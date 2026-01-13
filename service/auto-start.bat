@echo off
REM Auto-start script for Windows Task Scheduler (runs at boot)
REM Includes service monitoring and system awake keepalive

set BRIDGE_DIR=C:\RemoteClaudeCode\whatsapp-claude-bridge
set WHATSAPP_API_DIR=C:\WhatsAppAPI
set PATH=C:\Program Files\nodejs;%PATH%
set LOG_FILE=%BRIDGE_DIR%\logs\auto-start.log

echo [%date% %time%] ===== Auto-start triggered ===== >> "%LOG_FILE%"

REM Prevent system sleep while this script runs
powershell -Command "[System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer((Add-Type -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint esFlags);' -Name Win32 -Namespace System -PassThru)::SetThreadExecutionState, [Func[UInt32,UInt32]]).Invoke(0x80000003)" >nul 2>&1

REM Wait for network
:waitnet
ping -n 1 8.8.8.8 >nul 2>&1
if errorlevel 1 (
    echo [%date% %time%] Waiting for network... >> "%LOG_FILE%"
    timeout /t 5 /nobreak >nul
    goto waitnet
)
echo [%date% %time%] Network ready >> "%LOG_FILE%"

REM Start WhatsApp API
echo [%date% %time%] Starting WhatsApp API... >> "%LOG_FILE%"
cd /d "%WHATSAPP_API_DIR%"
start /B "" node index.js >> "%BRIDGE_DIR%\logs\whatsapp-api.log" 2>&1

REM Wait for API to be ready
set /a count=0
:waitapi
timeout /t 2 /nobreak >nul
curl -s http://localhost:3000/api/status >nul 2>&1
if errorlevel 1 (
    set /a count+=1
    if %count% lss 30 goto waitapi
    echo [%date% %time%] WARNING: API timeout >> "%LOG_FILE%"
) else (
    echo [%date% %time%] WhatsApp API ready >> "%LOG_FILE%"
)

REM Auto-connect to WhatsApp
echo [%date% %time%] Connecting to WhatsApp... >> "%LOG_FILE%"
curl -s -X POST http://localhost:3000/api/connect >nul 2>&1
timeout /t 10 /nobreak >nul

REM Verify WhatsApp connection
curl -s http://localhost:3000/api/status | findstr /i "isReady\":true" >nul 2>&1
if errorlevel 1 (
    echo [%date% %time%] WARNING: WhatsApp not connected >> "%LOG_FILE%"
) else (
    echo [%date% %time%] WhatsApp connected >> "%LOG_FILE%"
)

REM Start Bridge
echo [%date% %time%] Starting Bridge... >> "%LOG_FILE%"
cd /d "%BRIDGE_DIR%"
start /B "" node src/index.js >> "%BRIDGE_DIR%\logs\bridge-stdout.log" 2>&1

REM Wait for Bridge to be ready
set /a bcount=0
:waitbridge
timeout /t 2 /nobreak >nul
curl -s http://localhost:3001/health >nul 2>&1
if errorlevel 1 (
    set /a bcount+=1
    if %bcount% lss 15 goto waitbridge
    echo [%date% %time%] WARNING: Bridge timeout >> "%LOG_FILE%"
) else (
    echo [%date% %time%] Bridge ready >> "%LOG_FILE%"
)

echo [%date% %time%] Initial startup complete, entering monitor mode >> "%LOG_FILE%"

REM ===== SERVICE MONITOR LOOP =====
:monitor
timeout /t 60 /nobreak >nul

REM Check WhatsApp API
curl -s http://localhost:3000/api/status >nul 2>&1
if errorlevel 1 (
    echo [%date% %time%] WhatsApp API down, restarting... >> "%LOG_FILE%"
    cd /d "%WHATSAPP_API_DIR%"
    start /B "" node index.js >> "%BRIDGE_DIR%\logs\whatsapp-api.log" 2>&1
    timeout /t 10 /nobreak >nul
    curl -s -X POST http://localhost:3000/api/connect >nul 2>&1
)

REM Check Bridge
curl -s http://localhost:3001/health >nul 2>&1
if errorlevel 1 (
    echo [%date% %time%] Bridge down, restarting... >> "%LOG_FILE%"
    cd /d "%BRIDGE_DIR%"
    start /B "" node src/index.js >> "%BRIDGE_DIR%\logs\bridge-stdout.log" 2>&1
)

REM Check WhatsApp connection and reconnect if needed
curl -s http://localhost:3000/api/status | findstr /i "isReady\":true" >nul 2>&1
if errorlevel 1 (
    curl -s http://localhost:3000/api/status | findstr /i "not_initialized" >nul 2>&1
    if not errorlevel 1 (
        echo [%date% %time%] WhatsApp disconnected, reconnecting... >> "%LOG_FILE%"
        curl -s -X POST http://localhost:3000/api/connect >nul 2>&1
    )
)

REM Keep system awake
powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = [System.Windows.Forms.Cursor]::Position" >nul 2>&1

goto monitor
