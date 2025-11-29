-- companies: static meta
CREATE TABLE IF NOT EXISTS companies (
    company_id      VARCHAR PRIMARY KEY,
    warehouse_id    VARCHAR,
    company_name    VARCHAR,
    source_url      VARCHAR
);

CREATE TABLE IF NOT EXISTS raw_company_json (
    company_id VARCHAR PRIMARY KEY,
    source_url VARCHAR,
    scraped_at TIMESTAMP,
    payload_json JSON
);

CREATE TABLE chart_pbv (
    company_id VARCHAR,
    date DATE,
    pbv DOUBLE,
    median_pbv DOUBLE,
    book_value DOUBLE
);

-- summary snapshot (point-in-time data from `summary` dict)
CREATE TABLE IF NOT EXISTS company_summary (
    company_id              VARCHAR,
    as_of                   DATE,
    market_cap_raw          VARCHAR,
    current_price_raw       VARCHAR,
    high_low_raw            VARCHAR,
    stock_pe_raw            VARCHAR,
    book_value_raw          VARCHAR,
    dividend_yield_raw      VARCHAR,
    roce_raw                VARCHAR,
    roe_raw                 VARCHAR,
    face_value_raw          VARCHAR,
    created_at              TIMESTAMP DEFAULT now()
);

-- generic quarterly financials (from quarterly_results)
CREATE TABLE IF NOT EXISTS financials_quarterly (
    company_id  VARCHAR,
    period      DATE,
    statement   VARCHAR,  -- e.g. 'quarterly_results'
    item        VARCHAR,  -- row name from 'Item' column
    value       DOUBLE
);

-- generic yearly financials (P&L, Balance Sheet, Cash flows, Ratios)
CREATE TABLE IF NOT EXISTS financials_yearly (
    company_id  VARCHAR,
    period      DATE,
    statement   VARCHAR,  -- one of: 'profit_and_loss', 'balance_sheet', 'cash_flows', 'ratios'
    item        VARCHAR,
    value       DOUBLE
);

-- shareholding pattern (quarterly)
CREATE TABLE IF NOT EXISTS shareholding_pattern (
    company_id          VARCHAR,
    period              DATE,
    promoters_pct       DOUBLE,
    fiis_pct            DOUBLE,
    diis_pct            DOUBLE,
    government_pct      DOUBLE,
    public_pct          DOUBLE,
    shareholders_count  BIGINT
);

-- peers table (from peers_api)
CREATE TABLE IF NOT EXISTS peers (
    company_id              VARCHAR,
    peer_name               VARCHAR,
    cmp                     DOUBLE,    -- CMP Rs.
    pe                      DOUBLE,    -- P/E
    market_cap_cr           DOUBLE,    -- Mar Cap Rs.Cr.
    div_yield_pct           DOUBLE,    -- Div Yld %
    np_qtr_cr               DOUBLE,    -- NP Qtr Rs.Cr.
    qtr_profit_var_pct      DOUBLE,
    sales_qtr_cr            DOUBLE,
    qtr_sales_var_pct       DOUBLE,
    roce_pct                DOUBLE
);

-- analysis: pros/cons JSON + about text
CREATE TABLE IF NOT EXISTS analysis_insights (
    company_id  VARCHAR PRIMARY KEY,
    pros        JSON,
    cons        JSON,
    about       TEXT
);

-- core chart: price + DMA + volume
CREATE TABLE IF NOT EXISTS chart_price_dma_volume (
    company_id  VARCHAR,
    date        DATE,
    price       DOUBLE,
    dma50       DOUBLE,
    dma200      DOUBLE,
    volume      BIGINT,
    delivery_pct DOUBLE
);

-- chart: PE / EPS
CREATE TABLE IF NOT EXISTS chart_pe_eps (
    company_id          VARCHAR,
    date                DATE,
    eps                 DOUBLE,
    price_to_earning    DOUBLE,
    median_pe           DOUBLE
);

-- chart: margins vs sales
CREATE TABLE IF NOT EXISTS chart_margins_sales (
    company_id      VARCHAR,
    date            DATE,
    gpm             DOUBLE,
    opm             DOUBLE,
    npm             DOUBLE,
    quarter_sales   DOUBLE
);

-- chart: EV / EBITDA
CREATE TABLE IF NOT EXISTS chart_ev_ebitda (
    company_id          VARCHAR,
    date                DATE,
    ev_multiple         DOUBLE,
    median_ev_multiple  DOUBLE,
    ebitda              DOUBLE
);

-- chart: Market cap / Sales
CREATE TABLE IF NOT EXISTS chart_mcap_sales (
    company_id              VARCHAR,
    date                    DATE,
    mcap_to_sales           DOUBLE,
    median_mcap_to_sales    DOUBLE,
    sales                   DOUBLE
);

