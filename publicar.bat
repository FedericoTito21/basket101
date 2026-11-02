@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Basket101: preparando la web ===
python build.py %*
if errorlevel 1 goto fin
echo.
echo === Publicando en Firebase Hosting ===
call firebase deploy --only hosting
:fin
echo.
pause
