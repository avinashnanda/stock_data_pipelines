let widget = null;
let currentResolution = "1D";
let currentSourceId = "yfinance";
let currentSymbol = "NSE:RELIANCE";
let currentTheme = window.localStorage.getItem("tradingview_ui_theme") || "light";
let currentView = window.localStorage.getItem("tradingview_ui_view") || "price";

const WATCHLISTS_STORAGE_KEY = "tradingview_ui_watchlists_v2";
const WATCHLIST_PANEL_STORAGE_KEY = "tradingview_ui_watchlist_panel_hidden";
const SCREENER_CHART_ORDER = ["price_dma_volume", "pe_eps", "margins_sales", "ev_ebitda", "pbv", "mcap_sales"];
const SCREENER_RANGE_OPTIONS = ["1M", "6M", "1Yr", "3Yr", "5Yr", "10Yr", "Max"];
const SCREENER_CHART_DEFINITIONS = {
  price_dma_volume: {
    label: "Price",
    series: [
      { key: "Price", label: "Price on NSE", type: "line", axis: "y", color: "#635bff", width: 2.3 },
      { key: "DMA50", label: "50 DMA", type: "line", axis: "y", color: "#e5b454", width: 1.45 },
      { key: "DMA200", label: "200 DMA", type: "line", axis: "y", color: "#64748b", width: 1.35 },
      { key: "Volume", label: "Volume", type: "bar", axis: "yBar", color: "rgba(99, 91, 255, 0.24)" },
      { key: "Volume_delivery", label: "Delivery %", type: "line", axis: "yPercent", color: "#94a3b8", width: 1.2 },
    ],
    hidePercentAxis: true,
  },
  pe_eps: {
    label: "PE Ratio",
    series: [
      { key: "Price to Earning", label: "PE Ratio", type: "line", axis: "y", color: "#635bff", width: 2.1 },
      { key: "Median PE", label: "Median PE", type: "line", axis: "y", color: "#e5b454", width: 1.35 },
      { key: "EPS", label: "EPS", type: "bar", axis: "yBar", color: "rgba(99, 91, 255, 0.24)" },
    ],
  },
  margins_sales: {
    label: "Sales & Margin",
    series: [
      { key: "Quarter Sales", label: "Quarter Sales", type: "bar", axis: "yBar", color: "rgba(99, 91, 255, 0.24)" },
      { key: "GPM", label: "GPM", type: "line", axis: "yPercent", color: "#635bff", width: 1.9 },
      { key: "OPM", label: "OPM", type: "line", axis: "yPercent", color: "#10b981", width: 1.6 },
      { key: "NPM", label: "NPM", type: "line", axis: "yPercent", color: "#f59e0b", width: 1.6 },
    ],
  },
  ev_ebitda: {
    label: "EV/EBITDA",
    series: [
      { key: "EBITDA", label: "EBITDA", type: "bar", axis: "yBar", color: "rgba(99, 91, 255, 0.24)" },
      { key: "EV Multiple", label: "EV/EBITDA", type: "line", axis: "y", color: "#635bff", width: 2.0 },
      { key: "Median EV Multiple", label: "Median EV/EBITDA", type: "line", axis: "y", color: "#e5b454", width: 1.35 },
    ],
  },
  pbv: {
    label: "Price to Book",
    series: [
      { key: "Book value", label: "Book Value", type: "bar", axis: "yBar", color: "rgba(99, 91, 255, 0.24)" },
      { key: "Price to book value", label: "Price to Book", type: "line", axis: "y", color: "#635bff", width: 2.0 },
      { key: "Median PBV", label: "Median PBV", type: "line", axis: "y", color: "#e5b454", width: 1.35 },
    ],
  },
  mcap_sales: {
    label: "MCap/Sales",
    series: [
      { key: "Sales", label: "Sales", type: "bar", axis: "yBar", color: "rgba(99, 91, 255, 0.24)" },
      { key: "Market Cap to Sales", label: "MCap to Sales", type: "line", axis: "y", color: "#635bff", width: 2.0 },
      { key: "Median Market Cap to Sales", label: "Median MCap to Sales", type: "line", axis: "y", color: "#e5b454", width: 1.35 },
    ],
  },
};

let watchlistRefreshTimer = null;
let symbolSearchTimer = null;
let watchlistRequestId = 0;
let screenerRequestId = 0;
let screenerRefreshInFlight = false;
let screenerChartInstance = null;
let screenerChartState = {
  activeKey: SCREENER_CHART_ORDER[0],
  activeRange: "5Yr",
  hiddenSeries: {},
  charts: {},
};
let isWatchlistPanelHidden = window.localStorage.getItem(WATCHLIST_PANEL_STORAGE_KEY) === "true";
let screenerLayoutSyncTimer = null;

function $(id) {
  return document.getElementById(id);
}

function setStatus(message, tone) {
  const node = $("status");
  if (!node) {
    return;
  }
  node.textContent = message;
  node.dataset.tone = tone || "neutral";
}

async function loadSources() {
  const response = await fetch("/api/sources");
  const payload = await response.json();
  const select = $("source-select");
  select.innerHTML = "";

  payload.sources.forEach((source) => {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent =
      source.status === "available" ? source.label : `${source.label} (coming soon)`;
    option.disabled = source.status !== "available";
    option.selected = source.id === "yfinance";
    select.appendChild(option);
  });
}

function normalizeSymbolInput(symbol) {
  return symbol.trim().toUpperCase().replace(/^NSE:/, "");
}

function getDefaultSymbol() {
  const symbol = $("symbol-input").value.trim().toUpperCase();
  return symbol ? `NSE:${symbol}` : "NSE:RELIANCE";
}

function applyShellTheme(theme) {
  document.body.dataset.theme = theme;
  $("theme-toggle").textContent = theme === "dark" ? "Day Mode" : "Night Mode";
}

function applyWatchlistPanelState() {
  document.body.classList.toggle("watchlist-collapsed", isWatchlistPanelHidden);
  const panelToggle = $("watchlist-panel-toggle");
  const railToggle = $("watchlist-rail-toggle");

  if (panelToggle) {
    panelToggle.textContent = isWatchlistPanelHidden ? "‹" : "›";
    panelToggle.title = isWatchlistPanelHidden ? "Show watchlist" : "Hide watchlist";
    panelToggle.setAttribute("aria-label", isWatchlistPanelHidden ? "Show watchlist" : "Hide watchlist");
  }

  if (railToggle) {
    railToggle.textContent = "";
    railToggle.title = "Show watchlist";
    railToggle.setAttribute("aria-label", "Show watchlist");
    railToggle.classList.toggle("hidden", !isWatchlistPanelHidden);
  }
}

function toggleWatchlistPanel() {
  isWatchlistPanelHidden = !isWatchlistPanelHidden;
  window.localStorage.setItem(WATCHLIST_PANEL_STORAGE_KEY, String(isWatchlistPanelHidden));
  applyWatchlistPanelState();
}

function setSymbolSearchStatus(message) {
  $("symbol-search-status").textContent = message;
}

function setWatchlistStatus(message, tone = "") {
  const root = $("watchlist");
  root.innerHTML = "";
  const node = document.createElement("div");
  node.className = `watchlist-state${tone ? ` ${tone}` : ""}`;
  node.textContent = message;
  root.appendChild(node);
}

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
  if (currentView !== "screener" || !screenerView || screenerView.classList.contains("hidden")) {
    return;
  }

  if (screenerChartInstance && typeof screenerChartInstance.resize === "function") {
    screenerChartInstance.resize();
  }
}

