// DOM Elements & State
const listsGrid = document.getElementById('lists-grid');
const createModal = document.getElementById('create-modal');
const addItemModal = document.getElementById('add-item-modal');
const bulkImportModal = document.getElementById('bulk-import-modal');
const moveItemModal = document.getElementById('move-item-modal');
const phaseMenu = document.getElementById('phase-menu');
const selectedItems = new Set();
const confirmModal = document.getElementById('confirm-modal');
const confirmMessage = document.getElementById('confirm-message');
const confirmYesButton = document.getElementById('confirm-yes-button');
let pendingConfirm = null;
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
let notesState = { notes: [], activeNoteId: null, dirty: false, activeSnapshot: null };
let noteAutoSaveTimer = null;
let noteAutoSaveInFlight = false;
let currentTaskFilter = 'all';
let calendarState = { selectedDay: null, events: [], monthCursor: null, monthEventsByDay: {}, dayViewOpen: false, detailsOpen: false };
let calendarReminderTimers = {};
let calendarNotifyEnabled = false;
let calendarPrompt = { resolve: null, reject: null, onSubmit: null };
let datePickerState = { itemId: null };
let linkNoteModalState = { targetType: 'task', targetId: null, targetTitle: '', selectedNoteId: null, notes: [], existingNoteIds: [] };
const USER_TIMEZONE = window.USER_TIMEZONE || 'America/New_York'; // EST/EDT
let notificationsState = { items: [], unread: 0, open: false };

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

    } catch (e) {
        console.error('Error loading lists:', e);
    }
}

function renderListCard(list) {
    const cardColorVar = list.type === 'hub' ? 'var(--accent-color)' : 'var(--primary-color)';
    const progress = list.progress || 0;
    const items = (list.items || []).filter(i => !i.is_phase);
    const itemCount = items.length;
    const doneCount = items.filter(i => i.status === 'done').length;

    return `
        <a href="/list/${list.id}" class="card" style="border-top-color: ${cardColorVar};">
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
    menu.querySelectorAll('.task-filter-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            setTaskFilter(btn.dataset.filter);
            closeTaskFilterMenu();
        });
    });
    setTaskFilter(currentTaskFilter);
}

function setTaskFilter(filter) {
    const menu = document.getElementById('task-filter-menu');
    if (!menu) return;
    currentTaskFilter = filter || 'all';
    menu.querySelectorAll('.task-filter-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === currentTaskFilter);
    });
    const label = document.getElementById('task-filter-label');
    if (label) {
        const active = menu.querySelector(`.task-filter-item[data-filter="${currentTaskFilter}"]`);
        label.textContent = active ? active.textContent.trim() : 'All Tasks';
    }
    applyTaskFilter();
}

function applyTaskFilter() {
    const items = Array.from(document.querySelectorAll('.task-item'));
    if (!items.length) return;
    const phaseVisibility = new Map();

    items.forEach(item => {
        if (item.classList.contains('phase')) return;
        const status = item.dataset.status;
        const matches = currentTaskFilter === 'all' || status === currentTaskFilter;
        item.classList.toggle('hidden-by-filter', !matches);
        if (matches) {
            const phaseParent = item.dataset.phaseParent;
            if (phaseParent) phaseVisibility.set(phaseParent, true);
        }
    });

    items.forEach(item => {
        if (!item.classList.contains('phase')) return;
        const phaseId = item.dataset.phaseId;
        const showPhase = currentTaskFilter === 'all' || phaseVisibility.get(phaseId);
        item.classList.toggle('hidden-by-filter', !showPhase);
    });
}

function toggleTaskFilterMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('task-filter-menu');
    if (menu) menu.classList.toggle('show');
}

function closeTaskFilterMenu() {
    const menu = document.getElementById('task-filter-menu');
    if (menu) menu.classList.remove('show');
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

function openEditItemModal(itemId, content, description, notes) {
    const modal = document.getElementById('edit-item-modal');
    document.getElementById('edit-item-id').value = itemId;
    document.getElementById('edit-item-content').value = content;
    document.getElementById('edit-item-description').value = description || '';
    document.getElementById('edit-item-notes').value = notes || '';
    modal.classList.add('active');
}

function closeEditItemModal() {
    const modal = document.getElementById('edit-item-modal');
    modal.classList.remove('active');
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

    if (!content) return;

    try {
        const res = await fetch(`/api/items/${itemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, description, notes })
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
    const totalCheckboxes = document.querySelectorAll('.select-item').length;

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
        selectAll.checked = totalCheckboxes > 0 && selectedItems.size === totalCheckboxes;
        selectAll.indeterminate = selectedItems.size > 0 && selectedItems.size < totalCheckboxes;
    }
    // Prevent layout jump when bar appears
    window.scrollTo(0, scrollY);
}

