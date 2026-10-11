@echo off
title Professor OI - Live Broker Connector
cd /d "%~dp0"
set PY=

rem Python dhundo: pehle "py" launcher, phir "python", phir user install ki jagah
py -3 --version >nul 2>&1 && set PY=py -3
if not defined PY python --version >nul 2>&1 && set PY=python
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PY goto nopy

:run
echo.
echo   Professor OI browser mein khul raha hai: http://127.0.0.1:8765
echo   Broker page par apne broker ke "Connect" par click karo aur details bharo.
echo   Ye kaali window khuli rehne do. Band karoge to live data ruk jayega.
echo.
%PY% connector\server.py
echo.
echo   Connector ruk gaya. Upar likha message padho.
pause
goto :eof

:nopy
echo.
echo   Python nahi mila. Ise ek baar install karna hai (internet chahiye).
where winget >nul 2>&1 || goto manual
echo   Python 3.12 install ho raha hai, 1-2 minute lagenge...
echo.
winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if defined PY goto run

:manual
echo.
echo   Apne aap install nahi ho paya. Haath se karo:
echo   1. https://www.python.org/downloads/ kholo, Python 3.12 download karo.
echo   2. Install karte waqt "Add python.exe to PATH" par tick lagao.
echo   3. Phir ye file dobara chalao.
echo.
start "" https://www.python.org/downloads/
pause