function scheduleScreenerLayoutSync() {
  window.requestAnimationFrame(() => {
    syncScreenerLayout();
  });

  if (screenerLayoutSyncTimer) {
    window.clearTimeout(screenerLayoutSyncTimer);
  }

  screenerLayoutSyncTimer = window.setTimeout(() => {
    syncScreenerLayout();
  }, 260);
}

function applyResponsiveWatchlistPanelState() {
  document.body.classList.toggle("watchlist-collapsed", isWatchlistPanelHidden);
  const panelToggle = $("watchlist-panel-toggle");
  const railToggle = $("watchlist-rail-toggle");

  if (panelToggle) {
    // › = collapse (push right), ‹ = expand (pull left) — always visible unicode
    panelToggle.textContent = isWatchlistPanelHidden ? "‹" : "›";
    panelToggle.title = isWatchlistPanelHidden ? "Show watchlist" : "Hide watchlist";
    panelToggle.setAttribute("aria-label", isWatchlistPanelHidden ? "Show watchlist" : "Hide watchlist");
  }

  if (railToggle) {
    railToggle.textContent = "";
    railToggle.title = "Show watchlist";
    railToggle.setAttribute("aria-label", "Show watchlist");
    railToggle.classList.toggle("hidden", !isWatchlistPanelHidden);
  }

  scheduleScreenerLayoutSync();
}

function toggleResponsiveWatchlistPanel() {
  isWatchlistPanelHidden = !isWatchlistPanelHidden;
  window.localStorage.setItem(WATCHLIST_PANEL_STORAGE_KEY, String(isWatchlistPanelHidden));
  applyResponsiveWatchlistPanelState();
}

function getDefaultWatchlistsState() {
  return {
    activeId: "red_list",
    lists: {
      red_list: {
        id: "red_list",
        title: "Red list",
        symbols: ["NSE:RELIANCE", "NSE:TCS", "NSE:INFY", "NSE:HDFCBANK"],
      },
      banks: {
        id: "banks",
        title: "Banks",
        symbols: ["NSE:HDFCBANK", "NSE:ICICIBANK", "NSE:SBIN", "NSE:KOTAKBANK"],
      },
    },
  };
}

function getWatchlistsState() {
  try {
    const raw = window.localStorage.getItem(WATCHLISTS_STORAGE_KEY);
    if (!raw) {
      return getDefaultWatchlistsState();
    }

    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.lists || !parsed.activeId) {
      return getDefaultWatchlistsState();
    }

    return parsed;
  } catch (error) {
    console.warn("Failed to parse watchlist state", error);
    return getDefaultWatchlistsState();
  }
}

function saveWatchlistsState(state) {
  window.localStorage.setItem(WATCHLISTS_STORAGE_KEY, JSON.stringify(state));
}

function getActiveWatchlist() {
  const state = getWatchlistsState();
  return state.lists[state.activeId] || Object.values(state.lists)[0] || null;
}

function syncWatchlistDropdown() {
  const state = getWatchlistsState();
  const select = $("watchlist-select");
  select.innerHTML = "";

  Object.values(state.lists).forEach((list) => {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = list.title;
    option.selected = list.id === state.activeId;
    select.appendChild(option);
  });

  const activeList = state.lists[state.activeId] || Object.values(state.lists)[0] || null;
  $("watchlist-subtitle").textContent = activeList
    ? `${activeList.symbols.length} symbols saved locally`
    : "Custom synced watchlist";
  $("watchlist-section-label").textContent = activeList ? activeList.title.toUpperCase() : "ACTIVE LIST";
}

function openSymbolModal() {
  const modal = $("symbol-modal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  $("symbol-search-input").value = "";
  $("symbol-search-results").innerHTML = "";
  setSymbolSearchStatus("Start typing to search symbols.");
  window.setTimeout(() => $("symbol-search-input").focus(), 0);
}

function closeSymbolModal() {
  const modal = $("symbol-modal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function searchSymbols(query) {
  const resultsNode = $("symbol-search-results");
  resultsNode.innerHTML = "";

  if (!query.trim()) {
    setSymbolSearchStatus("Start typing to search symbols.");
    return;
  }

  setSymbolSearchStatus("Searching...");
  const response = await fetch(
    `/api/search?source=${encodeURIComponent(currentSourceId)}&query=${encodeURIComponent(query)}`
  );
  const payload = await response.json();
  const items = payload.items || [];

  if (!items.length) {
    setSymbolSearchStatus("No matching symbols found.");
    return;
  }

  setSymbolSearchStatus(`Found ${items.length} matches.`);

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "symbol-result";
    button.innerHTML = `
      <span class="symbol-result-main">
        <strong>${item.symbol}</strong>
        <small>${item.exchange || "NSE"}</small>
      </span>
      <span class="symbol-result-desc">${item.description || item.full_name || item.symbol}</span>
    `;

    button.addEventListener("click", () => {
      addSymbolToActiveWatchlist(item.full_name || `NSE:${item.symbol}`);
      closeSymbolModal();
    });

    resultsNode.appendChild(button);
  });
}

async function loadWatchlistQuotes() {
  const requestId = ++watchlistRequestId;
  const activeList = getActiveWatchlist();
  const root = $("watchlist");
  if (!activeList) {
    root.innerHTML = "";
    return;
  }

  $("watchlist-count").textContent = String(activeList.symbols.length);

  if (!activeList.symbols.length) {
    renderWatchlist([]);
    return;
  }

  setWatchlistStatus("Loading watchlist...");

  try {
    const response = await fetch(
      `/api/watchlist?source=${encodeURIComponent(currentSourceId)}&symbols=${encodeURIComponent(
        activeList.symbols.join(",")
      )}`
    );
    const payload = await response.json();
    if (requestId !== watchlistRequestId) {
      return;
    }
    renderWatchlist(payload.items || []);
  } catch (error) {
    if (requestId !== watchlistRequestId) {
      return;
    }
    console.error(error);
    setWatchlistStatus("Failed to load watchlist.", "error");
  }
}

function renderWatchlist(items) {
  const root = $("watchlist");
  root.innerHTML = "";
  renderWatchlistStats(items);

  items.forEach((item) => {
    const symbolId = item.full_name || `NSE:${item.symbol}`;
    const row = document.createElement("div");
    row.className = "watchlist-item";
    if (symbolId === currentSymbol) {
      row.classList.add("active");
    }

    const changeClass = (item.change || 0) >= 0 ? "up" : "down";
    const last = item.price !== undefined ? Number(item.price).toFixed(2) : "--";
    const change = item.change !== undefined ? Number(item.change).toFixed(2) : "--";
    const pct = item.change_pct !== undefined ? `${Number(item.change_pct).toFixed(2)}%` : "--";

    row.innerHTML = `
      <button type="button" class="watchlist-main">
        <span class="watch-symbol">
          <span class="watch-symbol-line">
            <strong>${item.symbol}</strong>
            <span class="watch-dot"></span>
          </span>
          <small>${item.description || item.symbol}</small>
        </span>
        <span class="watch-last">${last}</span>
        <span class="watch-change ${changeClass}">${change}</span>
        <span class="watch-change ${changeClass}">${pct}</span>
      </button>
      <button type="button" class="watch-remove" aria-label="Remove ${item.symbol}" title="Remove ${item.symbol}">x</button>
    `;

    row.querySelector(".watchlist-main").addEventListener("click", () => {
      $("symbol-input").value = item.symbol;
      buildWidget({ symbol: symbolId, resolution: currentResolution });
    });

    row.querySelector(".watch-remove").addEventListener("click", (event) => {
      event.stopPropagation();
      removeSymbolFromActiveWatchlist(symbolId);
    });

    root.appendChild(row);
  });

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "watchlist-empty";
    empty.textContent = "No symbols in this watchlist yet.";
    root.appendChild(empty);
  }
}

