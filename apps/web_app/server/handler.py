"""HTTP request handler — thin dispatcher that delegates to route modules."""
from __future__ import annotations
import json, mimetypes, re
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler
from typing import Any
from urllib.parse import parse_qs, urlparse
from apps.web_app.server.constants import APP_DIR, TRADINGVIEW_DIR, SERVER_LOG_PATH
from apps.web_app.server.utils import sanitize_json_value
from apps.web_app.server import routes_core, routes_announcements, routes_hedgefund

# ── Regex for <!-- @include partials/xxx.html --> directives ─────────────────
_INCLUDE_RE = re.compile(r'<!--\s*@include\s+([\w./\-]+)\s*-->')
_assembled_index_cache: bytes | None = None

def _assemble_index_html() -> bytes:
    """Read index.html and recursively replace @include markers with partial file contents."""
    global _assembled_index_cache
    if _assembled_index_cache is not None:
        return _assembled_index_cache
    index_path = APP_DIR / "index.html"
    html = index_path.read_text(encoding="utf-8")
    def _replace(match):
        partial_path = APP_DIR / match.group(1)
        if partial_path.exists():
            return partial_path.read_text(encoding="utf-8")
        return match.group(0)  # leave marker if file missing
    html = _INCLUDE_RE.sub(_replace, html)
    _assembled_index_cache = html.encode("utf-8")
    return _assembled_index_cache

class AppRequestHandler(SimpleHTTPRequestHandler):
    server_version = "TradingViewUI/0.1"

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._handle_api(parsed)
        else:
            self._serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._handle_api(parsed, method="POST")
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown route")

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._handle_api(parsed, method="DELETE")
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown route")

    def _handle_api(self, parsed, method="GET"):
        params = parse_qs(parsed.query)
        try:
            p = parsed.path
            if p == "/api/health": routes_core.handle_health(self); return
            if p == "/api/sources": routes_core.handle_sources(self); return
            if p == "/api/search": routes_core.handle_search(self, params); return
            if p == "/api/symbol": routes_core.handle_symbol(self, params); return
            if p == "/api/history": routes_core.handle_history(self, params); return
            if p == "/api/quote": routes_core.handle_quote(self, params); return
            if p == "/api/quotes": routes_core.handle_quotes(self, params); return
            if p == "/api/watchlist": routes_core.handle_watchlist(self, params); return
            if p == "/api/screener/company":
                if method != "GET": self.send_error(HTTPStatus.METHOD_NOT_ALLOWED); return
                routes_core.handle_screener_company(self, params); return
            if p == "/api/screener/refresh": routes_core.handle_screener_refresh(self, params, method); return
            if p == "/api/announcements/toggle": routes_announcements.handle_announcements_toggle(self, method); return
            if p == "/api/announcements/status": routes_announcements.handle_announcements_status(self); return
            if p == "/api/announcements/refresh_fundamentals_status": routes_announcements.handle_announcements_refresh_fundamentals_status(self); return
            if p == "/api/announcements/refresh_fundamentals": routes_announcements.handle_announcements_refresh_fundamentals(self, method); return
            if p == "/api/announcements": routes_announcements.handle_announcements(self, params); return
            if p == "/api/hedge-fund/agents": routes_hedgefund.handle_agents(self); return
            if p == "/api/hedge-fund/models": routes_hedgefund.handle_models(self); return
            if p == "/api/hedge-fund/run" and method == "POST": routes_hedgefund.handle_run(self); return
            if p == "/api/hedge-fund/backtest" and method == "POST": routes_hedgefund.handle_backtest(self); return
            if p == "/api/hedge-fund/api-keys": routes_hedgefund.handle_api_keys(self, method); return
            if p.startswith("/api/hedge-fund/api-keys/"):
                provider = p.split("/api/hedge-fund/api-keys/")[1]
                routes_hedgefund.handle_api_key_delete(self, provider, method); return
            if p == "/api/hedge-fund/ollama/status": routes_hedgefund.handle_ollama_status(self); return
            if p == "/api/hedge-fund/ollama/pull" and method == "POST": routes_hedgefund.handle_ollama_pull(self, method); return
            if p == "/api/hedge-fund/endpoints": routes_hedgefund.handle_endpoints(self, method); return
            if p.startswith("/api/hedge-fund/endpoints/") and "/test" in p:
                eid = p.split("/api/hedge-fund/endpoints/")[1].replace("/test", "")
                routes_hedgefund.handle_endpoint_test(self, eid); return
            if p.startswith("/api/hedge-fund/endpoints/"):
                eid = p.split("/api/hedge-fund/endpoints/")[1]
                routes_hedgefund.handle_endpoint_delete(self, eid, method); return
            if p == "/api/hedge-fund/custom-models": routes_hedgefund.handle_custom_models(self, method); return
            if p.startswith("/api/hedge-fund/custom-models/"):
                mid = p.split("/api/hedge-fund/custom-models/")[1]
                routes_hedgefund.handle_custom_model_delete(self, mid, method); return
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown API route")
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)

    def _serve_static(self, raw_path):
        # index.html is assembled from partials at first request then cached
        if raw_path in {"", "/"}:
            body = _assemble_index_html()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if raw_path.startswith("/charting_library/"): file_path = TRADINGVIEW_DIR / raw_path.lstrip("/")
        elif raw_path.startswith("/datafeeds/"): file_path = TRADINGVIEW_DIR / raw_path.lstrip("/")
        else: file_path = APP_DIR / raw_path.lstrip("/")
        if not file_path.exists() or file_path.is_dir():
            self.send_error(HTTPStatus.NOT_FOUND, "File not found"); return
        content_type, _ = mimetypes.guess_type(str(file_path))
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(file_path.stat().st_size))
        self.end_headers()
        self.wfile.write(file_path.read_bytes())

    def _send_json(self, payload, status=HTTPStatus.OK):
        try:
            body = json.dumps(sanitize_json_value(payload), allow_nan=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionAbortedError, ConnectionResetError):
            pass

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0: return {}
        return json.loads(self.rfile.read(length))

    def _send_sse(self, event_type, data):
        try:
            payload = json.dumps(sanitize_json_value(data), allow_nan=False)
            chunk = f"event: {event_type}\ndata: {payload}\n\n"
            self.wfile.write(chunk.encode("utf-8"))
            self.wfile.flush()
        except (ConnectionAbortedError, ConnectionResetError):
            pass

    def log_message(self, format, *args):
        log_line = f"[{datetime.now().isoformat()}] [tradingview-ui] {self.address_string()} - {format % args}\n"
        try:
            with open(SERVER_LOG_PATH, "a") as f:
                f.write(log_line)
        except Exception:
            pass
