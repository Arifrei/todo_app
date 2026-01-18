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

// --- Utility Functions ---
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

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
let currentDragIsPhase = false;
let currentDragPhaseId = null;
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
let touchDragIsPhase = false;
let touchDragPhaseId = null;
let notesState = { notes: [], activeNoteId: null, dirty: false, activeSnapshot: null, checkboxMode: false, activeFolderId: null };
let pinState = { hasPin: false, hasNotesPin: false, settingNotesPin: false, pendingNoteId: null, pendingFolderId: null, pendingAction: null };
let listState = { listId: null, items: [], dirty: false, activeSnapshot: null, checkboxMode: false, insertionIndex: null, editingItemId: null, expandedItemId: null };
let listAutoSaveTimer = null;
let listAutoSaveInFlight = false;
let noteAutoSaveTimer = null;
let noteAutoSaveInFlight = false;
let noteExitInProgress = false;
let noteFolderState = { folders: [], currentFolderId: null };
let noteMoveState = { ids: [], destinationFolderId: null, navStack: [] };
let recallState = {
    items: [],
    selectedWhen: null,
    lastUsedWhen: null,
    modalRecallId: null,
    modalEditMode: false,
    pollingIds: [],
    pollingInterval: null
};
let currentTaskFilter = 'all';
let selectedTagFilters = new Set();
let calendarState = { selectedDay: null, events: [], monthCursor: null, monthEventsByDay: {}, dayViewOpen: false, detailsOpen: false, daySort: 'time' };
const calendarSelection = { active: false, ids: new Set(), longPressTimer: null, longPressTriggered: false, touchStart: { x: 0, y: 0 } };
let calendarReminderTimers = {};
let calendarNotifyEnabled = false;
let calendarPrompt = { resolve: null, reject: null, onSubmit: null };
let datePickerState = { itemId: null };
let linkNoteModalState = { targetType: 'task', targetId: null, targetTitle: '', selectedNoteId: null, notes: [], existingNoteIds: [] };
let calendarNoteChoiceState = { event: null };
let calendarItemNoteState = { event: null, mode: 'view', isNew: false };
const CALENDAR_ITEM_NOTE_MAX_CHARS = window.CALENDAR_ITEM_NOTE_MAX_CHARS || 500;
const USER_TIMEZONE = window.USER_TIMEZONE || 'America/New_York'; // EST/EDT
let notificationsState = { items: [], unread: 0, open: false };
let timeModalState = { eventId: null };
let recurringModalState = { open: false };
const TOUCH_SCROLL_THRESHOLD = 12;

// --- Dashboard Functions ---

async function loadDashboard() {
    const hubsGrid = document.getElementById('hubs-grid');
    const listsGrid = document.getElementById('lists-grid');
    const lightListsGrid = document.getElementById('light-lists-grid');
    const hubsContainer = document.getElementById('hubs-container');
    const listsContainer = document.getElementById('lists-container');
    const lightListsContainer = document.getElementById('light-lists-container');

    if (!hubsGrid || !listsGrid || !lightListsGrid) return; // Not on dashboard

    try {
        const res = await fetch('/api/lists');
        const lists = await res.json();

        const hubs = lists.filter(l => l.type === 'hub');
        const simpleLists = lists.filter(l => l.type === 'list');
        const lightLists = lists.filter(l => l.type === 'light');

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

        // Render Light Lists
        if (lightLists.length > 0) {
            lightListsContainer.style.display = 'block';
            lightListsGrid.innerHTML = lightLists.map(list => renderListCard(list)).join('');
        } else {
            lightListsContainer.style.display = 'none';
        }

        initDashboardReorder();
    } catch (e) {
        console.error('Error loading lists:', e);
    }
}

function initDashboardReorder() {
    const grids = [
        { el: document.getElementById('hubs-grid'), type: 'hub' },
        { el: document.getElementById('lists-grid'), type: 'list' },
        { el: document.getElementById('light-lists-grid'), type: 'light' }
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
    const cardColorVar = list.type === 'hub'
        ? 'var(--accent-color)'
        : (list.type === 'light' ? 'var(--info-color)' : 'var(--primary-color)');
    const progress = list.progress || 0;
    const items = (list.items || []).filter(i => !i.is_phase);
    const itemCount = items.length;
    const doneCount = items.filter(i => i.status === 'done').length;
    const typeLabel = list.type === 'hub'
        ? 'Project Hub'
        : (list.type === 'light' ? 'Light List' : 'List');

    return `
        <a href="/list/${list.id}" class="card" data-list-id="${list.id}" data-list-type="${list.type}" style="border-top-color: ${cardColorVar};">
            <div class="card-header">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                    <span class="card-title">${list.title}</span>
                    <span class="card-type ${list.type}">${typeLabel}</span>
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
        const res = await fetch('/api/notes?all=1');
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


function showCalendarNoteChoiceInDropdown(dropdown, ev) {
    if (!dropdown || !ev) return;
    if (!dropdown._originalNodes) {
        dropdown._originalNodes = Array.from(dropdown.childNodes);
    }
    dropdown.dataset.noteChoice = '1';
    dropdown.classList.add('note-choice-compact');
    dropdown.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'calendar-note-choice-header';
    header.textContent = 'Add Note';
    dropdown.appendChild(header);

    if (ev.title) {
        const label = document.createElement('div');
        label.className = 'calendar-note-choice-label';
        label.textContent = `For "${ev.title}"`;
        dropdown.appendChild(label);
    }

    const makeOption = (icon, text, onClick, disabled = false) => {
        const btn = document.createElement('button');
        btn.className = 'calendar-item-menu-option';
        btn.innerHTML = `<i class="${icon}"></i><span class="note-choice-text">${text}</span>`;
        if (disabled) {
            btn.disabled = true;
        } else {
            btn.onclick = onClick;
        }
        return btn;
    };

    const notes = ev.linked_notes || [];
    dropdown.appendChild(makeOption('fa-solid fa-note-sticky', 'Notes note', () => {
        restoreCalendarNoteChoiceDropdown(dropdown);
        dropdown.classList.remove('active');
        openLinkNoteModal('calendar', ev.id, ev.title, notes.map(n => n.id));
    }));
    dropdown.appendChild(makeOption('fa-solid fa-pen', 'Item note', () => {
        restoreCalendarNoteChoiceDropdown(dropdown);
        dropdown.classList.remove('active');
        openCalendarItemNoteModal(ev, 'edit');
    }));
    dropdown.appendChild(makeOption('fa-solid fa-link-slash', notes.length > 1 ? `Unlink ${notes.length} notes` : 'Unlink note', () => {
        const label = notes.length > 1 ? `Unlink ${notes.length} notes from this item?` : 'Unlink this note?';
        openConfirmModal(label, async () => {
            try {
                await Promise.all(notes.map(note =>
                    fetch(`/api/notes/${note.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ calendar_event_id: null })
                    })
                ));
                restoreCalendarNoteChoiceDropdown(dropdown);
                dropdown.classList.remove('active');
                window.location.reload();
            } catch (e) {
                console.error('Error unlinking notes:', e);
                alert('Could not unlink note(s). Please try again.');
            }
        });
    }, notes.length === 0));
}

function restoreCalendarNoteChoiceDropdown(dropdown) {
    if (!dropdown || !dropdown.dataset.noteChoice) return;
    if (dropdown._originalNodes) {
        dropdown.innerHTML = '';
        dropdown._originalNodes.forEach(node => dropdown.appendChild(node));
    }
    delete dropdown.dataset.noteChoice;
    dropdown.classList.remove('note-choice-compact');
}

