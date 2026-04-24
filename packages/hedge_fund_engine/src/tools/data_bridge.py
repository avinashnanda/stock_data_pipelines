"""
Data Bridge — local data replacement for financial-datasets-api.

Provides drop-in replacements for the functions in api.py, using:
  - yfinance for price data
  - Screener DuckDB for financial metrics and line items
  - Announcements DuckDB for company news
"""

import contextlib
import json
import logging
import re
import contextlib
import os
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

# Ensure project root is importable
if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    _PROJECT_ROOT = Path(sys._MEIPASS)
else:
    _PROJECT_ROOT = Path(__file__).resolve().parents[3]  # ai-hedge-fund/src/tools -> project root
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

try:
    import duckdb
except ImportError:
    duckdb = None

from src.data.cache import get_cache
from src.data.models import (
    CompanyNews,
    FinancialMetrics,
    InsiderTrade,
    LineItem,
    Price,
)

_cache = get_cache()

# ── Helpers ──────────────────────────────────────────────────────────────────

def _yf_ticker(ticker: str) -> str:
    """Convert a plain ticker to yfinance format (append .NS for NSE stocks)."""
    t = ticker.strip().upper()
    if t.endswith(".NS") or t.endswith(".BO"):
        return t
    # If it looks like a US ticker with dots (BRK.A) or already has exchange, keep it
    if "." in t:
        return t
    # Default: assume Indian stock
    return f"{t}.NS"


def _parse_indian_number(value) -> float | None:
    """Parse Screener-style Indian numbers like '₹2,34,567 Cr.' or '23.4 %'."""
    if value is None:
        return None
    s = str(value).strip()
    if not s or s == "--" or s == "":
        return None
    # Remove currency symbols, commas, whitespace
    s = s.replace("₹", "").replace(",", "").strip()
    # Handle Cr. (crores = 1e7)
    cr_match = re.match(r"([-+]?[\d.]+)\s*Cr\.?", s)
    if cr_match:
        return float(cr_match.group(1)) * 1e7
    # Handle % suffix
    pct_match = re.match(r"([-+]?[\d.]+)\s*%", s)
    if pct_match:
        return float(pct_match.group(1)) / 100.0
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _load_screener_snapshot(ticker: str) -> dict | None:
    """Load the latest Screener.in JSON snapshot for a ticker from DuckDB."""
    if duckdb is None:
        return None
    try:
        from config.paths import SCREENER_DB
        if not SCREENER_DB.exists():
            return None
        normalized = ticker.strip().upper().replace(".NS", "")
        source_like = f"%/COMPANY/{normalized}/%"
        with contextlib.closing(duckdb.connect(str(SCREENER_DB), read_only=True)) as con:
            row = con.execute("""
                SELECT payload_json FROM raw_company_json
                WHERE UPPER(source_url) LIKE ?
                ORDER BY scraped_at DESC LIMIT 1
            """, [source_like]).fetchone()
        if row is None:
            return None
        payload = json.loads(row[0]) if isinstance(row[0], str) else row[0]
        return payload
    except Exception as e:
        logger.warning("Failed to load Screener snapshot for %s: %s", ticker, e)
        return None


# ── Price Data (yfinance) ────────────────────────────────────────────────────

def get_prices(ticker: str, start_date: str, end_date: str, api_key: str = None) -> list[Price]:
    """Fetch OHLCV price data from yfinance."""
    cache_key = f"{ticker}_{start_date}_{end_date}"
    if cached := _cache.get_prices(cache_key):
        return [Price(**p) for p in cached]

    yf_sym = _yf_ticker(ticker)
    try:
        # We suppress stderr because yfinance prints "1 Failed download" messages 
        # even when we handle the empty result gracefully.
        with open(os.devnull, 'w') as devnull:
            with contextlib.redirect_stderr(devnull):
                df = yf.download(yf_sym, start=start_date, end=end_date, progress=False, auto_adjust=True)
        
        # If the range fetch fails or is empty, try 'max' period for recently listed stocks
        if df.empty:
            with open(os.devnull, 'w') as devnull:
                with contextlib.redirect_stderr(devnull):
                    df = yf.download(yf_sym, period="max", progress=False, auto_adjust=True)
            if not df.empty:
                # Filter to requested range locally
                df = df[start_date:end_date]

        if df.empty:
            return []

        # Handle multi-level columns from yf.download
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        prices = []
        for dt, row in df.iterrows():
            prices.append(Price(
                open=float(row["Open"]),
                close=float(row["Close"]),
                high=float(row["High"]),
                low=float(row["Low"]),
                volume=int(row["Volume"]) if pd.notna(row["Volume"]) else 0,
                time=dt.strftime("%Y-%m-%d"),
            ))
        _cache.set_prices(cache_key, [p.model_dump() for p in prices])
        return prices
    except Exception as e:
        logger.warning("yfinance price fetch failed for %s: %s", ticker, e)
        return []


