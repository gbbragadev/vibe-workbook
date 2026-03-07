@echo off
setlocal

cd /d "%~dp0"

echo Iniciando Vibe Workbook...
echo.
echo URL: http://localhost:3457
echo.

start "Vibe Workbook" cmd /k "cd /d %~dp0 && npm run gui"

endlocal
