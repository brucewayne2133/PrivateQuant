$ErrorActionPreference = 'SilentlyContinue'

Write-Host 'Stopping stale Python processes...'
Get-Process python | Stop-Process -Force
Start-Sleep -Seconds 2

$project = 'C:\Users\alipu\.openclaw\workspace\backtest-quant'
$python = Join-Path $project '.venv\Scripts\python.exe'

if (-not (Test-Path $python)) {
  Write-Error "Python executable not found: $python"
  exit 1
}

Write-Host 'Starting backtest-quant on http://127.0.0.1:8030'
Set-Location $project
& $python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8030