async function unlinkNotesFromChoice() {
    const ev = calendarNoteChoiceState.event;
    if (!ev) return;
    const notes = ev.linked_notes || [];
    if (!notes.length) return;
    const label = notes.length > 1 ? `Unlink ${notes.length} notes from this item?` : 'Unlink this note?';
    openConfirmModal(label, async () => {
        try {
            await Promise.all(notes.map(note =>
                fetch(`/api/notes/${note.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ calendar_event_id: null })
                })
            ));
            closeCalendarNoteChoice();
            window.location.reload();
        } catch (e) {
            console.error('Error unlinking notes:', e);
            alert('Could not unlink note(s). Please try again.');
        }
    });
}

async function resolveCalendarEventId(ev) {
    if (!ev) return null;
    if (ev.is_task_link) {
        const linked = await ensureLinkedTaskEvent(ev);
        if (!linked || !linked.calendar_event_id) return null;
        return { ...ev, ...linked, id: linked.calendar_event_id };
    }
    return ev;
}

function updateCalendarItemNoteCounter() {
    const input = document.getElementById('calendar-item-note-input');
    const counter = document.getElementById('calendar-item-note-counter');
    if (!input || !counter) return;
    const count = input.value.length;
    counter.textContent = `${count}/${CALENDAR_ITEM_NOTE_MAX_CHARS} characters`;
}

function setCalendarItemNoteMode(mode) {
    const view = document.getElementById('calendar-item-note-view');
    const editor = document.getElementById('calendar-item-note-editor');
    const viewActions = document.getElementById('calendar-item-note-view-actions');
    const editActions = document.getElementById('calendar-item-note-edit-actions');
    if (view) view.classList.toggle('is-hidden', mode === 'edit');
    if (editor) editor.classList.toggle('is-hidden', mode !== 'edit');
    if (viewActions) viewActions.classList.toggle('is-hidden', mode === 'edit');
    if (editActions) editActions.classList.toggle('is-hidden', mode !== 'edit');
}

function renderCalendarItemNoteContent(text) {
    const view = document.getElementById('calendar-item-note-view');
    if (!view) return;
    const content = (text || '').trim();
    view.innerHTML = content ? escapeHtml(content).replace(/\n/g, '<br>') : '<em>No note yet.</em>';
}

async function openCalendarItemNoteModal(ev, mode = 'view') {
    const modal = document.getElementById('calendar-item-note-modal');
    const label = document.getElementById('calendar-item-note-label');
    const input = document.getElementById('calendar-item-note-input');
    if (!modal) return;
    const resolved = await resolveCalendarEventId(ev);
    if (!resolved) return;
    calendarItemNoteState = { event: resolved, mode, isNew: !((resolved.item_note || '').trim()) };
    if (label) label.textContent = resolved.title ? `For "${resolved.title}"` : '';
    if (input) input.value = resolved.item_note || '';
    renderCalendarItemNoteContent(resolved.item_note || '');
    updateCalendarItemNoteCounter();
    setCalendarItemNoteMode(mode);
    modal.classList.add('active');
    if (mode === 'edit' && input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }
}

function closeCalendarItemNoteModal() {
    const modal = document.getElementById('calendar-item-note-modal');
    if (modal) modal.classList.remove('active');
    calendarItemNoteState = { event: null, mode: 'view', isNew: false };
    const input = document.getElementById('calendar-item-note-input');
    if (input) input.value = '';
}

async function saveCalendarItemNote() {
    const input = document.getElementById('calendar-item-note-input');
    if (!calendarItemNoteState.event || !input) return;
    const text = input.value || '';
    if (text.length > CALENDAR_ITEM_NOTE_MAX_CHARS) {
        showToast(`Item note is limited to ${CALENDAR_ITEM_NOTE_MAX_CHARS} characters.`, 'warning');
        return;
    }
    await updateCalendarEvent(calendarItemNoteState.event.id, { item_note: text });
    closeCalendarItemNoteModal();
}

async function deleteCalendarItemNote() {
    if (!calendarItemNoteState.event) return;
    openConfirmModal('Delete this item note?', async () => {
        await updateCalendarEvent(calendarItemNoteState.event.id, { item_note: null });
        closeCalendarItemNoteModal();
    });
}

async function convertCalendarItemNote() {
    if (!calendarItemNoteState.event) return;
    const rawText = (calendarItemNoteState.event.item_note || '').trim();
    if (!rawText) {
        showToast('Item note is empty.', 'warning');
        return;
    }
    const title = calendarItemNoteState.event.title
        ? `${calendarItemNoteState.event.title} note`
        : 'Item note';
    const content = escapeHtml(rawText).replace(/\n/g, '<br>');
    try {
        const res = await fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                content,
                calendar_event_id: calendarItemNoteState.event.id
            })
        });
        if (!res.ok) {
            throw new Error('Failed to create note');
        }
        await updateCalendarEvent(calendarItemNoteState.event.id, { item_note: null });
        closeCalendarItemNoteModal();
        showToast('Converted to a note.', 'success');
    } catch (err) {
        console.error('Error converting item note:', err);
        showToast('Could not convert note.', 'error');
    }
}

function appendCalendarItemNoteChip(container, ev) {
    if (!container || !ev || !ev.item_note) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'meta-chip note item-note';
    chip.title = 'Item note';
    chip.setAttribute('aria-label', 'Item note');
    chip.innerHTML = '<i class="fa-solid fa-note-sticky"></i>';
    chip.onclick = (e) => {
        e.stopPropagation();
        openCalendarItemNoteModal(ev, 'view');
    };
    container.appendChild(chip);
}

async function updateLinkedTaskStatus(taskId, status) {
    try {
        const res = await fetch(`/api/items/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        if (!res.ok) throw new Error('Failed to update task status');

        let changed = false;
        if (Array.isArray(calendarState.events)) {
            calendarState.events = calendarState.events.map(ev => {
                if (ev.is_task_link && ev.task_id === taskId) {
                    if (ev.status !== status) changed = true;
                    return { ...ev, status };
                }
                return ev;
            });
        }
        if (calendarState.selectedDay && calendarState.monthEventsByDay && Array.isArray(calendarState.monthEventsByDay[calendarState.selectedDay])) {
            calendarState.monthEventsByDay[calendarState.selectedDay] = calendarState.monthEventsByDay[calendarState.selectedDay].map(ev => {
                if (ev.is_task_link && ev.task_id === taskId) {
                    return { ...ev, status };
                }
                return ev;
            });
        }
        if (changed) {
            renderCalendarEvents();
            if (calendarState.monthCursor) renderCalendarMonth();
        }
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
    ev.rollover_enabled = created.rollover_enabled || false;
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
    const tagFiltering = selectedTagFilters.size > 0;

    items.forEach(item => {
        if (item.classList.contains('phase')) return;
        const status = item.dataset.status;
        const matchesStatus = currentTaskFilter === 'all' || status === currentTaskFilter;
        const matchesTags = itemMatchesTagFilter(item);
        const hideDoneForTags = tagFiltering && currentTaskFilter !== 'done' && status === 'done';
        const matches = matchesStatus && matchesTags && !hideDoneForTags;
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

    const hideDoneBars = tagFiltering && currentTaskFilter !== 'done';
    document.querySelectorAll('.phase-done-bar, .phase-done-container').forEach(el => {
        el.classList.toggle('hidden-by-filter', hideDoneBars);
    });
}

function shouldMoveLinkedNotesToFooter() {
    return window.matchMedia && window.matchMedia('(max-width: 1024px)').matches;
}

function repositionLinkedNoteChips() {
    const moveToFooter = shouldMoveLinkedNotesToFooter();
    document.querySelectorAll('.task-item').forEach(item => {
        const footer = item.querySelector('.task-footer');
        const meta = item.querySelector('.task-meta-lite');
        if (!footer) return;

        let footerNotes = footer.querySelector('.task-footer-notes');
        if (moveToFooter) {
            if (!footerNotes) {
                footerNotes = document.createElement('div');
                footerNotes.className = 'task-footer-notes';
                footer.insertBefore(footerNotes, footer.firstChild);
            }
            if (meta) {
                meta.querySelectorAll('.linked-note-chip').forEach(chip => {
                    footerNotes.appendChild(chip);
                });
            }
            if (footerNotes.children.length === 0) {
                footerNotes.remove();
            }
            footer.classList.toggle('has-footer-notes', !!footer.querySelector('.task-footer-notes'));
        } else {
            if (!meta || !footerNotes) return;
            footerNotes.querySelectorAll('.linked-note-chip').forEach(chip => {
                meta.appendChild(chip);
            });
            if (footerNotes.children.length === 0) {
                footerNotes.remove();
            }
            footer.classList.remove('has-footer-notes');
        }
    });
}

function toggleTaskFilterSubmenu(kind, event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('task-filter-menu');
    if (!menu) return;
    const statusMenu = document.getElementById('task-filter-submenu-status');
    const tagsMenu = document.getElementById('task-filter-submenu-tags');
    if (!statusMenu) return;
    const openStatus = statusMenu.classList.contains('show');
    const openTags = tagsMenu ? tagsMenu.classList.contains('show') : false;

    if (kind === 'status') {
        statusMenu.classList.toggle('show', !openStatus);
        if (tagsMenu) tagsMenu.classList.remove('show');
    } else if (kind === 'tags') {
        if (!tagsMenu) return;
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

    // Delay focus to allow modal animation to complete and prevent keyboard flicker
    const contentInput = document.getElementById('item-content');
    if (contentInput) {
        setTimeout(() => {
            contentInput.focus();
            // On mobile, scroll input into view after keyboard opens
            if (window.innerWidth <= 768) {
                setTimeout(() => {
                    contentInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 300);
            }
        }, 150);
    }

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
    const addDropdown = document.getElementById('header-add-dropdown');
    if (addDropdown) addDropdown.classList.remove('show');
    dropdown.classList.toggle('show');
}

function toggleHeaderAddMenu(event) {
    const dropdown = document.getElementById('header-add-dropdown');
    if (!dropdown) return;
    if (event) event.stopPropagation();
    const mainDropdown = document.getElementById('header-menu-dropdown');
    if (mainDropdown) mainDropdown.classList.remove('show');
    dropdown.classList.toggle('show');
}

function toggleNoteAddMenu(event, dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    if (event) event.stopPropagation();
    document.querySelectorAll('.header-add-dropdown').forEach(el => {
        if (el !== dropdown) el.classList.remove('show');
    });
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
    const addDropdown = document.getElementById('header-add-dropdown');
    if (addDropdown && addDropdown.classList.contains('show')) {
        if (!e.target.closest('.header-add-menu')) {
            addDropdown.classList.remove('show');
        }
    }
    document.querySelectorAll('.header-add-dropdown').forEach(dropdown => {
        if (dropdown.classList.contains('show') && !e.target.closest('.header-add-menu')) {
            dropdown.classList.remove('show');
        }
    });
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
    const currentListType = (typeof CURRENT_LIST_TYPE !== 'undefined' ? CURRENT_LIST_TYPE : null);
    moveNavStack = [() => renderMoveRoot(effectiveType)];
    updateMoveBackButton();

    const actions = [];
    if (effectiveType === 'task') {
        if (currentListType === 'list') {
            actions.push({
                label: `<i class="fa-solid fa-house" style="margin-right: 0.5rem;"></i>Move within "${typeof CURRENT_LIST_TITLE !== 'undefined' ? CURRENT_LIST_TITLE : 'this project'}"`,
                handler: () => pushMoveView(() => renderPhasePicker(CURRENT_LIST_ID, typeof CURRENT_LIST_TITLE !== 'undefined' ? CURRENT_LIST_TITLE : 'This project'))
            });
        }
    } else if (effectiveType === 'project') {
        actions.push({
            label: '<i class="fa-solid fa-house" style="margin-right: 0.5rem;"></i>Move to main page',
            handler: () => {
                moveSelectedDestination = { destination_hub_id: null, label: 'Main page' };
                moveItem();
            }
        });
    }
    if (effectiveType === 'task') {
        actions.push({
            label: '<i class="fa-solid fa-feather" style="margin-right: 0.5rem;"></i>Browse light lists',
            handler: () => pushMoveView(renderLightListPicker)
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
            } else if (child.type === 'light') {
                const btnLight = document.createElement('button');
                btnLight.className = 'btn';
                btnLight.innerHTML = `<i class="fa-solid fa-feather" style="margin-right: 0.5rem; opacity: 0.7;"></i>${child.title} <span style="opacity: 0.6; margin-left: 0.25rem;">(Light)</span>`;
                btnLight.onclick = () => {
                    moveSelectedDestination = { destination_list_id: child.id, destination_phase_id: null, label: child.title };
                    moveItem();
                };
                panel.appendChild(btnLight);
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

async function renderLightListPicker() {
    const panel = document.getElementById('move-step-container');
    if (!panel) return;
    panel.innerHTML = '<div class="move-heading"><i class="fa-solid fa-feather" style="margin-right: 0.5rem;"></i>Choose a light list</div>';
    try {
        const res = await fetch('/api/lists?type=light');
        const lists = await res.json();
        if (!lists.length) {
            panel.innerHTML += '<div style="color: var(--text-muted); padding: 1rem; text-align: center;"><i class="fa-solid fa-inbox" style="margin-right: 0.5rem;"></i>No light lists available.</div>';
            return;
        }
        lists.forEach(list => {
            const btn = document.createElement('button');
            btn.className = 'btn';
            btn.innerHTML = `<i class="fa-solid fa-feather" style="margin-right: 0.5rem; opacity: 0.7;"></i>${list.title}`;
            btn.onclick = () => {
                moveSelectedDestination = { destination_list_id: list.id, destination_phase_id: null, label: list.title };
                moveItem();
            };
            panel.appendChild(btn);
        });
    } catch (e) {
        panel.innerHTML += '<div style="color: var(--danger-color); margin-top: 0.5rem; padding: 1rem;"><i class="fa-solid fa-exclamation-triangle" style="margin-right: 0.5rem;"></i>Unable to load light lists.</div>';
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
        menu.style.position = '';
        menu.style.top = '';
        menu.style.left = '';
        menu.style.right = '';
        menu.dataset.anchorId = '';
        const statusMenu = document.getElementById('bulk-status-submenu');
        const tagForm = document.getElementById('bulk-tag-form');
        if (statusMenu) statusMenu.classList.remove('show');
        if (tagForm) tagForm.classList.remove('show');
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

    const shouldShow = !menu.classList.contains('show');
    menu.classList.toggle('show', shouldShow);
    if (!shouldShow) {
        menu.style.position = '';
        menu.style.top = '';
        menu.style.left = '';
        menu.style.right = '';
        menu.dataset.anchorId = '';
        const statusMenu = document.getElementById('bulk-status-submenu');
        const tagForm = document.getElementById('bulk-tag-form');
        if (statusMenu) statusMenu.classList.remove('show');
        if (tagForm) tagForm.classList.remove('show');
        return;
    }

    if (window.innerWidth <= 768 && event && event.currentTarget) {
        const rect = event.currentTarget.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.right = '';
        const padding = 8;
        const menuWidth = menu.offsetWidth || 220;
        let left = rect.right - menuWidth;
        left = Math.max(padding, Math.min(left, window.innerWidth - menuWidth - padding));
        let top = rect.bottom + 8;
        if (top + menu.offsetHeight > window.innerHeight - padding) {
            top = Math.max(padding, rect.top - menu.offsetHeight - 8);
        }
        const maxTop = window.innerHeight - menu.offsetHeight - padding;
        top = Math.max(padding, Math.min(top, maxTop));
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        menu.dataset.anchorId = event.currentTarget.id || '';
    } else {
        menu.style.position = '';
        menu.style.top = '';
        menu.style.left = '';
        menu.style.right = '';
        menu.dataset.anchorId = '';
    }
}

function toggleBulkSubmenu(kind, event) {
    if (event) event.stopPropagation();
    const statusMenu = document.getElementById('bulk-status-submenu');
    const tagForm = document.getElementById('bulk-tag-form');
    if (kind === 'status') {
        if (tagForm) tagForm.classList.remove('show');
        if (statusMenu) statusMenu.classList.toggle('show');
    }
    if (kind === 'tag') {
        if (statusMenu) statusMenu.classList.remove('show');
        if (tagForm) {
            const willShow = !tagForm.classList.contains('show');
            tagForm.classList.toggle('show', willShow);
            if (willShow) {
                const input = document.getElementById('bulk-tag-input');
                if (input) input.focus();
            }
        }
    }
}

// Close bulk menu when clicking outside
document.addEventListener('click', (e) => {
    const menu = document.getElementById('bulk-menu-dropdown');
    if (!menu) return;
    if (!e.target.closest('.bulk-menu')) {
        menu.classList.remove('show');
        menu.style.position = '';
        menu.style.top = '';
        menu.style.left = '';
        menu.style.right = '';
        menu.dataset.anchorId = '';
        const statusMenu = document.getElementById('bulk-status-submenu');
        const tagForm = document.getElementById('bulk-tag-form');
        if (statusMenu) statusMenu.classList.remove('show');
        if (tagForm) tagForm.classList.remove('show');
    }
});

window.addEventListener('scroll', () => {
    const menu = document.getElementById('bulk-menu-dropdown');
    if (!menu || !menu.classList.contains('show')) return;
    const anchorId = menu.dataset.anchorId || '';
    const anchor = anchorId ? document.getElementById(anchorId) : null;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const padding = 8;
    const menuWidth = menu.offsetWidth || 220;
    let left = rect.right - menuWidth;
    left = Math.max(padding, Math.min(left, window.innerWidth - menuWidth - padding));
    let top = rect.bottom + 8;
    if (top + menu.offsetHeight > window.innerHeight - padding) {
        top = Math.max(padding, rect.top - menu.offsetHeight - 8);
    }
    const maxTop = window.innerHeight - menu.offsetHeight - padding;
    top = Math.max(padding, Math.min(top, maxTop));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}, { passive: true });

function toggleCalendarBulkMenu(event, forceClose = false) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('calendar-bulk-more-dropdown');
    if (!menu) return;
    if (forceClose) {
        menu.classList.remove('show');
        restoreCalendarNoteChoiceDropdown(menu);
        menu.style.position = '';
        menu.style.top = '';
        menu.style.left = '';
        menu.style.right = '';
        return;
    }
    const shouldShow = !menu.classList.contains('show');
    if (shouldShow) restoreCalendarNoteChoiceDropdown(menu);
    menu.classList.toggle('show', shouldShow);
      if (!shouldShow) {
          restoreCalendarNoteChoiceDropdown(menu);
          return;
      }

    if (window.innerWidth <= 768 && event && event.currentTarget) {
        const rect = event.currentTarget.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.right = '';
        const padding = 8;
        const menuWidth = menu.offsetWidth || 200;
        let left = rect.right - menuWidth;
        left = Math.max(padding, Math.min(left, window.innerWidth - menuWidth - padding));
        let top = rect.bottom + 8;
        if (top + menu.offsetHeight > window.innerHeight - padding) {
            top = Math.max(padding, rect.top - menu.offsetHeight - 8);
        }
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        menu.dataset.anchorId = event.currentTarget.id || '';
    } else {
        menu.style.position = '';
        menu.style.top = '';
        menu.style.left = '';
        menu.style.right = '';
        menu.dataset.anchorId = '';
    }
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('calendar-bulk-more-dropdown');
    if (!menu) return;
    if (!e.target.closest('.calendar-bulk-menu')) {
        menu.classList.remove('show');
    }
});

window.addEventListener('scroll', () => {
    const menu = document.getElementById('calendar-bulk-more-dropdown');
    if (!menu || !menu.classList.contains('show')) return;
    const anchorId = menu.dataset.anchorId || '';
    const anchor = anchorId ? document.getElementById(anchorId) : null;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const padding = 8;
    const menuWidth = menu.offsetWidth || 200;
    let left = rect.right - menuWidth;
    left = Math.max(padding, Math.min(left, window.innerWidth - menuWidth - padding));
    let top = rect.bottom + 8;
    if (top + menu.offsetHeight > window.innerHeight - padding) {
        top = Math.max(padding, rect.top - menu.offsetHeight - 8);
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}, { passive: true });


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

async function bulkAddTag() {
    if (selectedItems.size === 0) return;
    const input = document.getElementById('bulk-tag-input');
    const tagValue = input ? input.value.trim() : '';
    if (!tagValue) return;
    try {
        const res = await fetch('/api/items/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'add_tag',
                tag: tagValue,
                ids: Array.from(selectedItems),
                list_id: typeof CURRENT_LIST_ID !== 'undefined' ? CURRENT_LIST_ID : null
            })
        });
        if (res.ok) {
            if (input) input.value = '';
            selectedItems.clear();
            await refreshListView();
        }
    } catch (e) {
        console.error('Error bulk adding tag:', e);
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
function getDoneBarForY(container, y) {
    const bars = [...container.querySelectorAll('.phase-done-bar')];
    for (const bar of bars) {
        const rect = bar.getBoundingClientRect();
        if (y < rect.top) continue;
        const phaseId = bar.getAttribute('data-phase-id');
        const doneBox = container.querySelector(`.phase-done-container[data-phase-id='${phaseId}']`);
        let bottom = rect.bottom;
        if (doneBox) {
            const boxRect = doneBox.getBoundingClientRect();
            bottom = Math.max(bottom, boxRect.bottom);
        }
        if (y <= bottom) return bar;
    }
    return null;
}

function getPhaseEndAnchor(container, phaseId) {
    if (phaseId) {
        const doneBar = container.querySelector(`.phase-done-bar[data-phase-id='${phaseId}']`);
        if (doneBar) return doneBar;
        const phaseEl = container.querySelector(`.task-item.phase[data-phase-id='${phaseId}']`);
        if (!phaseEl) return null;
        let cursor = phaseEl.nextElementSibling;
        while (cursor && !cursor.classList.contains('phase')) {
            cursor = cursor.nextElementSibling;
        }
        return cursor || null;
    }
    return container.querySelector('.task-item.phase') || null;
}

function getTaskDragAfterElement(container, y, phaseId) {
    const elements = [...container.querySelectorAll('.task-item:not(.dragging):not(.drag-placeholder)')]
        .filter(el => !el.closest('.phase-done-container'))
        .filter(el => !el.classList.contains('phase'))
        .filter(el => (el.dataset.phaseParent || '') === (phaseId || ''));

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

// When dragging a phase, snap to phase boundaries to avoid splitting other phases
function getPhaseDragAfterElement(container, y) {
    const allElements = [...container.querySelectorAll('.task-item:not(.dragging):not(.drag-placeholder)')];

    if (allElements.length === 0) {
        return null; // Empty container, append at end
    }

    // Find all phase headers and the first element (for inserting at the very top)
    const phaseHeaders = allElements.filter(el => el.classList.contains('phase'));

    // Build list of valid drop positions: each phase header, plus the end
    // Each position has a reference element to insert before (null = append at end)
    const dropPositions = [];

    // Add position before the first element (top of list)
    if (allElements.length > 0) {
        const firstEl = allElements[0];
        const box = firstEl.getBoundingClientRect();
        dropPositions.push({
            y: box.top,
            insertBefore: firstEl
        });
    }

    // Add position before each phase header (except if it's the first element, already added)
    phaseHeaders.forEach(phase => {
        const box = phase.getBoundingClientRect();
        // Avoid duplicate if this phase is the first element
        if (phase !== allElements[0]) {
            dropPositions.push({
                y: box.top,
                insertBefore: phase
            });
        }
    });

    // Add position at the end
    const lastEl = allElements[allElements.length - 1];
    const lastBox = lastEl.getBoundingClientRect();
    dropPositions.push({
        y: lastBox.bottom,
        insertBefore: null // null means append at end
    });

    // Find the closest drop position
    let closestPosition = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    dropPositions.forEach(pos => {
        const distance = Math.abs(y - pos.y);
        if (distance < closestDistance) {
            closestDistance = distance;
            closestPosition = pos;
        }
    });

    return closestPosition ? closestPosition.insertBefore : null;
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
    currentDragIsPhase = false;
    currentDragPhaseId = null;
    if (row) {
        const isPhase = row.classList.contains('phase');
        currentDragIsPhase = isPhase;
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
            currentDragPhaseId = row.dataset.phaseParent || '';
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
    currentDragIsPhase = false;
    currentDragPhaseId = null;
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
    // When dragging a phase, snap to phase boundaries to avoid splitting other phases
    const doneBar = currentDragIsPhase ? null : getDoneBarForY(container, e.clientY);
    const phaseEndAnchor = currentDragIsPhase ? null : getPhaseEndAnchor(container, currentDragPhaseId || '');
    let afterElement = doneBar || (currentDragIsPhase
        ? getPhaseDragAfterElement(container, e.clientY)
        : getTaskDragAfterElement(container, e.clientY, currentDragPhaseId || ''));
    if (!currentDragIsPhase && afterElement == null && phaseEndAnchor) {
        afterElement = phaseEndAnchor;
    }
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
    // Re-organize done tasks after drag to maintain proper grouping
    normalizePhaseParents();
    organizePhaseDoneTasks();
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
        repositionLinkedNoteChips();
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
    if (document.body.classList.contains('selection-mode-active')) {
        return;
    }

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
        if (dx > TOUCH_SCROLL_THRESHOLD || dy > TOUCH_SCROLL_THRESHOLD) {
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
    touchDragIsPhase = false;
    touchDragPhaseId = null;

    const row = document.getElementById(`item-${itemId}`);
    if (row) {
        console.log('🔵 Row found:', row);
        const isPhase = row.classList.contains('phase');
        touchDragIsPhase = isPhase;
        if (isPhase) {
            const siblings = Array.from(document.querySelectorAll('.task-item'));
            const startIdx = siblings.indexOf(row);
            for (let i = startIdx; i < siblings.length; i++) {
                const el = siblings[i];
                if (i > startIdx && el.classList.contains('phase')) break;
                touchDragBlock.push(el);
            }
        } else {
            touchDragPhaseId = row.dataset.phaseParent || '';
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
    // When dragging a phase, snap to phase boundaries to avoid splitting other phases
    const doneBar = touchDragIsPhase ? null : getDoneBarForY(container, touchDragCurrentY);
    const phaseEndAnchor = touchDragIsPhase ? null : getPhaseEndAnchor(container, touchDragPhaseId || '');
    let afterElement = doneBar || (touchDragIsPhase
        ? getPhaseDragAfterElement(container, touchDragCurrentY)
        : getTaskDragAfterElement(container, touchDragCurrentY, touchDragPhaseId || ''));
    if (!touchDragIsPhase && afterElement == null && phaseEndAnchor) {
        afterElement = phaseEndAnchor;
    }

    let dragLog = 'at end';
    if (afterElement) {
        dragLog = afterElement.classList.contains('phase-done-bar')
            ? 'before done bar'
            : 'before item ' + afterElement.dataset.itemId;
    }
    console.log('🟢 Placeholder should be inserted', dragLog);

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
    touchDragIsPhase = false;
    touchDragPhaseId = null;
    // Re-organize done tasks after drag to maintain proper grouping
    normalizePhaseParents();
    organizePhaseDoneTasks();
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
    const unifiedListEl = document.getElementById('notes-unified-list');
    const listEditor = document.getElementById('list-editor-page');

    if (unifiedListEl) {
        initNotesListPage();
    }
    if (editor) {
        initNoteEditorPage();
    }
    if (listEditor) {
        initListEditorPage();
    }
}

function initNotesListPage() {
    const listEl = document.getElementById('notes-unified-list');
    if (!listEl) return;

    const page = document.querySelector('.notes-page');
    const rawFolderId = page ? page.dataset.folderId : '';
    const folderId = rawFolderId ? parseInt(rawFolderId, 10) : null;
    noteFolderState.currentFolderId = Number.isFinite(folderId) ? folderId : null;

    // Initialize FAB
    initNotesFab();

    // Check PIN status and load notes
    checkPinStatus();
    checkNotesPinStatus();
    loadNotesUnified();
}

// --- New Unified Notes Functions ---

// Swipe gesture state
let noteSwipeState = {
    activeItem: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    isSwiping: false,
    swipeDirection: null,
    swipeThreshold: 120,
    cancelThreshold: 15
};

// FAB state
let noteFabExpanded = false;

/**
 * Load notes and folders, then render unified list
 */
async function loadNotesUnified() {
    const listEl = document.getElementById('notes-unified-list');
    const emptyEl = document.getElementById('notes-empty-state');
    if (!listEl) return;

    try {
        const folderId = noteFolderState.currentFolderId;
        const query = folderId ? `?folder_id=${folderId}` : '';
        const [notesRes, foldersRes] = await Promise.all([
            fetch(`/api/notes${query}`),
            fetch('/api/note-folders')
        ]);

        if (!notesRes.ok || !foldersRes.ok) throw new Error('Failed to load');

        const notes = await notesRes.json();
        const folders = await foldersRes.json();

        notesState.notes = notes;
        noteFolderState.folders = folders;

        renderNotesUnified();

    } catch (err) {
        console.error('Error loading notes:', err);
        listEl.innerHTML = '<div class="notes-empty-state"><i class="fa-solid fa-exclamation-circle"></i><p>Could not load notes</p></div>';
    }
}

/**
 * Sort and group items for display
 */
function getSortedNotesItems() {
    const currentFolderId = noteFolderState.currentFolderId;
    const notes = notesState.notes || [];
    const folders = noteFolderState.folders || [];

    // Filter folders to current parent level
    const currentFolders = folders.filter(f =>
        (f.parent_id || null) === (currentFolderId || null)
    ).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    // Separate pinned and unpinned notes
    const pinnedItems = notes.filter(n => n.pinned)
        .sort((a, b) => (a.pin_order || 0) - (b.pin_order || 0));

    const unpinnedNotes = notes.filter(n => !n.pinned && n.note_type === 'note')
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    const unpinnedLists = notes.filter(n => !n.pinned && n.note_type === 'list')
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    return {
        pinned: pinnedItems,
        notes: unpinnedNotes,
        lists: unpinnedLists,
        folders: currentFolders
    };
}

/**
 * Render the unified notes list
 */
function renderNotesUnified() {
    const listEl = document.getElementById('notes-unified-list');
    const emptyEl = document.getElementById('notes-empty-state');
    if (!listEl) return;

    const sorted = getSortedNotesItems();

    listEl.innerHTML = '';

    const hasItems = sorted.pinned.length || sorted.notes.length ||
                     sorted.lists.length || sorted.folders.length;

    if (!hasItems) {
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    // Render pinned section
    if (sorted.pinned.length) {
        listEl.appendChild(createSectionHeader('Pinned'));
        sorted.pinned.forEach(note => {
            listEl.appendChild(createNoteItem(note, true));
        });
    }

    // Render notes section
    if (sorted.notes.length) {
        listEl.appendChild(createSectionHeader('Notes'));
        sorted.notes.forEach(note => {
            listEl.appendChild(createNoteItem(note, false));
        });
    }

    // Render lists section
    if (sorted.lists.length) {
        listEl.appendChild(createSectionHeader('Lists'));
        sorted.lists.forEach(note => {
            listEl.appendChild(createNoteItem(note, false));
        });
    }

    // Render folders section
    if (sorted.folders.length) {
        listEl.appendChild(createSectionHeader('Folders'));
        sorted.folders.forEach(folder => {
            listEl.appendChild(createFolderItem(folder));
        });
    }

    // Bind swipe and drag handlers
    initNoteSwipeHandlers();
    initPinnedDragHandlers();
}

function createSectionHeader(title) {
    const header = document.createElement('div');
    header.className = 'notes-section-header';
    header.textContent = title;
    return header;
}

function createNoteItem(note, isPinned) {
    const item = document.createElement('div');
    const isProtected = note.is_pin_protected;
    const isLocked = note.locked;
    item.className = 'notes-item' + (isPinned ? ' pinned-item' : '') + (isProtected ? ' protected' : '') + (isLocked ? ' locked' : '');
    item.dataset.itemId = note.id;
    item.dataset.itemType = 'note';
    item.dataset.protected = isProtected ? 'true' : 'false';
    item.dataset.locked = isLocked ? 'true' : 'false';
    if (isPinned) {
        item.draggable = true;
    }

    const iconClass = note.note_type === 'list' ? 'type-list' : 'type-note';
    const iconName = note.note_type === 'list' ? 'fa-list' : 'fa-note-sticky';
    const displayTitle = getNoteDisplayTitle(note);
    const pinLabel = isPinned ? 'Unpin' : 'Pin';
    const lockIcon = isProtected ? '<i class="notes-item-lock fa-solid fa-lock"></i>' : '';

    item.innerHTML = `
        <div class="notes-item-swipe-layer swipe-right">
            <i class="fa-solid fa-thumbtack"></i>
            <span>${pinLabel}</span>
        </div>
        <div class="notes-item-swipe-layer swipe-left">
            <i class="fa-solid fa-trash"></i>
            <span>Delete</span>
        </div>
        <div class="notes-item-content">
            ${isPinned ? '<div class="notes-item-drag-handle"><i class="fa-solid fa-grip-vertical"></i></div>' : ''}
            <div class="notes-item-icon ${iconClass}">
                <i class="fa-solid ${iconName}"></i>
            </div>
            <span class="notes-item-title">${escapeHtml(displayTitle)}</span>
            ${lockIcon}
            ${isPinned ? '<i class="notes-item-pinned fa-solid fa-thumbtack"></i>' : ''}
            <div class="notes-item-dropdown">
                <button class="btn-icon" data-note-id="${note.id}" data-pin-label="${pinLabel}" onclick="toggleNoteActionsMenu(${note.id}, event)" title="More actions">
                    <i class="fa-solid fa-ellipsis-vertical"></i>
                </button>
            </div>
        </div>
    `;

    return item;
}

function createFolderItem(folder) {
    const item = document.createElement('div');
    const isProtected = folder.is_pin_protected;
    item.className = 'notes-item' + (isProtected ? ' protected locked' : '');
    item.dataset.itemId = folder.id;
    item.dataset.itemType = 'folder';
    item.dataset.locked = isProtected ? 'true' : 'false';

    const lockIcon = isProtected ? '<i class="notes-item-lock fa-solid fa-lock"></i>' : '';

    item.innerHTML = `
        <div class="notes-item-content">
            <div class="notes-item-icon type-folder">
                <i class="fa-solid fa-folder"></i>
            </div>
            <span class="notes-item-title">${escapeHtml(folder.name)}</span>
            ${lockIcon}
            <i class="notes-item-chevron fa-solid fa-chevron-right"></i>
            <div class="notes-item-dropdown">
                <button class="btn-icon" data-folder-id="${folder.id}" data-folder-name="${escapeHtml(folder.name)}" onclick="toggleFolderActionsMenu(${folder.id}, event)" title="More actions">
                    <i class="fa-solid fa-ellipsis-vertical"></i>
                </button>
            </div>
        </div>
    `;

    return item;
}

/**
 * Initialize swipe handlers on all note items
 */
function initNoteSwipeHandlers() {
    const items = document.querySelectorAll('.notes-item[data-item-type="note"]');

    items.forEach(item => {
        const content = item.querySelector('.notes-item-content');
        if (!content) return;

        content.addEventListener('touchstart', handleNoteSwipeStart, { passive: true });
        content.addEventListener('touchmove', handleNoteSwipeMove, { passive: false });
        content.addEventListener('touchend', handleNoteSwipeEnd, { passive: true });

        // Click handler for navigation (non-swipe) or action buttons
        content.addEventListener('click', (e) => {
            if (noteSwipeState.isSwiping) return;

            const noteId = parseInt(item.dataset.itemId, 10);

            // Check if clicked on an action button
            const actionBtn = e.target.closest('.notes-item-actions .btn-icon');
            if (actionBtn) {
                e.stopPropagation();
                const action = actionBtn.dataset.action;
                if (action === 'pin') {
                    handleSwipePin(noteId);
                } else if (action === 'delete') {
                    handleSwipeDelete(noteId);
                }
                return;
            }

            // Check if note is locked (protected)
            const isLocked = item.dataset.locked === 'true';
            if (isLocked) {
                pinState.pendingNoteId = noteId;
                pinState.pendingAction = null; // View action, not unprotect
                openPinModal();
                return;
            }

            // Otherwise navigate to editor
            openNoteInEditor(noteId);
        });
    });

    // Folder items - click handler with action buttons
    const folderItems = document.querySelectorAll('.notes-item[data-item-type="folder"]');
    folderItems.forEach(item => {
        const content = item.querySelector('.notes-item-content');
        if (!content) return;

        content.addEventListener('click', (e) => {
            const folderId = parseInt(item.dataset.itemId, 10);

            // Check if clicked on an action button
            const actionBtn = e.target.closest('.notes-item-actions .btn-icon');
            if (actionBtn) {
                e.stopPropagation();
                const action = actionBtn.dataset.action;
                const folder = noteFolderState.folders.find(f => f.id === folderId);
                if (action === 'rename' && folder) {
                    openNoteFolderModal('rename', folder);
                } else if (action === 'delete' && folder) {
                    deleteNoteFolder(folderId, folder.name);
                }
                return;
            }

            // Check if folder is locked (protected)
            const isLocked = item.dataset.locked === 'true';
            if (isLocked) {
                pinState.pendingFolderId = folderId;
                pinState.pendingNoteId = null;
                pinState.pendingAction = 'unlock_folder';
                openPinModal();
                return;
            }

            // Otherwise navigate to folder
            window.location.href = `/notes/folder/${folderId}`;
        });
    });
}

function handleNoteSwipeStart(e) {
    if (!e.touches || e.touches.length !== 1) return;

    // Don't intercept touches on drag handle - let drag handlers handle those
    if (e.target.closest('.notes-item-drag-handle')) return;

    const touch = e.touches[0];
    const item = e.currentTarget.closest('.notes-item');

    noteSwipeState.activeItem = item;
    noteSwipeState.startX = touch.clientX;
    noteSwipeState.startY = touch.clientY;
    noteSwipeState.currentX = touch.clientX;
    noteSwipeState.isSwiping = false;
    noteSwipeState.swipeDirection = null;

    // Reset any existing swipe states on other items
    document.querySelectorAll('.notes-item').forEach(el => {
        if (el !== item) {
            const content = el.querySelector('.notes-item-content');
            if (content) content.style.transform = '';
        }
    });
}

function handleNoteSwipeMove(e) {
    if (!noteSwipeState.activeItem || !e.touches || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const dx = touch.clientX - noteSwipeState.startX;
    const dy = Math.abs(touch.clientY - noteSwipeState.startY);

    // Cancel swipe if scrolling vertically
    if (dy > noteSwipeState.cancelThreshold && !noteSwipeState.isSwiping) {
        noteSwipeState.activeItem = null;
        return;
    }

    // Start swiping if horizontal movement is significant
    if (Math.abs(dx) > 20 && !noteSwipeState.isSwiping) {
        e.preventDefault();
        noteSwipeState.isSwiping = true;
        noteSwipeState.activeItem.classList.add('swiping');
    }

    if (!noteSwipeState.isSwiping) return;

    e.preventDefault();
    noteSwipeState.currentX = touch.clientX;

    const item = noteSwipeState.activeItem;
    const content = item.querySelector('.notes-item-content');
    if (!content) return;

    // Determine swipe direction and apply transform with resistance
    if (dx > 0) {
        noteSwipeState.swipeDirection = 'right';
        const translateX = Math.min(dx * 0.8, 140);
        content.style.transform = `translateX(${translateX}px)`;
    } else if (dx < 0) {
        noteSwipeState.swipeDirection = 'left';
        const translateX = Math.max(dx * 0.8, -140);
        content.style.transform = `translateX(${translateX}px)`;
    }
}

function handleNoteSwipeEnd(e) {
    if (!noteSwipeState.activeItem) return;

    const item = noteSwipeState.activeItem;
    const content = item.querySelector('.notes-item-content');
    const dx = noteSwipeState.currentX - noteSwipeState.startX;
    const itemId = parseInt(item.dataset.itemId, 10);

    // Remove swiping class
    item.classList.remove('swiping');

    // Reset visual state with transition
    if (content) {
        content.style.transition = 'transform 0.2s ease';
        content.style.transform = '';
        setTimeout(() => {
            content.style.transition = '';
        }, 200);
    }

    // Check if swipe threshold was met
    if (Math.abs(dx) >= noteSwipeState.swipeThreshold) {
        if (dx > 0) {
            handleSwipePin(itemId);
        } else {
            handleSwipeDelete(itemId);
        }
    }

    // Small delay before allowing clicks again
    setTimeout(() => {
        noteSwipeState.isSwiping = false;
    }, 100);

    noteSwipeState.activeItem = null;
    noteSwipeState.swipeDirection = null;
}

async function handleSwipePin(noteId) {
    const note = notesState.notes.find(n => n.id === noteId);
    if (!note) return;

    const newPinned = !note.pinned;

    try {
        const res = await fetch(`/api/notes/${noteId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pinned: newPinned,
                title: note.title || deriveNoteAutoTitleFromHtml(note.content || '')
            })
        });

        if (!res.ok) throw new Error('Failed to update pin');

        showToast(newPinned ? 'Pinned' : 'Unpinned', 'success', 2000);
        await loadNotesUnified();

    } catch (err) {
        console.error('Pin toggle failed:', err);
        showToast('Failed to update', 'error');
    }
}

function handleSwipeDelete(noteId) {
    const note = notesState.notes.find(n => n.id === noteId);
    if (!note) return;

    openConfirmModal(`Delete "${getNoteDisplayTitle(note)}"?`, async () => {
        try {
            const res = await fetch(`/api/notes/${noteId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');

            showToast('Deleted', 'success', 2000);
            await loadNotesUnified();

        } catch (err) {
            console.error('Delete failed:', err);
            showToast('Failed to delete', 'error');
        }
    });
}

// Global reference to active notes dropdown
let activeNotesDropdown = null;

/**
 * Close any active notes dropdown menu
 */
function closeNotesDropdown() {
    if (activeNotesDropdown) {
        activeNotesDropdown.remove();
        activeNotesDropdown = null;
    }
}

/**
 * Position dropdown relative to trigger button
 */
function positionNotesDropdown(dropdown, button) {
    const rect = button.getBoundingClientRect();
    const dropdownWidth = 180;
    const dropdownHeight = dropdown.offsetHeight || 150;
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const padding = 8;

    // Position below button by default, above if not enough space
    let topPos = rect.bottom + padding;
    if (screenHeight - rect.bottom < dropdownHeight + padding && rect.top > dropdownHeight + padding) {
        topPos = rect.top - dropdownHeight - padding;
    }

    // Align right edge to button, but ensure it stays on screen
    let leftPos = rect.right - dropdownWidth;
    if (leftPos < padding) leftPos = padding;
    if (leftPos + dropdownWidth > screenWidth - padding) {
        leftPos = screenWidth - dropdownWidth - padding;
    }

    dropdown.style.top = `${topPos}px`;
    dropdown.style.left = `${leftPos}px`;
}

/**
 * Toggle note actions dropdown menu
 */
function toggleNoteActionsMenu(noteId, event) {
    event.stopPropagation();
    const button = event.currentTarget;

    // If clicking same button, close
    if (activeNotesDropdown && activeNotesDropdown.dataset.noteId === String(noteId)) {
        closeNotesDropdown();
        return;
    }

    // Close any existing dropdown
    closeNotesDropdown();

    // Get pin label from note state
    const note = notesState.notes.find(n => n.id === noteId);
    const pinLabel = note && note.pinned ? 'Unpin' : 'Pin';
    const isListNote = note && note.note_type === 'list';
    const isProtected = note && note.is_pin_protected;
    const protectLabel = isProtected ? 'Unprotect' : 'Protect';
    const protectIcon = isProtected ? 'fa-lock-open' : 'fa-lock';
    const convertOption = isListNote ? '' : `
        <button class="notes-item-menu-option" data-action="convert">
            <i class="fa-solid fa-list-check"></i> Convert to list
        </button>
    `;

    // Create dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'notes-item-menu active';
    dropdown.dataset.noteId = noteId;
    dropdown.innerHTML = `
        <button class="notes-item-menu-option" data-action="pin">
            <i class="fa-solid fa-thumbtack"></i> ${pinLabel}
        </button>
        <button class="notes-item-menu-option" data-action="protect">
            <i class="fa-solid ${protectIcon}"></i> ${protectLabel}
        </button>
        <button class="notes-item-menu-option" data-action="share">
            <i class="fa-solid fa-share-nodes"></i> Share
        </button>
        <button class="notes-item-menu-option" data-action="move">
            <i class="fa-solid fa-folder-open"></i> Move to folder
        </button>
        ${convertOption}
        <button class="notes-item-menu-option" data-action="duplicate">
            <i class="fa-solid fa-copy"></i> Duplicate
        </button>
        <button class="notes-item-menu-option danger" data-action="delete">
            <i class="fa-solid fa-trash"></i> Delete
        </button>
    `;

    // Add click handlers
    dropdown.querySelectorAll('.notes-item-menu-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = opt.dataset.action;
            closeNotesDropdown();
            if (action === 'pin') handleNoteMenuPin(noteId);
            else if (action === 'protect') handleNoteMenuProtect(noteId);
            else if (action === 'share') handleNoteMenuShare(noteId);
            else if (action === 'convert') handleNoteMenuConvert(noteId);
            else if (action === 'move') handleNoteMenuMove(noteId);
            else if (action === 'duplicate') handleNoteMenuDuplicate(noteId);
            else if (action === 'delete') handleNoteMenuDelete(noteId);
        });
    });

    document.body.appendChild(dropdown);
    positionNotesDropdown(dropdown, button);
    activeNotesDropdown = dropdown;
}

/**
 * Toggle folder actions dropdown menu
 */
function toggleFolderActionsMenu(folderId, event) {
    event.stopPropagation();
    const button = event.currentTarget;
    const folderName = button.dataset.folderName || '';

    // If clicking same button, close
    if (activeNotesDropdown && activeNotesDropdown.dataset.folderId === String(folderId)) {
        closeNotesDropdown();
        return;
    }

    // Close any existing dropdown
    closeNotesDropdown();

    // Get protection status from folder state
    const folder = noteFolderState.folders.find(f => f.id === folderId);
    const isProtected = folder && folder.is_pin_protected;
    const protectLabel = isProtected ? 'Unprotect' : 'Protect';
    const protectIcon = isProtected ? 'fa-lock-open' : 'fa-lock';

    // Create dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'notes-item-menu active';
    dropdown.dataset.folderId = folderId;
    dropdown.innerHTML = `
        <button class="notes-item-menu-option" data-action="rename">
            <i class="fa-solid fa-pen"></i> Rename
        </button>
        <button class="notes-item-menu-option" data-action="protect">
            <i class="fa-solid ${protectIcon}"></i> ${protectLabel}
        </button>
        <button class="notes-item-menu-option danger" data-action="delete">
            <i class="fa-solid fa-trash"></i> Delete
        </button>
    `;

    // Add click handlers
    dropdown.querySelectorAll('.notes-item-menu-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = opt.dataset.action;
            closeNotesDropdown();
            if (action === 'rename') handleFolderMenuRename(folderId, folderName);
            else if (action === 'protect') handleFolderMenuProtect(folderId);
            else if (action === 'delete') handleFolderMenuDelete(folderId);
        });
    });

    document.body.appendChild(dropdown);
    positionNotesDropdown(dropdown, button);
    activeNotesDropdown = dropdown;
}

// Close notes dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (activeNotesDropdown && !e.target.closest('.notes-item-dropdown')) {
        closeNotesDropdown();
    }
});

/**
 * Note menu action handlers
 */
async function handleNoteMenuPin(noteId) {
    await handleSwipePin(noteId);
}

async function handleNoteMenuProtect(noteId) {
    // Check if user has notes PIN set
    if (!pinState.hasNotesPin) {
        pinState.settingNotesPin = true;
        pinState.pendingNoteId = noteId;
        pinState.pendingAction = 'protect_after_set';
        openSetPinModal();
        return;
    }

    const note = notesState.notes.find(n => n.id === noteId);
    if (!note) return;

    // If note is protected, require PIN to unprotect
    if (note.is_pin_protected) {
        pinState.pendingNoteId = noteId;
        pinState.pendingAction = 'unprotect';
        openPinModal();
        return;
    }

    // Protecting an unprotected note - no PIN needed
    await doProtectNote(noteId, true);
}

async function doProtectNote(noteId, newProtectedState) {
    try {
        const res = await fetch(`/api/notes/${noteId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_pin_protected: newProtectedState })
        });

        if (!res.ok) {
            const data = await res.json();
            showToast(data.error || 'Failed to update protection', 'error', 3000);
            return;
        }

        showToast(newProtectedState ? 'Note protected' : 'Protection removed', 'success', 2000);
        await loadNotesUnified();
    } catch (e) {
        console.error('Error toggling protection:', e);
        showToast('Error updating protection', 'error', 3000);
    }
}

function handleNoteMenuMove(noteId) {
    openNoteMoveModal(noteId, 'note');
}

async function handleNoteMenuShare(noteId) {
    let note = notesState.notes.find(n => n.id === noteId);
    if (!note) return;
    const isListNote = note.note_type === 'list';

    // Fetch full note content if not loaded (list view might not have it)
    const needsContent = !isListNote && (note.content === undefined || note.content === null);
    const needsItems = isListNote && (!Array.isArray(note.items) || !note.items.length);
    if (needsContent || needsItems) {
        try {
            const res = await fetch(`/api/notes/${noteId}`);
            if (res.ok) {
                const fullNote = await res.json();
                note = { ...note, ...fullNote };
            }
        } catch (err) {
            console.error('Failed to fetch note content:', err);
        }
    }

    if (isListNote) {
        await shareListContent({
            title: note.title || 'Untitled List',
            items: note.items || [],
            checkboxMode: !!note.checkbox_mode
        });
        return;
    }

    // Convert HTML content to plain text for sharing
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = note.content || '';
    const plainText = tempDiv.textContent || tempDiv.innerText || '';
    const title = note.title || 'Untitled Note';

    // Use universal share function
    if (typeof window.universalShare === 'function') {
        const result = await window.universalShare({ title, text: plainText });
        if (result.cancelled) return;
        if (result.success && result.method === 'clipboard') {
            showToast('Note copied to clipboard', 'success', 2000);
        }
        return;
    }

    // Fallback if universalShare not available
    const shareText = `${title}\n\n${plainText}`.trim();
    try {
        await navigator.clipboard.writeText(shareText);
        showToast('Note copied to clipboard', 'success', 2000);
    } catch (err) {
        showToast('Could not share note', 'error', 2000);
    }
}

async function handleNoteMenuDuplicate(noteId) {
    const note = notesState.notes.find(n => n.id === noteId);
    if (!note) return;

    try {
        const res = await fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: (note.title || 'Untitled') + ' (copy)',
                content: note.content || '',
                folder_id: note.folder_id,
                note_type: note.note_type || 'note'
            })
        });

        if (!res.ok) throw new Error('Failed to duplicate');

        showToast('Note duplicated', 'success', 2000);
        await loadNotesUnified();

    } catch (err) {
        console.error('Duplicate failed:', err);
        showToast('Failed to duplicate', 'error');
    }
}

function handleNoteMenuDelete(noteId) {
    handleSwipeDelete(noteId);
}

async function handleNoteMenuConvert(noteId) {
    const note = notesState.notes.find(n => n.id === noteId);
    if (note && note.note_type === 'list') {
        showToast('This note is already a list.', 'info');
        return;
    }

    openConfirmModal('Convert this note to a list? This replaces the note content with list items.', async () => {
        try {
            const res = await fetch(`/api/notes/${noteId}/convert-to-list`, { method: 'POST' });
            if (!res.ok) {
                let errorMessage = 'Note does not qualify for list conversion.';
                try {
                    const data = await res.json();
                    if (data?.details) {
                        errorMessage = `${data.error}: ${data.details}`;
                    } else if (data?.error) {
                        errorMessage = data.error;
                    }
                } catch (e) {
                    // Keep fallback message
                }
                showToast(errorMessage, 'warning');
                return;
            }
            showToast('Converted to list.', 'success');
            const returnTo = `${window.location.pathname}${window.location.search || ''}`;
            window.location.href = `/notes/${noteId}?return=${encodeURIComponent(returnTo)}`;
        } catch (err) {
            console.error('Error converting note:', err);
            showToast('Could not convert note to list.', 'error');
        }
    });
}

/**
 * Folder menu action handlers
 */
function handleFolderMenuRename(folderId, currentName) {
    // Open the folder modal in edit mode
    const modal = document.getElementById('note-folder-modal');
    const titleEl = document.getElementById('note-folder-modal-title');
    const nameInput = document.getElementById('note-folder-name');
    const idInput = document.getElementById('note-folder-id');

    titleEl.textContent = 'Rename Folder';
    nameInput.value = currentName;
    idInput.value = folderId;

    modal.classList.add('active');
    nameInput.focus();
}

async function handleFolderMenuDelete(folderId) {
    const folder = noteFolderState.folders.find(f => f.id === folderId);
    if (!folder) return;

    // If folder is protected, require PIN to delete
    if (folder.is_pin_protected) {
        pinState.pendingFolderId = folderId;
        pinState.pendingNoteId = null;
        pinState.pendingAction = 'delete_folder';
        openPinModal();
        return;
    }

    openConfirmModal(`Delete folder "${folder.name}"? Notes inside will be moved out.`, async () => {
        try {
            const res = await fetch(`/api/note-folders/${folderId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');

            showToast('Folder deleted', 'success', 2000);
            await loadNotesUnified();

        } catch (err) {
            console.error('Delete failed:', err);
            showToast('Failed to delete folder', 'error');
        }
    });
}

async function handleFolderMenuProtect(folderId) {
    // Check if user has notes PIN set
    if (!pinState.hasNotesPin) {
        pinState.settingNotesPin = true;
        pinState.pendingFolderId = folderId;
        pinState.pendingNoteId = null;
        pinState.pendingAction = 'protect_folder_after_set';
        openSetPinModal();
        return;
    }

    const folder = noteFolderState.folders.find(f => f.id === folderId);
    if (!folder) return;

    // If folder is protected, require PIN to unprotect
    if (folder.is_pin_protected) {
        pinState.pendingFolderId = folderId;
        pinState.pendingNoteId = null;
        pinState.pendingAction = 'unprotect_folder';
        openPinModal();
        return;
    }

    // Protecting an unprotected folder - no PIN needed
    await doProtectFolder(folderId, true);
}

async function doProtectFolder(folderId, newProtectedState) {
    try {
        const res = await fetch(`/api/note-folders/${folderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_pin_protected: newProtectedState })
        });

        if (!res.ok) {
            const data = await res.json();
            showToast(data.error || 'Failed to update protection', 'error', 3000);
            return;
        }

        showToast(newProtectedState ? 'Folder protected' : 'Protection removed', 'success', 2000);
        await loadNotesUnified();
    } catch (e) {
        console.error('Error toggling folder protection:', e);
        showToast('Error updating protection', 'error', 3000);
    }
}

/**
 * Drag reorder state for pinned notes
 */
let pinnedDragState = {
    draggingItem: null,
    dragStartY: 0,
    placeholder: null,
    touchIdentifier: null
};

/**
 * Initialize drag handlers for pinned notes reordering
 */
function initPinnedDragHandlers() {
    const pinnedItems = document.querySelectorAll('.notes-item.pinned-item');
    if (!pinnedItems.length) return;

    pinnedItems.forEach(item => {
        // Desktop drag events
        item.addEventListener('dragstart', handlePinnedDragStart);
        item.addEventListener('dragend', handlePinnedDragEnd);
        item.addEventListener('dragover', handlePinnedDragOver);
        item.addEventListener('dragleave', handlePinnedDragLeave);
        item.addEventListener('drop', handlePinnedDrop);

        // Touch drag events (on drag handle)
        const handle = item.querySelector('.notes-item-drag-handle');
        if (handle) {
            handle.addEventListener('touchstart', handlePinnedTouchStart, { passive: false });
            handle.addEventListener('touchmove', handlePinnedTouchMove, { passive: false });
            handle.addEventListener('touchend', handlePinnedTouchEnd);
        }
    });
}

// Desktop drag handlers
function handlePinnedDragStart(e) {
    pinnedDragState.draggingItem = e.currentTarget;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', e.currentTarget.dataset.itemId);
}

function handlePinnedDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.notes-item.drag-over').forEach(el => {
        el.classList.remove('drag-over');
    });
    pinnedDragState.draggingItem = null;
}

function handlePinnedDragOver(e) {
    e.preventDefault();
    const item = e.currentTarget;
    if (item === pinnedDragState.draggingItem) return;
    if (!item.classList.contains('pinned-item')) return;

    // Remove drag-over from all items
    document.querySelectorAll('.notes-item.drag-over').forEach(el => {
        el.classList.remove('drag-over');
    });

    item.classList.add('drag-over');
}

function handlePinnedDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function handlePinnedDrop(e) {
    e.preventDefault();
    const dropTarget = e.currentTarget;
    dropTarget.classList.remove('drag-over');

    if (!pinnedDragState.draggingItem || dropTarget === pinnedDragState.draggingItem) return;
    if (!dropTarget.classList.contains('pinned-item')) return;

    // Reorder in DOM
    const parent = dropTarget.parentNode;
    const allPinned = Array.from(parent.querySelectorAll('.notes-item.pinned-item'));
    const dragIndex = allPinned.indexOf(pinnedDragState.draggingItem);
    const dropIndex = allPinned.indexOf(dropTarget);

    if (dragIndex < dropIndex) {
        parent.insertBefore(pinnedDragState.draggingItem, dropTarget.nextSibling);
    } else {
        parent.insertBefore(pinnedDragState.draggingItem, dropTarget);
    }

    // Save new order
    savePinnedOrder();
}

// Touch drag handlers
function handlePinnedTouchStart(e) {
    if (e.touches.length !== 1) return;
    e.preventDefault(); // Prevent scroll
    e.stopPropagation(); // Prevent swipe handlers from intercepting

    const touch = e.touches[0];
    const item = e.currentTarget.closest('.notes-item.pinned-item');
    if (!item) return;

    pinnedDragState.draggingItem = item;
    pinnedDragState.dragStartY = touch.clientY;
    pinnedDragState.touchIdentifier = touch.identifier;
    item.classList.add('dragging');

    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(30);
}

function handlePinnedTouchMove(e) {
    if (!pinnedDragState.draggingItem) return;

    const touch = Array.from(e.touches).find(t => t.identifier === pinnedDragState.touchIdentifier);
    if (!touch) return;

    e.preventDefault();
    e.stopPropagation();

    // Find which item we're over
    const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    const itemBelow = elemBelow ? elemBelow.closest('.notes-item.pinned-item') : null;

    // Clear previous drag-over
    document.querySelectorAll('.notes-item.drag-over').forEach(el => {
        el.classList.remove('drag-over');
    });

    if (itemBelow && itemBelow !== pinnedDragState.draggingItem) {
        itemBelow.classList.add('drag-over');
    }
}

function handlePinnedTouchEnd(e) {
    if (!pinnedDragState.draggingItem) return;
    e.stopPropagation();

    const draggingItem = pinnedDragState.draggingItem;
    draggingItem.classList.remove('dragging');

    // Find the item we're dropping onto
    const dragOverItem = document.querySelector('.notes-item.pinned-item.drag-over');
    if (dragOverItem) {
        dragOverItem.classList.remove('drag-over');

        // Reorder in DOM
        const parent = dragOverItem.parentNode;
        const allPinned = Array.from(parent.querySelectorAll('.notes-item.pinned-item'));
        const dragIndex = allPinned.indexOf(draggingItem);
        const dropIndex = allPinned.indexOf(dragOverItem);

        if (dragIndex < dropIndex) {
            parent.insertBefore(draggingItem, dragOverItem.nextSibling);
        } else {
            parent.insertBefore(draggingItem, dragOverItem);
        }

        // Save new order
        savePinnedOrder();
    }

    pinnedDragState.draggingItem = null;
    pinnedDragState.touchIdentifier = null;
}

/**
 * Save the new pinned order to the backend
 */
async function savePinnedOrder() {
    const listEl = document.getElementById('notes-unified-list');
    if (!listEl) return;

    const pinnedItems = listEl.querySelectorAll('.notes-item.pinned-item');
    const ids = Array.from(pinnedItems).map(item => parseInt(item.dataset.itemId, 10));

    if (!ids.length) return;

    try {
        const res = await fetch('/api/notes/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });

        if (!res.ok) throw new Error('Reorder failed');

        // Update local state to match new order
        const newPinOrder = {};
        ids.forEach((id, index) => {
            newPinOrder[id] = index;
        });
        notesState.notes.forEach(note => {
            if (note.pinned && newPinOrder[note.id] !== undefined) {
                note.pin_order = newPinOrder[note.id];
            }
        });

    } catch (err) {
        console.error('Failed to save pinned order:', err);
        showToast('Failed to save order', 'error');
    }
}

/**
 * Initialize FAB button
 */
function initNotesFab() {
    const fab = document.getElementById('notes-fab');
    const mainBtn = document.getElementById('notes-fab-main');
    const options = document.querySelectorAll('.notes-fab-option');

    if (!fab || !mainBtn) return;

    mainBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        noteFabExpanded = !noteFabExpanded;
        fab.classList.toggle('expanded', noteFabExpanded);
    });

    options.forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = option.dataset.action;

            noteFabExpanded = false;
            fab.classList.remove('expanded');

            switch (action) {
                case 'new-note':
                    handleNewNoteClick();
                    break;
                case 'new-list':
                    openListCreateModal();
                    break;
                case 'new-folder':
                    openNoteFolderModal('create');
                    break;
            }
        });
    });

    // Close FAB when clicking outside
    document.addEventListener('click', (e) => {
        if (!fab.contains(e.target) && noteFabExpanded) {
            noteFabExpanded = false;
            fab.classList.remove('expanded');
        }
    });
}

function initNoteEditorPage() {
    const editor = document.getElementById('note-editor');
    const titleInput = document.getElementById('note-title');
    if (!editor || !titleInput) return;

    const saveBtn = document.getElementById('note-save-btn');
    const deleteBtn = document.getElementById('note-delete-btn');
    const shareBtn = document.getElementById('note-share-btn');
    const convertBtn = document.getElementById('note-convert-btn');
    const backBtn = document.getElementById('note-back-btn');
    const notesBtn = document.getElementById('note-notes-btn');
    const actionsToggle = document.getElementById('note-actions-toggle');
    const actionsMenu = document.getElementById('note-actions-menu');
    const noteId = getNoteEditorNoteId();

    const protectBtn = document.getElementById('note-protect-btn');

    if (saveBtn) saveBtn.addEventListener('click', () => saveCurrentNote({ closeAfter: true }));
    if (deleteBtn) deleteBtn.addEventListener('click', () => deleteCurrentNote());
    if (shareBtn) shareBtn.addEventListener('click', () => openShareNoteModal());
    if (convertBtn) convertBtn.addEventListener('click', () => convertCurrentNoteToList());
    if (protectBtn) protectBtn.addEventListener('click', () => toggleNoteProtection());
    if (backBtn) backBtn.addEventListener('click', () => handleNoteBack());
    if (notesBtn) notesBtn.addEventListener('click', () => handleNoteExit());

    // Check PIN status
    checkPinStatus();
    checkNotesPinStatus();
    if (actionsToggle && actionsMenu) {
        actionsToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            actionsMenu.classList.toggle('open');
        });
        actionsMenu.addEventListener('click', (e) => {
            if (e.target.closest('button')) actionsMenu.classList.remove('open');
        });
        document.addEventListener('click', (e) => {
            if (!actionsMenu.contains(e.target) && !actionsToggle.contains(e.target)) {
                actionsMenu.classList.remove('open');
            }
        });
    }

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
    setupNoteExitAutosave();

    if (noteId) {
        loadNoteForEditor(noteId);
    } else {
        prepareNewNoteEditor();
    }
}

function initListEditorPage() {
    const titleInput = document.getElementById('list-title');
    const checkboxToggle = document.getElementById('list-checkbox-toggle');
    const listId = getListEditorNoteId();
    if (!titleInput || !checkboxToggle || !listId) return;

    const saveBtn = document.getElementById('list-save-btn');
    const deleteBtn = document.getElementById('list-delete-btn');
    const shareBtn = document.getElementById('list-share-btn');
    const protectBtn = document.getElementById('list-protect-btn');
    const backBtn = document.getElementById('list-back-btn');
    const notesBtn = document.getElementById('list-notes-btn');
    const actionsToggle = document.getElementById('list-actions-toggle');
    const actionsMenu = document.getElementById('list-actions-menu');
    const stack = document.getElementById('list-pill-stack');

    if (saveBtn) saveBtn.addEventListener('click', () => saveListMetadata({ closeAfter: true }));
    if (deleteBtn) deleteBtn.addEventListener('click', () => deleteCurrentList());
    if (shareBtn) shareBtn.addEventListener('click', () => shareCurrentList());
    if (protectBtn) protectBtn.addEventListener('click', () => toggleListProtection());
    if (backBtn) backBtn.addEventListener('click', () => handleListBack());
    if (notesBtn) notesBtn.addEventListener('click', () => handleListExit());

    // Check PIN status
    checkPinStatus();
    checkNotesPinStatus();
    if (actionsToggle && actionsMenu) {
        actionsToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            actionsMenu.classList.toggle('open');
        });
        actionsMenu.addEventListener('click', (e) => {
            if (e.target.closest('button')) actionsMenu.classList.remove('open');
        });
        document.addEventListener('click', (e) => {
            if (!actionsMenu.contains(e.target) && !actionsToggle.contains(e.target)) {
                actionsMenu.classList.remove('open');
            }
        });
    }
    if (stack) {
        stack.addEventListener('click', (e) => {
            if (e.target.closest('.list-pill')) return;
            if (e.target.closest('.list-pill-input')) return;
            setListInsertionAtPosition(e.clientY);
        });
    }
    document.addEventListener('mousedown', handleListEditorOutsideClick);

    titleInput.addEventListener('input', refreshListDirtyState);
    checkboxToggle.addEventListener('change', () => {
        listState.checkboxMode = checkboxToggle.checked;
        refreshListDirtyState();
        renderListItems();
    });

    loadListForEditor(listId);
}

function handleListEditorOutsideClick(e) {
    const page = document.getElementById('list-editor-page');
    if (!page) return;
    if (listState.editingItemId !== null) return;
    if (listState.insertionIndex === null) return;
    const inputRow = page.querySelector('.list-pill-input');
    if (!inputRow) return;
    if (inputRow.contains(e.target)) return;
    const input = inputRow.querySelector('textarea');
    if (!input) return;
    if (input.value.trim() !== '') return;
    listState.insertionIndex = null;
    listState.editingItemId = null;
    renderListItems();
}

function setListInsertionAtPosition(clientY) {
    const stack = document.getElementById('list-pill-stack');
    if (!stack) return;
    const pills = Array.from(stack.querySelectorAll('.list-pill:not(.list-pill-input)'));
    let index = 0;
    for (const pill of pills) {
        const rect = pill.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        if (clientY > midpoint) {
            index += 1;
        } else {
            break;
        }
    }
    listState.insertionIndex = index;
    listState.editingItemId = null;
    renderListItems();
}

function getListEditorNoteId() {
    const page = document.getElementById('list-editor-page');
    if (!page) return null;
    const raw = page.dataset.noteId || '';
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function getListReturnUrl() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('return');
    if (raw && raw.startsWith('/')) {
        return raw;
    }
    return '/notes';
}

async function loadListForEditor(listId) {
    try {
        let list;

        // Check for pre-fetched unlocked list data (from PIN unlock)
        const unlockedDataStr = sessionStorage.getItem('unlocked_note_data');
        if (unlockedDataStr) {
            sessionStorage.removeItem('unlocked_note_data');
            const unlockedData = JSON.parse(unlockedDataStr);
            if (unlockedData.id === listId && unlockedData.data) {
                list = unlockedData.data;
            }
        }

        // If no pre-fetched data, fetch from API
        if (!list) {
            const res = await fetch(`/api/notes/${listId}`);
            if (!res.ok) {
                const data = await res.json();
                if (data.locked) {
                    showToast('This list is protected. Please unlock from the notes list.', 'warning', 3000);
                    setTimeout(() => { window.location.href = '/notes'; }, 1500);
                    return;
                }
                throw new Error('Failed to load list');
            }
            list = await res.json();
        }

        if (list.note_type !== 'list') {
            window.location.href = `/notes/${listId}`;
            return;
        }

        // Store in notesState for protection toggle to reference
        notesState.notes = [list];

        listState.listId = list.id;
        listState.items = list.items || [];
        listState.checkboxMode = !!list.checkbox_mode;
        listState.activeSnapshot = {
            title: list.title || '',
            checkboxMode: !!list.checkbox_mode
        };
        listState.dirty = false;
        listState.insertionIndex = null;
        listState.editingItemId = null;
        listState.expandedItemId = null;
        const titleInput = document.getElementById('list-title');
        const checkboxToggle = document.getElementById('list-checkbox-toggle');
        const updatedLabel = document.getElementById('list-updated-label');
        if (titleInput) titleInput.value = list.title || '';
        if (checkboxToggle) checkboxToggle.checked = !!list.checkbox_mode;
        if (updatedLabel) updatedLabel.textContent = list.updated_at ? formatNoteDate(list.updated_at) : 'New list';
        renderListItems();
        setListDirty(false);
        updateProtectButton(list.is_pin_protected); // Update protect button state
    } catch (err) {
        console.error('Error loading list:', err);
        showToast('Could not load that list.', 'error');
    }
}

function refreshListDirtyState() {
    const titleInput = document.getElementById('list-title');
    const checkboxToggle = document.getElementById('list-checkbox-toggle');
    if (!titleInput || !checkboxToggle) return;
    const snapshot = listState.activeSnapshot || { title: '', checkboxMode: false };
    const title = (titleInput.value || '').trim();
    const checkboxMode = checkboxToggle.checked;
    const dirty = title !== (snapshot.title || '') || checkboxMode !== !!snapshot.checkboxMode;
    setListDirty(dirty);
}

function setListDirty(dirty) {
    listState.dirty = dirty;
    const saveBtn = document.getElementById('list-save-btn');
    if (saveBtn) saveBtn.disabled = !dirty;
    if (!dirty) {
        if (listAutoSaveTimer) {
            clearTimeout(listAutoSaveTimer);
            listAutoSaveTimer = null;
        }
        return;
    }
    scheduleListAutosave();
}

function scheduleListAutosave() {
    if (!listState.listId) return;
    if (listAutoSaveInFlight) return;
    if (listAutoSaveTimer) clearTimeout(listAutoSaveTimer);
    listAutoSaveTimer = setTimeout(async () => {
        listAutoSaveTimer = null;
        if (!listState.dirty) return;
        if (listAutoSaveInFlight) return;
        listAutoSaveInFlight = true;
        try {
            await saveListMetadata({ silent: true, keepOpen: true });
        } catch (e) {
            console.error('List auto-save failed', e);
        } finally {
            listAutoSaveInFlight = false;
        }
    }, 800);
}

async function saveListMetadata(options = {}) {
    const { closeAfter = false, silent = false } = options;
    const listId = listState.listId;
    const titleInput = document.getElementById('list-title');
    const checkboxToggle = document.getElementById('list-checkbox-toggle');
    if (!listId || !titleInput || !checkboxToggle) return;
    const title = titleInput.value.trim() || 'Untitled List';
    const checkboxMode = checkboxToggle.checked;
    try {
        const res = await fetch(`/api/notes/${listId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, checkbox_mode: checkboxMode })
        });
        if (!res.ok) throw new Error('Save failed');
        const saved = await res.json();
        listState.activeSnapshot = {
            title: saved.title || title,
            checkboxMode: !!saved.checkbox_mode
        };
        listState.checkboxMode = !!saved.checkbox_mode;
        setListDirty(false);
        const updatedLabel = document.getElementById('list-updated-label');
        if (updatedLabel) updatedLabel.textContent = saved.updated_at ? formatNoteDate(saved.updated_at) : 'Saved';
        if (closeAfter) {
            window.location.href = getListReturnUrl();
        }
    } catch (err) {
        console.error('Error saving list:', err);
        if (!silent) {
            showToast('Could not save list.', 'error');
        }
    }
}

async function handleListExit() {
    if (listState.dirty) {
        await saveListMetadata({ closeAfter: true });
        return;
    }
    window.location.href = getListReturnUrl();
}

async function handleListBack() {
    if (listState.dirty) {
        await saveListMetadata({ closeAfter: true });
        return;
    }
    if (window.history.length > 1) {
        window.history.back();
        return;
    }
    window.location.href = getListReturnUrl();
}

async function deleteCurrentList() {
    const listId = listState.listId;
    if (!listId) return;
    openConfirmModal('Delete this list?', async () => {
        try {
            const res = await fetch(`/api/notes/${listId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            window.location.href = getListReturnUrl();
        } catch (err) {
            console.error('Error deleting list:', err);
            showToast('Could not delete list.', 'error');
        }
    });
}

function sortListItemsForShare(items) {
    return (items || []).slice().sort((a, b) => {
        const aOrder = a.order_index || 0;
        const bOrder = b.order_index || 0;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return (a.id || 0) - (b.id || 0);
    });
}

function buildListShareText(items, checkboxMode) {
    const sorted = sortListItemsForShare(items);
    const lines = [];
    sorted.forEach((item) => {
        if (isListSectionItem(item)) {
            const title = getListSectionTitle(item);
            if (lines.length) lines.push('');
            if (title) lines.push(title);
            lines.push('');
            return;
        }
        const textValue = (item.text || '').trim();
        const linkLabel = (item.link_text || '').trim();
        const linkUrl = (item.link_url || '').trim();
        const noteValue = (item.note || '').trim();
        let line = textValue;

        if (linkLabel) {
            if (line && linkLabel !== line) line = `${line} - ${linkLabel}`;
            else if (!line) line = linkLabel;
        }

        if (linkUrl) {
            if (line) line = `${line} (${linkUrl})`;
            else line = linkUrl;
        }

        if (noteValue) {
            line = line ? `${line} - ${noteValue}` : noteValue;
        }

        if (!line) return '';
        if (checkboxMode) {
            lines.push(`${item.checked ? '[x]' : '[ ]'} ${line}`);
            return;
        }
        lines.push(`- ${line}`);
    });

    while (lines.length && lines[0] === '') lines.shift();
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
}

async function shareListContent({ title, items, checkboxMode }) {
    const shareTitle = title || 'Untitled List';
    const shareText = buildListShareText(items, checkboxMode);
    if (typeof window.universalShare === 'function') {
        const result = await window.universalShare({ title: shareTitle, text: shareText });
        if (result.cancelled) return result;
        if (result.success && result.method === 'clipboard') {
            showToast('List copied to clipboard', 'success', 2000);
        }
        return result;
    }

    const fallbackText = `${shareTitle}\n\n${shareText}`.trim();
    try {
        await navigator.clipboard.writeText(fallbackText);
        showToast('List copied to clipboard', 'success', 2000);
        return { success: true, method: 'clipboard' };
    } catch (err) {
        console.error('Share list failed:', err);
        showToast('Could not share list', 'error', 2000);
        return { success: false, method: 'none' };
    }
}

async function shareCurrentList() {
    const titleInput = document.getElementById('list-title');
    const title = titleInput ? titleInput.value.trim() : '';
    return shareListContent({
        title,
        items: listState.items || [],
        checkboxMode: !!listState.checkboxMode
    });
}

const LIST_SECTION_PREFIX = '[[section]]';

function isListSectionItem(item) {
    const textValue = (item?.text || '').trim();
    return textValue.startsWith(LIST_SECTION_PREFIX);
}

function getListSectionTitle(item) {
    const textValue = (item?.text || '').trim();
    if (!textValue.startsWith(LIST_SECTION_PREFIX)) return '';
    return textValue.slice(LIST_SECTION_PREFIX.length).trim();
}

function buildListSectionText(title) {
    const trimmed = (title || '').trim();
    return trimmed ? `${LIST_SECTION_PREFIX} ${trimmed}` : LIST_SECTION_PREFIX;
}

function renderListItems() {
    const stack = document.getElementById('list-pill-stack');
    if (!stack) return;
    const items = (listState.items || []).slice().sort((a, b) => {
        const aOrder = a.order_index || 0;
        const bOrder = b.order_index || 0;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return (a.id || 0) - (b.id || 0);
    });
    stack.innerHTML = '';
    const hasSections = items.some(isListSectionItem);
    let activeSectionBody = null;

    const appendInsertionRow = (insertIndex, target) => {
        if (listState.insertionIndex !== insertIndex) return;
        const row = createListInputRow({
            mode: 'insert',
            insertIndex,
            autoFocus: true
        });
        target.appendChild(row);
    };

    items.forEach((item, index) => {
        const isSection = isListSectionItem(item);
        if (isSection) {
            const section = document.createElement('div');
            section.className = 'list-section';
            const title = getListSectionTitle(item);
            const isEditing = listState.editingItemId === item.id;
            if (title && !isEditing) {
                section.classList.add('has-title');
            } else {
                section.classList.add('no-title');
            }
            if (isEditing) {
                const row = createListInputRow({
                    mode: 'edit',
                    itemId: item.id,
                    insertIndex: index,
                    value: title,
                    placeholder: 'Section title (optional)',
                    autoFocus: true,
                    isSection: true
                });
                section.appendChild(row);
            } else {
                const header = document.createElement('div');
                header.className = 'list-section-header';
                if (title) {
                    header.textContent = title;
                } else {
                    header.classList.add('empty');
                }
                header.addEventListener('click', (e) => {
                    e.stopPropagation();
                    listState.editingItemId = item.id;
                    listState.insertionIndex = null;
                    renderListItems();
                });
                section.appendChild(header);
            }
            const body = document.createElement('div');
            body.className = 'list-section-body';
            section.appendChild(body);
            stack.appendChild(section);
            activeSectionBody = body;
            return;
        }

        if (hasSections && !activeSectionBody) {
            const section = document.createElement('div');
            section.className = 'list-section no-title';
            // Add clickable header to create a section for these items
            const header = document.createElement('div');
            header.className = 'list-section-header empty';
            header.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    await createListItem({ text: buildListSectionText('') }, 0);
                    await loadListItems();
                    // Find the section at the beginning (lowest order_index)
                    const sections = listState.items.filter(i => isListSectionItem(i));
                    const firstSection = sections.sort((a, b) => (a.order_index || 0) - (b.order_index || 0))[0];
                    if (firstSection) {
                        listState.editingItemId = firstSection.id;
                        renderListItems();
                    }
                } catch (err) {
                    console.error('Failed to create section:', err);
                }
            });
            section.appendChild(header);
            const body = document.createElement('div');
            body.className = 'list-section-body';
            section.appendChild(body);
            stack.appendChild(section);
            activeSectionBody = body;
        }

        const target = activeSectionBody || stack;
        if (listState.editingItemId === item.id) {
            const row = createListInputRow({
                mode: 'edit',
                itemId: item.id,
                insertIndex: index,
                value: getListItemMainText(item),
                noteValue: item.note,
                autoFocus: true
            });
            target.appendChild(row);
        } else {
            target.appendChild(createListPill(item));
        }
        const gapIndex = index + 1;
        target.appendChild(createListGap(gapIndex));
        appendInsertionRow(gapIndex, target);
    });

    const primaryTarget = activeSectionBody || stack;
    primaryTarget.appendChild(createListInputRow({
        mode: 'new',
        insertIndex: items.length,
        placeholder: 'Add item... (use /section to split)',
        isPrimary: true
    }));
}

function createListGap(insertIndex) {
    const gap = document.createElement('div');
    gap.className = 'list-gap';
    gap.tabIndex = 0;
    const activate = () => {
        listState.insertionIndex = insertIndex;
        listState.editingItemId = null;
        renderListItems();
    };
    gap.addEventListener('click', activate);
    gap.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            activate();
        }
    });
    return gap;
}

function createListPill(item) {
    const pill = document.createElement('div');
    const hasNote = !!(item.note && item.note.trim());
    const isExpanded = hasNote && listState.expandedItemId === item.id;
    pill.className = `list-pill${hasNote ? ' has-note' : ''}${isExpanded ? ' expanded' : ''}`;
    const content = document.createElement('div');
    content.className = 'list-pill-content';
    const textValue = (item.text || '').trim();
    const linkLabel = (item.link_text || '').trim();
    const linkUrl = (item.link_url || '').trim();
    const linkSameAsText = linkLabel && textValue && linkLabel === textValue;

    if (listState.checkboxMode) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'list-checkbox';
        checkbox.checked = !!item.checked;
        checkbox.addEventListener('click', (e) => e.stopPropagation());
        checkbox.addEventListener('change', async () => {
            await updateListItem(item.id, { checked: checkbox.checked }, { refresh: true });
        });
        pill.appendChild(checkbox);
    }

    if (!linkSameAsText && textValue) {
        const textSpan = document.createElement('span');
        textSpan.textContent = textValue;
        content.appendChild(textSpan);
    }

    if (linkLabel && linkUrl) {
        const link = document.createElement('a');
        link.href = linkUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = linkLabel;
        link.addEventListener('click', (e) => e.stopPropagation());
        content.appendChild(link);
    }

    if (hasNote) {
        const noteBadge = document.createElement('span');
        noteBadge.className = 'list-note-indicator';
        noteBadge.title = 'Has note';
        content.appendChild(noteBadge);
    }

    pill.appendChild(content);
    if (hasNote) {
        const note = document.createElement('div');
        note.className = 'list-pill-note';
        note.textContent = item.note;
        note.style.display = isExpanded ? 'block' : 'none';
        pill.appendChild(note);
    }

    pill.addEventListener('click', () => {
        if (hasNote && listState.expandedItemId !== item.id) {
            listState.expandedItemId = item.id;
            listState.editingItemId = null;
            listState.insertionIndex = null;
            renderListItems();
            return;
        }
        listState.expandedItemId = null;
        listState.editingItemId = item.id;
        listState.insertionIndex = null;
        renderListItems();
    });

    return pill;
}

function createListInputRow(options) {
    const { mode, itemId, insertIndex, value, placeholder, autoFocus, noteValue, isSection, isPrimary } = options;
    const row = document.createElement('div');
    row.className = `list-pill list-pill-input${mode === 'edit' ? ' expanded' : ''}`;
    const input = document.createElement('textarea');
    input.rows = 1;
    input.value = value || '';
    input.placeholder = placeholder || '';
    let committed = false;
    let noteInput = null;
    const initialNoteValue = noteValue || '';
    const hasExistingNote = initialNoteValue.trim().length > 0;

    const commit = async (continueInserting = false) => {
        if (committed) return;
        committed = true;
        const raw = input.value.trim();
        if (!raw && !isSection) {
            if (mode === 'edit' && itemId) {
                await deleteListItem(itemId);
            }
            resetListInputState();
            return;
        }
        let parsed;
        if (isSection) {
            parsed = { text: buildListSectionText(raw) };
        } else if (mode === 'edit') {
            parsed = hasExistingNote ? parseListItemMainInput(raw) : parseListItemInput(raw);
        } else {
            parsed = parseListItemInput(raw);
        }
        if (!parsed.text) {
            resetListInputState();
            return;
        }
        if (mode === 'edit' && noteInput && !isSection) {
            const currentNote = noteInput.value;
            const noteEdited = currentNote !== initialNoteValue;
            if (noteEdited) {
                const noteText = currentNote.trim();
                parsed.note = noteText || null;
            } else if (hasExistingNote) {
                delete parsed.note;
            }
        }
        try {
            if (mode === 'edit' && itemId) {
                await updateListItem(itemId, parsed);
            } else {
                await createListItem(parsed, insertIndex);
            }
        } catch (err) {
            console.error('List item save failed:', err);
            showToast('Could not save item.', 'error');
            return;
        }
        // For insert mode with Enter, continue inserting at next position
        if (continueInserting && mode === 'insert') {
            listState.insertionIndex = insertIndex + 1;
            listState.editingItemId = null;
            await loadListItems();
        } else if (isPrimary) {
            // Primary input at bottom - stay there
            listState.insertionIndex = null;
            listState.editingItemId = null;
            await loadListItems({ focusPrimary: true });
        } else {
            resetListInputState();
        }
    };

      const resetListInputState = () => {
          listState.insertionIndex = null;
          listState.editingItemId = null;
          listState.expandedItemId = null;
          loadListItems();
      };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commit(true); // Continue inserting after Enter
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            listState.insertionIndex = null;
            listState.editingItemId = null;
            renderListItems();
        }
    });

    const handleBlurCommit = () => {
        // Handle section title editing - always save on blur
        if (mode === 'edit' && isSection) {
            setTimeout(() => {
                if (row.contains(document.activeElement)) return;
                commit(false);
            }, 0);
            return;
        }
        if (mode !== 'new' && mode !== 'insert') return;
        if (input.value.trim() === '') {
            setTimeout(() => {
                if (row.contains(document.activeElement)) return;
                listState.insertionIndex = null;
                listState.editingItemId = null;
                renderListItems();
            }, 0);
            return;
        }
        setTimeout(() => {
            if (row.contains(document.activeElement)) return;
            commit(false); // Don't continue inserting on blur
        }, 0);
    };

    input.addEventListener('blur', handleBlurCommit);

    row.appendChild(input);
    if (mode === 'edit' && !isSection) {
        noteInput = document.createElement('textarea');
        noteInput.className = 'list-pill-note-edit';
        noteInput.rows = 1;
        noteInput.placeholder = 'Add note...';
        noteInput.value = noteValue || '';
        noteInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commit();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                listState.insertionIndex = null;
                listState.editingItemId = null;
                renderListItems();
            }
        });
        noteInput.addEventListener('blur', handleBlurCommit);
        row.appendChild(noteInput);
    }
    if (autoFocus) {
        requestAnimationFrame(() => {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        });
    }
    return row;
}

function getListItemMainText(item) {
    if (isListSectionItem(item)) {
        return getListSectionTitle(item);
    }
    const textValue = (item.text || '').trim();
    const linkLabel = (item.link_text || '').trim();
    const linkUrl = (item.link_url || '').trim();
    let text = textValue;
    if (linkLabel && linkUrl) {
        if (textValue && textValue !== linkLabel) {
            text = `${textValue} [${linkLabel}](${linkUrl})`.trim();
        } else {
            text = `[${linkLabel}](${linkUrl})`;
        }
    }
    return text;
}

function parseListItemInput(raw) {
    const sectionMatch = raw.match(/^\/section(?:\s+(.*))?$/i);
    if (sectionMatch) {
        const title = sectionMatch[1] || '';
        return { text: buildListSectionText(title) };
    }
    const noteSplit = raw.indexOf('::');
    let main = raw;
    let noteText = null;
    if (noteSplit >= 0) {
        main = raw.slice(0, noteSplit).trim();
        noteText = raw.slice(noteSplit + 2).trim() || null;
    }
    const linkMatch = main.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
    let linkText = null;
    let linkUrl = null;
    let baseText = main;
    if (linkMatch) {
        linkText = linkMatch[1].trim();
        linkUrl = linkMatch[2].trim();
        baseText = main.replace(linkMatch[0], '').trim();
    }
    const text = (baseText || linkText || '').trim();
    return { text, note: noteText, link_text: linkText, link_url: linkUrl };
}

function parseListItemMainInput(raw) {
    const linkMatch = raw.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
    let linkText = null;
    let linkUrl = null;
    let baseText = raw;
    if (linkMatch) {
        linkText = linkMatch[1].trim();
        linkUrl = linkMatch[2].trim();
        baseText = raw.replace(linkMatch[0], '').trim();
    }
    const text = (baseText || linkText || '').trim();
    return { text, note: null, link_text: linkText, link_url: linkUrl };
}

async function loadListItems(options = {}) {
    const { focusPrimary = false } = options;
    if (!listState.listId) return;
    try {
        const res = await fetch(`/api/notes/${listState.listId}/list-items`);
        if (!res.ok) throw new Error('Failed to load items');
        listState.items = await res.json();
        renderListItems();
        if (focusPrimary) {
            const inputs = document.querySelectorAll('.list-pill-input textarea');
            const last = inputs[inputs.length - 1];
            if (last) last.focus();
        }
    } catch (err) {
        console.error('Error loading list items:', err);
    }
}

async function createListItem(payload, insertIndex) {
    if (!listState.listId) return;
    const res = await fetch(`/api/notes/${listState.listId}/list-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...payload,
            insert_index: insertIndex
        })
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Create failed');
    }
    const updatedLabel = document.getElementById('list-updated-label');
    if (updatedLabel) updatedLabel.textContent = formatNoteDate(new Date().toISOString());
}

async function updateListItem(itemId, payload, options = {}) {
    if (!listState.listId) return;
    const res = await fetch(`/api/notes/${listState.listId}/list-items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Update failed');
    }
    if (options.refresh) {
        await loadListItems();
    }
    const updatedLabel = document.getElementById('list-updated-label');
    if (updatedLabel) updatedLabel.textContent = formatNoteDate(new Date().toISOString());
}

async function deleteListItem(itemId) {
    if (!listState.listId) return;
    const res = await fetch(`/api/notes/${listState.listId}/list-items/${itemId}`, { method: 'DELETE' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Delete failed');
    }
    const updatedLabel = document.getElementById('list-updated-label');
    if (updatedLabel) updatedLabel.textContent = formatNoteDate(new Date().toISOString());
}

function isMobileNotesView() {
    return window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
}

function scrollToNoteEditor() {
    const editorCard = document.querySelector('.notes-editor.card');
    if (!editorCard) return;
    editorCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getNoteEditorNoteId() {
    const page = document.getElementById('note-editor-page');
    if (!page) return null;
    const raw = page.dataset.noteId || '';
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function getNoteEditorFolderId() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('folder') || params.get('folder_id');
    const parsed = raw ? parseInt(raw, 10) : null;
    return Number.isFinite(parsed) ? parsed : null;
}

function getNoteReturnUrl() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('return');
    if (raw && raw.startsWith('/')) {
        return raw;
    }
    return '/notes';
}

function prepareNewNoteEditor() {
    const editor = document.getElementById('note-editor');
    const titleInput = document.getElementById('note-title');
    const updatedLabel = document.getElementById('note-updated-label');
    const folderId = getNoteEditorFolderId();
    if (editor) editor.innerHTML = '';
    if (titleInput) titleInput.value = '';
    if (titleInput) titleInput.placeholder = 'Untitled note';
    if (updatedLabel) updatedLabel.textContent = 'New note';
    notesState.notes = [];
    notesState.activeNoteId = null;
    notesState.activeSnapshot = { title: '', content: '' };
    notesState.activeFolderId = folderId;
    notesState.checkboxMode = false;
    setNoteDirty(false);
    updateNoteToolbarStates();
}

async function loadNoteForEditor(noteId) {
    try {
        // Check for pre-fetched unlocked note data (from PIN unlock)
        const unlockedDataStr = sessionStorage.getItem('unlocked_note_data');
        if (unlockedDataStr) {
            sessionStorage.removeItem('unlocked_note_data');
            const unlockedData = JSON.parse(unlockedDataStr);
            if (unlockedData.id === noteId && unlockedData.data) {
                const note = unlockedData.data;
                notesState.notes = [note];
                await setActiveNote(note.id, { skipAutosave: true });
                return;
            }
        }

        const res = await fetch(`/api/notes/${noteId}`);
        if (!res.ok) {
            const data = await res.json();
            if (data.locked) {
                // Note is protected and locked - redirect back
                showToast('This note is protected. Please unlock from the notes list.', 'warning', 3000);
                setTimeout(() => { window.location.href = '/notes'; }, 1500);
                return;
            }
            throw new Error('Failed to load note');
        }
        const note = await res.json();
        notesState.notes = [note];
        await setActiveNote(note.id, { skipAutosave: true });
    } catch (err) {
        console.error('Error loading note:', err);
        showToast('Could not load that note.', 'error');
    }
}

function noteHasContent() {
    const editor = document.getElementById('note-editor');
    const titleInput = document.getElementById('note-title');
    const title = titleInput ? titleInput.value.trim() : '';
    if (title) return true;
    if (!editor) return false;
    const text = (editor.textContent || '').replace(/\u00a0/g, ' ').trim();
    if (text) return true;
    return editor.querySelector('input[type="checkbox"]') !== null;
}

function isStandaloneNoteEditor() {
    return !!document.getElementById('note-editor') && !document.getElementById('notes-list');
}

async function handleNoteExit() {
    noteExitInProgress = true;
    if (notesState.dirty && noteHasContent()) {
        await saveCurrentNote({ closeAfter: true });
        return;
    }
    window.location.href = getNoteReturnUrl();
}

async function handleNoteBack() {
    noteExitInProgress = true;
    if (notesState.dirty && noteHasContent()) {
        await saveCurrentNote({ closeAfter: true });
        return;
    }
    if (window.history.length > 1) {
        window.history.back();
        return;
    }
    window.location.href = getNoteReturnUrl();
}

function setupNoteExitAutosave() {
    let exitSaveTriggered = false;
    const onExit = () => {
        if (exitSaveTriggered) return;
        exitSaveTriggered = true;
        saveNoteOnExit();
    };
    window.addEventListener('pagehide', onExit);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            onExit();
        }
    });
}

function saveNoteOnExit() {
    if (noteExitInProgress || !notesState.dirty || !noteHasContent()) return;
    saveCurrentNote({ silent: true, keepOpen: true, keepalive: true });
}

function handleNewNoteClick() {
    const folderId = noteFolderState.currentFolderId;
    const returnTo = window.location.pathname;
    if (folderId) {
        window.location.href = `/notes/new?folder=${folderId}&return=${encodeURIComponent(returnTo)}`;
        return;
    }
    window.location.href = `/notes/new?return=${encodeURIComponent(returnTo)}`;
}

function openNoteInEditor(noteId) {
    const returnTo = window.location.pathname;
    const suffix = returnTo ? `?return=${encodeURIComponent(returnTo)}` : '';
    window.location.href = `/notes/${noteId}${suffix}`;
}

function openNoteInEditorWithData(noteId, noteData) {
    // Store the pre-fetched note data for the editor to use
    sessionStorage.setItem('unlocked_note_data', JSON.stringify({ id: noteId, data: noteData }));
    const returnTo = window.location.pathname;
    const suffix = returnTo ? `?return=${encodeURIComponent(returnTo)}` : '';
    window.location.href = `/notes/${noteId}${suffix}`;
}

async function loadNoteFolders() {
    const listEl = document.getElementById('notes-folder-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="empty-state"><p style="color: var(--text-muted); margin: 0;">Loading folders...</p></div>';
    try {
        const res = await fetch('/api/note-folders');
        if (!res.ok) throw new Error('Failed to load folders');
        const folders = await res.json();
        noteFolderState.folders = folders || [];
        renderNoteFolders();
    } catch (err) {
        console.error('Error loading folders:', err);
        listEl.innerHTML = '<div class="empty-state"><p style="color: var(--text-muted); margin: 0;">Could not load folders.</p></div>';
    }
}

function renderNoteFolders() {
    const listEl = document.getElementById('notes-folder-list');
    if (!listEl) return;
    const currentParentId = noteFolderState.currentFolderId;
    const folders = noteFolderState.folders
        .filter(f => (f.parent_id || null) === (currentParentId || null))
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    listEl.innerHTML = '';
    if (!folders.length) {
        listEl.innerHTML = '<div class="empty-state"><p style="color: var(--text-muted); margin: 0;">No folders yet.</p></div>';
        return;
    }

    folders.forEach(folder => {
        const row = document.createElement('div');
        row.className = 'notes-folder-item';
        row.innerHTML = `
            <div class="notes-folder-main">
                <i class="fa-solid fa-folder"></i>
                <span>${escapeHtml(folder.name)}</span>
            </div>
            <div class="notes-folder-actions">
                <button class="btn-icon" title="Rename folder"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-icon delete" title="Delete folder"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        row.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            window.location.href = `/notes/folder/${folder.id}`;
        });

        const actionButtons = row.querySelectorAll('.notes-folder-actions .btn-icon');
        if (actionButtons[0]) {
            actionButtons[0].addEventListener('click', (e) => {
                e.stopPropagation();
                openNoteFolderModal('rename', folder);
            });
        }
        if (actionButtons[1]) {
            actionButtons[1].addEventListener('click', (e) => {
                e.stopPropagation();
                deleteNoteFolder(folder.id, folder.name);
            });
        }

        listEl.appendChild(row);
    });
}

async function openListCreateModal() {
    const modal = document.getElementById('note-list-modal');
    if (!modal) return;
    const titleInput = document.getElementById('note-list-title');
    const checkboxToggle = document.getElementById('note-list-checkbox-toggle');
    if (titleInput) titleInput.value = '';
    if (checkboxToggle) checkboxToggle.checked = false;
    if (!noteFolderState.folders.length) {
        await loadNoteFolders();
    }
    populateListFolderSelect();
    modal.classList.add('active');
    if (titleInput) titleInput.focus();
}

function closeListCreateModal() {
    const modal = document.getElementById('note-list-modal');
    if (modal) modal.classList.remove('active');
}

function populateListFolderSelect() {
    const select = document.getElementById('note-list-folder');
    if (!select) return;
    select.innerHTML = '<option value="">No folder</option>';
    const folders = noteFolderState.folders || [];

    const buildOptions = (parentId, prefix) => {
        folders
            .filter(f => (f.parent_id || null) === (parentId || null))
            .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
            .forEach(folder => {
                const opt = document.createElement('option');
                opt.value = folder.id;
                opt.textContent = `${prefix}${folder.name}`;
                select.appendChild(opt);
                buildOptions(folder.id, `${prefix}— `);
            });
    };

    buildOptions(null, '');
    if (noteFolderState.currentFolderId) {
        select.value = String(noteFolderState.currentFolderId);
    }
}

async function createListFromModal() {
    const titleInput = document.getElementById('note-list-title');
    const checkboxToggle = document.getElementById('note-list-checkbox-toggle');
    const folderSelect = document.getElementById('note-list-folder');
    const title = titleInput ? titleInput.value.trim() : '';
    if (!title) {
        alert('List title required');
        return;
    }
    const checkboxMode = checkboxToggle ? checkboxToggle.checked : false;
    const folderId = folderSelect ? folderSelect.value : '';
    try {
        const res = await fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                note_type: 'list',
                checkbox_mode: checkboxMode,
                folder_id: folderId || null
            })
        });
        if (!res.ok) throw new Error('Failed to create list');
        const list = await res.json();
        closeListCreateModal();
        const returnTo = window.location.pathname;
        window.location.href = `/notes/${list.id}?return=${encodeURIComponent(returnTo)}`;
    } catch (err) {
        console.error('Error creating list:', err);
        alert('Could not create list');
    }
}

function openNoteFolderModal(mode = 'create', folder = null) {
    const modal = document.getElementById('note-folder-modal');
    if (!modal) return;
    const title = document.getElementById('note-folder-modal-title');
    const nameInput = document.getElementById('note-folder-name');
    const idInput = document.getElementById('note-folder-id');

    if (mode === 'rename' && folder) {
        if (title) title.textContent = 'Rename Folder';
        if (nameInput) nameInput.value = folder.name || '';
        if (idInput) idInput.value = folder.id;
    } else {
        if (title) title.textContent = 'New Folder';
        if (nameInput) nameInput.value = '';
        if (idInput) idInput.value = '';
    }

    modal.classList.add('active');
    if (nameInput) nameInput.focus();
}

function closeNoteFolderModal() {
    const modal = document.getElementById('note-folder-modal');
    if (modal) modal.classList.remove('active');
}

async function saveNoteFolder() {
    const nameInput = document.getElementById('note-folder-name');
    const idInput = document.getElementById('note-folder-id');
    const name = nameInput ? nameInput.value.trim() : '';
    if (!name) {
        alert('Folder name required');
        return;
    }
    const folderId = idInput ? idInput.value : '';
    const payload = { name };
    if (!folderId) {
        payload.parent_id = noteFolderState.currentFolderId;
    }
    try {
        let res;
        if (folderId) {
            res = await fetch(`/api/note-folders/${folderId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            res = await fetch('/api/note-folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }
        if (!res.ok) throw new Error('Folder save failed');
        closeNoteFolderModal();
        showToast(folderId ? 'Folder renamed' : 'Folder created', 'success', 2000);
        await loadNotesUnified();
    } catch (err) {
        console.error('Error saving folder:', err);
        showToast('Could not save folder', 'error');
    }
}

function deleteNoteFolder(folderId, folderName) {
    openConfirmModal(`Delete folder "${folderName}"?`, async () => {
        try {
            const res = await fetch(`/api/note-folders/${folderId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            showToast('Folder deleted', 'success', 2000);
            await loadNotesUnified();
        } catch (err) {
            console.error('Error deleting folder:', err);
            showToast('Could not delete folder', 'error');
        }
    });
}

function openNoteMoveModal(noteId = null) {
    const modal = document.getElementById('note-move-modal');
    if (!modal) return;
    let ids = [];
    if (noteId) {
        ids = [noteId];
    } else if (selectedNotes.size > 0) {
        ids = Array.from(selectedNotes);
    } else {
        return;
    }
    noteMoveState.ids = ids;
    noteMoveState.destinationFolderId = null;
    noteMoveState.navStack = [];
    const title = document.getElementById('note-move-title');
    if (title) {
        title.textContent = ids.length > 1 ? `Move ${ids.length} notes` : 'Move Note';
    }
    modal.classList.add('active');
    if (!noteFolderState.folders.length) {
        loadNoteFolders();
    }
    renderNoteMoveRoot();
}

function closeNoteMoveModal() {
    const modal = document.getElementById('note-move-modal');
    if (modal) modal.classList.remove('active');
    noteMoveState.ids = [];
    noteMoveState.destinationFolderId = null;
    noteMoveState.navStack = [];
    updateNoteMoveBackButton();
}

function updateNoteMoveBackButton() {
    const backBtn = document.getElementById('note-move-back-button');
    if (!backBtn) return;
    backBtn.style.display = noteMoveState.navStack.length > 1 ? 'inline-flex' : 'none';
}

function pushNoteMoveView(renderFn) {
    noteMoveState.navStack.push(renderFn);
    updateNoteMoveBackButton();
}

function noteMoveNavBack() {
    if (noteMoveState.navStack.length > 1) {
        noteMoveState.navStack.pop();
        const last = noteMoveState.navStack[noteMoveState.navStack.length - 1];
        last();
    }
    updateNoteMoveBackButton();
}

function renderNoteMoveRoot() {
    const panel = document.getElementById('note-move-step-container');
    if (!panel) return;
    noteMoveState.navStack = [renderNoteMoveRoot];
    updateNoteMoveBackButton();
    panel.innerHTML = `
        <div class="move-heading"><i class="fa-solid fa-folder-tree" style="margin-right: 0.5rem;"></i>Choose destination</div>
    `;
    const mainBtn = document.createElement('button');
    mainBtn.className = 'btn';
    mainBtn.innerHTML = '<i class="fa-solid fa-house" style="margin-right: 0.5rem;"></i>Move to main notes';
    mainBtn.addEventListener('click', () => performNoteMove(null));
    panel.appendChild(mainBtn);

    const browseBtn = document.createElement('button');
    browseBtn.className = 'btn';
    browseBtn.innerHTML = '<i class="fa-solid fa-folder-open" style="margin-right: 0.5rem;"></i>Browse folders';
    browseBtn.addEventListener('click', () => {
        pushNoteMoveView(() => renderNoteMoveFolderList(null, 'Folders'));
        renderNoteMoveFolderList(null, 'Folders');
    });
    panel.appendChild(browseBtn);
}

function renderNoteMoveFolderList(parentId, titleText) {
    const panel = document.getElementById('note-move-step-container');
    if (!panel) return;
    panel.innerHTML = `<div class="move-heading"><i class="fa-solid fa-folder-tree" style="margin-right: 0.5rem;"></i>${titleText}</div>`;

    if (parentId !== null) {
        const moveHereBtn = document.createElement('button');
        moveHereBtn.className = 'btn';
        moveHereBtn.innerHTML = '<i class="fa-solid fa-folder" style="margin-right: 0.5rem;"></i>Move to this folder';
        moveHereBtn.addEventListener('click', () => performNoteMove(parentId));
        panel.appendChild(moveHereBtn);
    }

    const folders = noteFolderState.folders
        .filter(f => (f.parent_id || null) === (parentId || null))
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    if (!folders.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = '<p style="color: var(--text-muted); margin: 0;">No subfolders here.</p>';
        panel.appendChild(empty);
        return;
    }

    folders.forEach(folder => {
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.innerHTML = `<i class="fa-solid fa-folder" style="margin-right: 0.5rem;"></i>${escapeHtml(folder.name)}`;
        btn.addEventListener('click', () => {
            pushNoteMoveView(() => renderNoteMoveFolderList(folder.id, folder.name));
            renderNoteMoveFolderList(folder.id, folder.name);
        });
        panel.appendChild(btn);
    });
}

async function performNoteMove(folderId) {
    try {
        const res = await fetch('/api/notes/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: noteMoveState.ids, folder_id: folderId })
        });
        if (!res.ok) throw new Error('Move failed');
        closeNoteMoveModal();
        resetNoteSelection();
        showToast('Moved', 'success', 2000);
        await loadNotesUnified();
    } catch (err) {
        console.error('Error moving notes:', err);
        showToast('Could not move notes', 'error');
    }
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
        toggleBlockquote();
        setNoteDirty(true);
        updateNoteToolbarStates();
        return;
    }
    if (command === 'code') {
        toggleInlineCode();
        setNoteDirty(true);
        updateNoteToolbarStates();
        return;
    }

    // Map commands to HTML tags
    const formatMap = {
        'bold': ['STRONG', 'B'],
        'italic': ['EM', 'I'],
        'underline': ['U'],
        'strikeThrough': ['S', 'STRIKE', 'DEL'],
        'insertUnorderedList': ['UL'],
        'insertOrderedList': ['OL'],
        'removeFormat': null
    };

    if (command === 'removeFormat') {
        removeAllFormatting();
        setNoteDirty(true);
        updateNoteToolbarStates();
        return;
    }

    if (command === 'insertUnorderedList' || command === 'insertOrderedList') {
        // Use execCommand for lists as it handles them well
        document.execCommand(command, false, null);
        setNoteDirty(true);
        setTimeout(() => updateNoteToolbarStates(), 10);
        return;
    }

    // Handle inline formatting with proper toggle
    const tags = formatMap[command];
    if (tags) {
        toggleInlineFormat(tags[0], tags);
        setNoteDirty(true);
        setTimeout(() => updateNoteToolbarStates(), 10);
    }
}

// Toggle inline formatting (bold, italic, underline, strikethrough)
function toggleInlineFormat(primaryTag, allTags) {
    const editor = document.getElementById('note-editor');
    if (!editor) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);

    // Check if cursor/selection is inside any of the format tags
    let existingFormat = null;
    for (const tag of allTags) {
        existingFormat = findAncestorInEditor(sel.focusNode, tag, editor);
        if (existingFormat) break;
    }

    if (existingFormat) {
        // Remove formatting - unwrap the element
        unwrapFormatElement(existingFormat);
        return;
    }

    // Apply new formatting
    if (range.collapsed) {
        // No selection - insert empty formatted element for typing
        const wrapper = document.createElement(primaryTag.toLowerCase());
        wrapper.appendChild(document.createTextNode('\u200B')); // Zero-width space
        range.insertNode(wrapper);

        // Position cursor inside
        const newRange = document.createRange();
        newRange.setStart(wrapper.firstChild, 1);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
    } else {
        // Wrap selected content
        const wrapper = document.createElement(primaryTag.toLowerCase());
        try {
            const contents = range.extractContents();
            wrapper.appendChild(contents);
            range.insertNode(wrapper);

            // Select the wrapped content
            const newRange = document.createRange();
            newRange.selectNodeContents(wrapper);
            sel.removeAllRanges();
            sel.addRange(newRange);
        } catch (e) {
            // Fallback if extraction fails
            const text = range.toString();
            range.deleteContents();
            wrapper.textContent = text;
            range.insertNode(wrapper);
        }
    }
}

// Unwrap a formatting element, preserving contents and cursor position
function unwrapFormatElement(element) {
    const sel = window.getSelection();
    const parent = element.parentNode;
    if (!parent) return;

    // Move all children out of the element
    const fragment = document.createDocumentFragment();
    let lastChild = null;
    while (element.firstChild) {
        lastChild = element.firstChild;
        fragment.appendChild(lastChild);
    }

    // Replace element with its contents
    parent.insertBefore(fragment, element);
    parent.removeChild(element);

    // Normalize to merge adjacent text nodes
    parent.normalize();

    // Restore cursor position
    if (sel && lastChild) {
        const newRange = document.createRange();
        if (lastChild.nodeType === 3) {
            newRange.setStart(lastChild, lastChild.length);
        } else {
            newRange.setStartAfter(lastChild);
        }
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
    }
}

// Remove all formatting from selection
function removeAllFormatting() {
    const editor = document.getElementById('note-editor');
    if (!editor) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    if (range.collapsed) return;

    // Get plain text and replace selection with it
    const text = range.toString();
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);

    // Select the text
    const newRange = document.createRange();
    newRange.selectNodeContents(textNode);
    sel.removeAllRanges();
    sel.addRange(newRange);
}

