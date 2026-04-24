# db/db_utils.py

import json
import sys
from datetime import datetime
import duckdb
from typing import Optional
from pathlib import Path
import pandas as pd

# Ensure project root is on sys.path so paths module can be imported
if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    _ROOT_DIR = Path(sys._MEIPASS)
else:
    _ROOT_DIR = Path(__file__).resolve().parents[2]
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

from config.paths import SCREENER_DB, ANNOUNCEMENTS_DB, FUNDAMENTALS_DB  # noqa: E402

DB_FILE = str(SCREENER_DB)

def get_connection():
    con = duckdb.connect(DB_FILE)
    # Initialize screener tables if they don't exist
    con.execute("""
        CREATE TABLE IF NOT EXISTS companies (
            company_id VARCHAR PRIMARY KEY,
            warehouse_id VARCHAR,
            company_name VARCHAR,
            source_url VARCHAR
        );
        CREATE TABLE IF NOT EXISTS raw_company_json (
            company_id VARCHAR,
            source_url VARCHAR,
            scraped_at TIMESTAMP,
            payload_json JSON
        );
        CREATE TABLE IF NOT EXISTS failed_companies (
            company_id VARCHAR,
            source_url VARCHAR,
            failure_reason VARCHAR,
            last_attempt TIMESTAMP
        );
    """)
    return con


def store_raw_json(company_id, url, payload):
    con = get_connection()

    con.execute(
        """
        INSERT INTO raw_company_json (company_id, source_url, scraped_at, payload_json)
        VALUES (?, ?, ?, ?)
        """,
        [
            company_id,
            url,
            datetime.utcnow(),
            json.dumps(payload, ensure_ascii=False),
        ],
    )
    con.close()


def upsert_company(company_id, warehouse_id, name, url):
    if company_id is None:
        return

    con = get_connection()
    con.execute(
        """
        INSERT INTO companies (company_id, warehouse_id, company_name, source_url)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(company_id) DO UPDATE SET
            warehouse_id = EXCLUDED.warehouse_id,
            company_name = EXCLUDED.company_name,
            source_url = EXCLUDED.source_url
        """,
        [company_id, warehouse_id, name, url],
    )
    con.close()



def mark_failed_company(
    company_id: Optional[str],
    source_url: str,
    failure_reason: str,
) -> None:
    """
    Insert a row into failed_companies.
    company_id can be None if we never reached the point of extracting it.
    """
    con = get_connection()
    con.execute(
        """
        INSERT INTO failed_companies (company_id, source_url, failure_reason, last_attempt)
        VALUES (?, ?, ?, ?)
        """,
        [
            company_id,
            source_url,
            failure_reason,
            datetime.utcnow(),
        ],
    )
    con.close()

ANNOUNCEMENTS_DB_FILE = str(ANNOUNCEMENTS_DB)

def get_announcements_connection():
    con = duckdb.connect(ANNOUNCEMENTS_DB_FILE)
    con.execute('''
    CREATE TABLE IF NOT EXISTS announcements (
        symbol VARCHAR,
        company_name VARCHAR,
        broadcast_date VARCHAR,
        pdf_url VARCHAR PRIMARY KEY,
        summary VARCHAR,
        sentiment VARCHAR,
        fetched_at TIMESTAMP
    )
    ''')
    try:
        con.execute("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS title VARCHAR")
    except duckdb.CatalogException:
        pass
    return con

def store_announcement(symbol: str, company_name: str, broadcast_date: str, pdf_url: str, summary: str, sentiment: str, title: str = ""):
    con = get_announcements_connection()
    con.execute(
        """
        INSERT INTO announcements (symbol, company_name, broadcast_date, pdf_url, summary, sentiment, fetched_at, title)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(pdf_url) DO UPDATE SET
            summary = EXCLUDED.summary,
            sentiment = EXCLUDED.sentiment,
            title = EXCLUDED.title
        """,
        [symbol, company_name, broadcast_date, pdf_url, summary, sentiment, datetime.utcnow(), title]
    )
    con.close()

def get_processed_pdf_urls() -> set:
    con = get_announcements_connection()
    try:
        results = con.execute("SELECT pdf_url FROM announcements").fetchall()
        return {r[0] for r in results}
    except duckdb.CatalogException:
        return set()
    finally:
        con.close()

