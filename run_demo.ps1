$ErrorActionPreference = "Stop"

if (-not $env:MAKHILLS_API_TOKEN) {
    throw "Set MAKHILLS_API_TOKEN before starting the demo server."
}

$env:MAKHILLS_DB_PATH = Join-Path $PSScriptRoot "data\makhills-demo.sqlite3"
$env:MAKHILLS_OVERTIME_MULTIPLIER = "1.5"

python (Join-Path $PSScriptRoot "seed_demo.py")
if ($LASTEXITCODE -ne 0) {
    throw "Demo data generation failed."
}

python (Join-Path $PSScriptRoot "server.py")