// Find ancestor element within editor
function findAncestorInEditor(node, tagName, editor) {
    let current = node;
    while (current && current !== editor && current !== document.body) {
        if (current.nodeType === 1 && current.tagName === tagName) {
            return current;
        }
        current = current.parentElement;
    }
    return null;
}

function applyNoteFontSize(sizePx) {
    const editor = document.getElementById('note-editor');
    if (!editor) return;
    editor.focus();

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);

    if (range.collapsed) {
        // No selection - create a span for new text
        const span = document.createElement('span');
        span.style.fontSize = `${sizePx}px`;
        span.appendChild(document.createTextNode('\u200B'));
        range.insertNode(span);

        const newRange = document.createRange();
        newRange.setStart(span.firstChild, 1);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
    } else {
        // Wrap selection in a span with font size
        const span = document.createElement('span');
        span.style.fontSize = `${sizePx}px`;
        try {
            span.appendChild(range.extractContents());
            range.insertNode(span);

            const newRange = document.createRange();
            newRange.selectNodeContents(span);
            sel.removeAllRanges();
            sel.addRange(newRange);
        } catch (e) {
            const text = range.toString();
            range.deleteContents();
            span.textContent = text;
            range.insertNode(span);
        }
    }
    setNoteDirty(true);
}

function toggleBlockquote() {
    const editor = document.getElementById('note-editor');
    if (!editor) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    const el = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const blockquote = findAncestorInEditor(el, 'BLOCKQUOTE', editor);

    if (blockquote) {
        // Remove blockquote - unwrap contents
        const frag = document.createDocumentFragment();
        while (blockquote.firstChild) {
            frag.appendChild(blockquote.firstChild);
        }

        const lastChild = frag.lastChild;
        blockquote.parentNode.insertBefore(frag, blockquote);
        blockquote.remove();

        // Position cursor at end
        if (lastChild) {
            const newRange = document.createRange();
            if (lastChild.nodeType === 3) {
                newRange.setStart(lastChild, lastChild.length);
            } else {
                newRange.setStartAfter(lastChild);
            }
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
        }
    } else {
        // Create new blockquote
        const bq = document.createElement('blockquote');

        if (range.collapsed) {
            // No selection - create empty blockquote
            bq.appendChild(document.createTextNode('\u200B'));
            range.insertNode(bq);

            const newRange = document.createRange();
            newRange.setStart(bq.firstChild, 0);
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
        } else {
            // Wrap selection in blockquote
            try {
                bq.appendChild(range.extractContents());
                range.insertNode(bq);

                const newRange = document.createRange();
                newRange.selectNodeContents(bq);
                sel.removeAllRanges();
                sel.addRange(newRange);
            } catch (e) {
                const text = range.toString();
                range.deleteContents();
                bq.textContent = text;
                range.insertNode(bq);
            }
        }
    }
    setNoteDirty(true);
}

