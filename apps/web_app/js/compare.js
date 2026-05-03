const STRATEGY_COMPARE_MOCK_DATA = {
  palette: ["#5b7cfa", "#5cc489", "#f3b43f", "#8b5cf6", "#22d3ee", "#ef4444", "#f472b6", "#facc15"],
  regimes: ["Bull Trend", "Bear Trend", "High Vol", "Low Vol", "Recovery", "Crash", "Sideways", "Rate Rising"],
  crises: [
    ["2008 GFC", "2008-09-01", "2009-03-31"],
    ["2011 Correction", "2011-07-01", "2011-12-31"],
    ["2015 China", "2015-06-01", "2015-09-30"],
    ["2018 Q4", "2018-10-01", "2018-12-31"],
    ["2020 COVID", "2020-02-15", "2020-04-30"],
    ["2022 Rate Shock", "2022-01-01", "2022-10-31"],
  ],
  goals: [
    ["2x capital", 2],
    ["1.5x capital", 1.5],
    ["Breakeven", 1],
    ["50% loss", 0.5],
  ],
};

let _strategyCompareInitialized = false;
let _strategyCompareActiveTab = "overview";
let _strategyCompareSelectedIds = new Set();
let _strategyCompareColors = {};
let _strategyCompareCharts = [];
let _strategyCompareRunCache = new Map();
let _strategyCompareHydrating = new Set();
let _strategyCompareCustomRuns = new Map();
let _strategyCompareFanStrategyId = null;
let _strategyCompareTradeFilter = { strategies: new Set(), symbol: "", result: "all", start: "", end: "", sort: "entryDate", dir: 1 };

function initStrategyCompareLab() {
  if (_strategyCompareInitialized) return;
  _strategyCompareInitialized = true;
  renderStrategyCompareLab();
}

function renderStrategyCompareLab() {
  const root = $("strategy-compare-root");
  if (!root) return;
  ensureDefaultCompareSelection();
  root.innerHTML = buildStrategyCompareShell();
  bindStrategyCompareEvents();
  hydrateSelectedCompareRuns();
  renderStrategyCompareViews();
}

function ensureDefaultCompareSelection() {
  if (_strategyCompareSelectedIds.size) return;
  const items = getCompareAvailableItems();
  items.slice(0, 4).forEach((item) => _strategyCompareSelectedIds.add(item.id));
}

function buildStrategyCompareShell() {
  return `
    <aside class="strategy-compare-side">
      <div class="strategy-compare-side-head">
        <strong>Strategies</strong>
        <button id="strategy-compare-add-current" type="button" class="strategy-opt-btn">+ Add</button>
      </div>
      <div class="strategy-compare-side-label">In comparison</div>
      <div id="strategy-compare-strategy-list" class="strategy-compare-side-list">${buildStrategyCompareSideList()}</div>
      <button id="strategy-compare-add-backtest" type="button" class="strategy-opt-btn full">+ From Backtest</button>
      <button id="strategy-compare-add-optimizer" type="button" class="strategy-opt-btn full">+ From Optimizer Results</button>
      <div id="strategy-compare-picker" class="strategy-compare-picker hidden"></div>
      <div class="strategy-compare-side-label">View</div>
      <nav class="strategy-compare-view-nav">
        ${[
          ["overview", "Overview", "O"],
          ["performance", "Performance", "P"],
          ["risk", "Risk & Drawdown", "R"],
          ["distribution", "Distribution", "D"],
          ["regime", "Regime Analysis", "G"],
          ["montecarlo", "Monte Carlo", "M"],
          ["stress", "Stress Tests", "S"],
          ["capacity", "Costs & Capacity", "C"],
          ["trades", "Trade-Level", "T"],
          ["full", "Full Table", "="],
        ].map(([id, label, icon]) => `<button type="button" class="${_strategyCompareActiveTab === id ? "active" : ""}" data-compare-tab="${id}"><span>${icon}</span>${label}</button>`).join("")}
      </nav>
      <div class="strategy-compare-side-footer">
        <button id="strategy-compare-export-pdf" type="button" class="strategy-opt-btn full">Export PDF Report</button>
        <button id="strategy-compare-export-csv" type="button" class="strategy-opt-btn full">Export CSV</button>
      </div>
    </aside>
    <main class="strategy-compare-main">
      <section class="strategy-compare-section-title"><span>Summary Cards</span></section>
      <div id="strategy-compare-summary-cards" class="strategy-compare-summary-cards"></div>
      <section id="strategy-compare-content" class="strategy-compare-content"></section>
    </main>
  `;
}

function buildStrategyCompareSideList() {
  const items = getCompareAvailableItems();
  return items.map((item) => {
    const checked = _strategyCompareSelectedIds.has(item.id);
    const metric = item.summary?.returnPct ?? item.metrics?.return_pct ?? item.result?.metrics?.return_pct;
    return `
      <label class="strategy-compare-side-item ${checked ? "active" : ""}">
        <input type="checkbox" value="${escapeStrategyHtml(item.id)}" ${checked ? "checked" : ""}>
        <span class="strategy-compare-dot" style="background:${getCompareColor(item.id)}"></span>
        <span class="strategy-compare-side-name">${escapeStrategyHtml(item.name)}</span>
        <input class="strategy-compare-side-color" type="color" value="${getCompareColor(item.id)}" data-color-strategy="${escapeStrategyHtml(item.id)}">
        <em class="${Number(metric) >= 0 ? "metric-positive" : "metric-negative"}">${Number.isFinite(Number(metric)) ? `${Number(metric) >= 0 ? "+" : ""}${num(metric)}%` : "--"}</em>
      </label>
    `;
  }).join("") || '<div class="strategy-empty-state">Run or load a backtest to compare strategies.</div>';
}

function bindStrategyCompareEvents() {
  document.querySelectorAll("#strategy-compare-strategy-list input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) _strategyCompareSelectedIds.add(input.value);
      else _strategyCompareSelectedIds.delete(input.value);
      hydrateSelectedCompareRuns();
      renderStrategyCompareLab();
    });
  });
  document.querySelectorAll("[data-color-strategy]").forEach((input) => {
    input.addEventListener("input", () => {
      _strategyCompareColors[input.dataset.colorStrategy] = input.value;
      renderStrategyCompareLab();
    });
  });
  document.querySelectorAll("[data-compare-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      _strategyCompareActiveTab = button.dataset.compareTab;
      renderStrategyCompareLab();
    });
  });
  $("strategy-compare-add-current")?.addEventListener("click", addCurrentBacktestToCompare);
  $("strategy-compare-add-backtest")?.addEventListener("click", renderBacktestPicker);
  $("strategy-compare-add-optimizer")?.addEventListener("click", renderOptimizerRunPicker);
  $("strategy-compare-export-csv")?.addEventListener("click", exportCompareCsv);
  $("strategy-compare-export-pdf")?.addEventListener("click", () => showStrategyToast("PDF export is not wired for Compare yet"));
}

function renderStrategyCompareViews() {
  const content = $("strategy-compare-content");
  if (!content) return;
  destroyCompareCharts();
  const strategies = getSelectedCompareStrategies();
  $("strategy-compare-count-badge") && ($("strategy-compare-count-badge").textContent = `${strategies.length} selected`);
  renderSummaryCards(strategies);
  if (!strategies.length) {
    content.innerHTML = '<div class="strategy-empty-state">Select at least one backtest run from the left panel.</div>';
    return;
  }
  if (_strategyCompareActiveTab === "overview") renderCompareOverview(content, strategies);
  if (_strategyCompareActiveTab === "performance") renderComparePerformance(content, strategies);
  if (_strategyCompareActiveTab === "risk") renderCompareRisk(content, strategies);
  if (_strategyCompareActiveTab === "distribution") renderCompareDistribution(content, strategies);
  if (_strategyCompareActiveTab === "regime") renderCompareRegime(content, strategies);
  if (_strategyCompareActiveTab === "montecarlo") renderCompareMonteCarlo(content, strategies);
  if (_strategyCompareActiveTab === "stress") renderCompareStress(content, strategies);
  if (_strategyCompareActiveTab === "capacity") renderCompareCapacity(content, strategies);
  if (_strategyCompareActiveTab === "trades") renderCompareTrades(content, strategies);
  if (_strategyCompareActiveTab === "full") renderFullMetricsTable(content, strategies);
}

