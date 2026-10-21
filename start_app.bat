@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_all.ps1"
if errorlevel 1 (
  echo Could not start the password-protected Mak Hills system.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:8000/"
exit /b 0
