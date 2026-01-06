// DOM Elements & State
const listsGrid = document.getElementById('lists-grid');
const createModal = document.getElementById('create-modal');
const addItemModal = document.getElementById('add-item-modal');
const bulkImportModal = document.getElementById('bulk-import-modal');
const moveItemModal = document.getElementById('move-item-modal');
const phaseMenu = document.getElementById('phase-menu');
const selectedItems = new Set();
const selectedNotes = new Set();
const confirmModal = document.getElementById('confirm-modal');
const confirmMessage = document.getElementById('confirm-message');
const confirmYesButton = document.getElementById('confirm-yes-button');
let pendingConfirm = null;

// --- Toast Notification System ---
function showToast(message, type = 'info', duration = 4000) {
    // Ensure toast container exists
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    // Icon mapping based on type
    const icons = {
        success: '<i class="fa-solid fa-circle-check"></i>',
        error: '<i class="fa-solid fa-circle-exclamation"></i>',
        warning: '<i class="fa-solid fa-triangle-exclamation"></i>',
        info: '<i class="fa-solid fa-circle-info"></i>'
    };

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${message}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;

    // Add to container
    container.appendChild(toast);

    // Auto-remove after duration
    if (duration > 0) {
        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.remove();
                }
            }, 300);
        }, duration);
    }

    return toast;
}
let currentDragId = null;
let currentDragBlock = [];
let longPressTimer = null;
let longPressTriggered = false;
let touchStartX = 0;
let touchStartY = 0;
let isTouchScrolling = false;
let bulkMoveIds = null;
let moveSelectedDestination = null;
let moveNavStack = [];
let moveItemType = 'task';
let touchDragActive = false;
let touchDragId = null;
let touchDragBlock = [];
let notesState = { notes: [], activeNoteId: null, dirty: false, activeSnapshot: null, checkboxMode: false };
let noteAutoSaveTimer = null;
let noteAutoSaveInFlight = false;
let recallState = { items: [], selectedId: null, editingId: null, filters: { q: '', category: 'all', type: 'all', status: 'active', sort: 'smart', pinnedOnly: false, tag: null }, aiResults: [] };
let currentTaskFilter = 'all';
let selectedTagFilters = new Set();
let calendarState = { selectedDay: null, events: [], monthCursor: null, monthEventsByDay: {}, dayViewOpen: false, detailsOpen: false, daySort: 'time' };
const calendarSelection = { active: false, ids: new Set(), longPressTimer: null, longPressTriggered: false, touchStart: { x: 0, y: 0 } };
let calendarReminderTimers = {};
let calendarNotifyEnabled = false;
let calendarPrompt = { resolve: null, reject: null, onSubmit: null };
let datePickerState = { itemId: null };
let linkNoteModalState = { targetType: 'task', targetId: null, targetTitle: '', selectedNoteId: null, notes: [], existingNoteIds: [] };
const USER_TIMEZONE = window.USER_TIMEZONE || 'America/New_York'; // EST/EDT
let notificationsState = { items: [], unread: 0, open: false };
let timeModalState = { eventId: null };

// --- Dashboard Functions ---

async function loadDashboard() {
    const hubsGrid = document.getElementById('hubs-grid');
    const listsGrid = document.getElementById('lists-grid');
    const hubsContainer = document.getElementById('hubs-container');
    const listsContainer = document.getElementById('lists-container');

    if (!hubsGrid || !listsGrid) return; // Not on dashboard

    try {
        const res = await fetch('/api/lists');
        const lists = await res.json();

        const hubs = lists.filter(l => l.type === 'hub');
        const simpleLists = lists.filter(l => l.type === 'list');

        // Render Hubs
        if (hubs.length > 0) {
            hubsContainer.style.display = 'block';
            hubsGrid.innerHTML = hubs.map(list => renderListCard(list)).join('');
        } else {
            hubsContainer.style.display = 'none';
        }

        // Render Simple Lists
        if (simpleLists.length > 0) {
            listsContainer.style.display = 'block';
            listsGrid.innerHTML = simpleLists.map(list => renderListCard(list)).join('');
        } else {
            listsContainer.style.display = 'none';
        }

        initDashboardReorder();
    } catch (e) {
        console.error('Error loading lists:', e);
    }
}

function initDashboardReorder() {
    const grids = [
        { el: document.getElementById('hubs-grid'), type: 'hub' },
        { el: document.getElementById('lists-grid'), type: 'list' }
    ];
    grids.forEach(({ el, type }) => {
        if (!el) return;
        let draggingEl = null;
        let dragMoved = false;

        const cards = Array.from(el.querySelectorAll('.card[data-list-id]'));
        cards.forEach(card => {
            card.setAttribute('draggable', 'true');

            card.addEventListener('dragstart', (e) => {
                draggingEl = card;
                dragMoved = false;
                card.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            card.addEventListener('dragend', async () => {
                if (draggingEl) draggingEl.classList.remove('dragging');
                draggingEl = null;
                if (dragMoved) {
                    await persistDashboardOrder(el, type);
                }
            });

            card.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (!draggingEl || draggingEl === card) return;
                const afterElement = getDashboardDragAfterElement(el, e.clientY);
                if (afterElement == null) {
                    el.appendChild(draggingEl);
                } else {
                    el.insertBefore(draggingEl, afterElement);
                }
                dragMoved = true;
            });

            card.addEventListener('click', (e) => {
                if (dragMoved) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            });
        });
    });
}

function getDashboardDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.card[data-list-id]:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset, element: child };
        }
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

async function persistDashboardOrder(container, type) {
    const ids = Array.from(container.querySelectorAll('.card[data-list-id]'))
        .map(card => parseInt(card.getAttribute('data-list-id'), 10))
        .filter(id => Number.isInteger(id));
    if (!ids.length) return;
    try {
        const res = await fetch('/api/lists/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, type })
        });
        if (!res.ok) {
            console.error('Failed to save list order');
        }
    } catch (e) {
        console.error('Error saving list order:', e);
    }
}

function renderListCard(list) {
    const cardColorVar = list.type === 'hub' ? 'var(--accent-color)' : 'var(--primary-color)';
    const progress = list.progress || 0;
    const items = (list.items || []).filter(i => !i.is_phase);
    const itemCount = items.length;
    const doneCount = items.filter(i => i.status === 'done').length;

    return `
        <a href="/list/${list.id}" class="card" data-list-id="${list.id}" data-list-type="${list.type}" style="border-top-color: ${cardColorVar};">
            <div class="card-header">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                    <span class="card-title">${list.title}</span>
                    <span class="card-type ${list.type}">${list.type === 'hub' ? 'Project Hub' : 'List'}</span>
                </div>
            </div>
            <div class="progress-container">
                <div class="progress-bar" style="width: ${progress}%"></div>
            </div>
            <div class="progress-text">
                <span>${progress}% Complete</span>
                ${list.type === 'hub' ?
                    `<button class="btn-icon delete" title="Delete" onclick="event.preventDefault(); event.stopPropagation(); deleteList(${list.id});">
                        <i class="fa-solid fa-trash"></i>
                    </button>` :
                    `<span>${doneCount}/${itemCount} Tasks</span>
                    <button class="btn-icon delete" title="Delete" onclick="event.preventDefault(); event.stopPropagation(); deleteList(${list.id});">
                        <i class="fa-solid fa-trash"></i>
                    </button>`
                }
            </div>
        </a>
    `;
}

async function createList() {
    const titleInput = document.getElementById('list-title');
    const typeSelect = document.getElementById('list-type');
    const title = titleInput ? titleInput.value.trim() : '';
    const type = typeSelect ? typeSelect.value : 'list';

    if (!title) return;

    try {
        const res = await fetch('/api/lists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, type })
        });

        if (res.ok) {
            const newList = await res.json();
            closeCreateModal();
            window.location.href = `/list/${newList.id}`;
        }
    } catch (e) {
        console.error('Error creating list:', e);
    }
}

// --- List View Functions ---

function openEditListModal() {
    const modal = document.getElementById('edit-list-modal');
    const input = document.getElementById('edit-list-title');
    const display = document.getElementById('list-title-display');
    if (!modal || !input || !display) return;
    input.value = display.textContent.trim();
    modal.classList.add('active');
    input.focus();
}

function closeEditListModal() {
    const modal = document.getElementById('edit-list-modal');
    if (modal) modal.classList.remove('active');
}

async function saveListTitle() {
    const input = document.getElementById('edit-list-title');
    if (!input) return;
    const title = input.value.trim();
    if (!title) return;

    try {
        const res = await fetch(`/api/lists/${CURRENT_LIST_ID}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });
        if (res.ok) {
            document.getElementById('list-title-display').textContent = title;
            closeEditListModal();
        }
    } catch (e) {
        console.error('Error updating list title:', e);
    }
}

async function createItem(listId, listType) {
    const input = document.getElementById('item-content');
    const descriptionInput = document.getElementById('item-description');
    const notesInput = document.getElementById('item-notes');
    const tagsInput = document.getElementById('item-tags');
    const phaseSelect = document.getElementById('item-phase-select');
    const projectTypeSelect = document.getElementById('project-type-select');
    const hiddenPhase = document.getElementById('item-phase-id');
    const modeInput = document.getElementById('item-mode');
    const content = input.value.trim();
    if (!content) return;

    const isPhase = modeInput && modeInput.value === 'phase';
    const phaseId = isPhase ? null : (phaseSelect && phaseSelect.value ? parseInt(phaseSelect.value, 10) : (hiddenPhase && hiddenPhase.value ? parseInt(hiddenPhase.value, 10) : null));
    const projectType = projectTypeSelect ? projectTypeSelect.value : 'list';

    try {
        const res = await fetch(`/api/lists/${listId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content,
                    description: descriptionInput ? descriptionInput.value.trim() : '',
                    notes: notesInput ? notesInput.value.trim() : '',
                    tags: tagsInput ? tagsInput.value.trim() : '',
                    is_project: listType === 'hub',
                    project_type: projectType, // Pass the selected type
                    phase_id: phaseId,
                    status: isPhase ? 'phase' : 'not_started'
            })
        });

        if (res.ok) {
            const newItem = await res.json();
            closeAddItemModal();

            if (newItem.linked_list_id) {
                // It's a project, open it
                window.location.href = `/list/${newItem.linked_list_id}`;
            } else {
                window.location.reload(); // Simple reload to refresh state
            }
        }
    } catch (e) {
        console.error('Error creating item:', e);
    }
}

function setItemDate(itemId, currentDate, itemTitle) {
    openDatePickerModal(itemId, currentDate, itemTitle);
}

// --- Notifications ---

async function loadNotifications() {
    try {
        const res = await fetch('/api/notifications');
        if (!res.ok) throw new Error('Failed to load notifications');
        const data = await res.json();
        notificationsState.items = data || [];
        notificationsState.unread = notificationsState.items.filter(n => !n.read_at).length;
        renderNotifications();
    } catch (e) {
        console.error('Error loading notifications:', e);
    }
}

function renderNotifications() {
    const badge = document.getElementById('notif-badge');
    const list = document.getElementById('notif-list');
    if (badge) {
        if (notificationsState.unread > 0) {
            badge.textContent = notificationsState.unread;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }
    if (!list) return;
    list.innerHTML = '';
    if (!notificationsState.items.length) {
        list.innerHTML = `<div class="empty-state">
            <i class="fa-solid fa-bell-slash" style="font-size: 1.5rem; color: var(--text-muted);"></i>
            <p style="margin: 0.5rem 0 0 0; color: var(--text-muted);">No notifications yet.</p>
        </div>`;
        return;
    }
    notificationsState.items.forEach(n => {
        const item = document.createElement('div');
        item.className = `notif-item ${n.read_at ? '' : 'unread'}`;
        const body = n.body ? `<p class="notif-body">${n.body}</p>` : '';
        const time = n.created_at ? `<div class="notif-time">${formatNoteDate(n.created_at)}</div>` : '';
        const link = n.link ? `<a href="${n.link}" class="btn btn-secondary btn-small" style="margin-top:0.5rem;">Open</a>` : '';
        item.innerHTML = `
            <div class="notif-title">${n.title || 'Notification'}</div>
            ${body}
            ${link}
            ${time}
        `;
        list.appendChild(item);
    });
}

async function markAllNotificationsRead() {
    try {
        const res = await fetch('/api/notifications/read_all', { method: 'POST' });
        if (!res.ok) throw new Error('Failed to mark read');
        notificationsState.items = notificationsState.items.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() }));
        notificationsState.unread = 0;
        renderNotifications();
    } catch (e) {
        console.error('Error marking read:', e);
    }
}

function toggleNotificationsPanel(forceOpen = null) {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    const open = forceOpen !== null ? forceOpen : !panel.classList.contains('open');
    if (open) {
        panel.classList.add('open');
        notificationsState.open = true;
        loadNotifications();
    } else {
        panel.classList.remove('open');
        notificationsState.open = false;
    }
}

function openDatePickerModal(itemId, currentDate, itemTitle) {
    const modal = document.getElementById('date-picker-modal');
    const input = document.getElementById('date-picker-input');
    const label = document.getElementById('date-picker-task-label');
    if (!modal || !input) return;
    datePickerState.itemId = itemId;
    input.value = currentDate || '';
    if (label) label.textContent = itemTitle ? `For "${itemTitle}"` : '';
    modal.classList.add('active');
    input.focus();
}

function closeDatePickerModal() {
    const modal = document.getElementById('date-picker-modal');
    if (modal) modal.classList.remove('active');
    datePickerState = { itemId: null };
}

async function saveDatePickerSelection(remove = false) {
    const input = document.getElementById('date-picker-input');
    if (!datePickerState.itemId || !input) return;
    const payload = { due_date: remove ? null : (input.value || null) };
    try {
        const res = await fetch(`/api/items/${datePickerState.itemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to set date');
        closeDatePickerModal();
        window.location.reload();
    } catch (e) {
        console.error('Error setting date:', e);
        alert('Could not set date. Please try again.');
    }
}

async function linkNoteToItem(itemId, itemTitle, existingNoteIds = []) {
    openLinkNoteModal('task', itemId, itemTitle, existingNoteIds);
}

async function linkNoteToCalendarEvent(eventId, eventTitle, existingNoteIds = []) {
    openLinkNoteModal('calendar', eventId, eventTitle, existingNoteIds);
}

async function openLinkNoteModal(targetType, targetId, targetTitle, existingNoteIds = []) {
    const modal = document.getElementById('link-note-modal');
    const listEl = document.getElementById('link-note-list');
    const label = document.getElementById('link-note-task-label');
    const newTitleInput = document.getElementById('link-note-new-title');
    if (!modal || !listEl) return;

    linkNoteModalState = {
        targetType,
        targetId,
        targetTitle,
        selectedNoteId: existingNoteIds && existingNoteIds.length ? existingNoteIds[0] : null,
        notes: [],
        existingNoteIds: existingNoteIds || []
    };
    if (label) label.textContent = targetTitle ? `For "${targetTitle}"` : '';
    if (newTitleInput) newTitleInput.value = `${targetTitle || 'New'} note`;
    listEl.innerHTML = '<div class="note-chooser-empty">Loading notes...</div>';
    modal.classList.add('active');

    try {
        const res = await fetch('/api/notes');
        if (!res.ok) throw new Error('Failed to fetch notes');
        const notes = await res.json();
        linkNoteModalState.notes = notes;
        renderLinkNoteList(notes);
    } catch (e) {
        console.error('Error loading notes:', e);
        listEl.innerHTML = '<div class="note-chooser-empty">Could not load notes.</div>';
    }
}

function renderLinkNoteList(notes) {
    const listEl = document.getElementById('link-note-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!notes || !notes.length) {
        listEl.innerHTML = '<div class="note-chooser-empty">No notes yet. Create one below.</div>';
        return;
    }
    notes.forEach(note => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const isSelected = linkNoteModalState.selectedNoteId === note.id;
        const isLinked = linkNoteModalState.existingNoteIds.includes(note.id);
        btn.className = `note-chooser-item ${isSelected ? 'active' : ''}`;
        btn.innerHTML = `
            <span>${note.title || 'Untitled'}</span>
            <span class="note-chooser-meta">#${note.id}${isLinked ? ' • linked' : ''}</span>
        `;
        btn.onclick = () => {
            linkNoteModalState.selectedNoteId = note.id;
            renderLinkNoteList(notes);
        };
        listEl.appendChild(btn);
    });
}

function closeLinkNoteModal() {
    const modal = document.getElementById('link-note-modal');
    if (modal) modal.classList.remove('active');
    linkNoteModalState = { targetType: 'task', targetId: null, targetTitle: '', selectedNoteId: null, notes: [], existingNoteIds: [] };
    const listEl = document.getElementById('link-note-list');
    if (listEl) listEl.innerHTML = '';
    const newTitleInput = document.getElementById('link-note-new-title');
    if (newTitleInput) newTitleInput.value = '';
}

async function saveLinkedNote() {
    if (!linkNoteModalState.targetId) return;
    if (!linkNoteModalState.selectedNoteId) {
        alert('Select a note or create a new one first.');
        return;
    }
    try {
        const updateRes = await fetch(`/api/notes/${linkNoteModalState.selectedNoteId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
                linkNoteModalState.targetType === 'calendar'
                    ? { calendar_event_id: linkNoteModalState.targetId }
                    : { todo_item_id: linkNoteModalState.targetId }
            )
        });
        if (!updateRes.ok) throw new Error('Failed to link note');
        closeLinkNoteModal();
        window.location.reload();
    } catch (e) {
        console.error('Error linking note:', e);
        alert('Could not link note. Please try again.');
    }
}

async function createAndLinkNote() {
    if (!linkNoteModalState.targetId) return;
    const newTitleInput = document.getElementById('link-note-new-title');
    const title = newTitleInput ? newTitleInput.value.trim() : '';
    const finalTitle = title || (linkNoteModalState.targetTitle ? `${linkNoteModalState.targetTitle} note` : 'New note');
    try {
        const createRes = await fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: finalTitle,
                content: '',
                ...(linkNoteModalState.targetType === 'calendar'
                    ? { calendar_event_id: linkNoteModalState.targetId }
                    : { todo_item_id: linkNoteModalState.targetId })
            })
        });
        if (!createRes.ok) throw new Error('Failed to create note');
        closeLinkNoteModal();
        window.location.reload();
    } catch (e) {
        console.error('Error creating note:', e);
        alert('Could not create note. Please try again.');
    }
}

async function updateLinkedTaskStatus(taskId, status) {
    try {
        await fetch(`/api/items/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
    } catch (e) {
        console.error('Error updating task status:', e);
    }
}

async function updateLinkedTaskDueDate(taskId, dayStr) {
    try {
        await fetch(`/api/items/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ due_date: dayStr })
        });
    } catch (e) {
        console.error('Error updating task date:', e);
    }
}

async function ensureLinkedTaskEvent(ev) {
    if (!ev || !ev.is_task_link || !ev.task_id) return null;
    if (ev.calendar_event_id) return ev;
    const created = await createCalendarEvent({
        title: ev.title,
        todo_item_id: ev.task_id
    });
    if (!created || !created.id) return null;
    ev.calendar_event_id = created.id;
    ev.start_time = created.start_time;
    ev.end_time = created.end_time;
    ev.reminder_minutes_before = created.reminder_minutes_before;
    ev.priority = created.priority || ev.priority;
    ev.day = created.day || calendarState.selectedDay;
    return ev;
}

async function unpinTaskDate(taskId) {
    if (!confirm('Remove this task from this date?')) return;
    try {
        await fetch(`/api/items/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ due_date: null })
        });
        window.location.reload();
    } catch (e) {
        console.error('Error unpinning task:', e);
        alert('Could not unpin task.');
    }
}

async function deleteItem(itemId) {
    openConfirmModal('Delete this item?', async () => {
        try {
            const res = await fetch(`/api/items/${itemId}`, { method: 'DELETE' });
            if (res.ok) {
                window.location.reload();
            }
        } catch (e) {
            console.error('Error deleting item:', e);
        }
    });
}

async function deleteList(listId) {
    openConfirmModal('Delete this list and all its contents?', async () => {
        try {
            const res = await fetch(`/api/lists/${listId}`, { method: 'DELETE' });
            if (res.ok) {
                window.location.href = '/';
            }
        } catch (e) {
            console.error('Error deleting list:', e);
        }
    });
}

// --- Status Functions ---

async function updateItemStatus(itemId, status) {
    try {
        const res = await fetch(`/api/items/${itemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });

        if (res.ok) {
            // Instead of reload, just refresh the list content
            await refreshListView();
        }
    } catch (e) {
        console.error('Error updating item:', e);
    }
}

async function inlineToggleStatus(itemId, currentStatus, targetStatus) {
    const nextStatus = currentStatus === targetStatus ? 'not_started' : targetStatus;
    updateItemStatus(itemId, nextStatus);
}

function toggleStatusDropdown(itemId) {
    const menu = document.getElementById(`status-menu-${itemId}`);
    // Close all other menus
    document.querySelectorAll('.status-dropdown-menu').forEach(el => {
        if (el !== menu) el.classList.remove('active');
    });
    menu.classList.toggle('active');
}

function initTaskFilters() {
    const menu = document.getElementById('task-filter-menu');
    if (!menu) return;
    menu.querySelectorAll('.task-filter-item[data-filter]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            setTaskFilter(btn.dataset.filter);
            closeTaskFilterMenu();
        });
    });
    setTaskFilter(currentTaskFilter);
}

function hashTagToHue(tag) {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
        hash = (hash << 5) - hash + tag.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) % 360;
}

function applyTagColors() {
    const chips = document.querySelectorAll('.task-tags .tag-chip[data-tag]');
    if (!chips.length) return;
    chips.forEach(chip => {
        const tag = chip.dataset.tag || '';
        if (!tag) return;
        const hue = hashTagToHue(tag.toLowerCase());
        chip.style.backgroundColor = `hsl(${hue}, 70%, 92%)`;
        chip.style.borderColor = `hsl(${hue}, 55%, 55%)`;
        chip.style.color = `hsl(${hue}, 45%, 30%)`;
    });
}

function setTaskFilter(filter) {
    const menu = document.getElementById('task-filter-menu');
    if (!menu) return;
    currentTaskFilter = filter || 'all';
    menu.querySelectorAll('.task-filter-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === currentTaskFilter);
    });
    updateTaskFilterLabel(menu);
    renderActiveFilterPills();
    applyTaskFilter();
}

function updateTaskFilterLabel(menu) {
    const label = document.getElementById('task-filter-label');
    if (!label) return;
    label.textContent = 'Filter';
}

function renderActiveFilterPills() {
    const container = document.getElementById('task-filter-pills');
    if (!container) return;
    container.innerHTML = '';

    if (currentTaskFilter && currentTaskFilter !== 'all') {
        const statusLabel = currentTaskFilter === 'in_progress' ? 'Started' :
            currentTaskFilter === 'not_started' ? 'Not Started' :
                currentTaskFilter === 'done' ? 'Done' : currentTaskFilter;
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'filter-pill';
        pill.innerHTML = `Status: ${statusLabel} <i class="fa-solid fa-xmark"></i>`;
        pill.addEventListener('click', (e) => {
            e.preventDefault();
            setTaskFilter('all');
        });
        container.appendChild(pill);
    }

    if (selectedTagFilters.size > 0) {
        Array.from(selectedTagFilters).sort().forEach(tag => {
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.className = 'filter-pill';
            pill.innerHTML = `Tag: ${tag} <i class="fa-solid fa-xmark"></i>`;
            pill.addEventListener('click', (e) => {
                e.preventDefault();
                selectedTagFilters.delete(tag);
                syncTagFilterUI();
                applyTaskFilter();
            });
            container.appendChild(pill);
        });
    }

    container.style.display = container.children.length ? 'flex' : 'none';
}

function normalizeTag(value) {
    return (value || '').toString().trim().toLowerCase();
}

function initTagFilters() {
    const chips = document.getElementById('task-filter-submenu-tags');
    if (!chips) {
        if (selectedTagFilters.size > 0) {
            selectedTagFilters.clear();
            const menu = document.getElementById('task-filter-menu');
            updateTaskFilterLabel(menu);
            renderActiveFilterPills();
            applyTaskFilter();
        }
        return;
    }
    chips.querySelectorAll('.tag-filter-chip').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const tag = btn.dataset.tag;
            if (!tag) return;
            if (tag === '__all') {
                selectedTagFilters.clear();
            } else {
                const normalized = normalizeTag(tag);
                if (selectedTagFilters.has(normalized)) {
                    selectedTagFilters.delete(normalized);
                } else {
                    selectedTagFilters.add(normalized);
                }
            }
            syncTagFilterUI();
            applyTaskFilter();
        });
    });
    syncTagFilterUI();
}

function syncTagFilterUI() {
    const chips = document.getElementById('task-filter-submenu-tags');
    if (!chips) return;
    const allBtn = chips.querySelector('.tag-filter-chip[data-tag="__all"]');
    const hasSelection = selectedTagFilters.size > 0;
    if (allBtn) allBtn.classList.toggle('active', !hasSelection);
    chips.querySelectorAll('.tag-filter-chip').forEach(btn => {
        const tag = btn.dataset.tag;
        if (!tag || tag === '__all') return;
        btn.classList.toggle('active', selectedTagFilters.has(normalizeTag(tag)));
    });
    const menu = document.getElementById('task-filter-menu');
    updateTaskFilterLabel(menu);
    renderActiveFilterPills();
}

function itemMatchesTagFilter(item) {
    if (selectedTagFilters.size === 0) return true;
    const rawTags = item.dataset.tags || '';
    if (!rawTags.trim()) return false;
    const tags = rawTags.split(',').map(normalizeTag).filter(Boolean);
    if (!tags.length) return false;
    return Array.from(selectedTagFilters).every(tag => tags.includes(tag));
}

function applyTaskFilter() {
    const items = Array.from(document.querySelectorAll('.task-item'));
    if (!items.length) return;
    const phaseVisibility = new Map();

    items.forEach(item => {
        if (item.classList.contains('phase')) return;
        const status = item.dataset.status;
        const matchesStatus = currentTaskFilter === 'all' || status === currentTaskFilter;
        const matchesTags = itemMatchesTagFilter(item);
        const matches = matchesStatus && matchesTags;
        item.classList.toggle('hidden-by-filter', !matches);
        if (matches) {
            const phaseParent = item.dataset.phaseParent;
            if (phaseParent) phaseVisibility.set(phaseParent, true);
        }
    });

    items.forEach(item => {
        if (!item.classList.contains('phase')) return;
        const phaseId = item.dataset.phaseId;
        const showPhase = (currentTaskFilter === 'all' && selectedTagFilters.size === 0) || phaseVisibility.get(phaseId);
        item.classList.toggle('hidden-by-filter', !showPhase);
    });
}

function toggleTaskFilterSubmenu(kind, event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('task-filter-menu');
    if (!menu) return;
    const statusMenu = document.getElementById('task-filter-submenu-status');
    const tagsMenu = document.getElementById('task-filter-submenu-tags');
    if (!statusMenu || !tagsMenu) return;
    const openStatus = statusMenu.classList.contains('show');
    const openTags = tagsMenu.classList.contains('show');

    if (kind === 'status') {
        statusMenu.classList.toggle('show', !openStatus);
        tagsMenu.classList.remove('show');
    } else if (kind === 'tags') {
        tagsMenu.classList.toggle('show', !openTags);
        statusMenu.classList.remove('show');
    }
}

function clearTaskFilters(event) {
    if (event) event.stopPropagation();
    currentTaskFilter = 'all';
    selectedTagFilters.clear();
    const menu = document.getElementById('task-filter-menu');
    if (menu) {
        menu.querySelectorAll('.task-filter-item[data-filter]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === currentTaskFilter);
        });
    }
    syncTagFilterUI();
    renderActiveFilterPills();
    applyTaskFilter();
}

function toggleTaskFilterMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('task-filter-menu');
    if (!menu) return;
    const shouldShow = !menu.classList.contains('show');
    menu.classList.toggle('show', shouldShow);
    if (!shouldShow) {
        const statusMenu = document.getElementById('task-filter-submenu-status');
        if (statusMenu) statusMenu.classList.remove('show');
        const tagsMenu = document.getElementById('task-filter-submenu-tags');
        if (tagsMenu) tagsMenu.classList.remove('show');
    }
}

function closeTaskFilterMenu() {
    const menu = document.getElementById('task-filter-menu');
    if (menu) menu.classList.remove('show');
    const statusMenu = document.getElementById('task-filter-submenu-status');
    if (statusMenu) statusMenu.classList.remove('show');
    const tagsMenu = document.getElementById('task-filter-submenu-tags');
    if (tagsMenu) tagsMenu.classList.remove('show');
}

// Toggle task actions dropdown
function toggleTaskActionsMenu(itemId, event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById(`task-actions-menu-${itemId}`);
    const taskItem = document.getElementById(`item-${itemId}`);

    // Close all other menus and remove menu-open class from all task items
    document.querySelectorAll('.task-actions-menu').forEach(el => {
        if (el !== menu) el.classList.remove('active');
    });
    document.querySelectorAll('.task-item.menu-open').forEach(el => {
        if (el !== taskItem) el.classList.remove('menu-open');
    });

    if (menu) {
        menu.classList.toggle('active');
        // Add/remove menu-open class to task item
        if (taskItem) {
            taskItem.classList.toggle('menu-open', menu.classList.contains('active'));
        }
    }
}

// Close dropdowns when clicking outside
window.addEventListener('click', function (e) {
    if (!e.target.closest('.status-dropdown-container')) {
        document.querySelectorAll('.status-dropdown-menu').forEach(el => {
            el.classList.remove('active');
        });
    }

    if (!e.target.closest('.task-filter-dropdown')) {
        closeTaskFilterMenu();
    }

    if (!e.target.closest('.task-actions-dropdown')) {
        document.querySelectorAll('.task-actions-menu').forEach(el => {
            el.classList.remove('active');
        });
        document.querySelectorAll('.task-item.menu-open').forEach(el => {
            el.classList.remove('menu-open');
        });
    }
});

// --- Modal Functions ---

function openCreateModal() {
    createModal.classList.add('active');
}

function closeCreateModal() {
    createModal.classList.remove('active');
    document.getElementById('list-title').value = '';
}

function openAddItemModal(phaseId = null, mode = 'task') {
    if (!addItemModal) return;
    addItemModal.classList.add('active');
    const contentInput = document.getElementById('item-content');
    if (contentInput) contentInput.focus();

    const phaseSelect = document.getElementById('item-phase-select');
    const hiddenPhase = document.getElementById('item-phase-id');
    const modeInput = document.getElementById('item-mode');
    const titleEl = document.getElementById('add-item-title');
    const phaseSelectGroup = document.getElementById('phase-select-group');
    const projectTypeGroup = document.getElementById('project-type-select-group');
    const projectTypeSelect = document.getElementById('project-type-select');

    if (modeInput) modeInput.value = mode || 'task';

    if (titleEl) {
        if (mode === 'phase') titleEl.textContent = 'Add Phase';
        else if (mode === 'project_list' || mode === 'project_hub') titleEl.textContent = 'Add Project';
        else titleEl.textContent = 'Add Task';
    }

    if (projectTypeGroup) projectTypeGroup.style.display = (mode === 'project_list' || mode === 'project_hub') ? 'block' : 'none';
    if (projectTypeSelect) {
        if (mode === 'project_hub') projectTypeSelect.value = 'hub';
        else projectTypeSelect.value = 'list';
    }
    
    if (hiddenPhase) hiddenPhase.value = phaseId ? String(phaseId) : '';
    if (phaseSelect) {
        if (phaseId) {
            phaseSelect.value = String(phaseId);
        } else {
            phaseSelect.value = '';
        }
    }
    if (phaseSelectGroup) phaseSelectGroup.style.display = mode === 'phase' ? 'none' : 'block';
}

