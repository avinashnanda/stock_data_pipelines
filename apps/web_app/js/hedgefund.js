/* ═══════════════════════════════════════════════════════════════════════════
   HEDGE FUND MODULE — hedgefund.js
   All hedge fund tab functionality: agents, models, analysis SSE, backtest
   SSE, integrated settings with vertical tabs.
   ═══════════════════════════════════════════════════════════════════════════ */

const HF_API_KEY_PROVIDERS = [
  { key: "OPENAI_API_KEY", label: "OpenAI", url: "https://platform.openai.com/" },
  { key: "ANTHROPIC_API_KEY", label: "Anthropic", url: "https://console.anthropic.com/" },
  { key: "GROQ_API_KEY", label: "Groq", url: "https://console.groq.com/" },
  { key: "DEEPSEEK_API_KEY", label: "DeepSeek", url: "https://platform.deepseek.com/" },
  { key: "GOOGLE_API_KEY", label: "Google", url: "https://aistudio.google.com/" },
  { key: "XAI_API_KEY", label: "xAI (Grok)", url: "https://console.x.ai/" },
  { key: "OPENROUTER_API_KEY", label: "OpenRouter", url: "https://openrouter.ai/" },
];

let _hfInitialized = false;
let _hfSelectedAnalysts = new Set();
let _hfBacktestChart = null;

// $ helper provided by js/utils.js

/* ── Init ─────────────────────────────────────────────────────────────────── */

function initHedgeFund() {
  if (_hfInitialized) return;
  _hfInitialized = true;

  // Set default dates (90 days ago → today)
  const today = new Date();
  const ago90 = new Date(today); ago90.setDate(ago90.getDate() - 90);
  if ($("hf-end-date")) $("hf-end-date").value = today.toISOString().split("T")[0];
  if ($("hf-start-date")) $("hf-start-date").value = ago90.toISOString().split("T")[0];

  syncHedgeFundTicker();
  loadHFAgents();
  loadHFModels();
  _bindHFEvents();
  
  // Pre-load settings data
  _loadApiKeys();
}

function syncHedgeFundTicker() {
  if (typeof currentSymbol !== "undefined" && currentSymbol) {
    const symbol = currentSymbol.includes(":") ? currentSymbol.split(":")[1] : currentSymbol;
    if ($("hf-tickers")) $("hf-tickers").value = symbol;
  }
}

/* ── Tab Switching ────────────────────────────────────────────────────────── */

function _switchHFTab(tabId) {
  document.querySelectorAll(".hf-internal-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.hfTab === tabId);
  });
  document.querySelectorAll(".hf-pane").forEach(pane => {
    pane.classList.toggle("hidden", pane.id !== `hf-pane-${tabId}`);
  });
  
  // Specific tab entry logic
  if (tabId === "settings") {
    _loadApiKeys();
  }
}

function _switchHFSettingsTab(vtabId) {
  document.querySelectorAll(".hf-settings-tab-v").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.vtab === vtabId);
  });
  document.querySelectorAll(".hf-vpane").forEach(pane => {
    pane.classList.toggle("hidden", pane.id !== `hf-vtab-${vtabId}`);
  });
  
  if (vtabId === "ollama") _checkOllamaStatus();
  if (vtabId === "custom") _loadCustomEndpoints();
}

/* ── Load Agents ──────────────────────────────────────────────────────────── */

async function loadHFAgents() {
  try {
    const res = await fetch("/api/hedge-fund/agents");
    const data = await res.json();
    const agents = data.agents || [];
    const grid = $("hf-analyst-grid");
    if (!grid) return;
    grid.innerHTML = "";
    agents.forEach(a => {
      const key = a.key || a.id || a.name;
      const displayName = a.display_name || a.name || key;
      const initials = displayName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
      
      _hfSelectedAnalysts.add(key);
      const card = document.createElement("div");
      card.className = "hf-analyst-card selected";
      card.dataset.key = key;
      card.innerHTML = `
        <div class="hf-check-icon"><svg width="10" height="8" viewBox="0 0 10 8"><path d="M1 4L4 7L9 1" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div class="hf-analyst-avatar">${initials}</div>
        <div class="hf-analyst-info">
          <div class="hf-analyst-name">${displayName}</div>
          <div class="hf-analyst-desc">${a.description || ""}</div>
        </div>`;
      card.addEventListener("click", () => _toggleAnalyst(card, key));
      grid.appendChild(card);
    });
  } catch (e) {
    console.error("Failed to load agents:", e);
    const grid = $("hf-analyst-grid");
    if (grid) grid.innerHTML = '<div style="color:var(--muted);padding:12px">Could not load analysts. Please check if backend is running correctly.</div>';
  }
}

