# TaskFlow Native Android App - Build Guide

## Overview

Your TaskFlow web app has been wrapped as a native Android app using Capacitor. This gives you:
- ✅ **Native local notifications** that work reliably (even with screen off)
- ✅ **Instant code updates** - just update your Flask server
- ✅ **Beautiful mobile UI** optimized for touch
- ✅ **Same backend sync** - web and mobile apps stay in sync

## How It Works

The Android app is a **native shell** that loads your Flask web app. Think of it like this:

```
┌─────────────────────────────┐
│   Android APK (Install once)│
│  ┌─────────────────────────┐│
│  │  Native Features:       ││
│  │  - Local Notifications  ││
│  │  - Status Bar           ││
│  │  - Splash Screen        ││
│  └─────────────────────────┘│
│            ↓                │
│  ┌─────────────────────────┐│
│  │  WebView loads:         ││
│  │  http://your-server.com ││
│  │  (Your Flask app)       ││
│  └─────────────────────────┘│
└─────────────────────────────┘
```

**Code updates:** Just deploy to your Flask server - no APK rebuild needed!
**APK rebuild:** Only needed for native changes (permissions, plugins, icons)

---

## Prerequisites

1. **Java Development Kit (JDK) 17**
   - Download: https://adoptium.net/
   - Set `JAVA_HOME` environment variable

2. **Android Studio** (or Android Command Line Tools)
   - Download: https://developer.android.com/studio
   - Install Android SDK (API 33 or higher)

3. **Node.js** (already installed since you ran npm install)

4. **Your Flask server running**
   - The app needs to connect to your Flask backend

---

## Step 1: Configure Server URL

Edit `capacitor.config.json` and set your server URL:

### For Development (Local Network)

```json
{
  "server": {
    "url": "http://192.168.1.XXX:5000",
    "cleartext": true,
    "androidScheme": "http"
  }
}
```

**Find your local IP:**
- Windows: Run `ipconfig` and look for IPv4 Address
- Mac/Linux: Run `ifconfig` and look for inet address
- Your phone must be on the same WiFi network

### For Production (Public Server)

```json
{
  "server": {
    "url": "https://your-domain.com",
    "cleartext": false,
    "androidScheme": "https"
  }
}
```

**Important:** After changing the server URL, run:
```bash
npx cap sync
```

---

## Step 2: Build the APK

### Option A: Using Android Studio (Recommended)

1. **Open project in Android Studio:**
   ```bash
   npx cap open android
   ```

2. **Wait for Gradle sync** to complete (first time takes 5-10 minutes)

3. **Build the APK:**
   - Click `Build` → `Build Bundle(s) / APK(s)` → `Build APK(s)`
   - Or click the green ▶ play button to build and run on a connected device

4. **Find your APK:**
   - Location: `android/app/build/outputs/apk/debug/app-debug.apk`
   - Transfer this file to your Android phone

### Option B: Using Command Line

```bash
# Navigate to android folder
cd android

# Build debug APK (for testing)
./gradlew assembleDebug

# Build release APK (for distribution - requires signing)
./gradlew assembleRelease
```

**APK Location:**
- Debug: `android/app/build/outputs/apk/debug/app-debug.apk`
- Release: `android/app/build/outputs/apk/release/app-release-unsigned.apk`

---

## Step 3: Install on Your Phone

### Method 1: USB Cable

1. **Enable Developer Options** on your phone:
   - Settings → About Phone → Tap "Build Number" 7 times

2. **Enable USB Debugging:**
   - Settings → Developer Options → USB Debugging

3. **Connect phone via USB** and run:
   ```bash
   npx cap run android
   ```

### Method 2: File Transfer

1. **Copy APK** to your phone (via USB, cloud storage, or email)

2. **Install APK:**
   - Open the APK file on your phone
   - Allow installation from unknown sources if prompted
   - Tap "Install"

### Method 3: Local Web Server

```bash
# Serve the APK on your local network
cd android/app/build/outputs/apk/debug
python -m http.server 8000
```

Then visit `http://YOUR-IP:8000` on your phone's browser and download the APK.

---

## Step 4: First Run Setup

1. **Open the app** on your phone

2. **Grant notification permissions** when prompted

3. **Go to Calendar** page and tap "Enable Notifications"

4. **Set reminders** on your calendar events - they'll now work reliably!

---

## Testing Notifications

1. **Create a calendar event** with a reminder (e.g., 1 minute before)

2. **Close the app completely** (swipe away from recent apps)

3. **Turn off your screen**

4. **Wait for the reminder time** - you should get a notification!

