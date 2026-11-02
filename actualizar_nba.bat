@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Instalando nba_api y openpyxl (solo la primera vez tarda)...
python -m pip install --quiet nba_api openpyxl
python actualizar_nba.py %*
echo.
pause
