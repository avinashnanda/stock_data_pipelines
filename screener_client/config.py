from typing import Dict

HEADERS: Dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36"
    )
}

REQUEST_TIMEOUT = 15  # seconds for HTTP requests
PLAYWRIGHT_TIMEOUT = 60000  # ms (kept in case you add Playwright later)
