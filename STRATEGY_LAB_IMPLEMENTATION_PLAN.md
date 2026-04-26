# Strategy Lab Implementation Plan

## Goal

Extend the existing desktop + web stock analysis app into a production-grade strategy research and backtesting platform without replacing the current architecture.

The plan below is tailored to the current repo:

- Web UI: `apps/web_app`
- Desktop shell: `apps/desktop_app`
- Python API server: `apps/web_app/server`
- Existing LLM/backtest subsystem: `packages/hedge_fund_engine`
- Writable local app data: `config/paths.py`

## Current Architecture Summary

The existing app already provides the right base primitives:

- TradingView chart bootstrapped from `apps/web_app/index.html` and `apps/web_app/app.js`
- Modular frontend JS/CSS/partials structure
- Thin Python request dispatcher in `apps/web_app/server/handler.py`
- Yahoo Finance adapter in `apps/web_app/server/adapters.py`
- Electron shell that starts the Python backend in `apps/desktop_app/main.js`
- Existing streaming backtest pattern in `apps/web_app/server/routes_hedgefund.py`

Recommendation: add a new first-class `Strategy Lab` feature slice instead of overloading the existing hedge-fund tab.

## Product Scope

### Phase 1

- TradingView chart with strategy signal overlays
- Monaco-based Python editor
- Backtest execution endpoint
- Metrics cards
- Trade list
- Equity curve
- Drawdown chart
- Save/load strategies

### Phase 2

- Strategy comparison
- Parameter optimization
- Optimization heatmap
- Best-params and robustness analysis

### Phase 3

- Paper trading
- Broker integrations
- Event-driven live compatibility
- Risk manager
- AI strategy assistant

## Target Feature Architecture

Introduce a new vertical slice named `strategy_lab`.

### Frontend

New frontend modules under `apps/web_app/js`:

- `strategy-lab.js`
- `strategy-editor.js`
- `strategy-results.js`
- `strategy-signals.js`
- `strategy-storage.js`
- `strategy-compare.js`
- `strategy-optimize.js`
- `split-layout.js`

New partials under `apps/web_app/partials`:

- `strategy-lab-view.html`
- `strategy-editor-panel.html`
- `strategy-bottom-tabs.html`
- `strategy-left-sidebar.html`

New CSS under `apps/web_app/css`:

- `strategy-lab.css`
- `strategy-editor.css`
- `strategy-results.css`

### Backend API

New route module:

- `apps/web_app/server/routes_strategy.py`

Wire into:

- `apps/web_app/server/handler.py`

### Quant Engine

Create a new package instead of coupling this to `hedge_fund_engine`.

New package:

- `packages/strategy_engine`

Suggested structure:

- `packages/strategy_engine/__init__.py`
- `packages/strategy_engine/runner.py`
- `packages/strategy_engine/models.py`
- `packages/strategy_engine/storage.py`
- `packages/strategy_engine/exceptions.py`
- `packages/strategy_engine/engines/backtesting_py_engine.py`
- `packages/strategy_engine/engines/vectorbt_engine.py`
- `packages/strategy_engine/engines/event_engine.py`
- `packages/strategy_engine/engines/base.py`
- `packages/strategy_engine/execution/sandbox.py`
- `packages/strategy_engine/execution/compiler.py`
- `packages/strategy_engine/metrics.py`
- `packages/strategy_engine/serialization.py`
- `packages/strategy_engine/data.py`
- `packages/strategy_engine/signals.py`

## Core Design Decisions

### 1. Keep the current app shell

Do not replace:

- `apps/web_app/index.html`
- `apps/web_app/app.js`
- `apps/desktop_app/main.js`

Instead, extend them with a new view and panel system.

### 2. Add a dedicated strategy workspace

Do not put research/backtesting into the current hedge-fund view. The hedge-fund module is LLM-agent-centric and already has its own UX and backend semantics.

### 3. Use a hybrid engine

- `backtesting.py` for fast single-strategy execution
- `vectorbt` for optimization and vectorized comparisons
- custom event-driven engine wrapper for future paper/live portability

### 4. Treat strategy code as untrusted

All user strategy execution must be isolated with:

- subprocess execution
- execution timeout
- import allowlist
- restricted globals
- structured stdout/stderr capture

## UI Plan

## Workspace Layout

Implement a new `Strategy Lab` view with this layout:

- Top navbar
- Left sidebar
- Center chart
- Right tabbed panel
- Bottom result tabs

### Top Navbar

Controls:

- symbol search
- data source
- timeframe
- date range
- Run Backtest
- Save Strategy
- Compare
- Optimize
- theme toggle

### Left Sidebar

Sections:

- watchlist
- scanner
- strategies
- backtests
- portfolio

### Center

