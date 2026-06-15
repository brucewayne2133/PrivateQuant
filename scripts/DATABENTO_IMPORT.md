# Databento Importer

This project can ingest 1-minute futures data from Databento and save it in the app's standard CSV format:

`timestamp,open,high,low,close,volume`

## Requirements

1. Databento API key in environment:

```powershell
$env:DATABENTO_API_KEY = 'your_api_key_here'
```

2. Install Python package in the project venv:

```powershell
cd C:\Users\alipu\.openclaw\workspace\backtest-quant
.\.venv\Scripts\python.exe -m pip install databento
```

## Fetch MNQ and MES 1-minute data

```powershell
cd C:\Users\alipu\.openclaw\workspace\backtest-quant
.\.venv\Scripts\python.exe .\scripts\fetch_databento.py --symbols MNQ MES --start 2024-04-01T00:00:00Z --end 2025-04-01T00:00:00Z
```

Output files:
- `data\MNQ_1m_1y.csv`
- `data\MES_1m_1y.csv`

## Generate higher timeframes

```powershell
.\.venv\Scripts\python.exe .\scripts\resample_timeframes.py
```

This will create:
- `5m`
- `10m`
- `15m`
- `30m`
- `1h`

for all available 1-minute base files.

## Notes

- The script uses Databento continuous symbols by default:
  - `MNQ` -> `MNQ.c.0`
  - `MES` -> `MES.c.0`
- You can extend `SYMBOL_MAP` in `fetch_databento.py` for more futures later.
- Files are written directly into the app's `data/` directory so the dashboard picks them up automatically.
