@echo off
title Professor OI Terminal
cd /d "%~dp0"
set PORT=8764
set PY=

rem Python mila to local server chalao, warna seedha file kholo
python --version >nul 2>&1 && set PY=python
if not defined PY py --version >nul 2>&1 && set PY=py
if not defined PY goto nopy

echo.
echo   Professor OI chal raha hai:  http://localhost:%PORT%
echo   Band karne ke liye ye window close kar do.
echo.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:%PORT%/index.html'"
%PY% -m http.server %PORT% --bind 127.0.0.1
goto :eof

:nopy
start "" "%~dp0index.html"
