# TradingView UI Implementation Notes

## Goal

Build a TradingView-style market chart UI inside this repository using the vendored TradingView Advanced Charts package, with:

- chart rendering via TradingView Advanced Charts
- market data sourced from `yfinance` for now
- room to add more data sources later
- a watchlist-style side panel
- a light/dark theme toggle
- a layout visually closer to TradingView

## Starting Point

The repository already contained:

- `trading_view_advanced_charts/`
  - vendored TradingView Advanced Charts package
- `data/all_stocks_combined.csv`
  - symbol universe used elsewhere in the repo
- Python market-data utilities and a local virtualenv

The TradingView package included sample pages like:

- `trading_view_advanced_charts/index.html`
- `trading_view_advanced_charts/test.html`

Those sample pages were using either the demo feed or sample UDF-compatible datafeed code, but not our own backend.

## What We Built

We added a new local app under:

- [tradingview_ui](/D:/projects/stock_data_pipelines/tradingview_ui)

This app contains:

- [server.py](/D:/projects/stock_data_pipelines/tradingview_ui/server.py)
  - lightweight Python HTTP server
  - serves the UI files
  - serves TradingView library assets from `trading_view_advanced_charts/`
  - exposes JSON endpoints for symbol search, symbol resolution, history, quotes, and watchlist data
- [index.html](/D:/projects/stock_data_pipelines/tradingview_ui/index.html)
  - main page
- [app.js](/D:/projects/stock_data_pipelines/tradingview_ui/app.js)
  - widget bootstrap
  - local watchlist handling
  - theme switching
  - interaction wiring
- [datafeed.js](/D:/projects/stock_data_pipelines/tradingview_ui/datafeed.js)
  - TradingView Datafeed API implementation
- [app.css](/D:/projects/stock_data_pipelines/tradingview_ui/app.css)
  - application styling

We also updated:

- [requirements.txt](/D:/projects/stock_data_pipelines/requirements.txt)
- [README.md](/D:/projects/stock_data_pipelines/README.md)

## Current Architecture

### 1. Frontend

The frontend is a plain HTML/CSS/JS app, not React.

It does the following:

- loads `charting_library.standalone.js`
- initializes `new TradingView.widget(...)`
- uses our custom datafeed object from `datafeed.js`
- allows symbol switching through the top toolbar
- allows theme switching through a Day/Night button
- renders a custom watchlist-like right panel

### 2. Backend

The backend is a small Python server in `server.py`.

It currently serves:

- `/api/health`
- `/api/sources`
- `/api/search`
- `/api/symbol`
- `/api/history`
- `/api/quote`
- `/api/quotes`
- `/api/watchlist`

### 3. Data source layer

We created a `SourceAdapter` abstraction and implemented:

- `YFinanceSourceAdapter`

This adapter currently supports:

- symbol search
- symbol resolution
- historical bars
- quote/quote-list payloads for watchlist rows

This was done so future adapters can be added for:

- DuckDB market data
- NSE bhavcopy
- any other source

without rewriting the TradingView integration.

## Symbol Search And Universe

The UI currently uses `data/all_stocks_combined.csv` to populate the symbol universe for search and resolution.

Important behaviors:

- symbol names are normalized to uppercase
- chart symbols are represented as `NSE:<SYMBOL>`
- Yahoo Finance symbols are mapped to `<SYMBOL>.NS`

Example:

- UI symbol: `NSE:RELIANCE`
- yfinance symbol: `RELIANCE.NS`

## Historical Data Support

### Initial implementation

We first implemented history loading by mapping TradingView resolutions to Yahoo intervals:

- `1` -> `1m`
- `5` -> `5m`
- `15` -> `15m`
- `30` -> `30m`
- `60` -> `60m`
- `240` -> `1h`
- `1D` -> `1d`
- `1W` -> `1wk`
- `1M` -> `1mo`

### Problem found

At first, only daily looked reliable.

Why:

- Yahoo Finance has strict retention limits for intraday intervals
- our initial request range logic sometimes asked for intervals beyond those limits
- the extra preload buffer pushed `5m` requests outside Yahoo’s allowed 60-day window

### Fix applied

We updated the backend history range logic to clamp requests to Yahoo’s real retention limits.

Current practical behavior:

- `1m` works only for roughly the last 7 days
- `5m`, `15m`, `30m` work for roughly the last 60 days
- `60m` / `1h` works for much longer
- `1D`, `1W`, `1M` work over much longer ranges

This made the TradingView chart usable across multiple resolutions, with the caveat that intraday availability still depends on Yahoo’s hard limits.

## Watchlist Work

Watchlist implementation was the most iterative part of the work.

### Attempt 1: custom watchlist in sidebar

We first built a custom watchlist panel with:

- local storage state
- list of symbols
- quote loading from the backend
- click-to-switch-symbol behavior

This worked functionally, but the layout was not close enough to TradingView.

### Attempt 2: try TradingView built-in watchlist via `widgetbar`

The user asked whether TradingView had built-in support. We checked the docs and confirmed:

- `widgetbar` exists
- it can enable Watchlist on the right side
- it requires:
  - `getQuotes`
  - `subscribeQuotes`
  - `unsubscribeQuotes`

Relevant documentation:

