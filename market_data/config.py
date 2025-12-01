# config.py
from datetime import timedelta

# Local DuckDB storage
DB_PATH = "db/market_data.duckdb"

# YFinance historical lookback capability (days)
MAX_LOOKBACK = {
    "D": 1825,   # 5 years max for 1d interval
    "W": 1825,   # 5 years max for 1wk interval
}

# Retry + throttling parameters
RETRY_ATTEMPTS = 5
BASE_SLEEP_SECONDS = 2  # exponential backoff base

# Logging / update config
FAILED_LOG_PATH = "logs/failed_symbols.txt"
