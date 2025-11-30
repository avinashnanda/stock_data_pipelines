from typing import Any, Optional
import re
import pandas as pd
from typing import Dict

MONTH_MAP = {
    "Jan": 1,
    "Feb": 2,
    "Mar": 3,
    "Apr": 4,
    "May": 5,
    "Jun": 6,
    "Jul": 7,
    "Aug": 8,
    "Sep": 9,
    "Oct": 10,
    "Nov": 11,
    "Dec": 12,
}

_num_re = re.compile(r"[-+]?\d+(?:\.\d+)?")

def parse_numeric_value(raw: Any, *, percent_to_fraction: bool) -> Optional[float]:
    if raw is None:
        return None

    if isinstance(raw, (int, float)):
        return float(raw)

    s = str(raw).strip()
    if not s or s in ("-", "NaN", "nan"):
        return None

    # remove commas before regex
    s_clean = s.replace(",", "")

    m = _num_re.search(s_clean)
    if not m:
        return None

    num_str = m.group(0)
    try:
        value = float(num_str)
    except ValueError:
        return None

    if percent_to_fraction and "%" in s:
        return value / 100.0

    return value



def period_to_date(period: str) -> Optional[str]:
    """
    Convert 'Mar 2014' -> '2014-03-01'.
    If we can't parse, return None.
    """
    if not period:
        return None

    parts = period.split()
    if len(parts) != 2:
        return None

    mon_str, year_str = parts[0], parts[1]
    mon = MONTH_MAP.get(mon_str[:3])  # allow 'March' -> 'Mar'
    if mon is None:
        return None

    try:
        year = int(year_str)
    except ValueError:
        return None

    return f"{year:04d}-{mon:02d}-01"


def maybe_number(s: str) -> Any:
    """
    Try to convert a string to a float.
    Handles:
      - commas: '151,096.39'
      - trailing %: '9.43%'
      - blanks: '', '-' -> None
    If not numeric, returns original string.
    """
    if s is None:
        return None
    s = str(s).strip()
    if s == "" or s == "-":
        return None

    # remove % and commas
    cleaned = s.replace(",", "").replace("%", "")
    try:
        return float(cleaned)
    except ValueError:
        return s  # keep as string if it isn't purely numeric

def normalize_key(prefix: str, label: str) -> str:
    """
    Turn 'Sales', 'Net Profit', 'Material Cost %' into keys like:
      'sales_quarterly', 'net_profit_profit_loss', etc.
    """
    return f"{label.lower().replace(' ', '_')}_{prefix}"


def df_to_records(df: Any) -> Any:
    """
    Convert a DataFrame into list-of-dicts (records) for JSON.
    If it's not a DataFrame, return as-is.
    """
    if isinstance(df, pd.DataFrame):
        if df.empty:
            return []
        return df.to_dict(orient="records")
    return df


def convert_dict_of_dfs_to_records(d: Dict[str, Any]) -> Dict[str, Any]:
    """
    For a dict where values may be DataFrames, convert them to records.
    Nested dicts are handled recursively.
    """
    out: Dict[str, Any] = {}
    for key, val in d.items():
        if isinstance(val, pd.DataFrame):
            out[key] = df_to_records(val)
        elif isinstance(val, dict):
            out[key] = convert_dict_of_dfs_to_records(val)
        else:
            out[key] = val
    return out
