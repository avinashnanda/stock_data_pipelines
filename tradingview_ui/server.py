from __future__ import annotations

import argparse
import json
import math
import mimetypes
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import pandas as pd
import yfinance as yf


ROOT_DIR = Path(__file__).resolve().parents[1]
APP_DIR = ROOT_DIR / "tradingview_ui"
TRADINGVIEW_DIR = ROOT_DIR / "trading_view_advanced_charts"
UNIVERSE_CSV = ROOT_DIR / "data" / "all_stocks_combined.csv"

SUPPORTED_RESOLUTIONS = ["1", "5", "15", "30", "60", "240", "1D", "1W", "1M"]
DEFAULT_WATCHLIST = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN"]
SOURCE_DEFINITIONS = [
    {
        "id": "yfinance",
        "label": "Yahoo Finance",
        "status": "available",
        "description": "Fetches chart bars from yfinance.",
    },
    {
        "id": "duckdb_market_data",
        "label": "DuckDB Market Data",
        "status": "coming_soon",
        "description": "Reserved for the local DuckDB OHLCV warehouse.",
    },
    {
        "id": "nse_bhavcopy",
        "label": "NSE Bhavcopy",
        "status": "coming_soon",
        "description": "Reserved for the SQLite bhavcopy store.",
    },
]

RESOLUTION_TO_YF_INTERVAL = {
    "1": "1m",
    "5": "5m",
    "15": "15m",
    "30": "30m",
    "60": "60m",
    "240": "1h",
    "1D": "1d",
    "D": "1d",
    "1W": "1wk",
    "W": "1wk",
    "1M": "1mo",
    "M": "1mo",
}

RESOLUTION_LOOKBACK_BUFFER = {
    "1m": timedelta(days=7),
    "5m": timedelta(days=60),
    "15m": timedelta(days=60),
    "30m": timedelta(days=60),
    "60m": timedelta(days=730),
    "1h": timedelta(days=730),
    "1d": timedelta(days=3650),
    "1wk": timedelta(days=3650),
    "1mo": timedelta(days=3650),
}

YF_INTERVAL_LIMITS = {
    "1m": timedelta(days=7),
    "5m": timedelta(days=60),
    "15m": timedelta(days=60),
    "30m": timedelta(days=60),
    "60m": timedelta(days=730),
    "1h": timedelta(days=730),
    "1d": timedelta(days=3650),
    "1wk": timedelta(days=3650),
    "1mo": timedelta(days=3650),
}


@dataclass
class SymbolRecord:
    symbol: str
    company_name: str
    exchange: str = "NSE"

    @property
    def tv_symbol(self) -> str:
        return f"{self.exchange}:{self.symbol}"

    @property
    def yfinance_symbol(self) -> str:
        return f"{self.symbol}.NS"


@lru_cache(maxsize=1)
def load_universe() -> list[SymbolRecord]:
    if not UNIVERSE_CSV.exists():
        return []

    df = pd.read_csv(UNIVERSE_CSV)
    if "symbol" not in df.columns:
        return []

    df = df.rename(columns={"name of company": "company_name"})
    if "company_name" not in df.columns:
        df["company_name"] = df["symbol"]

    df["symbol"] = df["symbol"].astype(str).str.strip().str.upper()
    df["company_name"] = df["company_name"].fillna("").astype(str).str.strip()
    df = df[df["symbol"] != ""]

    return [
        SymbolRecord(symbol=row["symbol"], company_name=row["company_name"] or row["symbol"])
        for _, row in df[["symbol", "company_name"]].drop_duplicates().iterrows()
    ]


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


