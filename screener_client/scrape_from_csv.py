# scrape_from_csv.py

import asyncio
import pandas as pd
from db.db_utils import upsert_company, store_raw_json
from screener_client.company_retry import scrape_company_with_retries
from typing import List


CONCURRENCY = 1
_sem = asyncio.Semaphore(CONCURRENCY)


async def scrape_one(symbol: str, url: str) -> None:
    async with _sem:
        print(f"🚀 Scraping {symbol} -> {url}")
        data = await scrape_company_with_retries(url)
        if not data:
            print(f"❌ Skipping {symbol} (no data after retries)")
            return

        meta = data.get("meta", {}) or {}
        upsert_company(
            meta.get("company_id"),
            meta.get("warehouse_id"),
            meta.get("company_name"),
            url,
        )
        store_raw_json(meta.get("company_id"), url, data)
        print(f"💾 Stored data for {symbol} ({url})")

        # be extra nice to Screener
        await asyncio.sleep(2.0)


def _build_urls_from_csv(csv_path: str) -> List[tuple[str, str]]:
    """
    Read the CSV and return a list of (symbol, url) tuples.

    CSV is expected to have at least:
        - 'symbol'
        - 'name of company' (ignored here, but available if you want it later)
        - 'date of listing'
        - 'isin number'
        - 'market cap'
    """
    df = pd.read_csv(csv_path)
    df = df[0:20]

    if "symbol" not in df.columns:
        raise ValueError("CSV must contain a 'symbol' column.")

    # Normalize symbol
    df["symbol"] = df["symbol"].astype(str).str.strip().str.upper()

    base = "https://www.screener.in/company"
    symbol_url_pairs: List[tuple[str, str]] = []

    for _, row in df.iterrows():
        symbol = row["symbol"]
        if not symbol:
            continue
        url = f"{base}/{symbol}/consolidated/"
        symbol_url_pairs.append((symbol, url))

    return symbol_url_pairs


async def scrape_csv(csv_path: str) -> None:
    """
    Orchestrate scraping for all companies listed in a CSV file.

    Uses the 'symbol' column to construct Screener URLs.
    """
    symbol_url_pairs = _build_urls_from_csv(csv_path)
    print(f"Found {len(symbol_url_pairs)} symbols in CSV")

    tasks = [scrape_one(symbol, url) for symbol, url in symbol_url_pairs]
    await asyncio.gather(*tasks)

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        raise SystemExit("Usage: python scrape_from_csv.py <path_to_csv>")

    csv_path = sys.argv[1]
    asyncio.run(scrape_csv(csv_path))