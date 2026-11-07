@echo off
rem Abre el panel de configuracion. Para cambiar el puerto, editalo aqui y en ventana.bat.
set PORT=7374
cd /d "%~dp0"
where node >nul 2>nul || (echo Hace falta Node.js: https://nodejs.org & pause & exit /b 1)
start "" http://localhost:%PORT%
node server.js
if errorlevel 1 pause
