author = avinash nanda

# Stock Data Pipelines

This repository is a local market-data and fundamentals workspace focused on Indian equities. It combines:

- A Yahoo Finance based OHLCV warehouse for NSE symbols
- An NSE bhavcopy downloader and incremental loader
- A Screener.in fundamentals scraper that stores raw company JSON in DuckDB
- Notebook-driven research utilities for symbol-universe creation and pattern analysis
- A vendored TradingView Advanced Charts package for chart UI experiments

## What The Repo Does

At a high level, the repo builds and maintains datasets that can be used for screening, charting, and research:

1. It creates a master stock universe in `data/all_stocks_combined.csv`
2. It loads that universe into DuckDB as instrument metadata
3. It downloads daily and weekly OHLCV candles from Yahoo Finance into DuckDB
4. It downloads official NSE bhavcopy files and stores normalized daily prices in SQLite
5. It scrapes Screener.in company pages plus internal API endpoints and stores raw JSON snapshots in DuckDB
6. It provides notebook and utility code for technical-pattern analysis on intraday data

## Main Components

### `market_data/`

This is the main price-history pipeline for NSE symbols using Yahoo Finance.

Responsibilities:

- Initializes the `db/market_data.duckdb` warehouse
- Loads instrument metadata from `data/all_stocks_combined.csv`
- Fetches missing OHLCV bars from Yahoo Finance
- Stores daily bars in `ohlcv_daily`
- Stores weekly bars in `ohlcv_weekly`
- Tracks failures in `logs/failed_symbols.txt`
- Supports retrying failed symbols later

Entry points:

- `python -m market_data.main`
  - Initializes tables
  - Loads instruments
  - Runs daily updates
  - Runs weekly updates
- `python -m market_data.reprocess_failed_symbols`
  - Re-runs only failed `(symbol, frequency)` pairs from the failure log

Key files:

- `market_data/main.py`: top-level orchestration
- `market_data/instrument_loader.py`: loads and cleans stock metadata CSV
- `market_data/yfinance_fetch.py`: fetches Yahoo Finance candles in bounded chunks
- `market_data/updater.py`: determines date ranges and writes incremental updates
- `market_data/db_utils.py`: creates tables and upserts OHLCV rows
- `market_data/config.py`: local DB path, retry config, and lookback settings

Important behavior:

- Only missing data is fetched after the first load
- Listing date from the CSV is loaded into metadata but not used to cap fetch ranges
- The code assumes Yahoo Finance symbol format `<SYMBOL>.NS`
- Failed initial loads are appended to a retry log instead of stopping the full run

DuckDB tables created by this pipeline:

- `instruments`
- `ohlcv_daily`
- `ohlcv_weekly`

### `nse_bhavcopy/`

This is a separate pipeline for downloading official NSE bhavcopy files and loading them into SQLite.

Responsibilities:

- Downloads NSE bhavcopy ZIP files for a date or date range
- Tries both the newer UDiFF archive format and the older historical archive format
- Normalizes inconsistent column names across bhavcopy formats
- Filters rows to the stock universe from `data/all_stocks_combined.csv`
- Stores daily prices in a SQLite table called `prices_daily`

CLI entry point:

- `python -m nse_bhavcopy.cli sync-latest --db-path <path>`
- `python -m nse_bhavcopy.cli fetch-range --db-path <path> --start_date YYYY-MM-DD --end_date YYYY-MM-DD`

Key files:

- `nse_bhavcopy/cli.py`: command-line interface
- `nse_bhavcopy/sync.py`: incremental sync and range fetch orchestration
- `nse_bhavcopy/bhavcopy.py`: bhavcopy URL selection, download, unzip, and DataFrame creation
- `nse_bhavcopy/db.py`: SQLite schema, normalization, filtering, and inserts
- `nse_bhavcopy/http_utils.py`: NSE session setup and retry logic

Important behavior:

- Skips weekends automatically
- Treats missing files as holiday or not-yet-published cases
- Uses the same stock-universe CSV as a symbol allowlist
- Stores data in SQLite, not DuckDB

### `screener_client/`

This is the fundamentals scraping pipeline for Screener.in.

Responsibilities:

