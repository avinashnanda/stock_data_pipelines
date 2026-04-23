/* ═══════════════════════════════════════════════════════════════════════════
   SCREENER — Charts, summary cards, analysis, peers, tables, data loading
   ═══════════════════════════════════════════════════════════════════════════ */

function setScreenerState(message, tone = "") {
  $("screener-company-name").textContent = "Screener Snapshot";
  $("screener-price").textContent = "--";
  $("screener-price-change").textContent = "--";
  $("screener-company-meta").textContent = message;
  $("screener-company-links").innerHTML = "";
  $("screener-sidebar").innerHTML = "";
  $("screener-badge").textContent = tone === "loading" ? "Loading" : "Screener";
  $("screener-badge").dataset.tone = tone || "neutral";
  $("screener-summary").innerHTML = `<div class="screener-empty${tone ? ` ${tone}` : ""}">${message}</div>`;
  destroyScreenerChart();
  $("screener-charts").innerHTML = "";
  $("screener-analysis").innerHTML = "";
  $("screener-peers").innerHTML = "";
  $("screener-tables").innerHTML = "";
}

function setScreenerRefreshState(isRefreshing) {
  screenerRefreshInFlight = isRefreshing;
  $("screener-refresh").disabled = isRefreshing;
  $("screener-refresh").textContent = isRefreshing ? "Refreshing..." : "Refresh";
}

function syncScreenerLayout() {
  const screenerView = $("screener-view");
  if (currentView !== "screener" || !screenerView || screenerView.classList.contains("hidden")) return;
  if (screenerChartInstance && typeof screenerChartInstance.resize === "function") screenerChartInstance.resize();
}

function scheduleScreenerLayoutSync() {
  window.requestAnimationFrame(() => { syncScreenerLayout(); });
  if (screenerLayoutSyncTimer) window.clearTimeout(screenerLayoutSyncTimer);
  screenerLayoutSyncTimer = window.setTimeout(() => { syncScreenerLayout(); }, 260);
}

function destroyScreenerChart() {
  if (screenerChartInstance) { screenerChartInstance.destroy(); screenerChartInstance = null; }
}

function createSummaryCards(summary) {
  const preferredKeys = ["Market Cap","Current Price","High / Low","Stock P/E","Book Value","ROCE","ROE","Dividend Yield"];
  return preferredKeys
    .filter((key) => summary[key] !== undefined)
    .map((key) => `<div class="summary-item"><span>${key}</span><strong>${summary[key]}</strong></div>`)
    .join("");
}

