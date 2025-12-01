# instrument_loader.py
import pandas as pd
from .db_utils import get_connection

CSV_PATH = "data/all_stocks_combined.csv"


def load_instruments(csv_path: str = CSV_PATH):
    df = pd.read_csv(csv_path)
    # Normalise column names
    df = df.rename(
        columns={
            "symbol": "symbol",
            "name of company": "company_name",
            "date of listing": "date_of_listing",
            "isin number": "isin",
            "market cap": "market_cap",
        }
    )

    # --- Clean date_of_listing ---
    # Handle "Not Available", "", NaN, etc. → NaT → None
    df["date_of_listing"] = (
        pd.to_datetime(
            df["date_of_listing"]
            .replace(["Not Available", "NA", "NaN", "nan", "-"], pd.NA),
            errors="coerce",     # don't raise on bad values
            dayfirst=True,       # NSE-style dates like 01-01-2000 or 01-JAN-2000
        )
        .dt.date
    )

    # --- Clean market_cap (optional but useful) ---
    # Remove commas and non-numeric junk, coerce errors to NaN
    df["market_cap"] = (
        df["market_cap"]
        .astype(str)
        .str.replace(",", "", regex=False)
        .str.extract(r"([\d\.]+)", expand=False)
        .astype(float)
    )

    con = get_connection()

    # Upsert into instruments
    con.execute("""
        INSERT OR REPLACE INTO instruments
        SELECT symbol, company_name, date_of_listing, isin, market_cap
        FROM df
    """)
    con.close()

    print(f"Loaded {len(df)} instruments into DuckDB.")
