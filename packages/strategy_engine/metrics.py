from __future__ import annotations

import math

import pandas as pd


def build_metrics(*, equity_curve: list[dict], trades: list[dict], initial_cash: float) -> dict:
    if not equity_curve:
        return {}

    frame = pd.DataFrame(equity_curve).copy()
    frame["equity"] = frame["equity"].astype(float)
    frame["returns"] = frame["equity"].pct_change().fillna(0.0)

    ending_equity = float(frame["equity"].iloc[-1])
    total_return_pct = ((ending_equity / float(initial_cash)) - 1.0) * 100 if initial_cash else 0.0

    running_max = frame["equity"].cummax()
    drawdowns = ((frame["equity"] / running_max) - 1.0) * 100
    max_drawdown = float(drawdowns.min()) if not drawdowns.empty else 0.0

    sharpe = _annualized_sharpe(frame["returns"])
    sortino = _annualized_sortino(frame["returns"])
    cagr = _cagr(frame["time"], initial_cash, ending_equity)

    wins = [trade for trade in trades if float(trade.get("pnl", 0.0)) > 0]
    losses = [trade for trade in trades if float(trade.get("pnl", 0.0)) < 0]
    gross_profit = sum(float(trade.get("pnl", 0.0)) for trade in wins)
    gross_loss = abs(sum(float(trade.get("pnl", 0.0)) for trade in losses))
    pnl_values = [float(trade.get("pnl", 0.0)) for trade in trades]

    return {
        "cagr": round(cagr, 4),
        "return_pct": round(total_return_pct, 4),
        "max_drawdown": round(max_drawdown, 4),
        "sharpe": round(sharpe, 4) if sharpe is not None else None,
        "sortino": round(sortino, 4) if sortino is not None else None,
        "win_rate": round((len(wins) / len(trades)) * 100, 4) if trades else None,
        "profit_factor": round(gross_profit / gross_loss, 4) if gross_loss > 0 else None,
        "total_trades": len(trades),
        "avg_trade": round(sum(pnl_values) / len(pnl_values), 4) if pnl_values else None,
        "best_trade": round(max(pnl_values), 4) if pnl_values else None,
        "worst_trade": round(min(pnl_values), 4) if pnl_values else None,
        "expectancy": round(((gross_profit / len(wins)) * (len(wins) / len(trades))) - ((gross_loss / len(losses)) * (len(losses) / len(trades))), 4) if trades and wins and losses else None,
        "ending_equity": round(ending_equity, 4),
    }


def build_drawdown_curve(equity_curve: list[dict]) -> list[dict]:
    if not equity_curve:
        return []
    frame = pd.DataFrame(equity_curve).copy()
    frame["equity"] = frame["equity"].astype(float)
    frame["running_max"] = frame["equity"].cummax()
    frame["drawdown"] = ((frame["equity"] / frame["running_max"]) - 1.0) * 100
    return [
        {
            "time": row["time"],
            "drawdown": round(float(row["drawdown"]), 4),
        }
        for _, row in frame.iterrows()
    ]


def _annualized_sharpe(returns: pd.Series) -> float | None:
    std = returns.std(ddof=0)
    if std == 0 or pd.isna(std):
        return None
    return (returns.mean() / std) * math.sqrt(252)


def _annualized_sortino(returns: pd.Series) -> float | None:
    downside = returns[returns < 0]
    downside_std = downside.std(ddof=0)
    if downside_std == 0 or pd.isna(downside_std):
        return None
    return (returns.mean() / downside_std) * math.sqrt(252)


def _cagr(time_values: pd.Series, initial_cash: float, ending_equity: float) -> float:
    if len(time_values) < 2 or initial_cash <= 0 or ending_equity <= 0:
        return 0.0
    start = pd.to_datetime(time_values.iloc[0], utc=True)
    end = pd.to_datetime(time_values.iloc[-1], utc=True)
    years = max((end - start).total_seconds() / (365.25 * 24 * 60 * 60), 1 / 365.25)
    return ((ending_equity / initial_cash) ** (1 / years) - 1.0) * 100
