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
    const sectionReorderToggleBtn = document.getElementById('list-section-reorder-toggle');
    const sectionReorderDoneBtn = document.getElementById('list-section-reorder-done-btn');
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
    const itemNoteModal = document.getElementById('list-item-note-modal');
    const itemNoteToolbar = document.getElementById('list-item-note-toolbar');
    const itemNoteInput = document.getElementById('list-item-note-input');
    const itemNoteSaveBtn = document.getElementById('list-item-note-save-btn');
    const itemNoteCancelBtn = document.getElementById('list-item-note-cancel-btn');
    const itemNoteClearBtn = document.getElementById('list-item-note-clear-btn');
    const itemDateModal = document.getElementById('list-item-date-modal');
    const itemDateInput = document.getElementById('list-item-date-input');
    const itemDateSaveBtn = document.getElementById('list-item-date-save-btn');
    const itemDateCancelBtn = document.getElementById('list-item-date-cancel-btn');
    const itemDateClearBtn = document.getElementById('list-item-date-clear-btn');

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
    if (sectionReorderToggleBtn) sectionReorderToggleBtn.addEventListener('click', () => toggleListSectionReorderMode());
    if (sectionReorderDoneBtn) sectionReorderDoneBtn.addEventListener('click', () => setListSectionReorderMode(false));
    if (searchToggleBtn) {
        searchToggleBtn.addEventListener('click', () => {
            if (!searchBar) return;
            const nextOpen = searchBar.style.display === 'none' || searchBar.style.display === '';
            searchBar.style.display = nextOpen ? 'flex' : 'none';
            searchToggleBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
            if (nextOpen && listState.sectionReorderMode) {
                setListSectionReorderMode(false);
            }
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
        const repositionOpenBulkMenu = () => {
            if (!bulkMoreMenu.classList.contains('open')) return;
            positionBulkMenu(bulkMoreMenu, bulkMoreToggle);
        };
        window.addEventListener('resize', repositionOpenBulkMenu, { passive: true });
        window.addEventListener('scroll', repositionOpenBulkMenu, { passive: true });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', repositionOpenBulkMenu, { passive: true });
            window.visualViewport.addEventListener('scroll', repositionOpenBulkMenu, { passive: true });
        }
    }
    const repositionOpenListItemMenu = () => {
        if (!activeListItemMenu || !activeListItemMenuAnchor) return;
        if (!document.body.contains(activeListItemMenu) || !document.body.contains(activeListItemMenuAnchor)) return;
        positionListItemMenu(activeListItemMenu, activeListItemMenuAnchor);
    };
    window.addEventListener('resize', repositionOpenListItemMenu, { passive: true });
    window.addEventListener('scroll', repositionOpenListItemMenu, { passive: true });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', repositionOpenListItemMenu, { passive: true });
        window.visualViewport.addEventListener('scroll', repositionOpenListItemMenu, { passive: true });
    }
    if (sectionSaveBtn) sectionSaveBtn.addEventListener('click', () => submitListSectionModal());
    if (sectionCancelBtn) sectionCancelBtn.addEventListener('click', () => closeListSectionModal());
    if (duplicatesCloseBtn) duplicatesCloseBtn.addEventListener('click', () => closeListDuplicatesModal());
    if (duplicatesDeleteSelectedBtn) duplicatesDeleteSelectedBtn.addEventListener('click', () => deleteSelectedDuplicateItems());
    if (itemNoteSaveBtn) itemNoteSaveBtn.addEventListener('click', () => saveListItemInnerNote());
    if (itemNoteCancelBtn) itemNoteCancelBtn.addEventListener('click', () => closeListItemNoteModal());
    if (itemNoteClearBtn) itemNoteClearBtn.addEventListener('click', () => clearListItemInnerNote());
    if (itemDateSaveBtn) itemDateSaveBtn.addEventListener('click', () => saveListItemScheduledDate());
    if (itemDateCancelBtn) itemDateCancelBtn.addEventListener('click', () => closeListItemDateModal());
    if (itemDateClearBtn) itemDateClearBtn.addEventListener('click', () => clearListItemScheduledDate());
    if (itemNoteToolbar) {
        itemNoteToolbar.querySelectorAll('[data-list-note-command]').forEach((btn) => {
            btn.addEventListener('mousedown', (e) => e.preventDefault());
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                applyListInnerNoteCommand(btn.dataset.listNoteCommand);
            });
        });
    }
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            if ((searchInput.value || '').trim() && listState.sectionReorderMode) {
                setListSectionReorderMode(false);
            }
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
    if (itemNoteModal) {
        itemNoteModal.addEventListener('click', (e) => {
            if (e.target === itemNoteModal) closeListItemNoteModal();
        });
    }
    if (itemDateModal) {
        itemDateModal.addEventListener('click', (e) => {
            if (e.target === itemDateModal) closeListItemDateModal();
        });
    }
    if (itemNoteInput) {
        itemNoteInput.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
                const key = e.key.toLowerCase();
                if (key === 'b') {
                    e.preventDefault();
                    applyListInnerNoteCommand('bold');
                    return;
                }
                if (key === 'i') {
                    e.preventDefault();
                    applyListInnerNoteCommand('italic');
                    return;
                }
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                saveListItemInnerNote();
            }
        });
    }
    if (itemDateInput) {
        itemDateInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveListItemScheduledDate();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeListItemDateModal();
            }
        });
    }
    document.addEventListener('keydown', handleListEditorModalKeydown);

    // Check PIN status
    checkPinStatus();
    checkNotesPinStatus();
    if (typeof window.setupNoteLinkModalControls === 'function') {
        window.setupNoteLinkModalControls();
    }
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
            if (listState.sectionReorderMode) return;
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
    updateListSectionReorderUI();
    loadListForEditor(listId);
}

