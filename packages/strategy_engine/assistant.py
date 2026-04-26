from __future__ import annotations

import json
from contextlib import contextmanager
from typing import Any

try:
    from packages.hedge_fund_engine.hedge_fund_db import get_custom_models
except Exception:  # pragma: no cover - fallback when hedge-fund package is unavailable
    get_custom_models = None

try:
    from packages.hedge_fund_engine.src.llm.models import ModelProvider, get_model as get_hedge_fund_model
except Exception:  # pragma: no cover - fallback when hedge-fund package is unavailable
    ModelProvider = None
    get_hedge_fund_model = None


@contextmanager
def _temporary_env(updates: dict[str, str]):
    import os

    previous: dict[str, str | None] = {key: os.environ.get(key) for key in updates}
    try:
        for key, value in updates.items():
            os.environ[key] = value
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def generate_strategy_from_prompt(prompt: str, model: dict[str, Any] | None = None) -> dict[str, Any]:
    idea = (prompt or "").strip()
    if not idea:
        raise ValueError("A strategy idea is required.")

    generated = None
    if model:
        try:
            generated = _generate_strategy_with_model(idea, model)
        except Exception:
            generated = None
    if generated:
        return generated

    lowered = idea.lower()
    if "rsi" in lowered:
        return _build_rsi_strategy(idea)
    if "breakout" in lowered or "range" in lowered or "channel" in lowered:
        return _build_breakout_strategy(idea)
    if "ema" in lowered:
        return _build_ma_crossover_strategy(idea, ma_kind="ema")
    return _build_ma_crossover_strategy(idea, ma_kind="sma")


def _generate_strategy_with_model(prompt: str, model: dict[str, Any]) -> dict[str, Any] | None:
    if get_hedge_fund_model is None:
        return None

    model_name = str(model.get("model_name", "")).strip()
    provider = str(model.get("provider", "")).strip()
    if not model_name or not provider:
        return None

    api_keys: dict[str, str] = {}
    temp_env: dict[str, str] = {}
    base_url = str(model.get("base_url", "")).strip()
    api_key = str(model.get("api_key", "")).strip()
    endpoint_id = str(model.get("endpoint_id", "")).strip()

    if provider in {"Custom", "CUSTOM"}:
        if not (base_url and api_key):
            if get_custom_models is not None:
                for item in get_custom_models():
                    if str(item.get("id", "")) == endpoint_id or (
                        str(item.get("model_name", "")) == model_name and str(item.get("provider", "")) == provider
                    ):
                        base_url = str(item.get("base_url", "")).strip()
                        api_key = str(item.get("api_key", "")).strip()
                        break
        if base_url:
            api_keys[f"CUSTOM_BASE_URL_{model_name}"] = base_url
        if api_key:
            api_keys[f"CUSTOM_API_KEY_{model_name}"] = api_key
    elif provider in {"LMStudio", "LMSTUDIO"}:
        if base_url:
            api_keys["LMSTUDIO_BASE_URL"] = base_url
    elif provider == "OpenAI" and base_url:
        temp_env["OPENAI_API_BASE"] = base_url
    elif provider == "Ollama":
        if base_url:
            temp_env["OLLAMA_BASE_URL"] = base_url.rstrip("/v1")

    try:
        with _temporary_env(temp_env):
            llm = get_hedge_fund_model(model_name, _resolve_model_provider(provider), api_keys or None)
            if llm is None:
                return None

            response = llm.invoke(
                _build_generation_prompt(prompt)
            )
            content = getattr(response, "content", response)
            parsed = _extract_json_payload(str(content))
            if not isinstance(parsed, dict):
                return None
            strategy_code = str(parsed.get("strategy_code", "")).strip()
            if not strategy_code:
                return None
            return {
                "name": str(parsed.get("name", "Generated Strategy")),
                "description": str(parsed.get("description", f"Generated from: {prompt}")),
                "tags": parsed.get("tags") if isinstance(parsed.get("tags"), list) else ["generated"],
                "params": parsed.get("params") if isinstance(parsed.get("params"), dict) else {},
                "strategy_code": strategy_code,
                "notes": parsed.get("notes") if isinstance(parsed.get("notes"), list) else [],
                "llm": {
                    "model_name": model_name,
                    "provider": provider,
                },
            }
    except Exception:
        return None


def _resolve_model_provider(provider: str) -> Any:
    if ModelProvider is None:
        return provider
    try:
        return ModelProvider(provider)
    except Exception:
        return provider


