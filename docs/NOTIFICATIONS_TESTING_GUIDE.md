# Notification System - Complete Testing Guide

## ✅ Implementation Complete

The notification system has been fully implemented with:
- ✅ Web Push Notifications (via VAPID)
- ✅ Service Worker for PWA support
- ✅ Calendar event reminders
- ✅ Background jobs for automatic notifications
- ✅ Mobile PWA support

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Restart the App
```bash
python app.py
```

The `.env` file has been created with VAPID keys. The app will automatically load them.

---

## 🧪 Testing on Desktop (Web Browser)

### Test 1: Enable Notifications
1. Open the app in your browser (Chrome, Edge, or Firefox recommended)
2. Navigate to Calendar view
3. Click the **More Options** button (⋮) in the calendar header
4. Click **"Enable Notifications"**
5. **Allow** when the browser asks for notification permission
6. You should see a success notification appear

### Test 2: Send Test Push Notification
1. Open browser Developer Tools (F12)
2. Go to Console tab
3. Run this command:
```javascript
fetch('/api/push/test', { method: 'POST' })
  .then(r => r.json())
  .then(d => console.log('Sent:', d.sent, 'notifications'))
```
4. You should receive a test push notification

### Test 3: Calendar Reminder (Local)
1. Create a calendar event for 2 minutes from now
2. Set a reminder for 1 minute before (using `*1` syntax or the reminder button)
3. Wait 1 minute
4. You should receive a notification when the reminder triggers

### Test 4: Calendar Reminder (Push - Background)
1. Create a calendar event for 5-10 minutes from now
2. Set a reminder for 1 minute before
3. **Close the browser tab** (or minimize it)
4. The backend job runs every minute and will send a push notification
5. You should receive the notification even with the tab closed!

---

## 📱 Testing on Mobile (PWA)

### Setup PWA
1. Open the app in Chrome/Edge on your phone
2. Tap the browser menu (⋮)
3. Select **"Add to Home Screen"** or **"Install App"**
4. The app will be installed as a PWA

### Test Mobile Push Notifications
1. Open the PWA app
2. Enable notifications (Calendar → More Options → Enable Notifications)
3. Allow notification permission when prompted
4. Create an event with a reminder

### Test Background Notifications
1. Create an event 5-10 minutes from now with a 1-minute reminder
2. **Exit the PWA app completely** (swipe it away from recent apps)
3. Wait for the reminder time
4. You should receive a push notification on your phone!
5. Tapping the notification will open the PWA to the calendar

---

## 🔧 Advanced Testing

### Verify Service Worker Registration
1. Open Developer Tools (F12)
2. Go to **Application** tab (Chrome) or **Storage** tab (Firefox)
3. Click **Service Workers** in the left sidebar
4. You should see `/static/service-worker.js` registered and running

### Verify Push Subscription
1. In Developer Tools → Application → Service Workers
2. Check that the service worker is "activated and running"
3. Go to Console and run:
```javascript
navigator.serviceWorker.ready.then(reg =>
  reg.pushManager.getSubscription().then(sub =>
    console.log('Subscribed:', sub !== null)
  )
)
```
4. Should log `Subscribed: true`

### Check Backend Logs
The server logs will show:
```
INFO: Push subscribe for user 1 endpoint https://...
INFO: Sending push to 1 subs for user 1
```

### Manual Push Test via Console
```javascript
// Send a test notification
fetch('/api/push/test', { method: 'POST' })
  .then(r => r.json())
  .then(data => {
    if (data.sent > 0) {
      console.log('✅ Push sent successfully!');
    } else {
      console.log('❌ No subscriptions or VAPID not configured');
    }
  });
```

---

## 📋 Notification Settings

Users can configure notifications at `/settings`:
- **In-App Notifications**: Show in the notification bell
- **Push Notifications**: Web push (enabled when you click "Enable Notifications")
- **Reminders**: Calendar event reminders
- **Email Digest**: Daily email summary (requires SMTP configuration)

---

## 🐛 Troubleshooting

