let _strategyLabInitialized = false;
let _strategySelectedId = null;
let _strategyListCache = [];
let _strategyEditorTab = "editor";
let _strategyResultsTab = "metrics";
let _strategyEquityChart = null;
let _strategyDrawdownChart = null;
let _strategyCompareChart = null;
let _strategyOptimizationScatterChart = null;
let _strategyOptimizationScoreChart = null;
let _strategyCompareSelection = new Set();
let _strategyOptimizationPollTimer = null;
let _strategyBacktestListCache = [];
let _strategySelectedRunId = null;
let _strategyCapabilities = null;
let _strategyPaperSessions = [];
let _strategyActivePaperSessionId = null;
let _strategyLatestRunContext = null;
let _strategyLatestRunPayload = null;
let _strategyModelList = [];
let _strategyOptimizationPinnedRuns = new Map();
const STRATEGY_SIDEBAR_COLLAPSED_KEY = "strategy_lab_sidebar_collapsed";
const STRATEGY_BASE_METRICS = [
  "CAGR", "Return %", "Max DD", "Sharpe", "Sortino", "Win Rate",
  "Profit Factor", "Total Trades", "Ending Equity", "Avg Trade", "Best Trade", "Worst Trade",
];

function initStrategyLab() {
  if (_strategyLabInitialized) return;
  _strategyLabInitialized = true;

  _initializeStrategyDates();
  restoreStrategySidebarState();
  _bindStrategyLabEvents();
  if (typeof initStrategyLabSplits === "function") {
    initStrategyLabSplits();
  }
  if (typeof initStrategyEditor === "function") {
    initStrategyEditor().catch((error) => console.error(error));
  }
  resetStrategyForm();
  renderOptimizationParameterRows(parseOptimizationGridSafe());
  loadStrategyCapabilities().catch((error) => console.error(error));
  loadStrategyModels().catch((error) => console.error(error));
  refreshStrategyList().catch((error) => console.error(error));
  refreshBacktestHistory().catch((error) => console.error(error));
  refreshPaperSessions().catch((error) => console.error(error));
}

function getStarterStrategyDraft() {
  return {
    name: "Simple SMA Cross",
    tags: "starter, trend, crossover",
    description: "A simple starter strategy that buys when the fast SMA crosses above the slow SMA and closes when it crosses below.",
    params: {
      fast_length: 10,
      slow_length: 30,
    },
    aiPrompt: "Create a simple moving average crossover strategy with fast and slow lengths.",
    code: typeof getDefaultStrategyTemplate === "function" ? getDefaultStrategyTemplate() : "",
  };
}

function _initializeStrategyDates() {
  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(today.getFullYear() - 1);
  if ($("strategy-end-date")) $("strategy-end-date").value = today.toISOString().split("T")[0];
  if ($("strategy-start-date")) $("strategy-start-date").value = oneYearAgo.toISOString().split("T")[0];
}

function _bindStrategyLabEvents() {
  const editorTabs = document.querySelectorAll("[data-strategy-tab]");
  editorTabs.forEach((button) => {
    button.addEventListener("click", () => switchStrategyEditorTab(button.dataset.strategyTab));
  });

  const resultsTabs = document.querySelectorAll("[data-results-tab]");
  resultsTabs.forEach((button) => {
    button.addEventListener("click", () => switchStrategyResultsTab(button.dataset.resultsTab));
  });

  if ($("strategy-model-select")) {
    $("strategy-model-select").addEventListener("change", () => {
      const status = $("strategy-model-status");
      const model = getSelectedStrategyModel();
      if (model) {
        window.localStorage.setItem("strategy_lab_model_selection", $("strategy-model-select").value);
      } else {
        window.localStorage.removeItem("strategy_lab_model_selection");
      }
      if (status) {
        status.textContent = model
          ? `Selected ${model.display_name || model.model_name || "model"}.`
          : "Local generator is ready.";
      }
    });
  }

  if ($("strategy-sidebar-toggle")) {
    $("strategy-sidebar-toggle").addEventListener("click", () => {
      const lab = document.querySelector(".strategy-lab");
      if (!lab) return;
      setStrategySidebarCollapsed(!lab.classList.contains("sidebar-collapsed"));
    });
  }

  if ($("strategy-sidebar-rail-toggle")) {
    $("strategy-sidebar-rail-toggle").addEventListener("click", () => {
      setStrategySidebarCollapsed(false);
    });
  }

  if ($("strategy-results-fullscreen-btn")) {
    $("strategy-results-fullscreen-btn").addEventListener("click", () => {
      toggleStrategyResultsFullscreen();
    });
  }

  if ($("strategy-model-refresh-btn")) {
    $("strategy-model-refresh-btn").addEventListener("click", () => {
      loadStrategyModels().catch((error) => {
        console.error(error);
        const status = $("strategy-model-status");
        if (status) status.textContent = `Model refresh failed: ${error.message}`;
      });
    });
  }

  if ($("strategy-refresh-list-btn")) {
    $("strategy-refresh-list-btn").addEventListener("click", () => {
      refreshStrategyList().catch((error) => _appendStrategyLog(`Refresh failed: ${error.message}`));
    });
  }

  if ($("strategy-refresh-backtests-btn")) {
    $("strategy-refresh-backtests-btn").addEventListener("click", () => {
      refreshBacktestHistory().catch((error) => _appendStrategyLog(`Backtest refresh failed: ${error.message}`));
    });
  }

  if ($("strategy-new-btn")) {
    $("strategy-new-btn").addEventListener("click", () => {
      resetStrategyForm(true);
      switchStrategyEditorTab("editor");
      switchStrategyResultsTab("metrics");
      $("strategy-name")?.focus();
    });
  }

  if ($("strategy-generate-btn")) {
    $("strategy-generate-btn").addEventListener("click", () => {
      generateStrategyFromPrompt().catch((error) => {
        console.error(error);
        const status = $("strategy-generate-status");
        if (status) status.textContent = `Generation failed: ${error.message}`;
        _appendStrategyLog(`Generation failed: ${error.message}`);
      });
    });
  }

  if ($("strategy-save-btn")) {
    $("strategy-save-btn").addEventListener("click", async () => {
      try {
        setStrategyRunStatus("Saving...");
        const payload = collectStrategyPayload();
        const result = await window.strategyStorageApi.saveStrategy(payload);
        _strategySelectedId = result.item.id;
        window.localStorage.setItem("strategy_lab_last_strategy_id", _strategySelectedId);
        await refreshStrategyList();
        await loadStrategyIntoForm(_strategySelectedId);
        setStrategyRunStatus("Saved");
        _appendStrategyLog(`Saved strategy "${result.item.name}".`);
      } catch (error) {
        console.error(error);
        setStrategyRunStatus("Save Failed");
        _appendStrategyLog(`Save failed: ${error.message}`);
      }
    });
  }

  if ($("strategy-save-new-btn")) {
    $("strategy-save-new-btn").addEventListener("click", async () => {
      try {
        setStrategyRunStatus("Saving New...");
        const payload = collectStrategyPayload();
        delete payload.id;
        const result = await window.strategyStorageApi.saveStrategy(payload);
        _strategySelectedId = result.item.id;
        window.localStorage.setItem("strategy_lab_last_strategy_id", _strategySelectedId);
        await refreshStrategyList();
        await loadStrategyIntoForm(_strategySelectedId);
        setStrategyRunStatus("Saved New");
        _appendStrategyLog(`Saved new strategy "${result.item.name}".`);
      } catch (error) {
        console.error(error);
        setStrategyRunStatus("Save Failed");
        _appendStrategyLog(`Save new failed: ${error.message}`);
      }
    });
  }

  if ($("strategy-export-btn")) {
    $("strategy-export-btn").addEventListener("click", async () => {
      try {
        const latestRunId = _strategySelectedRunId || _strategyBacktestListCache[0]?.run_id;
        if (!latestRunId) {
          throw new Error("Run or load a backtest before exporting.");
        }
        const result = await window.strategyStorageApi.exportBacktest(
          latestRunId,
          $("strategy-export-format")?.value || "json"
        );
        _strategySelectedRunId = latestRunId;
        _appendStrategyLog(`Exported ${result.export?.filename || "result"} to ${result.export?.path || "--"}.`);
        setStrategyRunStatus("Exported");
        switchStrategyEditorTab("logs");
      } catch (error) {
        console.error(error);
        setStrategyRunStatus("Export Failed");
        _appendStrategyLog(`Export failed: ${error.message}`);
      }
    });
  }

  if ($("strategy-compare-btn")) {
    $("strategy-compare-btn").addEventListener("click", () => {
      runStrategyComparison().catch((error) => {
        console.error(error);
        setStrategyRunStatus("Compare Failed");
        _appendStrategyLog(`Compare failed: ${error.message}`);
      });
    });
  }

  if ($("strategy-optimize-btn")) {
    $("strategy-optimize-btn").addEventListener("click", () => {
      runStrategyOptimization().catch((error) => {
        console.error(error);
        setStrategyRunStatus("Optimization Failed");
        _appendStrategyLog(`Optimization failed: ${error.message}`);
        switchStrategyEditorTab("logs");
      });
    });
  }

  if ($("strategy-opt-sync-params-btn")) {
    $("strategy-opt-sync-params-btn").addEventListener("click", () => {
      renderOptimizationParameterRows(parseOptimizationGridSafe());
    });
  }

  if ($("strategy-run-btn")) {
    $("strategy-run-btn").addEventListener("click", async () => {
      try {
        setStrategyRunStatus("Running...");
        const response = await fetch("/api/backtest/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategy_id: _strategySelectedId,
            strategy_name: ($("strategy-name")?.value || "").trim() || "Current Draft",
            symbol: currentSymbol,
            timeframe: $("strategy-timeframe")?.value || "1D",
            start_date: $("strategy-start-date")?.value || "",
            end_date: $("strategy-end-date")?.value || "",
            strategy_code: getStrategyCode(),
            params: parseStrategyParams(),
            initial_cash: getStrategyInitialCash(),
            commission: getStrategyCommission(),
            engine: $("strategy-run-engine")?.value || "auto",
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          if (payload.traceback) {
            _appendStrategyLog(`Backtest traceback:\n${payload.traceback}`);
          }
          throw new Error(payload.error || `Request failed: ${response.status}`);
        }
        renderStrategyRunResponse(payload);
        await refreshBacktestHistory();
        setStrategyRunStatus(payload.status === "not_implemented" ? "Engine Pending" : "Completed");
      } catch (error) {
        console.error(error);
        setStrategyRunStatus("Run Failed");
        _appendStrategyLog(`Backtest run failed: ${error.message}`);
      }
    });
  }

  if ($("strategy-paper-start-btn")) {
    $("strategy-paper-start-btn").addEventListener("click", () => {
      startPaperSession().catch((error) => {
        console.error(error);
        _appendStrategyLog(`Paper session start failed: ${error.message}`);
      });
    });
  }

  if ($("strategy-paper-stop-btn")) {
    $("strategy-paper-stop-btn").addEventListener("click", () => {
      stopPaperSession().catch((error) => {
        console.error(error);
        _appendStrategyLog(`Paper session stop failed: ${error.message}`);
      });
    });
  }

  if ($("strategy-paper-order-btn")) {
    $("strategy-paper-order-btn").addEventListener("click", () => {
      placePaperOrder().catch((error) => {
        console.error(error);
        _appendStrategyLog(`Paper order failed: ${error.message}`);
      });
    });
  }

  if ($("strategy-equity-view-mode")) {
    $("strategy-equity-view-mode").addEventListener("change", () => {
      if (_strategyLatestRunPayload) {
        renderStrategyEquityChart(_strategyLatestRunPayload.equity_curve || []);
      }
    });
  }

  window.addEventListener("keydown", (event) => {
    if (currentView !== "strategylab") return;
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault();
      $("strategy-save-btn")?.click();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      $("strategy-run-btn")?.click();
    }
    if (event.key === "Escape" && document.body.classList.contains("strategy-results-fullscreen-active")) {
      toggleStrategyResultsFullscreen(false);
    }
  });
}