function _toggleAnalyst(card, key) {
  if (_hfSelectedAnalysts.has(key)) {
    _hfSelectedAnalysts.delete(key);
    card.classList.remove("selected");
  } else {
    _hfSelectedAnalysts.add(key);
    card.classList.add("selected");
  }
}

/* ── Load Models ──────────────────────────────────────────────────────────── */

async function loadHFModels() {
  try {
    const res = await fetch("/api/hedge-fund/models");
    const data = await res.json();
    const sel = $("hf-model-select");
    if (!sel) return;
    sel.innerHTML = "";
    (data.models || []).forEach(m => {
      const opt = document.createElement("option");
      opt.value = JSON.stringify({ name: m.model_name, provider: m.provider });
      opt.textContent = m.display_name || m.model_name;
      sel.appendChild(opt);
    });
    if (!sel.options.length) {
      sel.innerHTML = '<option value="">No models available — configure in Settings</option>';
    }
  } catch (e) {
    console.error("Failed to load models:", e);
    const sel = $("hf-model-select");
    if (sel) sel.innerHTML = '<option value="">Error loading models</option>';
  }
}

function _getSelectedModel() {
  const sel = $("hf-model-select");
  if (!sel) return { name: "gpt-4.1", provider: "OpenAI" };
  const val = sel.value;
  if (!val) return { name: "gpt-4.1", provider: "OpenAI" };
  try { return JSON.parse(val); } catch { return { name: val, provider: "OpenAI" }; }
}

/* ── Run Analysis (SSE) ──────────────────────────────────────────────────── */

async function runHedgeFundAnalysis() {
  const tickersVal = $("hf-tickers").value;
  const tickers = tickersVal.split(",").map(t => t.trim()).filter(Boolean);
  if (!tickers.length) return alert("Enter at least one ticker");

  const model = _getSelectedModel();
  const body = {
    tickers,
    selected_analysts: [..._hfSelectedAnalysts],
    model_name: model.name,
    model_provider: model.provider,
    start_date: $("hf-start-date").value,
    end_date: $("hf-end-date").value,
    initial_cash: parseFloat($("hf-initial-cash").value) || 100000,
  };

  $("hf-progress-panel").classList.remove("hidden");
  $("hf-results").classList.add("hidden");
  $("hf-signals-section").classList.add("hidden");
  $("hf-progress-list").innerHTML = "";
  $("hf-run-btn").disabled = true;
  $("hf-run-btn").textContent = "⏳ Running...";

  try {
    const res = await fetch("/api/hedge-fund/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      _processSSELines(lines, "analysis");
    }
    if (buffer.trim()) _processSSELines(buffer.split("\n"), "analysis");
  } catch (e) {
    _addProgressItem("error", "Error", e.message, "analysis");
  } finally {
    $("hf-run-btn").disabled = false;
    $("hf-run-btn").textContent = "▶ Run Analysis";
  }
}

/* ── Backtest (SSE) ───────────────────────────────────────────────────────── */

async function runHedgeFundBacktest() {
  const tickersVal = $("hf-tickers").value;
  const tickers = tickersVal.split(",").map(t => t.trim()).filter(Boolean);
  if (!tickers.length) return alert("Enter at least one ticker");

  const model = _getSelectedModel();
  const body = {
    tickers,
    selected_analysts: [..._hfSelectedAnalysts],
    model_name: model.name,
    model_provider: model.provider,
    start_date: $("hf-start-date").value,
    end_date: $("hf-end-date").value,
    initial_capital: parseFloat($("hf-initial-cash").value) || 100000,
  };

  $("hf-backtest-progress").classList.remove("hidden");
  $("hf-backtest-results").classList.add("hidden");
  $("hf-backtest-progress-list").innerHTML = "";
  $("hf-backtest-btn").disabled = true;
  $("hf-backtest-btn").textContent = "⏳ Running...";

  try {
    const res = await fetch("/api/hedge-fund/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      _processSSELines(lines, "backtest");
    }
    if (buffer.trim()) _processSSELines(buffer.split("\n"), "backtest");
  } catch (e) {
    _addProgressItem("error", "Error", e.message, "backtest");
  } finally {
    $("hf-backtest-btn").disabled = false;
    $("hf-backtest-btn").textContent = "📊 Run Backtest";
  }
}