function closeAddItemModal() {
    if (!addItemModal) return;
    addItemModal.classList.remove('active');
    const contentInput = document.getElementById('item-content');
    if (contentInput) contentInput.value = '';
    const descriptionInput = document.getElementById('item-description');
    if (descriptionInput) descriptionInput.value = '';
    const notesInput = document.getElementById('item-notes');
    if (notesInput) notesInput.value = '';
    const tagsInput = document.getElementById('item-tags');
    if (tagsInput) tagsInput.value = '';
    const phaseSelect = document.getElementById('item-phase-select');
    if (phaseSelect) phaseSelect.value = '';
    const hiddenPhase = document.getElementById('item-phase-id');
    if (hiddenPhase) hiddenPhase.value = '';
    const modeInput = document.getElementById('item-mode');
    if (modeInput) modeInput.value = 'task';
    const projectTypeGroup = document.getElementById('project-type-select-group');
    if (projectTypeGroup) projectTypeGroup.style.display = 'none';

    const titleEl = document.getElementById('add-item-title');
    if (titleEl) titleEl.textContent = (typeof CURRENT_LIST_TYPE !== 'undefined' && CURRENT_LIST_TYPE === 'hub') ? 'Add Project' : 'Add Task';
    
    const phaseSelectGroup = document.getElementById('phase-select-group');
    if (phaseSelectGroup) phaseSelectGroup.style.display = 'block';
}

function openBulkImportModal() {
    if (bulkImportModal) {
        bulkImportModal.classList.add('active');
        const textarea = document.getElementById('bulk-import-text');
        if (textarea) textarea.focus();
    }
}

function closeBulkImportModal() {
    if (bulkImportModal) {
        bulkImportModal.classList.remove('active');
        const textarea = document.getElementById('bulk-import-text');
        if (textarea) textarea.value = '';
    }
}

function togglePhaseMenu(event, forceHide = false) {
    const menu = document.getElementById('phase-menu-main');
    if (!menu) return;
    if (event) event.stopPropagation();

    if (forceHide) {
        menu.classList.remove('show');
        return;
    }
    menu.classList.toggle('show');
}

function toggleHeaderMenu(event) {
    const dropdown = document.getElementById('header-menu-dropdown');
    if (!dropdown) return;
    if (event) event.stopPropagation();
    dropdown.classList.toggle('show');
}

// Close header menu when clicking outside
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('header-menu-dropdown');
    if (dropdown && dropdown.classList.contains('show')) {
        if (!e.target.closest('.header-main-menu')) {
            dropdown.classList.remove('show');
        }
    }
});

async function bulkImportItems(listId) {
    const textarea = document.getElementById('bulk-import-text');
    if (!textarea) return;
    const outline = textarea.value;
    if (!outline.trim()) return;

    try {
        const res = await fetch(`/api/lists/${listId}/bulk_import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ outline })
        });
        if (res.ok) {
            closeBulkImportModal();
            window.location.reload();
        } else {
            const err = await res.json();
            alert(err.error || 'Unable to import outline.');
        }
    } catch (e) {
        console.error('Error importing outline:', e);
    }
}

async function openMoveModal(itemId, itemType, itemName) {
    if (!moveItemModal) return;

    bulkMoveIds = null; // ensure single-item mode
    moveItemType = itemType;
    moveSelectedDestination = null;
    moveNavStack = [];
    document.getElementById('move-item-id').value = itemId;
    document.getElementById('move-item-title').textContent = `Move "${itemName}"`;
    moveItemModal.classList.add('active');
    renderMoveRoot(itemType);
}

function openBulkMoveModal() {
    if (!moveItemModal || selectedItems.size === 0) return;
    bulkMoveIds = Array.from(selectedItems).map(Number);
    moveItemType = 'task';
    document.getElementById('move-item-id').value = '';
    document.getElementById('move-item-title').textContent = `Move ${bulkMoveIds.length} items`;
    moveItemModal.classList.add('active');
    moveSelectedDestination = null;
    moveNavStack = [];
    renderMoveRoot('task');
}

function closeMoveModal() {
    if (moveItemModal) moveItemModal.classList.remove('active');
    bulkMoveIds = null;
    moveSelectedDestination = null;
    moveNavStack = [];
    updateMoveBackButton();
}

async function moveItem() {
    const itemId = document.getElementById('move-item-id').value;
    const isBulk = Array.isArray(bulkMoveIds) && bulkMoveIds.length > 0;

    if (!moveSelectedDestination || (!itemId && !isBulk)) {
        alert('Please select a destination.');
        return;
    }

    try {
        let res;
        if (isBulk) {
            res = await fetch('/api/items/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'move',
                    ids: bulkMoveIds,
                    list_id: typeof CURRENT_LIST_ID !== 'undefined' ? CURRENT_LIST_ID : null,
                    ...moveSelectedDestination
                })
            });
        } else {
            res = await fetch(`/api/items/${itemId}/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(moveSelectedDestination)
            });
        }

    if (res.ok) {
        closeMoveModal();
        selectedItems.clear();
        bulkMoveIds = null;
        moveSelectedDestination = null;
        window.location.reload();
    } else {
            const err = await res.json();
            alert(`Error: ${err.error || 'Could not move item.'}`);
        }
    } catch (e) {
        console.error('Error moving item:', e);
        alert('An unexpected error occurred.');
    }
}

function openEditItemModal(itemId, content, description, notes, tags) {
    const modal = document.getElementById('edit-item-modal');
    document.getElementById('edit-item-id').value = itemId;
    document.getElementById('edit-item-content').value = content;
    document.getElementById('edit-item-description').value = description || '';
    document.getElementById('edit-item-notes').value = notes || '';
    const tagsInput = document.getElementById('edit-item-tags');
    if (tagsInput) tagsInput.value = tags || '';
    modal.classList.add('active');
}

function closeEditItemModal() {
    const modal = document.getElementById('edit-item-modal');
    modal.classList.remove('active');
    const tagsInput = document.getElementById('edit-item-tags');
    if (tagsInput) tagsInput.value = '';
}

// --- Move Navigation (step-by-step) ---

function updateMoveBackButton() {
    const backBtn = document.getElementById('move-back-button');
    if (!backBtn) return;
    backBtn.style.display = moveNavStack.length > 1 ? 'inline-flex' : 'none';
}

// Selection summary removed - destination is selected when user clicks final option

function pushMoveView(renderFn) {
    moveNavStack.push(renderFn);
    updateMoveBackButton();
    renderFn();
}

function moveNavBack() {
    if (moveNavStack.length > 1) {
        moveNavStack.pop();
        const last = moveNavStack[moveNavStack.length - 1];
        last && last();
    }
    updateMoveBackButton();
}

function renderMoveRoot(itemType = 'task') {
    const panel = document.getElementById('move-step-container');
    if (!panel) return;
    panel.innerHTML = '';
    moveSelectedDestination = null;
    const effectiveType = itemType || moveItemType || 'task';
    moveNavStack = [() => renderMoveRoot(effectiveType)];
    updateMoveBackButton();

    const actions = [];
    if (effectiveType === 'task') {
        actions.push({
            label: `<i class="fa-solid fa-house" style="margin-right: 0.5rem;"></i>Move within "${typeof CURRENT_LIST_TITLE !== 'undefined' ? CURRENT_LIST_TITLE : 'this project'}"`,
            handler: () => pushMoveView(() => renderPhasePicker(CURRENT_LIST_ID, typeof CURRENT_LIST_TITLE !== 'undefined' ? CURRENT_LIST_TITLE : 'This project'))
        });
    }
    actions.push({
        label: '<i class="fa-solid fa-folder-tree" style="margin-right: 0.5rem;"></i>Browse hubs',
        handler: () => pushMoveView(renderHubList)
    });

    actions.forEach(action => {
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.innerHTML = action.label;
        btn.onclick = action.handler;
        panel.appendChild(btn);
    });
}

async function renderPhasePicker(listId, listTitle) {
    const panel = document.getElementById('move-step-container');
    if (!panel) return;
    panel.innerHTML = `<div class="move-heading"><i class="fa-solid fa-list-check" style="margin-right: 0.5rem;"></i>Choose a phase in "${listTitle}"</div>`;

    try {
        const res = await fetch(`/api/lists/${listId}/phases`);
        const data = await res.json();
        const btnNoPhase = document.createElement('button');
        btnNoPhase.className = 'btn';
        btnNoPhase.innerHTML = `<i class="fa-solid fa-inbox" style="margin-right: 0.5rem; opacity: 0.7;"></i>${data.title || 'Project'} <span style="opacity: 0.6; margin-left: 0.25rem;">(no phase)</span>`;
        btnNoPhase.onclick = () => {
            moveSelectedDestination = { destination_list_id: listId, destination_phase_id: null, label: data.title || listTitle };
            moveItem();
        };
        panel.appendChild(btnNoPhase);

        if (data.phases && data.phases.length) {
            data.phases.forEach(phase => {
                const btn = document.createElement('button');
                btn.className = 'btn';
                btn.innerHTML = `<i class="fa-solid fa-layer-group" style="margin-right: 0.5rem; opacity: 0.7;"></i>${phase.content}`;
                btn.onclick = () => {
                    moveSelectedDestination = {
                        destination_list_id: listId,
                        destination_phase_id: phase.id,
                        label: data.title || listTitle,
                        phase_label: phase.content
                    };
                    moveItem();
                };
                panel.appendChild(btn);
            });
        }
    } catch (e) {
        panel.innerHTML += '<div style="color: var(--danger-color); margin-top: 0.5rem;"><i class="fa-solid fa-exclamation-triangle"></i> Unable to load phases.</div>';
    }
}

async function renderHubList() {
    const panel = document.getElementById('move-step-container');
    if (!panel) return;
    panel.innerHTML = '<div class="move-heading"><i class="fa-solid fa-folder-tree" style="margin-right: 0.5rem;"></i>Choose a hub</div>';
    try {
        const res = await fetch('/api/hubs');
        const hubs = await res.json();
        if (!hubs.length) {
            panel.innerHTML += '<div style="color: var(--text-muted); padding: 1rem; text-align: center;"><i class="fa-solid fa-inbox" style="margin-right: 0.5rem;"></i>No hubs available.</div>';
            return;
        }
        hubs.forEach(hub => {
            const btn = document.createElement('button');
            btn.className = 'btn';
            btn.innerHTML = `<i class="fa-solid fa-folder-tree" style="margin-right: 0.5rem; opacity: 0.7;"></i>${hub.title}`;
            btn.onclick = () => {
                if (moveItemType === 'project') {
                    // Moving a project to a hub - this is final destination
                    moveSelectedDestination = { destination_hub_id: hub.id, label: hub.title };
                    moveItem();
                } else {
                    // Moving a task - show projects in this hub
                    pushMoveView(() => renderHubProjects(hub.id, hub.title));
                }
            };
            panel.appendChild(btn);
        });
    } catch (e) {
        panel.innerHTML += '<div style="color: var(--danger-color); margin-top: 0.5rem; padding: 1rem;"><i class="fa-solid fa-exclamation-triangle" style="margin-right: 0.5rem;"></i>Unable to load hubs.</div>';
    }
}

async function renderHubProjects(hubId, hubTitle) {
    const panel = document.getElementById('move-step-container');
    if (!panel) return;
    panel.innerHTML = `<div class="move-heading"><i class="fa-solid fa-sitemap" style="margin-right: 0.5rem;"></i>Projects in "${hubTitle}"</div>`;
    try {
        const res = await fetch(`/api/hubs/${hubId}/children`);
        const data = await res.json();
        if (!data.children || !data.children.length) {
            panel.innerHTML += '<div style="color: var(--text-muted); margin-top: 0.5rem; padding: 1rem; text-align: center;"><i class="fa-solid fa-inbox" style="margin-right: 0.5rem;"></i>No projects in this hub.</div>';
            return;
        }

        data.children.forEach(child => {
            if (child.type === 'hub') {
                // Nested hub - navigate into it
                const btnHub = document.createElement('button');
                btnHub.className = 'btn';
                btnHub.innerHTML = `<i class="fa-solid fa-folder-tree" style="margin-right: 0.5rem; opacity: 0.7;"></i>${child.title} <span style="opacity: 0.6; margin-left: 0.25rem;">(Hub)</span>`;
                btnHub.onclick = () => pushMoveView(() => renderHubProjects(child.id, child.title));
                panel.appendChild(btnHub);
            } else {
                // Project list - show it to navigate to phases
                const btnProject = document.createElement('button');
                btnProject.className = 'btn';
                btnProject.innerHTML = `<i class="fa-solid fa-list-check" style="margin-right: 0.5rem; opacity: 0.7;"></i>${child.title}`;
                btnProject.onclick = () => pushMoveView(() => renderPhasePicker(child.id, child.title));
                panel.appendChild(btnProject);
            }
        });
    } catch (e) {
        panel.innerHTML += '<div style="color: var(--danger-color); margin-top: 0.5rem; padding: 1rem;"><i class="fa-solid fa-exclamation-triangle" style="margin-right: 0.5rem;"></i>Unable to load hub contents.</div>';
    }
}
// --- Confirm Modal ---

function openConfirmModal(message, onConfirm) {
    if (confirmMessage) confirmMessage.textContent = message || 'Are you sure?';
    pendingConfirm = onConfirm;
    if (confirmModal) confirmModal.classList.add('active');
}

function closeConfirmModal() {
    pendingConfirm = null;
    if (confirmModal) confirmModal.classList.remove('active');
}

async function saveItemChanges() {
    const itemId = document.getElementById('edit-item-id').value;
    const content = document.getElementById('edit-item-content').value.trim();
    const description = document.getElementById('edit-item-description').value.trim();
    const notes = document.getElementById('edit-item-notes').value.trim();
    const tags = document.getElementById('edit-item-tags')?.value.trim() || '';

    if (!content) return;

    try {
        const res = await fetch(`/api/items/${itemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, description, notes, tags })
        });

        if (res.ok) {
            window.location.reload();
        }
    } catch (e) {
        console.error('Error updating item:', e);
    }
}

// --- Bulk Selection ---

function updateBulkBar() {
    const scrollY = window.scrollY;
    const bar = document.getElementById('bulk-actions');
    const countSpan = document.getElementById('bulk-count');
    const selectAll = document.getElementById('select-all');
    const totalItems = document.querySelectorAll('.task-item').length;

    if (selectedItems.size > 0) {
        if (bar) bar.style.display = 'flex';
        if (countSpan) countSpan.textContent = `${selectedItems.size} selected`;
    } else {
        if (bar) bar.style.display = 'none';
        if (countSpan) countSpan.textContent = '';
    }

  if (selectedItems.size === 0 && document.body.classList.contains('selection-mode-active')) {
    document.body.classList.remove('selection-mode-active');
  } else if (selectedItems.size > 0 && !document.body.classList.contains('selection-mode-active')) {
    document.body.classList.add('selection-mode-active');
  }

    if (selectAll) {
        selectAll.checked = totalItems > 0 && selectedItems.size === totalItems;
        selectAll.indeterminate = selectedItems.size > 0 && selectedItems.size < totalItems;
    }
    // Prevent layout jump when bar appears
    window.scrollTo(0, scrollY);
}

function toggleBulkMenu(event, forceClose = false) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('bulk-menu-dropdown');
    if (!menu) return;
    if (forceClose) {
        menu.classList.remove('show');
        return;
    }

    // Position the menu above the button on mobile
    if (window.innerWidth <= 768 && event && event.currentTarget) {
        const button = event.currentTarget;
        const rect = button.getBoundingClientRect();
        const menuHeight = menu.offsetHeight || 120; // Estimate if not visible yet

        // Position above the button
        menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
        menu.style.left = `${rect.left}px`;
    }

    menu.classList.toggle('show');
}

// Close bulk menu when clicking outside
document.addEventListener('click', (e) => {
    const menu = document.getElementById('bulk-menu-dropdown');
    if (!menu) return;
    if (!e.target.closest('.bulk-menu')) {
        menu.classList.remove('show');
    }
});


function setTaskSelected(itemId, isSelected, skipPhaseCascade = false) {
    const row = document.getElementById(`item-${itemId}`);
    if (!row) return;
    const isPhase = row.classList.contains('phase');
    if (isPhase && !skipPhaseCascade) {
        cascadePhaseSelection(row, isSelected);
    }
    row.classList.toggle('selected', isSelected);
    if (isSelected) selectedItems.add(itemId);
    else selectedItems.delete(itemId);
}

function resetTaskSelection() {
    selectedItems.clear();
    document.querySelectorAll('.task-item.selected').forEach(row => row.classList.remove('selected'));
    const selectAll = document.getElementById('select-all');
    if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
    }
    updateBulkBar();
}

function shouldIgnoreTaskSelection(target) {
    return !!(
        target.closest('.drag-handle') ||
        target.closest('.task-actions-dropdown') ||
        target.closest('.task-actions') ||
        target.closest('.status-buttons') ||
        target.closest('button') ||
        target.closest('a') ||
        target.closest('input') ||
        target.closest('textarea') ||
        target.closest('select')
    );
}

function cascadePhaseSelection(phaseElement, isChecked) {
    const items = Array.from(document.querySelectorAll('.task-item'));
    // Find the index of the phase element that was clicked
    const startIdx = items.indexOf(phaseElement);
    if (startIdx === -1) return;

    for (let i = startIdx + 1; i < items.length; i++) {
        const el = items[i];
        if (el.classList.contains('phase')) break;
        const id = parseInt(el.getAttribute('data-item-id'), 10);
        setTaskSelected(id, isChecked, true);
    }
}

function toggleSelectItem(itemId, isChecked, skipPhaseCascade = false) {
    const row = document.getElementById(`item-${itemId}`);
    const isPhase = row && row.classList.contains('phase');

    if (isPhase && !skipPhaseCascade) {
        // If a phase is clicked directly, also select/deselect its children
        cascadePhaseSelection(row, isChecked);
    }

    setTaskSelected(itemId, isChecked, true);

    updateBulkBar();
}

function toggleSelectAll(checkbox) {
    const shouldSelect = checkbox.checked;
    selectedItems.clear();
    const rows = document.querySelectorAll('.task-item');
    rows.forEach(row => {
        const id = parseInt(row.getAttribute('data-item-id'), 10);
        setTaskSelected(id, shouldSelect, true);
    });
    updateBulkBar();
}

async function bulkUpdateStatus(status) {
    if (selectedItems.size === 0) return;
    try {
        const res = await fetch('/api/items/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'status',
                status,
                ids: Array.from(selectedItems),
                list_id: typeof CURRENT_LIST_ID !== 'undefined' ? CURRENT_LIST_ID : null
            })
        });
        if (res.ok) {
            selectedItems.clear();
            await refreshListView();
        }
    } catch (e) {
        console.error('Error bulk updating status:', e);
    }
}

async function bulkDelete() {
    if (selectedItems.size === 0) return;
    openConfirmModal('Delete selected items?', async () => {
        try {
            const res = await fetch('/api/items/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete',
                    ids: Array.from(selectedItems),
                    list_id: typeof CURRENT_LIST_ID !== 'undefined' ? CURRENT_LIST_ID : null
                })
            });
            if (res.ok) {
                window.location.reload();
            }
        } catch (e) {
            console.error('Error bulk deleting:', e);
        }
    });
}

// --- Bulk Note Selection ---

function updateNotesBulkBar() {
    const bar = document.getElementById('notes-bulk-actions');
    const countSpan = document.getElementById('notes-bulk-count');
    const selectAll = document.getElementById('notes-select-all');
    const totalNotes = notesState.notes.length;

    if (selectedNotes.size > 0) {
        if (bar) bar.style.display = 'flex';
        if (countSpan) countSpan.textContent = `${selectedNotes.size} selected`;
    } else {
        if (bar) bar.style.display = 'none';
        if (countSpan) countSpan.textContent = '';
    }

    if (selectedNotes.size === 0 && document.body.classList.contains('note-selection-mode-active')) {
        document.body.classList.remove('note-selection-mode-active');
    } else if (selectedNotes.size > 0 && !document.body.classList.contains('note-selection-mode-active')) {
        document.body.classList.add('note-selection-mode-active');
    }

    if (selectAll) {
        selectAll.checked = totalNotes > 0 && selectedNotes.size === totalNotes;
        selectAll.indeterminate = selectedNotes.size > 0 && selectedNotes.size < totalNotes;
    }
}

function setNoteSelected(noteId, isSelected) {
    const noteElements = document.querySelectorAll(`[data-note-id="${noteId}"]`);
    noteElements.forEach(el => {
        el.classList.toggle('selected', isSelected);
    });
    if (isSelected) {
        selectedNotes.add(noteId);
    } else {
        selectedNotes.delete(noteId);
    }
}

function resetNoteSelection() {
    selectedNotes.clear();
    document.querySelectorAll('.notes-list-item.selected').forEach(el => el.classList.remove('selected'));
    const selectAll = document.getElementById('notes-select-all');
    if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
    }
    updateNotesBulkBar();
}

function toggleNotesSelectAll(checkbox) {
    const shouldSelect = checkbox.checked;
    selectedNotes.clear();
    notesState.notes.forEach(note => {
        setNoteSelected(note.id, shouldSelect);
    });
    updateNotesBulkBar();
}

function shouldIgnoreNoteSelection(target) {
    return !!(
        target.closest('.pin-btn') ||
        target.closest('.note-actions') ||
        target.closest('button.btn-icon')
    );
}

async function bulkDeleteNotes() {
    if (selectedNotes.size === 0) return;
    openConfirmModal(`Delete ${selectedNotes.size} note(s)?`, async () => {
        try {
            const deletePromises = Array.from(selectedNotes).map(noteId =>
                fetch(`/api/notes/${noteId}`, { method: 'DELETE' })
            );
            await Promise.all(deletePromises);
            resetNoteSelection();
            await loadNotes({ keepSelection: false });
        } catch (e) {
            console.error('Error bulk deleting notes:', e);
        }
    });
}

async function bulkPinNotes() {
    if (selectedNotes.size === 0) return;
    try {
        const pinPromises = Array.from(selectedNotes).map(noteId =>
            fetch(`/api/notes/${noteId}/pin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pinned: true })
            })
        );
        await Promise.all(pinPromises);
        resetNoteSelection();
        await loadNotes({ keepSelection: false });
    } catch (e) {
        console.error('Error bulk pinning notes:', e);
    }
}