function renderSummaryCards(strategies) {
  const node = $("strategy-compare-summary-cards");
  if (!node) return;
  node.innerHTML = strategies.map((s) => `
    <article class="strategy-compare-summary-card" style="border-top-color:${getCompareColor(s.id)}">
      <div>${escapeStrategyHtml(s.name)}</div>
      <strong class="${s.metrics.totalReturn >= 0 ? "metric-positive" : "metric-negative"}">${s.metrics.totalReturn >= 0 ? "+" : ""}${num(s.metrics.totalReturn)}%</strong>
      <span>Sharpe ${num(s.metrics.sharpe)} / DD ${num(s.metrics.maxDrawdown)}%</span>
    </article>
  `).join("") || '<div class="strategy-empty-state">No strategies selected.</div>';
}

function renderCompareOverview(content, strategies) {
  content.innerHTML = `
    <section class="strategy-compare-section-title"><span>Equity Curves</span></section>
    ${chartCard("cmp-equity", "Cumulative returns - all strategies", "wide")}
    <div class="strategy-compare-grid two">
      ${chartCard("cmp-risk-return", "Return vs Risk scatter")}
      ${chartCard("cmp-bars", "Metric ranking")}
    </div>
    ${tableShell("cmp-summary-table", "Summary metrics")}
  `;
  const labels = unionLabels(strategies.map((s) => s.equity.map((p) => p.time)));
  lineChart("cmp-equity", labels, [
    ...strategies.map((s) => lineDataset(s.name, alignSeries(s.equity, labels, "equity"), getCompareColor(s.id))),
    { label: "Buy & Hold", data: alignSeries(strategies[0].equity, labels, "buy_hold"), borderColor: "#6b7280", borderDash: [6, 5], pointRadius: 0, fill: false, tension: 0.12 },
  ], { yMoney: true });
  chart("cmp-risk-return", {
    type: "scatter",
    data: { datasets: strategies.map((s) => ({ label: s.name, data: [{ x: s.metrics.volatility, y: s.metrics.cagr }], backgroundColor: getCompareColor(s.id), pointRadius: 6 })) },
    options: baseChartOptions({ xTitle: "Volatility %", yTitle: "Annualized return %" }),
  });
  groupedBar("cmp-bars", ["Total Return", "CAGR", "Sharpe", "Max DD", "Win Rate", "Profit Factor"], strategies, (s) => [s.metrics.totalReturn, s.metrics.cagr, s.metrics.sharpe, s.metrics.maxDrawdown, s.metrics.winRate, s.metrics.profitFactor], { indexAxis: "y" });
  renderSummaryMetricsTable("cmp-summary-table", strategies);
}

function renderComparePerformance(content, strategies) {
  content.innerHTML = `
    <div class="strategy-compare-grid two">
      ${chartCard("cmp-annual-bars", "Year-by-year return breakdown")}
      ${chartCard("cmp-profit-factor", "Profit factor and expectancy")}
    </div>
    ${tableShell("cmp-performance-table", "Return and trade statistics")}
  `;
  const years = unionLabels(strategies.map((s) => Object.keys(s.annual)));
  groupedBar("cmp-annual-bars", years, strategies, (s) => years.map((y) => s.annual[y] ?? null));
  groupedBar("cmp-profit-factor", ["Profit Factor", "Expectancy", "Avg Win/Loss"], strategies, (s) => [s.metrics.profitFactor, s.metrics.expectancy, s.metrics.winLossRatio]);
  renderSimpleTable("cmp-performance-table", ["Strategy", "Total Return", "CAGR", "Trades", "Win Rate", "Profit Factor", "Expectancy", "Avg W/L"], strategies.map((s) => [s.name, pct(s.metrics.totalReturn), pct(s.metrics.cagr), s.metrics.totalTrades, pct(s.metrics.winRate), num(s.metrics.profitFactor), money(s.metrics.expectancy), num(s.metrics.winLossRatio)]));
}

function renderCompareRisk(content, strategies) {
  content.innerHTML = `
    <div class="strategy-compare-grid two">
      ${chartCard("cmp-underwater", "Drawdown underwater")}
      ${chartCard("cmp-rolling-sharpe", "Rolling Sharpe - 90 periods")}
      ${chartCard("cmp-rolling-vol", "Rolling Volatility - 90 periods")}
      ${chartCard("cmp-var-cvar", "VaR & CVaR")}
    </div>
    <div class="strategy-compare-grid two">
      ${chartCard("cmp-ulcer", "Ulcer Index")}
      ${tableShell("cmp-dd-duration", "Drawdown duration")}
    </div>
  `;
  const labels = unionLabels(strategies.map((s) => s.drawdown.map((p) => p.time)));
  lineChart("cmp-underwater", labels, strategies.map((s) => ({ ...lineDataset(s.name, alignSeries(s.drawdown, labels, "drawdown"), getCompareColor(s.id)), backgroundColor: hexToRgba(getCompareColor(s.id), 0.12), fill: true })));
  lineChart("cmp-rolling-sharpe", labels, strategies.map((s) => lineDataset(s.name, alignSeries(s.rollingSharpe, labels, "value"), getCompareColor(s.id))));
  lineChart("cmp-rolling-vol", labels, strategies.map((s) => lineDataset(s.name, alignSeries(s.rollingVol, labels, "value"), getCompareColor(s.id))));
  groupedBar("cmp-var-cvar", ["VaR 95", "CVaR 95", "VaR 99", "CVaR 99"], strategies, (s) => [s.varCvar.var95, s.varCvar.cvar95, s.varCvar.var99, s.varCvar.cvar99]);
  barChart("cmp-ulcer", strategies.map((s) => s.name), [{ label: "Ulcer Index", data: strategies.map((s) => s.metrics.ulcerIndex), backgroundColor: strategies.map((s) => getCompareColor(s.id)) }]);
  renderSimpleTable("cmp-dd-duration", ["Strategy", "Max Drawdown", "Longest DD", "Current DD"], strategies.map((s) => [s.name, pct(s.metrics.maxDrawdown), `${s.metrics.maxDrawdownDuration} periods`, pct(lastValue(s.drawdown, "drawdown"))]));
}

function renderCompareDistribution(content, strategies) {
  content.innerHTML = `
    <div class="strategy-compare-grid two">
      ${chartCard("cmp-radar", "Risk-adjusted radar")}
      ${chartCard("cmp-hist", "Return distribution")}
    </div>
    ${heatmapShell("cmp-annual-heatmap", "Annual returns heatmap")}
    ${tableShell("cmp-skew-table", "Skewness & Kurtosis")}
  `;
  chart("cmp-radar", {
    type: "radar",
    data: { labels: ["Sharpe", "Sortino", "Calmar", "Omega", "Tail Ratio"], datasets: strategies.map((s) => ({ label: s.name, data: [s.metrics.sharpe, s.metrics.sortino, s.metrics.calmar, s.metrics.omega, s.metrics.tailRatio], borderColor: getCompareColor(s.id), backgroundColor: hexToRgba(getCompareColor(s.id), 0.12), pointRadius: 2 })) },
    options: radarOptions(),
  });
  const buckets = [-5, -3, -1, 0, 1, 3, 5];
  groupedBar("cmp-hist", buckets.map((b) => `${b}%`), strategies, (s) => buckets.map((b, i) => s.returnsPct.filter((r) => r >= b && r < (buckets[i + 1] ?? Infinity)).length));
  const years = unionLabels(strategies.map((s) => Object.keys(s.annual)));
  renderHeatmap("cmp-annual-heatmap", strategies.map((s) => s.name), years, (row, col) => strategies[row].annual[years[col]]);
  renderSimpleTable("cmp-skew-table", ["Strategy", "Skewness", "Kurtosis", "Tail Ratio", "Omega"], strategies.map((s) => [s.name, num(s.metrics.skewness), num(s.metrics.kurtosis), num(s.metrics.tailRatio), num(s.metrics.omega)]));
}

