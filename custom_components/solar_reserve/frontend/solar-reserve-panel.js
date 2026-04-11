class SolarReservePanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this.entities = {};
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
          padding: 24px;
          font-family: 'Inter', Roboto, sans-serif;
          background: var(--primary-background-color, #111111);
          color: var(--primary-text-color, #ffffff);
          min-height: 100vh;
          box-sizing: border-box;
          overflow-y: auto;
        }
        * { box-sizing: border-box; }
        
        .dashboard-container {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
          padding-bottom: 60px;
        }

        .header {
          text-align: center;
          margin-bottom: 24px;
          padding-top: 12px;
        }
        
        .header h1 {
          font-size: 2.5rem;
          margin: 0;
          background: linear-gradient(90deg, #f59e0b, #eab308);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .header p {
          color: #a0aec0;
          margin-top: 8px;
          font-size: 1.1rem;
        }

        .card {
          background: rgba(30, 30, 30, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 16px;
          padding: 24px;
          backdrop-filter: blur(12px);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        
        .card:hover {
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
        }

        /* Top row: Master Switch & Surplus */
        .top-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
        }

        @media (max-width: 768px) {
          .top-row { grid-template-columns: 1fr; }
        }

        .switch-container {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
        }

        .permission-bubble {
          width: 140px;
          height: 140px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 2rem;
          font-weight: 800;
          text-transform: uppercase;
          transition: all 0.5s ease;
          margin-top: 24px;
          letter-spacing: 2px;
        }
        
        .permission-on {
          background: rgba(16, 185, 129, 0.15);
          color: #10b981;
          border: 2px solid #10b981;
          box-shadow: 0 0 40px rgba(16, 185, 129, 0.3);
          animation: pulse-green 3s infinite;
        }
        
        .permission-off {
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
          border: 2px solid #ef4444;
          box-shadow: 0 0 40px rgba(239, 68, 68, 0.3);
        }

        @keyframes pulse-green {
          0% { box-shadow: 0 0 30px rgba(16, 185, 129, 0.3); }
          50% { box-shadow: 0 0 60px rgba(16, 185, 129, 0.6); }
          100% { box-shadow: 0 0 30px rgba(16, 185, 129, 0.3); }
        }

        .metric-value {
          font-size: 3.5rem;
          font-weight: 800;
          margin: 16px 0;
          line-height: 1;
        }

        .metric-label {
          color: #a0aec0;
          font-size: 1rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1.5px;
        }

        /* 36-Hour Equation */
        .equation-grid {
          display: grid;
          grid-template-columns: 1fr 60px 1fr;
          gap: 16px;
          align-items: center;
        }
        
        .equation-operator {
          text-align: center;
          font-size: 2.5rem;
          color: #4b5563;
          font-weight: bold;
        }

        .breakdown-list {
          margin-top: 16px;
          background: rgba(0,0,0,0.25);
          border-radius: 12px;
          padding: 16px 20px;
        }

        .breakdown-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 0;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          font-size: 1.05rem;
        }
        .breakdown-item:last-child {
          border-bottom: none;
        }
        .breakdown-item strong {
          color: #e2e8f0;
          font-size: 1.15rem;
        }

        /* Bottom Row */
        .bottom-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
          gap: 24px;
        }

        h2, h3 {
          margin-top: 0;
          font-weight: 500;
          color: #f8fafc;
        }
        
        h2 {
          border-bottom: 1px solid rgba(255,255,255,0.1);
          padding-bottom: 16px;
          margin-bottom: 24px;
          font-size: 1.5rem;
        }

      </style>
      <div class="dashboard-container">
        <div class="header">
          <h1>Solar Reserve</h1>
          <p>36-Hour Predictive Engine Command Center</p>
        </div>

        <div class="top-row">
          <div class="card switch-container">
            <div class="metric-label">Permission Status</div>
            <div id="permission-bubble" class="permission-bubble permission-off">OFF</div>
            <div id="runtime-estimate" style="margin-top: 20px; color: #a0aec0; font-size: 1.1rem;"></div>
          </div>
          <div class="card switch-container">
            <div class="metric-label">Calculated Surplus</div>
            <div id="surplus-value" class="metric-value">0 <span style="font-size:1.5rem; color:#a0aec0">kWh</span></div>
            <div id="surplus-subtitle" style="color: #a0aec0; font-size: 1.1rem; text-align: center;">Positive = permission ON.<br>Negative = permission OFF.</div>
          </div>
        </div>

        <div class="card" style="position: relative; overflow: hidden;">
          <h2>The 36-Hour Equation</h2>
          <div class="equation-grid">
            <div>
              <div class="metric-label" style="text-align:center;">Energy Available</div>
              <div id="energy-available" class="metric-value" style="text-align:center; color: #10b981;">0</div>
            </div>
            <div class="equation-operator"> - </div>
            <div>
              <div class="metric-label" style="text-align:center;">Energy Required</div>
              <div id="energy-required" class="metric-value" style="text-align:center; color: #ef4444;">0</div>
            </div>
          </div>
          
          <div class="equation-grid" style="margin-top: 16px; align-items: start;">
            <div class="breakdown-list">
              <div class="breakdown-item">
                <span>Current Battery</span>
                <strong id="resolved-battery">0 kWh</strong>
              </div>
              <div class="breakdown-item">
                <span>Solar Remaining (Estimate)</span>
                <strong id="solar-remaining">-</strong>
              </div>
            </div>
            <div></div> <!-- Spacer -->
            <div class="breakdown-list">
              <div class="breakdown-item">
                <span>Dynamic Expected Load</span>
                <strong id="expected-load">0 kWh</strong>
              </div>
              <div class="breakdown-item">
                <span>Tomorrow's Deficit</span>
                <strong id="tomorrow-deficit">0 kWh</strong>
              </div>
              <div class="breakdown-item" style="opacity: 0.6;">
                <span>*Plus Emergency Reserve</span>
              </div>
            </div>
          </div>
        </div>

        <div class="bottom-row">
          <div class="card">
            <h3>Performance History</h3>
            <div class="breakdown-list">
              <div class="breakdown-item">
                <span>Daytime Tracker (Actual / Avg)</span>
                <div>
                  <strong id="day-actual">0</strong> <span style="color:#64748b; margin:0 6px;">/</span> <span id="day-avg" style="color:#94a3b8">0</span>
                </div>
              </div>
              <div class="breakdown-item">
                <span>Overnight Tracker (Actual / Avg)</span>
                <div>
                  <strong id="night-actual">0</strong> <span style="color:#64748b; margin:0 6px;">/</span> <span id="night-avg" style="color:#94a3b8">0</span>
                </div>
              </div>
              <div class="breakdown-item" style="margin-top: 8px; justify-content: center; background: rgba(0,0,0,0.2); border-radius: 6px;">
                <span style="color:#94a3b8; font-size: 0.9rem;" id="warmup-status">Warmup Phase...</span>
              </div>
            </div>
          </div>

          <div class="card">
            <h3>Diagnostic Inputs</h3>
            <div class="breakdown-list">
              <div class="breakdown-item">
                <span>Managed Load Usage</span>
                <strong id="managed-load">0 kWh</strong>
              </div>
              <div class="breakdown-item">
                <span>Sunrise Snapshot</span>
                <strong id="sunrise-snapshot">0 kWh</strong>
              </div>
              <div class="breakdown-item">
                <span>Sunset Snapshot</span>
                <strong id="sunset-snapshot">0 kWh</strong>
              </div>
            </div>
          </div>
        </div>

      </div>
    `;
    this.content = true;
  }

  updateData() {
    if (!this._hass) return;

    const states = this._hass.states;
    let entities = {};

    for (const [entityId, stateObj] of Object.entries(states)) {
      if (stateObj.attributes.device_class === 'energy' || entityId.includes('solar_reserve')) {
        if (entityId.includes('solar_reserve_permission')) entities.permission = stateObj;
        else if (entityId.includes('calculated_surplus')) entities.surplus = stateObj;
        else if (entityId.includes('energy_available')) entities.available = stateObj;
        else if (entityId.includes('energy_required')) entities.required = stateObj;
        else if (entityId.includes('average_overnight_load')) entities.avgNight = stateObj;
        else if (entityId.includes('overnight_load_tracker')) entities.actualNight = stateObj;
        else if (entityId.includes('average_daytime_load')) entities.avgDay = stateObj;
        else if (entityId.includes('daytime_load_tracker')) entities.actualDay = stateObj;
        else if (entityId.includes('resolved_battery_capacity')) entities.battery = stateObj;
        else if (entityId.includes('managed_load_usage')) entities.managedLoad = stateObj;
        else if (entityId.includes('night_data_days')) entities.nightDays = stateObj;
        else if (entityId.includes('day_data_days')) entities.dayDays = stateObj;
      }
    }

    if (entities.permission) {
      const bubble = this.shadowRoot.getElementById('permission-bubble');
      if (entities.permission.state === 'on') {
        bubble.className = 'permission-bubble permission-on';
        bubble.innerText = 'ON';
      } else {
        bubble.className = 'permission-bubble permission-off';
        bubble.innerText = 'OFF';
      }
    }

    if (entities.surplus) {
      this.shadowRoot.getElementById('surplus-value').innerHTML = `${entities.surplus.state} <span style="font-size:1.5rem; color:#a0aec0">kWh</span>`;
      
      const runtime = entities.surplus.attributes.estimated_runtime_hours;
      const rtEl = this.shadowRoot.getElementById('runtime-estimate');
      if (runtime > 0) {
        rtEl.innerText = `Est. Runtime Remaining: ${runtime} hrs`;
      } else {
        rtEl.innerText = ``;
      }
    }

    if (entities.available) {
      this.shadowRoot.getElementById('energy-available').innerText = entities.available.state;
      // Solar Remaining is roughly Available - Battery (though current battery state is live, so this is illustrative)
      if (entities.battery) {
        const availableFloat = parseFloat(entities.available.state) || 0;
        const batteryFloat = parseFloat(entities.battery.state) || 0;
        const solarRem = Math.max(0, availableFloat - batteryFloat).toFixed(2);
        this.shadowRoot.getElementById('solar-remaining').innerText = `${solarRem} kWh`;
      }
    }
    
    if (entities.required) {
      this.shadowRoot.getElementById('energy-required').innerText = entities.required.state;
      this.shadowRoot.getElementById('expected-load').innerText = `${entities.required.attributes.dynamic_expected_load_kwh ?? 0} kWh`;
      this.shadowRoot.getElementById('tomorrow-deficit').innerText = `${entities.required.attributes.tomorrow_deficit_kwh ?? 0} kWh`;
    }

    if (entities.battery) this.shadowRoot.getElementById('resolved-battery').innerText = `${entities.battery.state} kWh`;
    if (entities.managedLoad) this.shadowRoot.getElementById('managed-load').innerText = `${entities.managedLoad.state} kWh`;

    if (entities.actualDay) {
      this.shadowRoot.getElementById('day-actual').innerText = `${entities.actualDay.state} kWh`;
      this.shadowRoot.getElementById('sunrise-snapshot').innerText = `${entities.actualDay.attributes.sunrise_snapshot_kwh ?? 0} kWh`;
    }
    if (entities.avgDay) this.shadowRoot.getElementById('day-avg').innerText = `${entities.avgDay.state} kWh`;

    if (entities.actualNight) {
      this.shadowRoot.getElementById('night-actual').innerText = `${entities.actualNight.state} kWh`;
      this.shadowRoot.getElementById('sunset-snapshot').innerText = `${entities.actualNight.attributes.sunset_snapshot_kwh ?? 0} kWh`;
    }
    if (entities.avgNight) this.shadowRoot.getElementById('night-avg').innerText = `${entities.avgNight.state} kWh`;

    if (entities.dayDays && entities.nightDays) {
      const n = entities.nightDays.state;
      const d = entities.dayDays.state;
      this.shadowRoot.getElementById('warmup-status').innerText = `Data Collected: ${n}/7 Nights, ${d}/7 Days`;
    }
  }
}

customElements.define("solar-reserve-panel", SolarReservePanel);