- existing TradingView chart instance
- signal overlays
- optional highlighted trade regions later

### Right Panel Tabs

- Code Editor
- Parameters
- Logs
- Live Orders

### Bottom Tabs

- Metrics
- Trades
- Equity Curve
- Drawdown
- Compare Strategies
- Optimization Results

## Frontend Implementation Steps

### Step 1. Add a new view

Update:

- `apps/web_app/index.html`
- `apps/web_app/app.js`
- `apps/web_app/js/state.js`

Changes:

- add `Strategy Lab` tab beside Price/Screener/Announcements/Hedge Fund
- add a `strategylab-view` pane
- preserve current chart widget lifecycle

### Step 2. Split layout management

Add:

- `apps/web_app/js/split-layout.js`

Responsibilities:

- resizable left/center/right panes
- resizable bottom results panel
- persisted sizes in `localStorage`

Recommended library:

- `Split.js`

### Step 3. Monaco editor integration

Add:

- `apps/web_app/js/strategy-editor.js`

Responsibilities:

- lazy-load Monaco from CDN or local vendor bundle
- initialize Python editor
- expose `getCode()`, `setCode()`, `format()`, `insertTemplate()`
- keyboard shortcuts:
  - `Ctrl/Cmd+Enter` run
  - `Ctrl/Cmd+S` save
  - `Ctrl/Cmd+Shift+O` optimize

### Step 4. Result rendering

Add:

- `apps/web_app/js/strategy-results.js`
- `apps/web_app/js/strategy-signals.js`

Responsibilities:

- metric cards
- trade table
- equity/drawdown charts
- TradingView buy/sell markers
- compare overlay chart
- optimization heatmap rendering

### Step 5. Strategy storage UI

Add:

- `apps/web_app/js/strategy-storage.js`

Responsibilities:

- list saved strategies
- create/update/delete
- autosave draft
- last-open strategy restore

## Backend API Plan

Create `apps/web_app/server/routes_strategy.py`.

### Endpoints

#### Run Backtest

`POST /api/backtest/run`

Request:

```json
{
  "symbol": "NSE:RELIANCE",
  "timeframe": "1D",
  "start_date": "2024-01-01",
  "end_date": "2025-01-01",
  "strategy_code": "def initialize(ctx): pass\n\ndef next(ctx, row): pass",
  "params": {
    "ema_fast": 10,
    "ema_slow": 50
  }
}
```

Response:

```json
{
  "run_id": "bt_123",
  "metrics": {},
  "trades": [],
  "equity_curve": [],
  "drawdown_curve": [],
  "signals": [],
  "logs": []
}
```

#### Optimize

`POST /api/backtest/optimize`

Request:

```json
{
  "symbol": "NSE:RELIANCE",
  "timeframe": "1D",
  "start_date": "2024-01-01",
  "end_date": "2025-01-01",
  "strategy_code": "...",
  "parameter_grid": {
    "ema_fast": {"start": 5, "end": 20, "step": 1},
    "ema_slow": {"start": 30, "end": 100, "step": 5}
  },
  "objective": "sharpe"
}
```

Response:

```json
{
  "optimization_id": "opt_123",
  "best_params": {},
  "best_metrics": {},
  "leaderboard": [],
  "heatmap": [],
  "robustness_zone": []
}
```

#### Compare

`POST /api/backtest/compare`

Request:

```json
{
  "symbol": "NSE:RELIANCE",
  "timeframe": "1D",
  "start_date": "2024-01-01",
  "end_date": "2025-01-01",
  "strategies": [
    {"strategy_id": "strat_1"},
    {"strategy_id": "strat_2"}
  ]
}
```

Response:

```json
{
  "comparison_id": "cmp_123",
  "metrics_table": [],
  "equity_curves": [],
  "summary": {}
}
```

#### Strategy CRUD

- `GET /api/strategies`
- `GET /api/strategies/{id}`
- `POST /api/strategies`
- `PUT /api/strategies/{id}`
- `DELETE /api/strategies/{id}`

#### Backtest History

- `GET /api/backtests`
- `GET /api/backtests/{id}`

## Quant Engine Plan

## Public Abstraction

`packages/strategy_engine/runner.py`

```python
class StrategyRunner:
    def run(self, request): ...
    def optimize(self, request): ...
    def compare(self, request): ...
    def export(self, result, format): ...
```

### Request/Response Models

Define Pydantic dataclasses or typed dataclasses in `models.py`:

- `BacktestRunRequest`
- `BacktestRunResult`
- `OptimizationRequest`
- `OptimizationResult`
- `ComparisonRequest`
- `ComparisonResult`
- `StrategyDefinition`
- `StrategyParameterSpec`
- `TradeRecord`
- `SignalRecord`
- `EquityPoint`
- `MetricSet`

