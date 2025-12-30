# TaskFlow Android App - Quick Start

## 🚀 Get Your APK in 5 Minutes

### 1. Configure Server URL

**Find your computer's IP address:**
```bash
# Windows
ipconfig

# Look for "IPv4 Address" under your WiFi adapter
# Example: 192.168.1.100
```

**Set the server URL:**
```bash
node configure-server.js http://YOUR-IP:5000
# Example: node configure-server.js http://192.168.1.100:5000
```

### 2. Start Your Flask Server

```bash
python app.py
# Make sure it's running on port 5000
```

### 3. Build the APK

**Option A - Android Studio (Easiest):**
```bash
npx cap sync
npx cap open android
# Click the green ▶ play button
```

**Option B - Command Line:**
```bash
npx cap sync
cd android
./gradlew assembleDebug
# APK will be in: android/app/build/outputs/apk/debug/app-debug.apk
```

### 4. Install on Phone

**Transfer the APK** to your phone and install it.

**Or run directly:**
```bash
# Connect phone via USB with Developer Mode enabled
npx cap run android
```

### 5. Enable Notifications

1. Open the app on your phone
2. Allow notification permissions when prompted
3. Go to Calendar page
4. Tap "Enable Notifications"
5. Create a calendar event with a reminder

**Done!** 🎉 Your notifications will now work reliably.

---

## 📱 Testing

1. Create a calendar event with a 1-minute reminder
2. Close the app completely
3. Turn off your screen
4. Wait for the reminder - you should get a notification!

---

## 🔄 Making Updates

### Code Changes (No APK Rebuild)

Just update your Flask code and deploy - the app auto-updates! ✨

### Native Changes (Requires APK Rebuild)

1. Make changes
2. Run `npx cap sync`
3. Rebuild APK
4. Reinstall on phone

---

## ❓ Troubleshooting

**Can't connect to server?**
- ✅ Check Flask is running: visit http://YOUR-IP:5000 in phone's browser
- ✅ Make sure phone is on same WiFi network
- ✅ Verify server URL in capacitor.config.json

**Notifications not working?**
- ✅ Check Settings → Apps → TaskFlow → Notifications are enabled
- ✅ Tap "Enable Notifications" in Calendar page
- ✅ Verify reminder time is in the future

**Build failed?**
- ✅ Install Android Studio and Android SDK
- ✅ Make sure JAVA_HOME is set
- ✅ Run `npx cap doctor` to check configuration

---

## 📖 Full Documentation

See [ANDROID_BUILD_GUIDE.md](ANDROID_BUILD_GUIDE.md) for complete instructions.

---

## 🎯 Key Points

- **Install APK once** - it loads from your Flask server
- **Updates are instant** - just deploy to Flask, no APK rebuild
- **Works offline** - once loaded, basic functionality available
- **Native notifications** - reliable even with screen off
- **Same database** - web and mobile apps stay in sync

**Your Flask server must be running and accessible from your phone!**
