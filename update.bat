@echo off
cd /d "%~dp0"
echo Updating DeviantLab...
where git >nul 2>&1
if errorlevel 1 (
  echo Git is required. Install Git, then run this again.
  pause
  exit /b 1
)
git pull
if errorlevel 1 goto fail
call npm install
if errorlevel 1 goto fail
echo.
echo DeviantLab is up to date. Close this window, then start it with: npm run dev
echo.
pause
exit /b 0

:fail
echo.
echo Update failed.
pause
exit /b 1
