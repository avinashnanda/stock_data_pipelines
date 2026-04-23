"""Hedge-fund API route handlers: agents, models, run/backtest SSE, settings CRUD."""

from __future__ import annotations

import json
import os
import queue
import threading
import urllib.request
from http import HTTPStatus
from typing import Any

from .utils import sanitize_json_value

# Hedge fund DB imports (lazy-loaded where possible to avoid import errors if deps missing)
try:
    from hedge_fund_db import (
        save_api_key as hf_save_api_key,
        get_all_api_keys as hf_get_all_api_keys,
        get_all_api_keys_masked as hf_get_all_api_keys_masked,
        delete_api_key as hf_delete_api_key,
        save_endpoint as hf_save_endpoint,
        get_all_endpoints as hf_get_all_endpoints,
        get_endpoint as hf_get_endpoint,
        delete_endpoint as hf_delete_endpoint,
        save_custom_model as hf_save_custom_model,
        get_custom_models as hf_get_custom_models,
        delete_custom_model as hf_delete_custom_model,
    )
    _HF_DB_AVAILABLE = True
except ImportError:
    _HF_DB_AVAILABLE = False


def handle_agents(handler) -> None:
    try:
        from src.utils.analysts import get_agents_list
        handler._send_json({"agents": get_agents_list()})
    except ImportError as ie:
        handler._send_json({"error": f"Hedge fund module not available: {ie}"}, status=HTTPStatus.SERVICE_UNAVAILABLE)


