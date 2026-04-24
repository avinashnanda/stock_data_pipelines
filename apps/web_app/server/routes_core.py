"""Core API route handlers: health, sources, search, symbol, history, quotes, watchlist, screener."""

from __future__ import annotations

from http import HTTPStatus
from typing import Any

from apps.web_app.server.constants import DEFAULT_WATCHLIST, SOURCE_DEFINITIONS
from apps.web_app.server.screener import fetch_and_store_screener_snapshot, load_latest_screener_snapshot
from config.paths import WATCHLISTS_JSON
import json


def handle_health(handler) -> None:
    handler._send_json({"ok": True})


def handle_sources(handler) -> None:
    handler._send_json({"sources": SOURCE_DEFINITIONS})


def handle_search(handler, params: dict) -> None:
    adapter = handler.server.get_adapter(_get_param(params, "source", "yfinance"))
    results = adapter.search_symbols(_get_param(params, "query", ""))
    handler._send_json({"items": results})


def handle_symbol(handler, params: dict) -> None:
    adapter = handler.server.get_adapter(_get_param(params, "source", "yfinance"))
    symbol = _require_param(params, "symbol")
    handler._send_json(adapter.resolve_symbol(symbol))


def handle_history(handler, params: dict) -> None:
    adapter = handler.server.get_adapter(_get_param(params, "source", "yfinance"))
    symbol = _require_param(params, "symbol")
    resolution = _require_param(params, "resolution")
    from_ts = int(_require_param(params, "from"))
    to_ts = int(_require_param(params, "to"))
    bars = adapter.get_bars(symbol, resolution, from_ts, to_ts)
    handler._send_json({"bars": bars})


def handle_quote(handler, params: dict) -> None:
    adapter = handler.server.get_adapter(_get_param(params, "source", "yfinance"))
    symbol = _require_param(params, "symbol")
    handler._send_json(adapter.get_quote(symbol))


def handle_quotes(handler, params: dict) -> None:
    adapter = handler.server.get_adapter(_get_param(params, "source", "yfinance"))
    symbols = _get_list_param(params, "symbols")
    if not symbols:
        symbols = DEFAULT_WATCHLIST
    handler._send_json({"items": adapter.get_quotes(symbols[:50])})


def handle_watchlist(handler, params: dict) -> None:
    adapter = handler.server.get_adapter(_get_param(params, "source", "yfinance"))
    symbols = _get_list_param(params, "symbols")
    if not symbols:
        symbols = DEFAULT_WATCHLIST
    items = adapter.get_watchlist_items(symbols[:20])
    handler._send_json({"items": items})


def handle_watchlists_get(handler) -> None:
    if not WATCHLISTS_JSON.exists():
        handler._send_json({})
        return
    try:
        data = json.loads(WATCHLISTS_JSON.read_text(encoding="utf-8"))
        handler._send_json(data)
    except Exception:
        handler._send_json({})


def handle_watchlists_post(handler) -> None:
    try:
        data = handler._read_json_body()
        WATCHLISTS_JSON.write_text(json.dumps(data, indent=2), encoding="utf-8")
        handler._send_json({"ok": True})
    except Exception as exc:
        handler._send_json({"error": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)


def handle_screener_company(handler, params: dict) -> None:
    symbol = _require_param(params, "symbol")
    snapshot = load_latest_screener_snapshot(symbol)
    if snapshot is None:
        snapshot = fetch_and_store_screener_snapshot(symbol)
        snapshot["fetch_state"] = "fetched_on_demand"
    else:
        snapshot["fetch_state"] = "cached"
    handler._send_json(snapshot)


def handle_screener_refresh(handler, params: dict, method: str) -> None:
    if method != "POST":
        handler.send_error(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed")
        return
    symbol = _require_param(params, "symbol")
    snapshot = fetch_and_store_screener_snapshot(symbol)
    snapshot["fetch_state"] = "refreshed"
    handler._send_json(snapshot)


# ── Shared param helpers ─────────────────────────────────────────────────────

def _get_param(params: dict[str, list[str]], key: str, default: str) -> str:
    return params.get(key, [default])[0]


def _get_list_param(params: dict[str, list[str]], key: str) -> list[str]:
    raw = params.get(key, [])
    items: list[str] = []
    for value in raw:
        items.extend(part.strip().upper() for part in value.split(",") if part.strip())
    return items


def _require_param(params: dict[str, list[str]], key: str) -> str:
    value = params.get(key, [""])[0].strip()
    if not value:
        raise ValueError(f"Missing required query parameter: {key}")
    return value
