#api_parser
from typing import Any, Dict, Optional, Tuple, List
from bs4 import BeautifulSoup
from .helper import parse_numeric_value, period_to_date, maybe_number


def parse_screener_chart(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Robust chart parser: handles extra dict metadata fields in values,
    not just a single 'delivery' dict at index 2.
    """
    datasets = payload.get("datasets", []) or []
    by_date: Dict[str, Dict[str, Any]] = {}

    for ds in datasets:
        metric_name = ds.get("metric") or ds.get("label") or "value"
        values = ds.get("values", []) or []

        for pair in values:
            if not isinstance(pair, (list, tuple)) or len(pair) < 2:
                continue

            date_str = pair[0]
            if not date_str:
                continue

            row = by_date.setdefault(date_str, {"Date": date_str})

            # Main value (index 1)
            row[metric_name] = maybe_number(pair[1])

            # All additional dict fields from index >= 2
            for idx in range(2, len(pair)):
                if isinstance(pair[idx], dict):
                    for extra_key, extra_val in pair[idx].items():
                        col = f"{metric_name}_{extra_key}"
                        row[col] = maybe_number(extra_val)

    return [by_date[d] for d in sorted(by_date.keys())]



def parse_screener_schedule(
    payload: Dict[str, Dict[str, Any]],
    *,
    percent_to_fraction: bool = False,
) -> List[Dict[str, Any]]:
    """
    Parse Screener schedule API JSON into a list-of-dicts.

    Examples of payloads you showed:

    1) Single metric:
       {
         "Sales Growth %": {
           "Mar 2014": "9.43%",
           "Mar 2015": "-2.09%",
           ...
         }
       }

    2) Multiple metrics:
       {
         "Exceptional items": {
           "Mar 2014": "20",
           ...
         },
         "Other income normal": {
           "Mar 2014": "71",
           ...
         }
       }

    Output (for example 2):
      [
        {
          "Period": "Mar 2014",
          "Date": "2014-03-01",
          "Exceptional items": 20.0,
          "Other income normal": 71.0,
        },
        ...
      ]
    """

    if not payload:
        return []

    # Keep metric order as in the payload dict
    metrics = list(payload.items())  # [(metric_name, {period: value, ...}), ...]

    # Use the first metric to define period order
    first_metric_name, first_series = metrics[0]
    if not isinstance(first_series, dict):
        return []

    periods = list(first_series.keys())  # preserve order from API

    rows: List[Dict[str, Any]] = []

    for period in periods:
        row: Dict[str, Any] = {"Period": period}
        date_str = period_to_date(period)
        if date_str is not None:
            row["Date"] = date_str

        for metric_name, series in metrics:
            if not isinstance(series, dict):
                continue
            raw_val = series.get(period)
            val = parse_numeric_value(raw_val, percent_to_fraction=percent_to_fraction)
            # you can decide whether to keep NaNs or skip;
            # here we include them as None to keep the column present
            row[metric_name] = val

        rows.append(row)

    return rows


def _parse_html_peers_table(
    html: str,
) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Parse peers HTML table into (rows, median_info).
    rows: list[dict] for each company
    median_info: dict for 'Median: ...' row if present, else None
    """
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if not table:
        return [], None

    # Header row
    header_cells = table.find("thead")
    headers: List[str] = []
    if header_cells:
        tr = header_cells.find("tr")
        if tr:
            headers = [th.get_text(strip=True) for th in tr.find_all(["th", "td"])]
    else:
        # Fallback: use first row of tbody as header
        first_tr = table.find("tr")
        if first_tr:
            headers = [
                th.get_text(strip=True) for th in first_tr.find_all(["th", "td"])
            ]
            first_tr.extract()

    rows: List[Dict[str, Any]] = []
    median_info: Optional[Dict[str, Any]] = None

    # Data rows
    for tr in table.find_all("tr"):
        cells = tr.find_all("td")
        if not cells:
            continue

        values = [c.get_text(strip=True) for c in cells]
        # pad / trim to header length
        if len(values) < len(headers):
            values += [""] * (len(headers) - len(values))
        elif len(values) > len(headers):
            values = values[: len(headers)]

        row_dict: Dict[str, Any] = dict(zip(headers, values))

        # Detect Median row
        first_col_name = headers[0] if headers else None
        first_val = row_dict.get(first_col_name) if first_col_name else ""
        if isinstance(first_val, str) and first_val.startswith("Median:"):
            # store raw median row with numeric conversion applied where possible
            median_info = {k: maybe_number(v) for k, v in row_dict.items()}
            continue

        # Convert numeric-looking values
        for k, v in list(row_dict.items()):
            row_dict[k] = maybe_number(v)

        rows.append(row_dict)

    return rows, median_info


def _parse_tsv_peers(
    text: str,
) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Fallback parser for TSV-like plaintext peers table.
    """
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return [], None

    header = [h.strip() for h in lines[0].split("\t")]
    rows: List[Dict[str, Any]] = []
    median_info: Optional[Dict[str, Any]] = None

    for line in lines[1:]:
        parts = [p.strip() for p in line.split("\t")]
        if not parts:
            continue

        # Detect median row
        if parts[0].startswith("Median:"):
            # Normalize length
            if len(parts) < len(header):
                parts += [""] * (len(header) - len(parts))
            elif len(parts) > len(header):
                parts = parts[: len(header)]
            median_raw = dict(zip(header, parts))
            median_info = {k: maybe_number(v) for k, v in median_raw.items()}
            continue

        # Normalize length
        if len(parts) < len(header):
            parts += [""] * (len(header) - len(parts))
        elif len(parts) > len(header):
            parts = parts[: len(header)]

        row = dict(zip(header, parts))
        # numeric conversion
        for k, v in list(row.items()):
            row[k] = maybe_number(v)

        rows.append(row)

    return rows, median_info


def parse_peers_api(text: str) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Parse /peers/ API HTML/text into:
      - rows: list[dict] for each peer company
      - median_info: dict for the 'Median: ...' row, if present

    Works for:
      - HTML table from Screener
      - TSV-like plain text as fallback

    No pandas used anywhere.
    """
    text = text.strip()
    if not text:
        return [], None

    # HTML path
    if "<table" in text.lower():
        try:
            return _parse_html_peers_table(text)
        except Exception:
            # fall back to TSV-style if HTML parsing fails for some reason
            pass

    # TSV-style plaintext path
    return _parse_tsv_peers(text)
