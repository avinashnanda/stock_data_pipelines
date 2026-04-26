# Strategy Lab Implementation Guide

This document explains what was added to the app for Strategy Lab, how it works, where the code lives, and how to continue building on top of it.

## Goal

Strategy Lab extends the existing TradingView-based app into a strategy research workspace where a user can:

- write Python strategies
- run backtests
- see metrics, trades, equity, and drawdown
- overlay buy and sell signals on the chart
- compare strategies
- optimize parameters
- save and reload strategies
- export results
- start a paper-trading session

The implementation was designed to fit the current app structure instead of replacing it.

## High-Level Architecture

Strategy Lab is split into 3 layers:

1. Frontend workspace
2. Web app HTTP routes
3. Strategy engine package

### Frontend workspace

The Strategy Lab UI lives in the web app and reuses the shared TradingView chart container.

Main files:

- [apps/web_app/partials/strategy-lab-view.html](/D:/projects/stock_data_pipelines/apps/web_app/partials/strategy-lab-view.html:1)
- [apps/web_app/css/strategy-lab.css](/D:/projects/stock_data_pipelines/apps/web_app/css/strategy-lab.css:1)
- [apps/web_app/js/strategy-lab.js](/D:/projects/stock_data_pipelines/apps/web_app/js/strategy-lab.js:1)
- [apps/web_app/js/strategy-editor.js](/D:/projects/stock_data_pipelines/apps/web_app/js/strategy-editor.js:1)
- [apps/web_app/js/strategy-storage.js](/D:/projects/stock_data_pipelines/apps/web_app/js/strategy-storage.js:1)
- [apps/web_app/js/strategy-signals.js](/D:/projects/stock_data_pipelines/apps/web_app/js/strategy-signals.js:1)

### HTTP route layer

The backend is still the existing Python `ThreadingHTTPServer`, with new Strategy Lab routes added into the route dispatcher.

Main files:

- [apps/web_app/server/handler.py](/D:/projects/stock_data_pipelines/apps/web_app/server/handler.py:1)
- [apps/web_app/server/routes_strategy.py](/D:/projects/stock_data_pipelines/apps/web_app/server/routes_strategy.py:1)

### Strategy engine package

The reusable research and execution logic lives in a dedicated package.

Main files:

- [packages/strategy_engine/runner.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/runner.py:1)
- [packages/strategy_engine/execution.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/execution.py:1)
- [packages/strategy_engine/sandbox.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/sandbox.py:1)
- [packages/strategy_engine/data.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/data.py:1)
- [packages/strategy_engine/metrics.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/metrics.py:1)
- [packages/strategy_engine/storage.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/storage.py:1)
- [packages/strategy_engine/adapters.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/adapters.py:1)
- [packages/strategy_engine/export.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/export.py:1)
- [packages/strategy_engine/live.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/live.py:1)
- [packages/strategy_engine/assistant.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/assistant.py:1)

## Frontend Implementation Details

## 1. View integration

Strategy Lab was added as a new tab in the main web app shell and loaded as an included partial.

Relevant files:

- [apps/web_app/index.html](/D:/projects/stock_data_pipelines/apps/web_app/index.html:1)
- [apps/web_app/app.js](/D:/projects/stock_data_pipelines/apps/web_app/app.js:1)

What happens:

- the main app has tabs for `Price`, `Screener`, `Strategy Lab`, `Announcements`, and `Hedge Fund`
- `switchView("strategylab")` shows the Strategy Lab pane
- the existing TradingView chart container is moved between the Price host and the Strategy Lab host using `syncChartHost(view)`

Important detail:

- the chart is not duplicated
- the app uses one shared TradingView widget container and rehosts it between views
- this is why chart-host sizing in shared CSS matters

## 2. Strategy Lab layout

The Strategy Lab layout is composed of:

- left sidebar
- center chart + editor region
- bottom results panel

Sidebar areas:

- scanner summary
- portfolio summary
- live runtime summary
- saved strategies
- recent backtests

Toolbar controls:

- symbol label
- timeframe
- start date
- end date
- run engine selector
- optimization engine selector
- export format
- run / compare / optimize / export / save buttons

Right editor tabs:

- code editor
- parameters
- logs
- live orders

Bottom results tabs:

