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
let _strategyPrimaryTab = "backtest";
let _strategyLatestOptimizationPayload = null;
let _strategySelectedOptimizationRun = null;
let _strategySavedOptimizations = [];
let _strategyRecentOptimizations = [];
let _strategyWalkforwardChart = null;
let _strategySelectedRunEquityChart = null;
let _strategyBacktestAbortController = null;
let _strategyActiveOptimizationId = null;
let _strategyStoppedOptimizationIds = new Set();
const STRATEGY_SIDEBAR_COLLAPSED_KEY = "strategy_lab_sidebar_collapsed";
const STRATEGY_OPTIMIZATIONS_STORAGE_KEY = "strategy_lab_saved_optimizations_v1";
const STRATEGY_RECENT_OPTIMIZATIONS_STORAGE_KEY = "strategy_lab_recent_optimizations_v1";
const STRATEGY_OPT_LEFT_WIDTH_KEY = "strategy_lab_opt_left_width";
const STRATEGY_OPT_RIGHT_WIDTH_KEY = "strategy_lab_opt_right_width";
const STRATEGY_SUPPORTED_OPT_METHODS = new Set(["grid", "random", "bayesian"]);
const STRATEGY_SUPPORTED_OBJECTIVES = new Set(["return_pct", "sharpe", "sortino", "profit_factor", "max_drawdown", "calmar", "custom"]);
const STRATEGY_BASE_METRICS = [
  "CAGR", "Return %", "Max DD", "Sharpe", "Sortino", "Win Rate",
  "Profit Factor", "Total Trades", "Ending Equity", "Avg Trade", "Best Trade", "Worst Trade",
  "Calmar Ratio", "Recovery Factor", "Omega Ratio", "Avg Bars Held", "Max Consecutive Wins",
  "Max Consecutive Losses", "Long Win Rate", "Short Win Rate", "Commission Paid",
  "Slippage Cost", "Gross Profit", "Gross Loss", "Buy and Hold Return", "Alpha vs Benchmark",
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
  initOptimizerLeftResize();
  if (typeof initStrategyEditor === "function") {
    initStrategyEditor().catch((error) => console.error(error));
  }
  loadOptimizationSessionLists();
  resetStrategyForm();
  renderOptimizationParameterRows(parseOptimizationGridSafe());
  updateOptimizationExecutionHints();
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
  if ($("strategy-opt-end-date")) $("strategy-opt-end-date").value = today.toISOString().split("T")[0];
  if ($("strategy-opt-start-date")) $("strategy-opt-start-date").value = oneYearAgo.toISOString().split("T")[0];
}

function updateOptimizationExecutionHints() {
  const method = document.querySelector('input[name="strategy-opt-method"]:checked')?.value || "grid";
  const maxRuns = $("strategy-opt-max-runs");
  if (maxRuns) {
    maxRuns.disabled = method === "grid";
    maxRuns.title = method === "grid"
      ? "Grid search evaluates every valid combination, so max runs is ignored."
      : "Passed to backtesting.py as max_tries.";
  }
}

function _bindStrategyLabEvents() {
  document.querySelectorAll("[data-strategy-primary-tab]").forEach((button) => {
    button.addEventListener("click", () => switchStrategyPrimaryTab(button.dataset.strategyPrimaryTab));
  });

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
      if (_strategyPrimaryTab === "optimize") {
        renderOptimizeSidebar();
      } else {
        refreshBacktestHistory().catch((error) => _appendStrategyLog(`Backtest refresh failed: ${error.message}`));
      }
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
      sendBacktestToOptimizer();
    });
  }

  if ($("strategy-run-optimization-btn")) {
    $("strategy-run-optimization-btn").addEventListener("click", () => {
      runStrategyOptimization().catch((error) => {
        console.error(error);
        setStrategyRunStatus("Optimization Failed");
        setOptimizeRunStatus("Optimization Failed");
        _appendStrategyLog(`Optimization failed: ${error.message}`);
      });
    });
  }

  if ($("strategy-stop-optimization-btn")) {
    $("strategy-stop-optimization-btn").addEventListener("click", stopActiveOptimization);
  }

  if ($("strategy-toggle-detail-panel-btn")) {
    $("strategy-toggle-detail-panel-btn").addEventListener("click", toggleOptimizationDetailPanel);
  }

  document.querySelectorAll("[data-opt-section]").forEach((button) => {
    button.addEventListener("click", () => activateOptimizationSection(button.dataset.optSection));
  });

  document.querySelectorAll('input[name="strategy-opt-method"]').forEach((input) => {
    input.addEventListener("change", updateOptimizationExecutionHints);
  });

  if ($("strategy-opt-load-backtest-btn")) {
    $("strategy-opt-load-backtest-btn").addEventListener("click", () => sendBacktestToOptimizer(false));
  }

  if ($("strategy-opt-strategy-select")) {
    $("strategy-opt-strategy-select").addEventListener("change", () => {
      const strategyId = $("strategy-opt-strategy-select").value;
      if (strategyId) {
        loadStrategyForOptimizer(strategyId).catch((error) => _appendStrategyLog(`Optimizer load failed: ${error.message}`));
      }
    });
  }

  if ($("strategy-save-optimization-btn")) {
    $("strategy-save-optimization-btn").addEventListener("click", () => saveOptimizationSession());
  }

  if ($("strategy-export-optimization-csv-btn")) {
    $("strategy-export-optimization-csv-btn").addEventListener("click", () => exportOptimizationCsv());
  }

  if ($("strategy-optimization-sort")) {
    $("strategy-optimization-sort").addEventListener("change", () => {
      if (_strategyLatestOptimizationPayload) renderStrategyOptimizationResults(_strategyLatestOptimizationPayload);
    });
  }

  ["strategy-heatmap-x-axis", "strategy-heatmap-y-axis"].forEach((id) => {
    if ($(id)) {
      $(id).addEventListener("change", () => {
        if (_strategyLatestOptimizationPayload) renderStrategyHeatmap(_strategyLatestOptimizationPayload);
      });
    }
  });

  if ($("strategy-opt-sync-params-btn")) {
    $("strategy-opt-sync-params-btn").addEventListener("click", () => {
      renderOptimizationParameterRows(parseOptimizationGridSafe());
    });
  }

  if ($("strategy-run-btn")) {
    $("strategy-run-btn").addEventListener("click", async () => {
      try {
        stopBacktestRun(false);
        _strategyBacktestAbortController = new AbortController();
        setBacktestRunningState(true);
        setStrategyRunStatus("Running...");
        const response = await fetch("/api/backtest/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: _strategyBacktestAbortController.signal,
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
        if (error.name === "AbortError") {
          setStrategyRunStatus("Stopped");
          _appendStrategyLog("Backtest stopped by user.");
        } else {
          setStrategyRunStatus("Run Failed");
          _appendStrategyLog(`Backtest run failed: ${error.message}`);
        }
      } finally {
        _strategyBacktestAbortController = null;
        setBacktestRunningState(false);
      }
    });
  }

  if ($("strategy-stop-backtest-btn")) {
    $("strategy-stop-backtest-btn").addEventListener("click", () => stopBacktestRun(true));
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

function switchStrategyPrimaryTab(tabId) {
  _strategyPrimaryTab = tabId === "optimize" ? "optimize" : "backtest";
  document.querySelectorAll("[data-strategy-primary-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.strategyPrimaryTab === _strategyPrimaryTab);
  });
  $("strategy-backtest-tab-pane")?.classList.toggle("hidden", _strategyPrimaryTab !== "backtest");
  $("strategy-optimize-tab-pane")?.classList.toggle("hidden", _strategyPrimaryTab !== "optimize");
  document.querySelector(".strategy-lab")?.classList.toggle("optimize-active", _strategyPrimaryTab === "optimize");
  renderOptimizeSidebar();
  if (_strategyPrimaryTab === "optimize") {
    renderOptimizeStrategySelector(_strategyListCache);
    refreshStrategyList().catch((error) => _appendStrategyLog(`Strategy refresh failed: ${error.message}`));
    renderStrategyOptimizationCharts(_strategyLatestOptimizationPayload);
  }
  window.dispatchEvent(new Event("resize"));
}

function switchStrategyResultsTab(tabId) {
  _strategyResultsTab = tabId;
  document.querySelectorAll("[data-results-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.resultsTab === tabId);
  });
  ["metrics", "trades", "equity", "drawdown", "compare"].forEach((paneId) => {
    $(`strategy-results-${paneId}`)?.classList.toggle("hidden", paneId !== tabId);
  });
}

function syncStrategyLabSymbol() {
  const label = $("strategy-current-symbol");
  if (label) label.textContent = currentSymbol || "NSE:RELIANCE";
  if ($("strategy-opt-symbol")) $("strategy-opt-symbol").value = currentSymbol || "NSE:RELIANCE";
  updateOptimizerLoadedChip();
}

function setStrategyRunStatus(text) {
  const node = $("strategy-run-status");
  if (node) node.textContent = text;
}

function setOptimizeRunStatus(text) {
  const node = $("strategy-opt-run-status");
  if (node) node.textContent = text;
}

function setBacktestRunningState(isRunning) {
  $("strategy-run-btn")?.classList.toggle("hidden", isRunning);
  $("strategy-stop-backtest-btn")?.classList.toggle("hidden", !isRunning);
}

