"""Announcement / news API route handlers."""

from __future__ import annotations

import threading
from http import HTTPStatus

from announcement_fetcher.fetcher import start_fetcher, stop_fetcher, is_fetcher_running, get_fetcher_status
from announcement_fetcher.helper import get_all_stock_fundamental_data, get_fundamental_status
from db.db_utils import get_announcements


def handle_announcements_toggle(handler, method: str) -> None:
    if method != "POST":
        handler.send_error(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed")
        return
    if is_fetcher_running():
        stop_fetcher()
    else:
        start_fetcher()
    handler._send_json(get_fetcher_status())


def handle_announcements_status(handler) -> None:
    handler._send_json(get_fetcher_status())


def handle_announcements_refresh_fundamentals_status(handler) -> None:
    handler._send_json(get_fundamental_status())


def handle_announcements_refresh_fundamentals(handler, method: str) -> None:
    if method != "POST":
        handler.send_error(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed")
        return
    threading.Thread(target=get_all_stock_fundamental_data, daemon=True).start()
    handler._send_json({"status": "started"})


def handle_announcements(handler, params: dict) -> None:
    symbol = params.get("symbol", [""])[0].strip()
    if symbol.startswith("NSE:"):
        symbol = symbol[4:]
    limit = int(params.get("limit", ["50"])[0])

    start_date = params.get("start_date", [""])[0].strip()
    end_date = params.get("end_date", [""])[0].strip()
    sentiments_param = params.get("sentiments", [""])[0].strip()
    sentiments = [s.strip() for s in sentiments_param.split(",")] if sentiments_param else None

    announcements = get_announcements(
        symbol=symbol if symbol else None,
        limit=limit,
        start_date=start_date if start_date else None,
        end_date=end_date if end_date else None,
        sentiments=sentiments
    )
    handler._send_json({"announcements": announcements})
