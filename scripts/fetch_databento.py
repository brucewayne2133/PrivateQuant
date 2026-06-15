from __future__ import annotations

import argparse
import os
from pathlib import Path

import pandas as pd

DATA_DIR = Path(r'C:\Users\alipu\.openclaw\workspace\backtest-quant\data')
DEFAULT_DATASET = 'GLBX.MDP3'
DEFAULT_SCHEMA = 'ohlcv-1m'
SYMBOL_MAP = {
    'MNQ': 'MNQ.c.0',
    'MES': 'MES.c.0',
}


def normalize_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    rename_map = {
        'ts_event': 'timestamp',
        'open': 'open',
        'high': 'high',
        'low': 'low',
        'close': 'close',
        'volume': 'volume',
    }
    out = df.rename(columns=rename_map).copy()
    if 'timestamp' not in out.columns:
        raise ValueError('Databento response missing ts_event/timestamp column')
    cols = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
    missing = [c for c in cols if c not in out.columns]
    if missing:
        raise ValueError(f'Missing required columns: {missing}')
    out = out[cols]
    out['timestamp'] = pd.to_datetime(out['timestamp'], utc=True, errors='coerce').dt.strftime('%Y-%m-%d %H:%M:%S')
    return out.dropna(subset=['timestamp'])


def fetch(symbol: str, start: str, end: str, dataset: str = DEFAULT_DATASET, schema: str = DEFAULT_SCHEMA) -> Path:
    api_key = os.getenv('DATABENTO_API_KEY')
    if not api_key:
        raise RuntimeError('DATABENTO_API_KEY is not set')

    try:
        import databento as db
    except ImportError as e:
        raise RuntimeError('databento package is not installed. Install it with: pip install databento') from e

    stype_in = 'continuous'
    symbol_for_api = SYMBOL_MAP.get(symbol, symbol)

    client = db.Historical(api_key)
    data = client.timeseries.get_range(
        dataset=dataset,
        schema=schema,
        stype_in=stype_in,
        symbols=[symbol_for_api],
        start=start,
        end=end,
    )

    df = data.to_df().reset_index()
    out = normalize_ohlcv(df)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    target = DATA_DIR / f'{symbol}_1m_1y.csv'
    out.to_csv(target, index=False)
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description='Fetch 1-minute OHLCV data from Databento for quant backtesting.')
    parser.add_argument('--symbols', nargs='+', default=['MNQ', 'MES'], help='Symbols to fetch, e.g. MNQ MES')
    parser.add_argument('--start', required=True, help='UTC start timestamp, e.g. 2024-04-01T00:00:00Z')
    parser.add_argument('--end', required=True, help='UTC end timestamp, e.g. 2025-04-01T00:00:00Z')
    parser.add_argument('--dataset', default=DEFAULT_DATASET, help='Databento dataset, default GLBX.MDP3')
    parser.add_argument('--schema', default=DEFAULT_SCHEMA, help='Databento schema, default ohlcv-1m')
    args = parser.parse_args()

    for symbol in args.symbols:
        path = fetch(symbol=symbol, start=args.start, end=args.end, dataset=args.dataset, schema=args.schema)
        print(f'Wrote {path}')


if __name__ == '__main__':
    main()
