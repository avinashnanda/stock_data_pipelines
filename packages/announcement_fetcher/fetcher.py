import time
import threading
import pandas as pd
from datetime import datetime
from pathlib import Path
import sys

# Add root directory to python path if not present
if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    ROOT_DIR = Path(sys._MEIPASS)
else:
    ROOT_DIR = Path(__file__).resolve().parents[2]

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from config.paths import UNIVERSE_CSV, DATA_DIR  # noqa: E402
from packages.announcement_fetcher.pdf_utils import load_nse_announcement_to_dataframe  # noqa: E402
from packages.announcement_fetcher.summarize import fetch_summarize_announcements_pdf  # noqa: E402
from packages.shared_db.db_utils import store_announcement, get_processed_pdf_urls, get_symbols_with_min_market_cap  # noqa: E402

_fetcher_thread = None
_fetcher_running = False
_total_to_process = 0
_processed_count = 0
_current_company = ""
_errors = []

def process_special_announcements(row, pdf_url):
    subject = str(row.get("Subject", "")).lower()
    details = str(row.get("Details", ""))
    company_name = str(row.get("Company_Name", ""))
    broadcast_date = str(row.get("Broadcast_date", ""))
    symbol = str(row.get("Symbols", ""))

    if "financial result updates" in subject or "record date" in subject:
        store_announcement(symbol, company_name, broadcast_date, pdf_url, details, "neutral")
        return True
    return False

def filter_unwanted_announcements(df_nse):
    df_unwanted_announcements = pd.read_csv(
        str(DATA_DIR / "Unwanted_announcements.csv")
    )
    # Filter out unwanted subjects
    df_nse = df_nse[~df_nse["Subject"].isin(df_unwanted_announcements["subject"])]

    # Filter out specific Analyst/Institutional Investor Meet/Con. Call Updates unless they contain "presentation" or "transcript"
    df_nse = df_nse[
        (df_nse["Subject"] != "Analysts/Institutional Investor Meet/Con. Call Updates")
        | (
            df_nse["Details"].str.contains("presentation", case=False)
            | df_nse["Details"].str.contains("transcript", case=False)
        )
    ]

    # Filter out entries containing "esop" in the details
    df_nse = df_nse[~df_nse["Details"].str.contains("esop", case=False)]

    # Filter out financial results related entries unless the subject is "Financial Result Updates"
    keywords = [
        "financial result",
        "financial results",
        "quarterly result",
        "quarterly results",
        "results",
    ]
    pattern = "|".join(keywords)
    df_nse = df_nse[
        ~(
            df_nse["Details"].str.contains(pattern, case=False, na=False)
            & (df_nse["Subject"] != "Financial Result Updates")
        )
    ]

    return df_nse

def fetcher_loop():
    global _fetcher_running, _total_to_process, _processed_count, _current_company, _errors
    from langchain_openai import ChatOpenAI
    
    # Init LLM to use LMStudio
    llm = ChatOpenAI(base_url="http://localhost:1234/v1", api_key="lm-studio", model="local-model", temperature=0.2)
    
    while _fetcher_running:
        print(f"[fetcher] Starting fetch cycle at {datetime.now()}")
        try:
            # Refresh symbols from DB in case fundamentals have been updated
            symbols = get_symbols_with_min_market_cap(5000)
            if not symbols:
                # Fallback if DB is empty
                universe_path = UNIVERSE_CSV
                if universe_path.exists():
                    df_universe = pd.read_csv(universe_path)
                    symbols = set(df_universe['symbol'].dropna().str.strip().str.upper().tolist())

            df_nse = load_nse_announcement_to_dataframe()
            if not df_nse.empty:
                # Filter by universe/market cap
                if symbols:
                    df_nse = df_nse[df_nse["Symbols"].isin(symbols)].reset_index(drop=True)
                
                # Filter unwanted announcements
                df_nse = filter_unwanted_announcements(df_nse)
                
                processed_set = get_processed_pdf_urls()
                df_new = df_nse[~df_nse["Attachment_link"].isin(processed_set)]
                _total_to_process = len(df_new)
                _processed_count = 0
                _errors = []
                
                for _, row in df_new.iterrows():
                    if not _fetcher_running:
                        break
                        
                    pdf_url = row["Attachment_link"]
                    symbol = row["Symbols"]
                    broadcast_date = row["Broadcast_date"]
                    company_name = row["Company_Name"]
                    
                    _current_company = company_name
                    
                    try:
                        if process_special_announcements(row, pdf_url):
                            _processed_count += 1
                            continue
                            
                        result = fetch_summarize_announcements_pdf(pdf_url, llm, broadcast_date, company_name)
                        if result:
                            store_announcement(
                                symbol=symbol,
                                company_name=company_name,
                                broadcast_date=broadcast_date,
                                pdf_url=pdf_url,
                                summary=result.get("summary", ""),
                                sentiment=result.get("sentiment", "neutral"),
                                title=result.get("title", "")
                            )
                        _processed_count += 1
                    except Exception as item_error:
                        print(f"[fetcher] Error processing {company_name}: {item_error}")
                        _errors.append(f"{company_name}: {item_error}")
                        if len(_errors) > 10:
                            _errors.pop(0)
                
                _current_company = ""
                        
        except Exception as e:
            print(f"[fetcher] Error during fetch cycle: {e}")
            _errors.append(f"Cycle Error: {e}")
            if len(_errors) > 10:
                _errors.pop(0)
            
        print(f"[fetcher] Sleeping for 10 minutes...")
        for _ in range(600):
            if not _fetcher_running:
                break
            time.sleep(1)

def start_fetcher():
    global _fetcher_thread, _fetcher_running
    if _fetcher_running:
        return
    _fetcher_running = True
    _fetcher_thread = threading.Thread(target=fetcher_loop, daemon=True)
    _fetcher_thread.start()
    print("[fetcher] Thread started.")

def stop_fetcher():
    global _fetcher_running
    _fetcher_running = False
    print("[fetcher] Thread stopping...")

def is_fetcher_running():
    return _fetcher_running

def get_fetcher_status():
    return {
        "running": _fetcher_running,
        "total": _total_to_process,
        "processed": _processed_count,
        "current_company": _current_company,
        "errors": _errors
    }
