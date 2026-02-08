function initNoteEditorPage() {
    const page = document.getElementById('note-editor-page');
    if (!page) return;
    if (page.dataset.noteEditorInit === '1') return;

    const editor = document.getElementById('note-editor');
    const titleInput = document.getElementById('note-title');
    if (!editor || !titleInput) return;
    page.dataset.noteEditorInit = '1';

    const saveBtn = document.getElementById('note-save-btn');
    const deleteBtn = document.getElementById('note-delete-btn');
    const shareBtn = document.getElementById('note-share-btn');
    const cleanupBtn = document.getElementById('note-cleanup-btn');
    const cleanupAcceptBtn = document.getElementById('note-cleanup-accept-btn');
    const cleanupRestoreBtn = document.getElementById('note-cleanup-restore-btn');
    const convertBtn = document.getElementById('note-convert-btn');
    const archiveBtn = document.getElementById('note-archive-btn');
    const backBtn = document.getElementById('note-back-btn');
    const notesBtn = document.getElementById('note-notes-btn');
    const actionsToggle = document.getElementById('note-actions-toggle');
    const actionsMenu = document.getElementById('note-actions-menu');
    const noteId = getNoteEditorNoteId();

    const protectBtn = document.getElementById('note-protect-btn');
    const visibilityBtn = document.getElementById('note-visibility-btn');

    if (saveBtn) saveBtn.addEventListener('click', () => saveCurrentNote({ closeAfter: true }));
    if (deleteBtn) deleteBtn.addEventListener('click', () => deleteCurrentNote());
    if (shareBtn) shareBtn.addEventListener('click', () => openShareNoteModal());
    if (cleanupBtn) cleanupBtn.addEventListener('click', () => cleanupCurrentNote());
    if (cleanupAcceptBtn) cleanupAcceptBtn.addEventListener('click', () => acceptNoteCleanup());
    if (cleanupRestoreBtn) cleanupRestoreBtn.addEventListener('click', () => restoreNoteCleanup());
    if (convertBtn) convertBtn.addEventListener('click', () => convertCurrentNoteToList());
    if (protectBtn) protectBtn.addEventListener('click', () => toggleNoteProtection());
    if (visibilityBtn) visibilityBtn.addEventListener('click', () => toggleNoteVisibility());
    if (archiveBtn) archiveBtn.addEventListener('click', () => toggleCurrentNoteArchive());
    if (backBtn) backBtn.addEventListener('click', () => handleNoteBack());
    if (notesBtn) notesBtn.addEventListener('click', () => handleNoteExit());

    // Check PIN status
    checkPinStatus();
    checkNotesPinStatus();
    setupNoteLinkModalControls();
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

    editor.addEventListener('input', (e) => {
        if (notesState.activeNoteIsArchived) {
            showReadOnlyToast();
            return;
        }
        tryConvertBracketLink(editor, e);
        tryConvertMarkdownLink(editor, e);
        refreshNoteDirtyState();
        autoGenerateTitle();
    });
    editor.addEventListener('click', (e) => {
        const link = e.target.closest('a.note-link');
        if (!link) return;
        if (Date.now() < suppressLinkClickUntil || linkLongPressTriggered) return;
        if (e.ctrlKey) {
            e.preventDefault();
            openEditNoteLinkModal(link);
            return;
        }
        e.preventDefault();
        handleNoteLinkClick(link);
    });
    editor.addEventListener('click', (e) => {
        const link = e.target.closest('a.external-link');
        if (!link) return;
        if (Date.now() < suppressLinkClickUntil || linkLongPressTriggered) return;
        if (e.ctrlKey) {
            e.preventDefault();
            openEditNoteLinkModal(link);
            return;
        }
        e.preventDefault();
        const href = link.getAttribute('href') || '';
        if (href) {
            window.open(href, '_blank', 'noopener,noreferrer');
        }
    });
    editor.addEventListener('touchstart', (e) => {
        const link = e.target.closest('a.note-link, a.external-link');
        if (!link) return;
        if (!e.touches || !e.touches.length) return;
        const touch = e.touches[0];
        linkLongPressStart = { x: touch.clientX, y: touch.clientY };
        linkLongPressTriggered = false;
        if (linkLongPressTimer) clearTimeout(linkLongPressTimer);
        linkLongPressTimer = setTimeout(() => {
            linkLongPressTimer = null;
            linkLongPressTriggered = true;
            suppressLinkClickUntil = Date.now() + 400;
            openEditNoteLinkModal(link);
        }, 450);
    }, { passive: true });
    editor.addEventListener('touchmove', (e) => {
        if (!linkLongPressTimer || !linkLongPressStart || !e.touches || !e.touches.length) return;
        const touch = e.touches[0];
        const dx = Math.abs(touch.clientX - linkLongPressStart.x);
        const dy = Math.abs(touch.clientY - linkLongPressStart.y);
        if (dx > 10 || dy > 10) {
            clearTimeout(linkLongPressTimer);
            linkLongPressTimer = null;
        }
    }, { passive: true });
    editor.addEventListener('touchend', () => {
        if (linkLongPressTimer) {
            clearTimeout(linkLongPressTimer);
            linkLongPressTimer = null;
        }
        if (linkLongPressTriggered) {
            linkLongPressTriggered = false;
        }
        linkLongPressStart = null;
    });
    editor.addEventListener('beforeinput', (e) => {
        if (!notesState.activeNoteIsArchived) return;
        e.preventDefault();
        showReadOnlyToast();
    });
    editor.addEventListener('paste', (e) => {
        if (!notesState.activeNoteIsArchived) return;
        e.preventDefault();
        showReadOnlyToast();
    });
    titleInput.addEventListener('input', () => {
        if (notesState.activeNoteIsArchived) {
            showReadOnlyToast();
            return;
        }
        refreshNoteDirtyState();
    });
    titleInput.addEventListener('keydown', (e) => {
        if (!notesState.activeNoteIsArchived) return;
        e.preventDefault();
        showReadOnlyToast();
    });

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
    setupNoteLinkModalControls();
    setupNoteExitAutosave();

    if (noteId) {
        loadNoteForEditor(noteId);
    } else {
        prepareNewNoteEditor();
    }
}