function renderCompareRegime(content, strategies) {
  content.innerHTML = `
    ${heatmapShell("cmp-regime-heatmap", "Regime performance heatmap")}
    <div class="strategy-compare-grid three">
      ${chartCard("cmp-bull", "Bull")}
      ${chartCard("cmp-bear", "Bear")}
      ${chartCard("cmp-crash", "Crash")}
    </div>
  `;
  renderHeatmap("cmp-regime-heatmap", strategies.map((s) => s.name), STRATEGY_COMPARE_MOCK_DATA.regimes, (row, col) => strategies[row].regimes[STRATEGY_COMPARE_MOCK_DATA.regimes[col]]);
  barChart("cmp-bull", strategies.map((s) => s.name), [{ label: "Return", data: strategies.map((s) => s.regimes["Bull Trend"]), backgroundColor: strategies.map((s) => getCompareColor(s.id)) }]);
  barChart("cmp-bear", strategies.map((s) => s.name), [{ label: "Return", data: strategies.map((s) => s.regimes["Bear Trend"]), backgroundColor: strategies.map((s) => getCompareColor(s.id)) }]);
  barChart("cmp-crash", strategies.map((s) => s.name), [{ label: "Return", data: strategies.map((s) => s.regimes.Crash), backgroundColor: strategies.map((s) => getCompareColor(s.id)) }]);
}

function renderCompareStress(content, strategies) {
  content.innerHTML = `
    ${heatmapShell("cmp-stress-table", "Historical stress scenarios")}
    ${chartCard("cmp-stress-corr", "Correlation under stress vs normal", "wide")}
  `;
  const crises = STRATEGY_COMPARE_MOCK_DATA.crises.map(([name]) => name);
  renderHeatmap("cmp-stress-table", crises, strategies.map((s) => s.name), (row, col) => strategies[col].stress[crises[row]]);
  const pairs = strategies.slice(1).map((s) => `${strategies[0].name}/${s.name}`);
  groupedBar("cmp-stress-corr", pairs, [
    { id: "normal", name: "Normal" },
    { id: "crisis", name: "Crisis" },
  ], (bucket) => strategies.slice(1).map((s) => correlationForPair(strategies[0], s, bucket.id === "crisis")));
}

function renderCompareMonteCarlo(content, strategies) {
  const fanStrategy = strategies.find((s) => s.id === _strategyCompareFanStrategyId) || strategies[0];
  _strategyCompareFanStrategyId = fanStrategy.id;
  content.innerHTML = `
    <section class="strategy-compare-card">
      <div class="strategy-compare-card-head"><h4>Fan chart - 10,000 bootstrapped paths</h4><select id="strategy-compare-fan-select">${strategies.map((s) => `<option value="${escapeStrategyHtml(s.id)}" ${s.id === fanStrategy.id ? "selected" : ""}>${escapeStrategyHtml(s.name)}</option>`).join("")}</select></div>
      <div class="strategy-compare-canvas-wrap"><canvas id="cmp-fan"></canvas></div>
    </section>
    ${chartCard("cmp-terminal", "Terminal wealth distribution", "wide")}
    ${tableShell("cmp-goals-table", "Probability of goals")}
  `;
  $("strategy-compare-fan-select")?.addEventListener("change", (e) => { _strategyCompareFanStrategyId = e.target.value; renderStrategyCompareViews(); });
  const labels = fanStrategy.monteCarlo.map((p) => `M${p.step}`);
  lineChart("cmp-fan", labels, [
    { label: "P10", data: fanStrategy.monteCarlo.map((p) => p.p10), borderColor: hexToRgba(getCompareColor(fanStrategy.id), 0.32), backgroundColor: hexToRgba(getCompareColor(fanStrategy.id), 0.08), fill: "+1", pointRadius: 0 },
    { label: "P25", data: fanStrategy.monteCarlo.map((p) => p.p25), borderColor: hexToRgba(getCompareColor(fanStrategy.id), 0.55), backgroundColor: hexToRgba(getCompareColor(fanStrategy.id), 0.12), fill: "+1", pointRadius: 0 },
    { label: "Median", data: fanStrategy.monteCarlo.map((p) => p.median), borderColor: getCompareColor(fanStrategy.id), pointRadius: 0, borderWidth: 2 },
    { label: "P75", data: fanStrategy.monteCarlo.map((p) => p.p75), borderColor: hexToRgba(getCompareColor(fanStrategy.id), 0.55), pointRadius: 0 },
    { label: "P90", data: fanStrategy.monteCarlo.map((p) => p.p90), borderColor: hexToRgba(getCompareColor(fanStrategy.id), 0.32), pointRadius: 0 },
  ], { yMoney: true });
  const buckets = buildHistogramBuckets(strategies.flatMap((s) => s.terminalWealth), 8);
  groupedBar("cmp-terminal", buckets.map((b) => formatCompactValue(b)), strategies, (s) => bucketCounts(s.terminalWealth, buckets));
  renderSimpleTable("cmp-goals-table", ["Goal", ...strategies.map((s) => s.name)], STRATEGY_COMPARE_MOCK_DATA.goals.map(([goal]) => [goal, ...strategies.map((s) => pct(s.goals[goal], 0))]));
}

function renderCompareTrades(content, strategies) {
  content.innerHTML = `
    <section class="strategy-compare-card">
      <div class="strategy-compare-filter-row">
        <select id="cmp-trade-strategy-filter" multiple>${strategies.map((s) => `<option value="${escapeStrategyHtml(s.id)}" ${_strategyCompareTradeFilter.strategies.size === 0 || _strategyCompareTradeFilter.strategies.has(s.id) ? "selected" : ""}>${escapeStrategyHtml(s.name)}</option>`).join("")}</select>
        <input id="cmp-trade-symbol-filter" type="search" placeholder="Symbol" value="${escapeStrategyHtml(_strategyCompareTradeFilter.symbol)}">
        <select id="cmp-trade-result-filter"><option value="all">All</option><option value="winners">Winners</option><option value="losers">Losers</option></select>
        <input id="cmp-trade-start-filter" type="date" value="${escapeStrategyHtml(_strategyCompareTradeFilter.start)}">
        <input id="cmp-trade-end-filter" type="date" value="${escapeStrategyHtml(_strategyCompareTradeFilter.end)}">
      </div>
      <div class="strategy-table-shell"><table class="strategy-results-table strategy-compare-trade-table"><thead><tr>${["Strategy","Symbol","Direction","Entry Date","Entry Price","Exit Date","Exit Price","Duration","P&L ($)","Return (%)","MFE","MAE","Efficiency"].map((h) => `<th data-trade-sort="${escapeStrategyHtml(h)}">${escapeStrategyHtml(h)}</th>`).join("")}</tr></thead><tbody id="cmp-trade-log"></tbody></table></div>
    </section>
    <div class="strategy-compare-grid two">
      ${chartCard("cmp-mfe-mae", "MFE vs MAE")}
      ${chartCard("cmp-pnl-hist", "P&L distribution")}
      ${chartCard("cmp-eff", "Entry & exit efficiency")}
      ${heatmapShell("cmp-dow", "Day-of-week performance")}
      ${heatmapShell("cmp-session", "Session performance")}
      ${tableShell("cmp-symbol-overlap", "Symbol overlap")}
      ${chartCard("cmp-win-loss", "Win/Loss size ratio")}
    </div>
  `;
  $("cmp-trade-result-filter").value = _strategyCompareTradeFilter.result;
  bindTradeFilters();
  const trades = getFilteredCompareTrades(strategies);
  renderTradeLog(trades);
  chart("cmp-mfe-mae", { type: "scatter", data: { datasets: strategies.map((s) => ({ label: s.name, data: trades.filter((t) => t.strategyId === s.id).map((t) => ({ x: t.maePct, y: t.mfePct })), backgroundColor: getCompareColor(s.id), pointRadius: 4 })) }, options: baseChartOptions({ xTitle: "MAE %", yTitle: "MFE %" }) });
  const buckets = buildHistogramBuckets(trades.map((t) => t.returnPct), 8);
  groupedBar("cmp-pnl-hist", buckets.map((b) => `${num(b)}%`), strategies, (s) => bucketCounts(trades.filter((t) => t.strategyId === s.id).map((t) => t.returnPct), buckets));
  groupedBar("cmp-eff", ["Entry", "Exit"], strategies, (s) => [s.metrics.entryEfficiency, s.metrics.exitEfficiency]);
  renderHeatmap("cmp-dow", strategies.map((s) => s.name), ["Mon", "Tue", "Wed", "Thu", "Fri"], (r, c) => avg(strategies[r].trades.filter((t) => new Date(t.entryDate).getDay() === c + 1).map((t) => t.pnl)));
  renderHeatmap("cmp-session", strategies.map((s) => s.name), ["Open", "Midday", "Close"], (r, c) => avg(strategies[r].trades.filter((t, i) => getTradeSessionBucket(t, i) === c).map((t) => t.pnl)));
  renderSymbolOverlap("cmp-symbol-overlap", strategies);
  groupedBar("cmp-win-loss", ["Avg winner", "Avg loser"], strategies, (s) => [s.metrics.avgWinner, Math.abs(s.metrics.avgLoser)]);
}

