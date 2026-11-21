@echo off
cd /d "%~dp0"
start "" http://localhost:3000/host
node server.js
pause
