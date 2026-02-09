document.addEventListener('DOMContentLoaded', () => {
    const prefStatusEl = document.getElementById('pref-save-status');
    const prefsInputs = {
        in_app_enabled: document.getElementById('pref-in-app'),
        email_enabled: document.getElementById('pref-email'),
        push_enabled: document.getElementById('pref-push'),
        reminders_enabled: document.getElementById('pref-reminders'),
        digest_enabled: document.getElementById('pref-digest'),
        digest_hour: document.getElementById('pref-digest-hour'),
        default_snooze_minutes: document.getElementById('pref-snooze-minutes'),
    };

    const accountInputs = {
        username: document.getElementById('account-username'),
        currentPin: document.getElementById('account-current-pin'),
        newPin: document.getElementById('account-new-pin'),
        confirmPin: document.getElementById('account-confirm-pin'),
        saveBtn: document.getElementById('account-save-btn'),
        status: document.getElementById('account-save-status')
    };

    let saveTimer = null;

    function setPrefStatus(message, isError = false) {
        if (!prefStatusEl) return;
        prefStatusEl.textContent = message || '';
        prefStatusEl.style.color = isError ? 'var(--danger-color)' : 'var(--text-muted)';
    }

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
            setPrefStatus('');
        } catch (e) {
            console.error('Error loading preferences', e);
            setPrefStatus('Could not load notification preferences.', true);
        }
    }

    async function savePrefs(showSuccess = false) {
        const payload = {
            in_app_enabled: prefsInputs.in_app_enabled?.checked,
            email_enabled: prefsInputs.email_enabled?.checked,
            push_enabled: prefsInputs.push_enabled?.checked,
            reminders_enabled: prefsInputs.reminders_enabled?.checked,
            digest_enabled: prefsInputs.digest_enabled?.checked,
            digest_hour: prefsInputs.digest_hour?.value ? parseInt(prefsInputs.digest_hour.value, 10) : undefined,
            default_snooze_minutes: prefsInputs.default_snooze_minutes?.value ? parseInt(prefsInputs.default_snooze_minutes.value, 10) : undefined,
        };
        setPrefStatus('Saving...');
        try {
            const res = await fetch('/api/notifications/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to save notification preferences');
            }
            setPrefStatus('Saved.');
            if (showSuccess) {
                showToast('Notification preferences saved', 'success', 1800);
            }
        } catch (e) {
            console.error('Error saving preferences', e);
            setPrefStatus('Failed to save.', true);
            showToast('Could not save notification preferences', 'error', 2200);
        }
    }

    async function loadAccount() {
        if (!accountInputs.username) return;
        try {
            const res = await fetch('/api/user/profile');
            if (!res.ok) throw new Error('Failed to load profile');
            const data = await res.json();
            accountInputs.username.value = data.username || '';
        } catch (e) {
            console.error('Error loading profile', e);
        }
    }

    async function saveAccount() {
        if (!accountInputs.saveBtn) return;
        const username = accountInputs.username?.value.trim() || '';
        const currentPin = accountInputs.currentPin?.value.trim() || '';
        const newPin = accountInputs.newPin?.value.trim() || '';
        const confirmPin = accountInputs.confirmPin?.value.trim() || '';

        if (!currentPin) {
            setAccountStatus('Enter your current PIN.', true);
            return;
        }

        if ((newPin || confirmPin) && newPin !== confirmPin) {
            setAccountStatus('PINs do not match.', true);
            return;
        }

        setAccountStatus('Saving...');
        try {
            const res = await fetch('/api/user/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: username,
                    current_pin: currentPin,
                    new_pin: newPin,
                    confirm_pin: confirmPin
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setAccountStatus(data.error || 'Failed to save.', true);
                return;
            }
            setAccountStatus('Saved.');
            accountInputs.currentPin.value = '';
            accountInputs.newPin.value = '';
            accountInputs.confirmPin.value = '';
            if (data.username && accountInputs.username) {
                accountInputs.username.value = data.username;
                const currentName = document.getElementById('current-username');
                if (currentName) currentName.textContent = data.username;
            }
        } catch (e) {
            console.error('Error saving profile', e);
            setAccountStatus('Failed to save.', true);
        }
    }

    function setAccountStatus(message, isError = false) {
        if (!accountInputs.status) return;
        accountInputs.status.textContent = message;
        accountInputs.status.style.color = isError ? 'var(--danger-color)' : 'var(--text-muted)';
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
        const vapidKey = window.VAPID_PUBLIC_KEY || '';
        if (!vapidKey) throw new Error('VAPID public key missing');
        const reg = await ensureServiceWorkerRegistered();
        if (!reg) throw new Error('Service worker not available');
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
            return existing;
        }
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
        const res = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Subscribe failed: ${res.status} ${txt}`);
        }
    }

    async function sendTest() {
        try {
            const res = await fetch('/api/notifications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'test',
                    title: 'Test notification',
                    body: 'This is a test notification.',
                    channel: 'push'
                })
            });
            if (!res.ok) {
                throw new Error('Failed to send test notification');
            }
            await loadPrefs();
            window.dispatchEvent(new Event('notifications:refresh'));
            setPrefStatus('Test notification sent.');
            showToast('Test notification sent', 'success', 1800);
        } catch (e) {
            console.error('Error sending test', e);
            setPrefStatus('Could not send test notification.', true);
            showToast('Could not send test notification', 'error', 2200);
        }
    }

    async function ensurePushSubscribed() {
        try {
            const sub = await subscribePush();
            await saveSubscription(sub);
            await fetch('/api/push/subscriptions');
        } catch (e) {
            console.error('Push subscription failed', e);
            showToast('Push permission or subscription failed', 'error', 2500);
        }
    }

    const saveBtn = document.getElementById('pref-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', () => savePrefs(true));
    const testBtn = document.getElementById('pref-test-btn');
    if (testBtn) testBtn.addEventListener('click', sendTest);
    if (accountInputs.saveBtn) accountInputs.saveBtn.addEventListener('click', saveAccount);

    // Auto-save on change
    Object.entries(prefsInputs).forEach(([key, input]) => {
        if (!input) return;
        input.addEventListener('change', async () => {
            if (key === 'push_enabled') {
                if (input.checked) {
                    try {
                        await ensurePushSubscribed();
                    } catch (e) {
                        console.error('Push subscription failed', e);
                        input.checked = false;
                    }
                } else {
                    await unsubscribePush();
                }
            }
            scheduleSave();
        });
        input.addEventListener('input', scheduleSave);
    });

    loadPrefs();
    loadAccount();
});