function stopBacktestRun(showToastMessage = true) {
  if (!_strategyBacktestAbortController) return;
  _strategyBacktestAbortController.abort();
  _strategyBacktestAbortController = null;
  setBacktestRunningState(false);
  setStrategyRunStatus("Stopping...");
  if (showToastMessage) showStrategyToast("Backtest stop requested");
}

function setOptimizationRunningState(isRunning) {
  const runButton = $("strategy-run-optimization-btn");
  if (runButton) runButton.textContent = isRunning ? "Rerun optimization" : "Run optimization";
  $("strategy-stop-optimization-btn")?.classList.toggle("hidden", !isRunning);
}

function stopActiveOptimization() {
  if (_strategyActiveOptimizationId) {
    _strategyStoppedOptimizationIds.add(_strategyActiveOptimizationId);
    _appendStrategyLog(`Optimization stopped locally: ${_strategyActiveOptimizationId}`);
  }
  stopOptimizationPolling();
  _strategyActiveOptimizationId = null;
  setStrategyRunStatus("Optimization Stopped");
  setOptimizeRunStatus("Stopped");
  setOptimizationRunningState(false);
  showStrategyToast("Optimization stopped");
}

function toggleOptimizationDetailPanel() {
  const app = document.querySelector(".strategy-opt-app");
  if (!app) return;
  const expanded = app.classList.toggle("detail-expanded");
  const button = $("strategy-toggle-detail-panel-btn");
  if (button) button.textContent = expanded ? "Collapse detail" : "Expand detail";
  window.dispatchEvent(new Event("resize"));
  if (_strategySelectedOptimizationRun) renderSelectedOptimizationRun(_strategySelectedOptimizationRun);
}

