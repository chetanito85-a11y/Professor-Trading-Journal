@echo off
title Stop OI windows
echo.
echo   Professor OI ke chal rahe windows aur Python band kar raha hoon...
taskkill /F /T /FI "WINDOWTITLE eq Professor OI*" >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":8765 .*LISTENING" /c:":8764 .*LISTENING"') do taskkill /F /T /PID %%p >nul 2>&1
echo.
echo   Ho gaya. Ye window band karo, phir purana folder delete ho jayega.
echo   Phir bhi na ho: Notepad mein khuli config.json band karo,
echo   ya Task Manager mein "Python" par End task karo, ya PC restart karo.
echo.
pause