### Engine Adapters

#### `backtesting_py_engine.py`

Use for:

- single strategy backtests
- quick iteration
- straightforward strategy execution

Responsibilities:

- convert OHLCV DataFrame
- inject compiled strategy callbacks
- generate trades, equity, metrics, and signals

#### `vectorbt_engine.py`

Use for:

- parameter optimization
- comparison
- multi-run vectorized evaluation

Responsibilities:

- grid search
- top-N ranking
- heatmap generation
- robustness analysis

#### `event_engine.py`

Use for:

- future paper/live compatibility

Responsibilities:

- event objects
- signal generation contract
- order simulation
- position state
- broker gateway compatibility

## Strategy Execution Model

Support this user-facing strategy API first:

```python
def initialize(ctx):
    pass

def next(ctx, row):
    pass
```

### Context API

`ctx` should expose a stable research API:

- `ctx.params`
- `ctx.buy(size=1, stop_loss=None, take_profit=None)`
- `ctx.sell(size=1, stop_loss=None, take_profit=None)`
- `ctx.position`
- `ctx.cash`
- `ctx.equity`
- `ctx.indicator(name, series)`
- `ctx.log(message)`
- `ctx.state`

`row` should expose:

- `open`
- `high`
- `low`
- `close`
- `volume`
- `time`

This API should remain stable across:

- backtesting mode
- optimization mode
- future event-driven paper/live mode

## Data Layer Plan

### Market Data Source

Reuse:

- `apps/web_app/server/adapters.py`

Add a normalized bar loading utility in `packages/strategy_engine/data.py`.

Responsibilities:

- fetch OHLCV via existing adapter/server-compatible logic
- normalize columns to canonical schema
- cache bar sets for repeat runs
- support symbol/timeframe/date-range identity

### Canonical Bar Schema

All engines should operate on:

- `time`
- `open`
- `high`
- `low`
- `close`
- `volume`

### Caching

Add local cache for repeat backtests:

- raw bar cache
- normalized DataFrame cache
- optimization run cache

## Storage Plan

Use `config/paths.py` for writable persistence.

Add new paths:

- `STRATEGY_DB = DB_DIR / "strategy_lab.duckdb"`
- `STRATEGY_EXPORT_DIR = APP_DATA_DIR / "strategy_exports"`

### Suggested Tables

#### `strategies`

- `id`
- `name`
- `description`
- `code`
- `language`
- `parameter_schema_json`
- `tags_json`
- `created_at`
- `updated_at`

#### `strategy_runs`

- `id`
- `strategy_id`
- `symbol`
- `timeframe`
- `start_date`
- `end_date`
- `params_json`
- `engine`
- `status`
- `metrics_json`
- `created_at`

#### `strategy_run_artifacts`

- `run_id`
- `trades_json`
- `equity_curve_json`
- `drawdown_curve_json`
- `signals_json`
- `logs_json`

#### `strategy_optimizations`

- `id`
- `strategy_id`
- `symbol`
- `timeframe`
- `request_json`
- `best_params_json`
- `best_metrics_json`
- `leaderboard_json`
- `heatmap_json`
- `created_at`

## Signal Overlay Plan

Use TradingView chart markers/shapes.

Signal format:

```json
[
  {"time":"2025-01-10","type":"BUY","price":1234},
  {"time":"2025-01-20","type":"SELL","price":1260}
]
```

Frontend responsibilities:

- clear old shapes before new run
- batch-create markers after chart ready
- keep run-linked overlay state
- support compare mode with optional single-strategy overlay only

## Metrics Plan

Phase 1 metrics:

- CAGR
- Return %
- Max Drawdown
- Sharpe
- Sortino
- Win Rate
- Profit Factor
- Total Trades

Additional metrics worth supporting in engine models:

- expectancy
- average trade
- average win
- average loss
- exposure time
- Calmar ratio

## Comparison Plan

Comparison mode should not run ad hoc snippets only. It should primarily compare saved strategies or named snapshots.

Frontend:

- multiselect saved strategies
- metrics matrix
- normalized equity overlay
- winner/highlight column

Backend:

- fan out N runs using cached data
- aggregate metrics into comparable schema
- return aligned equity curves

## Optimization Plan

### UX

Parameter grid builder:

- integer range
- float range
- categorical list later

For EMA example:

- Fast EMA: 5 to 20
- Slow EMA: 30 to 100

### Engine behavior

- reject invalid combos such as `fast >= slow` when rule exists
- parallelize combinations where safe
- persist results incrementally for long jobs

### Outputs

- best params
- top leaderboard
- heatmap
- robustness zone
- overfit warning signals

## Security and Stability Plan

### Strategy code execution

Do not execute user code in-process inside the main request handler.

Use:

