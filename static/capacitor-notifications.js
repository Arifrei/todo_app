/**
 * Capacitor Notification Service
 * Provides unified notification API that works in both native app and web browser
 */

// Check if running in Capacitor native app
function isNativeApp() {
    return window.Capacitor && window.Capacitor.isNativePlatform();
}

// Global notification service
const NotificationService = {
    /**
     * Initialize the notification service
     * Requests permissions and sets up listeners
     */
    async initialize() {
        if (isNativeApp()) {
            console.log('Running in native app - using Capacitor Local Notifications');
            try {
                const { LocalNotifications } = window.Capacitor.Plugins;

                // Request permission
                const permission = await LocalNotifications.requestPermissions();
                if (permission.display !== 'granted') {
                    console.warn('Notification permission not granted');
                    return false;
                }

                // Listen for notification actions (when user taps notification)
                await LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
                    console.log('Notification tapped:', notification);

                    // Handle notification tap - navigate to relevant page
                    if (notification.notification.extra?.url) {
                        window.location.href = notification.notification.extra.url;
                    }
                });

                console.log('Native notifications initialized successfully');
                return true;
            } catch (error) {
                console.error('Failed to initialize native notifications:', error);
                return false;
            }
        } else {
            console.log('Running in web browser - using Web Notifications API');
            // Use existing web notification system
            if ('Notification' in window) {
                const permission = await Notification.requestPermission();
                return permission === 'granted';
            }
            return false;
        }
    },

    /**
     * Schedule a notification
     * @param {Object} options - Notification options
     * @param {number} options.id - Unique notification ID
     * @param {string} options.title - Notification title
     * @param {string} options.body - Notification body
     * @param {Date} options.at - When to show the notification
     * @param {Object} options.extra - Extra data (e.g., {url: '/calendar'})
     */
    async schedule(options) {
        if (isNativeApp()) {
            try {
                const { LocalNotifications } = window.Capacitor.Plugins;

                await LocalNotifications.schedule({
                    notifications: [{
                        id: options.id,
                        title: options.title,
                        body: options.body,
                        schedule: { at: options.at },
                        extra: options.extra || {},
                        smallIcon: 'ic_stat_icon_config_sample',
                        channelId: 'taskflow_reminders'
                    }]
                });

                console.log('Native notification scheduled:', options.title, 'at', options.at);
                return true;
            } catch (error) {
                console.error('Failed to schedule native notification:', error);
                return false;
            }
        } else {
            // Fallback to web notifications with setTimeout
            const delay = options.at.getTime() - Date.now();
            if (delay > 0) {
                setTimeout(() => {
                    this.show(options.title, {
                        body: options.body,
                        data: options.extra
                    });
                }, delay);
                return true;
            }
            return false;
        }
    },

    /**
     * Show an immediate notification
     * @param {string} title - Notification title
     * @param {Object} options - Notification options
     */
    async show(title, options = {}) {
        if (isNativeApp()) {
            try {
                const { LocalNotifications } = window.Capacitor.Plugins;

                await LocalNotifications.schedule({
                    notifications: [{
                        id: Date.now(), // Generate unique ID
                        title: title,
                        body: options.body || '',
                        schedule: { at: new Date(Date.now() + 1000) }, // Show after 1 second
                        extra: options.data || {},
                        smallIcon: 'ic_stat_icon_config_sample',
                        channelId: 'taskflow_general'
                    }]
                });

                return true;
            } catch (error) {
                console.error('Failed to show native notification:', error);
                return false;
            }
        } else {
            // Use existing web notification system
            if ('Notification' in window && Notification.permission === 'granted') {
                try {
                    const reg = await ensureServiceWorkerRegistered();
                    if (reg?.active?.state === 'activated') {
                        await reg.showNotification(title, options);
                    } else {
                        new Notification(title, options);
                    }
                    return true;
                } catch (error) {
                    console.error('Failed to show web notification:', error);
                    return false;
                }
            }
            return false;
        }
    },

    /**
     * Cancel a scheduled notification
     * @param {number} id - Notification ID to cancel
     */
    async cancel(id) {
        if (isNativeApp()) {
            try {
                const { LocalNotifications } = window.Capacitor.Plugins;
                await LocalNotifications.cancel({ notifications: [{ id }] });
                console.log('Cancelled notification:', id);
                return true;
            } catch (error) {
                console.error('Failed to cancel notification:', error);
                return false;
            }
        } else {
            // Web notifications scheduled with setTimeout can't be easily cancelled
            // This would require storing timeout IDs - keeping it simple for now
            return false;
        }
    },

    /**
     * Cancel all pending notifications
     */
    async cancelAll() {
        if (isNativeApp()) {
            try {
                const { LocalNotifications } = window.Capacitor.Plugins;

                // Get all pending notifications and cancel them
                const pending = await LocalNotifications.getPending();
                if (pending.notifications.length > 0) {
                    await LocalNotifications.cancel({
                        notifications: pending.notifications
                    });
                    console.log('Cancelled all notifications:', pending.notifications.length);
                }
                return true;
            } catch (error) {
                console.error('Failed to cancel all notifications:', error);
                return false;
            }
        }
        return false;
    },

    /**
     * Check if notifications are enabled
     */
    async hasPermission() {
        if (isNativeApp()) {
            try {
                const { LocalNotifications } = window.Capacitor.Plugins;
                const permission = await LocalNotifications.checkPermissions();
                return permission.display === 'granted';
            } catch (error) {
                return false;
            }
        } else {
            return 'Notification' in window && Notification.permission === 'granted';
        }
    },

    /**
     * Create notification channels (Android only)
     */
    async createChannels() {
        if (isNativeApp()) {
            try {
                const { LocalNotifications } = window.Capacitor.Plugins;

                await LocalNotifications.createChannel({
                    id: 'taskflow_reminders',
                    name: 'Task Reminders',
                    description: 'Notifications for calendar events and task reminders',
                    importance: 5, // High importance
                    sound: 'beep.wav',
                    vibration: true,
                    lights: true,
                    lightColor: '#3b82f6'
                });

                await LocalNotifications.createChannel({
                    id: 'taskflow_general',
                    name: 'General Notifications',
                    description: 'General app notifications',
                    importance: 3, // Default importance
                    vibration: true
                });

                console.log('Notification channels created');
                return true;
            } catch (error) {
                console.error('Failed to create notification channels:', error);
                return false;
            }
        }
        return true; // Web doesn't need channels
    }
};

// Auto-initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
        await NotificationService.createChannels();
        await NotificationService.initialize();
    });
} else {
    // DOM already loaded
    NotificationService.createChannels().then(() => {
        NotificationService.initialize();
    });
}

// Make globally available
window.NotificationService = NotificationService;
window.isNativeApp = isNativeApp;