function renderCompareCapacity(content, strategies) {
  content.innerHTML = `
    <div class="strategy-compare-grid two">
      ${chartCard("cmp-costs", "Cost drag breakdown")}
      ${chartCard("cmp-gross-net", "Net vs Gross return")}
    </div>
    ${chartCard("cmp-capacity", "Capacity / scalability curve", "wide")}
  `;
  const labels = strategies.map((s) => s.name);
  chart("cmp-costs", {
    type: "bar",
    data: { labels, datasets: ["commission", "slippage", "spread", "impact"].map((k, i) => ({ label: humanCompareMetric(k), data: strategies.map((s) => s.costs[k]), backgroundColor: STRATEGY_COMPARE_MOCK_DATA.palette[i] })) },
    options: baseChartOptions({ stacked: true }),
  });
  groupedBar("cmp-gross-net", ["Gross", "Net"], strategies, (s) => [s.metrics.totalReturn + Object.values(s.costs).reduce((a, b) => a + b, 0), s.metrics.totalReturn]);
  lineChart("cmp-capacity", strategies[0].capacity.map((p) => `${p.aum}Cr`), strategies.map((s) => lineDataset(s.name, s.capacity.map((p) => p.ret), getCompareColor(s.id))));
}

function renderFullMetricsTable(content, strategies) {
  content.innerHTML = `${tableShell("cmp-full-table", "Full comparison table")}`;
  renderSummaryMetricsTable("cmp-full-table", strategies);
}

function getCompareAvailableItems() {
  const current = _strategyCompareCustomRuns.has("current-backtest") ? [_strategyCompareCustomRuns.get("current-backtest")] : [];
  const custom = [..._strategyCompareCustomRuns.values()].filter((item) => item.id !== "current-backtest");
  const backtests = (typeof _strategyBacktestListCache !== "undefined" ? _strategyBacktestListCache : []);
  const saved = (typeof _strategyListCache !== "undefined" ? _strategyListCache : []).map((strategy) => {
    const latestRun = backtests.find((run) => (
      (strategy.id && run.strategy_id === strategy.id) ||
      (strategy.name && run.strategy_name === strategy.name)
    ));
    return {
      id: `strategy:${strategy.id}`,
      runId: latestRun?.run_id || null,
      strategyId: strategy.id,
      name: strategy.name || "Untitled Strategy",
      type: "strategy",
      summary: { returnPct: Number(latestRun?.metrics?.return_pct ?? latestRun?.metrics?.bt_return_pct) },
      item: latestRun || { strategy_id: strategy.id, strategy_name: strategy.name, metrics: {} },
    };
  });
  const runs = backtests
    .filter((item) => !saved.some((strategy) => strategy.runId === item.run_id))
    .map((item) => ({
    id: `run:${item.run_id}`,
    runId: item.run_id,
    strategyId: item.strategy_id,
    name: item.strategy_name || item.name || "Backtest",
    type: "backtest",
    summary: { returnPct: Number(item.metrics?.return_pct ?? item.metrics?.bt_return_pct) },
    item,
  }));
  if (current.length || custom.length || saved.length || runs.length) return [...current, ...custom, ...saved, ...runs];
  return [{
    id: "empty-demo",
    name: "No backtest loaded",
    type: "empty",
    summary: {},
    result: buildEmptyCompareResult(),
  }];
}

function getSelectedCompareStrategies() {
  return [..._strategyCompareSelectedIds].map((id) => {
    const item = getCompareAvailableItems().find((entry) => entry.id === id);
    if (!item) return null;
    if (item.result) return buildCompareStrategyFromResult(item.id, item.name, item.result, item.item);
    if (item.runId && _strategyCompareRunCache.has(item.runId)) {
      const cached = _strategyCompareRunCache.get(item.runId);
      return buildCompareStrategyFromResult(item.id, item.name, cached.result || {}, cached.item || item.item);
    }
    return buildCompareStrategyFromResult(item.id, item.name, { metrics: item.item?.metrics || {}, equity_curve: [], trades: [] }, item.item);
  }).filter(Boolean);
}

function hydrateSelectedCompareRuns() {
  if (!window.strategyStorageApi?.loadBacktest) return;
  getCompareAvailableItems().forEach((item) => {
    if (!_strategyCompareSelectedIds.has(item.id) || !item.runId || _strategyCompareRunCache.has(item.runId) || _strategyCompareHydrating.has(item.runId)) return;
    _strategyCompareHydrating.add(item.runId);
    window.strategyStorageApi.loadBacktest(item.runId)
      .then((payload) => {
        const loaded = payload.item || {};
        _strategyCompareRunCache.set(item.runId, { item: loaded, result: loaded.result || {} });
        renderStrategyCompareLab();
      })
      .catch((error) => {
        console.error(error);
        _appendStrategyLog?.(`Compare load failed for ${item.runId}: ${error.message}`);
      })
      .finally(() => _strategyCompareHydrating.delete(item.runId));
  });
}

function addCurrentBacktestToCompare() {
  const payload = typeof _strategyLatestRunPayload !== "undefined" ? _strategyLatestRunPayload : null;
  if (!payload) {
    showStrategyToast("Run or load a backtest before adding it to Compare");
    return;
  }
  const id = "current-backtest";
  _strategyCompareCustomRuns.set(id, {
    id,
    name: ($("strategy-name")?.value || payload.history_item?.strategy_name || "Current Backtest").trim(),
    type: "current",
    result: payload,
    item: payload.history_item || {},
    summary: { returnPct: Number(payload.metrics?.return_pct ?? payload.metrics?.bt_return_pct) },
  });
  _strategyCompareSelectedIds.add(id);
  renderStrategyCompareLab();
}

function renderBacktestPicker() {
  const picker = $("strategy-compare-picker");
  if (!picker) return;
  const runs = getCompareAvailableItems().filter((item) => item.type === "backtest");
  picker.classList.toggle("hidden");
  picker.innerHTML = `<div class="strategy-compare-picker-head"><strong>Recent backtests</strong><button id="strategy-compare-picker-close" type="button" class="icon-button">x</button></div>
    <div class="strategy-compare-picker-grid">${runs.map((run) => `<button type="button" data-pick-run="${escapeStrategyHtml(run.id)}">${escapeStrategyHtml(run.name)} / ${pct(run.summary.returnPct)}</button>`).join("") || '<span class="strategy-empty-state">No saved backtests yet.</span>'}</div>`;
  $("strategy-compare-picker-close")?.addEventListener("click", () => picker.classList.add("hidden"));
  picker.querySelectorAll("[data-pick-run]").forEach((button) => {
    button.addEventListener("click", () => {
      _strategyCompareSelectedIds.add(button.dataset.pickRun);
      renderStrategyCompareLab();
    });
  });
}