function activateOptimizationSection(section) {
  const target = section || "setup";
  document.querySelectorAll("[data-opt-section]").forEach((button) => {
    button.classList.toggle("active", button.dataset.optSection === target);
  });
  if (target === "setup") {
    document.querySelector(".strategy-opt-left")?.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (target === "compare" && !document.querySelector(".strategy-opt-app")?.classList.contains("detail-expanded")) {
    toggleOptimizationDetailPanel();
  }
  const anchor = document.querySelector(`[data-opt-anchor="${target}"]`)
    || (target === "compare" ? document.querySelector(".strategy-run-detail-panel") : null);
  if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
}

function initOptimizerLeftResize() {
  const handle = document.querySelector(".strategy-opt-left-resize");
  const body = document.querySelector(".strategy-opt-body");
  const rightHandle = document.querySelector(".strategy-opt-right-resize");
  if (!body) return;

  const savedWidth = Number(window.localStorage.getItem(STRATEGY_OPT_LEFT_WIDTH_KEY));
  if (Number.isFinite(savedWidth) && savedWidth > 0) {
    document.documentElement.style.setProperty("--strategy-opt-left-width", `${Math.min(420, Math.max(190, savedWidth))}px`);
  }
  const savedRightWidth = Number(window.localStorage.getItem(STRATEGY_OPT_RIGHT_WIDTH_KEY));
  if (Number.isFinite(savedRightWidth) && savedRightWidth > 0) {
    document.documentElement.style.setProperty("--strategy-opt-right-width", `${Math.min(620, Math.max(280, savedRightWidth))}px`);
  }

  if (handle) handle.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    handle.classList.add("dragging");
    const onMove = (moveEvent) => {
      const rect = body.getBoundingClientRect();
      const next = Math.min(420, Math.max(190, moveEvent.clientX - rect.left));
      document.documentElement.style.setProperty("--strategy-opt-left-width", `${Math.round(next)}px`);
      window.localStorage.setItem(STRATEGY_OPT_LEFT_WIDTH_KEY, String(Math.round(next)));
      window.dispatchEvent(new Event("resize"));
    };
    const onUp = () => {
      handle.classList.remove("dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.dispatchEvent(new Event("resize"));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    onMove(event);
  });

  if (rightHandle) rightHandle.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    rightHandle.classList.add("dragging");
    const onMove = (moveEvent) => {
      const rect = body.getBoundingClientRect();
      const next = Math.min(620, Math.max(280, rect.right - moveEvent.clientX));
      document.documentElement.style.setProperty("--strategy-opt-right-width", `${Math.round(next)}px`);
      window.localStorage.setItem(STRATEGY_OPT_RIGHT_WIDTH_KEY, String(Math.round(next)));
      window.dispatchEvent(new Event("resize"));
    };
    const onUp = () => {
      rightHandle.classList.remove("dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.dispatchEvent(new Event("resize"));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    onMove(event);
  });
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
  syncOptimizerSettingsFromBacktest();
  prefillOptimizerRangesFromCode(starter.code);
  updateOptimizerLoadedChip();
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
  renderOptimizeStrategySelector(items);
  renderOptimizeSidebar();
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
  renderOptimizeSidebar();
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

function renderOptimizeStrategySelector(items = _strategyListCache) {
  const select = $("strategy-opt-strategy-select");
  if (!select) return;
  const current = select.value || _strategySelectedId || "";
  select.innerHTML = '<option value="">Current Backtest draft</option>' + items.map((item) => (
    `<option value="${escapeStrategyHtml(item.id)}">${escapeStrategyHtml(item.name || "Untitled Strategy")}</option>`
  )).join("");
  if (current && items.some((item) => item.id === current)) {
    select.value = current;
  }
}

function renderOptimizeSidebar() {
  renderInPageOptimizationSessions();
  const savedLabel = $("strategy-sidebar-backtest-count")?.previousElementSibling;
  if (savedLabel) savedLabel.textContent = _strategyPrimaryTab === "optimize" ? "Runs" : "Backtests";
  const scannerTitle = document.querySelector("#strategy-scanner-summary")?.closest(".strategy-sidebar-section")?.querySelector(".strategy-section-title");
  const backtestsTitle = $("strategy-backtests-list")?.closest(".strategy-sidebar-section")?.querySelector(".strategy-section-title");
  const backtestsEmpty = $("strategy-backtests-empty");
  if (_strategyPrimaryTab !== "optimize") {
    if (scannerTitle) scannerTitle.textContent = "Scanner";
    const savedTitle = $("strategy-list")?.closest(".strategy-sidebar-section")?.querySelector(".strategy-section-title");
    if (savedTitle) savedTitle.textContent = "Saved Strategies";
    if (backtestsTitle) backtestsTitle.textContent = "Recent Backtests";
    renderStrategyList(_strategyListCache);
    renderBacktestHistory(_strategyBacktestListCache);
    updateScannerSummary();
    return;
  }

  if (scannerTitle) scannerTitle.textContent = "Strategy Selector";
  const scanner = $("strategy-scanner-summary");
  if (scanner) {
    scanner.innerHTML = `
      <div class="strategy-form-field strategy-sidebar-select-field">
        <select id="strategy-opt-sidebar-select">
          <option value="">Current Backtest draft</option>
          ${_strategyListCache.map((item) => `<option value="${escapeStrategyHtml(item.id)}">${escapeStrategyHtml(item.name || "Untitled Strategy")}</option>`).join("")}
        </select>
      </div>
      <div class="strategy-loaded-mini-chip">${escapeStrategyHtml(buildOptimizerStrategyChip())}</div>
    `;
    const sidebarSelect = $("strategy-opt-sidebar-select");
    if (sidebarSelect) {
      sidebarSelect.value = $("strategy-opt-strategy-select")?.value || "";
      sidebarSelect.addEventListener("change", () => {
        if ($("strategy-opt-strategy-select")) $("strategy-opt-strategy-select").value = sidebarSelect.value;
        if (sidebarSelect.value) loadStrategyForOptimizer(sidebarSelect.value).catch((error) => _appendStrategyLog(error.message));
      });
    }
  }
  renderSavedOptimizationsList();
  if (backtestsTitle) backtestsTitle.textContent = "Recent Runs";
  if (backtestsEmpty) backtestsEmpty.classList.toggle("hidden", _strategyRecentOptimizations.length > 0);
  const recentList = $("strategy-backtests-list");
  if (recentList) {
    recentList.innerHTML = _strategyRecentOptimizations.length
      ? _strategyRecentOptimizations.slice(0, 6).map((item, index) => `
        <div class="strategy-list-item" data-optimization-index="${index}">
          <h4>${escapeStrategyHtml(item.name || "Optimization Run")}</h4>
          <div class="strategy-list-meta">${escapeStrategyHtml(item.method || "Bayesian")} | ${item.runs || 0} runs | ${formatStrategyMetric(item.bestReturn, "%")}</div>
          <div class="strategy-list-desc">${escapeStrategyHtml(item.createdAt || "Just now")}</div>
        </div>
      `).join("")
      : '<div class="strategy-empty-state">No recent optimization runs yet.</div>';
    recentList.querySelectorAll("[data-optimization-index]").forEach((node) => {
      node.addEventListener("click", () => loadOptimizationSession(_strategyRecentOptimizations[Number(node.dataset.optimizationIndex)]));
    });
  }
}

function renderInPageOptimizationSessions() {
  renderOptimizationSessionList("strategy-opt-saved-sessions", _strategySavedOptimizations, "No saved results yet.");
  renderOptimizationSessionList("strategy-opt-recent-sessions", _strategyRecentOptimizations.slice(0, 6), "No recent runs yet.");
}

function renderOptimizationSessionList(elementId, items, emptyText) {
  const node = $(elementId);
  if (!node) return;
  node.innerHTML = items.length
    ? items.map((item, index) => `
      <button type="button" class="strategy-opt-session-item" data-session-index="${index}">
        <strong>${escapeStrategyHtml(item.name || item.strategyName || "Optimization")}</strong>
        <span>${escapeStrategyHtml(item.method || "Method")} | ${item.runs || 0} runs | ${formatStrategyMetric(item.bestReturn, "%")}</span>
      </button>
    `).join("")
    : `<div class="strategy-empty-state">${escapeStrategyHtml(emptyText)}</div>`;
  node.querySelectorAll("[data-session-index]").forEach((button) => {
    button.addEventListener("click", () => loadOptimizationSession(items[Number(button.dataset.sessionIndex)]));
  });
}

function renderSavedOptimizationsList() {
  const title = $("strategy-list")?.closest(".strategy-sidebar-section")?.querySelector(".strategy-section-title");
  const empty = $("strategy-list-empty");
  const list = $("strategy-list");
  if (title) title.textContent = "Saved Optimizations";
  if (!list || !empty) return;
  empty.classList.toggle("hidden", _strategySavedOptimizations.length > 0);
  list.innerHTML = _strategySavedOptimizations.length
    ? _strategySavedOptimizations.map((item, index) => `
      <div class="strategy-list-item" data-saved-optimization-index="${index}">
        <div class="strategy-list-item-head">
          <div style="flex:1">
            <h4>${escapeStrategyHtml(item.strategyName || item.name || "Optimization")}</h4>
            <div class="strategy-list-meta">${escapeStrategyHtml(item.method || "Bayesian")} | ${item.runs || 0} runs</div>
          </div>
          <button type="button" class="secondary-button strategy-load-optimization-btn">Load</button>
        </div>
        <div class="strategy-list-desc">Best return ${formatStrategyMetric(item.bestReturn, "%")} | ${escapeStrategyHtml(item.createdAt || "Saved")}</div>
      </div>
    `).join("")
    : '<div class="strategy-empty-state">No saved optimizations yet.</div>';
  list.querySelectorAll("[data-saved-optimization-index]").forEach((node) => {
    node.addEventListener("click", () => loadOptimizationSession(_strategySavedOptimizations[Number(node.dataset.savedOptimizationIndex)]));
  });
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
  if (backtestNode) backtestNode.textContent = String(_strategyPrimaryTab === "optimize" ? _strategyRecentOptimizations.length : _strategyBacktestListCache.length);
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

async function loadStrategyForOptimizer(strategyId) {
  const payload = await window.strategyStorageApi.loadStrategy(strategyId);
  const item = payload.item || {};
  if ($("strategy-opt-strategy-select")) $("strategy-opt-strategy-select").value = item.id || "";
  if ($("strategy-name")) $("strategy-name").value = item.name || "";
  if ($("strategy-tags")) $("strategy-tags").value = (item.tags || []).join(", ");
  if ($("strategy-description")) $("strategy-description").value = item.description || "";
  if ($("strategy-params-json")) $("strategy-params-json").value = JSON.stringify(item.parameter_schema || {}, null, 2);
  if (typeof setStrategyCode === "function") setStrategyCode(item.code || getDefaultStrategyTemplate());
  prefillOptimizerRangesFromCode(item.code || "");
  updateOptimizerLoadedChip(item);
  renderOptimizeSidebar();
  showStrategyToast("Strategy loaded into Optimizer");
}

function updateOptimizerLoadedChip(strategy = null) {
  const chip = $("strategy-opt-loaded-chip");
  if (chip) chip.textContent = buildOptimizerStrategyChip(strategy);
}

function buildOptimizerStrategyChip(strategy = null) {
  const params = extractNumericAssignments(getStrategyCode());
  const shorthand = Object.entries(params).slice(0, 4).map(([key, value]) => `${key.replace(/_length$/, "")}=${value}`).join(" - ");
  const symbol = $("strategy-opt-symbol")?.value || currentSymbol || "NSE:RELIANCE";
  const name = strategy?.name || $("strategy-name")?.value || "Current Draft";
  return [symbol, name, shorthand].filter(Boolean).join(" - ");
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
    ["Calmar Ratio", metrics?.calmar_ratio ?? metrics?.calmar, "number"],
    ["Recovery Factor", metrics?.recovery_factor, "number"],
    ["Omega Ratio", metrics?.omega_ratio ?? metrics?.omega, "number"],
    ["Avg Bars Held", metrics?.avg_bars_held, "number"],
    ["Max Consecutive Wins", metrics?.max_consecutive_wins, "count"],
    ["Max Consecutive Losses", metrics?.max_consecutive_losses, "count"],
    ["Long Win Rate", metrics?.long_win_rate, "%"],
    ["Short Win Rate", metrics?.short_win_rate, "%"],
    ["Commission Paid", metrics?.commission_paid, "currency"],
    ["Slippage Cost", metrics?.slippage_cost, "currency"],
    ["Gross Profit", metrics?.gross_profit, "currency"],
    ["Gross Loss", metrics?.gross_loss, "currency"],
    ["Buy and Hold Return", metrics?.buy_hold_return ?? metrics?.buy_and_hold_return, "%"],
    ["Alpha vs Benchmark", metrics?.alpha_vs_benchmark ?? metrics?.alpha, "%"],
  ];
  if (metrics) {
    Object.entries(metrics).forEach(([key, value]) => {
      if (["cagr", "return_pct", "max_drawdown", "sharpe", "sortino", "win_rate", "profit_factor", "total_trades", "ending_equity", "avg_trade", "best_trade", "worst_trade", "calmar_ratio", "calmar", "recovery_factor", "omega_ratio", "omega", "avg_bars_held", "max_consecutive_wins", "max_consecutive_losses", "long_win_rate", "short_win_rate", "commission_paid", "slippage_cost", "gross_profit", "gross_loss", "buy_hold_return", "buy_and_hold_return", "alpha_vs_benchmark", "alpha"].includes(key)) {
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
    body.innerHTML = '<tr><td colspan="10" class="strategy-empty-cell">Run a backtest to populate trades.</td></tr>';
    return;
  }

  body.innerHTML = "";
  trades.forEach((trade, index) => {
    const row = document.createElement("tr");
    const side = trade.side || (Number(trade.Size || trade.size || 0) < 0 ? "Short" : "Long");
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${side}</td>
      <td>${trade.entry_date || trade.entry_time || trade.date || trade.EntryTime || "--"}</td>
      <td>${trade.entry_price || trade.entry || trade.EntryPrice || "--"}</td>
      <td>${trade.exit_date || trade.exit_time || trade.ExitTime || "--"}</td>
      <td>${trade.exit_price || trade.exit || trade.ExitPrice || "--"}</td>
      <td>${trade.size || trade.qty || trade.Size || "--"}</td>
      <td>${trade.pnl || trade.PnL || "--"}</td>
      <td>${trade.pnl_pct || trade.ReturnPct || "--"}</td>
      <td>${trade.bars_held || trade.Bars || "--"}</td>
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
  if (_strategyActiveOptimizationId || _strategyOptimizationPollTimer) {
    stopActiveOptimization();
  }
  setStrategyRunStatus("Optimizing...");
  setOptimizeRunStatus("Optimizing...");
  setOptimizationRunningState(true);
  const response = await fetch("/api/backtest/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol: $("strategy-opt-symbol")?.value || currentSymbol,
      timeframe: $("strategy-opt-timeframe")?.value || $("strategy-timeframe")?.value || "1D",
      start_date: $("strategy-opt-start-date")?.value || $("strategy-start-date")?.value || "",
      end_date: $("strategy-opt-end-date")?.value || $("strategy-end-date")?.value || "",
      strategy_code: getStrategyCode(),
      parameter_grid: parseOptimizationGrid(),
      objective: getOptimizationObjective(),
      initial_cash: getOptimizerInitialCash(),
      commission: getOptimizerCommission(),
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
  _strategyActiveOptimizationId = optimizationId;
  _strategyStoppedOptimizationIds.delete(optimizationId);
  startOptimizationPolling(optimizationId);
  switchStrategyPrimaryTab("optimize");
}

function getOptimizationObjective() {
  const selected = document.querySelector('input[name="strategy-opt-objective-radio"]:checked')?.value
    || $("strategy-opt-objective")?.value
    || "sharpe";
  return STRATEGY_SUPPORTED_OBJECTIVES.has(selected) ? selected : "sharpe";
}

function getOptimizerInitialCash() {
  const value = Number($("strategy-opt-initial-cash")?.value || $("strategy-initial-cash")?.value || 100000);
  return Number.isFinite(value) && value > 0 ? value : 100000;
}

function getOptimizerCommission() {
  const value = Number($("strategy-opt-commission")?.value || $("strategy-commission")?.value || 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function sendBacktestToOptimizer(showToastMessage = true) {
  syncOptimizerSettingsFromBacktest();
  prefillOptimizerRangesFromCode(getStrategyCode());
  updateOptimizerLoadedChip();
  switchStrategyPrimaryTab("optimize");
  if (showToastMessage) showStrategyToast("Strategy loaded into Optimizer");
}

function syncOptimizerSettingsFromBacktest() {
  if ($("strategy-opt-symbol")) $("strategy-opt-symbol").value = currentSymbol || "NSE:RELIANCE";
  if ($("strategy-opt-timeframe")) $("strategy-opt-timeframe").value = $("strategy-timeframe")?.value || "1D";
  if ($("strategy-opt-start-date")) $("strategy-opt-start-date").value = $("strategy-start-date")?.value || "";
  if ($("strategy-opt-end-date")) $("strategy-opt-end-date").value = $("strategy-end-date")?.value || "";
  if ($("strategy-opt-initial-cash")) $("strategy-opt-initial-cash").value = $("strategy-initial-cash")?.value || "100000";
  if ($("strategy-opt-commission")) $("strategy-opt-commission").value = $("strategy-commission")?.value || "0";
}

function prefillOptimizerRangesFromCode(code) {
  const assignments = extractNumericAssignments(code);
  const grid = {};
  Object.entries(assignments).forEach(([name, value]) => {
    const isInt = Number.isInteger(value);
    grid[name] = {
      start: normalizeRangeNumber(value / 2, isInt),
      end: normalizeRangeNumber(value * 3, isInt),
      step: isInt ? 1 : 0.5,
    };
  });
  if (!Object.keys(grid).length) {
    Object.assign(grid, parseOptimizationGridSafe());
  }
  if ($("strategy-opt-grid-json")) $("strategy-opt-grid-json").value = JSON.stringify(grid, null, 2);
  renderOptimizationParameterRows(grid);
}

function extractNumericAssignments(code) {
  const assignments = {};
  String(code || "").split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*(?:#.*)?$/);
    if (!match) return;
    if (["return", "if", "for", "while", "with"].includes(match[1])) return;
    const value = Number(match[2]);
    if (Number.isFinite(value)) assignments[match[1]] = value;
  });
  return assignments;
}

function normalizeRangeNumber(value, isInt) {
  return isInt ? Math.max(1, Math.round(value)) : Number(value.toFixed(2));
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
  const selectedMethod = document.querySelector('input[name="strategy-opt-method"]:checked')?.value || "grid";
  const method = STRATEGY_SUPPORTED_OPT_METHODS.has(selectedMethod) ? selectedMethod : "grid";
  const maxRuns = Number($("strategy-opt-max-runs")?.value || 0) || null;
  return {
    method,
    max_runs: method === "grid" ? null : maxRuns,
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
  const currentParams = extractNumericAssignments(getStrategyCode());
  const rows = entries.map(([name, spec]) => {
    const normalized = normalizeOptimizationSpec(spec);
    return `
      <div class="strategy-opt-param-row" data-param-name="${escapeStrategyHtml(name)}">
        <label title="${escapeStrategyHtml(name)}"><input type="checkbox" class="strategy-opt-param-enabled" checked /> <span>${escapeStrategyHtml(name)}</span></label>
        <span class="strategy-opt-current-value">${escapeStrategyHtml(currentParams[name] ?? "--")}</span>
        <input class="strategy-opt-param-min" type="number" step="any" value="${escapeStrategyHtml(normalized.start)}" title="Minimum" />
        <input class="strategy-opt-param-max" type="number" step="any" value="${escapeStrategyHtml(normalized.end)}" title="Maximum" />
        <input class="strategy-opt-param-step" type="number" step="any" value="${escapeStrategyHtml(normalized.step)}" title="Step" />
      </div>
    `;
  }).join("");
  wrap.innerHTML = `
    <div class="strategy-opt-param-row strategy-opt-param-head" aria-hidden="true">
      <span>Parameter</span><span>Current</span><span>Min</span><span>Max</span><span>Step</span>
    </div>
    ${rows}
  `;
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
    _strategyLatestOptimizationPayload = null;
    _strategySelectedOptimizationRun = null;
    summary.textContent = "Optimization results will appear here.";
    body.innerHTML = '<tr><td colspan="10" class="strategy-empty-cell">No optimization run yet.</td></tr>';
    robustnessSummary.textContent = "Robustness analysis will appear here.";
    robustnessBody.innerHTML = '<tr><td colspan="3" class="strategy-empty-cell">No sensitivity rows yet.</td></tr>';
    if (diagnosticsNode) {
      diagnosticsNode.classList.add("hidden");
      diagnosticsNode.textContent = "";
    }
    renderStrategyHeatmap(null);
    renderStrategyOptimizationCharts(null);
    renderWalkforwardAndOverfit(null);
    renderSelectedOptimizationRun(null);
    renderPinnedOptimizationRuns();
    return;
  }

  _strategyLatestOptimizationPayload = payload;
  summary.textContent = `Best Params: ${JSON.stringify(payload.best_params || {})} | Best Metrics: Return ${formatStrategyMetric(payload.best_metrics?.return_pct, "%")}, Sharpe ${formatStrategyMetric(payload.best_metrics?.sharpe)}`;
  if (diagnosticsNode) {
    diagnosticsNode.classList.remove("hidden");
    diagnosticsNode.textContent = buildOptimizationDiagnosticsText(payload.diagnostics || {}, payload.engine || {});
  }
  const rows = sortOptimizationRows(payload.leaderboard || []);
  body.innerHTML = rows.map((row, index) => `
    <tr data-optimization-row="${index}">
      <td>${formatOptimizationRank(index)}</td>
      <td><button type="button" class="strategy-pin-run-btn" data-run-index="${index}">${_strategyOptimizationPinnedRuns.has(String(index)) ? "★" : "☆"}</button></td>
      <td>${escapeStrategyHtml(JSON.stringify(row.params || {}))}</td>
      <td class="${metricToneClass(row.metrics?.return_pct)}">${formatStrategyMetric(row.metrics?.return_pct, "%")}</td>
      <td>${formatStrategyMetric(row.metrics?.sharpe)}</td>
      <td>${formatStrategyMetric(row.metrics?.profit_factor)}</td>
      <td class="${drawdownToneClass(row.metrics?.max_drawdown)}">${formatStrategyMetric(row.metrics?.max_drawdown, "%")}</td>
      <td class="${metricToneClass(row.metrics?.win_rate)}">${formatStrategyMetric(row.metrics?.win_rate, "%")}</td>
      <td>${formatStrategyMetric(row.metrics?.total_trades, "count")}</td>
      <td><span class="strategy-overfit-badge ${getOverfitLevel(row).toLowerCase()}">${getOverfitLevel(row)}</span></td>
    </tr>
  `).join("") || '<tr><td colspan="10" class="strategy-empty-cell">No optimization rows returned.</td></tr>';
  body.querySelectorAll(".strategy-pin-run-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const index = button.dataset.runIndex;
      const run = rows[Number(index)];
      if (!run) return;
      togglePinnedOptimizationRun(index, run);
      renderStrategyOptimizationResults(payload);
    });
  });
  body.querySelectorAll("[data-optimization-row]").forEach((rowNode) => {
    rowNode.addEventListener("click", () => {
      const index = Number(rowNode.dataset.optimizationRow);
      selectOptimizationRun(index, rows[index]);
    });
  });
  if (rows.length && !_strategySelectedOptimizationRun) {
    selectOptimizationRun(0, rows[0], false);
  }

  const robustnessRows = payload.sensitivity || [];
  robustnessSummary.textContent = robustnessRows.length
    ? "Parameter impact on the selected objective. Longer bars mean the objective changed more across that parameter range."
    : buildRobustnessSummary(payload.robustness_zone || []);
  robustnessBody.innerHTML = robustnessRows.map((row, index) => `
    <tr>
      <td>${escapeStrategyHtml(row.parameter || "--")}</td>
      <td>${formatStrategyMetric(row.importance_pct, "%")}</td>
      <td><div class="strategy-sensitivity-bar color-${index % 6}"><span style="width:${Math.max(8, Math.min(100, Number(row.importance_pct || 0)))}%"></span></div></td>
    </tr>
  `).join("") || '<tr><td colspan="3" class="strategy-empty-cell">No sensitivity rows yet.</td></tr>';

  renderStrategyHeatmap(payload);
  renderStrategyOptimizationCharts(payload);
  renderWalkforwardAndOverfit(payload);
  renderPinnedOptimizationRuns();
}

function sortOptimizationRows(rows) {
  const key = $("strategy-optimization-sort")?.value || "return_pct";
  return [...rows].sort((a, b) => {
    const av = Number(a.metrics?.[key] ?? 0);
    const bv = Number(b.metrics?.[key] ?? 0);
    return key === "max_drawdown" ? Math.abs(av) - Math.abs(bv) : bv - av;
  });
}

function metricToneClass(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  if (numeric > 0) return "metric-positive";
  if (numeric < 0) return "metric-negative";
  return "metric-neutral";
}

function drawdownToneClass(value) {
  const numeric = Math.abs(Number(value));
  if (!Number.isFinite(numeric)) return "";
  if (numeric <= 10) return "metric-positive";
  if (numeric >= 25) return "metric-negative";
  return "metric-warning";
}

function formatOptimizationRank(index) {
  if (index === 0) return "1";
  if (index === 1) return "2";
  if (index === 2) return "3";
  return String(index + 1);
}

function getOverfitLevel(row) {
  const gap = Math.abs(Number(row.metrics?.in_sample_return ?? row.metrics?.return_pct ?? 0) - Number(row.metrics?.out_of_sample_return ?? row.metrics?.return_pct ?? 0));
  if (gap > 15) return "High";
  if (gap > 8) return "Med";
  return "Low";
}

function selectOptimizationRun(index, run, rerender = true) {
  if (!run) return;
  _strategySelectedOptimizationRun = { index, run };
  if (rerender) {
    document.querySelectorAll("[data-optimization-row]").forEach((node) => {
      node.classList.toggle("active", Number(node.dataset.optimizationRow) === index);
    });
  }
  renderSelectedOptimizationRun({ index, run });
}

function renderStrategyOptimizationCharts(payload) {
  const scatterCanvas = $("strategy-optimization-scatter-chart");
  const scoreCanvas = $("strategy-optimization-score-chart");
  if (_strategyOptimizationScatterChart) _strategyOptimizationScatterChart.destroy();
  if (_strategyOptimizationScoreChart) _strategyOptimizationScoreChart.destroy();
  _strategyOptimizationScatterChart = null;
  _strategyOptimizationScoreChart = null;
  const chartPayload = payload && Array.isArray(payload.leaderboard) && payload.leaderboard.length
    ? payload
    : buildDemoOptimizationPayload();

  const rows = chartPayload.leaderboard;
  if (scatterCanvas) {
    const scatterPoints = rows.map((row, index) => ({
      x: Math.abs(Number(row.metrics?.max_drawdown || 0)),
      y: Number(row.metrics?.return_pct || 0),
      rank: index + 1,
    }));
    const frontier = [...scatterPoints]
      .sort((a, b) => a.x - b.x)
      .filter((point, index, sorted) => point.y >= Math.max(...sorted.slice(0, index + 1).map((p) => p.y)));
    _strategyOptimizationScatterChart = new Chart(scatterCanvas.getContext("2d"), {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "Other runs",
            data: scatterPoints,
            backgroundColor: rows.map((_, index) => index === (_strategySelectedOptimizationRun?.index ?? 0) ? "rgba(41, 98, 255, 0.95)" : "rgba(148, 163, 184, 0.55)"),
            pointRadius: rows.map((_, index) => index === (_strategySelectedOptimizationRun?.index ?? 0) ? 6 : 3),
          },
          {
            type: "line",
            label: "Pareto frontier",
            data: frontier,
            borderColor: "#f59e0b",
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: "Max drawdown %" } },
          y: { title: { display: true, text: "Return %" } },
        },
      },
    });
  }

  if (scoreCanvas) {
    const topRows = rows.slice(0, 5).map((row, index) => ({
      ...row,
      equity_curve: Array.isArray(row.equity_curve) && row.equity_curve.length
        ? row.equity_curve
        : buildSyntheticEquityCurve(row.metrics?.return_pct, index),
    }));
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
            display: true,
            title: {
              display: true,
              text: "Date",
              color: "#64748b",
              font: { size: 10, weight: "bold" },
            },
            grid: {
              color: "rgba(100, 116, 139, 0.18)",
              drawBorder: false,
            },
            ticks: {
              maxTicksLimit: 8,
              color: "#64748b",
              font: { size: 10 },
              callback: function (value) {
                return formatStrategyDateTick(this.getLabelForValue(value));
              },
            },
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
              color: "rgba(100, 116, 139, 0.18)",
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

function buildDemoOptimizationPayload() {
  const returns = [47.3, 43.8, 41.2, 38.9, 35.4, 31.7, 28.3, 22.1, 18.6, 14.2];
  return {
    leaderboard: returns.map((ret, index) => ({
      params: { fast: [10, 8, 12, 10, 15, 8, 20, 5, 18, 25][index], slow: [42, 38, 45, 50, 40, 55, 60, 30, 70, 80][index] },
      metrics: {
        return_pct: ret,
        sharpe: [2.14, 1.98, 1.84, 1.76, 1.61, 1.44, 1.32, 1.11, 0.98, 0.82][index],
        profit_factor: [3.41, 3.12, 2.97, 2.78, 2.54, 2.31, 2.18, 1.94, 1.74, 1.52][index],
        max_drawdown: [11.2, 12.8, 13.5, 14.1, 15.7, 16.2, 17.8, 19.4, 21.2, 23.5][index],
        win_rate: [63.4, 61.1, 62.8, 60.2, 58.9, 57.4, 56.1, 54.3, 53.1, 51.8][index],
        total_trades: [142, 168, 121, 108, 134, 99, 87, 201, 76, 64][index],
      },
    })),
  };
}

function buildSyntheticEquityCurve(returnPct = 20, seed = 1) {
  const labels = ["Jan", "Mar", "May", "Jul", "Sep", "Nov", "Jan", "Mar", "May", "Jul", "Sep", "Nov", "Jan", "Mar", "May", "Jun"];
  let equity = 100000;
  let buyHold = 100000;
  return labels.map((label, index) => {
    const drift = Number(returnPct || 0) / 100 / labels.length;
    const wobble = (Math.sin((index + 1) * (seed + 1) * 0.7) * 0.4 + 0.5) * 0.035 - 0.006;
    equity = Math.max(65000, equity * (1 + drift + wobble));
    buyHold = Math.max(65000, buyHold * (1 + 0.28 / labels.length + Math.sin(index * 0.6) * 0.01));
    return { time: label, equity: Math.round(equity), buy_hold: Math.round(buyHold) };
  });
}

function formatStrategyDateTick(value) {
  const text = String(value || "");
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime()) && /\d{4}-\d{1,2}-\d{1,2}|\d{4}\/\d{1,2}\/\d{1,2}/.test(text)) {
    return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return text;
}

function renderSelectedOptimizationRun(selection) {
  const panel = $("strategy-selected-run-detail");
  if (!panel) return;
  if (!selection) {
    panel.className = "strategy-empty-state";
    panel.innerHTML = "Select a run to inspect details.";
    return;
  }
  const { index, run } = selection;
  const metrics = run.metrics || {};
  const paramsText = Object.entries(run.params || {}).map(([key, value]) => `${key}=${value}`).join(" - ");
  const trades = (run.trades || _strategyLatestOptimizationPayload?.trades || []).slice(-8).reverse();
  const app = document.querySelector(".strategy-opt-app");
  const expanded = app?.classList.contains("detail-expanded");
  panel.className = "strategy-run-detail";
  panel.innerHTML = `
    <div class="strategy-run-detail-header">
      <div>
        <div class="strategy-panel-kicker">Run #${index + 1}</div>
        <h3>${index === 0 ? "Best Run" : `Rank ${index + 1}`}</h3>
        <code>${escapeStrategyHtml(paramsText || "--")}</code>
      </div>
      <span class="strategy-rank-badge">Rank ${index + 1}</span>
    </div>
    <div class="strategy-detail-metrics">
      ${[
        ["Net return", formatStrategyMetric(metrics.return_pct, "%")],
        ["Sharpe", formatStrategyMetric(metrics.sharpe)],
        ["Profit factor", formatStrategyMetric(metrics.profit_factor)],
        ["Max DD", formatStrategyMetric(metrics.max_drawdown, "%")],
        ["Win rate", formatStrategyMetric(metrics.win_rate, "%")],
        ["Trades", formatStrategyMetric(metrics.total_trades, "count")],
      ].map(([label, value]) => `<div class="strategy-metric-card"><span class="strategy-metric-label">${label}</span><strong class="strategy-metric-value">${value}</strong></div>`).join("")}
    </div>
    <div class="strategy-mini-equity"><canvas id="strategy-selected-equity-chart"></canvas></div>
    <div class="strategy-table-shell strategy-detail-trades">
      <table class="strategy-results-table">
        <thead><tr><th>Side</th><th>Entry</th><th>Exit</th><th>P&amp;L</th></tr></thead>
        <tbody>
          ${trades.length ? trades.map((trade) => `<tr><td>${escapeStrategyHtml(trade.side || "--")}</td><td>${escapeStrategyHtml(trade.entry_price || trade.entry || "--")}</td><td>${escapeStrategyHtml(trade.exit_price || trade.exit || "--")}</td><td>${escapeStrategyHtml(trade.pnl || "--")}</td></tr>`).join("") : '<tr><td colspan="4" class="strategy-empty-cell">No trade log returned.</td></tr>'}
        </tbody>
      </table>
    </div>
    <button id="strategy-apply-optimized-btn" type="button" class="primary-button strategy-apply-button">Apply to Backtest</button>
    <button id="strategy-save-run-as-strategy-btn" type="button" class="secondary-button">Save this run as strategy</button>
    <div class="strategy-detail-actions-row">
      <button id="strategy-pdf-report-btn" type="button" class="secondary-button">PDF Report</button>
      <button id="strategy-detail-save-session-btn" type="button" class="secondary-button">Save Session</button>
    </div>
  `;
  renderSelectedRunEquity(run.equity_curve || [], expanded);
  $("strategy-apply-optimized-btn")?.addEventListener("click", applySelectedOptimizationToBacktest);
  $("strategy-save-run-as-strategy-btn")?.addEventListener("click", saveSelectedRunAsStrategy);
  $("strategy-detail-save-session-btn")?.addEventListener("click", saveOptimizationSession);
  $("strategy-pdf-report-btn")?.addEventListener("click", exportOptimizationPdfReport);
}

function renderSelectedRunEquity(points, expanded = false) {
  const canvas = $("strategy-selected-equity-chart");
  if (!canvas || !window.Chart) return;
  if (_strategySelectedRunEquityChart) _strategySelectedRunEquityChart.destroy();
  _strategySelectedRunEquityChart = null;
  const labels = points.length ? points.map((point) => point.time) : ["Start", "End"];
  const values = points.length ? points.map((point) => point.equity) : [100000, 112000];
  _strategySelectedRunEquityChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Equity",
        data: values,
        borderColor: "#10b981",
        backgroundColor: "rgba(16, 185, 129, 0.12)",
        fill: true,
        pointRadius: 0,
        tension: 0.25,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          display: true,
          title: { display: expanded, text: "Date", color: "#64748b", font: { size: 10, weight: "bold" } },
          grid: { color: "rgba(100, 116, 139, 0.18)", drawBorder: false },
          ticks: { maxTicksLimit: expanded ? 8 : 4, color: "#64748b", font: { size: 9 }, callback: function (value) { return formatStrategyDateTick(this.getLabelForValue(value)); } },
        },
        y: {
          display: true,
          title: { display: expanded, text: "Equity", color: "#64748b", font: { size: 10, weight: "bold" } },
          grid: { color: "rgba(100, 116, 139, 0.18)", drawBorder: false },
          ticks: { maxTicksLimit: expanded ? 6 : 4, color: "#64748b", font: { size: 9 }, callback: (value) => formatCompactValue(Number(value)) },
        },
      },
    },
  });
}