function toggleInlineCode() {
    const editor = document.getElementById('note-editor');
    if (!editor) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    const el = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const codeEl = findAncestorInEditor(el, 'CODE', editor);

    if (codeEl) {
        // Remove code - unwrap contents
        const textNode = document.createTextNode(codeEl.textContent || '');
        codeEl.replaceWith(textNode);

        const newRange = document.createRange();
        newRange.setStart(textNode, textNode.length);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
    } else {
        // Create new code element
        const code = document.createElement('code');
        const selectedText = range.toString();

        if (range.collapsed) {
            // No selection - create empty code element
            code.appendChild(document.createTextNode('\u200B'));
            range.insertNode(code);

            const newRange = document.createRange();
            newRange.setStart(code.firstChild, 1);
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
        } else {
            // Wrap selection in code
            range.deleteContents();
            code.textContent = selectedText;
            range.insertNode(code);

            const newRange = document.createRange();
            newRange.selectNodeContents(code);
            sel.removeAllRanges();
            sel.addRange(newRange);
        }
    }
    setNoteDirty(true);
}

function insertCheckbox() {
    const editor = document.getElementById('note-editor');
    if (!editor) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);

    // Create the checkbox container (using span so text clicks don't toggle)
    const container = document.createElement('span');
    container.className = 'note-inline-checkbox';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    container.appendChild(checkbox);
    container.appendChild(document.createTextNode(' '));

    // Insert at cursor position
    range.deleteContents();
    range.insertNode(container);

    // Position cursor after the checkbox (inside the container, after the space)
    const newRange = document.createRange();
    newRange.setStartAfter(container.lastChild);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);

    // Bind the newly inserted checkbox
    setTimeout(() => bindNoteCheckboxes(), 0);
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
    const editor = document.getElementById('note-editor');
    if (!toolbar || !editor) return;

    // Update checkbox button state
    const checkboxBtn = toolbar.querySelector('[data-command="checkbox"]');
    if (checkboxBtn) {
        if (notesState.checkboxMode) {
            checkboxBtn.classList.add('active');
        } else {
            checkboxBtn.classList.remove('active');
        }
    }

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const node = sel.focusNode;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);

    // Map commands to tag names for detection
    const formatMap = {
        'bold': ['STRONG', 'B'],
        'italic': ['EM', 'I'],
        'underline': ['U'],
        'strikeThrough': ['S', 'STRIKE', 'DEL'],
        'insertUnorderedList': ['UL'],
        'insertOrderedList': ['OL'],
        'code': ['CODE'],
        'quote': ['BLOCKQUOTE']
    };

    // Check each formatting command
    Object.keys(formatMap).forEach(cmd => {
        const btn = toolbar.querySelector(`[data-command="${cmd}"]`);
        if (!btn) return;

        const tags = formatMap[cmd];
        let isActive = false;

        // Check if current selection is inside any of the tags
        for (const tag of tags) {
            if (el && findAncestorInEditor(el, tag, editor)) {
                isActive = true;
                break;
            }
        }

        if (isActive) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function handleNoteEditorKeydown(e) {
    const editor = document.getElementById('note-editor');
    if (!editor) return;

    // Handle keyboard shortcuts for formatting (Ctrl/Cmd + B/I/U)
    const isMeta = e.metaKey || e.ctrlKey;
    if (isMeta && !e.shiftKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'b') {
            e.preventDefault();
            applyNoteCommand('bold');
            return;
        }
        if (key === 'i') {
            e.preventDefault();
            applyNoteCommand('italic');
            return;
        }
        if (key === 'u') {
            e.preventDefault();
            applyNoteCommand('underline');
            return;
        }
    }

    if (e.key !== 'Enter') return;

    // Handle checkbox mode
    if (notesState.checkboxMode) {
        const sel = window.getSelection();
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
                const br = document.createElement('br');
                label.parentNode.insertBefore(br, label);
                label.remove();

                // Position cursor after the br
                const newRange = document.createRange();
                newRange.setStartAfter(br);
                newRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(newRange);
                return;
            }
        }

        // Not an empty line, insert new checkbox on next line
        e.preventDefault();

        // Insert a line break and then the checkbox
        const br = document.createElement('br');
        range.insertNode(br);

        const newRange = document.createRange();
        newRange.setStartAfter(br);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);

        insertCheckbox();
        setNoteDirty(true);
    }
}

