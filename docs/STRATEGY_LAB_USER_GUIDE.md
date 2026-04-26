# Strategy Lab User Guide

This guide explains Strategy Lab in very simple language.

If you are new, think of Strategy Lab as a place where you can:

- write a trading idea
- test it on historical data
- see where it buys and sells
- compare strategies
- optimize settings
- save your work

## What You See On Screen

When you open `Strategy Lab`, the screen is divided into parts.

## Left side

This side shows:

- `New`
- saved strategies
- recent backtests
- simple summaries for scanner, portfolio, and runtime

### What `New` does

The `New` button starts a fresh strategy draft.

It will:

- clear the currently selected saved strategy
- load a simple starter strategy
- reset the metrics and results area
- take you back to the main editor

So if you want to start fresh, click `New`.

## Top toolbar

This area lets you choose:

- timeframe
- start date
- end date
- run engine
- optimization engine
- export format

And it has buttons for:

- `Run Backtest`
- `Compare Selected`
- `Optimize`
- `Export Latest`
- `Save Strategy`

## Center

This is the TradingView chart.

When your strategy runs:

- buy signals show on the chart
- sell signals show on the chart

## Right side tabs

These are:

- `Code Editor`
- `Parameters`
- `Logs`
- `Live Orders`

## Bottom tabs

These are:

- `Metrics`
- `Trades`
- `Equity Curve`
- `Drawdown`
- `Compare Strategies`
- `Optimization Results`

## The Simplest Way To Use Strategy Lab

Follow these steps:

1. Open `Strategy Lab`
2. Click `New`
3. Keep the default starter strategy
4. Choose a date range
5. Click `Run Backtest`
6. Check metrics, trades, and chart signals

This is the easiest way to see the system working.

## Starter Strategy

Every new draft starts with a simple moving average crossover strategy.

In plain English, it means:

- if the fast moving average goes above the slow moving average, buy
- if the fast moving average goes below the slow moving average, sell

This is just a starter. You can edit it any way you like.

## AI Strategy Box

Above the code editor, there is now a box for generating strategies from plain English.

It says:

- `Describe your indicator idea in natural language, turn it into a strategy.`

You can type ideas like:

- `Create an RSI oversold and overbought strategy`
- `Create an EMA crossover strategy`
- `Create a breakout strategy using the last 20 candles`

Then click:

- `Generate Strategy`

What happens next:

- Strategy Lab fills in the strategy name
- adds a description
- adds starter parameters
- writes code into the editor

This gives you a quick starting point.

## Example 1: Create A Strategy With The AI Box

Type this:

```text
Create an EMA crossover strategy with fast 10 and slow 30
```

Then click:

- `Generate Strategy`

You should see:

- a generated name
- generated tags
- generated parameter JSON
- Python strategy code in the editor

After that:

1. keep the dates as they are
2. click `Run Backtest`
3. check the chart and metrics

## Example 2: Use The Default Starter Strategy

1. Click `New`
2. Do not change the code
3. Set timeframe to `1D`
4. Pick one year of dates
5. Click `Run Backtest`

Then check:

- `Metrics` for return, Sharpe, max drawdown
- `Trades` for the trade list
- `Equity Curve` for account growth
- `Drawdown` for worst declines

## Parameters Tab

Open the `Parameters` tab if you want to change:

- strategy parameters
- optimization settings

### Parameter Schema / Default Params

This box is JSON.

Example:

```json
{
  "fast_length": 10,
  "slow_length": 30
}
```

If your strategy reads:

```python
ctx.params.get("fast_length", 10)
```

then this JSON is where you give it values.

## Run Backtest

Click `Run Backtest` after writing or generating a strategy.

What it does:

- sends your code to the backend
- loads historical data
- runs the strategy
- returns metrics, trades, equity, drawdown, signals, and logs

If the run works, Strategy Lab updates:

- chart signals
- metrics cards
- trade table
- equity chart
- drawdown chart
- logs

It also saves the run into `Recent Backtests`.

## Saved Strategies

If you want to keep a strategy for later, click:

- `Save Strategy`

This stores:

- strategy name
- description
- tags
- code
- parameter defaults

Later, click a saved strategy from the left sidebar to load it again.

## Recent Backtests

Every time you run a strategy, the result is stored.

You can open any recent run from the left sidebar.

When you click a backtest run:

- the metrics load again
- the trade list loads again
- equity and drawdown load again
- chart signals load again

This is useful when you want to review an old run without rerunning it.

## Metrics Tab

This tab shows a quick summary.

Typical metrics:

- CAGR
- Return %
- Max DD
- Sharpe
- Sortino
- Win Rate
- Profit Factor
- Total Trades

If you are new, start with these:

- `Return %`: how much the account grew or lost
- `Max DD`: worst peak-to-bottom drop
- `Sharpe`: risk-adjusted quality
- `Total Trades`: how active the strategy is

## Trades Tab

This shows the list of completed trades.