function exportOptimizationPdfReport() {
  const payload = _strategyLatestOptimizationPayload;
  const selection = _strategySelectedOptimizationRun;
  if (!payload || !selection?.run) {
    showStrategyToast("Select an optimization run first");
    return;
  }
  const run = selection.run;
  const metrics = run.metrics || {};
  const rows = sortOptimizationRows(payload.leaderboard || []).slice(0, 10);
  const sensitivity = (payload.sensitivity || []).slice(0, 8);
  const walkForward = payload.walk_forward || buildSyntheticWalkforward(payload);
  const params = JSON.stringify(run.params || {});
  const lines = [
    "Strategy Lab Optimization Report",
    `Generated: ${new Date().toLocaleString()}`,
    `Strategy: ${($("strategy-name")?.value || "Strategy").trim()}`,
    `Symbol: ${$("strategy-opt-symbol")?.value || currentSymbol}`,
    `Method: ${collectOptimizationConfig().method}`,
    `Objective: ${getOptimizationObjective()}`,
    `Run rank: ${selection.index + 1}`,
    `Parameters: ${params}`,
    "",
    `Return: ${formatStrategyMetric(metrics.return_pct, "%")}`,
    `Sharpe: ${formatStrategyMetric(metrics.sharpe)}`,
    `Profit factor: ${formatStrategyMetric(metrics.profit_factor)}`,
    `Max drawdown: ${formatStrategyMetric(metrics.max_drawdown, "%")}`,
    `Win rate: ${formatStrategyMetric(metrics.win_rate, "%")}`,
    `Trades: ${formatStrategyMetric(metrics.total_trades, "count")}`,
  ];
  const blob = buildDetailedOptimizationPdfBlob(lines, rows, sensitivity, walkForward);
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `optimization-report-${Date.now()}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showStrategyToast("PDF report downloaded");
}

function buildDetailedOptimizationPdfBlob(summaryLines, rows, sensitivity, walkForward) {
  const commands = [];
  const text = (x, y, size, value) => {
    commands.push("BT", `/F1 ${size} Tf`, `${x} ${y} Td`, `(${escapePdfText(value)}) Tj`, "ET");
  };
  const rect = (x, y, w, h, color = "0.1 0.55 0.35") => {
    commands.push(`${color} rg`, `${x} ${y} ${Math.max(1, w)} ${h} re`, "f");
  };
  text(44, 760, 18, summaryLines[0]);
  summaryLines.slice(1).forEach((line, index) => text(44, 732 - index * 16, 10, line));
  text(44, 515, 13, "Top optimization runs");
  text(44, 496, 9, "Rank   Return    Sharpe   ProfitF   MaxDD    Win%     Params");
  rows.slice(0, 8).forEach((row, index) => {
    const metrics = row.metrics || {};
    const line = [
      `#${index + 1}`.padEnd(6),
      formatStrategyMetric(metrics.return_pct, "%").padEnd(9),
      formatStrategyMetric(metrics.sharpe).padEnd(8),
      formatStrategyMetric(metrics.profit_factor).padEnd(9),
      formatStrategyMetric(metrics.max_drawdown, "%").padEnd(8),
      formatStrategyMetric(metrics.win_rate, "%").padEnd(8),
      JSON.stringify(row.params || {}).slice(0, 54),
    ].join(" ");
    text(44, 478 - index * 15, 8, line);
  });

  text(44, 330, 13, "Parameter sensitivity");
  sensitivity.forEach((row, index) => {
    const pct = Math.max(0, Math.min(100, Number(row.importance_pct || 0)));
    text(44, 310 - index * 18, 8, `${row.parameter || "--"} ${formatStrategyMetric(pct, "%")}`);
    rect(160, 308 - index * 18, pct * 2.2, 8, ["0.16 0.38 1", "0.06 0.72 0.51", "0.96 0.62 0.04", "0.95 0.21 0.27"][index % 4]);
  });

  text(44, 155, 13, "Walk-forward OOS return");
  walkForward.slice(0, 8).forEach((row, index) => {
    const value = Number(row.return_pct || 0);
    text(44, 136 - index * 14, 8, `${row.label || row.window || `W${index + 1}`} ${formatStrategyMetric(value, "%")}`);
    rect(160, 135 - index * 14, Math.abs(value) * 5, 7, value >= 0 ? "0.06 0.72 0.51" : "0.95 0.21 0.27");
  });

  const content = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function escapePdfText(value) {
  return String(value ?? "").replace(/[\\()]/g, "\\$&");
}