function switchStrategyEditorTab(tabId) {
  _strategyEditorTab = tabId;
  document.querySelectorAll("[data-strategy-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.strategyTab === tabId);
  });
  ["editor", "params", "logs", "live"].forEach((paneId) => {
    $(`strategy-pane-${paneId}`)?.classList.toggle("hidden", paneId !== tabId);
  });
}

function switchStrategyResultsTab(tabId) {
  _strategyResultsTab = tabId;
  document.querySelectorAll("[data-results-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.resultsTab === tabId);
  });
  ["metrics", "trades", "equity", "drawdown", "compare", "optimization"].forEach((paneId) => {
    $(`strategy-results-${paneId}`)?.classList.toggle("hidden", paneId !== tabId);
  });
}

function syncStrategyLabSymbol() {
  const label = $("strategy-current-symbol");
  if (label) label.textContent = currentSymbol || "NSE:RELIANCE";
}

function setStrategyRunStatus(text) {
  const node = $("strategy-run-status");
  if (node) node.textContent = text;
}

async function loadStrategyCapabilities() {
  const payload = await window.strategyStorageApi.getCapabilities();
  _strategyCapabilities = payload.capabilities || null;
  if (Array.isArray(payload.paper_sessions)) {
    _strategyPaperSessions = payload.paper_sessions;
    if (!_strategyActivePaperSessionId && _strategyPaperSessions.length) {
      _strategyActivePaperSessionId = _strategyPaperSessions[0].session_id;
    }
  }
  updateCapabilitiesSummary();
  renderPaperSessionState(getActivePaperSession());
}

async function loadStrategyModels() {
  const select = $("strategy-model-select");
  const status = $("strategy-model-status");
  if (!select || !status) return;

  try {
    status.textContent = "Loading models from Hedge Fund settings...";
    const response = await fetch("/api/hedge-fund/models");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `Request failed: ${response.status}`);
    }
    _strategyModelList = Array.isArray(payload.models) ? payload.models : [];
    select.innerHTML = '<option value="">Local generator</option>';

    const modelsByProvider = new Map();
    _strategyModelList.forEach((model) => {
      const provider = model.provider || "Other";
      if (!modelsByProvider.has(provider)) modelsByProvider.set(provider, []);
      modelsByProvider.get(provider).push(model);
    });

    modelsByProvider.forEach((models, provider) => {
      const group = document.createElement("optgroup");
      group.label = provider;
      models.forEach((model) => {
        const option = document.createElement("option");
        option.value = JSON.stringify(model);
        option.textContent = model.display_name || `${model.model_name || "--"}${model.endpoint_label ? ` (${model.endpoint_label})` : ""}`;
        group.appendChild(option);
      });
      select.appendChild(group);
    });

    const rememberedModel = window.localStorage.getItem("strategy_lab_model_selection");
    if (rememberedModel && [...select.options].some((option) => option.value === rememberedModel)) {
      select.value = rememberedModel;
    }

    const selected = getSelectedStrategyModel();
    if (selected) {
      status.textContent = `Using ${selected.display_name || selected.model_name || "selected model"}.`;
    } else if (_strategyModelList.length) {
      status.textContent = `${_strategyModelList.length} Hedge Fund model${_strategyModelList.length === 1 ? "" : "s"} available. Local generator is selected.`;
    } else {
      status.textContent = "No Hedge Fund models are configured. Local generator is ready.";
    }
  } catch (error) {
    console.error(error);
    if (select) {
      select.innerHTML = '<option value="">Local generator</option>';
    }
    status.textContent = "Local generator is ready. Model list could not be loaded.";
  }
}

function restoreStrategySidebarState() {
  setStrategySidebarCollapsed(window.localStorage.getItem(STRATEGY_SIDEBAR_COLLAPSED_KEY) === "true", false);
}

function setStrategySidebarCollapsed(collapsed, persist = true) {
  const lab = document.querySelector(".strategy-lab");
  const button = $("strategy-sidebar-toggle");
  const railButton = $("strategy-sidebar-rail-toggle");
  if (!lab) return;
  lab.classList.toggle("sidebar-collapsed", Boolean(collapsed));
  if (button) {
    button.textContent = "<<";
    button.title = "Collapse sidebar";
    button.setAttribute("aria-label", "Collapse sidebar");
    button.setAttribute("aria-expanded", String(!collapsed));
  }
  if (railButton) {
    railButton.classList.toggle("hidden", !collapsed);
  }
  if (persist) {
    window.localStorage.setItem(STRATEGY_SIDEBAR_COLLAPSED_KEY, String(Boolean(collapsed)));
  }
  window.dispatchEvent(new Event("resize"));
}

function toggleStrategyResultsFullscreen(force) {
  const panel = document.querySelector(".strategy-results-panel");
  const button = $("strategy-results-fullscreen-btn");
  if (!panel) return;
  const next = typeof force === "boolean" ? force : !panel.classList.contains("fullscreen");
  panel.classList.toggle("fullscreen", next);
  document.body.classList.toggle("strategy-results-fullscreen-active", next);
  if (button) {
    button.textContent = next ? "Exit Fullscreen" : "Fullscreen";
  }
  window.dispatchEvent(new Event("resize"));
}

