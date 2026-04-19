import asyncio
from typing import Any, Awaitable, Callable

import httpx
from httpx import HTTPStatusError

from .api_parsers import parse_peers_api, parse_screener_chart, parse_screener_schedule
from .build_urls import build_chart_url, build_peers_url, build_schedule_url
from .config import HEADERS, REQUEST_TIMEOUT
from .helper import normalize_key


CONCURRENCY_LIMIT = 1
RETRYABLE_STATUSES = {429, 500, 502, 503, 504}
_sem = asyncio.Semaphore(CONCURRENCY_LIMIT)

async def _limited(coro_func: Callable[..., Awaitable[Any]], *args, **kwargs) -> Any:
    async with _sem:
        return await coro_func(*args, **kwargs)


async def _request_with_retries(
    request: Callable[[], Awaitable[httpx.Response]],
    *,
    label: str,
    max_retries: int = 4,
    base_backoff: float = 2.0,
) -> httpx.Response | None:
    for attempt in range(max_retries + 1):
        try:
            response = await request()
            response.raise_for_status()
            return response
        except HTTPStatusError as error:
            status = error.response.status_code
            if status in RETRYABLE_STATUSES and attempt < max_retries:
                retry_after = error.response.headers.get("Retry-After")
                delay = float(retry_after) if retry_after and retry_after.replace(".", "", 1).isdigit() else base_backoff * (2**attempt)
                print(f"Retrying {label} after HTTP {status} in {delay}s (attempt {attempt + 1}/{max_retries})")
                await asyncio.sleep(delay)
                continue
            print(f"Request failed for {label}: {error!r}")
            return None
        except Exception as error:
            print(f"Request failed for {label}: {error!r}")
            return None
    return None


async def _fetch_chart(
    client: httpx.AsyncClient,
    name: str,
    url: str,
) -> tuple[str, list[dict[str, Any]]]:
    response = await _request_with_retries(
        lambda: client.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT),
        label=f"chart:{name}",
    )
    return name, parse_screener_chart(response.json()) if response is not None else []


async def _fetch_schedule(
    client: httpx.AsyncClient,
    name: str,
    url: str,
    *,
    percent_to_fraction: bool,
) -> tuple[str, list[dict[str, Any]]]:
    response = await _request_with_retries(
        lambda: client.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT),
        label=f"schedule:{name}",
    )
    if response is None:
        return name, []
    return name, parse_screener_schedule(
        response.json(),
        percent_to_fraction=percent_to_fraction,
    )


async def _fetch_peers_api(
    client: httpx.AsyncClient,
    warehouse_id: str | int,
) -> tuple[str, tuple[list[dict[str, Any]], dict[str, Any] | None]]:
    response = await _request_with_retries(
        lambda: client.get(build_peers_url(warehouse_id), headers=HEADERS, timeout=REQUEST_TIMEOUT),
        label=f"peers:{warehouse_id}",
    )
    return "peers_api", parse_peers_api(response.text) if response is not None else ([], None)


async def _fetch_api_data_for_company(
    company_id: str | int,
    warehouse_id: str | int | None,
) -> dict[str, Any]:
    chart_configs = {
        "price_dma_volume": ["Price", "DMA50", "DMA200", "Volume"],
        "pe_eps": ["Price to Earning", "Median PE", "EPS"],
        "margins_sales": ["GPM", "OPM", "NPM", "Quarter Sales"],
        "ev_ebitda": ["EV Multiple", "Median EV Multiple", "EBITDA"],
        "pbv": ["Price to book value", "Median PBV", "Book value"],
        "mcap_sales": ["Market Cap to Sales", "Median Market Cap to Sales", "Sales"],
    }
    schedule_specs = (
        [("quarterly", "quarters", True, metric) for metric in ["Sales", "Expenses", "Other Income", "Net Profit"]]
        + [("profit_loss", "profit-loss", True, metric) for metric in ["Sales", "Expenses", "Other Income", "Net Profit", "Material Cost %"]]
        + [("balance_sheet", "balance-sheet", False, metric) for metric in ["Borrowings", "Other Liabilities", "Fixed Assets", "Other Assets"]]
        + [("cash_flow", "cash-flow", False, metric) for metric in ["Cash from Operating Activity", "Cash from Investing Activity", "Cash from Financing Activity"]]
    )

    charts = {key: [] for key in chart_configs}
    schedules = {normalize_key(prefix, metric): [] for prefix, _, _, metric in schedule_specs}
    peers_api_records: list[dict[str, Any]] | None = None

    async with httpx.AsyncClient() as client:
        tasks: list[Awaitable[Any]] = [
            _limited(
                _fetch_chart,
                client,
                key,
                build_chart_url(company_id, metrics, days=3652, consolidated=True),
            )
            for key, metrics in chart_configs.items()
        ]
        tasks.extend(
            _limited(
                _fetch_schedule,
                client,
                normalize_key(prefix, metric),
                build_schedule_url(company_id, parent=metric, section=section, consolidated=True),
                percent_to_fraction=percent_to_fraction,
            )
            for prefix, section, percent_to_fraction, metric in schedule_specs
        )
        if warehouse_id is not None:
            tasks.append(_limited(_fetch_peers_api, client, warehouse_id))

        for key, payload in await asyncio.gather(*tasks):
            if key in charts:
                charts[key] = payload
            elif key == "peers_api":
                peers_api_records, _ = payload
            else:
                schedules[key] = payload

    return {
        "charts": charts,
        "schedules": schedules,
        "peers_api": peers_api_records,
        "quick_ratios": {},
    }