function cascadePhaseSelection(phaseElement, isChecked) {
    const items = Array.from(document.querySelectorAll('.task-item'));
    // Find the index of the phase element that was clicked
    const startIdx = items.indexOf(phaseElement);
    if (startIdx === -1) return;

    for (let i = startIdx + 1; i < items.length; i++) {
        const el = items[i];
        if (el.classList.contains('phase')) break;
        const cb = el.querySelector('.select-item');
        // This function is only for cascading changes, so we directly manipulate
        // the checkbox state and the underlying selectedItems set.
        if (cb) {
            cb.checked = isChecked;
            const id = parseInt(cb.getAttribute('data-item-id'), 10);
            if (isChecked) selectedItems.add(id);
            else selectedItems.delete(id);
        }
    }
}

function toggleSelectItem(itemId, isChecked, skipPhaseCascade = false) {
    const row = document.getElementById(`item-${itemId}`);
    const isPhase = row && row.classList.contains('phase');

    if (isPhase && !skipPhaseCascade) {
        // If a phase is clicked directly, also select/deselect its children
        cascadePhaseSelection(row, isChecked);
    }

    // Add or remove the main item (or phase item) itself
    if (isChecked) {
        selectedItems.add(itemId);
    } else {
        selectedItems.delete(itemId);
    }

    updateBulkBar();
}