function createCompanyLinks(meta, summary) {
  const symbol = meta.symbol || "--";
  const links = [
    { label: "Source", href: meta.source_url, text: "Screener" },
    { label: "NSE", href: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`, text: symbol },
    { label: "BSE", href: `https://www.bseindia.com/stock-share-price/searchresults/${encodeURIComponent(symbol)}/`, text: symbol },
  ];
  return links.map((link) => `
    <a class="screener-company-link" href="${link.href}" target="_blank" rel="noreferrer">
      <span>${link.label}</span><strong>${link.text}</strong>
    </a>`).join("");
}

function renderScreenerSidebar(analysis) {
  const keyPoints = (analysis.pros || []).slice(0, 3);
  return `
    <div class="sidebar-card">
      <div class="section-title">About</div>
      <p>${analysis.about || "No company profile text stored for this snapshot."}</p>
    </div>
    <div class="sidebar-card">
      <div class="section-title">Key Points</div>
      <ul>${keyPoints.length ? keyPoints.map((item) => `<li>${item}</li>`).join("") : "<li>No key points captured.</li>"}</ul>
      <button type="button" class="sidebar-link">Read More</button>
    </div>`;
}

function getScreenerChartConfigs(charts) {
  return SCREENER_CHART_ORDER
    .filter((key) => Array.isArray(charts[key]) && charts[key].length)
    .map((key) => ({ key, label: SCREENER_CHART_DEFINITIONS[key]?.label || titleizeKey(key), rows: charts[key] }));
}

function createDatasetsForChart(chartKey, rows) {
  if (!rows.length) return [];
  const definition = SCREENER_CHART_DEFINITIONS[chartKey];
  const series = definition?.series || [];
  return series
    .filter((item) => rows.some((row) => typeof row[item.key] === "number" && Number.isFinite(row[item.key])))
    .map((item) => ({
      key: item.key, label: item.label, type: item.type, yAxisID: item.axis,
      borderColor: item.type === "bar" ? "transparent" : item.color,
      backgroundColor: item.color,
      borderWidth: item.type === "bar" ? 0 : item.width || 1.5,
      tension: 0.34, pointRadius: 0, pointHoverRadius: 3, fill: false, spanGaps: true,
      barPercentage: 0.9, categoryPercentage: 0.82, maxBarThickness: 44,
      data: rows.map((row) => (typeof row[item.key] === "number" && Number.isFinite(row[item.key]) ? row[item.key] : null)),
    }));
}

function getRangeStartDate(rows, range) {
  if (!rows.length || range === "Max") return null;
  const latestDate = new Date(rows[rows.length - 1].Date);
  if (Number.isNaN(latestDate.getTime())) return null;
  const next = new Date(latestDate);
  if (range === "1M") next.setMonth(next.getMonth() - 1);
  else if (range === "6M") next.setMonth(next.getMonth() - 6);
  else if (range === "1Yr") next.setFullYear(next.getFullYear() - 1);
  else if (range === "3Yr") next.setFullYear(next.getFullYear() - 3);
  else if (range === "5Yr") next.setFullYear(next.getFullYear() - 5);
  else if (range === "10Yr") next.setFullYear(next.getFullYear() - 10);
  return next;
}

function filterChartRowsByRange(rows, range) {
  const startDate = getRangeStartDate(rows, range);
  if (!startDate) return rows;
  const filtered = rows.filter((row) => { const d = new Date(row.Date); return !Number.isNaN(d.getTime()) && d >= startDate; });
  return filtered.length ? filtered : rows;
}

function getChartRowsForDisplay(config, range) { return filterChartRowsByRange(config.rows, range); }

function getChartAxisTitles(chartKey) {
  if (chartKey === "price_dma_volume") return { yBar: "Volume", y: "Price on NSE", yPercent: "Delivery %" };
  if (chartKey === "pe_eps") return { yBar: "TTM EPS", y: "PE Ratio" };
  if (chartKey === "margins_sales") return { yBar: "Quarter Sales", yPercent: "Margins %" };
  if (chartKey === "ev_ebitda") return { yBar: "EBITDA", y: "EV/EBITDA" };
  if (chartKey === "pbv") return { yBar: "Book Value", y: "Price to BV" };
  if (chartKey === "mcap_sales") return { yBar: "Sales", y: "MCap to Sales" };
  return {};
}

function buildChartStateMap(chartConfigs) {
  const hiddenSeries = {};
  chartConfigs.forEach((config) => {
    hiddenSeries[config.key] = hiddenSeries[config.key] || {};
    createDatasetsForChart(config.key, config.rows).forEach((dataset) => {
      hiddenSeries[config.key][dataset.key] = hiddenSeries[config.key][dataset.key] || false;
    });
  });
  return hiddenSeries;
}

function formatChartTick(value) { return formatIndianCompactAxis(value); }
function formatPercentTick(value) { return `${Number(value).toFixed(0)}%`; }

function formatChartDateLabel(value, range) {
  range = range || screenerChartState.activeRange;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (range === "1M" || range === "6M") return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatChartSeriesValue(dataset, value) {
  if (value === null || value === undefined || value === "") return "--";
  if (dataset.yAxisID === "yPercent") return `${Number(value).toFixed(2)}%`;
  return formatCellValue(value, dataset.label || "");
}

function renderScreenerCharts(charts) {
  const chartConfigs = getScreenerChartConfigs(charts);
  if (!chartConfigs.length) { destroyScreenerChart(); return `<div class="screener-empty">No Screener chart series stored for this company.</div>`; }
  const nextActiveKey = chartConfigs.some((c) => c.key === screenerChartState.activeKey) ? screenerChartState.activeKey : chartConfigs[0].key;
  screenerChartState = { ...screenerChartState, activeKey: nextActiveKey, charts, hiddenSeries: { ...buildChartStateMap(chartConfigs), ...screenerChartState.hiddenSeries } };
  const rangeButtons = SCREENER_RANGE_OPTIONS.map((range) => `<button type="button" class="chart-range-pill${range === screenerChartState.activeRange ? " active" : ""}" data-chart-range="${range}">${range}</button>`).join("");
  const chartTabs = chartConfigs.map((config) => `<button type="button" class="chart-view-pill${config.key === screenerChartState.activeKey ? " active" : ""}" data-chart-key="${config.key}">${config.label}</button>`).join("");
  return `<article class="screener-chart-stage"><div class="screener-chart-toolbar"><div class="chart-range-group">${rangeButtons}</div><div class="chart-view-group">${chartTabs}</div></div><div class="screener-chart-canvas-shell"><canvas id="screener-main-chart"></canvas></div><div id="screener-chart-legend" class="screener-chart-legend"></div></article>`;
}

function getActiveChartConfig() {
  const chartConfigs = getScreenerChartConfigs(screenerChartState.charts || {});
  return chartConfigs.find((c) => c.key === screenerChartState.activeKey) || chartConfigs[0] || null;
}

function buildChartJsConfig(config, rows) {
  const datasets = createDatasetsForChart(config.key, rows).map((ds) => ({ ...ds, hidden: Boolean(screenerChartState.hiddenSeries?.[config.key]?.[ds.key]) }));
  const axisTitles = getChartAxisTitles(config.key);
  const chartDefinition = SCREENER_CHART_DEFINITIONS[config.key] || {};
  return {
    type: "bar",
    data: { labels: rows.map((row) => row.Date), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false }, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.92)", titleColor: "#f8fafc", bodyColor: "#e2e8f0", padding: 12, displayColors: true,
          callbacks: {
            title(items) { return items.length ? new Date(items[0].label).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : ""; },
            label(context) { return `${context.dataset.label || ""}: ${formatChartSeriesValue(context.dataset, context.raw)}`; },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#64748b", maxRotation: 0, autoSkip: true, maxTicksLimit: 10, callback: (_, index, ticks) => formatChartDateLabel(rows[index]?.Date || ticks[index]?.label || "", screenerChartState.activeRange) } },
        yBar: { position: "left", beginAtZero: true, display: datasets.some((ds) => ds.yAxisID === "yBar" && !ds.hidden), title: { display: Boolean(axisTitles.yBar), text: axisTitles.yBar || "", color: "#64748b", font: { size: 11, weight: "600" } }, grid: { color: "rgba(148, 163, 184, 0.16)" }, ticks: { color: "#64748b", callback: (v) => formatChartTick(v) } },
        y: { position: "right", display: datasets.some((ds) => ds.yAxisID === "y" && !ds.hidden), title: { display: Boolean(axisTitles.y), text: axisTitles.y || "", color: "#64748b", font: { size: 11, weight: "600" } }, grid: { drawOnChartArea: false }, ticks: { color: "#64748b", callback: (v) => formatChartTick(v) } },
        yPercent: { position: "right", display: datasets.some((ds) => ds.yAxisID === "yPercent" && !ds.hidden), title: { display: !chartDefinition.hidePercentAxis && Boolean(axisTitles.yPercent), text: axisTitles.yPercent || "", color: "#94a3b8", font: { size: 11, weight: "600" } }, grid: { drawOnChartArea: false }, ticks: { display: !chartDefinition.hidePercentAxis, color: "#94a3b8", callback: (v) => formatPercentTick(v) }, border: { display: !chartDefinition.hidePercentAxis } },
      },
    },
  };
}

