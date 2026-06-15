from __future__ import annotations

from pathlib import Path
from importlib.util import spec_from_file_location, module_from_spec
from typing import Any
import logging

import pandas as pd

from backend.state import state

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
STRATEGIES_DIR = PROJECT_ROOT / "strategies"
logger = logging.getLogger("quant_terminal.simulation")


def discover_strategies() -> list[str]:
    return sorted(
        path.stem
        for path in STRATEGIES_DIR.glob('*.py')
        if path.is_file() and not path.name.startswith('_')
    )


def _dataset_meta(path: Path) -> dict[str, Any] | None:
    try:
        if not path.exists() or path.stat().st_size == 0:
            return None
        with path.open('r', encoding='utf-8', errors='ignore') as f:
            header = f.readline().strip()
            rows = [line for line in f if line.strip()]
        if not header or not rows:
            return None
        return {
            'path': str(path),
            'rows': len(rows),
            'modified': path.stat().st_mtime,
        }
    except Exception:
        return None


def _csv_has_data(path: Path) -> bool:
    return _dataset_meta(path) is not None


def discover_assets() -> list[str]:
    assets = set()
    for path in DATA_DIR.glob('*.csv'):
        if not _csv_has_data(path):
            continue
        name = path.stem
        parts = name.split('_')
        if len(parts) >= 2:
            assets.add(parts[0])
    return sorted(assets)


def available_timeframes(symbol: str = 'BTCUSDT') -> list[str]:
    frames = []
    for timeframe in ['1m', '5m', '10m', '15m', '30m', '1h']:
        candidates = [
            DATA_DIR / f'{symbol}_{timeframe}_1y.csv',
            DATA_DIR / f'{symbol}_{timeframe}.csv',
        ]
        if any(_csv_has_data(path) for path in candidates):
            frames.append(timeframe)
    return frames


def dataset_status() -> dict[str, Any]:
    assets = discover_assets()
    result: dict[str, Any] = {'assets': {}, 'last_refresh': pd.Timestamp.utcnow().isoformat()}
    for asset in sorted(set(assets) | {'BTCUSDT', 'MNQ', 'MES'}):
        timeframes = {}
        latest_modified = None
        for timeframe in ['1m', '5m', '10m', '15m', '30m', '1h']:
            candidates = [
                DATA_DIR / f'{asset}_{timeframe}_1y.csv',
                DATA_DIR / f'{asset}_{timeframe}.csv',
            ]
            meta = None
            for candidate in candidates:
                meta = _dataset_meta(candidate)
                if meta:
                    break
            if meta and (latest_modified is None or meta['modified'] > latest_modified):
                latest_modified = meta['modified']
            timeframes[timeframe] = meta
        result['assets'][asset] = {
            'latest_modified': pd.to_datetime(latest_modified, unit='s', utc=True).isoformat() if latest_modified else None,
            'timeframes': timeframes,
        }
    return result


