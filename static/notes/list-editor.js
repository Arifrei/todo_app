function initListEditorPage() {
    const page = document.getElementById('list-editor-page');
    if (!page) return;
    if (page.dataset.listEditorInit === '1') return;

    const titleInput = document.getElementById('list-title');
    const checkboxToggle = document.getElementById('list-checkbox-toggle');
    const listId = getListEditorNoteId();
    if (!titleInput || !checkboxToggle || !listId) {
        return;
    }
    page.dataset.listEditorInit = '1';

    const saveBtn = document.getElementById('list-save-btn');
    const cancelBtn = document.getElementById('list-cancel-btn');
    const deleteBtn = document.getElementById('list-delete-btn');
    const shareBtn = document.getElementById('list-share-btn');
    const protectBtn = document.getElementById('list-protect-btn');
    const archiveBtn = document.getElementById('list-archive-btn');
    const visibilityBtn = document.getElementById('list-visibility-btn');
    const backBtn = document.getElementById('list-back-btn');
    const notesBtn = document.getElementById('list-notes-btn');
    const actionsToggle = document.getElementById('list-actions-toggle');
    const actionsMenu = document.getElementById('list-actions-menu');
    const duplicatesBtn = document.getElementById('list-duplicates-btn');
    const searchToggleBtn = document.getElementById('list-search-toggle');
    const stack = document.getElementById('list-pill-stack');
    const selectToggle = document.getElementById('list-select-toggle');
    const bulkMoveBtn = document.getElementById('list-bulk-move-btn');
    const bulkSectionBtn = document.getElementById('list-bulk-section-btn');
    const bulkDeleteBtn = document.getElementById('list-bulk-delete-btn');
    const bulkDoneBtn = document.getElementById('list-bulk-done-btn');
    const bulkMoreToggle = document.getElementById('list-bulk-more-toggle');
    const bulkMoreMenu = document.getElementById('list-bulk-more-menu');
    const searchBar = document.getElementById('list-search');
    const searchInput = document.getElementById('list-search-input');
    const searchClearBtn = document.getElementById('list-search-clear');
    const sectionModal = document.getElementById('list-section-modal');
    const sectionTitleInput = document.getElementById('list-section-title');
    const sectionSaveBtn = document.getElementById('list-section-save-btn');
    const sectionCancelBtn = document.getElementById('list-section-cancel-btn');
    const duplicatesModal = document.getElementById('list-duplicates-modal');
    const duplicatesCloseBtn = document.getElementById('list-duplicates-close-btn');
    const duplicatesDeleteSelectedBtn = document.getElementById('list-duplicates-delete-selected-btn');

    if (saveBtn) saveBtn.addEventListener('click', () => saveListMetadata({ closeAfter: true }));
    if (cancelBtn) cancelBtn.addEventListener('click', async () => { await cancelListMetadataChanges(); });
    if (deleteBtn) deleteBtn.addEventListener('click', () => deleteCurrentList());
    if (shareBtn) shareBtn.addEventListener('click', () => shareCurrentList());
    if (protectBtn) protectBtn.addEventListener('click', () => toggleListProtection());
    if (visibilityBtn) visibilityBtn.addEventListener('click', () => toggleListVisibility());
    if (archiveBtn) archiveBtn.addEventListener('click', () => toggleCurrentListArchive());
    if (backBtn) backBtn.addEventListener('click', () => handleListBack());
    if (notesBtn) notesBtn.addEventListener('click', () => handleListExit());
    if (duplicatesBtn) duplicatesBtn.addEventListener('click', () => openListDuplicatesModal());
    if (searchToggleBtn) {
        searchToggleBtn.addEventListener('click', () => {
            if (!searchBar) return;
            const nextOpen = searchBar.style.display === 'none' || searchBar.style.display === '';
            searchBar.style.display = nextOpen ? 'flex' : 'none';
            searchToggleBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
            if (nextOpen && searchInput) {
                searchInput.focus();
                searchInput.select();
            }
            if (actionsMenu) actionsMenu.classList.remove('open');
            if (actionsToggle) actionsToggle.setAttribute('aria-expanded', 'false');
        });
    }
    if (selectToggle) selectToggle.addEventListener('click', () => toggleListSelectionMode());
    if (bulkMoveBtn) {
        bulkMoveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (bulkMoreMenu) bulkMoreMenu.classList.remove('open');
            openListBulkMoveMenu(bulkMoveBtn);
        });
    }
    if (bulkSectionBtn) {
        bulkSectionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (bulkMoreMenu) bulkMoreMenu.classList.remove('open');
            createSectionFromSelection();
        });
    }
    if (bulkDeleteBtn) bulkDeleteBtn.addEventListener('click', () => deleteSelectedListItems());
    if (bulkDoneBtn) bulkDoneBtn.addEventListener('click', () => setListSelectionMode(false));

    // Select-all and clear handlers for unified bulk bar
    const listSelectAll = document.getElementById('list-select-all');
    const listBulkClear = document.getElementById('list-bulk-clear');
    if (listSelectAll) {
        listSelectAll.addEventListener('change', (e) => {
            const selectableItems = (listState.items || []).filter(item => !isListSectionItem(item));
            if (e.target.checked) {
                selectableItems.forEach(item => listSelectionState.ids.add(item.id));
            } else {
                listSelectionState.ids.clear();
            }
            updateListBulkBar();
            renderListItems();
        });
    }
    if (listBulkClear) {
        listBulkClear.addEventListener('click', () => {
            listSelectionState.ids.clear();
            updateListBulkBar();
            renderListItems();
        });
    }

    if (bulkMoreToggle && bulkMoreMenu) {
        bulkMoreToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const nextOpen = !bulkMoreMenu.classList.contains('open');
            if (nextOpen) {
                bulkMoreMenu.style.visibility = 'hidden';
                bulkMoreMenu.classList.add('open');
                requestAnimationFrame(() => {
                    positionBulkMenu(bulkMoreMenu, bulkMoreToggle);
                    bulkMoreMenu.style.visibility = 'visible';
                });
            } else {
                bulkMoreMenu.classList.remove('open');
                bulkMoreMenu.style.visibility = '';
            }
            bulkMoreToggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        });
        bulkMoreMenu.addEventListener('click', (e) => {
            if (e.target.closest('button')) {
                bulkMoreMenu.classList.remove('open');
                bulkMoreMenu.style.visibility = '';
                bulkMoreToggle.setAttribute('aria-expanded', 'false');
            }
        });
        document.addEventListener('click', (e) => {
            if (!bulkMoreMenu.contains(e.target) && !bulkMoreToggle.contains(e.target)) {
                bulkMoreMenu.classList.remove('open');
                bulkMoreMenu.style.visibility = '';
                bulkMoreToggle.setAttribute('aria-expanded', 'false');
            }
        });
    }
    if (sectionSaveBtn) sectionSaveBtn.addEventListener('click', () => submitListSectionModal());
    if (sectionCancelBtn) sectionCancelBtn.addEventListener('click', () => closeListSectionModal());
    if (duplicatesCloseBtn) duplicatesCloseBtn.addEventListener('click', () => closeListDuplicatesModal());
    if (duplicatesDeleteSelectedBtn) duplicatesDeleteSelectedBtn.addEventListener('click', () => deleteSelectedDuplicateItems());
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            listSearchState.query = (searchInput.value || '').trim();
            renderListItems();
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                searchInput.value = '';
                listSearchState.query = '';
                renderListItems();
                const searchBar = document.getElementById('list-search');
                if (searchBar) searchBar.style.display = 'none';
                if (searchToggleBtn) searchToggleBtn.setAttribute('aria-expanded', 'false');
            }
        });
    }
    if (searchClearBtn && searchInput) {
        searchClearBtn.addEventListener('click', () => {
            searchInput.value = '';
            listSearchState.query = '';
            renderListItems();
            searchInput.focus();
            if (searchBar) searchBar.style.display = 'none';
            if (searchToggleBtn) searchToggleBtn.setAttribute('aria-expanded', 'false');
        });
    }
    if (sectionTitleInput) {
        sectionTitleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitListSectionModal();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                closeListSectionModal();
            }
        });
    }
    if (sectionModal) {
        sectionModal.addEventListener('click', (e) => {
            if (e.target === sectionModal) closeListSectionModal();
        });
    }
    if (duplicatesModal) {
        duplicatesModal.addEventListener('click', (e) => {
            if (e.target === duplicatesModal) closeListDuplicatesModal();
        });
    }

    // Check PIN status
    checkPinStatus();
    checkNotesPinStatus();
    if (actionsToggle && actionsMenu) {
        actionsToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const nextOpen = !actionsMenu.classList.contains('open');
            actionsMenu.classList.toggle('open', nextOpen);
            actionsToggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        });
        actionsMenu.addEventListener('click', (e) => {
            if (e.target.closest('button')) {
                actionsMenu.classList.remove('open');
                actionsToggle.setAttribute('aria-expanded', 'false');
            }
        });
        document.addEventListener('click', (e) => {
            if (!actionsMenu.contains(e.target) && !actionsToggle.contains(e.target)) {
                actionsMenu.classList.remove('open');
                actionsToggle.setAttribute('aria-expanded', 'false');
            }
        });
    }
    if (stack) {
        stack.addEventListener('click', (e) => {
            if (listState.isArchived) {
                showReadOnlyToast();
                return;
            }
            if (isListSelectionActive()) return;
            if (e.target.closest('.list-pill')) return;
            if (e.target.closest('.list-pill-input')) return;
            setListInsertionAtPosition(e.clientY);
        });

        const selectionState = {
            pointerId: null,
            moved: false,
            startX: 0,
            startY: 0,
            itemId: null
        };
        const getPillFromTarget = (target) => target.closest('.list-pill:not(.list-pill-input)');
        const resetSelectionState = () => {
            selectionState.pointerId = null;
            selectionState.moved = false;
            selectionState.itemId = null;
        };
        stack.addEventListener('pointerdown', (e) => {
            if (!isListSelectionActive()) return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            const pill = getPillFromTarget(e.target);
            if (!pill) return;
            const itemId = parseInt(pill.dataset.itemId || '', 10);
            if (!itemId) return;
            selectionState.pointerId = e.pointerId;
            selectionState.moved = false;
            selectionState.startX = e.clientX;
            selectionState.startY = e.clientY;
            selectionState.itemId = itemId;
        });
        stack.addEventListener('pointermove', (e) => {
            if (!isListSelectionActive()) return;
            if (selectionState.pointerId !== e.pointerId) return;
            if (Math.abs(e.clientX - selectionState.startX) > TOUCH_SCROLL_THRESHOLD ||
                Math.abs(e.clientY - selectionState.startY) > TOUCH_SCROLL_THRESHOLD) {
                selectionState.moved = true;
            }
        });
        stack.addEventListener('pointerup', (e) => {
            if (!isListSelectionActive()) return;
            if (selectionState.pointerId !== e.pointerId) return;
            const itemId = selectionState.itemId;
            const moved = selectionState.moved;
            resetSelectionState();
            if (moved || !itemId) return;
            toggleListItemSelection(itemId);
        });
        stack.addEventListener('pointercancel', resetSelectionState);
    }
    document.addEventListener('mousedown', handleListEditorOutsideClick);

    titleInput.addEventListener('input', refreshListDirtyState);
    checkboxToggle.addEventListener('change', () => {
        if (listState.isArchived) {
            showReadOnlyToast();
            checkboxToggle.checked = listState.checkboxMode;
            return;
        }
        listState.checkboxMode = checkboxToggle.checked;
        refreshListDirtyState();
        renderListItems();
    });

    updateListSelectionUI();
    loadListForEditor(listId);
}