function renderScreenerLegend(config, rows) {
  const legendNode = $("screener-chart-legend");
  if (!legendNode) return;
  const datasets = createDatasetsForChart(config.key, rows);
  legendNode.innerHTML = datasets.map((ds) => {
    const hidden = Boolean(screenerChartState.hiddenSeries?.[config.key]?.[ds.key]);
    return `<button type="button" class="screener-legend-toggle${hidden ? " inactive" : ""}" data-chart-series="${ds.key}"><span class="legend-swatch" style="--legend-color: ${ds.type === "bar" ? ds.backgroundColor : ds.borderColor}"></span><span>${ds.label}</span></button>`;
  }).join("");
}

function bindScreenerLegendControls() {
  const root = $("screener-charts");
  if (!root) return;
  root.querySelectorAll("[data-chart-series]").forEach((button) => {
    button.addEventListener("click", () => {
      const config = getActiveChartConfig();
      if (!config) return;
      const key = button.dataset.chartSeries;
      const current = Boolean(screenerChartState.hiddenSeries?.[config.key]?.[key]);
      screenerChartState.hiddenSeries[config.key][key] = !current;
      mountScreenerChart();
    });
  });
}

function mountScreenerChart() {
  const config = getActiveChartConfig();
  const canvas = $("screener-main-chart");
  if (!config || !canvas || typeof window.Chart === "undefined") return;
  const rows = getChartRowsForDisplay(config, screenerChartState.activeRange);
  destroyScreenerChart();
  screenerChartInstance = new window.Chart(canvas, buildChartJsConfig(config, rows));
  renderScreenerLegend(config, rows);
  bindScreenerLegendControls();
}