function renderOptimizerRunPicker() {
  const picker = $("strategy-compare-picker");
  if (!picker) return;
  const rows = ((typeof _strategyLatestOptimizationPayload !== "undefined" ? _strategyLatestOptimizationPayload : null)?.leaderboard || []).slice(0, 10);
  picker.classList.toggle("hidden");
  picker.innerHTML = `<div class="strategy-compare-picker-head"><strong>Top optimizer runs</strong><button id="strategy-compare-picker-close" type="button" class="icon-button">x</button></div>
    <div class="strategy-compare-picker-grid">${rows.map((row, i) => `<button type="button" data-pick-opt="${i}">#${i + 1} / ${pct(row.metrics?.return_pct)} / Sharpe ${num(row.metrics?.sharpe)}</button>`).join("") || '<span class="strategy-empty-state">Run optimization before adding optimizer results.</span>'}</div>`;
  $("strategy-compare-picker-close")?.addEventListener("click", () => picker.classList.add("hidden"));
  picker.querySelectorAll("[data-pick-opt]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = rows[Number(button.dataset.pickOpt)];
      const id = `optimizer:${Date.now()}:${button.dataset.pickOpt}`;
      const baseResult = typeof _strategyLatestRunPayload !== "undefined" ? _strategyLatestRunPayload : {};
      _strategyCompareCustomRuns.set(id, {
        id,
        name: `Optimizer #${Number(button.dataset.pickOpt) + 1}`,
        type: "optimizer",
        result: { ...baseResult, metrics: { ...(baseResult.metrics || {}), ...(row.metrics || {}) }, equity_curve: row.equity_curve || baseResult.equity_curve || [], trades: row.trades || baseResult.trades || [] },
        item: { params: row.params || {} },
        summary: { returnPct: Number(row.metrics?.return_pct) },
      });
      _strategyCompareSelectedIds.add(id);
      renderStrategyCompareLab();
    });
  });
}

function buildCompareStrategyFromResult(id, name, result, item = {}) {
  const equity = normalizeEquity(result.equity_curve || [], result.metrics || {});
  const trades = normalizeTrades(result.trades || [], id, name, item.symbol || result.context?.symbol);
  const benchmark = equity.map((p) => p.buy_hold).filter(Number.isFinite);
  const returns = pctReturns(equity.map((p) => p.equity));
  const benchmarkReturns = pctReturns(benchmark.length === equity.length ? benchmark : []);
  const drawdown = buildDrawdown(equity);
  const metrics = computeCompareMetrics(result.metrics || item.metrics || {}, equity, trades, returns, benchmarkReturns, drawdown);
  const annual = computeAnnualReturns(equity);
  const rollingSharpe = rollingMetric(equity, returns, 90, (slice) => sharpeRatio(slice));
  const rollingVol = rollingMetric(equity, returns, 90, (slice) => volatilityPct(slice));
  const varCvar = computeVarCvar(returns);
  const regimes = computeRegimeReturns(equity, returns, benchmarkReturns);
  const stress = computeStressReturns(equity);
  const mc = buildMonteCarlo(equity[0]?.equity || 100000, returns, id);
  const costs = computeCosts(result.metrics || {}, equity, trades);
  return {
    id,
    name,
    color: getCompareColor(id),
    equity,
    trades,
    returnsPct: returns.map((v) => v * 100),
    drawdown,
    metrics,
    annual,
    rollingSharpe,
    rollingVol,
    varCvar,
    regimes,
    stress,
    monteCarlo: mc.fan,
    terminalWealth: mc.terminal,
    goals: mc.goals,
    costs,
    capacity: computeCapacity(metrics.cagr, costs, trades),
  };
}

function normalizeEquity(points, metrics = {}) {
  const rows = (points || []).map((p, i) => {
    const equity = Number(p.equity ?? p.Equity ?? p.value ?? p.portfolio_value);
    const buyHold = Number(p.buy_hold ?? p.buyHold ?? p.benchmark ?? p.BuyHold);
    return {
      time: String(p.time ?? p.date ?? p.Date ?? i),
      equity: Number.isFinite(equity) ? equity : null,
      buy_hold: Number.isFinite(buyHold) ? buyHold : null,
    };
  }).filter((p) => Number.isFinite(p.equity));
  if (rows.length) {
    let firstBh = rows.find((p) => Number.isFinite(p.buy_hold))?.buy_hold ?? rows[0].equity;
    rows.forEach((p) => { if (!Number.isFinite(p.buy_hold)) p.buy_hold = firstBh; firstBh = p.buy_hold; });
    return rows;
  }
  const start = Number(metrics.initial_cash || metrics.starting_equity || 100000);
  const ret = Number(metrics.return_pct ?? metrics.bt_return_pct ?? 0) / 100;
  return [{ time: "Start", equity: start, buy_hold: start }, { time: "End", equity: start * (1 + ret), buy_hold: start * 1.05 }];
}

function normalizeTrades(trades, strategyId, strategy, fallbackSymbol = "") {
  return (trades || []).map((trade, index) => {
    const entryPrice = Number(trade.entry_price ?? trade.EntryPrice ?? trade.entry ?? trade.Entry);
    const exitPrice = Number(trade.exit_price ?? trade.ExitPrice ?? trade.exit ?? trade.Exit);
    const pnl = Number(trade.pnl ?? trade.PnL ?? trade.pl ?? 0);
    const returnPct = Number(trade.pnl_pct ?? trade.ReturnPct ?? trade.return_pct ?? (Number.isFinite(entryPrice) && entryPrice ? ((exitPrice / entryPrice) - 1) * 100 : 0));
    const mfePct = Number(trade.mfe_pct ?? trade.MFEPct ?? trade.mfe ?? 0);
    const maePct = Number(trade.mae_pct ?? trade.MAEPct ?? trade.mae ?? 0);
    return {
      strategyId,
      strategy,
      symbol: String(trade.symbol ?? trade.Symbol ?? fallbackSymbol ?? "--").replace(/^NSE:/, ""),
      direction: String(trade.side ?? trade.direction ?? trade.Direction ?? "LONG").toUpperCase(),
      entryDate: formatCompareDate(trade.entry_time ?? trade.entry_date ?? trade.EntryTime ?? trade.EntryDate ?? index),
      entryPrice: Number.isFinite(entryPrice) ? entryPrice : 0,
      exitDate: formatCompareDate(trade.exit_time ?? trade.exit_date ?? trade.ExitTime ?? trade.ExitDate ?? index),
      exitPrice: Number.isFinite(exitPrice) ? exitPrice : 0,
      duration: Number(trade.days_held ?? trade.bars_held ?? trade.Duration ?? trade.Bars ?? 0),
      pnl,
      returnPct,
      mfePct,
      maePct,
      efficiency: computeTradeEfficiency(returnPct, mfePct, maePct),
    };
  });
}

function computeCompareMetrics(raw, equity, trades, returns, benchmarkReturns, drawdown) {
  const start = equity[0]?.equity || 0;
  const end = equity[equity.length - 1]?.equity || start;
  const totalReturn = finiteOr(Number(raw.return_pct ?? raw.bt_return_pct), start ? ((end / start) - 1) * 100 : 0);
  const cagr = finiteOr(Number(raw.cagr ?? raw.bt_return_ann_pct), computeCagr(equity));
  const volatility = finiteOr(Number(raw.volatility ?? raw.bt_volatility_ann_pct), volatilityPct(returns));
  const maxDrawdown = finiteOr(Number(raw.max_drawdown ?? raw.bt_max_drawdown_pct), Math.min(...drawdown.map((p) => p.drawdown), 0));
  const totalTrades = finiteOr(Number(raw.total_trades ?? raw.bt_trades), trades.length);
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const avgWinner = avg(wins.map((t) => t.pnl));
  const avgLoser = avg(losses.map((t) => t.pnl));
  const winRate = finiteOr(Number(raw.win_rate ?? raw.bt_win_rate_pct), totalTrades ? wins.length / totalTrades * 100 : 0);
  const profitFactor = finiteOr(Number(raw.profit_factor ?? raw.bt_profit_factor), grossLoss ? grossProfit / grossLoss : (grossProfit ? grossProfit : 0));
  const expectancy = finiteOr(Number(raw.expectancy ?? raw.bt_expectancy_pct), totalTrades ? (grossProfit - grossLoss) / totalTrades : 0);
  const relationship = computeBenchmarkRelationship(returns, benchmarkReturns);
  const ddDuration = longestDrawdownDuration(drawdown);
  return {
    totalReturn, cagr, volatility, maxDrawdown,
    sharpe: finiteOr(Number(raw.sharpe ?? raw.bt_sharpe_ratio), sharpeRatio(returns)),
    sortino: finiteOr(Number(raw.sortino ?? raw.bt_sortino_ratio), sortinoRatio(returns)),
    calmar: finiteOr(Number(raw.calmar ?? raw.bt_calmar_ratio), Math.abs(maxDrawdown) ? cagr / Math.abs(maxDrawdown) : 0),
    omega: omegaRatio(returns),
    tailRatio: tailRatio(returns),
    winRate, profitFactor, expectancy,
    avgTrade: finiteOr(Number(raw.avg_trade), avg(trades.map((t) => t.pnl))),
    bestTrade: finiteOr(Number(raw.best_trade), Math.max(...trades.map((t) => t.pnl), 0)),
    worstTrade: finiteOr(Number(raw.worst_trade), Math.min(...trades.map((t) => t.pnl), 0)),
    totalTrades,
    avgDuration: totalTrades ? `${num(avg(trades.map((t) => t.duration)), 1)}d` : "--",
    beta: relationship.beta,
    alpha: relationship.alpha,
    correlation: relationship.correlation,
    skewness: skewness(returns),
    kurtosis: kurtosis(returns),
    ulcerIndex: ulcerIndex(drawdown),
    maxDrawdownDuration: ddDuration,
    avgWinner,
    avgLoser,
    winLossRatio: Math.abs(avgLoser) ? avgWinner / Math.abs(avgLoser) : 0,
    entryEfficiency: avg(trades.map((t) => t.efficiency)),
    exitEfficiency: avg(trades.map((t) => t.mfePct ? Math.max(0, Math.min(100, (t.returnPct / t.mfePct) * 100)) : t.efficiency)),
  };
}