def get_announcement_stats(symbol: str = None, start_date: str = None, end_date: str = None):
    con = get_announcements_connection()
    try:
        query = "SELECT sentiment, COUNT(*) as count FROM announcements WHERE 1=1"
        params = []
        
        if symbol:
            query += " AND symbol = ?"
            params.append(symbol)
            
        if start_date:
            query += (" AND COALESCE("
                      "  TRY_CAST(broadcast_date AS DATE),"
                      "  TRY_CAST(STRPTIME(broadcast_date, '%d-%b-%Y %H:%M:%S') AS DATE)"
                      " ) >= CAST(? AS DATE)")
            params.append(start_date)
            
        if end_date:
            query += (" AND COALESCE("
                      "  TRY_CAST(broadcast_date AS DATE),"
                      "  TRY_CAST(STRPTIME(broadcast_date, '%d-%b-%Y %H:%M:%S') AS DATE)"
                      " ) <= CAST(? AS DATE)")
            params.append(end_date)
            
        query += " GROUP BY sentiment"
        rows = con.execute(query, params).fetchall()
        
        stats = {"total": 0, "positive": 0, "negative": 0, "neutral": 0}
        for sentiment, count in rows:
            if not sentiment: continue
            s = sentiment.lower()
            if "positive" in s: stats["positive"] += count
            elif "negative" in s: stats["negative"] += count
            else: stats["neutral"] += count
            stats["total"] += count
            
        return stats
    except Exception as e:
        print(f"Error getting stats: {e}")
        return {"total": 0, "positive": 0, "negative": 0, "neutral": 0}
    finally:
        con.close()

def get_announcements(symbol: str = None, limit: int = 50, start_date: str = None, end_date: str = None, sentiments: list = None):
    con = get_announcements_connection()
    try:
        query = "SELECT * FROM announcements WHERE 1=1"
        params = []
        
        if symbol:
            query += " AND symbol = ?"
            params.append(symbol)
            
        if start_date:
            query += (" AND COALESCE("
                      "  TRY_CAST(broadcast_date AS DATE),"
                      "  TRY_CAST(STRPTIME(broadcast_date, '%d-%b-%Y %H:%M:%S') AS DATE)"
                      " ) >= CAST(? AS DATE)")
            params.append(start_date)
            
        if end_date:
            query += (" AND COALESCE("
                      "  TRY_CAST(broadcast_date AS DATE),"
                      "  TRY_CAST(STRPTIME(broadcast_date, '%d-%b-%Y %H:%M:%S') AS DATE)"
                      " ) <= CAST(? AS DATE)")
            params.append(end_date)
            
        if sentiments:
            placeholders = ", ".join(["?"] * len(sentiments))
            query += f" AND UPPER(sentiment) IN ({placeholders})"
            params.extend([s.upper() for s in sentiments])
            
        query += (" ORDER BY COALESCE("
                  "  TRY_CAST(broadcast_date AS TIMESTAMP),"
                  "  TRY_CAST(STRPTIME(broadcast_date, '%d-%b-%Y %H:%M:%S') AS TIMESTAMP),"
                  "  fetched_at"
                  " ) DESC LIMIT ?")
        params.append(limit)
        
        results = con.execute(query, params).df()
        results = results.fillna("")
        # convert dates to string for json serialization
        for col in ['fetched_at']:
            if col in results.columns:
                results[col] = results[col].astype(str)
        return results.to_dict(orient="records")
    except duckdb.CatalogException:
        return []
    finally:
        con.close()

FUNDAMENTALS_DB_FILE = str(FUNDAMENTALS_DB)

def get_fundamentals_connection():
    return duckdb.connect(FUNDAMENTALS_DB_FILE)

def store_fundamental_data(df: pd.DataFrame):
    con = get_fundamentals_connection()
    try:
        df["fetched_at"] = datetime.utcnow().isoformat()
        con.execute("CREATE OR REPLACE TABLE fundamentals AS SELECT * FROM df")
    except Exception as e:
        print(f"Error storing fundamentals DB: {e}")
    finally:
        con.close()

def get_symbols_with_min_market_cap(min_cap: float = 5000) -> set:
    if not FUNDAMENTALS_DB.exists():
        return set()
    try:
        con = duckdb.connect(str(FUNDAMENTALS_DB), read_only=True)
        results = con.execute("SELECT Symbol FROM fundamentals WHERE \"Market Cap\" > ?", [min_cap]).fetchall()
        con.close()
        return {r[0] for r in results}
    except duckdb.CatalogException:
        return set()
    except Exception as e:
        print(f"Error reading fundamentals DB: {e}")
        return set()
    finally:
        con.close()

def get_fundamentals_metadata():
    if not FUNDAMENTALS_DB.exists():
        return {"last_refresh": None, "company_count": 0}
    try:
        con = duckdb.connect(str(FUNDAMENTALS_DB), read_only=True)
        results = con.execute("SELECT MAX(fetched_at), COUNT(Symbol) FROM fundamentals").fetchone()
        con.close()
        if results and results[0]:
            return {"last_refresh": results[0], "company_count": results[1]}
    except Exception as e:
        print(f"Metadata fetch error: {e}")
    return {"last_refresh": None, "company_count": 0}