def handle_models(handler) -> None:
    models = []
    try:
        from src.llm.models import get_models_list
        models.extend(get_models_list())
    except ImportError:
        pass
    # Probe Ollama
    try:
        req = urllib.request.Request("http://localhost:11434/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read())
            for m in data.get("models", []):
                models.append({"display_name": f"[Ollama] {m['name']}",
                               "model_name": m["name"], "provider": "Ollama"})
    except Exception:
        pass
    # Probe LMStudio
    try:
        lms_url = "http://localhost:1234/v1/models"
        if _HF_DB_AVAILABLE:
            endpoints = hf_get_all_endpoints()
            for ep in endpoints:
                if ep["provider_type"] == "lmstudio":
                    lms_url = ep["base_url"].rstrip("/") + "/models"
                    break
        with urllib.request.urlopen(lms_url, timeout=2) as resp:
            data = json.loads(resp.read())
            for m in data.get("data", []):
                models.append({"display_name": f"[LMStudio] {m['id']}",
                               "model_name": m["id"], "provider": "LMStudio"})
    except Exception:
        pass
    # Custom endpoints
    if _HF_DB_AVAILABLE:
        for cm in hf_get_custom_models():
            models.append({"display_name": cm["display_name"],
                           "model_name": cm["model_name"],
                           "provider": cm["provider"]})
    handler._send_json({"models": models})


def handle_run(handler) -> None:
    """Run hedge fund analysis with SSE streaming progress."""
    body = handler._read_json_body()
    tickers = body.get("tickers", [])
    selected_analysts = body.get("selected_analysts", [])
    model_name = body.get("model_name", "gpt-4.1")
    model_provider = body.get("model_provider", "OpenAI")
    start_date = body.get("start_date", "")
    end_date = body.get("end_date", "")
    initial_cash = float(body.get("initial_cash", 100000))

    if not tickers:
        handler._send_json({"error": "No tickers provided"}, status=HTTPStatus.BAD_REQUEST)
        return

    # Set up SSE response headers
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()

    handler._send_sse("start", {"type": "start"})

    q = queue.Queue()
    result_holder = [None]
    error_holder = [None]

    def progress_handler(agent_name, ticker, status, analysis, timestamp):
        q.put({"type": "progress", "agent": agent_name, "ticker": ticker,
                "status": status, "analysis": analysis, "timestamp": timestamp})

    def run_graph_thread():
        try:
            from src.services import run_hedge_fund, progress
            progress.register_handler(progress_handler)

            # Hydrate API keys
            api_keys = body.get("api_keys", {})
            if _HF_DB_AVAILABLE and not api_keys:
                api_keys = hf_get_all_api_keys()
            # Set env vars for LLM providers
            for k, v in api_keys.items():
                os.environ[k] = v

            # Initial portfolio state
            portfolio = {
                "cash": initial_cash,
                "margin_requirement": 0.0,
                "margin_used": 0.0,
                "positions": {t: {"long": 0, "short": 0, "long_cost_basis": 0.0, "short_cost_basis": 0.0, "short_margin_used": 0.0} for t in tickers},
                "realized_gains": {t: {"long": 0.0, "short": 0.0} for t in tickers}
            }

            result = run_hedge_fund(
                tickers=tickers,
                start_date=start_date,
                end_date=end_date,
                portfolio=portfolio,
                show_reasoning=True,
                selected_analysts=selected_analysts,
                model_name=model_name,
                model_provider=model_provider,
            )
            progress.unregister_handler(progress_handler)
            result_holder[0] = result
        except Exception as e:
            error_holder[0] = str(e)
            import traceback
            traceback.print_exc()

    thread = threading.Thread(target=run_graph_thread, daemon=True)
    thread.start()

    # Stream progress events
    while thread.is_alive() or not q.empty():
        try:
            event = q.get(timeout=1.0)
            handler._send_sse("progress", event)
        except Exception:
            pass

    # Drain remaining events
    while not q.empty():
        try:
            event = q.get_nowait()
            handler._send_sse("progress", event)
        except Exception:
            break

    if error_holder[0]:
        handler._send_sse("error", {"type": "error", "message": error_holder[0]})
        return

    result = result_holder[0]
    if not result or not result.get("messages"):
        handler._send_sse("error", {"type": "error", "message": "No results generated"})
        return

    try:
        from src.services import parse_hedge_fund_response
        decisions = parse_hedge_fund_response(result["messages"][-1])
        handler._send_sse("complete", {
            "type": "complete",
            "data": {
                "decisions": decisions,
                "analyst_signals": result.get("data", {}).get("analyst_signals", {}),
                "current_prices": result.get("data", {}).get("current_prices", {}),
            }
        })
    except Exception as e:
        handler._send_sse("error", {"type": "error", "message": f"Failed to parse results: {e}"})


def handle_backtest(handler) -> None:
    """Run hedge fund backtest with SSE streaming progress."""
    body = handler._read_json_body()
    tickers = body.get("tickers", [])
    selected_analysts = body.get("selected_analysts", [])
    model_name = body.get("model_name", "gpt-4.1")
    model_provider = body.get("model_provider", "OpenAI")
    start_date = body.get("start_date", "")
    end_date = body.get("end_date", "")
    initial_capital = float(body.get("initial_capital", 100000))

    if not tickers:
        handler._send_json({"error": "No tickers provided"}, status=HTTPStatus.BAD_REQUEST)
        return

    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()

    handler._send_sse("start", {"type": "start"})

    q = queue.Queue()
    result_holder = [None]
    error_holder = [None]

    def progress_handler(agent_name, ticker, status, analysis, timestamp):
        q.put({"type": "progress", "agent": agent_name, "ticker": ticker,
                "status": status, "analysis": analysis, "timestamp": timestamp})

    def backtest_thread():
        try:
            from src.services import BacktestService, progress, sanitize_json_value
            progress.register_handler(progress_handler)

            api_keys = body.get("api_keys", {})
            if _HF_DB_AVAILABLE and not api_keys:
                api_keys = hf_get_all_api_keys()
            for k, v in api_keys.items():
                os.environ[k] = v

            backtest_service = BacktestService(
                tickers=tickers,
                start_date=start_date,
                end_date=end_date,
                initial_capital=initial_capital,
                model_name=model_name,
                model_provider=model_provider,
                selected_analysts=selected_analysts,
            )

            import asyncio
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

            result = loop.run_until_complete(backtest_service.run_backtest_async())
            loop.close()
            progress.unregister_handler(progress_handler)
            result_holder[0] = result
        except Exception as e:
            error_holder[0] = str(e)
            import traceback
            traceback.print_exc()

    thread = threading.Thread(target=backtest_thread, daemon=True)
    thread.start()

    while thread.is_alive() or not q.empty():
        try:
            event = q.get(timeout=1.0)
            handler._send_sse("progress", event)
        except Exception:
            pass

    while not q.empty():
        try:
            event = q.get_nowait()
            handler._send_sse("progress", event)
        except Exception:
            break

    if error_holder[0]:
        handler._send_sse("error", {"type": "error", "message": error_holder[0]})
        return

    result = result_holder[0]
    if not result:
        handler._send_sse("error", {"type": "error", "message": "Backtest failed"})
        return

    handler._send_sse("complete", {
        "type": "complete",
        "data": {
            "performance_metrics": result.get("metrics", {}),
            "portfolio_values": result.get("portfolio_values", []),
        }
    })


# ── API Keys CRUD ────────────────────────────────────────────────────────────

def handle_api_keys(handler, method: str) -> None:
    if not _HF_DB_AVAILABLE:
        handler._send_json({"error": "Hedge fund DB not available"}, status=HTTPStatus.SERVICE_UNAVAILABLE)
        return
    if method == "GET":
        handler._send_json({"keys": hf_get_all_api_keys_masked()})
    elif method == "POST":
        body = handler._read_json_body()
        hf_save_api_key(body["provider"], body["key_value"])
        handler._send_json({"ok": True})
    else:
        handler.send_error(HTTPStatus.METHOD_NOT_ALLOWED)


def handle_api_key_delete(handler, provider: str, method: str) -> None:
    if not _HF_DB_AVAILABLE:
        handler._send_json({"error": "Hedge fund DB not available"}, status=HTTPStatus.SERVICE_UNAVAILABLE)
        return
    if method == "DELETE":
        deleted = hf_delete_api_key(provider)
        handler._send_json({"deleted": deleted})
    else:
        handler.send_error(HTTPStatus.METHOD_NOT_ALLOWED)


# ── Ollama management ────────────────────────────────────────────────────────

def handle_ollama_status(handler) -> None:
    status_info = {"running": False, "models": []}
    try:
        with urllib.request.urlopen("http://localhost:11434/api/tags", timeout=3) as resp:
            data = json.loads(resp.read())
            status_info["running"] = True
            status_info["models"] = [
                {"name": m["name"], "size": m.get("size", 0),
                 "modified": m.get("modified_at", "")}
                for m in data.get("models", [])
            ]
    except Exception:
        pass
    handler._send_json(status_info)


def handle_ollama_pull(handler, method: str) -> None:
    body = handler._read_json_body()
    model_name = body.get("model", "")
    if not model_name:
        handler._send_json({"error": "model name required"}, status=HTTPStatus.BAD_REQUEST)
        return
    try:
        import subprocess
        subprocess.Popen(["ollama", "pull", model_name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        handler._send_json({"ok": True, "message": f"Pulling {model_name}"})
    except Exception as e:
        handler._send_json({"error": str(e)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)


# ── Endpoints CRUD ───────────────────────────────────────────────────────────

def handle_endpoints(handler, method: str) -> None:
    if not _HF_DB_AVAILABLE:
        handler._send_json({"error": "Hedge fund DB not available"}, status=HTTPStatus.SERVICE_UNAVAILABLE)
        return
    if method == "GET":
        handler._send_json({"endpoints": hf_get_all_endpoints()})
    elif method == "POST":
        body = handler._read_json_body()
        eid = hf_save_endpoint(
            body.get("id"), body["label"], body["base_url"],
            body["provider_type"], body.get("api_key", ""))
        handler._send_json({"ok": True, "id": eid})
    else:
        handler.send_error(HTTPStatus.METHOD_NOT_ALLOWED)


def handle_endpoint_test(handler, endpoint_id: str) -> None:
    ep = hf_get_endpoint(endpoint_id) if _HF_DB_AVAILABLE else None
    if not ep:
        handler._send_json({"error": "Endpoint not found"}, status=HTTPStatus.NOT_FOUND)
        return
    try:
        test_url = ep["base_url"].rstrip("/") + "/models"
        with urllib.request.urlopen(test_url, timeout=5) as resp:
            data = json.loads(resp.read())
            model_count = len(data.get("data", data.get("models", [])))
            handler._send_json({"ok": True, "models_found": model_count})
    except Exception as e:
        handler._send_json({"ok": False, "error": str(e)})


def handle_endpoint_delete(handler, endpoint_id: str, method: str) -> None:
    if not _HF_DB_AVAILABLE:
        handler._send_json({"error": "Hedge fund DB not available"}, status=HTTPStatus.SERVICE_UNAVAILABLE)
        return
    if method == "DELETE":
        deleted = hf_delete_endpoint(endpoint_id)
        handler._send_json({"deleted": deleted})
    else:
        handler.send_error(HTTPStatus.METHOD_NOT_ALLOWED)


# ── Custom Models CRUD ───────────────────────────────────────────────────────

def handle_custom_models(handler, method: str) -> None:
    if not _HF_DB_AVAILABLE:
        handler._send_json({"error": "Hedge fund DB not available"}, status=HTTPStatus.SERVICE_UNAVAILABLE)
        return
    if method == "GET":
        handler._send_json({"models": hf_get_custom_models()})
    elif method == "POST":
        body = handler._read_json_body()
        mid = hf_save_custom_model(
            body["endpoint_id"], body["display_name"],
            body["model_name"], body["provider"])
        handler._send_json({"ok": True, "id": mid})
    else:
        handler.send_error(HTTPStatus.METHOD_NOT_ALLOWED)


def handle_custom_model_delete(handler, model_id: str, method: str) -> None:
    if not _HF_DB_AVAILABLE:
        handler._send_json({"error": "Hedge fund DB not available"}, status=HTTPStatus.SERVICE_UNAVAILABLE)
        return
    if method == "DELETE":
        deleted = hf_delete_custom_model(model_id)
        handler._send_json({"deleted": deleted})
    else:
        handler.send_error(HTTPStatus.METHOD_NOT_ALLOWED)
