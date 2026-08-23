@echo off
setlocal

title ParaMagic Development Server
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo Node.js was not found. Install Node.js or add it to PATH, then try again.
    echo.
    pause
    exit /b 1
)

echo Starting ParaMagic at http://localhost:5173
echo Close this window to stop the server.
echo.

node scripts\dev-server.js

if errorlevel 1 (
    echo.
    echo The ParaMagic server stopped with an error.
    pause
)

endlocal
