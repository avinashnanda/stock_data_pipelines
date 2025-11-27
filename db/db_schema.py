import duckdb
from pathlib import Path

# Path to your local DuckDB file
DB_PATH = Path("D:/projects/stock_data_pipelines/db/fundamentals.duckdb")


def get_connection(db_path: Path = DB_PATH) -> duckdb.DuckDBPyConnection:
    """
    Open a connection to the DuckDB database.
    Creates the file if it doesn't exist.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path))
    return con


def init_schema(con: duckdb.DuckDBPyConnection) -> None:
    """
    Create all tables needed for Option B raw data.
    Re-running this is safe (uses IF NOT EXISTS).
    """

    # 1) Companies master table (symbol-level metadata)
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS companies (
            symbol          TEXT PRIMARY KEY,         -- e.g. 'TRENT'
            name            TEXT,
            screener_url    TEXT,
            exchange        TEXT,                     -- NSE/BSE/etc
            isin            TEXT,
            sector          TEXT,
            industry        TEXT,
            created_at      TIMESTAMP DEFAULT current_timestamp
        );
        """
    )

    # 2) Long-format fundamentals table:
    #    - holds P&L, Balance Sheet, Cash Flow, Quarterly
    #    - Option B focuses on aggregated rows
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS fundamentals_long (
            symbol          TEXT NOT NULL,            -- 'TRENT'
            statement       TEXT NOT NULL,            -- 'pl', 'bs', 'cf', 'qr'
            item            TEXT NOT NULL,            -- e.g. 'Sales', 'Net Profit'
            period_label    TEXT NOT NULL,            -- e.g. 'Mar 2024', 'TTM', 'Jun 2024'
            frequency       TEXT NOT NULL,            -- 'annual', 'quarterly', 'ttm', 'other'
            is_consolidated BOOLEAN NOT NULL DEFAULT TRUE,
            value           DOUBLE,
            source          TEXT DEFAULT 'screener',  -- data source tag
            loaded_at       TIMESTAMP DEFAULT current_timestamp
        );
        """
    )

    # 3) Summary key-value pairs per symbol (from Screener “company-ratios” / header block)
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS summaries (
            symbol          TEXT NOT NULL,
            key             TEXT NOT NULL,            -- e.g. 'Current Price', 'Market Cap'
            value_text      TEXT,                     -- raw string value
            loaded_at       TIMESTAMP DEFAULT current_timestamp
        );
        """
    )

    # 4) (Optional) Raw shareholding pattern table
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS shareholding_pattern (
            symbol          TEXT NOT NULL,
            category        TEXT NOT NULL,            -- e.g. 'Promoters', 'FIIs', 'DIIs'
            period_label    TEXT NOT NULL,            -- e.g. 'Jun 2024'
            percent         DOUBLE,
            loaded_at       TIMESTAMP DEFAULT current_timestamp
        );
        """
    )