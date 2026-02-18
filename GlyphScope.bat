@echo off
setlocal

REM Go to the folder this script is in
cd /d "%~dp0"

REM Check for Python
python --version >nul 2>&1
if errorlevel 1 (
  echo.
  echo Python is required to run GlyphScope locally.
  echo Install Python from python.org and re-run start.bat
  echo.
  pause
  exit /b 1
)

set PORT=8000

REM Start server in a new window so this script can continue
start "GlyphScope Server" cmd /c python -m http.server %PORT%

REM Give server a moment
timeout /t 1 >nul

REM Open browser
start http://localhost:%PORT%/

echo.
echo GlyphScope is running at: http://localhost:%PORT%/
echo Close the "GlyphScope Server" window to stop it.
echo.
pause
