@echo off
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  where py >nul 2>&1
  if errorlevel 1 (
    echo Python Launcher was not found. Install Python 3 and try again.
    pause
    exit /b 1
  )
  py -3 -m venv .venv
  if errorlevel 1 (
    echo Could not create the project virtual environment.
    pause
    exit /b 1
  )
)

".venv\Scripts\python.exe" -c "import webview, requests, zk, dotenv, psycopg" >nul 2>&1
if errorlevel 1 (
  echo Installing project requirements, including pywebview...
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo Could not install project requirements.
    pause
    exit /b 1
  )
)

if exist ".venv\Scripts\pythonw.exe" (
  start "" ".venv\Scripts\pythonw.exe" desktop.py
) else (
  start "Mak Hills" ".venv\Scripts\python.exe" desktop.py
)
exit /b 0