async function bulkUnpinNotes() {
    if (selectedNotes.size === 0) return;
    try {
        const unpinPromises = Array.from(selectedNotes).map(noteId =>
            fetch(`/api/notes/${noteId}/pin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pinned: false })
            })
        );
        await Promise.all(unpinPromises);
        resetNoteSelection();
        await loadNotes({ keepSelection: false });
    } catch (e) {
        console.error('Error bulk unpinning notes:', e);
    }
}

// --- Drag & Drop Reorder ---

// Task list and pinned notes need different drag logic; keep these helpers distinct.
function getTaskDragAfterElement(container, y) {
    const elements = [...container.querySelectorAll('.task-item:not(.dragging):not(.drag-placeholder)')];

    if (elements.length === 0) {
        return null; // No elements to compare, will append to container
    }

    let closestElement = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    let closestChild = null;

    elements.forEach(child => {
        const box = child.getBoundingClientRect();
        const elementCenter = box.top + box.height / 2;
        const distance = Math.abs(y - elementCenter);

        if (distance < closestDistance) {
            closestDistance = distance;
            closestChild = child;
            // If touch is above center, insert before this element
            // If touch is below center, insert after (which means before next element)
            if (y < elementCenter) {
                closestElement = child;
            } else {
                // Find next non-dragging sibling
                let next = child.nextElementSibling;
                while (next && (next.classList.contains('dragging') || next.classList.contains('drag-placeholder'))) {
                    next = next.nextElementSibling;
                }
                closestElement = next; // Could be null if at end
            }
        }
    });

    return closestElement;
}

function handleDragStart(e) {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    if (selectedItems.size > 0) {
        e.preventDefault();
        return;
    }
    const itemId = handle.getAttribute('data-drag-id');
    currentDragId = itemId;
    const row = document.getElementById(`item-${itemId}`);
    currentDragBlock = [];
    if (row) {
        const isPhase = row.classList.contains('phase');
        if (isPhase) {
            const siblings = Array.from(document.querySelectorAll('.task-item'));
            const startIdx = siblings.indexOf(row);
            for (let i = startIdx; i < siblings.length; i++) {
                const el = siblings[i];
                if (i > startIdx && el.classList.contains('phase')) break;
                currentDragBlock.push(el);
                el.classList.add('dragging');
            }
        } else {
            currentDragBlock.push(row);
            row.classList.add('dragging');
        }
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemId);
}

function handleDragEnd() {
    currentDragId = null;
    currentDragBlock.forEach(el => el.classList.remove('dragging'));
    currentDragBlock = [];
}

async function commitOrderFromDOM() {
    const container = document.getElementById('items-container');
    if (!container) return;
    const ids = Array.from(container.querySelectorAll('.task-item')).map(el => parseInt(el.getAttribute('data-item-id'), 10));
    try {
        const res = await fetch(`/api/lists/${CURRENT_LIST_ID}/reorder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        if (!res.ok) {
            console.error('Failed to save order');
        }
    } catch (err) {
        console.error('Error saving order:', err);
    }
}

function handleDragOver(e) {
    e.preventDefault();
    const container = document.getElementById('items-container');
    if (!container) return;
    const afterElement = getTaskDragAfterElement(container, e.clientY);
    if (!currentDragBlock.length) return;

    // Remove current block to reinsert
    currentDragBlock.forEach(el => {
        if (el.parentElement === container) {
            container.removeChild(el);
        }
    });

    if (afterElement == null) {
        currentDragBlock.forEach(el => container.appendChild(el));
    } else {
        currentDragBlock.forEach(el => container.insertBefore(el, afterElement));
    }
}

async function handleDrop(e) {
    e.preventDefault();
    const container = document.getElementById('items-container');
    if (!container) return;
    await commitOrderFromDOM();
    handleDragEnd();
}

async function refreshListView() {
    try {
        const res = await fetch(window.location.href, {
            headers: { 'Accept': 'text/html' }
        });
        const html = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const newContainer = doc.getElementById('items-container');
        document.getElementById('items-container').innerHTML = newContainer.innerHTML;
        normalizePhaseParents();
        organizePhaseDoneTasks();
        initTaskSelectionUI();
        selectedItems.forEach(id => setTaskSelected(id, true, true));
        updateBulkBar();
        initDragAndDrop(); // Re-initialize drag and drop on new elements
        restorePhaseVisibility();
        applyTaskFilter();
    } catch (e) {
        console.error('Error refreshing list view:', e);
    }
}

function initDragAndDrop() {
    const container = document.getElementById('items-container');
    if (!container) return;
    container.addEventListener('dragover', handleDragOver);
    container.addEventListener('drop', handleDrop);

    document.querySelectorAll('.drag-handle').forEach(handle => {
        handle.setAttribute('draggable', 'true');
        handle.addEventListener('dragstart', handleDragStart);
        handle.addEventListener('dragend', handleDragEnd);
        handle.addEventListener('touchstart', touchHandleDragStart, { passive: false });
        handle.addEventListener('touchmove', touchHandleDragMove, { passive: false });
        handle.addEventListener('touchend', touchHandleDragEnd, { passive: false });
    });
}

function handleTouchStart(e) {
    longPressTriggered = false;
    isTouchScrolling = false;
    if (e.touches && e.touches.length) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }
    const item = e.currentTarget;
    if (shouldIgnoreTaskSelection(e.target)) return;
    // Don't trigger long press if dragging
    if (e.target.closest('.drag-handle')) return;

    longPressTimer = setTimeout(() => {
        longPressTimer = null; // Prevent multiple triggers
        const itemId = parseInt(item.dataset.itemId, 10);
        setTaskSelected(itemId, true);
        longPressTriggered = true;
        updateBulkBar();
    }, 500); // 500ms for a long press
}

function handleTouchMove(e) {
    // If user moves finger, it's a scroll, not a long press
    if (e.touches && e.touches.length) {
        const dx = Math.abs(e.touches[0].clientX - touchStartX);
        const dy = Math.abs(e.touches[0].clientY - touchStartY);
        if (dx > 8 || dy > 8) {
            isTouchScrolling = true;
            clearTimeout(longPressTimer);
            longPressTimer = null;
            return;
        }
    }
}

function handleTouchEnd(e) {
    clearTimeout(longPressTimer);
    if (isTouchScrolling) {
        isTouchScrolling = false;
        longPressTriggered = false;
        return;
    }
    if (longPressTriggered) {
        const item = e.currentTarget;
        if (item) item.dataset.skipClickAfterPress = 'true';
        longPressTriggered = false;
        return;
    }
    // If we are in selection mode, a short tap should toggle selection
    if (document.body.classList.contains('selection-mode-active')) {
        // Prevent click event from also firing and toggling again
        e.preventDefault();
        const item = e.currentTarget;
        const itemId = parseInt(item.dataset.itemId, 10);
        if (!shouldIgnoreTaskSelection(e.target)) {
            const next = !selectedItems.has(itemId);
            setTaskSelected(itemId, next);
            updateBulkBar();
        }
    }
}

function handleTaskClick(e) {
    const row = e.currentTarget;
    if (row.dataset.skipClickAfterPress === 'true') {
        row.dataset.skipClickAfterPress = 'false';
        return;
    }
    if (shouldIgnoreTaskSelection(e.target)) return;
    const meta = e.metaKey || e.ctrlKey;
    if (!meta && selectedItems.size === 0) return;
    e.preventDefault();
    const itemId = parseInt(row.dataset.itemId, 10);
    const next = !selectedItems.has(itemId);
    setTaskSelected(itemId, next);
    updateBulkBar();
}

// Touch drag for mobile (reorder)
let touchDragStartY = 0;
let touchDragCurrentY = 0;
let touchDragPlaceholder = null;



function touchHandleDragStart(e) {
    const handle = e.currentTarget;
    const itemId = handle.getAttribute('data-drag-id');
    if (!itemId) return;
    if (selectedItems.size > 0) {
        e.preventDefault();
        return;
    }

    console.log('🔵 ===== DRAG START =====');
    console.log('🔵 Item ID:', itemId);

    const touch = e.touches[0];
    touchDragStartY = touch.clientY;
    touchDragCurrentY = touch.clientY;
    touchDragActive = true;
    touchDragId = itemId;
    touchDragBlock = [];

    const row = document.getElementById(`item-${itemId}`);
    if (row) {
        console.log('🔵 Row found:', row);
        const isPhase = row.classList.contains('phase');
        if (isPhase) {
            const siblings = Array.from(document.querySelectorAll('.task-item'));
            const startIdx = siblings.indexOf(row);
            for (let i = startIdx; i < siblings.length; i++) {
                const el = siblings[i];
                if (i > startIdx && el.classList.contains('phase')) break;
                touchDragBlock.push(el);
            }
        } else {
            touchDragBlock.push(row);
        }

        console.log('🔵 Dragging', touchDragBlock.length, 'items');

        const container = document.getElementById('items-container');
        if (container && touchDragBlock.length > 0) {
            // Get INITIAL positions BEFORE any DOM changes
            const initialPositions = touchDragBlock.map(el => {
                const rect = el.getBoundingClientRect();
                return {
                    el: el,
                    id: el.dataset.itemId,
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height
                };
            });

            console.log('🔵 INITIAL positions (before placeholder):', initialPositions);

            // Create placeholder first
            touchDragPlaceholder = document.createElement('div');
            touchDragPlaceholder.className = 'drag-placeholder';
            const totalHeight = touchDragBlock.reduce((sum, el) => sum + el.offsetHeight, 0);
            touchDragPlaceholder.style.height = `${totalHeight}px`;
            touchDragPlaceholder.style.margin = '0.25rem 0';
            touchDragPlaceholder.style.border = '2px dashed var(--primary-color)';
            touchDragPlaceholder.style.borderRadius = '8px';
            touchDragPlaceholder.style.background = 'var(--primary-light)';
            touchDragPlaceholder.style.opacity = '0.5';

            // Insert placeholder
            container.insertBefore(touchDragPlaceholder, touchDragBlock[0]);
            console.log('🔵 Placeholder inserted before first item');

            // Now get positions AFTER placeholder is inserted
            const afterPlaceholderPositions = touchDragBlock.map(el => {
                const rect = el.getBoundingClientRect();
                return {
                    id: el.dataset.itemId,
                    top: rect.top,
                    left: rect.left
                };
            });

            console.log('🔵 Positions AFTER placeholder:', afterPlaceholderPositions);

            // Make items fixed using initial positions (before placeholder was inserted)
            touchDragBlock.forEach((el, index) => {
                const initialPos = initialPositions[index];
                el.classList.add('dragging');
                el.style.position = 'fixed';
                el.style.left = initialPos.left + 'px';
                el.style.top = initialPos.top + 'px';
                el.style.width = initialPos.width + 'px';
                el.style.zIndex = '9999';
                el.style.pointerEvents = 'none';

                console.log(`🔵 Item ${initialPos.id} set to fixed at:`, {
                    top: initialPos.top,
                    left: initialPos.left,
                    appliedTop: el.style.top,
                    appliedLeft: el.style.left
                });
            });
        }
    }
    e.preventDefault();
}

function touchHandleDragMove(e) {
    if (!touchDragActive || !touchDragBlock.length) return;
    if (!e.touches || !e.touches.length) return;

    const touch = e.touches[0];
    const deltaY = touch.clientY - touchDragCurrentY;
    touchDragCurrentY = touch.clientY;
    const container = document.getElementById('items-container');
    if (!container) return;

    console.log('🟢 DRAG MOVE - Y:', touchDragCurrentY, 'deltaY:', deltaY);

    // Move the dragged items with the finger
    touchDragBlock.forEach((el, index) => {
        const currentTop = parseFloat(el.style.top);
        const newTop = currentTop + deltaY;
        el.style.top = newTop + 'px';
        if (index === 0) {
            console.log('🟢 Moving item to:', newTop, '(was:', currentTop, ')');
        }
    });

    // Auto-scroll when dragging near edges
    const scrollThreshold = 80;
    const scrollSpeed = 10;
    const viewportHeight = window.innerHeight;
    if (touchDragCurrentY < scrollThreshold) {
        window.scrollBy(0, -scrollSpeed);
    } else if (touchDragCurrentY > viewportHeight - scrollThreshold) {
        window.scrollBy(0, scrollSpeed);
    }

    // Find where to insert placeholder based on touch position
    const afterElement = getTaskDragAfterElement(container, touchDragCurrentY);

    console.log('🟢 Placeholder should be inserted', afterElement ? 'before item ' + afterElement.dataset.itemId : 'at end');

    if (touchDragPlaceholder && touchDragPlaceholder.parentElement) {
        touchDragPlaceholder.parentElement.removeChild(touchDragPlaceholder);
    }

    if (afterElement == null) {
        container.appendChild(touchDragPlaceholder);
    } else {
        container.insertBefore(touchDragPlaceholder, afterElement);
    }

    e.preventDefault();
}

async function touchHandleDragEnd(e) {
    if (!touchDragActive) return;
    console.log('🔴 ===== DRAG END =====');
    touchDragActive = false;
    touchDragId = null;

    const container = document.getElementById('items-container');
    if (container && touchDragPlaceholder && touchDragPlaceholder.parentElement) {
        console.log('🔴 Restoring items to placeholder position');

        // Restore normal positioning for dragged elements
        touchDragBlock.forEach((el, index) => {
            console.log(`🔴 Item ${el.dataset.itemId} - before restore:`, {
                position: el.style.position,
                top: el.style.top,
                left: el.style.left
            });

            el.style.position = '';
            el.style.left = '';
            el.style.top = '';
            el.style.width = '';
            el.style.zIndex = '';
            el.style.pointerEvents = '';
            el.classList.remove('dragging');
            delete el.dataset.originalTop;
            delete el.dataset.originalLeft;
            delete el.dataset.originalWidth;

            if (index === 0) {
                const newRect = el.getBoundingClientRect();
                console.log(`🔴 Item ${el.dataset.itemId} - after restore, new position:`, {
                    top: newRect.top,
                    left: newRect.left
                });
            }
        });

        // Move elements to placeholder position
        console.log('🔴 Moving items to placeholder location in DOM');
        touchDragBlock.forEach(el => {
            container.insertBefore(el, touchDragPlaceholder);
        });

        // Remove placeholder
        touchDragPlaceholder.parentElement.removeChild(touchDragPlaceholder);
        touchDragPlaceholder = null;
        console.log('🔴 Placeholder removed');
    } else {
        console.log('🔴 No placeholder, just cleaning up');
        // Cleanup even if no placeholder
        touchDragBlock.forEach(el => {
            el.style.position = '';
            el.style.left = '';
            el.style.top = '';
            el.style.width = '';
            el.style.zIndex = '';
            el.style.pointerEvents = '';
            el.classList.remove('dragging');
            delete el.dataset.originalTop;
            delete el.dataset.originalLeft;
            delete el.dataset.originalWidth;
        });
    }

    console.log('🔴 Committing order to server');
    await commitOrderFromDOM();
    touchDragBlock = [];
    touchDragStartY = 0;
    touchDragCurrentY = 0;
    console.log('🔴 ===== DRAG COMPLETE =====');
}
// --- Phase Visibility ---

function getPhaseVisibilityKey() {
    if (typeof CURRENT_LIST_ID === 'undefined') return null;
    return `phase-visibility-${CURRENT_LIST_ID}`;
}

function hasDoneTasksInPhase(phaseId) {
    const phaseEl = document.querySelector(`.task-item.phase[data-phase-id='${phaseId}']`);
    if (!phaseEl) return false;
    const phaseIdStr = String(phaseId);
    const direct = Array.from(document.querySelectorAll(`.task-item[data-phase-parent='${phaseIdStr}']`))
        .filter(el => !el.classList.contains('phase') && el.dataset.status === 'done');
    if (direct.length) return true;

    // Fallback scan for under-phase tasks without explicit parent
    let sibling = phaseEl.nextElementSibling;
    while (sibling && !sibling.classList.contains('phase')) {
        if (!sibling.classList.contains('task-item')) {
            sibling = sibling.nextElementSibling;
            continue;
        }
        const parentAttr = sibling.getAttribute('data-phase-parent') || '';
        const isUnderPhase = sibling.classList.contains('under-phase');

        if (parentAttr) {
            if (parentAttr !== phaseIdStr) break;
        } else if (!isUnderPhase) {
            break;
        }

        if (!sibling.classList.contains('phase') && sibling.dataset.status === 'done') return true;
        sibling = sibling.nextElementSibling;
    }
    return false;
}

function normalizePhaseMode(mode) {
    if (mode === true || mode === 'collapsed') return 'collapsed';
    if (mode === 'hide_done') return 'collapsed'; // treat legacy hide_done as collapsed
    return 'expanded';
}

function applyPhaseVisibility(phaseId, modeInput) {
    const phaseEl = document.querySelector(`.task-item.phase[data-phase-id='${phaseId}']`);
    if (!phaseEl) return;
    const requestedMode = normalizePhaseMode(modeInput || phaseEl.dataset.phaseMode);
    const mode = requestedMode === 'hide_done' && !hasDoneTasksInPhase(phaseId) ? 'collapsed' : requestedMode;
    phaseEl.dataset.phaseMode = mode;

    const collapsed = mode === 'collapsed';
    const hideDoneOnly = mode === 'hide_done';
    phaseEl.classList.toggle('phase-collapsed', collapsed);

    const icon = phaseEl.querySelector('.phase-toggle i');
    if (icon) {
        if (collapsed) icon.className = 'fa-solid fa-chevron-down';
        else if (hideDoneOnly) icon.className = 'fa-solid fa-minus';
        else icon.className = 'fa-solid fa-chevron-up';
    }

    const phaseIdStr = String(phaseId);
    const hideAll = collapsed;
    const hideDone = hideDoneOnly && currentTaskFilter !== 'done';
    const doneBar = document.querySelector(`.phase-done-bar[data-phase-id='${phaseIdStr}']`);
    const doneContainer = document.querySelector(`.phase-done-container[data-phase-id='${phaseIdStr}']`);
    if (doneBar) doneBar.classList.toggle('hidden-by-phase', hideAll);
    if (doneContainer) {
        doneContainer.classList.toggle('hidden-by-phase', hideAll);
        // Respect the phase "hide done" mode in addition to the explicit toggle state
        if (hideDone) doneContainer.classList.add('collapsed-by-phase');
        else doneContainer.classList.remove('collapsed-by-phase');
    }

    function toggleTaskVisibility(el) {
        const isDone = el.dataset.status === 'done';
        const hideTask = hideAll || (hideDone && isDone);
        el.classList.toggle('hidden-by-phase', hideAll);
        el.classList.toggle('hidden-by-done', hideDone && isDone);
        if (!hideAll) el.classList.remove('hidden-by-phase');
        if (!hideDone || !isDone) el.classList.remove('hidden-by-done');
    }

    // Hide/show tasks explicitly assigned to this phase by data-phase-parent
    // No positional fallback needed - phase_id is managed by backend
    document.querySelectorAll(`.task-item[data-phase-parent='${phaseIdStr}']`).forEach(el => {
        toggleTaskVisibility(el);
    });

    return mode;
}

function normalizePhaseParents() {
    // This function is now a no-op since phase_id is managed by the backend
    // and the template renders data-phase-parent from the database.
    // The reorder endpoint automatically updates phase_id based on position.
    // Keeping this function for backwards compatibility but it does nothing.
}

function organizePhaseDoneTasks() {
    const container = document.getElementById('items-container');
    if (!container) return;

    // Unwrap any previous containers to avoid duplicating bars
    document.querySelectorAll('.phase-done-container').forEach(box => {
        while (box.firstChild) {
            container.insertBefore(box.firstChild, box);
        }
        box.remove();
    });
    document.querySelectorAll('.phase-done-bar').forEach(bar => bar.remove());

    const phases = Array.from(container.querySelectorAll('.task-item.phase'));
    phases.forEach(phaseEl => {
        const phaseIdStr = String(phaseEl.dataset.phaseId || '');
        if (!phaseIdStr) return;

        const doneTasks = [];
        let cursor = phaseEl.nextElementSibling;
        while (cursor && !cursor.classList.contains('phase')) {
            if (cursor.classList.contains('task-item')) {
                const belongs = cursor.dataset.phaseParent === phaseIdStr
                    || (!cursor.dataset.phaseParent && cursor.classList.contains('under-phase'));
                if (belongs && cursor.dataset.status === 'done') {
                    doneTasks.push(cursor);
                }
            }
            cursor = cursor.nextElementSibling;
        }

        if (!doneTasks.length) return;

        const anchor = cursor || null; // Insert before the next phase (or end)

        const bar = document.createElement('div');
        bar.className = 'phase-done-bar';
        bar.setAttribute('data-phase-id', phaseIdStr);

        const label = document.createElement('span');
        label.className = 'phase-done-label';
        label.textContent = `${doneTasks.length} done task${doneTasks.length === 1 ? '' : 's'}`;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary btn-small phase-done-toggle';

        const doneBox = document.createElement('div');
        doneBox.className = 'phase-done-container collapsed';
        doneBox.setAttribute('data-phase-id', phaseIdStr);

        const startOpen = currentTaskFilter === 'done';
        if (startOpen) doneBox.classList.remove('collapsed');
        btn.textContent = startOpen ? 'Hide' : 'Show';

        btn.addEventListener('click', () => {
            const isCollapsed = doneBox.classList.toggle('collapsed');
            btn.textContent = isCollapsed ? 'Show' : 'Hide';
        });

        doneTasks.forEach(task => doneBox.appendChild(task));

        bar.appendChild(label);
        bar.appendChild(btn);
        container.insertBefore(bar, anchor);
        container.insertBefore(doneBox, anchor);
    });
}

function persistPhaseVisibility(phaseId, collapsed) {
    const key = getPhaseVisibilityKey();
    if (!key) return;
    let state = {};
    try {
        state = JSON.parse(localStorage.getItem(key)) || {};
    } catch (e) {
        state = {};
    }
    state[phaseId] = normalizePhaseMode(collapsed);
    localStorage.setItem(key, JSON.stringify(state));
}

function togglePhaseVisibility(phaseId) {
    const phaseEl = document.querySelector(`.task-item.phase[data-phase-id='${phaseId}']`);
    if (!phaseEl) return;
    const current = normalizePhaseMode(phaseEl.dataset.phaseMode);
    const next = current === 'collapsed' ? 'expanded' : 'collapsed';
    const applied = applyPhaseVisibility(phaseId, next);
    persistPhaseVisibility(phaseId, applied);
}

function restorePhaseVisibility() {
    const key = getPhaseVisibilityKey();
    if (!key) return;
    let state = {};
    try {
        state = JSON.parse(localStorage.getItem(key)) || {};
    } catch (e) {
        state = {};
    }
    Object.entries(state).forEach(([phaseId, mode]) => {
        applyPhaseVisibility(phaseId, mode);
    });
}

// --- Notes Functions ---

function initNotesPage() {
    const editor = document.getElementById('note-editor');
    const listEl = document.getElementById('notes-list');
    const titleInput = document.getElementById('note-title');
    if (!editor || !listEl || !titleInput) return; // Not on notes page

    const params = new URLSearchParams(window.location.search);
    const targetNoteId = parseInt(params.get('note'), 10) || parseInt(params.get('note_id'), 10) || null;

    const saveBtn = document.getElementById('note-save-btn');
    const newBtn = document.getElementById('note-new-btn');
    const deleteBtn = document.getElementById('note-delete-btn');
    const refreshBtn = document.getElementById('note-refresh-btn');
    const shareBtn = document.getElementById('note-share-btn');

    if (saveBtn) saveBtn.addEventListener('click', () => saveCurrentNote());
    if (newBtn) newBtn.addEventListener('click', () => createNote());
    if (deleteBtn) deleteBtn.addEventListener('click', () => deleteCurrentNote());
    if (refreshBtn) refreshBtn.addEventListener('click', () => loadNotes({ keepSelection: true }));
    if (shareBtn) shareBtn.addEventListener('click', () => openShareNoteModal());

    editor.addEventListener('input', () => {
        refreshNoteDirtyState();
        autoGenerateTitle();
    });
    titleInput.addEventListener('input', refreshNoteDirtyState);

    // Add keydown listener for checkbox auto-continuation
    editor.addEventListener('keydown', handleNoteEditorKeydown);

    // Add selection change listener to update toolbar states
    document.addEventListener('selectionchange', () => {
        const activeEl = document.activeElement;
        if (activeEl === editor) {
            updateNoteToolbarStates();
        }
    });

    bindNoteToolbar();
    loadNotes({ keepSelection: false, targetNoteId });
}

function initNotificationsUI() {
    const bell = document.getElementById('notif-launcher');
    const closeBtn = document.getElementById('notif-close-btn');
    const markBtn = document.getElementById('notif-mark-read');
    if (bell) bell.addEventListener('click', () => toggleNotificationsPanel());
    if (closeBtn) closeBtn.addEventListener('click', () => toggleNotificationsPanel(false));
    if (markBtn) markBtn.addEventListener('click', () => markAllNotificationsRead());
}

function bindNoteToolbar() {
    const toolbar = document.getElementById('note-toolbar');
    if (!toolbar) return;
    toolbar.querySelectorAll('.note-tool[data-command]').forEach(btn => {
        // Keep selection in the editor when clicking toolbar buttons
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            applyNoteCommand(btn.dataset.command);
        });
    });

    const fontSizeSelect = document.getElementById('note-font-size');
    if (fontSizeSelect) {
        fontSizeSelect.addEventListener('change', (e) => {
            const size = parseInt(e.target.value, 10);
            if (size) {
                applyNoteFontSize(size);
            }
        });
    }
}

function applyNoteCommand(command) {
    const editor = document.getElementById('note-editor');
    if (!editor) return;
    editor.focus();

    if (command === 'checkbox') {
        // Toggle checkbox mode
        notesState.checkboxMode = !notesState.checkboxMode;
        updateNoteToolbarStates();

        // If turning on checkbox mode, insert a checkbox at current position
        if (notesState.checkboxMode) {
            insertCheckbox();
        }
        setNoteDirty(true);
        return;
    }
    if (command === 'quote') {
        if (toggleBlockquote()) return;
        document.execCommand('formatBlock', false, 'blockquote');
        setNoteDirty(true);
        updateNoteToolbarStates();
        return;
    }
    if (command === 'code') {
        if (toggleInlineCode()) return;
        const selection = window.getSelection ? window.getSelection().toString() : '';
        const html = selection ? `<code>${selection}</code>` : '<code></code>';
        document.execCommand('insertHTML', false, html);
        setNoteDirty(true);
        updateNoteToolbarStates();
        return;
    }

    document.execCommand(command, false, null);
    refreshNoteDirtyState();
    // Update toolbar states after a short delay to let the DOM update
    setTimeout(() => updateNoteToolbarStates(), 10);
}

function applyNoteFontSize(sizePx) {
    const editor = document.getElementById('note-editor');
    if (!editor) return;
    editor.focus();

    // Wrap selection using execCommand, then replace with a span that uses pixel sizing
    document.execCommand('fontSize', false, '7');
    const fonts = editor.querySelectorAll('font[size="7"]');
    fonts.forEach(font => {
        const span = document.createElement('span');
        span.style.fontSize = `${sizePx}px`;
        while (font.firstChild) {
            span.appendChild(font.firstChild);
        }
        font.replaceWith(span);
    });
    setNoteDirty(true);
}

function unwrapTag(tagName) {
    const sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0) return false;
    let node = sel.focusNode;
    let el = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
    while (el && el !== document.body && el.tagName !== tagName) {
        el = el.parentElement;
    }
    if (!el || el.tagName !== tagName) return false;

    const textNode = document.createTextNode(el.textContent || '');
    el.replaceWith(textNode);

    // Restore caret at end of unwrapped content
    const range = document.createRange();
    range.setStart(textNode, textNode.length);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
}

function findAncestor(el, tagName) {
    let node = el;
    while (node && node !== document.body) {
        if (node.tagName === tagName) return node;
        node = node.parentElement;
    }
    return null;
}

function toggleBlockquote() {
    const sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    const el = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const blockquote = findAncestor(el, 'BLOCKQUOTE');
    if (!blockquote) return false;

    const frag = document.createDocumentFragment();
    while (blockquote.firstChild) {
        frag.appendChild(blockquote.firstChild);
    }
    blockquote.replaceWith(frag);

    const endNode = frag.lastChild || frag.firstChild;
    if (endNode) {
        const newRange = document.createRange();
        if (endNode.nodeType === 3) {
            newRange.setStart(endNode, endNode.length);
        } else {
            newRange.setStartAfter(endNode);
        }
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
    }
    setNoteDirty(true);
    return true;
}

function toggleInlineCode() {
    const sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0) return false;
    const node = sel.focusNode;
    const codeEl = node ? findAncestor(node.nodeType === 1 ? node : node.parentElement, 'CODE') : null;
    if (!codeEl) return false;

    const textNode = document.createTextNode(codeEl.textContent || '');
    codeEl.replaceWith(textNode);

    const range = document.createRange();
    range.setStart(textNode, textNode.length);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    setNoteDirty(true);
    return true;
}

function insertCheckbox() {
    document.execCommand('insertHTML', false, '<label class="note-inline-checkbox"><input type="checkbox"> </label>');

    // Bind the newly inserted checkbox
    setTimeout(() => {
        const editor = document.getElementById('note-editor');
        if (editor) {
            bindNoteCheckboxes();
        }
    }, 0);
}

function bindNoteCheckboxes() {
    const editor = document.getElementById('note-editor');
    if (!editor) return;

    const checkboxes = editor.querySelectorAll('.note-inline-checkbox input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        // Remove existing listener to avoid duplicates
        checkbox.removeEventListener('change', handleCheckboxChange);
        // Add the event listener
        checkbox.addEventListener('change', handleCheckboxChange);

        // Apply initial state
        const label = checkbox.closest('.note-inline-checkbox');
        if (label) {
            if (checkbox.checked) {
                label.style.textDecoration = 'line-through';
                label.style.opacity = '0.6';
            } else {
                label.style.textDecoration = 'none';
                label.style.opacity = '1';
            }
        }
    });
}

function handleCheckboxChange(e) {
    const checkbox = e.target;
    const label = checkbox.closest('.note-inline-checkbox');

    if (label) {
        if (checkbox.checked) {
            label.style.textDecoration = 'line-through';
            label.style.opacity = '0.6';
        } else {
            label.style.textDecoration = 'none';
            label.style.opacity = '1';
        }
    }

    setNoteDirty(true);
}

function updateNoteToolbarStates() {
    const toolbar = document.getElementById('note-toolbar');
    if (!toolbar) return;

    // Update checkbox button state
    const checkboxBtn = toolbar.querySelector('[data-command="checkbox"]');
    if (checkboxBtn) {
        if (notesState.checkboxMode) {
            checkboxBtn.classList.add('active');
        } else {
            checkboxBtn.classList.remove('active');
        }
    }

    // Update other formatting buttons based on current selection
    const commands = ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'];
    commands.forEach(cmd => {
        const btn = toolbar.querySelector(`[data-command="${cmd}"]`);
        if (btn) {
            try {
                const isActive = document.queryCommandState(cmd);
                if (isActive) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            } catch (e) {
                // Some commands might not be supported
                btn.classList.remove('active');
            }
        }
    });

    // Check for code and quote formatting
    const sel = window.getSelection ? window.getSelection() : null;
    if (sel && sel.rangeCount > 0) {
        const node = sel.focusNode;
        const el = node && (node.nodeType === 1 ? node : node.parentElement);

        const codeBtn = toolbar.querySelector('[data-command="code"]');
        if (codeBtn) {
            const inCode = el && findAncestor(el, 'CODE');
            if (inCode) {
                codeBtn.classList.add('active');
            } else {
                codeBtn.classList.remove('active');
            }
        }

        const quoteBtn = toolbar.querySelector('[data-command="quote"]');
        if (quoteBtn) {
            const inQuote = el && findAncestor(el, 'BLOCKQUOTE');
            if (inQuote) {
                quoteBtn.classList.add('active');
            } else {
                quoteBtn.classList.remove('active');
            }
        }
    }
}

function handleNoteEditorKeydown(e) {
    const editor = document.getElementById('note-editor');
    if (!editor || e.key !== 'Enter') return;

    // Handle checkbox mode
    if (notesState.checkboxMode) {
        const sel = window.getSelection ? window.getSelection() : null;
        if (!sel || sel.rangeCount === 0) return;

        // Check if we're on an empty line with just a checkbox
        const range = sel.getRangeAt(0);
        const container = range.startContainer;
        const parentEl = container.nodeType === 1 ? container : container.parentElement;

        // Find the current line/label
        let label = parentEl;
        while (label && label !== editor && label.tagName !== 'LABEL') {
            label = label.parentElement;
        }

        if (label && label.classList.contains('note-inline-checkbox')) {
            // Check if the label only contains the checkbox and whitespace
            const textContent = label.textContent || '';
            if (textContent.trim() === '') {
                // Empty checkbox line - exit checkbox mode
                e.preventDefault();
                notesState.checkboxMode = false;
                updateNoteToolbarStates();

                // Remove the empty checkbox and insert a new line
                label.remove();
                document.execCommand('insertParagraph', false, null);
                return;
            }
        }

        // Not an empty line, insert new checkbox on next line
        e.preventDefault();
        document.execCommand('insertParagraph', false, null);
        insertCheckbox();
        setNoteDirty(true);
    }
}

function setNoteDirty(dirty) {
    notesState.dirty = dirty;
    const saveBtn = document.getElementById('note-save-btn');
    if (saveBtn) {
        saveBtn.disabled = !dirty;
    }
    if (!dirty) {
        if (noteAutoSaveTimer) {
            clearTimeout(noteAutoSaveTimer);
            noteAutoSaveTimer = null;
        }
        return;
    }
    scheduleNoteAutosave();
}

function refreshNoteDirtyState() {
    const editor = document.getElementById('note-editor');
    const titleInput = document.getElementById('note-title');
    const snapshot = notesState.activeSnapshot || { title: '', content: '' };
    const currentTitle = titleInput ? (titleInput.value || '').trim() : '';
    const currentContent = editor ? (editor.innerHTML || '').trim() : '';
    const dirty = currentTitle !== (snapshot.title || '') || currentContent !== (snapshot.content || '');
    setNoteDirty(dirty);
}

async function loadNotes(options = {}) {
    const { keepSelection = false, targetNoteId = null } = options;
    const listEl = document.getElementById('notes-list');
    if (!listEl) return;
    try {
        const res = await fetch('/api/notes');
        if (!res.ok) throw new Error('Failed to load notes');
        const notes = await res.json();
        notesState.notes = notes;
        renderNotesList();

        if (targetNoteId) {
            const target = notes.find(n => n.id === targetNoteId);
            if (target) {
                await setActiveNote(target.id, { skipAutosave: true });
                scrollNotesEditorIntoView();
                return;
            }
        }

        if (keepSelection && notesState.activeNoteId) {
            const nextNote = notes.find(n => n.id === notesState.activeNoteId);
            if (nextNote) {
                await setActiveNote(nextNote.id, { skipAutosave: true });
            } else {
                clearNoteEditor();
            }
        } else {
            clearNoteEditor();
        }
    } catch (err) {
        console.error('Error loading notes:', err);
    }
}

function renderNotesList() {
    const listPinned = document.getElementById('notes-list-pinned');
    const listAll = document.getElementById('notes-list');
    if (!listPinned || !listAll) return;

    const pinnedNotes = notesState.notes.filter(n => n.pinned);
    const regularNotes = notesState.notes.filter(n => !n.pinned);

    if (listPinned) {
        listPinned.innerHTML = '';
        if (!pinnedNotes.length) {
            listPinned.innerHTML = `<div class="empty-state"><p style="color: var(--text-muted); margin: 0;">No pinned notes.</p></div>`;
        } else {
            pinnedNotes.forEach(note => {
                const btn = document.createElement('button');
                const isSelected = selectedNotes.has(note.id);
                btn.className = `notes-list-item draggable ${note.id === notesState.activeNoteId ? 'active' : ''} ${isSelected ? 'selected' : ''}`;
                btn.draggable = true;
                btn.dataset.noteId = note.id;

                let displayTitle = note.title;
                if (!displayTitle || displayTitle === 'Untitled Note' || displayTitle === 'Untitled note') {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = note.content || '';
                    const plainText = tempDiv.textContent || tempDiv.innerText || '';
                    if (plainText.trim()) {
                        const firstLine = plainText.split('\n')[0].trim();
                        displayTitle = firstLine.substring(0, 35).trim();
                        if (firstLine.length > 35 || plainText.split('\n').length > 1) {
                            displayTitle += '...';
                        }
                    } else {
                        displayTitle = 'Untitled';
                    }
                }

                btn.innerHTML = `
                    <div class="note-select-indicator"><i class="fa-solid fa-check"></i></div>
                    <div class="note-title-row">
                        <div class="note-title">${displayTitle}</div>
                        <div class="note-actions">
                            <button class="btn-icon pin-btn active" title="Unpin">
                                <i class="fa-solid fa-thumbtack"></i>
                            </button>
                        </div>
                    </div>
                    <div class="note-updated">${formatNoteDate(note.updated_at)}</div>
                `;
                btn.addEventListener('click', async (e) => {
                    // avoid conflict with dragging
                    if (btn.classList.contains('dragging')) return;

                    // Handle selection mode
                    if (shouldIgnoreNoteSelection(e.target)) {
                        return;
                    }

                    // Toggle selection if in selection mode or shift/ctrl key pressed
                    if (selectedNotes.size > 0 || e.shiftKey || e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        const nowSelected = !selectedNotes.has(note.id);
                        setNoteSelected(note.id, nowSelected);
                        updateNotesBulkBar();
                    } else {
                        await setActiveNote(note.id);
                        scrollNotesEditorIntoView();
                    }
                });
                const pinBtn = btn.querySelector('.pin-btn');
                if (pinBtn) {
                    pinBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await toggleNotePin(note.id, false);
                    });
                }

                btn.addEventListener('dragstart', (e) => {
                    btn.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', note.id);
                    // Mark current drag index
                    btn.dataset.dragIndex = Array.from(listPinned.children).indexOf(btn);
                });
                btn.addEventListener('dragend', async (e) => {
                    btn.classList.remove('dragging');
                    await reorderPinnedFromDOM();
                });
                btn.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    const dragging = listPinned.querySelector('.dragging');
                    if (!dragging || dragging === btn) return;
                    const afterElement = getPinnedNoteDragAfterElement(listPinned, e.clientY);
                    if (afterElement == null) {
                        listPinned.appendChild(dragging);
                    } else {
                        listPinned.insertBefore(dragging, afterElement);
                    }
                });
                listPinned.appendChild(btn);
            });
        }
    }

    listAll.innerHTML = '';
    if (!regularNotes.length) {
        listAll.innerHTML = `<div class="empty-state">
            <p style="color: var(--text-muted); margin: 0;">No notes yet. Create one to get started.</p>
        </div>`;
    } else {
        regularNotes.forEach(note => {
        const btn = document.createElement('button');
        const isSelected = selectedNotes.has(note.id);
        btn.className = `notes-list-item ${note.id === notesState.activeNoteId ? 'active' : ''} ${isSelected ? 'selected' : ''}`;
        btn.dataset.noteId = note.id;

        // Use auto-generated title if note title is default
        let displayTitle = note.title;
        if (!displayTitle || displayTitle === 'Untitled Note' || displayTitle === 'Untitled note') {
            // Extract first line from content
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = note.content || '';
            const plainText = tempDiv.textContent || tempDiv.innerText || '';
            if (plainText.trim()) {
                const firstLine = plainText.split('\n')[0].trim();
                displayTitle = firstLine.substring(0, 35).trim();
                if (firstLine.length > 35 || plainText.split('\n').length > 1) {
                    displayTitle += '...';
                }
            } else {
                displayTitle = 'Untitled';
            }
        }

        btn.innerHTML = `
            <div class="note-select-indicator"><i class="fa-solid fa-check"></i></div>
            <div class="note-title-row">
                <div class="note-title">${displayTitle}</div>
                <div class="note-actions">
                    <button class="btn-icon pin-btn ${note.pinned ? 'active' : ''}" title="${note.pinned ? 'Unpin' : 'Pin'}">
                        <i class="fa-solid fa-thumbtack"></i>
                    </button>
                </div>
            </div>
            <div class="note-updated">${formatNoteDate(note.updated_at)}</div>
        `;
        btn.addEventListener('click', async (e) => {
            // Handle selection mode
            if (shouldIgnoreNoteSelection(e.target)) {
                return;
            }

            // Toggle selection if in selection mode or shift/ctrl key pressed
            if (selectedNotes.size > 0 || e.shiftKey || e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const nowSelected = !selectedNotes.has(note.id);
                setNoteSelected(note.id, nowSelected);
                updateNotesBulkBar();
            } else {
                await setActiveNote(note.id);
                scrollNotesEditorIntoView();
            }
        });

        const pinBtn = btn.querySelector('.pin-btn');
        if (pinBtn) {
            pinBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await toggleNotePin(note.id, !note.pinned);
            });
        }

        listAll.appendChild(btn);
        });
    }
}

function formatNoteDate(dateStr) {
    if (!dateStr) return 'New note';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', { timeZone: USER_TIMEZONE });
}

async function setActiveNote(noteId, options = {}) {
    const editor = document.getElementById('note-editor');
    const titleInput = document.getElementById('note-title');
    const updatedLabel = document.getElementById('note-updated-label');
    if (!editor || !titleInput || !updatedLabel) return;

    if (notesState.dirty && notesState.activeNoteId === noteId && options.skipAutosave) {
        renderNotesList();
        return; // Keep unsaved content intact
    }

    if (notesState.dirty && notesState.activeNoteId && notesState.activeNoteId !== noteId && !options.skipAutosave) {
        await saveCurrentNote({ silent: true });
    }

    const note = notesState.notes.find(n => n.id === noteId);
    if (!note) return;

    notesState.activeNoteId = noteId;
    titleInput.value = note.title || '';
    titleInput.placeholder = 'Untitled note';
    editor.innerHTML = note.content || '';
    updatedLabel.textContent = `Updated ${formatNoteDate(note.updated_at)}`;
    notesState.activeSnapshot = {
        title: (note.title || '').trim(),
        content: (note.content || '').trim()
    };
    notesState.checkboxMode = false; // Reset checkbox mode when switching notes
    setNoteDirty(false);
    renderNotesList();
    updateNoteToolbarStates(); // Update toolbar button states
    bindNoteCheckboxes(); // Bind checkbox event handlers
}

