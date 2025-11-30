# db/db_utils.py

import json
from datetime import datetime
import duckdb

DB_FILE = "db/screener_financials.duckdb"


def get_connection():
    return duckdb.connect(DB_FILE)


def store_raw_json(company_id, url, payload):
    con = get_connection()

    con.execute(
        """
        INSERT INTO raw_company_json (company_id, source_url, scraped_at, payload_json)
        VALUES (?, ?, ?, ?)
        """,
        [
            company_id,
            url,
            datetime.utcnow(),
            json.dumps(payload, ensure_ascii=False),
        ],
    )
    con.close()


def upsert_company(company_id, warehouse_id, name, url):
    if company_id is None:
        return

    con = get_connection()
    con.execute(
        """
        INSERT INTO companies (company_id, warehouse_id, company_name, source_url)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(company_id) DO UPDATE SET
            warehouse_id = EXCLUDED.warehouse_id,
            company_name = EXCLUDED.company_name,
            source_url = EXCLUDED.source_url
        """,
        [company_id, warehouse_id, name, url],
    )
    con.close()


def mark_failed_company(company_id, url, reason):
    con = get_connection()
    con.execute(
        """
        INSERT INTO failed_companies (company_id, source_url, failure_reason, last_attempt)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        """,
        [company_id, url, reason],
    )
    con.close()
