/**
 * Capacitor Notification Service
 * Provides unified notification API that works in both native app and web browser
 */

// Check if running in Capacitor native app
const notifyDebugLog = (...args) => {
    if (window.DEBUG_NOTIFICATIONS === true) console.log(...args);
};

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
            notifyDebugLog('Running in native app - using Capacitor Local Notifications');
            try {
                const { LocalNotifications } = window.Capacitor.Plugins;

                // Request permission
                const permission = await LocalNotifications.requestPermissions();
                if (permission.display !== 'granted') {
                    console.warn('Notification permission not granted');
                    return false;
                }

                // Register action types for snooze/dismiss buttons
                await LocalNotifications.registerActionTypes({
                    types: [
                        {
                            id: 'REMINDER_ACTIONS',
                            actions: [
                                {
                                    id: 'snooze',
                                    title: 'Snooze',
                                    requiresAuthentication: false
                                },
                                {
                                    id: 'dismiss',
                                    title: 'Dismiss',
                                    requiresAuthentication: false,
                                    destructive: true
                                }
                            ]
                        }
                    ]
                });

                // Listen for notification actions (when user taps notification or action buttons)
                await LocalNotifications.addListener('localNotificationActionPerformed', async (actionData) => {
                    notifyDebugLog('Notification action performed:', JSON.stringify(actionData));

                    const action = actionData.actionId;
                    // Check both camelCase and snake_case for compatibility
                    const eventId = actionData.notification.extra?.event_id || actionData.notification.extra?.eventId;

                    notifyDebugLog('Action:', action, 'EventId:', eventId);

                    if (action === 'snooze' && eventId) {
                        // Call snooze API
                        try {
                            // For native apps, fetch uses the configured server URL automatically
                            const apiUrl = `/api/calendar/events/${eventId}/snooze`;

                            notifyDebugLog('Calling snooze API:', apiUrl);
                            const response = await fetch(apiUrl, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({})
                            });

                            notifyDebugLog('Snooze response:', response.status, response.ok);

                            if (response.ok) {
                                const data = await response.json();
                                notifyDebugLog('Snooze API response data:', JSON.stringify(data));
                                const minutes = data.snooze_minutes || 10;
                                const snoozeUntil = new Date(data.snooze_until);
                                notifyDebugLog('Snoozed for', minutes, 'minutes until', snoozeUntil);

                                const { LocalNotifications } = window.Capacitor.Plugins;

                                try {
                                    // Schedule the snoozed reminder
                                    notifyDebugLog('Scheduling snoozed reminder with:', {
                                        id: eventId,
                                        title: actionData.notification.title,
                                        at: snoozeUntil
                                    });

                                    await LocalNotifications.schedule({
                                        notifications: [{
                                            id: eventId,  // Same ID so it replaces the original
                                            title: actionData.notification.title,
                                            body: actionData.notification.body,
                                            schedule: { at: snoozeUntil },
                                            extra: actionData.notification.extra,
                                            smallIcon: 'ic_notification_bell',
                                            channelId: 'taskflow_reminders',
                                            actionTypeId: 'REMINDER_ACTIONS'
                                        }]
                                    });
                                    notifyDebugLog('Snoozed reminder scheduled successfully');

                                    // Show confirmation
                                    notifyDebugLog('Scheduling confirmation notification');
                                    await LocalNotifications.schedule({
                                        notifications: [{
                                            id: Date.now(),
                                            title: 'Reminder Snoozed',
                                            body: `You will be reminded again in ${minutes} minute${minutes !== 1 ? 's' : ''}`,
                                            schedule: { at: new Date(Date.now() + 500) },
                                            channelId: 'taskflow_general'
                                        }]
                                    });
                                    notifyDebugLog('Confirmation notification scheduled');

                                    notifyDebugLog('All notifications scheduled for snooze');
                                } catch (notifError) {
                                    console.error('Error scheduling notifications:', notifError);
                                }
                            } else {
                                console.error('Snooze failed:', await response.text());
                            }
                        } catch (error) {
                            console.error('Failed to snooze reminder:', error);
                        }
                    } else if (action === 'dismiss' && eventId) {
                        // Call dismiss API
                        try {
                            const apiUrl = `/api/calendar/events/${eventId}/dismiss`;

                            notifyDebugLog('Calling dismiss API:', apiUrl);
                            const response = await fetch(apiUrl, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' }
                            });
                            notifyDebugLog('Dismiss response:', response.status, response.ok);
                        } catch (error) {
                            console.error('Failed to dismiss reminder:', error);
                        }
                    } else if (action === 'tap') {
                        // Default action: navigate to relevant page
                        if (actionData.notification.extra?.url) {
                            window.location.href = actionData.notification.extra.url;
                        }
                    }
                });

                notifyDebugLog('Native notifications initialized successfully');
                return true;
            } catch (error) {
                console.error('Failed to initialize native notifications:', error);
                return false;
            }
        } else {
            notifyDebugLog('Running in web browser - using Web Notifications API');
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
                        smallIcon: 'ic_notification_bell',
                        channelId: 'taskflow_reminders',
                        actionTypeId: 'REMINDER_ACTIONS'  // Add snooze/dismiss buttons
                    }]
                });

                notifyDebugLog('Native notification scheduled:', options.title, 'at', options.at);
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
                        smallIcon: 'ic_notification_bell',
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
                notifyDebugLog('Cancelled notification:', id);
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
                    notifyDebugLog('Cancelled all notifications:', pending.notifications.length);
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

                notifyDebugLog('Notification channels created');
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

