from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd

from apps.web_app.server.adapters import YFinanceSourceAdapter


def load_ohlcv_dataframe(
    *,
    symbol: str,
    timeframe: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    adapter = YFinanceSourceAdapter()
    start_dt = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1)

    bars = adapter.get_bars(
        symbol=symbol,
        resolution=timeframe,
        from_ts=int(start_dt.timestamp()),
        to_ts=int(end_dt.timestamp()),
    )
    if not bars:
        raise ValueError(f"No historical data available for {symbol} on {timeframe}.")

    frame = pd.DataFrame(bars)
    frame["time"] = pd.to_datetime(frame["time"], unit="ms", utc=True)
    frame = frame.sort_values("time").reset_index(drop=True)
    return frame[["time", "open", "high", "low", "close", "volume"]].copy()