-- schedules: quarterly sales growth
CREATE TABLE IF NOT EXISTS schedule_sales_quarterly (
    company_id          VARCHAR,
    period_label        VARCHAR,
    period_date         DATE,
    yoy_sales_growth    DOUBLE
);

-- schedules: quarterly expenses mix
CREATE TABLE IF NOT EXISTS schedule_expenses_quarterly (
    company_id          VARCHAR,
    period_label        VARCHAR,
    period_date         DATE,
    material_cost_pct   DOUBLE,
    employee_cost_pct   DOUBLE
);

-- schedules: quarterly other income
CREATE TABLE IF NOT EXISTS schedule_other_income_quarterly (
    company_id              VARCHAR,
    period_label            VARCHAR,
    period_date             DATE,
    exceptional_items       DOUBLE,
    other_income_normal     DOUBLE
);

-- schedules: quarterly net profit bridge
CREATE TABLE IF NOT EXISTS schedule_net_profit_quarterly (
    company_id              VARCHAR,
    period_label            VARCHAR,
    period_date             DATE,
    minority_share          DOUBLE,
    exceptional_items_at    DOUBLE,
    profit_excl_excep       DOUBLE,
    profit_for_pe           DOUBLE,
    profit_for_eps          DOUBLE,
    yoy_profit_growth       DOUBLE
);

-- schedules: yearly sales growth (P&L)
CREATE TABLE IF NOT EXISTS schedule_sales_profit_loss (
    company_id          VARCHAR,
    period_label        VARCHAR,
    period_date         DATE,
    sales_growth_pct    DOUBLE
);

-- schedules: yearly other income (P&L)
CREATE TABLE IF NOT EXISTS schedule_other_income_profit_loss (
    company_id              VARCHAR,
    period_label            VARCHAR,
    period_date             DATE,
    exceptional_items       DOUBLE,
    other_income_normal     DOUBLE
);

-- schedules: yearly net profit (P&L)
CREATE TABLE IF NOT EXISTS schedule_net_profit_profit_loss (
    company_id              VARCHAR,
    period_label            VARCHAR,
    period_date             DATE,
    profit_from_associates  DOUBLE,
    minority_share          DOUBLE,
    exceptional_items_at    DOUBLE,
    profit_excl_excep       DOUBLE,
    profit_for_pe           DOUBLE,
    profit_for_eps          DOUBLE
);

-- schedules: yearly material cost (P&L)
CREATE TABLE IF NOT EXISTS schedule_material_cost_profit_loss (
    company_id              VARCHAR,
    period_label            VARCHAR,
    period_date             DATE,
    raw_material_cost       DOUBLE,
    change_in_inventory     DOUBLE
);

-- schedules: fixed assets breakdown (Balance Sheet)
CREATE TABLE IF NOT EXISTS schedule_fixed_assets_balance_sheet (
    company_id              VARCHAR,
    period_label            VARCHAR,
    period_date             DATE,
    land                    DOUBLE,
    building                DOUBLE,
    plant_machinery         DOUBLE,
    equipments              DOUBLE,
    computers               DOUBLE,
    furniture_fittings      DOUBLE,
    vehicles                DOUBLE,
    intangible_assets       DOUBLE,
    other_fixed_assets      DOUBLE,
    gross_block             DOUBLE,
    accumulated_depr        DOUBLE
);

-- schedules: yearly expenses (P&L) – from schedules.expenses_profit_loss
CREATE TABLE IF NOT EXISTS schedule_expenses_profit_loss (
    company_id              VARCHAR,
    period_label            VARCHAR,
    period_date             DATE,
    material_cost_pct       DOUBLE,
    manufacturing_cost_pct  DOUBLE,
    employee_cost_pct       DOUBLE,
    other_cost_pct          DOUBLE
);

-- schedules: other liabilities breakdown (Balance Sheet)
-- from schedules.other_liabilities_balance_sheet
CREATE TABLE IF NOT EXISTS schedule_other_liabilities_balance_sheet (
    company_id              VARCHAR,
    period_label            VARCHAR,
    period_date             DATE,
    non_controlling_int     DOUBLE,
    trade_payables          DOUBLE,
    other_liability_items   DOUBLE
);

-- schedules: cash from operating activity (Cash Flow)
-- from schedules.cash_from_operating_activity_cash_flow
CREATE TABLE IF NOT EXISTS schedule_cash_from_operating_activity (
    company_id              VARCHAR,
    period_label            VARCHAR,
    period_date             DATE,
    profit_from_operations  DOUBLE,
    receivables             DOUBLE,
    inventory               DOUBLE,
    payables                DOUBLE,
    other_wc_items          DOUBLE,
    working_capital_changes DOUBLE,
    interest_paid           DOUBLE,
    direct_taxes            DOUBLE
);
