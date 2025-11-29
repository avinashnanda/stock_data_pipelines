# html_scraper.py
from io import StringIO
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import requests
from bs4 import BeautifulSoup

from .config import HEADERS, REQUEST_TIMEOUT


def get_soup(url: str) -> BeautifulSoup:
    """Fetch a URL and return a BeautifulSoup object."""
    resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "html.parser")


def extract_summary(soup: BeautifulSoup) -> Dict[str, Optional[str]]:
    """
    Extract high-level summary from company page:
    - company_name
    - key ratios under `.company-ratios`
    """
    summary: Dict[str, Optional[str]] = {}

    name_tag = soup.find("h1")
    summary["company_name"] = name_tag.get_text(strip=True) if name_tag else None

    ratios_block = soup.select_one(".company-ratios")
    if ratios_block:
        for li in ratios_block.select("li"):
            key_el = li.find("span", {"class": "name"})
            val_el = li.find("span", {"class": "value"})
            if key_el and val_el:
                key = key_el.get_text(strip=True)
                val = val_el.get_text(strip=True)
                summary[key] = val

    return summary


def _extract_table_df(soup: BeautifulSoup, header_text: str) -> pd.DataFrame:
    """
    Internal helper:
    - Finds table following header_text
    - Parses via pandas
    - Normalizes first column as 'Item'
    """
    heading = soup.find(
        lambda tag: tag.name in ["h2", "h3", "h4"]
        and header_text.lower() in tag.get_text(strip=True).lower()
    )
    if not heading:
        return pd.DataFrame()

    table = heading.find_next("table")
    if table is None:
        return pd.DataFrame()

    try:
        df = pd.read_html(StringIO(str(table)))[0]
    except Exception:
        return pd.DataFrame()

    if df.empty:
        return df

    # Normalize first column name to 'Item'
    first_col = df.columns[0]
    df.rename(columns={first_col: "Item"}, inplace=True)

    # Drop rows that are fully NaN except Item
    if len(df.columns) > 1:
        df.dropna(axis=0, how="all", subset=df.columns[1:], inplace=True)

    df["Item"] = df["Item"].astype(str).str.strip()
    df.reset_index(drop=True, inplace=True)
    return df


def extract_table(soup: BeautifulSoup, header_text: str) -> List[Dict[str, Any]]:
    """
    Extract table as JSON-friendly list-of-dicts (wide format).

    Example output:
    [
        { "Item": "Sales+", "Mar 2022": "10697", "Mar 2023": "12192", ... },
        { "Item": "Expenses+", ... },
        ...
    ]

    If table not found, returns [].
    """
    df = _extract_table_df(soup, header_text)
    if df is None or df.empty:
        return []
    # DataFrame -> wide records, preserves column order
    return df.to_dict(orient="records")


def extract_pros_cons(soup: BeautifulSoup) -> Dict[str, List[str]]:
    """
    Extract pros and cons (strengths and weaknesses) from the analysis section.
    """
    pros: List[str] = []
    cons: List[str] = []

    section = soup.find(id="analysis")
    if section:
        strengths = section.find("div", class_="pros")
        if strengths:
            pros = [li.get_text(strip=True) for li in strengths.find_all("li")]

        weaknesses = section.find("div", class_="cons")
        if weaknesses:
            cons = [li.get_text(strip=True) for li in weaknesses.find_all("li")]

    return {"pros": pros, "cons": cons}


def extract_about(soup: BeautifulSoup) -> str:
    """Extract the company profile text."""
    profile = soup.find("div", class_="company-profile")
    return profile.get_text(" ", strip=True) if profile else ""


def extract_company_and_warehouse(
    soup: BeautifulSoup,
) -> Tuple[Optional[str], Optional[str]]:
    """
    Extract Screener company_id and warehouse_id from the main page.

    Returns:
        (company_id, warehouse_id) as strings, or (None, None) if not found.
    """
    div = soup.find("div", attrs={"data-company-id": True, "data-warehouse-id": True})
    if not div:
        return None, None

    company_id = div.get("data-company-id")
    warehouse_id = div.get("data-warehouse-id")
    return company_id, warehouse_id
