from __future__ import annotations

import logging
import os
from statistics import mean

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.simulation import available_timeframes, dataset_status, discover_assets, discover_strategies, engine
from backend.state import reset_state, state

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')
logger = logging.getLogger('quant_terminal.api')
logger.info('QUANT TERMINAL RUNNING ON 8030')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, 'frontend')
INDEX_FILE = os.path.join(FRONTEND_DIR, 'index.html')

if not os.path.isdir(FRONTEND_DIR):
    raise RuntimeError(f'Frontend directory not found: {FRONTEND_DIR}')
if not os.path.isfile(INDEX_FILE):
    raise RuntimeError(f'Frontend entrypoint not found: {INDEX_FILE}')

print('Serving frontend from:', INDEX_FILE)

RUN_HISTORY: list[dict] = []

app = FastAPI(title="Quant Terminal Backend")
app.mount('/frontend', StaticFiles(directory=FRONTEND_DIR), name='frontend')


class StartRequest(BaseModel):
    strategy: str = "basic_trend"
    symbol: str = "BTCUSDT"
    timeframe: str = "1m"
    starting_cash: float = 100000.0
    speed: str = "normal"
    max_trades: int = 0


class BatchRunRequest(BaseModel):
    symbol: str = "BTCUSDT"
    timeframe: str = "1m"
    starting_cash: float = 100000.0
    speed: str = "fast"
    max_trades: int = 0
    strategies: list[str] | None = None


@app.get('/')
def serve_index():
    return FileResponse(INDEX_FILE)


@app.get('/identity')
def identity():
    return {
        'project': 'backtest-quant',
        'service': 'Quant Terminal Backend',
        'port': 8030,
        'frontend_root': INDEX_FILE,
    }


@app.get('/strategies')
def strategies():
    return {'strategies': discover_strategies()}


@app.get('/availability')
def availability(symbol: str = 'BTCUSDT'):
    status = dataset_status()
    return {
        'symbol': symbol,
        'assets': discover_assets(),
        'timeframes': available_timeframes(symbol),
        'dataset_status': status['assets'],
        'last_refresh': status['last_refresh'],
    }


@app.get('/runs')
def runs():
    best_id = max(RUN_HISTORY, key=lambda r: r.get('score', float('-inf')))['id'] if RUN_HISTORY else None
    return {
        'runs': [
            {
                **run,
                'best': run['id'] == best_id,
            }
            for run in RUN_HISTORY[-50:]
        ]
    }


@app.post('/clear-runs')
def clear_runs():
    RUN_HISTORY.clear()
    return {'ok': True, 'runs': []}


def _build_run_record() -> dict:
    completed = [t for t in state.trades_list if t.get('action') == 'trade']
    pnls = [float(t.get('pnl', 0.0)) for t in completed]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    equity_values = [float(point.get('equity', 0.0)) for point in state.equity_list if point.get('equity') is not None]
    returns = []
    for i in range(1, len(equity_values)):
        prev = equity_values[i - 1]
        curr = equity_values[i]
        if prev:
            returns.append((curr - prev) / prev)
    sharpe_like = 0.0
    if len(returns) > 1:
        avg_return = mean(returns)
        variance = mean([(r - avg_return) ** 2 for r in returns])
        std = variance ** 0.5
        sharpe_like = (avg_return / std) * (len(returns) ** 0.5) if std > 0 else 0.0
    winrate = (len(wins) / len(completed) * 100.0) if completed else 0.0
    total_pnl = float(state.current_pnl)
    max_drawdown = float(state.max_drawdown)
    score = (total_pnl * 0.4) + (winrate * 0.2) + (float(sharpe_like) * 0.2) - (max_drawdown * 0.2)
    return {
        'id': len(RUN_HISTORY) + 1,
        'current_index': state.current_index,
        'strategy': state.strategy_name,
        'symbol': state.symbol,
        'timeframe': state.timeframe,
        'speed': state.speed,
        'max_trades': state.max_trades,
        'total_pnl': total_pnl,
        'equity_peak': float(state.equity_peak),
        'max_drawdown': max_drawdown,
        'sharpe_like': float(sharpe_like),
        'score': float(score),
        'winrate': winrate,
        'trades': len(completed),
        'avg_win': mean(wins) if wins else 0.0,
        'avg_loss': mean(losses) if losses else 0.0,
    }


def _record_run() -> None:
    RUN_HISTORY.append(_build_run_record())


@app.post('/start')
def start(req: StartRequest):
    try:
        reset_state()
        engine.df = None
        engine.strategy = None
        engine.cash = req.starting_cash
        engine.units = 0.0
        engine.entry_price = None
        engine.start(req.strategy, req.symbol, req.timeframe, req.starting_cash, req.speed, req.max_trades)
        return {"ok": True, "message": "simulation started"}
    except FileNotFoundError as e:
        logger.error("START failed: %s", e)
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("START failed")
        raise HTTPException(status_code=400, detail=str(e))


@app.post('/run-all')
def run_all(req: BatchRunRequest):
    available = set(discover_strategies())
    strategies_list = req.strategies if req.strategies else list(available)
    invalid = [name for name in strategies_list if name not in available]
    if invalid:
        raise HTTPException(status_code=400, detail=f'Unknown strategies: {invalid}')
    batch_results = []
    for strategy_name in strategies_list:
        try:
            reset_state()
            engine.df = None
            engine.strategy = None
            engine.cash = req.starting_cash
            engine.units = 0.0
            engine.entry_price = None
            engine.start(strategy_name, req.symbol, req.timeframe, req.starting_cash, req.speed, req.max_trades)
            while state.running:
                engine.step()
            record = _build_run_record()
            RUN_HISTORY.append(record)
            batch_results.append(record)
        except Exception as e:
            batch_results.append({
                'strategy': strategy_name,
                'error': str(e),
            })
    reset_state()
    engine.df = None
    engine.strategy = None
    engine.cash = engine.starting_cash
    engine.units = 0.0
    engine.entry_price = None
    return {'ok': True, 'runs': batch_results}


@app.post('/pause')
def pause():
    if not state.running and not state.paused:
        raise HTTPException(status_code=400, detail="Simulation is not running")
    state.running = False
    state.paused = True
    state.message = "paused"
    return {"ok": True, "message": "simulation paused"}


@app.post('/continue')
def continue_run():
    if engine.df is None or engine.strategy is None:
        raise HTTPException(status_code=400, detail="No simulation to continue")
    state.running = True
    state.paused = False
    state.message = "running"
    return {"ok": True, "message": "simulation continued"}


@app.post('/reset')
def reset():
    reset_state()
    engine.df = None
    engine.strategy = None
    engine.cash = engine.starting_cash
    engine.units = 0.0
    engine.entry_price = None
    return {"ok": True, "message": "simulation reset"}


@app.get('/status')
def status():
    was_running = state.running
    payload = engine.step() if state.running else engine.snapshot()
    if was_running and not payload.get('running') and payload.get('message') == 'finished':
        if not RUN_HISTORY or RUN_HISTORY[-1].get('current_index') != payload.get('current_index'):
            _record_run()
    payload['available_strategies'] = discover_strategies()
    payload['run_history'] = RUN_HISTORY[-50:]
    return payload
