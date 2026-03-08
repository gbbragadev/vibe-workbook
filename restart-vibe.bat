@echo off
echo Encerrando instancias anteriores do Vibe Workbook...

for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":3457" ^| findstr "LISTENING"') do (
    echo Matando processo %%p na porta 3457...
    taskkill /PID %%p /F >nul 2>&1
)

timeout /t 1 /nobreak >nul

echo Iniciando Vibe Workbook...
cd /d "%~dp0"
start "" node src/gui.js
