// --- Notes Functions ---

function getNoteDisplayTitle(note) {
    if (!note) return 'Untitled';
    const title = (note.title || '').trim();
    if (title) return title;
    if (note.note_type === 'list') return 'Untitled List';
    return 'Untitled Note';
}

function initNotesPage() {
    const editor = document.getElementById('note-editor');
    const unifiedListEl = document.getElementById('notes-unified-list');
    const listEditor = document.getElementById('list-editor-page');
    if (!editor && !unifiedListEl && !listEditor) return;
    if (document.body && document.body.dataset.notesPageInit === '1') return;
    if (document.body) document.body.dataset.notesPageInit = '1';

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

    // Initialize bulk action buttons
    const selectAll = document.getElementById('notes-select-all');
    const bulkClear = document.getElementById('notes-bulk-clear');
    const bulkPin = document.getElementById('notes-bulk-pin');
    const bulkMove = document.getElementById('notes-bulk-move');
    const bulkDelete = document.getElementById('notes-bulk-delete');

    if (selectAll) {
        selectAll.addEventListener('change', (e) => toggleNotesSelectAll(e.target));
    }
    if (bulkClear) {
        bulkClear.addEventListener('click', resetNoteSelection);
    }
    if (bulkPin) {
        bulkPin.addEventListener('click', async () => {
            // Check if any selected notes are unpinned - if so, pin all. Otherwise unpin all.
            const anyUnpinned = notesState.notes.some(note =>
                selectedNotes.has(note.id) && !note.pinned
            );
            if (anyUnpinned) {
                await bulkPinNotes();
            } else {
                await bulkUnpinNotes();
            }
        });
    }
    if (bulkMove) {
        bulkMove.addEventListener('click', () => {
            if (selectedNotes.size > 0) {
                openNoteMoveModal(null, 'note');
            }
        });
    }
    if (bulkDelete) {
        bulkDelete.addEventListener('click', bulkDeleteNotes);
    }

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
        const archivedQuery = query ? `${query}&archived=1` : '?archived=1';
        const [notesRes, foldersRes, archivedNotesRes, archivedFoldersRes] = await Promise.all([
            fetch(`/api/notes${query}`),
            fetch('/api/note-folders'),
            fetch(`/api/notes${archivedQuery}`),
            fetch('/api/note-folders?archived=1')
        ]);
        if (
            notesRes.status === 401 ||
            foldersRes.status === 401 ||
            archivedNotesRes.status === 401 ||
            archivedFoldersRes.status === 401
        ) {
            window.location.href = '/select-user';
            return;
        }

        if (!notesRes.ok || !foldersRes.ok || !archivedNotesRes.ok || !archivedFoldersRes.ok) {
            throw new Error('Failed to load');
        }

        const notes = await notesRes.json();
        const folders = await foldersRes.json();
        const archivedNotes = await archivedNotesRes.json();
        const archivedFolders = await archivedFoldersRes.json();

        notesState.notes = notes;
        notesState.archivedNotes = archivedNotes || [];
        noteFolderState.folders = folders;
        noteFolderState.archivedFolders = archivedFolders || [];

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

function organizePhaseBlockedTasks() {
    const container = document.getElementById('items-container');
    if (!container) return;

    document.querySelectorAll('.phase-blocked-container').forEach(box => {
        while (box.firstChild) {
            container.insertBefore(box.firstChild, box);
        }
        box.remove();
    });
    document.querySelectorAll('.phase-blocked-bar').forEach(bar => bar.remove());

    const phases = Array.from(container.querySelectorAll('.task-item.phase'));
    phases.forEach(phaseEl => {
        const phaseIdStr = String(phaseEl.dataset.phaseId || '');
        if (!phaseIdStr) return;

        const blockedTasks = [];
        let cursor = phaseEl.nextElementSibling;
        while (cursor && !cursor.classList.contains('phase')) {
            if (cursor.classList.contains('task-item')) {
                const belongs = cursor.dataset.phaseParent === phaseIdStr
                    || (!cursor.dataset.phaseParent && cursor.classList.contains('under-phase'));
                if (belongs && cursor.dataset.blocked === 'true') {
                    blockedTasks.push(cursor);
                }
            }
            cursor = cursor.nextElementSibling;
        }

        if (!blockedTasks.length) return;

        const doneAnchor = container.querySelector(`.phase-done-bar[data-phase-id="${phaseIdStr}"]`);
        const anchor = doneAnchor || cursor || null;

        const bar = document.createElement('div');
        bar.className = 'phase-blocked-bar';
        bar.setAttribute('data-phase-id', phaseIdStr);

        const label = document.createElement('span');
        label.className = 'phase-blocked-label';
        label.textContent = `Blocked tasks (${blockedTasks.length})`;

        const blockedBox = document.createElement('div');
        blockedBox.className = 'phase-blocked-container';
        blockedBox.setAttribute('data-phase-id', phaseIdStr);

        blockedTasks.forEach(task => blockedBox.appendChild(task));

        bar.appendChild(label);
        container.insertBefore(bar, anchor);
        container.insertBefore(blockedBox, anchor);
    });
}

function getSortedArchivedItems() {
    const currentFolderId = noteFolderState.currentFolderId;
    const notes = notesState.archivedNotes || [];
    const folders = noteFolderState.archivedFolders || [];

    const currentFolders = folders.filter(f =>
        (f.parent_id || null) === (currentFolderId || null)
    ).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    const archivedNotes = notes.filter(n => n.note_type === 'note')
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    const archivedLists = notes.filter(n => n.note_type === 'list')
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    return {
        notes: archivedNotes,
        lists: archivedLists,
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
    const archived = getSortedArchivedItems();

    listEl.innerHTML = '';

    const hasItems = sorted.pinned.length || sorted.notes.length ||
                     sorted.lists.length || sorted.folders.length ||
                     archived.notes.length || archived.lists.length || archived.folders.length;

    if (!hasItems) {
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    // Render pinned section
    if (sorted.pinned.length) {
        listEl.appendChild(createSectionHeader('Pinned'));
        sorted.pinned.forEach(note => {
            listEl.appendChild(createNoteItem(note, { isPinned: true }));
        });
    }

    // Render notes section
    if (sorted.notes.length) {
        listEl.appendChild(createSectionHeader('Notes'));
        sorted.notes.forEach(note => {
            listEl.appendChild(createNoteItem(note));
        });
    }

    // Render lists section
    if (sorted.lists.length) {
        listEl.appendChild(createSectionHeader('Lists'));
        sorted.lists.forEach(note => {
            listEl.appendChild(createNoteItem(note));
        });
    }

    // Render folders section
    if (sorted.folders.length) {
        listEl.appendChild(createSectionHeader('Folders'));
        sorted.folders.forEach(folder => {
            listEl.appendChild(createFolderItem(folder));
        });
    }

    listEl.appendChild(createArchivedSection(archived));

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

function createArchivedSection(archived) {
    const wrapper = document.createElement('div');
    const total = (archived.notes.length + archived.lists.length + archived.folders.length) || 0;
    wrapper.className = `notes-archived-section${noteFolderState.archivedOpen ? ' open' : ''}`;

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'notes-archived-toggle';
    header.setAttribute('aria-expanded', noteFolderState.archivedOpen ? 'true' : 'false');
    header.innerHTML = `
        <span class="notes-archived-title">Archived</span>
        <span class="notes-archived-count">${total}</span>
        <i class="fa-solid fa-chevron-down"></i>
    `;
    header.addEventListener('click', () => {
        noteFolderState.archivedOpen = !noteFolderState.archivedOpen;
        try {
            localStorage.setItem('notes_archived_open', noteFolderState.archivedOpen ? '1' : '0');
        } catch (e) {
            // no-op: storage unavailable
        }
        renderNotesUnified();
    });
    wrapper.appendChild(header);

    const body = document.createElement('div');
    body.className = 'notes-archived-body';
    if (!noteFolderState.archivedOpen) {
        body.style.display = 'none';
    }

    if (!total) {
        const empty = document.createElement('div');
        empty.className = 'notes-archived-empty';
        empty.textContent = 'No archived items.';
        body.appendChild(empty);
    } else {
        if (archived.notes.length) {
            body.appendChild(createSectionHeader('Notes'));
            archived.notes.forEach(note => {
                body.appendChild(createNoteItem(note, { isArchived: true }));
            });
        }
        if (archived.lists.length) {
            body.appendChild(createSectionHeader('Lists'));
            archived.lists.forEach(note => {
                body.appendChild(createNoteItem(note, { isArchived: true }));
            });
        }
        if (archived.folders.length) {
            body.appendChild(createSectionHeader('Folders'));
            archived.folders.forEach(folder => {
                body.appendChild(createFolderItem(folder, { isArchived: true }));
            });
        }
    }

    wrapper.appendChild(body);
    return wrapper;
}

function createNoteItem(note, options = {}) {
    const { isPinned = false, isArchived = false } = options;
    const item = document.createElement('div');
    const isProtected = note.is_pin_protected;
    const isLocked = note.locked;
    const isSelected = selectedNotes.has(note.id);
    item.className = 'notes-item' + (isPinned ? ' pinned-item' : '') + (isProtected ? ' protected' : '') + (isLocked ? ' locked' : '') + (isArchived ? ' archived' : '') + (isSelected ? ' selected' : '');
    item.dataset.itemId = note.id;
    item.dataset.noteId = note.id;
    item.dataset.itemType = 'note';
    item.dataset.protected = isProtected ? 'true' : 'false';
    item.dataset.locked = isLocked ? 'true' : 'false';
    item.dataset.archived = isArchived ? 'true' : 'false';
    if (isPinned) {
        item.draggable = true;
    }

    const iconClass = note.note_type === 'list' ? 'type-list' : 'type-note';
    const iconName = note.note_type === 'list' ? 'fa-list' : 'fa-note-sticky';
    const displayTitle = getNoteDisplayTitle(note);
    const pinLabel = isPinned ? 'Unpin' : 'Pin';
    const lockIcon = isProtected ? '<i class="notes-item-lock fa-solid fa-lock"></i>' : '';

    item.innerHTML = `
        <input type="checkbox" class="item-select-checkbox notes-item-checkbox" ${isSelected ? 'checked' : ''}>
        ${isArchived ? '' : `
        <div class="notes-item-swipe-layer swipe-right">
            <i class="fa-solid fa-thumbtack"></i>
            <span>${pinLabel}</span>
        </div>
        <div class="notes-item-swipe-layer swipe-left">
            <i class="fa-solid fa-trash"></i>
            <span>Delete</span>
        </div>`}
        <div class="notes-item-content">
            ${isPinned ? '<div class="notes-item-drag-handle"><i class="fa-solid fa-grip-vertical"></i></div>' : ''}
            <div class="notes-item-icon ${iconClass}">
                <i class="fa-solid ${iconName}"></i>
            </div>
            <span class="notes-item-title">${escapeHtml(displayTitle)}</span>
            ${lockIcon}
            ${isPinned ? '<i class="notes-item-pinned fa-solid fa-thumbtack"></i>' : ''}
            <div class="notes-item-dropdown">
                <button class="btn-icon" id="notes-note-menu-btn-${note.id}" type="button" data-note-id="${note.id}" data-pin-label="${pinLabel}" onclick="toggleNoteActionsMenu(${note.id}, event)" title="More actions" aria-label="More note actions" aria-haspopup="menu" aria-expanded="false">
                    <i class="fa-solid fa-ellipsis-vertical"></i>
                </button>
            </div>
        </div>
        <div class="notes-item-select-indicator"><i class="fa-solid fa-check"></i></div>
    `;

    // Add checkbox click handler for selection
    const checkbox = item.querySelector('.notes-item-checkbox');
    if (checkbox) {
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            setNoteSelected(note.id, e.target.checked);
            item.classList.toggle('selected', e.target.checked);
            updateNotesBulkBar();
        });
    }

    return item;
}

function createFolderItem(folder, options = {}) {
    const { isArchived = false } = options;
    const item = document.createElement('div');
    const isProtected = folder.is_pin_protected;
    item.className = 'notes-item' + (isProtected ? ' protected locked' : '') + (isArchived ? ' archived' : '');
    item.dataset.itemId = folder.id;
    item.dataset.itemType = 'folder';
    item.dataset.locked = isProtected ? 'true' : 'false';
    item.dataset.archived = isArchived ? 'true' : 'false';

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
                <button class="btn-icon" id="notes-folder-menu-btn-${folder.id}" type="button" data-folder-id="${folder.id}" data-folder-name="${escapeHtml(folder.name)}" onclick="toggleFolderActionsMenu(${folder.id}, event)" title="More actions" aria-label="More folder actions" aria-haspopup="menu" aria-expanded="false">
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

        const isArchived = item.dataset.archived === 'true';
        if (!isArchived) {
            content.addEventListener('touchstart', handleNoteSwipeStart, { passive: true });
            content.addEventListener('touchmove', handleNoteSwipeMove, { passive: false });
            content.addEventListener('touchend', handleNoteSwipeEnd, { passive: true });
        }

        // Click handler for navigation (non-swipe) or action buttons
        content.addEventListener('click', (e) => {
            if (noteSwipeState.isSwiping) return;

            const noteId = parseInt(item.dataset.itemId, 10);

            // Check if clicked on checkbox - let checkbox handler handle it
            if (e.target.closest('.notes-item-checkbox')) {
                return;
            }

            // Check if clicked on an action button
            const actionBtn = e.target.closest('.notes-item-actions .btn-icon') || e.target.closest('.notes-item-dropdown');
            if (actionBtn) {
                e.stopPropagation();
                const action = actionBtn.dataset ? actionBtn.dataset.action : undefined;
                if (action === 'pin') {
                    handleSwipePin(noteId);
                } else if (action === 'delete') {
                    handleSwipeDelete(noteId);
                }
                return;
            }

            // If in selection mode (has selected items), toggle selection
            if (selectedNotes.size > 0) {
                e.preventDefault();
                const nowSelected = !selectedNotes.has(noteId);
                setNoteSelected(noteId, nowSelected);
                item.classList.toggle('selected', nowSelected);
                const checkbox = item.querySelector('.notes-item-checkbox');
                if (checkbox) checkbox.checked = nowSelected;
                updateNotesBulkBar();
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
                const folder = getFolderById(folderId);
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
    if (item && item.dataset.archived === 'true') return;

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
    const note = getNoteById(noteId);
    if (!note) return;
    if (note.is_archived) {
        showToast('Restore the note to pin it.', 'info', 2000);
        return;
    }

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
    const note = getNoteById(noteId);
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
let activeNotesDropdownTrigger = null;

/**
 * Close any active notes dropdown menu
 */
function closeNotesDropdown() {
    if (activeNotesDropdown) {
        activeNotesDropdown.remove();
        activeNotesDropdown = null;
    }
    if (activeNotesDropdownTrigger) {
        activeNotesDropdownTrigger.setAttribute('aria-expanded', 'false');
        activeNotesDropdownTrigger.removeAttribute('aria-controls');
        activeNotesDropdownTrigger = null;
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

function getNoteById(noteId) {
    return (notesState.notes || []).find(n => n.id === noteId)
        || (notesState.archivedNotes || []).find(n => n.id === noteId);
}

function getFolderById(folderId) {
    return (noteFolderState.folders || []).find(f => f.id === folderId)
        || (noteFolderState.archivedFolders || []).find(f => f.id === folderId);
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
    const note = getNoteById(noteId);
    const pinLabel = note && note.pinned ? 'Unpin' : 'Pin';
    const isListNote = note && note.note_type === 'list';
    const isProtected = note && note.is_pin_protected;
    const isArchived = note && note.is_archived;
    const protectLabel = isProtected ? 'Unprotect' : 'Protect';
    const protectIcon = isProtected ? 'fa-lock-open' : 'fa-lock';
    const pinOption = isArchived ? '' : `
        <button class="notes-item-menu-option" data-action="pin">
            <i class="fa-solid fa-thumbtack"></i> ${pinLabel}
        </button>
    `;
    const convertOption = isListNote ? '' : `
        <button class="notes-item-menu-option" data-action="convert">
            <i class="fa-solid fa-list-check"></i> Convert to list
        </button>
    `;
    const archiveOption = isArchived ? `
        <button class="notes-item-menu-option" data-action="restore">
            <i class="fa-solid fa-rotate-left"></i> Restore
        </button>
    ` : `
        <button class="notes-item-menu-option" data-action="archive">
            <i class="fa-solid fa-box-archive"></i> Archive
        </button>
    `;

    // Create dropdown
    const dropdown = document.createElement('div');
    const dropdownId = `notes-item-menu-note-${noteId}`;
    dropdown.className = 'notes-item-menu active';
    dropdown.id = dropdownId;
    dropdown.setAttribute('role', 'menu');
    dropdown.dataset.noteId = noteId;
    dropdown.innerHTML = `
        ${pinOption}
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
        ${archiveOption}
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
            else if (action === 'archive') handleNoteMenuArchive(noteId);
            else if (action === 'restore') handleNoteMenuRestore(noteId);
            else if (action === 'delete') handleNoteMenuDelete(noteId);
        });
    });

    document.body.appendChild(dropdown);
    positionNotesDropdown(dropdown, button);
    activeNotesDropdown = dropdown;
    activeNotesDropdownTrigger = button;
    if (button) {
        button.setAttribute('aria-controls', dropdownId);
        button.setAttribute('aria-expanded', 'true');
    }
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
    const folder = getFolderById(folderId);
    const isProtected = folder && folder.is_pin_protected;
    const isArchived = folder && folder.is_archived;
    const protectLabel = isProtected ? 'Unprotect' : 'Protect';
    const protectIcon = isProtected ? 'fa-lock-open' : 'fa-lock';
    const archiveOption = isArchived ? `
        <button class="notes-item-menu-option" data-action="restore">
            <i class="fa-solid fa-rotate-left"></i> Restore
        </button>
    ` : `
        <button class="notes-item-menu-option" data-action="archive">
            <i class="fa-solid fa-box-archive"></i> Archive
        </button>
    `;

    // Create dropdown
    const dropdown = document.createElement('div');
    const dropdownId = `notes-item-menu-folder-${folderId}`;
    dropdown.className = 'notes-item-menu active';
    dropdown.id = dropdownId;
    dropdown.setAttribute('role', 'menu');
    dropdown.dataset.folderId = folderId;
    dropdown.innerHTML = `
        <button class="notes-item-menu-option" data-action="rename">
            <i class="fa-solid fa-pen"></i> Rename
        </button>
        <button class="notes-item-menu-option" data-action="move">
            <i class="fa-solid fa-folder-open"></i> Move
        </button>
        <button class="notes-item-menu-option" data-action="protect">
            <i class="fa-solid ${protectIcon}"></i> ${protectLabel}
        </button>
        ${archiveOption}
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
            else if (action === 'move') handleFolderMenuMove(folderId);
            else if (action === 'protect') handleFolderMenuProtect(folderId);
            else if (action === 'archive') handleFolderMenuArchive(folderId);
            else if (action === 'restore') handleFolderMenuRestore(folderId);
            else if (action === 'delete') handleFolderMenuDelete(folderId);
        });
    });

    document.body.appendChild(dropdown);
    positionNotesDropdown(dropdown, button);
    activeNotesDropdown = dropdown;
    activeNotesDropdownTrigger = button;
    if (button) {
        button.setAttribute('aria-controls', dropdownId);
        button.setAttribute('aria-expanded', 'true');
    }
}

// Close notes dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (activeNotesDropdown && !e.target.closest('.notes-item-dropdown')) {
        closeNotesDropdown();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeNotesDropdown) {
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

    const note = getNoteById(noteId);
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
    let note = getNoteById(noteId);
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
        const title = note.title || 'Untitled List';
        const shareText = typeof window.buildListShareTextForShare === 'function'
            ? window.buildListShareTextForShare(note.items || [], !!note.checkbox_mode)
            : '';
        const fileName = typeof window.buildShareTxtFileName === 'function'
            ? window.buildShareTxtFileName(title, 'shared-list')
            : 'shared-list.txt';
        const fileText = `${title}\n\n${shareText}`.trim();

        if (typeof window.universalShare === 'function') {
            const result = await window.universalShare({
                title,
                text: shareText,
                fileName,
                fileText,
                allowClipboardFallback: false,
                allowDownloadFallback: true,
                preferWebFileShare: true,
                requireFileShare: true
            });
            if (result.cancelled) return;
            if (result.success) {
                if (result.method === 'clipboard') {
                    showToast('List copied to clipboard', 'success', 2000);
                } else if (result.method === 'download') {
                    showToast('List file downloaded for sharing', 'success', 2200);
                }
                return;
            }
        }
        showToast('Could not share list on this device', 'error', 2200);
        return;
    }

    const title = note.title || 'Untitled Note';
    const shareText = typeof window.noteHtmlToShareText === 'function'
        ? window.noteHtmlToShareText(note.content || '')
        : (() => {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = note.content || '';
            return tempDiv.textContent || tempDiv.innerText || '';
        })();
    const fileName = typeof window.buildShareTxtFileName === 'function'
        ? window.buildShareTxtFileName(title, 'shared-note')
        : 'shared-note.txt';
    const fileText = `${title}\n\n${shareText}`.trim();

    // Use universal share function
    if (typeof window.universalShare === 'function') {
        const result = await window.universalShare({
            title,
            text: shareText,
            fileName,
            fileText,
            allowClipboardFallback: false,
            allowDownloadFallback: true,
            preferWebFileShare: true,
            requireFileShare: true
        });
        if (result.cancelled) return;
        if (result.success) {
            if (result.method === 'clipboard') {
                showToast('Note copied to clipboard', 'success', 2000);
            } else if (result.method === 'download') {
                showToast('Note file downloaded for sharing', 'success', 2200);
            }
            return;
        }
    }

    showToast('Could not share note on this device', 'error', 2200);
}

async function handleNoteMenuDuplicate(noteId) {
    const note = getNoteById(noteId);
    if (!note) return;
    if (note.is_pin_protected) {
        pinState.pendingNoteId = noteId;
        pinState.pendingAction = 'duplicate';
        openPinModal();
        return;
    }

    try {
        const res = await fetch(`/api/notes/${noteId}/duplicate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!res.ok) throw new Error('Failed to duplicate');

        showToast('Note duplicated', 'success', 2000);
        await loadNotesUnified();

    } catch (err) {
        console.error('Duplicate failed:', err);
        showToast('Failed to duplicate', 'error');
    }
}

async function handleNoteMenuArchive(noteId) {
    const note = getNoteById(noteId);
    if (!note || note.is_archived) return;
    if (note.is_pin_protected) {
        pinState.pendingNoteId = noteId;
        pinState.pendingAction = 'archive';
        openPinModal();
        return;
    }
    try {
        const res = await fetch(`/api/notes/${noteId}/archive`, { method: 'POST' });
        if (!res.ok) throw new Error('Archive failed');
        showToast('Archived', 'success', 2000);
        await loadNotesUnified();
    } catch (err) {
        console.error('Archive failed:', err);
        showToast('Failed to archive', 'error');
    }
}

async function handleNoteMenuRestore(noteId) {
    const note = getNoteById(noteId);
    if (!note || !note.is_archived) return;
    if (note.is_pin_protected) {
        pinState.pendingNoteId = noteId;
        pinState.pendingAction = 'restore';
        openPinModal();
        return;
    }
    try {
        const res = await fetch(`/api/notes/${noteId}/restore`, { method: 'POST' });
        if (!res.ok) throw new Error('Restore failed');
        showToast('Restored', 'success', 2000);
        await loadNotesUnified();
    } catch (err) {
        console.error('Restore failed:', err);
        showToast('Failed to restore', 'error');
    }
}

function handleNoteMenuDelete(noteId) {
    handleSwipeDelete(noteId);
}

async function handleNoteMenuConvert(noteId) {
    const note = getNoteById(noteId);
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
                    if (data && data.details) {
                        errorMessage = `${data.error}: ${data.details}`;
                    } else if (data && data.error) {
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

function handleFolderMenuMove(folderId) {
    openNoteMoveModal(folderId, 'folder');
}

async function handleFolderMenuDelete(folderId) {
    const folder = getFolderById(folderId);
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

    const folder = getFolderById(folderId);
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

async function handleFolderMenuArchive(folderId) {
    const folder = getFolderById(folderId);
    if (!folder || folder.is_archived) return;
    if (folder.is_pin_protected) {
        pinState.pendingFolderId = folderId;
        pinState.pendingNoteId = null;
        pinState.pendingAction = 'archive_folder';
        openPinModal();
        return;
    }
    try {
        const res = await fetch(`/api/note-folders/${folderId}/archive`, { method: 'POST' });
        if (!res.ok) throw new Error('Archive failed');
        showToast('Folder archived', 'success', 2000);
        await loadNotesUnified();
    } catch (err) {
        console.error('Archive failed:', err);
        showToast('Failed to archive folder', 'error');
    }
}

async function handleFolderMenuRestore(folderId) {
    const folder = getFolderById(folderId);
    if (!folder || !folder.is_archived) return;
    if (folder.is_pin_protected) {
        pinState.pendingFolderId = folderId;
        pinState.pendingNoteId = null;
        pinState.pendingAction = 'restore_folder';
        openPinModal();
        return;
    }
    try {
        const res = await fetch(`/api/note-folders/${folderId}/restore`, { method: 'POST' });
        if (!res.ok) throw new Error('Restore failed');
        showToast('Folder restored', 'success', 2000);
        await loadNotesUnified();
    } catch (err) {
        console.error('Restore failed:', err);
        showToast('Failed to restore folder', 'error');
    }
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


async function ensureNotesDetailLoaded() {
    const hasCoreHandlers =
        typeof window.handleNewNoteClick === 'function' &&
        typeof window.openNoteInEditor === 'function' &&
        typeof window.openListCreateModal === 'function';
    if (hasCoreHandlers) return;

    const existing = document.querySelector('script[data-notes-detail-loader="1"]');
    if (existing) {
        await new Promise((resolve, reject) => {
            existing.addEventListener('load', resolve, { once: true });
            existing.addEventListener('error', reject, { once: true });
        });
        return;
    }

    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/static/notes/detail.js';
        script.defer = true;
        script.dataset.notesDetailLoader = '1';
        script.addEventListener('load', resolve, { once: true });
        script.addEventListener('error', reject, { once: true });
        document.head.appendChild(script);
    });
}

async function bootNotesPage() {
    try {
        await ensureNotesDetailLoaded();
    } catch (e) {
        console.warn('Failed to load notes detail handlers:', e);
    }
    initNotesPage();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootNotesPage);
} else {
    bootNotesPage();
}

