const feedState = {
    items: [],
    expandedId: null,
    editingId: null,
    selectedState: null,
    filterState: 'all',
    defaultStates: ['bored', 'work', 'free', 'travel'],
    customStates: [],
    addingState: false
};

function normalizeState(value) {
    return (value || '').toString().trim().toLowerCase();
}

function formatStateLabel(state) {
    if (!state) return '';
    return state.charAt(0).toUpperCase() + state.slice(1);
}

function getOrderedStates() {
    const base = feedState.defaultStates.slice();
    const seen = new Set(base);
    const fromItems = feedState.items
        .map(item => normalizeState(item.state))
        .filter(Boolean);
    const fromCustom = feedState.customStates
        .map(state => normalizeState(state))
        .filter(Boolean);
    [...fromItems, ...fromCustom].forEach((state) => {
        if (!seen.has(state)) {
            seen.add(state);
            base.push(state);
        }
    });
    return base;
}

function renderStateChips() {
    const chipWrap = document.getElementById('feed-state-chips');
    const addWrap = document.getElementById('feed-state-add');
    if (!chipWrap || !addWrap) return;

    chipWrap.innerHTML = '';
    const states = getOrderedStates();
    states.forEach((state) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `feed-state-chip ${feedState.selectedState === state ? 'active' : ''}`;
        btn.textContent = formatStateLabel(state);
        btn.addEventListener('click', () => {
            addFeedItemFromInput(state);
        });
        chipWrap.appendChild(btn);
    });

    const addChip = document.createElement('button');
    addChip.type = 'button';
    addChip.className = 'feed-state-chip add';
    addChip.textContent = '+ Add state';
    addChip.addEventListener('click', () => {
        feedState.addingState = true;
        renderStateChips();
        const input = document.getElementById('feed-state-input');
        if (input) input.focus();
    });

    if (!feedState.addingState) {
        chipWrap.appendChild(addChip);
    }
    addWrap.classList.toggle('active', feedState.addingState);
}

function renderFilterDropdown() {
    const selected = document.getElementById('feed-filter-selected');
    const menu = document.getElementById('feed-filter-menu');
    if (!selected || !menu) return;

    const label = feedState.filterState === 'all' ? 'All' : formatStateLabel(feedState.filterState);
    selected.innerHTML = `<span>${label}</span><i class="fa-solid fa-chevron-down"></i>`;

    menu.innerHTML = '';

    const allItem = document.createElement('div');
    allItem.className = `feed-filter-item ${feedState.filterState === 'all' ? 'active' : ''}`;
    allItem.textContent = 'All';
    allItem.addEventListener('click', (e) => {
        e.stopPropagation();
        feedState.filterState = 'all';
        closeFilterDropdown();
        renderFilterDropdown();
        renderFeedGrid();
    });
    menu.appendChild(allItem);

    getOrderedStates().forEach((state) => {
        const item = document.createElement('div');
        item.className = `feed-filter-item ${feedState.filterState === state ? 'active' : ''}`;
        item.setAttribute('data-state', state);
        item.textContent = formatStateLabel(state);
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            feedState.filterState = state;
            closeFilterDropdown();
            renderFilterDropdown();
            renderFeedGrid();
        });
        menu.appendChild(item);
    });
}

function toggleFilterDropdown() {
    const dropdown = document.getElementById('feed-filter-dropdown');
    if (dropdown) dropdown.classList.toggle('open');
}

function closeFilterDropdown() {
    const dropdown = document.getElementById('feed-filter-dropdown');
    if (dropdown) dropdown.classList.remove('open');
}

function parseFeedInput(raw) {
    if (!raw) return null;
    const parts = raw.split(';');
    const title = (parts[0] || '').trim();
    const url = (parts[1] || '').trim();
    const description = parts.slice(2).join(';').trim();
    return { title, url, description };
}

function normalizeUrl(url) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('www.')) return `https://${url}`;
    return `https://${url}`;
}

function openFeedUrl(id) {
    const item = feedState.items.find(i => i.id === id);
    if (!item) return;
    const target = normalizeUrl(item.url);
    if (target) {
        window.open(target, '_blank', 'noopener');
    }
}

