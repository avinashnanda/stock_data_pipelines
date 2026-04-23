# 📊 Screener.in Scraping Client

A professional-grade, asynchronous scraping pipeline designed to extract comprehensive financial data from **Screener.in**. This module is engineered for robustness, efficiency, and safety, utilizing both HTML scraping and internal API access.

---

## 🚀 Key Features

*   **⚡ Async Architecture**: Built with `httpx` and `asyncio` for high-performance, non-blocking operations.
*   **🛡️ Robust Error Handling**: Intelligent retry logic with exponential backoff, specifically tuned for Screener's rate limits.
*   **🔍 Dual-Source Extraction**: Combines `BeautifulSoup` for HTML parsing with direct calls to Screener's internal JSON APIs for maximum data coverage.
*   **📊 Comprehensive Data**: Extracts everything from summary ratios and financial tables to historical charts and peer comparisons.
*   **🗄️ Database Integrated**: Direct hooks for DuckDB storage via `db.db_utils`.

---

## 🏗️ Module Architecture

The system is organized into specialized layers to ensure maintainability and reliability:

### 1. Orchestration Layer
*   **`scrape_from_csv.py`**: The main entry point. Orchestrates bulk scraping from a CSV input, managing concurrency and database persistence.
*   **`company_retry.py`**: Manages the lifecycle of a single company scrape. Implements the "Accept Partial Data" strategy to minimize bans while maximizing yield.

### 2. Data Fetching Layer
*   **`fetch.py`**: The high-level orchestrator for a single symbol. It stitches together HTML scraping and API fetching into a unified JSON object.
*   **`api_async.py`**: A specialized client for Screener's internal APIs (Charts, Schedules, Peers). Includes a global concurrency semaphore.
*   **`html_scraper.py`**: Parses the main company page for summary data, financial tables, and metadata (IDs).

### 3. Processing Layer
*   **`api_parsers.py`**: Transforms raw, nested API responses into clean, flat, analysis-ready records.
*   **`build_urls.py`**: Safe URL construction for various Screener endpoints.
*   **`helper.py`**: Shared utilities for numeric parsing, date normalization, and key cleaning.

---

## 🛠️ Setup & Installation

### 1. Install Dependencies
Ensure you have Python 3.9+ installed. Install the required packages:

```bash
pip install -r requirements.txt
```

### 2. Generate Input Data
The scraper requires a CSV file containing stock symbols. Use the project's data generation notebook to create this:

1.  Run **`Fetch_all_stock_list.ipynb`** in the root directory.
2.  This will produce a `companies.csv` (or similar) with a mandatory `symbol` column.

---

## 📖 Usage Guide

### Bulk Scraping
To start a full scrape of the symbols in your CSV:

```bash
python -m screener_client.scrape_from_csv path/to/your/symbols.csv
```

### How it Works (Step-by-Step)
1.  **URL Discovery**: The script reads symbols from the CSV and builds the primary Screener URLs.
2.  **HTML Extraction**: It first fetches the main company HTML to extract `company_id` and `warehouse_id`.
3.  **API Parallelization**: Using the extracted IDs, it triggers multiple concurrent async requests to Screener's internal APIs for:
    *   **Charts**: 10+ years of Price, PE, PBV, and Margin data.
    *   **Schedules**: Granular quarterly and annual data points not available in main tables.
    *   **Peers**: Real-time peer comparison data.
4.  **Data Merging**: All sources are unified into a single structured JSON object.
5.  **Persistence**: The resulting data is stored in the `screener_financials.duckdb` database.

---

## 📂 Output Structure

Each successful scrape produces a structured JSON object containing:

| Section | Description |
| :--- | :--- |
| **`meta`** | IDs, names, and source URLs. |
| **`summary`** | Current ratios (Market Cap, P/E, ROCE, etc.) from the header. |
| **`tables`** | P&L, Balance Sheet, Cash Flow, and Ratios (standard tables). |
| **`analysis`** | Expert pros/cons and company profile text. |
| **`charts`** | Historical time-series data for multiple metrics. |
| **`schedules`** | Detailed break-up of financial items (e.g., "Other Income" details). |
| **`peers_api`** | Industry peer comparison metrics. |

---

## ⚠️ Important Notes

*   **Rate Limiting**: The client is configured with a strict `CONCURRENCY = 1` and a `2.0s` sleep between companies. **Do not increase these** unless you are using a proxy rotation service, as Screener.in is sensitive to automated traffic.
*   **Partial Data**: Sometimes Screener fails to return a specific schedule or chart. The client is designed to log a warning and keep the rest of the data rather than failing the entire company.
*   **Database**: Ensure the `db/` directory is writable as the client will attempt to upsert data into DuckDB.

---

**Developed for the Stock Data Pipelines ecosystem.**
