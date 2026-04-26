"""Strategy Lab routes for local strategy CRUD and backtest scaffolding."""

from __future__ import annotations

from datetime import datetime, timezone
from http import HTTPStatus
import traceback
import threading
from uuid import uuid4

from apps.web_app.server.utils import sanitize_json_value
from packages.strategy_engine.assistant import generate_strategy_from_prompt
from packages.strategy_engine.export import export_backtest_result
from packages.strategy_engine.live import PaperTradingManager
from packages.strategy_engine.runner import BacktestRunRequest, StrategyRunner
from packages.strategy_engine.storage import (
    create_backtest_run,
    create_optimization_job,
    create_or_update_paper_session,
    create_strategy,
    delete_strategy,
    delete_backtest_run,
    get_backtest_run,
    get_paper_session,
    get_strategy,
    get_optimization_job,
    list_backtest_runs,
    list_paper_sessions,
    list_strategies,
    update_optimization_job,
    update_strategy,
)

_PAPER_MANAGER = PaperTradingManager()
_OPTIMIZATION_JOBS: dict[str, dict] = {}
_OPTIMIZATION_JOBS_LOCK = threading.Lock()


def handle_strategies(handler, method: str) -> None:
    if method == "GET":
        handler._send_json({"items": list_strategies()})
        return

    if method == "POST":
        body = handler._read_json_body()
        item = create_strategy(_normalize_strategy_payload(body))
        handler._send_json({"item": item}, status=HTTPStatus.CREATED)
        return

    handler.send_error(HTTPStatus.METHOD_NOT_ALLOWED)


def handle_strategy_detail(handler, strategy_id: str, method: str) -> None:
    if not strategy_id:
        handler._send_json({"error": "Strategy id is required."}, status=HTTPStatus.BAD_REQUEST)
        return

    if method == "GET":
        item = get_strategy(strategy_id)
        if item is None:
            handler._send_json({"error": "Strategy not found."}, status=HTTPStatus.NOT_FOUND)
            return
        handler._send_json({"item": item})
        return

    if method == "PUT":
        body = handler._read_json_body()
        item = update_strategy(strategy_id, _normalize_strategy_payload(body))
        if item is None:
            handler._send_json({"error": "Strategy not found."}, status=HTTPStatus.NOT_FOUND)
            return
        handler._send_json({"item": item})
        return

    if method == "DELETE":
        deleted = delete_strategy(strategy_id)
        if not deleted:
            handler._send_json({"error": "Strategy not found."}, status=HTTPStatus.NOT_FOUND)
            return
        handler._send_json({"deleted": True})
        return

    handler.send_error(HTTPStatus.METHOD_NOT_ALLOWED)


def handle_strategy_generate(handler) -> None:
    body = handler._read_json_body()
    prompt = str(body.get("prompt", "")).strip()
    model = body.get("model") if isinstance(body.get("model"), dict) else None
    generated = generate_strategy_from_prompt(prompt, model=model)
    handler._send_json({"item": sanitize_json_value(generated)})


def handle_backtest_run(handler) -> None:
    body = handler._read_json_body()
    strategy_code = str(body.get("strategy_code", "")).strip()
    symbol = str(body.get("symbol", "")).strip()
    timeframe = str(body.get("timeframe", "")).strip()
    start_date = str(body.get("start_date", "")).strip()
    end_date = str(body.get("end_date", "")).strip()

    if not strategy_code:
        handler._send_json({"error": "strategy_code is required"}, status=HTTPStatus.BAD_REQUEST)
        return
    if not symbol or not timeframe or not start_date or not end_date:
        handler._send_json({"error": "symbol, timeframe, start_date, and end_date are required"}, status=HTTPStatus.BAD_REQUEST)
        return

    params = body.get("params") or {}
    if not isinstance(params, dict):
        handler._send_json({"error": "params must be an object"}, status=HTTPStatus.BAD_REQUEST)
        return

    initial_cash = float(body.get("initial_cash", 100000))
    commission = float(body.get("commission", 0))
    runner = StrategyRunner()
    run_id = f"bt_{uuid4().hex[:10]}"
    run_engine = str(body.get("engine", "auto")).strip() or "auto"

    try:
        result = runner.run(
            BacktestRunRequest(
                symbol=symbol,
                timeframe=timeframe,
                start_date=start_date,
                end_date=end_date,
                strategy_code=strategy_code,
                params=params,
                initial_cash=initial_cash,
                commission=commission,
                engine=run_engine,
            )
        )
    except Exception as exc:
        handler._send_json(
            {
                "error": str(exc),
                "traceback": traceback.format_exc(),
            },
            status=HTTPStatus.BAD_REQUEST,
        )
        return

    saved_run = create_backtest_run(
        {
            "run_id": run_id,
            "strategy_id": str(body.get("strategy_id", "")).strip() or None,
            "strategy_name": str(body.get("strategy_name", "")).strip() or "Current Draft",
            "symbol": symbol,
            "timeframe": timeframe,
            "start_date": start_date,
            "end_date": end_date,
            "result": result,
        }
    )
    handler._send_json(
        {
            "run_id": run_id,
            "status": "completed",
            "history_item": saved_run,
            **sanitize_json_value(result),
        }
    )


