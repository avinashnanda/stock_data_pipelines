"""
Centralized path management for both development and packaged (PyInstaller) modes.

- ASSETS_DIR: read-only bundled assets (UI files, CSV data, TradingView charts).
  In dev mode this is the project root. In a PyInstaller bundle it is sys._MEIPASS.

- APP_DATA_DIR: writable directory for databases, logs, and user-generated data.
  In dev mode this is the project root. In packaged mode it uses the OS-standard
  application data folder (e.g. %LOCALAPPDATA%/StockDataPipelines on Windows,
  ~/Library/Application Support/StockDataPipelines on macOS).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _is_frozen() -> bool:
    """Return True when running inside a PyInstaller bundle."""
    return getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")


def _get_assets_dir() -> Path:
    """Return the directory that contains bundled read-only assets."""
    if _is_frozen():
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parents[1]


def _get_app_data_dir() -> Path:
    """Return a writable directory for databases, logs, and generated files."""
    if not _is_frozen():
        # Dev mode: use a dedicated user_data folder to prevent bloating the .exe
        data_dir = Path(__file__).resolve().parents[1] / "user_data"
        data_dir.mkdir(exist_ok=True)
        return data_dir

    # --- Packaged mode: use OS-standard application data folder ---
    app_name = "StockDataPipelines"

    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))
        data_dir = Path(base) / app_name
    elif sys.platform == "darwin":
        data_dir = Path.home() / "Library" / "Application Support" / app_name
    else:
        # Linux / fallback
        xdg = os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
        data_dir = Path(xdg) / app_name

    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


# ── Public path constants ────────────────────────────────────────────────────
ASSETS_DIR = _get_assets_dir()
APP_DATA_DIR = _get_app_data_dir()

# Read-only asset paths
UI_DIR = ASSETS_DIR / "apps" / "web_app"
TRADINGVIEW_CHARTS_DIR = ASSETS_DIR / "trading_view_advanced_charts"
DATA_DIR = ASSETS_DIR / "data"
UNIVERSE_CSV = DATA_DIR / "all_stocks_combined.csv"

# Writable data paths
DB_DIR = APP_DATA_DIR / "databases"
DB_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR = APP_DATA_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
FUNDAMENTAL_DATA_DIR = APP_DATA_DIR / "fundamental_data"
FUNDAMENTAL_DATA_DIR.mkdir(parents=True, exist_ok=True)

SCREENER_DB = DB_DIR / "screener_financials.duckdb"
ANNOUNCEMENTS_DB = DB_DIR / "announcements.duckdb"
FUNDAMENTALS_DB = DB_DIR / "fundamentals.duckdb"
HEDGE_FUND_DB = DB_DIR / "hedge_fund.duckdb"
WATCHLISTS_JSON = APP_DATA_DIR / "watchlists.json"