function renderWatchlistStats(items) {
  const statsNode = $("watchlist-stats");
  const total = items.length;
  const gainers = items.filter((item) => Number(item.change || 0) > 0).length;
  const losers = items.filter((item) => Number(item.change || 0) < 0).length;
  const averageMove = total
    ? items.reduce((sum, item) => sum + Number(item.change_pct || 0), 0) / total
    : 0;

  statsNode.innerHTML = `
    <div class="watch-stat-card">
      <span>Symbols</span>
      <strong>${total}</strong>
    </div>
    <div class="watch-stat-card">
      <span>Up</span>
      <strong class="up">${gainers}</strong>
    </div>
    <div class="watch-stat-card">
      <span>Down</span>
      <strong class="down">${losers}</strong>
    </div>
    <div class="watch-stat-card">
      <span>Avg Move</span>
      <strong class="${averageMove >= 0 ? "up" : "down"}">${averageMove.toFixed(2)}%</strong>
    </div>
  `;
}

function startWatchlistAutoRefresh() {
  if (watchlistRefreshTimer) {
    window.clearInterval(watchlistRefreshTimer);
  }

  watchlistRefreshTimer = window.setInterval(() => {
    loadWatchlistQuotes().catch((error) => console.error(error));
  }, 15000);
}

function destroyWidget() {
  if (widget) {
    widget.remove();
    widget = null;
  }
}

function bindChartEvents() {
  const chart = widget?.activeChart?.();
  if (!chart || typeof chart.onSymbolChanged !== "function") {
    return;
  }

  chart.onSymbolChanged().subscribe(null, (symbolInfo) => {
    const nextSymbol = symbolInfo.ticker || symbolInfo.name || currentSymbol;
    currentSymbol = nextSymbol;
    $("symbol-input").value = normalizeSymbolInput(nextSymbol);
    loadWatchlistQuotes().catch((error) => console.error(error));
    if (currentView === "screener") {
      loadScreenerData(nextSymbol).catch((error) => console.error(error));
    }
    refreshActiveStockNews();
  });
}

function switchView(view) {
  currentView = view;
  window.localStorage.setItem("tradingview_ui_view", view);
  $("tab-price").classList.toggle("active", view === "price");
  $("tab-screener").classList.toggle("active", view === "screener");
  if ($("tab-news")) $("tab-news").classList.toggle("active", view === "news");
  
  $("price-view").classList.toggle("hidden", view !== "price");
  $("screener-view").classList.toggle("hidden", view !== "screener");
  if ($("news-view")) $("news-view").classList.toggle("hidden", view !== "news");

  if (view === "screener") {
    scheduleScreenerLayoutSync();
    loadScreenerData(currentSymbol).catch((error) => {
      console.error(error);
      setScreenerState(`Failed to load Screener data: ${error.message}`, "error");
    });
  } else if (view === "news") {
    refreshNewsView();
    checkFetcherStatus();
  }
}

function formatNumberWithSeparators(value, options = {}) {
  if (value === null || value === undefined || value === "") {
    return "--";
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return String(value);
  }

  const {
    minimumFractionDigits = 0,
    maximumFractionDigits = Math.abs(value) < 100 ? 2 : 0,
  } = options;

  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

function formatCompactValue(value) {
  return formatNumberWithSeparators(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(Number(value)) < 100 ? 2 : 0,
  });
}

function formatIndianCompactAxis(value) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) {
    return "--";
  }

  const numericValue = Number(value);
  const absoluteValue = Math.abs(numericValue);
  if (absoluteValue >= 10_000_000) {
    return `${formatNumberWithSeparators(numericValue / 10_000_000, { maximumFractionDigits: 2 })} Cr`;
  }
  if (absoluteValue >= 100_000) {
    return `${formatNumberWithSeparators(numericValue / 100_000, { maximumFractionDigits: 2 })} L`;
  }
  return formatNumberWithSeparators(numericValue, {
    minimumFractionDigits: 0,
    maximumFractionDigits: absoluteValue < 100 ? 2 : 0,
  });
}

