"""Module-level constants, path aliases and configuration mappings."""

from __future__ import annotations

from datetime import timedelta

from config.paths import (  # noqa: E402
    UI_DIR, TRADINGVIEW_CHARTS_DIR, SCREENER_DB, LOGS_DIR
)

# ── Path aliases ──────────────────────────────────────────────────────────────
APP_DIR = UI_DIR
TRADINGVIEW_DIR = TRADINGVIEW_CHARTS_DIR
SCREENER_DB_PATH = SCREENER_DB
SERVER_LOG_PATH = LOGS_DIR / "server.log"
SCREENER_SOURCE_BASE = "https://www.screener.in/company"

# ── Supported resolutions & defaults ─────────────────────────────────────────
SUPPORTED_RESOLUTIONS = ["1", "5", "15", "30", "60", "240", "1D", "1W", "1M"]
DEFAULT_WATCHLIST = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN"]

SOURCE_DEFINITIONS = [
    {
        "id": "yfinance",
        "label": "Yahoo Finance",
        "status": "available",
        "description": "Fetches chart bars from yfinance.",
    },
    {
        "id": "duckdb_market_data",
        "label": "DuckDB Market Data",
        "status": "coming_soon",
        "description": "Reserved for the local DuckDB OHLCV warehouse.",
    },
    {
        "id": "nse_bhavcopy",
        "label": "NSE Bhavcopy",
        "status": "coming_soon",
        "description": "Reserved for the SQLite bhavcopy store.",
    },
]

# ── YFinance interval / resolution mappings ──────────────────────────────────
RESOLUTION_TO_YF_INTERVAL = {
    "1": "1m",
    "5": "5m",
    "15": "15m",
    "30": "30m",
    "60": "60m",
    "240": "1h",
    "1D": "1d",
    "D": "1d",
    "1W": "1wk",
    "W": "1wk",
    "1M": "1mo",
    "M": "1mo",
}

RESOLUTION_LOOKBACK_BUFFER = {
    "1m": timedelta(days=7),
    "5m": timedelta(days=60),
    "15m": timedelta(days=60),
    "30m": timedelta(days=60),
    "60m": timedelta(days=730),
    "1h": timedelta(days=730),
    "1d": timedelta(days=3650),
    "1wk": timedelta(days=3650),
    "1mo": timedelta(days=3650),
}

YF_INTERVAL_LIMITS = {
    "1m": timedelta(days=7),
    "5m": timedelta(days=60),
    "15m": timedelta(days=60),
    "30m": timedelta(days=60),
    "60m": timedelta(days=730),
    "1h": timedelta(days=730),
    "1d": timedelta(days=3650),
    "1wk": timedelta(days=3650),
    "1mo": timedelta(days=3650),
}