function setNoteEditorReadOnly(isReadOnly) {
    const editor = document.getElementById('note-editor');
    const titleInput = document.getElementById('note-title');
    const saveBtn = document.getElementById('note-save-btn');
    const cleanupBtn = document.getElementById('note-cleanup-btn');
    const convertBtn = document.getElementById('note-convert-btn');
    const toolbar = document.getElementById('note-toolbar');
    if (editor) editor.setAttribute('contenteditable', isReadOnly ? 'false' : 'true');
    if (titleInput) titleInput.disabled = isReadOnly;
    if (saveBtn) saveBtn.disabled = isReadOnly;
    if (cleanupBtn) cleanupBtn.disabled = isReadOnly;
    if (convertBtn) convertBtn.disabled = isReadOnly;
    if (toolbar) {
        toolbar.classList.toggle('disabled', isReadOnly);
        toolbar.querySelectorAll('button, select').forEach(el => {
            el.disabled = isReadOnly;
        });
    }

    setupEditNoteLinkModalControls();
    if (editor) {
        editor.classList.toggle('read-only', isReadOnly);
        editor.onpointerdown = isReadOnly ? (e) => {
            showReadOnlyToast();
            e.preventDefault();
        } : null;
    }
}

function updateNoteVisibilityButton(isListed) {
    const visibilityBtn = document.getElementById('note-visibility-btn');
    if (!visibilityBtn) return;
    const icon = visibilityBtn.querySelector('i');
    const label = visibilityBtn.querySelector('span');
    if (isListed) {
        if (icon) icon.className = 'fa-solid fa-eye-slash';
        if (label) label.textContent = 'Hide from notes list';
    } else {
        if (icon) icon.className = 'fa-solid fa-eye';
        if (label) label.textContent = 'Show in notes list';
    }
}

