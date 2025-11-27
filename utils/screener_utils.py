import requests
from bs4 import BeautifulSoup
import pandas as pd
from io import StringIO
from playwright.sync_api import sync_playwright

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36"
    )
}


def extract_peers_dynamic(url: str) -> pd.DataFrame:
    """Extract peers table using Playwright (synchronous)."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(url, timeout=60000)

        # scroll down to trigger peers load
        page.evaluate("window.scrollBy(0, document.body.scrollHeight)")
        page.wait_for_selector("#peers table", timeout=5000)

        table_element = page.query_selector("#peers table")
        if not table_element:
            browser.close()
            return pd.DataFrame()

        html = table_element.inner_html()
        html = f"<table>{html}</table>"  # wrap properly
        browser.close()

        return pd.read_html(StringIO(html))[0]


def get_soup(url: str) -> BeautifulSoup:
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "html.parser")


def extract_summary(soup: BeautifulSoup) -> dict:
    summary = {}
    name_tag = soup.find("h1")
    summary["company_name"] = name_tag.get_text(strip=True) if name_tag else None

    ratios_block = soup.select_one(".company-ratios")
    if ratios_block:
        for li in ratios_block.select("li"):
            key = li.find("span", {"class": "name"})
            val = li.find("span", {"class": "value"})
            if key and val:
                summary[key.get_text(strip=True)] = val.get_text(strip=True)

    return summary


def extract_table(soup: BeautifulSoup, header_text: str) -> pd.DataFrame:
    heading = soup.find(lambda tag: tag.name in ["h2", "h3", "h4"] and header_text in tag.get_text())
    if not heading:
        return pd.DataFrame()
    table = heading.find_next("table")
    if table:
        try:
            df = pd.read_html(StringIO(str(table)))[0]
            # Rename first col
            if df.columns[0].startswith("Unnamed"):
                df.rename(columns={df.columns[0]: "Item"}, inplace=True)
            # Drop useless rows (where all data except Item is NaN)
            df.dropna(axis=0, how="all", subset=df.columns[1:], inplace=True)
            df.reset_index(drop=True, inplace=True)
            return df
        except Exception:
            return pd.DataFrame()
    return pd.DataFrame()


def extract_pros_cons(soup: BeautifulSoup) -> dict:
    pros, cons = [], []
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
    profile = soup.find("div", class_="company-profile")
    if profile:
        return profile.get_text(" ", strip=True)
    return ""
