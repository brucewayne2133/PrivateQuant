from pathlib import Path
import re
import pandas as pd

DATA_DIR = Path(r'C:\Users\alipu\.openclaw\workspace\backtest-quant\data')
TARGETS = {
    '5m': '5min',
    '10m': '10min',
    '15m': '15min',
    '30m': '30min',
    '1h': '1h',
}
BASE_PATTERNS = [
    re.compile(r'^(?P<asset>.+)_1m_1y\.csv$', re.IGNORECASE),
    re.compile(r'^(?P<asset>.+)_1m\.csv$', re.IGNORECASE),
]


def find_base_files() -> list[tuple[str, Path]]:
    found = []
    for path in DATA_DIR.glob('*.csv'):
        for pattern in BASE_PATTERNS:
            match = pattern.match(path.name)
            if match:
                found.append((match.group('asset'), path))
                break
    unique = {}
    for asset, path in found:
        unique.setdefault(asset, path)
    return sorted(unique.items())


def load_ohlcv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    if 'timestamp' not in df.columns:
        raise ValueError(f'Missing timestamp column in {path.name}')
    df['timestamp'] = pd.to_datetime(df['timestamp'], errors='coerce')
    df = df.dropna(subset=['timestamp']).sort_values('timestamp').set_index('timestamp')
    required = ['open', 'high', 'low', 'close', 'volume']
    missing = [col for col in required if col not in df.columns]
    if missing:
        raise ValueError(f'Missing columns {missing} in {path.name}')
    return df


def resample_asset(asset: str, src: Path) -> None:
    df = load_ohlcv(src)
    agg = {
        'open': 'first',
        'high': 'max',
        'low': 'min',
        'close': 'last',
        'volume': 'sum',
    }
    for label, rule in TARGETS.items():
        out = df.resample(rule).agg(agg).dropna(subset=['open', 'high', 'low', 'close'])
        out = out.reset_index()
        out['timestamp'] = out['timestamp'].dt.strftime('%Y-%m-%d %H:%M:%S')
        target = DATA_DIR / f'{asset}_{label}.csv'
        out.to_csv(target, index=False)
        print(f'Wrote {target} ({len(out)} rows)')


def main() -> None:
    base_files = find_base_files()
    if not base_files:
        raise SystemExit('No 1m base files found')
    for asset, src in base_files:
        print(f'Resampling {asset} from {src.name}')
        resample_asset(asset, src)


if __name__ == '__main__':
    main()
