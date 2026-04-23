# yfinance_fetch.py
from datetime import date, timedelta
from typing import List

import contextlib
import os
import sys
import time
import pandas as pd
import yfinance as yf

from .config import MAX_LOOKBACK, RETRY_ATTEMPTS, BASE_SLEEP_SECONDS
from .logger import get_logger

log = get_logger()


def fetch_ohlcv_range(symbol: str, start_d: date, end_d: date, freq: str = "D") -> pd.DataFrame:
    """
    Fetch OHLCV data for a symbol between start_d and end_d (inclusive),
    using yfinance and respecting Yahoo's max lookback limits.

    freq: "D" (daily -> 1d) or "W" (weekly -> 1wk)
    """
    if freq not in ("D", "W"):
        raise ValueError(f"Unsupported freq={freq}, expected 'D' or 'W'")

    if start_d > end_d:
        return pd.DataFrame(columns=["date", "open", "high", "low", "close", "volume"])

    # Map our freq to yfinance interval
    if freq == "D":
        interval = "1d"
    else:  # freq == "W"
        interval = "1wk"

    lookback_days = MAX_LOOKBACK[freq]
    yf_symbol = f"{symbol}.NS"  # NSE suffix; adjust later if you add BSE, etc.

    ticker = yf.Ticker(yf_symbol)
    all_chunks: List[pd.DataFrame] = []

    current_start = start_d
    while current_start <= end_d:
        current_end = min(
            current_start + timedelta(days=lookback_days - 1),
            end_d,
        )

        df_chunk = None
        for attempt in range(1, RETRY_ATTEMPTS + 1):
            try:
                # yfinance 'end' is exclusive; add +1 day to be safe
                with open(os.devnull, 'w') as devnull:
                    with contextlib.redirect_stderr(devnull):
                        df = ticker.history(
                            start=current_start.strftime("%Y-%m-%d"),
                            end=(current_end + timedelta(days=1)).strftime("%Y-%m-%d"),
                            interval=interval,
                        )
                
                # If we get no data for this specific chunk, it might be before listing.
                # Try fetching 'max' to see if there's ANY data available at all.
                if df.empty:
                    with open(os.devnull, 'w') as devnull:
                        with contextlib.redirect_stderr(devnull):
                            max_df = ticker.history(period="max", interval=interval)
                    if not max_df.empty:
                        # Filter the max_df to our current chunk range
                        df = max_df[(max_df.index.date >= current_start) & (max_df.index.date <= current_end)]
                
                df_chunk = df
                break
            except Exception as e:
                err_msg = str(e).lower()
                # If the error suggests no data exists for this range, try period="max"
                if "no price data found" in err_msg or "delisted" in err_msg or "data doesn't exist" in err_msg:
                    try:
                        with open(os.devnull, 'w') as devnull:
                            with contextlib.redirect_stderr(devnull):
                                max_df = ticker.history(period="max", interval=interval)
                        if not max_df.empty:
                            df_chunk = max_df[(max_df.index.date >= current_start) & (max_df.index.date <= current_end)]
                            break
                    except Exception:
                        pass
                
                log.error(
                    f"{symbol} [{freq}] error fetching chunk {current_start} -> {current_end} "
                    f"(attempt {attempt}/{RETRY_ATTEMPTS}): {e}"
                )
                time.sleep(BASE_SLEEP_SECONDS * attempt)

        if df_chunk is None:
            log.error(f"{symbol} [{freq}] giving up on chunk {current_start} -> {current_end}")
        else:
            if df_chunk.empty:
                log.warning(f"{symbol} [{freq}] empty chunk {current_start}->{current_end}")
            else:
                df_local = df_chunk.copy()
                df_local["date"] = df_local.index.date
                all_chunks.append(df_local)

        current_start = current_end + timedelta(days=1)
        time.sleep(0.2)  # throttle a bit to be nice to Yahoo

    if not all_chunks:
        return pd.DataFrame(columns=["date", "open", "high", "low", "close", "volume"])

    df_all = pd.concat(all_chunks, axis=0)

    df_all = df_all.rename(
        columns={
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Volume": "volume",
        }
    )

    df_all["date"] = pd.to_datetime(df_all["date"]).dt.date

    df_all = (
        df_all[["date", "open", "high", "low", "close", "volume"]]
        .drop_duplicates(subset=["date"])
        .set_index("date")
        .sort_index()
    )

    return df_all