- [TradingTerminalWidgetOptions.widgetbar](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.TradingTerminalWidgetOptions/#widgetbar)
- [WidgetBarParams](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.WidgetBarParams/)
- [Watchlist docs](https://www.tradingview.com/charting-library-docs/latest/trading_terminal/Watch-List/)
- [IWatchListApi](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.IWatchListApi/)

We then implemented backend/datafeed support for quote APIs:

- `/api/quotes`
- `getQuotes`
- `subscribeQuotes`
- `unsubscribeQuotes`

### Why we did not keep the built-in watchlist

Although the docs support it, the vendored package in this repo appears to be the Advanced Charts package, while the right widgetbar/watchlist belongs to Trading Platform / Trading Terminal functionality.

That meant the built-in watchlist path was not reliable in this local setup.

So we stopped relying on `widgetbar` and returned to a custom right-side panel.

### Current watchlist implementation

The current watchlist is custom and lives in the right panel.

It now supports:

- multiple watchlists stored in browser local storage
- switching active watchlist from a dropdown
- creating a new list
- adding a symbol through an in-panel `+` button
- loading quotes from backend endpoints
- clicking a row to load that symbol in the chart
- periodic refresh every 15 seconds

### Current watchlist visual structure

The watchlist now has:

- panel header with inline dropdown
- red marker shape
- in-panel action buttons
- a section row
- columns:
  - `Symbol`
  - `Last`
  - `Chg`
  - `Chg%`

This was reshaped several times to get closer to the screenshot provided by the user.

## UI Layout Iterations

### Original custom layout

We initially built:

- left sidebar controls
- large custom headings above the chart
- duplicated quote/symbol information outside the chart

### User feedback

The user pointed out that:

- TradingView already shows symbol and price information inside the chart
- duplicate headings were unnecessary
- timeframe controls should be selected from the TradingView chart itself
- watchlist should be on the right

### Changes made

We removed:

- custom company name/title block above the chart
- custom `Symbol / Last / Change` summary block
- custom extra timeframe control strip
- fake left-side toolbar with placeholder symbols:
  - `+`
  - `/`
  - `~`
  - `T`
  - `%`
  - `[]`

We kept:

- top toolbar for symbol input, source selector, load button, theme toggle
- center TradingView chart
- right-side custom watchlist panel

## Theme Work

### Issue

At one point the chart appearance and surrounding shell did not match, resulting in:

- dark shell
- chart looking yellow/light

### Fixes

We switched to using TradingView’s theme API:

- `widget.changeTheme(...)`

And aligned the page shell theme with:

- `body[data-theme="light"]`
- `body[data-theme="dark"]`

Current behavior:

- default theme is now `light`
- user can toggle Day/Night mode
- chart theme updates through TradingView API
- page shell updates through CSS variables

## Datafeed API Methods Implemented

The custom datafeed currently implements:

- `onReady`
- `searchSymbols`
- `resolveSymbol`
- `getBars`
- `subscribeBars`
- `unsubscribeBars`
- `getServerTime`
- `getQuotes`
- `subscribeQuotes`
- `unsubscribeQuotes`

This is enough for:

- chart rendering
- resolution switching through TradingView UI
- search
- quote-based watchlist rows

## Local Storage State

Current local storage usage includes:

- `tradingview_ui_theme`
  - stores current day/night mode
- `tradingview_ui_watchlists_v2`
  - stores custom watchlists and active list

## Current Run Command

Run the app with:

```bash
.\.venv\Scripts\python.exe tradingview_ui\server.py --port 9001
```

Then open:

```text
http://127.0.0.1:9001
```

## Current File Summary

### Main app files

- [tradingview_ui/server.py](/D:/projects/stock_data_pipelines/tradingview_ui/server.py)
- [tradingview_ui/index.html](/D:/projects/stock_data_pipelines/tradingview_ui/index.html)
- [tradingview_ui/app.js](/D:/projects/stock_data_pipelines/tradingview_ui/app.js)
- [tradingview_ui/datafeed.js](/D:/projects/stock_data_pipelines/tradingview_ui/datafeed.js)
- [tradingview_ui/app.css](/D:/projects/stock_data_pipelines/tradingview_ui/app.css)

### Related repo files

- [trading_view_advanced_charts](/D:/projects/stock_data_pipelines/trading_view_advanced_charts)
- [requirements.txt](/D:/projects/stock_data_pipelines/requirements.txt)
- [README.md](/D:/projects/stock_data_pipelines/README.md)

## What Is Working Now

- TradingView Advanced Charts loads locally
- custom backend serves symbol search and historical bars
- multiple timeframes work through TradingView’s own resolution controls
- Yahoo-backed historical data works, with intraday limits enforced
- custom right-side watchlist panel exists
- watchlist dropdown exists inside panel
- plus button exists inside panel
- symbol switching from watchlist rows works
- theme toggle works

## What Was Tried But Not Kept

- duplicate header and quote summary above chart
- custom timeframe strip outside chart
- fake left-side tool rail
- built-in TradingView `widgetbar` watchlist integration

## Important Limitation

The built-in TradingView right widgetbar/watchlist likely requires a Trading Platform / Trading Terminal capable build, not just the current Advanced Charts package that exists in this repo.

So the current right-side watchlist is intentionally custom.

## Likely Next Improvements

If we continue, the most useful next steps would be:

1. Make the custom watchlist visually even closer to TradingView
2. Add better symbol-add UX than `prompt(...)`
3. Persist watchlist ordering and manual reordering
4. Add local source adapters for:
   - DuckDB OHLCV
   - NSE bhavcopy
5. Improve watchlist refresh strategy and loading states
6. Add symbol search/autocomplete in the watchlist add flow

## Summary

So far, we successfully built a local TradingView-based charting UI around the vendored Advanced Charts package, backed it with a custom Python/yfinance data source, added multi-timeframe support, added a custom watchlist system, investigated but did not keep the built-in TradingView watchlist path, and iterated the UI several times to move it closer to the user’s TradingView screenshot.