function handleFeedAction(event, action, id) {
    event.stopPropagation();
    closeFeedSimpleMenus();
    if (action === 'open') {
        openFeedUrl(id);
    } else if (action === 'copy') {
        copyFeedUrl(id);
    } else if (action === 'date') {
        openFeedDatePrompt(id);
    } else if (action === 'done') {
        confirmDeleteFeed(id);
    } else if (action === 'edit') {
        startEditFeed(id);
    } else if (action === 'recall') {
        convertFeedToRecall(id);
    }
}

async function copyFeedUrl(id) {
    const item = feedState.items.find(i => i.id === id);
    const value = item ? (item.url || '').trim() : '';
    if (!value) {
        showToast('Nothing to copy', 'warning');
        return;
    }
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(value);
        } else {
            const temp = document.createElement('textarea');
            temp.value = value;
            temp.setAttribute('readonly', 'readonly');
            temp.style.position = 'absolute';
            temp.style.left = '-9999px';
            document.body.appendChild(temp);
            temp.select();
            document.execCommand('copy');
            temp.remove();
        }
        showToast('Copied', 'success');
    } catch (err) {
        console.error(err);
        showToast('Could not copy', 'error');
    }
}

function parseFeedDateValue(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    if (!year || !month || !day) return null;
    const parsed = new Date(year, month - 1, day);
    if (
        parsed.getFullYear() !== year ||
        parsed.getMonth() !== month - 1 ||
        parsed.getDate() !== day
    ) {
        return null;
    }
    return parsed;
}

function isFeedDateToday(dateStr) {
    const d = parseFeedDateValue(dateStr);
    if (!d) return false;
    const now = new Date();
    return d.getFullYear() === now.getFullYear()
        && d.getMonth() === now.getMonth()
        && d.getDate() === now.getDate();
}

function isFeedDatePast(dateStr) {
    const d = parseFeedDateValue(dateStr);
    if (!d) return false;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return d < todayStart;
}

function formatFeedScheduledDate(dateStr) {
    const d = parseFeedDateValue(dateStr);
    if (!d) return dateStr;
    const now = new Date();
    const includeYear = d.getFullYear() !== now.getFullYear();
    return d.toLocaleDateString(undefined, includeYear
        ? { month: 'short', day: 'numeric', year: 'numeric' }
        : { month: 'short', day: 'numeric' });
}

let feedDateModalState = { itemId: null, itemTitle: '' };

function closeFeedDateModal() {
    const modal = document.getElementById('feed-date-modal');
    if (modal) modal.classList.remove('active');
    feedDateModalState.itemId = null;
    feedDateModalState.itemTitle = '';
}

function openFeedDatePrompt(id) {
    const item = feedState.items.find(i => i.id === id);
    const modal = document.getElementById('feed-date-modal');
    const subtitle = document.getElementById('feed-date-subtitle');
    const input = document.getElementById('feed-date-input');
    if (!item || !modal || !input) return;

    feedDateModalState.itemId = id;
    feedDateModalState.itemTitle = (item.title || '').trim();
    input.value = item.scheduled_date || '';
    if (subtitle) {
        const title = (item.title || '').trim();
        subtitle.textContent = title
            ? `Set when to revisit "${title}".`
            : 'Set when to revisit this link.';
    }
    modal.classList.add('active');
    setTimeout(() => input.focus(), 0);
}

