# db/db_utils.py
import duckdb
import pandas as pd
import json
from datetime import date, datetime

from .common import clean_numeric, parse_period_label_to_date, ensure_date

# -----------------------
# Raw JSON storage
# -----------------------

def store_raw_json(con, company_id: str, meta: dict, data: dict):
    """
    Store the full raw scraped JSON into raw_company_json table.
    Upserts by deleting existing entry then inserting new one.
    """
    raw_payload = json.dumps(data, default=str)
    scraped_at = datetime.utcnow()

    con.execute("DELETE FROM raw_company_json WHERE company_id = ?", [company_id])
    con.execute(
        """
        INSERT INTO raw_company_json (
            company_id, source_url, scraped_at, payload_json
        )
        VALUES (?, ?, ?, ?)
        """,
        [
            company_id,
            meta.get("source_url"),
            scraped_at,
            raw_payload,
        ],
    )

# -----------------------
# Meta + summary
# -----------------------

def load_meta_and_summary(con, data: dict):
    meta = data["meta"]
    summary = data["summary"]
    company_id = meta["company_id"]

    warehouse_id = meta.get("warehouse_id")
    company_name = meta.get("company_name")
    source_url = meta.get("source_url")

    # companies
    con.execute("DELETE FROM companies WHERE company_id = ?", [company_id])
    con.execute(
        """
        INSERT INTO companies (company_id, warehouse_id, company_name, source_url)
        VALUES (?, ?, ?, ?)
        """,
        [company_id, warehouse_id, company_name, source_url],
    )

    # company_summary
    today = date.today()
    con.execute("DELETE FROM company_summary WHERE company_id = ?", [company_id])
    con.execute(
        """
        INSERT INTO company_summary (
            company_id, as_of,
            market_cap_raw, current_price_raw, high_low_raw,
            stock_pe_raw, book_value_raw, dividend_yield_raw,
            roce_raw, roe_raw, face_value_raw
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            company_id,
            today,
            summary.get("Market Cap"),
            summary.get("Current Price"),
            summary.get("High / Low"),
            summary.get("Stock P/E"),
            summary.get("Book Value"),
            summary.get("Dividend Yield"),
            summary.get("ROCE"),
            summary.get("ROE"),
            summary.get("Face Value"),
        ],
    )

# -----------------------
# Quarterly + yearly financials
# -----------------------

def melt_yearly(df: pd.DataFrame, statement_name: str, company_id: str) -> pd.DataFrame:
    df = df.copy()
    value_cols = [c for c in df.columns if c != "Item"]
    recs = []
    for _, row in df.iterrows():
        item = row["Item"]
        for col in value_cols:
            if col == "TTM":
                period = None
            else:
                period = parse_period_label_to_date(col)
            val = clean_numeric(row[col])
            recs.append(
                {
                    "company_id": company_id,
                    "period": period,
                    "statement": statement_name,
                    "item": item,
                    "value": val,
                }
            )
    return pd.DataFrame(recs)


def load_quarterly_and_yearly(con, data: dict):
    company_id = data["meta"]["company_id"]

    # quarterly_results -> financials_quarterly
    qdf = data["quarterly_results"].copy()
    value_cols = [c for c in qdf.columns if c != "Item"]

    q_records = []
    for _, row in qdf.iterrows():
        item = row["Item"]
        for col in value_cols:
            period = parse_period_label_to_date(col)
            val = clean_numeric(row[col])
            q_records.append(
                {
                    "company_id": company_id,
                    "period": period,
                    "statement": "quarterly_results",
                    "item": item,
                    "value": val,
                }
            )

    q_long = pd.DataFrame(q_records)
    con.execute(
        "DELETE FROM financials_quarterly WHERE company_id = ?",
        [company_id],
    )
    con.register("q_long", q_long)
    con.execute(
        """
        INSERT INTO financials_quarterly
        SELECT company_id, period, statement, item, value FROM q_long
        """
    )

    # profit_and_loss, balance_sheet, cash_flows, ratios -> financials_yearly
    yearly_parts = [
        melt_yearly(data["profit_and_loss"], "profit_and_loss", company_id),
        melt_yearly(data["balance_sheet"], "balance_sheet", company_id),
        melt_yearly(data["cash_flows"], "cash_flows", company_id),
        melt_yearly(data["ratios"], "ratios", company_id),
    ]

    yearly_all = pd.concat(yearly_parts, ignore_index=True)
    con.execute(
        "DELETE FROM financials_yearly WHERE company_id = ?",
        [company_id],
    )
    con.register("yearly_all", yearly_all)
    con.execute(
        """
        INSERT INTO financials_yearly
        SELECT company_id, period, statement, item, value FROM yearly_all
        """
    )


# -----------------------
# Shareholding pattern
# -----------------------

def load_shareholding_pattern(con, data: dict):
    company_id = data["meta"]["company_id"]
    sh = data["shareholding_pattern"].copy()

    def _norm_item(s: str) -> str:
        s = str(s).replace("\xa0", " ")
        s = " ".join(s.split())
        s = s.strip()
        if s.endswith("+"):
            s = s[:-1].strip()
        return s

    sh["Item_norm"] = sh["Item"].apply(_norm_item)
    sh_items = sh.set_index("Item_norm")
    period_cols = [c for c in sh.columns if c not in ("Item", "Item_norm")]

    con.execute(
        "DELETE FROM shareholding_pattern WHERE company_id = ?",
        [company_id],
    )

    def _val(label: str, col: str):
        if label in sh_items.index:
            return clean_numeric(sh_items.at[label, col])
        return None

    for col in period_cols:
        period_date = parse_period_label_to_date(col)

        promoters = _val("Promoters", col)
        fiis = _val("FIIs", col)
        diis = _val("DIIs", col)
        government = _val("Government", col)
        public = _val("Public", col)
        holders = _val("No. of Shareholders", col)

        con.execute(
            """
            INSERT INTO shareholding_pattern (
                company_id, period,
                promoters_pct, fiis_pct, diis_pct,
                government_pct, public_pct, shareholders_count
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                company_id,
                period_date,
                promoters,
                fiis,
                diis,
                government,
                public,
                holders,
            ],
        )