- subprocess worker
- temporary execution bundle
- timeout kill
- restricted import policy

Allow initially:

- builtins subset
- `math`
- `statistics`
- `numpy`
- `pandas`

Block initially:

- file writes
- shell access
- sockets
- arbitrary imports

### Job management

Long optimization runs should move to async job model quickly.

Recommended progression:

- Phase 1 backtests: synchronous request-response is acceptable
- Phase 2 optimization: add job queue with polling or SSE

## Testing Plan

### Backend tests

Add tests for:

- request validation
- strategy compilation
- run result schema
- metrics calculation
- signal extraction
- storage CRUD
- optimization ranking

Suggested locations:

- `tests/strategy_engine/test_runner.py`
- `tests/strategy_engine/test_storage.py`
- `tests/strategy_engine/test_compiler.py`
- `tests/web_app/test_routes_strategy.py`

### Frontend validation

Manual and automated checks:

- chart still loads
- strategy tab switching
- markers render and clear
- resize handles persist
- shortcuts work
- saved strategies reload

## Delivery Backlog

## Milestone 1: Strategy Lab shell

- add Strategy Lab tab and pane
- add split layout shell
- add placeholder right/bottom panels
- add state wiring and pane persistence

Files:

- `apps/web_app/index.html`
- `apps/web_app/app.js`
- `apps/web_app/js/state.js`
- `apps/web_app/partials/strategy-lab-view.html`
- `apps/web_app/css/strategy-lab.css`

## Milestone 2: Editor and storage

- integrate Monaco
- add strategy template
- add strategy CRUD API
- add save/load sidebar

Files:

- `apps/web_app/js/strategy-editor.js`
- `apps/web_app/js/strategy-storage.js`
- `apps/web_app/server/routes_strategy.py`
- `config/paths.py`
- `packages/strategy_engine/storage.py`

## Milestone 3: Backtest engine MVP

- add `StrategyRunner.run()`
- compile strategy code safely
- fetch canonical OHLCV data
- execute with `backtesting.py`
- return metrics, trades, equity, drawdown, signals, logs

Files:

- `packages/strategy_engine/runner.py`
- `packages/strategy_engine/engines/backtesting_py_engine.py`
- `packages/strategy_engine/execution/compiler.py`
- `packages/strategy_engine/execution/sandbox.py`
- `packages/strategy_engine/data.py`
- `apps/web_app/server/routes_strategy.py`

## Milestone 4: Results UX

- metrics cards
- trade table
- equity curve
- drawdown
- signal overlay

Files:

- `apps/web_app/js/strategy-results.js`
- `apps/web_app/js/strategy-signals.js`
- `apps/web_app/css/strategy-results.css`

## Milestone 5: Comparison

- compare saved strategies
- metrics matrix
- equity overlay

Files:

- `apps/web_app/js/strategy-compare.js`
- `packages/strategy_engine/runner.py`
- `packages/strategy_engine/models.py`

## Milestone 6: Optimization

- add `vectorbt` dependency
- implement optimization engine
- add heatmap UI
- add robustness analysis

Files:

- `pyproject.toml`
- `packages/strategy_engine/engines/vectorbt_engine.py`
- `apps/web_app/js/strategy-optimize.js`

## Milestone 7: Event-driven future compatibility

- add event abstractions
- unify signal/order/portfolio models
- prepare paper trading integration path

Files:

- `packages/strategy_engine/engines/event_engine.py`
- `packages/strategy_engine/models.py`

## Recommended Dependency Additions

Python:

- `backtesting`
- `vectorbt`

Frontend:

- Monaco Editor
- Split.js
- Grid.js or Tabulator

## Open Implementation Notes

### 1. Request model compatibility

The current server is plain `http.server`, not FastAPI. That is fine for now. Keep the request handling style consistent with `routes_core.py` and `routes_hedgefund.py`.

### 2. Desktop compatibility

No Electron architecture changes are required for Phase 1. The Electron shell already loads the same backend URL and will automatically inherit the new Strategy Lab view.

### 3. Persistence strategy

Use writable app-data paths from `config/paths.py` so the desktop packaged app stores strategy data outside bundled assets.

### 4. Live trading readiness

Do not let `backtesting.py` strategy internals leak into the public user strategy API. The user-facing `ctx` contract must remain platform-owned.

## Recommended Build Order

1. Strategy Lab shell
2. strategy CRUD storage
3. Monaco editor
4. backtesting run API
5. results rendering and chart overlays
6. comparison
7. optimization
8. event-driven abstraction
9. paper/live integration

## Immediate Next Step

Start Milestone 1 and Milestone 2 together:

- add the Strategy Lab view shell
- add strategy storage schema and endpoints
- wire Monaco editor

That gives the team a usable research workspace quickly while the execution engine is being completed behind it.
