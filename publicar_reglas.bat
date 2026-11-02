@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Subiendo las reglas de Firestore (solo hace falta cuando cambian) ===
call firebase deploy --only firestore:rules
echo.
pause