### Notifications Not Working?

**Check 1: Browser Permission**
- Go to browser settings → Site permissions → Notifications
- Ensure your app URL is allowed

**Check 2: Service Worker**
- DevTools → Application → Service Workers
- Should show "activated and running"
- If not, try clicking "Unregister" then refresh the page

**Check 3: VAPID Keys**
- Check that `.env` file exists with VAPID keys
- Restart the Flask app after adding `.env`

**Check 4: Push Subscription**
```javascript
navigator.serviceWorker.ready.then(reg =>
  reg.pushManager.getSubscription().then(sub => {
    if (!sub) console.log('❌ Not subscribed to push');
    else console.log('✅ Subscribed:', sub.endpoint);
  })
)
```

**Check 5: Backend Logs**
Look for errors in the Flask console output

### Mobile PWA Not Receiving Notifications?

1. **Ensure PWA is installed**: Just using the website in mobile browser won't work for background notifications
2. **Check phone settings**: Go to phone Settings → Apps → [Your App] → Notifications → Ensure enabled
3. **Battery optimization**: Some phones kill PWAs to save battery. Check battery optimization settings

### Clear and Reset
If things get stuck:
```javascript
// Unregister service worker
navigator.serviceWorker.getRegistrations().then(regs =>
  regs.forEach(reg => reg.unregister())
);

// Clear subscription
navigator.serviceWorker.ready.then(reg =>
  reg.pushManager.getSubscription().then(sub =>
    sub?.unsubscribe()
  )
);
```

Then refresh the page and enable notifications again.

---

## 🎯 How It Works

### Local Notifications (Browser Open)
- When you enable notifications, the app schedules JavaScript timers
- When a reminder time arrives, it shows a notification via the browser
- **Limitation**: Only works when the browser tab is open

### Push Notifications (Background)
- Backend job runs every minute checking for upcoming reminders
- If a reminder is due, it sends a Web Push to all subscribed devices
- Service worker receives the push and displays notification
- **Works even when browser/PWA is closed!**

### Notification Flow
```
1. User enables notifications
   ↓
2. Browser requests permission
   ↓
3. Service worker registers
   ↓
4. Push subscription created with VAPID keys
   ↓
5. Subscription sent to backend
   ↓
6. Backend stores subscription in database
   ↓
7. When reminder triggers:
   - Backend sends Web Push
   - Service worker receives it
   - Notification displays on device
```

---

## 📊 Testing Checklist

- [ ] Desktop: Enable notifications successfully
- [ ] Desktop: Receive test push notification
- [ ] Desktop: Receive calendar reminder (tab open)
- [ ] Desktop: Receive calendar reminder (tab closed)
- [ ] Mobile: Install PWA
- [ ] Mobile: Enable notifications
- [ ] Mobile: Receive notification while app is open
- [ ] Mobile: Receive notification while app is closed
- [ ] Service worker registered and active
- [ ] Push subscription created
- [ ] Backend logs show push being sent

---

## 🔐 Security Notes

- VAPID keys are generated uniquely for your app
- Push subscriptions are stored per-user in the database
- Notifications only sent to subscribed devices
- All communication uses HTTPS (required for service workers)

---

## 🚨 Important for Production

1. **HTTPS Required**: Service workers and push notifications only work on HTTPS
2. **Domain**: Update `VAPID_SUBJECT` in `.env` to `mailto:your-email@yourdomain.com`
3. **SMTP**: Configure email settings in `.env` for email digest feature
4. **Firewall**: Ensure server can make outbound HTTPS requests for Web Push

---

## ✨ Features

✅ **Instant notifications** when tab is open
✅ **Background notifications** when app is closed (PWA)
✅ **Calendar reminders** with customizable time
✅ **Click to navigate** - notification click opens calendar
✅ **Per-user subscriptions** - each device gets own notifications
✅ **Automatic cleanup** - invalid subscriptions removed
✅ **Cross-platform** - works on desktop and mobile

---

Need help? Check the browser console for errors or backend logs for debugging information.