/**
 * Poll for pending reminders and schedule them locally (mobile only)
 */
async function syncPendingReminders() {
    if (!isNativeApp()) return;

    try {
        const response = await fetch('/api/calendar/events/pending-reminders');

        if (!response.ok) {
            console.error('Failed to fetch pending reminders:', response.status);
            return;
        }

        const data = await response.json();
        const reminders = data.reminders || [];
        const pendingReminderIds = new Set(
            reminders
                .map(reminder => Number(reminder.event_id))
                .filter(id => Number.isFinite(id) && id > 0)
        );

        notifyDebugLog(`Found ${reminders.length} pending reminders to schedule`);

        const { LocalNotifications } = window.Capacitor.Plugins;
        const pendingLocal = await LocalNotifications.getPending();
        const staleReminderIds = new Set();
        (pendingLocal.notifications || []).forEach((notification) => {
            const extra = notification?.extra || {};
            const extraEventId = extra.event_id ?? extra.eventId;
            const channelId = notification?.channelId || notification?.channel_id;
            const actionTypeId = notification?.actionTypeId || notification?.actionType;
            const looksLikeTaskReminder = (
                extraEventId !== undefined && extraEventId !== null
            ) || channelId === 'taskflow_reminders' || actionTypeId === 'REMINDER_ACTIONS';
            if (!looksLikeTaskReminder) return;
            const linkedId = Number(extraEventId ?? notification?.id);
            if (!Number.isFinite(linkedId) || linkedId <= 0) return;
            if (!pendingReminderIds.has(linkedId)) staleReminderIds.add(linkedId);
        });
        if (staleReminderIds.size > 0) {
            await LocalNotifications.cancel({
                notifications: Array.from(staleReminderIds).map(id => ({ id }))
            });
            notifyDebugLog(`Cancelled ${staleReminderIds.size} stale task reminders`);
        }

        for (const reminder of reminders) {
            try {
                const remindAt = reminder.remind_at_ts
                    ? new Date(reminder.remind_at_ts)
                    : new Date(reminder.remind_at);

                // Only schedule if in the future
                if (remindAt > new Date()) {
                    await NotificationService.schedule({
                        id: reminder.event_id,
                        title: `Reminder: ${reminder.title}`,
                        body: `Starting at ${reminder.start_time}`,
                        at: remindAt,
                        extra: {
                            event_id: reminder.event_id,
                            url: reminder.url
                        }
                    });

                    notifyDebugLog(`Scheduled reminder for ${reminder.title} at ${remindAt}`);
                }
            } catch (error) {
                console.error('Failed to schedule reminder:', reminder, error);
            }
        }
    } catch (error) {
        console.error('Error syncing pending reminders:', error);
    }
}

// Sync reminders periodically (every 5 minutes) for mobile app
if (isNativeApp()) {
    // Initial sync after 5 seconds
    setTimeout(syncPendingReminders, 5000);

    // Then sync every 5 minutes
    setInterval(syncPendingReminders, 5 * 60 * 1000);

    // Also sync when app comes to foreground
    if (window.Capacitor?.Plugins?.App) {
        window.Capacitor.Plugins.App.addListener('appStateChange', (state) => {
            if (state.isActive) {
                notifyDebugLog('App became active, syncing reminders');
                syncPendingReminders();
            }
        });
    }
}

// Make globally available
window.NotificationService = NotificationService;
window.isNativeApp = isNativeApp;
window.syncPendingReminders = syncPendingReminders;