function setListEditorReadOnly(isReadOnly) {
    const titleInput = document.getElementById('list-title');
    const checkboxToggle = document.getElementById('list-checkbox-toggle');
    const saveBtn = document.getElementById('list-save-btn');
    const cancelBtn = document.getElementById('list-cancel-btn');
    const selectToggle = document.getElementById('list-select-toggle');
    const sectionReorderToggleBtn = document.getElementById('list-section-reorder-toggle');
    const sectionReorderDoneBtn = document.getElementById('list-section-reorder-done-btn');
    const bulkBar = document.getElementById('list-bulk-bar');
    if (titleInput) titleInput.disabled = isReadOnly;
    if (checkboxToggle) checkboxToggle.disabled = isReadOnly;
    if (saveBtn) saveBtn.disabled = isReadOnly;
    if (cancelBtn) cancelBtn.disabled = isReadOnly || !hasListSessionChanges();
    if (selectToggle) selectToggle.disabled = isReadOnly;
    if (sectionReorderToggleBtn) sectionReorderToggleBtn.disabled = isReadOnly;
    if (sectionReorderDoneBtn) sectionReorderDoneBtn.disabled = isReadOnly;
    if (bulkBar && isReadOnly) bulkBar.classList.remove('active');
    if (isReadOnly) setListSelectionMode(false);
    if (isReadOnly) setListSectionReorderMode(false);
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
        listState.collapsedSectionIds = new Set();
        listState.sectionReorderMode = false;
        restoreCollapsedListSections();
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
        updateListSectionReorderUI();
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
        const dateValue = normalizeListDateValue(item.scheduled_date);
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

        if (dateValue) {
            const label = formatListScheduledDate(dateValue) || dateValue;
            line = line ? `${line} [${label}]` : `[${label}]`;
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
const SECTION_DRAG_CLICK_SUPPRESS_MS = 250;
const SECTION_DRAG_AUTOSCROLL_EDGE_PX = 72;
const SECTION_DRAG_AUTOSCROLL_STEP_PX = 20;
let listSectionReorderState = {
    dragSectionId: null,
    overSectionId: null,
    dropPosition: null,
    suppressClicksUntil: 0,
    dragPreviewEl: null
};
let listItemNoteModalState = { itemId: null };
let listItemDateModalState = { itemId: null };
let activeListItemMenuAnchor = null;

function ensureCollapsedSectionSet() {
    if (!(listState.collapsedSectionIds instanceof Set)) {
        listState.collapsedSectionIds = new Set();
    }
    return listState.collapsedSectionIds;
}

function getListCollapsedSectionsKey() {
    if (!listState.listId) return '';
    return `notes_list_collapsed_sections_${listState.listId}`;
}

function persistCollapsedListSections() {
    const key = getListCollapsedSectionsKey();
    if (!key) return;
    try {
        const values = Array.from(ensureCollapsedSectionSet());
        sessionStorage.setItem(key, JSON.stringify(values));
    } catch (err) {
        console.warn('Could not persist collapsed sections:', err);
    }
}

function restoreCollapsedListSections() {
    const key = getListCollapsedSectionsKey();
    listState.collapsedSectionIds = new Set();
    if (!key) return;
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        listState.collapsedSectionIds = new Set(
            parsed
                .map(value => parseInt(value, 10))
                .filter(value => Number.isFinite(value) && value > 0)
        );
    } catch (err) {
        console.warn('Could not restore collapsed sections:', err);
        listState.collapsedSectionIds = new Set();
    }
}

function cleanCollapsedListSections(sectionIds) {
    const validIds = new Set(sectionIds || []);
    const collapsed = ensureCollapsedSectionSet();
    let changed = false;
    for (const id of Array.from(collapsed)) {
        if (!validIds.has(id)) {
            collapsed.delete(id);
            changed = true;
        }
    }
    if (changed) persistCollapsedListSections();
}

function toggleListSectionCollapsed(sectionId) {
    if (!sectionId || listSearchState.query) return;
    const collapsed = ensureCollapsedSectionSet();
    if (collapsed.has(sectionId)) {
        collapsed.delete(sectionId);
    } else {
        collapsed.add(sectionId);
    }
    persistCollapsedListSections();
    renderListItems();
}

function getListSectionItemCount(sectionId, sortedItems) {
    const items = sortedItems || getSortedListItems();
    const sectionIndex = items.findIndex(item => item.id === sectionId);
    if (sectionIndex === -1) return 0;
    let count = 0;
    for (let i = sectionIndex + 1; i < items.length; i += 1) {
        if (isListSectionItem(items[i])) break;
        count += 1;
    }
    return count;
}

function getListItemById(itemId) {
    if (!itemId) return null;
    return (listState.items || []).find(item => item.id === itemId) || null;
}

function normalizeListDateValue(raw) {
    const str = String(raw || '').trim();
    if (!str) return null;
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
}

function getListDateOnly(raw) {
    const value = normalizeListDateValue(raw);
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
}

function isListDatePast(raw) {
    const date = getListDateOnly(raw);
    if (!date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date.getTime() < today.getTime();
}

function isListDateToday(raw) {
    const date = getListDateOnly(raw);
    if (!date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date.getTime() === today.getTime();
}

function formatListScheduledDate(raw) {
    const date = getListDateOnly(raw);
    if (!date) return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.getTime() === today.getTime()) return 'Today';
    if (date.getTime() === tomorrow.getTime()) return 'Tomorrow';

    const diffDays = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 0 && diffDays <= 7) {
        return date.toLocaleDateString('en-US', { weekday: 'long' });
    }
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
    });
}

function closeListItemNoteModal() {
    const modal = document.getElementById('list-item-note-modal');
    if (modal) modal.classList.remove('active');
    listItemNoteModalState.itemId = null;
}

function openListItemNoteModal(itemId) {
    const item = getListItemById(itemId);
    const modal = document.getElementById('list-item-note-modal');
    const toolbar = document.getElementById('list-item-note-toolbar');
    const titleEl = document.getElementById('list-item-note-title');
    const subtitleEl = document.getElementById('list-item-note-subtitle');
    const input = document.getElementById('list-item-note-input');
    const saveBtn = document.getElementById('list-item-note-save-btn');
    const clearBtn = document.getElementById('list-item-note-clear-btn');
    if (!item || !modal || !titleEl || !subtitleEl || !input) return;

    listItemNoteModalState.itemId = itemId;
    const title = (item.text || '').trim() || 'Untitled item';
    titleEl.textContent = 'Inner Note';
    subtitleEl.textContent = title;
    input.value = item.inner_note || '';
    const isReadOnly = !!listState.isArchived;
    input.readOnly = isReadOnly;
    if (saveBtn) saveBtn.disabled = isReadOnly;
    if (clearBtn) clearBtn.disabled = isReadOnly;
    if (toolbar) {
        toolbar.querySelectorAll('[data-list-note-command]').forEach((btn) => {
            btn.disabled = isReadOnly;
        });
    }
    modal.classList.add('active');
    setTimeout(() => {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }, 0);
}

