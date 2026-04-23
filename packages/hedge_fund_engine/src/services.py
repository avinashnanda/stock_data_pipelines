import json
import logging
import threading
import queue
import asyncio
import math
import pandas as pd
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Callable

from langchain_core.messages import HumanMessage
from langgraph.graph import END, StateGraph

from src.graph.state import AgentState
from src.agents.portfolio_manager import portfolio_management_agent
from src.agents.risk_manager import risk_management_agent
from src.utils.analysts import get_analyst_nodes, ANALYST_ORDER
from src.utils.progress import progress
from src.backtesting.engine import BacktestEngine
from src.backtesting.portfolio import Portfolio

logger = logging.getLogger(__name__)

def sanitize_json_value(v):
    if isinstance(v, (datetime, pd.Timestamp)):
        return v.isoformat()
    if isinstance(v, (float, int)) and (pd.isna(v) or math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, dict):
        return {k: sanitize_json_value(val) for k, val in v.items()}
    if isinstance(v, (list, tuple, set)):
        return [sanitize_json_value(val) for val in v]
    return v

def parse_hedge_fund_response(response: Any) -> Optional[Dict]:
    """Parses a JSON string and returns a dictionary."""
    if not response:
        return None
    if isinstance(response, dict):
        return response
    try:
        # Handle case where response might be a message object
        if hasattr(response, "content"):
            content = response.content
        else:
            content = str(response)
        return json.loads(content)
    except Exception as e:
        logger.error(f"Error parsing hedge fund response: {e}")
        return None

def start_node(state: AgentState):
    """Initialize the workflow with the input message."""
    return state

def create_workflow(selected_analysts: Optional[List[str]] = None):
    """Create the workflow with selected analysts."""
    workflow = StateGraph(AgentState)
    workflow.add_node("start_node", start_node)

    # Get analyst nodes from the configuration
    analyst_nodes = get_analyst_nodes()

    # Default to all analysts if none selected
    if selected_analysts is None:
        selected_analysts = list(analyst_nodes.keys())
    
    # Add selected analyst nodes
    for analyst_key in selected_analysts:
        if analyst_key not in analyst_nodes:
            continue
        node_name, node_func = analyst_nodes[analyst_key]
        workflow.add_node(node_name, node_func)
        workflow.add_edge("start_node", node_name)

    # Always add risk and portfolio management
    workflow.add_node("risk_management_agent", risk_management_agent)
    workflow.add_node("portfolio_manager", portfolio_management_agent)

    # Connect selected analysts to risk management
    for analyst_key in selected_analysts:
        if analyst_key not in analyst_nodes:
            continue
        node_name = analyst_nodes[analyst_key][0]
        workflow.add_edge(node_name, "risk_management_agent")

    workflow.add_edge("risk_management_agent", "portfolio_manager")
    workflow.add_edge("portfolio_manager", END)

    workflow.set_entry_point("start_node")
    return workflow

def run_hedge_fund(
    tickers: List[str],
    start_date: str,
    end_date: str,
    portfolio: Dict,
    show_reasoning: bool = False,
    selected_analysts: Optional[List[str]] = None,
    model_name: str = "gpt-4.1",
    model_provider: str = "OpenAI",
):
    """Executes the hedge fund graph for a single analysis run."""
    progress.start()
    try:
        workflow = create_workflow(selected_analysts)
        agent = workflow.compile()

        final_state = agent.invoke(
            {
                "messages": [
                    HumanMessage(
                        content="Make trading decisions based on the provided data.",
                    )
                ],
                "data": {
                    "tickers": tickers,
                    "portfolio": portfolio,
                    "start_date": start_date,
                    "end_date": end_date,
                    "analyst_signals": {},
                },
                "metadata": {
                    "show_reasoning": show_reasoning,
                    "model_name": model_name,
                    "model_provider": model_provider,
                },
            },
        )

        return {
            "messages": final_state["messages"],
            "data": final_state["data"],
        }
    finally:
        progress.stop()

class BacktestService:
    """Async wrapper for BacktestEngine to support progress streaming."""
    
    def __init__(
        self,
        tickers: List[str],
        start_date: str,
        end_date: str,
        initial_capital: float,
        model_name: str,
        model_provider: str,
        selected_analysts: Optional[List[str]] = None,
    ):
        self.tickers = tickers
        self.start_date = start_date
        self.end_date = end_date
        self.initial_capital = initial_capital
        self.model_name = model_name
        self.model_provider = model_provider
        self.selected_analysts = selected_analysts
        
        # This agent function follows the signature expected by AgentController in engine.py
        def agent_fn(tickers, start_date, end_date, portfolio, model_name, model_provider, selected_analysts):
            res = run_hedge_fund(
                tickers=tickers,
                start_date=start_date,
                end_date=end_date,
                portfolio=portfolio,
                show_reasoning=False,
                selected_analysts=selected_analysts,
                model_name=model_name,
                model_provider=model_provider
            )
            # engine.py expects a dict with 'decisions' and 'analyst_signals'
            return {
                "decisions": parse_hedge_fund_response(res["messages"][-1]),
                "analyst_signals": res["data"].get("analyst_signals", {})
            }

        self.engine = BacktestEngine(
            agent=agent_fn,
            tickers=tickers,
            start_date=start_date,
            end_date=end_date,
            initial_capital=initial_capital,
            model_name=model_name,
            model_provider=model_provider,
            selected_analysts=selected_analysts,
            initial_margin_requirement=0.0
        )

    async def run_backtest_async(self, progress_callback: Optional[Callable] = None):
        """Runs the backtest in a separate thread."""
        # The engine uses src.tools.api which calls progress.update_status.
        # So progress handlers registered globally will work automatically.
        
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, self.engine.run_backtest)
        
        return {
            "metrics": sanitize_json_value(result),
            "portfolio_values": sanitize_json_value(self.engine.get_portfolio_values())
        }
