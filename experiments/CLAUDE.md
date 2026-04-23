# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

please use relative path for editing and writing files.

## Windows Rules
- Always use Windows-style backslash paths (e.g. `d:\projects\...`)
- Always re-read a file immediately before attempting to edit it
- Use large surrounding context (5+ lines) in old_string when editing
- Line endings on this machine are CRLF

## Project Overview and Architecture

This repository is a collection of data pipelines focused on Indian equities, designed to build and maintain datasets for screening, charting, and research. The architecture is composed of several specialized, largely independent pipelines that share a common stock universe derived from `data/all_stocks_combined.csv`.

The core components are:
1.  **Market Data Pipeline (`market_data/`):** Responsible for fetching, cleaning, and storing historical OHLCV data from Yahoo Finance into a DuckDB warehouse (`db/market_data.duckdb`). It handles daily and weekly updates incrementally.
2.  **NSE Bhavcopy Pipeline (`nse_bhavcopy/`):** Manages downloading official NSE bhavcopy files and normalizing the prices, storing the results in SQLite (`prices_daily`).
3.  **Screener Fundamentals Pipeline (`screener_client/`, `db/`):** Handles scraping company fundamentals from Screener.in HTML pages, extracts necessary data (including internal IDs), and stores raw JSON snapshots and metadata in a DuckDB schema (`db/screener_financials.duckdb`).
4.  **Research & Utilities (`pattern_utils/`, `notebooks/`):** Contains utility functions for technical analysis (e.g., pattern detection) and Jupyter Notebooks that serve as the primary workspace for data preparation, experiment execution, and analysis.
5.  **TradingView UI Layer (`tradingview_ui/`):** A self-contained local application that visualizes data using a vendored TradingView Advanced Charts package by interfacing with a custom Datafeed API served by `server.py`.

The system is designed as three main data processing pipelines feeding into shared persistence layers (DuckDB and SQLite), which are then utilized by the research notebooks and the final visualization layer.

## Essential Commands and Development Workflow

### 1. Setup & Environment
*   **Environment:** The project relies on a virtual environment, typically activated via `.\.venv\Scripts\activate`. Ensure this environment is active before running any pipeline scripts.
*   **Database Initialization:** To set up the fundamental data storage schema:
    ```bash
    python db/create_db.py
    ```

### 2. Market Data Pipeline Execution
The main orchestration for price history is handled by `market_data/main.py`.
*   **Full Run (Daily & Weekly Updates):**
    ```bash
    python -m market_data.main
    ```
*   **Reprocessing Failed Symbols:** To re-run updates only for symbols that previously failed:
    ```bash
    python -m market_data.reprocess_failed_symbols
    ```

### 3. NSE Bhavcopy Data Loading
This pipeline handles the official daily price files. It uses a specific SQLite path defined by the user.
*   **Sync Latest (Incremental Load):**
    ```bash
    python -m nse_bhavcopy.cli sync-latest --db-path <path>
    ```
*   **Fetch Specific Range:** To download a specific historical date range:
    ```bash
    python -m nse_bhavcopy.cli fetch-range --db-path <path> --start_date YYYY-MM-DD --end_date YYYY-MM-DD
    ```

### 4. Screener Fundamentals Scraping
This process scrapes company data from Screener.in and persists the results to DuckDB.
*   **Scrape from CSV:** To initiate the scraping process based on a list of symbols:
    ```bash
    python screener_client/scrape_from_csv.py data/all_stocks_combined.csv
    ```

### 5. Data Visualization (TradingView UI)
To run and view the local chart application, which requires setting up the local HTTP server.
*   **Start the Server:**
    ```bash
    .\.venv\Scripts\python.exe tradingview_ui\server.py --port 9001
    ```
*   **View Chart in Browser:**
    ```text
    http://127.0.0.1:9001
    ```

## Key Data Sources and Persistence Summary

| Data Source | Pipeline/Module | Storage Location | Purpose |
| :--- | :--- | :--- | :--- |
| **Instrument Metadata** | `market_data/` | `db/market_data.duckdb` | OHLCV price history (Yahoo Finance). |
| **Official Price History** | `nse_bhavcopy/` | SQLite (`prices_daily`) | Normalized daily NSE bhavcopy prices. |
| **Company Fundamentals** | `screener_client/` & `db/` | `db/screener_financials.duckdb` | Raw JSON snapshots and company metadata from Screener.in. |
| **Master Universe** | Input CSV | `data/all_stocks_combined.csv` | Master list of symbols (NSE/BSE) for all operations. |

## Further Context
*   **Limitation:** The system is research-oriented; there are no automated tests built into the core pipelines.
*   **Concurrency:** Concurrency is intentionally conservative in scraping and data fetching to respect external service limits.
*   **Note on Data:** All historical data is stored across DuckDB, SQLite, and raw JSON snapshots for maximum flexibility.