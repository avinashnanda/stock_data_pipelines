# reprocess_failed_symbols.py
import os
import csv

from .config import FAILED_LOG_PATH
from .updater import update_one_symbol
from .logger import get_logger

log = get_logger()


def _load_failed_pairs():
    """
    Read FAILED_LOG_PATH and return a set of (symbol, freq) to retry.

    Lines can look like:
      symbol,freq,start,end,EMPTY_INITIAL
      symbol,freq,ERROR,repr(e)
    We only care about symbol and freq for reprocessing.
    """
    if not os.path.exists(FAILED_LOG_PATH):
        log.info(f"No failed file found at {FAILED_LOG_PATH}, nothing to reprocess.")
        return set()

    failed_pairs = set()

    with open(FAILED_LOG_PATH, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        for row in reader:
            if not row:
                continue
            if len(row) < 2:
                continue
            symbol = row[0].strip()
            freq = row[1].strip()
            if not symbol or not freq:
                continue
            failed_pairs.add((symbol, freq))

    return failed_pairs


def reprocess_failed():
    failed_pairs = _load_failed_pairs()
    if not failed_pairs:
        log.info("No failed symbols to reprocess.")
        return

    log.info(f"Reprocessing {len(failed_pairs)} failed (symbol, freq) pairs")

    # Clear the failed file BEFORE re-running.
    # Any failures during this pass will be re-logged by update_one_symbol.
    open(FAILED_LOG_PATH, "w", encoding="utf-8").close()

    # listing_date is ignored in update_one_symbol's logic,
    # but we pass None to keep signature.
    for symbol, freq in sorted(failed_pairs):
        try:
            log.info(f"Reprocessing failed {symbol} [{freq}]")
            update_one_symbol(symbol=symbol, listing_date=None, freq=freq)
        except Exception as e:
            log.error(f"Reprocessing {symbol} [{freq}] crashed: {e}")
            # In this case we manually re-append to failed file
            with open(FAILED_LOG_PATH, "a", encoding="utf-8") as f:
                f.write(f"{symbol},{freq},ERROR_REPROCESS,{repr(e)}\n")


if __name__ == "__main__":
    reprocess_failed()
