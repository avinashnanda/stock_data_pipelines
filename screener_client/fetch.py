# your_package/scraper_orchestrator.py

from typing import Any, Dict

from .api_async import _fetch_api_data_for_company
from .html_scraper import (
    async_get_soup,  # or get_soup if still sync
    extract_about,
    extract_company_and_warehouse,
    extract_pros_cons,
    extract_summary,
    extract_table,
)


async def fetch_all_data(url: str) -> Dict[str, Any]:
    soup = await async_get_soup(url)  # if using async
    company_id, warehouse_id = extract_company_and_warehouse(soup)
    summary = extract_summary(soup)

    charts: Dict[str, Any] = {}
    schedules: Dict[str, Any] = {}
    peers_api = None

    if company_id is not None:
        api_data = await _fetch_api_data_for_company(company_id, warehouse_id)
        charts = api_data.get("charts", {}) or {}
        schedules = api_data.get("schedules", {}) or {}
        peers_api = api_data.get("peers_api")

    data: Dict[str, Any] = {
        "meta": {
            "company_id": company_id,
            "warehouse_id": warehouse_id,
            "company_name": summary.get("company_name") if summary else None,
            "source_url": url,
        },
        "summary": summary,
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
        "peers_api": peers_api,
        "charts": charts,
        "schedules": schedules,
    }
    return data