class SimulationEngine:
    def __init__(self) -> None:
        self.df: pd.DataFrame | None = None
        self.strategy = None
        self.starting_cash: float = 100000.0
        self.cash: float = self.starting_cash
        self.units: float = 0.0
        self.entry_price: float | None = None
        self.open_trade: dict[str, Any] | None = None

    def _load_strategy(self, strategy_name: str):
        strategy_path = STRATEGIES_DIR / f"{strategy_name}.py"
        if not strategy_path.exists():
            raise FileNotFoundError(f"Strategy not found: {strategy_path}")
        spec = spec_from_file_location(strategy_name, strategy_path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Could not load strategy: {strategy_name}")
        module = module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.BasicTrendStrategy()

    def _load_data(self, symbol: str, timeframe: str) -> pd.DataFrame:
        candidates = [
            DATA_DIR / f"{symbol}_{timeframe}_1y.csv",
            DATA_DIR / f"{symbol}_{timeframe}.csv",
        ]
        for path in candidates:
            if path.exists():
                df = pd.read_csv(path)
                time_col = "Open time" if "Open time" in df.columns else ("timestamp" if "timestamp" in df.columns else None)
                if time_col is not None:
                    df[time_col] = pd.to_datetime(df[time_col], utc=True, errors="coerce")
                    df = df.set_index(time_col)
                rename_map = {"open": "Open", "high": "High", "low": "Low", "close": "Close", "volume": "Volume"}
                df = df.rename(columns=rename_map)
                required = ["Open", "High", "Low", "Close"]
                missing = [c for c in required if c not in df.columns]
                if missing:
                    raise ValueError(f"Dataset missing columns: {missing}")
                return df
        raise FileNotFoundError(f"No dataset found for {symbol} {timeframe} in {DATA_DIR}")

    def start(self, strategy_name: str, symbol: str, timeframe: str, starting_cash: float = 100000.0, speed: str = "normal", max_trades: int = 0) -> None:
        self.strategy = self._load_strategy(strategy_name)
        self.df = self.strategy.prepare(self._load_data(symbol, timeframe))
        self.starting_cash = starting_cash
        self.cash = starting_cash
        self.units = 0.0
        self.entry_price = None
        self.open_trade = None

        state.running = True
        state.paused = False
        state.current_index = 0
        state.equity_list.clear()
        state.candle_list.clear()
        state.trades_list.clear()
        state.current_position = None
        state.latest_price = None
        state.current_pnl = 0.0
        state.equity_peak = starting_cash
        state.max_drawdown = 0.0
        speed_map = {"slow": 3, "normal": 10, "fast": 20}
        state.symbol = symbol
        state.timeframe = timeframe
        state.strategy_name = strategy_name
        state.speed = speed if speed in speed_map else "normal"
        state.batch_size = speed_map.get(state.speed, 10)
        state.max_trades = max(0, int(max_trades or 0))
        state.trades_completed = 0
        state.message = f"running ({state.speed})"
        logger.info("START | strategy=%s symbol=%s timeframe=%s start_cash=%.2f", strategy_name, symbol, timeframe, starting_cash)

    def _step_once(self) -> None:
        idx = state.current_index
        row = self.df.iloc[idx]
        ts = self.df.index[idx]
        price = float(row["Close"])
        candle_time = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
        state.candle_list.append({
            "timestamp": candle_time,
            "open": float(row["Open"]),
            "high": float(row["High"]),
            "low": float(row["Low"]),
            "close": float(row["Close"]),
        })
        in_position = self.units > 0
        action = self.strategy.signal(self.df, idx, in_position)

        if action == "buy" and not in_position:
            entry_time = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
            self.units = self.cash / price if price > 0 else 0.0
            self.entry_price = price
            self.cash = 0.0
            self.open_trade = {
                "entry_time": entry_time,
                "entry_price": price,
                "side": "long",
                "units": self.units,
            }
            state.current_position = {
                "side": "long",
                "entry_price": price,
                "entry_time": entry_time,
                "units": self.units,
            }
            state.trades_list.append({"action": "buy", "price": price, "timestamp": entry_time})
            logger.info("BUY | idx=%s price=%.2f units=%.6f", idx, price, self.units)
        elif action == "sell" and in_position:
            exit_time = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
            exit_value = self.units * price
            pnl = exit_value - (self.units * (self.entry_price or price))
            self.cash = exit_value
            completed_trade = {
                "entry_time": self.open_trade["entry_time"] if self.open_trade else None,
                "exit_time": exit_time,
                "entry_price": self.open_trade["entry_price"] if self.open_trade else self.entry_price,
                "exit_price": price,
                "side": "long",
                "units": self.open_trade["units"] if self.open_trade else self.units,
                "pnl": pnl,
            }
            state.trades_list.append({
                "action": "sell",
                "price": price,
                "timestamp": exit_time,
                "pnl": pnl,
                "entry_time": completed_trade["entry_time"],
                "entry_price": completed_trade["entry_price"],
            })
            state.trades_list.append({
                "action": "trade",
                **completed_trade,
            })
            state.trades_completed += 1
            logger.info("SELL | idx=%s price=%.2f pnl=%.2f", idx, price, pnl)
            self.units = 0.0
            self.entry_price = None
            self.open_trade = None
            state.current_position = None

        equity = self.cash if self.units == 0 else self.units * price
        pnl_value = equity - self.starting_cash
        state.latest_price = price
        state.current_pnl = pnl_value
        state.equity_peak = max(state.equity_peak, equity)
        if state.equity_peak > 0:
            drawdown = ((state.equity_peak - equity) / state.equity_peak) * 100.0
            state.max_drawdown = max(state.max_drawdown, drawdown)
        state.equity_list.append({
            "timestamp": candle_time,
            "equity": equity,
            "price": price,
            "pnl": pnl_value,
        })
        logger.info("STEP | idx=%s pnl=%.2f equity=%.2f", idx, pnl_value, equity)
        state.current_index += 1

    def step(self) -> dict[str, Any]:
        if self.df is None or self.strategy is None:
            return self.snapshot(message="not-started")
        if state.current_index >= len(self.df):
            state.running = False
            state.message = "finished"
            return self.snapshot(message="finished")

        steps = min(max(state.batch_size, 1), len(self.df) - state.current_index)
        for _ in range(steps):
            if state.current_index >= len(self.df):
                break
            if state.max_trades > 0 and state.trades_completed >= state.max_trades:
                state.running = False
                state.paused = False
                state.message = 'max-trades-reached'
                return self.snapshot(message='max-trades-reached')
            before_index = state.current_index
            self._step_once()
            if state.max_trades > 0 and state.trades_completed >= state.max_trades:
                state.running = False
                state.paused = False
                state.message = 'max-trades-reached'
                logger.info('MAX TRADES STOP | trades=%s limit=%s index=%s', state.trades_completed, state.max_trades, before_index)
                return self.snapshot(message='max-trades-reached')

        if state.current_index >= len(self.df):
            state.running = False
            state.message = "finished"
            return self.snapshot(message="finished")

        return self.snapshot()

    def snapshot(self, message: str | None = None) -> dict[str, Any]:
        total = len(self.df) if self.df is not None else 0
        candles = [
            {
                "timestamp": c["timestamp"],
                "open": float(c["open"]),
                "high": float(c["high"]),
                "low": float(c["low"]),
                "close": float(c["close"]),
            }
            for c in state.candle_list[-500:]
        ]
        return {
            "running": state.running,
            "paused": state.paused,
            "current_index": state.current_index,
            "total_bars": total,
            "current_equity": state.equity_list[-1]["equity"] if state.equity_list else self.starting_cash,
            "current_pnl": state.current_pnl,
            "equity_peak": state.equity_peak,
            "max_drawdown": state.max_drawdown,
            "latest_price": state.latest_price,
            "current_position": state.current_position,
            "trades": state.trades_list[-50:],
            "equity": state.equity_list[-500:],
            "candles": candles,
            "message": message or state.message,
            "strategy": state.strategy_name,
            "symbol": state.symbol,
            "timeframe": state.timeframe,
            "speed": state.speed,
            "batch_size": state.batch_size,
            "max_trades": state.max_trades,
            "trades_completed": state.trades_completed,
        }


engine = SimulationEngine()
