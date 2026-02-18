// DOM Elements & State
const listsGrid = document.getElementById('lists-grid');
const createModal = document.getElementById('create-modal');
const addItemModal = document.getElementById('add-item-modal');
const bulkImportModal = document.getElementById('bulk-import-modal');
const moveItemModal = document.getElementById('move-item-modal');
const phaseMenu = document.getElementById('phase-menu');
// Task selection manager - unified with other modules
let taskSelection = null;
// Backward compatible reference to selection set
let selectedItems = new Set();
const selectedNotes = new Set();

// Shared UI helpers/classes are loaded from static/shared-ui.js.

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
let notesState = { notes: [], archivedNotes: [], activeNoteId: null, dirty: false, activeSnapshot: null, sessionSnapshot: null, checkboxMode: false, activeFolderId: null, activeNoteIsArchived: false, activeNoteIsListed: true, activePlannerContext: null };
let pinState = { hasPin: false, hasNotesPin: false, settingNotesPin: false, pendingNoteId: null, pendingFolderId: null, pendingAction: null };
let listState = { listId: null, items: [], dirty: false, activeSnapshot: null, sessionSnapshot: null, checkboxMode: false, insertionIndex: null, editingItemId: null, expandedItemId: null, isArchived: false, isListed: true, folderId: null, collapsedSectionIds: new Set(), sectionReorderMode: false };
let listDuplicateState = { groups: [], method: null, threshold: null, selectedIds: new Set() };
let listAutoSaveTimer = null;
let listAutoSaveInFlight = false;
let noteAutoSaveTimer = null;
let noteAutoSaveInFlight = false;
let noteCleanupInFlight = false;
let noteCleanupState = { originalHtml: null };
let noteExitInProgress = false;
let noteFolderState = { folders: [], archivedFolders: [], currentFolderId: null, archivedOpen: false };
try {
    noteFolderState.archivedOpen = localStorage.getItem('notes_archived_open') === '1';
} catch (e) {
    noteFolderState.archivedOpen = false;
}