function titleizeKey(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCellValue(value, key = "") {
  if (value === null || value === undefined || value === "") {
    return "--";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (String(key).toLowerCase().includes("%")) {
      return formatNumberWithSeparators(value, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
    }
    return formatNumberWithSeparators(value, {
      minimumFractionDigits: 0,
      maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    });
  }
  return String(value);
}

function isNumericColumn(rows, key) {
  return rows.some((row) => typeof row[key] === "number" && Number.isFinite(row[key]));
}

function createSummaryCards(summary) {
  const preferredKeys = [
    "Market Cap",
    "Current Price",
    "High / Low",
    "Stock P/E",
    "Book Value",
    "ROCE",
    "ROE",
    "Dividend Yield",
  ];

  return preferredKeys
    .filter((key) => summary[key] !== undefined)
    .map(
      (key) => `
        <div class="summary-item">
          <span>${key}</span>
          <strong>${summary[key]}</strong>
        </div>
      `
    )
    .join("");
}

function createCompanyLinks(meta, summary) {
  const symbol = meta.symbol || "--";
  const links = [
    {
      label: "Source",
      href: meta.source_url,
      text: "Screener",
    },
    {
      label: "NSE",
      href: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`,
      text: symbol,
    },
    {
      label: "BSE",
      href: `https://www.bseindia.com/stock-share-price/searchresults/${encodeURIComponent(symbol)}/`,
      text: symbol,
    },
  ];

  return links
    .map(
      (link) => `
        <a class="screener-company-link" href="${link.href}" target="_blank" rel="noreferrer">
          <span>${link.label}</span>
          <strong>${link.text}</strong>
        </a>
      `
    )
    .join("");
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
    </div>
  `;
}

function destroyScreenerChart() {
  if (screenerChartInstance) {
    screenerChartInstance.destroy();
    screenerChartInstance = null;
  }
}

function getScreenerChartConfigs(charts) {
  return SCREENER_CHART_ORDER
    .filter((key) => Array.isArray(charts[key]) && charts[key].length)
    .map((key) => ({
      key,
      label: SCREENER_CHART_DEFINITIONS[key]?.label || titleizeKey(key),
      rows: charts[key],
    }));
}

function createDatasetsForChart(chartKey, rows) {
  if (!rows.length) {
    return [];
  }

  const definition = SCREENER_CHART_DEFINITIONS[chartKey];
  const series = definition?.series || [];

  return series
    .filter((item) => rows.some((row) => typeof row[item.key] === "number" && Number.isFinite(row[item.key])))
    .map((item) => {
      return {
        key: item.key,
        label: item.label,
        type: item.type,
        yAxisID: item.axis,
        borderColor: item.type === "bar" ? "transparent" : item.color,
        backgroundColor: item.color,
      borderWidth: item.type === "bar" ? 0 : item.width || 1.5,
      tension: 0.34,
      pointRadius: 0,
        pointHoverRadius: 3,
        fill: false,
        spanGaps: true,
      barPercentage: 0.9,
      categoryPercentage: 0.82,
      maxBarThickness: 44,
      data: rows.map((row) => (typeof row[item.key] === "number" && Number.isFinite(row[item.key]) ? row[item.key] : null)),
    };
  });
}

function getRangeStartDate(rows, range) {
  if (!rows.length || range === "Max") {
    return null;
  }

  const latestDate = new Date(rows[rows.length - 1].Date);
  if (Number.isNaN(latestDate.getTime())) {
    return null;
  }

  const next = new Date(latestDate);
  if (range === "1M") {
    next.setMonth(next.getMonth() - 1);
  } else if (range === "6M") {
    next.setMonth(next.getMonth() - 6);
  } else if (range === "1Yr") {
    next.setFullYear(next.getFullYear() - 1);
  } else if (range === "3Yr") {
    next.setFullYear(next.getFullYear() - 3);
  } else if (range === "5Yr") {
    next.setFullYear(next.getFullYear() - 5);
  } else if (range === "10Yr") {
    next.setFullYear(next.getFullYear() - 10);
  }
  return next;
}

function filterChartRowsByRange(rows, range) {
  const startDate = getRangeStartDate(rows, range);
  if (!startDate) {
    return rows;
  }

  const filtered = rows.filter((row) => {
    const rowDate = new Date(row.Date);
    return !Number.isNaN(rowDate.getTime()) && rowDate >= startDate;
  });

  return filtered.length ? filtered : rows;
}

function getChartRowsForDisplay(config, range) {
  return filterChartRowsByRange(config.rows, range);
}

function getChartAxisTitles(chartKey) {
  if (chartKey === "price_dma_volume") {
    return {
      yBar: "Volume",
      y: "Price on NSE",
      yPercent: "Delivery %",
    };
  }
  if (chartKey === "pe_eps") {
    return {
      yBar: "TTM EPS",
      y: "PE Ratio",
    };
  }
  if (chartKey === "margins_sales") {
    return {
      yBar: "Quarter Sales",
      yPercent: "Margins %",
    };
  }
  if (chartKey === "ev_ebitda") {
    return {
      yBar: "EBITDA",
      y: "EV/EBITDA",
    };
  }
  if (chartKey === "pbv") {
    return {
      yBar: "Book Value",
      y: "Price to BV",
    };
  }
  if (chartKey === "mcap_sales") {
    return {
      yBar: "Sales",
      y: "MCap to Sales",
    };
  }
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

function renderScreenerCharts(charts) {
  const chartConfigs = getScreenerChartConfigs(charts);
  if (!chartConfigs.length) {
    destroyScreenerChart();
    return `<div class="screener-empty">No Screener chart series stored for this company.</div>`;
  }

  const nextActiveKey = chartConfigs.some((config) => config.key === screenerChartState.activeKey)
    ? screenerChartState.activeKey
    : chartConfigs[0].key;
  screenerChartState = {
    ...screenerChartState,
    activeKey: nextActiveKey,
    charts,
    hiddenSeries: {
      ...buildChartStateMap(chartConfigs),
      ...screenerChartState.hiddenSeries,
    },
  };

  const rangeButtons = SCREENER_RANGE_OPTIONS
    .map(
      (range) => `
        <button
          type="button"
          class="chart-range-pill${range === screenerChartState.activeRange ? " active" : ""}"
          data-chart-range="${range}"
        >${range}</button>
      `
    )
    .join("");

  const chartTabs = chartConfigs
    .map(
      (config) => `
        <button
          type="button"
          class="chart-view-pill${config.key === screenerChartState.activeKey ? " active" : ""}"
          data-chart-key="${config.key}"
        >${config.label}</button>
      `
    )
    .join("");

  return `
    <article class="screener-chart-stage">
      <div class="screener-chart-toolbar">
        <div class="chart-range-group">${rangeButtons}</div>
        <div class="chart-view-group">${chartTabs}</div>
      </div>
      <div class="screener-chart-canvas-shell">
        <canvas id="screener-main-chart"></canvas>
      </div>
      <div id="screener-chart-legend" class="screener-chart-legend"></div>
    </article>
  `;
}

function getActiveChartConfig() {
  const chartConfigs = getScreenerChartConfigs(screenerChartState.charts || {});
  return chartConfigs.find((config) => config.key === screenerChartState.activeKey) || chartConfigs[0] || null;
}

function formatChartTick(value) {
  return formatIndianCompactAxis(value);
}

function formatPercentTick(value) {
  return `${Number(value).toFixed(0)}%`;
}

function formatChartDateLabel(value, range = screenerChartState.activeRange) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  if (range === "1M") {
    return date.toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
    });
  }
  if (range === "6M") {
    return date.toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
    });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function formatChartSeriesValue(dataset, value) {
  if (value === null || value === undefined || value === "") {
    return "--";
  }
  if (dataset.yAxisID === "yPercent") {
    return `${Number(value).toFixed(2)}%`;
  }
  return formatCellValue(value, dataset.label || "");
}

function buildChartJsConfig(config, rows) {
  const datasets = createDatasetsForChart(config.key, rows).map((dataset) => ({
    ...dataset,
    hidden: Boolean(screenerChartState.hiddenSeries?.[config.key]?.[dataset.key]),
  }));
  const axisTitles = getChartAxisTitles(config.key);
  const chartDefinition = SCREENER_CHART_DEFINITIONS[config.key] || {};

  return {
    type: "bar",
    data: {
      labels: rows.map((row) => row.Date),
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      animation: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.92)",
          titleColor: "#f8fafc",
          bodyColor: "#e2e8f0",
          padding: 12,
          displayColors: true,
          callbacks: {
            title(items) {
              return items.length
                ? new Date(items[0].label).toLocaleDateString("en-US", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "";
            },
            label(context) {
              const label = context.dataset.label || "";
              const value = context.raw;
              return `${label}: ${formatChartSeriesValue(context.dataset, value)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
          },
          ticks: {
            color: "#64748b",
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10,
            callback: (_, index, ticks) =>
              formatChartDateLabel(rows[index]?.Date || ticks[index]?.label || "", screenerChartState.activeRange),
          },
        },
        yBar: {
          position: "left",
          beginAtZero: true,
          display: datasets.some((dataset) => dataset.yAxisID === "yBar" && !dataset.hidden),
          title: {
            display: Boolean(axisTitles.yBar),
            text: axisTitles.yBar || "",
            color: "#64748b",
            font: { size: 11, weight: "600" },
          },
          grid: {
            color: "rgba(148, 163, 184, 0.16)",
          },
          ticks: {
            color: "#64748b",
            callback: (value) => formatChartTick(value),
          },
        },
        y: {
          position: "right",
          display: datasets.some((dataset) => dataset.yAxisID === "y" && !dataset.hidden),
          title: {
            display: Boolean(axisTitles.y),
            text: axisTitles.y || "",
            color: "#64748b",
            font: { size: 11, weight: "600" },
          },
          grid: {
            drawOnChartArea: false,
          },
          ticks: {
            color: "#64748b",
            callback: (value) => formatChartTick(value),
          },
        },
        yPercent: {
          position: "right",
          display: datasets.some((dataset) => dataset.yAxisID === "yPercent" && !dataset.hidden),
          title: {
            display: !chartDefinition.hidePercentAxis && Boolean(axisTitles.yPercent),
            text: axisTitles.yPercent || "",
            color: "#94a3b8",
            font: { size: 11, weight: "600" },
          },
          grid: {
            drawOnChartArea: false,
          },
          ticks: {
            display: !chartDefinition.hidePercentAxis,
            color: "#94a3b8",
            callback: (value) => formatPercentTick(value),
          },
          border: {
            display: !chartDefinition.hidePercentAxis,
          },
        },
      },
    },
  };
}

