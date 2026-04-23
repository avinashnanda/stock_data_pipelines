import duckdb
from pathlib import Path
import sys

# Add project root to sys.path to import paths
ROOT_DIR = Path.cwd()
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from paths import SCREENER_DB

def check_ticker(ticker):
    if not SCREENER_DB.exists():
        print(f"DB not found at {SCREENER_DB}")
        return
    
    con = duckdb.connect(str(SCREENER_DB), read_only=True)
    normalized = ticker.strip().upper()
    source_like = f"%/{normalized}/%"
    
    row = con.execute("""
        SELECT count(*) FROM raw_company_json 
        WHERE UPPER(source_url) LIKE ?
    """, [source_like.upper()]).fetchone()
    
    print(f"Count for {ticker}: {row[0]}")

if __name__ == "__main__":
    check_ticker("GROWW")
