from __future__ import annotations

from dataclasses import dataclass
from itertools import product
import operator
import os
import re
from typing import Any, Callable

from apps.web_app.server.utils import sanitize_json_value
from packages.strategy_engine.adapters import get_engine_capabilities, resolve_optimization_engine, resolve_run_engine
from packages.strategy_engine.data import load_ohlcv_dataframe
from packages.strategy_engine.execution import compile_strategy_class
from packages.strategy_engine.metrics import build_drawdown_curve, build_metrics
import pandas as pd

os.environ.setdefault("TQDM_DISABLE", "1")


def disable_backtesting_progress_bars() -> None:
    try:
        import backtesting.backtesting as backtesting_module  # type: ignore
        import backtesting._util as util_module  # type: ignore
    except Exception:
        return

    def passthrough_tqdm(sequence, **_: Any):
        return sequence

    backtesting_module._tqdm = passthrough_tqdm
    util_module._tqdm = passthrough_tqdm


disable_backtesting_progress_bars()


@dataclass
class BacktestRunRequest:
    symbol: str
    timeframe: str
    start_date: str
    end_date: str
    strategy_code: str
    params: dict[str, Any]
    initial_cash: float = 100000.0
    commission: float = 0.0
    engine: str = "auto"


class StrategyRunner:
    def capabilities(self) -> dict[str, Any]:
        return get_engine_capabilities()

    def run(self, request: BacktestRunRequest) -> dict[str, Any]:
        data = load_ohlcv_dataframe(
            symbol=request.symbol,
            timeframe=request.timeframe,
            start_date=request.start_date,
            end_date=request.end_date,
        )
        selected_engine, warning = resolve_run_engine(request.engine)
        if selected_engine == "backtesting":
            result = self._run_backtesting_adapter(request, data)
        else:
            result = self._run_with_data(request, data)

        result.setdefault("logs", [])
        if warning:
            result["logs"].insert(0, {"level": "warning", "message": warning})

        result["engine"] = {
            "selected": selected_engine,
            "requested": request.engine,
            "mode": "single_run",
            "capabilities": self.capabilities(),
        }
        result["context"] = {
            "symbol": request.symbol,
            "timeframe": request.timeframe,
            "start_date": request.start_date,
            "end_date": request.end_date,
            "bar_count": len(data),
            "last_price": round(float(data["close"].iloc[-1]), 4),
        }
        return sanitize_json_value(result)

    def compare(
        self,
        *,
        strategies: list[dict[str, Any]],
        symbol: str,
        timeframe: str,
        start_date: str,
        end_date: str,
        initial_cash: float = 100000.0,
        commission: float = 0.0,
        engine: str = "auto",
    ) -> dict[str, Any]:
        if not strategies:
            raise ValueError("At least one strategy is required for comparison.")

        data = load_ohlcv_dataframe(
            symbol=symbol,
            timeframe=timeframe,
            start_date=start_date,
            end_date=end_date,
        )
        selected_engine, warning = resolve_run_engine(engine)

        results = []
        for strategy in strategies:
            request = BacktestRunRequest(
                symbol=symbol,
                timeframe=timeframe,
                start_date=start_date,
                end_date=end_date,
                strategy_code=strategy["code"],
                params=strategy.get("params", {}),
                initial_cash=initial_cash,
                commission=commission,
                engine=selected_engine,
            )
            if selected_engine == "backtesting":
                result = self._run_backtesting_adapter(request, data)
            else:
                result = self._run_with_data(request, data)
            results.append(
                {
                    "strategy_id": strategy.get("id"),
                    "name": strategy.get("name", "Unnamed Strategy"),
                    "metrics": result["metrics"],
                    "equity_curve": result["equity_curve"],
                }
            )

        metrics_table = [
            {
                "name": item["name"],
                **item["metrics"],
            }
            for item in results
        ]
        summary = max(results, key=lambda item: float(item["metrics"].get("return_pct") or float("-inf")))

        return sanitize_json_value(
            {
                "metrics_table": metrics_table,
                "equity_curves": [
                    {
                        "name": item["name"],
                        "points": item["equity_curve"],
                    }
                    for item in results
                ],
                "summary": {
                    "winner": summary["name"],
                    "winner_metrics": summary["metrics"],
                },
                "engine": {
                    "selected": selected_engine,
                    "requested": engine,
                    "mode": "compare",
                    "warning": warning,
                },
            }
        )

    def optimize(
        self,
        *,
        strategy_code: str,
        symbol: str,
        timeframe: str,
        start_date: str,
        end_date: str,
        parameter_grid: dict[str, Any],
        objective: str = "sharpe",
        initial_cash: float = 100000.0,
        commission: float = 0.0,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
        engine: str = "auto",
        optimization_config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not parameter_grid:
            raise ValueError("parameter_grid is required for optimization.")
        diagnostics = build_optimization_diagnostics(parameter_grid)
        if diagnostics["valid_candidates"] <= 0:
            raise ValueError("All optimization candidates were filtered out by constraints.")

        data = load_ohlcv_dataframe(
            symbol=symbol,
            timeframe=timeframe,
            start_date=start_date,
            end_date=end_date,
        )
        combinations = build_parameter_combinations(parameter_grid)
        if not combinations:
            raise ValueError("No optimization parameter combinations were generated.")
        selected_engine, warning = resolve_optimization_engine(engine)
        if selected_engine == "backtesting":
            try:
                result = self._optimize_backtesting_adapter(
                    strategy_code=strategy_code,
                    symbol=symbol,
                    timeframe=timeframe,
                    start_date=start_date,
                    end_date=end_date,
                    parameter_grid=parameter_grid,
                    objective=objective,
                    initial_cash=initial_cash,
                    commission=commission,
                    optimization_config=optimization_config or {},
                    warning=warning,
                )
                if progress_callback:
                    progress_callback(
                        {
                            "completed": result.get("diagnostics", {}).get("valid_candidates", 0),
                            "total": result.get("diagnostics", {}).get("valid_candidates", 0),
                            "params": result.get("best_params"),
                            "score": result.get("best_metrics", {}).get(objective),
                        }
                    )
                return sanitize_json_value(result)
            except Exception as exc:
                warning = (
                    f"{warning} " if warning else ""
                ) + f"backtesting.py optimize failed ({exc}); using a manual backtesting.py parameter loop."

        runs = []
        total_runs = len(combinations)
        for index, params in enumerate(combinations, start=1):
            request = BacktestRunRequest(
                symbol=symbol,
                timeframe=timeframe,
                start_date=start_date,
                end_date=end_date,
                strategy_code=strategy_code,
                params=params,
                initial_cash=initial_cash,
                commission=commission,
                engine="custom",
            )
            result = self._run_with_data(request, data)
            score = resolve_objective_score(
                result["metrics"],
                objective,
                (optimization_config or {}).get("custom_formula") if optimization_config else None,
            )
            runs.append(
                {
                    "params": params,
                    "metrics": result["metrics"],
                    "score": score,
                    "trades": result.get("trades", []),
                    "equity_curve": result.get("equity_curve", []),
                }
            )
            if progress_callback:
                progress_callback(
                    {
                        "completed": index,
                        "total": total_runs,
                        "params": params,
                        "score": score,
                    }
                )

        ranked_runs = sorted(
            runs,
            key=lambda item: float(item["score"]) if item["score"] is not None else float("-inf"),
            reverse=True,
        )
        best = ranked_runs[0]

        return sanitize_json_value(
            {
                "best_params": best["params"],
                "best_metrics": best["metrics"],
                "leaderboard": ranked_runs[:25],
                "heatmap": build_heatmap(parameter_grid, runs, objective),
                "heatmap_axes": [key for key in parameter_grid.keys() if key != "_constraints"][:2],
                "robustness_zone": ranked_runs[:5],
                "sensitivity": build_parameter_sensitivity(runs),
                "diagnostics": diagnostics,
                "engine": {
                    "selected": selected_engine,
                    "requested": engine,
                    "mode": "optimize",
                    "warning": warning,
                },
            }
        )

    def _run_with_data(self, request: BacktestRunRequest, data) -> dict[str, Any]:
        return self._run_backtesting_adapter(request, data)

    def _run_backtesting_adapter(self, request: BacktestRunRequest, data) -> dict[str, Any]:
        try:
            from backtesting import Backtest  # type: ignore
        except Exception:
            raise ValueError("backtesting.py is required. Install the 'backtesting' package to run native strategies.")
        disable_backtesting_progress_bars()
        normalized = data.rename(
            columns={
                "open": "Open",
                "high": "High",
                "low": "Low",
                "close": "Close",
                "volume": "Volume",
            }
        ).copy()
        normalized = normalized.set_index("time")
        ScriptedStrategy = compile_strategy_class(request.strategy_code)

        try:
            backtest = Backtest(
                normalized,
                ScriptedStrategy,
                cash=request.initial_cash,
                commission=request.commission,
                trade_on_close=True,
                finalize_trades=True,
            )
        except TypeError:
            backtest = Backtest(normalized, ScriptedStrategy, cash=request.initial_cash, commission=request.commission, trade_on_close=True)
        stats = backtest.run(**(request.params or {}))
        return build_result_from_backtesting_stats(
            stats=stats,
            initial_cash=request.initial_cash,
            data=normalized,
            logs=[
                {
                    "level": "info",
                    "message": f"Executed native backtesting.py strategy. Equity final={round(float(stats.get('Equity Final [$]', request.initial_cash)), 4)}.",
                }
            ],
        )

    def _optimize_backtesting_adapter(
        self,
        *,
        strategy_code: str,
        symbol: str,
        timeframe: str,
        start_date: str,
        end_date: str,
        parameter_grid: dict[str, Any],
        objective: str,
        initial_cash: float,
        commission: float,
        optimization_config: dict[str, Any],
        warning: str | None,
    ) -> dict[str, Any]:
        from backtesting import Backtest  # type: ignore
        disable_backtesting_progress_bars()

        data = load_ohlcv_dataframe(
            symbol=symbol,
            timeframe=timeframe,
            start_date=start_date,
            end_date=end_date,
        )
        normalized = data.rename(
            columns={
                "open": "Open",
                "high": "High",
                "low": "Low",
                "close": "Close",
                "volume": "Volume",
            }
        ).copy()
        normalized = normalized.set_index("time")
        grid_specs = {key: value for key, value in parameter_grid.items() if key != "_constraints"}
        parameter_values = {key: _expand_parameter_spec(value) for key, value in grid_specs.items()}
        constraints = parse_constraints(parameter_grid.get("_constraints"))
        ScriptedStrategy = compile_strategy_class(strategy_code)

        try:
            backtest = Backtest(
                normalized,
                ScriptedStrategy,
                cash=initial_cash,
                commission=commission,
                trade_on_close=True,
                finalize_trades=True,
            )
        except TypeError:
            backtest = Backtest(normalized, ScriptedStrategy, cash=initial_cash, commission=commission, trade_on_close=True)

        optimize_kwargs: dict[str, Any] = {
            **parameter_values,
            "maximize": build_backtesting_objective(objective, optimization_config.get("custom_formula")),
            "return_heatmap": True,
        }
        method = str(optimization_config.get("method") or "grid").lower()
        max_runs = int(optimization_config.get("max_runs") or 0)
        if method == "bayesian":
            optimize_kwargs["method"] = "sambo"
            if max_runs > 0:
                optimize_kwargs["max_tries"] = max_runs
        else:
            optimize_kwargs["method"] = "grid"
            if method == "random" and max_runs > 0:
                optimize_kwargs["max_tries"] = max_runs
            elif method in {"genetic", "walk-forward"}:
                warning = (f"{warning} " if warning else "") + f"{method} is planned; backtesting.py grid optimize was used for this run."

        if constraints:
            optimize_kwargs["constraint"] = lambda params: all(
                evaluate_constraint(rule, constraint_params_to_dict(params)) for rule in constraints
            )

        stats, heatmap = backtest.optimize(**optimize_kwargs)
        heatmap_runs = []
        if heatmap is not None:
            ordered = heatmap.sort_values(ascending=False)
            for params_key, score in ordered.items():
                if not isinstance(params_key, tuple):
                    params_key = (params_key,)
                params = dict(zip(parameter_values.keys(), params_key))
                heatmap_runs.append({"params": params, "score": float(score) if pd.notna(score) else None})

        if not heatmap_runs:
            best_params = {name: getattr(stats._strategy, name, values[0]) for name, values in parameter_values.items()}
            heatmap_runs = [{"params": best_params, "score": stats_to_objective_value(stats, objective)}]

        top_runs = []
        for run in heatmap_runs[:25]:
            result = self._run_backtesting_adapter(
                BacktestRunRequest(
                    symbol=symbol,
                    timeframe=timeframe,
                    start_date=start_date,
                    end_date=end_date,
                    strategy_code=strategy_code,
                    params=run["params"],
                    initial_cash=initial_cash,
                    commission=commission,
                    engine="backtesting",
                ),
                data,
            )
            run_entry = {
                "params": run["params"],
                "metrics": result["metrics"],
                "score": run["score"],
                "trades": result.get("trades", []),
                "equity_curve": result.get("equity_curve", []),
            }
            top_runs.append(run_entry)

        best = top_runs[0]
        return {
            "best_params": best["params"],
            "best_metrics": best["metrics"],
            "leaderboard": top_runs,
            "heatmap": build_heatmap(parameter_grid, heatmap_runs, objective),
            "heatmap_axes": [key for key in parameter_grid.keys() if key != "_constraints"][:2],
            "robustness_zone": top_runs[:5],
            "sensitivity": build_parameter_sensitivity(heatmap_runs),
            "walk_forward": build_walk_forward_placeholder(top_runs),
            "diagnostics": build_optimization_diagnostics(parameter_grid),
            "engine": {
                "selected": "backtesting",
                "requested": "backtesting",
                "mode": "optimize",
                "method": method,
                "warning": warning,
            },
        }


def build_parameter_combinations(parameter_grid: dict[str, Any]) -> list[dict[str, Any]]:
    grid_specs = {
        key: value for key, value in parameter_grid.items()
        if key != "_constraints"
    }
    names: list[str] = []
    values: list[list[Any]] = []
    for key, spec in grid_specs.items():
        names.append(key)
        values.append(_expand_parameter_spec(spec))
    combinations = [dict(zip(names, combo)) for combo in product(*values)]
    constraints = parse_constraints(parameter_grid.get("_constraints"))
    if not constraints:
        return combinations
    return [combo for combo in combinations if all(evaluate_constraint(rule, combo) for rule in constraints)]


def _expand_parameter_spec(spec: Any) -> list[Any]:
    if isinstance(spec, list):
        return spec
    if not isinstance(spec, dict):
        return [spec]

    start = spec.get("start")
    end = spec.get("end")
    step = spec.get("step", 1)
    if start is None or end is None:
        raise ValueError("Optimization grid specs require start and end.")

    values = []
    current = start
    is_float = any(isinstance(item, float) for item in (start, end, step))
    while current <= end:
        values.append(round(current, 10) if is_float else int(current))
        current += step
    return values


def build_heatmap(parameter_grid: dict[str, Any], ranked_runs: list[dict[str, Any]], objective: str) -> list[dict[str, Any]]:
    keys = [key for key in parameter_grid.keys() if key != "_constraints"]
    if len(keys) < 2:
        return []
    x_key, y_key = keys[0], keys[1]
    return [
        {
            "x": run["params"].get(x_key),
            "y": run["params"].get(y_key),
            "value": run.get("metrics", {}).get(objective) if "metrics" in run else run.get("score"),
        }
        for run in ranked_runs
    ]


def build_result_from_backtesting_stats(*, stats: Any, initial_cash: float, data: pd.DataFrame, logs: list[dict[str, str]] | None = None) -> dict[str, Any]:
    trades = extract_backtesting_trades(stats, data)
    equity_curve = extract_backtesting_equity_curve(stats, data, initial_cash, trades)
    metrics = merge_backtesting_metrics(
        build_metrics(equity_curve=equity_curve, trades=trades, initial_cash=initial_cash),
        stats,
    )
    return sanitize_json_value(
        {
            "metrics": metrics,
            "trades": trades,
            "equity_curve": equity_curve,
            "drawdown_curve": build_drawdown_curve(equity_curve),
            "signals": build_signals_from_trades(trades),
            "logs": logs or [],
        }
    )


def extract_backtesting_equity_curve(stats: Any, data: pd.DataFrame, initial_cash: float, trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
    frame = getattr(stats, "_equity_curve", None)
    if frame is None or not hasattr(frame, "iterrows"):
        return []

    trade_exits = {t["exit_time"]: t for t in trades if t.get("exit_time")}
    first_close = float(data["Close"].iloc[0]) if not data.empty else 1.0

    points = []
    for index, row in frame.iterrows():
        time_str = format_time_value(index)
        close_at_time = float(data.loc[index, "Close"]) if index in data.index else first_close
        buy_hold = initial_cash * (close_at_time / first_close)

        point = {
            "time": time_str,
            "equity": round(float(row.get("Equity", 0.0)), 4),
            "buy_hold": round(float(buy_hold), 4),
        }
        if time_str in trade_exits:
            point["trade"] = trade_exits[time_str]

        points.append(point)
    return points


def extract_backtesting_trades(stats: Any, data: pd.DataFrame) -> list[dict[str, Any]]:
    frame = getattr(stats, "_trades", None)
    if frame is None or not hasattr(frame, "iterrows"):
        return []
    trades = []
    for _, row in frame.iterrows():
        size = float(row.get("Size", 0) or 0)
        entry_price = float(row.get("EntryPrice", 0) or 0)
        exit_price = float(row.get("ExitPrice", 0) or 0)
        pnl = float(row.get("PnL", 0) or 0)
        pnl_pct = float(row.get("ReturnPct", 0) or 0) * 100
        side = "LONG" if size > 0 else "SHORT"

        entry_time = row.get("EntryTime")
        exit_time = row.get("ExitTime")

        trade = {
            "date": format_time_value(exit_time),
            "side": side,
            "qty": abs(size),
            "entry": round(entry_price, 4),
            "exit": round(exit_price, 4),
            "pnl": round(pnl, 4),
            "pnl_pct": round(pnl_pct, 4),
            "entry_time": format_time_value(entry_time),
            "exit_time": format_time_value(exit_time),
        }

        # Calculate MFE / MAE
        if entry_time and exit_time and index_exists_in_data(entry_time, data) and index_exists_in_data(exit_time, data):
            try:
                trade_slice = data.loc[entry_time:exit_time]
                if not trade_slice.empty:
                    if side == "LONG":
                        max_favorable = float(trade_slice["High"].max())
                        max_adverse = float(trade_slice["Low"].min())
                        trade["mfe"] = round((max_favorable - entry_price) * abs(size), 4)
                        trade["mae"] = round((max_adverse - entry_price) * abs(size), 4)
                    else:
                        max_favorable = float(trade_slice["Low"].min())
                        max_adverse = float(trade_slice["High"].max())
                        trade["mfe"] = round((entry_price - max_favorable) * abs(size), 4)
                        trade["mae"] = round((entry_price - max_adverse) * abs(size), 4)
            except Exception:
                pass

        trades.append(trade)
    return trades


def index_exists_in_data(index: Any, data: pd.DataFrame) -> bool:
    return index in data.index


def build_signals_from_trades(trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
    signals = []
    for trade in trades:
        is_long = trade.get("side") == "LONG"
        entry_type = "BUY" if is_long else "SELL"
        exit_type = "SELL" if is_long else "BUY"
        if trade.get("entry_time"):
            signals.append(
                {
                    "time": trade.get("entry_time"),
                    "type": entry_type,
                    "price": trade.get("entry"),
                    "size": trade.get("qty"),
                }
            )
        if trade.get("exit_time"):
            signals.append(
                {
                    "time": trade.get("exit_time"),
                    "type": exit_type,
                    "price": trade.get("exit"),
                    "size": trade.get("qty"),
                    "exit_only": True,
                }
            )
    return signals


def format_time_value(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    return str(value)


def build_optimization_diagnostics(parameter_grid: dict[str, Any]) -> dict[str, Any]:
    grid_specs = {
        key: value for key, value in parameter_grid.items()
        if key != "_constraints"
    }
    names: list[str] = []
    values: list[list[Any]] = []
    for key, spec in grid_specs.items():
        names.append(key)
        expanded = _expand_parameter_spec(spec)
        values.append(expanded)

    total_candidates = 1
    for expanded in values:
        total_candidates *= max(len(expanded), 1)

    constraints = parse_constraints(parameter_grid.get("_constraints"))
    filtered_count = 0
    if constraints:
        for combo in product(*values):
            params = dict(zip(names, combo))
            if not all(evaluate_constraint(rule, params) for rule in constraints):
                filtered_count += 1

    return {
        "dimensions": names,
        "total_candidates": total_candidates,
        "constraints": constraints,
        "filtered_candidates": filtered_count,
        "valid_candidates": total_candidates - filtered_count,
    }


BACKTESTING_OBJECTIVE_KEYS = {
    "return_pct": "Return [%]",
    "return": "Return [%]",
    "sharpe": "Sharpe Ratio",
    "sortino": "Sortino Ratio",
    "profit_factor": "Profit Factor",
    "max_drawdown": "Max. Drawdown [%]",
    "drawdown": "Max. Drawdown [%]",
    "calmar": "Calmar Ratio",
}


def build_backtesting_objective(objective: str, custom_formula: str | None = None) -> str | Callable[[Any], float]:
    key = BACKTESTING_OBJECTIVE_KEYS.get((objective or "").strip().lower(), objective)
    if (objective or "").strip().lower() != "custom" and key != "Max. Drawdown [%]":
        return key

    def maximize(stats: Any) -> float:
        if (objective or "").strip().lower() == "custom":
            metrics = merge_backtesting_metrics({}, stats)
            value = evaluate_custom_objective(metrics, custom_formula)
            return float(value) if value is not None else float("-inf")
        value = stats.get(key)
        if value is None and key != objective:
            value = stats.get(objective)
        if value is None:
            value = stats_to_objective_value(stats, objective)
        numeric = float(value) if value is not None else float("-inf")
        if key == "Max. Drawdown [%]" or objective in {"max_drawdown", "drawdown"}:
            return -abs(numeric)
        return numeric

    return maximize


def resolve_objective_score(metrics: dict[str, Any], objective: str, custom_formula: str | None = None) -> Any:
    if (objective or "").strip().lower() == "custom":
        return evaluate_custom_objective(metrics, custom_formula)
    return metrics.get(objective)


def evaluate_custom_objective(metrics: dict[str, Any], custom_formula: str | None) -> float | None:
    formula = (custom_formula or "").strip()
    if not formula:
        return None
    if not re.match(r"^[\w\s+\-*/().,%]+$", formula):
        return None
    context = {
        key: float(value)
        for key, value in (metrics or {}).items()
        if isinstance(value, int | float) and not isinstance(value, bool)
    }
    context.setdefault("return", context.get("return_pct", 0.0))
    context.setdefault("dd", context.get("max_drawdown", context.get("bt_max_drawdown_pct", 0.0)))
    context.setdefault("sharpe", context.get("sharpe", context.get("bt_sharpe_ratio", 0.0)))
    context.setdefault("sortino", context.get("sortino", context.get("bt_sortino_ratio", 0.0)))
    try:
        value = eval(formula, {"__builtins__": {}, "abs": abs, "min": min, "max": max}, context)
    except Exception:
        return None
    try:
        return float(value)
    except Exception:
        return None


def stats_to_objective_value(stats: Any, objective: str) -> float | None:
    key = BACKTESTING_OBJECTIVE_KEYS.get((objective or "").strip().lower(), objective)
    value = stats.get(key)
    if value is None and key != objective:
        value = stats.get(objective)
    try:
        numeric = float(value)
    except Exception:
        return None
    return -abs(numeric) if key == "Max. Drawdown [%]" else numeric


def merge_backtesting_metrics(metrics: dict[str, Any], stats: Any) -> dict[str, Any]:
    merged = dict(metrics or {})
    normalized_keys = {
        "Start": "bt_start",
        "End": "bt_end",
        "Duration": "bt_duration",
        "Exposure Time [%]": "bt_exposure_time_pct",
        "Equity Final [$]": "bt_equity_final",
        "Equity Peak [$]": "bt_equity_peak",
        "Return [%]": "bt_return_pct",
        "Buy & Hold Return [%]": "bt_buy_hold_return_pct",
        "Return (Ann.) [%]": "bt_return_ann_pct",
        "Volatility (Ann.) [%]": "bt_volatility_ann_pct",
        "Sharpe Ratio": "bt_sharpe_ratio",
        "Sortino Ratio": "bt_sortino_ratio",
        "Calmar Ratio": "bt_calmar_ratio",
        "Max. Drawdown [%]": "bt_max_drawdown_pct",
        "Avg. Drawdown [%]": "bt_avg_drawdown_pct",
        "Max. Drawdown Duration": "bt_max_drawdown_duration",
        "Avg. Drawdown Duration": "bt_avg_drawdown_duration",
        "# Trades": "bt_trades",
        "Win Rate [%]": "bt_win_rate_pct",
        "Best Trade [%]": "bt_best_trade_pct",
        "Worst Trade [%]": "bt_worst_trade_pct",
        "Avg. Trade [%]": "bt_avg_trade_pct",
        "Max. Trade Duration": "bt_max_trade_duration",
        "Avg. Trade Duration": "bt_avg_trade_duration",
        "Profit Factor": "bt_profit_factor",
        "Expectancy [%]": "bt_expectancy_pct",
        "SQN": "bt_sqn",
        "Kelly Criterion": "bt_kelly_criterion",
    }
    for source_key, target_key in normalized_keys.items():
        if source_key in stats:
            merged[target_key] = to_jsonable_metric_value(stats.get(source_key))
    return merged


def to_jsonable_metric_value(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    if hasattr(value, "total_seconds"):
        try:
            return str(value)
        except Exception:
            pass
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    return value


def constraint_params_to_dict(params: Any) -> dict[str, Any]:
    if isinstance(params, dict):
        return dict(params)
    names = getattr(params, "_fields", None)
    if names:
        return {name: getattr(params, name) for name in names}
    raw = vars(params) if hasattr(params, "__dict__") else {}
    values = {key: value for key, value in raw.items() if not key.startswith("_")}
    for key in dir(params):
        if key.startswith("_") or key in values:
            continue
        try:
            value = getattr(params, key)
        except Exception:
            continue
        if not callable(value):
            values[key] = value
    return values


def build_parameter_sensitivity(runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not runs:
        return []
    param_names = sorted({key for run in runs for key in (run.get("params") or {}).keys()})
    rows = []
    for name in param_names:
        grouped: dict[Any, list[float]] = {}
        for run in runs:
            score = run.get("score")
            if score is None:
                continue
            grouped.setdefault((run.get("params") or {}).get(name), []).append(float(score))
        averages = [sum(values) / len(values) for values in grouped.values() if values]
        spread = max(averages) - min(averages) if len(averages) > 1 else 0
        rows.append({"parameter": name, "importance": round(spread, 4)})
    max_spread = max([row["importance"] for row in rows], default=0)
    for row in rows:
        row["importance_pct"] = round((row["importance"] / max_spread) * 100, 2) if max_spread else 0
    return sorted(rows, key=lambda item: item["importance_pct"], reverse=True)


def build_walk_forward_placeholder(runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    best = runs[0] if runs else {}
    metrics = best.get("metrics") or {}
    return [
        {
            "window": "Full sample",
            "return_pct": metrics.get("return_pct"),
            "params": best.get("params") or {},
            "stability": 100 if runs else 0,
        }
    ]


CONSTRAINT_PATTERN = re.compile(r"^\s*([A-Za-z_]\w*)\s*(<=|>=|==|!=|<|>)\s*([A-Za-z_]\w*|-?\d+(?:\.\d+)?)\s*$")
CONSTRAINT_OPERATORS = {
    "<": operator.lt,
    "<=": operator.le,
    ">": operator.gt,
    ">=": operator.ge,
    "==": operator.eq,
    "!=": operator.ne,
}


def parse_constraints(raw_constraints: Any) -> list[dict[str, Any]]:
    if raw_constraints is None:
        return []
    if not isinstance(raw_constraints, list):
        raise ValueError("_constraints must be an array of expressions.")

    parsed = []
    for raw in raw_constraints:
        expression = str(raw).strip()
        match = CONSTRAINT_PATTERN.match(expression)
        if not match:
            raise ValueError(f"Unsupported constraint expression: {expression}")
        left, op, right = match.groups()
        parsed.append(
            {
                "expression": expression,
                "left": left,
                "operator": op,
                "right": right,
            }
        )
    return parsed


def evaluate_constraint(rule: dict[str, Any], params: dict[str, Any]) -> bool:
    left = resolve_constraint_operand(rule["left"], params)
    right = resolve_constraint_operand(rule["right"], params)
    comparator = CONSTRAINT_OPERATORS[rule["operator"]]
    return comparator(left, right)


def resolve_constraint_operand(token: str, params: dict[str, Any]) -> Any:
    if token in params:
        return params[token]
    if "." in token:
        return float(token)
    if token.lstrip("-").isdigit():
        return int(token)
    raise ValueError(f"Constraint token '{token}' does not exist in the parameter grid.")
