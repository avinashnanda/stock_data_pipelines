# db_utils.py
import duckdb
from typing import Optional
from datetime import date
from .config import DB_PATH

def get_connection():
    return duckdb.connect(DB_PATH)

def init_db():
    con = get_connection()

    # Instruments master
    con.execute("""
    CREATE TABLE IF NOT EXISTS instruments (
        symbol          VARCHAR PRIMARY KEY,
        company_name    VARCHAR,
        date_of_listing DATE,
        isin            VARCHAR,
        market_cap      DOUBLE
    )
    """)

    # Daily OHLCV
    con.execute("""
    CREATE TABLE IF NOT EXISTS ohlcv_daily (
        symbol VARCHAR,
        date   DATE,
        open   DOUBLE,
        high   DOUBLE,
        low    DOUBLE,
        close  DOUBLE,
        volume DOUBLE,
        CONSTRAINT ohlcv_daily_pk PRIMARY KEY (symbol, date)
    )
    """)

    # Weekly OHLCV
    con.execute("""
    CREATE TABLE IF NOT EXISTS ohlcv_weekly (
        symbol VARCHAR,
        week_start DATE,  -- bar start date
        open   DOUBLE,
        high   DOUBLE,
        low    DOUBLE,
        close  DOUBLE,
        volume DOUBLE,
        CONSTRAINT ohlcv_weekly_pk PRIMARY KEY (symbol, week_start)
    )
    """)

    con.close()


def get_max_date(con, symbol: str, freq: str) -> Optional[date]:
    """
    Get the last stored date for a symbol for given frequency.
    freq: "D" (daily) or "W" (weekly)
    """
    if freq == "D":
        table = "ohlcv_daily"
        col = "date"
    elif freq == "W":
        table = "ohlcv_weekly"
        col = "week_start"
    else:
        raise ValueError(f"Unsupported freq: {freq}")

    row = con.execute(
        f"SELECT max({col}) FROM {table} WHERE symbol = ?", [symbol]
    ).fetchone()
    return row[0]


def upsert_ohlcv(con, symbol: str, df, freq: str):
    """
    Upsert candles into the appropriate table.
    df is indexed by date (for weekly: week_start).
    """
    if df.empty:
        return

    df = df.reset_index()

    if freq == "D":
        df["symbol"] = symbol
        df = df[["symbol", "date", "open", "high", "low", "close", "volume"]]
        con.execute("""
            INSERT OR REPLACE INTO ohlcv_daily
            SELECT * FROM df
        """)
    elif freq == "W":
        df["symbol"] = symbol
        df = df.rename(columns={"date": "week_start"})
        df = df[["symbol", "week_start", "open", "high", "low", "close", "volume"]]
        con.execute("""
            INSERT OR REPLACE INTO ohlcv_weekly
            SELECT * FROM df
        """)
    else:
        raise ValueError(f"Unsupported freq: {freq}")