- Builds Screener company URLs from symbols
- Fetches the company HTML page
- Extracts summary information and tabular sections from HTML
- Extracts internal company identifiers needed for Screener API endpoints
- Calls Screener chart, schedules, and peers endpoints asynchronously
- Parses the API payloads into JSON-friendly records
- Stores raw company snapshots and failure information through `db/`

Typical flow:

1. Read a CSV containing a `symbol` column
2. Build `https://www.screener.in/company/<SYMBOL>/consolidated/`
3. Scrape the HTML page
4. Extract `company_id` and `warehouse_id`
5. Call Screener API endpoints for charts, schedules, and peers
6. Merge everything into one JSON object
7. Store company metadata and raw JSON snapshot in DuckDB

Entry points:

- `screener_client/scrape_from_csv.py`
- `screener_client/fetch.py`

Key files:

- `screener_client/fetch.py`: top-level async company fetch orchestration
- `screener_client/company_retry.py`: retry policy and failure handling
- `screener_client/html_scraper.py`: HTML extraction with BeautifulSoup
- `screener_client/api_async.py`: async API calls with concurrency limits and backoff
- `screener_client/api_parsers.py`: parsers for charts, schedules, and peers payloads
- `screener_client/build_urls.py`: Screener endpoint builders
- `screener_client/helper.py`: numeric parsing and normalization helpers

Important behavior:

- Global concurrency is deliberately set to `1` to reduce ban risk
- Partial schedule data is accepted instead of repeatedly re-scraping a company
- Raw payloads are stored, not fully modeled into analytics tables
- Current CSV batch scraping is intentionally capped to the first 20 rows in `scrape_from_csv.py`

### `db/`

This folder contains the persistence layer for the Screener fundamentals scraper and checked-in local database files.

Responsibilities:

- Creates the Screener DuckDB schema
- Stores company metadata
- Stores raw JSON snapshots per scrape timestamp
- Stores failed company attempts

Schema objects:

- `companies`
- `raw_company_json`
- `failed_companies`

Key files:

- `db/db_schema.sql`: schema definition
- `db/create_db.py`: initializes `db/screener_financials.duckdb`
- `db/db_utils.py`: inserts raw JSON, upserts companies, and records failures

### `pattern_utils/`

This folder contains technical-analysis helpers used by the notebooks.

Current contents focus on triangle and flag-style pattern work:

- Fetch intraday OHLCV from Yahoo Finance
- Compute pivot highs and lows
- Detect triangle or flag-like setups
- Mark breakout windows
- Add volume-spike and MACD-based signals
- Plot candles, pivots, and detected patterns with Plotly

This is research code, not a production pipeline.

### `notebooks/`

The notebooks are workflow glue for research and data preparation.

Current notebook purposes:

- `notebooks/Fetch_all_stock_list.ipynb`
  - Builds the stock universe by combining BSE and NSE listings
  - Produces the master CSV used by the rest of the repo
- `notebooks/fetch_fundamental_data.ipynb`
  - Demonstrates how to run the Screener fetcher for one company and dump JSON

There are also additional top-level notebooks for experiments and backtests, such as flag-pattern analysis.

### `trading_view_advanced_charts/`

This directory is a vendored third-party TradingView Advanced Charts package.

It appears to be included for local charting/UI experimentation rather than being tightly integrated into the Python pipelines. The repository currently does not contain custom glue code that connects the warehouse data directly into this package.

## Data Inputs

The repo depends on a few core external inputs:

- Yahoo Finance
  - Used by `market_data/` and some research utilities
- NSE archives and NSE website
  - Used by `nse_bhavcopy/`
- Screener.in HTML and internal API endpoints
  - Used by `screener_client/`
- `data/all_stocks_combined.csv`
  - Acts as the master local universe for symbol metadata and filtering

Expected key columns in `data/all_stocks_combined.csv`:

- `symbol`
- `name of company`
- `date of listing`
- `isin number`
- `market cap`

## Data Stores

This repo uses more than one local database:

- `db/market_data.duckdb`
  - Price warehouse for the Yahoo Finance pipeline
- `db/screener_financials.duckdb`
  - Raw Screener fundamentals storage
