let widget = null;
let currentResolution = "1D";
let currentSourceId = "yfinance";
let currentSymbol = "NSE:RELIANCE";
let currentTheme = window.localStorage.getItem("tradingview_ui_theme") || "light";

const DEFAULT_WATCHLISTS = [
  {
    title: "Red list",
    symbols: [
      "###SECTION 1",
      "NSE:RELIANCE",
      "NSE:TCS",
      "NSE:INFY",
      "NSE:HDFCBANK",
      "NSE:ICICIBANK",
    ],
  },
  {
    title: "Banks",
    symbols: [
      "###SECTION 1",
      "NSE:HDFCBANK",
      "NSE:ICICIBANK",
      "NSE:SBIN",
      "NSE:KOTAKBANK",
      "NSE:AXISBANK",
    ],
  },
];

function $(id) {
  return document.getElementById(id);
}

function setStatus(message, tone) {
  const node = $("status");
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

function destroyWidget() {
  if (widget) {
    widget.remove();
    widget = null;
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

  widget = new TradingView.widget({
    autosize: true,
    symbol: currentSymbol,
    interval: currentResolution,
    container: "tv_chart_container",
    library_path: "/charting_library/",
    locale: "en",
    theme: currentTheme,
    datafeed: window.createAppDatafeed(currentSourceId, setStatus),
    enabled_features: [
      "study_templates",
      "header_symbol_search",
      "header_resolutions",
      "multiple_watchlists",
      "watchlist_sections",
    ],
    widgetbar: {
      watchlist: true,
      watchlist_settings: {
        default_symbols: DEFAULT_WATCHLISTS[0].symbols,
        readonly: false,
      },
    },
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
    try {
      widget.activeChart().setResolution(currentResolution, () => {});
      await widget.changeTheme(currentTheme);
      bindChartEvents();
      await initializeBuiltInWatchlists();
      setStatus(`Ready: ${currentSymbol} on ${currentResolution} from ${currentSourceId}`, "ready");
    } catch (error) {
      console.error(error);
      setStatus(`Widgetbar setup failed: ${error.message}`, "error");
    }
  });
}

function bindChartEvents() {
  const chart = widget.activeChart();
  if (!chart || typeof chart.onSymbolChanged !== "function") {
    return;
  }

  chart.onSymbolChanged().subscribe(null, (symbolInfo) => {
    const nextSymbol = symbolInfo.ticker || symbolInfo.name || currentSymbol;
    currentSymbol = nextSymbol;
    $("symbol-input").value = nextSymbol.replace("NSE:", "");
  });
}

async function initializeBuiltInWatchlists() {
  const watchlistApi = await widget.watchList();
  const widgetbarApi = await widget.widgetbar();
  const existingLists = watchlistApi.getAllLists() || {};
  const listsByTitle = new Map(
    Object.values(existingLists).map((list) => [String(list.title).toLowerCase(), list])
  );

  let preferredListId = null;

  DEFAULT_WATCHLISTS.forEach((definition, index) => {
    const existing = listsByTitle.get(definition.title.toLowerCase());
    if (existing) {
      preferredListId = preferredListId || existing.id;
      return;
    }

    const created = watchlistApi.createList(definition.title, definition.symbols);
    if (created?.id && index === 0) {
      preferredListId = created.id;
    }
  });

  if (!preferredListId) {
    preferredListId = watchlistApi.getActiveListId();
  }

  widgetbarApi.changeWidgetBarVisibility(true);
  widgetbarApi.showPage("watchlist_details_news");

  if (preferredListId) {
    watchlistApi.setActiveList(preferredListId);
  }
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

  $("theme-toggle").addEventListener("click", () => {
    toggleTheme().catch((error) => console.error(error));
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
    applyShellTheme(currentTheme);
    await loadSources();
    bindEvents();
    buildWidget();
  } catch (error) {
    console.error(error);
    setStatus(`Startup failed: ${error.message}`, "error");
  }
});
