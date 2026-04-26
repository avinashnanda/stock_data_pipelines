from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class RiskManager:
    max_position_value: float = 250000.0
    max_order_qty: int = 500

    def validate(self, *, side: str, qty: int, price: float) -> list[str]:
        issues: list[str] = []
        if qty <= 0:
            issues.append("Order quantity must be positive.")
        if qty > self.max_order_qty:
            issues.append(f"Order quantity exceeds max_order_qty={self.max_order_qty}.")
        if qty * price > self.max_position_value:
            issues.append(f"Order value exceeds max_position_value={self.max_position_value}.")
        if side not in {"BUY", "SELL"}:
            issues.append("Order side must be BUY or SELL.")
        return issues


@dataclass
class PaperTradingSession:
    session_id: str
    symbol: str
    initial_cash: float
    cash: float
    status: str = "running"
    created_at: str = field(default_factory=_now_iso)
    updated_at: str = field(default_factory=_now_iso)
    positions: dict[str, dict[str, Any]] = field(default_factory=dict)
    orders: list[dict[str, Any]] = field(default_factory=list)
    events: list[dict[str, Any]] = field(default_factory=list)

    def snapshot(self) -> dict[str, Any]:
        market_value = sum(float(item["qty"]) * float(item["avg_price"]) for item in self.positions.values())
        equity = self.cash + market_value
        return {
            "session_id": self.session_id,
            "symbol": self.symbol,
            "status": self.status,
            "initial_cash": round(self.initial_cash, 4),
            "cash": round(self.cash, 4),
            "equity": round(equity, 4),
            "positions": list(self.positions.values()),
            "orders": self.orders[-25:],
            "events": self.events[-50:],
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class PaperTradingManager:
    def __init__(self) -> None:
        self.sessions: dict[str, PaperTradingSession] = {}
        self.risk = RiskManager()

    def start(self, *, symbol: str, initial_cash: float = 100000.0) -> dict[str, Any]:
        session = PaperTradingSession(
            session_id=f"paper_{uuid4().hex[:10]}",
            symbol=symbol,
            initial_cash=float(initial_cash),
            cash=float(initial_cash),
        )
        session.events.append({"time": _now_iso(), "type": "SESSION_STARTED", "symbol": symbol})
        self.sessions[session.session_id] = session
        return session.snapshot()

    def stop(self, session_id: str) -> dict[str, Any]:
        session = self._get(session_id)
        session.status = "stopped"
        session.updated_at = _now_iso()
        session.events.append({"time": session.updated_at, "type": "SESSION_STOPPED"})
        return session.snapshot()

    def get(self, session_id: str) -> dict[str, Any]:
        return self._get(session_id).snapshot()

    def restore(self, payload: dict[str, Any]) -> dict[str, Any]:
        session = PaperTradingSession(
            session_id=payload["session_id"],
            symbol=payload["symbol"],
            initial_cash=float(payload.get("initial_cash", 100000)),
            cash=float(payload.get("cash", payload.get("initial_cash", 100000))),
            status=payload.get("status", "running"),
            created_at=payload.get("created_at", _now_iso()),
            updated_at=payload.get("updated_at", _now_iso()),
            positions={item["symbol"]: dict(item) for item in (payload.get("positions") or []) if item.get("symbol")},
            orders=list(payload.get("orders") or []),
            events=list(payload.get("events") or []),
        )
        self.sessions[session.session_id] = session
        return session.snapshot()

    def place_order(self, *, session_id: str, side: str, qty: int, price: float) -> dict[str, Any]:
        session = self._get(session_id)
        if session.status != "running":
            raise ValueError("Paper session is not running.")

        issues = self.risk.validate(side=side, qty=int(qty), price=float(price))
        if issues:
            raise ValueError(" ".join(issues))

        symbol = session.symbol
        position = session.positions.get(symbol, {"symbol": symbol, "qty": 0, "avg_price": 0.0})
        order = {
            "time": _now_iso(),
            "symbol": symbol,
            "side": side,
            "qty": int(qty),
            "price": round(float(price), 4),
            "status": "filled",
        }

        if side == "BUY":
            session.cash -= float(price) * int(qty)
            total_qty = int(position["qty"]) + int(qty)
            total_cost = (float(position["avg_price"]) * int(position["qty"])) + (float(price) * int(qty))
            position["qty"] = total_qty
            position["avg_price"] = round(total_cost / total_qty, 4) if total_qty else 0.0
        else:
            session.cash += float(price) * int(qty)
            position["qty"] = int(position["qty"]) - int(qty)
            if position["qty"] <= 0:
                position["qty"] = 0
                position["avg_price"] = 0.0

        if position["qty"] == 0:
            session.positions.pop(symbol, None)
        else:
            session.positions[symbol] = position

        session.orders.append(order)
        session.updated_at = order["time"]
        session.events.append(
            {
                "time": order["time"],
                "type": "ORDER_FILLED",
                "side": side,
                "qty": int(qty),
                "price": round(float(price), 4),
            }
        )
        return session.snapshot()

    def _get(self, session_id: str) -> PaperTradingSession:
        session = self.sessions.get(session_id)
        if session is None:
            raise ValueError("Paper trading session not found.")
        return session
