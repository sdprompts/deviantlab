@echo off
cd /d "%~dp0"
where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22 or newer, then run this again.
  pause
  exit /b 1
)
if not exist "node_modules\.bin\vite.cmd" (
  echo Installing DeviantLab. This can take a minute the first time.
  call npm install
  if errorlevel 1 (
    echo.
    echo Install failed.
    pause
    exit /b 1
  )
)
echo Starting DeviantLab at http://localhost:5173
echo Close this window to stop it.
echo.
call npm run dev
if errorlevel 1 (
  echo.
  echo DeviantLab did not start.
  pause
)
