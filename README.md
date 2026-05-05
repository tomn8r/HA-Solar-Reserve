# HA Solar Reserve

A Home Assistant custom integration that decides whether your battery has enough charge to run a high-draw appliance — like a "solar sponge" AC system — without leaving you short tonight or tomorrow.

The core idea is simple: instead of setting a fixed battery reserve percentage and hoping for the best, this integration looks at your actual usage patterns and tomorrow's solar forecast to work out exactly how much charge you can afford to spend right now.

---

## How it works

Every time your energy sensors update, the integration recalculates a single question: **is there a surplus?**

**Surplus = Energy Available − Energy Required**

- **Energy Available** = battery charge right now + remaining solar forecast for today (solar is set to zero at night, since that energy hasn't arrived yet)
- **Energy Required** = expected load for the rest of this period + tomorrow's shortfall + any emergency reserve you've configured

If the surplus is positive, the `Permission` binary sensor turns `on`. Hook that into an automation to run your load. When the surplus goes negative — because clouds rolled in, the battery dropped, or tomorrow looks grim — permission turns `off`.

### Load learning

The integration tracks your actual energy consumption separately for day and night, isolating the managed load (e.g. the AC) so it doesn't skew the baseline. After each sunrise/sunset it records how much "base" energy the house used, and builds a 7-day rolling average for both day and night periods. These averages feed directly into the expected load calculation, so the system adapts to seasonal changes in your usage without any manual tuning.

### Tomorrow's deficit

If tomorrow's solar forecast is lower than your expected daily usage, that shortfall is added to tonight's reserve requirement. This prevents the battery being run down today when tomorrow is a cloudy day.

### Prorated load expectation

The expected load shrinks dynamically through the night (or day) as the house actually uses energy. Halfway through the night, you only need to hold half the overnight average in reserve — the house has already consumed the other half. This avoids the integration being unnecessarily conservative in the second half of each period.

### Morning buffer

A configurable buffer (default 1.5 hours) reserves a small amount of energy to cover the gap between astronomical sunrise and the point where solar generation is actually meaningful. The buffer is sized proportionally to your average day load and the day's length, so it adjusts seasonally.

---

## Requirements

You need the following entities in Home Assistant before setting up:

| Entity | Notes |
|---|---|
| **Total Home Energy** | Cumulative energy sensor (`kWh`, `Wh`, or `MWh`). Must be the whole-home total, not just one circuit. |
| **Solar Forecast — Today** | Remaining solar energy expected today (from Solcast or similar). |
| **Solar Forecast — Tomorrow** | Total solar energy expected tomorrow. |
| **Battery Sensor** | Either a kWh or % sensor. Capacity must be specified if using %. |
| **Managed Load Energy** *(optional)* | A cumulative energy sensor for the appliance or appliances being isolated (e.g. the AC circuit). Without this, the load isolation math is skipped. |
| **`sun.sun`** | The standard HA sun integration — must be enabled. |

Energy sensors must be **cumulative** (always increasing, not resetting each interval). If your meter resets daily there's an option for that during setup.

---

## Installation

### Via HACS

1. Go to **HACS → Integrations → Custom repositories** (three-dot menu).
2. Add this repository URL and select `Integration`.
3. Download and restart Home Assistant.

### Manual

1. Copy the `solar_reserve` folder from `custom_components/` into your HA `config/custom_components/` directory.
2. Restart Home Assistant.

---

## Setup

Go to **Settings → Devices & Services → Add Integration** and search for `HA Solar Reserve`. The setup runs across two screens:

**Screen 1 — Energy inputs**
- Total home energy sensor
- Whether the meter resets daily (leave unchecked for continuously-accumulating sensors)
- Managed load energy sensor (optional)
- Solar forecast sensors (today and tomorrow)
- Morning buffer hours (default 1.5)

**Screen 2 — Battery**
- Battery sensor and whether it reports in kWh or %
- Battery capacity — either a sensor entity or a fixed number in kWh
- Emergency reserve percentage (held back regardless of surplus)

All settings can be changed later via **Configure** on the integration card.

---

## Sensors

All entities appear under a single **HA Solar Reserve** device card.

### The decision

| Entity | What it tells you |
|---|---|
| `binary_sensor.ha_solar_reserve_permission` | `on` when surplus > 0. Wire this into your automation. |
| `sensor.ha_solar_reserve_calculated_surplus` | The raw kWh margin (positive = go, negative = hold). |

### The calculation components

| Entity | What it tells you |
|---|---|
| `sensor.ha_solar_reserve_energy_available` | Battery + solar counted today |
| `sensor.ha_solar_reserve_energy_required` | Expected load + tomorrow's deficit + emergency reserve |
| `sensor.ha_solar_reserve_solar_counted_today` | Solar contribution being counted (zero at night) |
| `sensor.ha_solar_reserve_current_battery_charge` | Battery in kWh, regardless of whether your sensor reports % or kWh |
| `sensor.ha_solar_reserve_battery_capacity` | The capacity value the engine is actually using — useful to verify the right number was picked up |

### Load history

| Entity | What it tells you |
|---|---|
| `sensor.ha_solar_reserve_overnight_load_tracker` | Base energy used last night (managed load isolated) |
| `sensor.ha_solar_reserve_average_overnight_load` | 7-day rolling average of overnight base load |
| `sensor.ha_solar_reserve_daytime_load_tracker` | Base energy used last day (managed load isolated) |
| `sensor.ha_solar_reserve_average_daytime_load` | 7-day rolling average of daytime base load |
| `sensor.ha_solar_reserve_managed_load_usage` | Energy the managed load has used since the last sunrise/sunset |

### Warm-up progress

| Entity | What it tells you |
|---|---|
| `sensor.ha_solar_reserve_night_data_days_collected` | Nights of data collected (0–7). Averages start from a 10 kWh default while warming up. |
| `sensor.ha_solar_reserve_day_data_days_collected` | Days of data collected (0–7). |

---

## A note on fresh installs and reinstalls

On a fresh install, the integration queries HA's recorder to seed the sunrise/sunset energy snapshots and pre-populate the 7-day rolling averages from actual history. If the recorder isn't available (or there's no history yet), it waits for the first valid sensor reading before setting the baseline — rather than seeding to zero, which would make usage figures look enormous.

On a reinstall (remove and re-add), the same process runs again automatically. Historical data stored in HA's entity registry (the actual sensor history) is always preserved regardless of reinstall — only the integration's own internal state is re-seeded.

---

## Tips

- **The `Permission` binary sensor is the only thing you need in your automation.** All the other sensors are diagnostic — they exist so you can understand and verify what the engine is doing.
- **Check `Calculated Surplus` if permission seems wrong.** A small negative number means you're very close to the threshold — it's working as intended.
- **`Night/Day Data Days Collected` will show 0–7 for the first week.** During warmup the averages use a 10 kWh default, so the engine is conservative until it has real data.
- **The managed load sensor must be cumulative energy, not instantaneous power.** A power sensor (W or kW) will be rejected with an error in the HA log.
