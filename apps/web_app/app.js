/* ═══════════════════════════════════════════════════════════════════════════
   APP — Boot file: sources, view switching, widget, event bindings, init
   ═══════════════════════════════════════════════════════════════════════════ */

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

function switchView(view) {
  currentView = view;
  window.localStorage.setItem("tradingview_ui_view", view);
  $("tab-price").classList.toggle("active", view === "price");
  $("tab-screener").classList.toggle("active", view === "screener");
  if ($("tab-news")) $("tab-news").classList.toggle("active", view === "news");
  if ($("tab-hedgefund")) $("tab-hedgefund").classList.toggle("active", view === "hedgefund");

  $("price-view").classList.toggle("hidden", view !== "price");
  $("screener-view").classList.toggle("hidden", view !== "screener");
  if ($("news-view")) $("news-view").classList.toggle("hidden", view !== "news");
  if ($("hedgefund-view")) $("hedgefund-view").classList.toggle("hidden", view !== "hedgefund");

  if (view === "screener") {
    scheduleScreenerLayoutSync();
    loadScreenerData(currentSymbol).catch((error) => {
      console.error(error);
      setScreenerState(`Failed to load Screener data: ${error.message}`, "error");
    });
  } else if (view === "news") {
    refreshNewsView();
    checkFetcherStatus();
  } else if (view === "hedgefund") {
    if (typeof initHedgeFund === "function") initHedgeFund();
    if (typeof syncHedgeFundTicker === "function") syncHedgeFundTicker();
  }
}

function destroyWidget() {
  if (widget) {
    widget.remove();
    widget = null;
  }
}

function bindChartEvents() {
  const chart = widget?.activeChart?.();
  if (!chart || typeof chart.onSymbolChanged !== "function") return;

  // TradingView widget handles its own cleanup on .remove(), 
  // but we ensure we only subscribe once per widget instance.
  chart.onSymbolChanged().subscribe(null, (symbolInfo) => {
    const nextSymbol = symbolInfo.ticker || symbolInfo.name || currentSymbol;
    if (nextSymbol === currentSymbol) return; // Skip if no change
    
    currentSymbol = nextSymbol;
    $("symbol-input").value = normalizeSymbolInput(nextSymbol);
    loadWatchlistQuotes({ silent: true }).catch((error) => console.error(error));
    if (currentView === "screener") {
      loadScreenerData(nextSymbol).catch((error) => console.error(error));
    }
    refreshActiveStockNews();
  });
}

function buildWidget(options = {}) {
  currentSourceId = options.sourceId || $("source-select").value;
  currentSymbol = options.symbol || getDefaultSymbol();
  currentResolution = options.resolution || currentResolution || "1D";

  $("source-select").value = currentSourceId;
  $("symbol-input").value = currentSymbol.replace("NSE:", "");
  destroyWidget();
  setStatus(`Loading ${currentSymbol} on ${currentResolution} from ${currentSourceId}...`, "loading");
  
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
    // loadWatchlistQuotes is already called by startWatchlistAutoRefresh or init
  });
}

function bindEvents() {
  $("load-chart").addEventListener("click", () => { buildWidget(); });
  $("symbol-input").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); buildWidget(); } });
  $("source-select").addEventListener("change", () => { buildWidget({ sourceId: $("source-select").value }); });
  $("tab-price").addEventListener("click", () => { switchView("price"); });
  $("tab-screener").addEventListener("click", () => { switchView("screener"); });
  if ($("tab-news")) { $("tab-news").addEventListener("click", () => { switchView("news"); }); }
  if ($("tab-hedgefund")) { $("tab-hedgefund").addEventListener("click", () => { switchView("hedgefund"); }); }

  if ($("news-fetcher-toggle")) { $("news-fetcher-toggle").addEventListener("click", () => { toggleFetcher(); }); }

  if ($("news-refresh-fundamentals")) {
    $("news-refresh-fundamentals").addEventListener("click", async () => {
      try {
        const btn = $("news-refresh-fundamentals");
        const originalText = btn.textContent;
        btn.textContent = "Refreshing...";
        btn.disabled = true;
        await fetch("/api/announcements/refresh_fundamentals", { method: "POST" });
        setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 3000);
      } catch (error) { console.error("Failed to refresh fundamentals:", error); }
    });
  }

  if ($("news-filter-apply")) { $("news-filter-apply").addEventListener("click", () => { refreshNewsView(); }); }

  // Sound mode button (cycles off → all → watchlist → off)
  if ($("news-sound-btn")) { $("news-sound-btn").addEventListener("click", () => { cycleSoundMode(); }); }

  $("watchlist-panel-toggle").addEventListener("click", () => { toggleResponsiveWatchlistPanel(); });
  $("watchlist-rail-toggle").addEventListener("click", () => { toggleResponsiveWatchlistPanel(); });

  const resizer = $("watchlist-resizer");
  const workspace = document.querySelector(".workspace");
  let isResizing = false;

  if (resizer && workspace) {
    const savedWidth = window.localStorage.getItem("tradingview_ui_watchlist_width");
    if (savedWidth) { workspace.style.setProperty("--watchlist-width", `${savedWidth}px`); }

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

  $("new-watchlist").addEventListener("click", () => { createNewWatchlist(); });
  $("watchlist-add").addEventListener("click", () => { openSymbolModal(); });
  $("watchlist-select").addEventListener("change", () => { switchActiveWatchlist($("watchlist-select").value); });
  $("theme-toggle").addEventListener("click", () => { toggleTheme().catch((error) => console.error(error)); });
  $("symbol-modal-close").addEventListener("click", () => { closeSymbolModal(); });

  $("symbol-modal").addEventListener("click", (event) => {
    if (event.target === $("symbol-modal")) closeSymbolModal();
  });

  $("symbol-search-input").addEventListener("input", (event) => {
    const query = event.target.value;
    if (symbolSearchTimer) window.clearTimeout(symbolSearchTimer);
    symbolSearchTimer = window.setTimeout(() => {
      searchSymbols(query).catch((error) => {
        console.error(error);
        setSymbolSearchStatus(`Search failed: ${error.message}`);
      });
    }, 180);
  });

  $("symbol-search-input").addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSymbolModal();
  });

  window.addEventListener("resize", () => { scheduleScreenerLayoutSync(); });
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
    // Default date filters to today in initNewsModule.
    // Users can narrow the range manually via the filter inputs.

    applyShellTheme(currentTheme);
    applyResponsiveWatchlistPanelState();
    await loadSources();
    syncWatchlistDropdown();
    
    // Initial load (non-silent to show initial state)
    await loadWatchlistQuotes();
    
    startWatchlistAutoRefresh();
    initNewsModule();
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