let readOnlyToastAt = 0;
function showReadOnlyToast() {
    const now = Date.now();
    if (now - readOnlyToastAt < 1200) return;
    readOnlyToastAt = now;
    showToast('Archived notes are read-only.', 'info', 2000);
}
let noteMoveState = { ids: [], destinationFolderId: null, navStack: [], itemType: 'note' };
let activeListItemMenu = null;
let activeListItemActionPill = null;
let listSelectionState = { active: false, ids: new Set() };
let listSearchState = { query: '' };
let listSectionModalState = { onSubmit: null };
let recallState = {
    items: [],
    modalRecallId: null,
    modalEditMode: false,
    pollingIds: [],
    pollingInterval: null
};
let currentTaskFilter = 'all';
let selectedTagFilters = new Set();
const TASK_FILTER_STATE_KEY_PREFIX = 'task_filter_state:';
const taskTagAutocompleteMap = new Map();
let taskTagAutocompleteGlobalHandlersBound = false;
let taskTagAutocompleteRepositionRaf = 0;
let calendarState = { selectedDay: null, events: [], monthCursor: null, monthEventsByDay: {}, dayViewOpen: false, detailsOpen: false, daySort: 'time', dayViewMode: 'timeline' };
let calendarSearchState = { query: '', results: [], loading: false, debounceTimer: null, requestToken: 0 };
const calendarSelection = { active: false, ids: new Set(), longPressTimer: null, longPressTriggered: false, touchStart: { x: 0, y: 0 } };
let calendarReminderTimers = {};
let calendarNotifyEnabled = false;
let calendarPrompt = { resolve: null, reject: null, onSubmit: null };
let datePickerState = { itemId: null, itemTitle: '' };
let linkNoteModalState = { targetType: 'task', targetId: null, targetTitle: '', selectedNoteId: null, notes: [], existingNoteIds: [] };
let noteLinkState = { anchor: null, title: '', matches: [], sourceNoteId: null, openOnResolve: true, folderId: null, noteType: 'note' };
let linkEditState = { anchor: null };
let suppressLinkClickUntil = 0;
let linkLongPressTimer = null;
let linkLongPressTriggered = false;
let linkLongPressStart = null;
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
    if (document.body && document.body.dataset.tasksDashboardInit === '1') return;
    if (document.body) document.body.dataset.tasksDashboardInit = '1';

    try {
        const res = await fetch('/api/lists');
        if (res.status === 401) {
            window.location.href = '/select-user';
            return;
        }
        if (!res.ok) throw new Error('Failed to load task lists');
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
        if (typeof initTasksFab === 'function') initTasksFab();
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
                    `<button class="btn-icon delete" type="button" title="Delete" aria-label="Delete list" onclick="event.preventDefault(); event.stopPropagation(); deleteList(${list.id});">
                        <i class="fa-solid fa-trash"></i>
                    </button>` :
                    `<span>${doneCount}/${itemCount} Tasks</span>
                    <button class="btn-icon delete" type="button" title="Delete" aria-label="Delete list" onclick="event.preventDefault(); event.stopPropagation(); deleteList(${list.id});">
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
    datePickerState.itemTitle = itemTitle || '';
    input.value = currentDate || '';
    if (label) label.textContent = itemTitle ? `For "${itemTitle}"` : '';
    modal.classList.add('active');
    input.focus();
}

function closeDatePickerModal() {
    const modal = document.getElementById('date-picker-modal');
    if (modal) modal.classList.remove('active');
    datePickerState = { itemId: null, itemTitle: '' };
}

async function saveDatePickerSelection(remove = false) {
    const input = document.getElementById('date-picker-input');
    if (!datePickerState.itemId || !input) return;
    const itemId = datePickerState.itemId;
    const itemTitle = datePickerState.itemTitle || '';
    const dueDate = remove ? null : (input.value || null);
    const payload = { due_date: dueDate };

    const persistDate = async () => {
        const res = await fetch(`/api/items/${itemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to set date');
        closeDatePickerModal();
        window.location.reload();
    };

    if (dueDate && typeof openCalendarMovePreviewModal === 'function') {
        const movingLabel = itemTitle ? `"${itemTitle}"` : 'this task';
        await openCalendarMovePreviewModal({
            targetDay: dueDate,
            movingLabel,
            confirmLabel: 'Attach date',
            onConfirm: async () => {
                try {
                    await persistDate();
                } catch (e) {
                    console.error('Error setting date:', e);
                    showToast('Could not set date. Please try again.', 'error');
                    throw e;
                }
            }
        });
        return;
    }

    try {
        await persistDate();
    } catch (e) {
        console.error('Error setting date:', e);
        showToast('Could not set date. Please try again.', 'error');
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
        showToast('Select a note or create a new one first.', 'warning');
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
        showToast('Could not link note. Please try again.', 'error');
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
        showToast('Could not create note. Please try again.', 'error');
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
                showToast('Could not unlink note(s). Please try again.', 'error');
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
            showToast('Could not unlink note(s). Please try again.', 'error');
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
    if (ev.is_planner_item) {
        const linked = await ensureLinkedPlannerEvent(ev);
        if (!linked || !linked.calendar_event_id) return null;
        return { ...ev, ...linked, id: linked.calendar_event_id };
    }
    if (ev.is_note_list_item) {
        const linked = await ensureLinkedNoteListEvent(ev);
        if (!linked || !linked.calendar_event_id) return null;
        return { ...ev, ...linked, id: linked.calendar_event_id };
    }
    if (ev.is_feed_item) {
        const linked = await ensureLinkedFeedEvent(ev);
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
            await scheduleLocalReminders();
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
    if (created.allow_overlap !== null && created.allow_overlap !== undefined) {
        ev.allow_overlap = created.allow_overlap;
    } else if (ev.allow_overlap === null || ev.allow_overlap === undefined) {
        ev.allow_overlap = false;
    }
    ev.day = created.day || calendarState.selectedDay;
    return ev;
}

async function ensureLinkedPlannerEvent(ev) {
    if (!ev || !ev.is_planner_item) return null;
    if (ev.calendar_event_id) return ev;
    const payload = { title: ev.title };
    if (ev.planner_type === 'simple') {
        payload.planner_simple_item_id = ev.planner_item_id;
    } else if (ev.planner_type === 'group') {
        payload.planner_multi_item_id = ev.planner_item_id;
    } else if (ev.planner_type === 'line') {
        payload.planner_multi_line_id = ev.planner_line_id;
    }
    const created = await createCalendarEvent(payload);
    if (!created || !created.id) return null;
    ev.calendar_event_id = created.id;
    ev.start_time = created.start_time;
    ev.end_time = created.end_time;
    ev.reminder_minutes_before = created.reminder_minutes_before;
    ev.priority = created.priority || ev.priority || 'medium';
    ev.rollover_enabled = created.rollover_enabled || false;
    if (created.allow_overlap !== null && created.allow_overlap !== undefined) {
        ev.allow_overlap = created.allow_overlap;
    } else if (ev.allow_overlap === null || ev.allow_overlap === undefined) {
        ev.allow_overlap = false;
    }
    ev.day = created.day || calendarState.selectedDay;
    return ev;
}

async function ensureLinkedNoteListEvent(ev) {
    if (!ev || !ev.is_note_list_item || !ev.note_list_item_id) return null;
    if (ev.calendar_event_id) return ev;
    const created = await createCalendarEvent({
        title: ev.title,
        note_list_item_id: ev.note_list_item_id
    });
    if (!created || !created.id) return null;
    ev.calendar_event_id = created.id;
    ev.start_time = created.start_time;
    ev.end_time = created.end_time;
    ev.reminder_minutes_before = created.reminder_minutes_before;
    ev.priority = created.priority || ev.priority || 'medium';
    ev.rollover_enabled = created.rollover_enabled || false;
    ev.display_mode = created.display_mode || ev.display_mode || 'both';
    ev.item_note = created.item_note || ev.item_note || null;
    if (created.allow_overlap !== null && created.allow_overlap !== undefined) {
        ev.allow_overlap = created.allow_overlap;
    } else if (ev.allow_overlap === null || ev.allow_overlap === undefined) {
        ev.allow_overlap = false;
    }
    ev.status = created.status || ev.status || 'not_started';
    ev.day = created.day || calendarState.selectedDay;
    return ev;
}

async function ensureLinkedFeedEvent(ev) {
    if (!ev || !ev.is_feed_item || !ev.feed_item_id) return null;
    if (ev.calendar_event_id) return ev;
    const created = await createCalendarEvent({
        title: ev.title,
        do_feed_item_id: ev.feed_item_id
    });
    if (!created || !created.id) return null;
    ev.calendar_event_id = created.id;
    ev.start_time = created.start_time;
    ev.end_time = created.end_time;
    ev.reminder_minutes_before = created.reminder_minutes_before;
    ev.priority = created.priority || ev.priority || 'medium';
    ev.rollover_enabled = created.rollover_enabled || false;
    ev.display_mode = created.display_mode || ev.display_mode || 'both';
    ev.item_note = created.item_note || ev.item_note || null;
    if (created.allow_overlap !== null && created.allow_overlap !== undefined) {
        ev.allow_overlap = created.allow_overlap;
    } else if (ev.allow_overlap === null || ev.allow_overlap === undefined) {
        ev.allow_overlap = false;
    }
    ev.status = created.status || ev.status || 'not_started';
    ev.day = created.day || calendarState.selectedDay;
    return ev;
}

async function updateLinkedNoteListStatus(ev, status) {
    try {
        const linked = await ensureLinkedNoteListEvent(ev);
        if (!linked || !linked.calendar_event_id) return;
        await updateCalendarEvent(linked.calendar_event_id, { status }, { skipReload: false, skipMonth: true });
        linked.status = status;
        ev.status = status;
        if (calendarState.monthCursor) await loadCalendarMonth();
        await scheduleLocalReminders();
    } catch (e) {
        console.error('Error updating linked list item status:', e);
    }
}

async function updateLinkedFeedStatus(ev, status) {
    try {
        const linked = await ensureLinkedFeedEvent(ev);
        if (!linked || !linked.calendar_event_id) return;
        await updateCalendarEvent(linked.calendar_event_id, { status }, { skipReload: false, skipMonth: true });
        linked.status = status;
        ev.status = status;
        if (calendarState.monthCursor) await loadCalendarMonth();
        await scheduleLocalReminders();
    } catch (e) {
        console.error('Error updating linked feed item status:', e);
    }
}

async function unpinPlannerDate(ev) {
    openConfirmModal('Remove this item from this date?', async () => {
        try {
            let endpoint = '';
            if (ev.planner_type === 'simple') {
                endpoint = `/api/planner/simple-items/${ev.planner_item_id}`;
            } else if (ev.planner_type === 'group') {
                endpoint = `/api/planner/multi-items/${ev.planner_item_id}`;
            } else if (ev.planner_type === 'line') {
                endpoint = `/api/planner/multi-lines/${ev.planner_line_id}`;
            }
            if (!endpoint) return;
            await fetch(endpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scheduled_date: null })
            });
            window.location.reload();
        } catch (e) {
            console.error('Error unpinning planner item:', e);
            showToast('Could not unpin planner item.', 'error');
        }
    });
}

