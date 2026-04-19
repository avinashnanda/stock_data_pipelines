from __future__ import annotations

import asyncio
import argparse
import contextlib
import json
import math
import mimetypes
import sys
import threading
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

try:
    import duckdb
except ImportError:  # pragma: no cover - optional at runtime for UI-only mode
    duckdb = None


ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

APP_DIR = ROOT_DIR / "tradingview_ui"
TRADINGVIEW_DIR = ROOT_DIR / "trading_view_advanced_charts"
UNIVERSE_CSV = ROOT_DIR / "data" / "all_stocks_combined.csv"
SCREENER_DB = ROOT_DIR / "db" / "screener_financials.duckdb"
SCREENER_SOURCE_BASE = "https://www.screener.in/company"

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

_screener_refresh_guard = threading.Lock()
_screener_refresh_inflight: set[str] = set()


def normalize_symbol_name(symbol: str) -> str:
    cleaned = symbol.strip().upper()
    if ":" in cleaned:
        cleaned = cleaned.split(":", 1)[1]
    if cleaned.endswith(".NS"):
        cleaned = cleaned[:-3]
    return cleaned


def sanitize_json_value(value: Any) -> Any:
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, dict):
        return {key: sanitize_json_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_json_value(item) for item in value]
    if isinstance(value, tuple):
        return [sanitize_json_value(item) for item in value]
    return value


def load_latest_screener_snapshot(symbol: str) -> dict[str, Any] | None:
    if duckdb is None:
        raise RuntimeError("duckdb is not installed for Screener data access")
    if not SCREENER_DB.exists():
        raise FileNotFoundError(f"Screener database not found: {SCREENER_DB}")

    normalized = normalize_symbol_name(symbol)
    source_like = f"%/COMPANY/{normalized}/%"

    with contextlib.closing(duckdb.connect(str(SCREENER_DB), read_only=True)) as con:
        row = con.execute(
            """
            SELECT company_id, source_url, scraped_at, payload_json
            FROM raw_company_json
            WHERE UPPER(source_url) LIKE ?
            ORDER BY scraped_at DESC
            LIMIT 1
            """,
            [source_like],
        ).fetchone()

    if row is None:
        return None

    company_id, source_url, scraped_at, payload_json = row
    payload = json.loads(payload_json) if isinstance(payload_json, str) else payload_json
    meta = dict(payload.get("meta", {}) or {})
    meta.update(
        {
            "symbol": normalized,
            "source_url": source_url,
            "scraped_at": scraped_at.isoformat() if hasattr(scraped_at, "isoformat") else str(scraped_at),
            "company_id": meta.get("company_id") or company_id,
        }
    )

    return sanitize_json_value(
        {
        "meta": meta,
        "summary": payload.get("summary", {}) or {},
        "analysis": payload.get("analysis", {}) or {},
        "charts": payload.get("charts", {}) or {},
        "schedules": payload.get("schedules", {}) or {},
        "peers_api": payload.get("peers_api") or [],
        "tables": {
            "quarterly_results": payload.get("quarterly_results") or [],
            "profit_and_loss": payload.get("profit_and_loss") or [],
            "balance_sheet": payload.get("balance_sheet") or [],
            "cash_flows": payload.get("cash_flows") or [],
            "ratios": payload.get("ratios") or [],
            "shareholding_pattern": payload.get("shareholding_pattern") or [],
        },
        }
    )


def build_screener_company_url(symbol: str) -> str:
    return f"{SCREENER_SOURCE_BASE}/{normalize_symbol_name(symbol)}/consolidated/"


def _acquire_screener_refresh(symbol: str) -> bool:
    with _screener_refresh_guard:
        if symbol in _screener_refresh_inflight:
            return False
        _screener_refresh_inflight.add(symbol)
        return True


def _release_screener_refresh(symbol: str) -> None:
    with _screener_refresh_guard:
        _screener_refresh_inflight.discard(symbol)


def fetch_and_store_screener_snapshot(symbol: str) -> dict[str, Any]:
    normalized = normalize_symbol_name(symbol)
    if not _acquire_screener_refresh(normalized):
        raise RuntimeError(f"Refresh already in progress for {normalized}")

    try:
        from db.db_utils import store_raw_json, upsert_company
        from screener_client.company_retry import scrape_company_with_retries

        url = build_screener_company_url(normalized)
        payload = asyncio.run(scrape_company_with_retries(url))
        if not payload:
            raise RuntimeError(f"Failed to fetch Screener data for {normalized}")

        meta = payload.get("meta", {}) or {}
        upsert_company(
            meta.get("company_id"),
            meta.get("warehouse_id"),
            meta.get("company_name"),
            url,
        )
        store_raw_json(meta.get("company_id"), url, payload)

        snapshot = load_latest_screener_snapshot(normalized)
        if snapshot is None:
            raise RuntimeError(f"Fetched Screener data for {normalized} but could not reload it from DB")
        return snapshot
    finally:
        _release_screener_refresh(normalized)


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

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._handle_api(parsed, method="POST")
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Unknown route")

    def _handle_api(self, parsed, method: str = "GET") -> None:
        params = parse_qs(parsed.query)

        try:
            if parsed.path == "/api/health":
                self._send_json({"ok": True})
                return

            if parsed.path == "/api/sources":
                self._send_json({"sources": SOURCE_DEFINITIONS})
                return

            if parsed.path == "/api/screener/company":
                if method != "GET":
                    self.send_error(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed")
                    return
                symbol = self._require_param(params, "symbol")
                snapshot = load_latest_screener_snapshot(symbol)
                if snapshot is None:
                    snapshot = fetch_and_store_screener_snapshot(symbol)
                    snapshot["fetch_state"] = "fetched_on_demand"
                else:
                    snapshot["fetch_state"] = "cached"
                self._send_json(snapshot)
                return

            if parsed.path == "/api/screener/refresh":
                if method != "POST":
                    self.send_error(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed")
                    return
                symbol = self._require_param(params, "symbol")
                snapshot = fetch_and_store_screener_snapshot(symbol)
                snapshot["fetch_state"] = "refreshed"
                self._send_json(snapshot)
                return

            if parsed.path == "/api/watchlist":
                adapter = self.server.get_adapter(self._get_param(params, "source", "yfinance"))
                symbols = self._get_list_param(params, "symbols")
                if not symbols:
                    symbols = DEFAULT_WATCHLIST
                items = adapter.get_watchlist_items(symbols[:20])
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
        body = json.dumps(sanitize_json_value(payload), allow_nan=False).encode("utf-8")
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
    allow_reuse_address = True

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

    try:
        server = AppServer((args.host, args.port))
    except PermissionError as exc:
        if getattr(exc, "winerror", None) == 10013:
            raise SystemExit(
                "Could not bind the TradingView UI server to "
                f"http://{args.host}:{args.port}. "
                "Windows is blocking that socket, usually because the port is already in use "
                "or reserved by another process. Try a different port, for example:\n"
                f"python {Path(__file__).resolve()} --port 9010"
            ) from exc
        raise

    print(f"Serving TradingView UI at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