function renderScreenerLegend(config, rows) {
  const legendNode = $("screener-chart-legend");
  if (!legendNode) {
    return;
  }

  const datasets = createDatasetsForChart(config.key, rows);
  legendNode.innerHTML = datasets
    .map((dataset) => {
      const hidden = Boolean(screenerChartState.hiddenSeries?.[config.key]?.[dataset.key]);
      return `
        <button
          type="button"
          class="screener-legend-toggle${hidden ? " inactive" : ""}"
          data-chart-series="${dataset.key}"
        >
          <span class="legend-swatch" style="--legend-color: ${dataset.type === "bar" ? dataset.backgroundColor : dataset.borderColor}"></span>
          <span>${dataset.label}</span>
        </button>
      `;
    })
    .join("");
}

function bindScreenerLegendControls() {
  const root = $("screener-charts");
  if (!root) {
    return;
  }

  root.querySelectorAll("[data-chart-series]").forEach((button) => {
    button.addEventListener("click", () => {
      const config = getActiveChartConfig();
      if (!config) {
        return;
      }
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
  if (!config || !canvas || typeof window.Chart === "undefined") {
    return;
  }

  const rows = getChartRowsForDisplay(config, screenerChartState.activeRange);
  destroyScreenerChart();
  screenerChartInstance = new window.Chart(canvas, buildChartJsConfig(config, rows));
  renderScreenerLegend(config, rows);
  bindScreenerLegendControls();
}

function bindScreenerChartControls() {
  const root = $("screener-charts");
  if (!root) {
    return;
  }

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

  return `
    <article class="analysis-card">
      <div class="analysis-grid">
        <div class="analysis-block analysis-block-pros">
          <div class="section-title">Pros</div>
          <ul>${pros || "<li>No pros captured.</li>"}</ul>
        </div>
        <div class="analysis-block analysis-block-cons">
          <div class="section-title">Cons</div>
          <ul>${cons || "<li>No cons captured.</li>"}</ul>
        </div>
      </div>
    </article>
  `;
}

function renderDataTableCard(title, rows, options = {}) {
  if (!rows.length) {
    return "";
  }

  const maxColumns = options.maxColumns || Number.MAX_SAFE_INTEGER;
  const maxRows = options.maxRows || 10;
  const preferredColumns = options.preferredColumns || [];
  const columnLabels = options.columnLabels || {};
  const rowKey = options.rowKey || (rows[0].Item !== undefined ? "Item" : Object.keys(rows[0])[0]);
  const allColumns = Object.keys(rows[0]);
  const orderedColumns = Array.from(
    new Set([
    ...preferredColumns.filter((column) => allColumns.includes(column)),
    ...allColumns.filter((column) => !preferredColumns.includes(column)),
    ])
  );
  const columns = orderedColumns.slice(0, maxColumns);
  const sectionId = options.sectionId || "";
  const body = rows
    .slice(0, maxRows)
    .map(
      (row) => `
        <tr>
          ${columns
            .map((column) => {
              const value = formatCellValue(row[column], column);
              const className = isNumericColumn(rows, column) ? "numeric" : column === rowKey ? "row-key" : "";
              return `<td class="${className}">${value}</td>`;
            })
            .join("")}
        </tr>
      `
    )
    .join("");

  return `
    <article class="table-card"${sectionId ? ` id="${sectionId}"` : ""}>
      <div class="table-card-head">
        <div>
          ${options.kicker ? `<div class="section-title">${options.kicker}</div>` : ""}
          ${options.hideTitle ? "" : `<h3>${title}</h3>`}
        </div>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>${columns
              .map((column) => {
                const className = isNumericColumn(rows, column) ? "numeric" : column === rowKey ? "row-key" : "";
                return `<th class="${className}">${columnLabels[column] || column}<\/th>`;
              })
              .join("")}</tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </article>
  `;
}

function findPeerNumericColumns(peers) {
  if (!peers.length) {
    return [];
  }

  return Object.keys(peers[0]).filter(
    (key) =>
      !["Name", "Company", "Peer", "Stock", "Symbol", "S.No.", "No."].includes(key) &&
      peers.some((peer) => typeof peer[key] === "number" && Number.isFinite(peer[key]))
  );
}

function getPeerDisplayName(peer) {
  return peer.Name || peer.Company || peer.Peer || peer.Stock || peer.Symbol || "Peer";
}

function renderPeerSection(peers, symbol) {
  if (!peers.length) {
    return `<div class="screener-empty">No peer comparison rows stored for this company.</div>`;
  }

  const tableMarkup = renderDataTableCard("Peer comparison", peers, {
    maxColumns: 11,
    maxRows: 12,
    preferredColumns: [
      "S.No.",
      "Name",
      "CMPRs.",
      "P/E",
      "Mar CapRs.Cr.",
      "Div Yld%",
      "NP QtrRs.Cr.",
      "Qtr Profit Var%",
      "Sales QtrRs.Cr.",
      "Qtr Sales Var%",
      "ROCE%",
    ],
    columnLabels: {
      "S.No.": "#",
      "Name": "Company",
      "CMPRs.": "CMP (Rs)",
      "Mar CapRs.Cr.": "Market Cap (Rs Cr)",
      "Div Yld%": "Dividend Yield %",
      "NP QtrRs.Cr.": "Net Profit Qtr (Rs Cr)",
      "Qtr Profit Var%": "Qtr Profit Var %",
      "Sales QtrRs.Cr.": "Sales Qtr (Rs Cr)",
      "Qtr Sales Var%": "Qtr Sales Var %",
      "ROCE%": "ROCE %",
    },
    rowKey: "Name",
    sectionId: "screener-peer-comparison-table",
    hideTitle: true,
  });

  return `
    <section class="peer-card">
      <div class="peer-card-head">
        <div>
          <h3>Peer comparison</h3>
        </div>
      </div>
      ${tableMarkup
        .replace('<article class="table-card" id="screener-peer-comparison-table">', '<div class="peer-table-shell">')
        .replace("</article>", "</div>")}
    </section>
  `;
}

function renderScreenerTables(snapshot) {
  const tables = snapshot.tables || {};
  const primaryTables = [
    "quarterly_results",
    "profit_and_loss",
    "balance_sheet",
    "cash_flows",
    "ratios",
    "shareholding_pattern",
  ];

  const tableMarkup = primaryTables
    .filter((key) => Array.isArray(tables[key]) && tables[key].length)
    .map((key) =>
      renderDataTableCard(
        key === "profit_and_loss"
          ? "Profit & Loss"
          : key === "balance_sheet"
            ? "Balance Sheet"
            : key === "cash_flows"
              ? "Cash Flow"
              : key === "quarterly_results"
                ? "Quarterly Results"
                : key === "shareholding_pattern"
                  ? "Investors"
                  : titleizeKey(key),
        tables[key],
        {
        maxColumns: Number.MAX_SAFE_INTEGER,
        maxRows: 10,
        preferredColumns: ["Item"],
        rowKey: "Item",
        sectionId:
          key === "profit_and_loss"
            ? "screener-profitloss-section"
            : key === "balance_sheet"
              ? "screener-balancesheet-section"
              : key === "cash_flows"
                ? "screener-cashflow-section"
                : key === "ratios"
                  ? "screener-ratios-section"
                  : key === "quarterly_results"
                    ? "screener-quarters-section"
                    : "",
      })
    )
    .join("");

  return tableMarkup;
}

function renderScreener(snapshot) {
  const meta = snapshot.meta || {};
  const summary = snapshot.summary || {};
  const charts = snapshot.charts || {};
  const analysis = snapshot.analysis || {};
  const peers = snapshot.peers_api || [];
  const fetchState = snapshot.fetch_state || "cached";
  const badgeMap = {
    cached: "DB Cache",
    fetched_on_demand: "Fetched Now",
    refreshed: "Refreshed",
  };

  $("screener-company-name").textContent =
    summary.company_name || meta.company_name || meta.symbol || "Screener Snapshot";
  $("screener-price").textContent = summary["Current Price"] || "--";
  $("screener-price-change").textContent = summary["High / Low"] || "Stored snapshot";
  $("screener-company-meta").textContent = `${meta.symbol || "--"} | Last scraped ${meta.scraped_at || "--"}`;
  $("screener-company-links").innerHTML = createCompanyLinks(meta, summary);
  $("screener-sidebar").innerHTML = renderScreenerSidebar(analysis);
  $("screener-badge").textContent = badgeMap[fetchState] || "Screener";
  $("screener-badge").dataset.tone = fetchState;
  $("screener-summary").innerHTML =
    createSummaryCards(summary) || `<div class="screener-empty">No summary metrics stored for this company.</div>`;
  $("screener-charts").innerHTML = renderScreenerCharts(charts);
  bindScreenerChartControls();
  mountScreenerChart();

  $("screener-analysis").innerHTML = renderAnalysisCard(analysis, peers);
  $("screener-peers").innerHTML = renderPeerSection(peers, meta.symbol || currentSymbol);

  const tableMarkup = renderScreenerTables(snapshot);
  $("screener-tables").innerHTML =
    tableMarkup || `<div class="screener-empty">No Screener tables stored for this company.</div>`;
}

async function loadScreenerData(symbolText = currentSymbol) {
  const requestId = ++screenerRequestId;
  const symbol = normalizeSymbolInput(symbolText || currentSymbol);
  setScreenerState(`Loading Screener snapshot for ${symbol}...`, "loading");

  const response = await fetch(`/api/screener/company?symbol=${encodeURIComponent(symbol)}`);
  const payload = await response.json();

  if (requestId !== screenerRequestId) {
    return;
  }

  if (!response.ok) {
    setScreenerState(payload.error || `No Screener snapshot found for ${symbol}.`, "error");
    return;
  }

  renderScreener(payload);
}

async function refreshScreenerData(symbolText = currentSymbol) {
  if (screenerRefreshInFlight) {
    return;
  }

  const requestId = ++screenerRequestId;
  const symbol = normalizeSymbolInput(symbolText || currentSymbol);
  setScreenerRefreshState(true);
  setScreenerState(`Refreshing Screener snapshot for ${symbol}...`, "loading");

  try {
    const response = await fetch(`/api/screener/refresh?symbol=${encodeURIComponent(symbol)}`, {
      method: "POST",
    });
    const payload = await response.json();

    if (requestId !== screenerRequestId) {
      return;
    }

    if (!response.ok) {
      setScreenerState(payload.error || `Refresh failed for ${symbol}.`, "error");
      return;
    }

    renderScreener(payload);
  } catch (error) {
    console.error(error);
    if (requestId === screenerRequestId) {
      setScreenerState(`Refresh failed for ${symbol}: ${error.message}`, "error");
    }
  } finally {
    setScreenerRefreshState(false);
  }
}

function buildWidget(options = {}) {
  currentSourceId = options.sourceId || $("source-select").value;
  currentSymbol = options.symbol || getDefaultSymbol();
  currentResolution = options.resolution || currentResolution || "1D";

  $("source-select").value = currentSourceId;
  $("symbol-input").value = currentSymbol.replace("NSE:", "");
  destroyWidget();
  setStatus(`Loading ${currentSymbol} on ${currentResolution} from ${currentSourceId}...`, "loading");
  loadWatchlistQuotes().catch((error) => console.error(error));
  if (currentView === "screener") {
    loadScreenerData(currentSymbol).catch((error) => console.error(error));
  }

  widget = new TradingView.widget({
    autosize: true,
    symbol: currentSymbol,
    interval: currentResolution,
    container: "tv_chart_container",
    library_path: "/charting_library/",
    locale: "en",
    theme: currentTheme,
    datafeed: window.createAppDatafeed(currentSourceId, setStatus),
    disabled_features: ["use_localstorage_for_settings"],
    enabled_features: ["study_templates", "header_symbol_search", "header_resolutions"],
    fullscreen: false,
    timezone: "Asia/Kolkata",
    favorites: {
      intervals: ["1", "5", "15", "30", "60", "240", "1D", "1W", "1M"],
    },
    time_frames: [
      { text: "1D", resolution: "1", description: "1 day" },
      { text: "1W", resolution: "5", description: "1 week" },
      { text: "1M", resolution: "60", description: "1 month" },
      { text: "6M", resolution: "1D", description: "6 months" },
      { text: "1Y", resolution: "1D", description: "1 year" },
      { text: "5Y", resolution: "1W", description: "5 years" },
    ],
  });

  widget.onChartReady(async () => {
    widget.activeChart().setResolution(currentResolution, () => {});
    await widget.changeTheme(currentTheme);
    bindChartEvents();
    setStatus(`Ready: ${currentSymbol} on ${currentResolution} from ${currentSourceId}`, "ready");
    syncWatchlistDropdown();
    await loadWatchlistQuotes();
  });
}

function addSymbolToActiveWatchlist(symbolText) {
  const symbol = normalizeSymbolInput(symbolText || "");
  if (!symbol) {
    return;
  }

  const state = getWatchlistsState();
  const activeList = state.lists[state.activeId];
  if (!activeList) {
    return;
  }

  const fullSymbol = `NSE:${symbol}`;
  if (!activeList.symbols.includes(fullSymbol)) {
    activeList.symbols.push(fullSymbol);
    saveWatchlistsState(state);
    loadWatchlistQuotes().catch((error) => console.error(error));
  }
}

function removeSymbolFromActiveWatchlist(symbolText) {
  const symbol = normalizeSymbolInput(symbolText || "");
  if (!symbol) {
    return;
  }

  const state = getWatchlistsState();
  const activeList = state.lists[state.activeId];
  if (!activeList) {
    return;
  }

  const fullSymbol = `NSE:${symbol}`;
  activeList.symbols = activeList.symbols.filter((item) => item !== fullSymbol);
  saveWatchlistsState(state);
  loadWatchlistQuotes().catch((error) => console.error(error));
}

function createNewWatchlist() {
  const listName = window.prompt("New watchlist name");
  if (!listName) {
    return;
  }

  const state = getWatchlistsState();
  const id = `list_${Date.now()}`;
  state.lists[id] = {
    id,
    title: listName,
    symbols: [currentSymbol],
  };
  state.activeId = id;
  saveWatchlistsState(state);
  syncWatchlistDropdown();
  loadWatchlistQuotes().catch((error) => console.error(error));
}

function switchActiveWatchlist(listId) {
  const state = getWatchlistsState();
  if (!state.lists[listId]) {
    return;
  }

  state.activeId = listId;
  saveWatchlistsState(state);
  syncWatchlistDropdown();
  loadWatchlistQuotes().catch((error) => console.error(error));
}

async function toggleTheme() {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  window.localStorage.setItem("tradingview_ui_theme", currentTheme);
  applyShellTheme(currentTheme);
  if (widget) {
    await widget.changeTheme(currentTheme);
  }
}

function bindEvents() {
  $("load-chart").addEventListener("click", () => {
    buildWidget();
  });

  $("symbol-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      buildWidget();
    }
  });

  $("source-select").addEventListener("change", () => {
    buildWidget({ sourceId: $("source-select").value });
  });

  $("tab-price").addEventListener("click", () => {
    switchView("price");
  });

  $("tab-screener").addEventListener("click", () => {
    switchView("screener");
  });

  if ($("tab-news")) {
    $("tab-news").addEventListener("click", () => {
      switchView("news");
    });
  }

  if ($("news-fetcher-toggle")) {
    $("news-fetcher-toggle").addEventListener("click", () => {
      toggleFetcher();
    });
  }

  if ($("news-refresh-fundamentals")) {
    $("news-refresh-fundamentals").addEventListener("click", async () => {
      try {
        const btn = $("news-refresh-fundamentals");
        const originalText = btn.textContent;
        btn.textContent = "Refreshing...";
        btn.disabled = true;
        await fetch("/api/announcements/refresh_fundamentals", { method: "POST" });
        setTimeout(() => {
          btn.textContent = originalText;
          btn.disabled = false;
        }, 3000);
      } catch (error) {
        console.error("Failed to refresh fundamentals:", error);
      }
    });
  }

  if ($("news-filter-apply")) {
    $("news-filter-apply").addEventListener("click", () => {
      refreshNewsView();
    });
  }

  const soundToggle = $("news-sound-toggle");
  const soundWatchlist = $("news-sound-watchlist");
  const soundWatchlistLabel = $("news-sound-watchlist-label");
  if (soundToggle && soundWatchlist) {
    soundToggle.addEventListener("change", (e) => {
      soundWatchlist.disabled = !e.target.checked;
      soundWatchlistLabel.style.color = e.target.checked ? "var(--text)" : "var(--muted)";
      if (e.target.checked) {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
      }
    });
  }

  $("watchlist-panel-toggle").addEventListener("click", () => {
    toggleResponsiveWatchlistPanel();
  });

  $("watchlist-rail-toggle").addEventListener("click", () => {
    toggleResponsiveWatchlistPanel();
  });

  const resizer = $("watchlist-resizer");
  const workspace = document.querySelector(".workspace");
  let isResizing = false;

  if (resizer && workspace) {
    const savedWidth = window.localStorage.getItem("tradingview_ui_watchlist_width");
    if (savedWidth) {
      workspace.style.setProperty("--watchlist-width", `${savedWidth}px`);
    }

    resizer.addEventListener("mousedown", (e) => {
      isResizing = true;
      resizer.classList.add("dragging");
      document.body.style.cursor = "ew-resize";
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!isResizing) return;
      let newWidth = window.innerWidth - e.clientX;
      if (newWidth < 200) newWidth = 200;
      if (newWidth > 800) newWidth = 800;
      workspace.style.setProperty("--watchlist-width", `${newWidth}px`);
    });

    window.addEventListener("mouseup", () => {
      if (isResizing) {
        isResizing = false;
        resizer.classList.remove("dragging");
        document.body.style.cursor = "";
        const currentWidth = workspace.style.getPropertyValue("--watchlist-width").replace("px", "");
        if (currentWidth) {
          window.localStorage.setItem("tradingview_ui_watchlist_width", currentWidth);
          scheduleScreenerLayoutSync();
        }
      }
    });
  }

  $("screener-refresh").addEventListener("click", () => {
    refreshScreenerData(currentSymbol).catch((error) => {
      console.error(error);
      setScreenerState(`Refresh failed: ${error.message}`, "error");
      setScreenerRefreshState(false);
    });
  });

  $("new-watchlist").addEventListener("click", () => {
    createNewWatchlist();
  });

  $("watchlist-add").addEventListener("click", () => {
    openSymbolModal();
  });

  $("watchlist-select").addEventListener("change", () => {
    switchActiveWatchlist($("watchlist-select").value);
  });

  $("theme-toggle").addEventListener("click", () => {
    toggleTheme().catch((error) => console.error(error));
  });

  $("symbol-modal-close").addEventListener("click", () => {
    closeSymbolModal();
  });

  $("symbol-modal").addEventListener("click", (event) => {
    if (event.target === $("symbol-modal")) {
      closeSymbolModal();
    }
  });

  $("symbol-search-input").addEventListener("input", (event) => {
    const query = event.target.value;
    if (symbolSearchTimer) {
      window.clearTimeout(symbolSearchTimer);
    }
    symbolSearchTimer = window.setTimeout(() => {
      searchSymbols(query).catch((error) => {
        console.error(error);
        setSymbolSearchStatus(`Search failed: ${error.message}`);
      });
    }, 180);
  });

  $("symbol-search-input").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSymbolModal();
    }
  });

  window.addEventListener("resize", () => {
    scheduleScreenerLayoutSync();
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
    const today = new Date().toISOString().split("T")[0];
    if ($("news-filter-start")) $("news-filter-start").value = today;
    if ($("news-filter-end")) $("news-filter-end").value = today;
    
    applyShellTheme(currentTheme);
    applyResponsiveWatchlistPanelState();
    await loadSources();
    syncWatchlistDropdown();
    await loadWatchlistQuotes();
    startWatchlistAutoRefresh();
    refreshActiveStockNews();
    startNewsPolling();
    bindEvents();
    setScreenerState("Open the Screener tab to load stored fundamentals data.");
    buildWidget();
    checkFundamentalStatus();
    switchView(currentView);
  } catch (error) {
    console.error(error);
    setStatus(`Startup failed: ${error.message}`, "error");
  }
});

