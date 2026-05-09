"""Coordinator for HA Solar Reserve."""
from __future__ import annotations

import functools
import logging
from typing import TYPE_CHECKING
import datetime

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    CONF_TOTAL_HOME_ENERGY,
    CONF_BATTERY_REMAINING,
    CONF_SOLAR_REMAINING_TODAY,
    CONF_SOLAR_TOMORROW,
    CONF_METER_RESETS_DAILY,
    CONF_BATTERY_SENSOR_TYPE,
    CONF_BATTERY_CAPACITY_ENTITY,
    CONF_BATTERY_CAPACITY_MANUAL,
    CONF_EMERGENCY_RESERVE_PERCENT,
    CONF_LOAD_ENERGY,
    CONF_MORNING_BUFFER_HOURS,
    CONF_MAX_PERIOD_LOAD,
    CONF_CURRENT_SOLAR_POWER,
    CONF_CURRENT_HOME_POWER,
    CONF_MANAGED_LOAD_POWER,
    DEFAULT_AVG_NIGHT_LOAD,
    DEFAULT_AVG_DAY_LOAD,
    DEFAULT_APPLIANCE_POWER_KW,
    DEFAULT_MORNING_BUFFER_HOURS,
    DEFAULT_MAX_PERIOD_LOAD,
)

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.storage"


