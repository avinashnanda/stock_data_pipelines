# Implementation Plan: Finalizing Hedge Fund Integration & UI Polish

## Goal Description
Complete the transition of the Hedge Fund module into a fully integrated, premium-feeling tab within the TradingView UI. This includes:
- **Settings Dashboard**: A dedicated panel to manage all LLM providers (Cloud & Local).
- **Multi-Provider Support**: Exposing Ollama, LMStudio, and Custom models via the UI.
- **Backtesting Dashboard**: Bringing the engine's performance metrics into a dedicated sub-view.
- **Robustness**: Diagnostic cleanup of any residual `app` folder references causing `ModuleNotFoundError`.

## User Review Required
> [!IMPORTANT]
> **Unified UI Layout**: The Hedge Fund tab will now have 3 sub-views: **Analysis**, **Backtesting**, and **Settings**. 
> **LLM Selection**: Users can now select different models for different analysts if desired (advanced mode), or use a global setting.

## Open Questions
- Do you want the **Backtesting** results to be saved to a database for historical comparison, or just kept in-memory for the current session?

## Proposed Changes

### [TradingView UI - Backend]
#### [MODIFY] [server.py](file:///D:/projects/stock_data_pipelines/tradingview_ui/server.py)
- Add endpoints for Hedge Fund settings CRUD (integrated with `hedge_fund_db.py`).
- Add endpoint for backtesting execution (streaming progress via SSE).
- Add endpoint for available models from Ollama/LMStudio.

### [TradingView UI - Frontend]
#### [MODIFY] [hedgefund.js](file:///D:/projects/stock_data_pipelines/tradingview_ui/hedgefund.js)
- Implement the 3-tab layout: Analysis | Backtesting | Settings.
- **Analysis tab**: Add analyst selection (all 18 agents).
- **Settings tab**: UI for API keys and Endpoint management (Ollama, LMStudio, etc.).
- **Backtesting tab**: Form for parameters (date range, capital) and a results dashboard (ApexCharts + metrics table).

### [AI Hedge Fund - Backend]
#### [MODIFY] [services.py](file:///D:/projects/stock_data_pipelines/ai-hedge-fund/src/services.py)
- Refine `BacktestService` to provide more granular progress updates.
- Ensure `run_hedge_fund` correctly utilizes settings from `hedge_fund_db` for model provider selection.

## Verification Plan

### Automated Tests
- Test API key storage and retrieval in `hedge_fund_db.py`.
- Test SSE progress stream for a mock 2-day backtest.

### Manual Verification
- Verify that selecting "Ollama" in the Settings panel correctly updates the model list.
- Verify that a full "Run Analysis" with 18 agents completes without `ModuleNotFoundError`.

---

