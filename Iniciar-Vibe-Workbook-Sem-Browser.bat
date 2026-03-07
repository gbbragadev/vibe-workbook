@echo off
setlocal

cd /d "%~dp0"

echo Iniciando Vibe Workbook sem abrir navegador...
echo.
echo URL: http://localhost:3457
echo.

start "Vibe Workbook (sem browser)" cmd /k "cd /d %~dp0 && set VIBE_NO_OPEN=1 && npm run gui"

endlocal
