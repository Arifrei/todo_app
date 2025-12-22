document.addEventListener('DOMContentLoaded', () => {
    const prefsInputs = {
        in_app_enabled: document.getElementById('pref-in-app'),
        email_enabled: document.getElementById('pref-email'),
        push_enabled: document.getElementById('pref-push'),
        reminders_enabled: document.getElementById('pref-reminders'),
        digest_enabled: document.getElementById('pref-digest'),
        digest_hour: document.getElementById('pref-digest-hour'),
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

    async function sendTest() {
        try {
            await fetch('/api/notifications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'test',
                    title: 'Test notification',
                    body: 'This is a test notification.',
                    channel: 'in_app'
                })
            });
            await loadPrefs();
            window.dispatchEvent(new Event('notifications:refresh'));
        } catch (e) {
            console.error('Error sending test', e);
        }
    }

    const saveBtn = document.getElementById('pref-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', savePrefs);
    const testBtn = document.getElementById('pref-test-btn');
    if (testBtn) testBtn.addEventListener('click', sendTest);

    // Auto-save on change
    Object.values(prefsInputs).forEach(input => {
        if (!input) return;
        input.addEventListener('change', scheduleSave);
        input.addEventListener('input', scheduleSave);
    });

    loadPrefs();
});