function setNoteVisibilityButtonEnabled(enabled) {
    const visibilityBtn = document.getElementById('note-visibility-btn');
    if (!visibilityBtn) return;
    visibilityBtn.style.display = enabled ? '' : 'none';
}

function shouldAllowNoteVisibilityToggle(note) {
    if (!note) return false;
    if (typeof note.is_linked_note === 'boolean') return note.is_linked_note;
    return !!(note.todo_item_id || note.calendar_event_id || note.planner_multi_item_id || note.planner_multi_line_id);
}

function updateListVisibilityButton(isListed) {
    const visibilityBtn = document.getElementById('list-visibility-btn');
    if (!visibilityBtn) return;
    const icon = visibilityBtn.querySelector('i');
    const label = visibilityBtn.querySelector('span');
    if (isListed) {
        if (icon) icon.className = 'fa-solid fa-eye-slash';
        if (label) label.textContent = 'Hide from notes list';
    } else {
        if (icon) icon.className = 'fa-solid fa-eye';
        if (label) label.textContent = 'Show in notes list';
    }
}

function setListVisibilityButtonEnabled(enabled) {
    const visibilityBtn = document.getElementById('list-visibility-btn');
    if (!visibilityBtn) return;
    visibilityBtn.style.display = enabled ? '' : 'none';
}

function shouldAllowListVisibilityToggle(list) {
    if (!list) return false;
    if (typeof list.is_linked_note === 'boolean') return list.is_linked_note;
    return !!(list.todo_item_id || list.calendar_event_id || list.planner_multi_item_id || list.planner_multi_line_id);
}

async function toggleNoteVisibility() {
    const noteId = notesState.activeNoteId;
    if (!noteId) {
        notesState.activeNoteIsListed = !notesState.activeNoteIsListed;
        updateNoteVisibilityButton(notesState.activeNoteIsListed);
        showToast(notesState.activeNoteIsListed ? 'Will show in notes list.' : 'Will be linked-only.', 'info', 2000);
        return;
    }
    const note = notesState.notes.find(n => n.id === noteId);
    const nextListed = !(note && note.is_listed);
    try {
        const res = await fetch(`/api/notes/${noteId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_listed: nextListed })
        });
        if (!res.ok) throw new Error('Failed to update visibility');
        const updated = await res.json();
        notesState.notes = notesState.notes.map(n => n.id === updated.id ? updated : n);
        updateNoteVisibilityButton(!!updated.is_listed);
        showToast(updated.is_listed ? 'Note is now listed.' : 'Note is now linked-only.', 'success', 2000);
    } catch (err) {
        console.error('Failed to update visibility:', err);
        showToast('Could not update visibility.', 'error', 2500);
    }
}

async function toggleListVisibility() {
    const listId = listState.listId;
    if (!listId) return;
    if (listState.isArchived) {
        showReadOnlyToast();
        return;
    }
    const nextListed = !listState.isListed;
    try {
        const res = await fetch(`/api/notes/${listId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_listed: nextListed })
        });
        if (!res.ok) throw new Error('Failed to update visibility');
        const updated = await res.json();
        listState.isListed = !!updated.is_listed;
        updateListVisibilityButton(listState.isListed);
        showToast(listState.isListed ? 'List is now listed.' : 'List is now linked-only.', 'success', 2000);
    } catch (err) {
        console.error('Failed to update list visibility:', err);
        showToast('Could not update visibility.', 'error', 2500);
    }
}

