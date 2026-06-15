from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock
from typing import Any


@dataclass
class SimulationState:
    running: bool = False
    paused: bool = False
    current_index: int = 0
    equity_list: list[dict[str, Any]] = field(default_factory=list)
    candle_list: list[dict[str, Any]] = field(default_factory=list)
    trades_list: list[dict[str, Any]] = field(default_factory=list)
    current_position: dict[str, Any] | None = None
    latest_price: float | None = None
    current_pnl: float = 0.0
    equity_peak: float = 100000.0
    max_drawdown: float = 0.0
    symbol: str = "BTCUSDT"
    timeframe: str = "1m"
    strategy_name: str = "basic_trend"
    speed: str = "normal"
    batch_size: int = 10
    max_trades: int = 0
    trades_completed: int = 0
    message: str = "idle"


state = SimulationState()
state_lock = Lock()


def reset_state() -> None:
    global state
    state.running = False
    state.paused = False
    state.current_index = 0
    state.equity_list.clear()
    state.candle_list.clear()
    state.trades_list.clear()
    state.current_position = None
    state.latest_price = None
    state.current_pnl = 0.0
    state.equity_peak = 100000.0
    state.max_drawdown = 0.0
    state.symbol = "BTCUSDT"
    state.timeframe = "1m"
    state.strategy_name = "basic_trend"
    state.speed = "normal"
    state.batch_size = 10
    state.max_trades = 0
    state.trades_completed = 0
    state.message = "idle"