async function saveFeedDateFromModal(clearDate = false) {
    const id = feedDateModalState.itemId;
    const itemTitle = feedDateModalState.itemTitle || '';
    const input = document.getElementById('feed-date-input');
    if (!id || !input) return;

    const value = clearDate ? '' : (input.value || '').trim();
    if (value && !parseFeedDateValue(value)) {
        showToast('Use date format YYYY-MM-DD', 'error');
        return;
    }

    const persistDate = async () => {
        const res = await fetch(`/api/feed/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scheduled_date: value || null })
        });
        if (!res.ok) throw new Error('Date update failed');
        const updated = await res.json();
        const idx = feedState.items.findIndex(i => i.id === id);
        if (idx !== -1) feedState.items[idx] = updated;

        closeFeedDateModal();
        renderFeedGrid();
        showToast(value ? 'Date set' : 'Date cleared', 'success');
    };

    if (value && typeof openCalendarMovePreviewModal === 'function') {
        const movingLabel = itemTitle ? `"${itemTitle}"` : 'this feed item';
        await openCalendarMovePreviewModal({
            targetDay: value,
            movingLabel,
            confirmLabel: 'Save date',
            onConfirm: async () => {
                try {
                    await persistDate();
                } catch (err) {
                    console.error(err);
                    showToast('Could not update date', 'error');
                    throw err;
                }
            }
        });
        return;
    }

    try {
        await persistDate();
    } catch (err) {
        console.error(err);
        showToast('Could not update date', 'error');
    }
}

function toggleFeedSimpleMenu(event, id) {
    if (event) event.stopPropagation();
    const menu = document.getElementById(`feed-simple-menu-${id}`);
    if (!menu) return;
    const isOpen = menu.classList.contains('open');
    closeFeedSimpleMenus();
    if (!isOpen) {
        menu.classList.add('open');
        positionFeedSimpleMenu(menu);
    }
}

function closeFeedSimpleMenus() {
    document.querySelectorAll('.feed-simple-menu.open').forEach((menu) => {
        menu.classList.remove('open');
        menu.style.transform = '';
    });
}

function positionFeedSimpleMenu(menu) {
    if (!menu) return;
    const page = document.querySelector('.feed-page');
    if (!page) return;
    const pageRect = page.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const margin = 8;
    const minLeft = pageRect.left + margin;
    const maxRight = pageRect.right - margin;

    let shiftX = 0;
    if (menuRect.left < minLeft) {
        shiftX = minLeft - menuRect.left;
    } else if (menuRect.right > maxRight) {
        shiftX = maxRight - menuRect.right;
    }
    menu.style.transform = shiftX ? `translateX(${Math.round(shiftX)}px)` : '';
}

function repositionOpenFeedSimpleMenus() {
    document.querySelectorAll('.feed-simple-menu.open').forEach((menu) => {
        positionFeedSimpleMenu(menu);
    });
}

function startEditFeed(id) {
    feedState.editingId = id;
    feedState.expandedId = id;
    renderFeedGrid();
}

function cancelEditFeed(event) {
    if (event) event.stopPropagation();
    feedState.editingId = null;
    renderFeedGrid();
}

async function saveEditFeed(event, id) {
    if (event) event.stopPropagation();
    const titleInput = document.getElementById(`feed-edit-title-${id}`);
    const urlInput = document.getElementById(`feed-edit-url-${id}`);
    const descInput = document.getElementById(`feed-edit-desc-${id}`);
    const stateSelect = document.getElementById(`feed-edit-state-${id}`);

    if (!titleInput || !urlInput) return;

    const title = titleInput.value.trim();
    const url = urlInput.value.trim();
    const description = descInput ? descInput.value.trim() : '';
    const state = normalizeState(stateSelect ? stateSelect.value : '') || 'free';

    if (!title || !url) {
        showToast('Title and URL are required', 'error');
        return;
    }

    try {
        const res = await fetch(`/api/feed/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, url, description, state })
        });
        if (!res.ok) throw new Error('Update failed');
        const updated = await res.json();
        const idx = feedState.items.findIndex(i => i.id === id);
        if (idx !== -1) feedState.items[idx] = updated;
        feedState.editingId = null;
        renderFeedGrid();
        showToast('Updated', 'success');
    } catch (err) {
        console.error(err);
        showToast('Could not update item', 'error');
    }
}

function toggleFeedExpand(id) {
    if (feedState.editingId) return;
    feedState.expandedId = feedState.expandedId === id ? null : id;
    renderFeedGrid();
}