class YFinanceSourceAdapter(SourceAdapter):
    source_id = "yfinance"

    def __init__(self) -> None:
        self._records = load_universe()
        self._record_by_symbol = {record.symbol: record for record in self._records}

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
        record = self._resolve_record(symbol)
        df = self._download_history(
            record,
            interval="1d",
            from_ts=int((datetime.now(tz=timezone.utc) - timedelta(days=10)).timestamp()),
            to_ts=int(datetime.now(tz=timezone.utc).timestamp()),
        )
        if df.empty:
            return {
                "symbol": record.symbol,
                "full_name": record.tv_symbol,
                "description": record.company_name,
                "source": self.source_id,
            }

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        close_series = df["Close"].dropna()
        volume_series = df["Volume"].dropna() if "Volume" in df.columns else pd.Series(dtype=float)
        if close_series.empty:
            return {
                "symbol": record.symbol,
                "full_name": record.tv_symbol,
                "description": record.company_name,
                "source": self.source_id,
            }

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

    def get_quotes(self, symbols: list[str]) -> list[dict[str, Any]]:
        return [self._to_tv_quote(symbol) for symbol in symbols]

    def _to_tv_quote(self, symbol: str) -> dict[str, Any]:
        quote = self.get_quote(symbol)
        full_name = quote.get("full_name") or f"NSE:{quote.get('symbol', symbol)}"
        price = float(quote.get("price", 0.0) or 0.0)
        change = float(quote.get("change", 0.0) or 0.0)
        change_pct = float(quote.get("change_pct", 0.0) or 0.0)
        prev_close = price - change
        return {
            "s": "ok",
            "n": full_name,
            "v": {
                "short_name": quote.get("symbol", symbol),
                "description": quote.get("description", symbol),
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

        return yf.download(
            tickers=record.yfinance_symbol,
            start=start.strftime("%Y-%m-%d"),
            end=end.strftime("%Y-%m-%d"),
            interval=interval,
            progress=False,
            auto_adjust=False,
            threads=False,
        )

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


class AppRequestHandler(SimpleHTTPRequestHandler):
    server_version = "TradingViewUI/0.1"

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)

        if parsed.path.startswith("/api/"):
            self._handle_api(parsed)
            return

        self._serve_static(parsed.path)

    def _handle_api(self, parsed) -> None:
        params = parse_qs(parsed.query)

        try:
            if parsed.path == "/api/health":
                self._send_json({"ok": True})
                return

            if parsed.path == "/api/sources":
                self._send_json({"sources": SOURCE_DEFINITIONS})
                return

            if parsed.path == "/api/watchlist":
                adapter = self.server.get_adapter(self._get_param(params, "source", "yfinance"))
                symbols = self._get_list_param(params, "symbols")
                if not symbols:
                    symbols = DEFAULT_WATCHLIST
                items = [adapter.get_quote(symbol) for symbol in symbols[:20]]
                self._send_json({"items": items})
                return

            if parsed.path == "/api/quotes":
                adapter = self.server.get_adapter(self._get_param(params, "source", "yfinance"))
                symbols = self._get_list_param(params, "symbols")
                if not symbols:
                    symbols = DEFAULT_WATCHLIST
                self._send_json({"items": adapter.get_quotes(symbols[:50])})
                return

            if parsed.path == "/api/search":
                adapter = self.server.get_adapter(self._get_param(params, "source", "yfinance"))
                results = adapter.search_symbols(self._get_param(params, "query", ""))
                self._send_json({"items": results})
                return

            if parsed.path == "/api/symbol":
                adapter = self.server.get_adapter(self._get_param(params, "source", "yfinance"))
                symbol = self._require_param(params, "symbol")
                self._send_json(adapter.resolve_symbol(symbol))
                return

            if parsed.path == "/api/history":
                adapter = self.server.get_adapter(self._get_param(params, "source", "yfinance"))
                symbol = self._require_param(params, "symbol")
                resolution = self._require_param(params, "resolution")
                from_ts = int(self._require_param(params, "from"))
                to_ts = int(self._require_param(params, "to"))
                bars = adapter.get_bars(symbol, resolution, from_ts, to_ts)
                self._send_json({"bars": bars})
                return

            if parsed.path == "/api/quote":
                adapter = self.server.get_adapter(self._get_param(params, "source", "yfinance"))
                symbol = self._require_param(params, "symbol")
                self._send_json(adapter.get_quote(symbol))
                return

            self.send_error(HTTPStatus.NOT_FOUND, "Unknown API route")
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)

    def _serve_static(self, raw_path: str) -> None:
        if raw_path in {"", "/"}:
            file_path = APP_DIR / "index.html"
        elif raw_path.startswith("/charting_library/"):
            file_path = TRADINGVIEW_DIR / raw_path.lstrip("/")
        elif raw_path.startswith("/datafeeds/"):
            file_path = TRADINGVIEW_DIR / raw_path.lstrip("/")
        else:
            file_path = APP_DIR / raw_path.lstrip("/")

        if not file_path.exists() or file_path.is_dir():
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return

        content_type, _ = mimetypes.guess_type(str(file_path))
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(file_path.stat().st_size))
        self.end_headers()
        self.wfile.write(file_path.read_bytes())

    def _send_json(self, payload: dict[str, Any], status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    @staticmethod
    def _get_param(params: dict[str, list[str]], key: str, default: str) -> str:
        return params.get(key, [default])[0]

    @staticmethod
    def _get_list_param(params: dict[str, list[str]], key: str) -> list[str]:
        raw = params.get(key, [])
        items: list[str] = []
        for value in raw:
            items.extend(part.strip().upper() for part in value.split(",") if part.strip())
        return items

    def _require_param(self, params: dict[str, list[str]], key: str) -> str:
        value = params.get(key, [""])[0].strip()
        if not value:
            raise ValueError(f"Missing required query parameter: {key}")
        return value

    def log_message(self, format: str, *args) -> None:
        print(f"[tradingview-ui] {self.address_string()} - {format % args}")


class AppServer(ThreadingHTTPServer):
    def __init__(self, server_address: tuple[str, int]):
        super().__init__(server_address, AppRequestHandler)
        self._adapters: dict[str, SourceAdapter] = {
            "yfinance": YFinanceSourceAdapter(),
        }

    def get_adapter(self, source_id: str) -> SourceAdapter:
        adapter = self._adapters.get(source_id)
        if adapter is None:
            raise ValueError(f"Unsupported source: {source_id}")
        return adapter


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the TradingView demo app")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=9001, type=int)
    args = parser.parse_args()

    server = AppServer((args.host, args.port))
    print(f"Serving TradingView UI at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
