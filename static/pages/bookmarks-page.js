const bookmarkState = {
    items: [],
    activeId: null,
    mode: 'view',
    search: ''
};

// Bookmark selection manager
let bookmarkSelection = null;
let bookmarkBulkActions = null;

function initBookmarkSelection() {
    bookmarkSelection = new SelectionManager({
        moduleName: 'bookmark',
        bulkBarId: 'bookmark-bulk-bar',
        countSpanId: 'bookmark-bulk-count',
        selectAllId: 'bookmark-select-all',
        itemSelector: '.bookmark-card',
        itemIdAttr: 'data-id',
        selectedClass: 'selected',
        bodyActiveClass: 'bookmark-selection-mode-active',
        getTotalCount: () => bookmarkState.items.length
    });

    bookmarkBulkActions = new BulkActions({
        apiEndpoint: '/api/bookmarks/bulk',
        selectionManager: bookmarkSelection,
        moduleName: 'bookmark',
        onComplete: () => {
            loadBookmarks();
        }
    });
}

function extractBookmarkUrl(value) {
    if (!value) return null;
    const match = value.match(/https?:\/\/[^\s]+/i);
    if (match) return match[0];
    const trimmed = value.trim();
    if (trimmed.startsWith('www.')) return `https://${trimmed}`;
    return null;
}

function formatBookmarkValuePreview(value) {
    return (value || '').trim();
}

function openUrlSafely(url) {
    if (!url) return;
    window.open(url, '_blank', 'noopener');
}

function openBookmarkUrlById(id) {
    const item = bookmarkState.items.find(i => i.id === id);
    if (!item) return;
    openUrlSafely(extractBookmarkUrl(item.value));
}

function copyBookmarkValueById(id) {
    const item = bookmarkState.items.find(i => i.id === id);
    if (!item) return;
    copyBookmarkValue(item.value);
}

async function copyBookmarkValue(value) {
    const text = value || '';
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        showToast('Copied to clipboard', 'success');
    } catch (err) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Copied to clipboard', 'success');
    }
}

function renderBookmarkGrid() {
    const grid = document.getElementById('bookmark-grid');
    if (!grid) return;

    const searchTerm = bookmarkState.search.toLowerCase();
    const items = bookmarkState.items.filter(item => {
        if (!searchTerm) return true;
        const haystack = `${item.title || ''} ${item.description || ''} ${item.value || ''}`.toLowerCase();
        return haystack.includes(searchTerm);
    });

    if (!items.length) {
        renderEmptyState(grid, 'bookmark', bookmarkState.search ? 'No bookmarks match your search.' : 'No bookmarks yet.',
            !bookmarkState.search ? { label: 'Add Bookmark', icon: 'plus', onclick: 'openAddBookmarkModal()' } : null);
        return;
    }

    grid.innerHTML = '';
    items.forEach(item => {
        const url = extractBookmarkUrl(item.value);
        const isSelected = bookmarkSelection && bookmarkSelection.isSelected(item.id);
        const card = document.createElement('div');
        card.className = `bookmark-card ${item.pinned ? 'is-pinned' : ''} ${isSelected ? 'selected' : ''}`;
        card.dataset.id = item.id;

        card.innerHTML = `
            <input type="checkbox" class="item-select-checkbox bookmark-checkbox" ${isSelected ? 'checked' : ''}>
            ${item.pinned ? '<div class="bookmark-pin-badge">Pinned</div>' : ''}
            <div>
                <div class="bookmark-card-title">${escapeHtml(item.title)}</div>
                <div class="bookmark-card-value">${escapeHtml(formatBookmarkValuePreview(item.value))}</div>
            </div>
            <div class="bookmark-card-actions">
                ${url ? `<button class="bookmark-action-btn" type="button" onclick="handleBookmarkAction(event, 'open', ${item.id})" title="Open link" aria-label="Open bookmark link"><i class="fa-solid fa-link"></i></button>` : ''}
                <button class="bookmark-action-btn" type="button" onclick="handleBookmarkAction(event, 'copy', ${item.id})" title="Copy" aria-label="Copy bookmark value"><i class="fa-solid fa-copy"></i></button>
                <button class="bookmark-action-btn" type="button" onclick="handleBookmarkAction(event, 'pin', ${item.id})" title="${item.pinned ? 'Unpin' : 'Pin'}" aria-label="${item.pinned ? 'Unpin bookmark' : 'Pin bookmark'}"><i class="fa-solid fa-thumbtack"></i></button>
            </div>
        `;

        // Checkbox click handler
        const checkbox = card.querySelector('.bookmark-checkbox');
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            if (bookmarkSelection) bookmarkSelection.toggle(item.id);
            card.classList.toggle('selected', checkbox.checked);
        });

        // Card click handler
        card.addEventListener('click', (e) => {
            // If in selection mode, toggle selection instead of opening modal
            if (bookmarkSelection && bookmarkSelection.getCount() > 0 && !e.target.closest('.bookmark-card-actions')) {
                bookmarkSelection.toggle(item.id);
                checkbox.checked = bookmarkSelection.isSelected(item.id);
                card.classList.toggle('selected', checkbox.checked);
            } else {
                openBookmarkModal(item.id);
            }
        });

        grid.appendChild(card);
    });

    // Update select-all checkbox state
    if (bookmarkSelection) {
        bookmarkSelection.updateUI();
    }
}

