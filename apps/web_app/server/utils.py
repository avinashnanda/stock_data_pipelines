"""Shared utility helpers, data classes, and universe loader."""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import pandas as pd

from config.paths import UNIVERSE_CSV  # noqa: E402


def normalize_symbol_name(symbol: str) -> str:
    cleaned = symbol.strip().upper()
    if ":" in cleaned:
        cleaned = cleaned.split(":", 1)[1]
    if cleaned.endswith(".NS"):
        cleaned = cleaned[:-3]
    return cleaned


def sanitize_json_value(value: Any) -> Any:
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, dict):
        return {key: sanitize_json_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_json_value(item) for item in value]
    if isinstance(value, tuple):
        return [sanitize_json_value(item) for item in value]
    return value


@dataclass
class SymbolRecord:
    symbol: str
    company_name: str
    exchange: str = "NSE"

    @property
    def tv_symbol(self) -> str:
        return f"{self.exchange}:{self.symbol}"

    @property
    def yfinance_symbol(self) -> str:
        return f"{self.symbol}.NS"


@lru_cache(maxsize=1)
def load_universe() -> list[SymbolRecord]:
    if not UNIVERSE_CSV.exists():
        return []

    df = pd.read_csv(UNIVERSE_CSV)
    if "symbol" not in df.columns:
        return []

    df = df.rename(columns={"name of company": "company_name"})
    if "company_name" not in df.columns:
        df["company_name"] = df["symbol"]

    df["symbol"] = df["symbol"].astype(str).str.strip().str.upper()
    df["company_name"] = df["company_name"].fillna("").astype(str).str.strip()
    df = df[df["symbol"] != ""]

    return [
        SymbolRecord(symbol=row["symbol"], company_name=row["company_name"] or row["symbol"])
        for _, row in df[["symbol", "company_name"]].drop_duplicates().iterrows()
    ]