function resetStrategyForm(appendLog = false) {
  stopOptimizationPolling();
  _strategySelectedId = null;
  _strategySelectedRunId = null;
  _strategyLatestRunContext = null;
  _strategyLatestRunPayload = null;
  const starter = getStarterStrategyDraft();
  if ($("strategy-name")) $("strategy-name").value = starter.name;
  if ($("strategy-tags")) $("strategy-tags").value = starter.tags;
  if ($("strategy-description")) $("strategy-description").value = starter.description;
  if ($("strategy-params-json")) $("strategy-params-json").value = JSON.stringify(starter.params, null, 2);
  if ($("strategy-generate-prompt")) $("strategy-generate-prompt").value = starter.aiPrompt;
  if ($("strategy-generate-status")) {
    $("strategy-generate-status").textContent = "The assistant will generate a starter strategy and prefill the editor.";
  }
  if ($("strategy-model-select")) $("strategy-model-select").value = "";
  if ($("strategy-model-status")) $("strategy-model-status").textContent = "Local generator is ready.";
  if (typeof setStrategyCode === "function") setStrategyCode(starter.code);
  if ($("strategy-logs")) $("strategy-logs").textContent = "Strategy logs will appear here.";
  setStrategyRunStatus("Ready");
  renderStrategyMetrics(null);
  renderStrategyTrades([]);
  renderStrategyEquityChart([]);
  renderStrategyDrawdownChart([]);
  renderStrategyCompareResults(null);
  renderStrategyOptimizationResults(null);
  if (typeof resetStrategySignals === "function") resetStrategySignals();
  if (appendLog) _appendStrategyLog("Started a new strategy draft.");
  _highlightSelectedStrategy();
  _highlightSelectedBacktest();
  updateScannerSummary();
  updateSidebarStats();
}

function collectStrategyPayload() {
  const tags = ($("strategy-tags")?.value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    id: _strategySelectedId,
    name: ($("strategy-name")?.value || "").trim() || "Untitled Strategy",
    description: ($("strategy-description")?.value || "").trim(),
    code: getStrategyCode(),
    tags,
    parameter_schema: parseStrategyParams(),
  };
}

function getSelectedStrategyModel() {
  const select = $("strategy-model-select");
  if (!select || !select.value) return null;
  try {
    return JSON.parse(select.value);
  } catch (error) {
    return null;
  }
}

function parseStrategyParams() {
  const raw = $("strategy-params-json")?.value || "{}";
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("Parameters JSON is invalid.");
  }
}

function getStrategyInitialCash() {
  const value = Number($("strategy-initial-cash")?.value || 100000);
  return Number.isFinite(value) && value > 0 ? value : 100000;
}

function getStrategyCommission() {
  const value = Number($("strategy-commission")?.value || 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

async function refreshStrategyList() {
  const items = await window.strategyStorageApi.listStrategies();
  _strategyListCache = items;
  renderStrategyList(items);
  updateSidebarStats();

  const remembered = window.localStorage.getItem("strategy_lab_last_strategy_id");
  if (!_strategySelectedId && remembered && items.some((item) => item.id === remembered)) {
    await loadStrategyIntoForm(remembered);
  }
}

async function refreshBacktestHistory() {
  const items = await window.strategyStorageApi.listBacktests();
  _strategyBacktestListCache = items;
  renderBacktestHistory(items);
  updateScannerSummary();
  updateSidebarStats();
}

async function refreshPaperSessions() {
  const items = await window.strategyStorageApi.listPaperSessions();
  _strategyPaperSessions = items;
  if (!_strategyActivePaperSessionId && items.length) {
    _strategyActivePaperSessionId = items[0].session_id;
  }
  renderPaperSessionState(getActivePaperSession());
  updateSidebarStats();
}

function renderStrategyList(items) {
  const list = $("strategy-list");
  const empty = $("strategy-list-empty");
  if (!list || !empty) return;
  list.innerHTML = "";
  empty.classList.toggle("hidden", items.length > 0);

  const header = document.createElement("div");
  header.className = "strategy-list-panel-header";
  header.innerHTML = `
    <span>${items.length} saved</span>
    <span>Load | Compare</span>
  `;
  list.appendChild(header);

  items.forEach((item, index) => {
    const button = document.createElement("div");
    button.className = "strategy-list-item strategy-list-row";
    button.dataset.strategyId = item.id;
    const updated = item.updated_at ? new Date(item.updated_at).toLocaleString() : "Just now";
    button.innerHTML = `
      <div class="strategy-list-item-head">
        <input class="strategy-compare-checkbox" type="checkbox" ${_strategyCompareSelection.has(item.id) ? "checked" : ""} />
        <div style="flex:1">
          <h4 title="${escapeStrategyHtml(item.name || "")}">${escapeStrategyHtml(item.name || `Strategy ${index + 1}`)}</h4>
          <div class="strategy-list-meta">${escapeStrategyHtml((item.tags || []).join(" | ") || "No tags")}</div>
        </div>
        <button type="button" class="strategy-delete-item-btn icon-button icon-button-text" title="Delete strategy">Delete</button>
      </div>
      <div class="strategy-list-desc">${escapeStrategyHtml(item.description || "No description yet.")}</div>
      <div class="strategy-list-meta" style="margin-top:8px">Updated ${escapeStrategyHtml(updated)}</div>
    `;
    button.addEventListener("click", (event) => {
      if (event.target && (event.target.classList.contains("strategy-compare-checkbox") || event.target.classList.contains("strategy-delete-item-btn"))) return;
      loadStrategyIntoForm(item.id).catch((error) => _appendStrategyLog(`Load failed: ${error.message}`));
    });
    const checkbox = button.querySelector(".strategy-compare-checkbox");
    if (checkbox) {
      checkbox.addEventListener("click", (event) => {
        event.stopPropagation();
        if (checkbox.checked) {
          _strategyCompareSelection.add(item.id);
        } else {
          _strategyCompareSelection.delete(item.id);
        }
      });
    }
    const deleteButton = button.querySelector(".strategy-delete-item-btn");
    if (deleteButton) {
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteStrategy(item.id).catch((error) => _appendStrategyLog(`Delete failed: ${error.message}`));
      });
    }
    list.appendChild(button);
  });

  _highlightSelectedStrategy();
}

function renderBacktestHistory(items) {
  const list = $("strategy-backtests-list");
  const empty = $("strategy-backtests-empty");
  if (!list || !empty) return;
  list.innerHTML = "";
  empty.classList.toggle("hidden", items.length > 0);

  items.forEach((item) => {
    const button = document.createElement("div");
    button.className = "strategy-list-item";
    button.dataset.runId = item.run_id;
    const metrics = item.metrics || {};
    const created = item.created_at ? new Date(item.created_at).toLocaleString() : "Just now";
    button.innerHTML = `
      <div class="strategy-list-item-head">
        <div style="flex:1">
          <h4>${item.strategy_name || "Backtest Run"}</h4>
          <div class="strategy-list-meta">${item.symbol || "--"} | ${item.timeframe || "--"} | ${formatStrategyMetric(metrics.return_pct, "%")} return</div>
        </div>
        <button type="button" class="strategy-delete-backtest-btn icon-button icon-button-text" title="Delete backtest">Delete</button>
      </div>
      <div class="strategy-list-desc">${item.start_date || "--"} to ${item.end_date || "--"}</div>
      <div class="strategy-list-meta" style="margin-top:8px">Run ${created}</div>
    `;
    button.addEventListener("click", () => {
      loadBacktestRun(item.run_id).catch((error) => _appendStrategyLog(`Backtest load failed: ${error.message}`));
    });
    const deleteButton = button.querySelector(".strategy-delete-backtest-btn");
    if (deleteButton) {
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteBacktestRun(item.run_id).catch((error) => _appendStrategyLog(`Backtest delete failed: ${error.message}`));
      });
    }
    list.appendChild(button);
  });

  _highlightSelectedBacktest();
}