function setNoteDirty(dirty) {
    notesState.dirty = dirty;
    const saveBtn = document.getElementById('note-save-btn');
    if (saveBtn) {
        if (isStandaloneNoteEditor()) {
            saveBtn.disabled = false;
        } else {
            saveBtn.disabled = !dirty;
        }
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
    const { keepSelection = false, targetNoteId = null, folderId = undefined } = options;
    const listEl = document.getElementById('notes-list');
    if (!listEl) return;
    try {
        const effectiveFolderId = folderId !== undefined ? folderId : noteFolderState.currentFolderId;
        const query = effectiveFolderId ? `?folder_id=${effectiveFolderId}` : '';
        const res = await fetch(`/api/notes${query}`);
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

function getNoteDisplayTitle(note) {
    const isList = note.note_type === 'list';
    let displayTitle = note.title;
    if (!displayTitle || displayTitle === 'Untitled Note' || displayTitle === 'Untitled note' || displayTitle === 'Untitled List') {
        if (isList) {
            return 'Untitled List';
        }
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = note.content || '';
        const plainText = tempDiv.textContent || tempDiv.innerText || '';
        if (plainText.trim()) {
            const lines = plainText.split('\n').map(l => l.trim()).filter(Boolean);
            const firstLine = lines[0] || '';
            displayTitle = firstLine.substring(0, 35).trim();
            if (firstLine.length > 35 || lines.length > 1) {
                displayTitle += '...';
            }
        } else {
            displayTitle = 'Untitled';
        }
    }
    return displayTitle;
}

function getNotePreviewLines(note) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = note.content || '';
    const plainText = tempDiv.textContent || tempDiv.innerText || '';
    const lines = plainText.split('\n').map(l => l.trim()).filter(Boolean);
    return lines.slice(0, 2);
}

function renderNotePreview(note) {
    if (note.note_type === 'list') {
        const items = (note.list_preview || []).slice(0, 3);
        if (!items.length) return '';
        return `
            <ul class="note-preview list-preview">
                ${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
        `;
    }
    const lines = getNotePreviewLines(note);
    if (!lines.length) return '';
    return `
        <div class="note-preview text-preview">
            ${lines.map(line => `<div>${escapeHtml(line)}</div>`).join('')}
        </div>
    `;
}

function renderNoteIcon(note) {
    if (note.note_type === 'list') {
        return '<i class="fa-regular fa-square-check"></i>';
    }
    return '<i class="fa-solid fa-note-sticky"></i>';
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
                const displayTitle = getNoteDisplayTitle(note);
                const previewHtml = renderNotePreview(note);

                btn.innerHTML = `
                    <div class="note-select-indicator"><i class="fa-solid fa-check"></i></div>
                    <div class="note-title-row">
                        <div class="note-title">
                            <span class="note-kind-icon ${note.note_type === 'list' ? 'list' : 'note'}">${renderNoteIcon(note)}</span>
                            <span class="note-title-text">${escapeHtml(displayTitle)}</span>
                        </div>
                        <div class="note-actions">
                            <button class="btn-icon move-btn" title="Move note">
                                <i class="fa-solid fa-folder-open"></i>
                            </button>
                            <button class="btn-icon pin-btn active" title="Unpin">
                                <i class="fa-solid fa-thumbtack"></i>
                            </button>
                        </div>
                    </div>
                    ${previewHtml}
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
                        if (document.getElementById('note-editor')) {
                            await setActiveNote(note.id);
                            scrollNotesEditorIntoView();
                        } else {
                            openNoteInEditor(note.id);
                        }
                    }
                });
                const pinBtn = btn.querySelector('.pin-btn');
                if (pinBtn) {
                    pinBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await toggleNotePin(note.id, false);
                    });
                }
                const moveBtn = btn.querySelector('.move-btn');
                if (moveBtn) {
                    moveBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openNoteMoveModal(note.id);
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
            <p style="color: var(--text-muted); margin: 0;">No notes or lists yet. Create one to get started.</p>
        </div>`;
    } else {
        regularNotes.forEach(note => {
        const btn = document.createElement('button');
        const isSelected = selectedNotes.has(note.id);
        btn.className = `notes-list-item ${note.id === notesState.activeNoteId ? 'active' : ''} ${isSelected ? 'selected' : ''}`;
        btn.dataset.noteId = note.id;

        const displayTitle = getNoteDisplayTitle(note);
        const previewHtml = renderNotePreview(note);

        btn.innerHTML = `
            <div class="note-select-indicator"><i class="fa-solid fa-check"></i></div>
            <div class="note-title-row">
                <div class="note-title">
                    <span class="note-kind-icon ${note.note_type === 'list' ? 'list' : 'note'}">${renderNoteIcon(note)}</span>
                    <span class="note-title-text">${escapeHtml(displayTitle)}</span>
                </div>
                <div class="note-actions">
                    <button class="btn-icon move-btn" title="Move note">
                        <i class="fa-solid fa-folder-open"></i>
                    </button>
                    <button class="btn-icon pin-btn ${note.pinned ? 'active' : ''}" title="${note.pinned ? 'Unpin' : 'Pin'}">
                        <i class="fa-solid fa-thumbtack"></i>
                    </button>
                </div>
            </div>
            ${previewHtml}
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
                if (document.getElementById('note-editor')) {
                    await setActiveNote(note.id);
                    scrollNotesEditorIntoView();
                } else {
                    openNoteInEditor(note.id);
                }
            }
        });

        const pinBtn = btn.querySelector('.pin-btn');
        if (pinBtn) {
            pinBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await toggleNotePin(note.id, !note.pinned);
            });
        }
        const moveBtn = btn.querySelector('.move-btn');
        if (moveBtn) {
            moveBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openNoteMoveModal(note.id);
            });
        }

        listAll.appendChild(btn);
        });
    }
}

function formatNoteDate(dateStr) {
    if (!dateStr) return 'New note';
    const hasTz = /[zZ]|[+-]\d{2}:\d{2}$/.test(dateStr);
    const normalized = hasTz ? dateStr : `${dateStr}Z`;
    const date = new Date(normalized);
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
    notesState.activeFolderId = note.folder_id || null;
    notesState.checkboxMode = false; // Reset checkbox mode when switching notes
    setNoteDirty(false);
    renderNotesList();
    updateNoteToolbarStates(); // Update toolbar button states
    bindNoteCheckboxes(); // Bind checkbox event handlers
    updateProtectButton(note.is_pin_protected); // Update protect button state
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
    const { silent = false, keepOpen = false, closeAfter = false, keepalive = false } = options;
    const editor = document.getElementById('note-editor');
    const titleInput = document.getElementById('note-title');
    const updatedLabel = document.getElementById('note-updated-label');
    if (!editor || !titleInput) return;
    const noteId = notesState.activeNoteId;
    if (!notesState.dirty && noteId) {
        // No changes: still clear and reset without touching the timestamp
        if (closeAfter) {
            window.location.href = getNoteReturnUrl();
            return;
        }
        if (!keepOpen) {
            clearNoteEditor();
            renderNotesList();
        }
        return;
    }
    if (!notesState.dirty && !noteId) {
        if (closeAfter) {
            window.location.href = getNoteReturnUrl();
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
        content: editor.innerHTML.trim(),
        folder_id: notesState.activeFolderId
    };

    try {
        let res;
        let savedNote;
        if (!noteId) {
            res = await fetch('/api/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: keepalive
            });
            if (!res.ok) throw new Error('Create failed');
            savedNote = await res.json();
            notesState.notes = [savedNote, ...notesState.notes];
            notesState.activeNoteId = savedNote.id;
        } else {
            res = await fetch(`/api/notes/${noteId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: keepalive
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

        if (closeAfter || isStandaloneNoteEditor()) {
            window.location.href = getNoteReturnUrl();
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
            if (isStandaloneNoteEditor()) {
                window.location.href = getNoteReturnUrl();
            }
        } catch (err) {
            console.error('Error deleting note:', err);
        }
    });
}

async function convertCurrentNoteToList() {
    if (!noteHasContent()) {
        showToast('Add at least two short lines before converting.', 'warning');
        return;
    }

    if (notesState.dirty) {
        await saveCurrentNote({ silent: true, keepOpen: true });
    }

    const noteId = notesState.activeNoteId;
    if (!noteId) {
        showToast('Save the note before converting.', 'warning');
        return;
    }

    openConfirmModal('Convert this note to a list? This replaces the note content with list items.', async () => {
        try {
            const res = await fetch(`/api/notes/${noteId}/convert-to-list`, { method: 'POST' });
            if (!res.ok) {
                let errorMessage = 'Note does not qualify for list conversion.';
                try {
                    const data = await res.json();
                    if (data?.details) {
                        errorMessage = `${data.error}: ${data.details}`;
                    } else if (data?.error) {
                        errorMessage = data.error;
                    }
                } catch (e) {
                    // Keep fallback message
                }
                showToast(errorMessage, 'warning');
                return;
            }
            showToast('Converted to list.', 'success');
            const returnTo = getNoteReturnUrl();
            window.location.href = `/notes/${noteId}?return=${encodeURIComponent(returnTo)}`;
        } catch (err) {
            console.error('Error converting note:', err);
            showToast('Could not convert note to list.', 'error');
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
    notesState.activeFolderId = null;
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

    // Convert HTML content to plain text for sharing
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = note.content || '';
    const plainText = tempDiv.textContent || tempDiv.innerText || '';
    const title = note.title || 'Untitled Note';

    // Use universal share function if available
    if (typeof window.universalShare === 'function') {
        const result = await window.universalShare({ title, text: plainText });
        if (result.cancelled) return;
        if (result.success) {
            if (result.method === 'clipboard') {
                showToast('Note copied to clipboard', 'success', 2000);
            }
            return;
        }
    }

    // Fallback: Show modal with share options (for desktop or if native share fails)
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
        message: 'Enter 30m, 2h, or 1d before start (leave blank to remove)',
        type: 'text',
        defaultValue: formatReminderMinutes(ev.reminder_minutes_before),
        onSubmit: async (val) => {
            if (val === '' || val === null || val === undefined) {
                await updateCalendarEvent(ev.id, { reminder_minutes_before: null });
                return;
            }
            const minutes = parseReminderMinutesInput(val);
            if (minutes === null || minutes < 0) {
                showToast('Use 30m, 2h, or 1d for reminders.', 'error');
                return;
            }
            await updateCalendarEvent(ev.id, { reminder_minutes_before: minutes });
        }
    });
}

function parseReminderMinutesInput(value) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return null;
    const match = raw.match(/^(\d+)\s*([mhd])?$/);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    const unit = match[2] || 'm';
    const multipliers = { m: 1, h: 60, d: 1440 };
    return amount * multipliers[unit];
}

function formatReminderMinutes(minutes) {
    if (minutes === null || minutes === undefined) return '';
    const total = Number(minutes);
    if (!Number.isFinite(total)) return '';
    if (total % 1440 === 0) return `${total / 1440}d`;
    if (total % 60 === 0) return `${total / 60}h`;
    return `${total}m`;
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
            row.className = `calendar-month-event ${ev.is_phase ? 'phase' : ''} ${ev.status === 'done' ? 'done' : ''}`;
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
    const reminderInput = document.getElementById('calendar-time-reminder');
    if (!modal || !startInput || !endInput || !reminderInput) return;
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
    reminderInput.value = formatReminderMinutes(ev.reminder_minutes_before);
    modal.classList.add('active');
}

function closeCalendarTimeModal() {
    const modal = document.getElementById('calendar-time-modal');
    if (modal) modal.classList.remove('active');
    timeModalState.eventId = null;
    const reminderInput = document.getElementById('calendar-time-reminder');
    if (reminderInput) reminderInput.value = '';
}

async function saveCalendarTimeModal() {
    if (!timeModalState.eventId) return;
    const startInput = document.getElementById('calendar-time-start');
    const endInput = document.getElementById('calendar-time-end');
    const reminderInput = document.getElementById('calendar-time-reminder');
    const startVal = startInput ? startInput.value.trim() : '';
    const endVal = endInput ? endInput.value.trim() : '';
    const reminderRaw = reminderInput ? reminderInput.value.trim() : '';
    const reminderMinutes = reminderRaw ? parseReminderMinutesInput(reminderRaw) : null;
    if (reminderRaw && reminderMinutes === null) {
        showToast('Use 30m, 2h, or 1d for reminders.', 'error');
        return;
    }
    await updateCalendarEvent(timeModalState.eventId, {
        start_time: startVal || null,
        end_time: endVal || null,
        reminder_minutes_before: reminderMinutes
    });
    closeCalendarTimeModal();
}

function updateRecurringFieldVisibility() {
    const freqEl = document.getElementById('calendar-recurring-frequency');
    const unitEl = document.getElementById('calendar-recurring-interval-unit');
    const daysRow = document.getElementById('calendar-recurring-days-row');
    const monthRow = document.getElementById('calendar-recurring-month-row');
    const yearRow = document.getElementById('calendar-recurring-year-row');
    const customRow = document.getElementById('calendar-recurring-custom-row');
    if (!freqEl) return;
    const freq = freqEl.value;
    const unit = unitEl ? unitEl.value : 'days';
    const showCustom = freq === 'custom';
    const showDays = freq === 'weekly' || freq === 'biweekly' || (showCustom && unit === 'weeks');
    const showMonth = freq === 'monthly' || freq === 'yearly' || (showCustom && (unit === 'months' || unit === 'years'));
    const showYear = freq === 'yearly' || (showCustom && unit === 'years');
    if (customRow) customRow.classList.toggle('is-hidden', !showCustom);
    if (daysRow) daysRow.classList.toggle('is-hidden', !showDays);
    if (monthRow) monthRow.classList.toggle('is-hidden', !showMonth);
    if (yearRow) yearRow.classList.toggle('is-hidden', !showYear);
}

function openRecurringModal() {
    const modal = document.getElementById('calendar-recurring-modal');
    if (!modal) return;
    // Show list view by default
    showRecurringListView();
    loadRecurringList();
    modal.classList.add('active');
    recurringModalState.open = true;
}

function closeRecurringModal() {
    const modal = document.getElementById('calendar-recurring-modal');
    if (modal) modal.classList.remove('active');
    recurringModalState.open = false;
}

function showRecurringListView() {
    const listView = document.getElementById('recurring-list-view');
    const formView = document.getElementById('recurring-form-view');
    if (listView) listView.classList.remove('is-hidden');
    if (formView) formView.classList.add('is-hidden');
}

function showRecurringFormView(editItem = null) {
    const listView = document.getElementById('recurring-list-view');
    const formView = document.getElementById('recurring-form-view');
    const formTitle = document.getElementById('recurring-form-title');
    const editIdInput = document.getElementById('calendar-recurring-edit-id');
    const modal = document.getElementById('calendar-recurring-modal');

    if (listView) listView.classList.add('is-hidden');
    if (formView) formView.classList.remove('is-hidden');

    // Reset form
    const titleInput = document.getElementById('calendar-recurring-title');
    const startDayInput = document.getElementById('calendar-recurring-start-day');
    const startTimeInput = document.getElementById('calendar-recurring-start-time');
    const endTimeInput = document.getElementById('calendar-recurring-end-time');
    const reminderInput = document.getElementById('calendar-recurring-reminder');
    const rolloverInput = document.getElementById('calendar-recurring-rollover');
    const typeInput = document.getElementById('calendar-recurring-type');
    const priorityInput = document.getElementById('calendar-recurring-priority');
    const freqEl = document.getElementById('calendar-recurring-frequency');
    const intervalEl = document.getElementById('calendar-recurring-interval');
    const unitEl = document.getElementById('calendar-recurring-interval-unit');
    const dayOfMonthEl = document.getElementById('calendar-recurring-day-of-month');
    const monthEl = document.getElementById('calendar-recurring-month');

    if (editItem) {
        // Edit mode
        if (formTitle) formTitle.textContent = 'Edit Recurring Item';
        if (editIdInput) editIdInput.value = editItem.id;
        if (titleInput) titleInput.value = editItem.title || '';
        if (typeInput) typeInput.value = editItem.is_event ? 'event' : 'task';
        if (startDayInput) startDayInput.value = editItem.start_day || '';
        if (startTimeInput) startTimeInput.value = editItem.start_time || '';
        if (endTimeInput) endTimeInput.value = editItem.end_time || '';
        if (priorityInput) priorityInput.value = editItem.priority || 'medium';
        if (rolloverInput) rolloverInput.checked = editItem.rollover_enabled;
        if (freqEl) freqEl.value = editItem.frequency || 'daily';
        if (intervalEl) intervalEl.value = editItem.interval || 1;
        if (unitEl) unitEl.value = editItem.interval_unit || 'days';
        if (dayOfMonthEl) dayOfMonthEl.value = editItem.day_of_month || '';
        if (monthEl) monthEl.value = editItem.month_of_year || '';
        // Reminder
        if (reminderInput) {
            if (editItem.reminder_minutes_before) {
                const mins = editItem.reminder_minutes_before;
                if (mins >= 1440 && mins % 1440 === 0) {
                    reminderInput.value = `${mins / 1440}d`;
                } else if (mins >= 60 && mins % 60 === 0) {
                    reminderInput.value = `${mins / 60}h`;
                } else {
                    reminderInput.value = `${mins}m`;
                }
            } else {
                reminderInput.value = '';
            }
        }
        // Days of week
        if (modal) {
            modal.querySelectorAll('#calendar-recurring-days-row input[type="checkbox"]').forEach(cb => {
                cb.checked = editItem.days_of_week && editItem.days_of_week.includes(Number(cb.value));
            });
        }
    } else {
        // Add mode
        if (formTitle) formTitle.textContent = 'Add Recurring Item';
        if (editIdInput) editIdInput.value = '';
        if (titleInput) titleInput.value = '';
        if (typeInput) typeInput.value = 'task';
        if (startTimeInput) startTimeInput.value = '';
        if (endTimeInput) endTimeInput.value = '';
        if (reminderInput) reminderInput.value = '';
        if (rolloverInput) rolloverInput.checked = true;
        if (priorityInput) priorityInput.value = 'medium';
        if (freqEl) freqEl.value = 'daily';
        if (intervalEl) intervalEl.value = '1';
        if (unitEl) unitEl.value = 'days';
        const todayStr = calendarState.selectedDay || new Date().toISOString().slice(0, 10);
        if (startDayInput) startDayInput.value = todayStr;
        const dateObj = new Date(`${todayStr}T00:00:00`);
        if (dayOfMonthEl) dayOfMonthEl.value = dateObj.getDate();
        if (monthEl) monthEl.value = String(dateObj.getMonth() + 1);
        const dow = (dateObj.getDay() + 6) % 7;
        if (modal) {
            modal.querySelectorAll('#calendar-recurring-days-row input[type="checkbox"]').forEach(cb => {
                cb.checked = Number(cb.value) === dow;
            });
        }
    }
    updateRecurringFieldVisibility();
}

async function loadRecurringList() {
    const listEl = document.getElementById('recurring-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="recurring-empty">Loading...</div>';

    try {
        const res = await fetch('/api/calendar/recurring');
        if (!res.ok) throw new Error('Failed to load');
        const items = await res.json();
        window.recurringItemsCache = items;
        renderRecurringList(items);
    } catch (e) {
        console.error('Error loading recurring items:', e);
        listEl.innerHTML = '<div class="recurring-empty">Failed to load recurring items.</div>';
    }
}

function renderRecurringList(items) {
    const listEl = document.getElementById('recurring-list');
    if (!listEl) return;

    if (!items || items.length === 0) {
        listEl.innerHTML = '<div class="recurring-empty">No recurring items yet.<br>Click "Add New" to create one.</div>';
        return;
    }

    const freqLabels = {
        daily: 'Daily',
        weekly: 'Weekly',
        biweekly: 'Bi-weekly',
        monthly: 'Monthly',
        yearly: 'Yearly',
        custom: 'Custom'
    };

    listEl.innerHTML = items.map(item => {
        const typeClass = item.is_event ? 'event' : '';
        const typeLabel = item.is_event ? 'Event' : 'Task';
        const freqLabel = freqLabels[item.frequency] || item.frequency;
        const timeStr = item.start_time ? ` @ ${item.start_time}` : '';
        return `
            <div class="recurring-item" data-id="${item.id}">
                <div class="recurring-item-info">
                    <div class="recurring-item-title">${escapeHtml(item.title)}</div>
                    <div class="recurring-item-meta">
                        <span class="recurring-item-type ${typeClass}">${typeLabel}</span>
                        ${freqLabel}${timeStr}
                    </div>
                </div>
                <div class="recurring-item-actions">
                    <button class="btn-icon" onclick="editRecurringItem(${item.id})" title="Edit">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn-icon btn-danger" onclick="deleteRecurringItem(${item.id})" title="Delete">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function editRecurringItem(id) {
    const items = window.recurringItemsCache || [];
    const item = items.find(i => i.id === id);
    if (item) {
        showRecurringFormView(item);
    } else {
        // Fetch fresh if not in cache
        try {
            const res = await fetch('/api/calendar/recurring');
            if (!res.ok) throw new Error('Failed to load');
            const freshItems = await res.json();
            window.recurringItemsCache = freshItems;
            const freshItem = freshItems.find(i => i.id === id);
            if (freshItem) {
                showRecurringFormView(freshItem);
            }
        } catch (e) {
            console.error('Error loading recurring item:', e);
            alert('Could not load item for editing.');
        }
    }
}

function deleteRecurringItem(id) {
    openConfirmModal('Delete this recurring item? This will also remove all generated instances.', async () => {
        try {
            const res = await fetch(`/api/calendar/recurring/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete');
            await loadRecurringList();
            await loadCalendarMonth();
            if (calendarState.selectedDay) {
                await loadCalendarDay(calendarState.selectedDay);
            }
        } catch (e) {
            console.error('Error deleting recurring item:', e);
            showToast('Could not delete recurring item.', 'error');
        }
    });
}

async function saveRecurringModal() {
    const editIdInput = document.getElementById('calendar-recurring-edit-id');
    const editId = editIdInput ? editIdInput.value : '';
    const isEdit = !!editId;

    const titleInput = document.getElementById('calendar-recurring-title');
    const typeInput = document.getElementById('calendar-recurring-type');
    const startDayInput = document.getElementById('calendar-recurring-start-day');
    const startTimeInput = document.getElementById('calendar-recurring-start-time');
    const endTimeInput = document.getElementById('calendar-recurring-end-time');
    const reminderInput = document.getElementById('calendar-recurring-reminder');
    const rolloverInput = document.getElementById('calendar-recurring-rollover');
    const priorityInput = document.getElementById('calendar-recurring-priority');
    const freqEl = document.getElementById('calendar-recurring-frequency');
    const intervalEl = document.getElementById('calendar-recurring-interval');
    const unitEl = document.getElementById('calendar-recurring-interval-unit');
    const dayOfMonthEl = document.getElementById('calendar-recurring-day-of-month');
    const monthEl = document.getElementById('calendar-recurring-month');

    const title = titleInput ? titleInput.value.trim() : '';
    if (!title) {
        alert('Title is required.');
        return;
    }
    const freq = freqEl ? freqEl.value : 'daily';
    const startDay = (startDayInput && startDayInput.value) ? startDayInput.value : calendarState.selectedDay;
    const reminderRaw = reminderInput ? reminderInput.value.trim() : '';
    const reminderMinutes = reminderRaw ? parseReminderMinutesInput(reminderRaw) : null;
    if (reminderRaw && reminderMinutes === null) {
        alert('Use 30m, 2h, or 1d for reminders.');
        return;
    }
    const payload = {
        title,
        day: startDay,
        start_time: startTimeInput ? startTimeInput.value.trim() || null : null,
        end_time: endTimeInput ? endTimeInput.value.trim() || null : null,
        reminder_minutes_before: reminderMinutes,
        rollover_enabled: rolloverInput ? rolloverInput.checked : false,
        priority: priorityInput ? priorityInput.value : 'medium',
        frequency: freq,
        is_event: typeInput ? typeInput.value === 'event' : false
    };

    if (freq === 'weekly' || freq === 'biweekly' || (freq === 'custom' && unitEl && unitEl.value === 'weeks')) {
        const days = [];
        document.querySelectorAll('#calendar-recurring-days-row input[type="checkbox"]:checked').forEach(cb => {
            days.push(Number(cb.value));
        });
        payload.days_of_week = days;
    }
    if (freq === 'monthly' || freq === 'yearly' || (freq === 'custom' && unitEl && (unitEl.value === 'months' || unitEl.value === 'years'))) {
        payload.day_of_month = (dayOfMonthEl && dayOfMonthEl.value) ? Number(dayOfMonthEl.value) : null;
    }
    if (freq === 'yearly' || (freq === 'custom' && unitEl && unitEl.value === 'years')) {
        payload.month_of_year = (monthEl && monthEl.value) ? Number(monthEl.value) : null;
    }
    if (freq === 'custom') {
        payload.interval = intervalEl ? Number(intervalEl.value || '1') : 1;
        payload.interval_unit = unitEl ? unitEl.value : 'days';
    }

    try {
        const url = isEdit ? `/api/calendar/recurring/${editId}` : '/api/calendar/recurring';
        const method = isEdit ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || `Could not ${isEdit ? 'update' : 'create'} recurring item.`);
            return;
        }
        // Go back to list view and refresh
        showRecurringListView();
        await loadRecurringList();
        if (calendarState.selectedDay) {
            await loadCalendarDay(calendarState.selectedDay);
        }
        await loadCalendarMonth();
    } catch (e) {
        console.error(`Error ${isEdit ? 'updating' : 'creating'} recurring item:`, e);
        alert(`Could not ${isEdit ? 'update' : 'create'} recurring item.`);
    }
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
          const noteChips = document.createElement('div');
          noteChips.className = 'calendar-note-chips';
          appendCalendarItemNoteChip(noteChips, ev);
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
        reminderMenuItem.innerHTML = `<i class="fa-solid fa-bell${reminderActive ? '' : '-slash'} ${reminderActive ? 'active-icon' : ''}"></i> ${reminderActive ? `Reminder (${formatReminderMinutes(ev.reminder_minutes_before)})` : 'Set Reminder'}`;
        reminderMenuItem.onclick = async (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            const linked = await ensureLinkedTaskEvent(ev);
            if (!linked || !linked.calendar_event_id) return;
            openReminderEditor({ ...linked, id: linked.calendar_event_id });
        };

        const rolloverMenuItem = document.createElement('button');
        rolloverMenuItem.className = 'calendar-item-menu-option';
        rolloverMenuItem.innerHTML = `<i class="fa-solid fa-rotate ${ev.rollover_enabled ? 'active-icon' : ''}"></i> ${ev.rollover_enabled ? 'Disable' : 'Enable'} Rollover`;
        rolloverMenuItem.onclick = async (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            const linked = await ensureLinkedTaskEvent(ev);
            if (!linked || !linked.calendar_event_id) return;
            const next = !linked.rollover_enabled;
            try {
                await updateCalendarEvent(linked.calendar_event_id, { rollover_enabled: next });
                linked.rollover_enabled = next;
            } catch (err) {
                console.error('Failed to toggle rollover', err);
            }
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

        overflowDropdown.append(reminderMenuItem, rolloverMenuItem, openBtn, unpinBtn);
        overflowMenuContainer.append(overflowBtn);
        document.body.appendChild(overflowDropdown);

        const positionDropdown = () => {
            const rect = overflowBtn.getBoundingClientRect();
            const dropdownWidth = overflowDropdown.offsetWidth || 200;
            const dropdownHeight = overflowDropdown.offsetHeight || 120;
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;
            const padding = 8;
            overflowDropdown.style.position = 'fixed';
            let topPos = rect.bottom + 8;
            if (screenHeight - rect.bottom < dropdownHeight + padding && rect.top > screenHeight - rect.bottom) {
                topPos = rect.top - dropdownHeight - 8;
            }
            const maxTop = screenHeight - dropdownHeight - padding;
            const minTop = padding;
            topPos = Math.max(minTop, Math.min(topPos, maxTop));
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

          if (noteChips.childNodes.length) actions.append(noteChips);
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

            const moveUpMenuItem = document.createElement('button');
            moveUpMenuItem.className = 'calendar-item-menu-option';
            moveUpMenuItem.innerHTML = '<i class="fa-solid fa-arrow-up"></i> Move up';
            moveUpMenuItem.onclick = (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                nudgeCalendarEvent(ev.id, -1);
            };

            const moveDownMenuItem = document.createElement('button');
            moveDownMenuItem.className = 'calendar-item-menu-option';
            moveDownMenuItem.innerHTML = '<i class="fa-solid fa-arrow-down"></i> Move down';
            moveDownMenuItem.onclick = (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                nudgeCalendarEvent(ev.id, 1);
            };

            const deleteMenuItem = document.createElement('button');
            deleteMenuItem.className = 'calendar-item-menu-option delete-option';
            deleteMenuItem.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
            deleteMenuItem.onclick = (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                deleteCalendarEvent(ev.id);
            };

            overflowDropdown.append(moveUpMenuItem, moveDownMenuItem, deleteMenuItem);
            overflowMenuContainer.append(overflowBtn);
            document.body.appendChild(overflowDropdown);

            const positionDropdown = () => {
                const rect = overflowBtn.getBoundingClientRect();
                const dropdownWidth = 180;
                const dropdownHeight = overflowDropdown.offsetHeight || 120;
                const screenWidth = window.innerWidth;
                const screenHeight = window.innerHeight;
                const padding = 8;

                overflowDropdown.style.position = 'fixed';
                let topPos = rect.bottom + 8;
                if (screenHeight - rect.bottom < dropdownHeight + padding && rect.top > screenHeight - rect.bottom) {
                    topPos = rect.top - dropdownHeight - 8;
                }
                const maxTop = screenHeight - dropdownHeight - padding;
                const minTop = padding;
                topPos = Math.max(minTop, Math.min(topPos, maxTop));

                let leftPos = rect.right - dropdownWidth;
                if (leftPos < padding) leftPos = padding;
                if (leftPos + dropdownWidth > screenWidth - padding) {
                    leftPos = screenWidth - dropdownWidth - padding;
                }

                overflowDropdown.style.top = `${topPos}px`;
                overflowDropdown.style.left = `${leftPos}px`;
            };

            overflowBtn.onclick = (e) => {
                e.stopPropagation();
                const isOpen = overflowDropdown.classList.contains('active');
                document.querySelectorAll('.calendar-item-dropdown.active').forEach(d => {
                    if (d !== overflowDropdown) d.classList.remove('active');
                });
                if (!isOpen) {
                    positionDropdown();
                    overflowDropdown.classList.add('active');
                } else {
                    overflowDropdown.classList.remove('active');
                }
            };

            overflowDropdown.updatePosition = positionDropdown;
            overflowDropdown.triggerButton = overflowBtn;

            actions.append(overflowMenuContainer);
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
            link.href = `/notes/${note.id}`;
            link.title = note.title || `Note #${note.id}`;
            link.setAttribute('aria-label', note.title || `Note #${note.id}`);
            link.innerHTML = '<i class="fa-solid fa-note-sticky"></i>';
            noteChips.appendChild(link);
        });
        appendCalendarItemNoteChip(noteChips, ev);
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
        reminderMenuItem.innerHTML = `<i class="fa-solid fa-bell${reminderActive ? '' : '-slash'} ${reminderActive ? 'active-icon' : ''}"></i> ${reminderActive ? `Reminder (${formatReminderMinutes(ev.reminder_minutes_before)})` : 'Set Reminder'}`;
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
        noteMenuItem.innerHTML = '<i class="fa-solid fa-note-sticky"></i> Add Note...';
        noteMenuItem.onclick = async (e) => {
            e.stopPropagation();
            const resolved = await resolveCalendarEventId(ev);
            if (!resolved) return;
            showCalendarNoteChoiceInDropdown(overflowDropdown, resolved);
        };

        const convertMenuItem = document.createElement('button');
        convertMenuItem.className = 'calendar-item-menu-option';
        convertMenuItem.innerHTML = '<i class="fa-solid fa-list-check"></i> Convert to task';
        convertMenuItem.onclick = async (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            try {
                await updateCalendarEvent(ev.id, { is_event: false });
                ev.is_event = false;
                renderCalendarEvents();
            } catch (err) {
                console.error('Failed to convert event to task', err);
            }
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
            restoreCalendarNoteChoiceDropdown(overflowDropdown);

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
            link.href = `/notes/${note.id}`;
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
        reminderMenuItem.innerHTML = `<i class="fa-solid fa-bell${reminderActive ? '' : '-slash'} ${reminderActive ? 'active-icon' : ''}"></i> ${reminderActive ? `Reminder (${formatReminderMinutes(ev.reminder_minutes_before)})` : 'Set Reminder'}`;
        reminderMenuItem.onclick = (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            openReminderEditor(ev);
        };

        const noteMenuItem = document.createElement('button');
        noteMenuItem.className = 'calendar-item-menu-option';
        noteMenuItem.innerHTML = '<i class="fa-solid fa-note-sticky"></i> Add Note...';
        noteMenuItem.onclick = async (e) => {
            e.stopPropagation();
            const resolved = await resolveCalendarEventId(ev);
            if (!resolved) return;
            showCalendarNoteChoiceInDropdown(overflowDropdown, resolved);
        };

        const convertMenuItem = document.createElement('button');
        convertMenuItem.className = 'calendar-item-menu-option';
        convertMenuItem.innerHTML = '<i class="fa-solid fa-list-check"></i> Convert to task';
        convertMenuItem.onclick = async (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            try {
                await updateCalendarEvent(ev.id, { is_event: false });
                ev.is_event = false;
                renderCalendarEvents();
            } catch (err) {
                console.error('Failed to convert event to task', err);
            }
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

        overflowDropdown.append(reminderMenuItem, rolloverMenuItem, convertMenuItem, noteMenuItem, moveMenuItem, deleteMenuItem);
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
            restoreCalendarNoteChoiceDropdown(overflowDropdown);
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
    calendarSelection.touchMoved = false;
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
    if (!e.touches || !e.touches.length || !calendarSelection.touchStart) return;
    const dx = Math.abs(e.touches[0].clientX - calendarSelection.touchStart.x);
    const dy = Math.abs(e.touches[0].clientY - calendarSelection.touchStart.y);
    // If moved more than threshold, mark as scrolling
    if (dx > 8 || dy > 8) {
        calendarSelection.touchMoved = true;
        if (calendarSelection.longPressTimer) {
            clearTimeout(calendarSelection.longPressTimer);
            calendarSelection.longPressTimer = null;
        }
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
    // Don't toggle selection if user was scrolling
    if (calendarSelection.touchMoved) {
        calendarSelection.touchMoved = false;
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

function startBulkCalendarNoteLink(anchor = null) {
    const targets = getSelectedCalendarEvents(true).filter(ev => !ev.is_phase && !ev.is_group && !ev.is_task_link);
    if (!targets.length) return;
    if (targets.length > 1) {
        alert('Link note works one item at a time because notes attach to a single calendar entry. Select one item to continue.');
        return;
    }
    const ev = targets[0];
    const menu = document.getElementById('calendar-bulk-more-dropdown');
    if (!menu) return;
    showCalendarNoteChoiceInDropdown(menu, ev);
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
    let rollover = true;
    let isEvent = false;
    let groupName = null;

    // SYMBOL-BASED SYNTAX

    // Event marker: $
    if (working.includes('$')) {
        isEvent = true;
        working = working.replace(/\$/g, '').trim();
        rollover = false;
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

    // Reminder: *30, *2h, *1d
    const reminderMatch = working.match(/\*(\d+)\s*([mhd])?/i);
    if (reminderMatch) {
        reminder = parseReminderMinutesInput(`${reminderMatch[1]}${reminderMatch[2] || ''}`);
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

    // Disable rollover: -
    if (working.includes('-')) {
        rollover = false;
        working = working.replace(/-/g, '').trim();
    }
    // Enable rollover: +
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
        syntax: '*[minutes|h|d]',
        description: 'Reminder before start',
        example: '*30m or *2h'
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
            if (err && err.error) {
                showToast(err.error, 'warning');
            } else {
                showToast('Could not save calendar item.', 'error');
            }
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
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            if (err && err.error) {
                showToast(err.error, 'warning');
            } else {
                showToast('Could not update calendar item.', 'error');
            }
            console.error(err);
            return;
        }

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
        // Only cancel reminders for items we are about to reschedule (avoid wiping background-synced reminders)
        const cancelIds = new Set();
        calendarState.events.forEach((ev) => {
            if (ev.status === 'done') return;
            if (!ev.start_time || ev.reminder_minutes_before === null || ev.reminder_minutes_before === undefined) return;
            const reminderId = (ev.is_task_link && ev.calendar_event_id) ? ev.calendar_event_id : ev.id;
            cancelIds.add(reminderId);
        });
        for (const id of cancelIds) {
            await window.NotificationService?.cancel(id);
        }

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
    const bulkMoreBtn = document.getElementById('calendar-bulk-more-btn');
    const selectAllCheckbox = document.getElementById('calendar-select-all');
    const dayQuickAdd = document.getElementById('calendar-day-quick-add');
    const quickToggleBtn = document.getElementById('calendar-quick-toggle');
    const recurringBtn = document.getElementById('calendar-recurring-btn');
    const recurringModal = document.getElementById('calendar-recurring-modal');
    const recurringSaveBtn = document.getElementById('calendar-recurring-save');
    const recurringCancelBtn = document.getElementById('calendar-recurring-cancel');
    const recurringFreq = document.getElementById('calendar-recurring-frequency');
    const recurringUnit = document.getElementById('calendar-recurring-interval-unit');
    const recurringType = document.getElementById('calendar-recurring-type');
    const itemNoteModal = document.getElementById('calendar-item-note-modal');
    const itemNoteInput = document.getElementById('calendar-item-note-input');
    const itemNoteCloseBtn = document.getElementById('calendar-item-note-close');
    const itemNoteEditBtn = document.getElementById('calendar-item-note-edit');
    const itemNoteDeleteBtn = document.getElementById('calendar-item-note-delete');
    const itemNoteConvertBtn = document.getElementById('calendar-item-note-convert');
    const itemNoteSaveBtn = document.getElementById('calendar-item-note-save');
    const itemNoteCancelBtn = document.getElementById('calendar-item-note-cancel');

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
                      restoreCalendarNoteChoiceDropdown(d);
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


    if (itemNoteCloseBtn) itemNoteCloseBtn.onclick = closeCalendarItemNoteModal;
    if (itemNoteEditBtn) itemNoteEditBtn.onclick = () => {
        if (itemNoteInput && calendarItemNoteState.event) {
            itemNoteInput.value = calendarItemNoteState.event.item_note || '';
            updateCalendarItemNoteCounter();
        }
        setCalendarItemNoteMode('edit');
    };
    if (itemNoteDeleteBtn) itemNoteDeleteBtn.onclick = deleteCalendarItemNote;
    if (itemNoteConvertBtn) itemNoteConvertBtn.onclick = convertCalendarItemNote;
    if (itemNoteSaveBtn) itemNoteSaveBtn.onclick = saveCalendarItemNote;
    if (itemNoteCancelBtn) itemNoteCancelBtn.onclick = () => {
        if (calendarItemNoteState.isNew) {
            closeCalendarItemNoteModal();
        } else {
            setCalendarItemNoteMode('view');
        }
    };
    if (itemNoteInput) {
        itemNoteInput.addEventListener('input', updateCalendarItemNoteCounter);
    }

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
    const goToBtn = document.getElementById('calendar-go-to-btn');
    if (goToBtn) {
        goToBtn.onclick = () => {
            // Close dropdown menu if open
            const menu = document.querySelector('.calendar-month-menu');
            if (menu) menu.classList.remove('open');
            openCalendarPrompt({
                title: 'Go to date',
                message: 'Pick any date to jump to.',
                type: 'date',
                defaultValue: calendarState.selectedDay || todayStr,
                onSubmit: (val) => {
                    if (!val) return;
                    // Jump to the month containing the selected date
                    const targetDate = new Date(val + 'T00:00:00');
                    setCalendarMonth(targetDate);
                }
            });
        };
    }
    // Today button in month view - jumps to current month
    const todayMonthBtn = document.getElementById('calendar-today-month-btn');
    if (todayMonthBtn) {
        todayMonthBtn.onclick = () => {
            setCalendarMonth(new Date());
            closeCalendarMonthMenu();
        };
    }

    // Calendar month menu dropdown toggle
    const monthMenuBtn = document.getElementById('calendar-month-menu-btn');
    const monthMenu = document.querySelector('.calendar-month-menu');
    if (monthMenuBtn && monthMenu) {
        monthMenuBtn.onclick = (e) => {
            e.stopPropagation();
            monthMenu.classList.toggle('open');
        };
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!monthMenu.contains(e.target)) {
                monthMenu.classList.remove('open');
            }
        });
        // Close dropdown when clicking menu items
        monthMenu.querySelectorAll('.calendar-month-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                monthMenu.classList.remove('open');
            });
        });
    }
    function closeCalendarMonthMenu() {
        const menu = document.querySelector('.calendar-month-menu');
        if (menu) menu.classList.remove('open');
    }

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
    if (recurringBtn) recurringBtn.onclick = () => {
        // Close dropdown menu if open
        const menu = document.querySelector('.calendar-month-menu');
        if (menu) menu.classList.remove('open');
        openRecurringModal();
    };
    if (recurringSaveBtn) recurringSaveBtn.onclick = saveRecurringModal;
    if (recurringCancelBtn) recurringCancelBtn.onclick = showRecurringListView;
    if (recurringFreq) recurringFreq.onchange = updateRecurringFieldVisibility;
    if (recurringUnit) recurringUnit.onchange = updateRecurringFieldVisibility;
    if (recurringType) recurringType.onchange = () => {
        const rolloverInput = document.getElementById('calendar-recurring-rollover');
        if (rolloverInput) rolloverInput.checked = recurringType.value !== 'event';
    };
    // New recurring modal buttons
    const recurringAddNewBtn = document.getElementById('recurring-add-new-btn');
    const recurringBackBtn = document.getElementById('recurring-back-btn');
    const recurringCloseBtn = document.getElementById('calendar-recurring-close');
    if (recurringAddNewBtn) recurringAddNewBtn.onclick = () => showRecurringFormView(null);
    if (recurringBackBtn) recurringBackBtn.onclick = showRecurringListView;
    if (recurringCloseBtn) recurringCloseBtn.onclick = closeRecurringModal;
    if (recurringModal) {
        recurringModal.addEventListener('click', (e) => {
            if (e.target === recurringModal) closeRecurringModal();
        });
    }
    if (bulkClearBtn) bulkClearBtn.onclick = resetCalendarSelection;
    if (bulkDoneBtn) bulkDoneBtn.onclick = () => {
        bulkCalendarUpdateStatus('done');
        toggleCalendarBulkMenu(null, true);
    };
    if (bulkUndoneBtn) bulkUndoneBtn.onclick = () => {
        bulkCalendarUpdateStatus('not_started');
        toggleCalendarBulkMenu(null, true);
    };
    if (bulkRolloverBtn) bulkRolloverBtn.onclick = bulkCalendarToggleRollover;
    if (bulkPriorityBtn) bulkPriorityBtn.onclick = (e) => {
        toggleCalendarBulkMenu(null, true);
        startBulkCalendarPriorityPicker(e.currentTarget);
    };
    if (bulkMoveBtn) bulkMoveBtn.onclick = () => {
        toggleCalendarBulkMenu(null, true);
        startBulkCalendarMovePrompt();
    };
    if (bulkNoteBtn) bulkNoteBtn.onclick = () => {
        toggleCalendarBulkMenu(null, true);
        startBulkCalendarNoteLink(bulkNoteBtn);
    };
    if (bulkDeleteBtn) bulkDeleteBtn.onclick = bulkCalendarDelete;
    if (bulkMoreBtn) bulkMoreBtn.onclick = toggleCalendarBulkMenu;
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

// --- Homepage Reordering ---

let homepageEditMode = {
    active: false,
    longPressTimer: null,
    longPressTriggered: false,
    touchStart: { x: 0, y: 0 },
    currentDragCard: null
};

let homepageTouchDragState = {
    active: false,
    card: null,
    clone: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0
};

function initHomepageReorder() {
    const grid = document.getElementById('homepage-grid');
    if (!grid) return; // Not on homepage

    const cards = grid.querySelectorAll('.module-card');
    cards.forEach(card => {
        // Desktop: Long press detection
        let mouseDownTimer = null;

        card.addEventListener('mousedown', (e) => {
            if (homepageEditMode.active) return; // Already in edit mode
            mouseDownTimer = setTimeout(() => {
                enterHomepageEditMode();
            }, 1000); // 1 second for desktop
        });

        card.addEventListener('mouseup', () => {
            clearTimeout(mouseDownTimer);
        });

        card.addEventListener('mouseleave', () => {
            clearTimeout(mouseDownTimer);
        });

        // Mobile: Touch long press
        card.addEventListener('touchstart', handleHomepageTouchStart, { passive: true });
        card.addEventListener('touchmove', handleHomepageTouchMove, { passive: true });
        card.addEventListener('touchend', handleHomepageTouchEnd);
    });

    // Done button
    const doneBtn = document.getElementById('homepage-done-btn');
    if (doneBtn) {
        doneBtn.addEventListener('click', exitHomepageEditMode);
    }

    // Click outside to exit
    document.addEventListener('click', (e) => {
        if (!homepageEditMode.active) return;
        if (!e.target.closest('#homepage-grid') && !e.target.closest('#homepage-done-btn')) {
            exitHomepageEditMode();
        }
    });
}

function handleHomepageTouchStart(e) {
    if (homepageEditMode.active) return; // Already in edit mode, drag will handle

    homepageEditMode.longPressTriggered = false;
    if (e.touches && e.touches.length) {
        homepageEditMode.touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }

    homepageEditMode.longPressTimer = setTimeout(() => {
        homepageEditMode.longPressTimer = null;
        homepageEditMode.longPressTriggered = true;
        enterHomepageEditMode();
    }, 1000); // 1 second for mobile
}

function handleHomepageTouchMove(e) {
    if (!homepageEditMode.longPressTimer || !e.touches || !e.touches.length) return;

    const dx = Math.abs(e.touches[0].clientX - homepageEditMode.touchStart.x);
    const dy = Math.abs(e.touches[0].clientY - homepageEditMode.touchStart.y);

    if (dx > 10 || dy > 10) { // User is scrolling
        clearTimeout(homepageEditMode.longPressTimer);
        homepageEditMode.longPressTimer = null;
    }
}

function handleHomepageTouchEnd(e) {
    if (homepageEditMode.longPressTimer) {
        clearTimeout(homepageEditMode.longPressTimer);
        homepageEditMode.longPressTimer = null;
    }

    if (homepageEditMode.longPressTriggered) {
        e.preventDefault(); // Prevent click navigation
        homepageEditMode.longPressTriggered = false;
    }
}

function enterHomepageEditMode() {
    homepageEditMode.active = true;
    const grid = document.getElementById('homepage-grid');
    const doneBtn = document.getElementById('homepage-done-btn');

    if (grid) {
        grid.classList.add('edit-mode');
        const cards = grid.querySelectorAll('.module-card');
        cards.forEach(card => {
            card.classList.add('wiggle');
            // Prevent navigation while in edit mode
            card.addEventListener('click', preventNavigation);
        });
    }

    if (doneBtn) {
        doneBtn.style.display = 'block';
    }

    // Initialize drag after entering edit mode
    initHomepageDrag();
}

function exitHomepageEditMode() {
    homepageEditMode.active = false;
    const grid = document.getElementById('homepage-grid');
    const doneBtn = document.getElementById('homepage-done-btn');

    if (grid) {
        grid.classList.remove('edit-mode');
        const cards = grid.querySelectorAll('.module-card');
        cards.forEach(card => {
            card.classList.remove('wiggle');
            card.removeEventListener('click', preventNavigation);
            // Clean up drag listeners
            card.removeAttribute('draggable');
        });
    }

    if (doneBtn) {
        doneBtn.style.display = 'none';
    }

    // Save order
    saveHomepageOrder();
}

function preventNavigation(e) {
    if (homepageEditMode.active) {
        e.preventDefault();
        e.stopPropagation();
    }
}

function initHomepageDrag() {
    const grid = document.getElementById('homepage-grid');
    if (!grid) return;

    const cards = grid.querySelectorAll('.module-card');
    cards.forEach(card => {
        card.setAttribute('draggable', 'true');

        // Desktop drag events
        card.addEventListener('dragstart', handleHomepageDragStart);
        card.addEventListener('dragend', handleHomepageDragEnd);
        card.addEventListener('dragover', handleHomepageDragOver);
        card.addEventListener('drop', handleHomepageDrop);

        // Mobile touch drag events
        card.addEventListener('touchstart', handleHomepageTouchDragStart, { passive: false });
        card.addEventListener('touchmove', handleHomepageTouchDragMove, { passive: false });
        card.addEventListener('touchend', handleHomepageTouchDragEnd);
    });
}

function handleHomepageDragStart(e) {
    if (!homepageEditMode.active) return;

    homepageEditMode.currentDragCard = e.currentTarget;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget.innerHTML);
}

function handleHomepageDragEnd(e) {
    if (homepageEditMode.currentDragCard) {
        homepageEditMode.currentDragCard.classList.remove('dragging');
        homepageEditMode.currentDragCard = null;
    }
}

function handleHomepageDragOver(e) {
    if (!homepageEditMode.active || !homepageEditMode.currentDragCard) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const grid = document.getElementById('homepage-grid');
    const afterElement = getHomepageDragAfterElement(grid, e.clientX, e.clientY);
    const draggingCard = homepageEditMode.currentDragCard;

    if (afterElement == null) {
        grid.appendChild(draggingCard);
    } else if (afterElement !== draggingCard) {
        grid.insertBefore(draggingCard, afterElement);
    }
}

function handleHomepageDrop(e) {
    e.preventDefault();
}

function getHomepageDragAfterElement(container, x, y) {
    const draggableElements = [...container.querySelectorAll('.module-card:not(.dragging)')];

    if (draggableElements.length === 0) {
        return null;
    }

    // Grid flows top-to-bottom, left-to-right
    // Find the first element that the cursor is "before" in reading order
    for (const element of draggableElements) {
        const box = element.getBoundingClientRect();
        const centerX = box.left + box.width / 2;
        const centerY = box.top + box.height / 2;

        // If cursor is above this element (in a previous row), insert before it
        if (y < box.top) {
            return element;
        }

        // If cursor is roughly in this element's row
        if (y >= box.top && y <= box.bottom) {
            // Check if cursor is to the left of this element's center
            if (x < centerX) {
                return element;
            }
        }
    }

    // Cursor is after all elements - insert at end
    return null;
}

function handleHomepageTouchDragStart(e) {
    if (!homepageEditMode.active) return;

    const card = e.currentTarget;
    const touch = e.touches[0];

    homepageTouchDragState = {
        active: true,
        card: card,
        clone: null,
        startX: touch.clientX,
        startY: touch.clientY,
        currentX: touch.clientX,
        currentY: touch.clientY
    };

    // Create visual clone
    const clone = card.cloneNode(true);
    clone.style.position = 'fixed';
    clone.style.top = card.getBoundingClientRect().top + 'px';
    clone.style.left = card.getBoundingClientRect().left + 'px';
    clone.style.width = card.offsetWidth + 'px';
    clone.style.height = card.offsetHeight + 'px';
    clone.style.pointerEvents = 'none';
    clone.style.zIndex = '1000';
    clone.style.opacity = '0.9';
    clone.style.transition = 'none';
    clone.classList.add('dragging');
    clone.classList.remove('wiggle'); // Stop wiggle on the clone
    document.body.appendChild(clone);

    homepageTouchDragState.clone = clone;
    card.style.opacity = '0.3';
}

function handleHomepageTouchDragMove(e) {
    if (!homepageTouchDragState.active || !homepageTouchDragState.clone) return;

    e.preventDefault(); // Prevent scrolling while dragging

    const touch = e.touches[0];
    const deltaX = touch.clientX - homepageTouchDragState.startX;
    const deltaY = touch.clientY - homepageTouchDragState.startY;

    homepageTouchDragState.currentX = touch.clientX;
    homepageTouchDragState.currentY = touch.clientY;

    // Move clone
    homepageTouchDragState.clone.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

    // Determine where to insert
    const grid = document.getElementById('homepage-grid');
    const afterElement = getHomepageDragAfterElement(grid, touch.clientX, touch.clientY);
    const draggingCard = homepageTouchDragState.card;

    if (afterElement == null) {
        grid.appendChild(draggingCard);
    } else if (afterElement !== draggingCard) {
        grid.insertBefore(draggingCard, afterElement);
    }
}

function handleHomepageTouchDragEnd(e) {
    if (!homepageTouchDragState.active) return;

    // Clean up
    if (homepageTouchDragState.clone) {
        homepageTouchDragState.clone.remove();
    }

    if (homepageTouchDragState.card) {
        homepageTouchDragState.card.style.opacity = '';
    }

    homepageTouchDragState = {
        active: false,
        card: null,
        clone: null,
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0
    };
}

async function saveHomepageOrder() {
    const grid = document.getElementById('homepage-grid');
    if (!grid) return;

    const cards = grid.querySelectorAll('.module-card');
    const order = Array.from(cards).map(card => card.dataset.moduleId);

    try {
        const res = await fetch('/api/homepage-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(order)
        });

        if (!res.ok) {
            console.error('Failed to save homepage order');
            showToast('Failed to save order', 'error');
        } else {
            showToast('Homepage layout saved', 'success', 2000);
        }
    } catch (e) {
        console.error('Error saving homepage order:', e);
        showToast('Error saving order', 'error');
    }
}

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
    ensureServiceWorkerRegistered();
    const modal = document.getElementById('calendar-prompt-modal');
    if (modal) modal.classList.add('is-hidden');

    // ===== ANDROID KEYBOARD HANDLING =====
    // Directly manipulate modal heights based on visual viewport (more reliable than CSS dvh/svh)
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        let initialHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        let keyboardOpen = false;
        let rafId = null;

        // Force WebView to repaint an element (fixes Android WebView rendering bugs)
        const forceRepaint = (element) => {
            if (!element) return;
            // Trigger reflow by reading offsetHeight
            void element.offsetHeight;
            // Toggle opacity to force repaint
            element.style.opacity = '0.999';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    element.style.opacity = '1';
                });
            });
        };

        const adjustModalsForKeyboard = (viewportHeight) => {
            const addModal = document.getElementById('add-item-modal');
            const aiPanel = document.getElementById('ai-panel');

            // Adjust add-item-modal
            if (addModal && addModal.classList.contains('active')) {
                const modalContent = addModal.querySelector('.modal-content');
                if (modalContent) {
                    // Set explicit height based on viewport
                    addModal.style.height = viewportHeight + 'px';
                    modalContent.style.maxHeight = (viewportHeight - 20) + 'px';

                    // Force repaint to fix WebView rendering bug
                    forceRepaint(modalContent);

                    // Scroll focused input into view within modal
                    const focused = modalContent.querySelector(':focus');
                    if (focused) {
                        setTimeout(() => {
                            focused.scrollIntoView({ behavior: 'instant', block: 'nearest' });
                            // Force another repaint after scroll
                            forceRepaint(modalContent);
                        }, 50);
                    }
                }
            }

            // Adjust AI panel
            if (aiPanel && aiPanel.classList.contains('open')) {
                const maxH = Math.min(viewportHeight * 0.7, viewportHeight - 20);
                aiPanel.style.maxHeight = maxH + 'px';

                // Shrink messages when keyboard is open
                const messages = aiPanel.querySelector('.ai-messages');
                if (messages && keyboardOpen) {
                    messages.style.maxHeight = '80px';
                    messages.style.minHeight = '50px';
                }

                // Force repaint
                forceRepaint(aiPanel);
            }
        };

        const resetModalStyles = () => {
            const addModal = document.getElementById('add-item-modal');
            const aiPanel = document.getElementById('ai-panel');

            if (addModal) {
                addModal.style.height = '';
                const modalContent = addModal.querySelector('.modal-content');
                if (modalContent) modalContent.style.maxHeight = '';
            }

            if (aiPanel) {
                aiPanel.style.maxHeight = '';
                const messages = aiPanel.querySelector('.ai-messages');
                if (messages) {
                    messages.style.maxHeight = '';
                    messages.style.minHeight = '';
                }
            }
        };

        const handleViewportChange = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                const currentHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
                const heightDiff = initialHeight - currentHeight;
                const isKeyboardNowOpen = heightDiff > 150;

                if (isKeyboardNowOpen !== keyboardOpen) {
                    keyboardOpen = isKeyboardNowOpen;
                    document.body.classList.toggle('keyboard-open', keyboardOpen);
                }

                if (keyboardOpen) {
                    adjustModalsForKeyboard(currentHeight);
                } else {
                    resetModalStyles();
                }
            });
        };

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', handleViewportChange);
            window.visualViewport.addEventListener('scroll', handleViewportChange);
        }

        // Also listen to window resize as fallback
        window.addEventListener('resize', handleViewportChange);

        // Update initial height on orientation change
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                initialHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
                keyboardOpen = false;
                resetModalStyles();
            }, 500);
        });

        // Re-adjust when modals open
        const originalOpenAddItemModal = window.openAddItemModal;
        if (typeof originalOpenAddItemModal === 'function') {
            window.openAddItemModal = function(...args) {
                originalOpenAddItemModal.apply(this, args);
                if (keyboardOpen) {
                    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
                    adjustModalsForKeyboard(vh);
                }
            };
        }

        // Force repaint while typing in modals (fixes WebView not painting text)
        let repaintDebounce = null;
        document.addEventListener('input', (e) => {
            if (!keyboardOpen) return;
            const target = e.target;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
                const modal = target.closest('.modal-content') || target.closest('.ai-panel');
                if (modal) {
                    // Debounce repaint calls
                    if (repaintDebounce) clearTimeout(repaintDebounce);
                    repaintDebounce = setTimeout(() => {
                        forceRepaint(modal);
                    }, 100);
                }
            }
        }, true);

        // Also force repaint on focus changes within modals
        document.addEventListener('focusin', (e) => {
            if (!keyboardOpen) return;
            const target = e.target;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
                const modal = target.closest('.modal-content') || target.closest('.ai-panel');
                if (modal) {
                    setTimeout(() => forceRepaint(modal), 100);
                }
            }
        }, true);
    }

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
    organizePhaseDoneTasks();
    restorePhaseVisibility();
    initStickyListHeader();
    initTaskFilters();
    initTagFilters();
    repositionLinkedNoteChips();
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
    initHomepageReorder();
    let noteResizeTimer = null;
    window.addEventListener('resize', () => {
        if (noteResizeTimer) clearTimeout(noteResizeTimer);
        noteResizeTimer = setTimeout(repositionLinkedNoteChips, 120);
    });
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

    let draggingEl = null;
    let touchDragItem = null;
    let touchDragActive = false;
    let touchDragMoved = false;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchHoldTimer = null;
    let ignoreNextNavClick = false;

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

    navList.addEventListener('click', (e) => {
        if (!ignoreNextNavClick) return;
        e.preventDefault();
        e.stopPropagation();
        ignoreNextNavClick = false;
    }, true);

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

        item.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            touchDragMoved = false;
            touchDragActive = false;
            touchDragItem = item;
            touchHoldTimer = setTimeout(() => {
                touchDragActive = true;
                item.classList.add('dragging');
            }, 200);
        }, { passive: true });

        item.addEventListener('touchmove', (e) => {
            if (!touchDragItem) return;
            const touch = e.touches[0];
            const dx = Math.abs(touch.clientX - touchStartX);
            const dy = Math.abs(touch.clientY - touchStartY);
            if (!touchDragActive && (dx > 6 || dy > 6)) {
                clearTimeout(touchHoldTimer);
            }
            if (!touchDragActive) return;
            e.preventDefault();
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            const targetItem = target ? target.closest('li[data-nav-id]') : null;
            if (!targetItem || targetItem === touchDragItem) return;
            const rect = targetItem.getBoundingClientRect();
            const shouldInsertAfter = touch.clientY > rect.top + rect.height / 2;
            navList.insertBefore(touchDragItem, shouldInsertAfter ? targetItem.nextSibling : targetItem);
            touchDragMoved = true;
        }, { passive: false });

        item.addEventListener('touchend', () => {
            clearTimeout(touchHoldTimer);
            if (touchDragItem) touchDragItem.classList.remove('dragging');
            if (touchDragActive && touchDragMoved) {
                ignoreNextNavClick = true;
                persistOrder();
            }
            touchDragItem = null;
            touchDragActive = false;
            touchDragMoved = false;
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
const recallWhenDefaults = ['bored', 'free', 'work', 'travel'];

function initRecallsPage() {
    const cardsEl = document.getElementById('recall-cards');
    const addInput = document.getElementById('recall-add-input');
    const addBtn = document.getElementById('recall-add-btn');
    const addForm = document.getElementById('recall-add-form');
    if (!cardsEl) return;

    // Toggle add form visibility
    if (addBtn && addForm) {
        addBtn.addEventListener('click', () => {
            const isOpen = addForm.classList.contains('open');
            if (isOpen) {
                addForm.classList.remove('open');
                addBtn.classList.remove('active');
                addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add';
            } else {
                addForm.classList.add('open');
                addBtn.classList.add('active');
                addBtn.innerHTML = '<i class="fa-solid fa-times"></i> Cancel';
                if (addInput) addInput.focus();
            }
        });
    }

    // Setup add input - Enter key submits with last used when
    if (addInput) {
        addInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = addInput.value.trim();
                if (val && recallState.lastUsedWhen) {
                    handleAddRecall(val, recallState.lastUsedWhen);
                } else if (val) {
                    showToast('Select a context first', 'info');
                }
            }
        });
    }

    // Setup modal overlay click to close
    const overlay = document.getElementById('recall-modal-overlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeRecallModal();
        });
    }

    // Setup filter dropdown
    const filterBtn = document.getElementById('recall-filter-btn');
    if (filterBtn) {
        filterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFilterDropdown();
        });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('recall-filter-dropdown');
        if (dropdown && !dropdown.contains(e.target)) {
            closeFilterDropdown();
        }
    });

    loadAllRecalls();
}

