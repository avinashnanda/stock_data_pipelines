# TradingView UI - Modular Stock Analysis Platform

A professional-grade, modular stock analysis dashboard featuring real-time charts, automated screener snapshots, sentiment-aware announcements, and an agentic AI hedge fund backtesting engine.

## 🏗️ Architecture Walkthrough

The application is built with a decoupled, modular architecture to ensure maintainability and scalability.

### 1. Frontend (The "View" Layer)
Located in the root and `/js`, `/css`, and `/partials` directories.
- **index.html**: A slim skeleton that dynamically includes view components.
- **Modular JS (`/js`)**:
  - `app.js`: The bootloader and view-switcher.
  - `state.js`: Centralized global state and chart configurations.
  - `watchlist.js`: Watchlist CRUD and real-time refresh logic.
  - `screener.js`: Data loading and rendering for the Screener view.
  - `news.js`: Announcement feed, fetcher controls, and sentiment alerts.
  - `hedgefund.js`: Bridge to the AI Hedge Fund agentic engine.
  - `datafeed.js`: TradingView Charting Library adapter.
- **Modular CSS (`/css`)**: Split into functional partials (base, layout, components) imported via `app.css`.
- **Partials (`/partials`)**: Reusable HTML components stitched by the backend at runtime.

### 2. Backend (The "Controller" Layer)
Located in the `/server` package.
- **Dispatcher (`handler.py`)**: A lightweight HTTP request handler that serves static files (with HTML include processing) and routes API requests.
- **API Routes**:
  - `routes_core.py`: Market data, search, and watchlist persistence.
  - `routes_announcements.py`: News fetcher controls and status.
  - `routes_hedgefund.py`: SSE streaming for agentic analysis and backtesting.
- **Adapters (`adapters.py`)**: Connectors for external data sources (e.g., `yfinance`).

### 3. Desktop Integration (The "Container" Layer)
Located in the `/electron` directory.
- **Electron Sidecar**: Spawns the Python backend as a background process.
- **Lifecycle Management**: Handles startup splash screens, port selection, and graceful termination of the Python process.

---

## 🛠️ Dependencies

### Python Backend
Requires Python 3.10+. Main dependencies in `requirements.txt`:
- `duckdb`: High-performance analytical database.
- `yfinance`: Market data retrieval.
- `langchain` & `langgraph`: Orchestration for AI agents.
- `pandas` & `numpy`: Data processing.
- `beautifulsoup4`: Scraping for news/announcements.

### Frontend
- **TradingView Charting Library**: (External dependency, placed in `/charting_library`).
- **Chart.js**: For secondary visualizations in Screener and Hedge Fund views.
- **Marked.js**: Markdown rendering for LLM-generated summaries.

### Electron
- `electron`: App shell.
- `electron-builder`: For packaging into `.exe` or `.dmg`.
- `electron-log`: Centralized logging for the main process.

---

## 🚀 How to Run

### Development Mode (Recommended)
1. **Setup Python Environment**:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # or .venv\Scripts\activate on Windows
   pip install -r requirements.txt
   ```
2. **Start the Electron App**:
   ```bash
   cd electron
   npm install
   npm start
   ```
   *The Electron app will automatically start the Python backend on a free port.*

### Running Backend Independently
If you only want to work on the web UI:
```bash
python -m server --port 9032
```
Then visit `http://127.0.0.1:9032` in your browser.

---

## 📂 Directory Structure
- `/tradingview_ui`: The main application module.
  - `/js`: JavaScript logic modules.
  - `/css`: Styling partials.
  - `/partials`: HTML view components.
  - `/server`: Python backend package.
  - `/logs`: Application logs.
- `/electron`: Desktop container code.
- `/ai-hedge-fund`: Agentic trading logic.
- `/announcement_fetcher`: Background news processing.
- `/db`: Persistent DuckDB storage.
- `/data`: Cached market data.

## 📝 Logging
Logs are maintained in the centralized `logs/` directory at the project root. The primary UI server log is `logs/server.log`. This includes HTTP access logs, API errors, and background task updates.
