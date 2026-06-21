(function () {
    const state = {
        items: [],
        editing: false
    };

    const moduleIconMap = {
        home: 'fa-solid fa-house',
        tasks: 'fa-solid fa-list-check',
        calendar: 'fa-solid fa-calendar-day',
        assistant: 'fa-solid fa-robot',
        notes: 'fa-solid fa-note-sticky',
        vault: 'fa-solid fa-folder-open',
        inbox: 'fa-solid fa-box-open',
        more: 'fa-solid fa-ellipsis-vertical',
        saved: 'fa-solid fa-bookmark'
    };

    function byId(id) {
        return document.getElementById(id);
    }

    function todayUrl(offset) {
        const date = new Date();
        date.setDate(date.getDate() + offset);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `/calendar?day=${y}-${m}-${d}&mode=day&view=list`;
    }

    function systemItems() {
        return [
            {
                id: 'system-today',
                title: 'Today',
                icon: 'fa-solid fa-calendar-day',
                url: todayUrl(0),
                item_type: 'system',
                subtitle: 'Calendar shortcut'
            },
            {
                id: 'system-tomorrow',
                title: 'Tomorrow',
                icon: 'fa-solid fa-calendar-plus',
                url: todayUrl(1),
                item_type: 'system',
                subtitle: 'Calendar shortcut'
            }
        ];
    }

    function moduleLabel(item) {
        if (item.subtitle) return item.subtitle;
        const labels = {
            custom: 'Custom link',
            list: 'Task destination',
            note: 'Note',
            folder: 'Notes folder',
            calendar: 'Calendar date',
            system: 'System shortcut'
        };
        return labels[item.item_type] || item.module || 'Shortcut';
    }

    function iconForCurrentPage() {
        const moduleName = document.body.dataset.module || 'tasks';
        return moduleIconMap[moduleName] || 'fa-solid fa-bookmark';
    }

    function openProtectedItem(item) {
        if (typeof openPinModal !== 'function') return false;
        if (typeof window.qaProtectedState === 'undefined') {
            window.qaProtectedState = {};
        }
        window.qaProtectedState.pendingUrl = item.url || '/quick-access';
        window.qaProtectedState.protectedType = item.protected_type || null;
        window.qaProtectedState.itemType = item.item_type || null;
        window.qaProtectedState.referenceId = item.reference_id ? Number(item.reference_id) : null;
        window.qaProtectedState.protectedFolderId = item.protected_folder_id ? Number(item.protected_folder_id) : null;
        window.qaProtectedState.active = true;
        openPinModal();
        return true;
    }

    function labelForCurrentPage() {
        const headerTitle = document.querySelector('.appheader h1');
        const pageTitle = headerTitle && headerTitle.textContent.trim();
        if (pageTitle) return pageTitle;
        const h1 = document.querySelector('main h1');
        if (h1 && h1.textContent.trim()) return h1.textContent.trim();
        return document.title || 'Shortcut';
    }

    function renderQuickAccess() {
        const list = byId('qa-sheet-list');
        const sheet = document.querySelector('.qa-sheet');
        const editBtn = byId('qa-sheet-edit');
        if (!list || !sheet) return;

        sheet.classList.toggle('is-editing', state.editing);
        if (editBtn) editBtn.textContent = state.editing ? 'Done' : 'Edit';

        list.replaceChildren();
        const allItems = [...systemItems(), ...state.items];
        if (!allItems.length) {
            const empty = document.createElement('div');
            empty.className = 'qa-sheet__state';
            empty.textContent = 'No shortcuts yet.';
            list.appendChild(empty);
            return;
        }

        allItems.forEach((item, index) => {
            const isSystem = String(item.id).startsWith('system-');
            const row = document.createElement(isSystem || !state.editing ? 'a' : 'div');
            row.className = 'qa-sheet__item';
            row.dataset.id = item.id;
            if (row.tagName === 'A') {
                row.href = item.url || '#';
                if (item.is_protected) {
                    row.addEventListener('click', (event) => {
                        if (!openProtectedItem(item)) return;
                        event.preventDefault();
                        event.stopPropagation();
                    });
                }
            }

            const icon = document.createElement('span');
            icon.className = 'qa-sheet__icon';
            icon.innerHTML = `<i class="${item.icon || 'fa-solid fa-bookmark'}" aria-hidden="true"></i>`;

            const text = document.createElement('span');
            text.className = 'qa-sheet__text';
            text.innerHTML = `
                <span class="qa-sheet__label"></span>
                <span class="qa-sheet__module"></span>
            `;
            text.querySelector('.qa-sheet__label').textContent = item.title || 'Untitled';
            text.querySelector('.qa-sheet__module').textContent = moduleLabel(item);

            const controls = document.createElement('span');
            controls.className = 'qa-sheet__edit';
            if (!isSystem) {
                controls.innerHTML = `
                    <button class="qa-mini-btn" type="button" data-qa-move="up" aria-label="Move up">↑</button>
                    <button class="qa-mini-btn" type="button" data-qa-move="down" aria-label="Move down">↓</button>
                    <button class="qa-mini-btn qa-mini-btn--danger" type="button" data-qa-remove aria-label="Remove">×</button>
                `;
            }

            row.append(icon, text, controls);
            list.appendChild(row);

            if (!isSystem && controls) {
                const customIndex = index - systemItems().length;
                controls.querySelector('[data-qa-move="up"]')?.addEventListener('click', () => moveQuickAccessItem(customIndex, -1));
                controls.querySelector('[data-qa-move="down"]')?.addEventListener('click', () => moveQuickAccessItem(customIndex, 1));
                controls.querySelector('[data-qa-remove]')?.addEventListener('click', () => removeQuickAccessItem(item.id));
            }
        });
    }

    async function loadQuickAccess() {
        const list = byId('qa-sheet-list');
        if (list) {
            list.innerHTML = '<div class="qa-sheet__state">Loading...</div>';
        }
        try {
            const res = await fetch('/api/quick-access');
            if (!res.ok) throw new Error('Failed to load quick access');
            state.items = await res.json();
        } catch (error) {
            console.error(error);
            state.items = [];
            if (list) {
                list.innerHTML = '<div class="qa-sheet__state">Could not load shortcuts.</div>';
                return;
            }
        }
        renderQuickAccess();
    }

    function openQuickAccess() {
        const scrim = byId('quick-access-sheet');
        if (!scrim) return;
        scrim.classList.add('is-open');
        scrim.setAttribute('aria-hidden', 'false');
        const sheet = scrim.querySelector('.qa-sheet');
        if (sheet) sheet.focus({ preventScroll: true });
        loadQuickAccess();
    }

    function closeQuickAccess() {
        const scrim = byId('quick-access-sheet');
        if (!scrim) return;
        scrim.classList.remove('is-open');
        scrim.setAttribute('aria-hidden', 'true');
        state.editing = false;
        renderQuickAccess();
    }

    async function persistOrder() {
        const order = state.items.map((item) => item.id);
        if (!order.length) return;
        try {
            await fetch('/api/quick-access/order', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order })
            });
        } catch (error) {
            console.error('Failed to persist quick access order', error);
        }
    }

    function moveQuickAccessItem(index, delta) {
        const next = index + delta;
        if (next < 0 || next >= state.items.length) return;
        const copy = [...state.items];
        const [item] = copy.splice(index, 1);
        copy.splice(next, 0, item);
        state.items = copy;
        renderQuickAccess();
        persistOrder();
    }

    async function removeQuickAccessItem(id) {
        const item = state.items.find((candidate) => Number(candidate.id) === Number(id));
        if (!item) return;
        if (!window.confirm(`Remove "${item.title || 'shortcut'}" from Quick Access?`)) return;
        try {
            const res = await fetch(`/api/quick-access/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            state.items = state.items.filter((candidate) => Number(candidate.id) !== Number(id));
            renderQuickAccess();
        } catch (error) {
            console.error(error);
            if (typeof showToast === 'function') showToast('Could not remove shortcut', 'error');
        }
    }

    async function addCurrentShortcut() {
        const payload = {
            title: labelForCurrentPage(),
            icon: iconForCurrentPage(),
            url: `${window.location.pathname}${window.location.search}`,
            item_type: document.body.dataset.module === 'calendar' ? 'calendar' : 'custom',
            reference_id: null
        };
        try {
            const res = await fetch('/api/quick-access', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Add failed');
            }
            const item = await res.json();
            state.items.push(item);
            state.editing = true;
            renderQuickAccess();
        } catch (error) {
            console.error(error);
            if (typeof showToast === 'function') showToast(error.message || 'Could not add shortcut', 'error');
        }
    }

    function applyStatusBarTheme() {
        const capacitor = window.Capacitor;
        const statusBar = capacitor?.Plugins?.StatusBar;
        if (!statusBar) return;

        const styles = getComputedStyle(document.body);
        const isHome = document.body.dataset.module === 'home';
        const color = isHome ? '#FFFFFF' : styles.getPropertyValue('--accent').trim();

        try {
            statusBar.setBackgroundColor({ color });
            statusBar.setStyle({ style: isHome ? 'DARK' : 'LIGHT' });
        } catch (error) {
            console.debug('StatusBar theming unavailable', error);
        }
    }

    function initShell() {
        document.querySelectorAll('.js-qa-open').forEach((button) => {
            button.addEventListener('click', openQuickAccess);
        });

        byId('qa-sheet-close')?.addEventListener('click', closeQuickAccess);
        byId('qa-sheet-add-current')?.addEventListener('click', addCurrentShortcut);
        byId('qa-sheet-edit')?.addEventListener('click', () => {
            state.editing = !state.editing;
            renderQuickAccess();
        });

        const scrim = byId('quick-access-sheet');
        if (scrim) {
            scrim.addEventListener('click', (event) => {
                if (event.target === scrim) closeQuickAccess();
            });
        }

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeQuickAccess();
        });

        applyStatusBarTheme();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initShell);
    } else {
        initShell();
    }
})();
