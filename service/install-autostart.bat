@echo off
echo ========================================
echo Install WhatsApp Claude Auto-Start Task
echo ========================================
echo.

REM Check for admin privileges
net session >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Please run as Administrator!
    echo Right-click this file and select "Run as administrator"
    pause
    exit /b 1
)

set TASK_NAME=WhatsAppClaudeBridge
set SCRIPT_PATH=C:\RemoteClaudeCode\whatsapp-claude-bridge\service\auto-start.bat

echo Creating scheduled task: %TASK_NAME%
echo Script: %SCRIPT_PATH%
echo.

REM Delete existing task if present
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1

REM Create new task that runs at startup
schtasks /Create /TN "%TASK_NAME%" /TR "\"%SCRIPT_PATH%\"" /SC ONSTART /DELAY 0001:00 /RL HIGHEST /RU SYSTEM /F

if errorlevel 1 (
    echo [ERROR] Failed to create scheduled task
    pause
    exit /b 1
)

echo.
echo [SUCCESS] Auto-start task installed!
echo.
echo The service will automatically start 1 minute after boot.
echo.
echo To manage:
echo   - View task:   schtasks /Query /TN "%TASK_NAME%"
echo   - Run now:     schtasks /Run /TN "%TASK_NAME%"
echo   - Disable:     schtasks /Change /TN "%TASK_NAME%" /DISABLE
echo   - Remove:      schtasks /Delete /TN "%TASK_NAME%" /F
echo.
pause
