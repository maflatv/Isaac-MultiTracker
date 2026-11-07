@echo off
rem Perfil propio: con Edge ya abierto, una ventana del perfil normal ignoraria el tamano pedido.
rem 916x160 incluye el marco de la ventana: el area util queda en 900x121.
set PORT=7374
cd /d "%~dp0"
where node >nul 2>nul || (echo Hace falta Node.js: https://nodejs.org & pause & exit /b 1)
start "MultiTracker" /min node server.js
timeout /t 1 /nobreak >nul
start "" msedge --app=http://localhost:%PORT%/overlay.html --window-size=916,160 --user-data-dir="%LOCALAPPDATA%\MultiTracker\Window" --no-first-run
