from typing import Any, Dict, Tuple

import asyncio
import httpx
import pandas as pd

from .api_parsers import (
    parse_screener_chart,
    parse_screener_schedule,
    parse_peers_api,
)
from .api_urls import (
    build_chart_url,
    build_schedule_url,
    build_peers_url,
)
from .config import HEADERS, REQUEST_TIMEOUT


def _normalize_key(prefix: str, label: str) -> str:
    """
    Turn 'Sales', 'Net Profit', 'Material Cost %' into keys like:
      'sales_quarterly', 'net_profit_profit_loss', etc.
    """
    return f"{label.lower().replace(' ', '_')}_{prefix}"


async def _fetch_chart_df(
    client: httpx.AsyncClient,
    name: str,
    url: str,
) -> Tuple[str, pd.DataFrame]:
    resp = await client.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    df = parse_screener_chart(resp.json())
    return name, df


async def _fetch_schedule_df(
    client: httpx.AsyncClient,
    name: str,
    url: str,
    *,
    percent_to_fraction: bool,
) -> Tuple[str, pd.DataFrame]:
    resp = await client.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    df = parse_screener_schedule(resp.json(), percent_to_fraction=percent_to_fraction)
    return name, df


async def _fetch_peers_api(
    client: httpx.AsyncClient,
    warehouse_id: str | int,
) -> Tuple[str, Tuple[pd.DataFrame, Any]]:
    """
    Fetch /peers/ for a warehouse_id.
    Returns ('peers_api', (df, median_info)).
    """
    url = build_peers_url(warehouse_id)
    resp = await client.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    df, median_info = parse_peers_api(resp.text)
    return "peers_api", (df, median_info)


async def _fetch_api_data_for_company(
    company_id: str | int,
    warehouse_id: str | int | None,
) -> Dict[str, Any]:
    """
    Fetch all Screener API endpoints concurrently for a company:
      - chart URLs (multiple metrics)
      - schedule URLs (quarters / P&L / BS / CF)
      - peers API (warehouse based)
      - quick ratios API (warehouse based)
    """

    # Chart metrics
    chart_configs = {
        "price_dma_volume": ["Price", "DMA50", "DMA200", "Volume"],
        "pe_eps": ["Price to Earning", "Median PE", "EPS"],
        "margins_sales": ["GPM", "OPM", "NPM", "Quarter Sales"],
        "ev_ebitda": ["EV Multiple", "Median EV Multiple", "EBITDA"],
        "pbv": ["Price to book value", "Median PBV", "Book value"],
        "mcap_sales": ["Market Cap to Sales", "Median Market Cap to Sales", "Sales"],
    }

    chart_urls = {
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

    schedule_cfg = (
        [(_normalize_key("quarterly", p), p, "quarters", True) for p in schedule_quarters]
        + [(_normalize_key("profit_loss", p), p, "profit-loss", True) for p in schedule_pl]
        + [
            (_normalize_key("balance_sheet", p), p, "balance-sheet", False)
            for p in schedule_bs
        ]
        + [
            (_normalize_key("cash_flow", p), p, "cash-flow", False)
            for p in schedule_cf
        ]
    )

    charts: Dict[str, pd.DataFrame] = {}
    schedules: Dict[str, pd.DataFrame] = {}
    peers_api_df: pd.DataFrame | None = None
    quick_ratios: Dict[str, Any] = {}

    # Run async tasks
    async with httpx.AsyncClient() as client:
        tasks = []

        # Chart tasks
        for key, url in chart_urls.items():
            tasks.append(_fetch_chart_df(client, key, url))

        # Schedule tasks
        for key, parent, section, pct_frac in schedule_cfg:
            url = build_schedule_url(
                company_id, parent=parent, section=section, consolidated=True
            )
            tasks.append(
                _fetch_schedule_df(
                    client,
                    key,
                    url,
                    percent_to_fraction=pct_frac,
                )
            )

        # Warehouse-only APIs
        if warehouse_id:
            tasks.append(_fetch_peers_api(client, warehouse_id))

        results = await asyncio.gather(*tasks, return_exceptions=True)

    # Parse results
    for result in results:
        if isinstance(result, Exception):
            # you could log the exception here
            continue

        key, payload = result

        if key in chart_configs.keys():
            charts[key] = payload
            continue

        if (
            key.endswith("_quarterly")
            or key.endswith("_profit_loss")
            or key.endswith("_balance_sheet")
            or key.endswith("_cash_flow")
        ):
            schedules[key] = payload
            continue

        if key == "peers_api":
            peers_api_df, _ = payload
            continue

        if key == "quick_ratios":
            quick_ratios = payload
            continue

    return {
        "charts": charts,
        "schedules": schedules,
        "peers_api": peers_api_df,
        "quick_ratios": quick_ratios,
    }