let lastSeenAnnouncementDate = null;
let audioCtx = null;

function playBeep(type) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(type === 'positive' ? 880 : 220, audioCtx.currentTime);
  
  gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
  
  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  
  oscillator.start();
  oscillator.stop(audioCtx.currentTime + 0.5);
}

let newsPollTimer = null;

async function loadAnnouncements(params = {}) {
  try {
    const searchParams = new URLSearchParams();
    searchParams.append("limit", params.limit || 50);
    if (params.symbol) searchParams.append("symbol", params.symbol);
    if (params.start_date) searchParams.append("start_date", params.start_date);
    if (params.end_date) searchParams.append("end_date", params.end_date);
    if (params.sentiments) searchParams.append("sentiments", params.sentiments);

    const url = `/api/announcements?${searchParams.toString()}`;
    const response = await fetch(url);
    const data = await response.json();
    return data.announcements || [];
  } catch (error) {
    console.error("Failed to fetch announcements:", error);
    return [];
  }
}

function renderNewsFeed(containerId, announcements) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = "";
  
  if (!announcements.length) {
    container.innerHTML = `<div class="screener-empty">No announcements available.</div>`;
    return;
  }
  
  announcements.forEach(item => {
    let sentimentClass = "sentiment-neutral";
    const sentiment = (item.sentiment || "").toLowerCase();
    if (sentiment.includes("positive") || sentiment.includes("good") || sentiment.includes("bullish")) {
      sentimentClass = "sentiment-positive";
    } else if (sentiment.includes("negative") || sentiment.includes("bad") || sentiment.includes("bearish")) {
      sentimentClass = "sentiment-negative";
    }
    
    const div = document.createElement("div");
    div.className = `news-card ${sentimentClass}`;
    
    const formattedSummary = window.marked ? marked.parse(item.summary || "No summary available.") : (item.summary || "No summary available.");
    
    const displayTitle = item.title ? item.title : (item.symbol || item.company_name || "Announcement");
    const displaySymbol = item.title ? `<div class="news-card-symbol" style="color: var(--accent); font-weight: bold; font-size: 13px; text-transform: uppercase;">${item.symbol || ""}</div>` : "";

    div.innerHTML = `
      <div class="news-card-header" style="cursor: pointer;" onclick="this.parentElement.classList.toggle('expanded')">
        <div style="display: flex; flex-direction: column; gap: 4px; padding-right: 12px;">
          ${displaySymbol}
          <div class="news-card-title">${displayTitle}</div>
        </div>
        <div class="news-card-date" style="white-space: nowrap; flex-shrink: 0;">${item.broadcast_date || item.fetched_at || ""}</div>
      </div>
      <div class="news-card-summary markdown-body">${formattedSummary}</div>
      ${item.pdf_url ? `<a href="${item.pdf_url}" target="_blank" class="news-card-link">View PDF</a>` : ""}
    `;
    container.appendChild(div);
  });
}

