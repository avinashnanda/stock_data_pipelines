# api_async.py

from typing import Any
import asyncio
import httpx
from httpx import HTTPStatusError

from .api_parsers import (
    parse_screener_chart,
    parse_screener_schedule,
    parse_peers_api,
)
from .build_urls import (
    build_chart_url,
    build_schedule_url,
    build_peers_url,
)
from .helper import normalize_key
from .config import HEADERS, REQUEST_TIMEOUT


# -----------------------
# Concurrency limit
# -----------------------
CONCURRENCY_LIMIT = 1  # be gentle with Screener
_sem = asyncio.Semaphore(CONCURRENCY_LIMIT)


async def _limited(coro_func, *args, **kwargs):
    """
    Run a coroutine under a global semaphore to limit concurrency.
    """
    async with _sem:
        return await coro_func(*args, **kwargs)


# -----------------------
# Low-level fetchers with retry/backoff
# -----------------------

async def _fetch_chart(
    client: httpx.AsyncClient,
    name: str,
    url: str,
    *,
    max_retries: int = 4,
    base_backoff: float = 2.0,
) -> tuple[str, list[dict[str, Any]]]:
    """
    Fetch a chart series and parse into JSON records.
    Returns (chart_key, list[dict]).
    Retries on 429/5xx with exponential backoff.
    Returns [] on final failure.
    """
    attempt = 0
    while True:
        try:
            resp = await client.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            records = parse_screener_chart(resp.json())
            return name, records
        except HTTPStatusError as e:
            status = e.response.status_code
            if status in (429, 500, 502, 503, 504) and attempt < max_retries:
                attempt += 1
                retry_after = e.response.headers.get("Retry-After")
                if retry_after is not None:
                    try:
                        delay = float(retry_after)
                    except ValueError:
                        delay = base_backoff * (2 ** (attempt - 1))
                else:
                    delay = base_backoff * (2 ** (attempt - 1))
                print(
                    f"⚠️ _fetch_chart {name}: HTTP {status}, "
                    f"retrying in {delay}s (attempt {attempt})"
                )
                await asyncio.sleep(delay)
                continue

            print(f"❌ _fetch_chart failed for {name} {url}: {e!r}")
            return name, []
        except Exception as e:
            print(f"❌ _fetch_chart failed for {name} {url}: {e!r}")
            return name, []


async def _fetch_schedule(
    client: httpx.AsyncClient,
    name: str,
    url: str,
    *,
    percent_to_fraction: bool,
    max_retries: int = 4,
    base_backoff: float = 2.0,
) -> tuple[str, list[dict[str, Any]]]:
    """
    Fetch a schedule series and parse into JSON records.
    Returns (schedule_key, list[dict]).
    Retries on 429/5xx with exponential backoff.
    Returns [] on final failure.
    """
    attempt = 0
    while True:
        try:
            resp = await client.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            records = parse_screener_schedule(
                resp.json(),
                percent_to_fraction=percent_to_fraction,
            )
            return name, records
        except HTTPStatusError as e:
            status = e.response.status_code
            if status in (429, 500, 502, 503, 504) and attempt < max_retries:
                attempt += 1
                retry_after = e.response.headers.get("Retry-After")
                if retry_after is not None:
                    try:
                        delay = float(retry_after)
                    except ValueError:
                        delay = base_backoff * (2 ** (attempt - 1))
                else:
                    delay = base_backoff * (2 ** (attempt - 1))
                print(
                    f"⚠️ _fetch_schedule {name}: HTTP {status}, "
                    f"retrying in {delay}s (attempt {attempt})"
                )
                await asyncio.sleep(delay)
                continue

            print(f"❌ _fetch_schedule failed for {name} {url}: {e!r}")
            return name, []
        except Exception as e:
            print(f"❌ _fetch_schedule failed for {name} {url}: {e!r}")
            return name, []


async def _fetch_peers_api(
    client: httpx.AsyncClient,
    warehouse_id: str | int,
    *,
    max_retries: int = 4,
    base_backoff: float = 2.0,
) -> tuple[str, tuple[list[dict[str, Any]], dict[str, Any] | None]]:
    """
    Fetch /peers/ for a warehouse_id.
    Returns ('peers_api', (rows, median_info)).
    Retries on 429/5xx with exponential backoff.
    Returns ([], None) on final failure.
    """
    url = build_peers_url(warehouse_id)
    attempt = 0
    while True:
        try:
            resp = await client.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            rows, median_info = parse_peers_api(resp.text)
            return "peers_api", (rows, median_info)
        except HTTPStatusError as e:
            status = e.response.status_code
            if status in (429, 500, 502, 503, 504) and attempt < max_retries:
                attempt += 1
                retry_after = e.response.headers.get("Retry-After")
                if retry_after is not None:
                    try:
                        delay = float(retry_after)
                    except ValueError:
                        delay = base_backoff * (2 ** (attempt - 1))
                else:
                    delay = base_backoff * (2 ** (attempt - 1))
                print(
                    f"⚠️ _fetch_peers_api {warehouse_id}: HTTP {status}, "
                    f"retrying in {delay}s (attempt {attempt})"
                )
                await asyncio.sleep(delay)
                continue

            print(f"❌ _fetch_peers_api failed for warehouse {warehouse_id}: {e!r}")
            return "peers_api", ([], None)
        except Exception as e:
            print(f"❌ _fetch_peers_api failed for warehouse {warehouse_id}: {e!r}")
            return "peers_api", ([], None)


