@echo off
title Professor OI - Live Broker Connector
cd /d "%~dp0"
set PY=

rem Python dhundo: pehle "py" launcher, phir "python"
py -3 --version >nul 2>&1 && set PY=py -3
if not defined PY python --version >nul 2>&1 && set PY=python
if not defined PY goto nopy

echo.
echo   Professor OI browser mein khul raha hai: http://127.0.0.1:8765
echo   Broker page par apne broker ke "Connect" par click karo aur details bharo.
echo   Band karna ho to ye window close karo.
echo.
%PY% connector\server.py
echo.
echo   Connector ruk gaya. Upar likha message padho.
pause
goto :eof

:nopy
echo.
echo   Python nahi mila.
echo   https://www.python.org/downloads/ se Python 3.12 install karo
echo   aur setup mein "Add python.exe to PATH" par tick lagao.
echo   Phir ye file dobara chalao.
echo.
pause