# -----------------------
# Peers
# -----------------------

def load_peers(con, data: dict):
    company_id = data["meta"]["company_id"]
    peers_df = data["peers_api"].copy()

    peers_df = peers_df.rename(
        columns={
            "Name": "peer_name",
            "CMP  Rs.": "cmp",
            "P/E": "pe",
            "Mar Cap  Rs.Cr.": "market_cap_cr",
            "Div Yld  %": "div_yield_pct",
            "NP Qtr  Rs.Cr.": "np_qtr_cr",
            "Qtr Profit Var  %": "qtr_profit_var_pct",
            "Sales Qtr  Rs.Cr.": "sales_qtr_cr",
            "Qtr Sales Var  %": "qtr_sales_var_pct",
            "ROCE  %": "roce_pct",
        }
    )

    # Drop median row (S.No. NaN)
    peers_df = peers_df[peers_df["S.No."].notna()].copy()
    peers_df["company_id"] = company_id

    for col in [
        "cmp",
        "pe",
        "market_cap_cr",
        "div_yield_pct",
        "np_qtr_cr",
        "qtr_profit_var_pct",
        "sales_qtr_cr",
        "qtr_sales_var_pct",
        "roce_pct",
    ]:
        peers_df[col] = peers_df[col].apply(clean_numeric)

    con.execute("DELETE FROM peers WHERE company_id = ?", [company_id])
    con.register("peers_df", peers_df)
    con.execute(
        """
        INSERT INTO peers (
            company_id, peer_name,
            cmp, pe, market_cap_cr, div_yield_pct,
            np_qtr_cr, qtr_profit_var_pct,
            sales_qtr_cr, qtr_sales_var_pct, roce_pct
        )
        SELECT
            company_id, peer_name,
            cmp, pe, market_cap_cr, div_yield_pct,
            np_qtr_cr, qtr_profit_var_pct,
            sales_qtr_cr, qtr_sales_var_pct, roce_pct
        FROM peers_df
        """
    )

