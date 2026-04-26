from __future__ import annotations

from typing import Any


def _module_available(module_name: str) -> bool:
    try:
        __import__(module_name)
        return True
    except Exception:
        return False


def get_engine_capabilities() -> dict[str, Any]:
    backtesting_available = _module_available("backtesting")
    return {
        "run_engines": {
            "auto": True,
            "backtesting": backtesting_available,
        },
        "optimization_engines": {
            "auto": True,
            "backtesting": backtesting_available,
        },
        "live_engines": {
            "paper": True,
            "event_driven": True,
            "broker_bridge": False,
        },
        "notes": [
            "Strategy Lab runs native backtesting.py Strategy classes.",
            "backtesting.py optimize is used for Strategy Lab optimization.",
        ],
    }


def resolve_run_engine(preferred: str | None) -> tuple[str, str | None]:
    engine = (preferred or "auto").strip().lower()
    capabilities = get_engine_capabilities()
    if engine in {"", "auto"}:
        if capabilities["run_engines"]["backtesting"]:
            return "backtesting", None
        return "backtesting", "backtesting.py is not installed; native Strategy execution is unavailable."
    if engine == "backtesting" and not capabilities["run_engines"]["backtesting"]:
        return "backtesting", "Requested backtesting.py engine is unavailable."
    if engine not in {"backtesting"}:
        return "backtesting", f"Unknown run engine '{engine}'; using backtesting.py."
    return "backtesting", None


def resolve_optimization_engine(preferred: str | None) -> tuple[str, str | None]:
    engine = (preferred or "auto").strip().lower()
    capabilities = get_engine_capabilities()
    if engine in {"", "auto"}:
        if capabilities["optimization_engines"]["backtesting"]:
            return "backtesting", None
        return "backtesting", "backtesting.py is not installed; native optimization is unavailable."
    if engine == "backtesting" and not capabilities["optimization_engines"]["backtesting"]:
        return "backtesting", "Requested backtesting.py optimizer is unavailable."
    if engine not in {"backtesting"}:
        return "backtesting", f"Unknown optimization engine '{engine}'; using backtesting.py."
    return "backtesting", None
