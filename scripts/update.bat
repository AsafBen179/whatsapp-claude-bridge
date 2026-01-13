@echo off
echo ========================================
echo WhatsApp Claude Bridge - Update Script
echo ========================================
echo.

set PM2_HOME=C:\ProgramData\pm2
set PATH=C:\Program Files\nodejs;%PATH%

echo [1/6] Stopping processes...
pm2 stop all

echo.
echo [2/6] Updating Bridge (git pull)...
cd /d C:\RemoteClaudeCode\_bridge
git pull origin main
if errorlevel 1 (
    echo [ERROR] Git pull failed for Bridge
    goto :restart
)

echo.
echo [3/6] Updating WhatsApp API (git pull)...
cd /d C:\WhatsAppAPI
git pull origin main 2>nul
if errorlevel 1 (
    echo [INFO] WhatsApp API - no git repo or pull failed, skipping...
)

echo.
echo [4/6] Installing Bridge dependencies...
cd /d C:\RemoteClaudeCode\_bridge
call npm install --production

echo.
echo [5/6] Installing API dependencies...
cd /d C:\WhatsAppAPI
call npm install --production 2>nul

:restart
echo.
echo [6/6] Restarting processes...
pm2 restart all --update-env
pm2 save

echo.
echo ========================================
echo Update complete!
echo ========================================
pm2 status

echo.
echo Checking WhatsApp connection...
call C:\RemoteClaudeCode\_bridge\service\check-whatsapp.bat

pause
