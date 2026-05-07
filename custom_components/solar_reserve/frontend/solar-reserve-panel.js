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

        /* On narrow screens formula operators disappear and items tile 2-per-row */
        @media (max-width: 520px) {
          .energy-formula {
            display: grid;
            grid-template-columns: 1fr 1fr;
            align-items: stretch;
          }
          .formula-op { display: none; }
          .tracker-tiles {
            display: grid;
            grid-template-columns: 1fr 1fr;
          }
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
          flex: 1 1 0;
          min-width: 0;
          min-height: 110px;
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
        .formula-icon  { font-size: 1.5rem; flex-shrink: 0; }
        .formula-label {
          font-size: 0.78rem; color: var(--secondary-text-color);
          min-height: 2.6em;
          display: flex; align-items: center; justify-content: center;
          text-align: center;
        }
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

        /* ── Surplus equation notation strip ─────────────────────────────── */
        .surplus-equation {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 10px 16px;
          background: var(--secondary-background-color, rgba(128,128,128,0.07));
          border-radius: 8px;
          font-size: 0.88rem;
          color: var(--secondary-text-color);
          flex-wrap: wrap;
          text-align: center;
        }
        .eq-term { display: flex; align-items: baseline; gap: 4px; }
        .eq-label { font-size: 0.82rem; }
        .eq-val { font-weight: 600; font-size: 1rem; color: var(--primary-text-color); }
        .eq-unit { font-size: 0.72rem; }
        .eq-op { font-size: 1.2rem; font-weight: 300; padding: 0 2px; }
        .eq-result-pos { color: var(--success-color, #4caf50) !important; }
        .eq-result-neg { color: var(--error-color, #f44336) !important; }

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

        /* ── Master Output footer strip ──────────────────────────────────── */
        .master-footer {
          display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
          padding: 10px 4px 2px; margin-top: 8px;
          border-top: 1px solid var(--divider-color, rgba(0,0,0,0.12));
          color: var(--secondary-text-color); font-size: 0.9rem;
        }
        .master-footer-val { font-weight: 500; color: var(--primary-text-color); }

        /* ── Liabilities formula total (red) ─────────────────────────────── */
        .formula-item.formula-total-red { background: rgba(244, 67, 54, 0.10); }

        /* ── Load Tracker Tiles ──────────────────────────────────────────── */
        .tracker-tiles { display: flex; gap: 12px; flex-wrap: wrap; }
        .tracker-tile {
          flex: 1; min-width: 130px;
          display: flex; flex-direction: column; align-items: center; text-align: center;
          padding: 18px 12px 12px;
          background: var(--secondary-background-color, rgba(128,128,128,0.07));
          border-radius: 10px; gap: 2px;
        }
        .tracker-tile-managed { flex: 1 1 0; background: rgba(56,189,248,0.07); }
        .tracker-icon { font-size: 1.8rem; line-height: 1; margin-bottom: 4px; }
        .tracker-phase {
          font-size: 0.75rem; color: var(--secondary-text-color);
          text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500;
        }
        .tracker-value { font-size: 2rem; font-weight: 500; line-height: 1.1; margin: 4px 0 0; }
        .tracker-unit { font-size: 0.75rem; color: var(--secondary-text-color); }
        .tracker-avg { font-size: 0.8rem; color: var(--secondary-text-color); margin-top: 4px; }
        .tracker-snap { font-size: 0.78rem; color: var(--secondary-text-color); margin-top: 5px; }
        .warmup-dots { display: flex; gap: 4px; margin: 7px 0 3px; justify-content: center; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--divider-color, rgba(128,128,128,0.2)); }
        .dot.filled { background: var(--primary-color, #03a9f4); }
        details.tracker-detail { width: 100%; margin-top: 4px; }
        details.tracker-detail > summary.detail-summary { justify-content: center; font-size: 0.78rem; }

        /* ── Collapsible raw inputs card ─────────────────────────────────── */
        details.collapsible-card {
          background: var(--ha-card-background, var(--card-background-color, #fff));
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, 0px 2px 1px -1px rgba(0,0,0,0.2), 0px 1px 1px 0px rgba(0,0,0,0.14), 0px 1px 3px 0px rgba(0,0,0,0.12));
          padding: 16px;
        }
        details.collapsible-card > summary {
          list-style: none; cursor: pointer;
          font-size: 1.25rem; font-weight: 500; color: var(--secondary-text-color);
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 0;
        }
        details.collapsible-card > summary::-webkit-details-marker { display: none; }
        details.collapsible-card > summary::after {
          content: '▼'; font-size: 0.7rem; color: var(--secondary-text-color);
          transition: transform 0.15s; flex-shrink: 0;
        }
        details[open].collapsible-card > summary::after { transform: rotate(180deg); }
        details.collapsible-card > .grid-2 { margin-top: 16px; }

        /* ── Permission Condition pills ──────────────────────────────────────── */
        .conditions-strip {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          padding: 12px 4px 4px;
          margin-top: 8px;
          border-top: 1px solid var(--divider-color, rgba(0,0,0,0.12));
        }
        .cond-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px 6px 10px;
          border-radius: 20px;
          font-size: 0.85rem;
          font-weight: 500;
          background: var(--secondary-background-color, rgba(128,128,128,0.07));
          transition: background 0.2s;
          flex: 1;
          min-width: 180px;
        }
        .cond-pill.pass  { background: rgba(76,175,80,0.13);  color: var(--success-color, #4caf50); }
        .cond-pill.fail  { background: rgba(244,67,54,0.12);  color: var(--error-color, #f44336); }
        .cond-pill.na    { opacity: 0.55; }
        .cond-icon { font-size: 1rem; flex-shrink: 0; }
        .cond-label { flex: 1; }
        .cond-val { font-size: 0.8rem; margin-left: 4px; white-space: nowrap; }

        /* ── Battery Sustain analysis card ───────────────────────────────────── */
        .sustain-header-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 10px;
          border-radius: 12px;
          font-size: 0.82rem;
          font-weight: 600;
        }
        .sustain-header-chip.pass { background: rgba(76,175,80,0.15); color: var(--success-color, #4caf50); }
        .sustain-header-chip.fail { background: rgba(244,67,54,0.12); color: var(--error-color, #f44336); }
        .sustain-header-chip.na   { background: var(--secondary-background-color); color: var(--secondary-text-color); }
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

        <!-- Master Output -->
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
          <div class="master-footer">
            <span id="sun-phase">-</span>
            <span>Runtime:&nbsp;<span id="runtime-val" class="master-footer-val">-</span></span>
          </div>
          <!-- Permission Conditions strip -->
          <div class="conditions-strip">
            <div class="cond-pill" id="cond-a">
              <span class="cond-icon" id="cond-a-icon">○</span>
              <span class="cond-label">Condition A — Surplus &gt; 0</span>
              <span class="cond-val" id="cond-a-val">—</span>
            </div>
            <div class="cond-pill" id="cond-b">
              <span class="cond-icon" id="cond-b-icon">○</span>
              <span class="cond-label" id="cond-b-label">Condition B — Battery Sustain</span>
              <span class="cond-val" id="cond-b-val">—</span>
            </div>
          </div>
        </div>

        <!-- Battery Sustain Analysis (shown only when power sensors configured) -->
        <details class="collapsible-card" id="sustain-card" style="display:none">
          <summary>
            ⚡ Battery Sustain Analysis
            <span class="sustain-header-chip na" id="sustain-chip">—</span>
          </summary>
          <div class="grid-2" style="margin-top:16px">
            <div>
              <div class="metric-row">
                <span>30-day Managed Load Peak</span>
                <span id="sustain-peak" class="value">—</span>
              </div>
              <div class="metric-row">
                <span>Current Solar Generation</span>
                <span id="sustain-solar-kw" class="value">—</span>
              </div>
              <div class="metric-row">
                <span>Current Home Power (incl. load when ON)</span>
                <span id="sustain-home-kw" class="value">—</span>
              </div>
              <div class="metric-row">
                <span id="sustain-discharge-label">Net Battery Discharge (load OFF → ON)</span>
                <span id="sustain-net-kw" class="value">—</span>
              </div>
            </div>
            <div>
              <div class="metric-row">
                <span>Usable Battery (above emergency floor)</span>
                <span id="sustain-usable-kwh" class="value">—</span>
              </div>
              <div class="metric-row">
                <span>Battery Runway at Net Discharge Rate</span>
                <span id="sustain-runway-hrs" class="value">—</span>
              </div>
              <div class="metric-row">
                <span id="sustain-req-label">Required Runway</span>
                <span id="sustain-req-hrs" class="value">—</span>
              </div>
              <div class="metric-row total-row">
                <span>Battery Can Sustain Load</span>
                <span id="sustain-result" class="value">—</span>
              </div>
            </div>
          </div>
        </details>

        <!-- Energy Equation -->
        <div class="grid-2">
          <!-- Assets -->
          <div class="card">
            <div class="card-header">Energy Available</div>

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

          </div>

          <!-- Liabilities —— formula style, mirrors Assets -->
          <div class="card">
            <div class="card-header">Energy Required</div>
            <div class="energy-formula">
              <div class="formula-item" id="exp-load-item">
                <div class="formula-icon" id="exp-load-icon">🌤️</div>
                <div class="formula-label" id="exp-load-label">Day + Tonight</div>
                <div id="exp-load" class="formula-value">—</div>
                <div class="formula-unit">kWh</div>
              </div>
              <div class="formula-op">+</div>
              <div class="formula-item" id="tom-deficit-item">
                <div class="formula-icon">☁️</div>
                <div class="formula-label">Tomorrow's Deficit</div>
                <div id="tom-deficit" class="formula-value">—</div>
                <div class="formula-unit">kWh</div>
              </div>
              <div class="formula-op">+</div>
              <div class="formula-item" id="dyn-emerg-item">
                <div class="formula-icon">🛡️</div>
                <div class="formula-label">Emergency Reserve</div>
                <div id="dyn-emerg" class="formula-value">—</div>
                <div class="formula-unit">kWh</div>
              </div>
              <div class="formula-op">=</div>
              <div class="formula-item formula-total-red" id="total-liab-item">
                <div class="formula-icon">⚡</div>
                <div class="formula-label">Total Required</div>
                <div id="total-liab" class="formula-value">—</div>
                <div class="formula-unit">kWh</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Today's Load & Tomorrow's Load -->
        <div class="grid-2">
          <div class="card">
            <div class="card-header">Today's Remaining Load</div>
            <div class="metric-row" id="dyn-day-row">
              <span id="dyn-day-label">Remaining Day Load</span>
              <span id="dyn-day" class="value">-</span>
            </div>
            <div class="metric-row">
              <span id="dyn-night-label">Remaining Night Load</span>
              <span id="dyn-night" class="value">-</span>
            </div>
            <div class="metric-row">
              <span>Morning Buffer</span>
              <span id="dyn-buffer" class="value">-</span>
            </div>
            <div class="metric-row total-row">
              <span>= Expected Load</span>
              <span id="dyn-total" class="value">-</span>
            </div>
          </div>
          <div class="card">
            <div class="card-header">Tomorrow's Deficit / Surplus</div>
            <div class="metric-row">
              <span>Expected Usage (Tomorrow Day + Tomorrow Night)</span>
              <span id="tom-expected" class="value">-</span>
            </div>
            <div class="metric-row sub-row" id="tom-buffer-deduct-row">
              <span>Less: Morning Buffer (reserved in Today's Load)</span>
              <span id="tom-buffer-deduct" class="value">-</span>
            </div>
            <div class="metric-row">
              <span>Solar Forecast Tomorrow</span>
              <span id="solar-tom" class="value">-</span>
            </div>
            <div class="metric-row" id="tom-shortfall-row">
              <span id="tom-shortfall-label">Shortfall (Deficit)</span>
              <span id="tom-shortfall" class="value">-</span>
            </div>
          </div>
        </div>

        <!-- Surplus equation notation: Available − Required = Surplus -->
        <div class="surplus-equation">
          <div class="eq-term">
            <span class="eq-label">Available</span>
            <span id="eq-available" class="eq-val">—</span>
            <span class="eq-unit">kWh</span>
          </div>
          <span class="eq-op">−</span>
          <div class="eq-term">
            <span class="eq-label">Required</span>
            <span id="eq-required" class="eq-val">—</span>
            <span class="eq-unit">kWh</span>
          </div>
          <span class="eq-op">=</span>
          <div class="eq-term">
            <span class="eq-label">Surplus</span>
            <span id="eq-surplus" class="eq-val">—</span>
            <span class="eq-unit">kWh</span>
          </div>
        </div>

        <!-- Load Trackers —— tile layout -->
        <div class="card">
          <div class="card-header">Load Trackers</div>
          <div class="tracker-tiles">
            <div class="tracker-tile" id="night-tile">
              <div class="tracker-icon">🌙</div>
              <div class="tracker-phase">Night</div>
              <div id="night-actual" class="tracker-value">—</div>
              <div class="tracker-unit">kWh</div>
              <div id="night-avg-line" class="tracker-avg">—</div>
              <div id="night-dots" class="warmup-dots"></div>
              <div class="tracker-snap">Sunset: <span id="sunset-snap">—</span></div>
            </div>
            <div class="tracker-tile" id="day-tile">
              <div class="tracker-icon">☀️</div>
              <div class="tracker-phase">Day</div>
              <div id="day-actual" class="tracker-value">—</div>
              <div class="tracker-unit">kWh</div>
              <div id="day-avg-line" class="tracker-avg">—</div>
              <div id="day-dots" class="warmup-dots"></div>
              <div class="tracker-snap">Sunrise: <span id="sunrise-snap">—</span></div>
            </div>
            <div class="tracker-tile tracker-tile-managed" id="managed-tile">
              <div class="tracker-icon">⚡</div>
              <div class="tracker-phase">Managed Load</div>
              <div id="managed-load" class="tracker-value">—</div>
              <div class="tracker-unit">kWh</div>
              <div class="tracker-avg">Since last horizon crossing</div>
            </div>
          </div>
        </div>

        <!-- Raw Configuration Inputs —— collapsed by default -->
        <details class="collapsible-card">
          <summary>Raw Sensor Inputs</summary>
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
              <div class="metric-row" id="raw-solar-pwr-row" style="display:none">
                <span>Current Solar Power (live)</span>
                <span id="raw-solar-pwr" class="value">-</span>
              </div>
              <div class="metric-row" id="raw-home-pwr-row" style="display:none">
                <span>Current Home Power (live)</span>
                <span id="raw-home-pwr" class="value">-</span>
              </div>
              <div class="metric-row" id="raw-peak-pwr-row" style="display:none">
                <span>Managed Load 30-day Peak</span>
                <span id="raw-peak-pwr" class="value">-</span>
              </div>
            </div>
          </div>
        </details>

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
        if (entityId.includes('solar_reserve_permission')) data.permission = stateObj;
        else if (entityId.includes('calculated_surplus')) data.surplus = stateObj;
        else if (entityId.includes('energy_available')) data.available = stateObj;
        else if (entityId.includes('energy_required')) data.required = stateObj;
        else if (entityId.includes('average_overnight_load')) data.avgNight = stateObj;
        else if (entityId.includes('overnight_load_tracker')) data.actNight = stateObj;
        else if (entityId.includes('average_daytime_load')) data.avgDay = stateObj;
        else if (entityId.includes('daytime_load_tracker')) data.actDay = stateObj;
        else if (entityId.includes('current_battery_charge')) data.battCharge = stateObj;
        else if (entityId.includes('battery_capacity')) data.batteryCap = stateObj;
        else if (entityId.includes('solar_counted_today')) data.solarCounted = stateObj;
        else if (entityId.includes('managed_load_usage')) data.managed = stateObj;
        else if (entityId.includes('night_data_days')) data.nightDays = stateObj;
        else if (entityId.includes('day_data_days')) data.dayDays = stateObj;
      }
    }

    // ── Formatting helpers ──────────────────────────────────────────────────
    // fw = formatted kWh (for metric rows that have no separate unit element)
    // fnum = number only (for formula tiles that have their own kWh unit div)
    const fw = (val, dec = 2) => {
      if (val === undefined || val === null) return 'Warming up…';
      const n = parseFloat(val);
      return isNaN(n) ? 'Warming up…' : n.toFixed(dec) + ' kWh';
    };
    const fnum = (val, dec = 2) => {
      if (val === undefined || val === null) return '—';
      const n = parseFloat(val);
      return isNaN(n) ? '—' : n.toFixed(dec);
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
      const container = el.closest('.formula-item') || el.closest('.metric-row') || el.closest('.status-container') || el.closest('.tracker-tile');
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
    const dayDayCount = data.dayDays ? parseInt(data.dayDays.state, 10) : 0;
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

    // ── Warmup dot renderer ──────────────────────────────────────────────────
    const renderDots = (containerId, count, max = 7) => {
      const el = this.shadowRoot.getElementById(containerId);
      if (!el) return;
      el.innerHTML = Array.from({ length: max }, (_, i) =>
        `<span class="dot${i < count ? ' filled' : ''}"></span>`
      ).join('');
    };

    const nightCount = data.nightDays ? parseInt(data.nightDays.state, 10) : 0;
    const dayCount = data.dayDays ? parseInt(data.dayDays.state, 10) : 0;
    renderDots('night-dots', nightCount);
    renderDots('day-dots', dayCount);

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

      // Liabilities formula tiles — use fnum (unit div already shows kWh)
      setText('exp-load', fnum(attrs.dynamic_expected_load_kwh));
      setText('tom-deficit', fnum(attrs.tomorrow_deficit_kwh));
      setText('dyn-emerg', fnum(attrs.dyn_emergency_reserve_kwh));

      // Change 1: Phase-aware label + icon for the formula tile
      const expLoadIcon = this.shadowRoot.getElementById('exp-load-icon');
      const expLoadLabel = this.shadowRoot.getElementById('exp-load-label');
      if (expLoadIcon) expLoadIcon.textContent = isNight ? '🌙' : '🌤️';
      if (expLoadLabel) expLoadLabel.textContent = isNight ? 'Remaining Night' : 'Day + Tonight';

      // Change 2: Load Allowance card — values + phase-aware row labels
      setText('dyn-day', fw(attrs.dyn_rest_of_day_kwh));
      setText('dyn-night', fw(attrs.dyn_rest_of_night_kwh));
      setText('dyn-buffer', fw(attrs.dyn_morning_buffer_kwh));

      // Hide the daytime row at night (value is always 0 — noise not insight)
      const dayRow = this.shadowRoot.getElementById('dyn-day-row');
      if (dayRow) dayRow.style.display = isNight ? 'none' : '';

      // Night row label reflects whether the full night is ahead or partially elapsed
      const nightLabelEl = this.shadowRoot.getElementById('dyn-night-label');
      if (nightLabelEl) nightLabelEl.textContent = isNight ? 'Remaining Night' : 'Full Night Ahead';

      // Total row — sum of subcomponents, should match formula tile
      const restOfDay = parseFloat(attrs.dyn_rest_of_day_kwh) || 0;
      const restOfNight = parseFloat(attrs.dyn_rest_of_night_kwh) || 0;
      const morningBuf = parseFloat(attrs.dyn_morning_buffer_kwh) || 0;
      setText('dyn-total', fw(restOfDay + restOfNight + morningBuf));

      // Tomorrow's Load card
      const eDay = parseFloat(attrs.avg_day_load_kwh) || 0;
      const eNight = parseFloat(attrs.avg_night_load_kwh) || 0;
      setText('tom-expected', fw(eDay + eNight));
      // Deduction row: morning buffer already reserved in Today's Load card
      setText('tom-buffer-deduct', morningBuf > 0 ? '−' + fw(morningBuf) : fw(0));
      setText('solar-tom', fw(attrs.raw_solar_tomorrow));

      // Change 3: Shortfall row — use coordinator's pre-computed value so it
      // always matches the Tomorrow's Deficit formula tile exactly
      const deficit = parseFloat(attrs.tomorrow_deficit_kwh) || 0;
      const shortfallLabelEl = this.shadowRoot.getElementById('tom-shortfall-label');
      const shortfallValEl = this.shadowRoot.getElementById('tom-shortfall');
      if (shortfallLabelEl && shortfallValEl) {
        if (deficit <= 0) {
          shortfallLabelEl.textContent = '✓ Solar covers tomorrow';
          shortfallLabelEl.style.color = 'var(--success-color, #4caf50)';
          shortfallValEl.textContent = '0.00 kWh';
          shortfallValEl.style.color = 'var(--success-color, #4caf50)';
        } else {
          shortfallLabelEl.textContent = '⚠ Shortfall (Deficit)';
          shortfallLabelEl.style.color = 'var(--warning-color, #ff9800)';
          shortfallValEl.textContent = deficit.toFixed(2) + ' kWh';
          shortfallValEl.style.color = 'var(--warning-color, #ff9800)';
        }
      }

      // Change 4: Phase-aware and accurate tooltips
      setTooltip('exp-load', isNight
        ? 'Energy the engine is reserving for the remainder of tonight, plus the morning buffer before solar generates.'
        : 'Energy the engine is reserving for the remainder of today and tonight, plus the morning buffer before solar generates.');
      setTooltip('dyn-day', 'Prorated daytime load remaining — scales down as the day progresses.');
      setTooltip('dyn-night', isNight
        ? 'Prorated remaining night load — scales down as the night progresses.'
        : 'Full average night load held in reserve for tonight (sunset to next sunrise).');
      setTooltip('dyn-buffer', 'Configured buffer to cover the morning dead-zone before solar starts generating.');
      setTooltip('dyn-total', 'Sum of all load allowance components — matches the formula tile above.');
      setTooltip('tom-deficit', 'Held in reserve today: tomorrow\'s net need (expected usage − morning buffer) minus solar forecast. Matches the Tomorrow\'s Deficit formula tile.');
      setTooltip('tom-expected', 'Full expected home consumption tomorrow (avg daytime + avg overnight). The morning buffer is deducted on the next line to avoid double-counting with Today\'s Load.');
      setTooltip('tom-buffer-deduct', 'The morning dead-zone is already reserved separately in Today\'s Load. Deducting it here ensures it is not counted twice in the deficit.');
      setTooltip('solar-tom', 'Solar output forecast for all of tomorrow.');
      setTooltip('dyn-emerg', 'Emergency reserve explicitly held back regardless of surplus.');

      // Bind liabilities formula items to Energy Required entity
      bindEntity('exp-load', data.required, 'Dynamic expected load for the current period.');
      bindEntity('tom-deficit', data.required, 'Expected shortfall tomorrow if solar underperforms usage.');
      bindEntity('dyn-emerg', data.required, 'Emergency reserve held back regardless of surplus.');
      bindEntity('total-liab', data.required, 'Total energy the engine needs to hold in reserve.');

      // Raw config inputs
      setText('raw-home', fw(attrs.raw_home_energy));
      setText('raw-managed', fw(attrs.raw_managed_load));
      setText('raw-solar-today', fw(attrs.raw_solar_today));
      setText('raw-solar-tom', fw(attrs.raw_solar_tomorrow));

      // Battery raw display — format using declared sensor type
      const battType = attrs.battery_sensor_type || 'energy';
      const rawBatt = attrs.raw_battery_percent;
      let rawBattText = 'Warming up…';
      if (rawBatt !== undefined && rawBatt !== null) {
        rawBattText = battType === 'percentage'
          ? parseFloat(rawBatt).toFixed(1) + ' %'
          : parseFloat(rawBatt).toFixed(2) + ' kWh';
      }
      setText('raw-battery', rawBattText);
      setText('raw-battery-full', rawBattText);
      setTooltip('raw-home', 'Raw tracking input for the total home energy consumption sensor.');
      setTooltip('raw-managed', 'Raw tracking input for the managed load consumption sensor.');
      setTooltip('raw-solar-today', 'Raw tracking input from the solar forecast for today output.');
      setTooltip('raw-solar-tom', 'Raw tracking input from the solar forecast for tomorrow output.');
      setTooltip('raw-battery', 'Raw tracking input from the battery status sensor (' + battType + ').');
      setTooltip('raw-battery-full', 'Raw tracking input from the battery status sensor (' + battType + ').');

      // ── Condition pills ────────────────────────────────────────────────────
      const surplus = attrs.calculated_surplus_kwh !== undefined ? parseFloat(attrs.calculated_surplus_kwh) : null;
      const condA = surplus !== null ? surplus > 0 : null;
      const hasSustain = (attrs.managed_load_peak_kw || 0) > 0;
      const condB = hasSustain ? (attrs.battery_can_sustain === true) : null;

      const pillA = this.shadowRoot.getElementById('cond-a');
      const iconA = this.shadowRoot.getElementById('cond-a-icon');
      const valA  = this.shadowRoot.getElementById('cond-a-val');
      if (pillA && iconA && valA) {
        if (condA === null) {
          pillA.className = 'cond-pill na';
          iconA.textContent = '○'; valA.textContent = '—';
        } else if (condA) {
          pillA.className = 'cond-pill pass';
          iconA.textContent = '✓'; valA.textContent = surplus !== null ? ('+' + surplus.toFixed(2) + ' kWh') : '';
        } else {
          pillA.className = 'cond-pill fail';
          iconA.textContent = '✗'; valA.textContent = surplus !== null ? (surplus.toFixed(2) + ' kWh') : '';
        }
      }

      const pillB = this.shadowRoot.getElementById('cond-b');
      const iconB = this.shadowRoot.getElementById('cond-b-icon');
      const valB  = this.shadowRoot.getElementById('cond-b-val');
      const labelB = this.shadowRoot.getElementById('cond-b-label');
      if (pillB && iconB && valB) {
        if (!hasSustain) {
          pillB.className = 'cond-pill na';
          iconB.textContent = 'ℹ';
          if (labelB) labelB.textContent = 'Condition B — Battery Sustain';
          valB.textContent = 'not configured';
        } else if (condB) {
          pillB.className = 'cond-pill pass';
          iconB.textContent = '✓';
          const hrs = attrs.battery_sustain_hours;
          const hrsStr = (hrs >= 999) ? '∞' : (parseFloat(hrs).toFixed(1) + ' h');
          if (labelB) labelB.textContent = 'Condition B — Battery Sustain';
          valB.textContent = hrsStr + ' runway';
        } else {
          pillB.className = 'cond-pill fail';
          iconB.textContent = '✗';
          const hrs = attrs.battery_sustain_hours;
          const hrsStr = (hrs >= 999) ? '∞' : (parseFloat(hrs).toFixed(1) + ' h');
          if (labelB) labelB.textContent = 'Condition B — Battery Sustain';
          valB.textContent = hrsStr + ' runway (insufficient)';
        }
      }

      // ── Battery Sustain analysis card ──────────────────────────────────────
      const sustainCard = this.shadowRoot.getElementById('sustain-card');
      if (sustainCard) sustainCard.style.display = hasSustain ? '' : 'none';
      if (hasSustain) {
        const peakKw    = parseFloat(attrs.managed_load_peak_kw) || 0;
        const solarKw   = parseFloat(attrs.current_solar_power_kw) || 0;
        const homeKw    = parseFloat(attrs.current_home_power_kw) || 0;
        const netKw     = parseFloat(attrs.net_battery_discharge_kw) || 0;
        const sustainHrs = parseFloat(attrs.battery_sustain_hours) || 0;
        const emergResKwh = parseFloat(attrs.dyn_emergency_reserve_kwh) || 0;
        const curBattKwh = data.battCharge ? (parseFloat(data.battCharge.state) || 0) : 0;
        const usableKwh = Math.max(0, curBattKwh - emergResKwh);
        const canSustain = attrs.battery_can_sustain === true;
        const bufHrs = parseFloat(attrs.dyn_morning_buffer_kwh) || 1.5; // proxy for runway config

        // Chip in header
        const chip = this.shadowRoot.getElementById('sustain-chip');
        if (chip) {
          chip.textContent = canSustain ? '✓ Pass' : '✗ Fail';
          chip.className = 'sustain-header-chip ' + (canSustain ? 'pass' : 'fail');
        }

        // Prev permission to determine discharge label
        const prevPerm = data.permission.state === 'on';
        const dischLabel = this.shadowRoot.getElementById('sustain-discharge-label');
        if (dischLabel) {
          dischLabel.textContent = prevPerm
            ? 'Net Battery Discharge (load currently ON)'
            : 'Net Battery Discharge (load OFF → if turned ON)';
        }

        const fpKw  = v => v.toFixed(2) + ' kW';
        const fpHrs = v => (v >= 999 ? '∞' : v.toFixed(1)) + ' h';
        setText('sustain-peak',     peakKw.toFixed(2) + ' kW');
        setText('sustain-solar-kw', fpKw(solarKw));
        setText('sustain-home-kw',  fpKw(homeKw));
        setText('sustain-net-kw',   netKw === 0 ? '0.00 kW (solar covers load ✓)' : fpKw(netKw));
        setText('sustain-usable-kwh', usableKwh.toFixed(2) + ' kWh');
        setText('sustain-runway-hrs', netKw > 0 ? fpHrs(sustainHrs) : '∞ (no discharge)');

        // Required runway label is phase-aware
        const reqLabel = this.shadowRoot.getElementById('sustain-req-label');
        if (reqLabel) {
          reqLabel.textContent = isNight
            ? 'Required — until sunrise'
            : 'Required — morning buffer runway';
        }
        // Compute required energy/hours for display
        let reqDisplay = '—';
        if (netKw === 0) {
          reqDisplay = '0 h (solar sufficient)';
        } else if (isNight && data.available) {
          // hours_to_sunrise is not directly exposed; show the required energy instead
          const energyNeeded = (parseFloat(attrs.net_battery_discharge_kw) || 0);
          reqDisplay = 'until sunrise';
        } else {
          // daytime: morning_buffer_hours × net discharge rate = energy needed
          const morningBufHrs = parseFloat(attrs.dyn_morning_buffer_kwh) || 0; // not hours but kWh — use a proxy
          reqDisplay = 'see morning buffer config';
        }
        setText('sustain-req-hrs', reqDisplay);
        const resultEl = this.shadowRoot.getElementById('sustain-result');
        if (resultEl) {
          resultEl.textContent = canSustain ? '✓ Yes' : '✗ No';
          resultEl.style.color = canSustain ? 'var(--success-color, #4caf50)' : 'var(--error-color, #f44336)';
        }

        // Tooltips
        setTooltip('sustain-peak',     '30-day historical peak draw of the managed load power sensor.');
        setTooltip('sustain-solar-kw', 'Live instantaneous solar generation. Zero at night.');
        setTooltip('sustain-home-kw',  'Live instantaneous total home power draw. Includes the managed load when it is currently running.');
        setTooltip('sustain-net-kw',   'Net battery discharge rate if the managed load is ON = max(0, home + peak − solar). Zero means solar covers everything.');
        setTooltip('sustain-usable-kwh', 'Battery energy available above the emergency reserve floor.');
        setTooltip('sustain-runway-hrs', 'How long the battery can sustain the net discharge rate: usable battery ÷ net discharge rate.');
        setTooltip('sustain-req-hrs',  'Minimum runway required: morning buffer hours (daytime) or time until sunrise (night).');
        setTooltip('sustain-result',   'Whether the battery has sufficient runway to sustain the managed load without drawing from the grid.');

        // Show power sensor raw rows
        const showRow = (id, val, unit) => {
          const row = this.shadowRoot.getElementById(id + '-row');
          if (row) row.style.display = '';
          setText(id, val.toFixed(2) + ' ' + unit);
        };
        showRow('raw-solar-pwr', solarKw, 'kW');
        showRow('raw-home-pwr', homeKw, 'kW');
        showRow('raw-peak-pwr', peakKw, 'kW');
        setTooltip('raw-solar-pwr', 'Live solar power from the current_solar_power sensor.');
        setTooltip('raw-home-pwr', 'Live home power from the current_home_power sensor (includes managed load when ON).');
        setTooltip('raw-peak-pwr', '30-day historical peak of the managed load power sensor used for net discharge estimation.');
      }
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
      if (totalEl) totalEl.innerText = fnum(data.required.state);
      bindEntity('total-liab', data.required, 'Total energy the system needs to hold in reserve.');
    }

    // ── Surplus equation strip ────────────────────────────────────────────
    if (data.available && data.required) {
      const avail = parseFloat(data.available.state);
      const req = parseFloat(data.required.state);
      const surp = avail - req;
      const eqAvail = this.shadowRoot.getElementById('eq-available');
      const eqReq = this.shadowRoot.getElementById('eq-required');
      const eqSurp = this.shadowRoot.getElementById('eq-surplus');
      if (eqAvail) eqAvail.textContent = avail.toFixed(2);
      if (eqReq) eqReq.textContent = req.toFixed(2);
      if (eqSurp) {
        eqSurp.textContent = (surp >= 0 ? '+' : '') + surp.toFixed(2);
        eqSurp.className = surp >= 0 ? 'eq-val eq-result-pos' : 'eq-val eq-result-neg';
      }
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
      setText('raw-cap', fw(data.batteryCap.state));
      bindEntity('batt-cap', data.batteryCap, 'The battery capacity value actually being used by the engine.');
      bindEntity('raw-cap', data.batteryCap, 'The battery capacity value actually being used by the engine.');
    }

    // ── Load Trackers ──────────────────────────────────────────────────────
    if (data.actNight) {
      const el = this.shadowRoot.getElementById('night-actual');
      if (el) el.textContent = parseFloat(data.actNight.state).toFixed(2);
      setText('sunset-snap', fw(data.actNight.attributes.sunset_snapshot_kwh));
      bindEntity('night-actual', data.actNight, 'Overnight baseline energy used (current/last night, managed load isolated).');
      bindEntity('sunset-snap', data.actNight, 'Snapshot of energy taken at last sunset.');
    }
    if (data.avgNight) {
      const el = this.shadowRoot.getElementById('night-avg-line');
      if (el) el.textContent = '7-night avg: ' + parseFloat(data.avgNight.state).toFixed(2) + ' kWh';
    }
    if (data.actDay) {
      const el = this.shadowRoot.getElementById('day-actual');
      if (el) el.textContent = parseFloat(data.actDay.state).toFixed(2);
      setText('sunrise-snap', fw(data.actDay.attributes.sunrise_snapshot_kwh));
      bindEntity('day-actual', data.actDay, 'Daytime baseline energy used (current/last day, managed load isolated).');
      bindEntity('sunrise-snap', data.actDay, 'Snapshot of energy taken at last sunrise.');
    }
    if (data.avgDay) {
      const el = this.shadowRoot.getElementById('day-avg-line');
      if (el) el.textContent = '7-day avg: ' + parseFloat(data.avgDay.state).toFixed(2) + ' kWh';
    }
    if (data.managed) {
      const el = this.shadowRoot.getElementById('managed-load');
      if (el) el.textContent = parseFloat(data.managed.state).toFixed(3);
      bindEntity('managed-load', data.managed, 'Energy consumed by the managed load sensor since the last sunrise/sunset snapshot.');
    }
  }

  async _handleExport() {
    const btn = this.shadowRoot.getElementById('export-btn');
    const select = this.shadowRoot.getElementById('export-range');
    if (!btn || !select) return;

    btn.disabled = true;
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
      btn.disabled = false;
      btn.textContent = '⬇ Export CSV';
    }
  }

  _exportSnapshot() {
    const states = this._hass.states;
    const ts = new Date().toISOString();
    const rows = [];

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
    const states = this._hass.states;
    const entityIds = Object.keys(states).filter(id => id.includes('solar_reserve'));

    if (entityIds.length === 0) {
      alert('No Solar Reserve entities found.');
      return;
    }

    const now = new Date();
    const start = hours ? new Date(now - hours * 3600 * 1000) : new Date('2000-01-01T00:00:00Z');
    const url = `/api/history/period/${start.toISOString()}` +
      `?filter_entity_id=${entityIds.join(',')}` +
      `&minimal_response=false` +
      `&significant_changes_only=false`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${this._hass.auth.data.access_token}` },
    });
    if (!resp.ok) throw new Error(`History API returned ${resp.status}`);

    const history = await resp.json();
    const ts = now.toISOString();
    const label = hours === 24 ? '24h' : hours === 168 ? '7d' : 'all';
    const rows = [];

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
    const csv = rows.map(r => Array.isArray(r) ? r.map(escape).join(',') : '').join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

customElements.define("solar-reserve-panel", SolarReservePanel);