class SolarReserveCoordinator(DataUpdateCoordinator[dict]):
    """Class to manage fetching data from multiple states."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=None,
        )
        self.entry = entry
        # Single shared storage file for the integration.  A stored 'entry_id'
        # field is used to detect reinstalls: if the stored id doesn't match the
        # current entry, the data is from a previous install and snapshots are
        # re-seeded from live sensor values.  This avoids both the stale-snapshot
        # bug and the accumulation of orphaned per-entry storage files during
        # active development.
        self._store = Store[dict](hass, STORAGE_VERSION, STORAGE_KEY)

        # Persisted store: snapshot values and rolling load averages only
        self.data_store = {
            "overnight_load_tracker": 0.0,
            "sunset_energy": 0.0,
            "sunset_ac_energy": 0.0,
            "daily_loads": [],
            "daytime_load_tracker": 0.0,
            "sunrise_energy": 0.0,
            "sunrise_ac_energy": 0.0,
            "daily_day_loads": [],
            "last_sunset_time": None,
            "last_sunrise_time": None,
            # False only on a fresh install/reinstall when recorder seeding failed.
            # Defaults to True so existing upgrades don't re-trigger seeding.
            "snapshots_seeded": True,
            # 30-day historical peak of the managed load power sensor (kW).
            # Persisted so it survives restarts without needing an immediate recorder query.
            "managed_load_peak_kw": 0.0,
        }

        # In-memory only: rolling max values for meter-reset detection
        # These are re-seeded from snapshot values after each load
        self._session_max = {
            "max_energy_since_sunset": 0.0,
            "max_ac_energy_since_sunset": 0.0,
            "max_energy_since_sunrise": 0.0,
            "max_ac_energy_since_sunrise": 0.0,
        }

        # Cache of the last valid floats read, allowing graceful degradation if sensors go offline
        self._last_good_states = {}

        self.calculated_data = {
            "permission": False,
            "surplus_kwh": 0.0,
            "estimated_runtime": 0.0,
            "dynamic_expected_load": DEFAULT_AVG_NIGHT_LOAD,
            "avg_night_load": DEFAULT_AVG_NIGHT_LOAD,
            "avg_day_load": DEFAULT_AVG_DAY_LOAD,
            "tomorrow_deficit": 0.0,
            # Load trackers exposed here so sensors update via coordinator signal
            "overnight_load_tracker": 0.0,
            "daytime_load_tracker": 0.0,
            # Diagnostic sensors
            "energy_available_kwh": 0.0,
            "energy_required_kwh": 0.0,
            "solar_counted_kwh": 0.0,
            "current_battery_kwh": 0.0,
            "resolved_battery_capacity_kwh": 10.0,
            "managed_load_usage_kwh": 0.0,
            "night_data_days": 0,
            "day_data_days": 0,
            # Dashboard UX metadata
            "is_night": False,
            "battery_sensor_type": "energy",
            # Battery sustain diagnostics
            "managed_load_peak_kw": 0.0,
            "net_battery_discharge_kw": 0.0,
            "battery_sustain_hours": 0.0,
            "battery_sustain_required_kwh": 0.0,
            "battery_can_sustain": True,
            "current_solar_power_kw": 0.0,
            "current_home_power_kw": 0.0,
            "morning_buffer_hours_config": DEFAULT_MORNING_BUFFER_HOURS,
        }

    def _get_config(self, key, default=None):
        """Get config from options first, then data."""
        return self.entry.options.get(key, self.entry.data.get(key, default))

    async def _async_seed_from_recorder(self) -> bool:
        """Attempt to seed snapshots and rolling averages from HA recorder history.

        Queries sun.sun transitions to locate actual sunrise/sunset timestamps, then
        reads the energy sensors at those moments.  Also reconstructs up to 7 days of
        overnight/daytime load history for the rolling averages.

        Returns True when meaningful data was obtained; False when the recorder is
        unavailable, not yet ready, or has no relevant history (e.g. new install).
        The caller should fall back to deferred live-value seeding in that case.
        """
        try:
            from homeassistant.components.recorder import get_instance  # noqa: PLC0415
            from homeassistant.components.recorder.history import (  # noqa: PLC0415
                get_significant_states,
            )
            instance = get_instance(self.hass)
        except Exception:  # recorder not installed / not yet ready
            _LOGGER.debug("Solar Reserve: recorder unavailable, skipping historical seed")
            return False

        now = dt_util.utcnow()
        start_time = now - datetime.timedelta(days=9)

        home_entity = self._get_config(CONF_TOTAL_HOME_ENERGY)
        load_entity = self._get_config(CONF_LOAD_ENERGY)
        entities = ["sun.sun"]
        if home_entity:
            entities.append(home_entity)
        if load_entity:
            entities.append(load_entity)

        try:
            states_dict: dict = await instance.async_add_executor_job(
                functools.partial(
                    get_significant_states,
                    self.hass,
                    start_time,
                    now,
                    entity_ids=entities,
                    include_start_time_state=True,
                    significant_changes_only=False,
                )
            )
        except Exception as err:
            _LOGGER.debug("Solar Reserve: recorder query failed: %s", err)
            return False

        sun_states = states_dict.get("sun.sun", [])
        if len(sun_states) < 2:
            _LOGGER.debug("Solar Reserve: insufficient sun.sun history in recorder")
            return False

        # --- Locate sunrise / sunset transition timestamps ---
        sunrise_times: list = []
        sunset_times: list = []
        for i in range(1, len(sun_states)):
            prev, curr = sun_states[i - 1], sun_states[i]
            if prev.state == "below_horizon" and curr.state == "above_horizon":
                sunrise_times.append(curr.last_changed)
            elif prev.state == "above_horizon" and curr.state == "below_horizon":
                sunset_times.append(curr.last_changed)

        if not sunrise_times and not sunset_times:
            _LOGGER.debug("Solar Reserve: no sunrise/sunset transitions found in recorder")
            return False

        home_states = states_dict.get(home_entity, []) if home_entity else []
        load_states = states_dict.get(load_entity, []) if load_entity else []

        def _unit(entity_id: str) -> str:
            live = self.hass.states.get(entity_id)
            return live.attributes.get("unit_of_measurement", "") if live else ""

        def _value_at(states_list, target_time, entity_id):
            """Return the sensor kWh value at or just before target_time."""
            candidates = [s for s in states_list if s.last_changed <= target_time]
            if not candidates:
                return None
            s = candidates[-1]
            if s.state in (None, "unknown", "unavailable"):
                return None
            try:
                val = float(s.state)
                unit = _unit(entity_id)
                if unit == "Wh":
                    val /= 1000.0
                elif unit == "MWh":
                    val *= 1000.0
                return val
            except (ValueError, TypeError):
                return None

        # --- Seed most-recent sunrise / sunset snapshots ---
        seeded_any = False
        if sunrise_times:
            t = sunrise_times[-1]
            hv = _value_at(home_states, t, home_entity) if home_entity else None
            lv = _value_at(load_states, t, load_entity) if load_entity else None
            if hv is not None:
                self.data_store["sunrise_energy"] = hv
                self.data_store["last_sunrise_time"] = t.isoformat()
                seeded_any = True
            if lv is not None:
                self.data_store["sunrise_ac_energy"] = lv

        if sunset_times:
            t = sunset_times[-1]
            hv = _value_at(home_states, t, home_entity) if home_entity else None
            lv = _value_at(load_states, t, load_entity) if load_entity else None
            if hv is not None:
                self.data_store["sunset_energy"] = hv
                self.data_store["last_sunset_time"] = t.isoformat()
                seeded_any = True
            if lv is not None:
                self.data_store["sunset_ac_energy"] = lv

        if not seeded_any:
            _LOGGER.debug("Solar Reserve: recorder had transitions but no energy sensor values")
            return False

        # --- Reconstruct rolling load averages from historical periods ---
        all_sunrises = sorted(sunrise_times)
        all_sunsets = sorted(sunset_times)

        day_loads: list[float] = []
        for sr in all_sunrises:
            next_ss = next((t for t in all_sunsets if t > sr), None)
            if next_ss is None:
                continue
            h0 = _value_at(home_states, sr, home_entity) if home_entity else None
            h1 = _value_at(home_states, next_ss, home_entity) if home_entity else None
            l0 = _value_at(load_states, sr, load_entity) if load_entity else 0.0
            l1 = _value_at(load_states, next_ss, load_entity) if load_entity else 0.0
            if h0 is not None and h1 is not None and h1 > h0:
                day_loads.append(max(0.0, (h1 - h0) - ((l1 or 0.0) - (l0 or 0.0))))

        night_loads: list[float] = []
        for ss in all_sunsets:
            next_sr = next((t for t in all_sunrises if t > ss), None)
            if next_sr is None:
                continue
            h0 = _value_at(home_states, ss, home_entity) if home_entity else None
            h1 = _value_at(home_states, next_sr, home_entity) if home_entity else None
            l0 = _value_at(load_states, ss, load_entity) if load_entity else 0.0
            l1 = _value_at(load_states, next_sr, load_entity) if load_entity else 0.0
            if h0 is not None and h1 is not None and h1 > h0:
                night_loads.append(max(0.0, (h1 - h0) - ((l1 or 0.0) - (l0 or 0.0))))

        if day_loads:
            self.data_store["daily_day_loads"] = day_loads[-7:]
        if night_loads:
            self.data_store["daily_loads"] = night_loads[-7:]

        _LOGGER.info(
            "Solar Reserve: seeded from recorder — "
            "sunrise_energy=%.3f kWh, sunset_energy=%.3f kWh, "
            "sunrise_ac=%.3f kWh, sunset_ac=%.3f kWh, "
            "night_days=%d, day_days=%d",
            self.data_store.get("sunrise_energy", 0),
            self.data_store.get("sunset_energy", 0),
            self.data_store.get("sunrise_ac_energy", 0),
            self.data_store.get("sunset_ac_energy", 0),
            len(night_loads),
            len(day_loads),
        )
        return True

    async def async_initialize(self):
        """Load stored data and setup listeners."""
        stored = await self._store.async_load()
        # Only restore persisted data when it belongs to THIS config entry.
        # If the stored entry_id is absent or mismatched the file is from a
        # previous install; treat it as a first run and re-seed snapshots so
        # that _get_usage_since doesn't report the meter's entire lifetime as
        # 'energy used since the last snapshot'.
        if stored and stored.get("entry_id") == self.entry.entry_id:
            self.data_store.update(stored)
        else:
            # First run or reinstall: try to seed from recorder history so that
            # snapshots are based on actual sunrise/sunset values and rolling averages
            # are pre-populated.  If the recorder is unavailable or has no relevant
            # history, set snapshots_seeded=False so _recalculate() will seed from
            # the live sensor values the first time they are available (deferred
            # seeding avoids the startup race where sensors are still 'unknown').
            reason = "reinstall detected" if stored else "first run detected"
            seeded = await self._async_seed_from_recorder()
            if seeded:
                self.data_store["snapshots_seeded"] = True
                _LOGGER.info("Solar Reserve: %s — seeded from recorder history", reason)
            else:
                self.data_store["snapshots_seeded"] = False
                _LOGGER.info(
                    "Solar Reserve: %s — recorder unavailable or no history; "
                    "will seed snapshots from live sensor values on first valid reading",
                    reason,
                )

        if not self.data_store.get("last_sunset_time"):
            self.data_store["last_sunset_time"] = dt_util.utcnow().isoformat()
        if not self.data_store.get("last_sunrise_time"):
            self.data_store["last_sunrise_time"] = dt_util.utcnow().isoformat()

        # Seed session max values from the persisted snapshots
        self._session_max["max_energy_since_sunset"] = self.data_store["sunset_energy"]
        self._session_max["max_ac_energy_since_sunset"] = self.data_store["sunset_ac_energy"]
        self._session_max["max_energy_since_sunrise"] = self.data_store["sunrise_energy"]
        self._session_max["max_ac_energy_since_sunrise"] = self.data_store["sunrise_ac_energy"]

        # Sync load trackers into calculated_data
        self.calculated_data["overnight_load_tracker"] = self.data_store["overnight_load_tracker"]
        self.calculated_data["daytime_load_tracker"] = self.data_store["daytime_load_tracker"]

        self._recalc_average()

        # Sync persisted managed load peak into calculated_data on startup
        self.calculated_data["managed_load_peak_kw"] = self.data_store.get("managed_load_peak_kw", 0.0)

        entities = [
            self._get_config(CONF_TOTAL_HOME_ENERGY),
            self._get_config(CONF_BATTERY_REMAINING),
            self._get_config(CONF_SOLAR_REMAINING_TODAY),
            self._get_config(CONF_SOLAR_TOMORROW),
            self._get_config(CONF_LOAD_ENERGY),
            # Power sensors — trigger recalculate on each reading so permission is live
            self._get_config(CONF_CURRENT_SOLAR_POWER),
            self._get_config(CONF_CURRENT_HOME_POWER),
        ]

        cap_ent = self._get_config(CONF_BATTERY_CAPACITY_ENTITY)
        # Legacy fallback for users upgrading from v1.0.0
        legacy_cap = self.entry.data.get("battery_capacity", "")

        if cap_ent:
            entities.append(cap_ent)
        elif str(legacy_cap).startswith("sensor."):
            entities.append(str(legacy_cap))

        entities = [e for e in set(entities) if e is not None]

        self.entry.async_on_unload(
            async_track_state_change_event(
                self.hass, entities, self._async_sensor_changed
            )
        )

        self.entry.async_on_unload(
            async_track_state_change_event(
                self.hass, ["sun.sun"], self._async_sun_changed
            )
        )

        # Seed the 30-day managed load peak from recorder history
        await self._async_refresh_managed_load_peak()

        self.async_set_updated_data(self.calculated_data)
        self._recalculate()

    @callback
    def _async_sensor_changed(self, event):
        """Handle sensor state changes."""
        self._recalculate()

    @callback
    def _async_sun_changed(self, event):
        """Handle sun state changes (only on real horizon crossings)."""
        new_state = event.data.get("new_state")
        old_state = event.data.get("old_state")
        if not new_state or not old_state:
            return

        # Explicitly require transition FROM known state to prevent restart false triggers
        if old_state.state == "above_horizon" and new_state.state == "below_horizon":
            self._handle_sunset()
        elif old_state.state == "below_horizon" and new_state.state == "above_horizon":
            self._handle_sunrise()

        self._recalculate()

    def _safe_float(self, entity_id, default=0.0):
        """Safely read a sensor state, auto-scaling energy units to kWh."""
        if not entity_id:
            return default
        state = self.hass.states.get(entity_id)
        if state and state.state not in (None, "unknown", "unavailable"):
            try:
                val = float(state.state)
                unit = state.attributes.get("unit_of_measurement", "")
                if unit in ["W", "kW", "MW"]:
                    _LOGGER.error(
                        "Sensor %s is reporting instantaneous Power (%s). "
                        "You must use a cumulative Energy sensor (kWh/Wh/MWh)!",
                        entity_id, unit
                    )
                    return self._last_good_states.get(entity_id, default)
                if unit == "Wh":
                    val = val / 1000.0
                elif unit == "MWh":
                    val = val * 1000.0
                    
                self._last_good_states[entity_id] = val
                return val
            except (ValueError, TypeError):
                pass
                
        return self._last_good_states.get(entity_id, default)

    def _safe_power_kw(self, entity_id, default=0.0):
        """Safely read an instantaneous power sensor, returning value in kW.

        Accepts sensors reporting in W, kW, or MW and scales to kW automatically.
        Returns the last known good value if the sensor is temporarily unavailable.
        """
        if not entity_id:
            return default
        state = self.hass.states.get(entity_id)
        if state and state.state not in (None, "unknown", "unavailable"):
            try:
                val = float(state.state)
                unit = state.attributes.get("unit_of_measurement", "")
                if unit == "W":
                    val /= 1000.0
                elif unit == "MW":
                    val *= 1000.0
                # kW stays as-is; dimensionless treated as kW
                val = max(0.0, val)
                self._last_good_states[entity_id] = val
                return val
            except (ValueError, TypeError):
                pass
        return self._last_good_states.get(entity_id, default)

    async def _async_refresh_managed_load_peak(self) -> None:
        """Query the recorder for the 30-day peak of the managed load power sensor.

        The result is stored in data_store (persisted) and calculated_data so it
        survives restarts without an immediate recorder query.  Called once on init
        and again at each sunrise so the figure stays current.
        """
        entity_id = self._get_config(CONF_MANAGED_LOAD_POWER)
        if not entity_id:
            return

        try:
            from homeassistant.components.recorder import get_instance  # noqa: PLC0415
            from homeassistant.components.recorder.history import (  # noqa: PLC0415
                get_significant_states,
            )
            instance = get_instance(self.hass)
        except Exception:
            _LOGGER.debug("Solar Reserve: recorder unavailable for managed load peak query")
            return

        now = dt_util.utcnow()
        start_time = now - datetime.timedelta(days=30)

        try:
            states_dict: dict = await instance.async_add_executor_job(
                functools.partial(
                    get_significant_states,
                    self.hass,
                    start_time,
                    now,
                    entity_ids=[entity_id],
                    include_start_time_state=True,
                    significant_changes_only=True,
                )
            )
        except Exception as err:
            _LOGGER.debug("Solar Reserve: managed load peak query failed: %s", err)
            return

        states = states_dict.get(entity_id, [])
        if not states:
            _LOGGER.debug("Solar Reserve: no states returned for managed load power sensor %s", entity_id)
            return

        # Determine unit from the live state (most reliable source)
        live = self.hass.states.get(entity_id)
        unit = live.attributes.get("unit_of_measurement", "") if live else ""

        peak_kw = 0.0
        for s in states:
            if s.state in (None, "unknown", "unavailable"):
                continue
            try:
                val = float(s.state)
                if unit == "W":
                    val /= 1000.0
                elif unit == "MW":
                    val *= 1000.0
                if val > peak_kw:
                    peak_kw = val
            except (ValueError, TypeError):
                continue

        if peak_kw > 0:
            self.data_store["managed_load_peak_kw"] = round(peak_kw, 3)
            self.calculated_data["managed_load_peak_kw"] = round(peak_kw, 3)
            _LOGGER.info(
                "Solar Reserve: managed load 30-day peak = %.3f kW (%d states sampled)",
                peak_kw, len(states),
            )
        else:
            _LOGGER.debug(
                "Solar Reserve: managed load peak query returned no positive values for %s", entity_id
            )

    def _get_usage_since(self, entity_id, start_key, max_key):
        """Calculate energy used since a snapshot, handling daily resets."""
        if not entity_id:
            return 0.0
        current_val = self._safe_float(entity_id)
        start_val = self.data_store.get(start_key, current_val)

        # --- Layer 2: Zero-snapshot guard ---
        # If start_val is 0.0 but current_val is enormous, the snapshot was almost
        # certainly never seeded (e.g. after a restart before the first sunrise/sunset).
        # Returning the raw delta would inject a value equal to the meter's entire
        # lifetime reading into the rolling average.
        max_load = float(self._get_config(CONF_MAX_PERIOD_LOAD, DEFAULT_MAX_PERIOD_LOAD))
        if start_val == 0.0 and current_val > max_load:
            _LOGGER.warning(
                "Solar Reserve: Zero-snapshot guard triggered for %s "
                "(current=%.1f kWh exceeds max_period_load=%.1f kWh with start=0.0). "
                "Snapshot likely lost after restart — returning 0.0 to avoid corrupt delta.",
                entity_id, current_val, max_load,
            )
            return 0.0

        # Update in-memory max ONLY (not persisted data_store)
        current_max = self._session_max.get(max_key, start_val)
        if current_val > current_max:
            self._session_max[max_key] = current_val
            current_max = current_val

        check_daily_reset = self._get_config(CONF_METER_RESETS_DAILY, False)
        if check_daily_reset and current_val < start_val:
            # Meter reset: total used = (progress before reset) + (progress after reset)
            return max(0.0, (current_max - start_val) + current_val)
        return max(0.0, current_val - start_val)

    def _handle_sunset(self):
        """Record daytime load and take sunset snapshots for the night."""
        home_used = self._get_usage_since(
            self._get_config(CONF_TOTAL_HOME_ENERGY), "sunrise_energy", "max_energy_since_sunrise"
        )
        ac_used = self._get_usage_since(
            self._get_config(CONF_LOAD_ENERGY), "sunrise_ac_energy", "max_ac_energy_since_sunrise"
        )

        true_day_load = max(0.0, home_used - ac_used)
        self.data_store["daytime_load_tracker"] = true_day_load
        self.calculated_data["daytime_load_tracker"] = true_day_load

        # --- Layer 1: Configurable plausibility clamp ---
        # Only append to the rolling average when the delta is realistic.
        # A corrupted zero-start snapshot can produce values equal to the meter's
        # entire lifetime reading; we protect the 7-day average from such spikes.
        max_load = float(self._get_config(CONF_MAX_PERIOD_LOAD, DEFAULT_MAX_PERIOD_LOAD))
        loads = self.data_store.get("daily_day_loads", [])
        if true_day_load > max_load:
            _LOGGER.warning(
                "Solar Reserve: Daytime load %.2f kWh exceeds max_period_load %.1f kWh — "
                "skipping rolling average update to protect historical data. "
                "Check snapshot integrity or raise max_period_load_kwh in options.",
                true_day_load, max_load,
            )
        else:
            loads.append(true_day_load)
            if len(loads) > 7:
                loads.pop(0)
            self.data_store["daily_day_loads"] = loads
        self._recalc_average()

        # Take sunset snapshot
        home_state = self._safe_float(self._get_config(CONF_TOTAL_HOME_ENERGY))
        self.data_store["sunset_energy"] = home_state
        self._session_max["max_energy_since_sunset"] = home_state

        load_entity = self._get_config(CONF_LOAD_ENERGY)
        if load_entity:
            ac_state = self._safe_float(load_entity)
            self.data_store["sunset_ac_energy"] = ac_state
            self._session_max["max_ac_energy_since_sunset"] = ac_state

        self.data_store["last_sunset_time"] = dt_util.utcnow().isoformat()
        self.data_store["entry_id"] = self.entry.entry_id

        self.hass.async_create_task(self._store.async_save(self.data_store))

    def _handle_sunrise(self):
        """Record overnight load and take sunrise snapshots for the day."""
        home_used = self._get_usage_since(
            self._get_config(CONF_TOTAL_HOME_ENERGY), "sunset_energy", "max_energy_since_sunset"
        )
        ac_used = self._get_usage_since(
            self._get_config(CONF_LOAD_ENERGY), "sunset_ac_energy", "max_ac_energy_since_sunset"
        )

        true_night_load = max(0.0, home_used - ac_used)
        self.data_store["overnight_load_tracker"] = true_night_load
        self.calculated_data["overnight_load_tracker"] = true_night_load

        # --- Layer 1: Configurable plausibility clamp ---
        max_load = float(self._get_config(CONF_MAX_PERIOD_LOAD, DEFAULT_MAX_PERIOD_LOAD))
        loads = self.data_store.get("daily_loads", [])
        if true_night_load > max_load:
            _LOGGER.warning(
                "Solar Reserve: Overnight load %.2f kWh exceeds max_period_load %.1f kWh — "
                "skipping rolling average update to protect historical data. "
                "Check snapshot integrity or raise max_period_load_kwh in options.",
                true_night_load, max_load,
            )
        else:
            loads.append(true_night_load)
            if len(loads) > 7:
                loads.pop(0)
            self.data_store["daily_loads"] = loads
        self._recalc_average()

        # Take sunrise snapshot
        home_state = self._safe_float(self._get_config(CONF_TOTAL_HOME_ENERGY))
        self.data_store["sunrise_energy"] = home_state
        self._session_max["max_energy_since_sunrise"] = home_state

        load_entity = self._get_config(CONF_LOAD_ENERGY)
        if load_entity:
            ac_state = self._safe_float(load_entity)
            self.data_store["sunrise_ac_energy"] = ac_state
            self._session_max["max_ac_energy_since_sunrise"] = ac_state

        self.data_store["last_sunrise_time"] = dt_util.utcnow().isoformat()
        self.data_store["entry_id"] = self.entry.entry_id

        self.hass.async_create_task(self._store.async_save(self.data_store))

        # Refresh 30-day managed load peak daily at sunrise
        self.hass.async_create_task(self._async_refresh_managed_load_peak())

    def _recalc_average(self):
        """Recalculate the 7-day rolling averages, filtering statistical outliers."""

        def _median(lst):
            s = sorted(lst)
            n = len(s)
            return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0

        night_loads = self.data_store.get("daily_loads", [])
        if len(night_loads) > 1:
            med = _median(night_loads)
            # Layer 3: Discard values more than 3× the median (outliers from sensor errors).
            # The floor prevents filtering when the median itself is near zero.
            threshold = max(med * 3.0, DEFAULT_AVG_NIGHT_LOAD * 2)
            filtered_night = [l for l in night_loads if l <= threshold]
            if len(filtered_night) < len(night_loads):
                _LOGGER.warning(
                    "Solar Reserve: %d night-load outlier(s) excluded from average (threshold=%.1f kWh). "
                    "Raw values: %s",
                    len(night_loads) - len(filtered_night),
                    threshold,
                    [round(v, 2) for v in night_loads],
                )
            night_loads = filtered_night or night_loads  # fall back if all were filtered
        self.calculated_data["avg_night_load"] = (
            sum(night_loads) / len(night_loads) if night_loads else DEFAULT_AVG_NIGHT_LOAD
        )

        day_loads = self.data_store.get("daily_day_loads", [])
        if len(day_loads) > 1:
            med = _median(day_loads)
            threshold = max(med * 3.0, DEFAULT_AVG_DAY_LOAD * 2)
            filtered_day = [l for l in day_loads if l <= threshold]
            if len(filtered_day) < len(day_loads):
                _LOGGER.warning(
                    "Solar Reserve: %d day-load outlier(s) excluded from average (threshold=%.1f kWh). "
                    "Raw values: %s",
                    len(day_loads) - len(filtered_day),
                    threshold,
                    [round(v, 2) for v in day_loads],
                )
            day_loads = filtered_day or day_loads
        self.calculated_data["avg_day_load"] = (
            sum(day_loads) / len(day_loads) if day_loads else DEFAULT_AVG_DAY_LOAD
        )

    def _recalculate(self):
        """Perform the main surplus calculation."""
        # --- Deferred snapshot seeding ---
        # On a fresh install/reinstall where the recorder was unavailable, sensors
        # may have been 'unknown' at startup.  Seed from the first valid live reading
        # rather than from a 0.0 placeholder, which would inflate usage figures.
        if not self.data_store.get("snapshots_seeded", True):
            home_entity = self._get_config(CONF_TOTAL_HOME_ENERGY)
            load_entity = self._get_config(CONF_LOAD_ENERGY)
            home_state = self.hass.states.get(home_entity) if home_entity else None
            if home_state and home_state.state not in (None, "unknown", "unavailable"):
                hv = self._safe_float(home_entity)
                lv = self._safe_float(load_entity) if load_entity else 0.0
                self.data_store["sunrise_energy"] = hv
                self.data_store["sunset_energy"] = hv
                self.data_store["sunrise_ac_energy"] = lv
                self.data_store["sunset_ac_energy"] = lv
                self.data_store["snapshots_seeded"] = True
                self._session_max["max_energy_since_sunset"] = hv
                self._session_max["max_ac_energy_since_sunset"] = lv
                self._session_max["max_energy_since_sunrise"] = hv
                self._session_max["max_ac_energy_since_sunrise"] = lv
                _LOGGER.info(
                    "Solar Reserve: deferred seeding complete "
                    "(home=%.3f kWh, managed_load=%.3f kWh)", hv, lv
                )
                self.hass.async_create_task(
                    self._store.async_save(
                        {**self.data_store, "entry_id": self.entry.entry_id}
                    )
                )

        # --- Capacity: Entity sensor > Manual number > Legacy v1.0.0 fallback ---
        cap_ent = self._get_config(CONF_BATTERY_CAPACITY_ENTITY)
        cap_man = self._get_config(CONF_BATTERY_CAPACITY_MANUAL)

        if cap_ent:
            capacity = self._safe_float(cap_ent, 10.0)
        elif cap_man is not None:
            try:
                capacity = float(cap_man)
            except (ValueError, TypeError):
                capacity = 10.0
        else:
            capacity_raw = self.entry.data.get("battery_capacity", "10.0")
            if str(capacity_raw).startswith("sensor."):
                capacity = self._safe_float(str(capacity_raw), 10.0)
            else:
                try:
                    capacity = float(capacity_raw)
                except (ValueError, TypeError):
                    capacity = 10.0

        self.calculated_data["resolved_battery_capacity_kwh"] = round(capacity, 2)

        # --- Current battery level ---
        battery_sensor_state = self._safe_float(self._get_config(CONF_BATTERY_REMAINING), default=None)
        if battery_sensor_state is None:
            _LOGGER.debug("HA Solar Reserve: Battery sensor unavailable and no previous cache exists. Delaying recalculation.")
            self.calculated_data["permission"] = False
            self.async_set_updated_data(self.calculated_data)
            return
            
        sensor_type = self._get_config(CONF_BATTERY_SENSOR_TYPE, "energy")
        current_battery = (
            capacity * (battery_sensor_state / 100.0)
            if sensor_type == "percentage"
            else battery_sensor_state
        )

        solar_today = self._safe_float(self._get_config(CONF_SOLAR_REMAINING_TODAY), default=None)
        if solar_today is None:
            _LOGGER.debug("HA Solar Reserve: Solar today sensor unavailable and no previous cache exists. Delaying recalculation.")
            self.calculated_data["permission"] = False
            self.async_set_updated_data(self.calculated_data)
            return
            
        solar_tomorrow = self._safe_float(self._get_config(CONF_SOLAR_TOMORROW), default=0.0)

        avg_night_load = self.calculated_data["avg_night_load"]
        avg_day_load = self.calculated_data["avg_day_load"]

        # --- Dynamic expected load (shrinks through the night as house uses energy) ---
        sun_state = self.hass.states.get("sun.sun")
        is_night = sun_state is not None and sun_state.state == "below_horizon"

        # Export current battery kWh and metadata for dashboard display
        self.calculated_data["current_battery_kwh"] = round(current_battery, 2)
        self.calculated_data["is_night"] = is_night
        self.calculated_data["battery_sensor_type"] = sensor_type

        # After midnight and before sunrise the solar forecast sensor resets to the
        # full day's expected generation, but none of that energy is available yet.
        # Only count solar_today when the sun is above the horizon.
        solar_available_now = 0.0 if is_night else solar_today

        energy_available = current_battery + solar_available_now
        self.calculated_data["energy_available_kwh"] = round(energy_available, 2)
        self.calculated_data["solar_counted_kwh"] = round(solar_available_now, 2)

        now = dt_util.utcnow()

        def parse_str_time(dt_str):
            if not dt_str:
                return now
            try:
                parsed = dt_util.parse_datetime(dt_str)
                return parsed if parsed else now
            except Exception:
                return now
                
        # --- Morning Buffer Calculation ---
        buffer_hours = float(self._get_config(CONF_MORNING_BUFFER_HOURS, DEFAULT_MORNING_BUFFER_HOURS))
        last_sunset_dt = parse_str_time(self.data_store.get("last_sunset_time"))
        last_sunrise_dt = parse_str_time(self.data_store.get("last_sunrise_time"))
        
        # Determine actual daylight duration for the buffer hourly rate (fallback to 12)
        try:
            daylight_duration_secs = (last_sunset_dt - last_sunrise_dt).total_seconds()
            daylight_hours = max(4.0, abs(daylight_duration_secs) / 3600.0)
            morning_buffer_kwh = (avg_day_load / daylight_hours) * buffer_hours
        except (TypeError, ZeroDivisionError):
            morning_buffer_kwh = 0.0

        if is_night:
            home_used = self._get_usage_since(
                self._get_config(CONF_TOTAL_HOME_ENERGY), "sunset_energy", "max_energy_since_sunset"
            )
            ac_used = self._get_usage_since(
                self._get_config(CONF_LOAD_ENERGY), "sunset_ac_energy", "max_ac_energy_since_sunset"
            )
            used_so_far_tonight = max(0.0, home_used - ac_used)
            
            # Prorating
            last_sunset = parse_str_time(self.data_store.get("last_sunset_time"))
            next_rising_str = sun_state.attributes.get("next_rising") if sun_state else None
            next_event = parse_str_time(next_rising_str) if next_rising_str else (now + datetime.timedelta(hours=12))
            
            if next_event <= now:
                next_event = now + datetime.timedelta(hours=12)
                
            total_duration = (next_event - last_sunset).total_seconds()
            remaining_duration = (next_event - now).total_seconds()
            fraction_remaining = min(1.0, max(0.0, remaining_duration / max(1.0, total_duration)))

            prorated_expected = avg_night_load * fraction_remaining
            normal_expected = max(0.0, avg_night_load - used_so_far_tonight)
            rest_of_night_load = max(prorated_expected, normal_expected)
            rest_of_day_load = 0.0
            load_expected = rest_of_night_load

            managed_load_used = ac_used  # same quantity already computed above for used_so_far_tonight
        else:
            home_used = self._get_usage_since(
                self._get_config(CONF_TOTAL_HOME_ENERGY), "sunrise_energy", "max_energy_since_sunrise"
            )
            managed_load_used = self._get_usage_since(
                self._get_config(CONF_LOAD_ENERGY), "sunrise_ac_energy", "max_ac_energy_since_sunrise"
            )
            used_so_far_today = max(0.0, home_used - managed_load_used)
            
            # Prorating for day
            last_sunrise = parse_str_time(self.data_store.get("last_sunrise_time"))
            next_setting_str = sun_state.attributes.get("next_setting") if sun_state else None
            next_event = parse_str_time(next_setting_str) if next_setting_str else (now + datetime.timedelta(hours=12))
            
            if next_event <= now:
                next_event = now + datetime.timedelta(hours=12)
                
            total_duration = (next_event - last_sunrise).total_seconds()
            remaining_duration = (next_event - now).total_seconds()
            fraction_remaining = min(1.0, max(0.0, remaining_duration / max(1.0, total_duration)))

            prorated_expected_day = avg_day_load * fraction_remaining
            normal_expected_day = max(0.0, avg_day_load - used_so_far_today)
            rest_of_day_load = max(prorated_expected_day, normal_expected_day)
            rest_of_night_load = avg_night_load
            
            # Overall expected combines rest of day + full night
            load_expected = rest_of_day_load + rest_of_night_load

        # Append the morning buffer safely onto the expected load for the next dawn
        load_expected += morning_buffer_kwh

        self.calculated_data["dynamic_expected_load"] = load_expected
        self.calculated_data["managed_load_usage_kwh"] = round(managed_load_used, 3)

        # --- 36-Hour deficit engine ---
        tomorrow_expected_usage = avg_day_load + avg_night_load
        # morning_buffer_kwh is already explicitly reserved in load_expected above.
        # Deduct it here so the morning dead-zone is not counted a second time
        # when tomorrow's solar underperforms (i.e. when deficit > 0).
        tomorrow_deficit = max(0.0, tomorrow_expected_usage - morning_buffer_kwh - solar_tomorrow)
        self.calculated_data["tomorrow_deficit"] = tomorrow_deficit

        emergency_pct = float(self._get_config(CONF_EMERGENCY_RESERVE_PERCENT, 0))
        emergency_reserve = capacity * (emergency_pct / 100.0)
        total_reserve = tomorrow_deficit + emergency_reserve

        # --- Final surplus ---
        energy_required = load_expected + total_reserve
        self.calculated_data["energy_required_kwh"] = round(energy_required, 2)
        
        # --- UI Export Subcomponents ---
        self.calculated_data["dyn_rest_of_day_kwh"] = round(rest_of_day_load, 2)
        self.calculated_data["dyn_rest_of_night_kwh"] = round(rest_of_night_load, 2)
        self.calculated_data["dyn_morning_buffer_kwh"] = round(morning_buffer_kwh, 2)
        self.calculated_data["dyn_emergency_reserve_kwh"] = round(emergency_reserve, 2)

        # --- Data warm-up progress ---
        self.calculated_data["night_data_days"] = len(self.data_store.get("daily_loads", []))
        self.calculated_data["day_data_days"] = len(self.data_store.get("daily_day_loads", []))

        surplus = energy_available - energy_required

        self.calculated_data["surplus_kwh"] = surplus

        # --- Permission: two conditions must both be True ---
        #
        # (a) Overall surplus is positive — the existing energy-budget check.
        #
        # (b) Battery sustain check — the battery (above the emergency floor) can
        #     maintain the net discharge rate from right now until solar is expected
        #     to cover the combined home + managed load.  This prevents the managed
        #     load being switched ON only for the appliance to immediately pull from
        #     the grid because the usable battery headroom is effectively zero.
        #
        # Condition (b) is only evaluated when all three power sensors are configured.
        # If any is absent, only condition (a) governs.

        solar_ent = self._get_config(CONF_CURRENT_SOLAR_POWER)
        home_ent  = self._get_config(CONF_CURRENT_HOME_POWER)
        managed_load_peak_kw = self.data_store.get("managed_load_peak_kw", 0.0)
        power_sensors_ready = bool(solar_ent and home_ent and managed_load_peak_kw > 0)

        # Always expose the configured morning buffer hours for display
        _morning_buffer_hours = float(self._get_config(CONF_MORNING_BUFFER_HOURS, DEFAULT_MORNING_BUFFER_HOURS))
        self.calculated_data["morning_buffer_hours_config"] = _morning_buffer_hours

        if power_sensors_ready:
            solar_power_kw = self._safe_power_kw(solar_ent)
            home_power_kw  = self._safe_power_kw(home_ent)

            # If the managed load is already ON (previous permission was True), the
            # home power sensor already includes its draw — don't add peak again.
            prev_permission = self.calculated_data.get("permission", False)
            if prev_permission:
                projected_total_kw = home_power_kw
            else:
                projected_total_kw = home_power_kw + managed_load_peak_kw

            net_discharge_kw = max(0.0, projected_total_kw - solar_power_kw)

            if net_discharge_kw == 0.0:
                # Solar already covers home + managed load; battery not needed.
                battery_can_sustain = True
                sustain_required_kwh = 0.0
            else:
                usable_battery = max(0.0, current_battery - emergency_reserve)
                if is_night:
                    # Must sustain until sunrise; no solar help is coming.
                    sustain_required_kwh = net_discharge_kw * (remaining_duration / 3600.0)
                    battery_can_sustain = usable_battery >= sustain_required_kwh
                else:
                    # Daytime: require at least morning_buffer_hours of usable runway
                    # at the current net discharge rate before granting permission.
                    sustain_required_kwh = net_discharge_kw * _morning_buffer_hours
                    battery_can_sustain = usable_battery >= sustain_required_kwh

            # Export diagnostics
            self.calculated_data["current_solar_power_kw"] = round(solar_power_kw, 3)
            self.calculated_data["current_home_power_kw"] = round(home_power_kw, 3)
            self.calculated_data["net_battery_discharge_kw"] = round(net_discharge_kw, 3)
            self.calculated_data["battery_can_sustain"] = battery_can_sustain
            self.calculated_data["battery_sustain_required_kwh"] = round(sustain_required_kwh, 3)
            self.calculated_data["battery_sustain_hours"] = (
                round(max(0.0, current_battery - emergency_reserve) / net_discharge_kw, 2)
                if net_discharge_kw > 0 else 999.0
            )
        else:
            # Power sensors not configured — fall back to surplus check only.
            battery_can_sustain = True
            self.calculated_data["current_solar_power_kw"] = 0.0
            self.calculated_data["current_home_power_kw"] = 0.0
            self.calculated_data["net_battery_discharge_kw"] = 0.0
            self.calculated_data["battery_can_sustain"] = True
            self.calculated_data["battery_sustain_required_kwh"] = 0.0
            self.calculated_data["battery_sustain_hours"] = 0.0

        self.calculated_data["managed_load_peak_kw"] = round(managed_load_peak_kw, 3)
        self.calculated_data["permission"] = surplus > 0 and battery_can_sustain
        try:
            self.calculated_data["estimated_runtime"] = (
                max(0.0, surplus / DEFAULT_APPLIANCE_POWER_KW) if surplus > 0 else 0.0
            )
        except ZeroDivisionError:
            self.calculated_data["estimated_runtime"] = 0.0

        home_state = self._safe_float(self._get_config(CONF_TOTAL_HOME_ENERGY))
        self.calculated_data["raw_home_energy"] = home_state
        
        load_entity = self._get_config(CONF_LOAD_ENERGY)
        if load_entity:
            self.calculated_data["raw_managed_load"] = self._safe_float(load_entity)
        else:
            self.calculated_data["raw_managed_load"] = 0.0

        self.calculated_data["raw_solar_today"] = solar_today
        self.calculated_data["raw_solar_tomorrow"] = solar_tomorrow
        self.calculated_data["raw_battery_percent"] = battery_sensor_state

        self.async_set_updated_data(self.calculated_data)