/* ── SSE Processing ───────────────────────────────────────────────────────── */

function _processSSELines(lines, mode) {
  let eventType = "";
  for (const line of lines) {
    if (line.startsWith("event: ")) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      try {
        const data = JSON.parse(line.slice(6));
        _handleSSEEvent(eventType || data.type, data, mode);
      } catch (e) { /* skip */ }
    }
  }
}

function _handleSSEEvent(type, data, mode) {
  if (type === "progress") {
    const statusText = data.status || "processing";
    const status = statusText.toLowerCase() === "done" ? "done" : "progress";
    _addProgressItem(status, data.agent || "System", `${data.ticker ? `[${data.ticker}] ` : ""}${statusText}`, mode);
  } else if (type === "complete") {
    _addProgressItem("done", "Complete", "✅ Finished", mode);
    if (mode === "analysis") _renderAnalysisResults(data.data || data);
    if (mode === "backtest") _renderBacktestResults(data.data || data);
  } else if (type === "error") {
    _addProgressItem("error", "Error", data.message || "Unknown error", mode);
  }
}

function _addProgressItem(status, agent, text, mode) {
  const listId = mode === "backtest" ? "hf-backtest-progress-list" : "hf-progress-list";
  const list = $(listId);
  if (!list) return;

  const icons = { progress: "⏳", done: "✓", error: "✕" };
  
  // Try to find if this agent already has an item in the list
  const existingItems = list.querySelectorAll(`.hf-progress-item`);
  let existingItem = null;
  for (const item of existingItems) {
    if (item.getAttribute("data-agent") === agent) {
      existingItem = item;
      break;
    }
  }

  if (existingItem) {
    const iconEl = existingItem.querySelector(".hf-progress-icon");
    iconEl.textContent = icons[status] || "•";
    iconEl.className = `hf-progress-icon ${status}`;
    
    const statusEl = existingItem.querySelector(".hf-progress-status");
    statusEl.textContent = status === "done" ? "Done" : (status === "progress" ? "In Progress" : text);
    statusEl.className = `hf-progress-status ${status}`;
    return;
  }

  const div = document.createElement("div");
  div.className = `hf-progress-item`;
  div.setAttribute("data-agent", agent);
  div.innerHTML = `
    <span class="hf-progress-icon ${status}">${icons[status] || "•"}</span>
    <span class="hf-progress-agent">${agent}</span>
    <span class="hf-progress-status ${status}">${status === "done" ? "Done" : (status === "progress" ? "In Progress" : text)}</span>`;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}

/* ── Render Analysis Results ─────────────────────────────────────────────── */