function tryConvertBracketLink(editor, event) {
    if (!event || event.inputType !== 'insertText' || event.data !== ']') return false;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!range.collapsed) return false;
    const node = range.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    const text = node.nodeValue || '';
    const offset = range.startOffset;
    if (offset < 2 || text.slice(offset - 2, offset) !== ']]') return false;
    const before = text.slice(0, offset - 2);
    const openIndex = before.lastIndexOf('[[');
    if (openIndex === -1) return false;
    const rawTitle = before.slice(openIndex + 2);
    const title = rawTitle.trim();
    if (!title || title.includes('\n')) return false;

    const prefix = text.slice(0, openIndex);
    const suffix = text.slice(offset);
    const parent = node.parentNode;
    if (!parent) return false;

    const link = document.createElement('a');
    link.className = 'note-link';
    link.setAttribute('data-note-title', title);
    link.setAttribute('href', '#');
    link.textContent = title;

    const fragment = document.createDocumentFragment();
    if (prefix) fragment.appendChild(document.createTextNode(prefix));
    fragment.appendChild(link);
    if (suffix) fragment.appendChild(document.createTextNode(suffix));
    parent.insertBefore(fragment, node);
    parent.removeChild(node);

    const newRange = document.createRange();
    newRange.setStartAfter(link);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);
    return true;
}

function tryConvertMarkdownLink(editor, event) {
    if (!event || event.inputType !== 'insertText' || event.data !== ')') return false;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!range.collapsed) return false;
    const node = range.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    const text = node.nodeValue || '';
    const offset = range.startOffset;
    const before = text.slice(0, offset);
    const match = before.match(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)$/i);
    if (!match) return false;
    const label = match[1].trim();
    const url = match[2].trim();
    if (!label || !url) return false;

    const startIndex = before.lastIndexOf(match[0]);
    const prefix = text.slice(0, startIndex);
    const suffix = text.slice(offset);
    const parent = node.parentNode;
    if (!parent) return false;

    const link = document.createElement('a');
    link.className = 'external-link';
    link.setAttribute('href', url);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    link.textContent = label;

    const fragment = document.createDocumentFragment();
    if (prefix) fragment.appendChild(document.createTextNode(prefix));
    fragment.appendChild(link);
    if (suffix) fragment.appendChild(document.createTextNode(suffix));
    parent.insertBefore(fragment, node);
    parent.removeChild(node);

    const newRange = document.createRange();
    newRange.setStartAfter(link);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);
    return true;
}

async function ensureActiveNoteIdForLink() {
    if (notesState.activeNoteId) return notesState.activeNoteId;
    if (notesState.activeNoteIsArchived) return null;
    if (notesState.dirty || noteHasContent()) {
        await saveCurrentNote({ silent: true, keepOpen: true });
    }
    if (notesState.activeNoteId) return notesState.activeNoteId;

    const editor = document.getElementById('note-editor');
    const titleInput = document.getElementById('note-title');
    if (!editor || !titleInput) return null;
    const title = titleInput.value.trim() || titleInput.placeholder || 'Untitled Note';
    const payload = {
        title: title,
        content: editor.innerHTML.trim(),
        folder_id: notesState.activeFolderId
    };
    if (!noteId) {
        payload.is_listed = notesState.activeNoteIsListed;
    }
    try {
        const res = await fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to create note');
        const newNote = await res.json();
    notesState.notes = [newNote, ...notesState.notes];
    notesState.activeNoteId = newNote.id;
    notesState.activeNoteIsListed = !!newNote.is_listed;
        notesState.activeSnapshot = { title: payload.title, content: payload.content };
        setNoteDirty(false);
        return newNote.id;
    } catch (err) {
        console.error('Failed to create note for link:', err);
        showToast('Save this note before linking.', 'warning', 2500);
        return null;
    }
}

