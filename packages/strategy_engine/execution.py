from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd
from backtesting import Strategy
from backtesting.lib import crossover
from packages.strategy_engine.sandbox import validate_strategy_code


ALLOWED_IMPORTS = {
    "math": math,
    "statistics": __import__("statistics"),
    "numpy": np,
    "np": np,
    "pandas": pd,
    "pd": pd,
    "backtesting": __import__("backtesting"),
    "backtesting.lib": __import__("backtesting.lib", fromlist=["crossover"]),
}


def compile_strategy_class(strategy_code: str) -> type[Strategy]:
    validate_strategy_code(strategy_code)

    execution_env = {
        "__builtins__": _safe_builtins(),
        "__name__": "strategy_lab_user_strategy",
        "math": math,
        "np": np,
        "pd": pd,
        "Strategy": Strategy,
        "crossover": crossover,
    }
    exec(strategy_code, execution_env, execution_env)
    candidates = [
        value for value in execution_env.values()
        if isinstance(value, type) and issubclass(value, Strategy) and value is not Strategy
    ]
    if not candidates:
        raise ValueError("Strategy code must define a class that inherits from backtesting.Strategy.")
    return candidates[-1]


def _safe_builtins() -> dict[str, Any]:
    def limited_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name in ALLOWED_IMPORTS:
            return ALLOWED_IMPORTS[name]
        raise ImportError(f"Import '{name}' is not allowed in Strategy Lab.")

    return {
        "__import__": limited_import,
        "__build_class__": __build_class__,
        "abs": abs,
        "all": all,
        "any": any,
        "bool": bool,
        "dict": dict,
        "enumerate": enumerate,
        "float": float,
        "int": int,
        "len": len,
        "list": list,
        "max": max,
        "min": min,
        "pow": pow,
        "print": print,
        "range": range,
        "round": round,
        "set": set,
        "sorted": sorted,
        "str": str,
        "sum": sum,
        "tuple": tuple,
        "object": object,
        "zip": zip,
    }