function updateCapabilitiesSummary() {
  const runtimeNode = $("strategy-live-runtime-summary");
  if (!runtimeNode) return;
  if (!_strategyCapabilities) {
    runtimeNode.textContent = "Paper/live runtime is idle.";
    return;
  }
  const runEngineSelect = $("strategy-run-engine");
  const optEngineSelect = $("strategy-opt-engine");
  if (runEngineSelect) {
    [...runEngineSelect.options].forEach((option) => {
      if (option.value in (_strategyCapabilities.run_engines || {})) {
        option.disabled = !_strategyCapabilities.run_engines[option.value];
      }
    });
    if (runEngineSelect.selectedOptions[0]?.disabled) runEngineSelect.value = "auto";
  }
  if (optEngineSelect) {
    [...optEngineSelect.options].forEach((option) => {
      if (option.value in (_strategyCapabilities.optimization_engines || {})) {
        option.disabled = !_strategyCapabilities.optimization_engines[option.value];
      }
    });
    if (optEngineSelect.selectedOptions[0]?.disabled) optEngineSelect.value = "auto";
  }
  const runEngines = Object.entries(_strategyCapabilities.run_engines || {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([name]) => name)
    .join(", ");
  const optimizationEngines = Object.entries(_strategyCapabilities.optimization_engines || {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([name]) => name)
    .join(", ");
  runtimeNode.textContent = `Run engines: ${runEngines || "--"}. Optimization engines: ${optimizationEngines || "--"}.`;
}

function updateScannerSummary() {
  const node = $("strategy-scanner-summary");
  if (!node) return;
  if (!_strategyBacktestListCache.length) {
    node.textContent = "No market regime snapshot yet.";
    return;
  }
  const best = [..._strategyBacktestListCache].sort((a, b) => Number(b.metrics?.return_pct || -Infinity) - Number(a.metrics?.return_pct || -Infinity))[0];
  node.textContent = `Best recent run: ${best.strategy_name || "--"} on ${best.symbol || "--"} with ${formatStrategyMetric(best.metrics?.return_pct, "%")} return.`;
}

function updateSidebarStats() {
  const savedNode = $("strategy-sidebar-saved-count");
  const backtestNode = $("strategy-sidebar-backtest-count");
  const paperNode = $("strategy-sidebar-paper-count");
  if (savedNode) savedNode.textContent = String(_strategyListCache.length);
  if (backtestNode) backtestNode.textContent = String(_strategyBacktestListCache.length);
  if (paperNode) paperNode.textContent = String(_strategyPaperSessions.filter((item) => item && item.status === "running").length);
}

function updatePortfolioSummary(session) {
  const node = $("strategy-portfolio-summary");
  if (!node) return;
  if (!session) {
    node.textContent = "No paper portfolio running.";
    return;
  }
  node.textContent = `Paper equity ${formatCompactValue(Number(session.equity || 0))}, cash ${formatCompactValue(Number(session.cash || 0))}, positions ${session.positions?.length || 0}.`;
}

function _highlightSelectedStrategy() {
  document.querySelectorAll(".strategy-list-item").forEach((node) => {
    if (!node.dataset.strategyId) return;
    node.classList.toggle("active", node.dataset.strategyId === _strategySelectedId);
  });
}

function _highlightSelectedBacktest() {
  document.querySelectorAll(".strategy-list-item").forEach((node) => {
    if (!node.dataset.runId) return;
    node.classList.toggle("active", node.dataset.runId === _strategySelectedRunId);
  });
}

async function loadStrategyIntoForm(strategyId) {
  const payload = await window.strategyStorageApi.loadStrategy(strategyId);
  const item = payload.item;
  _strategySelectedId = item.id;
  window.localStorage.setItem("strategy_lab_last_strategy_id", _strategySelectedId);

  if ($("strategy-name")) $("strategy-name").value = item.name || "";
  if ($("strategy-tags")) $("strategy-tags").value = (item.tags || []).join(", ");
  if ($("strategy-description")) $("strategy-description").value = item.description || "";
  if ($("strategy-params-json")) {
    $("strategy-params-json").value = JSON.stringify(item.parameter_schema || {}, null, 2);
  }
  if ($("strategy-generate-status")) {
    $("strategy-generate-status").textContent = "Loaded a saved strategy. You can still generate a fresh draft from the prompt box above.";
  }
  if (typeof setStrategyCode === "function") setStrategyCode(item.code || getDefaultStrategyTemplate());
  setStrategyRunStatus("Ready");
  _appendStrategyLog(`Loaded strategy "${item.name}".`);
  _highlightSelectedStrategy();
}

async function deleteStrategy(strategyId) {
  const item = _strategyListCache.find((s) => s.id === strategyId);
  const name = item ? item.name : "this strategy";
  if (!confirm(`Are you sure you want to delete "${name}"?`)) {
    return;
  }

  try {
    setStrategyRunStatus("Deleting...");
    await window.strategyStorageApi.deleteStrategy(strategyId);
    _appendStrategyLog(`Deleted strategy "${name}".`);

    if (_strategySelectedId === strategyId) {
      _strategySelectedId = null;
      window.localStorage.removeItem("strategy_lab_last_strategy_id");
      resetStrategyForm();
    }

    _strategyCompareSelection.delete(strategyId);
    await refreshStrategyList();
    setStrategyRunStatus("Deleted");
  } catch (error) {
    console.error(error);
    setStrategyRunStatus("Delete Failed");
    _appendStrategyLog(`Delete failed: ${error.message}`);
    throw error;
  }
}

async function generateStrategyFromPrompt() {
  const prompt = ($("strategy-generate-prompt")?.value || "").trim();
  if (!prompt) {
    throw new Error("Enter an indicator idea first.");
  }
  const status = $("strategy-generate-status");
  const model = getSelectedStrategyModel();
  if (status) status.textContent = "Generating strategy draft...";
  if ($("strategy-model-status")) {
    $("strategy-model-status").textContent = model
      ? `Generating with ${model.display_name || model.model_name || "selected model"}...`
      : "Generating with the local generator...";
  }
  const payload = await window.strategyStorageApi.generateStrategy(prompt, model);
  const item = payload.item || {};
  _strategySelectedId = null;
  window.localStorage.removeItem("strategy_lab_last_strategy_id");
  if ($("strategy-name")) $("strategy-name").value = item.name || "Generated Strategy";
  if ($("strategy-tags")) $("strategy-tags").value = (item.tags || []).join(", ");
  if ($("strategy-description")) $("strategy-description").value = item.description || "";
  if ($("strategy-params-json")) $("strategy-params-json").value = JSON.stringify(item.params || {}, null, 2);
  if (typeof setStrategyCode === "function") setStrategyCode(item.strategy_code || getDefaultStrategyTemplate());
  if (status) status.textContent = (item.notes || []).join(" ") || "Strategy generated.";
  if ($("strategy-model-status")) {
    $("strategy-model-status").textContent = item.llm
      ? `Generated with ${item.llm.provider} / ${item.llm.model_name}.`
      : (model ? "Selected model fell back to the local generator." : "Local generator produced the draft.");
  }
  _appendStrategyLog(`Generated strategy from prompt: "${prompt}".`);
  switchStrategyEditorTab("editor");
}

async function loadBacktestRun(runId) {
  const payload = await window.strategyStorageApi.loadBacktest(runId);
  const item = payload.item || {};
  _strategySelectedRunId = item.run_id || runId;
  renderStrategyRunResponse({
    ...(item.result || {}),
    run_id: item.run_id,
    status: "completed",
    history_item: item,
  });
  setStrategyRunStatus("History Loaded");
  _appendStrategyLog(`Loaded backtest run ${item.run_id}.`);
  _highlightSelectedBacktest();
}

async function deleteBacktestRun(runId) {
  if (!runId) return;
  await window.strategyStorageApi.deleteBacktest(runId);
  if (_strategySelectedRunId === runId) {
    _strategySelectedRunId = null;
  }
  await refreshBacktestHistory();
  setStrategyRunStatus("Backtest Deleted");
  _appendStrategyLog(`Deleted backtest run ${runId}.`);
}

function renderStrategyRunResponse(payload) {
  const logs = payload.logs || [];
  const metrics = payload.metrics || {};
  _strategyLatestRunPayload = payload;
  _strategyLatestRunContext = payload.context || payload.history_item?.result?.context || null;
  if (payload.run_id) {
    _strategySelectedRunId = payload.run_id;
  } else if (payload.history_item?.run_id) {
    _strategySelectedRunId = payload.history_item.run_id;
  }
  renderStrategyMetrics(metrics);
  renderStrategyTrades(payload.trades || []);
  renderStrategyEquityChart(payload.equity_curve || []);
  renderStrategyDrawdownChart(payload.drawdown_curve || []);
  if (typeof setStrategySignals === "function") setStrategySignals(payload.signals || []);
  if (typeof applyStrategySignals === "function") applyStrategySignals();
  if (payload.engine) {
    _appendStrategyLog(`Engine: ${payload.engine.selected || "--"}${payload.engine.warning ? ` (${payload.engine.warning})` : ""}`);
  }

  if (logs.length) {
    const logText = logs
      .map((entry) => `[${entry.level || "info"}] ${entry.message || ""}`.trim())
      .join("\n");
    ["strategy-logs"].forEach((id) => {
      const node = $(id);
      if (node) node.textContent = logText;
    });
  } else {
    _appendStrategyLog("Backtest response received.");
  }
  switchStrategyEditorTab("logs");
  _highlightSelectedBacktest();
}

function formatStrategyMetric(value, type = "number") {
  if (value === undefined || value === null || value === "") return "--";
  if (type === "count") return String(value);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (type === "%") return `${numeric.toFixed(2)}%`;
  if (type === "currency") return formatCompactValue(numeric);
  return numeric.toFixed(2);
}

function escapeStrategyHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderStrategyMetrics(metrics) {
  const grid = $("strategy-metrics-grid");
  if (!grid) return;
  const metricRows = [
    ["CAGR", metrics?.cagr, "%"],
    ["Return %", metrics?.return_pct, "%"],
    ["Max DD", metrics?.max_drawdown, "%"],
    ["Sharpe", metrics?.sharpe, "number"],
    ["Sortino", metrics?.sortino, "number"],
    ["Win Rate", metrics?.win_rate, "%"],
    ["Profit Factor", metrics?.profit_factor, "number"],
    ["Total Trades", metrics?.total_trades, "count"],
    ["Ending Equity", metrics?.ending_equity, "currency"],
    ["Avg Trade", metrics?.avg_trade, "currency"],
    ["Best Trade", metrics?.best_trade, "currency"],
    ["Worst Trade", metrics?.worst_trade, "currency"],
  ];
  if (metrics) {
    Object.entries(metrics).forEach(([key, value]) => {
      if (["cagr", "return_pct", "max_drawdown", "sharpe", "sortino", "win_rate", "profit_factor", "total_trades", "ending_equity", "avg_trade", "best_trade", "worst_trade"].includes(key)) {
        return;
      }
      metricRows.push([humanizeStrategyMetricKey(key), value, inferStrategyMetricType(key)]);
    });
  } else {
    STRATEGY_BASE_METRICS.forEach((label, index) => {
      if (metricRows[index]) metricRows[index][1] = null;
    });
  }

  grid.innerHTML = metricRows.map(([label, value, type]) => `
    <div class="strategy-metric-card">
      <span class="strategy-metric-label">${escapeStrategyHtml(label)}</span>
      <strong class="strategy-metric-value">${escapeStrategyHtml(formatStrategyMetric(value, type))}</strong>
    </div>
  `).join("");
}

function humanizeStrategyMetricKey(key) {
  return String(key || "")
    .replace(/^bt_/, "BT ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace("Pct", "%");
}

function inferStrategyMetricType(key) {
  const lower = String(key || "").toLowerCase();
  if (lower.includes("pct") || lower.includes("rate") || lower.includes("return") || lower.includes("drawdown")) return "%";
  if (lower.includes("equity") || lower.includes("trade") || lower.includes("cash")) return "currency";
  if (lower.includes("trades") || lower.includes("count")) return "count";
  return "number";
}

function updateMetricCard(label, value) {
  const cards = document.querySelectorAll(".strategy-metric-card");
  cards.forEach((card) => {
    const metricLabel = card.querySelector(".strategy-metric-label")?.textContent;
    if (metricLabel === label) {
      const valueNode = card.querySelector(".strategy-metric-value");
      if (valueNode) valueNode.textContent = value === undefined || value === null ? "--" : String(value);
    }
  });
}

function renderStrategyTrades(trades) {
  const body = $("strategy-trades-body");
  if (!body) return;
  if (!trades.length) {
    body.innerHTML = '<tr><td colspan="7" class="strategy-empty-cell">Run a backtest to populate trades.</td></tr>';
    return;
  }

  body.innerHTML = "";
  trades.forEach((trade) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${trade.date || "--"}</td>
      <td>${trade.side || "--"}</td>
      <td>${trade.qty || "--"}</td>
      <td>${trade.entry || "--"}</td>
      <td>${trade.exit || "--"}</td>
      <td>${trade.pnl || "--"}</td>
      <td>${trade.pnl_pct || "--"}</td>
    `;
    body.appendChild(row);
  });
}

function _appendStrategyLog(message) {
  const targets = ["strategy-logs"];
  targets.forEach((id) => {
    const node = $(id);
    if (!node) return;
    if (node.textContent === "Strategy logs will appear here.") {
      node.textContent = "";
    }
    node.textContent = `${node.textContent}${node.textContent ? "\n" : ""}${message}`;
    node.scrollTop = node.scrollHeight;
  });
}

async function runStrategyComparison() {
  const selectedIds = [..._strategyCompareSelection];
  if (!selectedIds.length) {
    throw new Error("Select at least one saved strategy to compare.");
  }

  setStrategyRunStatus("Comparing...");
  const response = await fetch("/api/backtest/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol: currentSymbol,
      timeframe: $("strategy-timeframe")?.value || "1D",
      start_date: $("strategy-start-date")?.value || "",
      end_date: $("strategy-end-date")?.value || "",
      strategies: [
        {
          id: "current_draft",
          name: ($("strategy-name")?.value || "").trim() || "Current Draft",
          strategy_code: getStrategyCode(),
          params: parseStrategyParams(),
        },
        ...selectedIds.map((strategyId) => ({ strategy_id: strategyId })),
      ],
      initial_cash: getStrategyInitialCash(),
      commission: getStrategyCommission(),
      engine: $("strategy-run-engine")?.value || "auto",
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  renderStrategyCompareResults(payload);
  setStrategyRunStatus("Compare Ready");
  switchStrategyResultsTab("compare");
}

async function runStrategyOptimization() {
  setStrategyRunStatus("Optimizing...");
  const response = await fetch("/api/backtest/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol: currentSymbol,
      timeframe: $("strategy-timeframe")?.value || "1D",
      start_date: $("strategy-start-date")?.value || "",
      end_date: $("strategy-end-date")?.value || "",
      strategy_code: getStrategyCode(),
      parameter_grid: parseOptimizationGrid(),
      objective: $("strategy-opt-objective")?.value || "sharpe",
      initial_cash: getStrategyInitialCash(),
      commission: getStrategyCommission(),
      engine: $("strategy-opt-engine")?.value || "auto",
      optimization_config: collectOptimizationConfig(),
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  const optimizationId = payload.optimization_id;
  if (!optimizationId) {
    throw new Error("Optimization job id was not returned.");
  }
  _appendStrategyLog(`Optimization job queued: ${optimizationId}`);
  startOptimizationPolling(optimizationId);
  switchStrategyResultsTab("optimization");
}

function parseOptimizationGrid() {
  const fromRows = collectOptimizationGridFromRows();
  if (Object.keys(fromRows).filter((key) => key !== "_constraints").length) {
    if ($("strategy-opt-grid-json")) {
      $("strategy-opt-grid-json").value = JSON.stringify(fromRows, null, 2);
    }
    return fromRows;
  }
  const raw = $("strategy-opt-grid-json")?.value || "{}";
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("Optimization grid JSON is invalid.");
  }
}

function parseOptimizationGridSafe() {
  try {
    return JSON.parse($("strategy-opt-grid-json")?.value || "{}");
  } catch (error) {
    return {};
  }
}

function collectOptimizationConfig() {
  const method = document.querySelector('input[name="strategy-opt-method"]:checked')?.value || "grid";
  return {
    method,
    max_runs: Number($("strategy-opt-max-runs")?.value || 0) || null,
    generations: Number($("strategy-opt-generations")?.value || 0) || null,
    cores: Number($("strategy-opt-cores")?.value || 1) || 1,
    time_budget: $("strategy-opt-time-budget")?.value || "",
    in_sample_pct: Number($("strategy-opt-insample")?.value || 70) || 70,
    custom_formula: $("strategy-opt-custom-formula")?.value || "",
  };
}

function renderOptimizationParameterRows(grid) {
  const wrap = $("strategy-opt-param-rows");
  if (!wrap) return;
  const entries = Object.entries(grid || {}).filter(([key]) => key !== "_constraints");
  if (!entries.length) {
    wrap.innerHTML = '<div class="strategy-empty-state">Add parameters in the JSON grid, then sync.</div>';
    return;
  }
  wrap.innerHTML = entries.map(([name, spec]) => {
    const normalized = normalizeOptimizationSpec(spec);
    return `
      <div class="strategy-opt-param-row" data-param-name="${escapeStrategyHtml(name)}">
        <label><input type="checkbox" class="strategy-opt-param-enabled" checked /> ${escapeStrategyHtml(name)}</label>
        <input class="strategy-opt-param-min" type="number" step="any" value="${escapeStrategyHtml(normalized.start)}" title="Minimum" />
        <input class="strategy-opt-param-max" type="number" step="any" value="${escapeStrategyHtml(normalized.end)}" title="Maximum" />
        <input class="strategy-opt-param-step" type="number" step="any" value="${escapeStrategyHtml(normalized.step)}" title="Step" />
      </div>
    `;
  }).join("");
}

function normalizeOptimizationSpec(spec) {
  if (Array.isArray(spec)) {
    return { start: spec[0] ?? 0, end: spec[spec.length - 1] ?? spec[0] ?? 0, step: spec.length > 1 ? Number(spec[1]) - Number(spec[0]) || 1 : 1 };
  }
  if (spec && typeof spec === "object") {
    return { start: spec.start ?? 0, end: spec.end ?? spec.start ?? 0, step: spec.step ?? 1 };
  }
  return { start: spec ?? 0, end: spec ?? 0, step: 1 };
}

function collectOptimizationGridFromRows() {
  const rows = document.querySelectorAll(".strategy-opt-param-row");
  if (!rows.length) return {};
  const grid = {};
  rows.forEach((row) => {
    if (!row.querySelector(".strategy-opt-param-enabled")?.checked) return;
    const name = row.dataset.paramName;
    if (!name) return;
    grid[name] = {
      start: Number(row.querySelector(".strategy-opt-param-min")?.value),
      end: Number(row.querySelector(".strategy-opt-param-max")?.value),
      step: Number(row.querySelector(".strategy-opt-param-step")?.value) || 1,
    };
  });
  const existing = parseOptimizationGridSafe();
  if (Array.isArray(existing._constraints) && existing._constraints.length) {
    grid._constraints = existing._constraints;
  }
  return grid;
}

function renderStrategyEquityChart(points) {
  const canvas = $("strategy-equity-chart");
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (_strategyEquityChart) _strategyEquityChart.destroy();
  _strategyEquityChart = null;
  if (!points.length) return;

  const mode = $("strategy-equity-view-mode")?.value || "absolute";
  const initialEquity = points[0]?.equity || 100000;
  const initialBuyHold = points[0]?.buy_hold || initialEquity;

  const labels = points.map((p) => p.time);
  const equityData = points.map((p) => (mode === "percentage" ? ((p.equity / initialEquity) - 1) * 100 : p.equity));
  const buyHoldData = points.map((p) => (mode === "percentage" ? ((p.buy_hold / initialBuyHold) - 1) * 100 : p.buy_hold));

  _strategyEquityChart = new Chart(context, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Cumulative P&L",
          data: equityData,
          borderColor: "#10b981",
          backgroundColor: "rgba(16, 185, 129, 0.12)",
          fill: true,
          pointRadius: points.map((p) => (p.trade ? 4 : 0)),
          pointHoverRadius: 6,
          pointBackgroundColor: "#10b981",
          pointBorderColor: "#fff",
          pointBorderWidth: 2,
          tension: 0.15,
          order: 2,
        },
        {
          label: "Buy & Hold",
          data: buyHoldData,
          borderColor: "#2962ff",
          backgroundColor: "transparent",
          fill: false,
          pointRadius: 0,
          borderDash: [5, 5],
          tension: 0.15,
          order: 3,
        },
        {
          label: "Excursions",
          type: "bar",
          data: points.map((p) => {
            if (!p.trade) return null;
            const base = mode === "percentage" ? ((p.equity / initialEquity) - 1) * 100 : p.equity;
            const mfe = mode === "percentage" ? (p.trade.mfe / initialEquity) * 100 : p.trade.mfe;
            const mae = mode === "percentage" ? (p.trade.mae / initialEquity) * 100 : p.trade.mae;
            return [base + mae, base + mfe];
          }),
          backgroundColor: "rgba(255, 255, 255, 0.2)",
          borderColor: "rgba(255, 255, 255, 0.4)",
          borderWidth: 1,
          barThickness: 2,
          order: 1,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            font: { size: 11 },
            color: "#94a3b8",
          },
        },
        tooltip: {
          enabled: true,
          backgroundColor: "rgba(15, 23, 42, 0.94)",
          titleColor: "#94a3b8",
          bodyColor: "#f8fafc",
          borderColor: "rgba(255, 255, 255, 0.1)",
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function (context) {
              const point = points[context.dataIndex];
              const dataset = context.dataset;
              if (dataset.label === "Excursions") {
                if (!point.trade) return "";
                const mfe = formatStrategyMetric(point.trade.mfe, mode === "percentage" ? "%" : "currency");
                const mae = formatStrategyMetric(point.trade.mae, mode === "percentage" ? "%" : "currency");
                return [
                  `Trade #${context.dataIndex + 1} (${point.trade.side})`,
                  `Favorable: ${mfe}`,
                  `Adverse: ${mae}`,
                ];
              }
              const val = context.raw;
              const formatted = mode === "percentage" ? `${val.toFixed(2)}%` : formatCompactValue(val);
              return `${dataset.label}: ${formatted}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 12, color: "#64748b", font: { size: 10 } },
        },
        y: {
          grid: { color: "rgba(255, 255, 255, 0.04)" },
          ticks: {
            color: "#64748b",
            font: { size: 10 },
            callback: (value) => (mode === "percentage" ? `${value.toFixed(1)}%` : formatCompactValue(Number(value))),
          },
        },
      },
    },
  });
}

function renderStrategyDrawdownChart(points) {
  const canvas = $("strategy-drawdown-chart");
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (_strategyDrawdownChart) _strategyDrawdownChart.destroy();
  _strategyDrawdownChart = null;
  if (!points.length) return;

  _strategyDrawdownChart = new Chart(context, {
    type: "line",
    data: {
      labels: points.map((point) => point.time),
      datasets: [
        {
          data: points.map((point) => point.drawdown),
          borderColor: "#f23645",
          backgroundColor: "rgba(242, 54, 69, 0.14)",
          fill: true,
          pointRadius: 0,
          tension: 0.25,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 8 } },
        y: { ticks: { callback: (value) => `${Number(value).toFixed(1)}%` } },
      },
    },
  });
}

function renderStrategyCompareResults(payload) {
  const summary = $("strategy-compare-summary");
  const body = $("strategy-compare-body");
  const canvas = $("strategy-compare-chart");
  if (!summary || !body || !canvas) return;

  if (!payload) {
    summary.textContent = "Select saved strategies in the sidebar and click Compare Selected.";
    body.innerHTML = '<tr><td colspan="6" class="strategy-empty-cell">No comparison run yet.</td></tr>';
    if (_strategyCompareChart) _strategyCompareChart.destroy();
    _strategyCompareChart = null;
    return;
  }

  summary.textContent = `Winner: ${payload.summary?.winner || "--"}`;
  const rows = payload.metrics_table || [];
  body.innerHTML = rows.map((row) => `
    <tr>
      <td>${row.name || "--"}</td>
      <td>${formatStrategyMetric(row.return_pct, "%")}</td>
      <td>${formatStrategyMetric(row.sharpe)}</td>
      <td>${formatStrategyMetric(row.sortino)}</td>
      <td>${formatStrategyMetric(row.max_drawdown, "%")}</td>
      <td>${formatStrategyMetric(row.total_trades, "count")}</td>
    </tr>
  `).join("") || '<tr><td colspan="6" class="strategy-empty-cell">No comparison rows returned.</td></tr>';

  const ctx = canvas.getContext("2d");
  if (_strategyCompareChart) _strategyCompareChart.destroy();
  _strategyCompareChart = null;
  const curves = payload.equity_curves || [];
  if (!curves.length) return;
  _strategyCompareChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: curves[0].points.map((point) => point.time),
      datasets: curves.map((curve, index) => ({
        label: curve.name,
        data: curve.points.map((point) => point.equity),
        borderColor: ["#2962ff", "#10b981", "#f5a623", "#f23645", "#8b5cf6"][index % 5],
        pointRadius: 0,
        tension: 0.25,
      })),
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: true, position: "bottom" } },
      scales: {
        x: { ticks: { maxTicksLimit: 8 } },
      },
    },
  });
}

function renderStrategyOptimizationResults(payload) {
  const summary = $("strategy-optimization-summary");
  const body = $("strategy-optimization-body");
  const robustnessSummary = $("strategy-robustness-summary");
  const robustnessBody = $("strategy-robustness-body");
  if (!summary || !body || !robustnessSummary || !robustnessBody) return;
  const diagnosticsNode = $("strategy-optimization-diagnostics");

  if (!payload) {
    summary.textContent = "Optimization results will appear here.";
    body.innerHTML = '<tr><td colspan="7" class="strategy-empty-cell">No optimization run yet.</td></tr>';
    robustnessSummary.textContent = "Robustness analysis will appear here.";
    robustnessBody.innerHTML = '<tr><td colspan="4" class="strategy-empty-cell">No robustness rows yet.</td></tr>';
    if (diagnosticsNode) {
      diagnosticsNode.classList.add("hidden");
      diagnosticsNode.textContent = "";
    }
    renderStrategyHeatmap(null);
    renderStrategyOptimizationCharts(null);
    renderPinnedOptimizationRuns();
    return;
  }

  summary.textContent = `Best Params: ${JSON.stringify(payload.best_params || {})} | Best Metrics: Return ${formatStrategyMetric(payload.best_metrics?.return_pct, "%")}, Sharpe ${formatStrategyMetric(payload.best_metrics?.sharpe)}`;
  if (diagnosticsNode) {
    diagnosticsNode.classList.remove("hidden");
    diagnosticsNode.textContent = buildOptimizationDiagnosticsText(payload.diagnostics || {}, payload.engine || {});
  }
  const rows = payload.leaderboard || [];
  body.innerHTML = rows.map((row, index) => `
    <tr data-optimization-row="${index}">
      <td>${index + 1}</td>
      <td>${escapeStrategyHtml(JSON.stringify(row.params || {}))}</td>
      <td>${formatStrategyMetric(row.score)}</td>
      <td>${formatStrategyMetric(row.metrics?.return_pct, "%")}</td>
      <td>${formatStrategyMetric(row.metrics?.sharpe)}</td>
      <td>${formatStrategyMetric(row.metrics?.max_drawdown, "%")}</td>
      <td><button type="button" class="strategy-pin-run-btn" data-run-index="${index}">${_strategyOptimizationPinnedRuns.has(String(index)) ? "Pinned" : "Pin"}</button></td>
    </tr>
  `).join("") || '<tr><td colspan="7" class="strategy-empty-cell">No optimization rows returned.</td></tr>';
  body.querySelectorAll(".strategy-pin-run-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const index = button.dataset.runIndex;
      const run = rows[Number(index)];
      if (!run) return;
      togglePinnedOptimizationRun(index, run);
      renderStrategyOptimizationResults(payload);
    });
  });

  const robustnessRows = payload.sensitivity || [];
  robustnessSummary.textContent = robustnessRows.length
    ? "Higher bars moved the objective more across the tested range."
    : buildRobustnessSummary(payload.robustness_zone || []);
  robustnessBody.innerHTML = robustnessRows.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeStrategyHtml(row.parameter || "--")}</td>
      <td>${formatStrategyMetric(row.importance_pct, "%")}</td>
      <td><div class="strategy-sensitivity-bar"><span style="width:${Math.max(0, Math.min(100, Number(row.importance_pct || 0)))}%"></span></div></td>
    </tr>
  `).join("") || '<tr><td colspan="4" class="strategy-empty-cell">No robustness rows yet.</td></tr>';

  renderStrategyHeatmap(payload);
  renderStrategyOptimizationCharts(payload);
  renderPinnedOptimizationRuns();
}

function renderStrategyOptimizationCharts(payload) {
  const scatterCanvas = $("strategy-optimization-scatter-chart");
  const scoreCanvas = $("strategy-optimization-score-chart");
  if (_strategyOptimizationScatterChart) _strategyOptimizationScatterChart.destroy();
  if (_strategyOptimizationScoreChart) _strategyOptimizationScoreChart.destroy();
  _strategyOptimizationScatterChart = null;
  _strategyOptimizationScoreChart = null;
  if (!payload || !Array.isArray(payload.leaderboard) || !payload.leaderboard.length) return;

  const rows = payload.leaderboard;
  if (scatterCanvas) {
    _strategyOptimizationScatterChart = new Chart(scatterCanvas.getContext("2d"), {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "Candidates",
            data: rows.map((row, index) => ({
              x: Number(row.metrics?.return_pct || 0),
              y: Math.abs(Number(row.metrics?.max_drawdown || 0)),
              rank: index + 1,
            })),
            backgroundColor: rows.map((_, index) => index < 5 ? "rgba(16, 185, 129, 0.85)" : "rgba(41, 98, 255, 0.55)"),
            pointRadius: rows.map((_, index) => index < 5 ? 5 : 3),
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: "Return %" } },
          y: { title: { display: true, text: "Drawdown %" } },
        },
      },
    });
  }

  if (scoreCanvas) {
    const topRows = rows.slice(0, 5);
    const colors = ["#2962ff", "#10b981", "#f5a623", "#f23645", "#8b5cf6"];
    
    // Find first available equity curve to get labels and buy_hold
    const firstCurve = topRows.find(r => r.equity_curve && r.equity_curve.length)?.equity_curve || [];
    const labels = firstCurve.map(p => p.time);
    const buyHoldData = firstCurve.map(p => p.buy_hold);

    const datasets = topRows.map((row, index) => ({
      label: `#${index + 1}`,
      data: (row.equity_curve || []).map((p) => p.equity),
      borderColor: colors[index % colors.length],
      backgroundColor: "transparent",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.1,
      fill: false,
    }));

    // Add Buy & Hold if available
    if (buyHoldData.length > 0) {
      datasets.push({
        label: "Buy & Hold",
        data: buyHoldData,
        borderColor: "#94a3b8",
        borderDash: [5, 5],
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0,
        fill: false,
      });
    }

    _strategyOptimizationScoreChart = new Chart(scoreCanvas.getContext("2d"), {
      type: "line",
      data: {
        labels: labels,
        datasets: datasets,
      },
      options: {
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: { 
              boxWidth: 12, 
              font: { size: 11, weight: '500' }, 
              color: "#94a3b8", 
              usePointStyle: true,
              padding: 15
            },
          },
          tooltip: {
            enabled: true,
            backgroundColor: "rgba(17, 24, 39, 0.95)",
            titleColor: "#94a3b8",
            bodyColor: "#f8fafc",
            borderColor: "rgba(255, 255, 255, 0.1)",
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (context) => {
                const label = context.dataset.label;
                const val = context.raw;
                if (label === "Buy & Hold") return `${label}: ${formatCompactValue(val)}`;
                const row = topRows[context.datasetIndex];
                return `${label}: ${formatCompactValue(val)} (${JSON.stringify(row.params || {})})`;
              },
            },
          },
        },
        scales: {
          x: { 
            display: false,
            grid: { display: false }
          },
          y: {
            beginAtZero: false,
            title: {
              display: true,
              text: 'Equity ($)',
              color: '#64748b',
              font: { size: 10, weight: 'bold' }
            },
            grid: { 
              color: "rgba(255, 255, 255, 0.06)",
              drawBorder: false
            },
            ticks: {
              font: { size: 10 },
              color: "#64748b",
              callback: (value) => formatCompactValue(Number(value)),
              padding: 8
            },
          },
        },
      },
    });
  }
}