def handle_backtests(handler, method: str) -> None:
    if method != "GET":
        handler.send_error(HTTPStatus.METHOD_NOT_ALLOWED)
        return
    handler._send_json({"items": list_backtest_runs()})


def handle_capabilities(handler, method: str) -> None:
    if method != "GET":
        handler.send_error(HTTPStatus.METHOD_NOT_ALLOWED)
        return
    runner = StrategyRunner()
    handler._send_json(
        {
            "capabilities": runner.capabilities(),
            "paper_sessions": list_paper_sessions(),
        }
    )


def handle_backtest_detail(handler, run_id: str, method: str) -> None:
    if method == "DELETE":
        deleted = delete_backtest_run(run_id)
        if not deleted:
            handler._send_json({"error": "Backtest run not found."}, status=HTTPStatus.NOT_FOUND)
            return
        handler._send_json({"deleted": True})
        return

    if method != "GET":
        handler.send_error(HTTPStatus.METHOD_NOT_ALLOWED)
        return
    item = get_backtest_run(run_id)
    if item is None:
        handler._send_json({"error": "Backtest run not found."}, status=HTTPStatus.NOT_FOUND)
        return
    handler._send_json({"item": item})


def handle_backtest_compare(handler) -> None:
    body = handler._read_json_body()
    symbol = str(body.get("symbol", "")).strip()
    timeframe = str(body.get("timeframe", "")).strip()
    start_date = str(body.get("start_date", "")).strip()
    end_date = str(body.get("end_date", "")).strip()
    if not symbol or not timeframe or not start_date or not end_date:
        handler._send_json({"error": "symbol, timeframe, start_date, and end_date are required"}, status=HTTPStatus.BAD_REQUEST)
        return

    raw_strategies = body.get("strategies") or []
    strategies: list[dict] = []
    for strategy in raw_strategies:
        strategy_id = str(strategy.get("strategy_id", "")).strip()
        if strategy_id:
            saved = get_strategy(strategy_id)
            if saved is None:
                handler._send_json({"error": f"Strategy not found: {strategy_id}"}, status=HTTPStatus.NOT_FOUND)
                return
            strategies.append(
                {
                    "id": saved["id"],
                    "name": saved["name"],
                    "code": saved["code"],
                    "params": strategy.get("params") or saved.get("parameter_schema") or {},
                }
            )
            continue

        code = str(strategy.get("strategy_code", "")).strip()
        if not code:
            continue
        strategies.append(
            {
                "id": strategy.get("id"),
                "name": strategy.get("name", "Current Draft"),
                "code": code,
                "params": strategy.get("params") or {},
            }
        )

    if not strategies:
        handler._send_json({"error": "At least one strategy is required for comparison."}, status=HTTPStatus.BAD_REQUEST)
        return

    initial_cash = float(body.get("initial_cash", 100000))
    commission = float(body.get("commission", 0))
    engine = str(body.get("engine", "auto")).strip() or "auto"
    runner = StrategyRunner()
    try:
        result = runner.compare(
            strategies=strategies,
            symbol=symbol,
            timeframe=timeframe,
            start_date=start_date,
            end_date=end_date,
            initial_cash=initial_cash,
            commission=commission,
            engine=engine,
        )
    except Exception as exc:
        handler._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
        return

    handler._send_json(
        {
            "comparison_id": f"cmp_{uuid4().hex[:10]}",
            "status": "completed",
            **sanitize_json_value(result),
        }
    )