async function unpinNoteListDate(noteId, noteListItemId) {
    openConfirmModal('Remove this list item from this date?', async () => {
        try {
            await fetch(`/api/notes/${noteId}/list-items/${noteListItemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scheduled_date: null })
            });
            window.location.reload();
        } catch (e) {
            console.error('Error unpinning list item date:', e);
            showToast('Could not unpin list item.', 'error');
        }
    });
}

async function unpinTaskDate(taskId) {
    openConfirmModal('Remove this task from this date?', async () => {
        try {
            await fetch(`/api/items/${taskId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ due_date: null })
            });
            window.location.reload();
        } catch (e) {
            console.error('Error unpinning task:', e);
            showToast('Could not unpin task.', 'error');
        }
    });
}

async function unpinFeedDate(feedItemId) {
    openConfirmModal('Remove this feed item from this date?', async () => {
        try {
            await fetch(`/api/feed/${feedItemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scheduled_date: null })
            });
            window.location.reload();
        } catch (e) {
            console.error('Error unpinning feed item:', e);
            showToast('Could not unpin feed item.', 'error');
        }
    });
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
                window.location.href = '/tasks';
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
        } else {
            const err = await res.json().catch(() => ({}));
            if (err && err.error) {
                showToast(err.error, 'error');
            }
        }
    } catch (e) {
        console.error('Error updating item:', e);
    }
}

async function inlineToggleStatus(itemId, currentStatus, targetStatus) {
    const nextStatus = currentStatus === targetStatus ? 'not_started' : targetStatus;
    updateItemStatus(itemId, nextStatus);
}

let dependencyTargetId = null;
let dependencySelectedIds = new Set();
let dependencyNavStack = [];

function getDependencyIdsForItem(itemId) {
    const row = document.getElementById(`item-${itemId}`);
    const deps = row && row.dataset.deps
        ? row.dataset.deps.split(',').map((val) => val.trim()).filter(Boolean)
        : [];
    return deps;
}

function updateDependencyBackButton() {
    const backBtn = document.getElementById('dependency-back-button');
    if (!backBtn) return;
    backBtn.style.display = dependencyNavStack.length > 1 ? 'inline-flex' : 'none';
}

function pushDependencyView(renderFn) {
    dependencyNavStack.push(renderFn);
    updateDependencyBackButton();
    renderFn();
}

function dependencyNavBack() {
    if (dependencyNavStack.length > 1) {
        dependencyNavStack.pop();
        const last = dependencyNavStack[dependencyNavStack.length - 1];
        last && last();
    }
    updateDependencyBackButton();
}

function getDependencyPhaseId() {
    const row = dependencyTargetId ? document.getElementById(`item-${dependencyTargetId}`) : null;
    const phaseId = row ? row.dataset.phaseParent : '';
    return phaseId ? parseInt(phaseId, 10) : null;
}

function getPhaseTitle(phaseId) {
    if (!phaseId) return null;
    const phaseEl = document.getElementById(`item-${phaseId}`);
    const titleEl = phaseEl ? phaseEl.querySelector('.task-text') : null;
    return titleEl ? titleEl.textContent.trim() : null;
}

function renderDependencyRoot() {
    const panel = document.getElementById('dependency-step-container');
    if (!panel) return;
    panel.innerHTML = '';
    dependencyNavStack = [renderDependencyRoot];
    updateDependencyBackButton();

    const actions = [];
    const currentListType = (typeof CURRENT_LIST_TYPE !== 'undefined' ? CURRENT_LIST_TYPE : null);
    if (currentListType === 'list') {
        const phaseId = getDependencyPhaseId();
        if (phaseId) {
            const phaseTitle = getPhaseTitle(phaseId) || 'This phase';
            actions.push({
                label: `<i class="fa-solid fa-layer-group" style="margin-right: 0.5rem;"></i>Within "${phaseTitle}"`,
                handler: () => pushDependencyView(() => renderDependencyTasks(CURRENT_LIST_ID, phaseId, `Phase: ${phaseTitle}`))
            });
        }
        actions.push({
            label: `<i class="fa-solid fa-list-check" style="margin-right: 0.5rem;"></i>Within "${typeof CURRENT_LIST_TITLE !== 'undefined' ? CURRENT_LIST_TITLE : 'this project'}"`,
            handler: () => pushDependencyView(() => renderDependencyPhasePicker(CURRENT_LIST_ID, typeof CURRENT_LIST_TITLE !== 'undefined' ? CURRENT_LIST_TITLE : 'This project'))
        });
    }
    actions.push({
        label: '<i class="fa-solid fa-sitemap" style="margin-right: 0.5rem;"></i>Browse projects',
        handler: () => pushDependencyView(renderDependencyProjectList)
    });
    actions.push({
        label: '<i class="fa-solid fa-folder-tree" style="margin-right: 0.5rem;"></i>Browse hubs',
        handler: () => pushDependencyView(renderDependencyHubList)
    });

    actions.forEach((action) => {
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.innerHTML = action.label;
        btn.onclick = action.handler;
        panel.appendChild(btn);
    });
}

async function renderDependencyPhasePicker(listId, listTitle) {
    const panel = document.getElementById('dependency-step-container');
    if (!panel) return;
    panel.innerHTML = `<div class="move-heading"><i class="fa-solid fa-list-check" style="margin-right: 0.5rem;"></i>Choose a phase in "${listTitle}"</div>`;
    try {
        const res = await fetch(`/api/lists/${listId}/phases`);
        const data = await res.json();
        const btnAll = document.createElement('button');
        btnAll.className = 'btn';
        btnAll.innerHTML = `<i class="fa-solid fa-inbox" style="margin-right: 0.5rem; opacity: 0.7;"></i>All tasks in "${data.title || listTitle}"`;
        btnAll.onclick = () => pushDependencyView(() => renderDependencyTasks(listId, null, data.title || listTitle));
        panel.appendChild(btnAll);

        const btnNoPhase = document.createElement('button');
        btnNoPhase.className = 'btn';
        btnNoPhase.innerHTML = `<i class="fa-solid fa-layer-group" style="margin-right: 0.5rem; opacity: 0.7;"></i>No phase`;
        btnNoPhase.onclick = () => pushDependencyView(() => renderDependencyTasks(listId, 'none', data.title || listTitle));
        panel.appendChild(btnNoPhase);

        if (data.phases && data.phases.length) {
            data.phases.forEach((phase) => {
                const btn = document.createElement('button');
                btn.className = 'btn';
                btn.innerHTML = `<i class="fa-solid fa-layer-group" style="margin-right: 0.5rem; opacity: 0.7;"></i>${phase.content}`;
                btn.onclick = () => pushDependencyView(() => renderDependencyTasks(listId, phase.id, phase.content));
                panel.appendChild(btn);
            });
        }
    } catch (e) {
        panel.innerHTML += '<div style="color: var(--danger-color); margin-top: 0.5rem;"><i class="fa-solid fa-exclamation-triangle"></i> Unable to load phases.</div>';
    }
}

async function renderDependencyProjectList() {
    const panel = document.getElementById('dependency-step-container');
    if (!panel) return;
    panel.innerHTML = '<div class="move-heading"><i class="fa-solid fa-sitemap" style="margin-right: 0.5rem;"></i>Choose a project</div>';
    try {
        const res = await fetch('/api/lists?type=list&include_children=true');
        const lists = await res.json();
        if (!lists.length) {
            panel.innerHTML += '<div style="color: var(--text-muted); padding: 1rem; text-align: center;"><i class="fa-solid fa-inbox" style="margin-right: 0.5rem;"></i>No projects available.</div>';
            return;
        }
        lists.forEach((list) => {
            const btn = document.createElement('button');
            btn.className = 'btn';
            btn.innerHTML = `<i class="fa-solid fa-list-check" style="margin-right: 0.5rem; opacity: 0.7;"></i>${list.title}`;
            btn.onclick = () => pushDependencyView(() => renderDependencyPhasePicker(list.id, list.title));
            panel.appendChild(btn);
        });
    } catch (e) {
        panel.innerHTML += '<div style="color: var(--danger-color); margin-top: 0.5rem;"><i class="fa-solid fa-exclamation-triangle"></i> Unable to load projects.</div>';
    }
}

async function renderDependencyHubList() {
    const panel = document.getElementById('dependency-step-container');
    if (!panel) return;
    panel.innerHTML = '<div class="move-heading"><i class="fa-solid fa-folder-tree" style="margin-right: 0.5rem;"></i>Choose a hub</div>';
    try {
        const res = await fetch('/api/hubs');
        const hubs = await res.json();
        if (!hubs.length) {
            panel.innerHTML += '<div style="color: var(--text-muted); padding: 1rem; text-align: center;"><i class="fa-solid fa-inbox" style="margin-right: 0.5rem;"></i>No hubs available.</div>';
            return;
        }
        hubs.forEach((hub) => {
            const btn = document.createElement('button');
            btn.className = 'btn';
            btn.innerHTML = `<i class="fa-solid fa-folder-tree" style="margin-right: 0.5rem; opacity: 0.7;"></i>${hub.title}`;
            btn.onclick = () => pushDependencyView(() => renderDependencyHubProjects(hub.id, hub.title));
            panel.appendChild(btn);
        });
    } catch (e) {
        panel.innerHTML += '<div style="color: var(--danger-color); margin-top: 0.5rem;"><i class="fa-solid fa-exclamation-triangle"></i> Unable to load hubs.</div>';
    }
}

async function renderDependencyHubProjects(hubId, hubTitle) {
    const panel = document.getElementById('dependency-step-container');
    if (!panel) return;
    panel.innerHTML = `<div class="move-heading"><i class="fa-solid fa-sitemap" style="margin-right: 0.5rem;"></i>Projects in "${hubTitle}"</div>`;
    try {
        const res = await fetch(`/api/hubs/${hubId}/children`);
        const data = await res.json();
        if (!data.children || !data.children.length) {
            panel.innerHTML += '<div style="color: var(--text-muted); margin-top: 0.5rem; padding: 1rem; text-align: center;"><i class="fa-solid fa-inbox" style="margin-right: 0.5rem;"></i>No projects in this hub.</div>';
            return;
        }
        data.children.forEach((child) => {
            if (child.type === 'hub') {
                const btnHub = document.createElement('button');
                btnHub.className = 'btn';
                btnHub.innerHTML = `<i class="fa-solid fa-folder-tree" style="margin-right: 0.5rem; opacity: 0.7;"></i>${child.title} <span style="opacity: 0.6; margin-left: 0.25rem;">(Hub)</span>`;
                btnHub.onclick = () => pushDependencyView(() => renderDependencyHubProjects(child.id, child.title));
                panel.appendChild(btnHub);
            } else if (child.type === 'list') {
                const btnProject = document.createElement('button');
                btnProject.className = 'btn';
                btnProject.innerHTML = `<i class="fa-solid fa-list-check" style="margin-right: 0.5rem; opacity: 0.7;"></i>${child.title}`;
                btnProject.onclick = () => pushDependencyView(() => renderDependencyPhasePicker(child.id, child.title));
                panel.appendChild(btnProject);
            }
        });
    } catch (e) {
        panel.innerHTML += '<div style="color: var(--danger-color); margin-top: 0.5rem; padding: 1rem;"><i class="fa-solid fa-exclamation-triangle" style="margin-right: 0.5rem;"></i>Unable to load hub contents.</div>';
    }
}

async function renderDependencyTasks(listId, phaseId, heading) {
    const panel = document.getElementById('dependency-step-container');
    if (!panel) return;
    panel.innerHTML = `<div class="move-heading"><i class="fa-solid fa-list-check" style="margin-right: 0.5rem;"></i>${heading}</div>`;
    try {
        const res = await fetch(`/api/items?list_id=${listId}`);
        const items = await res.json();
        const tasks = (items || []).filter((item) => {
            if (item.is_phase || item.status === 'phase') return false;
            if (dependencyTargetId && item.id === dependencyTargetId) return false;
            if (phaseId === 'none') return !item.phase_id;
            if (phaseId && phaseId !== 'none') return item.phase_id === phaseId;
            return true;
        });
        if (!tasks.length) {
            panel.innerHTML += '<div style="color: var(--text-muted); margin-top: 0.5rem;">No tasks found.</div>';
            return;
        }
        const listEl = document.createElement('div');
        listEl.className = 'dependency-task-list';
        tasks.forEach((task) => {
            const wrapper = document.createElement('label');
            wrapper.className = 'dependency-item';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = String(task.id);
            input.checked = dependencySelectedIds.has(String(task.id));
            input.onchange = () => {
                if (input.checked) dependencySelectedIds.add(String(task.id));
                else dependencySelectedIds.delete(String(task.id));
            };
            const text = document.createElement('span');
            text.className = 'dependency-text';
            text.textContent = task.content;
            const status = document.createElement('span');
            status.className = `dependency-status status-${task.status || 'not_started'}`;
            status.textContent = task.status === 'done' ? 'Done' : task.status === 'in_progress' ? 'Started' : 'Not started';
            wrapper.appendChild(input);
            wrapper.appendChild(text);
            wrapper.appendChild(status);
            listEl.appendChild(wrapper);
        });
        panel.appendChild(listEl);
    } catch (e) {
        panel.innerHTML += '<div style="color: var(--danger-color); margin-top: 0.5rem;">Unable to load tasks.</div>';
    }
}

function openDependencyModal(itemId, title) {
    dependencyTargetId = itemId;
    dependencySelectedIds = new Set(getDependencyIdsForItem(itemId));
    const modal = document.getElementById('dependency-modal');
    const label = document.getElementById('dependency-target-label');
    const titleEl = document.getElementById('dependency-title');
    if (label) label.textContent = title ? `For: ${title}` : '';
    if (titleEl) titleEl.textContent = 'Set Dependencies';
    renderDependencyRoot();
    if (modal) modal.classList.add('active');
}

function closeDependencyModal() {
    dependencyTargetId = null;
    dependencySelectedIds = new Set();
    dependencyNavStack = [];
    const modal = document.getElementById('dependency-modal');
    const label = document.getElementById('dependency-target-label');
    if (label) label.textContent = '';
    if (modal) modal.classList.remove('active');
    updateDependencyBackButton();
}

async function saveDependencies() {
    if (!dependencyTargetId) return;
    const selected = Array.from(dependencySelectedIds).map((val) => parseInt(val, 10)).filter(Number.isFinite);
    try {
        const res = await fetch(`/api/items/${dependencyTargetId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dependency_ids: selected })
        });
        if (res.ok) {
            closeDependencyModal();
            window.location.reload();
        } else {
            const err = await res.json().catch(() => ({}));
            if (err && err.error) showToast(err.error, 'error');
        }
    } catch (e) {
        console.error('Error saving dependencies:', e);
    }
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
    restoreTaskFilterState();
    menu.querySelectorAll('.task-filter-item[data-filter]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            setTaskFilter(btn.dataset.filter);
            closeTaskFilterMenu();
        });
    });
    setTaskFilter(currentTaskFilter);
}