function togglePinnedOptimizationRun(index, run) {
  const key = String(index);
  if (_strategyOptimizationPinnedRuns.has(key)) {
    _strategyOptimizationPinnedRuns.delete(key);
    return;
  }
  if (_strategyOptimizationPinnedRuns.size >= 4) {
    const firstKey = _strategyOptimizationPinnedRuns.keys().next().value;
    _strategyOptimizationPinnedRuns.delete(firstKey);
  }
  _strategyOptimizationPinnedRuns.set(key, run);
}

function renderPinnedOptimizationRuns() {
  const node = $("strategy-optimization-pinned");
  if (!node) return;
  if (!_strategyOptimizationPinnedRuns.size) {
    node.classList.add("hidden");
    node.innerHTML = "";
    return;
  }
  const rows = [..._strategyOptimizationPinnedRuns.entries()];
  node.classList.remove("hidden");
  node.innerHTML = `
    <div class="strategy-pinned-title">Pinned Comparison</div>
    <div class="strategy-pinned-grid">
      ${rows.map(([key, run]) => `
        <div class="strategy-pinned-card">
          <button type="button" class="strategy-unpin-run-btn" data-pin-key="${escapeStrategyHtml(key)}">x</button>
          <strong>#${Number(key) + 1}</strong>
          <span>${escapeStrategyHtml(JSON.stringify(run.params || {}))}</span>
          <em>Return ${formatStrategyMetric(run.metrics?.return_pct, "%")} | DD ${formatStrategyMetric(run.metrics?.max_drawdown, "%")}</em>
        </div>
      `).join("")}
    </div>
  `;
  node.querySelectorAll(".strategy-unpin-run-btn").forEach((button) => {
    button.addEventListener("click", () => {
      _strategyOptimizationPinnedRuns.delete(button.dataset.pinKey);
      renderPinnedOptimizationRuns();
    });
  });
}

