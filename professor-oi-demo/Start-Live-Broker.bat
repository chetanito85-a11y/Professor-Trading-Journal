@echo off
title Professor OI - Live Broker Connector
cd /d "%~dp0"
set PY=

rem Python dhundo: pehle "py" launcher, phir "python"
py -3 --version >nul 2>&1 && set PY=py -3
if not defined PY python --version >nul 2>&1 && set PY=python
if not defined PY goto nopy

if exist "connector\config.json" goto run
copy "connector\config.example.json" "connector\config.json" >nul
echo.
echo   Pehli baar: connector\config.json ban gaya hai.
echo   Notepad khulega. "broker" set karo, usi broker ki keys bharo,
echo   Save karo aur Notepad band karo. Phir connector shuru hoga.
echo.
notepad "connector\config.json"

:run
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