function handleBookmarkAction(event, action, id) {
    event.stopPropagation();
    const item = bookmarkState.items.find(i => i.id === id);
    if (!item) return;
    if (action === 'open') {
        openUrlSafely(extractBookmarkUrl(item.value));
    } else if (action === 'copy') {
        copyBookmarkValue(item.value);
    } else if (action === 'pin') {
        toggleBookmarkPin(id);
    }
}

async function loadBookmarks() {
    const grid = document.getElementById('bookmark-grid');
    if (grid) grid.innerHTML = '<div class="bookmark-empty">Loading...</div>';
    try {
        const res = await fetch('/api/bookmarks');
        if (!res.ok) throw new Error('Failed to load bookmarks');
        bookmarkState.items = await res.json();
        renderBookmarkGrid();
        openBookmarkFromQuery();
    } catch (err) {
        console.error(err);
        if (grid) grid.innerHTML = '<div class="bookmark-empty">Could not load bookmarks.</div>';
    }
}

function openBookmarkModal(id) {
    const item = bookmarkState.items.find(i => i.id === id);
    if (!item) return;
    bookmarkState.activeId = id;
    bookmarkState.mode = 'view';
    renderBookmarkModalView(item);
    const overlay = document.getElementById('bookmark-modal-overlay');
    if (overlay) overlay.classList.add('open');
    refreshBookmarkDetails(id);
}

function openAddBookmarkModal() {
    bookmarkState.activeId = null;
    bookmarkState.mode = 'add';
    renderBookmarkModalEdit({
        title: '',
        description: '',
        value: '',
        pinned: false
    });
    const overlay = document.getElementById('bookmark-modal-overlay');
    if (overlay) overlay.classList.add('open');
}

function closeBookmarkModal() {
    const overlay = document.getElementById('bookmark-modal-overlay');
    if (overlay) overlay.classList.remove('open');
    bookmarkState.activeId = null;
    bookmarkState.mode = 'view';
}

function renderBookmarkModalView(item) {
    const body = document.getElementById('bookmark-modal-body');
    const title = document.getElementById('bookmark-modal-title');
    const modal = document.querySelector('.bookmark-modal');
    if (!body || !title) return;
    if (modal) modal.classList.remove('editing');
    title.textContent = item.title || 'Bookmark';
    const url = extractBookmarkUrl(item.value);

    body.innerHTML = `
        ${item.description ? `
        <div class="bookmark-view-block">
            <div class="bookmark-view-label">Description</div>
            <div class="bookmark-view-box">${escapeHtml(item.description)}</div>
        </div>
        ` : ''}
        <div class="bookmark-view-block">
            <div class="bookmark-view-label">Value</div>
            <div class="bookmark-view-box">${escapeHtml(item.value).replace(/\\n/g, '<br>')}</div>
        </div>
        <div class="bookmark-modal-actions">
            <button class="btn btn-ghost" type="button" onclick="toggleBookmarkPin(${item.id})" title="${item.pinned ? 'Unpin' : 'Pin'}">
                <i class="fa-solid fa-thumbtack"></i><span>${item.pinned ? 'Unpin' : 'Pin'}</span>
            </button>
            ${url ? `<button class="btn btn-ghost" type="button" onclick="openBookmarkUrlById(${item.id})" title="Open"><i class="fa-solid fa-link"></i><span>Open</span></button>` : ''}
            <button class="btn btn-ghost" type="button" onclick="copyBookmarkValueById(${item.id})" title="Copy">
                <i class="fa-solid fa-copy"></i><span>Copy</span>
            </button>
            <button class="btn btn-secondary" type="button" onclick="renderBookmarkModalEdit(${item.id})" title="Edit">
                <i class="fa-solid fa-pen"></i><span>Edit</span>
            </button>
            <button class="btn btn-danger" type="button" onclick="confirmDeleteBookmark(${item.id})" title="Delete">
                <i class="fa-solid fa-trash"></i><span>Delete</span>
            </button>
        </div>
    `;
}