5. **Tap the notification** - it should open the app to your calendar

---

## Troubleshooting

### "Failed to connect to server"

- ✅ Check that your Flask server is running
- ✅ Verify the server URL in `capacitor.config.json`
- ✅ If using local IP, ensure phone is on same WiFi network
- ✅ Try pinging the server from your phone's browser first

### "Notifications not appearing"

- ✅ Check notification permissions: Settings → Apps → TaskFlow → Notifications
- ✅ Verify "Enable Notifications" was tapped in the Calendar page
- ✅ Check that the reminder time is in the future
- ✅ Ensure the event status is not "done"

### "App crashes on startup"

- ✅ Check Android Studio Logcat for error messages
- ✅ Verify server URL is accessible
- ✅ Try rebuilding: `npx cap sync && npx cap open android`

### "Build failed - SDK not found"

- ✅ Install Android Studio and Android SDK
- ✅ Set `ANDROID_HOME` environment variable to SDK location
- ✅ Restart terminal/command prompt

---

## Making Code Updates

### Web Code Changes (HTML/CSS/JS)

**No APK rebuild needed!**

1. Make changes to your Flask app code
2. Deploy changes to your server
3. Refresh the app (swipe down to pull-to-refresh)
4. Users get updates instantly ✨

### Native Changes (Permissions, Plugins, Icons)

**Requires APK rebuild:**

1. Make changes to native code
2. Run `npx cap sync`
3. Rebuild APK
4. Reinstall on phone

---

## Customization

### Change App Name

Edit `android/app/src/main/res/values/strings.xml`:
```xml
<string name="app_name">TaskFlow</string>
```

### Change App Icon

Replace these files in `android/app/src/main/res/`:
- `mipmap-hdpi/ic_launcher.png` (72x72)
- `mipmap-mdpi/ic_launcher.png` (48x48)
- `mipmap-xhdpi/ic_launcher.png` (96x96)
- `mipmap-xxhdpi/ic_launcher.png` (144x144)
- `mipmap-xxxhdpi/ic_launcher.png` (192x192)

Or use Android Studio's Image Asset tool:
1. Right-click `res` folder
2. New → Image Asset
3. Follow the wizard

### Change Theme Colors

Edit `android/app/src/main/res/values/styles.xml`

### Change Package Name

Edit `capacitor.config.json`:
```json
{
  "appId": "com.yourname.taskflow"
}
```

Then run:
```bash
npx cap sync
```

---

## Publishing to Google Play Store (Optional)

### 1. Create Keystore

```bash
cd android/app
keytool -genkey -v -keystore taskflow-release-key.keystore -alias taskflow -keyalg RSA -keysize 2048 -validity 10000
```

### 2. Configure Signing

Edit `android/app/build.gradle` and add:
```gradle
android {
    signingConfigs {
        release {
            storeFile file('taskflow-release-key.keystore')
            storePassword 'your-password'
            keyAlias 'taskflow'
            keyPassword 'your-password'
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
```

### 3. Build Release APK

```bash
cd android
./gradlew assembleRelease
```

### 4. Upload to Play Console

- Create developer account: https://play.google.com/console
- Create new app and upload APK
- Fill in store listing details
- Submit for review

---

## Quick Reference Commands

```bash
# Sync web assets to native project
npx cap sync

# Open in Android Studio
npx cap open android

# Build and run on connected device
npx cap run android

# Build debug APK via command line
cd android && ./gradlew assembleDebug

# Build release APK
cd android && ./gradlew assembleRelease

# Update Capacitor plugins
npm update

# Check Capacitor config
npx cap doctor
```

---

## Architecture Summary

```
Flask Server (your-domain.com)
    ↓
Web App (HTML/CSS/JS)
    ↓
Capacitor Bridge
    ↓
Native Android APIs
    ↓
Local Notifications, Camera, etc.
```

**Key Files:**
- `capacitor.config.json` - Main configuration
- `android/app/src/main/AndroidManifest.xml` - Permissions
- `static/capacitor-notifications.js` - Notification service
- `static/mobile-enhancements.css` - Mobile UI improvements

---

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Run `npx cap doctor` to diagnose configuration issues
3. Check Capacitor docs: https://capacitorjs.com/docs
4. Check Android Studio Logcat for detailed error messages

---

## Next Steps

- ✅ Set up automatic deployment for your Flask server
- ✅ Configure HTTPS for production (required for secure connections)
- ✅ Consider setting up app icons and splash screens
- ✅ Test on multiple Android devices
- ✅ Create a release build for distribution

**Enjoy your native Android app with reliable notifications!** 🎉
