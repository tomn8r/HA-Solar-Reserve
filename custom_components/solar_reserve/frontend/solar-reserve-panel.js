class SolarReservePanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this.entities = {};
    this._prevSurplus = null;
    this._permissionState = null;
    this._permissionSince = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.content) {
      this.init();
    }
    this.updateData();
  }

  init() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          padding: 16px;
          font-family: var(--paper-font-body1_-_font-family), -apple-system, Roboto, sans-serif;
          background: var(--primary-background-color);
          color: var(--primary-text-color);
          box-sizing: border-box;
        }
        * { box-sizing: border-box; }

        .dashboard-container {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding-bottom: 30px;
        }

        .header {
          padding: 16px 8px 8px 8px;
        }

        .header h1 {
          font-size: 2rem;
          font-weight: 400;
          margin: 0;
          color: var(--primary-text-color);
        }

        .card {
          background: var(--ha-card-background, var(--card-background-color, #fff));
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, 0px 2px 1px -1px rgba(0,0,0,0.2), 0px 1px 1px 0px rgba(0,0,0,0.14), 0px 1px 3px 0px rgba(0,0,0,0.12));
          padding: 16px;
        }

        .card-header {
          font-size: 1.25rem;
          font-weight: 500;
          margin-bottom: 16px;
          color: var(--primary-text-color);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .grid-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        @media (max-width: 768px) {
          .grid-2 { grid-template-columns: 1fr; }
        }

        .metric-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12));
          font-size: 1rem;
        }
        .metric-row:last-child {
          border-bottom: none;
        }

        .metric-row.sub-row {
          padding-left: 24px;
          font-size: 0.9rem;
          color: var(--secondary-text-color);
        }

        .metric-row.total-row {
          font-weight: bold;
          border-top: 2px solid var(--divider-color, rgba(0,0,0,0.12));
          border-bottom: none;
          padding-top: 12px;
          margin-top: 8px;
        }

        .value {
          font-weight: 500;
        }

        /* Large Status Displays */
        .status-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 24px 0;
        }

        .status-value {
          font-size: 3rem;
          font-weight: 500;
          line-height: 1.2;
        }

        .status-label {
          color: var(--secondary-text-color);
          font-size: 1rem;
        }

        .status-on  { color: var(--success-color, #4caf50); }
        .status-off { color: var(--error-color, #f44336); }
        .status-neutral { color: var(--primary-color, #03a9f4); }

        .chip {
          background: var(--secondary-background-color);
          padding: 4px 12px;
          border-radius: 16px;
          font-size: 0.85rem;
          color: var(--secondary-text-color);
        }

        .clickable {
          cursor: pointer;
          transition: background-color 0.2s;
          border-radius: 4px;
        }
        .clickable:hover {
          background-color: var(--secondary-background-color, rgba(128,128,128,0.1));
        }

        .config-link {
          color: var(--primary-color);
          text-decoration: none;
          font-weight: 500;
          font-size: 1rem;
        }
        .config-link:hover { text-decoration: underline; }

        /* ── Warmup banner ─────────────────────────────────────────────── */
        .warmup-banner {
          display: flex;
          align-items: center;
          gap: 12px;
          background: var(--warning-color, #ff9800);
          color: #fff;
          border-radius: var(--ha-card-border-radius, 12px);
          padding: 14px 18px;
        }
        .warmup-banner .banner-icon { font-size: 1.6rem; flex-shrink: 0; }
        .warmup-banner .banner-text { flex: 1; line-height: 1.4; }
        .warmup-banner .banner-text strong { display: block; font-size: 1rem; }
        .warmup-banner .banner-text span  { font-size: 0.875rem; opacity: 0.9; }

        /* ── Energy-Assets formula ─────────────────────────────────────── */
        .energy-formula {
          display: flex;
          align-items: stretch;
          gap: 8px;
          padding: 4px 0 16px 0;
          flex-wrap: wrap;
        }
        .formula-item {
          flex: 1;
          min-width: 80px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: 10px 8px;
          background: var(--secondary-background-color, rgba(128,128,128,0.07));
          border-radius: 8px;
          gap: 2px;
        }
        .formula-item.formula-total {
          background: rgba(76, 175, 80, 0.12);
        }
        .formula-icon  { font-size: 1.5rem; }
        .formula-label { font-size: 0.78rem; color: var(--secondary-text-color); }
        .formula-value { font-size: 1.4rem; font-weight: 500; }
        .formula-unit  { font-size: 0.75rem; color: var(--secondary-text-color); }
        .formula-op {
          display: flex;
          align-items: center;
          font-size: 1.6rem;
          font-weight: 300;
          color: var(--secondary-text-color);
          padding: 0 2px;
          flex-shrink: 0;
        }

        /* ── Loading placeholder ───────────────────────────────────────── */
        .loading {
          color: var(--secondary-text-color);
          font-style: italic;
          font-size: 0.85rem;
        }

        /* ── Collapsible detail groups ─────────────────────────────────── */
        details.detail-group { margin: 2px 0; }
        details.detail-group summary.detail-summary {
          cursor: pointer;
          padding: 5px 8px 5px 0;
          font-size: 0.85rem;
          color: var(--secondary-text-color);
          list-style: none;
          display: flex;
          align-items: center;
          gap: 6px;
          user-select: none;
          border-radius: 4px;
        }
        details.detail-group summary.detail-summary::-webkit-details-marker { display: none; }
        details.detail-group summary.detail-summary::before {
          content: '▶';
          font-size: 0.65rem;
          transition: transform 0.15s;
          display: inline-block;
          flex-shrink: 0;
        }
        details[open].detail-group summary.detail-summary::before { transform: rotate(90deg); }
        details.detail-group summary.detail-summary:hover {
          background: var(--secondary-background-color, rgba(128,128,128,0.1));
        }

        /* ── Surplus trend indicator ───────────────────────────────────── */
        .trend-indicator { font-size: 1.1rem; margin-left: 4px; line-height: 1; }
        .trend-up   { color: var(--success-color, #4caf50); }
        .trend-down { color: var(--error-color, #f44336); }
        .trend-stable { color: var(--secondary-text-color); }

        /* ── Permission since chip ─────────────────────────────────────── */
        .permission-since {
          color: var(--secondary-text-color);
          font-size: 0.8rem;
          margin-top: 6px;
          min-height: 1em;
        }

        /* ── Night/Day phase badge ─────────────────────────────────────── */
        .phase-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 2px 10px;
          border-radius: 12px;
          font-size: 0.88rem;
          font-weight: 500;
        }
        .phase-day   { background: rgba(255,152,0,0.15);  color: #e65100; }
        .phase-night { background: rgba(33,150,243,0.12); color: var(--primary-color, #03a9f4); }

        /* ── Active/inactive load segment labels ───────────────────────── */
        .segment-active   { font-weight: 600; color: var(--primary-text-color); }
        .segment-inactive { color: var(--secondary-text-color); }

        /* ── CSV Export controls ─────────────────────────────────────────── */
        .export-controls {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .export-select {
          background: var(--ha-card-background, var(--card-background-color, #fff));
          color: var(--primary-text-color);
          border: 1px solid var(--divider-color, rgba(0,0,0,0.12));
          border-radius: 8px;
          padding: 7px 12px;
          font-size: 0.9rem;
          cursor: pointer;
        }
        .export-btn {
          background: var(--primary-color, #03a9f4);
          color: var(--text-primary-color, #fff);
          border: none;
          border-radius: 8px;
          padding: 8px 16px;
          cursor: pointer;
          font-size: 0.9rem;
          font-weight: 500;
          white-space: nowrap;
        }
        .export-btn:hover { opacity: 0.85; }
        .export-btn:disabled { opacity: 0.5; cursor: wait; }
      </style>

      <div class="dashboard-container">
        <!-- Header -->
        <div class="header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <h1>HA Solar Reserve Analytics</h1>
          <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <a href="/config/integrations/integration/solar_reserve" class="config-link">⚙ Configure Integration</a>
            <div class="export-controls">
              <select id="export-range" class="export-select" title="Select export time range">
                <option value="snapshot">Current Snapshot</option>
                <option value="24h">Last 24 Hours</option>
                <option value="7d">Last 7 Days</option>
                <option value="all">All History</option>
              </select>
              <button id="export-btn" class="export-btn">⬇ Export CSV</button>
            </div>
          </div>
        </div>

        <!-- Warmup Banner (hidden until data available) -->
        <div id="warmup-banner" style="display:none" class="warmup-banner">
          <div class="banner-icon">⏳</div>
          <div class="banner-text">
            <strong>Data warming up</strong>
            <span id="warmup-detail">Collecting historical load data. Accuracy improves over 7 days.</span>
          </div>
        </div>

        <!-- Master Output + System Intel -->
        <div class="grid-2">
          <div class="card">
            <div class="card-header">Master Output</div>
            <div class="grid-2">
              <div class="status-container">
                <div class="status-label">Permission</div>
                <div id="permission-status" class="status-value status-off">-</div>
                <div id="permission-since" class="permission-since"></div>
              </div>
              <div class="status-container">
                <div class="status-label">Calculated Surplus</div>
                <div style="display:flex; align-items:baseline; justify-content:center; gap:6px;">
                  <div id="surplus-val" class="status-value status-neutral">-</div>
                  <span id="surplus-trend" class="trend-indicator"></span>
                </div>
                <div class="status-label">kWh</div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">System Intel</div>
            <div class="metric-row">
              <span>Current Phase</span>
              <span id="sun-phase" class="value">-</span>
            </div>
            <div class="metric-row">
              <span>Estimated Runtime Remaining</span>
              <span id="runtime-val" class="value">-</span>
            </div>
            <div class="metric-row">
              <span>Data Warmup Nights (Max 7)</span>
              <span id="warmup-night" class="value">-</span>
            </div>
            <div class="metric-row">
              <span>Data Warmup Days (Max 7)</span>
              <span id="warmup-day" class="value">-</span>
            </div>
          </div>
        </div>

        <!-- Energy Equation -->
        <div class="grid-2">
          <!-- Assets -->
          <div class="card">
            <div class="card-header">Energy Assets (Available)</div>

            <!-- Formula: Battery + Solar = Total -->
            <div class="energy-formula">
              <div class="formula-item" id="batt-charge-item">
                <div class="formula-icon">🔋</div>
                <div class="formula-label">Battery Charge</div>
                <div id="batt-charge" class="formula-value">—</div>
                <div class="formula-unit">kWh</div>
              </div>
              <div class="formula-op">+</div>
              <div class="formula-item" id="solar-today-item">
                <div class="formula-icon">☀️</div>
                <div class="formula-label">Solar Today</div>
                <div id="solar-today" class="formula-value">—</div>
                <div class="formula-unit">kWh</div>
              </div>
              <div class="formula-op">=</div>
              <div class="formula-item formula-total" id="total-assets-item">
                <div class="formula-icon">⚡</div>
                <div class="formula-label">Total Available</div>
                <div id="total-assets" class="formula-value">—</div>
                <div class="formula-unit">kWh</div>
              </div>
            </div>

            <div class="metric-row sub-row">
              <span>Battery Rated Capacity</span>
              <span id="batt-cap" class="value">-</span>
            </div>
            <div class="metric-row sub-row">
              <span>Battery Input (Raw)</span>
              <span id="raw-battery" class="value">-</span>
            </div>
          </div>

          <!-- Liabilities (collapsible) -->
          <div class="card">
            <div class="card-header">Energy Liabilities (Required)</div>

            <div class="metric-row">
              <span>Dynamic Expected Load</span>
              <span id="exp-load" class="value">-</span>
            </div>
            <details class="detail-group" open>
              <summary class="detail-summary">Load breakdown</summary>
              <div class="metric-row sub-row">
                <span id="dyn-day-label">Rest of Day Target</span>
                <span id="dyn-day" class="value">-</span>
              </div>
              <div class="metric-row sub-row">
                <span id="dyn-night-label">Rest of Night Target</span>
                <span id="dyn-night" class="value">-</span>
              </div>
              <div class="metric-row sub-row">
                <span>Next Morning Buffer</span>
                <span id="dyn-buffer" class="value">-</span>
              </div>
            </details>

            <div class="metric-row">
              <span>Tomorrow's Deficit</span>
              <span id="tom-deficit" class="value">-</span>
            </div>
            <details class="detail-group" open>
              <summary class="detail-summary">Tomorrow's forecast</summary>
              <div class="metric-row sub-row">
                <span>Expected Tomorrow (Day+Night)</span>
                <span id="tom-expected" class="value">-</span>
              </div>
              <div class="metric-row sub-row">
                <span>Solar Output Tomorrow</span>
                <span id="solar-tom" class="value">-</span>
              </div>
            </details>

            <div class="metric-row">
              <span>Emergency Reserve Segment</span>
              <span id="dyn-emerg" class="value">-</span>
            </div>

            <div class="metric-row total-row">
              <span>Total Energy Required</span>
              <span id="total-liab" class="value" style="color:var(--error-color,#f44336);">-</span>
            </div>
          </div>
        </div>

        <!-- Historical Breakdown -->
        <div class="card">
          <div class="card-header">Load Trackers &amp; Diagnostics</div>
          <div class="grid-2">
            <div>
              <div class="metric-row">
                <span>Overnight Usage (Current/Last)</span>
                <span id="night-actual" class="value">-</span>
              </div>
              <div class="metric-row sub-row">
                <span>Rolling 7-Night Average</span>
                <span id="night-avg" class="value">-</span>
              </div>
              <div class="metric-row sub-row">
                <span>Sunset Energy Snapshot</span>
                <span id="sunset-snap" class="value">-</span>
              </div>
            </div>
            <div>
              <div class="metric-row">
                <span>Daytime Usage (Current/Last)</span>
                <span id="day-actual" class="value">-</span>
              </div>
              <div class="metric-row sub-row">
                <span>Rolling 7-Day Average</span>
                <span id="day-avg" class="value">-</span>
              </div>
              <div class="metric-row sub-row">
                <span>Sunrise Energy Snapshot</span>
                <span id="sunrise-snap" class="value">-</span>
              </div>
            </div>
          </div>
          <div style="margin-top:16px; border-top:1px solid var(--divider-color,rgba(0,0,0,0.12)); padding-top:16px;">
            <div class="metric-row">
              <span>Managed Load Usage Segment</span>
              <span id="managed-load" class="value">-</span>
            </div>
            <div class="metric-row sub-row">
              <span>Used since last horizon crossing</span>
            </div>
          </div>
        </div>

        <!-- Raw Configuration Inputs -->
        <div class="card">
          <div class="card-header">Raw Configuration Inputs</div>
          <div class="grid-2">
            <div>
              <div class="metric-row">
                <span>Total Home Energy (Cumulative)</span>
                <span id="raw-home" class="value">-</span>
              </div>
              <div class="metric-row">
                <span>Managed Load Sensor (Cumulative)</span>
                <span id="raw-managed" class="value">-</span>
              </div>
              <div class="metric-row">
                <span>Battery Status Sensor (Raw)</span>
                <span id="raw-battery-full" class="value">-</span>
              </div>
            </div>
            <div>
              <div class="metric-row">
                <span>Solar Forecast Remaining Today</span>
                <span id="raw-solar-today" class="value">-</span>
              </div>
              <div class="metric-row">
                <span>Solar Forecast Tomorrow</span>
                <span id="raw-solar-tom" class="value">-</span>
              </div>
              <div class="metric-row">
                <span>Rated Energy Capacity</span>
                <span id="raw-cap" class="value">-</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    `;
    this.content = true;

    const exportBtn = this.shadowRoot.getElementById('export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this._handleExport());
    }
  }

  updateData() {
    if (!this._hass) return;

    const states = this._hass.states;
    let data = {};

    for (const [entityId, stateObj] of Object.entries(states)) {
      if (entityId.includes('solar_reserve')) {
        if      (entityId.includes('solar_reserve_permission'))  data.permission      = stateObj;
        else if (entityId.includes('calculated_surplus'))        data.surplus         = stateObj;
        else if (entityId.includes('energy_available'))          data.available       = stateObj;
        else if (entityId.includes('energy_required'))           data.required        = stateObj;
        else if (entityId.includes('average_overnight_load'))    data.avgNight        = stateObj;
        else if (entityId.includes('overnight_load_tracker'))    data.actNight        = stateObj;
        else if (entityId.includes('average_daytime_load'))      data.avgDay          = stateObj;
        else if (entityId.includes('daytime_load_tracker'))      data.actDay          = stateObj;
        else if (entityId.includes('current_battery_charge'))    data.battCharge      = stateObj;
        else if (entityId.includes('battery_capacity'))          data.batteryCap      = stateObj;
        else if (entityId.includes('solar_counted_today'))       data.solarCounted    = stateObj;
        else if (entityId.includes('managed_load_usage'))        data.managed         = stateObj;
        else if (entityId.includes('night_data_days'))           data.nightDays       = stateObj;
        else if (entityId.includes('day_data_days'))             data.dayDays         = stateObj;
      }
    }

    // ── Formatting helpers ──────────────────────────────────────────────────
    const fw = (val, dec = 2) => {
      if (val === undefined || val === null) return 'Warming up…';
      const n = parseFloat(val);
      return isNaN(n) ? 'Warming up…' : n.toFixed(dec) + ' kWh';
    };

    const setText = (id, text, isLoading = false) => {
      const el = this.shadowRoot.getElementById(id);
      if (!el) return;
      el.textContent = text;
      el.classList.toggle('loading', isLoading);
    };

    const bindEntity = (elementId, entityObj, description) => {
      const el = this.shadowRoot.getElementById(elementId);
      if (!el || !entityObj) return;
      const container = el.closest('.formula-item') || el.closest('.metric-row') || el.closest('.status-container');
      if (container) {
        container.title = description;
        container.classList.add('clickable');
        container.onclick = () => {
          this.dispatchEvent(new CustomEvent('hass-more-info', {
            detail: { entityId: entityObj.entity_id },
            bubbles: true,
            composed: true,
          }));
        };
      }
    };

    const setTooltip = (elementId, description) => {
      const el = this.shadowRoot.getElementById(elementId);
      if (!el) return;
      const container = el.closest('.formula-item') || el.closest('.metric-row') || el.closest('.status-container');
      if (container) container.title = description;
    };

    // ── Warmup banner ───────────────────────────────────────────────────────
    const nightDayCount = data.nightDays ? parseInt(data.nightDays.state, 10) : 0;
    const dayDayCount   = data.dayDays   ? parseInt(data.dayDays.state,   10) : 0;
    const warming = nightDayCount < 7 || dayDayCount < 7;
    const banner = this.shadowRoot.getElementById('warmup-banner');
    if (banner) {
      banner.style.display = warming ? 'flex' : 'none';
      if (warming) {
        const detail = this.shadowRoot.getElementById('warmup-detail');
        if (detail) {
          detail.innerText =
            `Collecting historical load data — ${nightDayCount}/7 nights, ${dayDayCount}/7 days recorded. ` +
            'Calculations improve as more data is gathered.';
        }
      }
    }

    // ── Warmup counters in System Intel ────────────────────────────────────
    if (data.nightDays) {
      setText('warmup-night', data.nightDays.state + ' / 7');
      bindEntity('warmup-night', data.nightDays, 'Number of nights of data collected for the overnight rolling average (0–7).');
    }
    if (data.dayDays) {
      setText('warmup-day', data.dayDays.state + ' / 7');
      bindEntity('warmup-day', data.dayDays, 'Number of days of data collected for the daytime rolling average (0–7).');
    }

    // ── Permission sensor (master output + liabilities details) ─────────────
    if (data.permission) {
      const attrs = data.permission.attributes;
      const isNight = attrs.is_night === true;

      // Permission status + since chip
      const permEl = this.shadowRoot.getElementById('permission-status');
      if (permEl) {
        const newState = data.permission.state;
        permEl.innerText = newState.toUpperCase();
        permEl.className = newState === 'on' ? 'status-value status-on' : 'status-value status-off';

        if (this._permissionState !== newState) {
          this._permissionState = newState;
          this._permissionSince = new Date();
        }
      }
      bindEntity('permission-status', data.permission, 'Overall permission status based on calculated surplus.');

      const sinceEl = this.shadowRoot.getElementById('permission-since');
      if (sinceEl && this._permissionSince) {
        const diffMs = Date.now() - this._permissionSince.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const sinceStr = diffMins < 1
          ? 'just now'
          : diffMins < 60
            ? `${diffMins} min ago`
            : `${Math.floor(diffMins / 60)}h ${diffMins % 60}m ago`;
        sinceEl.innerText = (this._permissionState === 'on' ? 'ON' : 'OFF') + ' since ' + sinceStr;
      }

      // Runtime
      setText('runtime-val', attrs.estimated_runtime_hours !== undefined ? attrs.estimated_runtime_hours + ' hrs' : 'Warming up…');
      setTooltip('runtime-val', 'Estimated runtime in hours based on current surplus.');

      // Night/Day phase badge
      const phaseEl = this.shadowRoot.getElementById('sun-phase');
      if (phaseEl) {
        phaseEl.innerHTML = isNight
          ? '<span class="phase-badge phase-night" aria-label="Night phase">🌙 Night</span>'
          : '<span class="phase-badge phase-day" aria-label="Daytime phase">☀️ Daytime</span>';
      }

      // Active/inactive load segment labels
      const dayLabel   = this.shadowRoot.getElementById('dyn-day-label');
      const nightLabel = this.shadowRoot.getElementById('dyn-night-label');
      if (dayLabel)   dayLabel.className   = isNight ? 'segment-inactive' : 'segment-active';
      if (nightLabel) nightLabel.className = isNight ? 'segment-active'   : 'segment-inactive';

      // Liabilities detail rows
      setText('exp-load',  fw(attrs.dynamic_expected_load_kwh));
      setText('dyn-day',   fw(attrs.dyn_rest_of_day_kwh));
      setText('dyn-night', fw(attrs.dyn_rest_of_night_kwh));
      setText('dyn-buffer',fw(attrs.dyn_morning_buffer_kwh));
      setText('tom-deficit',fw(attrs.tomorrow_deficit_kwh));
      setText('dyn-emerg', fw(attrs.dyn_emergency_reserve_kwh));

      const eDay   = parseFloat(attrs.avg_day_load_kwh)   || 0;
      const eNight = parseFloat(attrs.avg_night_load_kwh) || 0;
      setText('tom-expected', fw(eDay + eNight));
      setText('solar-tom', fw(attrs.raw_solar_tomorrow));

      setTooltip('exp-load',   'Total dynamic load expected until the morning buffer finishes.');
      setTooltip('dyn-day',    'Dynamic target to cover the rest of daytime usage.');
      setTooltip('dyn-night',  'Dynamic target to cover overnight usage.');
      setTooltip('dyn-buffer', 'Configured buffer to cover next morning before solar starts producing.');
      setTooltip('tom-deficit','Expected 36-hour deficit, holding energy back if tomorrow is forecasted to be cloudy.');
      setTooltip('tom-expected','Total expected usage tomorrow (day + night).');
      setTooltip('solar-tom',  'Solar output forecast for tomorrow.');
      setTooltip('dyn-emerg',  'Emergency reserve energy explicitly held back.');

      // Raw config inputs
      setText('raw-home',       fw(attrs.raw_home_energy));
      setText('raw-managed',    fw(attrs.raw_managed_load));
      setText('raw-solar-today',fw(attrs.raw_solar_today));
      setText('raw-solar-tom',  fw(attrs.raw_solar_tomorrow));

      // Battery raw display — format using declared sensor type
      const battType = attrs.battery_sensor_type || 'energy';
      const rawBatt  = attrs.raw_battery_percent;
      let rawBattText = 'Warming up…';
      if (rawBatt !== undefined && rawBatt !== null) {
        rawBattText = battType === 'percentage'
          ? parseFloat(rawBatt).toFixed(1) + ' %'
          : parseFloat(rawBatt).toFixed(2) + ' kWh';
      }
      setText('raw-battery',      rawBattText);
      setText('raw-battery-full', rawBattText);
      setTooltip('raw-home',        'Raw tracking input for the total home energy consumption sensor.');
      setTooltip('raw-managed',     'Raw tracking input for the managed load consumption sensor.');
      setTooltip('raw-solar-today', 'Raw tracking input from the solar forecast for today output.');
      setTooltip('raw-solar-tom',   'Raw tracking input from the solar forecast for tomorrow output.');
      setTooltip('raw-battery',     'Raw tracking input from the battery status sensor (' + battType + ').');
      setTooltip('raw-battery-full','Raw tracking input from the battery status sensor (' + battType + ').');
    }

    // ── Calculated Surplus + trend indicator ───────────────────────────────
    if (data.surplus) {
      const currentSurplus = parseFloat(data.surplus.state);
      const surplusEl = this.shadowRoot.getElementById('surplus-val');
      if (surplusEl) surplusEl.innerText = currentSurplus.toFixed(2);
      bindEntity('surplus-val', data.surplus, 'Raw kWh surplus/deficit driving the permission decision.');

      const trendEl = this.shadowRoot.getElementById('surplus-trend');
      if (trendEl && this._prevSurplus !== null) {
        const delta = currentSurplus - this._prevSurplus;
        if (Math.abs(delta) < 0.01) {
          trendEl.innerText = '—';
          trendEl.className = 'trend-indicator trend-stable';
        } else if (delta > 0) {
          trendEl.innerText = '▲';
          trendEl.className = 'trend-indicator trend-up';
        } else {
          trendEl.innerText = '▼';
          trendEl.className = 'trend-indicator trend-down';
        }
      }
      this._prevSurplus = currentSurplus;
    }

    // ── Total Energy Available ─────────────────────────────────────────────
    if (data.available) {
      const totalEl = this.shadowRoot.getElementById('total-assets');
      if (totalEl) totalEl.innerText = parseFloat(data.available.state).toFixed(2);
      bindEntity('total-assets', data.available, 'Total energy available right now: battery + remaining solar today.');
    }

    // ── Total Energy Required ─────────────────────────────────────────────
    if (data.required) {
      const totalEl = this.shadowRoot.getElementById('total-liab');
      if (totalEl) totalEl.innerText = fw(data.required.state);
      bindEntity('total-liab', data.required, 'Total energy the system needs to hold in reserve.');
    }

    // ── Current Battery Charge (dedicated sensor) ──────────────────────────
    if (data.battCharge) {
      const el = this.shadowRoot.getElementById('batt-charge');
      if (el) el.innerText = parseFloat(data.battCharge.state).toFixed(2);
      bindEntity('batt-charge', data.battCharge, 'Current battery energy available in kWh.');
    }

    // ── Solar Counted Today (dedicated sensor) ─────────────────────────────
    if (data.solarCounted) {
      const el = this.shadowRoot.getElementById('solar-today');
      if (el) el.innerText = parseFloat(data.solarCounted.state).toFixed(2);
      bindEntity('solar-today', data.solarCounted, 'Solar energy counted as available right now (zero at night).');
    }

    // ── Battery Capacity ───────────────────────────────────────────────────
    if (data.batteryCap) {
      setText('batt-cap', fw(data.batteryCap.state));
      setText('raw-cap',  fw(data.batteryCap.state));
      bindEntity('batt-cap', data.batteryCap, 'The battery capacity value actually being used by the engine.');
      bindEntity('raw-cap',  data.batteryCap, 'The battery capacity value actually being used by the engine.');
    }

    // ── Load Trackers ──────────────────────────────────────────────────────
    if (data.actNight) {
      setText('night-actual', fw(data.actNight.state));
      setText('sunset-snap',  fw(data.actNight.attributes.sunset_snapshot_kwh));
      bindEntity('night-actual', data.actNight, 'Overnight baseline energy used (current/last night, managed load isolated).');
      bindEntity('sunset-snap',  data.actNight, 'Snapshot of energy taken at last sunset.');
    }
    if (data.avgNight) {
      setText('night-avg', fw(data.avgNight.state));
      bindEntity('night-avg', data.avgNight, 'Rolling 7-day average of overnight baseline load.');
    }
    if (data.actDay) {
      setText('day-actual',   fw(data.actDay.state));
      setText('sunrise-snap', fw(data.actDay.attributes.sunrise_snapshot_kwh));
      bindEntity('day-actual',   data.actDay, 'Daytime baseline energy used (current/last day, managed load isolated).');
      bindEntity('sunrise-snap', data.actDay, 'Snapshot of energy taken at last sunrise.');
    }
    if (data.avgDay) {
      setText('day-avg', fw(data.avgDay.state));
      bindEntity('day-avg', data.avgDay, 'Rolling 7-day average of daytime baseline load.');
    }
    if (data.managed) {
      setText('managed-load', fw(data.managed.state, 3));
      bindEntity('managed-load', data.managed, 'Energy consumed by the managed load sensor since the last sunrise/sunset snapshot.');
    }
  }

  async _handleExport() {
    const btn    = this.shadowRoot.getElementById('export-btn');
    const select = this.shadowRoot.getElementById('export-range');
    if (!btn || !select) return;

    btn.disabled    = true;
    btn.textContent = '⏳ Exporting…';

    try {
      const val = select.value;
      if (val === 'snapshot') {
        this._exportSnapshot();
      } else {
        const hours = val === '24h' ? 24 : val === '7d' ? 168 : null;
        await this._exportHistory(hours);
      }
    } catch (e) {
      console.error('Solar Reserve CSV export error:', e);
      alert('Export failed. See browser console for details.');
    } finally {
      btn.disabled    = false;
      btn.textContent = '⬇ Export CSV';
    }
  }

  _exportSnapshot() {
    const states = this._hass.states;
    const ts     = new Date().toISOString();
    const rows   = [];

    rows.push(['# Solar Reserve — Current Snapshot', ts]);
    rows.push([]);

    // ── All entity states ──────────────────────────────────────────────────
    rows.push(['# Sensor States']);
    rows.push(['entity_id', 'display_name', 'state', 'unit_of_measurement', 'last_changed']);
    for (const [entityId, stateObj] of Object.entries(states)) {
      if (!entityId.includes('solar_reserve')) continue;
      rows.push([
        entityId,
        stateObj.attributes.friendly_name || entityId,
        stateObj.state,
        stateObj.attributes.unit_of_measurement || '',
        stateObj.last_changed,
      ]);
    }

    rows.push([]);

    // ── Permission sensor attributes (inputs + computed values) ───────────
    const permEntry = Object.entries(states).find(([id]) =>
      id.includes('solar_reserve') && id.includes('permission'));
    if (permEntry) {
      rows.push(['# Permission Sensor Attributes (Inputs & Computed Values)']);
      rows.push(['attribute', 'value']);
      for (const [k, v] of Object.entries(permEntry[1].attributes)) {
        rows.push([k, v !== null && v !== undefined ? String(v) : '']);
      }
      rows.push([]);
    }

    // ── Load tracker attributes ────────────────────────────────────────────
    const trackers = Object.entries(states).filter(([id]) =>
      id.includes('solar_reserve') && (id.includes('load_tracker')));
    for (const [entityId, stateObj] of trackers) {
      if (Object.keys(stateObj.attributes).length > 1) {
        rows.push([`# Attributes: ${stateObj.attributes.friendly_name || entityId}`]);
        rows.push(['attribute', 'value']);
        for (const [k, v] of Object.entries(stateObj.attributes)) {
          rows.push([k, v !== null && v !== undefined ? String(v) : '']);
        }
        rows.push([]);
      }
    }

    const filename = `solar-reserve-snapshot-${ts.slice(0, 19).replace(/[:.]/g, '-')}.csv`;
    this._downloadCSV(rows, filename);
  }

  async _exportHistory(hours) {
    const states    = this._hass.states;
    const entityIds = Object.keys(states).filter(id => id.includes('solar_reserve'));

    if (entityIds.length === 0) {
      alert('No Solar Reserve entities found.');
      return;
    }

    const now   = new Date();
    const start = hours ? new Date(now - hours * 3600 * 1000) : new Date('2000-01-01T00:00:00Z');
    const url   = `/api/history/period/${start.toISOString()}` +
                  `?filter_entity_id=${entityIds.join(',')}` +
                  `&minimal_response=false` +
                  `&significant_changes_only=false`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${this._hass.auth.data.access_token}` },
    });
    if (!resp.ok) throw new Error(`History API returned ${resp.status}`);

    const history = await resp.json();
    const ts      = now.toISOString();
    const label   = hours === 24 ? '24h' : hours === 168 ? '7d' : 'all';
    const rows    = [];

    rows.push(['# Solar Reserve — History Export', label, ts]);
    rows.push([]);

    // ── Current snapshot header for reference ─────────────────────────────
    rows.push(['# Current Input Snapshot (for reference)']);
    rows.push(['entity_id', 'state', 'unit_of_measurement']);
    for (const [entityId, stateObj] of Object.entries(states)) {
      if (!entityId.includes('solar_reserve')) continue;
      rows.push([
        entityId,
        stateObj.state,
        stateObj.attributes.unit_of_measurement || '',
      ]);
    }
    rows.push([]);

    // ── Permission sensor attributes snapshot ─────────────────────────────
    const permEntry = Object.entries(states).find(([id]) =>
      id.includes('solar_reserve') && id.includes('permission'));
    if (permEntry) {
      rows.push(['# Current Permission Sensor Attributes']);
      rows.push(['attribute', 'value']);
      for (const [k, v] of Object.entries(permEntry[1].attributes)) {
        rows.push([k, v !== null && v !== undefined ? String(v) : '']);
      }
      rows.push([]);
    }

    // ── Historical time-series ─────────────────────────────────────────────
    rows.push(['# Historical Data']);
    rows.push(['timestamp', 'entity_id', 'display_name', 'state', 'unit_of_measurement']);
    for (const entityHistory of history) {
      for (const stateObj of entityHistory) {
        rows.push([
          stateObj.last_changed,
          stateObj.entity_id,
          stateObj.attributes?.friendly_name || stateObj.entity_id,
          stateObj.state,
          stateObj.attributes?.unit_of_measurement || '',
        ]);
      }
    }

    this._downloadCSV(rows, `solar-reserve-history-${label}-${ts.slice(0, 10)}.csv`);
  }

  _downloadCSV(rows, filename) {
    const escape = v => {
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    };
    const csv  = rows.map(r => Array.isArray(r) ? r.map(escape).join(',') : '').join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

customElements.define("solar-reserve-panel", SolarReservePanel);
