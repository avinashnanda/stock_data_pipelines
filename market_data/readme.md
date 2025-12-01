# 📊 NSE Market Data Pipeline (DuckDB + YFinance)

A modular local market data warehouse built with Python, DuckDB & Yahoo Finance.

✔ Stores NSE OHLCV (Daily + Weekly)
✔ Maintains incremental refreshes
✔ Handles failures + retry queue
✔ Logging for debugging and audit
✔ Uses Yahoo Finance data limits properly

---

## 📁 Project Structure

```
project-root/
│
├─ market_data/
│   ├─ logger.py
│   ├─ config.py
│   ├─ db_utils.py
│   ├─ instrument_loader.py
│   ├─ yfinance_fetch.py
│   ├─ updater.py
│   ├─ reprocess_failed_symbols.py
│   └─ main.py
│
├─ data/
│   └─ all_stocks_combined.csv
│
├─ logs/
│   ├─ market_data.log
│   └─ failed_symbols.txt
│
└─ db/
    └─ market_data.duckdb
```

---

## ⚙️ Installation

### Python dependencies

```bash
pip install yfinance duckdb pandas pyarrow
```

---

## 📌 Dataset Requirement

Place the master symbols CSV here:

```
data/all_stocks_combined.csv
```

Required columns:

| Column          |
| --------------- |
| symbol          |
| name of company |
| date of listing |
| isin number     |
| market cap      |

---

## 🚀 Running the Pipeline

### 1️⃣ Initial Load + Incremental Updates

Fetches:

* **Daily** OHLCV (max: **5 years**)
* **Weekly** OHLCV (max: **5 years**)
* Only missing data fetched during future runs

```bash
python -m market_data.main
```

🎯 Run this **daily** or **weekly** to stay updated.

---

### 2️⃣ Retry Failed Symbols

If some symbols fail during fetch:

Check:

```
logs/failed_symbols.txt
```

Then retry fetching only those:

```bash
python -m market_data.reprocess_failed_symbols
```

---

## 🧪 Validating the Data

Example: fetch last 10 RELIANCE records from DuckDB

```python
import duckdb
con = duckdb.connect('db/market_data.duckdb')

df = con.execute("""
SELECT *
FROM ohlcv_daily
WHERE symbol='RELIANCE'
ORDER BY date DESC
LIMIT 10
""").fetchdf()

print(df)
```

---

## 📝 Notes

* Listing date from CSV is **not** used for fetching — Yahoo provides true available range
* Each symbol is stored separately for:

  * `ohlcv_daily`
  * `ohlcv_weekly`
* Yahoo Finance max history:

  * `1d` → **1825 days (~5 years)**
  * `1wk` → **1825 days (~5 years)**

---

## 🧠 Troubleshooting

| Issue                     | Cause                  | Fix                                      |
| ------------------------- | ---------------------- | ---------------------------------------- |
| Empty chunks near today   | Weekend / holiday      | Normal — logged as INFO                  |
| Symbol always fails       | Not on Yahoo Finance   | Stays in failed_symbols.txt              |
| Faster performance needed | Python single-threaded | Enable parallel fetch (optional upgrade) |

---


---

## 🏁 Summary

Run this daily:

```bash
python -m market_data.main
```

Retry failures:

```bash
python -m market_data.reprocess_failed_symbols
```

🔔 And your DuckDB market warehouse stays fresh & analytics-ready!