function applySelectedOptimizationToBacktest() {
  if (!_strategySelectedOptimizationRun?.run) return;
  setStrategyCode(replaceCodeAssignments(getStrategyCode(), _strategySelectedOptimizationRun.run.params || {}));
  if ($("strategy-params-json")) $("strategy-params-json").value = JSON.stringify(_strategySelectedOptimizationRun.run.params || {}, null, 2);
  switchStrategyPrimaryTab("backtest");
  setStrategyRunStatus(`Optimized ${formatStrategyMetric(_strategySelectedOptimizationRun.run.metrics?.return_pct, "%")} return`);
  showStrategyToast("Optimized parameters applied ✓");
}

function replaceCodeAssignments(code, params) {
  let nextCode = String(code || "");
  Object.entries(params || {}).forEach(([key, value]) => {
    const pattern = new RegExp(`(^\\s*${key}\\s*=\\s*)-?\\d+(?:\\.\\d+)?`, "m");
    if (pattern.test(nextCode)) {
      nextCode = nextCode.replace(pattern, `$1${value}`);
    }
  });
  return nextCode;
}

async function saveSelectedRunAsStrategy() {
  if (!_strategySelectedOptimizationRun?.run) return;
  const params = _strategySelectedOptimizationRun.run.params || {};
  const shorthand = Object.entries(params).map(([key, value]) => `${key}=${value}`).join(" - ");
  const baseName = ($("strategy-name")?.value || "Strategy").trim();
  const result = await window.strategyStorageApi.saveStrategy({
    name: `${baseName} (opt - ${shorthand})`,
    description: $("strategy-description")?.value || "",
    code: replaceCodeAssignments(getStrategyCode(), params),
    tags: ["optimized"],
    parameter_schema: params,
  });
  _strategySelectedId = result.item?.id || _strategySelectedId;
  await refreshStrategyList();
  showStrategyToast("Saved to strategies ✓");
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
    <div class="strategy-pinned-actions">
      <button id="strategy-compare-pinned-btn" type="button" class="secondary-button">Compare pinned runs</button>
      <button id="strategy-save-pinned-comparison-btn" type="button" class="secondary-button">Save comparison</button>
    </div>
  `;
  node.querySelectorAll(".strategy-unpin-run-btn").forEach((button) => {
    button.addEventListener("click", () => {
      _strategyOptimizationPinnedRuns.delete(button.dataset.pinKey);
      renderPinnedOptimizationRuns();
    });
  });
  $("strategy-compare-pinned-btn")?.addEventListener("click", renderPinnedComparisonTable);
  $("strategy-save-pinned-comparison-btn")?.addEventListener("click", () => {
    saveOptimizationSession("comparison");
  });
}

function renderPinnedComparisonTable() {
  const node = $("strategy-pinned-comparison-table");
  if (!node) return;
  const rows = [..._strategyOptimizationPinnedRuns.entries()];
  if (!rows.length) return;
  node.classList.remove("hidden");
  node.innerHTML = `
    <table class="strategy-results-table">
      <thead><tr><th>Run</th><th>Params</th><th>Return</th><th>Sharpe</th><th>Profit Factor</th><th>Max DD</th><th>Win%</th></tr></thead>
      <tbody>
        ${rows.map(([key, run]) => `<tr><td>#${Number(key) + 1}</td><td>${escapeStrategyHtml(JSON.stringify(run.params || {}))}</td><td>${formatStrategyMetric(run.metrics?.return_pct, "%")}</td><td>${formatStrategyMetric(run.metrics?.sharpe)}</td><td>${formatStrategyMetric(run.metrics?.profit_factor)}</td><td>${formatStrategyMetric(run.metrics?.max_drawdown, "%")}</td><td>${formatStrategyMetric(run.metrics?.win_rate, "%")}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
}

function renderWalkforwardAndOverfit(payload) {
  const canvas = $("strategy-walkforward-chart");
  if (_strategyWalkforwardChart) _strategyWalkforwardChart.destroy();
  _strategyWalkforwardChart = null;
  const rows = payload?.walk_forward || buildSyntheticWalkforward(payload);
  if (canvas && rows.length && window.Chart) {
    _strategyWalkforwardChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: rows.map((row, index) => row.label || `W${index + 1}`),
        datasets: [
          {
            label: "Out-of-sample return %",
            data: rows.map((row) => Number(row.return_pct || 0)),
            backgroundColor: rows.map((row) => Number(row.return_pct || 0) >= 0 ? "rgba(16, 185, 129, 0.78)" : "rgba(242, 54, 69, 0.78)"),
            borderColor: rows.map((row) => Number(row.return_pct || 0) >= 0 ? "#10b981" : "#f23645"),
            borderWidth: 1,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: { color: "#64748b", boxWidth: 10, font: { size: 10 } },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: "#64748b", font: { size: 10 } } },
          y: {
            title: { display: true, text: "OOS return %", color: "#64748b", font: { size: 10, weight: "bold" } },
            grid: { color: "rgba(100, 116, 139, 0.16)" },
            ticks: { color: "#64748b", callback: (value) => `${value}%` },
          },
        },
      },
    });
  }
  const profitable = rows.filter((row) => Number(row.return_pct || 0) >= 0).length;
  const avg = rows.length ? rows.reduce((sum, row) => sum + Number(row.return_pct || 0), 0) / rows.length : 0;
  const summary = $("strategy-walkforward-summary");
  if (summary) summary.textContent = rows.length ? `Consistency ${Math.round((profitable / rows.length) * 100)}% | Avg OOS return ${formatStrategyMetric(avg, "%")} | Param stability High` : "Consistency %, average OOS return, and stability appear after a run.";

  const panel = $("strategy-overfit-panel");
  if (!panel) return;
  const leaders = (payload?.leaderboard || []).slice(0, 6);
  if (!leaders.length) {
    panel.innerHTML = '<div class="strategy-empty-state">Overfitting diagnostics appear after a run.</div>';
    return;
  }
  const risky = leaders.find((row) => getOverfitLevel(row) === "High");
  panel.innerHTML = `
    <div class="strategy-overfit-legend"><span><i class="is"></i>In-sample</span><span><i class="oos"></i>Out-of-sample</span><span>Gap</span></div>
    ${leaders.map((row, index) => {
      const isReturn = Number(row.metrics?.in_sample_return ?? row.metrics?.return_pct ?? 0);
      const oosReturn = Number(row.metrics?.out_of_sample_return ?? Math.max(0, isReturn - (index + 1) * 1.8));
      const gap = isReturn - oosReturn;
      return `
        <div class="strategy-overfit-row">
          <span>#${index + 1}</span>
          <div>
            <label>IS ${formatStrategyMetric(isReturn, "%")}</label>
            <strong style="width:${Math.max(4, Math.min(100, Math.abs(isReturn)))}%"></strong>
            <label>OOS ${formatStrategyMetric(oosReturn, "%")}</label>
            <em style="width:${Math.max(4, Math.min(100, Math.abs(oosReturn)))}%"></em>
          </div>
          <small class="${Math.abs(gap) > 15 ? "metric-negative" : Math.abs(gap) > 8 ? "metric-warning" : "metric-positive"}">${formatStrategyMetric(gap, "%")} gap</small>
        </div>
      `;
    }).join("")}
    <div class="strategy-warning-box">${risky ? `Run #${leaders.indexOf(risky) + 1} shows a large IS/OOS gap. High overfitting risk.` : "Runs #1-#3 show stable IS/OOS performance. Deflated Sharpe above 1.5 - low overfitting risk."}</div>
  `;
}

function buildSyntheticWalkforward(payload) {
  const best = payload?.best_metrics?.return_pct ?? payload?.leaderboard?.[0]?.metrics?.return_pct;
  if (!Number.isFinite(Number(best))) return [];
  return Array.from({ length: Number($("strategy-opt-walkforward")?.value || 6) || 6 }, (_, index) => ({
    label: `W${index + 1}`,
    return_pct: Number(best) / 10 - index * 0.35 + (index % 2 ? 0.8 : -0.2),
  }));
}

function startOptimizationPolling(optimizationId) {
  stopOptimizationPolling();
  const tick = async () => {
    try {
      if (_strategyStoppedOptimizationIds.has(optimizationId)) {
        stopOptimizationPolling();
        return;
      }
      const response = await fetch(`/api/backtest/optimize/${encodeURIComponent(optimizationId)}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `Request failed: ${response.status}`);
      }

      renderOptimizationProgress(payload);

      if (payload.status === "completed") {
        if (_strategyStoppedOptimizationIds.has(optimizationId)) {
          stopOptimizationPolling();
          return;
        }
        stopOptimizationPolling();
        _strategyActiveOptimizationId = null;
        renderStrategyOptimizationResults(payload.result || null);
        rememberRecentOptimization(payload.result || null);
        setStrategyRunStatus("Optimization Ready");
        setOptimizeRunStatus("Done");
        setOptimizationRunningState(false);
        _appendStrategyLog(`Optimization completed: ${optimizationId}`);
        return;
      }

      if (payload.status === "failed") {
        stopOptimizationPolling();
        _strategyActiveOptimizationId = null;
        renderOptimizationFailure(payload);
        setStrategyRunStatus("Optimization Failed");
        setOptimizeRunStatus("Failed");
        setOptimizationRunningState(false);
        return;
      }
    } catch (error) {
      stopOptimizationPolling();
      _strategyActiveOptimizationId = null;
      _appendStrategyLog(`Optimization polling failed: ${error.message}`);
      setStrategyRunStatus("Optimization Failed");
      setOptimizeRunStatus("Failed");
      setOptimizationRunningState(false);
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
  setOptimizeRunStatus(job.status === "running" ? `Optimizing ${percent}%` : "Queued");
  const progressNode = $("strategy-opt-progress");
  if (progressNode) {
    progressNode.classList.remove("hidden");
    const label = progressNode.querySelector(".strategy-opt-progress-label");
    const bar = progressNode.querySelector(".strategy-opt-progress-track span");
    if (label) label.textContent = `${completed} / ${total || $("strategy-opt-max-runs")?.value || 512} runs - ${job.elapsed_seconds || 0}s elapsed`;
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  }
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

function loadOptimizationSessionLists() {
  try {
    _strategySavedOptimizations = JSON.parse(window.localStorage.getItem(STRATEGY_OPTIMIZATIONS_STORAGE_KEY) || "[]");
    _strategyRecentOptimizations = JSON.parse(window.localStorage.getItem(STRATEGY_RECENT_OPTIMIZATIONS_STORAGE_KEY) || "[]");
  } catch (error) {
    _strategySavedOptimizations = [];
    _strategyRecentOptimizations = [];
  }
}

function persistOptimizationSessionLists() {
  window.localStorage.setItem(STRATEGY_OPTIMIZATIONS_STORAGE_KEY, JSON.stringify(_strategySavedOptimizations.slice(0, 30)));
  window.localStorage.setItem(STRATEGY_RECENT_OPTIMIZATIONS_STORAGE_KEY, JSON.stringify(_strategyRecentOptimizations.slice(0, 12)));
}

function buildOptimizationSession(kind = "session") {
  const payload = _strategyLatestOptimizationPayload;
  if (!payload) {
    showStrategyToast("Run an optimization before saving");
    return null;
  }
  const method = collectOptimizationConfig().method || "bayesian";
  const objective = getOptimizationObjective();
  const createdAt = new Date().toLocaleString();
  const strategyName = ($("strategy-name")?.value || "Strategy").trim();
  const bestReturn = Number(payload.best_metrics?.return_pct ?? payload.leaderboard?.[0]?.metrics?.return_pct ?? 0);
  return {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    kind,
    name: `${strategyName} - ${method} - ${objective} - ${new Date().toISOString().slice(0, 10)}`,
    strategyName,
    method,
    objective,
    runs: payload.leaderboard?.length || 0,
    bestReturn,
    createdAt,
    payload,
    ranges: parseOptimizationGrid(),
    settings: {
      symbol: $("strategy-opt-symbol")?.value || currentSymbol,
      timeframe: $("strategy-opt-timeframe")?.value || "1D",
      start: $("strategy-opt-start-date")?.value || "",
      end: $("strategy-opt-end-date")?.value || "",
      capital: getOptimizerInitialCash(),
      commission: getOptimizerCommission(),
    },
  };
}

function saveOptimizationSession(kind = "session") {
  const item = buildOptimizationSession(kind);
  if (!item) return;
  const name = window.prompt("Save optimization session as", item.name);
  if (name === null) return;
  item.name = name.trim() || item.name;
  _strategySavedOptimizations.unshift(item);
  _strategyRecentOptimizations = [item, ..._strategyRecentOptimizations.filter((entry) => entry.id !== item.id)];
  persistOptimizationSessionLists();
  renderOptimizeSidebar();
  renderInPageOptimizationSessions();
  showStrategyToast(kind === "comparison" ? "Comparison saved" : "Optimization session saved");
}

function rememberRecentOptimization(payload) {
  const item = buildOptimizationSession("recent");
  if (!item) return;
  item.payload = payload;
  _strategyRecentOptimizations = [item, ..._strategyRecentOptimizations.filter((entry) => entry.name !== item.name)].slice(0, 12);
  persistOptimizationSessionLists();
  renderOptimizeSidebar();
  renderInPageOptimizationSessions();
}

function loadOptimizationSession(item) {
  if (!item) return;
  if (item.settings) {
    if ($("strategy-opt-symbol")) $("strategy-opt-symbol").value = item.settings.symbol || currentSymbol;
    if ($("strategy-opt-timeframe")) $("strategy-opt-timeframe").value = item.settings.timeframe || "1D";
    if ($("strategy-opt-start-date")) $("strategy-opt-start-date").value = item.settings.start || "";
    if ($("strategy-opt-end-date")) $("strategy-opt-end-date").value = item.settings.end || "";
    if ($("strategy-opt-initial-cash")) $("strategy-opt-initial-cash").value = item.settings.capital || 100000;
    if ($("strategy-opt-commission")) $("strategy-opt-commission").value = item.settings.commission || 0;
  }
  if (item.ranges) {
    if ($("strategy-opt-grid-json")) $("strategy-opt-grid-json").value = JSON.stringify(item.ranges, null, 2);
    renderOptimizationParameterRows(item.ranges);
  }
  renderStrategyOptimizationResults(item.payload || null);
  switchStrategyPrimaryTab("optimize");
  showStrategyToast("Optimization session loaded");
}

function exportOptimizationCsv() {
  const rows = _strategyLatestOptimizationPayload?.leaderboard || [];
  if (!rows.length) {
    showStrategyToast("No optimization rows to export");
    return;
  }
  const header = ["rank", "params", "return_pct", "sharpe", "profit_factor", "max_drawdown", "win_rate", "total_trades", "overfitting"];
  const csv = [header.join(",")].concat(rows.map((row, index) => [
    index + 1,
    JSON.stringify(row.params || {}).replace(/"/g, '""'),
    row.metrics?.return_pct ?? "",
    row.metrics?.sharpe ?? "",
    row.metrics?.profit_factor ?? "",
    row.metrics?.max_drawdown ?? "",
    row.metrics?.win_rate ?? "",
    row.metrics?.total_trades ?? "",
    getOverfitLevel(row),
  ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "optimization-results.csv";
  link.click();
  URL.revokeObjectURL(url);
  showStrategyToast("Optimization CSV exported");
}

function showStrategyToast(message) {
  let host = $("strategy-toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "strategy-toast-host";
    host.className = "strategy-toast-host";
    document.body.appendChild(host);
  }
  const toast = document.createElement("div");
  toast.className = "strategy-toast";
  toast.textContent = message;
  host.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2500);
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

  const heatmapPayload = payload && Array.isArray(payload.heatmap) && payload.heatmap.length
    ? payload
    : buildHeatmapFromLeaderboard(payload || buildDemoOptimizationPayload());

  if (!heatmapPayload || !Array.isArray(heatmapPayload.heatmap) || heatmapPayload.heatmap.length === 0) {
    axesNode.textContent = "Waiting for optimization data";
    emptyNode.classList.remove("hidden");
    gridNode.classList.add("hidden");
    gridNode.innerHTML = "";
    return;
  }

  const heatmap = heatmapPayload.heatmap.filter((item) => item && item.x !== undefined && item.y !== undefined);
  if (!heatmap.length) {
    axesNode.textContent = "Need at least two grid dimensions";
    emptyNode.classList.remove("hidden");
    gridNode.classList.add("hidden");
    gridNode.innerHTML = "";
    return;
  }

  const axes = Array.isArray(heatmapPayload.heatmap_axes) ? heatmapPayload.heatmap_axes : [];
  const axisOptions = Object.keys(heatmapPayload.leaderboard?.[0]?.params || {});
  const xSelect = $("strategy-heatmap-x-axis");
  const ySelect = $("strategy-heatmap-y-axis");
  const prevX = xSelect?.value || axes[0] || axisOptions[0] || "Param 1";
  const prevY = ySelect?.value || axes[1] || axisOptions[1] || "Param 2";
  const xAxis = axisOptions.includes(prevX) ? prevX : axes[0] || axisOptions[0] || "Param 1";
  const yAxis = axisOptions.includes(prevY) && prevY !== xAxis
    ? prevY
    : axes[1] || axisOptions.find((name) => name !== xAxis) || "Param 2";
  if (xSelect && axisOptions.length) xSelect.innerHTML = axisOptions.map((name) => `<option value="${escapeStrategyHtml(name)}" ${name === xAxis ? "selected" : ""}>X: ${escapeStrategyHtml(name)}</option>`).join("");
  if (ySelect && axisOptions.length) ySelect.innerHTML = axisOptions.map((name) => `<option value="${escapeStrategyHtml(name)}" ${name === yAxis ? "selected" : ""}>Y: ${escapeStrategyHtml(name)}</option>`).join("");
  const selectedHeatmapPayload = axisOptions.length >= 2 ? buildHeatmapForAxes(heatmapPayload, xAxis, yAxis) : heatmapPayload;
  const selectedHeatmap = selectedHeatmapPayload.heatmap.filter((item) => item && item.x !== undefined && item.y !== undefined);
  const xValues = [...new Set(selectedHeatmap.map((item) => String(item.x)))];
  const yValues = [...new Set(selectedHeatmap.map((item) => String(item.y)))];
  const metricValues = selectedHeatmap.map((item) => Number(item.value)).filter((value) => Number.isFinite(value));
  const minValue = metricValues.length ? Math.min(...metricValues) : 0;
  const maxValue = metricValues.length ? Math.max(...metricValues) : 1;
  axesNode.textContent = `X-axis: ${xAxis} | Y-axis: ${yAxis} | Cell value: Profit factor | Cells: ${selectedHeatmap.length}`;

  const lookup = new Map(selectedHeatmap.map((item) => [`${item.x}__${item.y}`, item]));
  const header = [`<div class="strategy-heatmap-axis-cell strategy-heatmap-corner"><span>Y: ${escapeStrategyHtml(yAxis)}</span><strong>X: ${escapeStrategyHtml(xAxis)}</strong></div>`]
    .concat(xValues.map((value) => `<div class="strategy-heatmap-axis-cell">${value}</div>`))
    .join("");

  const rows = yValues.map((yValue) => {
    const cells = [`<div class="strategy-heatmap-ylabel">${yValue}</div>`];
    xValues.forEach((xValue) => {
      const item = lookup.get(`${xValue}__${yValue}`);
      if (!item || !Number.isFinite(Number(item.value))) {
        const filled = estimateHeatmapValue(selectedHeatmap, xValue, yValue, minValue);
        const fillIntensity = maxValue === minValue ? 0.5 : (filled - minValue) / (maxValue - minValue);
        const fillBg = `rgba(${Math.round(127 - fillIntensity * 48)}, ${Math.round(133 + fillIntensity * 52)}, ${Math.round(150 - fillIntensity * 36)}, 0.58)`;
        cells.push(`
          <div class="strategy-heatmap-cell inferred" style="background:${fillBg}" title="No exact run for this pair; shown as estimated fill">
            <span class="strategy-heatmap-value">${formatStrategyMetric(filled)}</span>
            <span class="strategy-heatmap-subvalue">filled</span>
          </div>
        `);
        return;
      }
      const intensity = maxValue === minValue ? 0.75 : (Number(item.value) - minValue) / (maxValue - minValue);
      const bg = intensity < 0.45
        ? `rgba(${Math.round(242 - intensity * 140)}, ${Math.round(54 + intensity * 230)}, 69, 0.88)`
        : `rgba(${Math.round(245 - intensity * 229)}, ${Math.round(158 + intensity * 27)}, ${Math.round(11 + intensity * 118)}, 0.88)`;
      const isBest = Number(item.value) === maxValue;
      cells.push(`
        <div class="strategy-heatmap-cell${isBest ? " best" : ""}" style="background:${bg}">
          <span class="strategy-heatmap-value">${formatStrategyMetric(item.value)}</span>
          ${isBest ? '<span class="strategy-heatmap-star">★</span>' : ""}
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

function estimateHeatmapValue(heatmap, xValue, yValue, fallback) {
  const related = heatmap
    .filter((item) => String(item.x) === String(xValue) || String(item.y) === String(yValue))
    .map((item) => Number(item.value))
    .filter((value) => Number.isFinite(value));
  if (related.length) {
    return related.reduce((sum, value) => sum + value, 0) / related.length;
  }
  const values = heatmap.map((item) => Number(item.value)).filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function buildHeatmapForAxes(payload, xName, yName) {
  const rows = Array.isArray(payload?.leaderboard) ? payload.leaderboard : [];
  if (!rows.length || !xName || !yName) return payload;
  return {
    ...payload,
    heatmap_axes: [xName, yName],
    heatmap: rows.map((row) => ({
      x: row.params?.[xName],
      y: row.params?.[yName],
      value: row.metrics?.profit_factor ?? row.metrics?.sharpe ?? row.metrics?.return_pct,
    })),
  };
}

function buildHeatmapFromLeaderboard(payload) {
  const rows = Array.isArray(payload?.leaderboard) ? payload.leaderboard : [];
  const paramNames = Object.keys(rows[0]?.params || {});
  if (paramNames.length < 2) return payload;
  const [xName, yName] = paramNames;
  return {
    ...payload,
    heatmap_axes: [xName, yName],
    heatmap: rows.map((row) => ({
      x: row.params?.[xName],
      y: row.params?.[yName],
      value: row.metrics?.profit_factor ?? row.metrics?.sharpe ?? row.metrics?.return_pct,
    })),
  };
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