# -----------------------
# Analysis
# -----------------------
def load_analysis(con, data: dict):
    company_id = data["meta"]["company_id"]
    analysis = data["analysis"]

    pros = analysis.get("pros", [])
    cons = analysis.get("cons", [])
    about = analysis.get("about", "")

    con.execute("DELETE FROM analysis_insights WHERE company_id = ?", [company_id])
    con.execute(
        """
        INSERT INTO analysis_insights (company_id, pros, cons, about)
        VALUES (?, ?, ?, ?)
        """,
        [
            company_id,
            pd.Series(pros).to_json(orient="values"),
            pd.Series(cons).to_json(orient="values"),
            about,
        ],
    )

# -----------------------
# Charts (including PBV)
# -----------------------
def load_charts(con, data: dict):
    company_id = data["meta"]["company_id"]
    charts = data.get("charts") or {}

    # price_dma_volume
    if "price_dma_volume" in charts:
        pdf = charts["price_dma_volume"].copy()
        pdf["company_id"] = company_id
        pdf["Date"] = ensure_date(pdf["Date"])
        pdf = pdf.rename(
            columns={
                "Date": "date",
                "Price": "price",
                "DMA50": "dma50",
                "DMA200": "dma200",
                "Volume": "volume",
                "Delivery": "delivery_pct",
            }
        )
        for col in ["price", "dma50", "dma200", "volume", "delivery_pct"]:
            if col in pdf.columns:
                pdf[col] = pdf[col].apply(clean_numeric)

        con.execute(
            "DELETE FROM chart_price_dma_volume WHERE company_id = ?",
            [company_id],
        )
        con.register("pdf", pdf)
        con.execute(
            """
            INSERT INTO chart_price_dma_volume
            SELECT company_id, date, price, dma50, dma200, volume, delivery_pct FROM pdf
            """
        )

    # pe_eps
    if "pe_eps" in charts:
        peps = charts["pe_eps"].copy()
        peps["company_id"] = company_id
        peps["Date"] = ensure_date(peps["Date"])
        peps = peps.rename(
            columns={
                "Date": "date",
                "EPS": "eps",
                "Price to Earning": "price_to_earning",
                "Median PE": "median_pe",
            }
        )
        for col in ["eps", "price_to_earning", "median_pe"]:
            if col in peps.columns:
                peps[col] = peps[col].apply(clean_numeric)

        con.execute("DELETE FROM chart_pe_eps WHERE company_id = ?", [company_id])
        con.register("peps", peps)
        con.execute(
            """
            INSERT INTO chart_pe_eps
            SELECT company_id, date, eps, price_to_earning, median_pe FROM peps
            """
        )

    # margins_sales (optional)
    if "margins_sales" in charts:
        ms = charts["margins_sales"].copy()
        ms["company_id"] = company_id
        ms["Date"] = ensure_date(ms["Date"])
        ms = ms.rename(
            columns={
                "Date": "date",
                "GPM": "gpm",
                "OPM": "opm",
                "NPM": "npm",
                "Quarter Sales": "quarter_sales",
            }
        )
        for col in ["gpm", "opm", "npm", "quarter_sales"]:
            if col in ms.columns:
                ms[col] = ms[col].apply(clean_numeric)

        con.execute(
            "DELETE FROM chart_margins_sales WHERE company_id = ?",
            [company_id],
        )
        con.register("ms", ms)
        con.execute(
            """
            INSERT INTO chart_margins_sales
            SELECT company_id, date, gpm, opm, npm, quarter_sales FROM ms
            """
        )

    # ev_ebitda (optional)
    if "ev_ebitda" in charts:
        ev = charts["ev_ebitda"].copy()
        ev["company_id"] = company_id
        ev["Date"] = ensure_date(ev["Date"])
        ev = ev.rename(
            columns={
                "Date": "date",
                "EV Multiple": "ev_multiple",
                "Median EV Multiple": "median_ev_multiple",
                "EBITDA": "ebitda",
            }
        )
        for col in ["ev_multiple", "median_ev_multiple", "ebitda"]:
            if col in ev.columns:
                ev[col] = ev[col].apply(clean_numeric)

        con.execute(
            "DELETE FROM chart_ev_ebitda WHERE company_id = ?",
            [company_id],
        )
        con.register("ev", ev)
        con.execute(
            """
            INSERT INTO chart_ev_ebitda
            SELECT company_id, date, ev_multiple, median_ev_multiple, ebitda FROM ev
            """
        )

    # mcap_sales (optional)
    if "mcap_sales" in charts:
        mcs = charts["mcap_sales"].copy()
        mcs["company_id"] = company_id
        mcs["Date"] = ensure_date(mcs["Date"])
        mcs = mcs.rename(
            columns={
                "Date": "date",
                "Market Cap to Sales": "mcap_to_sales",
                "Median Market Cap to Sales": "median_mcap_to_sales",
                "Sales": "sales",
            }
        )
        for col in ["mcap_to_sales", "median_mcap_to_sales", "sales"]:
            if col in mcs.columns:
                mcs[col] = mcs[col].apply(clean_numeric)

        con.execute(
            "DELETE FROM chart_mcap_sales WHERE company_id = ?",
            [company_id],
        )
        con.register("mcs", mcs)
        con.execute(
            """
            INSERT INTO chart_mcap_sales
            SELECT company_id, date, mcap_to_sales, median_mcap_to_sales, sales FROM mcs
            """
        )

    # pbv (optional, but you *do* have it)
    if "pbv" in charts:
        pbv = charts["pbv"].copy()
        pbv["company_id"] = company_id
        pbv["Date"] = ensure_date(pbv["Date"])
        pbv = pbv.rename(
            columns={
                "Date": "date",
                "Price to book value": "pbv",
                "Median PBV": "median_pbv",
                "Book value": "book_value",
            }
        )
        for col in ["pbv", "median_pbv", "book_value"]:
            if col in pbv.columns:
                pbv[col] = pbv[col].apply(clean_numeric)

        con.execute(
            "DELETE FROM chart_pbv WHERE company_id = ?",
            [company_id],
        )
        con.register("pbv", pbv)
        con.execute(
            """
            INSERT INTO chart_pbv (company_id, date, pbv, median_pbv, book_value)
            SELECT company_id, date, pbv, median_pbv, book_value
            FROM pbv
            """
        )
