# updater.py
from datetime import datetime, timedelta

from .db_utils import get_connection, get_max_date, upsert_ohlcv
from .yfinance_fetch import fetch_ohlcv_range
from .config import MAX_LOOKBACK, FAILED_LOG_PATH
from .logger import get_logger

log = get_logger()


def _decide_date_range(max_existing_date, freq: str):
    """
    Decide [start_d, end_d] for fetching.

    - If no existing data: fetch last MAX_LOOKBACK[freq] days (5 years).
    - If existing: fetch from next day after max_existing_date up to today.
    """
    today = datetime.today().date()
    lookback_days = MAX_LOOKBACK[freq]

    if max_existing_date is None:
        start_d = today - timedelta(days=lookback_days)
    else:
        start_d = max_existing_date + timedelta(days=1)

    if start_d > today:
        return None, None

    return start_d, today


def update_one_symbol(symbol: str, listing_date, freq: str):
    """
    Update a single symbol for given freq ('D' daily or 'W' weekly).

    listing_date is currently ignored for range logic (we trust Yahoo's
    available data instead of CSV listing date), but kept in signature
    for compatibility.
    """
    con = get_connection()
    max_existing = get_max_date(con, symbol, freq)
    start_d, end_d = _decide_date_range(max_existing, freq)

    if start_d is None:
        log.info(f"[{freq}] {symbol}: already up to date")
        con.close()
        return

    log.info(f"[{freq}] {symbol}: fetching {start_d} -> {end_d}")

    df = fetch_ohlcv_range(symbol, start_d, end_d, freq=freq)

    if df.empty:
        # If we already had some data, this just means no new bars
        if max_existing is not None:
            log.info(
                f"[{freq}] {symbol}: no new data for {start_d} -> {end_d}, "
                f"keeping existing up to {max_existing}"
            )
            con.close()
            return

        # Initial load and still empty => treat as failed (e.g. invalid/delisted symbol)
        log.error(f"[{freq}] {symbol}: FAILED initial load — logging")
        with open(FAILED_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"{symbol},{freq},{start_d},{end_d},EMPTY_INITIAL\n")
        con.close()
        return

    # Normal success path
    upsert_ohlcv(con, symbol, df, freq)
    con.close()

    log.info(f"[{freq}] {symbol}: stored {len(df)} rows")


def update_all_symbols(freq: str = "D"):
    """
    Update all symbols in 'instruments' table for the given frequency.

    freq: 'D' (daily) or 'W' (weekly)
    """
    con = get_connection()
    instruments = con.execute(
        "SELECT symbol, date_of_listing FROM instruments ORDER BY symbol"
    ).fetchall()
    con.close()

    for symbol, listing_date in instruments:
        try:
            update_one_symbol(symbol, listing_date, freq)
        except Exception as e:
            log.error(f"[{freq}] {symbol}: unexpected error: {e}")
            with open(FAILED_LOG_PATH, "a", encoding="utf-8") as f:
                f.write(f"{symbol},{freq},ERROR,{repr(e)}\n")