- metrics
- trades
- equity curve
- drawdown
- compare strategies
- optimization results

## 3. Editor and starter strategy

The strategy editor uses Monaco when available and falls back to a textarea if the CDN cannot load.

Relevant file:

- [apps/web_app/js/strategy-editor.js](/D:/projects/stock_data_pipelines/apps/web_app/js/strategy-editor.js:1)

How it works:

- `initStrategyEditor()` loads Monaco dynamically
- `getStrategyCode()` reads from Monaco or fallback textarea
- `setStrategyCode(code)` writes to Monaco or fallback textarea
- `getDefaultStrategyTemplate()` returns the built-in starter strategy

Current starter strategy:

- simple SMA crossover
- buys when fast SMA crosses above slow SMA
- sells when fast SMA crosses below slow SMA

Why this matters:

- users now always start from a working strategy
- the `New` button feels useful immediately

## 4. Strategy Lab state controller

The main UI controller is [apps/web_app/js/strategy-lab.js](/D:/projects/stock_data_pipelines/apps/web_app/js/strategy-lab.js:1).

This file manages:

- initialization
- form reset
- strategy save/load
- backtest runs
- comparison
- optimization
- export
- backtest history loading
- paper trading controls
- AI strategy generation UI
- tab switching
- metrics rendering
- chart rendering for equity/drawdown/compare

Key functions:

- `initStrategyLab()`
- `resetStrategyForm()`
- `refreshStrategyList()`
- `refreshBacktestHistory()`
- `renderStrategyRunResponse(payload)`
- `runStrategyComparison()`
- `runStrategyOptimization()`
- `generateStrategyFromPrompt()`
- `startPaperSession()`
- `placePaperOrder()`

## 5. AI strategy prompt box

The new AI box is a lightweight local strategy generator, not a live LLM integration yet.

Relevant files:

- [apps/web_app/partials/strategy-lab-view.html](/D:/projects/stock_data_pipelines/apps/web_app/partials/strategy-lab-view.html:1)
- [apps/web_app/js/strategy-lab.js](/D:/projects/stock_data_pipelines/apps/web_app/js/strategy-lab.js:1)
- [apps/web_app/js/strategy-storage.js](/D:/projects/stock_data_pipelines/apps/web_app/js/strategy-storage.js:1)
- [packages/strategy_engine/assistant.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/assistant.py:1)

Current behavior:

- user enters a natural-language idea
- frontend posts to `POST /api/strategies/generate`
- backend maps the prompt into a starter template
- generated name, description, tags, params, and strategy code are written back into the editor

Current supported prompt families:

- moving average crossover
- EMA crossover
- RSI mean reversion
- breakout

This was designed as a safe local generator so the UI can already support “AI strategy generation” before plugging in external LLM providers.

## Backend Route Implementation

All Strategy Lab routes are handled in:

- [apps/web_app/server/routes_strategy.py](/D:/projects/stock_data_pipelines/apps/web_app/server/routes_strategy.py:1)

They are registered in:

- [apps/web_app/server/handler.py](/D:/projects/stock_data_pipelines/apps/web_app/server/handler.py:1)

### Strategy CRUD routes

- `GET /api/strategies`
- `POST /api/strategies`
- `GET /api/strategies/{id}`
- `PUT /api/strategies/{id}`
- `DELETE /api/strategies/{id}`

Used for:

- saved strategy list
- loading a saved strategy into the editor
- storing code, tags, description, and parameter schema

### Strategy generation route

- `POST /api/strategies/generate`

Used for:

- converting natural-language prompts into starter strategy code

### Backtest routes

- `POST /api/backtest/run`
- `GET /api/backtests`
- `GET /api/backtests/{run_id}`
- `POST /api/backtest/export`

Used for:

- running a strategy
- persisting completed runs
- loading historical runs
- exporting results

### Compare and optimize routes

- `POST /api/backtest/compare`
- `POST /api/backtest/optimize`
- `GET /api/backtest/optimize/{optimization_id}`

Used for:

- comparing multiple strategies
- async optimization jobs
- progress polling

### Capabilities route

- `GET /api/strategy-lab/capabilities`

Used for:

- engine availability
- paper session summaries
- enabling or disabling unavailable engine options in the UI

### Paper trading routes

