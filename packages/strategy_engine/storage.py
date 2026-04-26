from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import uuid4

import duckdb

from config.paths import STRATEGY_DB


def _connect():
    connection = duckdb.connect(str(STRATEGY_DB))
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS strategies (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL,
            description VARCHAR,
            code TEXT NOT NULL,
            language VARCHAR NOT NULL DEFAULT 'python',
            tags_json TEXT NOT NULL,
            parameter_schema_json TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS optimization_jobs (
            job_id VARCHAR PRIMARY KEY,
            status VARCHAR NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS backtest_runs (
            run_id VARCHAR PRIMARY KEY,
            strategy_id VARCHAR,
            strategy_name VARCHAR NOT NULL,
            symbol VARCHAR NOT NULL,
            timeframe VARCHAR NOT NULL,
            start_date VARCHAR NOT NULL,
            end_date VARCHAR NOT NULL,
            created_at TIMESTAMP NOT NULL,
            result_json TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS paper_sessions (
            session_id VARCHAR PRIMARY KEY,
            status VARCHAR NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL
        )
        """
    )
    return connection


def list_strategies() -> list[dict]:
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT id, name, description, code, language, tags_json, parameter_schema_json, created_at, updated_at
            FROM strategies
            ORDER BY updated_at DESC, created_at DESC
            """
        ).fetchall()
    finally:
        conn.close()
    return [_row_to_dict(row) for row in rows]


def get_strategy(strategy_id: str) -> dict | None:
    conn = _connect()
    try:
        row = conn.execute(
            """
            SELECT id, name, description, code, language, tags_json, parameter_schema_json, created_at, updated_at
            FROM strategies
            WHERE id = ?
            """,
            [strategy_id],
        ).fetchone()
    finally:
        conn.close()
    return _row_to_dict(row) if row else None


def create_strategy(payload: dict) -> dict:
    now = _now()
    strategy_id = payload.get("id") or f"strat_{uuid4().hex[:10]}"
    conn = _connect()
    try:
        conn.execute(
            """
            INSERT INTO strategies (
                id, name, description, code, language, tags_json, parameter_schema_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                strategy_id,
                payload["name"],
                payload.get("description", ""),
                payload.get("code", ""),
                payload.get("language", "python"),
                json.dumps(payload.get("tags", [])),
                json.dumps(payload.get("parameter_schema", {})),
                now,
                now,
            ],
        )
    finally:
        conn.close()
    return get_strategy(strategy_id)


def update_strategy(strategy_id: str, payload: dict) -> dict | None:
    existing = get_strategy(strategy_id)
    if existing is None:
        return None

    conn = _connect()
    try:
        conn.execute(
            """
            UPDATE strategies
            SET name = ?, description = ?, code = ?, language = ?, tags_json = ?, parameter_schema_json = ?, updated_at = ?
            WHERE id = ?
            """,
            [
                payload["name"],
                payload.get("description", ""),
                payload.get("code", ""),
                payload.get("language", "python"),
                json.dumps(payload.get("tags", [])),
                json.dumps(payload.get("parameter_schema", {})),
                _now(),
                strategy_id,
            ],
        )
    finally:
        conn.close()
    return get_strategy(strategy_id)


def delete_strategy(strategy_id: str) -> bool:
    existing = get_strategy(strategy_id)
    if existing is None:
        return False
    conn = _connect()
    try:
        conn.execute("DELETE FROM strategies WHERE id = ?", [strategy_id])
    finally:
        conn.close()
    return True


def create_optimization_job(job_id: str, payload: dict) -> dict:
    conn = _connect()
    now = _now()
    try:
        conn.execute(
            """
            INSERT INTO optimization_jobs (job_id, status, payload_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            [job_id, payload.get("status", "queued"), json.dumps(payload), now, now],
        )
    finally:
        conn.close()
    return get_optimization_job(job_id)


def get_optimization_job(job_id: str) -> dict | None:
    conn = _connect()
    try:
        row = conn.execute(
            """
            SELECT payload_json
            FROM optimization_jobs
            WHERE job_id = ?
            """,
            [job_id],
        ).fetchone()
    finally:
        conn.close()
    return json.loads(row[0]) if row else None


def update_optimization_job(job_id: str, updates: dict) -> dict | None:
    current = get_optimization_job(job_id)
    if current is None:
        return None
    merged = {**current, **updates}
    conn = _connect()
    try:
        conn.execute(
            """
            UPDATE optimization_jobs
            SET status = ?, payload_json = ?, updated_at = ?
            WHERE job_id = ?
            """,
            [merged.get("status", current.get("status", "queued")), json.dumps(merged), _now(), job_id],
        )
    finally:
        conn.close()
    return get_optimization_job(job_id)


def create_backtest_run(payload: dict) -> dict:
    conn = _connect()
    created_at = _now()
    run_id = payload["run_id"]
    try:
        conn.execute(
            """
            INSERT INTO backtest_runs (
                run_id, strategy_id, strategy_name, symbol, timeframe, start_date, end_date, created_at, result_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                run_id,
                payload.get("strategy_id"),
                payload.get("strategy_name", "Untitled Strategy"),
                payload["symbol"],
                payload["timeframe"],
                payload["start_date"],
                payload["end_date"],
                created_at,
                json.dumps(payload["result"]),
            ],
        )
    finally:
        conn.close()
    return get_backtest_run(run_id)


def list_backtest_runs(limit: int = 30) -> list[dict]:
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT run_id, strategy_id, strategy_name, symbol, timeframe, start_date, end_date, created_at, result_json
            FROM backtest_runs
            ORDER BY created_at DESC
            LIMIT ?
            """,
            [limit],
        ).fetchall()
    finally:
        conn.close()
    return [_backtest_row_to_dict(row, include_result=False) for row in rows]


def get_backtest_run(run_id: str) -> dict | None:
    conn = _connect()
    try:
        row = conn.execute(
            """
            SELECT run_id, strategy_id, strategy_name, symbol, timeframe, start_date, end_date, created_at, result_json
            FROM backtest_runs
            WHERE run_id = ?
            """,
            [run_id],
        ).fetchone()
    finally:
        conn.close()
    return _backtest_row_to_dict(row, include_result=True) if row else None


def delete_backtest_run(run_id: str) -> bool:
    existing = get_backtest_run(run_id)
    if existing is None:
        return False
    conn = _connect()
    try:
        conn.execute("DELETE FROM backtest_runs WHERE run_id = ?", [run_id])
    finally:
        conn.close()
    return True


def create_or_update_paper_session(payload: dict) -> dict:
    session_id = payload["session_id"]
    existing = get_paper_session(session_id)
    conn = _connect()
    now = _now()
    try:
        if existing is None:
            conn.execute(
                """
                INSERT INTO paper_sessions (session_id, status, payload_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                [session_id, payload.get("status", "running"), json.dumps(payload), now, now],
            )
        else:
            conn.execute(
                """
                UPDATE paper_sessions
                SET status = ?, payload_json = ?, updated_at = ?
                WHERE session_id = ?
                """,
                [payload.get("status", existing.get("status", "running")), json.dumps(payload), now, session_id],
            )
    finally:
        conn.close()
    return get_paper_session(session_id)


def get_paper_session(session_id: str) -> dict | None:
    conn = _connect()
    try:
        row = conn.execute(
            """
            SELECT payload_json
            FROM paper_sessions
            WHERE session_id = ?
            """,
            [session_id],
        ).fetchone()
    finally:
        conn.close()
    return json.loads(row[0]) if row else None


def list_paper_sessions(limit: int = 20) -> list[dict]:
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT payload_json
            FROM paper_sessions
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            [limit],
        ).fetchall()
    finally:
        conn.close()
    return [json.loads(row[0]) for row in rows]


def _row_to_dict(row) -> dict:
    return {
        "id": row[0],
        "name": row[1],
        "description": row[2],
        "code": row[3],
        "language": row[4],
        "tags": json.loads(row[5] or "[]"),
        "parameter_schema": json.loads(row[6] or "{}"),
        "created_at": _iso(row[7]),
        "updated_at": _iso(row[8]),
    }


def _backtest_row_to_dict(row, include_result: bool) -> dict:
    result = json.loads(row[8] or "{}")
    metrics = result.get("metrics") if isinstance(result, dict) else {}
    payload = {
        "run_id": row[0],
        "strategy_id": row[1],
        "strategy_name": row[2],
        "symbol": row[3],
        "timeframe": row[4],
        "start_date": row[5],
        "end_date": row[6],
        "created_at": _iso(row[7]),
        "metrics": metrics or {},
    }
    if include_result:
        payload["result"] = result
    return payload


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)