function bindScreenerChartControls() {
  const root = $("screener-charts");
  if (!root) return;
  root.querySelectorAll("[data-chart-key]").forEach((button) => {
    button.addEventListener("click", () => {
      screenerChartState.activeKey = button.dataset.chartKey;
      $("screener-charts").innerHTML = renderScreenerCharts(screenerChartState.charts || {});
      bindScreenerChartControls();
      mountScreenerChart();
    });
  });
  root.querySelectorAll("[data-chart-range]").forEach((button) => {
    button.addEventListener("click", () => {
      screenerChartState.activeRange = button.dataset.chartRange;
      $("screener-charts").innerHTML = renderScreenerCharts(screenerChartState.charts || {});
      bindScreenerChartControls();
      mountScreenerChart();
    });
  });
}

function renderAnalysisCard(analysis, peers) {
  const pros = (analysis.pros || []).map((item) => `<li>${item}</li>`).join("");
  const cons = (analysis.cons || []).map((item) => `<li>${item}</li>`).join("");
  return `<article class="analysis-card"><div class="analysis-grid"><div class="analysis-block analysis-block-pros"><div class="section-title">Pros</div><ul>${pros || "<li>No pros captured.</li>"}</ul></div><div class="analysis-block analysis-block-cons"><div class="section-title">Cons</div><ul>${cons || "<li>No cons captured.</li>"}</ul></div></div></article>`;
}

function renderDataTableCard(title, rows, options = {}) {
  if (!rows.length) return "";
  const maxColumns = options.maxColumns || Number.MAX_SAFE_INTEGER;
  const maxRows = options.maxRows || 10;
  const preferredColumns = options.preferredColumns || [];
  const columnLabels = options.columnLabels || {};
  const rowKey = options.rowKey || (rows[0].Item !== undefined ? "Item" : Object.keys(rows[0])[0]);
  const allColumns = Object.keys(rows[0]);
  const orderedColumns = Array.from(new Set([...preferredColumns.filter((c) => allColumns.includes(c)), ...allColumns.filter((c) => !preferredColumns.includes(c))]));
  const columns = orderedColumns.slice(0, maxColumns);
  const sectionId = options.sectionId || "";
  const body = rows.slice(0, maxRows).map((row) => `<tr>${columns.map((column) => { const value = formatCellValue(row[column], column); const className = isNumericColumn(rows, column) ? "numeric" : column === rowKey ? "row-key" : ""; return `<td class="${className}">${value}</td>`; }).join("")}</tr>`).join("");
  return `<article class="table-card"${sectionId ? ` id="${sectionId}"` : ""}><div class="table-card-head"><div>${options.kicker ? `<div class="section-title">${options.kicker}</div>` : ""}${options.hideTitle ? "" : `<h3>${title}</h3>`}</div></div><div class="table-scroll"><table><thead><tr>${columns.map((column) => { const className = isNumericColumn(rows, column) ? "numeric" : column === rowKey ? "row-key" : ""; return `<th class="${className}">${columnLabels[column] || column}<\/th>`; }).join("")}</tr></thead><tbody>${body}</tbody></table></div></article>`;
}

function findPeerNumericColumns(peers) {
  if (!peers.length) return [];
  return Object.keys(peers[0]).filter((key) => !["Name","Company","Peer","Stock","Symbol","S.No.","No."].includes(key) && peers.some((peer) => typeof peer[key] === "number" && Number.isFinite(peer[key])));
}

function getPeerDisplayName(peer) { return peer.Name || peer.Company || peer.Peer || peer.Stock || peer.Symbol || "Peer"; }

function renderPeerSection(peers, symbol) {
  if (!peers.length) return `<div class="screener-empty">No peer comparison rows stored for this company.</div>`;
  const tableMarkup = renderDataTableCard("Peer comparison", peers, {
    maxColumns: 11, maxRows: 12,
    preferredColumns: ["S.No.","Name","CMPRs.","P/E","Mar CapRs.Cr.","Div Yld%","NP QtrRs.Cr.","Qtr Profit Var%","Sales QtrRs.Cr.","Qtr Sales Var%","ROCE%"],
    columnLabels: {"S.No.":"#","Name":"Company","CMPRs.":"CMP (Rs)","Mar CapRs.Cr.":"Market Cap (Rs Cr)","Div Yld%":"Dividend Yield %","NP QtrRs.Cr.":"Net Profit Qtr (Rs Cr)","Qtr Profit Var%":"Qtr Profit Var %","Sales QtrRs.Cr.":"Sales Qtr (Rs Cr)","Qtr Sales Var%":"Qtr Sales Var %","ROCE%":"ROCE %"},
    rowKey: "Name", sectionId: "screener-peer-comparison-table", hideTitle: true,
  });
  return `<section class="peer-card"><div class="peer-card-head"><div><h3>Peer comparison</h3></div></div>${tableMarkup.replace('<article class="table-card" id="screener-peer-comparison-table">', '<div class="peer-table-shell">').replace("</article>", "</div>")}</section>`;
}