async function refreshBookmarkDetails(id) {
    try {
        const res = await fetch(`/api/bookmarks/${id}`);
        if (!res.ok) throw new Error('Failed to load bookmark');
        const fresh = await res.json();
        const idx = bookmarkState.items.findIndex(i => i.id === fresh.id);
        if (idx !== -1) bookmarkState.items[idx] = fresh;
        if (bookmarkState.activeId === fresh.id && bookmarkState.mode === 'view') {
            renderBookmarkModalView(fresh);
        }
    } catch (err) {
        console.error(err);
    }
}

function renderBookmarkModalEdit(itemOrId) {
    const body = document.getElementById('bookmark-modal-body');
    const title = document.getElementById('bookmark-modal-title');
    const modal = document.querySelector('.bookmark-modal');
    if (!body || !title) return;
    if (modal) modal.classList.add('editing');

    const item = typeof itemOrId === 'number'
        ? bookmarkState.items.find(i => i.id === itemOrId)
        : itemOrId;
    if (!item) return;

    bookmarkState.mode = bookmarkState.activeId ? 'edit' : 'add';
    title.textContent = bookmarkState.mode === 'add' ? 'Add Bookmark' : 'Edit Bookmark';

    body.innerHTML = `
        <div class="form-group">
            <label>Title</label>
            <input type="text" id="bookmark-title-input" class="form-control" value="${escapeHtml(item.title || '')}" placeholder="Title">
        </div>
        <div class="form-group">
            <label>Description (optional)</label>
            <textarea id="bookmark-desc-input" class="form-control" rows="2" placeholder="Short context...">${escapeHtml(item.description || '')}</textarea>
        </div>
        <div class="form-group">
            <label>Value</label>
            <textarea id="bookmark-value-input" class="form-control" rows="4" placeholder="Command, URL, account info...">${escapeHtml(item.value || '')}</textarea>
        </div>
        <div class="form-group">
            <label><input type="checkbox" id="bookmark-pin-input" ${item.pinned ? 'checked' : ''}> Pin to top</label>
        </div>
        <div class="bookmark-modal-actions">
            <button class="btn" type="button" onclick="cancelBookmarkEdit()">Cancel</button>
            <button class="btn btn-primary" type="button" onclick="saveBookmarkFromModal()">
                ${bookmarkState.mode === 'add' ? 'Add' : 'Save'}
            </button>
        </div>
    `;
}

function cancelBookmarkEdit() {
    if (!bookmarkState.activeId) {
        closeBookmarkModal();
        return;
    }
    const item = bookmarkState.items.find(i => i.id === bookmarkState.activeId);
    if (item) renderBookmarkModalView(item);
}