async function toggleNotePin(noteId, pinned) {
    const note = notesState.notes.find(n => n.id === noteId);
    const fallbackTitle = note ? deriveNoteAutoTitleFromHtml(note.content || '') : 'Untitled';
    try {
        const res = await fetch(`/api/notes/${noteId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pinned, title: (note && note.title) ? note.title : fallbackTitle })
        });
        if (!res.ok) throw new Error('Failed to update pin');
        await loadNotes({ keepSelection: true });
    } catch (err) {
        console.error('Pin toggle failed', err);
    }
}

async function movePinnedNote(noteId, direction) {
    // Drag-based reordering supersedes arrow controls; keep function to avoid breaks if called elsewhere
    return;
}

function getPinnedNoteDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.draggable:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

async function saveCurrentNote(options = {}) {
    const { silent = false, keepOpen = false } = options;
    const editor = document.getElementById('note-editor');
    const titleInput = document.getElementById('note-title');
    const updatedLabel = document.getElementById('note-updated-label');
    if (!editor || !titleInput) return;
    const noteId = notesState.activeNoteId;
    if (!notesState.dirty && noteId) {
        // No changes: still clear and reset without touching the timestamp
        if (!keepOpen) {
            clearNoteEditor();
            renderNotesList();
        }
        return;
    }

    // Use auto-generated title if no explicit title is set
    let title = titleInput.value.trim();
    if (!title || title === 'Untitled note') {
        title = titleInput.placeholder || 'Untitled Note';
    }

    const payload = {
        title: title,
        content: editor.innerHTML.trim()
    };

    try {
        let res;
        let savedNote;
        if (!noteId) {
            res = await fetch('/api/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('Create failed');
            savedNote = await res.json();
            notesState.notes = [savedNote, ...notesState.notes];
            notesState.activeNoteId = savedNote.id;
        } else {
            res = await fetch(`/api/notes/${noteId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('Save failed');
            savedNote = await res.json();
            notesState.notes = notesState.notes.map(n => n.id === savedNote.id ? savedNote : n);
        }

        if (updatedLabel) updatedLabel.textContent = `Saved ${formatNoteDate(savedNote.updated_at)}`;
        setNoteDirty(false);
        renderNotesList();

        if (keepOpen) {
            notesState.activeNoteId = savedNote.id;
            notesState.activeSnapshot = {
                title: payload.title,
                content: payload.content
            };
            return;
        }

        // Always clear and reset after any save (new or existing) unless kept open
        clearNoteEditor();
        notesState.activeNoteId = null;
        notesState.activeSnapshot = null;
    } catch (err) {
        console.error('Error saving note:', err);
    }
}

async function createNote() {
    try {
        const res = await fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Untitled Note', content: '' })
        });
        if (!res.ok) throw new Error('Create failed');
        const newNote = await res.json();
        notesState.activeNoteId = newNote.id;
        notesState.notes = [newNote, ...notesState.notes];
        renderNotesList();
        setActiveNote(newNote.id, { skipAutosave: true });
        const titleInput = document.getElementById('note-title');
        if (titleInput) {
            titleInput.placeholder = 'Untitled note';
            titleInput.focus();
        }
    } catch (err) {
        console.error('Error creating note:', err);
    }
}

async function deleteCurrentNote() {
    const noteId = notesState.activeNoteId;
    if (!noteId) return;
    openConfirmModal('Delete this note?', async () => {
        try {
            const res = await fetch(`/api/notes/${noteId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            notesState.notes = notesState.notes.filter(n => n.id !== noteId);
            notesState.activeNoteId = null;
            renderNotesList();
            clearNoteEditor();
        } catch (err) {
            console.error('Error deleting note:', err);
        }
    });
}

function clearNoteEditor() {
    const editor = document.getElementById('note-editor');
    const titleInput = document.getElementById('note-title');
    const updatedLabel = document.getElementById('note-updated-label');
    if (editor) editor.innerHTML = '';
    if (titleInput) titleInput.value = '';
    if (titleInput) titleInput.placeholder = 'Untitled note';
    if (updatedLabel) updatedLabel.textContent = 'No note selected';
    notesState.activeNoteId = null;
    notesState.activeSnapshot = null;
    notesState.checkboxMode = false; // Reset checkbox mode
    setNoteDirty(false);
    updateNoteToolbarStates(); // Update toolbar button states
}

function autoGenerateTitle() {
    const titleInput = document.getElementById('note-title');
    const editor = document.getElementById('note-editor');

    if (!titleInput || !editor) return;

    // Only auto-generate if title is empty or default "Untitled note"
    const currentTitle = titleInput.value.trim();
    if (currentTitle && currentTitle !== 'Untitled note') return;

    // Get plain text with preserved newlines
    const rawText = (editor.innerText || editor.textContent || '').replace(/\u00a0/g, ' ');
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    if (!lines.length) {
        titleInput.placeholder = 'Untitled note';
        return;
    }

    const firstLine = lines[0];
    const words = firstLine.split(/\s+/).filter(Boolean);
    let autoTitle;

    if (words.length <= 5) {
        autoTitle = firstLine; // use full first line when short
    } else {
        autoTitle = words.slice(0, 3).join(' ') + '...';
    }

    titleInput.placeholder = autoTitle;
}

function deriveNoteAutoTitleFromHtml(html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html || '';
    const rawText = (tempDiv.innerText || tempDiv.textContent || '').replace(/\u00a0/g, ' ');
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return 'Untitled';
    const firstLine = lines[0];
    const words = firstLine.split(/\s+/).filter(Boolean);
    if (words.length <= 5) return firstLine;
    return words.slice(0, 3).join(' ') + '...';
}

// Share Note Functions
async function openShareNoteModal() {
    const noteId = notesState.activeNoteId;
    if (!noteId) {
        alert('Please select a note to share');
        return;
    }

    const note = notesState.notes.find(n => n.id === noteId);
    if (!note) return;

    // Try to use native Web Share API first (works like Google/real apps)
    if (navigator.share) {
        console.log('Web Share API is available, attempting to share...');
        try {
            // Convert HTML content to plain text for sharing
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = note.content || '';
            const plainText = tempDiv.textContent || tempDiv.innerText || '';

            await navigator.share({
                title: note.title || 'Untitled Note',
                text: plainText
            });
            console.log('Share successful!');
            return; // Successfully shared, exit
        } catch (err) {
            // User cancelled or share failed, show modal as fallback
            console.log('Share error:', err.name, err.message);
            if (err.name !== 'AbortError') {
                console.log('Share failed, showing modal as fallback');
            } else {
                console.log('User cancelled share');
                return; // User cancelled, don't show modal
            }
        }
    } else {
        console.log('Web Share API not available - Protocol:', window.location.protocol, 'Host:', window.location.host);
    }

    // Fallback: Show modal with share options
    const modal = document.getElementById('share-note-modal');
    if (!modal) return;

    modal.classList.add('active');
    setupShareModalControls();

    // Check if note is already shared
    if (note.is_public && note.share_token) {
        showShareLink(note.share_token);
    } else {
        hideShareLink();
    }
}

function setupShareModalControls() {
    const modal = document.getElementById('share-note-modal');
    const closeBtn = document.getElementById('share-note-close-btn');
    const generateBtn = document.getElementById('share-note-generate-btn');
    const copyBtn = document.getElementById('share-note-copy-btn');
    const revokeBtn = document.getElementById('share-note-revoke-btn');
    const copyContentBtn = document.getElementById('share-note-content-btn');
    const emailBtn = document.getElementById('share-note-email-btn');

    // Close modal
    const closeModal = () => modal.classList.remove('active');

    if (closeBtn) {
        closeBtn.onclick = closeModal;
    }

    // Click outside to close
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };

    // Copy note content to clipboard
    if (copyContentBtn) {
        copyContentBtn.onclick = async () => {
            const note = notesState.notes.find(n => n.id === notesState.activeNoteId);
            if (!note) return;

            // Convert HTML to plain text
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = note.content || '';
            const plainText = tempDiv.textContent || tempDiv.innerText || '';

            const textToCopy = `${note.title || 'Untitled Note'}\n\n${plainText}`;

            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(textToCopy);
                } else {
                    // Fallback for older browsers
                    const textarea = document.createElement('textarea');
                    textarea.value = textToCopy;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                }

                // Visual feedback
                const originalText = copyContentBtn.innerHTML;
                copyContentBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
                setTimeout(() => {
                    copyContentBtn.innerHTML = originalText;
                }, 2000);
            } catch (err) {
                console.error('Failed to copy:', err);
                alert('Failed to copy to clipboard');
            }
        };
    }

    // Share via email
    if (emailBtn) {
        emailBtn.onclick = () => {
            const note = notesState.notes.find(n => n.id === notesState.activeNoteId);
            if (!note) return;

            // Convert HTML to plain text
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = note.content || '';
            const plainText = tempDiv.textContent || tempDiv.innerText || '';

            const subject = encodeURIComponent(note.title || 'Untitled Note');
            const body = encodeURIComponent(plainText);
            window.location.href = `mailto:?subject=${subject}&body=${body}`;
        };
    }

    // Generate share link
    if (generateBtn) {
        generateBtn.onclick = async () => {
            await generateShareLink();
        };
    }

    // Copy link to clipboard
    if (copyBtn) {
        copyBtn.onclick = () => {
            const urlInput = document.getElementById('share-note-url');
            if (urlInput) {
                urlInput.select();
                document.execCommand('copy');

                // Visual feedback
                const originalText = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
                setTimeout(() => {
                    copyBtn.innerHTML = originalText;
                }, 2000);
            }
        };
    }

    // Revoke share access
    if (revokeBtn) {
        revokeBtn.onclick = async () => {
            if (confirm('Are you sure you want to revoke access to this shared note?')) {
                await revokeShareLink();
            }
        };
    }
}

async function generateShareLink() {
    const noteId = notesState.activeNoteId;
    if (!noteId) return;

    try {
        const res = await fetch(`/api/notes/${noteId}/share`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!res.ok) throw new Error('Failed to generate share link');

        const data = await res.json();

        // Update local note data
        const note = notesState.notes.find(n => n.id === noteId);
        if (note) {
            note.share_token = data.share_token;
            note.is_public = data.is_public;
        }

        // Show the share link
        showShareLink(data.share_token);

    } catch (err) {
        console.error('Error generating share link:', err);
        alert('Failed to generate share link. Please try again.');
    }
}

async function revokeShareLink() {
    const noteId = notesState.activeNoteId;
    if (!noteId) return;

    try {
        const res = await fetch(`/api/notes/${noteId}/share`, {
            method: 'DELETE'
        });

        if (!res.ok) throw new Error('Failed to revoke share link');

        // Update local note data
        const note = notesState.notes.find(n => n.id === noteId);
        if (note) {
            note.share_token = null;
            note.is_public = false;
        }

        // Hide the share link section
        hideShareLink();

        // Show success message
        const statusDiv = document.getElementById('share-note-status');
        if (statusDiv) {
            statusDiv.innerHTML = '<p style="color: var(--accent-color); padding: 0.75rem; background: var(--accent-light); border-radius: 8px; margin-bottom: 1rem;"><i class="fa-solid fa-check"></i> Sharing has been revoked</p>';
            setTimeout(() => {
                statusDiv.innerHTML = '';
            }, 3000);
        }

    } catch (err) {
        console.error('Error revoking share link:', err);
        alert('Failed to revoke share link. Please try again.');
    }
}

function showShareLink(shareToken) {
    const linkSection = document.getElementById('share-note-link-section');
    const generateBtn = document.getElementById('share-note-generate-btn');
    const urlInput = document.getElementById('share-note-url');

    if (linkSection) linkSection.style.display = 'block';
    if (generateBtn) generateBtn.style.display = 'none';

    if (urlInput) {
        const shareUrl = `${window.location.origin}/shared/${shareToken}`;
        urlInput.value = shareUrl;
    }
}

function hideShareLink() {
    const linkSection = document.getElementById('share-note-link-section');
    const generateBtn = document.getElementById('share-note-generate-btn');

    if (linkSection) linkSection.style.display = 'none';
    if (generateBtn) generateBtn.style.display = 'inline-flex';
}

function scrollNotesEditorIntoView() {
    if (!window.matchMedia || !window.matchMedia('(max-width: 1024px)').matches) return;
    const editorCard = document.querySelector('.notes-editor.card');
    if (!editorCard) return;
    editorCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function scheduleNoteAutosave() {
    if (!notesState.activeNoteId) return;
    if (noteAutoSaveInFlight) return;
    if (noteAutoSaveTimer) {
        clearTimeout(noteAutoSaveTimer);
    }
    noteAutoSaveTimer = setTimeout(async () => {
        noteAutoSaveTimer = null;
        if (!notesState.dirty || !notesState.activeNoteId) return;
        if (noteAutoSaveInFlight) return;
        noteAutoSaveInFlight = true;
        try {
            await saveCurrentNote({ silent: true, keepOpen: true });
        } catch (e) {
            console.error('Auto-save failed', e);
        } finally {
            noteAutoSaveInFlight = false;
        }
    }, 1200);
}

// --- Hub Calculation ---
function calculateHubProgress() {
    // This is handled by the backend now and rendered in template/API
    // But we might want to update the UI if we didn't reload
    // For now, we rely on reload for simplicity in this version
}

// --- Calendar ---

function formatCalendarLabel(dayStr) {
    const d = new Date(dayStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: USER_TIMEZONE });
}

function formatMonthLabel(dateObj) {
    return dateObj.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: USER_TIMEZONE });
}

function getMonthRange(dateObj) {
    const start = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1);
    const end = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0);
    return {
        start,
        end,
        startStr: start.toISOString().slice(0, 10),
        endStr: end.toISOString().slice(0, 10)
    };
}

function setDayControlsEnabled(enabled) {
    const picker = document.getElementById('calendar-date-picker');
    const quickInput = document.getElementById('calendar-quick-input');
    const prevBtn = document.getElementById('calendar-prev-day');
    const nextBtn = document.getElementById('calendar-next-day');
    const todayBtn = document.getElementById('calendar-today-btn');
    if (picker) picker.disabled = !enabled;
    if (quickInput) {
        quickInput.disabled = !enabled;
        quickInput.placeholder = enabled
            ? "Type your task and press Enter. Use $ # > @ ! *"
            : 'Pick a day to open its schedule';
    }
    if (prevBtn) prevBtn.disabled = !enabled;
    if (nextBtn) nextBtn.disabled = !enabled;
    if (todayBtn) todayBtn.disabled = false; // keep Today usable as an entry point
}

function showDayView() {
    const view = document.getElementById('calendar-day-view');
    if (view) view.classList.remove('is-hidden');
    calendarState.dayViewOpen = true;
    setDayControlsEnabled(true);
}

function hideDayView() {
    const view = document.getElementById('calendar-day-view');
    if (view) view.classList.add('is-hidden');
    calendarState.dayViewOpen = false;
    calendarState.detailsOpen = false;
    setDayControlsEnabled(false);
    const label = document.getElementById('calendar-day-label');
    if (label) label.textContent = 'Pick a day';
}

function returnToMonthView() {
    const monthCard = document.getElementById('calendar-month-card');
    const quickAddPanel = document.getElementById('calendar-quick-add-panel');
    const dayView = document.getElementById('calendar-day-view');

    // Show month card
    if (monthCard) monthCard.classList.remove('is-hidden');

    // Hide quick-add panel
    if (quickAddPanel) quickAddPanel.classList.add('is-hidden');

    // Explicitly hide day view
    if (dayView) dayView.classList.add('is-hidden');

    // Reset calendar state
    calendarState.dayViewOpen = false;
    calendarState.detailsOpen = false;
    resetCalendarSelection();
    setDayControlsEnabled(false);

    // Re-render month view
    renderCalendarMonth();

    // Update URL to remove query parameters
    const url = new URL(window.location);
    url.search = '';
    window.history.pushState({}, '', url);
}

function refreshGroupOptionsFromState() {
    const select = document.getElementById('calendar-group-select');
    if (!select) return;
    const prev = select.value;
    select.innerHTML = '';
    const optNone = document.createElement('option');
    optNone.value = '';
    optNone.textContent = 'Ungrouped';
    select.appendChild(optNone);
    const groups = (calendarState.events || []).filter(ev => ev.is_group).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.title || `Group ${g.id}`;
        select.appendChild(opt);
    });
    if (groups.find(g => String(g.id) === prev)) {
        select.value = prev;
    } else {
        select.value = '';
    }
}

function openCalendarPrompt({ title = 'Input', message = '', defaultValue = '', type = 'text', onSubmit }) {
    const modal = document.getElementById('calendar-prompt-modal');
    const titleEl = document.getElementById('calendar-prompt-title');
    const msgEl = document.getElementById('calendar-prompt-message');
    const input = document.getElementById('calendar-prompt-input');
    const saveBtn = document.getElementById('calendar-prompt-save');
    const cancelBtn = document.getElementById('calendar-prompt-cancel');
    if (!modal || !titleEl || !msgEl || !input || !saveBtn || !cancelBtn) return;

    titleEl.textContent = title;
    msgEl.textContent = message;
    input.type = type;
    input.value = defaultValue || '';
    modal.classList.remove('is-hidden');
    input.focus();
    input.select();

    const close = () => {
        modal.classList.add('is-hidden');
        saveBtn.onclick = null;
        cancelBtn.onclick = null;
        input.onkeydown = null;
        modal.onclick = null;
    };

    saveBtn.onclick = () => {
        const val = input.value;
        close();
        if (typeof onSubmit === 'function') onSubmit(val);
    };
    cancelBtn.onclick = close;
    input.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveBtn.click();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    };
    modal.onclick = (e) => {
        if (e.target === modal) {
            close();
        }
    };
}

function openReminderEditor(ev) {
    openCalendarPrompt({
        title: 'Reminder',
        message: 'Minutes before start (leave blank to remove)',
        type: 'number',
        defaultValue: ev.reminder_minutes_before ?? '',
        onSubmit: async (val) => {
            if (val === '' || val === null || val === undefined) {
                await updateCalendarEvent(ev.id, { reminder_minutes_before: null });
                return;
            }
            const minutes = parseInt(val, 10);
            if (Number.isNaN(minutes) || minutes < 0) return;
            await updateCalendarEvent(ev.id, { reminder_minutes_before: minutes });
        }
    });
}

function openCalendarMovePrompt(ev) {
    const currentDay = ev.day || calendarState.selectedDay || '';
    openCalendarPrompt({
        title: 'Move to day',
        message: 'Pick a new date for this item',
        type: 'date',
        defaultValue: currentDay,
        onSubmit: async (val) => {
            if (!val) return;
            if (ev.is_task_link && ev.task_id) {
                await updateLinkedTaskDueDate(ev.task_id, val);
                await loadCalendarDay(calendarState.selectedDay);
                if (calendarState.monthCursor) await loadCalendarMonth();
                return;
            }
            await updateCalendarEvent(ev.id, { day: val }, { skipReload: false, skipMonth: false });
        }
    });
}

async function setCalendarDay(dayStr, options = {}) {
    const { skipLoad = false, skipLabel = false } = options;
    calendarState.selectedDay = dayStr;
    resetCalendarSelection();
    const label = document.getElementById('calendar-day-label');
    const picker = document.getElementById('calendar-date-picker');
    if (!skipLabel) {
        if (label) label.textContent = formatCalendarLabel(dayStr);
        if (picker) picker.value = dayStr;
    }
    renderCalendarMonth(); // keep the month grid highlight in sync
    if (!skipLoad && calendarState.dayViewOpen && calendarState.detailsOpen) {
        await loadCalendarDay(dayStr);
    }
}

async function setCalendarMonth(anchorDate) {
    const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    calendarState.monthCursor = monthStart;
    await loadCalendarMonth();
}

async function loadCalendarMonth() {
    const grid = document.getElementById('calendar-month-grid');
    const label = document.getElementById('calendar-month-label');
    if (!grid) return;
    const range = getMonthRange(calendarState.monthCursor || new Date());
    if (label) label.textContent = formatMonthLabel(calendarState.monthCursor || new Date());
    try {
        const res = await fetch(`/api/calendar/events?start=${range.startStr}&end=${range.endStr}`);
        if (!res.ok) throw new Error('Failed to load month');
        const data = await res.json();
        calendarState.monthEventsByDay = data.events || {};
        renderCalendarMonth();
    } catch (err) {
        grid.innerHTML = `<div class="calendar-month-error">Could not load month.</div>`;
        console.error(err);
    }
}

function renderCalendarMonth() {
    const grid = document.getElementById('calendar-month-grid');
    const label = document.getElementById('calendar-month-label');
    if (!grid || !calendarState.monthCursor) return;
    if (label) label.textContent = formatMonthLabel(calendarState.monthCursor);

    const todayStr = new Date().toISOString().slice(0, 10);
    const range = getMonthRange(calendarState.monthCursor);
    const startDayOfWeek = range.start.getDay();
    const daysInMonth = range.end.getDate();
    grid.innerHTML = '';

    for (let i = 0; i < startDayOfWeek; i++) {
        const pad = document.createElement('div');
        pad.className = 'calendar-month-cell pad';
        grid.appendChild(pad);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateObj = new Date(calendarState.monthCursor.getFullYear(), calendarState.monthCursor.getMonth(), day);
        const dateStr = dateObj.toISOString().slice(0, 10);
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'calendar-month-cell';
        if (dateStr === todayStr) cell.classList.add('today');
        if (calendarState.selectedDay === dateStr) cell.classList.add('selected');

        const header = document.createElement('div');
        header.className = 'calendar-month-cell-header';
        header.innerHTML = `<span class="day-number">${day}</span>`;
        cell.appendChild(header);

        const eventsWrap = document.createElement('div');
        eventsWrap.className = 'calendar-month-events';
        const eventsForDay = (calendarState.monthEventsByDay || {})[dateStr] || [];
        const previews = eventsForDay.slice(0, 3);
        previews.forEach(ev => {
            const row = document.createElement('div');
            row.className = `calendar-month-event ${ev.is_phase ? 'phase' : ''}`;
            const time = ev.start_time ? ev.start_time.slice(0, 5) + (ev.end_time ? `-${ev.end_time.slice(0, 5)}` : '') : '';
            row.innerHTML = `
                <span class="dot priority-${ev.priority || 'medium'}"></span>
                <span class="title">${time ? time + ' · ' : ''}${ev.title || ''}</span>
            `;
            eventsWrap.appendChild(row);
        });
        if (eventsForDay.length > previews.length) {
            const more = document.createElement('div');
            more.className = 'calendar-month-more';
            more.textContent = `+${eventsForDay.length - previews.length} more`;
            eventsWrap.appendChild(more);
        }
        if (!eventsForDay.length) {
            const hint = document.createElement('div');
            hint.className = 'calendar-month-hint';
            hint.textContent = '—';
            eventsWrap.appendChild(hint);
        }
        cell.appendChild(eventsWrap);

        let clickTimer = null;
        cell.addEventListener('click', () => {
            if (clickTimer) {
                clearTimeout(clickTimer);
                clickTimer = null;
            }
            clickTimer = setTimeout(() => {
                clickTimer = null;
                selectDayForQuickAdd(dateStr);
            }, 200);
        });
        cell.addEventListener('dblclick', (e) => {
            e.preventDefault();
            if (clickTimer) {
                clearTimeout(clickTimer);
                clickTimer = null;
            }
            navigateToDayPage(dateStr);
        });
        grid.appendChild(cell);
    }
}

async function loadCalendarDay(dayStr) {
    const container = document.getElementById('calendar-events');
    if (!container) return;
    if (!dayStr || !calendarState.detailsOpen) {
        container.innerHTML = `<div class="calendar-empty">Pick a day to see the schedule.</div>`;
        return;
    }
    try {
        const res = await fetch(`/api/calendar/events?day=${dayStr}`);
        if (!res.ok) throw new Error('Failed to load events');
        calendarState.events = await res.json();
        renderCalendarEvents();
        scheduleLocalReminders();
    } catch (err) {
        container.innerHTML = `<div class="calendar-empty">Could not load events.</div>`;
        console.error(err);
    }
}

function ensureMonthMatchesSelectedDay() {
    if (!calendarState.selectedDay || !calendarState.monthCursor) return;
    const selectedDate = new Date(calendarState.selectedDay + 'T00:00:00');
    if (
        selectedDate.getFullYear() !== calendarState.monthCursor.getFullYear() ||
        selectedDate.getMonth() !== calendarState.monthCursor.getMonth()
    ) {
        setCalendarMonth(selectedDate);
    } else {
        renderCalendarMonth();
    }
}

function formatTimeDisplay(timeStr) {
    if (!timeStr) return '';
    const parts = timeStr.split(':').map(Number);
    const hour = parts[0] || 0;
    const minute = parts[1] || 0;
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = ((hour + 11) % 12) + 1;
    return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`;
}

// --- Calendar Time Modal ---

function openCalendarTimeModal(ev) {
    const modal = document.getElementById('calendar-time-modal');
    const title = document.getElementById('calendar-time-title');
    const startInput = document.getElementById('calendar-time-start');
    const endInput = document.getElementById('calendar-time-end');
    if (!modal || !startInput || !endInput) return;
    timeModalState.eventId = ev.id;
    if (title) title.textContent = ev.title || 'Calendar item';
    const normalize = (t) => {
        if (!t) return '';
        const friendly = formatTimeDisplay(String(t));
        if (friendly) return friendly; // e.g., 6:10 PM
        const parts = String(t).split(':');
        if (parts.length >= 2) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
        return String(t);
    };
    startInput.value = normalize(ev.start_time);
    endInput.value = normalize(ev.end_time);
    modal.classList.add('active');
}

function closeCalendarTimeModal() {
    const modal = document.getElementById('calendar-time-modal');
    if (modal) modal.classList.remove('active');
    timeModalState.eventId = null;
}

async function saveCalendarTimeModal() {
    if (!timeModalState.eventId) return;
    const startInput = document.getElementById('calendar-time-start');
    const endInput = document.getElementById('calendar-time-end');
    const startVal = startInput ? startInput.value.trim() : '';
    const endVal = endInput ? endInput.value.trim() : '';
    await updateCalendarEvent(timeModalState.eventId, {
        start_time: startVal || null,
        end_time: endVal || null
    });
    closeCalendarTimeModal();
}

function formatTimeRange(ev) {
    if (!ev.start_time) return '';
    const start = formatTimeDisplay(ev.start_time);
    const end = ev.end_time ? formatTimeDisplay(ev.end_time) : '';
    return end ? `${start} - ${end}` : start;
}

function getCalendarSortMode() {
    return calendarState.daySort || 'time';
}

function parseTimeToMinutes(value) {
    if (!value) return null;
    const parts = String(value).split(':');
    if (!parts.length) return null;
    const hours = parseInt(parts[0], 10);
    const mins = parseInt(parts[1] || '0', 10);
    if (Number.isNaN(hours) || Number.isNaN(mins)) return null;
    return (hours * 60) + mins;
}

function sortCalendarItems(items, mode) {
    const priorityRank = { high: 0, medium: 1, low: 2 };
    const statusRank = { not_started: 0, in_progress: 1, done: 2 };
    const normalizedMode = mode || 'time';
    const orderIndex = (ev) => (Number.isFinite(ev.order_index) ? ev.order_index : 999999);

    return [...items].sort((a, b) => {
        if (normalizedMode === 'manual') {
            return orderIndex(a) - orderIndex(b);
        }

        if (normalizedMode === 'time') {
            const at = parseTimeToMinutes(a.start_time);
            const bt = parseTimeToMinutes(b.start_time);
            if (at !== null || bt !== null) {
                if (at === null) return 1;
                if (bt === null) return -1;
                if (at !== bt) return at - bt;
            }
        }

        if (normalizedMode === 'priority') {
            const ap = priorityRank[a.priority || 'medium'] ?? 3;
            const bp = priorityRank[b.priority || 'medium'] ?? 3;
            if (ap !== bp) return ap - bp;
        }

        if (normalizedMode === 'status') {
            const as = statusRank[a.status || 'not_started'] ?? 3;
            const bs = statusRank[b.status || 'not_started'] ?? 3;
            if (as !== bs) return as - bs;
        }

        const atitle = (a.title || '').toLowerCase();
        const btitle = (b.title || '').toLowerCase();
        if (atitle < btitle) return -1;
        if (atitle > btitle) return 1;
        return orderIndex(a) - orderIndex(b);
    });
}

function renderCalendarEvents() {
    const container = document.getElementById('calendar-events');
    if (!container) return;
    container.innerHTML = '';
    if (!calendarState.selectedDay) {
        container.innerHTML = `<div class="calendar-empty">Pick a day from the calendar to view its schedule.</div>`;
        resetCalendarSelection();
        return;
    }
    if (!calendarState.detailsOpen) {
        container.innerHTML = `<div class="calendar-empty">Double-click a day to open its full schedule. You can still add quick events once a day is selected.</div>`;
        resetCalendarSelection();
        return;
    }
    if (!calendarState.events || calendarState.events.length === 0) {
        container.innerHTML = `<div class="calendar-empty">Nothing planned for this day. Use the quick add box to start.</div>`;
        resetCalendarSelection();
        return;
    }
    const sortMode = getCalendarSortMode();
    const tasksDue = (calendarState.events || []).filter(ev => ev.is_task_link);
    const timeline = (calendarState.events || []).filter(ev => !ev.is_task_link);
    const groupMap = new Map();
    const rootItems = [];
    const rootNonGroup = [];

    timeline.forEach(ev => {
        if (ev.is_group) {
            groupMap.set(ev.id, { header: ev, children: [] });
            rootItems.push(ev);
        }
    });

    timeline.forEach(ev => {
        if (ev.is_group) return;
        // Only tasks/phases can be nested under groups (no events)
        if (!ev.is_event && ev.group_id && groupMap.has(ev.group_id)) {
            groupMap.get(ev.group_id).children.push(ev);
        } else {
            rootItems.push(ev);
            rootNonGroup.push(ev);
        }
    });

    const groupsList = sortCalendarItems(timeline.filter(ev => ev.is_group), sortMode);
    groupMap.forEach(group => {
        group.children = sortCalendarItems(group.children, sortMode);
    });

    const phasesAndTasks = [
        ...sortCalendarItems(rootNonGroup.filter(ev => !ev.is_event && !ev.is_group), sortMode),
        ...sortCalendarItems(tasksDue, sortMode)
    ];
    const dayEvents = sortCalendarItems(rootNonGroup.filter(ev => ev.is_event && !ev.is_group), sortMode);

    const renderPhaseOrTask = (ev, isChild = false) => {
        const row = document.createElement('div');
        const doneClass = (!ev.is_phase && ev.status === 'done') ? 'done' : '';
        row.className = `calendar-row ${ev.is_phase ? 'phase' : ''} ${doneClass} ${isChild ? 'child-row' : ''}`;
        row.dataset.id = ev.id;
        row.dataset.groupId = ev.group_id || '';
        row.dataset.type = ev.is_phase ? 'phase' : 'task';

        if (ev.is_task_link) {
            const left = document.createElement('div');
            left.className = 'row-left';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = ev.status === 'done';
            checkbox.onchange = () => updateLinkedTaskStatus(ev.task_id, checkbox.checked ? 'done' : 'not_started');
            left.appendChild(checkbox);

            row.classList.add('task-link-row');
            const titleWrap = document.createElement('div');
            titleWrap.className = 'calendar-title task-link-title';
            const titleInput = document.createElement('input');
            titleInput.type = 'text';
            titleInput.value = ev.title;
            titleInput.readOnly = true;
            titleInput.setAttribute('aria-label', 'Open task');
            titleWrap.appendChild(titleInput);
            titleWrap.addEventListener('click', () => {
                window.location.href = `/list/${ev.task_list_id}#item-${ev.task_id}`;
            });
            titleInput.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.href = `/list/${ev.task_list_id}#item-${ev.task_id}`;
            });

            const timeBtn = document.createElement('button');
            timeBtn.type = 'button';
            timeBtn.className = 'calendar-time-inline';
            const timeLabel = formatTimeRange(ev);
            timeBtn.innerHTML = timeLabel
                ? `<i class="fa-regular fa-clock"></i><span>${timeLabel}</span>`
                : `<i class="fa-regular fa-clock"></i>`;
            if (!timeLabel) {
                timeBtn.classList.add('no-time');
                timeBtn.setAttribute('data-label', 'Add time');
            }
            timeBtn.title = timeLabel || 'Add time';
            timeBtn.onclick = async (e) => {
                e.stopPropagation();
                const linked = await ensureLinkedTaskEvent(ev);
                if (!linked || !linked.calendar_event_id) return;
                openCalendarTimeModal({ ...linked, id: linked.calendar_event_id });
            };
            titleWrap.appendChild(timeBtn);

            const meta = document.createElement('div');
            meta.className = 'calendar-meta-lite';
            const listChip = document.createElement('a');
            listChip.className = 'meta-chip task-link';
            listChip.href = `/list/${ev.task_list_id}#item-${ev.task_id}`;
            listChip.textContent = ev.task_list_title || 'Task list';
            listChip.title = 'Open task';
            meta.append(listChip);
            titleWrap.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'calendar-actions-row';
        const priorityDot = document.createElement('button');
        priorityDot.className = `calendar-priority-dot priority-${ev.priority || 'medium'}`;
        priorityDot.title = `Priority: ${(ev.priority || 'medium')}`;
        priorityDot.onclick = (e) => {
            e.stopPropagation();
            openPriorityMenu(priorityDot, ev.priority || 'medium', async (val) => {
                // Only update UI; task link priority isn't editable here
                ev.priority = val;
                renderCalendarEvents();
            }, { readOnly: true });
        };

        const overflowMenuContainer = document.createElement('div');
        overflowMenuContainer.className = 'calendar-overflow-menu';
        const overflowBtn = document.createElement('button');
        overflowBtn.className = 'calendar-icon-btn overflow-trigger';
        overflowBtn.title = 'More options';
        overflowBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
        overflowBtn.style.display = 'inline-flex';
        overflowBtn.style.width = '28px';
        overflowBtn.style.height = '28px';

        const overflowDropdown = document.createElement('div');
        overflowDropdown.className = 'calendar-item-dropdown';

        const reminderActive = ev.reminder_minutes_before !== null && ev.reminder_minutes_before !== undefined;
        const reminderMenuItem = document.createElement('button');
        reminderMenuItem.className = 'calendar-item-menu-option';
        reminderMenuItem.innerHTML = `<i class="fa-solid fa-bell${reminderActive ? '' : '-slash'} ${reminderActive ? 'active-icon' : ''}"></i> ${reminderActive ? `Reminder (${ev.reminder_minutes_before}m)` : 'Set Reminder'}`;
        reminderMenuItem.onclick = async (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            const linked = await ensureLinkedTaskEvent(ev);
            if (!linked || !linked.calendar_event_id) return;
            openReminderEditor({ ...linked, id: linked.calendar_event_id });
        };

        const openBtn = document.createElement('a');
        openBtn.className = 'calendar-item-menu-option';
        openBtn.href = `/list/${ev.task_list_id}#item-${ev.task_id}`;
        openBtn.innerHTML = '<i class="fa-solid fa-up-right-from-square"></i> Open task';

        const unpinBtn = document.createElement('button');
        unpinBtn.className = 'calendar-item-menu-option';
        unpinBtn.innerHTML = '<i class="fa-solid fa-thumbtack"></i> Unpin from day';
        unpinBtn.onclick = (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            unpinTaskDate(ev.task_id);
        };

        overflowDropdown.append(reminderMenuItem, openBtn, unpinBtn);
        overflowMenuContainer.append(overflowBtn);
        document.body.appendChild(overflowDropdown);

        const positionDropdown = () => {
            const rect = overflowBtn.getBoundingClientRect();
            const dropdownWidth = 200;
            const dropdownHeight = overflowDropdown.offsetHeight || 120;
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;
            const padding = 8;
            overflowDropdown.style.position = 'fixed';
            let topPos = rect.bottom + 8;
            if (screenHeight - rect.bottom < dropdownHeight + padding && rect.top > screenHeight - rect.bottom) {
                topPos = rect.top - dropdownHeight - 8;
            }
            let leftPos = rect.right - dropdownWidth;
            if (leftPos < padding) leftPos = padding;
            if (leftPos + dropdownWidth > screenWidth - padding) leftPos = screenWidth - dropdownWidth - padding;
            overflowDropdown.style.top = `${topPos}px`;
            overflowDropdown.style.left = `${leftPos}px`;
        };

        overflowBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.calendar-item-dropdown.active').forEach(d => d.classList.remove('active'));
            overflowDropdown.classList.toggle('active');
            positionDropdown();
        });

        window.addEventListener('scroll', () => {
            if (overflowDropdown.classList.contains('active')) positionDropdown();
        }, { passive: true });

        actions.append(priorityDot, overflowMenuContainer);

        row.append(left, titleWrap, actions);
        attachCalendarRowSelection(row, ev);
        return row;
        }

        if (ev.is_phase) {
            const left = document.createElement('div');
            left.className = 'row-left phase-icon';
            left.innerHTML = '<i class="fa-solid fa-bars-staggered"></i>';

            const titleWrap = document.createElement('div');
            titleWrap.className = 'calendar-title';
            const titleInput = document.createElement('input');
            titleInput.type = 'text';
            titleInput.value = ev.title;
            titleInput.placeholder = 'Phase title';
            titleInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    titleInput.blur();
                }
            });
            titleInput.addEventListener('blur', () => {
                if (titleInput.value.trim() !== ev.title) {
                    updateCalendarEvent(ev.id, { title: titleInput.value.trim() || ev.title });
                }
            });
            titleWrap.appendChild(titleInput);

            const actions = document.createElement('div');
            actions.className = 'calendar-actions-row';
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-icon';
            deleteBtn.title = 'Delete';
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            deleteBtn.onclick = () => deleteCalendarEvent(ev.id);
            const moveUp = document.createElement('button');
            moveUp.className = 'btn-icon';
            moveUp.title = 'Move up';
            moveUp.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
            moveUp.onclick = () => nudgeCalendarEvent(ev.id, -1);
            const moveDown = document.createElement('button');
            moveDown.className = 'btn-icon';
            moveDown.title = 'Move down';
            moveDown.innerHTML = '<i class="fa-solid fa-arrow-down"></i>';
            moveDown.onclick = () => nudgeCalendarEvent(ev.id, 1);
            actions.append(moveUp, moveDown, deleteBtn);
            row.append(left, titleWrap, actions);
            attachCalendarRowSelection(row, ev);
            return row;
        }

        const left = document.createElement('div');
        left.className = 'row-left';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = ev.status === 'done';
        checkbox.onchange = () => updateCalendarEvent(ev.id, { status: checkbox.checked ? 'done' : 'not_started' });
        left.appendChild(checkbox);

        const titleWrap = document.createElement('div');
        titleWrap.className = 'calendar-title';
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.value = ev.title;
        titleInput.placeholder = 'Task title';
        titleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                titleInput.blur();
            }
        });
        titleInput.addEventListener('blur', () => {
            if (titleInput.value.trim() !== ev.title) {
                updateCalendarEvent(ev.id, { title: titleInput.value.trim() || ev.title });
            }
        });
        titleWrap.appendChild(titleInput);

        // Add time inline with title (clickable to edit)
        const timeBtn = document.createElement('button');
        timeBtn.type = 'button';
        timeBtn.className = 'calendar-time-inline';
        const timeLabel = formatTimeRange(ev);
        timeBtn.innerHTML = timeLabel
            ? `<i class="fa-regular fa-clock"></i><span>${timeLabel}</span>`
            : `<i class="fa-regular fa-clock"></i>`;
        if (!timeLabel) {
            timeBtn.classList.add('no-time');
            timeBtn.setAttribute('data-label', 'Add time');
        }
        timeBtn.title = timeLabel || 'Add time';
        timeBtn.onclick = () => openCalendarTimeModal(ev);
        titleWrap.appendChild(timeBtn);

        // Keep phase chip in meta-lite (will show on hover)
        const meta = document.createElement('div');
        meta.className = 'calendar-meta-lite';
        if (ev.phase_id) {
            const chip = document.createElement('span');
            chip.className = 'meta-chip phase';
            chip.textContent = ev.phase_title ? `# ${ev.phase_title}` : 'Phase';
            meta.appendChild(chip);
        }
        const noteChips = document.createElement('div');
        noteChips.className = 'calendar-note-chips';
        (ev.linked_notes || []).forEach(note => {
            const link = document.createElement('a');
            link.className = 'meta-chip note';
            link.href = `/notes?note=${note.id}`;
            link.title = note.title || `Note #${note.id}`;
            link.setAttribute('aria-label', note.title || `Note #${note.id}`);
            link.innerHTML = '<i class="fa-solid fa-note-sticky"></i>';
            noteChips.appendChild(link);
        });
        if (meta.childNodes.length) titleWrap.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'calendar-actions-row';

        const priorityDot = document.createElement('button');
        priorityDot.className = `calendar-priority-dot priority-${ev.priority || 'medium'}`;
        priorityDot.title = `Priority: ${(ev.priority || 'medium')}`;
        priorityDot.onclick = (e) => {
            e.stopPropagation();
            openPriorityMenu(priorityDot, ev.priority || 'medium', async (val) => {
                await updateCalendarEvent(ev.id, { priority: val });
                ev.priority = val;
                renderCalendarEvents();
            });
        };

        // Overflow menu for less common actions
        const overflowMenuContainer = document.createElement('div');
        overflowMenuContainer.className = 'calendar-overflow-menu';

        const overflowBtn = document.createElement('button');
        overflowBtn.className = 'calendar-icon-btn overflow-trigger';
        overflowBtn.title = 'More options';
        overflowBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
        overflowBtn.style.display = 'inline-flex';
        overflowBtn.style.width = '28px';
        overflowBtn.style.height = '28px';

        const overflowDropdown = document.createElement('div');
        overflowDropdown.className = 'calendar-item-dropdown';

        const reminderActive = ev.reminder_minutes_before !== null && ev.reminder_minutes_before !== undefined;
        const reminderMenuItem = document.createElement('button');
        reminderMenuItem.className = 'calendar-item-menu-option';
        reminderMenuItem.innerHTML = `<i class="fa-solid fa-bell${reminderActive ? '' : '-slash'} ${reminderActive ? 'active-icon' : ''}"></i> ${reminderActive ? `Reminder (${ev.reminder_minutes_before}m)` : 'Set Reminder'}`;
        reminderMenuItem.onclick = (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            openReminderEditor(ev);
        };

        const moveMenuItem = document.createElement('button');
        moveMenuItem.className = 'calendar-item-menu-option';
        moveMenuItem.innerHTML = '<i class="fa-solid fa-calendar-day"></i> Move to day';
        moveMenuItem.onclick = (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            openCalendarMovePrompt(ev);
        };

        const noteMenuItem = document.createElement('button');
        noteMenuItem.className = 'calendar-item-menu-option';
        noteMenuItem.innerHTML = '<i class="fa-solid fa-note-sticky"></i> Link Note';
        noteMenuItem.onclick = (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            linkNoteToCalendarEvent(ev.id, ev.title, (ev.linked_notes || []).map(n => n.id));
        };

        const rolloverMenuItem = document.createElement('button');
        rolloverMenuItem.className = 'calendar-item-menu-option';
        rolloverMenuItem.innerHTML = `<i class="fa-solid fa-rotate ${ev.rollover_enabled ? 'active-icon' : ''}"></i> ${ev.rollover_enabled ? 'Disable' : 'Enable'} Rollover`;
        rolloverMenuItem.onclick = async (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            const next = !ev.rollover_enabled;
            try {
                await updateCalendarEvent(ev.id, { rollover_enabled: next });
                ev.rollover_enabled = next;
            } catch (err) {
                console.error('Failed to toggle rollover', err);
            }
        };

        const deleteMenuItem = document.createElement('button');
        deleteMenuItem.className = 'calendar-item-menu-option delete-option';
        deleteMenuItem.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
        deleteMenuItem.onclick = (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            deleteCalendarEvent(ev.id);
        };

        // Order: reminder, rollover, note, move, delete
        overflowDropdown.append(reminderMenuItem, rolloverMenuItem, noteMenuItem, moveMenuItem, deleteMenuItem);
        overflowMenuContainer.append(overflowBtn);
        document.body.appendChild(overflowDropdown); // Append to body instead

        // Function to position dropdown relative to button
        const positionDropdown = () => {
            const rect = overflowBtn.getBoundingClientRect();
            const dropdownWidth = 180;
            const dropdownHeight = overflowDropdown.offsetHeight || 150; // Estimate if not rendered yet
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;
            const padding = 8;

            overflowDropdown.style.position = 'fixed';

            // Determine vertical position - flip up if would spill below screen
            let topPos;
            const spaceBelow = screenHeight - rect.bottom;
            const spaceAbove = rect.top;

            if (spaceBelow < dropdownHeight + padding && spaceAbove > spaceBelow) {
                // Not enough space below, but more space above - position above button
                topPos = rect.top - dropdownHeight - 8;
            } else {
                // Position below button (default)
                topPos = rect.bottom + 8;
            }

            overflowDropdown.style.top = `${topPos}px`;

            // Calculate left position, ensuring it stays on screen
            let leftPos = rect.right - dropdownWidth;

            // If dropdown would go off left edge, align to left edge with padding
            if (leftPos < padding) {
                leftPos = padding;
            }

            // If dropdown would go off right edge, align to right edge with padding
            if (leftPos + dropdownWidth > screenWidth - padding) {
                leftPos = screenWidth - dropdownWidth - padding;
            }

            overflowDropdown.style.left = `${leftPos}px`;
        };

        // Store reference for scroll update
        overflowDropdown.updatePosition = positionDropdown;
        overflowDropdown.triggerButton = overflowBtn;

        overflowBtn.onclick = (e) => {
            e.stopPropagation();

            const isOpen = overflowDropdown.classList.contains('active');

            // Close all other dropdowns first
            document.querySelectorAll('.calendar-item-dropdown.active').forEach(d => {
                if (d !== overflowDropdown) {
                    d.classList.remove('active');
                }
            });

            if (!isOpen) {
                positionDropdown();
                overflowDropdown.classList.add('active');
            } else {
                overflowDropdown.classList.remove('active');
            }
        };

        if (noteChips.childNodes.length) actions.append(noteChips);
        actions.append(priorityDot, overflowMenuContainer);
        row.append(left, titleWrap, actions);
        attachCalendarRowSelection(row, ev);
        return row;
    };

    const renderEvent = (ev, isChild = false) => {
        const row = document.createElement('div');
        row.className = `calendar-row event ${isChild ? 'child-row' : ''}`;
        row.dataset.id = ev.id;
        row.dataset.groupId = ev.group_id || '';
        row.dataset.type = 'event';

        const left = document.createElement('div');
        left.className = 'row-left';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'calendar-title';
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.value = ev.title;
        titleInput.placeholder = 'Event title';
        titleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                titleInput.blur();
            }
        });
        titleInput.addEventListener('blur', () => {
            if (titleInput.value.trim() !== ev.title) {
                updateCalendarEvent(ev.id, { title: titleInput.value.trim() || ev.title });
            }
        });
        titleWrap.appendChild(titleInput);

        // Add time inline with title
        const timeBtn = document.createElement('button');
        timeBtn.type = 'button';
        timeBtn.className = 'calendar-time-inline';
        const timeLabel = formatTimeRange(ev);
        timeBtn.innerHTML = timeLabel
            ? `<i class="fa-regular fa-clock"></i><span>${timeLabel}</span>`
            : `<i class="fa-regular fa-clock"></i>`;
        if (!timeLabel) {
            timeBtn.classList.add('no-time');
            timeBtn.setAttribute('data-label', 'Add time');
        }
        timeBtn.title = timeLabel || 'Add time';
        timeBtn.onclick = () => openCalendarTimeModal(ev);
        titleWrap.appendChild(timeBtn);

        const noteChips = document.createElement('div');
        noteChips.className = 'calendar-note-chips';
        (ev.linked_notes || []).forEach(note => {
            const link = document.createElement('a');
            link.className = 'meta-chip note';
            link.href = `/notes?note=${note.id}`;
            link.title = note.title || `Note #${note.id}`;
            link.setAttribute('aria-label', note.title || `Note #${note.id}`);
            link.innerHTML = '<i class="fa-solid fa-note-sticky"></i>';
            noteChips.appendChild(link);
        });

        const actions = document.createElement('div');
        actions.className = 'calendar-actions-row';

        const priorityDot = document.createElement('button');
        priorityDot.className = `calendar-priority-dot priority-${ev.priority || 'medium'}`;
        priorityDot.title = `Priority: ${(ev.priority || 'medium')}`;
        priorityDot.onclick = (e) => {
            e.stopPropagation();
            openPriorityMenu(priorityDot, ev.priority || 'medium', async (val) => {
                await updateCalendarEvent(ev.id, { priority: val });
                ev.priority = val;
                renderCalendarEvents();
            });
        };

        // Overflow menu for events (matching tasks)
        const overflowMenuContainer = document.createElement('div');
        overflowMenuContainer.className = 'calendar-overflow-menu';

        const overflowBtn = document.createElement('button');
        overflowBtn.className = 'calendar-icon-btn overflow-trigger';
        overflowBtn.title = 'More options';
        overflowBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
        overflowBtn.style.display = 'inline-flex';
        overflowBtn.style.width = '28px';
        overflowBtn.style.height = '28px';

        const overflowDropdown = document.createElement('div');
        overflowDropdown.className = 'calendar-item-dropdown';

        const reminderActive = ev.reminder_minutes_before !== null && ev.reminder_minutes_before !== undefined;
        const reminderMenuItem = document.createElement('button');
        reminderMenuItem.className = 'calendar-item-menu-option';
        reminderMenuItem.innerHTML = `<i class="fa-solid fa-bell${reminderActive ? '' : '-slash'} ${reminderActive ? 'active-icon' : ''}"></i> ${reminderActive ? `Reminder (${ev.reminder_minutes_before}m)` : 'Set Reminder'}`;
        reminderMenuItem.onclick = (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            openReminderEditor(ev);
        };

        const noteMenuItem = document.createElement('button');
        noteMenuItem.className = 'calendar-item-menu-option';
        noteMenuItem.innerHTML = '<i class="fa-solid fa-note-sticky"></i> Link Note';
        noteMenuItem.onclick = (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            linkNoteToCalendarEvent(ev.id, ev.title, (ev.linked_notes || []).map(n => n.id));
        };

        const rolloverMenuItem = document.createElement('button');
        rolloverMenuItem.className = 'calendar-item-menu-option';
        rolloverMenuItem.innerHTML = `<i class="fa-solid fa-rotate ${ev.rollover_enabled ? 'active-icon' : ''}"></i> ${ev.rollover_enabled ? 'Disable' : 'Enable'} Rollover`;
        rolloverMenuItem.onclick = async (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            const next = !ev.rollover_enabled;
            try {
                await updateCalendarEvent(ev.id, { rollover_enabled: next });
                ev.rollover_enabled = next;
            } catch (err) {
                console.error('Failed to toggle rollover', err);
            }
        };

        const moveMenuItem = document.createElement('button');
        moveMenuItem.className = 'calendar-item-menu-option';
        moveMenuItem.innerHTML = '<i class="fa-solid fa-calendar-day"></i> Move to day';
        moveMenuItem.onclick = (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            openCalendarMovePrompt(ev);
        };

        const deleteMenuItem = document.createElement('button');
        deleteMenuItem.className = 'calendar-item-menu-option delete-option';
        deleteMenuItem.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
        deleteMenuItem.onclick = (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            deleteCalendarEvent(ev.id);
        };

        overflowDropdown.append(reminderMenuItem, rolloverMenuItem, noteMenuItem, moveMenuItem, deleteMenuItem);
        overflowMenuContainer.append(overflowBtn);
        document.body.appendChild(overflowDropdown);

        const positionDropdown = () => {
            const rect = overflowBtn.getBoundingClientRect();
            const dropdownWidth = 180;
            const dropdownHeight = overflowDropdown.offsetHeight || 150;
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;
            const padding = 8;

            overflowDropdown.style.position = 'fixed';

            let topPos;
            const spaceBelow = screenHeight - rect.bottom;
            const spaceAbove = rect.top;

            if (spaceBelow < dropdownHeight + padding && spaceAbove > spaceBelow) {
                topPos = rect.top - dropdownHeight - 8;
            } else {
                topPos = rect.bottom + 8;
            }

            overflowDropdown.style.top = `${topPos}px`;

            let leftPos = rect.right - dropdownWidth;
            if (leftPos < padding) {
                leftPos = padding;
            }
            if (leftPos + dropdownWidth > screenWidth - padding) {
                leftPos = screenWidth - dropdownWidth - padding;
            }

            overflowDropdown.style.left = `${leftPos}px`;
        };

        overflowDropdown.updatePosition = positionDropdown;
        overflowDropdown.triggerButton = overflowBtn;

        overflowBtn.onclick = (e) => {
            e.stopPropagation();
            const isOpen = overflowDropdown.classList.contains('active');
            document.querySelectorAll('.calendar-item-dropdown.active').forEach(d => {
                if (d !== overflowDropdown) {
                    d.classList.remove('active');
                }
            });
            if (!isOpen) {
                positionDropdown();
                overflowDropdown.classList.add('active');
            } else {
                overflowDropdown.classList.remove('active');
            }
        };

        if (noteChips.childNodes.length) actions.append(noteChips);
        actions.append(priorityDot, overflowMenuContainer);
        row.append(left, titleWrap, actions);
        attachCalendarRowSelection(row, ev);
        return row;
    };

    const renderGroup = (group) => {
        const row = document.createElement('div');
        row.className = 'calendar-row group';
        row.dataset.id = group.id;
        row.dataset.groupCollapsed = 'false';

        const grip = document.createElement('span');
        grip.className = 'group-icon';
        const children = groupMap.get(group.id)?.children || [];
        grip.innerHTML = `
            <i class="fa-solid fa-chevron-down" style="font-size: 0.75rem; margin-right: 0.25rem;"></i>
            <i class="fa-solid fa-layer-group"></i>
            <span class="count-badge" style="margin-left: 0.35rem;">${children.length}</span>
        `;
        grip.style.cursor = 'pointer';
        grip.onclick = () => {
            const isCollapsed = row.dataset.groupCollapsed === 'true';
            row.dataset.groupCollapsed = isCollapsed ? 'false' : 'true';
            const chevron = grip.querySelector('.fa-chevron-down');
            if (chevron) {
                chevron.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
            }
            // Toggle children visibility
            children.forEach(child => {
                const childRow = container.querySelector(`[data-id="${child.id}"]`);
                if (childRow && childRow !== row) {
                    childRow.style.display = isCollapsed ? '' : 'none';
                }
            });
        };

        const titleWrap = document.createElement('div');
        titleWrap.className = 'calendar-title';
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.value = group.title;
        titleInput.placeholder = 'Group title';
        titleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                titleInput.blur();
            }
        });
        titleInput.addEventListener('blur', () => {
            if (titleInput.value.trim() !== group.title) {
                updateCalendarEvent(group.id, { title: titleInput.value.trim() || group.title });
            }
        });
        titleWrap.appendChild(titleInput);

        const actions = document.createElement('div');
        actions.className = 'calendar-actions-row';
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-icon';
        deleteBtn.title = 'Delete';
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteBtn.onclick = () => deleteCalendarEvent(group.id);
        actions.append(deleteBtn);

        row.append(grip, titleWrap, actions);
        container.appendChild(row);

        children.forEach(child => {
            // indent children slightly
            const childRow = child.is_event ? renderEvent(child, true) : renderPhaseOrTask(child, true);
            container.appendChild(childRow);
        });
    };

    const eventItems = dayEvents;
    const taskItems = sortCalendarItems([...groupsList, ...phasesAndTasks], sortMode);

    const toggleSection = (sectionId) => {
        const section = document.getElementById(`calendar-section-${sectionId}`);
        const divider = document.querySelector(`[data-section="${sectionId}"]`);
        if (section && divider) {
            section.classList.toggle('collapsed');
            divider.classList.toggle('collapsed');
        }
    };

    const addDivider = (label, count, sectionId) => {
        const d = document.createElement('div');
        d.className = 'calendar-event-divider';
        d.dataset.section = sectionId;
        d.innerHTML = `
            <span>
                ${label}
                <span class="count-badge">${count}</span>
            </span>
            <i class="fa-solid fa-chevron-down divider-icon"></i>
        `;
        d.onclick = () => toggleSection(sectionId);
        container.appendChild(d);
    };

    const createSection = (id) => {
        const section = document.createElement('div');
        section.id = `calendar-section-${id}`;
        section.className = 'calendar-section';
        return section;
    };

    if (eventItems.length) {
        addDivider('Events', eventItems.length, 'events');
        const eventSection = createSection('events');
        eventItems.forEach(ev => eventSection.appendChild(renderEvent(ev)));
        container.appendChild(eventSection);
    }

    if (taskItems.length) {
        addDivider('Tasks', taskItems.length, 'tasks');
        const taskSection = createSection('tasks');
        taskItems.forEach(ev => {
            if (ev.is_group) {
                renderGroup(ev);
            } else {
                taskSection.appendChild(renderPhaseOrTask(ev));
            }
        });
        container.appendChild(taskSection);
    }

    enableCalendarDragAndDrop(container);

    updateCalendarBulkBar();
}

