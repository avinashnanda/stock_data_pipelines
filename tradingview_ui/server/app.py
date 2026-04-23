"""Application server and CLI entry point."""
from __future__ import annotations
import argparse, logging, os, sys
from http.server import ThreadingHTTPServer
from pathlib import Path

# ── Path bootstrapping (same as original server.py) ──────────────────────────
ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

AI_HEDGE_FUND_DIR = ROOT_DIR / "ai-hedge-fund"
if str(AI_HEDGE_FUND_DIR) not in sys.path:
    sys.path.insert(0, str(AI_HEDGE_FUND_DIR))
os.environ["HEDGE_FUND_DATA_MODE"] = "local"

# Silence yfinance logger
logging.getLogger("yfinance").setLevel(logging.CRITICAL)

from .handler import AppRequestHandler
from .adapters import YFinanceSourceAdapter, SourceAdapter


class AppServer(ThreadingHTTPServer):
    allow_reuse_address = True

    def __init__(self, server_address: tuple[str, int]):
        super().__init__(server_address, AppRequestHandler)
        self._adapters: dict[str, SourceAdapter] = {
            "yfinance": YFinanceSourceAdapter(),
        }

    def get_adapter(self, source_id: str) -> SourceAdapter:
        adapter = self._adapters.get(source_id)
        if adapter is None:
            raise ValueError(f"Unsupported source: {source_id}")
        return adapter


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the TradingView demo app")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=9032, type=int)
    args = parser.parse_args()

    try:
        server = AppServer((args.host, args.port))
    except PermissionError as exc:
        if getattr(exc, "winerror", None) == 10013:
            raise SystemExit(
                "Could not bind the TradingView UI server to "
                f"http://{args.host}:{args.port}. "
                "Windows is blocking that socket, usually because the port is already in use "
                "or reserved by another process. Try a different port, for example:\n"
                f"python {Path(__file__).resolve()} --port 9010"
            ) from exc
        raise

    print(f"Serving TradingView UI at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