function computeAnnualReturns(equity) {
  const years = {};
  equity.forEach((point) => {
    const year = String(point.time).slice(0, 4);
    if (!/^\d{4}$/.test(year)) return;
    if (!years[year]) years[year] = { start: point.equity, end: point.equity };
    years[year].end = point.equity;
  });
  return Object.fromEntries(Object.entries(years).map(([year, v]) => [year, v.start ? ((v.end / v.start) - 1) * 100 : 0]));
}

function buildDrawdown(equity) {
  let peak = equity[0]?.equity || 0;
  return equity.map((point) => {
    peak = Math.max(peak, point.equity);
    return { time: point.time, drawdown: peak ? ((point.equity / peak) - 1) * 100 : 0 };
  });
}

function computeRegimeReturns(equity, returns, benchmarkReturns) {
  const buckets = Object.fromEntries(STRATEGY_COMPARE_MOCK_DATA.regimes.map((r) => [r, []]));
  const benchVol = rollingStd(benchmarkReturns, 20);
  returns.forEach((ret, i) => {
    const b = benchmarkReturns[i] ?? ret;
    const vol = benchVol[i] ?? 0;
    if (b > 0.01) buckets["Bull Trend"].push(ret);
    if (b < -0.01) buckets["Bear Trend"].push(ret);
    if (vol > 0.018) buckets["High Vol"].push(ret);
    if (vol <= 0.018) buckets["Low Vol"].push(ret);
    if (i > 0 && benchmarkReturns[i - 1] < 0 && b > 0) buckets.Recovery.push(ret);
    if (b < -0.035) buckets.Crash.push(ret);
    if (Math.abs(b) <= 0.004) buckets.Sideways.push(ret);
    if (i % 4 === 0) buckets["Rate Rising"].push(ret);
  });
  return Object.fromEntries(Object.entries(buckets).map(([k, vals]) => [k, vals.length ? compoundReturn(vals) * 100 : null]));
}

function computeStressReturns(equity) {
  return Object.fromEntries(STRATEGY_COMPARE_MOCK_DATA.crises.map(([name, start, end]) => {
    const rows = equity.filter((p) => p.time >= start && p.time <= end);
    if (rows.length < 2) return [name, null];
    return [name, ((rows[rows.length - 1].equity / rows[0].equity) - 1) * 100];
  }));
}

function buildMonteCarlo(initial, returns, seedText) {
  const source = returns.length ? returns : [0];
  const horizon = Math.max(24, Math.min(120, source.length || 60));
  const paths = 10000;
  const seedBase = hashString(seedText);
  const byStep = Array.from({ length: horizon }, () => []);
  const terminal = [];
  for (let path = 0; path < paths; path += 1) {
    let value = initial || 100000;
    let seed = seedBase + path * 7919;
    for (let step = 0; step < horizon; step += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const ret = source[seed % source.length] || 0;
      value *= 1 + ret;
      if (path % 20 === 0) byStep[step].push(value);
    }
    terminal.push(value);
  }
  const fan = byStep.map((values, step) => ({ step, p10: percentile(values, 10), p25: percentile(values, 25), median: percentile(values, 50), p75: percentile(values, 75), p90: percentile(values, 90) }));
  const goals = Object.fromEntries(STRATEGY_COMPARE_MOCK_DATA.goals.map(([name, multiple]) => [name, terminal.filter((v) => v >= initial * multiple).length / terminal.length * 100]));
  goals["50% loss"] = terminal.filter((v) => v <= initial * 0.5).length / terminal.length * 100;
  return { fan, terminal, goals };
}

function computeCosts(raw, equity, trades) {
  const initial = equity[0]?.equity || 100000;
  const commission = Number(raw.commission_paid || 0) / initial * 100;
  const slippage = Number(raw.slippage_cost || 0) / initial * 100;
  const turnoverProxy = trades.reduce((sum, t) => sum + Math.abs(t.entryPrice || 0), 0) / Math.max(initial, 1);
  return {
    commission: finiteOr(commission, 0),
    slippage: finiteOr(slippage, 0),
    spread: turnoverProxy * 0.02,
    impact: turnoverProxy * 0.03,
  };
}

function computeCapacity(cagr, costs, trades) {
  const turnover = Math.max(1, trades.length / 50);
  return [1, 5, 10, 25, 50, 100, 250].map((aum) => ({ aum, ret: Math.max(-100, cagr - Math.log10(aum + 1) * turnover - costs.impact * aum / 25) }));
}

function computeVarCvar(returns) {
  const vals = returns.map((r) => r * 100).sort((a, b) => a - b);
  const var95 = percentile(vals, 5);
  const var99 = percentile(vals, 1);
  return {
    var95,
    cvar95: avg(vals.filter((v) => v <= var95)),
    var99,
    cvar99: avg(vals.filter((v) => v <= var99)),
  };
}

function computeBenchmarkRelationship(returns, benchmarkReturns) {
  if (!returns.length || benchmarkReturns.length !== returns.length) return { beta: 0, alpha: 0, correlation: 0 };
  const cov = covariance(returns, benchmarkReturns);
  const varBench = variance(benchmarkReturns);
  const beta = varBench ? cov / varBench : 0;
  const alpha = (mean(returns) - beta * mean(benchmarkReturns)) * 252 * 100;
  return { beta, alpha, correlation: correlation(returns, benchmarkReturns) };
}

function renderSummaryMetricsTable(id, strategies) {
  const rows = [
    ["Total Return %", "totalReturn"], ["CAGR", "cagr"], ["Volatility", "volatility"], ["Max Drawdown", "maxDrawdown"],
    ["Sharpe", "sharpe"], ["Sortino", "sortino"], ["Calmar", "calmar"], ["Omega", "omega"], ["Tail Ratio", "tailRatio"],
    ["Win Rate", "winRate"], ["Profit Factor", "profitFactor"], ["Expectancy", "expectancy"], ["Avg Trade", "avgTrade"],
    ["Best Trade", "bestTrade"], ["Worst Trade", "worstTrade"], ["Total Trades", "totalTrades"], ["Avg Duration", "avgDuration"],
    ["Beta", "beta"], ["Alpha", "alpha"], ["Correlation to Benchmark", "correlation"],
  ];
  renderSimpleTable(id, ["Metric", ...strategies.map((s) => s.name)], rows.map(([label, key]) => [label, ...strategies.map((s) => formatCompareMetric(key, s.metrics[key]))]));
}

