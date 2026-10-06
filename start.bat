@echo off
cd /d "%~dp0"
echo Starting DeviantLab at http://localhost:5173
echo Close this window to stop it.
echo.
call npm run dev
if errorlevel 1 (
  echo.
  echo DeviantLab did not start.
  pause
)