Columns:

- Date
- Side
- Qty
- Entry
- Exit
- PnL
- PnL %

Use this tab to answer:

- Is the strategy trading too often?
- Are losses too large?
- Are winners bigger than losers?

## Equity Curve Tab

This shows how the account value changed over time.

Use it to see:

- smooth growth
- flat behavior
- unstable jumps

## Drawdown Tab

This shows how much the strategy fell from its high points.

Use it to judge pain and risk.

A strategy with nice returns but terrible drawdowns may be hard to use in real life.

## Compare Selected

You can compare strategies side by side.

How:

1. save multiple strategies
2. check them in the `Saved Strategies` list
3. click `Compare Selected`

What you get:

- metrics table
- overlaid equity curves
- a simple winner summary

This helps answer:

- which strategy performed better on the same data
- which one had lower drawdown
- which one traded more or less

## Example 3: Compare Two Strategies

1. Save one SMA strategy
2. Generate and save one RSI strategy
3. Tick both saved strategies
4. Click `Compare Selected`

Now open:

- `Compare Strategies`

Look at:

- return %
- Sharpe
- max drawdown
- trade count

## Optimize

Optimization means:

- try many parameter combinations automatically
- rank the results

Example optimization grid:

```json
{
  "fast_length": { "start": 5, "end": 20, "step": 1 },
  "slow_length": { "start": 30, "end": 100, "step": 5 },
  "_constraints": ["fast_length < slow_length"]
}
```

This means:

- test many fast values
- test many slow values
- but only keep combinations where fast is smaller than slow

### How to use optimization

1. open `Parameters`
2. edit the optimization grid JSON
3. choose an optimization objective like `Sharpe`
4. click `Optimize`

Then open:

- `Optimization Results`

You will see:

- best params
- leaderboard
- diagnostics
- heatmap
- robustness zone

## What “robustness zone” means

If only one exact parameter set works and nearby values fail, the strategy may be fragile.

If many nearby values work well, it is more robust.

So this section helps you avoid overfitting.

## Export Latest

After you run or load a backtest, you can export it.

Choose export type from the toolbar:

- `JSON`
- `Trades CSV`
- `Equity CSV`

Then click:

- `Export Latest`

This creates a file in the local export folder.

Use this if you want:

- a raw result snapshot
- a CSV of trades
- a CSV of equity points

## Logs Tab

This tab shows messages from the run.

Use it when:

- the strategy fails
- generation fails
- optimization fails
- you want to see engine warnings

If something goes wrong, check `Logs` first.

## Live Orders Tab

This is the beginning of paper trading support.

You can:

- start a paper session
- place manual paper orders
- stop the session
- see recent paper orders

This does not send real broker orders.

It is only for local paper tracking right now.

## Example 4: Start A Paper Session

1. Open `Live Orders`
2. Click `Start Paper Session`
3. Enter:
   - side
   - quantity
   - price
4. Click `Send Order`

What happens:

- the app updates the paper portfolio
- cash changes
- position changes
- order appears in the table

## Engine Selectors

There are two engine selectors in the toolbar.

### Run Engine

Options:

- `Auto`
- `Built-in`
- `backtesting.py`

### Optimization Engine

Options:

- `Auto`
- `Built-in`
- `vectorbt`

Simple advice:

- use `Auto` unless you are testing engine behavior

If a library is not installed, the app falls back safely and tells you in logs or diagnostics.

## Very Simple Beginner Workflow

If you want the easiest path, do this:

1. Click `New`
2. Leave the default strategy
3. Pick a date range
4. Click `Run Backtest`
5. Read the `Metrics`
6. Open `Trades`
7. Save the strategy
8. Generate another idea with the AI box
9. Run it
10. Compare both strategies

That is enough to start using Strategy Lab productively.

## Common Problems

## “New does nothing”

Now it should visibly load a fresh starter strategy.

If it still looks unchanged:

- check whether you already had the same starter strategy loaded
- look at the name, params, and description fields

## “Generate Strategy did nothing”

Check:

- did you type a prompt?
- did the `strategy-generate-status` message update?
- did the `Logs` tab show an error?

## “Backtest failed”

Go to:

- `Logs`

Common causes:

- bad JSON in parameters
- invalid strategy code
- unsupported imports
- no historical data for that symbol/date/timeframe

## “Optimization is slow”

This is normal if:

- the grid is very large
- the strategy is complex

Try:

- smaller ranges
- larger step size
- fewer parameters

## Good Example Prompts For The AI Box

Try these:

```text
Create an RSI mean reversion strategy
```

```text
Create an EMA crossover strategy for trend following
```

```text
Create a breakout strategy using a 20 candle high and low
```

```text
Create a simple moving average crossover strategy
```

## Final Tip

Do not try to make the perfect strategy immediately.

Start small:

- one simple idea
- one clean parameter set
- one clear backtest

Then improve step by step.

That is the best way to use Strategy Lab.