function renderFeedGrid() {
    const grid = document.getElementById('feed-grid');
    if (!grid) return;

    const filtered = feedState.items.filter(item => {
        if (feedState.filterState === 'all') return true;
        return normalizeState(item.state) === feedState.filterState;
    });

    if (!filtered.length) {
        grid.innerHTML = '<div class="feed-empty">No items yet.</div>';
        return;
    }

    grid.innerHTML = '';
    filtered.forEach((item) => {
        const isExpanded = feedState.expandedId === item.id;
        const isEditing = feedState.editingId === item.id;
        const state = normalizeState(item.state);
        const stateLabel = formatStateLabel(state);
        const stateChipHtml = stateLabel
            ? `
                <div class="feed-card-state-row">
                    <span class="feed-card-state feed-card-state-corner" data-state="${escapeHtml(state)}">${escapeHtml(stateLabel)}</span>
                </div>
            `
            : '';
        const cell = document.createElement('div');
        cell.className = 'feed-grid-cell';
        const card = document.createElement('div');
        card.className = `feed-card ${isExpanded ? 'expanded' : ''} ${isEditing ? 'editing' : ''}`;

        if (!isEditing) {
            card.addEventListener('click', () => toggleFeedExpand(item.id));
        }

        if (isEditing) {
            const editStateOptionsHtml = getOrderedStates()
                .map((s) => `<option value="${escapeHtml(s)}" ${s === state ? 'selected' : ''}>${escapeHtml(formatStateLabel(s))}</option>`)
                .join('');
            card.innerHTML = `
                <div class="feed-card-content">
                    <div class="feed-edit-form">
                        <label for="feed-edit-title-${item.id}" class="feed-edit-label">Title</label>
                        <input type="text" id="feed-edit-title-${item.id}" class="feed-edit-input" value="${escapeHtml(item.title)}" placeholder="Title">
                        <label for="feed-edit-url-${item.id}" class="feed-edit-label">URL</label>
                        <input type="text" id="feed-edit-url-${item.id}" class="feed-edit-input" value="${escapeHtml(item.url)}" placeholder="URL">
                        <label for="feed-edit-desc-${item.id}" class="feed-edit-label">Description (optional)</label>
                        <textarea id="feed-edit-desc-${item.id}" class="feed-edit-textarea" placeholder="Description (optional)">${escapeHtml(item.description || '')}</textarea>
                        <label for="feed-edit-state-${item.id}" class="feed-edit-label">Tag</label>
                        <select id="feed-edit-state-${item.id}" class="feed-edit-input">${editStateOptionsHtml}</select>
                    </div>
                </div>
                <div class="feed-card-actions">
                    <button class="feed-cancel-btn" type="button" onclick="cancelEditFeed(event)">Cancel</button>
                    <button class="feed-save-btn" type="button" onclick="saveEditFeed(event, ${item.id})">Save</button>
                </div>
            `;
        } else {
            const descriptionHtml = isExpanded && item.description
                ? `<div class="feed-card-details">${escapeHtml(item.description)}</div>`
                : '';
            const dateStr = item.scheduled_date;
            const dateClass = dateStr
                ? (isFeedDatePast(dateStr) ? 'past' : (isFeedDateToday(dateStr) ? 'today' : ''))
                : '';

            card.innerHTML = `
                <div class="feed-card-content">
                    <div class="feed-card-header">
                        <div class="feed-card-title">${escapeHtml(item.title)}</div>
                        ${dateStr ? `<div class="feed-date-badge ${dateClass}"><i class="fa-regular fa-calendar"></i> ${formatFeedScheduledDate(dateStr)}</div>` : ''}
                    </div>
                    ${descriptionHtml}
                </div>
                <div class="feed-card-actions ${isExpanded ? 'expanded' : ''}">
                    <div class="feed-card-actions-left">
                        <button class="feed-action-btn feed-action-primary" type="button" onclick="handleFeedAction(event, 'open', ${item.id})" title="Open link" aria-label="Open feed link">
                            <i class="fa-solid fa-arrow-up-right-from-square"></i>
                            <span>Open</span>
                        </button>
                        ${isExpanded ? `
                            <div class="dropdown feed-simple-dropdown">
                                <button class="feed-action-btn" type="button" onclick="toggleFeedSimpleMenu(event, ${item.id})" aria-label="More actions" title="More actions">
                                    <i class="fa-solid fa-ellipsis-vertical"></i>
                                    <span>More</span>
                                </button>
                                <div class="dropdown-menu feed-simple-menu" id="feed-simple-menu-${item.id}">
                                    <button class="dropdown-item" type="button" onclick="handleFeedAction(event, 'copy', ${item.id})">
                                        <i class="fa-solid fa-copy"></i> Copy
                                    </button>
                                    <button class="dropdown-item" type="button" onclick="handleFeedAction(event, 'date', ${item.id})">
                                        <i class="fa-regular fa-calendar"></i> Date
                                    </button>
                                    <button class="dropdown-item" type="button" onclick="handleFeedAction(event, 'edit', ${item.id})">
                                        <i class="fa-solid fa-pen"></i> Edit
                                    </button>
                                    <button class="dropdown-item" type="button" onclick="handleFeedAction(event, 'recall', ${item.id})">
                                        <i class="fa-solid fa-inbox"></i> Move to Recalls
                                    </button>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    ${isExpanded ? `
                        <button class="feed-action-btn feed-action-danger" type="button" onclick="handleFeedAction(event, 'done', ${item.id})" title="Mark done">
                            <i class="fa-solid fa-check"></i>
                            <span>Done</span>
                        </button>
                    ` : ''}
                    <div class="feed-card-actions-right">
                        ${stateChipHtml}
                    </div>
                </div>
            `;
        }

        cell.appendChild(card);
        grid.appendChild(cell);
    });
}

async function loadFeedItems() {
    const grid = document.getElementById('feed-grid');
    if (grid) grid.innerHTML = '<div class="feed-empty">Loading...</div>';
    try {
        const res = await fetch('/api/feed');
        if (!res.ok) throw new Error('Failed to load feed items');
        feedState.items = await res.json();
        renderFilterDropdown();
        renderStateChips();
        renderFeedGrid();
    } catch (err) {
        console.error(err);
        if (grid) grid.innerHTML = '<div class="feed-empty">Could not load items.</div>';
    }
}

async function addFeedItemFromInput(stateOverride) {
    const input = document.getElementById('feed-add-input');
    if (!input) return;
    const parsed = parseFeedInput(input.value.trim());
    if (!parsed || !parsed.title || !parsed.url) {
        showToast('Use: Title; URL; optional description', 'error');
        input.focus();
        return;
    }

    const state = stateOverride || feedState.selectedState;
    if (!state) {
        showToast('Pick a state to add this item', 'error');
        return;
    }

    const payload = {
        title: parsed.title,
        url: parsed.url,
        description: parsed.description,
        state
    };

    try {
        const res = await fetch('/api/feed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Save failed');
        const saved = await res.json();
        feedState.items.unshift(saved);
        input.value = '';
        feedState.selectedState = null;
        renderFilterDropdown();
        renderStateChips();
        renderFeedGrid();
        showToast('Added to EverFeed', 'success');
    } catch (err) {
        console.error(err);
        showToast('Could not save item', 'error');
    }
}

async function convertFeedToRecall(id) {
    try {
        const res = await fetch(`/api/feed/${id}/to-recall`, { method: 'POST' });
        if (!res.ok) throw new Error('Move failed');
        feedState.items = feedState.items.filter(item => item.id !== id);
        if (feedState.expandedId === id) {
            feedState.expandedId = null;
        }
        renderFilterDropdown();
        renderStateChips();
        renderFeedGrid();
        showToast('Moved to Recalls', 'success');
    } catch (err) {
        console.error(err);
        showToast('Could not move to Recalls', 'error');
    }
}

function confirmDeleteFeed(id) {
    openConfirmModal('Mark as done and remove?', async () => {
        try {
            const res = await fetch(`/api/feed/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            feedState.items = feedState.items.filter(item => item.id !== id);
            if (feedState.expandedId === id) {
                feedState.expandedId = null;
            }
            renderFilterDropdown();
            renderStateChips();
            renderFeedGrid();
            showToast('Removed', 'success');
        } catch (err) {
            console.error(err);
            showToast('Could not remove item', 'error');
        }
    });
}