function startOptimizationPolling(optimizationId) {
  stopOptimizationPolling();
  const tick = async () => {
    try {
      const response = await fetch(`/api/backtest/optimize/${encodeURIComponent(optimizationId)}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `Request failed: ${response.status}`);
      }

      renderOptimizationProgress(payload);

      if (payload.status === "completed") {
        stopOptimizationPolling();
        renderStrategyOptimizationResults(payload.result || null);
        setStrategyRunStatus("Optimization Ready");
        _appendStrategyLog(`Optimization completed: ${optimizationId}`);
        return;
      }

      if (payload.status === "failed") {
        stopOptimizationPolling();
        renderOptimizationFailure(payload);
        setStrategyRunStatus("Optimization Failed");
        return;
      }
    } catch (error) {
      stopOptimizationPolling();
      _appendStrategyLog(`Optimization polling failed: ${error.message}`);
      setStrategyRunStatus("Optimization Failed");
      switchStrategyEditorTab("logs");
    }
  };

  tick();
  _strategyOptimizationPollTimer = window.setInterval(tick, 1200);
}

function stopOptimizationPolling() {
  if (_strategyOptimizationPollTimer) {
    window.clearInterval(_strategyOptimizationPollTimer);
    _strategyOptimizationPollTimer = null;
  }
}

function renderOptimizationProgress(job) {
  const diagnosticsNode = $("strategy-optimization-diagnostics");
  const progress = job.progress || {};
  const completed = progress.completed ?? 0;
  const total = progress.total ?? 0;
  const percent = progress.percent ?? 0;
  const params = progress.params ? JSON.stringify(progress.params) : "--";
  setStrategyRunStatus(job.status === "running" ? `Optimizing ${percent}%` : "Queued");
  if (diagnosticsNode) {
    diagnosticsNode.classList.remove("hidden");
    diagnosticsNode.textContent = `Job ${job.job_id}: ${job.status}. Progress ${completed}/${total} (${percent}%). Current params: ${params}.`;
  }
}

function renderOptimizationFailure(job) {
  const diagnosticsNode = $("strategy-optimization-diagnostics");
  if (diagnosticsNode) {
    diagnosticsNode.classList.remove("hidden");
    diagnosticsNode.textContent = [
      `Optimization job ${job.job_id || "--"} failed.`,
      job.error ? `Error: ${job.error}` : "Error: unavailable",
      job.traceback ? `Traceback:\n${job.traceback}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }
  _appendStrategyLog(`Optimization failed: ${job.error || "Unknown error"}`);
}

function buildOptimizationDiagnosticsText(diagnostics, engine = {}) {
  const total = diagnostics.total_candidates ?? "--";
  const valid = diagnostics.valid_candidates ?? "--";
  const filtered = diagnostics.filtered_candidates ?? "--";
  const dimensions = Array.isArray(diagnostics.dimensions) ? diagnostics.dimensions.join(", ") : "--";
  const constraints = Array.isArray(diagnostics.constraints) && diagnostics.constraints.length
    ? diagnostics.constraints.map((item) => item.expression || "").join(" | ")
    : "None";
  const engineLabel = engine.selected ? ` Engine: ${engine.selected}.` : "";
  const warning = engine.warning ? ` ${engine.warning}` : "";
  return `Grid dimensions: ${dimensions}. Total combinations: ${total}. Valid combinations: ${valid}. Filtered by constraints: ${filtered}. Constraints: ${constraints}.${engineLabel}${warning}`;
}

function buildRobustnessSummary(rows) {
  if (!rows || !rows.length) {
    return "Robustness analysis will appear here.";
  }
  const returns = rows
    .map((row) => Number(row.metrics?.return_pct))
    .filter((value) => Number.isFinite(value));
  const sharpes = rows
    .map((row) => Number(row.metrics?.sharpe))
    .filter((value) => Number.isFinite(value));
  const avgReturn = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null;
  const avgSharpe = sharpes.length ? sharpes.reduce((sum, value) => sum + value, 0) / sharpes.length : null;
  return `Top ${rows.length} combinations average ${formatStrategyMetric(avgReturn, "%")} return and ${formatStrategyMetric(avgSharpe)} Sharpe.`;
}

function renderStrategyHeatmap(payload) {
  const axesNode = $("strategy-heatmap-axes");
  const emptyNode = $("strategy-heatmap-empty");
  const gridNode = $("strategy-heatmap-grid");
  if (!axesNode || !emptyNode || !gridNode) return;

  if (!payload || !Array.isArray(payload.heatmap) || payload.heatmap.length === 0) {
    axesNode.textContent = "Waiting for optimization data";
    emptyNode.classList.remove("hidden");
    gridNode.classList.add("hidden");
    gridNode.innerHTML = "";
    return;
  }

  const heatmap = payload.heatmap.filter((item) => item && item.x !== undefined && item.y !== undefined);
  if (!heatmap.length) {
    axesNode.textContent = "Need at least two grid dimensions";
    emptyNode.classList.remove("hidden");
    gridNode.classList.add("hidden");
    gridNode.innerHTML = "";
    return;
  }

  const xValues = [...new Set(heatmap.map((item) => String(item.x)))];
  const yValues = [...new Set(heatmap.map((item) => String(item.y)))];
  const axes = Array.isArray(payload.heatmap_axes) ? payload.heatmap_axes : [];
  const metricValues = heatmap.map((item) => Number(item.value)).filter((value) => Number.isFinite(value));
  const minValue = metricValues.length ? Math.min(...metricValues) : 0;
  const maxValue = metricValues.length ? Math.max(...metricValues) : 1;
  axesNode.textContent = `X: ${axes[0] || "Param 1"} | Y: ${axes[1] || "Param 2"} | Cells: ${heatmap.length}`;

  const lookup = new Map(heatmap.map((item) => [`${item.x}__${item.y}`, item]));
  const header = ['<div class="strategy-heatmap-axis-cell">Y \\ X</div>']
    .concat(xValues.map((value) => `<div class="strategy-heatmap-axis-cell">${value}</div>`))
    .join("");

  const rows = yValues.map((yValue) => {
    const cells = [`<div class="strategy-heatmap-ylabel">${yValue}</div>`];
    xValues.forEach((xValue) => {
      const item = lookup.get(`${xValue}__${yValue}`);
      if (!item || !Number.isFinite(Number(item.value))) {
        cells.push('<div class="strategy-heatmap-cell" style="background: rgba(127,133,150,0.18); color: var(--muted);">--</div>');
        return;
      }
      const intensity = maxValue === minValue ? 0.75 : (Number(item.value) - minValue) / (maxValue - minValue);
      const bg = `rgba(${Math.round(20 + intensity * 21)}, ${Math.round(70 + intensity * 110)}, ${Math.round(120 + intensity * 95)}, 0.88)`;
      cells.push(`
        <div class="strategy-heatmap-cell" style="background:${bg}">
          <span class="strategy-heatmap-value">${formatStrategyMetric(item.value)}</span>
          <span class="strategy-heatmap-subvalue">${xValue}, ${yValue}</span>
        </div>
      `);
    });
    return `<div class="strategy-heatmap-row">${cells.join("")}</div>`;
  });

  gridNode.innerHTML = `<div class="strategy-heatmap-header">${header}</div>${rows.join("")}`;
  emptyNode.classList.add("hidden");
  gridNode.classList.remove("hidden");
}

function getActivePaperSession() {
  return _strategyPaperSessions.find((item) => item.session_id === _strategyActivePaperSessionId) || _strategyPaperSessions[0] || null;
}

function renderPaperSessionState(session) {
  const summary = $("strategy-paper-session-summary");
  const body = $("strategy-live-orders-body");
  if (summary) {
    summary.textContent = session
      ? `Session ${session.session_id} | ${session.status} | Equity ${formatCompactValue(Number(session.equity || 0))} | Cash ${formatCompactValue(Number(session.cash || 0))}`
      : "No active paper session.";
  }
  if (body) {
    const orders = session?.orders || [];
    body.innerHTML = orders.length
      ? orders.slice().reverse().map((order) => `
        <tr>
          <td>${order.time || "--"}</td>
          <td>${order.side || "--"}</td>
          <td>${order.qty || "--"}</td>
          <td>${order.price || "--"}</td>
          <td>${order.status || "--"}</td>
        </tr>
      `).join("")
      : '<tr><td colspan="5" class="strategy-empty-cell">No live or paper orders yet.</td></tr>';
  }
  updatePortfolioSummary(session);
}

async function startPaperSession() {
  const payload = await window.strategyStorageApi.startPaperSession({
    symbol: currentSymbol,
  });
  const session = payload.session || null;
  if (session) {
    _strategyActivePaperSessionId = session.session_id;
  }
  await refreshPaperSessions();
  _appendStrategyLog(`Started paper session ${session?.session_id || "--"}.`);
  switchStrategyEditorTab("live");
}

async function stopPaperSession() {
  const session = getActivePaperSession();
  if (!session) {
    throw new Error("No active paper session to stop.");
  }
  await window.strategyStorageApi.stopPaperSession(session.session_id);
  await refreshPaperSessions();
  _appendStrategyLog(`Stopped paper session ${session.session_id}.`);
}

async function placePaperOrder() {
  const session = getActivePaperSession();
  if (!session) {
    throw new Error("Start a paper session first.");
  }
  const side = $("strategy-paper-side")?.value || "BUY";
  const qty = Number($("strategy-paper-qty")?.value || 0);
  const fallbackPrice = Number(_strategyLatestRunContext?.last_price || 0);
  const price = Number($("strategy-paper-price")?.value || fallbackPrice);
  const payload = await window.strategyStorageApi.placePaperOrder({
    session_id: session.session_id,
    side,
    qty,
    price,
  });
  const updated = payload.session || null;
  if (updated) {
    _strategyActivePaperSessionId = updated.session_id;
  }
  await refreshPaperSessions();
  _appendStrategyLog(`Paper order filled: ${side} ${qty} @ ${price}.`);
}
