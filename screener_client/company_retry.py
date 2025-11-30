# screener_client/company_retry.py

from __future__ import annotations

import asyncio
from typing import Any, Dict

import httpx

from .fetch import fetch_all_data

# These are the schedule keys you consider "must-have"
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
    """
    for key in IMPORTANT_SCHEDULE_KEYS:
        if key not in schedules or not schedules[key]:
            return True
    return False


def _is_unrecoverable(e: Exception) -> bool:
    """
    Return True if we should NOT retry this error.
    - 404: invalid symbol/company page
    - 400/403: likely bad request or forbidden (not rate limit)
    """
    if isinstance(e, httpx.HTTPStatusError):
        status = e.response.status_code
        if status in (400, 403, 404):
            return True
    return False


async def scrape_company_with_retries(
    url: str,
    *,
    max_attempts: int = 5,
    delay_between_attempts: float = 30.0,
) -> Dict[str, Any] | None:
    """
    Fetch full data for a company URL, retrying the whole company
    if some important schedules are missing (likely due to 429s).

    Special case:
      - If we hit an unrecoverable HTTP error (e.g. 404),
        we immediately record the failure in the DB and skip retries.

    On final failure (exceptions or still-missing schedules), records
    the failure in the database via db.db_utils.mark_failed_company.

    Returns:
        - dict with full data on success
        - None on final failure
    """
    last_exception: Exception | None = None
    last_data: Dict[str, Any] | None = None

    for attempt in range(1, max_attempts + 1):
        print(f"🏢 Scraping {url} (attempt {attempt}/{max_attempts})")

        try:
            data = await fetch_all_data(url)
        except Exception as e:
            # Hard failure: network, parsing, HTTP error, etc.
            last_exception = e
            print(f"❌ fetch_all_data failed for {url}: {e!r}")

            # If it's an unrecoverable error (e.g. 404), don't retry; mark failed immediately.
            if _is_unrecoverable(e):
                try:
                    from db.db_utils import mark_failed_company  # local import to avoid circulars
                except ImportError:
                    print(
                        "⚠️ Could not import db.db_utils.mark_failed_company; "
                        "unrecoverable failure will not be persisted to DB."
                    )
                    return None

                reason = f"Unrecoverable HTTP error: {e!r}"
                # We don't have meta/data in this path, so company_id is unknown (None)
                mark_failed_company(None, url, reason)
                print(
                    f"📦 Recorded unrecoverable failed company in DB for {url} "
                    f"(company_id=None)"
                )
                return None

            # Otherwise, treat as recoverable (e.g. 429, transient issues)
            if attempt < max_attempts:
                print(
                    f"⚠️ Will retry {url} in {delay_between_attempts}s "
                    f"(attempt {attempt + 1}/{max_attempts})"
                )
                await asyncio.sleep(delay_between_attempts)
                continue
            else:
                break  # exit loop, will mark failure below

        # If we got here, we have some data
        last_data = data
        schedules = data.get("schedules", {}) or {}

        if not _has_missing_important_schedules(schedules):
            print(f"✅ Successfully scraped {url} with all important schedules")
            return data

        # We have data but some important schedules are missing/empty
        if attempt < max_attempts:
            print(
                f"⚠️ {url}: some important schedules missing/empty; "
                f"waiting {delay_between_attempts}s before retrying..."
            )
            await asyncio.sleep(delay_between_attempts)
            continue
        else:
            # No more attempts left
            break

    # If we reach here, all attempts failed one way or another.
    # Record the failure in the DB.
    try:
        from db.db_utils import mark_failed_company  # local import to avoid circulars
    except ImportError:
        print(
            "⚠️ Could not import db.db_utils.mark_failed_company; "
            "failure will not be persisted to DB."
        )
        return None

    company_id: str | None = None
    reason: str

    if last_data is not None:
        meta = last_data.get("meta", {}) or {}
        company_id = meta.get("company_id")
        reason = "Missing important schedules after all retries"
    elif last_exception is not None:
        reason = f"Exception in fetch_all_data after all retries: {last_exception!r}"
    else:
        reason = "Unknown failure after all retries"

    mark_failed_company(company_id, url, reason)
    print(f"📦 Recorded failed company in DB for {url} (company_id={company_id!r})")

    return None
