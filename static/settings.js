document.addEventListener('DOMContentLoaded', () => {
    console.log('[push] settings script loaded');
    const prefsInputs = {
        in_app_enabled: document.getElementById('pref-in-app'),
        email_enabled: document.getElementById('pref-email'),
        push_enabled: document.getElementById('pref-push'),
        reminders_enabled: document.getElementById('pref-reminders'),
        digest_enabled: document.getElementById('pref-digest'),
        digest_hour: document.getElementById('pref-digest-hour'),
        default_snooze_minutes: document.getElementById('pref-snooze-minutes'),
    };

    let saveTimer = null;

    async function loadPrefs() {
        try {
            const res = await fetch('/api/notifications/settings');
            if (!res.ok) throw new Error('Failed to load preferences');
            const data = await res.json();
            if (prefsInputs.in_app_enabled) prefsInputs.in_app_enabled.checked = !!data.in_app_enabled;
            if (prefsInputs.email_enabled) prefsInputs.email_enabled.checked = !!data.email_enabled;
            if (prefsInputs.push_enabled) prefsInputs.push_enabled.checked = !!data.push_enabled;
            if (prefsInputs.reminders_enabled) prefsInputs.reminders_enabled.checked = !!data.reminders_enabled;
            if (prefsInputs.digest_enabled) prefsInputs.digest_enabled.checked = !!data.digest_enabled;
            if (prefsInputs.digest_hour && data.digest_hour !== undefined) prefsInputs.digest_hour.value = data.digest_hour;
            if (prefsInputs.default_snooze_minutes && data.default_snooze_minutes !== undefined) prefsInputs.default_snooze_minutes.value = data.default_snooze_minutes;
            if (prefsInputs.push_enabled && prefsInputs.push_enabled.checked) {
                ensurePushSubscribed();
            }
        } catch (e) {
            console.error('Error loading preferences', e);
        }
    }

    async function savePrefs() {
        const payload = {
            in_app_enabled: prefsInputs.in_app_enabled?.checked,
            email_enabled: prefsInputs.email_enabled?.checked,
            push_enabled: prefsInputs.push_enabled?.checked,
            reminders_enabled: prefsInputs.reminders_enabled?.checked,
            digest_enabled: prefsInputs.digest_enabled?.checked,
            digest_hour: prefsInputs.digest_hour?.value ? parseInt(prefsInputs.digest_hour.value, 10) : undefined,
            default_snooze_minutes: prefsInputs.default_snooze_minutes?.value ? parseInt(prefsInputs.default_snooze_minutes.value, 10) : undefined,
        };
        try {
            await fetch('/api/notifications/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (e) {
            console.error('Error saving preferences', e);
        }
    }

    function scheduleSave() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            savePrefs();
        }, 300);
    }

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    async function subscribePush() {
        console.log('[push] subscribePush start');
        const vapidKey = window.VAPID_PUBLIC_KEY || '';
        if (!vapidKey) throw new Error('VAPID public key missing');
        const reg = await ensureServiceWorkerRegistered();
        if (!reg) throw new Error('Service worker not available');
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
            console.log('[push] existing subscription found');
            return existing;
        }
        console.log('[push] subscribing with VAPID key', vapidKey.slice(0, 8) + '...');
        let sub = null;
        try {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidKey)
            });
        } catch (err) {
            console.error('[push] subscribe error', err);
            throw err;
        }
        console.log('[push] new subscription created', sub);
        return sub;
    }

    async function unsubscribePush() {
        const reg = await ensureServiceWorkerRegistered();
        if (!reg) return;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
            const endpoint = sub.endpoint;
            await sub.unsubscribe();
            await fetch('/api/push/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint })
            });
        }
    }

    async function saveSubscription(sub) {
        if (!sub) return;
        const payload = { subscription: sub.toJSON ? sub.toJSON() : sub };
        console.log('[push] saving subscription to server', payload);
        const res = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Subscribe failed: ${res.status} ${txt}`);
        }
        console.log('[push] subscription stored on server', res.status);
    }

    async function sendTest() {
        try {
            await fetch('/api/notifications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'test',
                    title: 'Test notification',
                    body: 'This is a test notification.',
                    channel: 'push'
                })
            });
            await loadPrefs();
            window.dispatchEvent(new Event('notifications:refresh'));
        } catch (e) {
            console.error('Error sending test', e);
        }
    }

    async function ensurePushSubscribed() {
        try {
            console.log('[push] ensurePushSubscribed start');
            const sub = await subscribePush();
            await saveSubscription(sub);
            const serverSubs = await fetch('/api/push/subscriptions').then(r => r.json());
            console.log('[push] server subscriptions after save', serverSubs);
        } catch (e) {
            console.error('Push subscription failed', e);
        }
    }

    const saveBtn = document.getElementById('pref-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', savePrefs);
    const testBtn = document.getElementById('pref-test-btn');
    if (testBtn) testBtn.addEventListener('click', sendTest);

    // Auto-save on change
    Object.entries(prefsInputs).forEach(([key, input]) => {
        if (!input) return;
        input.addEventListener('change', async () => {
            console.log('[push] change detected', key, input.checked);
            if (key === 'push_enabled') {
                if (input.checked) {
                    try {
                        await ensurePushSubscribed();
                        console.log('[push] push toggle save starting');
                    } catch (e) {
                        console.error('Push subscription failed', e);
                        input.checked = false;
                    }
                } else {
                    await unsubscribePush();
                    console.log('[push] push toggle save starting (off)');
                }
            }
            scheduleSave();
        });
        input.addEventListener('input', scheduleSave);
    });

    loadPrefs();
});
