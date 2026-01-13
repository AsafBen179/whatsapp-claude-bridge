@echo off
REM Check WhatsApp connection status and auto-connect if needed

set PATH=C:\Program Files\nodejs;%PATH%

echo [%date% %time%] Checking WhatsApp status...

REM Get status from API
curl -s http://localhost:3000/api/status > "%TEMP%\wa_status.json" 2>nul

if errorlevel 1 (
    echo [ERROR] Cannot reach WhatsApp API
    exit /b 1
)

REM Check if connected (look for "connected":true in response)
findstr /i "\"connected\":true" "%TEMP%\wa_status.json" >nul
if errorlevel 1 (
    echo [INFO] WhatsApp not connected. Attempting to connect...

    REM Call connect endpoint
    curl -s -X POST http://localhost:3000/api/connect > "%TEMP%\wa_connect.json" 2>nul

    if errorlevel 1 (
        echo [ERROR] Failed to call connect endpoint
        del "%TEMP%\wa_status.json" 2>nul
        exit /b 1
    )

    REM Wait a few seconds for connection
    timeout /t 5 /nobreak >nul

    REM Check status again
    curl -s http://localhost:3000/api/status > "%TEMP%\wa_status2.json" 2>nul
    findstr /i "\"connected\":true" "%TEMP%\wa_status2.json" >nul
    if errorlevel 1 (
        echo [WARN] WhatsApp still not connected. QR scan may be required.
        echo [INFO] Check http://localhost:3000 for QR code
    ) else (
        echo [OK] WhatsApp connected successfully!
    )
    del "%TEMP%\wa_status2.json" 2>nul
    del "%TEMP%\wa_connect.json" 2>nul
) else (
    echo [OK] WhatsApp is already connected.
)

del "%TEMP%\wa_status.json" 2>nul
exit /b 0