async function refreshNewsView() {
  const startEl = $("news-filter-start");
  const endEl = $("news-filter-end");
  const symbolEl = $("news-filter-symbol");
  
  const sentiments = [];
  if ($("news-filter-positive")?.checked) sentiments.push("POSITIVE");
  if ($("news-filter-negative")?.checked) sentiments.push("NEGATIVE");
  if ($("news-filter-neutral")?.checked) sentiments.push("NEUTRAL");

  const announcements = await loadAnnouncements({
    start_date: startEl?.value || "",
    end_date: endEl?.value || "",
    symbol: symbolEl?.value || "",
    sentiments: sentiments.join(","),
    limit: 50
  });
  renderNewsFeed("news-feed", announcements);
}

async function refreshActiveStockNews() {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  const start_date = date.toISOString().split("T")[0];

  const announcements = await loadAnnouncements({
    symbol: currentSymbol.replace("NSE:", ""),
    limit: 30,
    start_date: start_date,
    sentiments: "POSITIVE,NEGATIVE"
  });
  renderNewsFeed("active-stock-news", announcements);
}

async function toggleFetcher() {
  try {
    const response = await fetch("/api/announcements/toggle", { method: "POST" });
    const data = await response.json();
    updateFetcherButtonState(data.running);
  } catch (error) {
    console.error("Failed to toggle fetcher:", error);
  }
}