async function loadAllRecalls() {
    const cardsEl = document.getElementById('recall-cards');
    if (cardsEl) cardsEl.innerHTML = '<div class="recall-empty">Loading...</div>';
    try {
        const res = await fetch('/api/recalls');
        if (!res.ok) throw new Error('Failed to load recalls');
        recallState.items = await res.json();
        renderWhenTabs();
        renderWhenChipsForAdd();
        renderRecallCards();
        startPollingPendingAI();
    } catch (err) {
        console.error(err);
        if (cardsEl) cardsEl.innerHTML = '<div class="recall-empty">Could not load recalls.</div>';
    }
}

function getWhenOptions() {
    const values = new Set(recallWhenDefaults);
    recallState.items.forEach(item => {
        if (item.when_context) values.add(item.when_context);
    });
    return Array.from(values);
}

function renderFilterDropdown() {
    const menu = document.getElementById('recall-filter-menu');
    const label = document.getElementById('recall-filter-label');
    if (!menu) return;

    const options = getWhenOptions();
    menu.innerHTML = '';

    // "All" option
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = `recall-filter-option ${recallState.selectedWhen === null ? 'active' : ''}`;
    allBtn.textContent = 'All';
    allBtn.addEventListener('click', () => {
        filterByWhen(null);
        closeFilterDropdown();
    });
    menu.appendChild(allBtn);

    // Context options
    options.forEach(when => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `recall-filter-option ${recallState.selectedWhen === when ? 'active' : ''}`;
        btn.textContent = when;
        btn.addEventListener('click', () => {
            filterByWhen(when);
            closeFilterDropdown();
        });
        menu.appendChild(btn);
    });

    // Update label
    if (label) {
        label.textContent = recallState.selectedWhen || 'All';
    }
}