function closeStateInput() {
    feedState.addingState = false;
    const input = document.getElementById('feed-state-input');
    if (input) input.value = '';
    renderStateChips();
}

function confirmStateInput() {
    const input = document.getElementById('feed-state-input');
    if (!input) return;
    const raw = normalizeState(input.value);
    if (!raw) {
        closeStateInput();
        return;
    }
    if (!feedState.customStates.includes(raw) && !feedState.defaultStates.includes(raw)) {
        feedState.customStates.push(raw);
    }
    closeStateInput();
    renderFilterDropdown();
}

document.addEventListener('DOMContentLoaded', () => {
    const addBtn = document.getElementById('feed-add-btn');
    const addForm = document.getElementById('feed-add-form');
    const addInput = document.getElementById('feed-add-input');
    const stateConfirm = document.getElementById('feed-state-confirm');
    const stateCancel = document.getElementById('feed-state-cancel');
    const stateInput = document.getElementById('feed-state-input');
    const feedDateModal = document.getElementById('feed-date-modal');
    const feedDateInput = document.getElementById('feed-date-input');
    const feedDateSaveBtn = document.getElementById('feed-date-save-btn');
    const feedDateCancelBtn = document.getElementById('feed-date-cancel-btn');
    const feedDateClearBtn = document.getElementById('feed-date-clear-btn');

    function updateAddButtonState(isOpen) {
        if (!addBtn) return;
        addBtn.setAttribute('aria-label', isOpen ? 'Cancel add' : 'Add item');
        addBtn.setAttribute('title', isOpen ? 'Cancel add' : 'Add item');
        const icon = addBtn.querySelector('i');
        if (icon) {
            icon.className = isOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-plus';
        }
    }

    if (addBtn && addForm) {
        addBtn.addEventListener('click', () => {
            const isOpen = addForm.classList.toggle('open');
            updateAddButtonState(isOpen);
            if (isOpen) {
                if (addInput) addInput.focus();
            } else {
                if (addInput) addInput.value = '';
                feedState.selectedState = null;
                closeStateInput();
                renderStateChips();
            }
        });
    }

    if (addInput) {
        addInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
            }
        });
    }

    if (stateConfirm) {
        stateConfirm.addEventListener('click', confirmStateInput);
    }

    if (stateCancel) {
        stateCancel.addEventListener('click', closeStateInput);
    }

    if (stateInput) {
        stateInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmStateInput();
            } else if (e.key === 'Escape') {
                closeStateInput();
            }
        });
    }

    if (feedDateSaveBtn) {
        feedDateSaveBtn.addEventListener('click', () => saveFeedDateFromModal(false));
    }

    if (feedDateCancelBtn) {
        feedDateCancelBtn.addEventListener('click', () => closeFeedDateModal());
    }

    if (feedDateClearBtn) {
        feedDateClearBtn.addEventListener('click', () => saveFeedDateFromModal(true));
    }

    if (feedDateInput) {
        feedDateInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveFeedDateFromModal(false);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeFeedDateModal();
            }
        });
    }

    if (feedDateModal) {
        feedDateModal.addEventListener('click', (e) => {
            if (e.target === feedDateModal) {
                closeFeedDateModal();
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (feedDateModal && feedDateModal.classList.contains('active')) {
            closeFeedDateModal();
        }
    });

    const filterSelected = document.getElementById('feed-filter-selected');
    if (filterSelected) {
        filterSelected.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFilterDropdown();
        });
    }

    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('feed-filter-dropdown');
        if (dropdown && !dropdown.contains(e.target)) {
            closeFilterDropdown();
        }
        const clickTarget = e.target && e.target.nodeType === Node.TEXT_NODE
            ? e.target.parentElement
            : e.target;
        if (!clickTarget || !clickTarget.closest('.feed-simple-dropdown')) {
            closeFeedSimpleMenus();
        }
    });
    window.addEventListener('resize', repositionOpenFeedSimpleMenus);

    renderStateChips();
    renderFilterDropdown();
    loadFeedItems();
});


