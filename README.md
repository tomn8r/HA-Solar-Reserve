# HA Solar Reserve

A highly advanced, dynamic Home Assistant custom integration designed to intelligently manage high-energy loads (like a "Solar Sponge" AC system) based on real-time solar forecasts and rolling historical energy usage.

Instead of relying on arbitrary static battery reserves, Solar Sponge uses a **36-Hour Predictive Engine** to automatically calculate exactly how much battery power you need to survive tonight and tomorrow, guaranteeing your battery is never unnecessarily depleted by thirsty smart appliances.

## Features

- **36-Hour Predictive Engine**: Dynamically calculates the deficit between tomorrow's expected solar harvest and your next 24-hours of expected house load. It adjusts your battery reserve in real-time.
- **Symmetrical Load Tracking**: Automatically tracks the exact amount of energy your house uses between Sunrise and Sunset (Day Load) and Sunset and Sunrise (Night Load).
- **Interactive Analytics Dashboard**: A dedicated panel providing a "Balance Sheet" view of your energy assets (Battery + Solar) vs liabilities (Expected Load + Deficit + Emergency Reserve). Features hover tooltips for logic explanations and click-to-open entity popups.
- **Production-Grade Hardening**: Implements "Graceful Degradation" logic where the engine caches last-known-good sensor states to prevent integration crashes or math spikes if sensors go unavailable.
- **Managed Load Isolation**: Mathematically removes heavy appliance consumption from your baseline to prevent feedback loops inflating your expected load.
- **Unit Auto-Scaling**: Native support for `Wh`, `kWh`, and `MWh` with automatic conversion.

## Requirements

To use this integration, you must have the following entities available in Home Assistant:
1. **Total Home Energy Sensor**: A cumulative energy sensor (kWh).
2. **Solar Forecast Sensors**: Two sensors detailing your Solar Forecast Remaining Today and Solar Forecast Tomorrow.
3. **Battery Sensor**: A sensor detailing your battery's current state of charge (either in kWh or %).
4. **sun.sun**: The native Home Assistant sun tracker must be enabled.

## Installation

### Method 1: HACS (Recommended)
1. Open Home Assistant and navigate to **HACS**.
2. Click **Integrations** -> **Custom repositories** (three dots in top right).
3. Add the URL to this repository and select `Integration` as the category.
4. Click **Download** and restart Home Assistant.

### Method 2: Manual Installation
1. Download the `solar_reserve` folder from the `custom_components` directory in this repository.
2. Copy the folder to your Home Assistant `custom_components` directory (`/config/custom_components/solar_reserve`).
3. Restart Home Assistant.

## Configuration

1. Navigate to **Settings -> Devices & Services**.
2. Click **+ Add Integration** and search for `HA Solar Reserve`.
3. Follow the two-step wizard to map your energy inputs and battery constraints.
4. (Optional) Access the **Analytics Dashboard** via the sidebar.

## Exposed Sensors
The integration provides a comprehensive set of diagnostic sensors for full transparency:

- **Primary Logic**
  - `binary_sensor.solar_reserve_permission`: The master switch for automation.
  - `sensor.calculated_surplus`: The raw kWh balance driving the decision.
- **The Equation (Liabilities & Assets)**
  - `sensor.energy_available`: Total assets (Battery kWh + Solar Today).
  - `sensor.energy_required`: Total liabilities (Load + Deficit + Reserve).
  - `sensor.battery_capacity`: The confirmed capacity being used by the engine.
- **Historical Tracking**
  - `sensor.overnight_load_tracker`: Energy used during the last/current night.
  - `sensor.daytime_load_tracker`: Energy used during the last/current day.
  - `sensor.average_overnight_load`: 7-day rolling average of night load.
  - `sensor.average_daytime_load`: 7-day rolling average of day load.
- **Diagnostics**
  - `sensor.managed_load_usage`: Real-time tracking of isolated heavy loads.
  - `sensor.night_data_days_collected`: Data warmup progress (0-7 days).

## Changelog

### v1.1.0-beta.1 (Hardened Beta Release)
- **New Dashboard:** Complete redesign with "Balance Sheet" layout and interactive logic tooltips.
- **Interactive UI:** Added click-to-open entity popups and a direct "⚙ Configure" link.
- **Logic Hardening:** Added sensor-state caching to prevent crashes/spikes during sensor dropouts.
- **Refined Math:** Improved morning buffer prorating and tomorrow-deficit logic.
- **Nomenclature:** Renamed "Resolved Battery Capacity" to "Battery Capacity" for clarity.
- **AI-Ready:** Added `ai_deployment_protocol.md` for automated version management.