function getTaskFilterStateKey() {
    if (typeof CURRENT_LIST_ID === 'undefined' || CURRENT_LIST_ID === null) return null;
    return `${TASK_FILTER_STATE_KEY_PREFIX}${CURRENT_LIST_ID}`;
}

function saveTaskFilterState() {
    const key = getTaskFilterStateKey();
    if (!key) return;
    try {
        const state = {
            filter: currentTaskFilter || 'all',
            tags: Array.from(selectedTagFilters)
        };
        sessionStorage.setItem(key, JSON.stringify(state));
    } catch (e) {
        // Ignore storage failures (private mode, disabled storage, etc.)
    }
}

function restoreTaskFilterState() {
    const key = getTaskFilterStateKey();
    if (!key) return;
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const allowedFilters = new Set(['all', 'not_started', 'in_progress', 'done']);
        if (parsed && allowedFilters.has(parsed.filter)) {
            currentTaskFilter = parsed.filter;
        }
        if (parsed && Array.isArray(parsed.tags)) {
            selectedTagFilters = new Set(parsed.tags.map(normalizeTag).filter(Boolean));
        }
    } catch (e) {
        currentTaskFilter = 'all';
        selectedTagFilters = new Set();
    }
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

function collectTaskTagAutocompleteSource() {
    const byNormalized = new Map();
    const addTag = (value) => {
        const raw = (value || '').toString().trim();
        if (!raw || raw === '__all') return;
        const normalized = raw.toLowerCase();
        if (!byNormalized.has(normalized)) byNormalized.set(normalized, raw);
    };

    document.querySelectorAll('#task-filter-submenu-tags .tag-filter-chip[data-tag]').forEach((chip) => {
        addTag(chip.dataset.tag);
    });
    document.querySelectorAll('.task-item[data-tags]').forEach((item) => {
        const rawTags = item.dataset.tags || '';
        rawTags.split(',').forEach(addTag);
    });

    return Array.from(byNormalized.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function buildTaskTagAutocompleteContext(input) {
    const value = input.value || '';
    const selectionStart = Number.isInteger(input.selectionStart) ? input.selectionStart : value.length;
    const caret = Math.max(0, Math.min(selectionStart, value.length));
    const commaSearchIndex = caret > 0 ? caret - 1 : 0;
    const previousComma = value.lastIndexOf(',', commaSearchIndex);
    const tokenStart = previousComma === -1 ? 0 : previousComma + 1;
    const nextComma = value.indexOf(',', caret);
    const tokenEnd = nextComma === -1 ? value.length : nextComma;
    const rawToken = value.slice(tokenStart, tokenEnd);
    const leadingWhitespace = (rawToken.match(/^\s*/) || [''])[0];
    return {
        query: rawToken.trim().toLowerCase(),
        valuePrefix: value.slice(0, tokenStart) + leadingWhitespace,
        valueSuffix: value.slice(tokenEnd)
    };
}

function getTaskTagAutocompleteState(input) {
    if (!input) return null;
    if (taskTagAutocompleteMap.has(input)) return taskTagAutocompleteMap.get(input);
    const dropdown = document.createElement('div');
    dropdown.className = 'autocomplete-dropdown';
    dropdown.setAttribute('role', 'listbox');
    dropdown.addEventListener('mousedown', (event) => {
        event.preventDefault();
    });
    document.body.appendChild(dropdown);
    const state = { dropdown, matches: [], selectedIndex: -1 };
    taskTagAutocompleteMap.set(input, state);
    return state;
}

function positionTaskTagDropdown(input, dropdown) {
    if (!input || !dropdown) return;
    const rect = input.getBoundingClientRect();
    const gutter = 8;
    const spacing = 6;
    const maxWidth = Math.max(220, window.innerWidth - (gutter * 2));
    const width = Math.min(rect.width, maxWidth);
    const left = Math.max(gutter, Math.min(rect.left, window.innerWidth - width - gutter));

    dropdown.style.left = `${Math.round(left)}px`;
    dropdown.style.width = `${Math.round(width)}px`;
    dropdown.style.top = `${Math.round(rect.bottom + spacing)}px`;

    const dropHeight = Math.min(dropdown.offsetHeight || 220, 260);
    const spaceBelow = window.innerHeight - rect.bottom - spacing;
    const spaceAbove = rect.top - spacing;
    if (spaceBelow < 120 && spaceAbove > spaceBelow) {
        const top = Math.max(gutter, rect.top - dropHeight - spacing);
        dropdown.style.top = `${Math.round(top)}px`;
    }
}

function hideTaskTagDropdown(input) {
    const state = input ? taskTagAutocompleteMap.get(input) : null;
    if (!state) return;
    state.matches = [];
    state.selectedIndex = -1;
    state.dropdown.classList.remove('show');
    state.dropdown.innerHTML = '';
}

function updateTaskTagActiveOption(state) {
    if (!state || !state.dropdown) return;
    const items = state.dropdown.querySelectorAll('.autocomplete-item');
    items.forEach((item, index) => {
        const isActive = index === state.selectedIndex;
        item.classList.toggle('active', isActive);
        if (isActive) {
            item.scrollIntoView({ block: 'nearest' });
        }
    });
}

function applyTaskTagSuggestion(input, selectedTag) {
    if (!input || !selectedTag) return;
    const context = buildTaskTagAutocompleteContext(input);
    const isBulkTagInput = input.id === 'bulk-tag-input';
    const appendCommaForMultiTag = !isBulkTagInput && !context.valueSuffix;
    const nextValue = appendCommaForMultiTag
        ? `${context.valuePrefix}${selectedTag}, `
        : `${context.valuePrefix}${selectedTag}${context.valueSuffix}`;
    const caretPos = appendCommaForMultiTag
        ? nextValue.length
        : (context.valuePrefix + selectedTag).length;
    input.value = nextValue;
    input.focus();
    input.setSelectionRange(caretPos, caretPos);
    hideTaskTagDropdown(input);
}

function renderTaskTagSuggestions(input) {
    if (!input) return;
    taskTagAutocompleteMap.forEach((_state, otherInput) => {
        if (otherInput !== input) hideTaskTagDropdown(otherInput);
    });
    const state = getTaskTagAutocompleteState(input);
    if (!state) return;

    const { query } = buildTaskTagAutocompleteContext(input);
    if (!query) {
        hideTaskTagDropdown(input);
        return;
    }

    const matches = collectTaskTagAutocompleteSource()
        .filter((tag) => tag.toLowerCase().startsWith(query));

    if (!matches.length) {
        hideTaskTagDropdown(input);
        return;
    }

    state.matches = matches;
    state.selectedIndex = 0;
    state.dropdown.innerHTML = '';
    matches.forEach((tag, index) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.setAttribute('role', 'option');
        if (index === 0) item.classList.add('active');
        item.textContent = tag;
        item.addEventListener('mouseenter', () => {
            state.selectedIndex = index;
            updateTaskTagActiveOption(state);
        });
        item.addEventListener('click', () => applyTaskTagSuggestion(input, tag));
        state.dropdown.appendChild(item);
    });
    state.dropdown.classList.add('show');
    positionTaskTagDropdown(input, state.dropdown);
}

function repositionVisibleTaskTagDropdowns() {
    taskTagAutocompleteMap.forEach((state, input) => {
        if (!state.dropdown.classList.contains('show')) return;
        positionTaskTagDropdown(input, state.dropdown);
    });
}

function bindTaskTagAutocompleteGlobals() {
    if (taskTagAutocompleteGlobalHandlersBound) return;
    taskTagAutocompleteGlobalHandlersBound = true;

    document.addEventListener('click', (event) => {
        taskTagAutocompleteMap.forEach((state, input) => {
            if (input.contains(event.target) || state.dropdown.contains(event.target)) return;
            hideTaskTagDropdown(input);
        });
    });

    window.addEventListener('resize', repositionVisibleTaskTagDropdowns, { passive: true });
    window.addEventListener('scroll', () => {
        if (taskTagAutocompleteRepositionRaf) return;
        taskTagAutocompleteRepositionRaf = window.requestAnimationFrame(() => {
            taskTagAutocompleteRepositionRaf = 0;
            repositionVisibleTaskTagDropdowns();
        });
    }, true);
}

function bindTaskTagAutocompleteInput(input) {
    if (!input || input.dataset.tagAutocompleteBound === '1') return;
    input.dataset.tagAutocompleteBound = '1';

    getTaskTagAutocompleteState(input);
    input.addEventListener('focus', () => renderTaskTagSuggestions(input));
    input.addEventListener('click', () => renderTaskTagSuggestions(input));
    input.addEventListener('input', () => renderTaskTagSuggestions(input));
    input.addEventListener('blur', () => {
        window.setTimeout(() => hideTaskTagDropdown(input), 120);
    });
    input.addEventListener('keydown', (event) => {
        const state = taskTagAutocompleteMap.get(input);
        if (!state || !state.dropdown.classList.contains('show')) return;
        if (!state.matches.length) return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            state.selectedIndex = (state.selectedIndex + 1) % state.matches.length;
            updateTaskTagActiveOption(state);
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            state.selectedIndex = (state.selectedIndex - 1 + state.matches.length) % state.matches.length;
            updateTaskTagActiveOption(state);
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            const selected = state.matches[state.selectedIndex] || state.matches[0];
            applyTaskTagSuggestion(input, selected);
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            hideTaskTagDropdown(input);
        }
    });
}

