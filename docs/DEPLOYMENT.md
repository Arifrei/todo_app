# Mobile App Deployment Guide

## Overview

Your TaskFlow app has two components:
1. **Backend (Flask)** - Runs on VPS at `51.81.32.252:8003`
2. **Mobile App (Android APK)** - Downloads from `http://51.81.32.252:8003/download/app`

## Initial Setup (One Time)

### 1. Build the APK with Production Settings

The app is now configured to connect to your VPS at `http://51.81.32.252:8003`

**Build the APK:**
```bash
# Windows
tools/build-apk.bat

# Linux/Mac
./tools/build-apk.sh
```

This creates `downloads/taskflow.apk`

### 2. Upload to VPS

**Push code changes to VPS:**
```bash
# Commit your changes
git add .
git commit -m "Add mobile app and download route"
git push origin master

# SSH into VPS
ssh user@51.81.32.252

# On VPS, pull changes
cd /path/to/todo_app
git pull origin master

# Create downloads directory if it doesn't exist
mkdir -p downloads

# Restart Flask
sudo systemctl restart todo-app
```

**Upload the APK to VPS:**
```bash
# From your local machine
scp downloads/taskflow.apk user@51.81.32.252:/path/to/todo_app/downloads/
```

### 3. Download on Your Phone

Visit: `http://51.81.32.252:8003/download/app` on your phone's browser

The APK will download automatically!

## Daily Workflow

### Web Code Updates (No APK Rebuild Needed) ✨

When you update:
- Python backend code (`app.py`, `models.py`, etc.)
- JavaScript (`static/*.js`)
- CSS (`static/*.css`)
- HTML templates (`templates/*.html`)

**Deploy:**
```bash
# Local machine
git add .
git commit -m "Your changes"
git push origin master

# On VPS
ssh user@51.81.32.252
cd /path/to/todo_app
git pull origin master
sudo systemctl restart todo-app
```

**Phone automatically gets updates!** Just refresh or reopen the app.

### Native App Updates (APK Rebuild Required)

When you change:
- App icon
- Notification icon
- Capacitor config
- Android permissions

**Deploy:**
```bash
# 1. Build new APK
tools/build-apk.bat  # or ./tools/build-apk.sh

# 2. Upload to VPS
scp downloads/taskflow.apk user@51.81.32.252:/path/to/todo_app/downloads/

# 3. On phone, visit http://51.81.32.252:8003/download/app
# Download and install the new version
```

## Download URL

Share this with users: **`http://51.81.32.252:8003/download/app`**

## Tips

- **99% of updates** don't require rebuilding the APK
- Only rebuild when you change icons, permissions, or app configuration
- Users can bookmark the download URL to easily get updates
- Consider adding HTTPS with Let's Encrypt for secure downloads (optional)

## Troubleshooting

**APK not found error:**
- Make sure `downloads/taskflow.apk` exists on VPS
- Check file permissions: `chmod 644 downloads/taskflow.apk`

**App won't connect to server:**
- Verify Flask is running on VPS: `sudo systemctl status todo-app`
- Check domain DNS is resolving correctly
- Ensure phone can reach `simplytasks.simplifiedsuite.com` (test in browser)

**Old version on phone:**
- Uninstall the old app completely
- Download fresh from `https://simplytasks.simplifiedsuite.com/download/app`
- Install the new version
