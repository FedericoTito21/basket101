@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Basket101: ampliar la base de datos NBA con NBA.com ===
echo Anade a todos los jugadores con 6 o mas temporadas en la NBA.
echo La primera vez tarda bastante (mas o menos 1 hora por cada 1.000 jugadores).
echo Si se corta, vuelve a ejecutarlo: sigue donde lo dejo.
echo.
python -m pip install --quiet nba_api openpyxl
python actualizar_nba.py --temporadas 6 %*
if errorlevel 1 goto fin
echo.
echo === Generando datos-nba.js ===
python build_nba.py
echo.
echo Listo. Ahora haz doble clic en publicar.bat para subir la web.
:fin
echo.
pause
