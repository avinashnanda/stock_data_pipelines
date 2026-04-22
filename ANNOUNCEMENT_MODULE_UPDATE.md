# Announcement Fetcher Module Update

## 🎯 Objective
The goal was to upgrade the existing `announcement_fetcher` module by:
1. Removing the dependency on the Tkinter GUI.
2. Integrating the fetching logic seamlessly into the web-based `tradingview_ui` app.
3. Migrating from Ollama to a local **LMStudio** instance for LLM inference.
4. Implementing a persistent database storage (DuckDB) for news and their summaries.
5. Building dynamic, sentiment-aware News feeds directly into the frontend (with specific styling like red bounded boxes for negative news).

---

## 🛠️ What Was Implemented

### 1. Backend Service (`announcement_fetcher/fetcher.py`)
- Created a background daemon thread that continually scrapes NSE announcements using Selenium.
- Replaced the Ollama usage with `langchain_openai.ChatOpenAI` configured to call a local LMStudio server (`http://localhost:1234/v1`).
- Re-created the missing `prompts.py` file to handle chunk summarization, final summarization, and sentiment extraction.
- Fixed existing local module import paths to ensure they work smoothly when the project is run from the root directory.

### 2. Database Integration (`db/db_utils.py` & `announcements.duckdb`)
- Created a separate DuckDB database (`db/announcements.duckdb`) specifically for storing announcements to avoid concurrency locks with the main screener database.
- Implemented robust `store_announcement` (with `ON CONFLICT DO UPDATE` logic) and `get_announcements` query methods.

### 3. Server Integration (`tradingview_ui/server.py`)
- Exposed REST APIs to control the fetcher and query news:
  - `POST /api/announcements/toggle`: Starts or stops the background fetcher thread.
  - `GET /api/announcements/status`: Returns whether the fetcher is currently active.
  - `GET /api/announcements?symbol=...&limit=...`: Retrieves news from DuckDB, optionally filtered by a specific stock.

### 4. Frontend & UI Features (`tradingview_ui/`)
- **New News Tab**: Added a dedicated "News" tab next to "Price" and "Screener" in the main interface. It contains a global stream of all fetched announcements.
- **Contextual Active Stock News**: Added a secondary feed directly below the Watchlist. When you click a stock (e.g., RELIANCE), this feed instantly filters down to show only that company's recent announcements.
- **Sentiment Visuals**: Added parsing logic to the JavaScript and dynamic CSS classes to the styling. 
  - 🟢 Positive/Bullish sentiment shows up in a light-green box with a green border.
  - 🔴 Negative/Bearish sentiment shows up in a light-red box with a red border.
  - ⚪ Neutral sentiment displays cleanly in standard interface grey.

### 5. Dependency Management (`requirements.txt`)
- Added all the previously unlisted modules required by the announcement fetcher (`langchain`, `langchain_openai`, `langchain_text_splitters`, `selenium`, `webdriver-manager`, `pdfminer.six`, `transformers`, `slack_sdk`).

---

## ✨ Phase 2 Upgrades: Advanced Filtering, Tracking & UI Polish

### 1. Intelligent Titles & Structural LLM
- Upgraded the `langchain` prompts to return a structured JSON response consisting of a short, informative `title` and a detailed markdown `summary`.
- Updated DuckDB schemas (`title` column) and insertion logic to seamlessly store the generated titles.

### 2. Live Fetcher Progress & Dashboard UI
- The fetcher background thread now tracks active progress metrics (Total PDFs, Processed Count, Current Company, Error Logs).
- Built a live progress bar into the "Announcements" tab (formerly "News") header that polls and displays this extraction context.
- Implemented logic to strictly avoid re-processing previously summarized PDFs, saving LLM cost and time.

### 3. Masonry Grid Layout & Markdown
- **Renamed** the "News" tab to "Announcements".
- Upgraded the flat feed to a responsive, multi-column CSS Grid (Masonry-style) layout, drastically improving use of screen real-estate.
- Implemented `marked.js` to render the LLM's Markdown summaries (with bullet points and bolding). Cards feature a clean "click-to-expand" behavior.

### 4. Advanced Filtering & Sound Alerts
- **Filter Controls**: Added intuitive controls to filter announcements by Date Range, Company Symbol, and Sentiment (Positive, Negative, Neutral).
- **Audio Synthesizer**: Built a JS-based audio engine to play distinct notification beeps (high-pitch for Positive, low-pitch for Negative) when new announcements arrive.
- **Watchlist-only Mode**: Added a toggle that restricts sound alerts to trigger *only* for companies currently present in your active Watchlist.
- Added business logic that limits the contextual Watchlist announcement feed to strictly the past 30 days and removes "Neutral" announcements.

---

## 🚀 How to Run and Test
1. **Start your LMStudio Server:**
   - Open LMStudio, load your desired local LLM, and start the local inference server (ensure it runs on port `1234`).
2. **Install updated dependencies:**
   ```powershell
   pip install -r requirements.txt
   ```
3. **Start the TradingView Web Server:**
   ```powershell
   python tradingview_ui/server.py
   ```
4. **Use the App:**
   - Go to the UI in your browser (`http://localhost:8000` by default).
   - Click the "News" tab and click the **Start Fetcher** button.
   - The backend will begin pulling PDFs, asking LMStudio to summarize/analyze sentiment, and storing them in the DuckDB database.
   - Click around the watchlist to watch the contextual "Latest Announcements" feed automatically update!