async function handleNoteLinkClick(linkEl) {
    const existingId = parseInt(linkEl.dataset.noteId || '', 10);
    if (existingId) {
        openNoteInEditor(existingId);
        return;
    }
    const title = (linkEl.dataset.noteTitle || linkEl.textContent || '').trim();
    if (!title) return;
    const sourceNoteId = await ensureActiveNoteIdForLink();
    if (!sourceNoteId) return;

    try {
        const res = await fetch('/api/notes/resolve-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_note_id: sourceNoteId,
                title: title,
                folder_id: notesState.activeFolderId
            })
        });
        if (!res.ok) throw new Error('Failed to resolve link');
        const data = await res.json();
        if (data.status === 'choose') {
            openNoteLinkModal(linkEl, title, data.matches || [], sourceNoteId, { folderId: notesState.activeFolderId });
            return;
        }
        if (data.note) {
            applyResolvedNoteLink(linkEl, data.note);
            openNoteInEditor(data.note.id);
        }
    } catch (err) {
        console.error('Failed to resolve note link:', err);
        showToast('Could not resolve that link.', 'error', 2500);
    }
}

async function handleListNoteLinkClick(linkEl) {
    const existingId = parseInt(linkEl.dataset.noteId || '', 10);
    if (existingId) {
        openNoteInEditor(existingId);
        return;
    }
    const title = (linkEl.dataset.noteTitle || linkEl.textContent || '').trim();
    if (!title) return;
    const sourceNoteId = listState.listId;
    if (!sourceNoteId) return;

    try {
        const res = await fetch('/api/notes/resolve-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_note_id: sourceNoteId,
                title: title,
                folder_id: listState.folderId
            })
        });
        if (!res.ok) throw new Error('Failed to resolve link');
        const data = await res.json();
        if (data.status === 'choose') {
            openNoteLinkModal(linkEl, title, data.matches || [], sourceNoteId, { folderId: listState.folderId });
            return;
        }
        if (data.note) {
            applyResolvedNoteLink(linkEl, data.note);
            openNoteInEditor(data.note.id);
        }
    } catch (err) {
        console.error('Failed to resolve list note link:', err);
        showToast('Could not resolve that link.', 'error', 2500);
    }
}

function applyResolvedNoteLink(linkEl, note) {
    if (!linkEl || !note) return;
    linkEl.dataset.noteId = note.id;
    linkEl.dataset.noteTitle = note.title || linkEl.textContent || '';
    linkEl.setAttribute('href', `/notes/${note.id}`);
    if (document.getElementById('note-editor')) {
        setNoteDirty(true);
    }
}

function openNoteLinkModal(anchor, title, matches, sourceNoteId, options = {}) {
    const modal = document.getElementById('note-link-modal');
    const listEl = document.getElementById('note-link-match-list');
    const titleEl = document.getElementById('note-link-modal-title');
    const subtitleEl = document.getElementById('note-link-modal-subtitle');
    if (!modal || !listEl) return;

    noteLinkState = {
        anchor,
        title,
        matches: matches || [],
        sourceNoteId,
        openOnResolve: options.openOnResolve !== false,
        folderId: options.folderId ?? null
    };
    if (titleEl) titleEl.textContent = `Link: ${title}`;
    if (subtitleEl) {
        subtitleEl.textContent = (matches && matches.length)
            ? 'Select an existing note or create a new one.'
            : 'No exact matches found. Create a new note?';
    }

    listEl.innerHTML = '';
    if (matches && matches.length) {
        matches.forEach(match => {
            const option = document.createElement('div');
            option.className = 'note-link-option';
            option.innerHTML = `
                <div>
                    <div class="note-link-option-title">${escapeHtml(match.title || 'Untitled Note')}</div>
                    <div class="note-link-option-meta">${match.is_listed ? 'Listed' : 'Linked-only'}</div>
                </div>
                <i class="fa-solid fa-arrow-right"></i>
            `;
            option.onclick = () => selectNoteLinkMatch(match.id);
            listEl.appendChild(option);
        });
    } else {
        listEl.innerHTML = '<div class="note-chooser-empty">No matching notes.</div>';
    }

    modal.classList.add('active');
}

function closeNoteLinkModal() {
    const modal = document.getElementById('note-link-modal');
    if (modal) modal.classList.remove('active');
    noteLinkState = { anchor: null, title: '', matches: [], sourceNoteId: null, openOnResolve: true, folderId: null };
}