function _renderAnalysisResults(data) {
  if (!data) return;
  $("hf-results").classList.remove("hidden");
  $("hf-signals-section").classList.remove("hidden");
  
  const tickerInput = $("hf-tickers")?.value || "";
  if ($("hf-decision-title")) {
    $("hf-decision-title").textContent = tickerInput ? `Trading Decision — ${tickerInput}` : "Trading Decision";
  }
  
  if (data.decisions) {
    const wrap = $("hf-decision-table-wrap");
    wrap.innerHTML = "";
    for (const [ticker, dec] of Object.entries(data.decisions)) {
      const action = (dec.action || "hold").toLowerCase();
      const confidence = (dec.confidence !== undefined && dec.confidence !== null) ? (dec.confidence * 1) : 0;
      
      const card = document.createElement("div");
      card.className = "hf-decision-card";
      card.innerHTML = `
        <div class="hf-decision-header">
          <span class="hf-decision-ticker">${ticker}</span>
          <span class="hf-decision-badge ${action}">${dec.action || "HOLD"}</span>
          <span style="font-size:12px; color:var(--muted); margin-left:auto;">Qty: ${dec.quantity || 0}</span>
        </div>
        <div class="hf-conf-section">
          <div class="hf-conf-header">
            <span class="hf-conf-title">Confidence</span>
            <span class="hf-conf-val">${confidence.toFixed(0)}%</span>
          </div>
          <div class="hf-conf-bar-bg">
            <div class="hf-conf-bar-fill" style="width: ${confidence}%"></div>
          </div>
        </div>
        <div class="hf-decision-reasoning">${dec.reasoning || ""}</div>
      `;
      wrap.appendChild(card);
    }
  }

  if (data.analyst_signals) {
    const container = $("hf-signals-container");
    container.innerHTML = "";
    for (const [agentKey, signalData] of Object.entries(data.analyst_signals)) {
      for (const [ticker, signal] of Object.entries(signalData || {})) {
        let s = signal.signal || "neutral";
        if (typeof s === "object") s = s.signal || "neutral";

        let reasoning = signal.reasoning || "No reasoning provided";
        if (typeof reasoning === "object") {
          reasoning = reasoning.risk_adjustment || reasoning.error || JSON.stringify(reasoning);
        }

        const confidence = (signal.confidence !== undefined && signal.confidence !== null) ? (signal.confidence * 1) : 0;

        const card = document.createElement("div");
        card.className = "hf-signal-card";
        card.innerHTML = `
          <div class="hf-signal-header">
            <span class="hf-signal-agent">${agentKey}</span>
            <span class="hf-signal-badge hf-action-badge ${s.toLowerCase()}">${s}</span>
          </div>
          <div class="hf-signal-meta">${ticker}</div>
          <div class="hf-conf-section" style="margin-top: -4px; margin-bottom: 12px;">
            <div class="hf-conf-header" style="margin-bottom: 4px;">
              <span class="hf-conf-title" style="font-size: 10px;">Confidence</span>
              <span class="hf-conf-val" style="font-size: 10px;">${confidence.toFixed(0)}%</span>
            </div>
            <div class="hf-conf-bar-bg" style="height: 4px;">
              <div class="hf-conf-bar-fill" style="width: ${confidence}%"></div>
            </div>
          </div>
          <div class="hf-signal-reasoning">${reasoning}</div>`;
        card.addEventListener("click", () => card.classList.toggle("expanded"));
        container.appendChild(card);
      }
    }
  }
}

/* ── Render Backtest Results ──────────────────────────────────────────────── */

function _renderBacktestResults(data) {
  if (!data || !data.performance_metrics) return;
  $("hf-backtest-results").classList.remove("hidden");
  
  const grid = $("hf-metrics-grid");
  const pm = data.performance_metrics;
  const metrics = [
    { label: "Total Return", value: pm.total_return ? pm.total_return.toFixed(2) + "%" : "--" },
    { label: "Net Profit", value: pm.net_profit ? "₹" + pm.net_profit.toLocaleString(undefined, {maximumFractionDigits: 0}) : "--" },
    { label: "Sharpe Ratio", value: pm.sharpe_ratio?.toFixed(2) || "--" },
    { label: "Max Drawdown", value: pm.max_drawdown ? Math.abs(pm.max_drawdown).toFixed(1) + "%" : "--" },
  ];
  grid.innerHTML = metrics.map(m => `
    <div class="hf-metric-card">
      <span class="hf-metric-label">${m.label}</span>
      <span class="hf-metric-value">${m.value}</span>
    </div>`).join("");

  if (data.portfolio_values && data.portfolio_values.length) {
    _renderBacktestChart(data.portfolio_values);
  }
}

function _renderBacktestChart(points) {
  const canvas = $("hf-backtest-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (_hfBacktestChart) _hfBacktestChart.destroy();
  
  const labels = points.map(p => new Date(p.Date).toLocaleDateString());
  const values = points.map(p => p["Portfolio Value"]);
  
  _hfBacktestChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Portfolio Value",
        data: values,
        borderColor: "#2962ff",
        backgroundColor: "rgba(41, 98, 255, 0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
        y: { grid: { color: "rgba(255,255,255,0.05)" } }
      }
    }
  });
}

/* ── Settings Logic ───────────────────────────────────────────────────────── */

