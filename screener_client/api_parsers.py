import json
from typing import Any, Dict, Optional, Union, Tuple, List
from io import StringIO

import pandas as pd


# ---------- Chart parser ----------

def parse_screener_chart(raw: Union[str, Dict[str, Any]]) -> pd.DataFrame:
    """
    Parse Screener.in chart API response into a tidy DataFrame.

    - One row per date
    - One column per metric (Price, DMA50, EPS, etc)
    - Optional 'Delivery' column from Volume dataset
    """
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return pd.DataFrame()

    if not isinstance(data, dict) or "datasets" not in data:
        return pd.DataFrame()

    records_by_date: Dict[str, Dict[str, Any]] = {}

    for ds in data.get("datasets", []):
        metric = ds.get("metric")
        values = ds.get("values", [])
        if not metric or not isinstance(values, list):
            continue

        for entry in values:
            # Expected: [date, value] OR [date, value, {"delivery": x}]
            if not isinstance(entry, list) or len(entry) < 2:
                continue

            date_str = entry[0]
            value = entry[1]

            if date_str not in records_by_date:
                records_by_date[date_str] = {"Date": date_str}

            records_by_date[date_str][metric] = value

            if len(entry) > 2 and isinstance(entry[2], dict):
                delivery = entry[2].get("delivery")
                if delivery is not None:
                    records_by_date[date_str]["Delivery"] = delivery

    if not records_by_date:
        return pd.DataFrame()

    df = pd.DataFrame.from_dict(records_by_date, orient="index")
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df.sort_values("Date", inplace=True)
    df.reset_index(drop=True, inplace=True)

    for col in df.columns:
        if col == "Date":
            continue
        df[col] = pd.to_numeric(df[col], errors="coerce")

    return df


# ---------- Schedules parser ----------

def _parse_schedule_value(v: Any, percent_to_fraction: bool) -> Optional[float]:
    if v is None:
        return None

    if isinstance(v, (int, float)):
        return float(v)

    if not isinstance(v, str):
        return None

    s = v.strip()
    is_percent = s.endswith("%")
    if is_percent:
        s = s[:-1].strip()

    if not s:
        return None

    try:
        num = float(s)
    except ValueError:
        return None

    if is_percent and percent_to_fraction:
        num = num / 100.0

    return num


def parse_screener_schedule(
    raw: Union[str, Dict[str, Dict[str, str]]],
    *,
    percent_to_fraction: bool = False,
) -> pd.DataFrame:
    """
    Parse Screener.in /schedules API (Expenses, Other Income, etc) into a DataFrame.

    Output:
      Period (string), Date (datetime), one column per metric.
    """
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return pd.DataFrame()

    if not isinstance(data, dict) or not data:
        return pd.DataFrame()

    periods: set[str] = set()
    for series in data.values():
        if isinstance(series, dict):
            periods.update(series.keys())

    if not periods:
        return pd.DataFrame()

    records_by_period: Dict[str, Dict[str, Any]] = {
        p: {"Period": p} for p in periods
    }

    for metric, series in data.items():
        if not isinstance(series, dict):
            continue

        for period, value in series.items():
            if period not in records_by_period:
                records_by_period[period] = {"Period": period}
            records_by_period[period][metric] = _parse_schedule_value(
                value, percent_to_fraction=percent_to_fraction
            )

    df = pd.DataFrame.from_dict(records_by_period, orient="index")
    df["Date"] = pd.to_datetime(df["Period"], format="%b %Y", errors="coerce")
    df.sort_values("Date", inplace=True)
    df.reset_index(drop=True, inplace=True)

    return df


# ---------- Peers API parser ----------


def parse_peers_api(text: str) -> Tuple[pd.DataFrame, Optional[Dict[str, Any]]]:
    """
    Parse /peers/ API HTML/text into a DataFrame and an optional 'median' row.
    - Supports HTML tables and fallback TSV format.
    """
    text = text.strip()
    if not text:
        return pd.DataFrame(), None

    median_info: Optional[Dict[str, Any]] = None

    # Attempt: HTML table
    if "<table" in text.lower():
        try:
            df_list = pd.read_html(StringIO(text))
            if df_list:
                df = df_list[0]

                # Extract & remove Median: row if present
                first_col = df.columns[0]
                median_mask = df[first_col].astype(str).str.startswith("Median:")
                if median_mask.any():
                    median_row = df[median_mask].iloc[0]
                    median_info = median_row.to_dict()
                    df = df[~median_mask].reset_index(drop=True)

                # Clean column names
                df.columns = [str(c).strip().replace("\n", " ") for c in df.columns]

                # Convert numeric columns where possible
                for col in df.columns:
                    try:
                        df[col] = pd.to_numeric(df[col])
                    except Exception:
                        pass

                return df, median_info

        except Exception:
            pass

    # Fallback: TSV-style plaintext
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return pd.DataFrame(), None

    header = [h.strip() for h in lines[0].split("\t")]
    data_rows: List[List[str]] = []

    for line in lines[1:]:
        parts = line.split("\t")

        if parts[0].startswith("Median:"):
            median_info = {"raw": line, "columns": parts}
            continue

        # Normalize missing values
        if len(parts) < len(header):
            parts += [""] * (len(header) - len(parts))
        else:
            parts = parts[:len(header)]

        data_rows.append([p.strip() for p in parts])

    df = pd.DataFrame(data_rows, columns=header)
    return df, median_info