async function saveListItemInnerNote() {
    const itemId = listItemNoteModalState.itemId;
    const input = document.getElementById('list-item-note-input');
    if (!itemId || !input) return;
    if (listState.isArchived) {
        showReadOnlyToast();
        return;
    }
    const noteValue = (input.value || '').trim() || null;
    try {
        await updateListItem(itemId, { inner_note: noteValue }, { refresh: true });
        closeListItemNoteModal();
        showToast('Inner note saved', 'success', 1400);
    } catch (err) {
        console.error('Save inner note failed:', err);
        showToast('Could not save inner note', 'error');
    }
}

async function clearListItemInnerNote() {
    const itemId = listItemNoteModalState.itemId;
    if (!itemId) return;
    if (listState.isArchived) {
        showReadOnlyToast();
        return;
    }
    try {
        await updateListItem(itemId, { inner_note: null }, { refresh: true });
        closeListItemNoteModal();
        showToast('Inner note cleared', 'success', 1400);
    } catch (err) {
        console.error('Clear inner note failed:', err);
        showToast('Could not clear inner note', 'error');
    }
}

function applyListInnerNoteCommand(command) {
    const input = document.getElementById('list-item-note-input');
    if (!input || input.readOnly || listState.isArchived) return;
    input.focus();
    if (command === 'bold') {
        wrapListInnerNoteSelection('**');
        return;
    }
    if (command === 'italic') {
        wrapListInnerNoteSelection('*');
        return;
    }
    if (command === 'strike') {
        wrapListInnerNoteSelection('~~');
        return;
    }
    if (command === 'bullet') {
        toggleListInnerNoteLinePrefix('bullet');
        return;
    }
    if (command === 'number') {
        toggleListInnerNoteLinePrefix('number');
        return;
    }
    if (command === 'quote') {
        toggleListInnerNoteLinePrefix('quote');
    }
}

function wrapListInnerNoteSelection(marker) {
    const input = document.getElementById('list-item-note-input');
    if (!input) return;
    const value = input.value || '';
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    const selected = value.slice(start, end);
    const wrappedPrefix = `${marker}`;
    const wrappedSuffix = `${marker}`;

    if (selected) {
        const hasWrap = selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2;
        const replacement = hasWrap
            ? selected.slice(marker.length, selected.length - marker.length)
            : `${wrappedPrefix}${selected}${wrappedSuffix}`;
        input.value = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
        const nextStart = start;
        const nextEnd = start + replacement.length;
        input.setSelectionRange(nextStart, nextEnd);
        return;
    }

    const insertion = `${wrappedPrefix}${wrappedSuffix}`;
    input.value = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
    const cursor = start + marker.length;
    input.setSelectionRange(cursor, cursor);
}

function toggleListInnerNoteLinePrefix(mode) {
    const input = document.getElementById('list-item-note-input');
    if (!input) return;
    const value = input.value || '';
    const selStart = input.selectionStart ?? 0;
    const selEnd = input.selectionEnd ?? 0;

    const blockStart = value.lastIndexOf('\n', Math.max(selStart - 1, 0));
    const start = blockStart === -1 ? 0 : blockStart + 1;
    const blockEndIndex = value.indexOf('\n', selEnd);
    const end = blockEndIndex === -1 ? value.length : blockEndIndex;
    const block = value.slice(start, end);
    const lines = block.split('\n');
    const nonEmpty = lines.filter(line => line.trim() !== '');
    if (!nonEmpty.length) return;

    let nextLines = lines.slice();
    if (mode === 'bullet') {
        const allBulleted = nonEmpty.every(line => /^\s*[-*]\s+/.test(line));
        nextLines = lines.map((line) => {
            if (!line.trim()) return line;
            if (allBulleted) return line.replace(/^(\s*)[-*]\s+/, '$1');
            return line.replace(/^(\s*)/, '$1- ');
        });
    } else if (mode === 'number') {
        const allNumbered = nonEmpty.every(line => /^\s*\d+\.\s+/.test(line));
        if (allNumbered) {
            nextLines = lines.map((line) => line.replace(/^(\s*)\d+\.\s+/, '$1'));
        } else {
            let index = 1;
            nextLines = lines.map((line) => {
                if (!line.trim()) return line;
                const leading = (line.match(/^(\s*)/) || [''])[0];
                const stripped = line.replace(/^(\s*)([-*]|\d+\.)\s+/, '$1').trimStart();
                const numbered = `${leading}${index}. ${stripped}`;
                index += 1;
                return numbered;
            });
        }
    } else if (mode === 'quote') {
        const allQuoted = nonEmpty.every(line => /^\s*>\s+/.test(line));
        nextLines = lines.map((line) => {
            if (!line.trim()) return line;
            if (allQuoted) return line.replace(/^(\s*)>\s+/, '$1');
            return line.replace(/^(\s*)/, '$1> ');
        });
    }

    const replacement = nextLines.join('\n');
    input.value = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
    input.setSelectionRange(start, start + replacement.length);
}

function closeListItemDateModal() {
    const modal = document.getElementById('list-item-date-modal');
    if (modal) modal.classList.remove('active');
    listItemDateModalState.itemId = null;
}

function openListItemDateModal(itemId) {
    if (listState.isArchived) {
        showReadOnlyToast();
        return;
    }
    const item = getListItemById(itemId);
    const modal = document.getElementById('list-item-date-modal');
    const subtitleEl = document.getElementById('list-item-date-subtitle');
    const input = document.getElementById('list-item-date-input');
    if (!item || !modal || !subtitleEl || !input) return;

    listItemDateModalState.itemId = itemId;
    subtitleEl.textContent = (item.text || '').trim() || 'Untitled item';
    input.value = normalizeListDateValue(item.scheduled_date) || '';
    modal.classList.add('active');
    setTimeout(() => input.focus(), 0);
}

