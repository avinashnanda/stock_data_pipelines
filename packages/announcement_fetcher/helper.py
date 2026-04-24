import pandas as pd
import yfinance as yf
from datetime import datetime,timedelta
import os
from tqdm.auto import tqdm

import sys
from pathlib import Path

if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    ROOT_DIR = Path(sys._MEIPASS)
else:
    ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from config.paths import UNIVERSE_CSV, FUNDAMENTAL_DATA_DIR  # noqa: E402

_fundamental_total = 0
_fundamental_processed = 0
_fundamental_running = False

def get_fundamental_status():
    import sys
    if str(ROOT_DIR) not in sys.path:
        sys.path.append(str(ROOT_DIR))
    from packages.shared_db.db_utils import get_fundamentals_metadata
    metadata = get_fundamentals_metadata()
    
    return {
        "running": _fundamental_running,
        "total": _fundamental_total,
        "processed": _fundamental_processed,
        "last_refresh": metadata["last_refresh"],
        "company_count": metadata["company_count"]
    }

def get_all_stocks_symbols():
    # Reading the CSV file from the URL
    df = pd.read_csv(str(UNIVERSE_CSV))
    symbols = df["symbol"].dropna().str.strip().str.upper().tolist()
    return symbols

def get_stock_fundamental_data(symbol):
    stock = yf.Ticker(symbol + ".NS")
    end_date = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=60)).strftime("%Y-%m-%d")
    price_data = stock.history(start=start_date, end=end_date)
    if price_data.empty:
        return None

    latest_price = price_data["Close"].iloc[-1]
    latest_volume = price_data["Volume"].iloc[-1]
    daily_change = (
        (latest_price - price_data["Close"].iloc[-2])
        / price_data["Close"].iloc[-2]
        * 100
    )
    weekly_change = (
        (latest_price - price_data["Close"].iloc[-1 * min(6,len(price_data))])
        / price_data["Close"].iloc[-1* min(6,len(price_data))]
        * 100
    )
    monthly_change = (
        (latest_price - price_data["Close"].iloc[-1 * min(22,len(price_data))])
        / price_data["Close"].iloc[-1 * min(22,len(price_data))]
        * 100
    )

    import time
    time.sleep(0.5)  # To avoid rate limits from Yahoo Finance
    
    try:
        info = stock.info
        if not isinstance(info, dict):
            info = {}
    except Exception as e:
        print(f"Failed to get info for {symbol}: {e}")
        info = {}

    stock_data = {
        "Symbol": symbol,
        "Company Name": info.get("longName", "N/A"),
        "Sector": info.get("sector", "N/A"),
        "Industry": info.get("industry", "N/A"),
        "Market Cap": info.get("marketCap", "N/A"),
        "P/E Ratio": info.get("trailingPE", "N/A"),
        "Forward P/E": info.get("forwardPE", "N/A"),
        "PEG Ratio": info.get("pegRatio", "N/A"),
        "Price to Book": info.get("priceToBook", "N/A"),
        "EV/EBITDA": info.get("enterpriseToEbitda", "N/A"),
        "Profit Margin": info.get("profitMargins", "N/A"),
        "Operating Margin": info.get("operatingMargins", "N/A"),
        "ROE": info.get("returnOnEquity", "N/A"),
        "ROA": info.get("returnOnAssets", "N/A"),
        "Revenue": info.get("totalRevenue", "N/A"),
        "Revenue Per Share": info.get("revenuePerShare", "N/A"),
        "Quarterly Revenue Growth": info.get("quarterlyRevenueGrowth", "N/A"),
        "Gross Profit": info.get("grossProfits", "N/A"),
        "EBITDA": info.get("ebitda", "N/A"),
        "Net Income": info.get("netIncomeToCommon", "N/A"),
        "EPS": info.get("trailingEps", "N/A"),
        "Quarterly Earnings Growth": info.get("quarterlyEarningsGrowth", "N/A"),
        "Total Cash": info.get("totalCash", "N/A"),
        "Total Debt": info.get("totalDebt", "N/A"),
        "Debt to Equity": info.get("debtToEquity", "N/A"),
        "Current Ratio": info.get("currentRatio", "N/A"),
        "Book Value": info.get("bookValue", "N/A"),
        "Free Cash Flow": info.get("freeCashFlow", "N/A"),
        "Dividend Rate": info.get("dividendRate", "N/A"),
        "Dividend Yield": info.get("dividendYield", "N/A"),
        "Payout Ratio": info.get("payoutRatio", "N/A"),
        "Beta": info.get("beta", "N/A"),
        "52 Week High": info.get("fiftyTwoWeekHigh", "N/A"),
        "52 Week Low": info.get("fiftyTwoWeekLow", "N/A"),
        "50 Day Average": info.get("fiftyDayAverage", "N/A"),
        "200 Day Average": info.get("twoHundredDayAverage", "N/A"),
        "Latest Price": info.get("current_price", "N/A"),
        "Daily Change %": f"{daily_change:.2f}%",
        "Weekly Change %": f"{weekly_change:.2f}%",
        "Monthly Change %": f"{monthly_change:.2f}%",
        "Volume": latest_volume,
    }
    return stock_data

def get_all_stock_fundamental_data():
    global _fundamental_total, _fundamental_processed, _fundamental_running
    _fundamental_running = True
    today = datetime.now().strftime("%Y-%m-%d")
    symbols = get_all_stocks_symbols()
    _fundamental_total = len(symbols)
    _fundamental_processed = 0
    stock_data = []
    for symbol in tqdm(symbols):
        try:
            data = get_stock_fundamental_data(symbol)
            if data is not None:
                stock_data.append(data)
        except Exception as e:
            print(f"Error getting data for {symbol} excetion = {e}")
        _fundamental_processed += 1
    df_stock_data = pd.DataFrame(stock_data)
    df_stock_data["Market Cap"] = (pd.to_numeric(df_stock_data["Market Cap"], errors="coerce")/10_000_000)
    
    output_dir = str(FUNDAMENTAL_DATA_DIR)
    os.makedirs(output_dir, exist_ok=True)
    df_stock_data.to_csv(f"{output_dir}/fundamental_data_all_stocks{today}.csv", index=False)
    
    # Store to DuckDB
    import sys
    sys.path.append(str(ROOT_DIR))
    from packages.shared_db.db_utils import store_fundamental_data
    store_fundamental_data(df_stock_data)
    
    _fundamental_running = False
    return df_stock_data