function initTaskTagAutocomplete() {
    const hasTagInput = document.getElementById('item-tags') ||
        document.getElementById('edit-item-tags') ||
        document.getElementById('bulk-tag-input');
    if (!hasTagInput) return;
    bindTaskTagAutocompleteGlobals();
    bindTaskTagAutocompleteInput(document.getElementById('item-tags'));
    bindTaskTagAutocompleteInput(document.getElementById('edit-item-tags'));
    bindTaskTagAutocompleteInput(document.getElementById('bulk-tag-input'));
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
    saveTaskFilterState();
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
    saveTaskFilterState();
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

function setCoreAriaExpandedForControls(controlledId, expanded) {
    if (!controlledId) return;
    document.querySelectorAll(`[aria-controls="${controlledId}"]`).forEach((control) => {
        control.setAttribute('aria-expanded', expanded ? 'true' : 'false');
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
        setCoreAriaExpandedForControls('task-filter-submenu-status', !!statusMenu.classList.contains('show'));
        setCoreAriaExpandedForControls('task-filter-submenu-tags', false);
    } else if (kind === 'tags') {
        if (!tagsMenu) return;
        tagsMenu.classList.toggle('show', !openTags);
        statusMenu.classList.remove('show');
        setCoreAriaExpandedForControls('task-filter-submenu-status', false);
        setCoreAriaExpandedForControls('task-filter-submenu-tags', !!tagsMenu.classList.contains('show'));
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
    saveTaskFilterState();
}

function toggleTaskFilterMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('task-filter-menu');
    if (!menu) return;
    const shouldShow = !menu.classList.contains('show');
    menu.classList.toggle('show', shouldShow);
    setCoreAriaExpandedForControls('task-filter-menu', shouldShow);
    if (!shouldShow) {
        const statusMenu = document.getElementById('task-filter-submenu-status');
        if (statusMenu) statusMenu.classList.remove('show');
        const tagsMenu = document.getElementById('task-filter-submenu-tags');
        if (tagsMenu) tagsMenu.classList.remove('show');
        setCoreAriaExpandedForControls('task-filter-submenu-status', false);
        setCoreAriaExpandedForControls('task-filter-submenu-tags', false);
    }
}

function closeTaskFilterMenu() {
    const menu = document.getElementById('task-filter-menu');
    if (menu) menu.classList.remove('show');
    const statusMenu = document.getElementById('task-filter-submenu-status');
    if (statusMenu) statusMenu.classList.remove('show');
    const tagsMenu = document.getElementById('task-filter-submenu-tags');
    if (tagsMenu) tagsMenu.classList.remove('show');
    setCoreAriaExpandedForControls('task-filter-menu', false);
    setCoreAriaExpandedForControls('task-filter-submenu-status', false);
    setCoreAriaExpandedForControls('task-filter-submenu-tags', false);
}

// Toggle task actions dropdown
function toggleTaskActionsMenu(itemId, event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById(`task-actions-menu-${itemId}`);
    const taskItem = document.getElementById(`item-${itemId}`);

    // Close all other menus and remove menu-open class from all task items
    document.querySelectorAll('.task-actions-menu').forEach(el => {
        if (el !== menu) {
            el.classList.remove('active');
            if (el.id) setCoreAriaExpandedForControls(el.id, false);
        }
    });
    document.querySelectorAll('.task-item.menu-open').forEach(el => {
        if (el !== taskItem) el.classList.remove('menu-open');
    });

    if (menu) {
        const shouldOpen = !menu.classList.contains('active');
        menu.classList.toggle('active', shouldOpen);
        if (menu.id) setCoreAriaExpandedForControls(menu.id, shouldOpen);
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
            if (el.id) setCoreAriaExpandedForControls(el.id, false);
        });
        document.querySelectorAll('.task-item.menu-open').forEach(el => {
            el.classList.remove('menu-open');
        });
    }
});