def handle_backtest_optimize(handler) -> None:
    body = handler._read_json_body()
    strategy_code = str(body.get("strategy_code", "")).strip()
    symbol = str(body.get("symbol", "")).strip()
    timeframe = str(body.get("timeframe", "")).strip()
    start_date = str(body.get("start_date", "")).strip()
    end_date = str(body.get("end_date", "")).strip()
    parameter_grid = body.get("parameter_grid") or {}
    objective = str(body.get("objective", "sharpe")).strip() or "sharpe"
    engine = str(body.get("engine", "auto")).strip() or "auto"
    optimization_config = body.get("optimization_config") or {}

    if not strategy_code:
        handler._send_json({"error": "strategy_code is required"}, status=HTTPStatus.BAD_REQUEST)
        return
    if not symbol or not timeframe or not start_date or not end_date:
        handler._send_json({"error": "symbol, timeframe, start_date, and end_date are required"}, status=HTTPStatus.BAD_REQUEST)
        return
    if not isinstance(parameter_grid, dict):
        handler._send_json({"error": "parameter_grid must be an object"}, status=HTTPStatus.BAD_REQUEST)
        return

    initial_cash = float(body.get("initial_cash", 100000))
    commission = float(body.get("commission", 0))
    job_id = f"opt_{uuid4().hex[:10]}"
    initial_job = {
        "job_id": job_id,
        "status": "queued",
        "progress": {
            "completed": 0,
            "total": 0,
            "percent": 0,
        },
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "result": None,
        "error": None,
    }
    _remember_optimization_job(initial_job)
    try:
        create_optimization_job(job_id, initial_job)
    except Exception:
        # Keep the live job in memory even if DuckDB is temporarily locked.
        pass

    thread = threading.Thread(
        target=_run_optimization_job,
        kwargs={
            "job_id": job_id,
            "strategy_code": strategy_code,
            "symbol": symbol,
            "timeframe": timeframe,
            "start_date": start_date,
            "end_date": end_date,
            "parameter_grid": parameter_grid,
            "objective": objective,
            "initial_cash": initial_cash,
            "commission": commission,
            "engine": engine,
            "optimization_config": optimization_config if isinstance(optimization_config, dict) else {},
        },
        daemon=True,
    )
    thread.start()
    handler._send_json(
        {
            "optimization_id": job_id,
            "status": "queued",
        }
    )


def handle_backtest_optimize_status(handler, optimization_id: str) -> None:
    job = _get_optimization_job_state(optimization_id)
    if job is None:
        handler._send_json({"error": "Optimization job not found."}, status=HTTPStatus.NOT_FOUND)
        return
    handler._send_json(sanitize_json_value(job))


def handle_backtest_export(handler) -> None:
    body = handler._read_json_body()
    run_id = str(body.get("run_id", "")).strip()
    export_format = str(body.get("format", "json")).strip() or "json"
    if not run_id:
        handler._send_json({"error": "run_id is required."}, status=HTTPStatus.BAD_REQUEST)
        return
    item = get_backtest_run(run_id)
    if item is None:
        handler._send_json({"error": "Backtest run not found."}, status=HTTPStatus.NOT_FOUND)
        return
    exported = export_backtest_result(run_id=run_id, result=item.get("result") or {}, export_format=export_format)
    handler._send_json({"export": exported, "run_id": run_id})


def handle_paper_start(handler) -> None:
    body = handler._read_json_body()
    symbol = str(body.get("symbol", "")).strip()
    if not symbol:
        handler._send_json({"error": "symbol is required."}, status=HTTPStatus.BAD_REQUEST)
        return
    initial_cash = float(body.get("initial_cash", 100000))
    snapshot = _PAPER_MANAGER.start(symbol=symbol, initial_cash=initial_cash)
    create_or_update_paper_session(snapshot)
    handler._send_json({"session": snapshot}, status=HTTPStatus.CREATED)


def handle_paper_list(handler, method: str) -> None:
    if method != "GET":
        handler.send_error(HTTPStatus.METHOD_NOT_ALLOWED)
        return
    handler._send_json({"items": list_paper_sessions()})


def handle_paper_detail(handler, session_id: str, method: str) -> None:
    if method == "GET":
        item = get_paper_session(session_id)
        if item is None:
            handler._send_json({"error": "Paper trading session not found."}, status=HTTPStatus.NOT_FOUND)
            return
        handler._send_json({"session": item})
        return
    if method == "POST":
        persisted = get_paper_session(session_id)
        if persisted is not None:
            _PAPER_MANAGER.restore(persisted)
        snapshot = _PAPER_MANAGER.stop(session_id)
        create_or_update_paper_session(snapshot)
        handler._send_json({"session": snapshot})
        return
    handler.send_error(HTTPStatus.METHOD_NOT_ALLOWED)