function renderSimpleTable(id, headers, rows) {
  const node = $(id);
  if (!node) return;
  node.innerHTML = `<table class="strategy-results-table"><thead><tr>${headers.map((h) => `<th>${escapeStrategyHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeStrategyHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderHeatmap(id, rowLabels, colLabels, getValue) {
  const node = $(id);
  if (!node) return;
  node.style.gridTemplateColumns = `minmax(118px, 1.2fr) repeat(${colLabels.length}, minmax(82px, 1fr))`;
  const cells = ['<span class="corner"></span>'];
  colLabels.forEach((c) => cells.push(`<strong>${escapeStrategyHtml(c)}</strong>`));
  rowLabels.forEach((r, ri) => {
    cells.push(`<strong>${escapeStrategyHtml(r)}</strong>`);
    colLabels.forEach((_, ci) => {
      const value = getValue(ri, ci);
      cells.push(`<span class="strategy-compare-heat-cell" style="background:${heatColor(value)}">${Number.isFinite(Number(value)) ? num(value, 1) : "--"}</span>`);
    });
  });
  node.innerHTML = cells.join("");
}

function renderTradeLog(trades) {
  const body = $("cmp-trade-log");
  if (!body) return;
  body.innerHTML = trades.map((t) => `<tr>
    <td>${escapeStrategyHtml(t.strategy)}</td><td>${escapeStrategyHtml(t.symbol)}</td><td>${escapeStrategyHtml(t.direction)}</td>
    <td>${escapeStrategyHtml(t.entryDate)}</td><td>${num(t.entryPrice)}</td><td>${escapeStrategyHtml(t.exitDate)}</td><td>${num(t.exitPrice)}</td>
    <td>${num(t.duration, 1)}d</td><td class="${t.pnl >= 0 ? "metric-positive" : "metric-negative"}">${money(t.pnl)}</td><td>${pct(t.returnPct)}</td>
    <td>${pct(t.mfePct)}</td><td>${pct(t.maePct)}</td><td>${pct(t.efficiency)}</td>
  </tr>`).join("") || '<tr><td colspan="13" class="strategy-empty-cell">No trades match the filters.</td></tr>';
}

function bindTradeFilters() {
  const strategySelect = $("cmp-trade-strategy-filter");
  strategySelect?.addEventListener("change", () => {
    _strategyCompareTradeFilter.strategies = new Set([...strategySelect.selectedOptions].map((o) => o.value));
    renderStrategyCompareViews();
  });
  ["cmp-trade-symbol-filter", "cmp-trade-result-filter", "cmp-trade-start-filter", "cmp-trade-end-filter"].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      _strategyCompareTradeFilter.symbol = $("cmp-trade-symbol-filter")?.value || "";
      _strategyCompareTradeFilter.result = $("cmp-trade-result-filter")?.value || "all";
      _strategyCompareTradeFilter.start = $("cmp-trade-start-filter")?.value || "";
      _strategyCompareTradeFilter.end = $("cmp-trade-end-filter")?.value || "";
      renderStrategyCompareViews();
    });
  });
}

function getFilteredCompareTrades(strategies) {
  let trades = strategies.flatMap((s) => s.trades.map((t) => ({ ...t, strategyId: s.id, strategy: s.name })));
  const selected = _strategyCompareTradeFilter.strategies;
  if (selected.size) trades = trades.filter((t) => selected.has(t.strategyId));
  if (_strategyCompareTradeFilter.symbol) trades = trades.filter((t) => t.symbol.toLowerCase().includes(_strategyCompareTradeFilter.symbol.toLowerCase()));
  if (_strategyCompareTradeFilter.result === "winners") trades = trades.filter((t) => t.pnl >= 0);
  if (_strategyCompareTradeFilter.result === "losers") trades = trades.filter((t) => t.pnl < 0);
  if (_strategyCompareTradeFilter.start) trades = trades.filter((t) => t.entryDate >= _strategyCompareTradeFilter.start);
  if (_strategyCompareTradeFilter.end) trades = trades.filter((t) => t.entryDate <= _strategyCompareTradeFilter.end);
  return trades;
}

function renderSymbolOverlap(id, strategies) {
  const keys = new Map();
  strategies.forEach((s) => s.trades.forEach((t) => {
    const key = `${t.symbol}|${t.entryDate}`;
    if (!keys.has(key)) keys.set(key, {});
    keys.get(key)[s.id] = t;
  }));
  const rows = [...keys.entries()].filter(([, byStrategy]) => Object.keys(byStrategy).length > 1).slice(0, 12).map(([key, byStrategy]) => {
    const [symbol, date] = key.split("|");
    return [symbol, date, ...strategies.map((s) => byStrategy[s.id] ? `${pct(byStrategy[s.id].returnPct)} / ${money(byStrategy[s.id].pnl)}` : "--")];
  });
  renderSimpleTable(id, ["Symbol", "Date", ...strategies.map((s) => s.name)], rows.length ? rows : [["--", "--", ...strategies.map(() => "No overlap")]]);
}

function getTradeSessionBucket(trade, index) {
  const parsed = new Date(trade.entryDate);
  if (!Number.isNaN(parsed.getTime())) {
    const hour = parsed.getHours();
    if (hour && hour < 11) return 0;
    if (hour && hour < 14) return 1;
    if (hour) return 2;
  }
  return index % 3;
}

function chartCard(id, title, extra = "") {
  return `<section class="strategy-compare-card ${extra}"><div class="strategy-compare-card-head"><h4>${escapeStrategyHtml(title)}</h4></div><div class="strategy-compare-canvas-wrap"><canvas id="${id}"></canvas></div></section>`;
}

function tableShell(id, title) {
  return `<section class="strategy-compare-card wide"><div class="strategy-compare-card-head"><h4>${escapeStrategyHtml(title)}</h4></div><div id="${id}" class="strategy-table-shell"></div></section>`;
}

function heatmapShell(id, title) {
  return `<section class="strategy-compare-card wide"><div class="strategy-compare-card-head"><h4>${escapeStrategyHtml(title)}</h4></div><div id="${id}" class="strategy-compare-heatmap"></div></section>`;
}

function chart(id, config) {
  const canvas = $(id);
  if (!canvas || !window.Chart) return null;
  const instance = new Chart(canvas.getContext("2d"), config);
  _strategyCompareCharts.push(instance);
  return instance;
}

function lineChart(id, labels, datasets, extra = {}) {
  return chart(id, { type: "line", data: { labels, datasets }, options: baseChartOptions(extra) });
}

function barChart(id, labels, datasets, extra = {}) {
  return chart(id, { type: "bar", data: { labels, datasets }, options: baseChartOptions(extra) });
}

function groupedBar(id, labels, strategies, getValues, extra = {}) {
  return barChart(id, labels, strategies.map((s) => ({ label: s.name, data: getValues(s), backgroundColor: hexToRgba(getCompareColor(s.id), 0.68), borderColor: getCompareColor(s.id), borderWidth: 1 })), extra);
}

function lineDataset(label, data, color) {
  return { label, data, borderColor: color, backgroundColor: "transparent", pointRadius: 0, tension: 0.18, fill: false };
}

function baseChartOptions(opts = {}) {
  return {
    maintainAspectRatio: false,
    indexAxis: opts.indexAxis,
    plugins: { legend: { display: true, position: "bottom", labels: { color: "#8b92a8", boxWidth: 10, font: { size: 10 } } } },
    scales: {
      x: { stacked: opts.stacked, title: opts.xTitle ? { display: true, text: opts.xTitle } : undefined, grid: { color: "rgba(148,163,184,.10)" }, ticks: { color: "#8b92a8", maxTicksLimit: 9 } },
      y: { stacked: opts.stacked, title: opts.yTitle ? { display: true, text: opts.yTitle } : undefined, grid: { color: "rgba(148,163,184,.10)" }, ticks: { color: "#8b92a8", callback: opts.yMoney ? (value) => formatCompactValue(Number(value)) : undefined } },
    },
  };
}

function radarOptions() {
  return { maintainAspectRatio: false, plugins: { legend: { display: true, position: "bottom", labels: { color: "#8b92a8", boxWidth: 10, font: { size: 10 } } } }, scales: { r: { grid: { color: "rgba(148,163,184,.14)" }, angleLines: { color: "rgba(148,163,184,.14)" }, pointLabels: { color: "#8b92a8" }, ticks: { color: "#8b92a8", backdropColor: "transparent" } } } };
}

function destroyCompareCharts() {
  _strategyCompareCharts.forEach((c) => c.destroy());
  _strategyCompareCharts = [];
}

