@echo off
echo [%date% %time%] Starting WhatsApp Claude Service...

set PM2_HOME=C:\ProgramData\pm2
set NODE_ENV=production
set PATH=C:\Program Files\nodejs;%PATH%

cd /d C:\RemoteClaudeCode\_bridge

REM Wait for network connectivity
echo Waiting for network...
:waitnet
ping -n 1 8.8.8.8 >nul 2>&1
if errorlevel 1 (
    timeout /t 5 /nobreak >nul
    goto waitnet
)
echo Network is ready.

REM Start PM2 processes
echo Starting PM2 processes...
call pm2 resurrect --no-daemon-mode

REM If no saved processes, start fresh
if errorlevel 1 (
    echo No saved processes, starting from ecosystem...
    call pm2 start C:\RemoteClaudeCode\_bridge\ecosystem.config.js
    call pm2 save
)

REM Wait for API to be ready (max 60 seconds)
echo Waiting for WhatsApp API to be ready...
set /a count=0
:waitapi
timeout /t 2 /nobreak >nul
curl -s http://localhost:3000/api/status >nul 2>&1
if errorlevel 1 (
    set /a count+=1
    if %count% lss 30 goto waitapi
    echo Warning: API health check timeout, continuing anyway...
)
echo WhatsApp API is ready.

REM Check WhatsApp connection status and reconnect if needed
echo Checking WhatsApp connection...
call C:\RemoteClaudeCode\_bridge\service\check-whatsapp.bat

REM Keep running (PM2 no-daemon mode)
echo Service started successfully.
call pm2 logs --raw