- SQLite database chosen at runtime for `nse_bhavcopy`
  - Stores normalized NSE bhavcopy daily prices

The checked-in repo also contains `db/market.duckdb`, but in the current workspace it is not a valid DuckDB database file.

## End-To-End Workflows

### 1. Build The Stock Universe

Use `notebooks/Fetch_all_stock_list.ipynb` to combine NSE and BSE listings into:

- `data/all_stocks_combined.csv`

This CSV is the shared input for both the market data pipeline and the bhavcopy loader.

### 2. Build Or Refresh Price History

Run:

```bash
python -m market_data.main
```

This will:

- Create the DuckDB tables if needed
- Load instrument metadata
- Fetch missing daily bars
- Fetch missing weekly bars

If some symbols fail:

```bash
python -m market_data.reprocess_failed_symbols
```

### 3. Load Official NSE Bhavcopy Data

Run either:

```bash
python -m nse_bhavcopy.cli sync-latest --db-path db/marketdata.db
```

or:

```bash
python -m nse_bhavcopy.cli fetch-range --db-path db/marketdata.db --start_date 2025-01-01 --end_date 2025-01-31
```

This creates and updates a SQLite `prices_daily` table.

### 4. Scrape Fundamentals From Screener

Initialize the Screener schema if needed:

```bash
python db/create_db.py
```

Then scrape from a CSV of symbols:

```bash
python screener_client/scrape_from_csv.py data/all_stocks_combined.csv

python -m screener_client.scrape_from_csv data/all_stocks_combined.csv




```

This stores:

- Company metadata in `companies`
- Raw JSON snapshots in `raw_company_json`
- Failed attempts in `failed_companies`

## Current Architecture Summary

The repo is best understood as three mostly independent data pipelines sharing a common stock universe:

- `market_data/` for Yahoo Finance OHLCV in DuckDB
- `nse_bhavcopy/` for official NSE daily files in SQLite
- `screener_client/` plus `db/` for fundamentals scraping in DuckDB

On top of those, it also contains:

- notebook-based data-prep and research workflows
- pattern-detection utilities
- a third-party TradingView chart package

## Practical Notes And Limitations

- There is no single top-level application that ties all subsystems together
- The repo is research-oriented and pipeline-oriented, not packaged as a deployable product
- There are no automated tests in the current codebase
- Some files are exploratory notebooks and scratch outputs rather than production modules
- The Screener batch scraper currently processes only the first 20 CSV rows
- Concurrency is intentionally conservative for both Screener and market-data fetching
- A checked-in virtualenv and local database files make the repo larger and noisier than a source-only project

## Suggested Mental Model

If you are new to the repo, the easiest way to think about it is:

- `data/` defines what securities exist
- `market_data/` keeps price candles fresh
- `nse_bhavcopy/` captures official daily exchange files
- `screener_client/` captures fundamentals and company snapshots
- `pattern_utils/` and notebooks use those datasets for research

## TradingView UI

The repo now also includes a small local chart app in `tradingview_ui/` that uses the vendored Advanced Charts package from `trading_view_advanced_charts/`.

What it does:

- Renders a TradingView Advanced Chart in the browser
- Uses a custom Datafeed API implementation, which matches TradingView's recommended integration model for custom data sources
- Fetches symbol metadata and historical bars from a local Python server
- Uses Yahoo Finance as the live source for now
- Exposes a source dropdown so additional adapters can be added later without rebuilding the UI

Files:

- `tradingview_ui/server.py`: local HTTP server, source adapters, and API endpoints
- `tradingview_ui/index.html`: chart page
- `tradingview_ui/datafeed.js`: TradingView Datafeed API implementation
- `tradingview_ui/app.js`: source selector and widget bootstrapping
- `tradingview_ui/app.css`: page styling

Run it with:

```bash
.\.venv\Scripts\python.exe tradingview_ui\server.py --port 9001

python -m tradingview_ui.server
```

Then open:

```text
http://127.0.0.1:9001
```

Notes:

- Yahoo Finance is the only active source right now
- The source dropdown already includes placeholders for future DuckDB and NSE bhavcopy adapters
- The widget is configured against a custom datafeed, not the demo UDF feed