from __future__ import annotations

import csv
import json
from pathlib import Path
from uuid import uuid4

from config.paths import STRATEGY_EXPORT_DIR


def export_backtest_result(*, run_id: str, result: dict, export_format: str) -> dict:
    export_type = (export_format or "json").strip().lower()
    if export_type == "json":
        path = STRATEGY_EXPORT_DIR / f"{run_id}_{uuid4().hex[:6]}.json"
        path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        return _export_payload(path, export_type)
    if export_type == "trades_csv":
        path = STRATEGY_EXPORT_DIR / f"{run_id}_{uuid4().hex[:6]}_trades.csv"
        _write_csv(path, result.get("trades") or [])
        return _export_payload(path, export_type)
    if export_type == "equity_csv":
        path = STRATEGY_EXPORT_DIR / f"{run_id}_{uuid4().hex[:6]}_equity.csv"
        _write_csv(path, result.get("equity_curve") or [])
        return _export_payload(path, export_type)
    raise ValueError(f"Unsupported export format '{export_format}'.")


def _write_csv(path: Path, rows: list[dict]) -> None:
    fieldnames = sorted({key for row in rows for key in row.keys()}) if rows else ["empty"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        if rows:
            writer.writerows(rows)


def _export_payload(path: Path, export_type: str) -> dict:
    return {
        "format": export_type,
        "path": str(path),
        "filename": path.name,
        "size_bytes": path.stat().st_size,
    }
