$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$baseUrl = "http://127.0.0.1:8000"
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
$ownedServer = $null

if (-not (Test-Path $python)) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
        throw "Python was not found. Install Python 3 or create the project .venv first."
    }
    $python = $pythonCommand.Source
}

$npx = Get-Command npx -ErrorAction SilentlyContinue
if (-not $npx) {
    throw "LocalTunnel needs Node.js and npm. Install Node.js, then run this script again."
}

$loginPasswordConfigured = [bool]$env:MAKHILLS_LOGIN_PASSWORD
if (-not $loginPasswordConfigured -and (Test-Path (Join-Path $projectRoot ".env"))) {
    & $python -c "from dotenv import dotenv_values; import sys; sys.exit(0 if dotenv_values(sys.argv[1]).get('MAKHILLS_LOGIN_PASSWORD') else 1)" (Join-Path $projectRoot ".env") *> $null
    $loginPasswordConfigured = ($LASTEXITCODE -eq 0)
}
if (-not $loginPasswordConfigured) {
    throw "Set MAKHILLS_LOGIN_PASSWORD in .env or the environment before starting the tunnel."
}

$serverIsRunning = $false
try {
    $null = Invoke-RestMethod -Uri "$baseUrl/api/v1/health" -TimeoutSec 2
    $serverIsRunning = $true
} catch {
    $serverIsRunning = $false
}

try {
    if (-not $serverIsRunning) {
        if (-not $env:MAKHILLS_API_TOKEN -or $env:MAKHILLS_API_TOKEN -in @("replace-with-a-long-random-secret", "dev-only-change-me")) {
            $env:MAKHILLS_API_TOKEN = & $python (Join-Path $projectRoot "backend\local_config.py")
            if ($LASTEXITCODE -ne 0 -or -not $env:MAKHILLS_API_TOKEN) {
                throw "Could not generate and save MAKHILLS_API_TOKEN in .env."
            }
        }
        $ownedServer = Start-Process -FilePath $python -ArgumentList @("backend/server.py") `
            -WorkingDirectory $projectRoot -PassThru
        $deadline = (Get-Date).AddSeconds(30)
        do {
            if ($ownedServer.HasExited) {
                throw "The local server exited before it became ready."
            }
            try {
                $null = Invoke-RestMethod -Uri "$baseUrl/api/v1/health" -TimeoutSec 2
                $serverIsRunning = $true
                break
            } catch {
                Start-Sleep -Milliseconds 500
            }
        } while ((Get-Date) -lt $deadline)
        if (-not $serverIsRunning) {
            throw "Timed out while waiting for the local server."
        }
    }

    $loginPage = Invoke-WebRequest -Uri $baseUrl -TimeoutSec 5 -UseBasicParsing
    if ($loginPage.StatusCode -ne 200 -or $loginPage.Content -notmatch 'id="login"' `
            -or $loginPage.Content -match 'id="employeesView"') {
        throw "The server does not appear to have the password-protected login page. Stop that server, run start_all.ps1, then retry."
    }

    Write-Host "Starting a free LocalTunnel link. Keep this window open while using the site."
    Write-Warning "The link is publicly reachable. Anyone who gets it can try the configured system password; share it only with trusted staff."
    & $npx.Source --yes localtunnel --port 8000
    if ($LASTEXITCODE -ne 0) {
        throw "LocalTunnel exited with code $LASTEXITCODE."
    }
} finally {
    if ($ownedServer -and -not $ownedServer.HasExited) {
        Stop-Process -Id $ownedServer.Id
        Write-Host "Stopped the server started by this tunnel script."
    }
}
