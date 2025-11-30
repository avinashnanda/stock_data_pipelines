-- db_schema.sql

-- Basic company metadata (one row per company)
CREATE TABLE IF NOT EXISTS companies (
    company_id      VARCHAR PRIMARY KEY,
    warehouse_id    VARCHAR,
    company_name    VARCHAR,
    source_url      VARCHAR
);

-- Raw full JSON snapshot per scrape
-- You can use (company_id, scraped_at) as composite key, or just append.
CREATE TABLE IF NOT EXISTS raw_company_json (
    company_id   VARCHAR,
    source_url   VARCHAR,
    scraped_at   TIMESTAMP,
    payload_json JSON,
    PRIMARY KEY (company_id, scraped_at)
);

-- Companies where scraping failed after all retries
CREATE TABLE IF NOT EXISTS failed_companies (
    company_id VARCHAR,
    source_url VARCHAR,
    failure_reason VARCHAR,
    last_attempt TIMESTAMP
);