# -----------------------
# High-level orchestrator for APIs
# -----------------------

async def _fetch_api_data_for_company(
    company_id: str | int,
    warehouse_id: str | int | None,
) -> dict[str, Any]:
    """
    Fetch all Screener API endpoints concurrently for a company:
      - chart URLs (multiple metrics)
      - schedule URLs (quarters / P&L / BS / CF)
      - peers API (warehouse based)

    RETURNS:
      {
        "charts":       dict[str, list[dict[str, Any]]],
        "schedules":    dict[str, list[dict[str, Any]]],
        "peers_api":    list[dict[str, Any]] | None,
        "quick_ratios": dict[str, Any],
      }

    No pandas.DataFrame is returned anywhere.
    """

    # Chart metrics
    chart_configs: dict[str, list[str]] = {
        "price_dma_volume": ["Price", "DMA50", "DMA200", "Volume"],
        "pe_eps": ["Price to Earning", "Median PE", "EPS"],
        "margins_sales": ["GPM", "OPM", "NPM", "Quarter Sales"],
        "ev_ebitda": ["EV Multiple", "Median EV Multiple", "EBITDA"],
        "pbv": ["Price to book value", "Median PBV", "Book value"],
        "mcap_sales": ["Market Cap to Sales", "Median Market Cap to Sales", "Sales"],
    }

    chart_urls: dict[str, str] = {
        key: build_chart_url(company_id, metrics, days=3652, consolidated=True)
        for key, metrics in chart_configs.items()
    }

    # Schedule configs
    schedule_quarters = ["Sales", "Expenses", "Other Income", "Net Profit"]
    schedule_pl = ["Sales", "Expenses", "Other Income", "Net Profit", "Material Cost %"]
    schedule_bs = ["Borrowings", "Other Liabilities", "Fixed Assets", "Other Assets"]
    schedule_cf = [
        "Cash from Operating Activity",
        "Cash from Investing Activity",
        "Cash from Financing Activity",
    ]

    schedule_cfg: list[tuple[str, str, str, bool]] = (
        [(normalize_key("quarterly", p), p, "quarters", True) for p in schedule_quarters]
        + [(normalize_key("profit_loss", p), p, "profit-loss", True) for p in schedule_pl]
        + [(normalize_key("balance_sheet", p), p, "balance-sheet", False) for p in schedule_bs]
        + [(normalize_key("cash_flow", p), p, "cash-flow", False) for p in schedule_cf]
    )

    # Pre-populate schedules with all expected keys (stable schema)
    schedules: dict[str, list[dict[str, Any]]] = {}
    for p in schedule_quarters:
        schedules[normalize_key("quarterly", p)] = []
    for p in schedule_pl:
        schedules[normalize_key("profit_loss", p)] = []
    for p in schedule_bs:
        schedules[normalize_key("balance_sheet", p)] = []
    for p in schedule_cf:
        schedules[normalize_key("cash_flow", p)] = []

    charts: dict[str, list[dict[str, Any]]] = {}
    peers_api_records: list[dict[str, Any]] | None = None
    quick_ratios: dict[str, Any] = {}

    async with httpx.AsyncClient() as client:
        tasks: list[Any] = []

        # Chart tasks
        for key, url in chart_urls.items():
            tasks.append(_limited(_fetch_chart, client, key, url))

        # Schedule tasks
        for key, parent, section, pct_frac in schedule_cfg:
            url = build_schedule_url(
                company_id,
                parent=parent,
                section=section,
                consolidated=True,
            )
            tasks.append(
                _limited(
                    _fetch_schedule,
                    client,
                    key,
                    url,
                    percent_to_fraction=pct_frac,
                )
            )

        # Warehouse-only APIs
        if warehouse_id is not None:
            tasks.append(_limited(_fetch_peers_api, client, warehouse_id))

        # We now handle errors inside the helpers, so no need for return_exceptions=True
        results = await asyncio.gather(*tasks)

    # Parse results
    for key, payload in results:
        # Charts
        if key in chart_configs:
            charts[key] = payload  # list[dict]
            continue

        # Schedules
        if (
            key.endswith("_quarterly")
            or key.endswith("_profit_loss")
            or key.endswith("_balance_sheet")
            or key.endswith("_cash_flow")
        ):
            # overwrite pre-populated [] with actual payload (could still be [])
            schedules[key] = payload  # list[dict]
            continue

        # Peers API
        if key == "peers_api":
            peers_api_records, _median_info = payload
            continue

        # Quick ratios (if/when you add it)
        if key == "quick_ratios":
            quick_ratios = payload
            continue

    return {
        "charts": charts,
        "schedules": schedules,
        "peers_api": peers_api_records,
        "quick_ratios": quick_ratios,
    }