function calendarSelectionKey(id) {
    return String(id);
}

function resetCalendarSelection() {
    calendarSelection.ids.clear();
    calendarSelection.active = false;
    document.querySelectorAll('.calendar-row.selected').forEach(row => row.classList.remove('selected'));
    const selectAll = document.getElementById('calendar-select-all');
    if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
    }
    updateCalendarBulkBar();
}

function setCalendarRowSelected(id, isSelected) {
    const row = document.querySelector(`.calendar-row[data-id="${id}"]`);
    if (row) row.classList.toggle('selected', isSelected);
}

function startCalendarSelection(id) {
    if (id === null || id === undefined) return;
    calendarSelection.active = true;
    const key = calendarSelectionKey(id);
    calendarSelection.ids.add(key);
    setCalendarRowSelected(key, true);
    updateCalendarBulkBar();
}

function toggleCalendarSelection(id) {
    if (id === null || id === undefined) return;
    const key = calendarSelectionKey(id);
    if (!calendarSelection.active) {
        calendarSelection.active = true;
    }
    if (calendarSelection.ids.has(key)) {
        calendarSelection.ids.delete(key);
        setCalendarRowSelected(key, false);
    } else {
        calendarSelection.ids.add(key);
        setCalendarRowSelected(key, true);
    }
    if (calendarSelection.ids.size === 0) {
        calendarSelection.active = false;
    }
    updateCalendarBulkBar();
}

function calendarSelectAll(checked) {
    const rows = document.querySelectorAll('.calendar-row.selectable');
    calendarSelection.active = checked;
    calendarSelection.ids.clear();
    rows.forEach(row => {
        const id = row.dataset.id;
        if (!id) return;
        setCalendarRowSelected(id, checked);
        if (checked) calendarSelection.ids.add(calendarSelectionKey(id));
    });
    updateCalendarBulkBar();
}

function getSelectedCalendarEvents(includeTaskLinks = true) {
    const selectedKeys = calendarSelection.ids;
    if (!selectedKeys.size) return [];
    return (calendarState.events || []).filter(ev =>
        selectedKeys.has(calendarSelectionKey(ev.id)) &&
        (includeTaskLinks || !ev.is_task_link)
    );
}

function shouldIgnoreCalendarSelection(target) {
    if (!target) return false;
    return !!target.closest('input, textarea, select, button, a, .calendar-item-dropdown, .priority-menu');
}

function handleCalendarRowClick(e, ev) {
    if (ev.is_phase || ev.is_group) return;
    if (shouldIgnoreCalendarSelection(e.target)) return;
    const metaPressed = e.metaKey || e.ctrlKey;
    if (!calendarSelection.active && !metaPressed) return;
    e.preventDefault();
    toggleCalendarSelection(ev.id);
}

function handleCalendarTouchStart(e, ev) {
    if (ev.is_phase || ev.is_group) return;
    if (shouldIgnoreCalendarSelection(e.target)) return;
    calendarSelection.longPressTriggered = false;
    if (calendarSelection.longPressTimer) {
        clearTimeout(calendarSelection.longPressTimer);
    }
    if (e.touches && e.touches.length) {
        calendarSelection.touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    calendarSelection.longPressTimer = setTimeout(() => {
        calendarSelection.longPressTimer = null;
        calendarSelection.longPressTriggered = true;
        startCalendarSelection(ev.id);
    }, 450);
}

function handleCalendarTouchMove(e) {
    if (!calendarSelection.longPressTimer || !e.touches || !e.touches.length) return;
    const dx = Math.abs(e.touches[0].clientX - calendarSelection.touchStart.x);
    const dy = Math.abs(e.touches[0].clientY - calendarSelection.touchStart.y);
    if (dx > 8 || dy > 8) {
        clearTimeout(calendarSelection.longPressTimer);
        calendarSelection.longPressTimer = null;
    }
}

function handleCalendarTouchEnd(e, ev) {
    if (calendarSelection.longPressTimer) {
        clearTimeout(calendarSelection.longPressTimer);
        calendarSelection.longPressTimer = null;
    }
    if (calendarSelection.longPressTriggered) {
        e.preventDefault();
        calendarSelection.longPressTriggered = false;
        return;
    }
    if (calendarSelection.active && !shouldIgnoreCalendarSelection(e.target)) {
        e.preventDefault();
        toggleCalendarSelection(ev.id);
    }
}

function attachCalendarRowSelection(row, ev) {
    if (!row || ev.is_phase || ev.is_group) return;
    row.classList.add('selectable');
    if (calendarSelection.ids.has(calendarSelectionKey(ev.id))) {
        row.classList.add('selected');
    }
    const indicator = document.createElement('div');
    indicator.className = 'calendar-select-indicator';
    indicator.innerHTML = '<i class="fa-solid fa-check"></i>';
    row.appendChild(indicator);

    row.addEventListener('click', (e) => handleCalendarRowClick(e, ev));
    row.addEventListener('touchstart', (e) => handleCalendarTouchStart(e, ev), { passive: true });
    row.addEventListener('touchmove', handleCalendarTouchMove, { passive: true });
    row.addEventListener('touchend', (e) => handleCalendarTouchEnd(e, ev));
}

function updateCalendarBulkBar() {
    const bar = document.getElementById('calendar-bulk-bar');
    const count = document.getElementById('calendar-bulk-count');
    const selectAll = document.getElementById('calendar-select-all');
    const hasSelection = calendarSelection.ids.size > 0;
    if (bar) {
        bar.classList.toggle('active', hasSelection);
        bar.classList.toggle('is-hidden', !hasSelection);
    }
    if (count) {
        count.textContent = hasSelection ? `${calendarSelection.ids.size} selected` : '0 selected';
    }
    if (selectAll) {
        const selectableRows = document.querySelectorAll('.calendar-row.selectable');
        const total = selectableRows.length;
        selectAll.checked = hasSelection && total > 0 && calendarSelection.ids.size >= total;
        selectAll.indeterminate = hasSelection && total > 0 && calendarSelection.ids.size > 0 && calendarSelection.ids.size < total;
    }
    document.body.classList.toggle('calendar-selection-active', hasSelection);
}

async function finalizeCalendarBulkUpdate({ reloadDay = true } = {}) {
    if (reloadDay && calendarState.selectedDay) {
        await loadCalendarDay(calendarState.selectedDay);
    } else {
        renderCalendarEvents();
    }
    if (calendarState.monthCursor) {
        await loadCalendarMonth();
    }
    resetCalendarSelection();
}

async function bulkCalendarUpdateStatus(status) {
    const targets = getSelectedCalendarEvents(true).filter(ev => !ev.is_phase && !ev.is_group);
    if (!targets.length) return;
    const normalEvents = targets.filter(ev => !ev.is_task_link);
    const linkedTasks = targets.filter(ev => ev.is_task_link && ev.task_id);
    await Promise.all(normalEvents.map(ev => updateCalendarEvent(ev.id, { status }, { skipReload: true, skipMonth: true })));
    await Promise.all(linkedTasks.map(ev => updateLinkedTaskStatus(ev.task_id, status)));
    await finalizeCalendarBulkUpdate();
}

async function bulkCalendarToggleRollover() {
    const targets = getSelectedCalendarEvents(false).filter(ev => !ev.is_phase && !ev.is_group && !ev.is_task_link);
    if (!targets.length) return;
    await Promise.all(targets.map(ev => {
        const current = ev.rollover_enabled !== false;
        return updateCalendarEvent(ev.id, { rollover_enabled: !current }, { skipReload: true, skipMonth: true });
    }));
    await finalizeCalendarBulkUpdate();
}

async function bulkCalendarChangePriority(priority) {
    if (!['low', 'medium', 'high'].includes(priority)) return;
    const targets = getSelectedCalendarEvents(false).filter(ev => !ev.is_phase && !ev.is_group && !ev.is_task_link);
    if (!targets.length) return;
    await Promise.all(targets.map(ev => updateCalendarEvent(ev.id, { priority }, { skipReload: true, skipMonth: true })));
    await finalizeCalendarBulkUpdate();
}

async function bulkCalendarDelete() {
    const targets = getSelectedCalendarEvents(false).filter(ev => !ev.is_phase && !ev.is_group && !ev.is_task_link);
    if (!targets.length) return;
    if (!confirm(`Delete ${targets.length} selected item(s)?`)) return;
    try {
        await Promise.all(targets.map(ev => fetch(`/api/calendar/events/${ev.id}`, { method: 'DELETE' })));
        calendarState.events = calendarState.events.filter(ev => !calendarSelection.ids.has(calendarSelectionKey(ev.id)));
    } catch (err) {
        console.error('Bulk delete failed', err);
    }
    await finalizeCalendarBulkUpdate({ reloadDay: true });
}

async function bulkCalendarMove(dayStr) {
    if (!dayStr) return;
    const targets = getSelectedCalendarEvents(false).filter(ev => !ev.is_phase && !ev.is_group && !ev.is_task_link);
    if (!targets.length) return;
    await Promise.all(targets.map(ev => updateCalendarEvent(ev.id, { day: dayStr }, { skipReload: true })));
    await finalizeCalendarBulkUpdate();
}

function startBulkCalendarMovePrompt() {
    openCalendarPrompt({
        title: 'Move to day',
        message: 'Choose a date',
        type: 'date',
        defaultValue: calendarState.selectedDay || '',
        onSubmit: (val) => bulkCalendarMove(val)
    });
}

function startBulkCalendarPriorityPicker(anchor) {
    const button = anchor || document.getElementById('calendar-bulk-priority');
    if (!button) return;
    const hasSelection = calendarSelection.ids.size > 0;
    if (!hasSelection) return;
    openBulkPriorityDropdown(button, (val) => bulkCalendarChangePriority(val));
}

function startBulkCalendarNoteLink() {
    const targets = getSelectedCalendarEvents(true).filter(ev => !ev.is_phase && !ev.is_group && !ev.is_task_link);
    if (!targets.length) return;
    if (targets.length > 1) {
        alert('Link note works one item at a time because notes attach to a single calendar entry. Select one item to continue.');
        return;
    }
    const ev = targets[0];
    linkNoteToCalendarEvent(ev.id, ev.title, (ev.linked_notes || []).map(n => n.id));
}

function enableCalendarDragAndDrop(container) {
    const rows = Array.from(container.querySelectorAll('.calendar-row'));
    if (!rows.length) return;
    let dragSrc = null;

    const typeKey = (row) => `${row.dataset.type || 'task'}|${row.dataset.groupId || ''}`;

    rows.forEach(row => {
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
            if (calendarSelection.ids.size) {
                e.preventDefault();
                return;
            }
            dragSrc = row;
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            rows.forEach(r => r.classList.remove('drag-over'));
            dragSrc = null;
        });
        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!dragSrc) return;
            if (typeKey(dragSrc) !== typeKey(row)) return;
            row.classList.add('drag-over');
        });
        row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            rows.forEach(r => r.classList.remove('drag-over'));
            if (!dragSrc) return;
            if (typeKey(dragSrc) !== typeKey(row)) return;
            if (dragSrc === row) return;
            const order = Array.from(container.querySelectorAll('.calendar-row'));
            const srcIdx = order.indexOf(dragSrc);
            const tgtIdx = order.indexOf(row);
            if (srcIdx === -1 || tgtIdx === -1) return;
            order.splice(tgtIdx, 0, order.splice(srcIdx, 1)[0]);
            // Rebuild events order and commit
            const idToEvent = new Map(calendarState.events.map(ev => [String(ev.id), ev]));
            calendarState.events = order.map(r => idToEvent.get(r.dataset.id)).filter(Boolean);
            commitCalendarOrder();
            renderCalendarEvents();
        });
    });
}