function exportCompareCsv() {
  const strategies = getSelectedCompareStrategies();
  const rows = [["metric", ...strategies.map((s) => s.name)]];
  [["totalReturn", "Total Return"], ["cagr", "CAGR"], ["volatility", "Volatility"], ["maxDrawdown", "Max Drawdown"], ["sharpe", "Sharpe"], ["sortino", "Sortino"], ["calmar", "Calmar"], ["omega", "Omega"], ["tailRatio", "Tail Ratio"], ["winRate", "Win Rate"], ["profitFactor", "Profit Factor"]]
    .forEach(([key, label]) => rows.push([label, ...strategies.map((s) => s.metrics[key])]));
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "strategy-compare.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function getCompareColor(id) {
  if (!_strategyCompareColors[id]) _strategyCompareColors[id] = STRATEGY_COMPARE_MOCK_DATA.palette[Object.keys(_strategyCompareColors).length % STRATEGY_COMPARE_MOCK_DATA.palette.length];
  return _strategyCompareColors[id];
}

function buildEmptyCompareResult() {
  return { metrics: { return_pct: 0 }, equity_curve: [{ time: "Start", equity: 100000, buy_hold: 100000 }, { time: "End", equity: 100000, buy_hold: 100000 }], trades: [] };
}

function pctReturns(values) {
  const rows = [];
  for (let i = 1; i < values.length; i += 1) {
    const prev = Number(values[i - 1]);
    const next = Number(values[i]);
    if (Number.isFinite(prev) && Number.isFinite(next) && prev !== 0) rows.push((next / prev) - 1);
  }
  return rows;
}

function compoundReturn(returns) {
  return returns.reduce((acc, r) => acc * (1 + r), 1) - 1;
}

function computeCagr(equity) {
  if (equity.length < 2) return 0;
  const start = equity[0].equity;
  const end = equity[equity.length - 1].equity;
  const years = Math.max(daysBetween(equity[0].time, equity[equity.length - 1].time) / 365.25, equity.length / 252);
  return start > 0 && years > 0 ? (Math.pow(end / start, 1 / years) - 1) * 100 : 0;
}

function volatilityPct(returns) {
  return std(returns) * Math.sqrt(252) * 100;
}

function sharpeRatio(returns) {
  const s = std(returns);
  return s ? mean(returns) / s * Math.sqrt(252) : 0;
}

function sortinoRatio(returns) {
  const downside = returns.filter((r) => r < 0);
  const s = std(downside);
  return s ? mean(returns) / s * Math.sqrt(252) : 0;
}

function omegaRatio(returns) {
  const gains = returns.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const losses = Math.abs(returns.filter((r) => r < 0).reduce((a, b) => a + b, 0));
  return losses ? gains / losses : (gains ? gains : 0);
}

function tailRatio(returns) {
  const vals = returns.map((r) => r * 100).sort((a, b) => a - b);
  const left = Math.abs(percentile(vals, 5));
  const right = percentile(vals, 95);
  return left ? right / left : 0;
}

function skewness(values) {
  const m = mean(values);
  const s = std(values);
  return s ? mean(values.map((v) => Math.pow((v - m) / s, 3))) : 0;
}

function kurtosis(values) {
  const m = mean(values);
  const s = std(values);
  return s ? mean(values.map((v) => Math.pow((v - m) / s, 4))) : 0;
}

function ulcerIndex(drawdown) {
  return Math.sqrt(mean(drawdown.map((p) => Math.pow(Math.min(0, p.drawdown), 2))));
}

function longestDrawdownDuration(drawdown) {
  let longest = 0;
  let current = 0;
  drawdown.forEach((p) => {
    if (p.drawdown < 0) current += 1;
    else current = 0;
    longest = Math.max(longest, current);
  });
  return longest;
}

function rollingMetric(equity, returns, windowSize, fn) {
  return equity.slice(1).map((p, index) => {
    const start = Math.max(0, index - windowSize + 1);
    return { time: p.time, value: fn(returns.slice(start, index + 1)) };
  });
}

function rollingStd(values, windowSize) {
  return values.map((_, i) => std(values.slice(Math.max(0, i - windowSize + 1), i + 1)));
}

function computeTradeEfficiency(returnPct, mfePct, maePct) {
  const excursion = Math.abs(mfePct) + Math.abs(maePct);
  if (!excursion) return returnPct > 0 ? 70 : 35;
  return Math.max(0, Math.min(100, ((returnPct - maePct) / excursion) * 100));
}

function correlationForPair(a, b, crisisOnly = false) {
  let ar = a.returnsPct.map((v) => v / 100);
  let br = b.returnsPct.map((v) => v / 100);
  const len = Math.min(ar.length, br.length);
  ar = ar.slice(0, len);
  br = br.slice(0, len);
  if (crisisOnly) {
    const idx = ar.map((v, i) => ({ v, i })).filter((x) => x.v < -0.01).map((x) => x.i);
    ar = idx.map((i) => ar[i]);
    br = idx.map((i) => br[i]);
  }
  return correlation(ar, br);
}

function alignSeries(points, labels, key) {
  const map = new Map(points.map((p) => [String(p.time), p[key]]));
  return labels.map((label) => map.has(label) ? map.get(label) : null);
}

function unionLabels(groups) {
  return [...new Set(groups.flat().map(String))].sort();
}

function buildHistogramBuckets(values, count) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return [0, 1];
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const step = (max - min || 1) / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, i) => min + i * step);
}

function bucketCounts(values, buckets) {
  return buckets.map((bucket, i) => values.filter((value) => Number(value) >= bucket && Number(value) < (buckets[i + 1] ?? Infinity)).length);
}

function formatCompareMetric(key, value) {
  if (key === "avgDuration") return value || "--";
  if (["totalReturn", "cagr", "volatility", "maxDrawdown", "winRate", "alpha", "correlation"].includes(key)) return pct(value);
  if (["expectancy", "avgTrade", "bestTrade", "worstTrade"].includes(key)) return money(value);
  return num(value);
}

function humanCompareMetric(key) {
  return String(key).replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function heatColor(value) {
  if (!Number.isFinite(Number(value))) return "rgba(127, 133, 150, 0.12)";
  const v = Math.max(-25, Math.min(25, Number(value)));
  if (v >= 0) return `rgba(8, 153, 129, ${0.16 + Math.abs(v) / 34})`;
  return `rgba(242, 54, 69, ${0.16 + Math.abs(v) / 34})`;
}

function hexToRgba(hex, alpha) {
  const clean = String(hex || "#94a3b8").replace("#", "");
  const num16 = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
  return `rgba(${(num16 >> 16) & 255}, ${(num16 >> 8) & 255}, ${num16 & 255}, ${alpha})`;
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function lastValue(rows, key) {
  return rows.length ? rows[rows.length - 1][key] : 0;
}

function mean(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function avg(values) {
  return mean(values);
}

function variance(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  const m = mean(nums);
  return nums.length ? mean(nums.map((v) => Math.pow(v - m, 2))) : 0;
}

function std(values) {
  return Math.sqrt(variance(values));
}

function covariance(a, b) {
  const len = Math.min(a.length, b.length);
  if (!len) return 0;
  const ax = a.slice(0, len);
  const bx = b.slice(0, len);
  const am = mean(ax);
  const bm = mean(bx);
  return mean(ax.map((v, i) => (v - am) * (bx[i] - bm)));
}

function correlation(a, b) {
  const den = std(a) * std(b);
  return den ? covariance(a, b) / den : 0;
}

function percentile(values, p) {
  const nums = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const idx = (p / 100) * (nums.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return nums[lo] + (nums[hi] - nums[lo]) * (idx - lo);
}

function daysBetween(a, b) {
  const start = new Date(a).getTime();
  const end = new Date(b).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(1, (end - start) / 86400000) : 365;
}

function formatCompareDate(value) {
  const text = String(value ?? "");
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return text || "--";
}

function pct(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "--";
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? formatCompactValue(n) : "--";
}

function num(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "--";
}

function hashString(text) {
  return String(text || "").split("").reduce((h, ch) => ((h << 5) - h + ch.charCodeAt(0)) >>> 0, 2166136261);
}