def handle_paper_order(handler) -> None:
    body = handler._read_json_body()
    session_id = str(body.get("session_id", "")).strip()
    side = str(body.get("side", "")).strip().upper()
    qty = int(body.get("qty", 0))
    price = float(body.get("price", 0))
    persisted = get_paper_session(session_id)
    if persisted is not None:
        _PAPER_MANAGER.restore(persisted)
    snapshot = _PAPER_MANAGER.place_order(session_id=session_id, side=side, qty=qty, price=price)
    create_or_update_paper_session(snapshot)
    handler._send_json({"session": snapshot})


def _normalize_strategy_payload(body: dict) -> dict:
    tags = body.get("tags") or []
    if isinstance(tags, str):
        tags = [item.strip() for item in tags.split(",") if item.strip()]

    parameter_schema = body.get("parameter_schema") or {}
    if not isinstance(parameter_schema, dict):
        raise ValueError("parameter_schema must be an object")

    return {
        "name": str(body.get("name", "")).strip() or "Untitled Strategy",
        "description": str(body.get("description", "")).strip(),
        "code": str(body.get("code", "")).rstrip(),
        "language": "python",
        "tags": tags,
        "parameter_schema": parameter_schema,
    }


def _run_optimization_job(
    *,
    job_id: str,
    strategy_code: str,
    symbol: str,
    timeframe: str,
    start_date: str,
    end_date: str,
    parameter_grid: dict,
    objective: str,
    initial_cash: float,
    commission: float,
    engine: str,
    optimization_config: dict | None = None,
) -> None:
    runner = StrategyRunner()
    optimization_settings = optimization_config if isinstance(optimization_config, dict) else {}
    _update_optimization_job_state(job_id, {"status": "running", "updated_at": _now_iso()})

    def progress_callback(progress: dict) -> None:
        total = int(progress.get("total") or 0)
        completed = int(progress.get("completed") or 0)
        percent = round((completed / total) * 100, 2) if total > 0 else 0
        _update_optimization_job_state(
            job_id,
            {
                "progress": {
                    "completed": completed,
                    "total": total,
                    "percent": percent,
                    "params": progress.get("params"),
                    "score": progress.get("score"),
                },
                "updated_at": _now_iso(),
            },
            persist=False,
        )

    try:
        result = runner.optimize(
            strategy_code=strategy_code,
            symbol=symbol,
            timeframe=timeframe,
            start_date=start_date,
            end_date=end_date,
            parameter_grid=parameter_grid,
            objective=objective,
            initial_cash=initial_cash,
            commission=commission,
            progress_callback=progress_callback,
            engine=engine,
            optimization_config=optimization_settings,
        )
        _update_optimization_job_state(
            job_id,
            {
                "status": "completed",
                "result": result,
                "updated_at": _now_iso(),
            },
            persist=True,
        )
    except Exception as exc:
        _update_optimization_job_state(
            job_id,
            {
                "status": "failed",
                "error": str(exc),
                "traceback": traceback.format_exc(),
                "updated_at": _now_iso(),
            },
            persist=True,
        )


def _remember_optimization_job(job: dict) -> None:
    with _OPTIMIZATION_JOBS_LOCK:
        _OPTIMIZATION_JOBS[str(job["job_id"])] = dict(job)


def _get_optimization_job_state(job_id: str) -> dict | None:
    with _OPTIMIZATION_JOBS_LOCK:
        job = _OPTIMIZATION_JOBS.get(job_id)
        if job is not None:
            return dict(job)
    try:
        return get_optimization_job(job_id)
    except Exception:
        return None


def _update_optimization_job_state(job_id: str, updates: dict, persist: bool = False) -> dict | None:
    with _OPTIMIZATION_JOBS_LOCK:
        current = _OPTIMIZATION_JOBS.get(job_id, {"job_id": job_id})
        merged = {**current, **updates}
        _OPTIMIZATION_JOBS[job_id] = merged
    if persist:
        try:
            update_optimization_job(job_id, updates)
        except Exception:
            pass
    return dict(merged)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
