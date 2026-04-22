"""
Package the Python backend into a standalone executable using PyInstaller.

Usage:
    python build_scripts/package_python.py

This produces a folder `python_dist/` at the project root containing
the `stock_backend` executable (or `stock_backend.exe` on Windows).
The Electron builder is configured to bundle this folder into the
final installer via `extraResources`.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_ROOT / "python_dist"
SPEC_NAME = "stock_backend"


def clean_previous_build():
    """Remove previous build artifacts."""
    for d in [OUTPUT_DIR, PROJECT_ROOT / "build"]:
        if d.exists():
            print(f"  Removing {d}")
            shutil.rmtree(d)
    spec_file = PROJECT_ROOT / f"{SPEC_NAME}.spec"
    if spec_file.exists():
        spec_file.unlink()


def run_pyinstaller():
    """Run PyInstaller to build the sidecar executable."""
    entry_point = str(PROJECT_ROOT / "tradingview_ui" / "server.py")

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--name", SPEC_NAME,
        # One-folder mode (faster startup, easier debugging, smaller)
        "--onedir",
        # No console window
        "--noconsole",
        # Output directory
        "--distpath", str(OUTPUT_DIR),
        # Work directory
        "--workpath", str(PROJECT_ROOT / "build"),
        # ── Bundle data directories ──
        "--add-data", f"{PROJECT_ROOT / 'tradingview_ui'}{_sep()}tradingview_ui",
        "--add-data", f"{PROJECT_ROOT / 'trading_view_advanced_charts'}{_sep()}trading_view_advanced_charts",
        "--add-data", f"{PROJECT_ROOT / 'data'}{_sep()}data",
        "--add-data", f"{PROJECT_ROOT / 'announcement_fetcher'}{_sep()}announcement_fetcher",
        "--add-data", f"{PROJECT_ROOT / 'screener_client'}{_sep()}screener_client",
        "--add-data", f"{PROJECT_ROOT / 'db' / '__init__.py'}{_sep()}db",
        "--add-data", f"{PROJECT_ROOT / 'db' / 'db_utils.py'}{_sep()}db",
        "--add-data", f"{PROJECT_ROOT / 'db' / 'db_schema.sql'}{_sep()}db",
        "--add-data", f"{PROJECT_ROOT / 'db' / 'common.py'}{_sep()}db",
        "--add-data", f"{PROJECT_ROOT / 'db' / 'create_db.py'}{_sep()}db",
        "--add-data", f"{PROJECT_ROOT / 'config.py'}{_sep()}.",
        "--add-data", f"{PROJECT_ROOT / 'paths.py'}{_sep()}.",
        # ── Hidden imports (modules that PyInstaller may miss) ──
        "--hidden-import", "duckdb",
        "--hidden-import", "pandas",
        "--hidden-import", "yfinance",
        "--hidden-import", "langchain_openai",
        "--hidden-import", "langchain",
        "--hidden-import", "langchain.text_splitter",
        "--hidden-import", "pdfminer",
        "--hidden-import", "pdfminer.high_level",
        "--hidden-import", "selenium",
        "--hidden-import", "transformers",
        "--hidden-import", "requests",
        "--hidden-import", "tqdm",
        "--hidden-import", "sklearn",
        "--hidden-import", "openpyxl",
        "--hidden-import", "bs4",
        "--hidden-import", "plotly",
        # Overwrite
        "--noconfirm",
        # The entry point
        entry_point,
    ]

    print("\n  Running PyInstaller...")
    print(f"  Command: {' '.join(cmd)}\n")
    result = subprocess.run(cmd, cwd=str(PROJECT_ROOT))
    if result.returncode != 0:
        print(f"\n  ❌ PyInstaller failed with exit code {result.returncode}")
        sys.exit(result.returncode)

    print(f"\n  ✅ Python backend packaged successfully to: {OUTPUT_DIR / SPEC_NAME}")


def _sep() -> str:
    """Return the PyInstaller path separator (`;` on Windows, `:` elsewhere)."""
    return ";" if sys.platform == "win32" else ":"


def main():
    print("=" * 60)
    print("  Stock Data Pipelines – Python Backend Packager")
    print("=" * 60)

    print("\n[1/2] Cleaning previous builds...")
    clean_previous_build()

    print("[2/2] Running PyInstaller...")
    run_pyinstaller()

    print("\n" + "=" * 60)
    print("  Build complete!")
    print(f"  Output: {OUTPUT_DIR / SPEC_NAME}")
    print("=" * 60)


if __name__ == "__main__":
    main()
