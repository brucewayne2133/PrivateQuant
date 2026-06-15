param(
  [string[]]$Symbols = @('MNQ','MES'),
  [string]$Start = '2024-04-01T00:00:00Z',
  [string]$End = '2025-04-01T00:00:00Z'
)

$ErrorActionPreference = 'Stop'
$project = 'C:\Users\alipu\.openclaw\workspace\backtest-quant'
$python = Join-Path $project '.venv\Scripts\python.exe'

if (-not (Test-Path $python)) {
  throw "Python executable not found: $python"
}

if (-not $env:DATABENTO_API_KEY) {
  throw 'DATABENTO_API_KEY is not set'
}

Set-Location $project

Write-Host 'Installing/validating databento package...'
& $python -m pip install databento | Out-Host

Write-Host "Fetching 1m data for: $($Symbols -join ', ')"
& $python '.\scripts\fetch_databento.py' --symbols @Symbols --start $Start --end $End

Write-Host 'Resampling higher timeframes...'
& $python '.\scripts\resample_timeframes.py'

Write-Host 'Done. New datasets are in data\ and should appear in the dashboard automatically.'
