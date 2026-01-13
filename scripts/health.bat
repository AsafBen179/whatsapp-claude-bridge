@echo off
echo ========================================
echo Health Check - WhatsApp Claude Service
echo ========================================
echo.

set PM2_HOME=C:\ProgramData\pm2
set PATH=C:\Program Files\nodejs;%PATH%

echo [PM2 Status]
pm2 status

echo.
echo [WhatsApp API - Port 3000]
curl -s http://localhost:3000/api/status 2>nul || echo API not responding

echo.
echo [Bridge - Port 3001]
curl -s http://localhost:3001/health 2>nul || echo Bridge not responding

echo.
echo [WhatsApp Connection]
call C:\RemoteClaudeCode\whatsapp-claude-bridge\service\check-whatsapp.bat

echo.
pause