function toggleSelectAll(checkbox) {
    selectedItems.clear();
    const checkboxes = document.querySelectorAll('.select-item');
    checkboxes.forEach(cb => {
        cb.checked = checkbox.checked;
        const id = parseInt(cb.getAttribute('data-item-id'), 10);
        if (checkbox.checked) selectedItems.add(id); else selectedItems.delete(id);
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

// --- Drag & Drop Reorder ---

function getDragAfterElement(container, y) {
    const elements = [...container.querySelectorAll('.task-item:not(.dragging)')];
    return elements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

function handleDragStart(e) {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
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
    const afterElement = getDragAfterElement(container, e.clientY);
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
    // Don't trigger long press if dragging
    if (e.target.closest('.drag-handle')) return;

    longPressTimer = setTimeout(() => {
        longPressTimer = null; // Prevent multiple triggers
        const itemId = parseInt(item.dataset.itemId, 10);
        const checkbox = item.querySelector('.select-item');
        
        // Enter selection mode and select the item
        document.body.classList.add('selection-mode-active');
        if (checkbox && !checkbox.checked) {
            checkbox.checked = true;
            toggleSelectItem(itemId, true);
            longPressTriggered = true;
        }
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
        longPressTriggered = false;
        return;
    }
    // If we are in selection mode, a short tap should toggle selection
    if (document.body.classList.contains('selection-mode-active')) {
        // Prevent click event from also firing and toggling again
        e.preventDefault();
        const item = e.currentTarget;
        const checkbox = item.querySelector('.select-item');
        if (checkbox) {
            checkbox.click(); // Programmatically toggle the checkbox to trigger its onchange
        }
    }
}

// Touch drag for mobile (reorder)
function touchHandleDragStart(e) {
    const handle = e.currentTarget;
    const itemId = handle.getAttribute('data-drag-id');
    if (!itemId) return;
    touchDragActive = true;
    touchDragId = itemId;
    touchDragBlock = [];
    const row = document.getElementById(`item-${itemId}`);
    if (row) {
        const isPhase = row.classList.contains('phase');
        if (isPhase) {
            const siblings = Array.from(document.querySelectorAll('.task-item'));
            const startIdx = siblings.indexOf(row);
            for (let i = startIdx; i < siblings.length; i++) {
                const el = siblings[i];
                if (i > startIdx && el.classList.contains('phase')) break;
                touchDragBlock.push(el);
                el.classList.add('dragging');
            }
        } else {
            touchDragBlock.push(row);
            row.classList.add('dragging');
        }
    }
    e.preventDefault();
}

function touchHandleDragMove(e) {
    if (!touchDragActive || !touchDragBlock.length) return;
    if (!e.touches || !e.touches.length) return;
    const y = e.touches[0].clientY;
    const container = document.getElementById('items-container');
    if (!container) return;
    const afterElement = getDragAfterElement(container, y);

    // Remove current block to reinsert
    touchDragBlock.forEach(el => {
        if (el.parentElement === container) {
            container.removeChild(el);
        }
    });

    if (afterElement == null) {
        touchDragBlock.forEach(el => container.appendChild(el));
    } else {
        touchDragBlock.forEach(el => container.insertBefore(el, afterElement));
    }
    e.preventDefault();
}

async function touchHandleDragEnd(e) {
    if (!touchDragActive) return;
    touchDragActive = false;
    touchDragId = null;
    await commitOrderFromDOM();
    touchDragBlock.forEach(el => el.classList.remove('dragging'));
    touchDragBlock = [];
}

// --- Phase Visibility ---

function getPhaseVisibilityKey() {
    if (typeof CURRENT_LIST_ID === 'undefined') return null;
    return `phase-visibility-${CURRENT_LIST_ID}`;
}

function applyPhaseVisibility(phaseId, collapsed) {
    const phaseEl = document.querySelector(`.task-item.phase[data-phase-id='${phaseId}']`);
    if (!phaseEl) return;
    phaseEl.classList.toggle('phase-collapsed', collapsed);

    const icon = phaseEl.querySelector('.phase-toggle i');
    if (icon) {
        icon.className = collapsed ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
    }

    const phaseIdStr = String(phaseId);

    // Primary: hide/show tasks explicitly assigned to this phase
    document.querySelectorAll(`.task-item[data-phase-parent='${phaseIdStr}']`).forEach(el => {
        el.classList.toggle('hidden-by-phase', collapsed);
    });

    // Fallback: also hide tasks visually under this phase that lack a parent attribute
    // but are marked as under-phase, stopping at the next phase header or an item
    // explicitly tied to another phase.
    let sibling = phaseEl.nextElementSibling;
    while (sibling && !sibling.classList.contains('phase')) {
        const parentAttr = sibling.getAttribute('data-phase-parent') || '';
        const isUnderPhase = sibling.classList.contains('under-phase');

        if (parentAttr) {
            if (parentAttr !== phaseIdStr) break; // belongs to another phase
            sibling.classList.toggle('hidden-by-phase', collapsed);
        } else if (isUnderPhase) {
            sibling.classList.toggle('hidden-by-phase', collapsed);
        } else {
            break; // not under this phase, stop scanning
        }

        sibling = sibling.nextElementSibling;
    }
}

function normalizePhaseParents() {
    const items = Array.from(document.querySelectorAll('.task-item'));
    let currentPhaseId = null;

    items.forEach(el => {
        const isPhase = el.classList.contains('phase');
        if (isPhase) {
            currentPhaseId = el.dataset.phaseId || null;
            return;
        }

        // Only set when missing/empty to avoid overwriting real data
        const existingParent = el.dataset.phaseParent;
        if (!existingParent && currentPhaseId) {
            el.dataset.phaseParent = currentPhaseId;
            el.classList.add('under-phase');
        }
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
    state[phaseId] = collapsed;
    localStorage.setItem(key, JSON.stringify(state));
}

function togglePhaseVisibility(phaseId) {
    const phaseEl = document.querySelector(`.task-item.phase[data-phase-id='${phaseId}']`);
    if (!phaseEl) return;
    const collapsed = !phaseEl.classList.contains('phase-collapsed');
    applyPhaseVisibility(phaseId, collapsed);
    persistPhaseVisibility(phaseId, collapsed);
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
    Object.entries(state).forEach(([phaseId, collapsed]) => {
        if (collapsed) {
            applyPhaseVisibility(phaseId, true);
        }
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

    if (saveBtn) saveBtn.addEventListener('click', () => saveCurrentNote());
    if (newBtn) newBtn.addEventListener('click', () => createNote());
    if (deleteBtn) deleteBtn.addEventListener('click', () => deleteCurrentNote());
    if (refreshBtn) refreshBtn.addEventListener('click', () => loadNotes({ keepSelection: true }));

    editor.addEventListener('input', refreshNoteDirtyState);
    titleInput.addEventListener('input', refreshNoteDirtyState);

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
        document.execCommand('insertHTML', false, '<label class="note-inline-checkbox"><input type="checkbox"> </label>');
        setNoteDirty(true);
        return;
    }
    if (command === 'quote') {
        if (toggleBlockquote()) return;
        document.execCommand('formatBlock', false, 'blockquote');
        setNoteDirty(true);
        return;
    }
    if (command === 'code') {
        if (toggleInlineCode()) return;
        const selection = window.getSelection ? window.getSelection().toString() : '';
        const html = selection ? `<code>${selection}</code>` : '<code></code>';
        document.execCommand('insertHTML', false, html);
        setNoteDirty(true);
        return;
    }

    document.execCommand(command, false, null);
    refreshNoteDirtyState();
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
    const listEl = document.getElementById('notes-list');
    if (!listEl) return;
    if (!notesState.notes.length) {
        listEl.innerHTML = `<div class="empty-state">
            <p style="color: var(--text-muted); margin: 0;">No notes yet. Create one to get started.</p>
        </div>`;
        return;
    }

    listEl.innerHTML = '';
    notesState.notes.forEach(note => {
        const btn = document.createElement('button');
        btn.className = `notes-list-item ${note.id === notesState.activeNoteId ? 'active' : ''}`;
        btn.innerHTML = `
            <div class="note-title">${note.title || 'Untitled'}</div>
            <div class="note-updated">${formatNoteDate(note.updated_at)}</div>
        `;
        btn.addEventListener('click', async () => {
            await setActiveNote(note.id);
            scrollNotesEditorIntoView();
        });
        listEl.appendChild(btn);
    });
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
    editor.innerHTML = note.content || '';
    updatedLabel.textContent = `Updated ${formatNoteDate(note.updated_at)}`;
    notesState.activeSnapshot = {
        title: (note.title || '').trim(),
        content: (note.content || '').trim()
    };
    setNoteDirty(false);
    renderNotesList();
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

    const payload = {
        title: titleInput.value.trim() || 'Untitled Note',
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
        if (titleInput) titleInput.focus();
    } catch (err) {
        console.error('Error creating note:', err);
    }
}

async function deleteCurrentNote() {
    const noteId = notesState.activeNoteId;
    if (!noteId) return;
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
}

function clearNoteEditor() {
    const editor = document.getElementById('note-editor');
    const titleInput = document.getElementById('note-title');
    const updatedLabel = document.getElementById('note-updated-label');
    if (editor) editor.innerHTML = '';
    if (titleInput) titleInput.value = '';
    if (updatedLabel) updatedLabel.textContent = 'No note selected';
    notesState.activeNoteId = null;
    notesState.activeSnapshot = null;
    setNoteDirty(false);
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
            ? "Type your task and press Enter. Use $ for events, #Phase, >Group"
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
    if (monthCard) monthCard.classList.remove('is-hidden');
    hideDayView();
    renderCalendarMonth();
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

async function setCalendarDay(dayStr, options = {}) {
    const { skipLoad = false, skipLabel = false } = options;
    calendarState.selectedDay = dayStr;
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

function formatTimeRange(ev) {
    if (!ev.start_time) return '';
    const start = ev.start_time.slice(0, 5);
    const end = ev.end_time ? ev.end_time.slice(0, 5) : '';
    return end ? `${start} - ${end}` : start;
}

function renderCalendarEvents() {
    const container = document.getElementById('calendar-events');
    if (!container) return;
    container.innerHTML = '';
    if (!calendarState.selectedDay) {
        container.innerHTML = `<div class="calendar-empty">Pick a day from the calendar to view its schedule.</div>`;
        return;
    }
    if (!calendarState.detailsOpen) {
        container.innerHTML = `<div class="calendar-empty">Double-click a day to open its full schedule. You can still add quick events once a day is selected.</div>`;
        return;
    }
    if (!calendarState.events || calendarState.events.length === 0) {
        container.innerHTML = `<div class="calendar-empty">Nothing planned for this day. Use the quick add box to start.</div>`;
        return;
    }
    const sorted = [...calendarState.events].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
    const tasksDue = sorted.filter(ev => ev.is_task_link);
    const timeline = sorted.filter(ev => !ev.is_task_link);
    const groupMap = new Map();
    const rootItems = [];

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
        }
    });

    const groupsList = timeline.filter(ev => ev.is_group);
    const phasesAndTasks = [...rootItems.filter(ev => !ev.is_event && !ev.is_group), ...tasksDue];
    const dayEvents = rootItems.filter(ev => ev.is_event && !ev.is_group);

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

            const titleWrap = document.createElement('div');
            titleWrap.className = 'calendar-title';
            const titleInput = document.createElement('input');
            titleInput.type = 'text';
            titleInput.value = ev.title;
            titleInput.readOnly = true;
            titleWrap.appendChild(titleInput);

            const meta = document.createElement('div');
            meta.className = 'calendar-meta-lite';
            meta.innerHTML = `
                <span class="meta-chip">${ev.task_list_title || 'Task list'}</span>
                <span class="meta-chip status-chip status-${ev.status || 'not_started'}">${ev.status || 'not_started'}</span>
            `;
            titleWrap.appendChild(meta);

            const actions = document.createElement('div');
            actions.className = 'calendar-actions-row';
            const reminderBtn = document.createElement('button');
            reminderBtn.className = 'calendar-icon-btn';
            reminderBtn.title = 'Reminders not supported for task links';
            reminderBtn.innerHTML = '<i class="fa-solid fa-bell-slash"></i>';
            reminderBtn.disabled = true;

            const rolloverBtn = document.createElement('button');
            rolloverBtn.className = 'calendar-icon-btn';
            rolloverBtn.title = 'Rollover not supported for task links';
            rolloverBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
            rolloverBtn.disabled = true;

            const openBtn = document.createElement('a');
            openBtn.className = 'btn btn-secondary btn-small';
            openBtn.href = `/list/${ev.task_list_id}#item-${ev.task_id}`;
            openBtn.textContent = 'Open task';
            const unpinBtn = document.createElement('button');
            unpinBtn.className = 'btn btn-secondary btn-small';
            unpinBtn.textContent = 'Unpin';
            unpinBtn.onclick = () => unpinTaskDate(ev.task_id);

            actions.append(reminderBtn, rolloverBtn, openBtn, unpinBtn);

            row.append(left, titleWrap, actions);
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

        // Add time inline with title
        if (ev.start_time) {
            const timeSpan = document.createElement('span');
            timeSpan.className = 'calendar-time-inline';
            timeSpan.textContent = formatTimeRange(ev) || 'Time';
            titleWrap.appendChild(timeSpan);
        }

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
            link.textContent = note.title || `Note #${note.id}`;
            noteChips.appendChild(link);
        });
        if (meta.childNodes.length) titleWrap.appendChild(meta);
        if (noteChips.childNodes.length) titleWrap.appendChild(noteChips);

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

        const reminderBtn = document.createElement('button');
        const reminderActive = ev.reminder_minutes_before !== null && ev.reminder_minutes_before !== undefined;
        reminderBtn.className = `calendar-icon-btn ${reminderActive ? 'active' : ''}`;
        reminderBtn.title = reminderActive ? `Reminder: ${ev.reminder_minutes_before}m` : 'Set reminder';
        reminderBtn.innerHTML = `<i class="fa-solid fa-bell${reminderActive ? '' : '-slash'}"></i>`;
        reminderBtn.onclick = async () => {
            if (reminderActive) {
                await updateCalendarEvent(ev.id, { reminder_minutes_before: null });
                return;
            }
            openCalendarPrompt({
                title: 'Set Reminder',
                message: 'Minutes before start',
                type: 'number',
                defaultValue: ev.reminder_minutes_before ?? 10,
                onSubmit: async (val) => {
                    const minutes = parseInt(val, 10);
                    if (Number.isNaN(minutes) || minutes < 0) return;
                    await updateCalendarEvent(ev.id, { reminder_minutes_before: minutes });
                }
            });
        };

        const noteBtn = document.createElement('button');
        noteBtn.className = 'calendar-icon-btn';
        noteBtn.title = 'Link note';
        noteBtn.innerHTML = '<i class="fa-solid fa-note-sticky"></i>';
        noteBtn.onclick = () => linkNoteToCalendarEvent(ev.id, ev.title, (ev.linked_notes || []).map(n => n.id));

        const rolloverBtn = document.createElement('button');
        rolloverBtn.className = `calendar-icon-btn ${ev.rollover_enabled ? 'active' : ''}`;
        rolloverBtn.title = ev.rollover_enabled ? 'Rollover enabled' : 'Rollover disabled';
        rolloverBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
        rolloverBtn.onclick = () => updateCalendarEvent(ev.id, { rollover_enabled: !ev.rollover_enabled });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-icon';
        deleteBtn.title = 'Delete';
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteBtn.onclick = () => deleteCalendarEvent(ev.id);

        actions.append(priorityDot, reminderBtn, noteBtn, rolloverBtn, deleteBtn);
        row.append(left, titleWrap, actions);
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
        if (ev.start_time) {
            const timeSpan = document.createElement('span');
            timeSpan.className = 'calendar-time-inline';
            timeSpan.textContent = formatTimeRange(ev) || 'Time';
            titleWrap.appendChild(timeSpan);
        }

        const noteChips = document.createElement('div');
        noteChips.className = 'calendar-note-chips';
        (ev.linked_notes || []).forEach(note => {
            const link = document.createElement('a');
            link.className = 'meta-chip note';
            link.href = `/notes?note=${note.id}`;
            link.textContent = note.title || `Note #${note.id}`;
            noteChips.appendChild(link);
        });
        if (noteChips.childNodes.length) titleWrap.appendChild(noteChips);

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

        const reminderBtn = document.createElement('button');
        const reminderActive = ev.reminder_minutes_before !== null && ev.reminder_minutes_before !== undefined;
        reminderBtn.className = `calendar-icon-btn ${reminderActive ? 'active' : ''}`;
        reminderBtn.title = reminderActive ? `Reminder: ${ev.reminder_minutes_before}m` : 'Set reminder';
        reminderBtn.innerHTML = `<i class="fa-solid fa-bell${reminderActive ? '' : '-slash'}"></i>`;
        reminderBtn.onclick = async () => {
            if (reminderActive) {
                await updateCalendarEvent(ev.id, { reminder_minutes_before: null });
                return;
            }
            openCalendarPrompt({
                title: 'Set Reminder',
                message: 'Minutes before start',
                type: 'number',
                defaultValue: ev.reminder_minutes_before ?? 10,
                onSubmit: async (val) => {
                    const minutes = parseInt(val, 10);
                    if (Number.isNaN(minutes) || minutes < 0) return;
                    await updateCalendarEvent(ev.id, { reminder_minutes_before: minutes });
                }
            });
        };

        const noteBtn = document.createElement('button');
        noteBtn.className = 'calendar-icon-btn';
        noteBtn.title = 'Link note';
        noteBtn.innerHTML = '<i class="fa-solid fa-note-sticky"></i>';
        noteBtn.onclick = () => linkNoteToCalendarEvent(ev.id, ev.title, (ev.linked_notes || []).map(n => n.id));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-icon';
        deleteBtn.title = 'Delete';
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteBtn.onclick = () => deleteCalendarEvent(ev.id);

        actions.append(priorityDot, reminderBtn, noteBtn, deleteBtn);
        row.append(left, titleWrap, actions);
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

    const eventItems = rootItems.filter(ev => ev.is_event && !ev.is_group);
    let taskItems = rootItems.filter(ev => ev.is_group || (!ev.is_event && !ev.is_group));
    taskItems = [...taskItems, ...tasksDue];

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
}

function enableCalendarDragAndDrop(container) {
    const rows = Array.from(container.querySelectorAll('.calendar-row'));
    if (!rows.length) return;
    let dragSrc = null;

    const typeKey = (row) => `${row.dataset.type || 'task'}|${row.dataset.groupId || ''}`;

    rows.forEach(row => {
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
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
    // Phase creation
    if (raw.startsWith('#')) {
        return { is_phase: true, title: raw.replace(/^#+\s*/, '') || 'Untitled Phase' };
    }
    let working = raw;
    let startTime = null;
    let endTime = null;
    let priority = 'medium';
    let reminder = null;
    let phaseName = null;
    let rollover = true;
    let isEvent = false;
    let groupName = null;

    // NEW SYNTAX: Letter-based codes (mobile-friendly)
    // Event: e
    if (/\be\b/i.test(working)) {
        isEvent = true;
        working = working.replace(/\be\b/gi, '').trim();
    }

    // Time: t [time] or t [time-time]
    const newTimeMatch = working.match(/\bt\s+(\d{1,2}(?::\d{2})?(?:am|pm)?)\s*(?:-\s*(\d{1,2}(?::\d{2})?(?:am|pm)?))?/i);
    if (newTimeMatch) {
        startTime = newTimeMatch[1];
        endTime = newTimeMatch[2] || null;
        working = working.replace(newTimeMatch[0], '').trim();
    }

    // Priority: p h|m|l
    const newPriorityMatch = working.match(/\bp\s+(h|m|l)\b/i);
    if (newPriorityMatch) {
        const val = newPriorityMatch[1].toLowerCase();
        if (val === 'h') priority = 'high';
        else if (val === 'l') priority = 'low';
        else priority = 'medium';
        working = working.replace(newPriorityMatch[0], '').trim();
    }

    // Phase: ph [name]
    const newPhaseMatch = working.match(/\bph\s+([A-Za-z0-9_-]+)/i);
    if (newPhaseMatch) {
        phaseName = newPhaseMatch[1].trim();
        working = working.replace(newPhaseMatch[0], '').trim();
    }

    // Group: g [name]
    const newGroupMatch = working.match(/\bg\s+([A-Za-z0-9_-]+)/i);
    if (newGroupMatch) {
        groupName = newGroupMatch[1].trim();
        working = working.replace(newGroupMatch[0], '').trim();
    }

    // Reminder: r [minutes]
    const newReminderMatch = working.match(/\br\s+(\d{1,3})/i);
    if (newReminderMatch) {
        reminder = parseInt(newReminderMatch[1], 10);
        working = working.replace(newReminderMatch[0], '').trim();
    }

    // No rollover: nr
    if (/\bnr\b/i.test(working)) {
        rollover = false;
        working = working.replace(/\bnr\b/gi, '').trim();
    }

    // OLD SYNTAX: Symbol-based (backward compatibility)
    // Event marker ($)
    if (working.includes('$')) {
        isEvent = true;
        working = working.replace(/\$/g, '').trim();
    }

    // Time: @
    const oldTimeMatch = working.match(/@(\d{1,2}(?::\d{2})?)(?:\s*-\s*(\d{1,2}(?::\d{2})?))?/);
    if (oldTimeMatch && !startTime) {
        startTime = oldTimeMatch[1];
        endTime = oldTimeMatch[2] || null;
        working = working.replace(oldTimeMatch[0], '').trim();
    }

    // Priority: !
    const oldPriorityMatch = working.match(/!(high|med|medium|low|1|2|3)/i);
    if (oldPriorityMatch && priority === 'medium') {
        const val = oldPriorityMatch[1].toLowerCase();
        if (val === 'high' || val === '3') priority = 'high';
        else if (val === 'low' || val === '1') priority = 'low';
        else priority = 'medium';
        working = working.replace(oldPriorityMatch[0], '').trim();
    }

    // Reminder: bell/rem
    const oldReminderMatch = working.match(/\b(rem|bell)\s*(\d{1,3})/i);
    if (oldReminderMatch && !reminder) {
        reminder = parseInt(oldReminderMatch[2], 10);
        working = working.replace(oldReminderMatch[0], '').trim();
    }

    // Phase: #
    const oldPhaseMatch = working.match(/#([A-Za-z0-9 _-]+)/);
    if (oldPhaseMatch && !phaseName) {
        phaseName = oldPhaseMatch[1].trim();
        working = working.replace(oldPhaseMatch[0], '').trim();
    }

    // Group: >
    const oldGroupMatch = working.match(/>([A-Za-z0-9 _-]+)/);
    if (oldGroupMatch && !groupName) {
        groupName = oldGroupMatch[1].trim();
        working = working.replace(oldGroupMatch[0], '').trim();
    }

    // No rollover: noroll
    if (working.toLowerCase().includes('noroll')) {
        rollover = false;
        working = working.replace(/noroll/gi, '').trim();
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
    const lastWord = beforeCursor.split(/\s/).pop().toLowerCase();
    const words = beforeCursor.split(/\s/);
    const lastTwoWords = words.slice(-2).join(' ').toLowerCase();

    // Check if user is typing "g " - show existing groups
    if (lastTwoWords.match(/\bg\s*$/)) {
        const groups = calendarState.events?.filter(e => e.is_group) || [];
        if (groups.length > 0) {
            groups.forEach(group => {
                suggestions.push({
                    syntax: group.title,
                    description: `Add to "${group.title}" group`,
                    example: `g ${group.title}`
                });
            });
        }
        suggestions.push({
            syntax: '[NewName]',
            description: 'Or type a new group name',
            example: 'g Projects'
        });
        return suggestions;
    }

    // Check if user is typing "ph " - show existing phases
    if (lastTwoWords.match(/\bph\s*$/)) {
        const phases = calendarState.events?.filter(e => e.is_phase) || [];
        if (phases.length > 0) {
            phases.forEach(phase => {
                suggestions.push({
                    syntax: phase.title,
                    description: `Add to "${phase.title}" phase`,
                    example: `ph ${phase.title}`
                });
            });
        }
        suggestions.push({
            syntax: '[NewName]',
            description: 'Or type a new phase name',
            example: 'ph Planning'
        });
        return suggestions;
    }

    // Otherwise, show all syntax options
    // Event
    suggestions.push({
        syntax: 'e',
        description: 'Mark as event (not a task)',
        example: 'Team meeting e t 2pm'
    });

    // Time
    suggestions.push({
        syntax: 't [time]',
        description: 'Set time',
        example: 't 2pm or t 2-3pm or t 14:00'
    });

    // Priority
    suggestions.push({
        syntax: 'p h',
        description: 'High priority (red)',
        example: 'Buy milk p h'
    });
    suggestions.push({
        syntax: 'p m',
        description: 'Medium priority (orange)',
        example: 'Call client p m'
    });
    suggestions.push({
        syntax: 'p l',
        description: 'Low priority (green)',
        example: 'Read article p l'
    });

    // Phase
    const phases = calendarState.events?.filter(e => e.is_phase) || [];
    if (phases.length > 0) {
        suggestions.push({
            syntax: 'ph [name]',
            description: 'Add to phase',
            example: `ph ${phases[0].title}`
        });
    } else {
        suggestions.push({
            syntax: 'ph [name]',
            description: 'Add to phase',
            example: 'ph Planning'
        });
    }

    // Group
    const groups = calendarState.events?.filter(e => e.is_group) || [];
    if (groups.length > 0) {
        suggestions.push({
            syntax: 'g [name]',
            description: 'Add to group',
            example: `g ${groups[0].title}`
        });
    } else {
        suggestions.push({
            syntax: 'g [name]',
            description: 'Add to group',
            example: 'g Work'
        });
    }

    // Reminder
    suggestions.push({
        syntax: 'r [minutes]',
        description: 'Reminder before start',
        example: 'r 15 or r 30'
    });

    // No rollover
    suggestions.push({
        syntax: 'nr',
        description: 'Disable auto-rollover',
        example: 'Important task nr'
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
        item.innerHTML = `
            <div class="autocomplete-syntax">${sug.syntax}</div>
            <div class="autocomplete-description">${sug.description}</div>
            <div class="autocomplete-example">e.g., ${sug.example}</div>
        `;
        item.onclick = () => insertSuggestion(sug.syntax);
        container.appendChild(item);
    });

    container.classList.remove('is-hidden');
    autocompleteState.visible = true;
    autocompleteState.suggestions = suggestions;
}

function insertSuggestion(syntax) {
    const input = document.getElementById('calendar-quick-input');
    if (!input) return;

    const cursorPos = input.selectionStart;
    const text = input.value;
    const beforeCursor = text.substring(0, cursorPos);
    const afterCursor = text.substring(cursorPos);

    // Find where to insert (replace partial token or append)
    const lastWord = beforeCursor.split(/\s/).pop();
    const hasPartial = lastWord.startsWith('@') || lastWord.startsWith('!') ||
                       lastWord.startsWith('#') || lastWord.startsWith('>') ||
                       lastWord === '$' || lastWord.toLowerCase().startsWith('bell');

    let newText;
    let newCursorPos;
    if (hasPartial) {
        const replaceStart = cursorPos - lastWord.length;
        newText = text.substring(0, replaceStart) + syntax + ' ' + afterCursor;
        newCursorPos = replaceStart + syntax.length + 1;
    } else {
        newText = beforeCursor + syntax + ' ' + afterCursor;
        newCursorPos = cursorPos + syntax.length + 1;
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

async function handleCalendarQuickAdd() {
    const input = document.getElementById('calendar-quick-input');
    if (!input || !calendarState.selectedDay || !calendarState.dayViewOpen) return;
    const parsed = parseCalendarQuickInput(input.value || '');
    if (!parsed) return;
    input.value = '';
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

async function updateCalendarEvent(id, payload) {
    try {
        await fetch(`/api/calendar/events/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        await loadCalendarDay(calendarState.selectedDay);
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

function scheduleLocalReminders() {
    Object.values(calendarReminderTimers).forEach(t => clearTimeout(t));
    calendarReminderTimers = {};
    if (!calendarNotifyEnabled || !calendarState.selectedDay) return;
    const now = new Date();
    calendarState.events.forEach(ev => {
        if (ev.status === 'done') return;
        if (!ev.start_time || ev.reminder_minutes_before === null || ev.reminder_minutes_before === undefined) return;
        const target = new Date(`${calendarState.selectedDay}T${ev.start_time}`);
        const reminderAt = new Date(target.getTime() - ev.reminder_minutes_before * 60000);
        const delay = reminderAt.getTime() - now.getTime();
        if (delay > 0) {
            calendarReminderTimers[ev.id] = setTimeout(() => {
                triggerLocalNotification(ev);
            }, delay);
        }
    });
}

function triggerLocalNotification(ev) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const body = ev.start_time ? `${formatTimeRange(ev)} - ${ev.title}` : ev.title;
    new Notification('Upcoming event', { body });
}

async function enableCalendarNotifications() {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    calendarNotifyEnabled = perm === 'granted';
    if (calendarNotifyEnabled) scheduleLocalReminders();
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
    showDayView();
    calendarState.detailsOpen = false;
    setCalendarDay(dayStr, { skipLoad: true });
    renderCalendarEvents();
    const view = document.getElementById('calendar-day-view');
    if (view) view.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    const rolloverBtn = document.getElementById('calendar-rollover-btn');
    const backBtn = document.getElementById('calendar-back-month');

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

        // No auto-suggestions - user must trigger with Ctrl+Space

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
    initNotificationsUI();
    loadNotifications();
    window.addEventListener('notifications:refresh', loadNotifications);
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
    restorePhaseVisibility();
    initStickyListHeader();
    initTaskFilters();
    initMobileTopbar();
    initNotesPage();
    initAIPage();
    initCalendarPage();

    // Add long-press listeners for mobile selection
    document.querySelectorAll('.task-item').forEach(item => {
        item.addEventListener('touchstart', handleTouchStart, { passive: false });
        item.addEventListener('touchend', handleTouchEnd, { passive: false });
        item.addEventListener('touchmove', handleTouchMove, { passive: false });
        item.addEventListener('mousedown', handleMouseHoldStart);
        item.addEventListener('mouseup', handleMouseHoldEnd);
        item.addEventListener('mouseleave', handleMouseHoldEnd);
    });

    initAIPanel();
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

let mouseHoldTimer = null;

function handleMouseHoldStart(e) {
    // Only trigger on left click
    if (e.button !== 0) return;
    const item = e.currentTarget;
    if (e.target.closest('.drag-handle') || e.target.closest('.task-actions-dropdown')) return;
    mouseHoldTimer = setTimeout(() => {
        mouseHoldTimer = null;
        const itemId = parseInt(item.dataset.itemId, 10);
        const checkbox = item.querySelector('.select-item');
        document.body.classList.add('selection-mode-active');
        if (checkbox && !checkbox.checked) {
            checkbox.checked = true;
            toggleSelectItem(itemId, true);
            checkbox.classList.add('force-visible');
        }
    }, 500);
}

function handleMouseHoldEnd() {
    clearTimeout(mouseHoldTimer);
    mouseHoldTimer = null;
}

// --- AI Assistant ---
let aiMessages = [];
let aiSending = false;
let aiTyping = false;

function toggleAIPanel() {
    const panel = document.getElementById('ai-panel');
    if (!panel) return;
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
        const input = document.getElementById('ai-input');
        if (input) input.focus();
    }
}

function formatAIMessage(text) {
    // Convert markdown-style formatting to HTML
    let formatted = text;

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
    }
}

function initAIPanel() {
    renderAIMessages('panel');
}

function initAIPage() {
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