- `GET /api/paper`
- `POST /api/paper/start`
- `POST /api/paper/order`
- `GET /api/paper/{session_id}`
- `POST /api/paper/{session_id}`

Used for:

- listing sessions
- starting paper trading
- placing paper orders
- loading session state
- stopping a session

## Strategy Engine Implementation Details

## 1. Data loading

Historical data is loaded through Yahoo Finance via the existing web-app adapter layer.

Relevant file:

- [packages/strategy_engine/data.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/data.py:1)

How it works:

- converts Strategy Lab date inputs into timestamps
- requests bars through `YFinanceSourceAdapter`
- normalizes into a pandas DataFrame with:
  - `time`
  - `open`
  - `high`
  - `low`
  - `close`
  - `volume`

## 2. Strategy compilation and execution

Relevant file:

- [packages/strategy_engine/execution.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/execution.py:1)

Core pieces:

- `compile_strategy_code(strategy_code)`
- `StrategyContext`
- `PositionState`
- `row_to_namespace(row)`

What the strategy code can do:

- define `initialize(ctx)`
- define `next(ctx, row)`
- access `ctx.params`
- access `ctx.state`
- read `ctx.data`
- log with `ctx.log(...)`
- create indicators with `ctx.indicator(...)`
- place orders with `ctx.buy()` and `ctx.sell()`

## 3. Sandbox validation

Relevant file:

- [packages/strategy_engine/sandbox.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/sandbox.py:1)

This was added to make user code safer before execution.

Current validation includes:

- empty-code rejection
- max code-length check
- AST parse validation
- required function checks for `initialize` and `next`
- import allowlist
- forbidden function-call checks
- forbidden attribute access checks
- complexity limit by AST node count

This is not a full subprocess sandbox yet, but it is much safer than raw `exec` without checks.

## 4. Metrics and result shaping

Relevant file:

- [packages/strategy_engine/metrics.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/metrics.py:1)

Returned result sections include:

- `metrics`
- `trades`
- `equity_curve`
- `drawdown_curve`
- `signals`
- `logs`
- `engine`
- `context`

The `context` block was added later so downstream features can reuse run metadata such as:

- symbol
- timeframe
- start/end date
- bar count
- last price

## 5. Runner orchestration

Relevant file:

- [packages/strategy_engine/runner.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/runner.py:1)

Main class:

- `StrategyRunner`

Main methods:

- `capabilities()`
- `run(request)`
- `compare(...)`
- `optimize(...)`

### `run()`

What it does:

- loads data
- resolves which engine to use
- runs the strategy
- injects engine metadata
- injects result context

### `compare()`

What it does:

- runs the current draft and/or saved strategies on the same dataset
- returns:
  - metrics table
  - equity curves
  - summary winner
  - engine metadata

### `optimize()`

What it does:

- expands the parameter grid
- validates `_constraints`
- runs parameter combinations
- ranks results
- returns:
  - best params
  - best metrics
  - leaderboard
  - heatmap payload
  - robustness zone
  - diagnostics
  - engine metadata

Important current limitation:

- the optimizer still uses the built-in loop because the current strategy DSL is bar-by-bar and stateful
- even if `vectorbt` is installed, the UI is told clearly when it falls back

## 6. Engine capability adapters

Relevant file:

- [packages/strategy_engine/adapters.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/adapters.py:1)

This file abstracts optional dependency detection.

It exposes:

- `get_engine_capabilities()`
- `resolve_run_engine(preferred)`
- `resolve_optimization_engine(preferred)`

Current engine behavior:

- run engine:
  - `auto`
  - `custom`
  - `backtesting`
- optimization engine:
  - `auto`
  - `custom`
  - `vectorbt`

If optional libraries are not installed:

- the app falls back to built-in logic
- the UI gets a warning

## 7. Backtesting.py adapter path

Relevant file:

- [packages/strategy_engine/runner.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/runner.py:1)

Method:

- `_run_backtesting_adapter(...)`

What it does:

- detects `backtesting.py`
- normalizes bar data into the schema expected by that library
- bridges the current Strategy Lab strategy callbacks into a `BacktestingStrategy`
- falls back to the built-in engine if the library is unavailable

Important note:

