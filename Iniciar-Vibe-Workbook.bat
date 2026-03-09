@echo off
setlocal

cd /d "%~dp0"

echo Iniciando Vibe Workbook...
echo.
echo URL: http://localhost:3457
echo Para encerrar: pressione Ctrl+C nesta janela
echo.

npm run gui
pause

endlocal