async function saveListItemScheduledDate() {
    const itemId = listItemDateModalState.itemId;
    const input = document.getElementById('list-item-date-input');
    if (!itemId || !input) return;
    if (listState.isArchived) {
        showReadOnlyToast();
        return;
    }
    const dateValue = (input.value || '').trim();
    try {
        await updateListItem(itemId, { scheduled_date: dateValue || null }, { refresh: true });
        closeListItemDateModal();
        showToast('Date saved', 'success', 1400);
    } catch (err) {
        console.error('Save item date failed:', err);
        showToast('Could not save date', 'error');
    }
}

async function clearListItemScheduledDate() {
    const itemId = listItemDateModalState.itemId;
    if (!itemId) return;
    if (listState.isArchived) {
        showReadOnlyToast();
        return;
    }
    try {
        await updateListItem(itemId, { scheduled_date: null }, { refresh: true });
        closeListItemDateModal();
        showToast('Date cleared', 'success', 1400);
    } catch (err) {
        console.error('Clear item date failed:', err);
        showToast('Could not clear date', 'error');
    }
}

function handleListEditorModalKeydown(event) {
    if (event.key !== 'Escape') return;
    const noteModal = document.getElementById('list-item-note-modal');
    if (noteModal && noteModal.classList.contains('active')) {
        event.preventDefault();
        closeListItemNoteModal();
        return;
    }
    const dateModal = document.getElementById('list-item-date-modal');
    if (dateModal && dateModal.classList.contains('active')) {
        event.preventDefault();
        closeListItemDateModal();
    }
}

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

function getSectionBlocksWithPrefix() {
    const sorted = getSortedListItems();
    const firstSectionIndex = sorted.findIndex(isListSectionItem);
    const prefixIds = firstSectionIndex === -1
        ? sorted.map(item => item.id)
        : sorted.slice(0, firstSectionIndex).map(item => item.id);
    if (firstSectionIndex === -1) {
        return { prefixIds, blocks: [] };
    }

    const blocks = [];
    let idx = firstSectionIndex;
    while (idx < sorted.length) {
        const item = sorted[idx];
        if (!isListSectionItem(item)) {
            idx += 1;
            continue;
        }
        const blockIds = [item.id];
        idx += 1;
        while (idx < sorted.length && !isListSectionItem(sorted[idx])) {
            blockIds.push(sorted[idx].id);
            idx += 1;
        }
        blocks.push({
            sectionId: item.id,
            itemIds: blockIds
        });
    }
    return { prefixIds, blocks };
}

function clearSectionDropIndicators() {
    document.querySelectorAll('.list-section.section-drop-before, .list-section.section-drop-after, .list-section.section-dragging')
        .forEach(el => {
            el.classList.remove('section-drop-before', 'section-drop-after', 'section-dragging');
            el.removeAttribute('data-drop-position');
        });
}

function clearSectionDropTargets() {
    document.querySelectorAll('.list-section.section-drop-before, .list-section.section-drop-after')
        .forEach(el => {
            el.classList.remove('section-drop-before', 'section-drop-after');
            el.removeAttribute('data-drop-position');
        });
}

function markSectionDropTarget(sectionId, dropPosition) {
    clearSectionDropTargets();
    const target = document.querySelector(`.list-section[data-section-id="${sectionId}"]`);
    if (!target) return;
    target.setAttribute('data-drop-position', dropPosition === 'after' ? 'after' : 'before');
    if (dropPosition === 'after') {
        target.classList.add('section-drop-after');
    } else {
        target.classList.add('section-drop-before');
    }
}

function clearSectionDragPreview() {
    const previewEl = listSectionReorderState.dragPreviewEl;
    if (previewEl && previewEl.parentNode) {
        previewEl.parentNode.removeChild(previewEl);
    }
    listSectionReorderState.dragPreviewEl = null;
}

function resetSectionDragState() {
    listSectionReorderState.dragSectionId = null;
    listSectionReorderState.overSectionId = null;
    listSectionReorderState.dropPosition = null;
    listSectionReorderState.suppressClicksUntil = Date.now() + SECTION_DRAG_CLICK_SUPPRESS_MS;
    clearSectionDropIndicators();
    clearSectionDragPreview();
    document.body.classList.remove('list-section-dragging');
}

function autoScrollWhileSectionDragging(clientY) {
    if (!Number.isFinite(clientY)) return;
    const viewportTop = (window.visualViewport && window.visualViewport.offsetTop) || 0;
    const viewportHeight = (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0;
    const viewportBottom = viewportTop + viewportHeight;
    if (viewportHeight > 0) {
        if (clientY < viewportTop + SECTION_DRAG_AUTOSCROLL_EDGE_PX) {
            window.scrollBy(0, -SECTION_DRAG_AUTOSCROLL_STEP_PX);
        } else if (clientY > viewportBottom - SECTION_DRAG_AUTOSCROLL_EDGE_PX) {
            window.scrollBy(0, SECTION_DRAG_AUTOSCROLL_STEP_PX);
        }
    }
    const surface = document.getElementById('list-editor-surface');
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    if (!rect.height) return;
    const edge = Math.min(SECTION_DRAG_AUTOSCROLL_EDGE_PX, Math.max(28, rect.height * 0.2));
    if (clientY < rect.top + edge) {
        surface.scrollTop -= SECTION_DRAG_AUTOSCROLL_STEP_PX;
    } else if (clientY > rect.bottom - edge) {
        surface.scrollTop += SECTION_DRAG_AUTOSCROLL_STEP_PX;
    }
}

async function reorderSectionBlocks(sourceSectionId, targetSectionId, dropPosition = 'before') {
    if (!sourceSectionId || !targetSectionId || sourceSectionId === targetSectionId) return false;
    const { prefixIds, blocks } = getSectionBlocksWithPrefix();
    if (!blocks.length) return false;

    const sourceIndex = blocks.findIndex(block => block.sectionId === sourceSectionId);
    const targetIndex = blocks.findIndex(block => block.sectionId === targetSectionId);
    if (sourceIndex === -1 || targetIndex === -1) return false;

    const nextBlocks = blocks.slice();
    const [sourceBlock] = nextBlocks.splice(sourceIndex, 1);
    let insertIndex = targetIndex;
    if (sourceIndex < targetIndex) insertIndex -= 1;
    if (dropPosition === 'after') insertIndex += 1;
    if (insertIndex < 0) insertIndex = 0;
    if (insertIndex > nextBlocks.length) insertIndex = nextBlocks.length;
    nextBlocks.splice(insertIndex, 0, sourceBlock);

    const orderIds = [
        ...prefixIds,
        ...nextBlocks.flatMap(block => block.itemIds)
    ];
    await reorderListItems(orderIds);
    await loadListItems();
    return true;
}

function handleSectionDragStart(event) {
    if (!listState.sectionReorderMode || listState.isArchived || isListSelectionActive()) {
        event.preventDefault();
        return;
    }
    const dragSource = event.currentTarget;
    const sectionId = parseInt(dragSource.dataset.sectionId || '', 10);
    if (!sectionId) {
        event.preventDefault();
        return;
    }
    clearSectionDragPreview();
    listSectionReorderState.dragSectionId = sectionId;
    listSectionReorderState.overSectionId = null;
    listSectionReorderState.dropPosition = null;
    listSectionReorderState.suppressClicksUntil = Date.now() + SECTION_DRAG_CLICK_SUPPRESS_MS;
    const sectionEl = dragSource.closest('.list-section');
    if (sectionEl) {
        sectionEl.classList.add('section-dragging');
    }
    document.body.classList.add('list-section-dragging');
    if (event.dataTransfer) {
        const sectionTitle = dragSource.dataset.sectionTitle || 'Section';
        const preview = document.createElement('div');
        preview.className = 'list-section-drag-preview';
        preview.textContent = sectionTitle;
        preview.style.position = 'fixed';
        preview.style.top = '-9999px';
        preview.style.left = '-9999px';
        preview.style.pointerEvents = 'none';
        document.body.appendChild(preview);
        listSectionReorderState.dragPreviewEl = preview;
        try {
            event.dataTransfer.setDragImage(preview, 18, 12);
        } catch (_) {
            // Some environments ignore custom drag images.
        }
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(sectionId));
    }
}

