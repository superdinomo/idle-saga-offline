@echo off
title Idle Saga Offline Server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo Error: Node.js is not installed or not in PATH.
    pause
    exit /b 1
)
echo Starting Idle Saga Offline Emulator...
start "" "http://127.0.0.1:8899/"
node server.js
pause
