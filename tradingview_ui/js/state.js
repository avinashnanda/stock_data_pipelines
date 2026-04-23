/* ═══════════════════════════════════════════════════════════════════════════
   STATE — Global state declarations and configuration constants
   ═══════════════════════════════════════════════════════════════════════════ */

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
