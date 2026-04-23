from typing import Any

from .api_async import _fetch_api_data_for_company
from .html_scraper import (
    async_get_soup,
    extract_about,
    extract_company_and_warehouse,
    extract_pros_cons,
    extract_summary,
    extract_table,
)


TABLE_SECTIONS = {
    "quarterly_results": "Quarterly Results",
    "profit_and_loss": "Profit & Loss",
    "balance_sheet": "Balance Sheet",
    "cash_flows": "Cash Flows",
    "ratios": "Ratios",
    "shareholding_pattern": "Shareholding Pattern",
}


async def fetch_all_data(url: str) -> dict[str, Any]:
    soup = await async_get_soup(url)
    company_id, warehouse_id = extract_company_and_warehouse(soup)
    summary = extract_summary(soup)
    api_data = (
        await _fetch_api_data_for_company(company_id, warehouse_id)
        if company_id is not None
        else {"charts": {}, "schedules": {}, "peers_api": None}
    )

    return {
        "meta": {
            "company_id": company_id,
            "warehouse_id": warehouse_id,
            "company_name": summary.get("company_name"),
            "source_url": url,
        },
        "summary": summary,
        **{key: extract_table(soup, heading) for key, heading in TABLE_SECTIONS.items()},
        "analysis": {
            **extract_pros_cons(soup),
            "about": extract_about(soup),
        },
        "peers_api": api_data.get("peers_api"),
        "charts": api_data.get("charts", {}) or {},
        "schedules": api_data.get("schedules", {}) or {},
    }
