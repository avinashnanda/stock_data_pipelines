# maybe scraper_orchestrator.py or similar
from typing import Any, Dict

import pandas as pd

from .api_async import _fetch_api_data_for_company
from .html_scraper import (
    extract_about,
    extract_company_and_warehouse,
    extract_pros_cons,
    extract_summary,
    extract_table,
    get_soup,
)


def _df_to_records(df: Any) -> Any:
    """
    Helper: convert a DataFrame into a list-of-dicts (records) for JSON.
    If it's not a DataFrame, return as-is.
    """
    if isinstance(df, pd.DataFrame):
        if df.empty:
            return []
        return df.to_dict(orient="records")
    return df


def _convert_dict_of_dfs_to_records(d: Dict[str, Any]) -> Dict[str, Any]:
    """
    For a dict where values may be DataFrames,
    convert all DataFrames to list-of-dicts.
    Keeps non-DF values unchanged.
    """
    out: Dict[str, Any] = {}
    for key, val in d.items():
        if isinstance(val, pd.DataFrame):
            out[key] = _df_to_records(val)
        elif isinstance(val, dict):
            out[key] = _convert_dict_of_dfs_to_records(val)
        else:
            out[key] = val
    return out


async def fetch_all_data(url: str) -> Dict[str, Any]:
    """
    High-level orchestrator:
      - Scrape HTML page for summary + main tables (wide JSON)
      - Use API endpoints for charts, schedules, peers

    Returns:
      Fully JSON-serializable dict (no pandas objects).
    """
    soup = get_soup(url)
    company_id, warehouse_id = extract_company_and_warehouse(soup)
    summary = extract_summary(soup)

    charts: Dict[str, Any] = {}
    schedules: Dict[str, Any] = {}
    peers_api = None

    if company_id is not None:
        api_data = await _fetch_api_data_for_company(company_id, warehouse_id)

        raw_charts = api_data.get("charts", {}) or {}
        raw_schedules = api_data.get("schedules", {}) or {}
        raw_peers_api = api_data.get("peers_api")

        charts = _convert_dict_of_dfs_to_records(raw_charts)
        schedules = _convert_dict_of_dfs_to_records(raw_schedules)
        peers_api = _df_to_records(raw_peers_api)

    data: Dict[str, Any] = {
        "meta": {
            "company_id": company_id,
            "warehouse_id": warehouse_id,
            "company_name": summary.get("company_name") if summary else None,
            "source_url": url,
        },
        "summary": summary,
        # HTML tables as wide JSON
        "quarterly_results": extract_table(soup, "Quarterly Results"),
        "profit_and_loss": extract_table(soup, "Profit & Loss"),
        "balance_sheet": extract_table(soup, "Balance Sheet"),
        "cash_flows": extract_table(soup, "Cash Flows"),
        "ratios": extract_table(soup, "Ratios"),
        "shareholding_pattern": extract_table(soup, "Shareholding Pattern"),
        "analysis": {
            **extract_pros_cons(soup),
            "about": extract_about(soup),
        },
        # APIs normalized to JSON records
        "peers_api": peers_api,
        "charts": charts,
        "schedules": schedules,
    }
    return data
