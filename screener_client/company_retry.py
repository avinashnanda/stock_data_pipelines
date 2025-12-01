# screener_client/company_retry.py

from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

import httpx

from .fetch import fetch_all_data

# These are the schedule keys you consider "nice-to-have" (we'll only WARN on them now).
IMPORTANT_SCHEDULE_KEYS = [
    "sales_quarterly",
    "expenses_quarterly",
    "other_income_quarterly",
    "net_profit_quarterly",
    "sales_profit_loss",
    "expenses_profit_loss",
    "other_income_profit_loss",
    "net_profit_profit_loss",
    "material_cost_%_profit_loss",
    "borrowings_balance_sheet",
    "other_liabilities_balance_sheet",
    "fixed_assets_balance_sheet",
    "other_assets_balance_sheet",
    "cash_from_operating_activity_cash_flow",
    "cash_from_investing_activity_cash_flow",
    "cash_from_financing_activity_cash_flow",
]


def _has_missing_important_schedules(schedules: Dict[str, list[dict]]) -> bool:
    """
    Return True if any important schedule key is missing OR has an empty list.
    Used now only for logging / diagnostics, not for re-scraping the whole company.
    """
    for key in IMPORTANT_SCHEDULE_KEYS:
        if key not in schedules or not schedules[key]:
            return True
    return False


def _is_unrecoverable(e: Exception) -> bool:
    """
    Return True if we should NOT retry this error.

    We treat 400 / 403 / 404 as unrecoverable:
      - 404 => symbol/company does not exist on Screener
      - 400/403 => bad request or forbidden (often not fixed by retry)
    """
    if isinstance(e, httpx.HTTPStatusError):
        status = e.response.status_code
        if status in (400, 403, 404):
            return True
    return False


async def scrape_company_with_retries(
    url: str,
    *,
    max_attempts: int = 3,          # smaller, because we only retry on hard failures
    delay_between_attempts: float = 30.0,
) -> Dict[str, Any] | None:
    """
    Fetch full data for a company URL.

    Behaviour:
      - If fetch_all_data raises an unrecoverable HTTP error (400/403/404):
          -> record failure once, do NOT retry.
      - If fetch_all_data raises a recoverable error (e.g., 429/5xx/network):
          -> retry up to max_attempts with delay_between_attempts.
      - If fetch_all_data returns data (even with some schedules missing):
          -> accept the data as-is, log a warning if schedules are missing,
             and DO NOT re-scrape the whole company.

    Returns:
        - dict with full data on success (possibly partial schedules)
        - None on final failure
    """
    last_exception: Optional[Exception] = None

    # Import here to avoid circular imports
    try:
        from db.db_utils import mark_failed_company
    except ImportError:
        mark_failed_company = None  # type: ignore
        print(
            "⚠️ Could not import db.db_utils.mark_failed_company; "
            "failures will not be persisted to DB."
        )

    for attempt in range(1, max_attempts + 1):
        print(f"🏢 Scraping {url} (attempt {attempt}/{max_attempts})")

        try:
            data = await fetch_all_data(url)
        except Exception as e:
            last_exception = e
            print(f"❌ fetch_all_data failed for {url}: {e!r}")

            # Unrecoverable HTTP cases: don't bother retrying.
            if _is_unrecoverable(e):
                reason = f"Unrecoverable HTTP error: {e!r}"
                print(f"⛔ Unrecoverable for {url}, not retrying. Reason: {reason}")
                if mark_failed_company is not None:
                    mark_failed_company(None, url, reason)
                    print(f"📦 Recorded failed company in DB for {url} (company_id=None)")
                return None

            # Recoverable case (429/5xx/network): retry a few times then give up.
            if attempt < max_attempts:
                print(
                    f"⚠️ Will retry {url} in {delay_between_attempts}s "
                    f"(attempt {attempt + 1}/{max_attempts})"
                )
                await asyncio.sleep(delay_between_attempts)
                continue
            else:
                break  # exit loop and mark failure below

        # If we got here, fetch_all_data returned some data; we accept it even if partial.
        schedules = data.get("schedules", {}) or {}
        if _has_missing_important_schedules(schedules):
            print(
                f"⚠️ {url}: some important schedules are missing/empty. "
                "Accepting partial data to avoid more 429s."
            )
        else:
            print(f"✅ Successfully scraped {url} with all important schedules")

        return data  # ✅ no more company-level retries once we have data

    # If we reach here, all attempts failed with exceptions.
    if mark_failed_company is None:
        # We already logged above that we couldn't import it
        return None

    reason: str
    if last_exception is not None:
        reason = f"Exception in fetch_all_data after all retries: {last_exception!r}"
    else:
        reason = "Unknown failure after all retries"

    mark_failed_company(None, url, reason)
    print(f"📦 Recorded failed company in DB for {url} (company_id=None)")

    return None