# ── Financial Metrics (Screener DuckDB) ──────────────────────────────────────

def get_financial_metrics(
    ticker: str,
    end_date: str,
    period: str = "ttm",
    limit: int = 10,
    api_key: str = None,
) -> list[FinancialMetrics]:
    """Fetch financial metrics from Screener.in DuckDB data."""
    cache_key = f"{ticker}_{period}_{end_date}_{limit}"
    if cached := _cache.get_financial_metrics(cache_key):
        return [FinancialMetrics(**m) for m in cached]

    payload = _load_screener_snapshot(ticker)
    if not payload:
        return []

    normalized = ticker.strip().upper().replace(".NS", "")
    summary = payload.get("summary", {}) or {}
    ratios_table = (payload.get("ratios") or payload.get("tables", {}).get("ratios")) or []

    metrics_list = []

    # Build one "current" metrics from summary
    current = FinancialMetrics(
        ticker=normalized,
        report_period=end_date,
        period="ttm",
        currency="INR",
        market_cap=_parse_indian_number(summary.get("Market Cap")),
        enterprise_value=None,
        price_to_earnings_ratio=_parse_indian_number(summary.get("Stock P/E")),
        price_to_book_ratio=_parse_indian_number(summary.get("Price to book value")),
        price_to_sales_ratio=None,
        enterprise_value_to_ebitda_ratio=None,
        enterprise_value_to_revenue_ratio=None,
        free_cash_flow_yield=None,
        peg_ratio=None,
        gross_margin=None,
        operating_margin=None,
        net_margin=None,
        return_on_equity=_parse_indian_number(summary.get("ROE")),
        return_on_assets=None,
        return_on_invested_capital=_parse_indian_number(summary.get("ROCE")),
        asset_turnover=None,
        inventory_turnover=None,
        receivables_turnover=None,
        days_sales_outstanding=None,
        operating_cycle=None,
        working_capital_turnover=None,
        current_ratio=_parse_indian_number(summary.get("Current ratio")),
        quick_ratio=None,
        cash_ratio=None,
        operating_cash_flow_ratio=None,
        debt_to_equity=_parse_indian_number(summary.get("Debt to equity")),
        debt_to_assets=None,
        interest_coverage=None,
        revenue_growth=None,
        earnings_growth=None,
        book_value_growth=None,
        earnings_per_share_growth=None,
        free_cash_flow_growth=None,
        operating_income_growth=None,
        ebitda_growth=None,
        payout_ratio=_parse_indian_number(summary.get("Dividend Yield")),
        earnings_per_share=_parse_indian_number(summary.get("EPS")),
        book_value_per_share=_parse_indian_number(summary.get("Book Value")),
        free_cash_flow_per_share=None,
    )
    metrics_list.append(current)

    # Build historical metrics from ratios table if available
    if ratios_table and isinstance(ratios_table, list) and len(ratios_table) > 0:
        is_dicts = isinstance(ratios_table[0], dict)
        if is_dicts:
            headers = list(ratios_table[0].keys())
            rows = ratios_table
        else:
            headers = ratios_table[0]
            rows = ratios_table[1:]

        for row in rows[:limit]:
            row_dict = {}
            if is_dicts:
                row_dict = {str(k).strip(): v for k, v in row.items()}
                period_str = str(list(row.values())[0]).strip()
            else:
                if not isinstance(row, list) or len(row) < 1:
                    continue
                period_str = str(row[0]).strip()
                for i, h in enumerate(headers):
                    if i < len(row):
                        row_dict[str(h).strip()] = row[i]

            m = FinancialMetrics(
                ticker=normalized,
                report_period=period_str if "-" in period_str else f"{period_str}-03-31",
                period="annual",
                currency="INR",
                market_cap=None,
                enterprise_value=None,
                price_to_earnings_ratio=None,
                price_to_book_ratio=None,
                price_to_sales_ratio=None,
                enterprise_value_to_ebitda_ratio=None,
                enterprise_value_to_revenue_ratio=None,
                free_cash_flow_yield=None,
                peg_ratio=None,
                gross_margin=None,
                operating_margin=_parse_indian_number(row_dict.get("OPM %")),
                net_margin=None,
                return_on_equity=_parse_indian_number(row_dict.get("ROE %")),
                return_on_assets=None,
                return_on_invested_capital=_parse_indian_number(row_dict.get("ROCE %")),
                asset_turnover=None,
                inventory_turnover=None,
                receivables_turnover=None,
                days_sales_outstanding=_parse_indian_number(row_dict.get("Debtor Days")),
                operating_cycle=None,
                working_capital_turnover=None,
                current_ratio=None,
                quick_ratio=None,
                cash_ratio=None,
                operating_cash_flow_ratio=None,
                debt_to_equity=None,
                debt_to_assets=None,
                interest_coverage=None,
                revenue_growth=None,
                earnings_growth=None,
                book_value_growth=None,
                earnings_per_share_growth=None,
                free_cash_flow_growth=None,
                operating_income_growth=None,
                ebitda_growth=None,
                payout_ratio=None,
                earnings_per_share=None,
                book_value_per_share=None,
                free_cash_flow_per_share=None,
            )
            metrics_list.append(m)

    _cache.set_financial_metrics(cache_key, [m.model_dump() for m in metrics_list])
    return metrics_list[:limit]


