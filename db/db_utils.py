import pandas as pd
import duckdb
from typing import Optional, Dict


def melt_statement(
    df: pd.DataFrame,
    symbol: str,
    statement: str,
    frequency: str,
    is_consolidated: bool = True,
) -> pd.DataFrame:
    """
    Convert a wide Screener table (Item + year/period columns) into long format
    compatible with fundamentals_long.

    Input df is expected to have column 'Item' + one col per period (e.g. 'Mar 2024', 'Mar 2023', 'TTM').
    """
    if df.empty:
        return df

    df = df.copy()
    if "Item" not in df.columns:
        raise ValueError("Expected an 'Item' column in the DataFrame")

    value_cols = [c for c in df.columns if c != "Item"]

    long_df = df.melt(
        id_vars=["Item"],
        value_vars=value_cols,
        var_name="period_label",
        value_name="value",
    )

    long_df["symbol"] = symbol
    long_df["statement"] = statement
    long_df["frequency"] = frequency
    long_df["is_consolidated"] = is_consolidated

    # Normalize text
    long_df["Item"] = long_df["Item"].astype(str).str.strip()
    long_df["period_label"] = long_df["period_label"].astype(str).str.strip()

    # Clean numeric values
    long_df["value"] = (
        long_df["value"]
        .astype(str)
        .str.replace(",", "", regex=False)
        .str.replace("%", "", regex=False)
        .str.replace("—", "", regex=False)
        .str.strip()
    )
    long_df["value"] = pd.to_numeric(long_df["value"], errors="coerce")

    return long_df[
        [
            "symbol",
            "statement",
            "Item",
            "period_label",
            "frequency",
            "is_consolidated",
            "value",
        ]
    ].rename(columns={"Item": "item"})


def insert_fundamentals(
    con: duckdb.DuckDBPyConnection, fundamentals_df: pd.DataFrame
) -> None:
    """
    Insert a pre-normalized fundamentals DataFrame into fundamentals_long.

    Expects columns:
      ['symbol', 'statement', 'item', 'period_label', 'frequency', 'is_consolidated', 'value']
    """
    if fundamentals_df.empty:
        return

    con.execute(
        """
        INSERT INTO fundamentals_long
        SELECT
            symbol,
            statement,
            item,
            period_label,
            frequency,
            is_consolidated,
            value,
            'screener' AS source,
            current_timestamp AS loaded_at
        FROM fundamentals_df;
        """
    )


def insert_summary(
    con: duckdb.DuckDBPyConnection, symbol: str, summary_dict: Dict[str, str]
) -> None:
    """
    Insert summary key-value pairs from Screener into the summaries table.
    summary_dict is like:
      {
        'company_name': 'Trent Ltd',
        'Current Price': '₹ 4,500',
        'Market Cap': '₹ 1,50,000 Cr.',
        ...
      }
    """
    if not summary_dict:
        return

    rows = []
    for k, v in summary_dict.items():
        if v is None:
            continue
        rows.append({"symbol": symbol, "key": k, "value_text": str(v)})

    if not rows:
        return

    df = pd.DataFrame(rows)
    con.execute(
        """
        INSERT INTO summaries
        SELECT symbol, key, value_text, current_timestamp AS loaded_at
        FROM df;
        """
    )


def insert_company(
    con: duckdb.DuckDBPyConnection,
    symbol: str,
    name: Optional[str] = None,
    screener_url: Optional[str] = None,
    exchange: Optional[str] = None,
    isin: Optional[str] = None,
    sector: Optional[str] = None,
    industry: Optional[str] = None,
) -> None:
    """
    Upsert basic company info into companies table.
    (DuckDB doesn't support native UPSERT yet; we emulate via delete+insert.)
    """
    con.execute(
        """
        DELETE FROM companies WHERE symbol = ?;
        """,
        [symbol],
    )

    con.execute(
        """
        INSERT INTO companies (symbol, name, screener_url, exchange, isin, sector, industry)
        VALUES (?, ?, ?, ?, ?, ?, ?);
        """,
        [symbol, name, screener_url, exchange, isin, sector, industry],
    )