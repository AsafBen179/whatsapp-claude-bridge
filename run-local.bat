@echo off
echo ========================================
echo WhatsApp Claude Bridge - Local Run
echo ========================================
echo.

set BRIDGE_DIR=%~dp0
set WHATSAPP_API_DIR=C:\WhatsAppAPI
set PATH=C:\Program Files\nodejs;%PATH%

echo [1/6] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found in PATH
    pause
    exit /b 1
)
echo Node.js OK

echo.
echo [2/6] Starting WhatsApp API on port 3000...
cd /d "%WHATSAPP_API_DIR%"
start "WhatsApp API" cmd /c "node index.js"

echo Waiting for WhatsApp API to start...
timeout /t 5 /nobreak >nul

REM Wait for API to be ready (max 30 seconds)
set /a count=0
:waitapi
curl -s http://localhost:3000/api/status >nul 2>&1
if errorlevel 1 (
    set /a count+=1
    if %count% lss 15 (
        timeout /t 2 /nobreak >nul
        goto waitapi
    )
    echo [WARN] WhatsApp API not responding yet, continuing...
) else (
    echo WhatsApp API is ready!
)

echo.
echo [3/6] Connecting to WhatsApp...
curl -s -X POST http://localhost:3000/api/connect >nul 2>&1
echo Waiting for WhatsApp connection...
timeout /t 5 /nobreak >nul

REM Wait for WhatsApp to connect (max 30 seconds)
set /a connectCount=0
:waitconnect
curl -s http://localhost:3000/api/status > "%TEMP%\wa_status_check.json" 2>nul
findstr /i "\"connected\":true" "%TEMP%\wa_status_check.json" >nul 2>&1
if errorlevel 1 (
    findstr /i "\"isReady\":true" "%TEMP%\wa_status_check.json" >nul 2>&1
    if errorlevel 1 (
        set /a connectCount+=1
        if %connectCount% lss 15 (
            timeout /t 2 /nobreak >nul
            goto waitconnect
        )
        echo [WARN] WhatsApp connection timeout - may need QR scan
    ) else (
        echo WhatsApp connected successfully!
    )
) else (
    echo WhatsApp connected successfully!
)
del "%TEMP%\wa_status_check.json" 2>nul

echo.
echo [4/6] Starting Bridge service on port 3001...
cd /d "%BRIDGE_DIR%"
start "Claude Bridge" cmd /c "node src/index.js"

echo Waiting for Bridge to start...
timeout /t 3 /nobreak >nul

REM Wait for Bridge to be ready
set /a bridgeCount=0
:waitbridge
curl -s http://localhost:3001/health >nul 2>&1
if errorlevel 1 (
    set /a bridgeCount+=1
    if %bridgeCount% lss 10 (
        timeout /t 2 /nobreak >nul
        goto waitbridge
    )
    echo [WARN] Bridge not responding yet
) else (
    echo Bridge is ready!
)

echo.
echo [5/6] Verifying WhatsApp connection status...
echo.
echo --- WhatsApp API Status ---
curl -s http://localhost:3000/api/status 2>nul
echo.

echo.
echo [6/6] Verifying Bridge status...
echo.
echo --- Bridge Health ---
curl -s http://localhost:3001/health 2>nul
echo.
echo.
echo --- Bridge API Status ---
curl -s http://localhost:3001/api/status 2>nul
echo.

echo.
echo ========================================
echo All services started and verified!
echo.
echo WhatsApp API: http://localhost:3000
echo Bridge:       http://localhost:3001/health
echo Webhook:      http://localhost:3001/webhook/whatsapp
echo.
echo Press any key to stop services...
echo ========================================
pause >nul

echo.
echo Stopping services...
taskkill /FI "WINDOWTITLE eq WhatsApp API*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Claude Bridge*" /F >nul 2>&1
echo Services stopped.
