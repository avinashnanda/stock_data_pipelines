# Screener.in Scraping Codebase – README

This repository implements a **robust, async scraping pipeline** for extracting company financial data from **Screener.in**. It combines **HTML scraping**, **internal Screener APIs**, **retry logic**, and **CSV‑driven batch execution**.

---

## How to Run

### 0. Generate the Input CSV (Required First Step)

Before running the scraper, you **must generate the input CSV of stock symbols**.

This is done by running the notebook:

* **`Fetch_all_stock_list.ipynb`**

What the notebook does:

* Fetches the complete stock universe (NSE / BSE)
* Normalizes stock symbols
* Creates a master DataFrame of listed companies
* Exports the result to a CSV file (e.g. `companies.csv`)

> The generated CSV is the **input universe** for the scraper. The scraper itself does **not** fetch stock lists.

---

### 1. Install Dependencies

```bash
pip install httpx beautifulsoup4 pandas lxml requests
```

---

### 2. Run Bulk Scraping from CSV

```bash
python scrape_from_csv.py <path_to_csv>
```

**CSV requirements**:

* Must contain a column named `symbol`
* Each symbol is mapped to:

  ```
  https://www.screener.in/company/<SYMBOL>/consolidated/
  ```

The script:

* Scrapes companies **one-by-one (rate‑safe)**
* Retries on failures
* Stores raw JSON using DB hooks (`db.db_utils`)

---

## What Each File Does

---

### `scrape_from_csv.py`

**Entry point for bulk scraping**

What it does:

* Reads a CSV file of stock symbols
* Builds Screener URLs
* Runs async scraping with controlled concurrency
* Stores results via database helpers

Key functions:

* `scrape_csv()` – orchestrates full CSV scraping
* `scrape_one()` – scrapes one company safely

---

### `company_retry.py`

**Company‑level retry controller**

What it does:

* Calls the full scraper for one company
* Retries only on **recoverable errors** (429 / 5xx / network)
* Stops retrying on **400 / 403 / 404**
* Accepts **partial data** to avoid re‑scraping

Key function:

* `scrape_company_with_retries()`

---

### `fetch.py`

**Top‑level data orchestrator**

What it does:

* Fetches the company HTML page
* Extracts IDs (company_id, warehouse_id)
* Calls async API fetchers
* Merges everything into one JSON object

Key function:

* `fetch_all_data(url)`

---

### `html_scraper.py`

**HTML page scraper (BeautifulSoup)**

What it extracts:

* Company summary & ratios
* Quarterly Results table
* Profit & Loss
* Balance Sheet
* Cash Flows
* Ratios
* Shareholding Pattern
* Pros & Cons
* About section

Key functions:

* `async_get_soup()` / `get_soup()`
* `extract_summary()`
* `extract_table()`
* `extract_pros_cons()`
* `extract_about()`
* `extract_company_and_warehouse()`

---

### `api_async.py`

**Async Screener API client**

What it fetches:

* Chart data (price, PE, PBV, margins, etc.)
* Financial schedules (quarterly, P&L, BS, CF)
* Peers comparison API

Key characteristics:

* Global concurrency limit
* Exponential backoff retries
* Always returns JSON (never pandas)

Key function:

* `_fetch_api_data_for_company()`

---

### `api_parsers.py`

**Parsers for Screener API responses**

What it does:

* Converts raw API payloads to clean records
* Handles nested chart formats
* Parses schedule data into time‑series rows
* Parses peers tables (HTML or TSV)

Key functions:

* `parse_screener_chart()`
* `parse_screener_schedule()`
* `parse_peers_api()`

---

### `build_urls.py`

**Screener URL builders**

What it does:

* Builds internal Screener API URLs safely

Key functions:

* `build_chart_url()`
* `build_schedule_url()`
* `build_peers_url()`
* `screener_url_from_symbol()`

---

### `helper.py`

**Shared utilities & normalization helpers**

What it does:

* Numeric parsing (%, commas, blanks)
* Period → date conversion
* Stable key normalization
* DataFrame → JSON conversion

Key functions:

* `parse_numeric_value()`
* `period_to_date()`
* `normalize_key()`
* `maybe_number()`

---

### `config.py`

**Global configuration**

Contains:

* HTTP headers (browser‑like User‑Agent)
* Request timeout values

---

## Output

Each company produces a **single structured JSON object** containing:

* Metadata
* Summary & ratios
* Financial tables
* Analysis (pros/cons/about)
* Charts
* Schedules
* Peers comparison

Designed for:

* Database storage
* Analytics pipelines
* ML / quantitative research

---

## Notes

* Concurrency is intentionally low to avoid Screener bans
* Partial data is preferred over repeated retries
* All API layers are async & JSON‑only

---

**This README documents how to run and understand the system — not Screener’s data itself.**