async function checkFetcherStatus() {
  try {
    const response = await fetch("/api/announcements/status");
    const data = await response.json();
    updateFetcherButtonState(data.running);
    
    const progressContainer = $("fetcher-progress-container");
    if (data.running) {
      if (progressContainer) progressContainer.style.display = "flex";
      const pct = data.total ? (data.processed / data.total) * 100 : 0;
      if ($("fetcher-progress")) $("fetcher-progress").value = pct;
      if ($("fetcher-status-text")) {
        let txt = `Processing: ${data.processed}/${data.total}`;
        if (data.current_company) txt += ` (${data.current_company})`;
        $("fetcher-status-text").textContent = txt;
      }
    } else {
      if (progressContainer) progressContainer.style.display = "none";
    }
  } catch (error) {
    console.error("Failed to check fetcher status:", error);
  }
}

async function checkFundamentalStatus() {
  try {
    const response = await fetch("/api/announcements/refresh_fundamentals_status");
    const data = await response.json();
    
    const progressContainer = $("fundamental-progress-container");
    const btn = $("news-refresh-fundamentals");
    
    if (data.running) {
      if (progressContainer) progressContainer.style.display = "flex";
      if (btn) {
        btn.textContent = "Refreshing...";
        btn.disabled = true;
      }
      const pct = data.total ? (data.processed / data.total) * 100 : 0;
      if ($("fundamental-progress")) $("fundamental-progress").value = pct;
      if ($("fundamental-status-text")) {
        $("fundamental-status-text").textContent = `Refreshing: ${data.processed}/${data.total}`;
      }
    } else {
      if (progressContainer) progressContainer.style.display = "none";
      if (btn && btn.textContent === "Refreshing...") {
        btn.textContent = "Refresh Fundamentals";
        btn.disabled = false;
      }
    }
    
    if (data.last_refresh) {
      const dateStr = new Date(data.last_refresh).toLocaleString();
      if ($("fundamental-last-refresh")) $("fundamental-last-refresh").textContent = `Updated: ${dateStr}`;
      if ($("fundamental-count")) $("fundamental-count").textContent = `${data.company_count} Companies`;
    } else {
      if ($("fundamental-last-refresh")) $("fundamental-last-refresh").textContent = `Updated: Never`;
      if ($("fundamental-count")) $("fundamental-count").textContent = `0 Companies`;
    }
  } catch (error) {
    console.error("Failed to check fundamental status:", error);
  }
}

function updateFetcherButtonState(isRunning) {
  const btn = $("news-fetcher-toggle");
  if (btn) {
    btn.textContent = isRunning ? "Stop Fetcher" : "Start Fetcher";
    btn.className = isRunning ? "primary-button" : "secondary-button";
  }
}

function startNewsPolling() {
  if (newsPollTimer) clearInterval(newsPollTimer);
  newsPollTimer = setInterval(async () => {
    if (currentView === "news") {
      refreshNewsView();
    }
    
    // Check for new announcements
    const latestAnnouncements = await loadAnnouncements({ limit: 5 });
    if (latestAnnouncements.length > 0) {
      const maxDate = latestAnnouncements[0].fetched_at;
      if (lastSeenAnnouncementDate && maxDate > lastSeenAnnouncementDate) {
        // We have a new announcement!
        if ($("news-sound-toggle")?.checked) {
          const item = latestAnnouncements[0];
          const watchlistOnly = $("news-sound-watchlist")?.checked;
          const state = getWatchlistsState();
          const activeList = state.lists[state.activeId];
          
          let shouldPlay = true;
          if (watchlistOnly && activeList && item.symbol) {
            if (!activeList.symbols.includes(`NSE:${item.symbol}`)) {
              shouldPlay = false;
            }
          }
          
          if (shouldPlay) {
            const sentiment = (item.sentiment || "").toLowerCase();
            if (sentiment.includes("positive") || sentiment.includes("good") || sentiment.includes("bullish")) {
              playBeep("positive");
            } else if (sentiment.includes("negative") || sentiment.includes("bad") || sentiment.includes("bearish")) {
              playBeep("negative");
            }
          }
        }
      }
      lastSeenAnnouncementDate = maxDate;
    }
    
    refreshActiveStockNews();
    checkFetcherStatus();
    checkFundamentalStatus();
  }, 10000);
}