function setupNoteLinkModalControls() {
    const modal = document.getElementById('note-link-modal');
    const cancelBtn = document.getElementById('note-link-cancel-btn');
    const createListedBtn = document.getElementById('note-link-create-listed-btn');
    const createHiddenBtn = document.getElementById('note-link-create-hidden-btn');
    if (!modal) return;

    if (cancelBtn) cancelBtn.onclick = () => closeNoteLinkModal();
    if (createListedBtn) createListedBtn.onclick = () => createNoteFromLinkModal(true);
    if (createHiddenBtn) createHiddenBtn.onclick = () => createNoteFromLinkModal(false);
    modal.onclick = (e) => {
        if (e.target === modal) closeNoteLinkModal();
    };
}

function openEditNoteLinkModal(linkEl) {
    const modal = document.getElementById('note-edit-link-modal');
    const textInput = document.getElementById('note-edit-link-text');
    const typeSelect = document.getElementById('note-edit-link-type');
    const urlGroup = document.getElementById('note-edit-link-url-group');
    const urlInput = document.getElementById('note-edit-link-url');
    const noteGroup = document.getElementById('note-edit-link-note-group');
    if (!modal || !textInput || !typeSelect || !urlGroup || !urlInput || !noteGroup) return;

    linkEditState.anchor = linkEl;
    const isExternal = linkEl.classList.contains('external-link');
    textInput.value = linkEl.textContent || '';
    typeSelect.value = isExternal ? 'external' : 'note';
    urlInput.value = isExternal ? (linkEl.getAttribute('href') || '') : '';
    urlGroup.style.display = isExternal ? 'block' : 'none';
    noteGroup.style.display = isExternal ? 'none' : 'block';
    modal.classList.add('active');
    textInput.focus();
    textInput.select();
}

function closeEditNoteLinkModal() {
    const modal = document.getElementById('note-edit-link-modal');
    if (modal) modal.classList.remove('active');
    linkEditState.anchor = null;
}

async function relinkNoteFromEditModal() {
    const anchor = linkEditState.anchor;
    const textInput = document.getElementById('note-edit-link-text');
    if (!anchor || !textInput) return;
    const title = textInput.value.trim();
    if (!title) return;
    const sourceNoteId = await ensureActiveNoteIdForLink();
    if (!sourceNoteId) return;

    try {
        const res = await fetch('/api/notes/resolve-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_note_id: sourceNoteId,
                title: title,
                folder_id: notesState.activeFolderId
            })
        });
        if (!res.ok) throw new Error('Failed to resolve link');
        const data = await res.json();
        if (data.status === 'choose') {
            openNoteLinkModal(anchor, title, data.matches || [], sourceNoteId, { openOnResolve: false, folderId: notesState.activeFolderId });
            return;
        }
        if (data.note) {
            applyResolvedNoteLink(anchor, data.note);
            anchor.textContent = title;
            setNoteDirty(true);
        }
    } catch (err) {
        console.error('Failed to relink note:', err);
        showToast('Could not relink that note.', 'error', 2500);
    }
}

function removeNoteLinkFromEditModal() {
    const anchor = linkEditState.anchor;
    const textInput = document.getElementById('note-edit-link-text');
    if (!anchor) return;
    const label = (textInput && textInput.value.trim()) || anchor.textContent || '';
    const textNode = document.createTextNode(label);
    anchor.replaceWith(textNode);
    setNoteDirty(true);
    closeEditNoteLinkModal();
}