function setListEditorReadOnly(isReadOnly) {
    const titleInput = document.getElementById('list-title');
    const checkboxToggle = document.getElementById('list-checkbox-toggle');
    const saveBtn = document.getElementById('list-save-btn');
    const cancelBtn = document.getElementById('list-cancel-btn');
    const selectToggle = document.getElementById('list-select-toggle');
    const bulkBar = document.getElementById('list-bulk-bar');
    if (titleInput) titleInput.disabled = isReadOnly;
    if (checkboxToggle) checkboxToggle.disabled = isReadOnly;
    if (saveBtn) saveBtn.disabled = isReadOnly;
    if (cancelBtn) cancelBtn.disabled = isReadOnly || !hasListSessionChanges();
    if (selectToggle) selectToggle.disabled = isReadOnly;
    if (bulkBar && isReadOnly) bulkBar.classList.remove('active');
    if (isReadOnly) setListSelectionMode(false);
}

function handleListEditorOutsideClick(e) {
    const page = document.getElementById('list-editor-page');
    if (!page) return;
    if (isListSelectionActive()) return;
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
        listState.isArchived = false;
        setListEditorReadOnly(false);

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
        listState.isArchived = !!list.is_archived;
        listState.isListed = !!list.is_listed;
        listState.folderId = list.folder_id || null;
        listState.activeSnapshot = {
            title: list.title || '',
            checkboxMode: !!list.checkbox_mode
        };
        listState.sessionSnapshot = {
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
        updateArchiveButton(!!list.is_archived);
        updateListVisibilityButton(listState.isListed);
        setListVisibilityButtonEnabled(shouldAllowListVisibilityToggle(list));
        setListEditorReadOnly(!!list.is_archived);
    } catch (err) {
        console.error('Error loading list:', err);
        showToast('Could not load that list.', 'error');
    }
}

function refreshListDirtyState() {
    const titleInput = document.getElementById('list-title');
    const checkboxToggle = document.getElementById('list-checkbox-toggle');
    if (!titleInput || !checkboxToggle) return;
    if (listState.isArchived) {
        showReadOnlyToast();
        return;
    }
    const snapshot = listState.activeSnapshot || { title: '', checkboxMode: false };
    const title = (titleInput.value || '').trim();
    const checkboxMode = checkboxToggle.checked;
    const dirty = title !== (snapshot.title || '') || checkboxMode !== !!snapshot.checkboxMode;
    setListDirty(dirty);
}