function handleSectionDragOver(event) {
    if (!listState.sectionReorderMode) return;
    const sourceId = listSectionReorderState.dragSectionId;
    if (!sourceId) return;
    autoScrollWhileSectionDragging(event.clientY);
    const target = event.currentTarget;
    const targetId = parseInt(target.dataset.sectionId || '', 10);
    if (!targetId || targetId === sourceId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    const rect = target.getBoundingClientRect();
    const midpoint = rect.top + (rect.height / 2);
    const dropPosition = event.clientY >= midpoint ? 'after' : 'before';
    if (
        targetId !== listSectionReorderState.overSectionId ||
        dropPosition !== listSectionReorderState.dropPosition
    ) {
        listSectionReorderState.overSectionId = targetId;
        listSectionReorderState.dropPosition = dropPosition;
        markSectionDropTarget(targetId, dropPosition);
    }
}

function handleSectionDragLeave(event) {
    if (!listState.sectionReorderMode) return;
    const sourceId = listSectionReorderState.dragSectionId;
    if (!sourceId) return;
    const target = event.currentTarget;
    const related = event.relatedTarget;
    if (related && target.contains(related)) return;
    const targetId = parseInt(target.dataset.sectionId || '', 10);
    if (!targetId) return;
    if (targetId === listSectionReorderState.overSectionId) {
        listSectionReorderState.overSectionId = null;
        listSectionReorderState.dropPosition = null;
        clearSectionDropTargets();
        const sourceSection = document.querySelector(`.list-section[data-section-id="${sourceId}"]`);
        if (sourceSection) sourceSection.classList.add('section-dragging');
    }
}

async function handleSectionDrop(event) {
    if (!listState.sectionReorderMode) return;
    const sourceId = listSectionReorderState.dragSectionId;
    const target = event.currentTarget;
    const targetId = parseInt(target.dataset.sectionId || '', 10);
    if (!sourceId || !targetId || sourceId === targetId) return;
    event.preventDefault();
    const dropPosition = listSectionReorderState.dropPosition || 'before';
    try {
        await reorderSectionBlocks(sourceId, targetId, dropPosition);
        showToast('Section moved', 'success', 1200);
    } catch (err) {
        console.error('Section reorder failed:', err);
        showToast('Could not reorder section', 'error');
    } finally {
        resetSectionDragState();
    }
}

function handleSectionDragEnd() {
    resetSectionDragState();
}

function isListSelectionActive() {
    return !!listSelectionState.active;
}

function getListSectionCount() {
    return (listState.items || []).filter(isListSectionItem).length;
}

function updateListSectionReorderUI() {
    const page = document.getElementById('list-editor-page');
    const sectionCount = getListSectionCount();
    const hasSearch = !!(listSearchState.query || '').trim();
    const canStart = !listState.isArchived && !hasSearch && !isListSelectionActive() && sectionCount > 1;
    if (listState.sectionReorderMode && !canStart) {
        listState.sectionReorderMode = false;
        resetSectionDragState();
    }
    if (page) page.classList.toggle('list-section-reorder-mode', !!listState.sectionReorderMode);

    const toggleBtn = document.getElementById('list-section-reorder-toggle');
    const doneBtn = document.getElementById('list-section-reorder-done-btn');

    if (toggleBtn) {
        const active = !!listState.sectionReorderMode;
        toggleBtn.classList.toggle('active', active);
        toggleBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
        toggleBtn.disabled = !active && !canStart;
        toggleBtn.innerHTML = active
            ? '<i class="fa-solid fa-check"></i> Done reordering'
            : '<i class="fa-solid fa-grip-lines"></i> Reorder sections';
    }

    if (doneBtn) {
        doneBtn.classList.toggle('u-hidden', !listState.sectionReorderMode);
    }
}

function setListSectionReorderMode(active) {
    const next = !!active;
    if (next === !!listState.sectionReorderMode) {
        updateListSectionReorderUI();
        return;
    }
    if (next) {
        if (listState.isArchived) {
            showReadOnlyToast();
            return;
        }
        if ((listSearchState.query || '').trim()) {
            showToast('Clear search before reordering sections.', 'warning', 2200);
            return;
        }
        if (getListSectionCount() < 2) {
            showToast('Add at least two sections to reorder.', 'info', 2200);
            return;
        }
        if (isListSelectionActive()) {
            listSelectionState.active = false;
            clearListSelection();
            updateListSelectionUI();
        }
        listState.insertionIndex = null;
        listState.editingItemId = null;
        listState.expandedItemId = null;
    } else {
        resetSectionDragState();
    }

    listState.sectionReorderMode = next;
    updateListSectionReorderUI();
    renderListItems();
}

function toggleListSectionReorderMode() {
    setListSectionReorderMode(!listState.sectionReorderMode);
}

function clearListSelection() {
    listSelectionState.ids.clear();
}

function setListSelectionMode(active) {
    if (active && listState.sectionReorderMode) {
        listState.sectionReorderMode = false;
        resetSectionDragState();
    }
    listSelectionState.active = !!active;
    clearListSelection();
    listState.insertionIndex = null;
    listState.editingItemId = null;
    listState.expandedItemId = null;
    updateListSelectionUI();
    updateListSectionReorderUI();
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
    updateListSectionReorderUI();
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
    activeListItemMenuAnchor = null;
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
    const viewportWidth = Math.floor((window.visualViewport && window.visualViewport.width) || window.innerWidth || document.documentElement.clientWidth || 0);
    const viewportHeight = Math.floor((window.visualViewport && window.visualViewport.height) || window.innerHeight || document.documentElement.clientHeight || 0);
    if (viewportWidth > 0) {
        menu.style.maxWidth = `${Math.max(180, viewportWidth - 16)}px`;
    }
    if (viewportHeight > 0) {
        menu.style.maxHeight = `${Math.max(140, viewportHeight - 16)}px`;
    }
    menu.style.overflowY = 'auto';

    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const padding = 8;
    const usableWidth = Math.max(0, viewportWidth - (padding * 2));
    const usableHeight = Math.max(0, viewportHeight - (padding * 2));
    const menuWidth = Math.min(menuRect.width, usableWidth || menuRect.width);
    const menuHeight = Math.min(menuRect.height, usableHeight || menuRect.height);

    let topPos = rect.bottom + padding;
    if (topPos + menuHeight > viewportHeight - padding) {
        topPos = rect.top - menuHeight - padding;
    }
    if (topPos < padding) topPos = padding;

    let leftPos = rect.right - menuWidth;
    if (leftPos < padding) leftPos = padding;
    if (leftPos + menuWidth > viewportWidth - padding) {
        leftPos = viewportWidth - menuWidth - padding;
    }
    if (leftPos < padding) leftPos = padding;

    menu.style.top = `${topPos}px`;
    menu.style.left = `${leftPos}px`;
    menu.style.right = '';
    menu.style.bottom = '';
    nudgeFixedMenuIntoViewport(menu, padding);
    window.requestAnimationFrame(() => nudgeFixedMenuIntoViewport(menu, padding));
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
    activeListItemMenuAnchor = anchor;
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
    activeListItemMenuAnchor = anchor;
}

function positionBulkMenu(menu, button) {
    const viewportWidth = Math.floor((window.visualViewport && window.visualViewport.width) || window.innerWidth || document.documentElement.clientWidth || 0);
    const viewportHeight = Math.floor((window.visualViewport && window.visualViewport.height) || window.innerHeight || document.documentElement.clientHeight || 0);
    if (viewportWidth > 0) {
        menu.style.maxWidth = `${Math.max(180, viewportWidth - 16)}px`;
    }
    if (viewportHeight > 0) {
        menu.style.maxHeight = `${Math.max(140, viewportHeight - 16)}px`;
    }
    menu.style.overflowY = 'auto';

    const rect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const padding = 8;
    const usableWidth = Math.max(0, viewportWidth - (padding * 2));
    const usableHeight = Math.max(0, viewportHeight - (padding * 2));
    const menuWidth = Math.min(menuRect.width, usableWidth || menuRect.width);
    const menuHeight = Math.min(menuRect.height, usableHeight || menuRect.height);

    let topPos = rect.bottom + padding;
    if (topPos + menuHeight > viewportHeight - padding) {
        topPos = rect.top - menuHeight - padding;
    }
    if (topPos < padding) topPos = padding;

    let leftPos = rect.right - menuWidth;
    if (leftPos < padding) leftPos = padding;
    if (leftPos + menuWidth > viewportWidth - padding) {
        leftPos = viewportWidth - menuWidth - padding;
    }
    if (leftPos < padding) leftPos = padding;

    menu.style.top = `${topPos}px`;
    menu.style.left = `${leftPos}px`;
    menu.style.right = '';
    menu.style.bottom = '';
    nudgeFixedMenuIntoViewport(menu, padding);
    window.requestAnimationFrame(() => nudgeFixedMenuIntoViewport(menu, padding));
}

function nudgeFixedMenuIntoViewport(menu, padding = 8) {
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const viewportWidth = Math.floor((window.visualViewport && window.visualViewport.width) || window.innerWidth || document.documentElement.clientWidth || 0);
    const viewportHeight = Math.floor((window.visualViewport && window.visualViewport.height) || window.innerHeight || document.documentElement.clientHeight || 0);
    if (!viewportWidth || !viewportHeight) return;

    let leftPos = parseFloat(menu.style.left);
    let topPos = parseFloat(menu.style.top);
    if (!Number.isFinite(leftPos)) leftPos = rect.left;
    if (!Number.isFinite(topPos)) topPos = rect.top;

    if (rect.right > viewportWidth - padding) {
        leftPos -= (rect.right - (viewportWidth - padding));
    }
    if (rect.left < padding) {
        leftPos += (padding - rect.left);
    }
    if (rect.bottom > viewportHeight - padding) {
        topPos -= (rect.bottom - (viewportHeight - padding));
    }
    if (rect.top < padding) {
        topPos += (padding - rect.top);
    }

    menu.style.left = `${Math.max(padding, Math.round(leftPos))}px`;
    menu.style.top = `${Math.max(padding, Math.round(topPos))}px`;
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
    const sectionIdsOrdered = items.filter(isListSectionItem).map(entry => entry.id);
    cleanCollapsedListSections(sectionIdsOrdered);
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
        const innerNoteValue = (item.inner_note || '').toLowerCase();
        const scheduledValue = (normalizeListDateValue(item.scheduled_date) || '').toLowerCase();
        const scheduledLabel = (formatListScheduledDate(item.scheduled_date) || '').toLowerCase();
        return (
            textValue.includes(searchLower) ||
            linkLabel.includes(searchLower) ||
            noteValue.includes(searchLower) ||
            innerNoteValue.includes(searchLower) ||
            scheduledValue.includes(searchLower) ||
            scheduledLabel.includes(searchLower)
        );
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
            const isCollapsed = !searchLower && ensureCollapsedSectionSet().has(item.id);
            if (isCollapsed && !isEditing) section.classList.add('collapsed');
            if (!isEditing) {
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
                section.dataset.sectionId = String(item.id);
                header.dataset.sectionId = String(item.id);
                const sectionCount = sectionIdsOrdered.length;
                const canEditSection = !listState.isArchived && !searchLower && !isListSelectionActive() && !listState.sectionReorderMode;
                const canReorder = !listState.isArchived && !searchLower && !isListSelectionActive() && listState.sectionReorderMode && sectionCount > 1;
                const sectionTitle = title || 'Untitled section';
                const sectionItemCount = getListSectionItemCount(item.id, items);

                const main = document.createElement('div');
                main.className = 'list-section-header-main';

                const toggleBtn = document.createElement('button');
                toggleBtn.type = 'button';
                toggleBtn.className = 'list-section-toggle';
                toggleBtn.title = isCollapsed ? 'Expand section' : 'Collapse section';
                toggleBtn.innerHTML = `<i class="fa-solid ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down'}"></i>`;
                toggleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (listState.sectionReorderMode) return;
                    if (Date.now() < listSectionReorderState.suppressClicksUntil) return;
                    toggleListSectionCollapsed(item.id);
                });
                main.appendChild(toggleBtn);

                const titleEl = document.createElement('span');
                titleEl.className = 'list-section-header-title';
                if (title) {
                    appendHighlightedText(titleEl, title, listState.isArchived ? '' : listSearchState.query);
                } else {
                    titleEl.textContent = sectionTitle;
                }
                main.appendChild(titleEl);

                if (isCollapsed) {
                    const summary = document.createElement('span');
                    summary.className = 'list-section-summary';
                    summary.textContent = `${sectionItemCount} item${sectionItemCount === 1 ? '' : 's'}`;
                    main.appendChild(summary);
                }

                header.appendChild(main);

                const actions = document.createElement('div');
                actions.className = 'list-section-reorder-actions';

                if (canEditSection) {
                    const editBtn = document.createElement('button');
                    editBtn.type = 'button';
                    editBtn.className = 'list-section-reorder-btn';
                    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
                    editBtn.title = 'Rename section';
                    editBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        listState.editingItemId = item.id;
                        listState.insertionIndex = null;
                        renderListItems();
                    });
                    actions.appendChild(editBtn);
                }

                if (canReorder) {
                    section.classList.add('reorder-active');
                    section.classList.add('reorder-target');
                    section.addEventListener('dragover', handleSectionDragOver);
                    section.addEventListener('dragleave', handleSectionDragLeave);
                    section.addEventListener('drop', handleSectionDrop);
                    const dragHandle = document.createElement('button');
                    dragHandle.type = 'button';
                    dragHandle.className = 'list-section-drag-handle';
                    dragHandle.dataset.sectionId = String(item.id);
                    dragHandle.dataset.sectionTitle = sectionTitle;
                    dragHandle.setAttribute('draggable', 'true');
                    dragHandle.title = `Drag to reorder section "${sectionTitle}"`;
                    dragHandle.innerHTML = '<i class="fa-solid fa-grip-lines"></i><span>Drag</span>';
                    dragHandle.addEventListener('click', (e) => e.stopPropagation());
                    dragHandle.addEventListener('dragstart', handleSectionDragStart);
                    dragHandle.addEventListener('dragend', handleSectionDragEnd);
                    actions.appendChild(dragHandle);
                }

                if (actions.children.length) {
                    header.appendChild(actions);
                }

                header.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (listState.sectionReorderMode) return;
                    if (Date.now() < listSectionReorderState.suppressClicksUntil) return;
                    if (isListSelectionActive()) return;
                    toggleListSectionCollapsed(item.id);
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