# ----------------------
# Schedules (all)
# -----------------------
def load_schedules(con, data: dict):
    company_id = data["meta"]["company_id"]
    schedules = data.get("schedules") or {}

    # sales_quarterly
    if "sales_quarterly" in schedules:
        sq = schedules["sales_quarterly"].copy()
        sq["company_id"] = company_id
        sq["period_date"] = ensure_date(sq["Date"])
        sq["YOY Sales Growth %"] = sq["YOY Sales Growth %"].apply(clean_numeric)
        sq = sq.rename(columns={"Period": "period_label"})
        con.execute(
            "DELETE FROM schedule_sales_quarterly WHERE company_id = ?",
            [company_id],
        )
        con.register("sq", sq)
        con.execute(
            """
            INSERT INTO schedule_sales_quarterly
            SELECT company_id, period_label, period_date,
                   "YOY Sales Growth %" AS yoy_sales_growth
            FROM sq
            """
        )

    # expenses_quarterly
    if "expenses_quarterly" in schedules:
        eq = schedules["expenses_quarterly"].copy()
        eq["company_id"] = company_id
        eq["period_date"] = ensure_date(eq["Date"])
        eq["Material Cost %"] = eq["Material Cost %"].apply(clean_numeric)
        eq["Employee Cost %"] = eq["Employee Cost %"].apply(clean_numeric)
        eq = eq.rename(columns={"Period": "period_label"})
        con.execute(
            "DELETE FROM schedule_expenses_quarterly WHERE company_id = ?",
            [company_id],
        )
        con.register("eq", eq)
        con.execute(
            """
            INSERT INTO schedule_expenses_quarterly
            SELECT company_id, period_label, period_date,
                   "Material Cost %" AS material_cost_pct,
                   "Employee Cost %" AS employee_cost_pct
            FROM eq
            """
        )

    # other_income_quarterly
    if "other_income_quarterly" in schedules:
        oi_q = schedules["other_income_quarterly"].copy()
        oi_q["company_id"] = company_id
        oi_q["period_date"] = ensure_date(oi_q["Date"])
        oi_q["Exceptional items"] = oi_q["Exceptional items"].apply(clean_numeric)
        oi_q["Other income normal"] = oi_q["Other income normal"].apply(clean_numeric)
        oi_q = oi_q.rename(columns={"Period": "period_label"})
        con.execute(
            "DELETE FROM schedule_other_income_quarterly WHERE company_id = ?",
            [company_id],
        )
        con.register("oi_q", oi_q)
        con.execute(
            """
            INSERT INTO schedule_other_income_quarterly
            SELECT company_id, period_label, period_date,
                   "Exceptional items" AS exceptional_items,
                   "Other income normal" AS other_income_normal
            FROM oi_q
            """
        )

    # net_profit_quarterly
    if "net_profit_quarterly" in schedules:
        np_q = schedules["net_profit_quarterly"].copy()
        np_q["company_id"] = company_id
        np_q["period_date"] = ensure_date(np_q["Date"])
        for col in [
            "Minority share",
            "Exceptional items AT",
            "Profit excl Excep",
            "Profit for PE",
            "Profit for EPS",
            "YOY Profit Growth %",
        ]:
            np_q[col] = np_q[col].apply(clean_numeric)
        np_q = np_q.rename(columns={"Period": "period_label"})
        con.execute(
            "DELETE FROM schedule_net_profit_quarterly WHERE company_id = ?",
            [company_id],
        )
        con.register("np_q", np_q)
        con.execute(
            """
            INSERT INTO schedule_net_profit_quarterly
            SELECT company_id, period_label, period_date,
                   "Minority share" AS minority_share,
                   "Exceptional items AT" AS exceptional_items_at,
                   "Profit excl Excep" AS profit_excl_excep,
                   "Profit for PE" AS profit_for_pe,
                   "Profit for EPS" AS profit_for_eps,
                   "YOY Profit Growth %" AS yoy_profit_growth
            FROM np_q
            """
        )

    # sales_profit_loss (yearly)
    if "sales_profit_loss" in schedules:
        spl = schedules["sales_profit_loss"].copy()
        spl["company_id"] = company_id
        spl["period_date"] = ensure_date(spl["Date"])
        spl["Sales Growth %"] = spl["Sales Growth %"].apply(clean_numeric)
        spl = spl.rename(columns={"Period": "period_label"})
        con.execute(
            "DELETE FROM schedule_sales_profit_loss WHERE company_id = ?",
            [company_id],
        )
        con.register("spl", spl)
        con.execute(
            """
            INSERT INTO schedule_sales_profit_loss
            SELECT company_id, period_label, period_date,
                   "Sales Growth %" AS sales_growth_pct
            FROM spl
            """
        )

    # expenses_profit_loss (yearly)
    if "expenses_profit_loss" in schedules:
        epl = schedules["expenses_profit_loss"].copy()
        epl["company_id"] = company_id
        epl["period_date"] = ensure_date(epl["Date"])
        for col in [
            "Material Cost %",
            "Manufacturing Cost %",
            "Employee Cost %",
            "Other Cost %",
        ]:
            epl[col] = epl[col].apply(clean_numeric)
        epl = epl.rename(columns={"Period": "period_label"})
        con.execute(
            "DELETE FROM schedule_expenses_profit_loss WHERE company_id = ?",
            [company_id],
        )
        con.register("epl", epl)
        con.execute(
            """
            INSERT INTO schedule_expenses_profit_loss
            SELECT company_id, period_label, period_date,
                   "Material Cost %" AS material_cost_pct,
                   "Manufacturing Cost %" AS manufacturing_cost_pct,
                   "Employee Cost %" AS employee_cost_pct,
                   "Other Cost %" AS other_cost_pct
            FROM epl
            """
        )

    # other_income_profit_loss (yearly)
    if "other_income_profit_loss" in schedules:
        oi_pl = schedules["other_income_profit_loss"].copy()
        oi_pl["company_id"] = company_id
        oi_pl["period_date"] = ensure_date(oi_pl["Date"])
        oi_pl["Exceptional items"] = oi_pl["Exceptional items"].apply(clean_numeric)
        oi_pl["Other income normal"] = oi_pl["Other income normal"].apply(clean_numeric)
        oi_pl = oi_pl.rename(columns={"Period": "period_label"})
        con.execute(
            "DELETE FROM schedule_other_income_profit_loss WHERE company_id = ?",
            [company_id],
        )
        con.register("oi_pl", oi_pl)
        con.execute(
            """
            INSERT INTO schedule_other_income_profit_loss
            SELECT company_id, period_label, period_date,
                   "Exceptional items" AS exceptional_items,
                   "Other income normal" AS other_income_normal
            FROM oi_pl
            """
        )

    # net_profit_profit_loss (yearly)
    if "net_profit_profit_loss" in schedules:
        np_pl = schedules["net_profit_profit_loss"].copy()
        np_pl["company_id"] = company_id
        np_pl["period_date"] = ensure_date(np_pl["Date"])
        for col in [
            "Profit from Associates",
            "Minority share",
            "Exceptional items AT",
            "Profit excl Excep",
            "Profit for PE",
            "Profit for EPS",
        ]:
            np_pl[col] = np_pl[col].apply(clean_numeric)
        np_pl = np_pl.rename(columns={"Period": "period_label"})
        con.execute(
            "DELETE FROM schedule_net_profit_profit_loss WHERE company_id = ?",
            [company_id],
        )
        con.register("np_pl", np_pl)
        con.execute(
            """
            INSERT INTO schedule_net_profit_profit_loss
            SELECT company_id, period_label, period_date,
                   "Profit from Associates" AS profit_from_associates,
                   "Minority share" AS minority_share,
                   "Exceptional items AT" AS exceptional_items_at,
                   "Profit excl Excep" AS profit_excl_excep,
                   "Profit for PE" AS profit_for_pe,
                   "Profit for EPS" AS profit_for_eps
            FROM np_pl
            """
        )

    # material_cost_%_profit_loss (yearly)
    if "material_cost_%_profit_loss" in schedules:
        mc_pl = schedules["material_cost_%_profit_loss"].copy()
        mc_pl["company_id"] = company_id
        mc_pl["period_date"] = ensure_date(mc_pl["Date"])
        mc_pl["Raw material cost"] = mc_pl["Raw material cost"].apply(clean_numeric)
        mc_pl["Change in inventory"] = mc_pl["Change in inventory"].apply(clean_numeric)
        mc_pl = mc_pl.rename(columns={"Period": "period_label"})
        con.execute(
            "DELETE FROM schedule_material_cost_profit_loss WHERE company_id = ?",
            [company_id],
        )
        con.register("mc_pl", mc_pl)
        con.execute(
            """
            INSERT INTO schedule_material_cost_profit_loss
            SELECT company_id, period_label, period_date,
                   "Raw material cost" AS raw_material_cost,
                   "Change in inventory" AS change_in_inventory
            FROM mc_pl
            """
        )

    # other_liabilities_balance_sheet (yearly)
    if "other_liabilities_balance_sheet" in schedules:
        ol_bs = schedules["other_liabilities_balance_sheet"].copy()
        ol_bs["company_id"] = company_id
        ol_bs["period_date"] = ensure_date(ol_bs["Date"])
        for col in [
            "Non controlling int",
            "Trade Payables",
            "Other liability items",
        ]:
            ol_bs[col] = ol_bs[col].apply(clean_numeric)
        ol_bs = ol_bs.rename(columns={"Period": "period_label"})
        con.execute(
            "DELETE FROM schedule_other_liabilities_balance_sheet WHERE company_id = ?",
            [company_id],
        )
        con.register("ol_bs", ol_bs)
        con.execute(
            """
            INSERT INTO schedule_other_liabilities_balance_sheet
            SELECT company_id, period_label, period_date,
                   "Non controlling int" AS non_controlling_int,
                   "Trade Payables" AS trade_payables,
                   "Other liability items" AS other_liability_items
            FROM ol_bs
            """
        )

    # fixed_assets_balance_sheet (yearly)
    if "fixed_assets_balance_sheet" in schedules:
        fa_bs = schedules["fixed_assets_balance_sheet"].copy()
        fa_bs["company_id"] = company_id
        fa_bs["period_date"] = ensure_date(fa_bs["Date"])

        for col in [
            "Land",
            "Building",
            "Plant Machinery",
            "Equipments",
            "Computers",
            "Furniture n fittings",
            "Vehicles",
            "Intangible Assets",
            "Other fixed assets",
            "Gross Block",
            "Accumulated Depreciation",
        ]:
            if col in fa_bs.columns:
                fa_bs[col] = fa_bs[col].apply(clean_numeric)

        fa_bs = fa_bs.rename(columns={"Period": "period_label"})
        con.execute(
            "DELETE FROM schedule_fixed_assets_balance_sheet WHERE company_id = ?",
            [company_id],
        )
        con.register("fa_bs", fa_bs)
        con.execute(
            """
            INSERT INTO schedule_fixed_assets_balance_sheet
            SELECT
                company_id, period_label, period_date,
                Land AS land,
                Building AS building,
                "Plant Machinery" AS plant_machinery,
                Equipments AS equipments,
                Computers AS computers,
                "Furniture n fittings" AS furniture_fittings,
                Vehicles AS vehicles,
                "Intangible Assets" AS intangible_assets,
                "Other fixed assets" AS other_fixed_assets,
                "Gross Block" AS gross_block,
                "Accumulated Depreciation" AS accumulated_depr
            FROM fa_bs
            """
        )

    # cash_from_operating_activity_cash_flow (yearly)
    if "cash_from_operating_activity_cash_flow" in schedules:
        cfo = schedules["cash_from_operating_activity_cash_flow"].copy()
        cfo["company_id"] = company_id
        cfo["period_date"] = ensure_date(cfo["Date"])
        for col in [
            "Profit from operations",
            "Receivables",
            "Inventory",
            "Payables",
            "Other WC items",
            "Working capital changes",
            "Interest paid",
            "Direct taxes",
        ]:
            cfo[col] = cfo[col].apply(clean_numeric)
        cfo = cfo.rename(columns={"Period": "period_label"})
        con.execute(
            "DELETE FROM schedule_cash_from_operating_activity WHERE company_id = ?",
            [company_id],
        )
        con.register("cfo", cfo)
        con.execute(
            """
            INSERT INTO schedule_cash_from_operating_activity
            SELECT company_id, period_label, period_date,
                   "Profit from operations" AS profit_from_operations,
                   Receivables AS receivables,
                   Inventory AS inventory,
                   Payables AS payables,
                   "Other WC items" AS other_wc_items,
                   "Working capital changes" AS working_capital_changes,
                   "Interest paid" AS interest_paid,
                   "Direct taxes" AS direct_taxes
            FROM cfo
            """
        )

# -----------------------
# Orchestrator
# -----------------------
def load_company_to_duckdb(data: dict, db_path: str = "screener_financials.duckdb"):
    con = duckdb.connect(db_path)
    try:
        con.execute("BEGIN")
        meta = data["meta"]
        company_id = meta["company_id"]

        store_raw_json(con, company_id, meta, data)
        load_meta_and_summary(con, data)
        load_quarterly_and_yearly(con, data)
        load_shareholding_pattern(con, data)
        load_peers(con, data)
        load_analysis(con, data)
        load_charts(con, data)
        load_schedules(con, data)

        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise
    finally:
        con.close()
