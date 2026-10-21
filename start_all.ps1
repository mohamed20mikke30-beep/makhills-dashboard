$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
        throw "Python was not found. Create the workspace .venv or install Python, then run this script again."
    }
    $python = $pythonCommand.Source
}

& $python -c "import requests, zk, dotenv, psycopg" *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing bridge dependencies from requirements.txt..."
    & $python -m pip install -r (Join-Path $projectRoot "requirements.txt")
    if ($LASTEXITCODE -ne 0) {
        throw "Could not install Python requirements."
    }
}

$loginPasswordConfigured = [bool]$env:MAKHILLS_LOGIN_PASSWORD
if (-not $loginPasswordConfigured -and (Test-Path (Join-Path $projectRoot ".env"))) {
    & $python -c "from dotenv import dotenv_values; import sys; sys.exit(0 if dotenv_values(sys.argv[1]).get('MAKHILLS_LOGIN_PASSWORD') else 1)" (Join-Path $projectRoot ".env") *> $null
    $loginPasswordConfigured = ($LASTEXITCODE -eq 0)
}
if (-not $loginPasswordConfigured) {
    throw "Set MAKHILLS_LOGIN_PASSWORD in .env or the environment before starting the system."
}

$healthUrl = "http://127.0.0.1:8000/api/v1/health"
$serverIsRunning = $false
try {
    $null = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    $serverIsRunning = $true
} catch {
    $serverIsRunning = $false
}

if (-not $env:MAKHILLS_API_TOKEN -and (Test-Path (Join-Path $projectRoot ".env"))) {
    $env:MAKHILLS_API_TOKEN = & $python -c "from dotenv import dotenv_values; print(dotenv_values(r'$projectRoot\\.env').get('MAKHILLS_API_TOKEN', ''))"
}
if ($env:MAKHILLS_API_TOKEN -in @("replace-with-a-long-random-secret", "dev-only-change-me")) {
    $env:MAKHILLS_API_TOKEN = ""
}
if (-not $env:MAKHILLS_API_TOKEN) {
    if ($serverIsRunning) {
        throw "The running server's MAKHILLS_API_TOKEN is unavailable. Stop it and rerun start_all.ps1, or set the same token in this PowerShell session."
    }
    $env:MAKHILLS_API_TOKEN = & $python (Join-Path $projectRoot "backend\local_config.py")
    if ($LASTEXITCODE -ne 0 -or -not $env:MAKHILLS_API_TOKEN) {
        throw "Could not generate and save MAKHILLS_API_TOKEN in .env."
    }
}

if (-not $serverIsRunning) {
    Start-Process -FilePath $python -ArgumentList @("backend/server.py") -WorkingDirectory $projectRoot
    $deadline = (Get-Date).AddSeconds(30)
    do {
        try {
            $null = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
            $serverIsRunning = $true
            break
        } catch {
            Start-Sleep -Milliseconds 500
        }
    } while ((Get-Date) -lt $deadline)
    if (-not $serverIsRunning) {
        throw "The local server did not become ready within 30 seconds."
    }
    Write-Host "Started Mak Hills server on http://127.0.0.1:8000"
} else {
    Write-Host "Mak Hills server is already running on http://127.0.0.1:8000"
}

$loginPage = Invoke-WebRequest -Uri "http://127.0.0.1:8000/" -TimeoutSec 5 -UseBasicParsing
if ($loginPage.Content -notmatch 'id="login"' -or $loginPage.Content -match 'id="employeesView"') {
    throw "The server is outdated or password protection is unavailable. Stop it and rerun start_all.ps1."
}

Start-Process -FilePath $python -ArgumentList @("bridge.py") -WorkingDirectory $projectRoot
Write-Host "Started ZKTeco bridge for 192.168.1.247:4370."
Write-Host "The bridge retries automatically until the server and device are reachable."
