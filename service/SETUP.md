# WhatsApp Claude Service - Setup Guide

## Prerequisites

1. **Node.js** installed at `C:\Program Files\nodejs`
2. **PM2** installed globally: `npm install -g pm2`
3. **curl** available in PATH (comes with Windows 10+)

## Installation Steps

### Step 1: Download WinSW

1. Go to: https://github.com/winsw/winsw/releases
2. Download: `WinSW-x64.exe`
3. Rename to: `whatsapp-service.exe`
4. Place in: `C:\RemoteClaudeCode\_bridge\service\`

### Step 2: Setup PM2 Environment (Run as Administrator)

```powershell
# Set PM2_HOME system-wide
[System.Environment]::SetEnvironmentVariable("PM2_HOME", "C:\ProgramData\pm2", "Machine")
$env:PM2_HOME = "C:\ProgramData\pm2"

# Create directories
New-Item -ItemType Directory -Path "C:\ProgramData\pm2" -Force
New-Item -ItemType Directory -Path "C:\WhatsAppAPI\logs" -Force

# Set permissions for Local Service account
icacls "C:\ProgramData\pm2" /grant "LOCAL SERVICE:(OI)(CI)F"
icacls "C:\RemoteClaudeCode\_bridge" /grant "LOCAL SERVICE:(OI)(CI)F"
icacls "C:\WhatsAppAPI" /grant "LOCAL SERVICE:(OI)(CI)F"
```

### Step 3: Initialize PM2 Processes

```powershell
$env:PM2_HOME = "C:\ProgramData\pm2"
cd C:\RemoteClaudeCode\_bridge
pm2 start ecosystem.config.js
pm2 save
```

### Step 4: Install Windows Service

```powershell
cd C:\RemoteClaudeCode\_bridge\service
.\whatsapp-service.exe install
.\whatsapp-service.exe start
```

### Step 5: Verify

```powershell
Get-Service WhatsAppClaudeService
pm2 status
```

## Service Commands

```batch
REM Start service
net start WhatsAppClaudeService

REM Stop service
net stop WhatsAppClaudeService

REM View service status
sc query WhatsAppClaudeService

REM Uninstall service
cd C:\RemoteClaudeCode\_bridge\service
.\whatsapp-service.exe uninstall
```

## PM2 Commands

```batch
REM Set environment first
set PM2_HOME=C:\ProgramData\pm2

REM View status
pm2 status

REM View logs
pm2 logs

REM Restart all
pm2 restart all

REM Stop all
pm2 stop all
```

## Utility Scripts

| Script | Location | Purpose |
|--------|----------|---------|
| `health.bat` | `scripts\` | Check all services status |
| `update.bat` | `scripts\` | Update from git + restart |
| `check-whatsapp.bat` | `service\` | Check/reconnect WhatsApp |

## Troubleshooting

### Service won't start
1. Check logs at `C:\RemoteClaudeCode\_bridge\logs\`
2. Verify PM2_HOME is set: `echo %PM2_HOME%`
3. Verify Node.js path: `where node`

### WhatsApp not connecting
1. Run `scripts\health.bat`
2. Check if QR scan needed at `http://localhost:3000`
3. Manually run `service\check-whatsapp.bat`

### PM2 processes not starting
```powershell
$env:PM2_HOME = "C:\ProgramData\pm2"
pm2 delete all
pm2 start C:\RemoteClaudeCode\_bridge\ecosystem.config.js
pm2 save
```
