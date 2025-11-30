# scrape_from_csv.py

import asyncio
import pandas as pd
from db.db_utils import upsert_company, store_raw_json
from screener_client.company_retry import scrape_company_with_retries


CONCURRENCY = 3
_sem = asyncio.Semaphore(CONCURRENCY)


async def scrape_one(url: str):
    async with _sem:
        data = await scrape_company_with_retries(url)
        if not data: return

        meta = data["meta"]
        upsert_company(
            meta["company_id"],
            meta["warehouse_id"],
            meta["company_name"],
            url,
        )
        store_raw_json(meta["company_id"], url, data)
        print(f"💾 Stored {url}")


async def scrape_csv(csv_path: str):
    df = pd.read_csv(csv_path)
    urls = df["screener_url"].dropna().tolist()
    await asyncio.gather(*(scrape_one(u) for u in urls))


if __name__ == "__main__":
    import sys
    csv_path = sys.argv[1]
    asyncio.run(scrape_csv(csv_path))