async function _loadApiKeys() {
  const list = $("hf-api-keys-list");
  if (!list) return;
  let existing = {};
  try {
    const res = await fetch("/api/hedge-fund/api-keys");
    const data = await res.json();
    (data.keys || []).forEach(k => { existing[k.provider] = k.key_preview; });
  } catch (e) { /* ignore */ }

  list.innerHTML = "";
  HF_API_KEY_PROVIDERS.forEach(p => {
    const row = document.createElement("div");
    row.className = "hf-key-row";
    row.innerHTML = `
      <label><a href="${p.url}" target="_blank">${p.label}</a></label>
      <div class="hf-key-input-wrap">
        <input type="password" id="hf-key-${p.key}" placeholder="${existing[p.key] || `Enter ${p.label} key...`}" data-provider="${p.key}" />
        <button class="hf-key-toggle">👁</button>
        <button class="hf-key-delete">🗑</button>
      </div>`;
    
    const input = row.querySelector("input");
    const toggle = row.querySelector(".hf-key-toggle");
    const del = row.querySelector(".hf-key-delete");

    toggle.onclick = () => input.type = input.type === "password" ? "text" : "password";
    del.onclick = () => _deleteApiKey(p.key);

    let debounceTimer;
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const val = input.value.trim();
        if (val) _saveApiKey(p.key, val);
      }, 800);
    });
    list.appendChild(row);
  });
}

async function _saveApiKey(provider, value) {
  try {
    await fetch("/api/hedge-fund/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, key_value: value }),
    });
  } catch (e) { console.error("Failed to save API key:", e); }
}

async function _deleteApiKey(provider) {
  if (!confirm(`Delete ${provider} key?`)) return;
  try {
    await fetch(`/api/hedge-fund/api-keys/${provider}`, { method: "DELETE" });
    _loadApiKeys();
  } catch (e) { console.error("Failed to delete API key:", e); }
}

/* ── Ollama Logic ─────────────────────────────────────────────────────────── */

async function _checkOllamaStatus() {
  try {
    const res = await fetch("/api/hedge-fund/ollama/status");
    const data = await res.json();
    const indicator = $("hf-ollama-indicator");
    const text = $("hf-ollama-status-text");
    if (data.running) {
      indicator.className = "status-dot green";
      text.textContent = `Running — ${data.models.length} model(s)`;
      _renderOllamaModels(data.models);
    } else {
      indicator.className = "status-dot red";
      text.textContent = "Not running";
      $("hf-ollama-model-list").innerHTML = '<div style="color:var(--muted);font-size:12px">Ollama server is not running</div>';
    }
  } catch (e) {
    if ($("hf-ollama-indicator")) $("hf-ollama-indicator").className = "status-dot red";
    if ($("hf-ollama-status-text")) $("hf-ollama-status-text").textContent = "Connection failed";
  }
}

function _renderOllamaModels(models) {
  const list = $("hf-ollama-model-list");
  if (!list) return;
  if (!models.length) { list.innerHTML = '<div style="color:var(--muted);font-size:12px">No models installed</div>'; return; }
  list.innerHTML = models.map(m => `
    <div class="hf-ollama-model-item">
      <span>${m.name}</span>
      <span style="color:var(--muted);font-size:11px">${m.size ? (m.size / 1e9).toFixed(1) + " GB" : ""}</span>
    </div>`).join("");
}

async function _pullOllamaModel() {
  const nameInput = $("hf-ollama-pull-name");
  if (!nameInput) return;
  const name = nameInput.value.trim();
  if (!name) return alert("Enter a model name");
  try {
    const res = await fetch("/api/hedge-fund/ollama/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name }),
    });
    const data = await res.json();
    if (data.ok) {
      alert(`Pulling ${name}... Check Ollama CLI for progress.`);
      setTimeout(_checkOllamaStatus, 5000);
    } else {
      alert(`Error: ${data.error}`);
    }
  } catch (e) { alert("Failed to pull model: " + e.message); }
}

/* ── LMStudio Logic ────────────────────────────────────────────────────────── */

async function _testLMStudio() {
  const urlInput = $("hf-lmstudio-url");
  if (!urlInput) return;
  const url = urlInput.value.trim();
  const indicator = $("hf-lmstudio-indicator");
  const text = $("hf-lmstudio-status-text");
  indicator.className = "status-dot";
  text.textContent = "Testing...";
  try {
    const res = await fetch(url + "/models");
    const data = await res.json();
    const models = data.data || [];
    indicator.className = "status-dot green";
    text.textContent = `Connected — ${models.length} model(s)`;
    $("hf-lmstudio-model-list").innerHTML = models.map(m =>
      `<div class="hf-ollama-model-item"><span>${m.id}</span></div>`
    ).join("") || '<div style="color:var(--muted);font-size:12px">No models loaded</div>';
  } catch (e) {
    indicator.className = "status-dot red";
    text.textContent = "Connection failed: " + e.message;
    $("hf-lmstudio-model-list").innerHTML = "";
  }
}