function parseCalendarQuickInput(text) {
    const raw = text.trim();
    if (!raw) return null;

    // Phase creation with task
    if (raw.startsWith('#')) {
        const afterSymbol = raw.substring(1).trim();
        let phaseName, taskText;

        // Check for comma separator for multi-word phase names
        if (afterSymbol.includes(',')) {
            const parts = afterSymbol.split(',');
            phaseName = parts[0].trim();
            taskText = parts.slice(1).join(',').trim();
        } else {
            // Split on first space
            const firstSpaceIndex = afterSymbol.indexOf(' ');
            if (firstSpaceIndex === -1) {
                // No space, just create the phase
                return { is_phase: true, title: afterSymbol || 'Untitled Phase' };
            }
            phaseName = afterSymbol.substring(0, firstSpaceIndex).trim();
            taskText = afterSymbol.substring(firstSpaceIndex + 1).trim();
        }

        if (!taskText) {
            // No task text, just create phase
            return { is_phase: true, title: phaseName };
        }

        // Return indicator to create both phase and task
        return {
            create_phase_with_task: true,
            phase_name: phaseName,
            task_text: taskText
        };
    }

    // Group creation with task
    if (raw.startsWith('>')) {
        const afterSymbol = raw.substring(1).trim();
        let groupName, taskText;

        // Check for comma separator for multi-word group names
        if (afterSymbol.includes(',')) {
            const parts = afterSymbol.split(',');
            groupName = parts[0].trim();
            taskText = parts.slice(1).join(',').trim();
        } else {
            // Split on first space
            const firstSpaceIndex = afterSymbol.indexOf(' ');
            if (firstSpaceIndex === -1) {
                // No space, just create the group
                return { is_group: true, title: afterSymbol || 'Untitled Group' };
            }
            groupName = afterSymbol.substring(0, firstSpaceIndex).trim();
            taskText = afterSymbol.substring(firstSpaceIndex + 1).trim();
        }

        if (!taskText) {
            // No task text, just create group
            return { is_group: true, title: groupName };
        }

        // Return indicator to create both group and task
        return {
            create_group_with_task: true,
            group_name: groupName,
            task_text: taskText
        };
    }

    let working = raw;
    let startTime = null;
    let endTime = null;
    let priority = 'medium';
    let reminder = null;
    let phaseName = null;
    let rollover = false;
    let isEvent = false;
    let groupName = null;

    // SYMBOL-BASED SYNTAX

    // Event marker: $
    if (working.includes('$')) {
        isEvent = true;
        working = working.replace(/\$/g, '').trim();
    }

    // Time: @time or @time-time
    const timeMatch = working.match(/@(\d{1,2}(?::\d{2})?(?:am|pm)?)\s*(?:-\s*(\d{1,2}(?::\d{2})?(?:am|pm)?))?/i);
    if (timeMatch) {
        startTime = timeMatch[1];
        endTime = timeMatch[2] || null;
        working = working.replace(timeMatch[0], '').trim();
    }

    // Priority: !h, !m, !l OR !high, !medium, !low
    const priorityMatch = working.match(/!(h|m|l|high|med|medium|low)/i);
    if (priorityMatch) {
        const val = priorityMatch[1].toLowerCase();
        if (val === 'h' || val === 'high') priority = 'high';
        else if (val === 'l' || val === 'low') priority = 'low';
        else priority = 'medium';
        working = working.replace(priorityMatch[0], '').trim();
    }

    // Reminder: *minutes
    const reminderMatch = working.match(/\*(\d{1,3})/);
    if (reminderMatch) {
        reminder = parseInt(reminderMatch[1], 10);
        working = working.replace(reminderMatch[0], '').trim();
    }

    // Phase: #name
    const phaseMatch = working.match(/#([A-Za-z0-9 _-]+)/);
    if (phaseMatch) {
        phaseName = phaseMatch[1].trim();
        working = working.replace(phaseMatch[0], '').trim();
    }

    // Group: >name
    const groupMatch = working.match(/>([A-Za-z0-9 _-]+)/);
    if (groupMatch) {
        groupName = groupMatch[1].trim();
        working = working.replace(groupMatch[0], '').trim();
    }

    // Enable rollover: + (dash previously disabled; now explicit opt-in)
    if (working.includes('+')) {
        rollover = true;
        working = working.replace(/\+/g, '').trim();
    }

    const title = working.trim();
    if (!title) return null;

    return {
        title,
        is_phase: false,
        is_event: isEvent,
        start_time: startTime,
        end_time: endTime,
        priority,
        reminder_minutes_before: reminder,
        phase_name: phaseName,
        group_name: groupName,
        rollover_enabled: rollover
    };
}

// Autocomplete state
const autocompleteState = {
    visible: false,
    selectedIndex: 0,
    suggestions: []
};

function getSyntaxSuggestions(text, cursorPosition) {
    const suggestions = [];
    const beforeCursor = text.substring(0, cursorPosition);

    // Check if user is typing after "#" - filter existing phases
    const phaseMatch = beforeCursor.match(/#([A-Za-z0-9 _-]*)$/);
    if (phaseMatch) {
        const searchTerm = phaseMatch[1].toLowerCase();
        const phases = calendarState.events?.filter(e => e.is_phase) || [];
        phases.forEach(phase => {
            if (phase.title.toLowerCase().startsWith(searchTerm)) {
                suggestions.push({
                    type: 'phase',
                    syntax: phase.title,
                    description: `Add to "${phase.title}" phase`,
                    insertText: phase.title
                });
            }
        });
        return suggestions;
    }

    // Check if user is typing after ">" - filter existing groups
    const groupMatch = beforeCursor.match(/>([A-Za-z0-9 _-]*)$/);
    if (groupMatch) {
        const searchTerm = groupMatch[1].toLowerCase();
        const groups = calendarState.events?.filter(e => e.is_group) || [];
        groups.forEach(group => {
            if (group.title.toLowerCase().startsWith(searchTerm)) {
                suggestions.push({
                    type: 'group',
                    syntax: group.title,
                    description: `Add to "${group.title}" group`,
                    insertText: group.title
                });
            }
        });
        return suggestions;
    }

    // Otherwise, show all syntax options
    // Event
    suggestions.push({
        syntax: '$',
        description: 'Mark as event (not a task)',
        example: '$ Team meeting @2pm'
    });

    // Time
    suggestions.push({
        syntax: '@[time]',
        description: 'Set time',
        example: '@2pm or @2pm-3pm or @14:00'
    });

    // Priority
    suggestions.push({
        syntax: '!h',
        description: 'High priority (red)',
        example: 'Buy milk !h'
    });
    suggestions.push({
        syntax: '!m',
        description: 'Medium priority (orange)',
        example: 'Call client !m'
    });
    suggestions.push({
        syntax: '!l',
        description: 'Low priority (green)',
        example: 'Read article !l'
    });

    // Phase
    const phases = calendarState.events?.filter(e => e.is_phase) || [];
    if (phases.length > 0) {
        suggestions.push({
            syntax: '#[name]',
            description: 'Add to phase',
            example: `#${phases[0].title}`
        });
    } else {
        suggestions.push({
            syntax: '#[name]',
            description: 'Add to phase',
            example: '#Planning'
        });
    }

    // Group
    const groups = calendarState.events?.filter(e => e.is_group) || [];
    if (groups.length > 0) {
        suggestions.push({
            syntax: '>[name]',
            description: 'Add to group',
            example: `>${groups[0].title}`
        });
    } else {
        suggestions.push({
            syntax: '>[name]',
            description: 'Add to group',
            example: '>Work'
        });
    }

    // Reminder
    suggestions.push({
        syntax: '*[minutes]',
        description: 'Reminder before start',
        example: '*15 or *30'
    });

    // Disable rollover
    suggestions.push({
        syntax: '-',
        description: 'Disable rollover (task won\'t move to next day)',
        example: 'Buy milk - (won\'t rollover)'
    });

    return suggestions;
}

function renderAutocompleteSuggestions(suggestions) {
    const container = document.getElementById('calendar-autocomplete');
    if (!container) return;

    if (suggestions.length === 0) {
        container.classList.add('is-hidden');
        autocompleteState.visible = false;
        return;
    }

    container.innerHTML = '';
    suggestions.forEach((sug, index) => {
        const item = document.createElement('div');
        item.className = `autocomplete-item ${index === autocompleteState.selectedIndex ? 'selected' : ''}`;

        if (sug.type === 'phase' || sug.type === 'group') {
            // Simpler format for phase/group autocomplete
            item.innerHTML = `
                <div class="autocomplete-syntax">${sug.syntax}</div>
                <div class="autocomplete-description">${sug.description}</div>
            `;
        } else {
            // Full format for syntax help
            item.innerHTML = `
                <div class="autocomplete-syntax">${sug.syntax}</div>
                <div class="autocomplete-description">${sug.description}</div>
                <div class="autocomplete-example">e.g., ${sug.example}</div>
            `;
        }

        // Make item clickable
        item.onclick = () => {
            if (sug.insertText) {
                insertSuggestion(sug.insertText, sug.type);
            } else {
                insertSuggestion(sug.syntax);
            }
            hideAutocomplete();
        };

        container.appendChild(item);
    });

    container.classList.remove('is-hidden');
    autocompleteState.visible = true;
    autocompleteState.suggestions = suggestions;
}

function insertSuggestion(syntax, type) {
    const input = document.getElementById('calendar-quick-input');
    if (!input) return;

    const cursorPos = input.selectionStart;
    const text = input.value;
    const beforeCursor = text.substring(0, cursorPos);
    const afterCursor = text.substring(cursorPos);

    let newText;
    let newCursorPos;

    // Handle phase/group autocomplete
    if (type === 'phase' || type === 'group') {
        const symbol = type === 'phase' ? '#' : '>';
        const symbolIndex = beforeCursor.lastIndexOf(symbol);

        if (symbolIndex !== -1) {
            // Replace everything after the symbol with the selected name
            newText = text.substring(0, symbolIndex + 1) + syntax + ' ' + afterCursor;
            newCursorPos = symbolIndex + 1 + syntax.length + 1;
        } else {
            // Fallback: just append
            newText = beforeCursor + syntax + ' ' + afterCursor;
            newCursorPos = cursorPos + syntax.length + 1;
        }
    } else {
        // Original logic for other suggestions
        const lastWord = beforeCursor.split(/\s/).pop();
        const hasPartial = lastWord.startsWith('@') || lastWord.startsWith('!') ||
                           lastWord.startsWith('#') || lastWord.startsWith('>') ||
                           lastWord === '$' || lastWord.toLowerCase().startsWith('bell');

        if (hasPartial) {
            const replaceStart = cursorPos - lastWord.length;
            newText = text.substring(0, replaceStart) + syntax + ' ' + afterCursor;
            newCursorPos = replaceStart + syntax.length + 1;
        } else {
            newText = beforeCursor + syntax + ' ' + afterCursor;
            newCursorPos = cursorPos + syntax.length + 1;
        }
    }

    input.value = newText;
    input.setSelectionRange(newCursorPos, newCursorPos);
    input.focus();

    hideAutocomplete();
}

function hideAutocomplete() {
    const container = document.getElementById('calendar-autocomplete');
    if (container) container.classList.add('is-hidden');
    autocompleteState.visible = false;
    autocompleteState.selectedIndex = 0;
}

function updateDynamicHint(text) {
    // No dynamic hint updates - keep it simple
}

let priorityMenuEl = null;
function closePriorityMenu() {
    if (priorityMenuEl) {
        priorityMenuEl.classList.add('is-hidden');
    }
}

function openPriorityMenu(target, current, onSelect) {
    if (!priorityMenuEl) {
        priorityMenuEl = document.createElement('div');
        priorityMenuEl.className = 'priority-menu is-hidden';
        document.body.appendChild(priorityMenuEl);
    }
    priorityMenuEl.innerHTML = '';
    ['low', 'medium', 'high'].forEach(val => {
        const btn = document.createElement('button');
        btn.className = `priority-menu-item ${val === current ? 'active' : ''}`;
        btn.textContent = val.charAt(0).toUpperCase() + val.slice(1);
        btn.onclick = async () => {
            await onSelect(val);
            closePriorityMenu();
        };
        priorityMenuEl.appendChild(btn);
    });
    const rect = target.getBoundingClientRect();
    priorityMenuEl.style.top = `${rect.bottom + window.scrollY + 6}px`;
    priorityMenuEl.style.left = `${rect.left + window.scrollX}px`;
    priorityMenuEl.classList.remove('is-hidden');
}

document.addEventListener('click', (e) => {
    if (!priorityMenuEl) return;
    if (priorityMenuEl.classList.contains('is-hidden')) return;
    if (!e.target.closest('.priority-menu')) {
        closePriorityMenu();
    }
});

let bulkPriorityDropdown = null;
function closeBulkPriorityDropdown() {
    if (bulkPriorityDropdown) bulkPriorityDropdown.classList.add('is-hidden');
}

function openBulkPriorityDropdown(anchor, onSelect) {
    if (!bulkPriorityDropdown) {
        bulkPriorityDropdown = document.createElement('div');
        bulkPriorityDropdown.className = 'priority-menu priority-menu-bulk is-hidden';
        document.body.appendChild(bulkPriorityDropdown);
    }
    bulkPriorityDropdown.innerHTML = '';
    ['low', 'medium', 'high'].forEach(val => {
        const btn = document.createElement('button');
        btn.className = 'priority-menu-item';
        btn.textContent = `Set to ${val.charAt(0).toUpperCase() + val.slice(1)}`;
        btn.onclick = async () => {
            await onSelect(val);
            closeBulkPriorityDropdown();
        };
        bulkPriorityDropdown.appendChild(btn);
    });
    const rect = anchor.getBoundingClientRect();
    bulkPriorityDropdown.style.top = `${rect.bottom + window.scrollY + 6}px`;
    bulkPriorityDropdown.style.left = `${rect.left + window.scrollX}px`;
    bulkPriorityDropdown.classList.remove('is-hidden');
}

document.addEventListener('click', (e) => {
    if (bulkPriorityDropdown && !bulkPriorityDropdown.classList.contains('is-hidden')) {
        if (!e.target.closest('.priority-menu-bulk') && !e.target.closest('#calendar-bulk-priority')) {
            closeBulkPriorityDropdown();
        }
    }
});

async function getOrCreatePhase(phaseName) {
    const existing = calendarState.events.find(e => e.is_phase && e.title.toLowerCase() === phaseName.toLowerCase());
    if (existing) {
        return existing.id;
    } else {
        const created = await createCalendarEvent({ title: phaseName, is_phase: true });
        return created ? created.id : null;
    }
}

async function getOrCreateGroup(groupName) {
    const existing = calendarState.events.find(e => e.is_group && e.title.toLowerCase() === groupName.toLowerCase());
    if (existing) {
        return existing.id;
    } else {
        const created = await createCalendarEvent({ title: groupName, is_group: true, is_event: false, is_phase: false });
        return created ? created.id : null;
    }
}

async function handleCalendarQuickAdd() {
    const input = document.getElementById('calendar-quick-input');
    if (!input || !calendarState.selectedDay || !calendarState.dayViewOpen) return;
    const parsed = parseCalendarQuickInput(input.value || '');
    if (!parsed) return;
    input.value = '';

    // Handle phase creation with task
    if (parsed.create_phase_with_task) {
        const createdPhase = await createCalendarEvent({
            title: parsed.phase_name,
            is_phase: true
        });
        const phaseId = createdPhase ? createdPhase.id : null;

        // Parse task text for all properties
        const taskParsed = parseCalendarQuickInput(parsed.task_text);
        if (taskParsed && !taskParsed.is_phase && !taskParsed.is_group && !taskParsed.create_phase_with_task && !taskParsed.create_group_with_task) {
            await createCalendarEvent({
                title: taskParsed.title,
                is_phase: false,
                is_event: taskParsed.is_event || false,
                phase_id: phaseId,
                start_time: taskParsed.start_time,
                end_time: taskParsed.end_time,
                priority: taskParsed.priority,
                reminder_minutes_before: taskParsed.reminder_minutes_before,
                group_id: taskParsed.group_name ? (await getOrCreateGroup(taskParsed.group_name)) : null,
                rollover_enabled: taskParsed.rollover_enabled
            });
        }

        if (calendarState.detailsOpen) {
            await loadCalendarDay(calendarState.selectedDay);
        } else {
            await loadCalendarMonth();
        }
        return;
    }

    // Handle group creation with task
    if (parsed.create_group_with_task) {
        const createdGroup = await createCalendarEvent({
            title: parsed.group_name,
            is_group: true,
            is_event: false,
            is_phase: false
        });
        const groupId = createdGroup ? createdGroup.id : null;

        // Parse task text for all properties
        const taskParsed = parseCalendarQuickInput(parsed.task_text);
        if (taskParsed && !taskParsed.is_phase && !taskParsed.is_group && !taskParsed.create_phase_with_task && !taskParsed.create_group_with_task) {
            let phaseId = null;
            if (taskParsed.phase_name) {
                phaseId = await getOrCreatePhase(taskParsed.phase_name);
            }

            await createCalendarEvent({
                title: taskParsed.title,
                is_phase: false,
                is_event: taskParsed.is_event || false,
                group_id: groupId,
                phase_id: phaseId,
                start_time: taskParsed.start_time,
                end_time: taskParsed.end_time,
                priority: taskParsed.priority,
                reminder_minutes_before: taskParsed.reminder_minutes_before,
                rollover_enabled: taskParsed.rollover_enabled
            });
        }

        if (calendarState.detailsOpen) {
            await loadCalendarDay(calendarState.selectedDay);
        } else {
            await loadCalendarMonth();
        }
        return;
    }

    const isEvent = parsed.is_event || false;
    if (parsed.is_phase) {
        await createCalendarEvent({ title: parsed.title, is_phase: true });
        if (calendarState.detailsOpen) {
            await loadCalendarDay(calendarState.selectedDay);
        } else {
            await loadCalendarMonth();
        }
        return;
    }

    if (parsed.is_group) {
        await createCalendarEvent({ title: parsed.title, is_group: true, is_event: false, is_phase: false });
        if (calendarState.detailsOpen) {
            await loadCalendarDay(calendarState.selectedDay);
        } else {
            await loadCalendarMonth();
        }
        return;
    }

    let phaseId = null;
    if (parsed.phase_name) {
        const existing = calendarState.events.find(e => e.is_phase && e.title.toLowerCase() === parsed.phase_name.toLowerCase());
        if (existing) {
            phaseId = existing.id;
        } else {
            const createdPhase = await createCalendarEvent({ title: parsed.phase_name, is_phase: true });
            phaseId = createdPhase ? createdPhase.id : null;
        }
    } else {
        // Default to most recent phase if present
        const phases = calendarState.events.filter(e => e.is_phase).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
        if (phases.length > 0) {
            phaseId = phases[phases.length - 1].id;
        }
    }

    let finalGroupId = null;
    if (parsed.group_name) {
        const existing = calendarState.events.find(e => e.is_group && e.title.toLowerCase() === parsed.group_name.toLowerCase());
        if (existing) {
            finalGroupId = existing.id;
        } else {
            const createdGroup = await createCalendarEvent({ title: parsed.group_name, is_group: true, is_event: false, is_phase: false });
            finalGroupId = createdGroup ? createdGroup.id : null;
        }
    }

    await createCalendarEvent({
        title: parsed.title,
        is_phase: false,
        is_event: isEvent,
        group_id: finalGroupId,
        start_time: parsed.start_time,
        end_time: parsed.end_time,
        priority: parsed.priority,
        reminder_minutes_before: parsed.reminder_minutes_before,
        phase_id: isEvent ? null : phaseId,
        rollover_enabled: parsed.rollover_enabled
    });
    if (calendarState.detailsOpen) {
        await loadCalendarDay(calendarState.selectedDay);
    } else {
        await loadCalendarMonth();
    }
}

async function handleMonthQuickAdd() {
    const input = document.getElementById('calendar-month-quick-input');
    const panel = document.getElementById('calendar-quick-add-panel');
    if (!input || !calendarState.selectedDay) return;

    const parsed = parseCalendarQuickInput(input.value || '');
    if (!parsed) return;

    input.value = '';

    // Handle phase creation with task
    if (parsed.create_phase_with_task) {
        const createdPhase = await createCalendarEvent({
            title: parsed.phase_name,
            is_phase: true
        });
        const phaseId = createdPhase ? createdPhase.id : null;

        // Parse task text for all properties
        const taskParsed = parseCalendarQuickInput(parsed.task_text);
        if (taskParsed && !taskParsed.is_phase && !taskParsed.is_group && !taskParsed.create_phase_with_task && !taskParsed.create_group_with_task) {
            const monthEvents = await fetchMonthEvents(calendarState.selectedDay);
            let groupId = null;
            if (taskParsed.group_name) {
                const existingGroup = monthEvents.find(e => e.is_group && e.title.toLowerCase() === taskParsed.group_name.toLowerCase());
                if (existingGroup) {
                    groupId = existingGroup.id;
                } else {
                    const createdGroup = await createCalendarEvent({
                        title: taskParsed.group_name,
                        is_group: true,
                        is_event: false,
                        is_phase: false
                    });
                    groupId = createdGroup ? createdGroup.id : null;
                }
            }

            await createCalendarEvent({
                title: taskParsed.title,
                is_phase: false,
                is_event: taskParsed.is_event || false,
                phase_id: phaseId,
                group_id: groupId,
                start_time: taskParsed.start_time,
                end_time: taskParsed.end_time,
                priority: taskParsed.priority,
                reminder_minutes_before: taskParsed.reminder_minutes_before,
                rollover_enabled: taskParsed.rollover_enabled
            });
        }

        await loadCalendarMonth();
        if (panel) panel.classList.add('is-hidden');
        return;
    }

    // Handle group creation with task
    if (parsed.create_group_with_task) {
        const createdGroup = await createCalendarEvent({
            title: parsed.group_name,
            is_group: true,
            is_event: false,
            is_phase: false
        });
        const groupId = createdGroup ? createdGroup.id : null;

        // Parse task text for all properties
        const taskParsed = parseCalendarQuickInput(parsed.task_text);
        if (taskParsed && !taskParsed.is_phase && !taskParsed.is_group && !taskParsed.create_phase_with_task && !taskParsed.create_group_with_task) {
            const monthEvents = await fetchMonthEvents(calendarState.selectedDay);
            let phaseId = null;
            if (taskParsed.phase_name) {
                const existingPhase = monthEvents.find(e => e.is_phase && e.title.toLowerCase() === taskParsed.phase_name.toLowerCase());
                if (existingPhase) {
                    phaseId = existingPhase.id;
                } else {
                    const createdPhase = await createCalendarEvent({
                        title: taskParsed.phase_name,
                        is_phase: true
                    });
                    phaseId = createdPhase ? createdPhase.id : null;
                }
            }

            await createCalendarEvent({
                title: taskParsed.title,
                is_phase: false,
                is_event: taskParsed.is_event || false,
                group_id: groupId,
                phase_id: phaseId,
                start_time: taskParsed.start_time,
                end_time: taskParsed.end_time,
                priority: taskParsed.priority,
                reminder_minutes_before: taskParsed.reminder_minutes_before,
                rollover_enabled: taskParsed.rollover_enabled
            });
        }

        await loadCalendarMonth();
        if (panel) panel.classList.add('is-hidden');
        return;
    }

    const isEvent = parsed.is_event || false;

    // Load the day's events to get phases and groups
    await loadCalendarMonth();

    if (parsed.is_phase) {
        await createCalendarEvent({ title: parsed.title, is_phase: true });
        await loadCalendarMonth();
        if (panel) panel.classList.add('is-hidden');
        return;
    }

    if (parsed.is_group) {
        await createCalendarEvent({ title: parsed.title, is_group: true, is_event: false, is_phase: false });
        await loadCalendarMonth();
        if (panel) panel.classList.add('is-hidden');
        return;
    }

    let phaseId = null;
    if (parsed.phase_name) {
        const monthEvents = await fetchMonthEvents(calendarState.selectedDay);
        const existing = monthEvents.find(e => e.is_phase && e.title.toLowerCase() === parsed.phase_name.toLowerCase());
        if (existing) {
            phaseId = existing.id;
        } else {
            const createdPhase = await createCalendarEvent({ title: parsed.phase_name, is_phase: true });
            phaseId = createdPhase ? createdPhase.id : null;
        }
    }

    let finalGroupId = null;
    if (parsed.group_name) {
        const monthEvents = await fetchMonthEvents(calendarState.selectedDay);
        const existing = monthEvents.find(e => e.is_group && e.title.toLowerCase() === parsed.group_name.toLowerCase());
        if (existing) {
            finalGroupId = existing.id;
        } else {
            const createdGroup = await createCalendarEvent({ title: parsed.group_name, is_group: true, is_event: false, is_phase: false });
            finalGroupId = createdGroup ? createdGroup.id : null;
        }
    }

    await createCalendarEvent({
        title: parsed.title,
        is_phase: false,
        is_event: isEvent,
        group_id: finalGroupId,
        start_time: parsed.start_time,
        end_time: parsed.end_time,
        priority: parsed.priority,
        reminder_minutes_before: parsed.reminder_minutes_before,
        phase_id: isEvent ? null : phaseId,
        rollover_enabled: parsed.rollover_enabled
    });

    await loadCalendarMonth();
    if (panel) panel.classList.add('is-hidden');
}

async function fetchMonthEvents(dayStr) {
    try {
        const res = await fetch(`/api/calendar/events?day=${dayStr}`);
        if (!res.ok) return [];
        return await res.json();
    } catch (err) {
        console.error(err);
        return [];
    }
}

function renderMonthAutocompleteSuggestions(suggestions) {
    const container = document.getElementById('calendar-month-autocomplete');
    if (!container) return;

    if (!suggestions || suggestions.length === 0) {
        hideMonthAutocomplete();
        return;
    }

    container.innerHTML = '';
    suggestions.forEach((sug, index) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item' + (index === autocompleteState.selectedIndex ? ' selected' : '');
        item.innerHTML = `<strong>${sug.display}</strong> <span class="autocomplete-hint">${sug.hint || ''}</span>`;
        item.onclick = () => {
            const input = document.getElementById('calendar-month-quick-input');
            if (input && sug.insert) {
                const before = input.value.substring(0, autocompleteState.cursorPos);
                const after = input.value.substring(autocompleteState.cursorPos);
                input.value = before + sug.insert + after;
                input.setSelectionRange(
                    autocompleteState.cursorPos + sug.insert.length,
                    autocompleteState.cursorPos + sug.insert.length
                );
                input.focus();
            }
            hideMonthAutocomplete();
        };
        container.appendChild(item);
    });

    container.classList.remove('is-hidden');
}

function hideMonthAutocomplete() {
    const container = document.getElementById('calendar-month-autocomplete');
    if (container) container.classList.add('is-hidden');
    autocompleteState.visible = false;
    autocompleteState.suggestions = [];
}

async function createCalendarEvent(payload) {
    try {
        const res = await fetch('/api/calendar/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, day: calendarState.selectedDay })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error(err);
            return null;
        }
        return await res.json();
    } catch (err) {
        console.error(err);
        return null;
    }
}

async function updateCalendarEvent(id, payload, options = {}) {
    const { skipReload = false, skipMonth = false } = options;
    const prevEvent = Array.isArray(calendarState.events) ? calendarState.events.find(e => e.id === id) : null;
    const prevDay = prevEvent?.day;
    try {
        const res = await fetch(`/api/calendar/events/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to update event');

        let updated = null;
        try {
            updated = await res.json();
        } catch (_) {
            // Some updates may not return JSON; skip in that case
        }

        // Optimistically update local state so the UI reflects changes without waiting on a reload
        if (updated && Array.isArray(calendarState.events)) {
            const movedOffDay = updated.day && calendarState.selectedDay && updated.day !== calendarState.selectedDay;
            calendarState.events = calendarState.events
                .map(ev => ev.id === id ? { ...ev, ...updated } : ev)
                .filter(ev => !(ev.id === id && movedOffDay));
        }

        const newDay = updated?.day || calendarState.selectedDay;
        if (calendarState.monthEventsByDay) {
            // Remove from previous day bucket if it changed
            if (prevDay && updated?.day && prevDay !== updated.day && Array.isArray(calendarState.monthEventsByDay[prevDay])) {
                calendarState.monthEventsByDay[prevDay] = calendarState.monthEventsByDay[prevDay].filter(ev => ev.id !== id);
            }
            if (newDay) {
                const bucket = calendarState.monthEventsByDay[newDay] || [];
                const replaced = bucket.some(ev => ev.id === id);
                const nextBucket = replaced
                    ? bucket.map(ev => ev.id === id ? { ...ev, ...updated } : ev)
                    : [...bucket, { ...updated }];
                calendarState.monthEventsByDay[newDay] = nextBucket;
            }
        }

        if (!skipReload) {
            if (calendarState.detailsOpen && calendarState.selectedDay) {
                await loadCalendarDay(calendarState.selectedDay);
            } else if (updated) {
                renderCalendarEvents();
            }
        }
        if (calendarState.monthCursor && !skipMonth) {
            renderCalendarMonth();
        }
    } catch (err) {
        console.error(err);
    }
}

async function deleteCalendarEvent(id) {
    try {
        await fetch(`/api/calendar/events/${id}`, { method: 'DELETE' });
        calendarState.events = calendarState.events.filter(e => e.id !== id);
        renderCalendarEvents();
    } catch (err) {
        console.error(err);
    }
}

async function commitCalendarOrder() {
    const ids = calendarState.events.filter(e => !e.is_task_link).map(e => e.id);
    try {
        await fetch('/api/calendar/events/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ day: calendarState.selectedDay, ids })
        });
    } catch (err) {
        console.error(err);
    }
}

function nudgeCalendarEvent(id, delta) {
    const idx = calendarState.events.findIndex(e => e.id === id && !e.is_task_link);
    if (idx === -1) return;
    const target = idx + delta;
    if (target < 0 || target >= calendarState.events.length) return;
    const swapped = [...calendarState.events];
    const tmp = swapped[idx];
    swapped[idx] = swapped[target];
    swapped[target] = tmp;
    calendarState.events = swapped.map((ev, i) => ({ ...ev, order_index: i + 1 }));
    renderCalendarEvents();
    commitCalendarOrder();
}

async function scheduleLocalReminders() {
    // Clear old timers (only needed for web mode)
    Object.values(calendarReminderTimers).forEach(t => clearTimeout(t));
    calendarReminderTimers = {};

    if (!calendarNotifyEnabled || !calendarState.selectedDay) return;

    const now = new Date();

    // In native app mode, use Capacitor Local Notifications
    if (window.isNativeApp && window.isNativeApp()) {
        // Cancel all existing scheduled notifications
        await window.NotificationService?.cancelAll();

        // Schedule new notifications
        calendarState.events.forEach(async (ev) => {
            if (ev.status === 'done') return;
            if (!ev.start_time || ev.reminder_minutes_before === null || ev.reminder_minutes_before === undefined) return;

            const target = new Date(`${calendarState.selectedDay}T${ev.start_time}`);
            const reminderAt = new Date(target.getTime() - ev.reminder_minutes_before * 60000);
            const reminderId = (ev.is_task_link && ev.calendar_event_id) ? ev.calendar_event_id : ev.id;

            if (reminderAt.getTime() > now.getTime()) {
                const body = ev.start_time ? `${formatTimeRange(ev)} - ${ev.title}` : ev.title;

                await window.NotificationService?.schedule({
                    id: reminderId,
                    title: 'Upcoming Event',
                    body: body,
                    at: reminderAt,
                    extra: { url: '/calendar', eventId: ev.id }
                });
            }
        });
    } else {
        // Web mode: use setTimeout as before
        calendarState.events.forEach(ev => {
            if (ev.status === 'done') return;
            if (!ev.start_time || ev.reminder_minutes_before === null || ev.reminder_minutes_before === undefined) return;
            const target = new Date(`${calendarState.selectedDay}T${ev.start_time}`);
            const reminderAt = new Date(target.getTime() - ev.reminder_minutes_before * 60000);
            const delay = reminderAt.getTime() - now.getTime();
            if (delay > 0) {
                const reminderId = (ev.is_task_link && ev.calendar_event_id) ? ev.calendar_event_id : ev.id;
                calendarReminderTimers[reminderId] = setTimeout(() => {
                    triggerLocalNotification(ev);
                }, delay);
            }
        });
    }
}

function triggerLocalNotification(ev) {
    const body = ev.start_time ? `${formatTimeRange(ev)} - ${ev.title}` : ev.title;
    showNativeNotification('Upcoming event', { body, data: { url: '/calendar' } });
}

async function enableCalendarNotifications() {
    // In native app, use NotificationService
    if (window.isNativeApp && window.isNativeApp()) {
        const hasPermission = await window.NotificationService?.initialize();
        if (hasPermission) {
            calendarNotifyEnabled = true;
            await scheduleLocalReminders();

            // Show success notification
            await window.NotificationService?.show('Notifications Enabled', {
                body: 'You will now receive notifications for your calendar events and reminders.'
            });
        } else {
            calendarNotifyEnabled = false;
            alert('Notification permission denied. Please enable notifications in your device settings.');
        }
        return;
    }

    // Web mode: use existing web notification system
    if (!('Notification' in window)) {
        alert('Notifications are not supported in this browser');
        return;
    }

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
        calendarNotifyEnabled = false;
        alert('Notification permission denied. Please enable notifications in your browser settings.');
        return;
    }

    const registration = await ensureServiceWorkerRegistered();
    if (!registration) {
        alert('Could not register service worker. Notifications may not work properly.');
        calendarNotifyEnabled = true;
        scheduleLocalReminders();
        return;
    }

    // Subscribe to push notifications
    await subscribeToPushNotifications(registration);

    calendarNotifyEnabled = true;
    scheduleLocalReminders();

    // Show success notification
    showNativeNotification('Notifications Enabled', {
        body: 'You will now receive notifications for your calendar events and reminders.',
        icon: '/static/favicon.png'
    });
}

async function subscribeToPushNotifications(registration) {
    if (!registration) {
        console.warn('No registration provided for push subscription');
        return;
    }

    try {
        // Check if service worker is active
        if (!registration.active) {
            console.warn('Service worker not active yet, waiting...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (!registration.active) {
                throw new Error('Service worker failed to activate');
            }
        }

        // VAPID public key from server
        const vapidPublicKey = 'BPIc2hbTVNzSXKqIVlMPYEl5CJ3tH6fT9QLNnyD2UQESX2JzIBNljsIVDBkWyYrbeET3tHWpmPyjOYq8PKnMWVQ';

        // Convert base64 to Uint8Array
        const convertedKey = urlBase64ToUint8Array(vapidPublicKey);

        console.log('Subscribing to push notifications...');

        // Subscribe to push notifications
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: convertedKey
        });

        console.log('Push subscription created:', subscription.endpoint);

        // Send subscription to server
        const response = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                subscription: subscription.toJSON()
            })
        });

        if (!response.ok) {
            throw new Error(`Server rejected subscription: ${response.status}`);
        }

        console.log('Push notification subscription successful');
    } catch (error) {
        console.error('Push subscription failed:', error);
        // Don't fail entirely - local notifications can still work
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function autoEnableCalendarNotificationsIfGranted() {
    // In native app, check permission via NotificationService
    if (window.isNativeApp && window.isNativeApp()) {
        const hasPermission = await window.NotificationService?.hasPermission();
        if (hasPermission) {
            calendarNotifyEnabled = true;
            await scheduleLocalReminders();
        }
        return;
    }

    // Web mode: check browser notification permission
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
        calendarNotifyEnabled = true;
        const registration = await ensureServiceWorkerRegistered();
        if (registration) {
            // Ensure push subscription is active
            await subscribeToPushNotifications(registration);
        }
        scheduleLocalReminders();
    }
}

async function ensureServiceWorkerRegistered() {
    if (!('serviceWorker' in navigator)) {
        console.warn('Service workers not supported');
        return null;
    }
    try {
        // Check if already registered
        let registration = await navigator.serviceWorker.getRegistration('/');

        if (!registration) {
            // Register new service worker
            console.log('Registering service worker...');
            registration = await navigator.serviceWorker.register('/service-worker.js', {
                scope: '/'
            });
            console.log('Service worker registered:', registration);
        } else {
            console.log('Service worker already registered');
        }

        // Wait for service worker to be ready (active)
        console.log('Waiting for service worker to be ready...');
        const readyRegistration = await navigator.serviceWorker.ready;
        console.log('Service worker ready and active:', readyRegistration.active);

        return readyRegistration;
    } catch (error) {
        console.error('Service worker registration failed:', error);
        return null;
    }
}

async function showNativeNotification(title, options = {}) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
        const reg = await ensureServiceWorkerRegistered();
        if (reg?.active?.state === 'activated') {
            await reg.showNotification(title, options);
            return;
        }
    } catch (e) {
        console.error('SW showNotification failed, falling back', e);
    }
    // Fallback to page notification
    new Notification(title, options);
}

async function sendCalendarDigest(dayStr) {
    try {
        await fetch('/api/calendar/digest/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ day: dayStr })
        });
        window.dispatchEvent(new Event('notifications:refresh'));
    } catch (err) {
        console.error(err);
    }
}

async function triggerManualRollover() {
    try {
        await fetch('/api/calendar/rollover-now', { method: 'POST' });
        if (calendarState.selectedDay) {
            await loadCalendarDay(calendarState.selectedDay);
        }
    } catch (err) {
        console.error(err);
    }
}

function selectDayForQuickAdd(dayStr) {
    if (!dayStr) return;
    calendarState.selectedDay = dayStr;
    const panel = document.getElementById('calendar-quick-add-panel');
    const dateLabel = document.getElementById('calendar-quick-add-date');
    const input = document.getElementById('calendar-month-quick-input');

    if (!panel) return;

    // Format the date nicely
    const date = new Date(dayStr + 'T00:00:00');
    const options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
    const formattedDate = date.toLocaleDateString('en-US', options);

    if (dateLabel) dateLabel.textContent = formattedDate;
    if (input) {
        input.disabled = false;
        input.value = '';
    }

    panel.classList.remove('is-hidden');

    // Scroll to the bottom smoothly after animation
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    smoothScrollTo(maxScroll, 220);

    // Update month grid to highlight selected day
    renderCalendarMonth();
}

function smoothScrollTo(targetY, durationMs = 250) {
    const startY = window.scrollY || window.pageYOffset || 0;
    const delta = targetY - startY;
    if (Math.abs(delta) < 1) return;
    const start = performance.now();

    const step = (now) => {
        const elapsed = now - start;
        const t = Math.min(1, elapsed / durationMs);
        const eased = t * (2 - t); // easeOutQuad
        window.scrollTo(0, startY + delta * eased);
        if (t < 1) {
            window.requestAnimationFrame(step);
        }
    };

    window.requestAnimationFrame(step);
}

function openDayDetails(dayStr) {
    if (!dayStr) return;
    showDayView();
    calendarState.detailsOpen = true;
    setCalendarDay(dayStr);
    ensureMonthMatchesSelectedDay();
    const view = document.getElementById('calendar-day-view');
    if (view) view.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function navigateToDayPage(dayStr) {
    if (!dayStr) return;
    window.location.href = `/calendar?day=${dayStr}&mode=day`;
}

function initCalendarPage() {
    const page = document.getElementById('calendar-page');
    if (!page) return;
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const params = new URLSearchParams(window.location.search);
    const initialDayParam = params.get('day');
    const initialMode = params.get('mode');
    const initialDayStr = initialDayParam || todayStr;
    calendarState.selectedDay = initialDayStr;
    const monthCard = document.getElementById('calendar-month-card');

    const prevMonthBtn = document.getElementById('calendar-prev-month');
    const nextMonthBtn = document.getElementById('calendar-next-month');
    const prevBtn = document.getElementById('calendar-prev-day');
    const nextBtn = document.getElementById('calendar-next-day');
    const picker = document.getElementById('calendar-date-picker');
    const todayBtn = document.getElementById('calendar-today-btn');
    const quickInput = document.getElementById('calendar-quick-input');
    const notifyBtn = document.getElementById('calendar-enable-notify');
    const digestBtn = document.getElementById('calendar-send-digest');
    const timeModal = document.getElementById('calendar-time-modal');
    const timeSaveBtn = document.getElementById('calendar-time-save');
    const timeCancelBtn = document.getElementById('calendar-time-cancel');
    const rolloverBtn = document.getElementById('calendar-rollover-btn');
    const backBtn = document.getElementById('calendar-back-month');
    const menuBtn = document.getElementById('calendar-menu-btn');
    const dropdownMenu = document.getElementById('calendar-dropdown-menu');
    const sortBtn = document.getElementById('calendar-day-sort-btn');
    const sortMenu = document.getElementById('calendar-day-sort-menu');
    const sortMobileToggle = document.getElementById('calendar-sort-mobile-toggle');
    const sortMobileMenu = document.getElementById('calendar-sort-mobile');
    const bulkClearBtn = document.getElementById('calendar-bulk-clear');
    const bulkDoneBtn = document.getElementById('calendar-bulk-done');
    const bulkUndoneBtn = document.getElementById('calendar-bulk-undone');
    const bulkRolloverBtn = document.getElementById('calendar-bulk-rollover');
    const bulkPriorityBtn = document.getElementById('calendar-bulk-priority');
    const bulkMoveBtn = document.getElementById('calendar-bulk-move');
    const bulkNoteBtn = document.getElementById('calendar-bulk-note');
    const bulkDeleteBtn = document.getElementById('calendar-bulk-delete');
    const selectAllCheckbox = document.getElementById('calendar-select-all');
    const dayQuickAdd = document.getElementById('calendar-day-quick-add');
    const quickToggleBtn = document.getElementById('calendar-quick-toggle');

    const sortLabelMap = {
        time: 'Time',
        title: 'Title',
        priority: 'Priority',
        status: 'Status',
        manual: 'Manual'
    };

    const setDaySort = (mode) => {
        const next = mode || 'time';
        calendarState.daySort = next;
        localStorage.setItem('calendarDaySort', next);
        const label = sortLabelMap[next] || 'Time';
        if (sortBtn) sortBtn.setAttribute('title', `Sort: ${label}`);
        document.querySelectorAll('[data-sort]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-sort') === next);
        });
        if (calendarState.detailsOpen) {
            renderCalendarEvents();
        }
    };

    // Dropdown menu toggle
    if (menuBtn && dropdownMenu) {
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            dropdownMenu.classList.toggle('active');
        };
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.calendar-actions-menu')) {
                dropdownMenu.classList.remove('active');
                if (sortMobileMenu) sortMobileMenu.classList.remove('active');
            }
            if (sortMenu && !e.target.closest('.calendar-sort-menu')) {
                sortMenu.classList.remove('active');
            }
            // Also close all calendar item dropdowns
            if (!e.target.closest('.calendar-overflow-menu') && !e.target.closest('.calendar-item-dropdown')) {
                document.querySelectorAll('.calendar-item-dropdown.active').forEach(d => {
                    d.classList.remove('active');
                });
            }
        });

        // Update dropdown positions on scroll instead of closing them
        window.addEventListener('scroll', () => {
            document.querySelectorAll('.calendar-item-dropdown.active').forEach(dropdown => {
                if (dropdown.updatePosition && typeof dropdown.updatePosition === 'function') {
                    dropdown.updatePosition();
                }
            });
        }, true);

    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && calendarSelection.active) {
            resetCalendarSelection();
        }
    });

    if (prevMonthBtn) prevMonthBtn.onclick = () => {
        const current = calendarState.monthCursor || new Date();
        const prev = new Date(current.getFullYear(), current.getMonth() - 1, 1);
        setCalendarMonth(prev);
    };
    if (nextMonthBtn) nextMonthBtn.onclick = () => {
        const current = calendarState.monthCursor || new Date();
        const next = new Date(current.getFullYear(), current.getMonth() + 1, 1);
        setCalendarMonth(next);
    };

    if (prevBtn) prevBtn.onclick = () => {
        if (!calendarState.selectedDay) return;
        const current = new Date(calendarState.selectedDay + 'T00:00:00');
        current.setDate(current.getDate() - 1);
        openDayDetails(current.toISOString().slice(0, 10));
    };
    if (nextBtn) nextBtn.onclick = () => {
        if (!calendarState.selectedDay) return;
        const current = new Date(calendarState.selectedDay + 'T00:00:00');
        current.setDate(current.getDate() + 1);
        openDayDetails(current.toISOString().slice(0, 10));
    };
    if (picker) picker.onchange = (e) => openDayDetails(e.target.value);
    if (todayBtn) todayBtn.onclick = () => openDayDetails(todayStr);
    if (quickInput) {
        quickInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleCalendarQuickAdd();
            }

            // Navigation in autocomplete
            if (autocompleteState.visible) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    autocompleteState.selectedIndex =
                        Math.min(autocompleteState.selectedIndex + 1, autocompleteState.suggestions.length - 1);
                    renderAutocompleteSuggestions(autocompleteState.suggestions);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    autocompleteState.selectedIndex = Math.max(autocompleteState.selectedIndex - 1, 0);
                    renderAutocompleteSuggestions(autocompleteState.suggestions);
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    const selected = autocompleteState.suggestions[autocompleteState.selectedIndex];
                    if (selected) insertSuggestion(selected.syntax);
                } else if (e.key === 'Escape') {
                    hideAutocomplete();
                }
            }

            // Trigger autocomplete with Ctrl+Space
            if (e.key === ' ' && e.ctrlKey) {
                e.preventDefault();
                const suggestions = getSyntaxSuggestions(quickInput.value, quickInput.selectionStart);
                renderAutocompleteSuggestions(suggestions);
            }
        });

        // Auto-trigger suggestions for # and > with continuous filtering
        quickInput.addEventListener('input', () => {
            const text = quickInput.value;
            const cursorPos = quickInput.selectionStart;
            const beforeCursor = text.substring(0, cursorPos);

            // Check if we're currently typing after # or >
            const hasPhase = beforeCursor.match(/#([A-Za-z0-9 _-]*)$/);
            const hasGroup = beforeCursor.match(/>([A-Za-z0-9 _-]*)$/);

            if (hasPhase || hasGroup) {
                const suggestions = getSyntaxSuggestions(text, cursorPos);
                renderAutocompleteSuggestions(suggestions);
            } else {
                // Hide autocomplete if not typing after # or >
                hideAutocomplete();
            }
        });

        // Hide autocomplete when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.quick-add-input-wrapper')) {
                hideAutocomplete();
            }
        });

        // Mobile-friendly help button
        const helpBtn = document.getElementById('calendar-help-btn');
        if (helpBtn) {
            helpBtn.onclick = (e) => {
                e.stopPropagation();
                const suggestions = getSyntaxSuggestions(quickInput.value, quickInput.selectionStart);
                renderAutocompleteSuggestions(suggestions);
                quickInput.focus();
            };
        }
    }
    if (notifyBtn) notifyBtn.onclick = enableCalendarNotifications;
    if (digestBtn) digestBtn.onclick = () => {
        if (!calendarState.selectedDay) return;
        sendCalendarDigest(calendarState.selectedDay);
    };
    if (rolloverBtn) rolloverBtn.onclick = triggerManualRollover;
    if (backBtn) backBtn.onclick = returnToMonthView;
    if (timeCancelBtn) timeCancelBtn.onclick = closeCalendarTimeModal;
    if (timeSaveBtn) timeSaveBtn.onclick = saveCalendarTimeModal;
    if (timeModal) {
        timeModal.addEventListener('click', (e) => {
            if (e.target === timeModal) closeCalendarTimeModal();
        });
    }
    if (bulkClearBtn) bulkClearBtn.onclick = resetCalendarSelection;
    if (bulkDoneBtn) bulkDoneBtn.onclick = () => bulkCalendarUpdateStatus('done');
    if (bulkUndoneBtn) bulkUndoneBtn.onclick = () => bulkCalendarUpdateStatus('not_started');
    if (bulkRolloverBtn) bulkRolloverBtn.onclick = bulkCalendarToggleRollover;
    if (bulkPriorityBtn) bulkPriorityBtn.onclick = (e) => startBulkCalendarPriorityPicker(e.currentTarget);
    if (bulkMoveBtn) bulkMoveBtn.onclick = startBulkCalendarMovePrompt;
    if (bulkNoteBtn) bulkNoteBtn.onclick = startBulkCalendarNoteLink;
    if (bulkDeleteBtn) bulkDeleteBtn.onclick = bulkCalendarDelete;
    if (selectAllCheckbox) selectAllCheckbox.onchange = (e) => calendarSelectAll(e.target.checked);

    const savedSort = localStorage.getItem('calendarDaySort');
    if (savedSort) {
        calendarState.daySort = savedSort;
    }
    setDaySort(calendarState.daySort || 'time');

    if (sortBtn && sortMenu) {
        sortBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sortMenu.classList.toggle('active');
        });
    }

    if (sortMobileToggle && sortMobileMenu) {
        sortMobileToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            sortMobileMenu.classList.toggle('active');
        });
    }

    document.querySelectorAll('.calendar-sort-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.getAttribute('data-sort') || 'time';
            setDaySort(mode);
            if (sortMenu) sortMenu.classList.remove('active');
            if (dropdownMenu) dropdownMenu.classList.remove('active');
            if (sortMobileMenu) sortMobileMenu.classList.remove('active');
        });
    });

    if (dayQuickAdd && quickToggleBtn) {
        const setQuickAddCollapsed = (collapsed) => {
            dayQuickAdd.classList.toggle('is-collapsed', collapsed);
            const icon = quickToggleBtn.querySelector('i');
            if (icon) {
                icon.className = collapsed ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
            }
            const label = collapsed ? 'Expand quick add' : 'Minimize quick add';
            quickToggleBtn.setAttribute('aria-label', label);
            quickToggleBtn.setAttribute('title', label);
        };

        quickToggleBtn.addEventListener('click', () => {
            const collapsed = !dayQuickAdd.classList.contains('is-collapsed');
            setQuickAddCollapsed(collapsed);
        });

        setQuickAddCollapsed(false);
    }

    // Quick-add panel event handlers
    const quickAddPanel = document.getElementById('calendar-quick-add-panel');
    const quickAddCloseBtn = document.getElementById('calendar-quick-add-close');
    const monthQuickInput = document.getElementById('calendar-month-quick-input');

    if (quickAddCloseBtn && quickAddPanel) {
        quickAddCloseBtn.onclick = () => {
            quickAddPanel.classList.add('is-hidden');
            if (monthQuickInput) monthQuickInput.value = '';
        };
    }

    if (monthQuickInput) {
        monthQuickInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                await handleMonthQuickAdd();
            }
        });
    }

    // Syntax guide toggle
    const quickHelpToggle = document.getElementById('calendar-quick-help-toggle');
    const syntaxGuide = document.getElementById('calendar-quick-syntax-guide');

    if (quickHelpToggle && syntaxGuide) {
        quickHelpToggle.onclick = () => {
            const isHidden = syntaxGuide.classList.toggle('is-hidden');
            quickHelpToggle.textContent = isHidden ? 'Show syntax guide' : 'Hide syntax guide';
        };
    }

    const startInDayMode = initialMode === 'day';
    if (startInDayMode) {
        if (monthCard) monthCard.classList.add('is-hidden');
        showDayView();
        calendarState.detailsOpen = true;
        setCalendarDay(initialDayStr, { skipLoad: false, skipLabel: false });
    } else {
        hideDayView(); // start collapsed on calendar view
        setCalendarDay(todayStr, { skipLoad: true, skipLabel: true });
    }

    setCalendarMonth(new Date(initialDayStr + 'T00:00:00'));
}

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
    ensureServiceWorkerRegistered();
    const modal = document.getElementById('calendar-prompt-modal');
    if (modal) modal.classList.add('is-hidden');

    // Close modals on outside click
    window.onclick = function (event) {
        if (event.target == createModal) closeCreateModal();
        if (event.target == addItemModal) closeAddItemModal();
        if (event.target == bulkImportModal) closeBulkImportModal();
        if (event.target == moveItemModal) closeMoveModal();
        const editModal = document.getElementById('edit-item-modal');
        if (event.target == editModal) closeEditItemModal();
        if (event.target == confirmModal) closeConfirmModal();
        const editListModal = document.getElementById('edit-list-modal');
        if (event.target == editListModal) closeEditListModal();
        const recallModal = document.getElementById('recall-modal');
        if (event.target == recallModal) closeRecallModal();

        const mainMenu = document.getElementById('phase-menu-main');
        if (!event.target.closest('.phase-add-dropdown')) {
            if (mainMenu) mainMenu.classList.remove('show');
        }
    }

    if (confirmYesButton) {
        confirmYesButton.addEventListener('click', async () => {
            const action = pendingConfirm;
            pendingConfirm = null;
            if (action) {
                try {
                    await action();
                } catch (e) {
                    console.error('Error running confirm action:', e);
                }
            }
            closeConfirmModal();
        });
    }

    initDragAndDrop();
    normalizePhaseParents();
    organizePhaseDoneTasks();
    restorePhaseVisibility();
    initStickyListHeader();
    initTaskFilters();
    initTagFilters();
    applyTagColors();
    initMobileTopbar();
    initSidebarReorder();
    initNotesPage();
    initRecallsPage();
    initAIPage();
    initCalendarPage();
    autoEnableCalendarNotificationsIfGranted();

    initTaskSelectionUI();

    initAIPanel();
    initAIDragLauncher();
});

function initStickyListHeader() {
    const header = document.querySelector('.list-header');
    if (!header) return;
    header.classList.add('sticky-header');

    let lastScroll = window.scrollY;
    window.addEventListener('scroll', () => {
        const current = window.scrollY;
        if (current > lastScroll + 10) {
            header.classList.add('header-hidden');
        } else if (current < lastScroll - 10) {
            header.classList.remove('header-hidden');
        }
        lastScroll = current;
    }, { passive: true });
}

function initMobileTopbar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const trigger = document.getElementById('mobile-menu-btn');
    if (!sidebar || !overlay || !trigger) return;

    const media = window.matchMedia('(max-width: 1024px)');

    function closeDrawer() {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    }

    function openDrawer() {
        sidebar.classList.add('open');
        overlay.classList.add('active');
    }

    window.toggleSidebarDrawer = (forceOpen) => {
        if (!media.matches) return;
        const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !sidebar.classList.contains('open');
        if (shouldOpen) openDrawer(); else closeDrawer();
    };

    trigger.addEventListener('click', () => toggleSidebarDrawer());
    overlay.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDrawer();
    });

    const handleMediaChange = () => {
        if (!media.matches) {
            closeDrawer();
            sidebar.style.transform = '';
        }
    };

    if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', handleMediaChange);
    } else if (typeof media.addListener === 'function') {
        media.addListener(handleMediaChange);
    }
}

function initSidebarReorder() {
    const navList = document.querySelector('.nav-links');
    if (!navList) return;
    const media = window.matchMedia('(max-width: 1024px)');
    if (media.matches) return;

    let draggingEl = null;

    function applyOrder(order) {
        if (!Array.isArray(order) || !order.length) return;
        const items = Array.from(navList.querySelectorAll('li[data-nav-id]'));
        const map = new Map(items.map(item => [item.getAttribute('data-nav-id'), item]));
        order.forEach(id => {
            const item = map.get(id);
            if (item) navList.appendChild(item);
        });
    }

    function persistOrder() {
        const order = Array.from(navList.querySelectorAll('li[data-nav-id]'))
            .map(item => item.getAttribute('data-nav-id'))
            .filter(Boolean);
        fetch('/api/sidebar-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order })
        }).catch(err => console.error('Failed to save sidebar order:', err));
    }

    fetch('/api/sidebar-order')
        .then(r => r.json())
        .then(data => applyOrder(data.order || []))
        .catch(err => console.error('Failed to load sidebar order:', err));

    navList.querySelectorAll('li[data-nav-id]').forEach(item => {
        item.setAttribute('draggable', 'true');

        item.addEventListener('dragstart', (e) => {
            draggingEl = item;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', () => {
            if (draggingEl) draggingEl.classList.remove('dragging');
            draggingEl = null;
            persistOrder();
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            const target = e.currentTarget;
            if (!draggingEl || draggingEl === target) return;
            const rect = target.getBoundingClientRect();
            const shouldInsertAfter = e.clientY > rect.top + rect.height / 2;
            navList.insertBefore(draggingEl, shouldInsertAfter ? target.nextSibling : target);
        });
    });
}

let mouseHoldTimer = null;

function handleMouseHoldStart(e) {
    // Only trigger on left click
    if (e.button !== 0) return;
    const item = e.currentTarget;
    if (shouldIgnoreTaskSelection(e.target)) return;
    if (e.target.closest('.drag-handle') || e.target.closest('.task-actions-dropdown')) return;
    mouseHoldTimer = setTimeout(() => {
        mouseHoldTimer = null;
        const itemId = parseInt(item.dataset.itemId, 10);
        setTaskSelected(itemId, true);
        updateBulkBar();
    }, 500);
}

function handleMouseHoldEnd() {
    clearTimeout(mouseHoldTimer);
    mouseHoldTimer = null;
}

function initTaskSelectionUI() {
    const rows = document.querySelectorAll('.task-item');
    rows.forEach(row => {
        if (row.dataset.selectionBound === 'true') return;
        row.dataset.selectionBound = 'true';
        row.classList.add('selectable');
        row.addEventListener('touchstart', handleTouchStart, { passive: false });
        row.addEventListener('touchend', handleTouchEnd, { passive: false });
        row.addEventListener('touchmove', handleTouchMove, { passive: false });
        row.addEventListener('mousedown', handleMouseHoldStart);
        row.addEventListener('mouseup', handleMouseHoldEnd);
        row.addEventListener('mouseleave', handleMouseHoldEnd);
        row.addEventListener('click', handleTaskClick);
    });
}

// --- Recalls ---
let recallSearchTimer = null;

function initRecallsPage() {
    const listEl = document.getElementById('recall-list');
    const modal = document.getElementById('recall-modal');
    if (!listEl || !modal) return; // Not on recalls page

    // If any legacy filter/helper blocks remain in DOM, hide them defensively
    ['recall-tag-cloud', 'recall-ai-input', 'recall-ai-results'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    document.querySelectorAll('.recall-filter-card, .recall-ai-card, .recalls-toolbar').forEach(el => {
        el.style.display = 'none';
    });

    const searchInput = document.getElementById('recall-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            recallState.filters.q = e.target.value.trim();
            scheduleRecallReload();
        });
    }

    const menuBtn = document.getElementById('recall-actions-btn');
    const menu = document.getElementById('recall-actions-menu');
    if (menuBtn && menu) {
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('open');
        });
        document.addEventListener('click', () => menu.classList.remove('open'));
    }
    const menuAI = document.getElementById('recall-menu-ai');
    if (menuAI) menuAI.addEventListener('click', () => { promptRecallAISearch(); menu?.classList.remove('open'); });
    const menuRefresh = document.getElementById('recall-menu-refresh');
    if (menuRefresh) menuRefresh.addEventListener('click', () => { loadRecalls(); menu?.classList.remove('open'); });
    const menuEdit = document.getElementById('recall-menu-edit');
    if (menuEdit) menuEdit.addEventListener('click', () => { editSelectedRecall(); menu?.classList.remove('open'); });

    // Toggle quick add panel
    const toggleAddBtn = document.getElementById('recall-toggle-add-btn');
    const quickAddPanel = document.getElementById('recall-quick-add-panel');
    if (toggleAddBtn && quickAddPanel) {
        toggleAddBtn.addEventListener('click', () => {
            quickAddPanel.classList.toggle('is-hidden');
            if (!quickAddPanel.classList.contains('is-hidden')) {
                const quickInput = document.getElementById('recall-quick-input');
                if (quickInput) quickInput.focus();
            }
        });
    }
    const quickAddCloseBtn = document.getElementById('recall-quick-add-close');
    if (quickAddCloseBtn && quickAddPanel) {
        quickAddCloseBtn.addEventListener('click', () => {
            quickAddPanel.classList.add('is-hidden');
        });
    }

    const quickAddBtn = document.getElementById('recall-quick-add-btn');
    if (quickAddBtn) quickAddBtn.addEventListener('click', handleRecallQuickAdd);
    const quickInput = document.getElementById('recall-quick-input');
    if (quickInput) {
        quickInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                await handleRecallQuickAdd();
            }
        });
    }
    const quickHelpBtn = document.getElementById('recall-quick-help-btn');
    if (quickHelpBtn) quickHelpBtn.addEventListener('click', toggleRecallQuickHelp);

    const saveBtn = document.getElementById('recall-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', saveRecall);
    const pinBtn = document.getElementById('recall-pin-btn');
    if (pinBtn) pinBtn.addEventListener('click', toggleSelectedRecallPin);
    const editBtn = document.getElementById('recall-edit-btn');
    if (editBtn) editBtn.addEventListener('click', editSelectedRecall);
    const deleteBtn = document.getElementById('recall-delete-btn');
    if (deleteBtn) deleteBtn.addEventListener('click', deleteSelectedRecall);

    loadRecalls();
}

function scheduleRecallReload() {
    if (recallSearchTimer) clearTimeout(recallSearchTimer);
    recallSearchTimer = setTimeout(() => loadRecalls(), 200);
}

function parseRecallQuickInput(text) {
    let raw = (text || '').trim();
    if (!raw) return null;
    const entry = { title: '', content: '', description: '', category: 'General', type: 'note', keywords: [], reminder_at: null };

    // Reminder: *YYYY-MM-DD or *YYYY-MM-DD HH:MM
    const reminderMatch = raw.match(/\*(\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?)/);
    if (reminderMatch) {
        entry.reminder_at = reminderMatch[1].trim();
        raw = raw.replace(reminderMatch[0], '').trim();
    }

    // Type: @link|@idea|@source|@note|@other
    const typeMatch = raw.match(/@(link|idea|source|note|other)/i);
    if (typeMatch) {
        entry.type = typeMatch[1].toLowerCase();
        raw = raw.replace(typeMatch[0], '').trim();
    }

    // Category: #Category
    const catMatch = raw.match(/#([A-Za-z0-9 _-]+)/);
    if (catMatch) {
        entry.category = catMatch[1].trim() || 'General';
        raw = raw.replace(catMatch[0], '').trim();
    }

    // Keywords: +word
    const keywordMatches = raw.match(/\+([A-Za-z0-9_-]+)/g) || [];
    if (keywordMatches.length) {
        entry.keywords = keywordMatches.map(k => k.substring(1));
        keywordMatches.forEach(k => { raw = raw.replace(k, '').trim(); });
    }

    // Description: :: Description text
    if (raw.includes('::')) {
        const parts = raw.split('::');
        entry.description = parts.slice(1).join('::').trim();
        raw = parts[0].trim();
    }

    // Split title ; content
    if (raw.includes(';')) {
        const parts = raw.split(';');
        entry.title = parts[0].trim();
        entry.content = parts.slice(1).join(';').trim();
    } else {
        entry.title = raw;
        entry.content = '';
    }

    // Source URL detection
    const urlMatch = (entry.content || raw).match(/https?:\/\/\S+/);
    if (urlMatch) {
        entry.source_url = urlMatch[0];
    }

    if (!entry.title) return null;
    return entry;
}

async function handleRecallQuickAdd() {
    const input = document.getElementById('recall-quick-input');
    if (!input) return;
    const parsed = parseRecallQuickInput(input.value);
    if (!parsed) return;
    const payload = {
        title: parsed.title,
        content: parsed.content,
        description: parsed.description,
        category: parsed.category,
        type: parsed.type,
        reminder_at: parsed.reminder_at,
        keywords: parsed.keywords,
        source_url: parsed.source_url
    };
    try {
        const res = await fetch('/api/recalls', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Create failed');
        input.value = '';
        await loadRecalls();
        // Close the quick add panel after successful add
        const quickAddPanel = document.getElementById('recall-quick-add-panel');
        if (quickAddPanel) quickAddPanel.classList.add('is-hidden');
    } catch (err) {
        console.error(err);
        showToast('Could not create recall.', 'error');
    }
}

function toggleRecallQuickHelp() {
    const guide = document.getElementById('recall-syntax-guide');
    if (!guide) return;
    const nowHidden = guide.classList.toggle('is-hidden');
    guide.style.display = nowHidden ? 'none' : 'block';
}

async function loadRecalls() {
    const listEl = document.getElementById('recall-list');
    if (listEl) listEl.innerHTML = '<div class=\"recall-empty\">Loading...</div>';
    const params = new URLSearchParams();
    const f = recallState.filters;
    if (f.q) params.set('q', f.q);
    if (f.status) params.set('status', f.status);
    try {
        const res = await fetch(`/api/recalls?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to load recalls');
        recallState.items = await res.json();

        // Check if there's a ?note= parameter in the URL to auto-select a recall
        const urlParams = new URLSearchParams(window.location.search);
        const targetNoteId = parseInt(urlParams.get('note'), 10);
        if (targetNoteId && !isNaN(targetNoteId)) {
            // Check if this recall exists in the loaded items
            const targetRecall = recallState.items.find(item => item.id === targetNoteId);
            if (targetRecall) {
                recallState.selectedId = targetNoteId;
            }
        }

        renderRecallList();
    } catch (err) {
        console.error(err);
        if (listEl) listEl.innerHTML = '<div class=\"recall-empty\">Could not load recalls.</div>';
    }
}

function renderRecallFilters() {
    // Reduced UI: no-op placeholder to avoid errors if called
}

function renderRecallList() {
    const container = document.getElementById('recall-list');
    if (!container) return;
    if (!recallState.items.length) {
        container.innerHTML = '<div class=\"recall-empty\"><i class=\"fa-solid fa-inbox\"></i><p>No recalls yet. Add one to get started.</p></div>';
        renderRecallDetail(null);
        return;
    }
    container.innerHTML = '';
    recallState.items.forEach(item => {
        const row = document.createElement('div');
        row.className = `recall-row ${item.pinned ? 'pinned' : ''} ${recallState.selectedId === item.id ? 'active' : ''} ${item.status === 'archived' ? 'archived' : ''}`;
        row.dataset.id = item.id;
        const snippet = (item.summary || item.description || item.content || '').slice(0, 100);
        const typeIcon = {
            'link': 'fa-link',
            'idea': 'fa-lightbulb',
            'source': 'fa-book',
            'note': 'fa-note-sticky',
            'other': 'fa-circle'
        }[item.type || 'note'] || 'fa-note-sticky';

        row.innerHTML = `
            <div class=\"recall-row-top\">
                <div class=\"recall-row-header\">
                    <i class=\"fa-solid ${typeIcon} recall-type-icon\"></i>
                    <div class=\"recall-row-title\">${recallEscape(item.title)}</div>
                </div>
                <div class=\"recall-pill\">${recallEscape(item.category || 'General')}</div>
            </div>
            ${snippet ? `<div class=\"recall-row-snippet\">${recallEscape(snippet)}${snippet.length >= 100 ? '...' : ''}</div>` : ''}
        `;
        row.addEventListener('click', () => selectRecall(item.id));
        row.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            recallState.selectedId = item.id;
            editSelectedRecall();
        });
        container.appendChild(row);
    });
    if (recallState.selectedId) {
        const selectedExists = recallState.items.some(i => i.id === recallState.selectedId);
        if (!selectedExists) {
            recallState.selectedId = null;
        }
    }
    // Don't auto-select first recall - keep detail box empty until user clicks
    renderRecallDetail(getSelectedRecall());
}

function selectRecall(id) {
    recallState.selectedId = id;
    renderRecallList();
}

function getSelectedRecall() {
    return recallState.items.find(i => i.id === recallState.selectedId) || null;
}

function editSelectedRecall() {
    const selected = getSelectedRecall();
    if (!selected) {
        showToast('Select a recall to edit.', 'info');
        return;
    }
    openRecallModal(selected);
}

function renderRecallDetail(item) {
    const empty = document.getElementById('recall-detail-empty');
    const body = document.getElementById('recall-detail-body');
    if (!empty || !body) return;
    if (!item) {
        empty.style.display = 'flex';
        body.style.display = 'none';
        return;
    }
    empty.style.display = 'none';
    body.style.display = 'block';

    // Build the detail view HTML
    const typeLabels = {
        'link': 'Link',
        'idea': 'Idea',
        'source': 'Source',
        'note': 'Note',
        'other': 'Other'
    };
    const typeIcons = {
        'link': 'fa-link',
        'idea': 'fa-lightbulb',
        'source': 'fa-book',
        'note': 'fa-note-sticky',
        'other': 'fa-circle'
    };
    const typeLabel = typeLabels[item.type] || 'Note';
    const typeIcon = typeIcons[item.type] || 'fa-note-sticky';

    let detailHTML = `
        <div class=\"recall-detail-header\">
            <div class=\"recall-detail-header-left\">
                ${item.pinned ? '<i class=\"fa-solid fa-thumbtack recall-pin-icon\" title=\"Pinned\"></i>' : ''}
                <h2>${recallEscape(item.title)}</h2>
            </div>
            <div class=\"recall-actions\">
                <button class=\"btn btn-secondary btn-small recall-pin-btn\" id=\"recall-pin-btn\" title=\"${item.pinned ? 'Unpin' : 'Pin'}\">
                    <i class=\"fa-solid fa-thumbtack\"></i><span class=\"btn-text\">${item.pinned ? 'Unpin' : 'Pin'}</span>
                </button>
                <button class=\"btn btn-small recall-edit-btn\" id=\"recall-edit-btn\" title=\"Edit\">
                    <i class=\"fa-solid fa-pen\"></i><span class=\"btn-text\">Edit</span>
                </button>
                <button class=\"btn btn-danger btn-small recall-delete-btn\" id=\"recall-delete-btn\" title=\"Delete\">
                    <i class=\"fa-solid fa-trash\"></i><span class=\"btn-text\">Delete</span>
                </button>
            </div>
        </div>

        <div class=\"recall-detail-meta\">
            <span class=\"pill recall-type-pill\"><i class=\"fa-solid ${typeIcon}\"></i> ${typeLabel}</span>
            <span class=\"pill recall-category-pill\">${recallEscape(item.category || 'General')}</span>
            ${item.priority && item.priority !== 'medium' ? `<span class=\"pill priority-${item.priority}\">${recallEscape(item.priority).toUpperCase()}</span>` : ''}
            ${item.status && item.status !== 'active' ? `<span class=\"pill\">${recallEscape(item.status).toUpperCase()}</span>` : ''}
        </div>

        ${item.description ? `
        <div class=\"recall-detail-section\">
            <h3 class=\"recall-section-title\">Description</h3>
            <div class=\"recall-detail-content\">${recallEscape(item.description)}</div>
        </div>` : ''}

        ${item.content ? `
        <div class=\"recall-detail-section\">
            <h3 class=\"recall-section-title\">Content</h3>
            <div class=\"recall-detail-content\">${linkifyRecallContent(item.content)}</div>
        </div>` : ''}

        ${item.source_url ? `
        <div class=\"recall-detail-section\">
            <h3 class=\"recall-section-title\">Source</h3>
            <a href=\"${recallEscape(item.source_url)}\" target=\"_blank\" rel=\"noopener\" class=\"recall-source-link\">
                <i class=\"fa-solid fa-external-link-alt\"></i> ${recallEscape(item.source_url)}
            </a>
        </div>` : ''}

        ${item.summary ? `
        <div class=\"recall-summary-section\">
            <div class=\"recall-summary\">${recallEscape(item.summary)}</div>
        </div>` : ''}

        ${item.reminder_at ? `
        <div class=\"recall-detail-section\">
            <h3 class=\"recall-section-title\">Reminder</h3>
            <div class=\"recall-reminder-info\">
                <i class=\"fa-solid fa-bell\"></i> ${formatRecallDate(item.reminder_at)}
            </div>
        </div>` : ''}

        ${item.updated_at ? `
        <div class=\"recall-detail-footer\">
            <span class=\"recall-timestamp\">Last updated: ${formatRecallDate(item.updated_at)}</span>
        </div>` : ''}
    `;

    body.innerHTML = detailHTML;

    // Re-attach event listeners
    const pinBtn = document.getElementById('recall-pin-btn');
    const editBtn = document.getElementById('recall-edit-btn');
    const deleteBtn = document.getElementById('recall-delete-btn');
    if (pinBtn) pinBtn.addEventListener('click', toggleSelectedRecallPin);
    if (editBtn) editBtn.addEventListener('click', editSelectedRecall);
    if (deleteBtn) deleteBtn.addEventListener('click', deleteSelectedRecall);
}

function openRecallModal(item = null) {
    const modal = document.getElementById('recall-modal');
    if (!modal) return;
    recallState.editingId = item ? item.id : null;
    const title = document.getElementById('recall-modal-title');
    const titleInput = document.getElementById('recall-title-input');
    const categoryInput = document.getElementById('recall-category-input');
    const typeInput = document.getElementById('recall-type-input');
    const priorityInput = document.getElementById('recall-priority-input');
    const statusInput = document.getElementById('recall-status-input');
    const pinnedInput = document.getElementById('recall-pinned-input');
    const contentInput = document.getElementById('recall-content-input');
    const descriptionInput = document.getElementById('recall-description-input');
    const summaryInput = document.getElementById('recall-summary-input');
    const tagsInput = document.getElementById('recall-tags-input');
    const sourceInput = document.getElementById('recall-source-input');
    const reminderInput = document.getElementById('recall-reminder-input');

    if (title) title.textContent = item ? 'Edit Recall' : 'New Recall';
    if (titleInput) titleInput.value = item ? item.title : '';
    if (categoryInput) categoryInput.value = item ? item.category : 'General';
    if (typeInput) typeInput.value = item ? item.type : 'note';
    if (priorityInput) priorityInput.value = item ? item.priority : 'medium';
    if (statusInput) statusInput.value = item ? item.status : 'active';
    if (pinnedInput) pinnedInput.checked = item ? !!item.pinned : false;
    if (contentInput) contentInput.value = item ? (item.content || '') : '';
    if (descriptionInput) descriptionInput.value = item ? (item.description || '') : '';
    if (summaryInput) summaryInput.value = item ? (item.summary || '') : '';
    if (tagsInput) tagsInput.value = item ? (item.tags || []).join(', ') : '';
    if (sourceInput) sourceInput.value = item ? (item.source_url || '') : '';
    if (reminderInput) reminderInput.value = item && item.reminder_at ? item.reminder_at.slice(0, 16) : '';

    modal.classList.add('active');
    if (titleInput) titleInput.focus();
}

function closeRecallModal() {
    const modal = document.getElementById('recall-modal');
    if (modal) modal.classList.remove('active');
    recallState.editingId = null;
}

async function saveRecall() {
    const titleInput = document.getElementById('recall-title-input');
    if (!titleInput || !titleInput.value.trim()) return;
    const payload = {
        title: titleInput.value.trim(),
        category: document.getElementById('recall-category-input')?.value || 'General',
        type: document.getElementById('recall-type-input')?.value || 'note',
        pinned: document.getElementById('recall-pinned-input')?.checked || false,
        content: document.getElementById('recall-content-input')?.value || '',
        description: document.getElementById('recall-description-input')?.value || '',
        keywords: document.getElementById('recall-tags-input')?.value || '',
        source_url: document.getElementById('recall-source-input')?.value || '',
        reminder_at: document.getElementById('recall-reminder-input')?.value || '',
    };
    const isEdit = !!recallState.editingId;
    const url = isEdit ? `/api/recalls/${recallState.editingId}` : '/api/recalls';
    try {
        const res = await fetch(url, {
            method: isEdit ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Save failed');
        const saved = await res.json();
        recallState.editingId = null;
        closeRecallModal();
        await loadRecalls();
        recallState.selectedId = saved.id;
        renderRecallList();
    } catch (err) {
        console.error(err);
        showToast('Could not save recall. Please try again.', 'error');
    }
}

async function deleteSelectedRecall() {
    const target = getSelectedRecall();
    if (!target) return;
    openConfirmModal('Delete this recall?', async () => {
        try {
            const res = await fetch(`/api/recalls/${target.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            recallState.selectedId = null;
            await loadRecalls();
            closeConfirmModal();
        } catch (err) {
            console.error(err);
            showToast('Could not delete recall.', 'error');
            closeConfirmModal();
        }
    });
}

async function toggleSelectedRecallPin() {
    const target = getSelectedRecall();
    if (!target) return;
    try {
        const res = await fetch(`/api/recalls/${target.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pinned: !target.pinned })
        });
        if (!res.ok) throw new Error('Failed to update pin');
        await loadRecalls();
        recallState.selectedId = target.id;
    } catch (err) {
        console.error(err);
    }
}

async function runRecallAISearch() {
    const input = document.getElementById('recall-ai-input');
    const text = input ? (input.value || '').trim() : '';
    if (!text) return;
    await runRecallAISearchWithQuery(text);
}

function promptRecallAISearch() {
    // Open AI panel with a pre-filled recall search prompt
    const panel = document.getElementById('ai-panel');
    const input = document.getElementById('ai-input');
    if (!panel || !input) return;

    // Pre-fill the input with a recall search prompt
    input.value = 'Find recalls about ';

    // Open the panel
    if (!panel.classList.contains('open')) {
        toggleAIPanel();
    }

    // Focus and position cursor at the end
    setTimeout(() => {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }, 100);
}

async function runRecallAISearchWithQuery(query) {
    try {
        const res = await fetch('/api/recalls/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, limit: 6 })
        });
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        recallState.aiResults = data.results || [];
        if (recallState.aiResults.length) {
            recallState.selectedId = recallState.aiResults[0].id;
            renderRecallList();
        } else {
            showToast('No matching recalls found.', 'info');
        }
    } catch (err) {
        console.error(err);
        showToast('Recall AI search failed.', 'error');
    }
}

function renderRecallAIResults() {
    // AI results list removed from UI on simplified recall page
}

function formatRecallDate(val) {
    try {
        return new Date(val).toLocaleString();
    } catch (e) {
        return val;
    }
}

function recallEscape(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function linkifyRecallContent(str) {
    if (!str) return '';
    // First escape HTML
    const escaped = recallEscape(str);
    // Then convert URLs to clickable links
    const urlPattern = /(https?:\/\/[^\s<]+)/g;
    return escaped.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener" class="recall-content-link">$1</a>');
}

// --- AI Assistant ---
let aiMessages = [];
let aiSending = false;
let aiTyping = false;
const AI_STORAGE_KEY = 'ai-messages';
let aiRecognition = null;
let aiVoiceActive = false;
let aiVoiceUserStop = false;
let aiVoiceBaseText = '';
let aiVoiceContext = 'panel';
let aiRecorder = null;
let aiRecorderStream = null;
let aiRecorderChunks = [];
let aiRecorderActive = false;
let aiRecorderContext = 'panel';
let aiRecorderBaseText = '';
let aiRecorderTranscript = '';
const USE_SERVER_STT_ALWAYS = true; // Force server STT to avoid native auto-stopping
const SERVER_STT_CHUNK_MS = 10000; // send chunks every 10s

function isSecureVoiceContext() {
    // getUserMedia typically requires HTTPS or localhost
    return window.isSecureContext || ['https:', 'file:'].includes(location.protocol) ||
        location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

function loadAIMessagesFromStorage() {
    try {
        const raw = localStorage.getItem(AI_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function saveAIMessagesToStorage() {
    try {
        localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(aiMessages));
    } catch (e) {
        // ignore storage errors
    }
}

function getAIInputByContext(context) {
    const inputId = context === 'page' ? 'ai-page-input' : 'ai-input';
    return document.getElementById(inputId);
}

function setAIMicButtonState(active, context) {
    const btn = context === 'page'
        ? document.querySelector('#ai-page-send')?.previousElementSibling
        : document.querySelector('#ai-panel .ai-mic-btn');
    if (!btn) return;
    btn.classList.toggle('listening', active);
}

function ensureRecognition() {
    if (aiRecognition) return aiRecognition;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;
    aiRecognition = new SpeechRecognition();
    aiRecognition.lang = navigator.language || 'en-US';
    aiRecognition.continuous = true;
    aiRecognition.interimResults = true;
    aiRecognition.onresult = (event) => {
        const input = getAIInputByContext(aiVoiceContext);
        if (!input) return;
        let finalText = '';
        let interimText = '';
        for (let i = 0; i < event.results.length; i++) {
            const res = event.results[i];
            if (res.isFinal) finalText += res[0].transcript;
            else interimText += res[0].transcript;
        }
        input.value = `${aiVoiceBaseText}${finalText}${interimText}`.trimStart();
    };
    aiRecognition.onerror = (e) => {
        console.error('Speech recognition error:', e);
        aiVoiceActive = false;
        setAIMicButtonState(false, aiVoiceContext);
    };
    aiRecognition.onstart = () => {
        aiVoiceActive = true;
        setAIMicButtonState(true, aiVoiceContext);
    };
    aiRecognition.onend = () => {
        if (aiVoiceUserStop) {
            aiVoiceActive = false;
            setAIMicButtonState(false, aiVoiceContext);
            return;
        }
        // Keep listening; avoid silence auto-stop
        try {
            aiRecognition.start();
        } catch (err) {
            console.error('Failed to restart speech recognition:', err);
            aiVoiceActive = false;
            setAIMicButtonState(false, aiVoiceContext);
        }
    };
    return aiRecognition;
}

function toggleAIVoice(context = 'panel') {
    aiVoiceContext = context || 'panel';
    const recognition = ensureRecognition();
    const hasNative = !USE_SERVER_STT_ALWAYS && !!recognition;
    const hasMediaRecorder = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

    // If native speech is available, prefer it
    if (!hasNative && !hasMediaRecorder) {
        showToast('Speech recognition is not available in this environment.', 'warning');
        return;
    }

    if (!hasNative && hasMediaRecorder) {
        // Fallback to server STT with recording
        if (aiRecorderActive) {
            stopServerVoice();
        } else {
            startServerVoice(aiVoiceContext);
        }
        return;
    }

    if (aiVoiceActive) {
        aiVoiceUserStop = true;
        try { recognition.stop(); } catch (e) { /* ignore */ }
        aiVoiceActive = false;
        setAIMicButtonState(false, aiVoiceContext);
        return;
    }

    const input = getAIInputByContext(aiVoiceContext);
    if (!input) return;
    aiVoiceBaseText = input.value ? `${input.value.trim()} ` : '';
    aiVoiceUserStop = false;
    try {
        recognition.start();
    } catch (e) {
        console.error('Failed to start speech recognition:', e);
        aiVoiceActive = false;
        setAIMicButtonState(false, aiVoiceContext);
    }
}

function startServerVoice(context = 'panel') {
    aiRecorderContext = context || 'panel';
    const input = getAIInputByContext(aiRecorderContext);
    if (!input) return;
    aiRecorderBaseText = input.value ? input.value.trim() : '';
    aiRecorderTranscript = aiRecorderBaseText;

    if (!isSecureVoiceContext()) {
        showToast('Microphone access is blocked because this page is not served over HTTPS/localhost. Use HTTPS or the installed app.', 'warning');
        return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Microphone is not available in this environment.', 'warning');
        return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        aiRecorderStream = stream;
        aiRecorderChunks = [];

        // Configure MediaRecorder with options for better compatibility
        let options = { mimeType: 'audio/webm' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options = { mimeType: 'audio/ogg' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options = {};
            }
        }

        aiRecorder = new MediaRecorder(stream, options);
        console.log('MediaRecorder started with mimeType:', aiRecorder.mimeType);

        aiRecorder.ondataavailable = (e) => {
            console.log('Data available event fired, size:', e.data.size);
            if (e.data && e.data.size > 0) {
                // Accumulate chunks instead of transcribing immediately
                aiRecorderChunks.push(e.data);
                console.log('Chunk accumulated. Total chunks:', aiRecorderChunks.length);
            } else {
                console.warn('Empty chunk received');
            }
        };

        aiRecorder.onstart = () => {
            console.log('MediaRecorder started successfully');
        };

        aiRecorder.onerror = (e) => {
            console.error('MediaRecorder error:', e);
        };

        aiRecorder.onstop = () => {
            console.log('MediaRecorder stopped');
            aiRecorderActive = false;
            setAIMicButtonState(false, aiRecorderContext);

            // Transcribe all accumulated chunks as one complete audio
            if (aiRecorderChunks.length > 0) {
                console.log('Transcribing', aiRecorderChunks.length, 'accumulated chunks');
                const completeBlob = new Blob(aiRecorderChunks, { type: aiRecorder.mimeType });
                transcribeServerAudioChunk(completeBlob, aiRecorderContext);
            }

            stopServerVoiceStream();
        };

        // Start with timeslice to ensure continuous chunk generation regardless of pauses
        aiRecorder.start(SERVER_STT_CHUNK_MS);
        aiRecorderActive = true;
        setAIMicButtonState(true, aiRecorderContext);
    }).catch(err => {
        console.error('Unable to access microphone:', err);
        showToast('Could not access the microphone. Please check permissions.', 'error');
    });
}

function stopServerVoiceStream() {
    if (aiRecorderStream) {
        aiRecorderStream.getTracks().forEach(t => t.stop());
        aiRecorderStream = null;
    }
    aiRecorder = null;
    // Clear chunks after transcription is done
    aiRecorderChunks = [];
}

function stopServerVoice() {
    if (aiRecorder) {
        try { aiRecorder.stop(); } catch (e) { /* ignore */ }
        // Don't clear chunks here - let onstop handler use them first
    } else {
        stopServerVoiceStream();
        aiRecorderActive = false;
        setAIMicButtonState(false, aiRecorderContext);
    }
}

async function transcribeServerAudioChunk(blob, context) {
    const formData = new FormData();
    formData.append('audio', blob, 'audio.webm');
    console.log('Sending STT chunk - bytes:', blob.size, 'type:', blob.type);
    try {
        const res = await fetch('/api/ai/stt', {
            method: 'POST',
            body: formData
        });
        console.log('STT response status:', res.status);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error('STT failed with status', res.status, ':', err);
        } else {
            const data = await res.json();
            const transcript = data.text || '';
            console.log('STT chunk transcript:', transcript.length, 'chars - "' + transcript + '"');
            appendTranscript(context, transcript);
        }
    } catch (e) {
        console.error('Transcription error:', e);
    }
}

function appendTranscript(context, text) {
    console.log('appendTranscript called with text:', text);
    if (!text) {
        console.warn('appendTranscript: no text provided');
        return;
    }
    const input = getAIInputByContext(context);
    if (!input) {
        console.error('appendTranscript: no input found for context', context);
        return;
    }
    const current = aiRecorderTranscript || input.value || '';
    const appended = `${current} ${text}`.replace(/\s+/g, ' ').trim();
    console.log('Appending transcript - before:', current.length, 'chars, after:', appended.length, 'chars');
    aiRecorderTranscript = appended;
    input.value = appended;
}

function toggleAIPanel() {
    const panel = document.getElementById('ai-panel');
    if (!panel) return;
    if (!aiMessages.length) {
        aiMessages = loadAIMessagesFromStorage();
    }
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
        const input = document.getElementById('ai-input');
        if (input) input.focus();
    }
}

function formatAIMessage(text) {
    // Convert markdown-style formatting to HTML
    let formatted = text;

    // Convert markdown links [text](url) to HTML <a> tags (must be done before other conversions)
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="ai-link">$1</a>');

    // Convert **📋 Project:** to styled project header
    formatted = formatted.replace(/\*\*📋 Project: (.+?)\*\*/g, '<strong class="ai-project-header">📋 Project: $1</strong>');

    // Convert **▶ Phase:** to styled phase header
    formatted = formatted.replace(/\*\*▶ Phase: (.+?)\*\*/g, '<strong class="ai-phase-header">▶ Phase: $1</strong>');

    // Convert remaining **text** to <strong>text</strong>
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Convert newlines to <br>
    formatted = formatted.replace(/\n/g, '<br>');

    // Style status badges (must be before bullet conversion)
    formatted = formatted.replace(/\[○\]/g, '<span class="ai-status ai-status-todo">○</span>');
    formatted = formatted.replace(/\[◐\]/g, '<span class="ai-status ai-status-progress">◐</span>');
    formatted = formatted.replace(/\[✓\]/g, '<span class="ai-status ai-status-done">✓</span>');

    // Convert bullet points with proper indentation
    formatted = formatted.replace(/^-\s/gm, '<span class="ai-bullet">- </span>');
    formatted = formatted.replace(/<br>-\s/g, '<br><span class="ai-bullet">- </span>');

    // Add spacing for double line breaks
    formatted = formatted.replace(/(<br>){2,}/g, '<br><br>');

    return formatted;
}

function renderAIMessages(context = 'panel') {
    const containerId = context === 'page' ? 'ai-page-messages' : 'ai-messages';
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    aiMessages.forEach(m => {
        const div = document.createElement('div');
        div.className = `ai-msg ${m.role === 'user' ? 'user' : 'ai'}`;

        if (m.role === 'assistant') {
            // Format assistant messages with HTML
            div.innerHTML = formatAIMessage(m.content);
        } else {
            // User messages remain as plain text
            div.textContent = m.content;
        }

        container.appendChild(div);
    });
    if (aiTyping) {
        const typing = document.createElement('div');
        typing.className = 'ai-typing';
        typing.innerHTML = `<span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span>`;
        container.appendChild(typing);
    }
    container.scrollTop = container.scrollHeight;
    saveAIMessagesToStorage();
}

async function sendAIPrompt(context = 'panel') {
    if (aiSending) return;
    const inputId = context === 'page' ? 'ai-page-input' : 'ai-input';
    const input = document.getElementById(inputId);
    if (!input) return;
    const text = (input.value || '').trim();
    if (!text) return;

    aiSending = true;
    aiTyping = true;
    aiMessages.push({ role: 'user', content: text });
    renderAIMessages(context);
    input.value = '';

    try {
        const res = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: aiMessages })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            aiMessages.push({ role: 'assistant', content: `Error: ${err.error || 'Request failed'}` });
        } else {
            const data = await res.json();
            const reply = data.reply || 'No reply';
            aiMessages.push({ role: 'assistant', content: reply });
        }
    } catch (e) {
        aiMessages.push({ role: 'assistant', content: 'Error contacting AI.' });
    } finally {
        aiSending = false;
        aiTyping = false;
        renderAIMessages(context);
        saveAIMessagesToStorage();
    }
}

function clearAIConversation() {
    openConfirmModal('Clear all AI conversation history? This cannot be undone.', () => {
        aiMessages = [];
        saveAIMessagesToStorage();

        // Re-render both contexts in case both are visible
        const panelMessages = document.getElementById('ai-messages');
        const pageMessages = document.getElementById('ai-page-messages');
        if (panelMessages) renderAIMessages('panel');
        if (pageMessages) renderAIMessages('page');

        showToast('AI conversation cleared. Start a new conversation to use the updated AI instructions.', 'success', 5000);
        closeConfirmModal();
    });
}

function openFullAIPage() {
    if (!aiMessages.length) {
        aiMessages = loadAIMessagesFromStorage();
    }
    saveAIMessagesToStorage();
    window.location.href = '/ai';
}

function initAIPanel() {
    if (!aiMessages.length) {
        aiMessages = loadAIMessagesFromStorage();
    }
    renderAIMessages('panel');
}

function initAIDragLauncher() {
    const launcher = document.querySelector('.ai-launcher');
    if (!launcher) return;

    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let baseX = 0;
    let baseY = 0;
    let dragMoved = false;

    const parseTranslate = (el) => {
        const value = window.getComputedStyle(el).transform;
        if (!value || value === 'none') return { x: 0, y: 0 };
        if (typeof DOMMatrixReadOnly !== 'undefined') {
            const matrix = new DOMMatrixReadOnly(value);
            return { x: matrix.m41, y: matrix.m42 };
        }
        const match = value.match(/matrix\(([^)]+)\)/);
        if (!match) return { x: 0, y: 0 };
        const parts = match[1].split(',').map(Number);
        return { x: parts[4] || 0, y: parts[5] || 0 };
    };

    launcher.addEventListener('pointerdown', (e) => {
        pointerId = e.pointerId;
        launcher.setPointerCapture(pointerId);
        const pos = parseTranslate(launcher);
        baseX = pos.x;
        baseY = pos.y;
        startX = e.clientX;
        startY = e.clientY;
        dragMoved = false;
        launcher.classList.add('dragging');
    });

    launcher.addEventListener('pointermove', (e) => {
        if (pointerId === null || e.pointerId !== pointerId) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
            dragMoved = true;
        }

        const rect = launcher.getBoundingClientRect();
        const padding = 8;
        const minDx = padding - rect.left;
        const maxDx = window.innerWidth - padding - rect.right;
        const minDy = padding - rect.top;
        const maxDy = window.innerHeight - padding - rect.bottom;

        const clampedDx = Math.max(minDx, Math.min(maxDx, dx));
        const clampedDy = Math.max(minDy, Math.min(maxDy, dy));

        launcher.style.transform = `translate(${baseX + clampedDx}px, ${baseY + clampedDy}px)`;
    });

    const endDrag = (e) => {
        if (pointerId === null || e.pointerId !== pointerId) return;
        launcher.releasePointerCapture(pointerId);
        pointerId = null;
        launcher.classList.remove('dragging');
        if (dragMoved) {
            launcher.dataset.justDragged = 'true';
            window.setTimeout(() => {
                delete launcher.dataset.justDragged;
            }, 0);
        }
    };

    launcher.addEventListener('pointerup', endDrag);
    launcher.addEventListener('pointercancel', endDrag);

    launcher.addEventListener('click', (e) => {
        if (launcher.dataset.justDragged) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, true);
}

function initAIPage() {
    aiMessages = loadAIMessagesFromStorage();
    const pageMessages = document.getElementById('ai-page-messages');
    const pageInput = document.getElementById('ai-page-input');
    const pageSend = document.getElementById('ai-page-send');
    if (!pageMessages || !pageInput || !pageSend) return;
    renderAIMessages('page');
    pageSend.addEventListener('click', () => sendAIPrompt('page'));
    pageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            sendAIPrompt('page');
        }
    });
}