// --- Modal Functions ---

function openCreateModal() {
    if (createModal) createModal.classList.add('active');
}

function closeCreateModal() {
    if (!createModal) return;
    createModal.classList.remove('active');
    const titleInput = document.getElementById('list-title');
    if (titleInput) titleInput.value = '';
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
    if (tagsInput) {
        tagsInput.value = '';
        hideTaskTagDropdown(tagsInput);
    }
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
    const shouldShow = !dropdown.classList.contains('show');
    dropdown.classList.toggle('show', shouldShow);
    setCoreAriaExpandedForControls('header-menu-dropdown', shouldShow);
    setCoreAriaExpandedForControls('header-add-dropdown', false);
}

function toggleHeaderAddMenu(event) {
    const dropdown = document.getElementById('header-add-dropdown');
    if (!dropdown) return;
    if (event) event.stopPropagation();
    const mainDropdown = document.getElementById('header-menu-dropdown');
    if (mainDropdown) mainDropdown.classList.remove('show');
    const shouldShow = !dropdown.classList.contains('show');
    dropdown.classList.toggle('show', shouldShow);
    setCoreAriaExpandedForControls('header-add-dropdown', shouldShow);
    setCoreAriaExpandedForControls('header-menu-dropdown', false);
}

function toggleNoteAddMenu(event, dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    if (event) event.stopPropagation();
    document.querySelectorAll('.header-add-dropdown').forEach(el => {
        if (el !== dropdown) {
            el.classList.remove('show');
            if (el.id) setCoreAriaExpandedForControls(el.id, false);
        }
    });
    const shouldShow = !dropdown.classList.contains('show');
    dropdown.classList.toggle('show', shouldShow);
    if (dropdown.id) setCoreAriaExpandedForControls(dropdown.id, shouldShow);
}