/* ── Custom Logic ──────────────────────────────────────────────────────────── */

async function _loadCustomEndpoints() {
  try {
    const res = await fetch("/api/hedge-fund/endpoints");
    const data = await res.json();
    const list = $("hf-custom-endpoint-list");
    if (!list) return;
    list.innerHTML = "";
    (data.endpoints || []).forEach(ep => {
      const div = document.createElement("div");
      div.className = "hf-custom-endpoint-item";
      div.innerHTML = `
        <div>
          <strong>${ep.label}</strong>
          <div style="font-size:11px;color:var(--muted)">${ep.base_url}</div>
        </div>
        <button class="secondary-button" onclick="_deleteEndpoint('${ep.id}')" style="font-size:11px">Delete</button>`;
      list.appendChild(div);
    });
  } catch (e) { console.error("Failed to load endpoints:", e); }
}

async function _addCustomEndpoint() {
  const label = $("hf-custom-label").value.trim();
  const url = $("hf-custom-url").value.trim();
  const apiKey = $("hf-custom-apikey").value.trim();
  const modelName = $("hf-custom-model").value.trim();
  if (!label || !url) return alert("Label and URL are required");

  try {
    const epRes = await fetch("/api/hedge-fund/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, base_url: url, api_key: apiKey, provider_type: "custom_openai" }),
    });
    const epData = await epRes.json();

    if (modelName && epData.id) {
      await fetch("/api/hedge-fund/custom-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint_id: epData.id,
          display_name: `[${label}] ${modelName}`,
          model_name: modelName,
          provider: "Custom",
        }),
      });
    }

    $("hf-custom-label").value = "";
    $("hf-custom-url").value = "";
    $("hf-custom-apikey").value = "";
    $("hf-custom-model").value = "";
    _loadCustomEndpoints();
    loadHFModels();
  } catch (e) { alert("Failed to add: " + e.message); }
}

async function _deleteEndpoint(id) {
  if (!confirm("Delete this endpoint?")) return;
  try {
    await fetch(`/api/hedge-fund/endpoints/${id}`, { method: "DELETE" });
    _loadCustomEndpoints();
    loadHFModels();
  } catch (e) { alert("Failed to delete: " + e.message); }
}

/* ── Event Bindings ───────────────────────────────────────────────────────── */

function _bindHFEvents() {
  // Main buttons
  const runBtn = $("hf-run-btn");
  if (runBtn) runBtn.addEventListener("click", runHedgeFundAnalysis);
  
  const backtestBtn = $("hf-backtest-btn");
  if (backtestBtn) backtestBtn.addEventListener("click", runHedgeFundBacktest);

  // Internal tab switching
  document.querySelectorAll(".hf-internal-tab").forEach(btn => {
    btn.addEventListener("click", () => _switchHFTab(btn.dataset.hfTab));
  });

  // Vertical settings tab switching
  document.querySelectorAll(".hf-settings-tab-v").forEach(btn => {
    btn.addEventListener("click", () => _switchHFSettingsTab(btn.dataset.vtab));
  });

  // Analyst selection
  const selectAll = $("hf-select-all");
  if (selectAll) selectAll.addEventListener("click", () => {
    document.querySelectorAll(".hf-analyst-card").forEach(card => {
      card.classList.add("selected");
      _hfSelectedAnalysts.add(card.dataset.key);
    });
  });
  
  const deselectAll = $("hf-deselect-all");
  if (deselectAll) deselectAll.addEventListener("click", () => {
    document.querySelectorAll(".hf-analyst-card").forEach(card => card.classList.remove("selected"));
    _hfSelectedAnalysts.clear();
  });

  // Ollama
  const ollamaRefresh = $("hf-ollama-refresh");
  if (ollamaRefresh) ollamaRefresh.addEventListener("click", _checkOllamaStatus);
  
  const ollamaPull = $("hf-ollama-pull-btn");
  if (ollamaPull) ollamaPull.addEventListener("click", _pullOllamaModel);

  // LMStudio
  const lmstudioTest = $("hf-lmstudio-test");
  if (lmstudioTest) lmstudioTest.addEventListener("click", _testLMStudio);

  // Custom
  const customAdd = $("hf-custom-add-btn");
  if (customAdd) customAdd.addEventListener("click", _addCustomEndpoint);
}