def _build_generation_prompt(prompt: str) -> str:
    return (
        "You are generating a single self-contained Python strategy for the Strategy Lab.\n"
        "Return JSON only with keys: name, description, tags, params, strategy_code, notes.\n"
        "The code must define exactly one class that inherits from backtesting.Strategy.\n"
        "Use self.position.close() to exit existing positions instead of opening the opposite side by default.\n"
        "Expose optimizable parameters as class attributes.\n"
        "Default to a long-only strategy unless the prompt explicitly asks for shorting.\n"
        "Allowed imports include backtesting, backtesting.lib, pandas, numpy, math, and statistics.\n"
        "Prompt:\n"
        f"{prompt}"
    )


def _extract_json_payload(text: str) -> dict[str, Any] | None:
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if "\n" in raw:
            raw = raw.split("\n", 1)[1]
    try:
        return json.loads(raw)
    except Exception:
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(raw[start : end + 1])
            except Exception:
                return None
    return None


def _build_ma_crossover_strategy(idea: str, *, ma_kind: str) -> dict[str, Any]:
    fast_key = f"{ma_kind}_fast"
    slow_key = f"{ma_kind}_slow"
    indicator_fn = "EMA" if ma_kind == "ema" else "SMA"
    helper = (
        "def EMA(values, length):\n"
        "    return pd.Series(values).ewm(span=length, adjust=False).mean()\n"
        if ma_kind == "ema"
        else
        "def SMA(values, length):\n"
        "    return pd.Series(values).rolling(length).mean()\n"
    )
    strategy_code = f"""from backtesting import Strategy
from backtesting.lib import crossover
import pandas as pd


{helper}

class {ma_kind.upper()}Cross(Strategy):
    fast_length = 10
    slow_length = 30

    def init(self):
        self.{fast_key} = self.I({indicator_fn}, self.data.Close, self.fast_length)
        self.{slow_key} = self.I({indicator_fn}, self.data.Close, self.slow_length)

    def next(self):
        if crossover(self.{fast_key}, self.{slow_key}):
            self.buy()
        elif crossover(self.{slow_key}, self.{fast_key}):
            self.position.close()
"""
    title = f"{ma_kind.upper()} crossover"
    return {
        "name": f"{title} Strategy",
        "description": f"Generated from: {idea}",
        "tags": [ma_kind, "trend", "generated"],
        "params": {
            "fast_length": 10,
            "slow_length": 30,
        },
        "strategy_code": strategy_code,
        "notes": [
            f"Generated a {title} trend-following strategy from your prompt.",
            "You can refine the lengths, add filters, or extend exits in the editor.",
        ],
    }


def _build_rsi_strategy(idea: str) -> dict[str, Any]:
    strategy_code = """from backtesting import Strategy
import pandas as pd


def RSI(values, length):
    close = pd.Series(values)
    delta = close.diff()
    gains = delta.clip(lower=0).rolling(length).mean()
    losses = (-delta.clip(upper=0)).rolling(length).mean()
    rs = gains / losses.replace(0, float("nan"))
    return 100 - (100 / (1 + rs))


class RsiReversion(Strategy):
    rsi_length = 14
    oversold = 30
    overbought = 70

    def init(self):
        self.rsi = self.I(RSI, self.data.Close, self.rsi_length)

    def next(self):
        if self.rsi[-1] <= self.oversold:
            self.buy()
        elif self.rsi[-1] >= self.overbought:
            self.position.close()
"""
    return {
        "name": "RSI Reversion Strategy",
        "description": f"Generated from: {idea}",
        "tags": ["rsi", "mean-reversion", "generated"],
        "params": {
            "rsi_length": 14,
            "oversold": 30,
            "overbought": 70,
        },
        "strategy_code": strategy_code,
        "notes": [
            "Generated an RSI mean-reversion template.",
            "This is a simple one-position implementation and can be expanded with trend or volatility filters.",
        ],
    }


def _build_breakout_strategy(idea: str) -> dict[str, Any]:
    strategy_code = """from backtesting import Strategy
import pandas as pd


def ROLLING_HIGH(values, length):
    return pd.Series(values).rolling(length).max()


def ROLLING_LOW(values, length):
    return pd.Series(values).rolling(length).min()


class BreakoutStrategy(Strategy):
    lookback = 20

    def init(self):
        self.breakout_high = self.I(ROLLING_HIGH, self.data.High, self.lookback)
        self.breakout_low = self.I(ROLLING_LOW, self.data.Low, self.lookback)

    def next(self):
        if self.data.Close[-1] > self.breakout_high[-2]:
            self.buy()
        elif self.data.Close[-1] < self.breakout_low[-2]:
            self.position.close()
"""
    return {
        "name": "Breakout Strategy",
        "description": f"Generated from: {idea}",
        "tags": ["breakout", "momentum", "generated"],
        "params": {
            "lookback": 20,
        },
        "strategy_code": strategy_code,
        "notes": [
            "Generated a simple price breakout strategy.",
            "Consider adding stop loss, volume confirmation, or regime filters before using it seriously.",
        ],
    }