function toggleFilterDropdown() {
    const btn = document.getElementById('recall-filter-btn');
    const menu = document.getElementById('recall-filter-menu');
    if (!btn || !menu) return;

    const isOpen = menu.classList.contains('open');
    if (isOpen) {
        closeFilterDropdown();
    } else {
        btn.classList.add('open');
        menu.classList.add('open');
    }
}

function closeFilterDropdown() {
    const btn = document.getElementById('recall-filter-btn');
    const menu = document.getElementById('recall-filter-menu');
    if (btn) btn.classList.remove('open');
    if (menu) menu.classList.remove('open');
}

// Keep old name as alias for compatibility
function renderWhenTabs() {
    renderFilterDropdown();
}

function renderWhenChipsForAdd() {
    const container = document.getElementById('recall-when-chips');
    if (!container) return;

    const options = getWhenOptions();
    container.innerHTML = '';

    options.forEach(when => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `recall-when-chip ${recallState.lastUsedWhen === when ? 'active' : ''}`;
        chip.textContent = when;
        chip.addEventListener('click', () => {
            const input = document.getElementById('recall-add-input');
            const val = input ? input.value.trim() : '';
            if (val) {
                handleAddRecall(val, when);
            } else {
                // Just select this as the default
                recallState.lastUsedWhen = when;
                renderWhenChipsForAdd();
            }
        });
        container.appendChild(chip);
    });

    // Add "+" button for custom context
    const addChip = document.createElement('button');
    addChip.type = 'button';
    addChip.className = 'recall-when-chip recall-when-chip-add';
    addChip.innerHTML = '<i class="fa-solid fa-plus"></i>';
    addChip.title = 'Add custom context';
    addChip.addEventListener('click', () => {
        showAddWhenInput(container);
    });
    container.appendChild(addChip);
}

function showAddWhenInput(container) {
    // Check if input already exists
    if (container.querySelector('.recall-when-add-input')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'recall-when-add-wrapper';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'recall-when-add-input';
    input.placeholder = 'New context...';
    input.maxLength = 20;

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'recall-when-add-confirm';
    confirmBtn.innerHTML = '<i class="fa-solid fa-check"></i>';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'recall-when-add-cancel';
    cancelBtn.innerHTML = '<i class="fa-solid fa-times"></i>';

    const addCustomWhen = () => {
        const val = input.value.trim().toLowerCase();
        if (val && val.length <= 20) {
            // Add to defaults so it persists in this session
            if (!recallWhenDefaults.includes(val)) {
                recallWhenDefaults.push(val);
            }
            recallState.lastUsedWhen = val;
            renderWhenChipsForAdd();
            renderFilterDropdown();
        }
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCustomWhen();
        } else if (e.key === 'Escape') {
            renderWhenChipsForAdd();
        }
    });

    confirmBtn.addEventListener('click', addCustomWhen);
    cancelBtn.addEventListener('click', () => renderWhenChipsForAdd());

    wrapper.appendChild(input);
    wrapper.appendChild(confirmBtn);
    wrapper.appendChild(cancelBtn);
    container.appendChild(wrapper);

    input.focus();
}

function filterByWhen(when) {
    recallState.selectedWhen = when;
    renderWhenTabs();
    renderRecallCards();
}