- this is an adapter layer, not a full rewrite of the DSL
- it gives a path to stronger engine execution without forcing a breaking UI change

## Persistence Implementation

Relevant file:

- [packages/strategy_engine/storage.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/storage.py:1)

The Strategy Lab DuckDB database is configured in:

- [config/paths.py](/D:/projects/stock_data_pipelines/config/paths.py:1)

Database file:

- `strategy_lab.duckdb`

Current tables:

- `strategies`
- `optimization_jobs`
- `backtest_runs`
- `paper_sessions`

### `strategies`

Stores:

- id
- name
- description
- code
- language
- tags
- parameter schema
- timestamps

### `optimization_jobs`

Stores:

- job id
- status
- progress/result/error payload
- timestamps

### `backtest_runs`

Stores:

- run id
- strategy id
- strategy name
- symbol
- timeframe
- date range
- full result payload

### `paper_sessions`

Stores:

- session id
- status
- full session payload
- timestamps

Important design choice:

- list endpoints return lightweight summaries when possible
- detail endpoints return full payloads

## Export Implementation

Relevant file:

- [packages/strategy_engine/export.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/export.py:1)

Export directory:

- `user_data/strategy_exports`

Supported formats:

- `json`
- `trades_csv`
- `equity_csv`

Route:

- `POST /api/backtest/export`

Used by:

- `Export Latest` button in Strategy Lab

## Paper Trading Implementation

Relevant file:

- [packages/strategy_engine/live.py](/D:/projects/stock_data_pipelines/packages/strategy_engine/live.py:1)

Main classes:

- `RiskManager`
- `PaperTradingSession`
- `PaperTradingManager`

Current behavior:

- start session with symbol and initial cash
- place manual paper orders
- update cash and positions
- keep recent orders and events
- stop session
- persist/reload session state

Current limits:

- no broker integration yet
- no streaming market feed yet
- no automated live strategy execution loop yet

Still, it establishes the contract needed for later live-trading milestones.

## Why The `New` Button Seemed To Do Nothing

Originally, `New` only:

- cleared internal state
- reset fields
- appended a log line

If the user was already looking at a blank-ish editor, there was no strong visual signal.

It now:

- loads a visible starter strategy
- fills name/description/tags/params
- resets run/result state
- switches back to the editor tab
- switches results back to metrics
- focuses the strategy name input

## Why The Price Chart Was Squeezed

The TradingView widget container is shared across views.

Files involved:

- [apps/web_app/app.js](/D:/projects/stock_data_pipelines/apps/web_app/app.js:1)
- [apps/web_app/css/layout.css](/D:/projects/stock_data_pipelines/apps/web_app/css/layout.css:1)
- [apps/web_app/css/strategy-lab.css](/D:/projects/stock_data_pipelines/apps/web_app/css/strategy-lab.css:1)

What happened:

- the chart container was being moved between hosts
- the Strategy Lab layout introduced stricter grid sizing
- the Price tab host did not explicitly reserve full host width/height

Fix applied:

- `chart-card` was made a grid container
- `#tv_chart_host` was given full width/height behavior
- `#tv_chart_container` was given explicit width and height rules

This prevents the Price tab from inheriting a tighter sizing context after the chart is moved back from Strategy Lab.

## How To Continue Building

Recommended next work items:

1. Replace the local strategy generator with live LLM provider integration.
2. Move strategy execution into a subprocess sandbox with timeout and resource limits.
3. Add a richer strategy DSL with reusable helpers like `ctx.crossed_above(...)`.
4. Add real broker connectors behind the paper/live interfaces.
5. Add persisted backtest filtering, tags, and search in the history panel.
6. Add export buttons per run instead of only “latest run”.
7. Make comparison and optimization results shareable snapshots.
8. Add unit tests for:
   - sandbox validation
   - parameter grid expansion
   - assistant prompt generation
   - backtest persistence
   - paper session persistence/restore

## Safe Mental Model For Future Work

When continuing work, think of Strategy Lab as 5 connected subsystems:

1. Editor and prompt-to-strategy generation
2. Backtest runner and metrics engine
3. Persistence and history
4. Optimization and comparison
5. Paper/live execution

Try to keep those boundaries clean. The current implementation is not perfect, but it was intentionally structured so each area can be upgraded without rewriting the whole product.
