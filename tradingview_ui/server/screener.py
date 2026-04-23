"""Screener snapshot loading, fetching and storage."""

from __future__ import annotations

import asyncio
import contextlib
import json
import threading
from typing import Any

try:
    import duckdb
except ImportError:  # pragma: no cover - optional at runtime for UI-only mode
    duckdb = None

from .constants import SCREENER_DB_PATH, SCREENER_SOURCE_BASE
from .utils import normalize_symbol_name, sanitize_json_value

# ── DuckDB import (uses the same DB path constant) ───────────────────────────
from paths import SCREENER_DB  # noqa: E402

_screener_refresh_guard = threading.Lock()
_screener_refresh_inflight: set[str] = set()


def load_latest_screener_snapshot(symbol: str) -> dict[str, Any] | None:
    if duckdb is None:
        raise RuntimeError("duckdb is not installed for Screener data access")
    if not SCREENER_DB.exists():
        raise FileNotFoundError(f"Screener database not found: {SCREENER_DB}")

    normalized = normalize_symbol_name(symbol)
    source_like = f"%/COMPANY/{normalized}/%"

    with contextlib.closing(duckdb.connect(str(SCREENER_DB_PATH), read_only=True)) as con:
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
