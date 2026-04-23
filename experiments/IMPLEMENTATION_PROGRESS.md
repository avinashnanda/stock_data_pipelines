# Project Continuation Brief

Repository contains a **TradingView-style stock UI** with 2 main tabs:

## 1. Price Tab
- Uses vendored **TradingView Advanced Charts**
- Market data source = `yfinance`
- Supports:
  - symbol search
  - symbol resolve
  - historical bars
  - quotes
- Intervals:
  - `1m,5m,15m,30m,1h,4h,1D,1W,1M`
- Light / Dark theme implemented

## 2. Screener Tab
- Separate fundamentals page (not embedded TradingView chart)
- Uses **DuckDB**
- Reads cached symbol data
- Fetches on-demand if missing
- Manual refresh supported

---

# Important Files

## UI
- `tradingview_ui/server.py`
- `tradingview_ui/index.html`
- `tradingview_ui/app.js`
- `tradingview_ui/datafeed.js`
- `tradingview_ui/app.css`

## Screener Pipeline
- `screener_client/fetch.py`
- `screener_client/api_async.py`
- `screener_client/company_retry.py`
- `screener_client/scrape_from_csv.py`

## DB
- `db/db_utils.py`

---

# Architecture

## Price Tab
TradingView chart centered + custom right-side watchlist.

## Why Custom Watchlist?
Vendored TradingView build has stubbed / broken:

- `widgetbar.watchlist`
- `widget.watchList()`
- `widget.widgetbar()`

So built-in watchlist is unusable.

---

# Custom Watchlist Features

- right docked panel
- multiple watchlists
- add/remove symbols
- symbol search modal
- click row loads symbol in chart
- columns:
  - Symbol
  - Last
  - Chg
  - Chg%
- active row highlight
- local persistence
- periodic refresh

## Performance Fixes

- batched quote fetch
- short cache
- stale request protection
- loading/error/empty states

---

# Screener APIs

## Backend

### GET `/api/screener/company?symbol=XXX`
- read snapshot from DB
- fetch/store if missing

### POST `/api/screener/refresh?symbol=XXX`
- force refresh
- store latest data

---

# Screener Payload

- meta
- summary
- analysis
- charts
- schedules
- peers_api
- tables:
  - quarterly_results
  - profit_and_loss
  - balance_sheet
  - cash_flows
  - ratios
  - shareholding_pattern

---

# Screener Frontend Sections

- company header
- ratios grid
- about/key points
- pros/cons
- peer comparison
- wide financial tables
- mini SVG charts

---

# Technical Fixes Completed

- NaN / Infinity converted to JSON null
- per-symbol refresh locking
- import-path fixes
- direct script execution works

python tradingview_ui/server.py --port 9010
python -m tradingview_ui.server --port 9010
python screener_client/scrape_from_csv.py data/all_stocks_combined.csv
```

---

# Announcements Module

## 3. Announcements Tab
- Live-updating news feed and active stock context feed below the watchlist.
- Filterable by:
  - Date bounds (`start_date`, `end_date`)
  - Company Symbol
  - Sentiment (Positive, Negative, Neutral)
- **Innovative UI**:
  - Masonry-style CSS Grid layout for optimal screen space usage.
  - Interactive expand/collapse cards.
  - Markdown rendering using `marked.js`.
  - Configurable sound alerts with a Watchlist-only filter.

## Background Fetcher & LLM Processing
- Runs in a background thread to continually poll NSE for PDFs.
- Utilizes an LMStudio-backed model to:
  - Generate a 1-sentence `title` (structured JSON output).
  - Generate a detailed, formatted `summary`.
  - Predict `sentiment`.
- Deduplication: Avoids processing the same PDF twice using `db_utils` tracking.
- Progress Tracking: Exposes real-time processing metrics (total, processed, current company, errors) to the UI.

## Backend APIs
- `GET /api/announcements`: Serves announcements with support for date, sentiment, and symbol filters.
- `GET /api/announcements/status`: Returns current background fetcher metrics.
- `POST /api/announcements/toggle`: Starts or stops the background fetcher thread.