function renderScreenerTables(snapshot) {
  const tables = snapshot.tables || {};
  const primaryTables = ["quarterly_results","profit_and_loss","balance_sheet","cash_flows","ratios","shareholding_pattern"];
  const titleMap = { profit_and_loss: "Profit & Loss", balance_sheet: "Balance Sheet", cash_flows: "Cash Flow", quarterly_results: "Quarterly Results", shareholding_pattern: "Investors" };
  return primaryTables.filter((key) => Array.isArray(tables[key]) && tables[key].length).map((key) => {
    const sectionIdMap = { profit_and_loss: "screener-profitloss-section", balance_sheet: "screener-balancesheet-section", cash_flows: "screener-cashflow-section", ratios: "screener-ratios-section", quarterly_results: "screener-quarters-section" };
    return renderDataTableCard(titleMap[key] || titleizeKey(key), tables[key], { maxColumns: Number.MAX_SAFE_INTEGER, maxRows: 10, preferredColumns: ["Item"], rowKey: "Item", sectionId: sectionIdMap[key] || "" });
  }).join("");
}

function renderScreener(snapshot) {
  const meta = snapshot.meta || {};
  const summary = snapshot.summary || {};
  const charts = snapshot.charts || {};
  const analysis = snapshot.analysis || {};
  const peers = snapshot.peers_api || [];
  const fetchState = snapshot.fetch_state || "cached";
  const badgeMap = { cached: "DB Cache", fetched_on_demand: "Fetched Now", refreshed: "Refreshed" };
  $("screener-company-name").textContent = summary.company_name || meta.company_name || meta.symbol || "Screener Snapshot";
  $("screener-price").textContent = summary["Current Price"] || "--";
  $("screener-price-change").textContent = summary["High / Low"] || "Stored snapshot";
  $("screener-company-meta").textContent = `${meta.symbol || "--"} | Last scraped ${meta.scraped_at || "--"}`;
  $("screener-company-links").innerHTML = createCompanyLinks(meta, summary);
  $("screener-sidebar").innerHTML = renderScreenerSidebar(analysis);
  $("screener-badge").textContent = badgeMap[fetchState] || "Screener";
  $("screener-badge").dataset.tone = fetchState;
  $("screener-summary").innerHTML = createSummaryCards(summary) || `<div class="screener-empty">No summary metrics stored for this company.</div>`;
  $("screener-charts").innerHTML = renderScreenerCharts(charts);
  bindScreenerChartControls();
  mountScreenerChart();
  $("screener-analysis").innerHTML = renderAnalysisCard(analysis, peers);
  $("screener-peers").innerHTML = renderPeerSection(peers, meta.symbol || currentSymbol);
  const tableMarkup = renderScreenerTables(snapshot);
  $("screener-tables").innerHTML = tableMarkup || `<div class="screener-empty">No Screener tables stored for this company.</div>`;
}

async function loadScreenerData(symbolText) {
  symbolText = symbolText || currentSymbol;
  const requestId = ++screenerRequestId;
  const symbol = normalizeSymbolInput(symbolText || currentSymbol);
  setScreenerState(`Loading Screener snapshot for ${symbol}...`, "loading");
  const response = await fetch(`/api/screener/company?symbol=${encodeURIComponent(symbol)}`);
  const payload = await response.json();
  if (requestId !== screenerRequestId) return;
  if (!response.ok) { setScreenerState(payload.error || `No Screener snapshot found for ${symbol}.`, "error"); return; }
  renderScreener(payload);
}

async function refreshScreenerData(symbolText) {
  symbolText = symbolText || currentSymbol;
  if (screenerRefreshInFlight) return;
  const requestId = ++screenerRequestId;
  const symbol = normalizeSymbolInput(symbolText || currentSymbol);
  setScreenerRefreshState(true);
  setScreenerState(`Refreshing Screener snapshot for ${symbol}...`, "loading");
  try {
    const response = await fetch(`/api/screener/refresh?symbol=${encodeURIComponent(symbol)}`, { method: "POST" });
    const payload = await response.json();
    if (requestId !== screenerRequestId) return;
    if (!response.ok) { setScreenerState(payload.error || `Refresh failed for ${symbol}.`, "error"); return; }
    renderScreener(payload);
  } catch (error) {
    console.error(error);
    if (requestId === screenerRequestId) setScreenerState(`Refresh failed for ${symbol}: ${error.message}`, "error");
  } finally { setScreenerRefreshState(false); }
}