function renderRecallCards() {
    const container = document.getElementById('recall-cards');
    if (!container) return;

    const items = recallState.selectedWhen
        ? recallState.items.filter(item => item.when_context === recallState.selectedWhen)
        : recallState.items;

    if (!items.length) {
        container.innerHTML = '<div class="recall-empty">No recalls yet. Click Add to create one.</div>';
        return;
    }

    container.innerHTML = '';
    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'recall-card';
        card.dataset.id = item.id;

        // Meta badges (URL + when context)
        let metaHtml = '';
        if (item.payload_type === 'url') {
            metaHtml += `<a href="${recallEscape(item.payload)}" target="_blank" rel="noopener" class="recall-card-url" onclick="event.stopPropagation()"><i class="fa-solid fa-link"></i> URL</a>`;
        }
        metaHtml += `<span class="recall-card-when" data-when="${recallEscape(item.when_context)}">${recallEscape(item.when_context)}</span>`;

        // Why display
        let whyHtml = '';
        if (item.ai_status === 'pending' || item.ai_status === 'processing') {
            whyHtml = `<div class="recall-card-why pending">Generating...</div>`;
        } else if (item.why) {
            whyHtml = `<div class="recall-card-why">${recallEscape(item.why)}</div>`;
        }

        card.innerHTML = `
            <div class="recall-card-header">
                <div class="recall-card-title">${recallEscape(item.title)}</div>
                <div class="recall-card-meta">${metaHtml}</div>
            </div>
            ${whyHtml}
        `;

        card.addEventListener('click', () => openRecallModal(item.id));
        container.appendChild(card);
    });
}

function openRecallModal(id) {
    const recall = recallState.items.find(item => item.id === id);
    if (!recall) return;

    recallState.modalRecallId = id;
    recallState.modalEditMode = false;
    const overlay = document.getElementById('recall-modal-overlay');
    const body = document.getElementById('recall-modal-body');
    const titleText = document.getElementById('recall-modal-title-text');
    if (!overlay || !body) return;

    if (titleText) titleText.textContent = 'Recall';
    renderModalViewMode(recall);
    overlay.classList.add('open');
}

function renderModalViewMode(recall) {
    const body = document.getElementById('recall-modal-body');
    const titleText = document.getElementById('recall-modal-title-text');
    if (!body) return;

    if (titleText) titleText.textContent = 'Recall';

    // URL badge
    let urlHtml = '';
    if (recall.payload_type === 'url') {
        urlHtml = `<a href="${recallEscape(recall.payload)}" target="_blank" rel="noopener" class="recall-view-url"><i class="fa-solid fa-external-link"></i> URL</a>`;
    }

    // Why display
    let whyHtml = '';
    if (recall.ai_status === 'pending' || recall.ai_status === 'processing') {
        whyHtml = `
            <div class="recall-view-block">
                <div class="recall-view-label">Why</div>
                <div class="recall-view-box recall-view-why pending">Generating...</div>
            </div>
        `;
    } else if (recall.why) {
        whyHtml = `
            <div class="recall-view-block">
                <div class="recall-view-label">Why</div>
                <div class="recall-view-box recall-view-why">${recallEscape(recall.why)}</div>
            </div>
        `;
    }

    // Summary display
    let summaryHtml = '';
    if (recall.ai_status === 'pending' || recall.ai_status === 'processing') {
        summaryHtml = `
            <div class="recall-view-block">
                <div class="recall-view-label">Summary</div>
                <div class="recall-view-box recall-view-summary pending">Generating summary...</div>
            </div>
        `;
    } else if (recall.summary) {
        summaryHtml = `
            <div class="recall-view-block">
                <div class="recall-view-label">Summary</div>
                <div class="recall-view-box recall-view-summary">${recallEscape(recall.summary)}</div>
            </div>
        `;
    }

    // Content display for text payloads
    let contentHtml = '';
    if (recall.payload_type === 'text') {
        contentHtml = `
            <div class="recall-view-block">
                <div class="recall-view-label">Content</div>
                <div class="recall-view-box recall-view-content">${recallEscape(recall.payload)}</div>
            </div>
        `;
    }

    body.innerHTML = `
        <div class="recall-view-section">
            <div class="recall-view-title">${recallEscape(recall.title)}</div>
            <div class="recall-view-meta">
                <span class="recall-view-when" data-when="${recallEscape(recall.when_context)}">${recallEscape(recall.when_context)}</span>
                ${urlHtml}
            </div>
        </div>
        ${whyHtml ? `<div class="recall-view-section">${whyHtml}</div>` : ''}
        ${summaryHtml ? `<div class="recall-view-section">${summaryHtml}</div>` : ''}
        ${contentHtml ? `<div class="recall-view-section">${contentHtml}</div>` : ''}
        <div class="recall-modal-actions">
            <div class="recall-modal-actions-left">
                <button type="button" class="recall-modal-delete" id="recall-modal-delete">Delete</button>
                <button type="button" class="recall-modal-edit" id="recall-modal-edit">Edit</button>
            </div>
        </div>
    `;

    // Setup edit button
    const editBtn = document.getElementById('recall-modal-edit');
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            recallState.modalEditMode = true;
            renderModalEditMode(recall);
        });
    }

    // Setup delete button
    const deleteBtn = document.getElementById('recall-modal-delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            closeRecallModal();
            deleteRecall(recall.id);
        });
    }
}

function renderModalEditMode(recall) {
    const body = document.getElementById('recall-modal-body');
    const titleText = document.getElementById('recall-modal-title-text');
    if (!body) return;

    if (titleText) titleText.textContent = 'Edit Recall';

    // Payload field - editable for text and url types
    let payloadHtml = '';
    if (recall.payload_type === 'text') {
        payloadHtml = `
            <div class="recall-modal-field">
                <label>Content</label>
                <textarea class="recall-modal-payload" id="recall-modal-payload">${recallEscape(recall.payload)}</textarea>
            </div>
        `;
    } else if (recall.payload_type === 'url') {
        payloadHtml = `
            <div class="recall-modal-field">
                <label>URL</label>
                <input type="text" class="recall-modal-input" id="recall-modal-payload" value="${recallEscape(recall.payload)}" placeholder="https://...">
            </div>
        `;
    }

    // Summary field
    let summaryHtml = '';
    if (recall.ai_status === 'pending' || recall.ai_status === 'processing') {
        summaryHtml = `
            <div class="recall-modal-field">
                <label>Summary</label>
                <div class="recall-view-summary pending">Generating summary...</div>
            </div>
        `;
    } else {
        summaryHtml = `
            <div class="recall-modal-field">
                <label>Summary</label>
                <textarea class="recall-modal-summary-input" id="recall-modal-summary">${recallEscape(recall.summary || '')}</textarea>
            </div>
        `;
    }

    body.innerHTML = `
        <div class="recall-modal-field">
            <label>Title</label>
            <input type="text" class="recall-modal-input" id="recall-modal-title" value="${recallEscape(recall.title)}">
        </div>
        ${payloadHtml}
        <div class="recall-modal-field">
            <label>Context</label>
            <div class="recall-when-chips" id="recall-modal-when-chips"></div>
        </div>
        <div class="recall-modal-field">
            <label>Why</label>
            <input type="text" class="recall-modal-input" id="recall-modal-why" value="${recallEscape(recall.why || '')}" placeholder="${recall.ai_status === 'pending' || recall.ai_status === 'processing' ? 'Generating...' : ''}">
        </div>
        ${summaryHtml}
        <div class="recall-modal-actions">
            <button type="button" class="recall-modal-cancel" id="recall-modal-cancel">Cancel</button>
            <button type="button" class="recall-modal-save" id="recall-modal-save">Save</button>
        </div>
    `;

    // Setup when chips
    const chipsContainer = document.getElementById('recall-modal-when-chips');
    if (chipsContainer) {
        const options = getWhenOptions();
        options.forEach(when => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `recall-when-chip ${recall.when_context === when ? 'active' : ''}`;
            chip.textContent = when;
            chip.addEventListener('click', () => {
                chipsContainer.querySelectorAll('.recall-when-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
            });
            chipsContainer.appendChild(chip);
        });
    }

    // Setup cancel button
    const cancelBtn = document.getElementById('recall-modal-cancel');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            recallState.modalEditMode = false;
            renderModalViewMode(recall);
        });
    }

    // Setup save button
    const saveBtn = document.getElementById('recall-modal-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => saveRecallFromModal(recall.id));
    }
}

// Keep for backward compatibility with polling updates
function renderModalContent(recall) {
    if (recallState.modalEditMode) {
        renderModalEditMode(recall);
    } else {
        renderModalViewMode(recall);
    }
}

function closeRecallModal() {
    const overlay = document.getElementById('recall-modal-overlay');
    if (overlay) overlay.classList.remove('open');
    recallState.modalRecallId = null;
    recallState.modalEditMode = false;
}

async function saveRecallFromModal(id) {
    const titleInput = document.getElementById('recall-modal-title');
    const whyInput = document.getElementById('recall-modal-why');
    const payloadInput = document.getElementById('recall-modal-payload');
    const summaryInput = document.getElementById('recall-modal-summary');
    const activeChip = document.querySelector('#recall-modal-when-chips .recall-when-chip.active');

    const fields = {};
    if (titleInput) fields.title = titleInput.value.trim();
    if (whyInput) fields.why = whyInput.value.trim();
    if (payloadInput) fields.payload = payloadInput.value.trim();
    if (summaryInput) fields.summary = summaryInput.value.trim();
    if (activeChip) fields.when_context = activeChip.textContent;

    try {
        const res = await fetch(`/api/recalls/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields)
        });
        if (!res.ok) throw new Error('Update failed');
        const updated = await res.json();
        const idx = recallState.items.findIndex(item => item.id === id);
        if (idx !== -1) recallState.items[idx] = updated;
        renderWhenTabs();
        renderRecallCards();
        closeRecallModal();
        showToast('Recall updated', 'success');
    } catch (err) {
        console.error(err);
        showToast('Could not update recall.', 'error');
    }
}

function detectPayloadType(input) {
    const trimmed = (input || '').trim();
    return /^https?:\/\/\S+$/i.test(trimmed) ? 'url' : 'text';
}

function parseRecallInput(input) {
    // Use ";" (semicolon) as delimiter for easier mobile typing
    const idx = input.indexOf(';');
    if (idx === -1) return null;
    const title = input.substring(0, idx).trim();
    const content = input.substring(idx + 1).trim();
    if (!title || !content) return null;
    return { title, content };
}

async function handleAddRecall(input, whenContext) {
    const parsed = parseRecallInput(input);
    if (!parsed) {
        showToast('Use format: Title; Content or URL', 'error');
        return;
    }

    const payload_type = detectPayloadType(parsed.content);

    try {
        const res = await fetch('/api/recalls', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: parsed.title,
                payload: parsed.content,
                payload_type,
                when_context: whenContext
            })
        });
        if (!res.ok) throw new Error('Save failed');
        const saved = await res.json();

        recallState.lastUsedWhen = whenContext;
        recallState.items.unshift(saved);

        // Start polling for this item if AI is pending
        if (saved.ai_status === 'pending') {
            startPollingForRecall(saved.id);
        }

        const addInput = document.getElementById('recall-add-input');
        if (addInput) addInput.value = '';

        // Close the add form
        const addForm = document.getElementById('recall-add-form');
        const addBtn = document.getElementById('recall-add-btn');
        if (addForm) addForm.classList.remove('open');
        if (addBtn) {
            addBtn.classList.remove('active');
            addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add';
        }

        renderWhenTabs();
        renderWhenChipsForAdd();
        renderRecallCards();
        showToast('Recall saved', 'success');
    } catch (err) {
        console.error(err);
        showToast('Could not save recall.', 'error');
    }
}

function startPollingForRecall(id) {
    if (!recallState.pollingIds.includes(id)) {
        recallState.pollingIds.push(id);
    }

    if (!recallState.pollingInterval) {
        recallState.pollingInterval = setInterval(pollPendingAI, 3000);
    }
}

function startPollingPendingAI() {
    // Find any items that are still pending
    const pendingIds = recallState.items
        .filter(item => item.ai_status === 'pending' || item.ai_status === 'processing')
        .map(item => item.id);

    if (pendingIds.length > 0) {
        recallState.pollingIds = pendingIds;
        recallState.pollingInterval = setInterval(pollPendingAI, 3000);
    }
}

async function pollPendingAI() {
    if (recallState.pollingIds.length === 0) {
        if (recallState.pollingInterval) {
            clearInterval(recallState.pollingInterval);
            recallState.pollingInterval = null;
        }
        return;
    }

    const idsToCheck = [...recallState.pollingIds];

    for (const id of idsToCheck) {
        try {
            const res = await fetch(`/api/recalls/${id}`);
            if (!res.ok) continue;
            const recall = await res.json();

            if (recall.ai_status === 'done' || recall.ai_status === 'failed') {
                // Update local state
                const idx = recallState.items.findIndex(r => r.id === id);
                if (idx !== -1) {
                    recallState.items[idx] = recall;
                }

                // Remove from polling
                recallState.pollingIds = recallState.pollingIds.filter(i => i !== id);

                // Re-render
                renderRecallCards();

                // Update modal if it's open for this item
                if (recallState.modalRecallId === id) {
                    renderModalContent(recall);
                }
            }
        } catch (err) {
            console.error('Poll error for recall', id, err);
        }
    }
}

function deleteRecall(id) {
    openConfirmModal('Delete this recall?', async () => {
        try {
            const res = await fetch(`/api/recalls/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            recallState.items = recallState.items.filter(item => item.id !== id);
            recallState.pollingIds = recallState.pollingIds.filter(i => i !== id);
            renderWhenTabs();
            renderRecallCards();
            closeConfirmModal();
            showToast('Recall deleted', 'success');
        } catch (err) {
            console.error(err);
            showToast('Could not delete recall.', 'error');
            closeConfirmModal();
        }
    });
}

function recallEscape(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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

    // Calendar: Convert **📅 Day, Month Date, Year** to styled calendar day header
    formatted = formatted.replace(/\*\*📅 (.+?)\*\*/g, '<span class="ai-calendar-day">📅 $1</span>');

    // Calendar: Convert **📁 Group** to styled group header
    formatted = formatted.replace(/\*\*📁 (.+?)\*\*/g, '<span class="ai-calendar-group">📁 $1</span>');

    // Convert remaining **text** to <strong>text</strong>
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Calendar: Convert timed events (⏰ HH:MM-HH:MM | status **title** priority)
    formatted = formatted.replace(/⏰\s*(\d{2}:\d{2})-(\d{2}:\d{2})\s*\|\s*(○|◐|✓)\s*<strong>(.+?)<\/strong>(\s*🔴|\s*🟡)?/g,
        (match, start, end, status, title, priority) => {
            const statusClass = status === '○' ? 'ai-status-todo' : status === '◐' ? 'ai-status-progress' : 'ai-status-done';
            const priorityHtml = priority ? (priority.includes('🔴') ? ' <span class="ai-priority-high">🔴</span>' : ' <span class="ai-priority-medium">🟡</span>') : '';
            return `<span class="ai-calendar-event"><span class="ai-calendar-time">${start}-${end}</span> <span class="ai-status ${statusClass}">${status}</span> <span class="ai-calendar-title">${title}</span>${priorityHtml}</span>`;
        });

    // Calendar: Convert non-timed events (📌 status **title** priority)
    formatted = formatted.replace(/📌\s*(○|◐|✓)\s*<strong>(.+?)<\/strong>(\s*🔴|\s*🟡)?/g,
        (match, status, title, priority) => {
            const statusClass = status === '○' ? 'ai-status-todo' : status === '◐' ? 'ai-status-progress' : 'ai-status-done';
            const priorityHtml = priority ? (priority.includes('🔴') ? ' <span class="ai-priority-high">🔴</span>' : ' <span class="ai-priority-medium">🟡</span>') : '';
            return `<span class="ai-calendar-event"><span class="ai-status ${statusClass}">${status}</span> <span class="ai-calendar-title">${title}</span>${priorityHtml}</span>`;
        });

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

    // Show placeholder when no messages
    if (!aiMessages.length && !aiTyping) {
        const placeholder = document.createElement('div');
        placeholder.className = 'ai-empty-state';
        placeholder.innerHTML = `
            <i class="fa-solid fa-robot"></i>
            <p>Start a conversation</p>
            <span>Ask me to manage tasks, calendar events, recalls, or bookmarks</span>
        `;
        container.appendChild(placeholder);
        return;
    }

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

// --- PIN Protection Functions ---

async function checkPinStatus() {
    try {
        const res = await fetch('/api/pin');
        if (!res.ok) return;
        const data = await res.json();
        pinState.hasPin = data.has_pin;
    } catch (e) {
        console.error('Error checking PIN status:', e);
    }
}

async function checkNotesPinStatus() {
    try {
        const res = await fetch('/api/notes-pin/status');
        if (!res.ok) return;
        const data = await res.json();
        pinState.hasNotesPin = data.has_notes_pin;
    } catch (e) {
        console.error('Error checking notes PIN status:', e);
    }
}

async function verifyPin(pin) {
    const noteId = pinState.pendingNoteId;
    const folderId = pinState.pendingFolderId;
    const pendingAction = pinState.pendingAction;

    // Handle folder-related actions
    if (folderId && (pendingAction === 'unlock_folder' || pendingAction === 'unprotect_folder' || pendingAction === 'delete_folder')) {
        return await verifyFolderPin(pin, folderId, pendingAction);
    }

    if (!noteId) {
        showToast('No note selected', 'error', 2000);
        return false;
    }

    try {
        // Handle unprotect action - send PIN with the unprotect request
        if (pendingAction === 'unprotect') {
            const res = await fetch(`/api/notes/${noteId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin, is_pin_protected: false })
            });

            if (res.ok) {
                closePinModal();
                pinState.pendingNoteId = null;
                pinState.pendingAction = null;
                showToast('Protection removed', 'success', 2000);
                await loadNotesUnified();
                return true;
            } else {
                const data = await res.json();
                showToast(data.error || 'Incorrect PIN', 'error', 3000);
                const input = document.getElementById('pin-input');
                if (input) input.value = '';
                return false;
            }
        }

        // Handle unlock to view - use the unlock endpoint
        const res = await fetch(`/api/notes/${noteId}/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin })
        });

        if (res.ok) {
            const noteData = await res.json();
            closePinModal();
            pinState.pendingNoteId = null;
            pinState.pendingAction = null;
            // Open the note with the unlocked content
            openNoteInEditorWithData(noteId, noteData);
            return true;
        } else {
            const data = await res.json();
            showToast(data.error || 'Incorrect PIN', 'error', 3000);
            const input = document.getElementById('pin-input');
            if (input) input.value = '';
            return false;
        }
    } catch (e) {
        console.error('Error verifying PIN:', e);
        showToast('Error verifying PIN', 'error', 3000);
        return false;
    }
}

async function verifyFolderPin(pin, folderId, action) {
    try {
        if (action === 'unlock_folder') {
            // Verify PIN and navigate to folder
            const res = await fetch(`/api/note-folders/${folderId}/unlock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            });

            if (res.ok) {
                closePinModal();
                pinState.pendingFolderId = null;
                pinState.pendingAction = null;
                // Navigate to the folder
                window.location.href = `/notes/folder/${folderId}`;
                return true;
            } else {
                const data = await res.json();
                showToast(data.error || 'Incorrect PIN', 'error', 3000);
                const input = document.getElementById('pin-input');
                if (input) input.value = '';
                return false;
            }
        }

        if (action === 'unprotect_folder') {
            // Send PIN with the unprotect request
            const res = await fetch(`/api/note-folders/${folderId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin, is_pin_protected: false })
            });

            if (res.ok) {
                closePinModal();
                pinState.pendingFolderId = null;
                pinState.pendingAction = null;
                showToast('Protection removed', 'success', 2000);
                await loadNotesUnified();
                return true;
            } else {
                const data = await res.json();
                showToast(data.error || 'Incorrect PIN', 'error', 3000);
                const input = document.getElementById('pin-input');
                if (input) input.value = '';
                return false;
            }
        }

        if (action === 'delete_folder') {
            // Verify PIN and then delete
            const res = await fetch(`/api/note-folders/${folderId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            });

            if (res.ok) {
                closePinModal();
                pinState.pendingFolderId = null;
                pinState.pendingAction = null;
                showToast('Folder deleted', 'success', 2000);
                await loadNotesUnified();
                return true;
            } else {
                const data = await res.json();
                showToast(data.error || 'Incorrect PIN', 'error', 3000);
                const input = document.getElementById('pin-input');
                if (input) input.value = '';
                return false;
            }
        }

        return false;
    } catch (e) {
        console.error('Error verifying folder PIN:', e);
        showToast('Error verifying PIN', 'error', 3000);
        return false;
    }
}

function openPinModal() {
    const modal = document.getElementById('pin-modal');
    if (modal) {
        modal.classList.add('active');
        const input = document.getElementById('pin-input');
        if (input) {
            input.value = '';
            setTimeout(() => input.focus(), 100);
        }
    }
}

function closePinModal() {
    const modal = document.getElementById('pin-modal');
    if (modal) {
        modal.classList.remove('active');
    }
    pinState.pendingNoteId = null;
    pinState.pendingFolderId = null;
    pinState.pendingAction = null;

    // Reset Quick Access protected state if it exists
    if (window.qaProtectedState) {
        window.qaProtectedState.active = false;
        window.qaProtectedState.pendingUrl = null;
    }
}

function submitPin() {
    const input = document.getElementById('pin-input');
    const pin = input ? input.value.trim() : '';
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        showToast('PIN must be 4 digits', 'warning', 2000);
        return;
    }

    // Check if this is a Quick Access protected item unlock
    if (window.qaProtectedState && window.qaProtectedState.active) {
        if (typeof window.verifyQAProtectedPin === 'function') {
            window.verifyQAProtectedPin(pin);
        }
        return;
    }

    verifyPin(pin);
}

function openSetPinModal() {
    const modal = document.getElementById('set-pin-modal');
    if (modal) {
        modal.classList.add('active');
        const input = document.getElementById('new-pin-input');
        if (input) {
            input.value = '';
            setTimeout(() => input.focus(), 100);
        }
        const confirmInput = document.getElementById('confirm-pin-input');
        if (confirmInput) confirmInput.value = '';
    }
}

function closeSetPinModal() {
    const modal = document.getElementById('set-pin-modal');
    if (modal) {
        modal.classList.remove('active');
    }
    // Reset notes PIN setting state if cancelled
    pinState.settingNotesPin = false;
}

async function submitSetPin() {
    const newPinInput = document.getElementById('new-pin-input');
    const confirmPinInput = document.getElementById('confirm-pin-input');
    const newPin = newPinInput ? newPinInput.value.trim() : '';
    const confirmPin = confirmPinInput ? confirmPinInput.value.trim() : '';

    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
        showToast('PIN must be 4 digits', 'warning', 2000);
        return;
    }

    if (newPin !== confirmPin) {
        showToast('PINs do not match', 'warning', 2000);
        return;
    }

    // Check if we're setting the notes PIN
    const settingNotesPin = pinState.settingNotesPin;
    const pendingAction = pinState.pendingAction;
    const pendingNoteId = pinState.pendingNoteId;
    const pendingFolderId = pinState.pendingFolderId;

    try {
        const endpoint = settingNotesPin ? '/api/notes-pin' : '/api/pin';
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: newPin, confirm_pin: confirmPin })
        });
        const data = await res.json();
        if (res.ok) {
            if (settingNotesPin) {
                pinState.hasNotesPin = true;
                pinState.settingNotesPin = false;
            } else {
                pinState.hasPin = true;
            }
            closeSetPinModal();
            showToast('PIN set successfully', 'success', 2000);

            // If there was a pending protection action, execute it now
            if (settingNotesPin && pendingAction === 'protect_after_set' && pendingNoteId) {
                await doProtectNote(pendingNoteId, true);
                pinState.pendingNoteId = null;
                pinState.pendingAction = null;
            } else if (settingNotesPin && pendingAction === 'protect_folder_after_set' && pendingFolderId) {
                await doProtectFolder(pendingFolderId, true);
                pinState.pendingFolderId = null;
                pinState.pendingAction = null;
            }
        } else {
            showToast(data.error || 'Failed to set PIN', 'error', 3000);
        }
    } catch (e) {
        showToast('Error setting PIN', 'error', 3000);
    }
}

async function toggleNoteProtection(noteId) {
    if (!noteId) {
        noteId = notesState.activeNoteId;
    }
    if (!noteId) {
        showToast('No note selected', 'warning', 2000);
        return;
    }

    // Check if user has notes PIN set
    if (!pinState.hasNotesPin) {
        pinState.settingNotesPin = true;
        pinState.pendingNoteId = noteId;
        pinState.pendingAction = 'protect_after_set';
        openSetPinModal();
        return;
    }

    const note = notesState.notes.find(n => n.id === noteId);
    if (!note) return;

    // If unprotecting, require PIN first
    if (note.is_pin_protected) {
        pinState.pendingNoteId = noteId;
        pinState.pendingAction = 'unprotect';
        openPinModal();
        return;
    }

    // Protecting an unprotected note
    try {
        const res = await fetch(`/api/notes/${noteId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_pin_protected: true })
        });

        if (!res.ok) {
            const data = await res.json();
            showToast(data.error || 'Failed to update protection', 'error', 3000);
            return;
        }

        // Update local state
        note.is_pin_protected = true;

        // Update UI
        updateProtectButton(true);
        showToast('Note protected', 'success', 2000);
    } catch (e) {
        console.error('Error toggling protection:', e);
        showToast('Error updating protection', 'error', 3000);
    }
}

function updateProtectButton(isProtected) {
    // Update note protect button
    const noteBtn = document.getElementById('note-protect-btn');
    if (noteBtn) {
        const icon = noteBtn.querySelector('i');
        const label = noteBtn.querySelector('span');
        if (isProtected) {
            if (icon) icon.className = 'fa-solid fa-lock-open';
            if (label) label.textContent = ' Unprotect';
        } else {
            if (icon) icon.className = 'fa-solid fa-lock';
            if (label) label.textContent = ' Protect';
        }
    }

    // Update list protect button
    const listBtn = document.getElementById('list-protect-btn');
    if (listBtn) {
        const icon = listBtn.querySelector('i');
        const label = listBtn.querySelector('span');
        if (isProtected) {
            if (icon) icon.className = 'fa-solid fa-lock-open';
            if (label) label.textContent = ' Unprotect';
        } else {
            if (icon) icon.className = 'fa-solid fa-lock';
            if (label) label.textContent = ' Protect';
        }
    }
}

async function toggleListProtection() {
    const listId = listState.listId;
    if (!listId) {
        showToast('No list selected', 'warning', 2000);
        return;
    }

    // Check if user has notes PIN set
    if (!pinState.hasNotesPin) {
        pinState.settingNotesPin = true;
        pinState.pendingNoteId = listId;
        pinState.pendingAction = 'protect_after_set';
        openSetPinModal();
        return;
    }

    // Check current protection state from notesState or protectButton state
    const note = notesState.notes.find(n => n.id === listId);
    const isCurrentlyProtected = note ? note.is_pin_protected : false;

    // If unprotecting, require PIN first
    if (isCurrentlyProtected) {
        pinState.pendingNoteId = listId;
        pinState.pendingAction = 'unprotect';
        openPinModal();
        return;
    }

    // Protecting an unprotected list
    try {
        const updateRes = await fetch(`/api/notes/${listId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_pin_protected: true })
        });

        if (!updateRes.ok) {
            const data = await updateRes.json();
            showToast(data.error || 'Failed to update protection', 'error', 3000);
            return;
        }

        // Update local state if note exists
        if (note) note.is_pin_protected = true;

        // Update UI
        updateProtectButton(true);
        showToast('List protected', 'success', 2000);
    } catch (e) {
        console.error('Error toggling list protection:', e);
        showToast('Error updating protection', 'error', 3000);
    }
}