// Close header menu when clicking outside
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('header-menu-dropdown');
    if (dropdown && dropdown.classList.contains('show')) {
        if (!e.target.closest('.header-main-menu')) {
            dropdown.classList.remove('show');
            setCoreAriaExpandedForControls('header-menu-dropdown', false);
        }
    }
    const addDropdown = document.getElementById('header-add-dropdown');
    if (addDropdown && addDropdown.classList.contains('show')) {
        if (!e.target.closest('.header-add-menu')) {
            addDropdown.classList.remove('show');
            setCoreAriaExpandedForControls('header-add-dropdown', false);
        }
    }
    document.querySelectorAll('.header-add-dropdown').forEach(dropdown => {
        if (dropdown.classList.contains('show') && !e.target.closest('.header-add-menu')) {
            dropdown.classList.remove('show');
            if (dropdown.id) setCoreAriaExpandedForControls(dropdown.id, false);
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
            showToast(err.error || 'Unable to import outline.', 'error');
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
        showToast('Please select a destination.', 'warning');
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
            showToast(err.error || 'Could not move item.', 'error');
        }
    } catch (e) {
        console.error('Error moving item:', e);
        showToast('An unexpected error occurred.', 'error');
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
    if (tagsInput) {
        tagsInput.value = '';
        hideTaskTagDropdown(tagsInput);
    }
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
async function saveItemChanges() {
    const itemId = document.getElementById('edit-item-id').value;
    const content = document.getElementById('edit-item-content').value.trim();
    const description = document.getElementById('edit-item-description').value.trim();
    const notes = document.getElementById('edit-item-notes').value.trim();
    const tagsInput = document.getElementById('edit-item-tags');
    const tags = tagsInput ? tagsInput.value.trim() : '';

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

function autoInitTasksDashboard() {
    if (!document.getElementById('hubs-grid') || !document.getElementById('lists-grid')) return;
    loadDashboard();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInitTasksDashboard);
} else {
    autoInitTasksDashboard();
}


