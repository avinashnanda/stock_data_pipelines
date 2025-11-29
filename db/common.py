# db/common.py
import pandas as pd
import numpy as np
from datetime import date


def clean_numeric(x):
    """
    Convert Screener-style values to float (handles %, commas, ₹, Cr., etc.).
    Returns None when it can't parse.
    """
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return None
    if isinstance(x, (int, float)):
        return float(x)

    s = str(x).strip()
    if s in ("", "-", "NaN", "nan", "None"):
        return None

    # Remove common symbols
    for tok in ["₹", "Rs.", "Rs", "Cr.", "cr.", "cr", "%", ","]:
        s = s.replace(tok, "")

    s = s.strip()
    try:
        return float(s)
    except ValueError:
        return None


def parse_period_label_to_date(label: str) -> date:
    """
    Convert labels like 'Sep 2022' or 'Mar 2014' into a DATE.
    We'll map them to the first day of that month.
    """
    # Use errors='coerce' so bad labels become NaT
    return pd.to_datetime(label + " 01", format="%b %Y %d", errors="coerce").date()


def ensure_date(col):
    """
    Convert a Series to Python date objects (assuming it's str/datetime-like).
    """
    return pd.to_datetime(col).dt.date