const LIST_NOTE_LINK_PATTERN = /\[\[\[([^\]\n]+)\]\]\]|\[\[([^\]\n]+)\]\]|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g;
const LIST_NOTE_INLINE_FORMAT_PATTERN = /(\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~\n]+)~~|`([^`\n]+)`)/g;

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

function appendFormattedInlineText(target, text) {
    const raw = String(text || '');
    if (!raw) return;
    LIST_NOTE_INLINE_FORMAT_PATTERN.lastIndex = 0;
    let lastIndex = 0;
    for (const match of raw.matchAll(LIST_NOTE_INLINE_FORMAT_PATTERN)) {
        const matchIndex = match.index ?? 0;
        if (matchIndex > lastIndex) {
            appendHighlightedText(target, raw.slice(lastIndex, matchIndex), listSearchState.query);
        }

        let tag = null;
        let content = '';
        if (match[2] || match[3]) {
            tag = 'strong';
            content = match[2] || match[3] || '';
        } else if (match[4] || match[5]) {
            tag = 'em';
            content = match[4] || match[5] || '';
        } else if (match[6]) {
            tag = 's';
            content = match[6];
        } else if (match[7]) {
            tag = 'code';
            content = match[7];
        }

        if (!tag || !content) {
            appendHighlightedText(target, match[0], listSearchState.query);
        } else {
            const el = document.createElement(tag);
            appendHighlightedText(el, content, listSearchState.query);
            target.appendChild(el);
        }
        lastIndex = matchIndex + match[0].length;
    }
    if (lastIndex < raw.length) {
        appendHighlightedText(target, raw.slice(lastIndex), listSearchState.query);
    }
}

function appendListNoteLineWithLinks(target, line) {
    LIST_NOTE_LINK_PATTERN.lastIndex = 0;
    let lastIndex = 0;
    for (const match of line.matchAll(LIST_NOTE_LINK_PATTERN)) {
        const matchIndex = match.index ?? 0;
        if (matchIndex > lastIndex) {
            appendFormattedInlineText(target, line.slice(lastIndex, matchIndex));
        }
        if (match[1] || match[2]) {
            const isListLink = !!match[1];
            const title = (match[1] || match[2] || '').trim();
            if (title) {
                const link = document.createElement('a');
                link.className = 'note-link';
                if (isListLink) link.classList.add('list-link');
                link.dataset.noteTitle = title;
                link.dataset.noteLinkType = isListLink ? 'list' : 'note';
                link.setAttribute('href', '#');
                appendFormattedInlineText(link, title);
                target.appendChild(link);
            } else {
                appendFormattedInlineText(target, match[0]);
            }
        } else if (match[3] && match[4]) {
            const label = match[3].trim();
            const url = match[4].trim();
            if (label && url) {
                const link = document.createElement('a');
                link.className = 'external-link';
                link.setAttribute('href', url);
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener noreferrer');
                appendFormattedInlineText(link, label);
                target.appendChild(link);
            } else {
                appendFormattedInlineText(target, match[0]);
            }
        } else {
            appendFormattedInlineText(target, match[0]);
        }
        lastIndex = matchIndex + match[0].length;
    }
    if (lastIndex < line.length) {
        appendFormattedInlineText(target, line.slice(lastIndex));
    }
}

function appendListNoteTextWithLinks(target, text) {
    const lines = String(text || '').split('\n');
    let index = 0;
    while (index < lines.length) {
        const rawLine = lines[index];
        if (!rawLine.trim()) {
            target.appendChild(document.createElement('br'));
            index += 1;
            continue;
        }

        if (/^\s*[-*]\s+/.test(rawLine)) {
            const ul = document.createElement('ul');
            while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
                const li = document.createElement('li');
                appendListNoteLineWithLinks(li, lines[index].replace(/^\s*[-*]\s+/, ''));
                ul.appendChild(li);
                index += 1;
            }
            target.appendChild(ul);
            continue;
        }

        if (/^\s*\d+\.\s+/.test(rawLine)) {
            const ol = document.createElement('ol');
            while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
                const li = document.createElement('li');
                appendListNoteLineWithLinks(li, lines[index].replace(/^\s*\d+\.\s+/, ''));
                ol.appendChild(li);
                index += 1;
            }
            target.appendChild(ol);
            continue;
        }

        if (/^\s*>\s+/.test(rawLine)) {
            const quote = document.createElement('blockquote');
            while (index < lines.length && /^\s*>\s+/.test(lines[index])) {
                if (quote.childNodes.length) quote.appendChild(document.createElement('br'));
                appendListNoteLineWithLinks(quote, lines[index].replace(/^\s*>\s+/, ''));
                index += 1;
            }
            target.appendChild(quote);
            continue;
        }

        const line = document.createElement('div');
        line.className = 'list-note-line';
        appendListNoteLineWithLinks(line, rawLine);
        target.appendChild(line);
        index += 1;
    }
}

function createListPill(item) {
    const pill = document.createElement('div');
    const hasNote = !!(item.note && item.note.trim());
    const hasInnerNote = !!(item.inner_note && item.inner_note.trim());
    const isExpanded = hasNote && listState.expandedItemId === item.id;
    const isSelected = listSelectionState.ids.has(item.id);
    pill.className = `list-pill${hasNote ? ' has-note' : ''}${isExpanded ? ' expanded' : ''}${isSelected ? ' selected' : ''}`;
    pill.dataset.itemId = item.id;
    const content = document.createElement('div');
    content.className = 'list-pill-content';
    const textValue = (item.text || '').trim();
    const linkLabel = (item.link_text || '').trim();
    const linkUrl = (item.link_url || '').trim();
    const scheduledDate = normalizeListDateValue(item.scheduled_date);
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
        appendListNoteLineWithLinks(textSpan, textValue);
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

    if (scheduledDate) {
        const dateBadge = document.createElement('span');
        const dateClass = isListDatePast(scheduledDate) ? 'past' : (isListDateToday(scheduledDate) ? 'today' : '');
        dateBadge.className = `list-date-badge${dateClass ? ` ${dateClass}` : ''}`;
        dateBadge.innerHTML = '<i class="fa-regular fa-calendar"></i>';
        const label = document.createElement('span');
        label.textContent = formatListScheduledDate(scheduledDate);
        dateBadge.appendChild(label);
        content.appendChild(dateBadge);
    }

    if (hasNote || hasInnerNote) {
        const noteBadgeWrap = document.createElement('span');
        noteBadgeWrap.className = 'list-note-indicators';
        if (hasNote && hasInnerNote) {
            noteBadgeWrap.title = 'Has inline + attached notes';
        } else if (hasNote) {
            noteBadgeWrap.title = 'Has inline note';
        } else {
            noteBadgeWrap.title = 'Has attached note';
        }
        if (hasNote) {
            const inlineDot = document.createElement('span');
            inlineDot.className = 'list-note-indicator inline';
            noteBadgeWrap.appendChild(inlineDot);
        }
        if (hasInnerNote) {
            const attachedDot = document.createElement('span');
            attachedDot.className = 'list-note-indicator attached';
            noteBadgeWrap.appendChild(attachedDot);
        }
        content.appendChild(noteBadgeWrap);
    }

    content.addEventListener('click', (e) => {
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
    const noteBtn = document.createElement('button');
    noteBtn.type = 'button';
    noteBtn.className = `list-pill-action${hasInnerNote ? ' active' : ''}`;
    noteBtn.title = hasInnerNote ? 'Open inner note' : 'Add inner note';
    noteBtn.innerHTML = '<i class="fa-solid fa-note-sticky"></i>';
    noteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isListSelectionActive()) return;
        openListItemNoteModal(item.id);
    });
    const dateBtn = document.createElement('button');
    dateBtn.type = 'button';
    dateBtn.className = `list-pill-action${scheduledDate ? ' active' : ''}`;
    dateBtn.title = scheduledDate ? 'Edit date' : 'Attach date';
    dateBtn.innerHTML = '<i class="fa-regular fa-calendar"></i>';
    dateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isListSelectionActive()) return;
        openListItemDateModal(item.id);
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
    actions.appendChild(noteBtn);
    actions.appendChild(dateBtn);
    actions.appendChild(deleteBtn);
    pill.appendChild(actions);

    let longPressTimer = null;
    let longPressTriggered = false;
    let ignoreClick = false;
    const supportsTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
    const longPressMs = 450;
    const clearTouchActive = () => {
        pill.classList.remove('touch-active');
    };
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
        pill.classList.add('touch-active');
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
                clearTouchActive();
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
        clearTouchActive();
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
        clearTouchActive();
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
        updateListSectionReorderUI();
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

