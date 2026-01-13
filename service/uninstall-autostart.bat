@echo off
echo ========================================
echo Remove WhatsApp Claude Auto-Start Task
echo ========================================
echo.

REM Check for admin privileges
net session >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Please run as Administrator!
    pause
    exit /b 1
)

set TASK_NAME=WhatsAppClaudeBridge

schtasks /Delete /TN "%TASK_NAME%" /F

if errorlevel 1 (
    echo [ERROR] Task not found or failed to remove
) else (
    echo [SUCCESS] Auto-start task removed!
)

echo.
pause
