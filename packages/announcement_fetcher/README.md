# Announcement Fetcher Module

The `announcement_fetcher` is a core background service of the Stock Data Pipeline. It automates the monitoring, ingestion, analysis, and notification of corporate announcements from the National Stock Exchange (NSE).

## Features

- **Automated Monitoring**: Regularly polls the NSE API for new corporate filings.
- **Intelligent Filtering**:
  - **Market Cap Filter**: Focuses on high-impact companies (default > ₹5,000 Cr market cap).
  - **Content Filtering**: Automatically skips routine announcements like ESOP grants, meeting notices without transcripts, and generic financial results (which are handled by other pipelines).
- **AI-Powered Summarization**:
  - Uses local LLMs (via LMStudio) to read lengthy PDF announcements.
  - Extracts key financial, strategic, and corporate insights.
  - Generates structured Markdown summaries and catchy titles.
- **Sentiment Analysis**: Classifies announcements as **POSITIVE**, **NEGATIVE**, or **NEUTRAL** using LLM-based sentiment prediction.
- **Slack Integration**: Sends real-time alerts to specific Slack channels:
  - `#corporate_announcements_positive`: For positive sentiment.
  - `#corporate_announcements_negative`: For negative sentiment.
  - `#corporate_announcements_neutral`: For neutral sentiment.
  - `#financial_results_declared`: For raw financial result updates.
  - `#record_date_declared`: For record date and dividend announcements.
- **Persistent Storage**: All processed announcements are stored in a local DuckDB instance (`announcements.duckdb`) for historical analysis and UI display.

## System Architecture

The module consists of several specialized components:

- **`fetcher.py`**: The orchestrator. Manages the background loop, applies filtering logic, and coordinates between fetching, summarizing, and storing.
- **`pdf_utils.py`**: Handles low-level data ingestion. Uses Selenium to bypass NSE bot detection, downloads PDFs, and extracts text using `pdfminer`.
- **`summarize.py`**: Contains the LLM logic. It handles text chunking (using the `phi-4` tokenizer), recursive summarization, and sentiment analysis.
- **`prompts.py`**: Defines the prompt templates used for chunk-wise summarization, final synthesis, and sentiment classification.
- **`slack_utils.py`**: Manages outgoing notifications to Slack.
- **`helper.py`**: Provides utility functions for fetching fundamental data (Market Cap, etc.) which the fetcher uses for filtering.
- **`db/db_utils.py`**: (Located in project root) Handles DuckDB persistence.

## Prerequisites

1. **LMStudio**: Must be running locally with an OpenAI-compatible API server.
   - **Base URL**: `http://localhost:1234/v1`
   - **Model**: Any capable local model (e.g., Llama 3, Phi-4, or Mistral).
2. **Chrome Browser**: Required for Selenium to fetch NSE cookies.
3. **Environment Variables**:
   - `SLACK_TOKEN`: Required for Slack notifications.
4. **Dependencies**: Ensure all requirements are installed (e.g., `uv sync` from the project root).

## How to Run

The fetcher is designed to run as a background thread within the main application environment.

### Integration in Code
```python
from announcement_fetcher.fetcher import start_fetcher, stop_fetcher, get_fetcher_status

# Start the background service
start_fetcher()

# Check status
status = get_fetcher_status()
print(f"Processed {status['processed']} of {status['total']} announcements.")

# Stop the service
stop_fetcher()
```

### Configuration
- **Market Cap Threshold**: Configurable in `fetcher.py` (default is 5000 Cr).
- **Fetch Interval**: Currently set to check for new announcements every 10 minutes.
- **Excluded Symbols/Subjects**: Managed via `DATA_DIR / "Unwanted_announcements.csv"`.

## Data Flow Walkthrough

1. **Cookie Generation**: The module starts a headless Chrome instance to visit NSE and grab valid session cookies.
2. **CSV Fetching**: It downloads the latest corporate announcements CSV from NSE using the captured cookies.
3. **Filtering**:
   - Compares symbols against the "Monitored Universe" (Market Cap > 5k, fetched via `helper.py`).
   - Checks against `announcements.duckdb` to skip already processed PDFs.
   - Filters out subjects found in `Unwanted_announcements.csv`.
4. **PDF Processing**:
   - Downloads the PDF attachment.
   - Extracts raw text and cleans it of "noisy" short paragraphs.
   - Splits text into manageable chunks for the LLM.
5. **AI Analysis**:
   - **Step 1**: Summarizes each chunk.
   - **Step 2**: Synthesizes chunk summaries into a final Markdown summary and a concise Title.
   - **Step 3**: Predicts sentiment based on the summary.
6. **Storage & Notification**:
   - Saves the result to the database.
   - Posts a formatted message to Slack.

## Troubleshooting

- **"Failed to download PDF"**: Ensure LMStudio is not blocking the thread or that your internet connection to NSE is stable. NSE sometimes rate-limits requests; the fetcher includes headers and cookies to mitigate this.
- **LMStudio Connection Error**: Verify LMStudio is running and the "Local Server" is enabled on port 1234.
- **Empty Summaries**: Check if the PDF is image-based (OCR is not currently implemented) or if the text extraction failed.
