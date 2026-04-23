import re
from typing import Any


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
_NUM_RE = re.compile(r"[-+]?\d+(?:\.\d+)?")


def parse_numeric_value(raw: Any, *, percent_to_fraction: bool) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)

    text = str(raw).strip()
    if not text or text in {"-", "NaN", "nan"}:
        return None

    match = _NUM_RE.search(text.replace(",", ""))
    if match is None:
        return None

    value = float(match.group(0))
    return value / 100.0 if percent_to_fraction and "%" in text else value


def period_to_date(period: str) -> str | None:
    if not period:
        return None

    parts = period.split()
    if len(parts) != 2:
        return None

    month = MONTH_MAP.get(parts[0][:3])
    if month is None:
        return None

    try:
        year = int(parts[1])
    except ValueError:
        return None

    return f"{year:04d}-{month:02d}-01"


def maybe_number(value: Any) -> Any:
    if value is None:
        return None

    text = str(value).strip()
    if text in {"", "-"}:
        return None

    try:
        return float(text.replace(",", "").replace("%", ""))
    except ValueError:
        return text


def normalize_key(prefix: str, label: str) -> str:
    return f"{label.lower().replace(' ', '_')}_{prefix}"
