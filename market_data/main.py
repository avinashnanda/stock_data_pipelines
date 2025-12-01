# main.py
from .db_utils import init_db
from .instrument_loader import load_instruments
from .updater import update_all_symbols

if __name__ == "__main__":
    init_db()
    load_instruments()
    update_all_symbols(freq="D")  # daily
    update_all_symbols(freq="W")  # weekly