# ── Line Items (Screener DuckDB tables) ──────────────────────────────────────

# Mapping from financial-datasets line item names → Screener table + column
_LINE_ITEM_MAP = {
    "revenue": ("profit_and_loss", "Sales"),
    "net_income": ("profit_and_loss", "Net Profit"),
    "operating_income": ("profit_and_loss", "Operating Profit"),
    "operating_margin": ("profit_and_loss", "OPM %"),
    "depreciation_and_amortization": ("profit_and_loss", "Depreciation"),
    "interest_expense": ("profit_and_loss", "Interest"),
    "tax_expense": ("profit_and_loss", "Tax"),
    "capital_expenditure": ("cash_flows", "Fixed Assets Purchased"),
    "total_assets": ("balance_sheet", "Total Assets"),
    "total_liabilities": ("balance_sheet", "Total Liabilities"),
    "shareholders_equity": ("balance_sheet", "Total Equity"),
    "outstanding_shares": ("balance_sheet", "Equity Capital"),
    "book_value_per_share": ("balance_sheet", "Book Value"),
    "free_cash_flow": ("cash_flows", "Cash from Operating Activity"),
    "dividends_and_other_cash_distributions": ("cash_flows", "Dividends Paid"),
    "gross_profit": ("profit_and_loss", "Gross Profit"),
    "ebitda": ("profit_and_loss", "EBITDA"),
}


