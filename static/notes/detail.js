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

function getNotePlannerContext() {
    const params = new URLSearchParams(window.location.search);
    const rawItem = params.get('planner_item_id') || params.get('planner_multi_item_id');
    const rawLine = params.get('planner_line_id') || params.get('planner_multi_line_id');
    const parsedItem = rawItem ? parseInt(rawItem, 10) : null;
    const parsedLine = rawLine ? parseInt(rawLine, 10) : null;
    const itemId = Number.isFinite(parsedItem) ? parsedItem : null;
    const lineId = Number.isFinite(parsedLine) ? parsedLine : null;
    const listedRaw = params.get('is_listed');
    const isListed = listedRaw === null ? null : ['1', 'true', 'yes', 'on'].includes(String(listedRaw).toLowerCase());
    return {
        itemId,
        lineId,
        isListed
    };
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
    const plannerContext = getNotePlannerContext();
    notesState.activePlannerContext = plannerContext;
    if (editor) editor.innerHTML = '';
    if (titleInput) titleInput.value = '';
    if (titleInput) titleInput.placeholder = 'Untitled note';
    if (updatedLabel) updatedLabel.textContent = 'New note';
    notesState.notes = [];
    notesState.activeNoteId = null;
    notesState.activeSnapshot = { title: '', content: '' };
    notesState.sessionSnapshot = { title: '', content: '' };
    notesState.activeFolderId = folderId;
    notesState.checkboxMode = false;
    notesState.activeNoteIsArchived = false;
    if (plannerContext && (plannerContext.itemId || plannerContext.lineId)) {
        notesState.activeNoteIsListed = plannerContext.isListed !== null ? plannerContext.isListed : false;
    } else {
        notesState.activeNoteIsListed = plannerContext && plannerContext.isListed !== null ? plannerContext.isListed : true;
    }
    setNoteDirty(false);
    hideNoteCleanupActions();
    updateNoteToolbarStates();
    updateArchiveButton(false);
    updateNoteVisibilityButton(notesState.activeNoteIsListed);
    setNoteVisibilityButtonEnabled(!!(plannerContext && (plannerContext.itemId || plannerContext.lineId)));
    setNoteEditorReadOnly(false);
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
        listEl.innerHTML = '<div class="empty-state"><p class="u-text-muted u-m-0">No folders yet.</p></div>';
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
                <button class="btn-icon" type="button" title="Rename folder" aria-label="Rename folder"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-icon delete" type="button" title="Delete folder" aria-label="Delete folder"><i class="fa-solid fa-trash"></i></button>
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
        showToast('List title required', 'warning');
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
        showToast('Could not create list', 'error');
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
        showToast('Folder name required', 'warning');
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

function openNoteMoveModal(noteId = null, itemType = 'note') {
    const modal = document.getElementById('note-move-modal');
    if (!modal) return;
    let ids = [];
    if (noteId) {
        ids = [noteId];
    } else if (itemType === 'note' && selectedNotes.size > 0) {
        ids = Array.from(selectedNotes);
    } else {
        return;
    }
    noteMoveState.ids = ids;
    noteMoveState.destinationFolderId = null;
    noteMoveState.navStack = [];
    noteMoveState.itemType = itemType === 'folder' ? 'folder' : 'note';
    const title = document.getElementById('note-move-title');
    if (title) {
        if (noteMoveState.itemType === 'folder') {
            title.textContent = 'Move Folder';
        } else {
            title.textContent = ids.length > 1 ? `Move ${ids.length} notes` : 'Move Note';
        }
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
    noteMoveState.itemType = 'note';
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
    const isFolderMove = noteMoveState.itemType === 'folder';
    panel.innerHTML = `
        <div class="move-heading"><i class="fa-solid fa-folder-tree" style="margin-right: 0.5rem;"></i>Choose destination</div>
    `;
    const mainBtn = document.createElement('button');
    mainBtn.className = 'btn';
    mainBtn.innerHTML = isFolderMove
        ? '<i class="fa-solid fa-house" style="margin-right: 0.5rem;"></i>Move to top level'
        : '<i class="fa-solid fa-house" style="margin-right: 0.5rem;"></i>Move to main notes';
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
        .filter(f => isFolderMoveTargetAllowed(f.id))
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

function isFolderMoveTargetAllowed(targetFolderId) {
    if (noteMoveState.itemType !== 'folder') return true;
    if (!noteMoveState.ids.length) return true;
    const movingId = noteMoveState.ids[0];
    if (movingId === targetFolderId) return false;
    return !isDescendantFolder(targetFolderId, movingId);
}

function isDescendantFolder(folderId, ancestorId) {
    const folderMap = new Map((noteFolderState.folders || []).map(f => [f.id, f]));
    let current = folderId;
    while (current) {
        const folder = folderMap.get(current);
        if (!folder) return false;
        if (folder.parent_id === ancestorId) return true;
        current = folder.parent_id || null;
    }
    return false;
}

async function performNoteMove(folderId) {
    try {
        const endpoint = noteMoveState.itemType === 'folder' ? '/api/note-folders/move' : '/api/notes/move';
        const payload = noteMoveState.itemType === 'folder'
            ? { ids: noteMoveState.ids, parent_id: folderId }
            : { ids: noteMoveState.ids, folder_id: folderId };
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Move failed');
        closeNoteMoveModal();
        resetNoteSelection();
        showToast('Moved', 'success', 2000);
        await loadNotesUnified();
    } catch (err) {
        console.error('Error moving notes:', err);
        showToast('Could not move', 'error');
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

    if (notesState.activeNoteIsArchived) {
        checkbox.checked = !checkbox.checked;
        showReadOnlyToast();
    }

    if (label) {
        if (checkbox.checked) {
            label.style.textDecoration = 'line-through';
            label.style.opacity = '0.6';
        } else {
            label.style.textDecoration = 'none';
            label.style.opacity = '1';
        }
    }

    if (notesState.activeNoteIsArchived) {
        return;
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
    if (notesState.activeNoteIsArchived) {
        e.preventDefault();
        showReadOnlyToast();
        return;
    }

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
    const cancelBtn = document.getElementById('note-cancel-btn');
    if (saveBtn) {
        saveBtn.disabled = false;
    }
    if (cancelBtn) {
        cancelBtn.disabled = notesState.activeNoteIsArchived || !hasNoteSessionChanges();
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

function getCurrentNoteEditorSnapshot() {
    const editor = document.getElementById('note-editor');
    const titleInput = document.getElementById('note-title');
    return {
        title: titleInput ? (titleInput.value || '').trim() : '',
        content: editor ? (editor.innerHTML || '').trim() : ''
    };
}

function getNoteSessionSnapshot() {
    return notesState.sessionSnapshot || notesState.activeSnapshot || { title: '', content: '' };
}

function hasNoteSessionChanges() {
    const current = getCurrentNoteEditorSnapshot();
    const session = getNoteSessionSnapshot();
    return current.title !== (session.title || '') || current.content !== (session.content || '');
}

async function cancelCurrentNoteChanges() {
    if (!hasNoteSessionChanges()) return;
    if (notesState.activeNoteIsArchived) {
        showReadOnlyToast();
        return;
    }
    const editor = document.getElementById('note-editor');
    const titleInput = document.getElementById('note-title');
    if (!editor || !titleInput) return;
    const snapshot = getNoteSessionSnapshot();
    editor.innerHTML = snapshot.content || '';
    titleInput.value = snapshot.title || '';
    titleInput.placeholder = 'Untitled note';
    bindNoteCheckboxes();
    updateNoteToolbarStates();
    hideNoteCleanupActions();
    autoGenerateTitle();
    refreshNoteDirtyState();
    if (notesState.dirty && notesState.activeNoteId) {
        await saveCurrentNote({ silent: true, keepOpen: true });
    } else {
        setNoteDirty(false);
    }
    showToast('Restored to session start.', 'success', 1800);
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
            listPinned.innerHTML = `<div class="empty-state"><p class="u-text-muted u-m-0">No pinned notes.</p></div>`;
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
                            <button class="btn-icon move-btn" type="button" title="Move note" aria-label="Move note">
                                <i class="fa-solid fa-folder-open"></i>
                            </button>
                            <button class="btn-icon pin-btn active" type="button" title="Unpin" aria-label="Unpin note">
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
                    <button class="btn-icon move-btn" type="button" title="Move note" aria-label="Move note">
                        <i class="fa-solid fa-folder-open"></i>
                    </button>
                    <button class="btn-icon pin-btn ${note.pinned ? 'active' : ''}" type="button" title="${note.pinned ? 'Unpin' : 'Pin'}" aria-label="${note.pinned ? 'Unpin note' : 'Pin note'}">
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
    return date.toLocaleString('en-US', {
        timeZone: USER_TIMEZONE,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
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
    const markdown = window.NoteMarkdown;
    const renderedContent = markdown && typeof markdown.renderNoteContentForEditor === 'function'
        ? markdown.renderNoteContentForEditor(note.content || '')
        : (note.content || '');
    editor.innerHTML = renderedContent;
    updatedLabel.textContent = `Updated ${formatNoteDate(note.updated_at)}`;
    notesState.activeSnapshot = {
        title: (note.title || '').trim(),
        content: (renderedContent || '').trim()
    };
    notesState.sessionSnapshot = {
        title: (note.title || '').trim(),
        content: (renderedContent || '').trim()
    };
    notesState.activeFolderId = note.folder_id || null;
    notesState.checkboxMode = false; // Reset checkbox mode when switching notes
    notesState.activeNoteIsArchived = !!note.is_archived;
    notesState.activeNoteIsListed = !!note.is_listed;
    setNoteDirty(false);
    hideNoteCleanupActions();
    renderNotesList();
    updateNoteToolbarStates(); // Update toolbar button states
    bindNoteCheckboxes(); // Bind checkbox event handlers
    updateProtectButton(note.is_pin_protected); // Update protect button state
    updateArchiveButton(!!note.is_archived);
    updateNoteVisibilityButton(!!note.is_listed);
    setNoteVisibilityButtonEnabled(shouldAllowNoteVisibilityToggle(note));
    setNoteEditorReadOnly(!!note.is_archived);
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

function showNoteCleanupActions() {
    const actions = document.getElementById('note-cleanup-actions');
    if (actions) actions.classList.add('visible');
}

function hideNoteCleanupActions() {
    const actions = document.getElementById('note-cleanup-actions');
    if (actions) actions.classList.remove('visible');
    noteCleanupState.originalHtml = null;
}

function acceptNoteCleanup() {
    hideNoteCleanupActions();
}

function restoreNoteCleanup() {
    const editor = document.getElementById('note-editor');
    if (!editor) return;
    if (noteCleanupState.originalHtml == null) {
        hideNoteCleanupActions();
        return;
    }
    editor.innerHTML = noteCleanupState.originalHtml;
    setNoteDirty(true);
    bindNoteCheckboxes();
    updateNoteToolbarStates();
    hideNoteCleanupActions();
}

async function cleanupCurrentNote() {
    if (noteCleanupInFlight) return;
    const editor = document.getElementById('note-editor');
    const titleInput = document.getElementById('note-title');
    const cleanupBtn = document.getElementById('note-cleanup-btn');
    const updatedLabel = document.getElementById('note-updated-label');
    if (!editor) return;

    const content = (editor.innerHTML || '').trim();
    if (!content) {
        showToast('Note is empty', 'warning', 2500);
        return;
    }

    hideNoteCleanupActions();
    noteCleanupState.originalHtml = content;
    noteCleanupInFlight = true;
    let cleanupApplied = false;
    const originalLabel = cleanupBtn ? cleanupBtn.innerHTML : '';
    const originalUpdatedLabel = updatedLabel ? updatedLabel.innerHTML : '';
    if (cleanupBtn) {
        cleanupBtn.disabled = true;
        cleanupBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Cleaning...';
    }
    if (updatedLabel) {
        updatedLabel.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Cleaning...';
    }

    try {
        const res = await fetch('/api/notes/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: titleInput ? titleInput.value.trim() : '',
                content
            })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showToast(data.error || 'Cleanup failed', 'error', 3000);
            return;
        }
        if (data.html) {
            editor.innerHTML = data.html;
            setNoteDirty(true);
            bindNoteCheckboxes();
            updateNoteToolbarStates();
            cleanupApplied = true;
            showNoteCleanupActions();
        }
    } catch (e) {
        console.error('Error cleaning note:', e);
        showToast('Cleanup failed', 'error', 3000);
    } finally {
        noteCleanupInFlight = false;
        if (!cleanupApplied) {
            noteCleanupState.originalHtml = null;
            hideNoteCleanupActions();
        }
        if (cleanupBtn) {
            cleanupBtn.disabled = false;
            cleanupBtn.innerHTML = originalLabel;
        }
        if (updatedLabel) {
            updatedLabel.innerHTML = originalUpdatedLabel;
        }
    }
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
    if (noteId && notesState.activeNoteIsArchived) {
        showReadOnlyToast();
        if (closeAfter || noteExitInProgress) {
            window.location.href = getNoteReturnUrl();
        }
        return;
    }
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

    const markdown = window.NoteMarkdown;
    const currentContent = (editor.innerHTML || '').trim();
    const normalizedContent = markdown && typeof markdown.normalizeNoteEditorHtml === 'function'
        ? markdown.normalizeNoteEditorHtml(currentContent)
        : currentContent;
    const contentForSave = normalizedContent || currentContent;

    if (contentForSave && contentForSave !== currentContent && !silent && !keepalive) {
        editor.innerHTML = contentForSave;
        bindNoteCheckboxes();
        updateNoteToolbarStates();
    }

    const payload = {
        title: title,
        content: contentForSave,
        folder_id: notesState.activeFolderId
    };
    const plannerContext = notesState.activePlannerContext || getNotePlannerContext();
    if (!noteId) {
        if (plannerContext && plannerContext.itemId) {
            payload.planner_multi_item_id = plannerContext.itemId;
        }
        if (plannerContext && plannerContext.lineId) {
            payload.planner_multi_line_id = plannerContext.lineId;
        }
        payload.is_listed = !!notesState.activeNoteIsListed;
    }

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
            notesState.activeNoteIsListed = !!savedNote.is_listed;
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
            notesState.activeNoteIsListed = !!savedNote.is_listed;
        }

        if (updatedLabel) updatedLabel.textContent = `Saved ${formatNoteDate(savedNote.updated_at)}`;
        setNoteDirty(false);
        renderNotesList();
        setNoteVisibilityButtonEnabled(shouldAllowNoteVisibilityToggle(savedNote));
        updateNoteVisibilityButton(!!savedNote.is_listed);

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
        notesState.activeNoteIsListed = !!newNote.is_listed;
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
    notesState.sessionSnapshot = null;
    notesState.activeFolderId = null;
    notesState.checkboxMode = false; // Reset checkbox mode
    setNoteDirty(false);
    hideNoteCleanupActions();
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
        showToast('Please select a note to share', 'warning');
        return;
    }

    const note = notesState.notes.find(n => n.id === noteId);
    if (!note) return;

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

    // Use universal share function if available
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
                showToast('Copied for sharing (browser limitation)', 'info', 2400);
            } else if (result.method === 'download') {
                showToast('Note file downloaded for sharing', 'success', 2400);
            }
            return;
        }
    }

    showToast('Sharing is unavailable on this device/browser', 'error', 2600);
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

            const shareText = typeof window.noteHtmlToShareText === 'function'
                ? window.noteHtmlToShareText(note.content || '')
                : (() => {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = note.content || '';
                    return tempDiv.textContent || tempDiv.innerText || '';
                })();
            const textToCopy = `${note.title || 'Untitled Note'}\n\n${shareText}`;

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
                showToast('Failed to copy to clipboard', 'error');
            }
        };
    }

    // Share via email
    if (emailBtn) {
        emailBtn.onclick = () => {
            const note = notesState.notes.find(n => n.id === notesState.activeNoteId);
            if (!note) return;

            const plainText = typeof window.noteHtmlToShareText === 'function'
                ? window.noteHtmlToShareText(note.content || '')
                : (() => {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = note.content || '';
                    return tempDiv.textContent || tempDiv.innerText || '';
                })();

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
            const confirmFn = typeof openConfirmModal === 'function' ? openConfirmModal : null;
            if (confirmFn) {
                confirmFn('Are you sure you want to revoke access to this shared note?', revokeShareLink);
            } else {
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
        showToast('Failed to generate share link. Please try again.', 'error');
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
        showToast('Failed to revoke share link. Please try again.', 'error');
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
