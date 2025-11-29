import duckdb
import os

DB_FILE = "db/screener_financials.duckdb"
SCHEMA_FILE = "db/db_schema.sql"

def run_schema():
    if not os.path.exists(SCHEMA_FILE):
        raise FileNotFoundError(f"Schema file not found: {SCHEMA_FILE}")

    print(f"📂 Initializing DuckDB database: {DB_FILE}")

    with open(SCHEMA_FILE, "r", encoding="utf-8") as f:
        schema_sql = f.read()

    con = duckdb.connect(DB_FILE)
    con.execute(schema_sql)
    con.close()

    print("✅ Database schema created successfully!")


if __name__ == "__main__":
    run_schema()