def search_line_items(
    ticker: str,
    line_items: list[str],
    end_date: str,
    period: str = "ttm",
    limit: int = 10,
    api_key: str = None,
) -> list[LineItem]:
    """Fetch financial line items from Screener.in DuckDB tables."""
    payload = _load_screener_snapshot(ticker)
    if not payload:
        return []

    normalized = ticker.strip().upper().replace(".NS", "")
    tables = {}
    for tbl_name in ["profit_and_loss", "balance_sheet", "cash_flows"]:
        raw = payload.get(tbl_name) or (payload.get("tables", {}) or {}).get(tbl_name) or []
        if raw and isinstance(raw, list) and len(raw) > 1:
            tables[tbl_name] = raw

    if not tables:
        return []

    # Determine periods from the first available table
    first_table = list(tables.values())[0]
    if not first_table:
        return []

    # Detect format: list of lists or list of dicts
    is_list_of_dicts = isinstance(first_table[0], dict)
    
    if is_list_of_dicts:
        headers = list(first_table[0].keys())
    else:
        headers = first_table[0]
        
    period_cols = [str(h).strip() for h in headers[1:]]

    results = []
    for pi, period_label in enumerate(period_cols[:limit]):
        report_period = period_label if "-" in period_label else f"{period_label}-03-31"
        item_data = {
            "ticker": normalized,
            "report_period": report_period,
            "period": "annual",
            "currency": "INR",
        }

        for li_name in line_items:
            mapping = _LINE_ITEM_MAP.get(li_name)
            if not mapping:
                item_data[li_name] = None
                continue

            tbl_name, col_name = mapping
            tbl = tables.get(tbl_name, [])

            found = False
            # If list of dicts, headers[0] is the key for the row label (e.g. "Item")
            # headers[pi+1] is the key for the value in this period
            label_key = headers[0]
            val_key = headers[pi + 1]

            for row in (tbl if is_list_of_dicts else tbl[1:]):
                if is_list_of_dicts:
                    row_label = str(row.get(label_key, "")).strip()
                    row_val = row.get(val_key)
                else:
                    if not isinstance(row, list) or len(row) < 2:
                        continue
                    row_label = str(row[0]).strip()
                    row_val = row[pi + 1] if (pi + 1) < len(row) else None

                if row_label.lower() == col_name.lower() or col_name.lower() in row_label.lower():
                    item_data[li_name] = _parse_indian_number(row_val)
                    found = True
                    break
            if not found:
                item_data[li_name] = None

        results.append(LineItem(**item_data))

    return results[:limit]


# ── Insider Trades (not available for NSE) ───────────────────────────────────

def get_insider_trades(
    ticker: str,
    end_date: str,
    start_date: str | None = None,
    limit: int = 1000,
    api_key: str = None,
) -> list[InsiderTrade]:
    """Return empty list — NSE insider trade data not in our pipeline."""
    return []


# ── Company News (Announcements DuckDB) ─────────────────────────────────────

def get_company_news(
    ticker: str,
    end_date: str,
    start_date: str | None = None,
    limit: int = 1000,
    api_key: str = None,
) -> list[CompanyNews]:
    """Fetch company news from our announcements DuckDB."""
    cache_key = f"{ticker}_{start_date or 'none'}_{end_date}_{limit}"
    if cached := _cache.get_company_news(cache_key):
        return [CompanyNews(**n) for n in cached]

    try:
        from packages.shared_db.db_utils import get_announcements
        normalized = ticker.strip().upper().replace(".NS", "")
        rows = get_announcements(symbol=normalized, limit=limit,
                                 start_date=start_date, end_date=end_date)
        news = []
        for r in rows:
            news.append(CompanyNews(
                ticker=normalized,
                title=r.get("title") or r.get("summary", "")[:100],
                source="NSE",
                date=r.get("broadcast_date", ""),
                url=r.get("pdf_url", ""),
                sentiment=r.get("sentiment"),
            ))
        _cache.set_company_news(cache_key, [n.model_dump() for n in news])
        return news
    except Exception as e:
        logger.warning("Failed to fetch announcements for %s: %s", ticker, e)
        return []


# ── Market Cap ───────────────────────────────────────────────────────────────

def get_market_cap(ticker: str, end_date: str, api_key: str = None) -> float | None:
    """Get market cap from Screener summary or yfinance."""
    payload = _load_screener_snapshot(ticker)
    if payload:
        summary = payload.get("summary", {}) or {}
        mcap = _parse_indian_number(summary.get("Market Cap"))
        if mcap:
            return mcap

    # Fallback to yfinance
    try:
        yf_sym = _yf_ticker(ticker)
        info = yf.Ticker(yf_sym).info
        return info.get("marketCap")
    except Exception:
        return None


# ── DataFrame helpers (unchanged logic from api.py) ──────────────────────────

def prices_to_df(prices: list[Price]) -> pd.DataFrame:
    """Convert prices to a DataFrame."""
    df = pd.DataFrame([p.model_dump() for p in prices])
    df["Date"] = pd.to_datetime(df["time"])
    df.set_index("Date", inplace=True)
    numeric_cols = ["open", "close", "high", "low", "volume"]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df.sort_index(inplace=True)
    return df


def get_price_data(ticker: str, start_date: str, end_date: str, api_key: str = None) -> pd.DataFrame:
    prices = get_prices(ticker, start_date, end_date, api_key=api_key)
    return prices_to_df(prices)
