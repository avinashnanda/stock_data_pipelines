"""
Hedge Fund DuckDB storage for API keys, LLM endpoints, and custom models.
Lightweight replacement for the original SQLAlchemy + SQLite setup.
"""

import sys
import uuid
from datetime import datetime
from pathlib import Path

import duckdb

_ROOT_DIR = Path(__file__).resolve().parents[1]
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

from paths import HEDGE_FUND_DB  # noqa: E402

_DB_FILE = str(HEDGE_FUND_DB)


def get_hf_connection():
    """Get a DuckDB connection and ensure tables exist."""
    con = duckdb.connect(_DB_FILE)
    con.execute("""
        CREATE TABLE IF NOT EXISTS api_keys (
            provider VARCHAR PRIMARY KEY,
            key_value VARCHAR NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS llm_endpoints (
            id VARCHAR PRIMARY KEY,
            label VARCHAR NOT NULL,
            base_url VARCHAR NOT NULL,
            api_key VARCHAR DEFAULT '',
            provider_type VARCHAR NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS custom_models (
            id VARCHAR PRIMARY KEY,
            endpoint_id VARCHAR NOT NULL,
            display_name VARCHAR NOT NULL,
            model_name VARCHAR NOT NULL,
            provider VARCHAR NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    return con


# ── API Key functions ────────────────────────────────────────────────────────

def save_api_key(provider: str, key_value: str) -> None:
    con = get_hf_connection()
    try:
        con.execute("""
            INSERT INTO api_keys (provider, key_value, is_active, updated_at)
            VALUES (?, ?, TRUE, ?)
            ON CONFLICT(provider) DO UPDATE SET
                key_value = EXCLUDED.key_value,
                is_active = TRUE,
                updated_at = EXCLUDED.updated_at
        """, [provider, key_value, datetime.utcnow()])
    finally:
        con.close()


def get_api_key(provider: str) -> str | None:
    con = get_hf_connection()
    try:
        row = con.execute(
            "SELECT key_value FROM api_keys WHERE provider = ? AND is_active = TRUE",
            [provider],
        ).fetchone()
        return row[0] if row else None
    finally:
        con.close()


def get_all_api_keys() -> dict[str, str]:
    con = get_hf_connection()
    try:
        rows = con.execute(
            "SELECT provider, key_value FROM api_keys WHERE is_active = TRUE"
        ).fetchall()
        return {r[0]: r[1] for r in rows}
    finally:
        con.close()


def get_all_api_keys_masked() -> list[dict]:
    con = get_hf_connection()
    try:
        rows = con.execute(
            "SELECT provider, key_value, is_active, updated_at FROM api_keys"
        ).fetchall()
        result = []
        for r in rows:
            val = r[1]
            masked = val[:4] + "..." + val[-4:] if len(val) > 8 else "****"
            result.append({
                "provider": r[0],
                "key_preview": masked,
                "is_active": r[2],
                "updated_at": str(r[3]) if r[3] else None,
            })
        return result
    finally:
        con.close()


def delete_api_key(provider: str) -> bool:
    con = get_hf_connection()
    try:
        before = con.execute("SELECT COUNT(*) FROM api_keys WHERE provider = ?", [provider]).fetchone()[0]
        con.execute("DELETE FROM api_keys WHERE provider = ?", [provider])
        return before > 0
    finally:
        con.close()


# ── LLM Endpoint functions ───────────────────────────────────────────────────

def save_endpoint(endpoint_id: str | None, label: str, base_url: str,
                  provider_type: str, api_key: str = "") -> str:
    con = get_hf_connection()
    try:
        eid = endpoint_id or str(uuid.uuid4())[:8]
        con.execute("""
            INSERT INTO llm_endpoints (id, label, base_url, api_key, provider_type, is_active, updated_at)
            VALUES (?, ?, ?, ?, ?, TRUE, ?)
            ON CONFLICT(id) DO UPDATE SET
                label = EXCLUDED.label,
                base_url = EXCLUDED.base_url,
                api_key = EXCLUDED.api_key,
                provider_type = EXCLUDED.provider_type,
                updated_at = EXCLUDED.updated_at
        """, [eid, label, base_url, api_key, provider_type, datetime.utcnow()])
        return eid
    finally:
        con.close()


def get_all_endpoints() -> list[dict]:
    con = get_hf_connection()
    try:
        rows = con.execute(
            "SELECT id, label, base_url, api_key, provider_type, is_active, updated_at FROM llm_endpoints"
        ).fetchall()
        return [{
            "id": r[0], "label": r[1], "base_url": r[2],
            "api_key": r[3], "provider_type": r[4],
            "is_active": r[5], "updated_at": str(r[6]) if r[6] else None,
        } for r in rows]
    finally:
        con.close()


def get_endpoint(endpoint_id: str) -> dict | None:
    con = get_hf_connection()
    try:
        row = con.execute(
            "SELECT id, label, base_url, api_key, provider_type FROM llm_endpoints WHERE id = ?",
            [endpoint_id],
        ).fetchone()
        if not row:
            return None
        return {"id": row[0], "label": row[1], "base_url": row[2],
                "api_key": row[3], "provider_type": row[4]}
    finally:
        con.close()


def delete_endpoint(endpoint_id: str) -> bool:
    con = get_hf_connection()
    try:
        before = con.execute("SELECT COUNT(*) FROM llm_endpoints WHERE id = ?", [endpoint_id]).fetchone()[0]
        con.execute("DELETE FROM custom_models WHERE endpoint_id = ?", [endpoint_id])
        con.execute("DELETE FROM llm_endpoints WHERE id = ?", [endpoint_id])
        return before > 0
    finally:
        con.close()


# ── Custom Model functions ───────────────────────────────────────────────────

def save_custom_model(endpoint_id: str, display_name: str,
                      model_name: str, provider: str) -> str:
    con = get_hf_connection()
    try:
        mid = str(uuid.uuid4())[:8]
        con.execute("""
            INSERT INTO custom_models (id, endpoint_id, display_name, model_name, provider, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, [mid, endpoint_id, display_name, model_name, provider, datetime.utcnow()])
        return mid
    finally:
        con.close()


def get_custom_models() -> list[dict]:
    con = get_hf_connection()
    try:
        rows = con.execute("""
            SELECT m.id, m.endpoint_id, m.display_name, m.model_name, m.provider,
                   e.base_url, e.api_key, e.label as endpoint_label
            FROM custom_models m
            LEFT JOIN llm_endpoints e ON m.endpoint_id = e.id
        """).fetchall()
        return [{
            "id": r[0], "endpoint_id": r[1], "display_name": r[2],
            "model_name": r[3], "provider": r[4],
            "base_url": r[5], "api_key": r[6], "endpoint_label": r[7],
        } for r in rows]
    finally:
        con.close()


def delete_custom_model(model_id: str) -> bool:
    con = get_hf_connection()
    try:
        before = con.execute("SELECT COUNT(*) FROM custom_models WHERE id = ?", [model_id]).fetchone()[0]
        con.execute("DELETE FROM custom_models WHERE id = ?", [model_id])
        return before > 0
    finally:
        con.close()
