"""Data-source adapters for symbol search, OHLCV bars, and quote data."""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd
import yfinance as yf

from apps.web_app.server.constants import (
    RESOLUTION_TO_YF_INTERVAL,
    RESOLUTION_LOOKBACK_BUFFER,
    SUPPORTED_RESOLUTIONS,
    YF_INTERVAL_LIMITS,
)
from apps.web_app.server.utils import SymbolRecord, load_universe


class SourceAdapter:
    source_id = ""

    def search_symbols(self, query: str) -> list[dict[str, Any]]:
        raise NotImplementedError

    def resolve_symbol(self, symbol: str) -> dict[str, Any]:
        raise NotImplementedError

    def get_bars(self, symbol: str, resolution: str, from_ts: int, to_ts: int) -> list[dict[str, Any]]:
        raise NotImplementedError

    def get_quote(self, symbol: str) -> dict[str, Any]:
        raise NotImplementedError

    def get_quotes(self, symbols: list[str]) -> list[dict[str, Any]]:
        raise NotImplementedError

    def get_watchlist_items(self, symbols: list[str]) -> list[dict[str, Any]]:
        return [self.get_quote(symbol) for symbol in symbols]


class YFinanceSourceAdapter(SourceAdapter):
    source_id = "yfinance"

    def __init__(self) -> None:
        self._records = load_universe()
        self._record_by_symbol = {record.symbol: record for record in self._records}
        self._quote_cache: dict[str, tuple[datetime, dict[str, Any]]] = {}

    def search_symbols(self, query: str) -> list[dict[str, Any]]:
        text = query.strip().upper()
        records = self._records

        if text:
            records = [
                record
                for record in self._records
                if text in record.symbol or text in record.company_name.upper()
            ]

        return [
            {
                "symbol": record.symbol,
                "full_name": record.tv_symbol,
                "description": record.company_name,
                "exchange": record.exchange,
                "ticker": record.tv_symbol,
                "type": "stock",
            }
            for record in records[:30]
        ]

    def resolve_symbol(self, symbol: str) -> dict[str, Any]:
        record = self._resolve_record(symbol)
        return {
            "name": record.symbol,
            "ticker": record.tv_symbol,
            "description": record.company_name,
            "type": "stock",
            "session": "0915-1530:12345",
            "timezone": "Asia/Kolkata",
            "exchange": record.exchange,
            "listed_exchange": record.exchange,
            "minmov": 1,
            "pricescale": 100,
            "has_intraday": True,
            "has_daily": True,
            "has_weekly_and_monthly": True,
            "supported_resolutions": SUPPORTED_RESOLUTIONS,
            "intraday_multipliers": ["1", "5", "15", "30", "60", "240"],
            "daily_multipliers": ["1"],
            "weekly_multipliers": ["1"],
            "monthly_multipliers": ["1"],
            "volume_precision": 0,
            "format": "price",
            "data_status": "streaming",
        }

    def get_bars(self, symbol: str, resolution: str, from_ts: int, to_ts: int) -> list[dict[str, Any]]:
        record = self._resolve_record(symbol)
        interval = RESOLUTION_TO_YF_INTERVAL.get(resolution)
        if interval is None:
            raise ValueError(f"Unsupported resolution: {resolution}")

        df = self._download_history(record, interval, from_ts, to_ts)
        if df.empty:
            return []

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        df = df.rename(
            columns={
                "Open": "open",
                "High": "high",
                "Low": "low",
                "Close": "close",
                "Volume": "volume",
            }
        )
        df = df.reset_index()
        timestamp_col = next(
            (name for name in ("Datetime", "Date") if name in df.columns),
            None,
        )
        if timestamp_col is None:
            return []

        timestamps = pd.to_datetime(df[timestamp_col], utc=True)
        if interval in {"1d", "1wk", "1mo"}:
            timestamps = timestamps.dt.normalize()

        bars: list[dict[str, Any]] = []
        for row, ts in zip(df.itertuples(index=False), timestamps):
            bar_time = int(ts.timestamp() * 1000)
            if bar_time < from_ts * 1000 or bar_time >= to_ts * 1000:
                continue

            open_price = getattr(row, "open", None)
            high_price = getattr(row, "high", None)
            low_price = getattr(row, "low", None)
            close_price = getattr(row, "close", None)
            if any(value is None or (isinstance(value, float) and math.isnan(value)) for value in (open_price, high_price, low_price, close_price)):
                continue

            volume = getattr(row, "volume", None)
            bars.append(
                {
                    "time": bar_time,
                    "open": float(open_price),
                    "high": float(high_price),
                    "low": float(low_price),
                    "close": float(close_price),
                    "volume": 0 if volume is None or pd.isna(volume) else float(volume),
                }
            )

        return bars

    def get_quote(self, symbol: str) -> dict[str, Any]:
        return self._get_quote_payloads([symbol])[self._normalize_symbol_key(symbol)]

    def get_quotes(self, symbols: list[str]) -> list[dict[str, Any]]:
        quote_payloads = self._get_quote_payloads(symbols)
        return [self._to_tv_quote(quote_payloads[self._normalize_symbol_key(symbol)]) for symbol in symbols]

    def get_watchlist_items(self, symbols: list[str]) -> list[dict[str, Any]]:
        quote_payloads = self._get_quote_payloads(symbols)
        return [quote_payloads[self._normalize_symbol_key(symbol)] for symbol in symbols]

    def _to_tv_quote(self, quote: dict[str, Any]) -> dict[str, Any]:
        full_name = quote.get("full_name") or f"NSE:{quote.get('symbol', '')}"
        price = float(quote.get("price", 0.0) or 0.0)
        change = float(quote.get("change", 0.0) or 0.0)
        change_pct = float(quote.get("change_pct", 0.0) or 0.0)
        prev_close = price - change
        return {
            "s": "ok",
            "n": full_name,
            "v": {
                "short_name": quote.get("symbol", ""),
                "description": quote.get("description", quote.get("symbol", "")),
                "exchange": "NSE",
                "lp": price,
                "ch": change,
                "chp": change_pct,
                "open_price": prev_close,
                "high_price": price,
                "low_price": price,
                "prev_close_price": prev_close if prev_close else price,
                "volume": int(quote.get("volume", 0) or 0),
            },
        }

    def _get_quote_payloads(self, symbols: list[str]) -> dict[str, dict[str, Any]]:
        now_utc = datetime.now(tz=timezone.utc)
        records_by_key = {
            self._normalize_symbol_key(symbol): self._resolve_record(symbol)
            for symbol in symbols
        }
        quote_payloads: dict[str, dict[str, Any]] = {}
        symbols_to_fetch: list[str] = []

        for key, record in records_by_key.items():
            cached = self._quote_cache.get(key)
            if cached and (now_utc - cached[0]) <= timedelta(seconds=15):
                quote_payloads[key] = cached[1]
            else:
                symbols_to_fetch.append(key)

        if symbols_to_fetch:
            fetched_payloads = self._fetch_quote_batch([records_by_key[key] for key in symbols_to_fetch])
            for key in symbols_to_fetch:
                payload = fetched_payloads.get(key) or self._default_quote_payload(records_by_key[key])
                self._quote_cache[key] = (now_utc, payload)
                quote_payloads[key] = payload

        return quote_payloads

    def _fetch_quote_batch(self, records: list[SymbolRecord]) -> dict[str, dict[str, Any]]:
        if not records:
            return {}

        start = (datetime.now(tz=timezone.utc) - timedelta(days=10)).strftime("%Y-%m-%d")
        end = (datetime.now(tz=timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
        tickers = [record.yfinance_symbol for record in records]
        df = yf.download(
            tickers=tickers,
            start=start,
            end=end,
            interval="1d",
            progress=False,
            auto_adjust=False,
            threads=False,
            group_by="ticker",
        )

        payloads: dict[str, dict[str, Any]] = {}
        if df.empty:
            # Fallback for recently listed stocks: try fetching 'max' for each record
            for record in records:
                try:
                    df_max = yf.download(
                        tickers=[record.yfinance_symbol],
                        period="max",
                        interval="1d",
                        progress=False,
                        auto_adjust=False,
                        threads=False,
                    )
                    if not df_max.empty:
                        payloads[self._normalize_symbol_key(record.tv_symbol)] = self._quote_payload_from_df(record, df_max)
                except Exception:
                    pass
            return payloads

        if len(records) == 1 and not isinstance(df.columns, pd.MultiIndex):
            record = records[0]
            payloads[self._normalize_symbol_key(record.tv_symbol)] = self._quote_payload_from_df(record, df)
            return payloads

        if isinstance(df.columns, pd.MultiIndex):
            for record in records:
                ticker_key = record.yfinance_symbol
                if ticker_key not in df.columns.get_level_values(0):
                    continue
                ticker_df = df[ticker_key]
                payloads[self._normalize_symbol_key(record.tv_symbol)] = self._quote_payload_from_df(record, ticker_df)

        return payloads

    def _quote_payload_from_df(self, record: SymbolRecord, df: pd.DataFrame) -> dict[str, Any]:
        if df.empty:
            return self._default_quote_payload(record)

        close_series = df["Close"].dropna() if "Close" in df.columns else pd.Series(dtype=float)
        volume_series = df["Volume"].dropna() if "Volume" in df.columns else pd.Series(dtype=float)
        if close_series.empty:
            return self._default_quote_payload(record)

        last_close = float(close_series.iloc[-1])
        prev_close = float(close_series.iloc[-2]) if len(close_series) > 1 else last_close
        change = last_close - prev_close
        change_pct = (change / prev_close * 100.0) if prev_close else 0.0
        last_volume = float(volume_series.iloc[-1]) if not volume_series.empty else 0.0

        return {
            "symbol": record.symbol,
            "full_name": record.tv_symbol,
            "description": record.company_name,
            "source": self.source_id,
            "price": round(last_close, 2),
            "change": round(change, 2),
            "change_pct": round(change_pct, 2),
            "volume": int(last_volume),
        }

    def _default_quote_payload(self, record: SymbolRecord) -> dict[str, Any]:
        return {
            "symbol": record.symbol,
            "full_name": record.tv_symbol,
            "description": record.company_name,
            "source": self.source_id,
        }

    def _normalize_symbol_key(self, symbol: str) -> str:
        cleaned = symbol.strip().upper()
        if cleaned.endswith(".NS"):
            cleaned = cleaned[:-3]
        if ":" not in cleaned:
            cleaned = f"NSE:{cleaned}"
        return cleaned

    def _download_history(
        self,
        record: SymbolRecord,
        interval: str,
        from_ts: int,
        to_ts: int,
    ) -> pd.DataFrame:
        start = datetime.fromtimestamp(from_ts, tz=timezone.utc)
        end = datetime.fromtimestamp(to_ts, tz=timezone.utc)
        if end <= start:
            end = start + timedelta(days=1)

        max_span = YF_INTERVAL_LIMITS[interval]
        now_utc = datetime.now(tz=timezone.utc)
        is_intraday = interval in {"1m", "5m", "15m", "30m", "60m", "1h"}

        if is_intraday:
            end = min(end, now_utc)
            start = max(start, end - max_span + timedelta(hours=6))
            start = max(start, now_utc - max_span + timedelta(hours=6))
            end = min(end + timedelta(hours=1), now_utc + timedelta(hours=1))
        else:
            if end - start > max_span:
                start = end - max_span
            buffer = RESOLUTION_LOOKBACK_BUFFER[interval]
            start = max(start - min(buffer, max_span), datetime(2000, 1, 1, tzinfo=timezone.utc))
            end = min(max(end + timedelta(days=1), start + timedelta(days=2)), now_utc + timedelta(days=1))

        df = yf.download(
            tickers=record.yfinance_symbol,
            start=start.strftime("%Y-%m-%d"),
            end=end.strftime("%Y-%m-%d"),
            interval=interval,
            progress=False,
            auto_adjust=False,
            threads=False,
        )

        if df.empty:
            # Fallback for recently listed stocks: try period="max"
            df = yf.download(
                tickers=record.yfinance_symbol,
                period="max",
                interval=interval,
                progress=False,
                auto_adjust=False,
                threads=False,
            )
            # Filter locally to requested range
            if not df.empty:
                df = df[start.strftime("%Y-%m-%d"):end.strftime("%Y-%m-%d")]

        return df

    def _resolve_record(self, symbol: str) -> SymbolRecord:
        cleaned = symbol.strip().upper()
        if ":" in cleaned:
            cleaned = cleaned.split(":", 1)[1]
        if cleaned.endswith(".NS"):
            cleaned = cleaned[:-3]
        return self._record_by_symbol.get(cleaned) or SymbolRecord(
            symbol=cleaned,
            company_name=cleaned,
        )