function setListDirty(dirty) {
    listState.dirty = dirty;
    const saveBtn = document.getElementById('list-save-btn');
    const cancelBtn = document.getElementById('list-cancel-btn');
    if (saveBtn) saveBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = listState.isArchived || !hasListSessionChanges();
    if (!dirty) {
        if (listAutoSaveTimer) {
            clearTimeout(listAutoSaveTimer);
            listAutoSaveTimer = null;
        }
        return;
    }
    scheduleListAutosave();
}

function getCurrentListMetadataSnapshot() {
    const titleInput = document.getElementById('list-title');
    const checkboxToggle = document.getElementById('list-checkbox-toggle');
    return {
        title: titleInput ? (titleInput.value || '').trim() : '',
        checkboxMode: checkboxToggle ? !!checkboxToggle.checked : false
    };
}

function getListSessionSnapshot() {
    return listState.sessionSnapshot || listState.activeSnapshot || { title: '', checkboxMode: false };
}

function hasListSessionChanges() {
    const current = getCurrentListMetadataSnapshot();
    const session = getListSessionSnapshot();
    return current.title !== (session.title || '') || current.checkboxMode !== !!session.checkboxMode;
}

async function cancelListMetadataChanges() {
    if (!hasListSessionChanges()) return;
    if (listState.isArchived) {
        showReadOnlyToast();
        return;
    }
    const titleInput = document.getElementById('list-title');
    const checkboxToggle = document.getElementById('list-checkbox-toggle');
    if (!titleInput || !checkboxToggle) return;
    const snapshot = getListSessionSnapshot();
    titleInput.value = snapshot.title || '';
    checkboxToggle.checked = !!snapshot.checkboxMode;
    listState.checkboxMode = !!snapshot.checkboxMode;
    refreshListDirtyState();
    if (listState.dirty) {
        await saveListMetadata({ silent: true });
    } else {
        setListDirty(false);
    }
    renderListItems();
    showToast('Restored to session start.', 'success', 1800);
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
    if (!listState.dirty) {
        if (closeAfter) {
            window.location.href = getListReturnUrl();
        }
        return;
    }
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

function getSortedListItems() {
    return (listState.items || []).slice().sort((a, b) => {
        const aOrder = a.order_index || 0;
        const bOrder = b.order_index || 0;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return (a.id || 0) - (b.id || 0);
    });
}

function isListSelectionActive() {
    return !!listSelectionState.active;
}

function clearListSelection() {
    listSelectionState.ids.clear();
}

function setListSelectionMode(active) {
    listSelectionState.active = !!active;
    clearListSelection();
    listState.insertionIndex = null;
    listState.editingItemId = null;
    listState.expandedItemId = null;
    updateListSelectionUI();
    renderListItems();
}

function toggleListSelectionMode() {
    setListSelectionMode(!listSelectionState.active);
}

function updateListSelectionUI() {
    const page = document.getElementById('list-editor-page');
    if (page) page.classList.toggle('list-selection-mode', listSelectionState.active);
    const bar = document.getElementById('list-bulk-bar');
    if (bar) bar.style.display = listSelectionState.active ? 'flex' : 'none';
    const toggleBtn = document.getElementById('list-select-toggle');
    if (toggleBtn) {
        toggleBtn.classList.toggle('active', listSelectionState.active);
        toggleBtn.setAttribute('aria-pressed', listSelectionState.active ? 'true' : 'false');
        toggleBtn.innerHTML = listSelectionState.active
            ? '<i class="fa-solid fa-check"></i> Done'
            : '<i class="fa-solid fa-check-square"></i> Select';
    }
    updateListBulkBar();
}

function toggleListItemSelection(itemId) {
    if (!itemId) return;
    const item = (listState.items || []).find(entry => entry.id === itemId);
    if (item && isListSectionItem(item)) return;
    if (listSelectionState.ids.has(itemId)) {
        listSelectionState.ids.delete(itemId);
    } else {
        listSelectionState.ids.add(itemId);
    }
    updateListBulkBar();
    renderListItems();
}

function getSelectedListItemIds() {
    return Array.from(listSelectionState.ids);
}

function updateListBulkBar() {
    const count = listSelectionState.ids.size;
    const countEl = document.getElementById('list-bulk-count');
    if (countEl) countEl.textContent = `${count} selected`;
    const moveBtn = document.getElementById('list-bulk-move-btn');
    const sectionBtn = document.getElementById('list-bulk-section-btn');
    const deleteBtn = document.getElementById('list-bulk-delete-btn');
    const selectAll = document.getElementById('list-select-all');
    const disabled = count === 0;
    if (moveBtn) moveBtn.disabled = disabled;
    if (sectionBtn) sectionBtn.disabled = disabled;
    if (deleteBtn) deleteBtn.disabled = disabled;
    // Note: moreToggle (dropdown button) is kept enabled so users can see options

    // Update select-all checkbox state
    const selectableItems = (listState.items || []).filter(item => !isListSectionItem(item));
    const totalSelectable = selectableItems.length;
    if (selectAll) {
        selectAll.checked = totalSelectable > 0 && count === totalSelectable;
        selectAll.indeterminate = count > 0 && count < totalSelectable;
    }
}

function openListSectionModal(onSubmit) {
    const modal = document.getElementById('list-section-modal');
    const input = document.getElementById('list-section-title');
    if (!modal || !input) return;
    listSectionModalState.onSubmit = onSubmit;
    input.value = '';
    modal.classList.add('active');
    setTimeout(() => input.focus(), 0);
}

function closeListSectionModal() {
    const modal = document.getElementById('list-section-modal');
    if (modal) modal.classList.remove('active');
    listSectionModalState.onSubmit = null;
}

function submitListSectionModal() {
    const input = document.getElementById('list-section-title');
    const handler = listSectionModalState.onSubmit;
    closeListSectionModal();
    if (typeof handler === 'function') {
        handler(input ? input.value : '');
    }
}

function closeListItemMenu() {
    if (activeListItemMenu) {
        activeListItemMenu.remove();
        activeListItemMenu = null;
    }
}

function showListItemActions(pill) {
    if (isListSelectionActive()) return;
    if (activeListItemActionPill && activeListItemActionPill !== pill) {
        activeListItemActionPill.classList.remove('show-actions');
    }
    activeListItemActionPill = pill;
    pill.classList.add('show-actions');
}

function clearListItemActions() {
    if (!activeListItemActionPill) return;
    activeListItemActionPill.classList.remove('show-actions');
    activeListItemActionPill = null;
}

function positionListItemMenu(menu, anchor) {
    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const padding = 8;
    let topPos = rect.bottom + padding;
    if (window.innerHeight - rect.bottom < menuRect.height + padding && rect.top > menuRect.height + padding) {
        topPos = rect.top - menuRect.height - padding;
    }
    let leftPos = rect.right - menuRect.width;
    if (leftPos < padding) leftPos = padding;
    if (leftPos + menuRect.width > window.innerWidth - padding) {
        leftPos = window.innerWidth - menuRect.width - padding;
    }
    menu.style.top = `${topPos}px`;
    menu.style.left = `${leftPos}px`;
}

function getListSectionOptions() {
    return getSortedListItems()
        .filter(isListSectionItem)
        .map(section => ({
            id: section.id,
            title: getListSectionTitle(section) || 'Untitled section'
        }));
}

function getListInsertIndexForSection(itemId, sectionId) {
    const items = getSortedListItems();
    const sectionIds = new Set(items.filter(isListSectionItem).map(item => item.id));
    const ids = items.map(item => item.id);
    const currentIndex = ids.indexOf(itemId);
    if (currentIndex === -1) return null;
    ids.splice(currentIndex, 1);
    const sectionIndex = ids.indexOf(sectionId);
    if (sectionIndex === -1) return null;
    let insertIndex = ids.length;
    for (let idx = sectionIndex + 1; idx < ids.length; idx += 1) {
        if (sectionIds.has(ids[idx])) {
            insertIndex = idx;
            break;
        }
    }
    return insertIndex;
}

function getListInsertIndexForSectionExcluding(sectionId, excludeIds = []) {
    const excluded = new Set(excludeIds || []);
    const items = getSortedListItems().filter(item => !excluded.has(item.id));
    const sectionIds = new Set(items.filter(isListSectionItem).map(item => item.id));
    const ids = items.map(item => item.id);
    const sectionIndex = ids.indexOf(sectionId);
    if (sectionIndex === -1) return null;
    let insertIndex = ids.length;
    for (let idx = sectionIndex + 1; idx < ids.length; idx += 1) {
        if (sectionIds.has(ids[idx])) {
            insertIndex = idx;
            break;
        }
    }
    return insertIndex;
}

function buildListReorderIdsForSection(selectedIds, sectionId) {
    const selectedSet = new Set(selectedIds);
    const sorted = getSortedListItems();
    const selectedItems = sorted.filter(item => selectedSet.has(item.id));
    const remaining = sorted.filter(item => !selectedSet.has(item.id));
    const sectionIndex = remaining.findIndex(item => item.id === sectionId);
    if (sectionIndex === -1) return null;
    let insertIndex = remaining.length;
    for (let idx = sectionIndex + 1; idx < remaining.length; idx += 1) {
        if (isListSectionItem(remaining[idx])) {
            insertIndex = idx;
            break;
        }
    }
    const remainingIds = remaining.map(item => item.id);
    const selectedIdsOrdered = selectedItems.map(item => item.id);
    return [
        ...remainingIds.slice(0, insertIndex),
        ...selectedIdsOrdered,
        ...remainingIds.slice(insertIndex)
    ];
}

function buildListReorderIdsForNewSection(selectedOrderedIds, newSectionId, targetSectionId) {
    const selectedSet = new Set(selectedOrderedIds);
    const sorted = getSortedListItems();
    const remaining = sorted.filter(item => item.id !== newSectionId && !selectedSet.has(item.id));
    let insertIndex = remaining.length;
    if (targetSectionId) {
        const sectionIndex = remaining.findIndex(item => item.id === targetSectionId);
        if (sectionIndex !== -1) {
            insertIndex = remaining.length;
            for (let idx = sectionIndex + 1; idx < remaining.length; idx += 1) {
                if (isListSectionItem(remaining[idx])) {
                    insertIndex = idx;
                    break;
                }
            }
        }
    } else {
        insertIndex = remaining.length;
    }
    const remainingIds = remaining.map(item => item.id);
    return [
        ...remainingIds.slice(0, insertIndex),
        newSectionId,
        ...selectedOrderedIds,
        ...remainingIds.slice(insertIndex)
    ];
}

function buildListReorderIdsToTop(selectedIds) {
    const selectedSet = new Set(selectedIds);
    const sorted = getSortedListItems();
    const selectedItems = sorted.filter(item => selectedSet.has(item.id));
    const remaining = sorted.filter(item => !selectedSet.has(item.id));
    return [...selectedItems.map(item => item.id), ...remaining.map(item => item.id)];
}

async function reorderListItems(orderIds) {
    if (!listState.listId) return;
    const res = await fetch(`/api/notes/${listState.listId}/list-items/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: orderIds })
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Reorder failed');
    }
    const updatedLabel = document.getElementById('list-updated-label');
    if (updatedLabel) updatedLabel.textContent = formatNoteDate(new Date().toISOString());
}

async function moveListItemToSection(itemId, sectionId) {
    const insertIndex = getListInsertIndexForSection(itemId, sectionId);
    if (insertIndex === null) return;
    await updateListItem(itemId, { insert_index: insertIndex });
    await loadListItems();
}

async function moveListItemToTop(itemId) {
    await updateListItem(itemId, { insert_index: 0 });
    await loadListItems();
}

function openListItemMoveMenu(itemId, anchor) {
    const sections = getListSectionOptions();
    if (!sections.length) {
        showToast('No sections yet. Type /section to add one.', 'warning', 2500);
        return;
    }
    closeListItemMenu();
    const menu = document.createElement('div');
    menu.className = 'list-item-menu active';
    menu.dataset.itemId = itemId;

    const title = document.createElement('div');
    title.className = 'list-item-menu-title';
    title.textContent = 'Move to section';
    menu.appendChild(title);

    const topBtn = document.createElement('button');
    topBtn.type = 'button';
    topBtn.className = 'list-item-menu-option';
    topBtn.dataset.action = 'top';
    topBtn.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
    const topLabel = document.createElement('span');
    topLabel.textContent = 'Top (no section)';
    topBtn.appendChild(topLabel);
    menu.appendChild(topBtn);

    sections.forEach(section => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'list-item-menu-option';
        btn.dataset.sectionId = section.id;
        btn.innerHTML = '<i class="fa-solid fa-layer-group"></i>';
        const label = document.createElement('span');
        label.textContent = section.title;
        btn.appendChild(label);
        menu.appendChild(btn);
    });

    menu.querySelectorAll('.list-item-menu-option').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            closeListItemMenu();
            const action = btn.dataset.action;
            const sectionId = btn.dataset.sectionId ? parseInt(btn.dataset.sectionId, 10) : null;
            try {
                if (action === 'top') {
                    await moveListItemToTop(itemId);
                } else if (sectionId) {
                    await moveListItemToSection(itemId, sectionId);
                }
            } catch (err) {
                console.error('Move list item failed:', err);
                showToast('Could not move item', 'error');
            }
        });
    });

    document.body.appendChild(menu);
    positionListItemMenu(menu, anchor);
    activeListItemMenu = menu;
}

async function moveListItemsToSection(itemIds, sectionId) {
    if (!itemIds.length || !sectionId) return;
    const orderIds = buildListReorderIdsForSection(itemIds, sectionId);
    if (!orderIds) return;
    await reorderListItems(orderIds);
    await loadListItems();
}

function openListBulkMoveMenu(anchor) {
    const selectedIds = getSelectedListItemIds();
    if (!selectedIds.length) return;
    const sections = getListSectionOptions();
    if (!sections.length) {
        showToast('No sections yet. Type /section to add one.', 'warning', 2500);
        return;
    }
    closeListItemMenu();
    const menu = document.createElement('div');
    menu.className = 'list-item-menu active';
    menu.dataset.mode = 'bulk';

    const title = document.createElement('div');
    title.className = 'list-item-menu-title';
    title.textContent = 'Move selected to section';
    menu.appendChild(title);

    const topBtn = document.createElement('button');
    topBtn.type = 'button';
    topBtn.className = 'list-item-menu-option';
    topBtn.dataset.action = 'top';
    topBtn.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
    const topLabel = document.createElement('span');
    topLabel.textContent = 'Top (no section)';
    topBtn.appendChild(topLabel);
    menu.appendChild(topBtn);

    sections.forEach(section => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'list-item-menu-option';
        btn.dataset.sectionId = section.id;
        btn.innerHTML = '<i class="fa-solid fa-layer-group"></i>';
        const label = document.createElement('span');
        label.textContent = section.title;
        btn.appendChild(label);
        menu.appendChild(btn);
    });

    menu.querySelectorAll('.list-item-menu-option').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            closeListItemMenu();
            const action = btn.dataset.action;
            const sectionId = btn.dataset.sectionId ? parseInt(btn.dataset.sectionId, 10) : null;
            try {
                if (action === 'top') {
                    const orderIds = buildListReorderIdsToTop(selectedIds);
                    await reorderListItems(orderIds);
                    await loadListItems();
                } else if (sectionId) {
                    await moveListItemsToSection(selectedIds, sectionId);
                }
                setListSelectionMode(false);
            } catch (err) {
                console.error('Bulk move failed:', err);
                showToast('Could not move items', 'error');
            }
        });
    });

    document.body.appendChild(menu);
    positionListItemMenu(menu, anchor);
    activeListItemMenu = menu;
}

function positionBulkMenu(menu, button) {
    const rect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const padding = 8;
    let topPos = rect.bottom + padding;
    if (window.innerHeight - rect.bottom < menuRect.height + padding && rect.top > menuRect.height + padding) {
        topPos = rect.top - menuRect.height - padding;
    }
    let leftPos = rect.right - menuRect.width;
    if (leftPos < padding) leftPos = padding;
    if (leftPos + menuRect.width > window.innerWidth - padding) {
        leftPos = window.innerWidth - menuRect.width - padding;
    }
    menu.style.top = `${topPos}px`;
    menu.style.left = `${leftPos}px`;
}

function createSectionFromSelection() {
    const selectedIds = getSelectedListItemIds();
    if (!selectedIds.length) return;
    const sorted = getSortedListItems();
    const orderedSelected = sorted.filter(item => selectedIds.includes(item.id));
    const targetSectionId = null;
    openListSectionModal(async (value) => {
        try {
            const section = await createListItem({ text: buildListSectionText(value || '') }, null);
            await loadListItems();
            if (section && section.id) {
                const orderIds = buildListReorderIdsForNewSection(
                    orderedSelected.map(item => item.id),
                    section.id,
                    targetSectionId
                );
                await reorderListItems(orderIds);
                await loadListItems();
            }
            setListSelectionMode(false);
        } catch (err) {
            console.error('Create section failed:', err);
            showToast('Could not create section', 'error');
        }
    });
}

function deleteSelectedListItems() {
    const selectedIds = getSelectedListItemIds();
    if (!selectedIds.length) return;
    openConfirmModal(`Delete ${selectedIds.length} item(s)?`, async () => {
        try {
            await Promise.all(selectedIds.map(id => deleteListItem(id)));
            await loadListItems();
            setListSelectionMode(false);
            showToast('Deleted', 'success', 2000);
        } catch (err) {
            console.error('Bulk delete failed:', err);
            showToast('Could not delete items', 'error');
        }
    });
}

document.addEventListener('click', (e) => {
    if (activeListItemMenu && !e.target.closest('.list-item-menu')) {
        closeListItemMenu();
    }
    if (activeListItemActionPill && !e.target.closest('.list-pill')) {
        clearListItemActions();
    }
});

function renderListItems() {
    const stack = document.getElementById('list-pill-stack');
    if (!stack) return;
    if (listState.isArchived) {
        listState.insertionIndex = null;
        listState.editingItemId = null;
    }
    closeListItemMenu();
    clearListItemActions();
    const items = getSortedListItems();
    const searchQuery = (listSearchState.query || '').trim();
    const searchLower = searchQuery.toLowerCase();
    stack.innerHTML = '';
    const hasSections = items.some(isListSectionItem);
    let activeSectionBody = null;
    let renderedCount = 0;

    const doesListItemMatch = (item) => {
        if (!searchLower) return true;
        if (isListSectionItem(item)) {
            const sectionTitle = getListSectionTitle(item) || '';
            return sectionTitle.toLowerCase().includes(searchLower);
        }
        const textValue = (item.text || '').toLowerCase();
        const linkLabel = (item.link_text || '').toLowerCase();
        const noteValue = (item.note || '').toLowerCase();
        return textValue.includes(searchLower) || linkLabel.includes(searchLower) || noteValue.includes(searchLower);
    };

    let sectionMatches = null;
    if (searchLower && hasSections) {
        sectionMatches = new Map();
        let currentSectionId = null;
        let currentSectionMatch = false;
        for (const item of items) {
            if (isListSectionItem(item)) {
                if (currentSectionId !== null) {
                    sectionMatches.set(currentSectionId, currentSectionMatch);
                }
                currentSectionId = item.id;
                currentSectionMatch = doesListItemMatch(item);
            } else if (currentSectionId !== null && doesListItemMatch(item)) {
                currentSectionMatch = true;
            }
        }
        if (currentSectionId !== null) {
            sectionMatches.set(currentSectionId, currentSectionMatch);
        }
    }

    const appendInsertionRow = (insertIndex, target) => {
        if (listState.isArchived || searchLower) return;
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
            if (searchLower && sectionMatches && !sectionMatches.get(item.id) && !doesListItemMatch(item)) {
                activeSectionBody = null;
                return;
            }
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
                    appendHighlightedText(header, title, listSearchState.query);
                } else {
                    header.classList.add('empty');
                }
                header.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (listState.isArchived) {
                        showReadOnlyToast();
                        return;
                    }
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
        if (searchLower && !doesListItemMatch(item)) {
            return;
        }
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
        renderedCount += 1;
        const gapIndex = index + 1;
        if (!listState.isArchived && !searchLower) {
            target.appendChild(createListGap(gapIndex));
            appendInsertionRow(gapIndex, target);
        }
    });

    if (!listState.isArchived && !searchLower) {
        const primaryTarget = activeSectionBody || stack;
        primaryTarget.appendChild(createListInputRow({
            mode: 'new',
            insertIndex: items.length,
            placeholder: 'Add item... (use /section to split)',
            isPrimary: true
        }));
    }

    if (searchLower && renderedCount === 0) {
        const empty = document.createElement('div');
        empty.className = 'notes-empty-state';
        empty.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i><p>No results</p>';
        stack.appendChild(empty);
    }
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

const LIST_NOTE_LINK_PATTERN = /\[\[([^\]\n]+)\]\]|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g;

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function appendHighlightedText(target, text, query) {
    const raw = String(text || '');
    const trimmedQuery = (query || '').trim();
    if (!trimmedQuery) {
        target.appendChild(document.createTextNode(raw));
        return;
    }
    const pattern = new RegExp(escapeRegExp(trimmedQuery), 'gi');
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(raw)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (start > lastIndex) {
            target.appendChild(document.createTextNode(raw.slice(lastIndex, start)));
        }
        const hit = document.createElement('span');
        hit.className = 'list-search-hit';
        hit.textContent = raw.slice(start, end);
        target.appendChild(hit);
        lastIndex = end;
    }
    if (lastIndex < raw.length) {
        target.appendChild(document.createTextNode(raw.slice(lastIndex)));
    }
}

function appendListNoteTextWithLinks(target, text) {
    const lines = String(text || '').split('\n');
    lines.forEach((line, lineIndex) => {
        if (lineIndex > 0) target.appendChild(document.createElement('br'));
        appendListNoteLineWithLinks(target, line);
    });
}

function appendListNoteLineWithLinks(target, line) {
    LIST_NOTE_LINK_PATTERN.lastIndex = 0;
    let lastIndex = 0;
    for (const match of line.matchAll(LIST_NOTE_LINK_PATTERN)) {
        const matchIndex = match.index ?? 0;
        if (matchIndex > lastIndex) {
            appendHighlightedText(target, line.slice(lastIndex, matchIndex), listSearchState.query);
        }
        if (match[1]) {
            const title = match[1].trim();
            if (title) {
                const link = document.createElement('a');
                link.className = 'note-link';
                link.dataset.noteTitle = title;
                link.setAttribute('href', '#');
                appendHighlightedText(link, title, listSearchState.query);
                target.appendChild(link);
            } else {
                appendHighlightedText(target, match[0], listSearchState.query);
            }
        } else if (match[2] && match[3]) {
            const label = match[2].trim();
            const url = match[3].trim();
            if (label && url) {
                const link = document.createElement('a');
                link.className = 'external-link';
                link.setAttribute('href', url);
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener noreferrer');
                appendHighlightedText(link, label, listSearchState.query);
                target.appendChild(link);
            } else {
                appendHighlightedText(target, match[0], listSearchState.query);
            }
        } else {
            appendHighlightedText(target, match[0], listSearchState.query);
        }
        lastIndex = matchIndex + match[0].length;
    }
    if (lastIndex < line.length) {
        appendHighlightedText(target, line.slice(lastIndex), listSearchState.query);
    }
}

function createListPill(item) {
    const pill = document.createElement('div');
    const hasNote = !!(item.note && item.note.trim());
    const isExpanded = hasNote && listState.expandedItemId === item.id;
    const isSelected = listSelectionState.ids.has(item.id);
    pill.className = `list-pill${hasNote ? ' has-note' : ''}${isExpanded ? ' expanded' : ''}${isSelected ? ' selected' : ''}`;
    pill.dataset.itemId = item.id;
    const content = document.createElement('div');
    content.className = 'list-pill-content';
    const textValue = (item.text || '').trim();
    const linkLabel = (item.link_text || '').trim();
    const linkUrl = (item.link_url || '').trim();
    const linkSameAsText = linkLabel && textValue && linkLabel === textValue;
    const searchQuery = (listSearchState.query || '').trim();
    const searchLower = searchQuery.toLowerCase();
    const noteHasMatch = !!(searchLower && item.note && item.note.toLowerCase().includes(searchLower));

    if (listState.checkboxMode) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'list-checkbox';
        checkbox.checked = !!item.checked;
        checkbox.disabled = listState.isArchived;
        checkbox.addEventListener('click', (e) => e.stopPropagation());
        checkbox.addEventListener('change', async () => {
            if (listState.isArchived) {
                showReadOnlyToast();
                checkbox.checked = !!item.checked;
                return;
            }
            await updateListItem(item.id, { checked: checkbox.checked }, { refresh: true });
        });
        pill.appendChild(checkbox);
    }

    if (!linkSameAsText && textValue) {
        const textSpan = document.createElement('span');
        appendHighlightedText(textSpan, textValue, searchQuery);
        content.appendChild(textSpan);
    }

    if (linkLabel && linkUrl) {
        const link = document.createElement('a');
        link.href = linkUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        appendHighlightedText(link, linkLabel, searchQuery);
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
        appendListNoteTextWithLinks(note, item.note);
        note.style.display = isExpanded || noteHasMatch ? 'block' : 'none';
        note.addEventListener('click', (e) => {
            if (isListSelectionActive()) return;
            const noteLink = e.target.closest('a.note-link');
            const externalLink = e.target.closest('a.external-link');
            if (!noteLink && !externalLink) return;
            e.stopPropagation();
            e.preventDefault();
            if (externalLink) {
                const href = externalLink.getAttribute('href') || '';
                if (href) window.open(href, '_blank', 'noopener,noreferrer');
                return;
            }
            handleListNoteLinkClick(noteLink);
        });
        pill.appendChild(note);
    }

    const actions = document.createElement('div');
    actions.className = 'list-pill-actions';
    const moveBtn = document.createElement('button');
    moveBtn.type = 'button';
    moveBtn.className = 'list-pill-action';
    moveBtn.title = 'Move to section';
    moveBtn.innerHTML = '<i class="fa-solid fa-layer-group"></i>';
    moveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isListSelectionActive()) return;
        if (listState.isArchived) {
            showReadOnlyToast();
            return;
        }
        showListItemActions(pill);
        openListItemMoveMenu(item.id, moveBtn);
    });
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'list-pill-action danger';
    deleteBtn.title = 'Delete item';
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isListSelectionActive()) return;
        if (listState.isArchived) {
            showReadOnlyToast();
            return;
        }
        openConfirmModal('Delete this item?', async () => {
            try {
                await deleteListItem(item.id);
                await loadListItems();
                showToast('Deleted', 'success', 2000);
            } catch (err) {
                console.error('Delete list item failed:', err);
                showToast('Could not delete item', 'error');
            }
        });
    });
    actions.appendChild(moveBtn);
    actions.appendChild(deleteBtn);
    pill.appendChild(actions);

    let longPressTimer = null;
    let longPressTriggered = false;
    let ignoreClick = false;
    const supportsTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
    const longPressMs = 450;
    const clearLongPress = () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    };
    let touchMoveHandler = null;
    const handleTouchStart = (e) => {
        if (listState.isArchived) {
            showReadOnlyToast();
            return;
        }
        if (!supportsTouch || isListSelectionActive()) return;
        const touch = e.touches && e.touches[0];
        if (!touch) return;
        let startX = touch.clientX;
        let startY = touch.clientY;
        longPressTriggered = false;
        clearLongPress();
        longPressTimer = setTimeout(() => {
            longPressTriggered = true;
            ignoreClick = true;
            showListItemActions(pill);
        }, longPressMs);
        touchMoveHandler = (moveEvent) => {
            const moveTouch = moveEvent.touches && moveEvent.touches[0];
            if (!moveTouch) return;
            if (Math.abs(moveTouch.clientX - startX) > 10 || Math.abs(moveTouch.clientY - startY) > 10) {
                clearLongPress();
                if (touchMoveHandler) {
                    pill.removeEventListener('touchmove', touchMoveHandler);
                    touchMoveHandler = null;
                }
            }
        };
        pill.addEventListener('touchmove', touchMoveHandler, { passive: true });
    };
    const handleTouchEnd = () => {
        if (!supportsTouch || isListSelectionActive()) return;
        clearLongPress();
        if (touchMoveHandler) {
            pill.removeEventListener('touchmove', touchMoveHandler);
            touchMoveHandler = null;
        }
        longPressTriggered = false;
    };
    pill.addEventListener('touchstart', handleTouchStart, { passive: true });
    pill.addEventListener('touchend', handleTouchEnd);
    pill.addEventListener('touchcancel', handleTouchEnd);

    pill.addEventListener('click', () => {
        if (ignoreClick) {
            ignoreClick = false;
            return;
        }
        if (isListSelectionActive()) return;
        if (listState.isArchived) {
            if (hasNote) {
                listState.expandedItemId = listState.expandedItemId === item.id ? null : item.id;
                listState.editingItemId = null;
                listState.insertionIndex = null;
                renderListItems();
            } else {
                showReadOnlyToast();
            }
            return;
        }
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

    input.addEventListener('paste', async (e) => {
        if (mode === 'edit' || isSection) return;
        const pasteText = (e.clipboardData || window.clipboardData)?.getData('text') || '';
        if (!pasteText.includes('\n')) return;
        const validation = validateBulkListLines(pasteText);
        if (!validation.ok) {
            e.preventDefault();
            showToast(validation.error || 'Paste does not fit list criteria.', 'warning', 2500);
            return;
        }
        e.preventDefault();
        const lines = validation.lines || [];
        if (!lines.length) return;

        try {
            if (mode === 'insert' && insertIndex !== null && insertIndex !== undefined) {
                let idx = insertIndex;
                for (const line of lines) {
                    const parsed = parseListItemInput(line);
                    if (!parsed.text) continue;
                    await createListItem(parsed, idx);
                    idx += 1;
                }
                listState.insertionIndex = insertIndex + lines.length;
                listState.editingItemId = null;
                await loadListItems();
                return;
            }

            for (const line of lines) {
                const parsed = parseListItemInput(line);
                if (!parsed.text) continue;
                await createListItem(parsed, null);
            }
            if (isPrimary) {
                listState.insertionIndex = null;
                listState.editingItemId = null;
                await loadListItems({ focusPrimary: true });
            } else {
                resetListInputState();
            }
        } catch (err) {
            console.error('Bulk paste failed:', err);
            showToast('Could not add pasted items.', 'error');
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

const NOTE_LIST_CONVERSION_RULES = {
    minLines: 2,
    maxLines: 100,
    maxChars: 80,
    maxWords: 12,
    maxWordsWithPunct: 8
};

function validateBulkListLines(rawText) {
    const text = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rawLines = text.split('\n').map(line => line.trim()).filter(Boolean);
    if (rawLines.length < NOTE_LIST_CONVERSION_RULES.minLines) {
        return { ok: false, error: `Need at least ${NOTE_LIST_CONVERSION_RULES.minLines} non-empty lines.` };
    }

    const cleanedLines = rawLines.map(line => {
        let next = line;
        next = next.replace(/^\s*\[[xX ]\]\s+/, '');
        next = next.replace(/^\s*(?:[-*+]|\d+[.)]|\d+\s*[-:]|[A-Za-z][.)])\s+/, '');
        next = next.replace(/\s+/g, ' ').trim();
        return next;
    }).filter(Boolean);

    if (cleanedLines.length < NOTE_LIST_CONVERSION_RULES.minLines) {
        return { ok: false, error: `Need at least ${NOTE_LIST_CONVERSION_RULES.minLines} non-empty lines.` };
    }
    if (cleanedLines.length > NOTE_LIST_CONVERSION_RULES.maxLines) {
        return { ok: false, error: `Too many lines to convert (max ${NOTE_LIST_CONVERSION_RULES.maxLines}).` };
    }

    for (const line of cleanedLines) {
        if (line.length > NOTE_LIST_CONVERSION_RULES.maxChars) {
            return { ok: false, error: `Lines must be ${NOTE_LIST_CONVERSION_RULES.maxChars} characters or fewer.` };
        }
        const words = line.match(/[A-Za-z0-9']+/g) || [];
        if (words.length > NOTE_LIST_CONVERSION_RULES.maxWords) {
            return { ok: false, error: `Lines must be ${NOTE_LIST_CONVERSION_RULES.maxWords} words or fewer.` };
        }
        const sentenceMarks = line.match(/[.!?]/g) || [];
        if (sentenceMarks.length > 1) {
            return { ok: false, error: 'Lines must be single phrases, not multiple sentences.' };
        }
        if (sentenceMarks.length === 1 && words.length > NOTE_LIST_CONVERSION_RULES.maxWordsWithPunct) {
            return { ok: false, error: `Lines must be short phrases (max ${NOTE_LIST_CONVERSION_RULES.maxWordsWithPunct} words if punctuated).` };
        }
    }

    return { ok: true, lines: cleanedLines };
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
    const created = await res.json().catch(() => null);
    const updatedLabel = document.getElementById('list-updated-label');
    if (updatedLabel) updatedLabel.textContent = formatNoteDate(new Date().toISOString());
    return created;
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

function closeListDuplicatesModal() {
    const modal = document.getElementById('list-duplicates-modal');
    if (modal) modal.classList.remove('active');
}

function updateListDuplicatesSubtitle() {
    const subtitle = document.getElementById('list-duplicates-subtitle');
    if (!subtitle) return;
    if (listDuplicateState.method === 'embeddings') {
        subtitle.textContent = 'AI similarity scan (embedding-based). Review matches before deleting.';
    } else if (listDuplicateState.method === 'fuzzy') {
        subtitle.textContent = 'Fuzzy text scan. Review matches before deleting.';
    } else {
        subtitle.textContent = 'Scan your list for possible duplicates.';
    }
}

function updateListDuplicatesDeleteButton() {
    const btn = document.getElementById('list-duplicates-delete-selected-btn');
    if (!btn) return;
    const count = listDuplicateState.selectedIds.size;
    btn.disabled = count === 0;
    btn.textContent = count ? `Delete selected (${count})` : 'Delete selected';
}

function removeDuplicateItemFromState(itemId) {
    const nextGroups = [];
    listDuplicateState.groups.forEach(group => {
        const remaining = group.items.filter(item => item.id !== itemId);
        if (remaining.length > 1) {
            nextGroups.push({ ...group, items: remaining });
        }
    });
    listDuplicateState.groups = nextGroups;
}

function removeDuplicateSelectionsFromState(itemIds) {
    const removeSet = new Set(itemIds);
    listDuplicateState.selectedIds = new Set(
        Array.from(listDuplicateState.selectedIds).filter(id => !removeSet.has(id))
    );
    removeSet.forEach(id => removeDuplicateItemFromState(id));
    updateListDuplicatesDeleteButton();
}

function renderListDuplicates() {
    const list = document.getElementById('list-duplicates-list');
    if (!list) return;
    list.innerHTML = '';
    updateListDuplicatesSubtitle();
    updateListDuplicatesDeleteButton();
    if (!listDuplicateState.groups.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = '<p style="color: var(--text-muted); margin: 0;">No duplicates found.</p>';
        list.appendChild(empty);
        return;
    }

    listDuplicateState.groups.forEach((group, index) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'list-duplicates-group';
        const title = document.createElement('div');
        title.className = 'list-duplicates-group-title';
        const label = group.representative || `Group ${index + 1}`;
        title.textContent = label;
        groupEl.appendChild(title);

        group.items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'list-duplicates-item';
            const left = document.createElement('div');
            left.className = 'list-duplicates-item-left';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = listDuplicateState.selectedIds.has(item.id);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    listDuplicateState.selectedIds.add(item.id);
                } else {
                    listDuplicateState.selectedIds.delete(item.id);
                }
                updateListDuplicatesDeleteButton();
            });
            left.appendChild(checkbox);
            const main = document.createElement('div');
            main.className = 'list-duplicates-item-main';
            const text = document.createElement('div');
            const baseText = (item.text || '').trim();
            let display = baseText || '';
            if (item.link_text && item.link_url) {
                if (baseText && baseText !== item.link_text) {
                    display = `${baseText} (${item.link_text})`;
                } else {
                    display = item.link_text;
                }
            }
            text.textContent = display || '(Untitled item)';
            if (item.section) {
                const section = document.createElement('span');
                section.className = 'list-duplicates-item-section';
                section.textContent = `• ${item.section}`;
                text.appendChild(section);
            }
            main.appendChild(text);
            if (item.note) {
                const note = document.createElement('div');
                note.className = 'list-duplicates-item-note';
                note.textContent = item.note;
                main.appendChild(note);
            }
            left.appendChild(main);
            row.appendChild(left);

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'btn btn-danger btn-icon';
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openConfirmModal('Delete this duplicate item?', async () => {
                    try {
                        await deleteListItem(item.id);
                        removeDuplicateItemFromState(item.id);
                        listDuplicateState.selectedIds.delete(item.id);
                        updateListDuplicatesDeleteButton();
                        renderListDuplicates();
                        await loadListItems();
                        showToast('Deleted', 'success', 2000);
                    } catch (err) {
                        console.error('Duplicate delete failed:', err);
                        showToast('Could not delete item', 'error');
                    }
                });
            });
            row.appendChild(deleteBtn);
            groupEl.appendChild(row);
        });
        list.appendChild(groupEl);
    });
}

async function deleteSelectedDuplicateItems() {
    if (!listDuplicateState.selectedIds.size) return;
    const ids = Array.from(listDuplicateState.selectedIds);
    openConfirmModal(`Delete ${ids.length} selected item(s)?`, async () => {
        const deleted = [];
        for (const itemId of ids) {
            try {
                await deleteListItem(itemId);
                deleted.push(itemId);
            } catch (err) {
                console.error('Duplicate bulk delete failed:', err);
                showToast('Could not delete some items', 'error');
                break;
            }
        }
        if (deleted.length) {
            removeDuplicateSelectionsFromState(deleted);
            renderListDuplicates();
            await loadListItems();
            showToast('Deleted', 'success', 2000);
            closeListDuplicatesModal();
        }
    });
}

async function openListDuplicatesModal() {
    if (!listState.listId) return;
    if (listState.isArchived) {
        showReadOnlyToast();
        return;
    }
    const modal = document.getElementById('list-duplicates-modal');
    const list = document.getElementById('list-duplicates-list');
    if (!modal || !list) return;
    modal.classList.add('active');
    list.innerHTML = '<div class="empty-state"><p style="color: var(--text-muted); margin: 0;">Scanning list...</p></div>';
    listDuplicateState.groups = [];
    listDuplicateState.method = null;
    listDuplicateState.threshold = null;
    listDuplicateState.selectedIds = new Set();
    updateListDuplicatesSubtitle();
    updateListDuplicatesDeleteButton();

    try {
        const res = await fetch(`/api/notes/${listState.listId}/list-items/duplicates`);
        if (!res.ok) throw new Error('Failed to scan');
        const data = await res.json();
        listDuplicateState.groups = data.groups || [];
        listDuplicateState.method = data.method || null;
        listDuplicateState.threshold = data.threshold || null;
        renderListDuplicates();
    } catch (err) {
        console.error('Duplicate scan failed:', err);
        list.innerHTML = '<div class="empty-state"><p style="color: var(--text-muted); margin: 0;">Could not scan for duplicates.</p></div>';
    }
}

function bootListEditorPage() {
    if (!document.getElementById('list-editor-page')) return;
    ensureListEditorDependencies()
        .catch((e) => {
            console.warn('Failed to load list editor dependencies:', e);
        })
        .finally(() => {
            initListEditorPage();
        });
}

if (document.readyState === 'complete') {
    bootListEditorPage();
} else {
    document.addEventListener('DOMContentLoaded', bootListEditorPage, { once: true });
}

function loadListEditorScriptOnce(url, marker) {
    const existing = document.querySelector(`script[data-list-editor-dep="${marker}"]`);
    if (existing) {
        return new Promise((resolve, reject) => {
            existing.addEventListener('load', resolve, { once: true });
            existing.addEventListener('error', reject, { once: true });
        });
    }
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.defer = true;
        script.dataset.listEditorDep = marker;
        script.addEventListener('load', resolve, { once: true });
        script.addEventListener('error', reject, { once: true });
        document.head.appendChild(script);
    });
}

async function ensureListEditorDependencies() {
    const hasDetailHelpers = typeof window.formatNoteDate === 'function';
    if (!hasDetailHelpers) {
        await loadListEditorScriptOnce('/static/notes/detail.js', 'detail');
    }

    const hasEditorHelpers =
        typeof window.updateListVisibilityButton === 'function' &&
        typeof window.setListVisibilityButtonEnabled === 'function' &&
        typeof window.shouldAllowListVisibilityToggle === 'function' &&
        typeof window.toggleListVisibility === 'function';
    if (!hasEditorHelpers) {
        await loadListEditorScriptOnce('/static/notes/editor.js', 'editor');
    }
}

