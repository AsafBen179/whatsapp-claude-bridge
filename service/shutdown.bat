@echo off
echo [%date% %time%] Stopping WhatsApp Claude Service...

set PM2_HOME=C:\ProgramData\pm2
set PATH=C:\Program Files\nodejs;%PATH%

call pm2 save
call pm2 kill

echo Service stopped.