async function saveBookmarkFromModal() {
    const titleEl = document.getElementById('bookmark-title-input');
    const descEl = document.getElementById('bookmark-desc-input');
    const valueEl = document.getElementById('bookmark-value-input');
    const pinEl = document.getElementById('bookmark-pin-input');
    if (!titleEl || !valueEl) return;

    const payload = {
        title: titleEl.value.trim(),
        description: descEl ? descEl.value.trim() : '',
        value: valueEl.value.trim(),
        pinned: !!(pinEl && pinEl.checked)
    };

    if (!payload.title || !payload.value) {
        showToast('Title and value are required', 'error');
        return;
    }

    try {
        let res;
        if (bookmarkState.mode === 'add') {
            res = await fetch('/api/bookmarks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            res = await fetch(`/api/bookmarks/${bookmarkState.activeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }
        if (!res.ok) throw new Error('Save failed');
        const saved = await res.json();

        if (bookmarkState.mode === 'add') {
            bookmarkState.items.unshift(saved);
            bookmarkState.activeId = saved.id;
        } else {
            const idx = bookmarkState.items.findIndex(i => i.id === saved.id);
            if (idx !== -1) bookmarkState.items[idx] = saved;
        }

        renderBookmarkGrid();
        if (bookmarkState.mode === 'add') {
            closeBookmarkModal();
        } else {
            renderBookmarkModalView(saved);
        }
        showToast('Bookmark saved', 'success');
    } catch (err) {
        console.error(err);
        showToast('Could not save bookmark', 'error');
    }
}

function confirmDeleteBookmark(id) {
    openConfirmModal('Delete this bookmark?', async () => {
        try {
            const res = await fetch(`/api/bookmarks/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            bookmarkState.items = bookmarkState.items.filter(item => item.id !== id);
            renderBookmarkGrid();
            closeBookmarkModal();
            showToast('Bookmark deleted', 'success');
        } catch (err) {
            console.error(err);
            showToast('Could not delete bookmark', 'error');
        }
    });
}

async function toggleBookmarkPin(id) {
    const item = bookmarkState.items.find(i => i.id === id);
    if (!item) return;
    try {
        const res = await fetch(`/api/bookmarks/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pinned: !item.pinned })
        });
        if (!res.ok) throw new Error('Pin update failed');
        const updated = await res.json();
        const idx = bookmarkState.items.findIndex(i => i.id === updated.id);
        if (idx !== -1) bookmarkState.items[idx] = updated;
        renderBookmarkGrid();
        if (bookmarkState.activeId === id) {
            renderBookmarkModalView(updated);
        }
    } catch (err) {
        console.error(err);
        showToast('Could not update pin', 'error');
    }
}

function openBookmarkFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const rawId = params.get('item');
    if (!rawId) return;
    const id = parseInt(rawId, 10);
    if (Number.isNaN(id)) return;
    const item = bookmarkState.items.find(i => i.id === id);
    if (item) openBookmarkModal(item.id);
}

document.addEventListener('DOMContentLoaded', () => {
    // Initialize selection manager
    initBookmarkSelection();

    loadBookmarks();
    const searchInput = document.getElementById('bookmark-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            bookmarkState.search = e.target.value || '';
            renderBookmarkGrid();
        });
    }
    const overlay = document.getElementById('bookmark-modal-overlay');
    const closeBtn = document.getElementById('bookmark-modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeBookmarkModal);
    }
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeBookmarkModal();
        });
    }

    // Bulk action button handlers
    const selectAll = document.getElementById('bookmark-select-all');
    const bulkClear = document.getElementById('bookmark-bulk-clear');
    const bulkPin = document.getElementById('bookmark-bulk-pin');
    const bulkDelete = document.getElementById('bookmark-bulk-delete');

    if (selectAll) {
        selectAll.addEventListener('change', (e) => {
            if (bookmarkSelection) {
                if (e.target.checked) {
                    const allIds = bookmarkState.items.map(item => item.id);
                    bookmarkSelection.selectAll(allIds);
                } else {
                    bookmarkSelection.deselectAll();
                }
                renderBookmarkGrid();
            }
        });
    }

    if (bulkClear) {
        bulkClear.addEventListener('click', () => {
            if (bookmarkSelection) {
                bookmarkSelection.deselectAll();
                renderBookmarkGrid();
            }
        });
    }

    if (bulkPin) {
        bulkPin.addEventListener('click', async () => {
            if (bookmarkBulkActions) {
                const selectedIds = bookmarkSelection.getIds();
                const anyUnpinned = bookmarkState.items.some(item => selectedIds.includes(item.id) && !item.pinned);
                await bookmarkBulkActions.execute(anyUnpinned ? 'pin' : 'unpin');
            }
        });
    }

    if (bulkDelete) {
        bulkDelete.addEventListener('click', () => {
            if (bookmarkBulkActions) {
                bookmarkBulkActions.delete('Delete selected bookmarks?');
            }
        });
    }
});