function saveEditNoteLinkModal() {
    const anchor = linkEditState.anchor;
    const textInput = document.getElementById('note-edit-link-text');
    const typeSelect = document.getElementById('note-edit-link-type');
    const urlInput = document.getElementById('note-edit-link-url');
    if (!anchor || !textInput || !typeSelect || !urlInput) return;

    const label = textInput.value.trim() || 'Link';
    const type = typeSelect.value;

    anchor.textContent = label;
    anchor.dataset.noteTitle = label;

    if (type === 'external') {
        const url = urlInput.value.trim();
        anchor.classList.remove('note-link');
        anchor.classList.add('external-link');
        anchor.removeAttribute('data-note-id');
        anchor.removeAttribute('data-note-title');
        anchor.setAttribute('href', url || '#');
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
    } else {
        anchor.classList.remove('external-link');
        anchor.classList.add('note-link');
        anchor.setAttribute('href', anchor.dataset.noteId ? `/notes/${anchor.dataset.noteId}` : '#');
        anchor.removeAttribute('target');
        anchor.removeAttribute('rel');
        anchor.dataset.noteTitle = label;
    }

    setNoteDirty(true);
    closeEditNoteLinkModal();
}

function setupEditNoteLinkModalControls() {
    const modal = document.getElementById('note-edit-link-modal');
    const cancelBtn = document.getElementById('note-edit-link-cancel-btn');
    const saveBtn = document.getElementById('note-edit-link-save-btn');
    const removeBtn = document.getElementById('note-edit-link-remove-btn');
    const relinkBtn = document.getElementById('note-edit-link-relink-btn');
    const typeSelect = document.getElementById('note-edit-link-type');
    const urlGroup = document.getElementById('note-edit-link-url-group');
    const noteGroup = document.getElementById('note-edit-link-note-group');

    if (!modal) return;

    if (cancelBtn) cancelBtn.onclick = () => closeEditNoteLinkModal();
    if (saveBtn) saveBtn.onclick = () => saveEditNoteLinkModal();
    if (removeBtn) removeBtn.onclick = () => removeNoteLinkFromEditModal();
    if (relinkBtn) relinkBtn.onclick = () => relinkNoteFromEditModal();
    if (typeSelect && urlGroup && noteGroup) {
        typeSelect.onchange = () => {
            const isExternal = typeSelect.value === 'external';
            urlGroup.style.display = isExternal ? 'block' : 'none';
            noteGroup.style.display = isExternal ? 'none' : 'block';
        };
    }
    modal.onclick = (e) => {
        if (e.target === modal) closeEditNoteLinkModal();
    };
}

async function selectNoteLinkMatch(targetId) {
    const { anchor, sourceNoteId } = noteLinkState;
    if (!anchor || !sourceNoteId || !targetId) return;
    try {
        const res = await fetch('/api/notes/resolve-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_note_id: sourceNoteId,
                target_note_id: targetId
            })
        });
        if (!res.ok) throw new Error('Failed to link note');
        const data = await res.json();
        if (data.note) {
            applyResolvedNoteLink(anchor, data.note);
            closeNoteLinkModal();
            if (noteLinkState.openOnResolve) {
                openNoteInEditor(data.note.id);
            }
        }
    } catch (err) {
        console.error('Failed to link note:', err);
        showToast('Could not link that note.', 'error', 2500);
    }
}

async function createNoteFromLinkModal(isListed) {
    const { anchor, title, sourceNoteId } = noteLinkState;
    if (!anchor || !sourceNoteId || !title) return;
    const folderId = noteLinkState.folderId !== null ? noteLinkState.folderId : notesState.activeFolderId;
    try {
        const res = await fetch('/api/notes/resolve-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_note_id: sourceNoteId,
                title: title,
                is_listed: isListed,
                folder_id: folderId
            })
        });
    if (!res.ok) throw new Error('Failed to create linked note');
    const data = await res.json();
    if (data.note) {
        applyResolvedNoteLink(anchor, data.note);
        closeNoteLinkModal();
        if (noteLinkState.openOnResolve) {
            openNoteInEditor(data.note.id);
        }
    }
    } catch (err) {
        console.error('Failed to create linked note:', err);
        showToast('Could not create that note.', 'error', 2500);
    }
}

function bootNoteEditorPage() {
    if (!document.getElementById('note-editor-page')) return;
    initNoteEditorPage();
}

if (document.readyState === 'complete') {
    bootNoteEditorPage();
} else {
    document.addEventListener('DOMContentLoaded', bootNoteEditorPage, { once: true });
}

