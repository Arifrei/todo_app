// --- Bulk Selection ---

// Initialize task selection manager (unified with other modules)
function initTaskSelection() {
    taskSelection = new SelectionManager({
        moduleName: 'task',
        bulkBarId: 'bulk-actions',
        countSpanId: 'bulk-count',
        selectAllId: 'select-all',
        itemSelector: '.task-item',
        itemIdAttr: 'data-item-id',
        selectedClass: 'selected',
        bodyActiveClass: 'selection-mode-active',
        getTotalCount: () => document.querySelectorAll('.task-item').length
    });
    // Keep backward compatible reference
    selectedItems = taskSelection.selectedIds;
}

function updateBulkBar() {
    const scrollY = window.scrollY;
    // Use SelectionManager if available, otherwise fallback to legacy logic
    if (taskSelection) {
        taskSelection.updateUI();
    } else {
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
    }
    // Prevent layout jump when bar appears
    window.scrollTo(0, scrollY);
}

function setAriaExpandedForControls(controlledId, expanded) {
    if (!controlledId) return;
    document.querySelectorAll(`[aria-controls="${controlledId}"]`).forEach((control) => {
        control.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
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
        menu.style.bottom = '';
        menu.dataset.anchorId = '';
        const statusMenu = document.getElementById('bulk-status-submenu');
        const tagForm = document.getElementById('bulk-tag-form');
        if (statusMenu) statusMenu.classList.remove('show');
        if (tagForm) tagForm.classList.remove('show');
        setAriaExpandedForControls('bulk-menu-dropdown', false);
        setAriaExpandedForControls('bulk-status-submenu', false);
        setAriaExpandedForControls('bulk-tag-form', false);
        return;
    }

    const shouldShow = !menu.classList.contains('show');
    menu.classList.toggle('show', shouldShow);
    if (!shouldShow) {
        menu.style.position = '';
        menu.style.top = '';
        menu.style.left = '';
        menu.style.right = '';
        menu.style.bottom = '';
        menu.dataset.anchorId = '';
        const statusMenu = document.getElementById('bulk-status-submenu');
        const tagForm = document.getElementById('bulk-tag-form');
        if (statusMenu) statusMenu.classList.remove('show');
        if (tagForm) tagForm.classList.remove('show');
        setAriaExpandedForControls('bulk-status-submenu', false);
        setAriaExpandedForControls('bulk-tag-form', false);
        setAriaExpandedForControls('bulk-menu-dropdown', false);
        return;
    }
    setAriaExpandedForControls('bulk-menu-dropdown', true);

    const isListView = !!document.querySelector('.list-view');
    const positionBulkMenuAbove = (rect) => {
        menu.style.position = 'fixed';
        menu.style.right = '';
        menu.style.top = '';
        const padding = 8;
        const menuWidth = menu.offsetWidth || 220;
        let left = rect.right - menuWidth;
        left = Math.max(padding, Math.min(left, window.innerWidth - menuWidth - padding));
        const bottom = Math.max(padding, window.innerHeight - rect.top + 8);
        menu.style.left = `${left}px`;
        menu.style.bottom = `${bottom}px`;
    };
    if (window.innerWidth <= 768 && event && event.currentTarget) {
        const rect = event.currentTarget.getBoundingClientRect();
        if (isListView) {
            positionBulkMenuAbove(rect);
        } else {
            menu.style.position = 'fixed';
            menu.style.right = '';
            menu.style.bottom = '';
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
        }
        menu.dataset.anchorId = event.currentTarget.id || '';
    } else {
        menu.style.position = '';
        menu.style.top = '';
        menu.style.left = '';
        menu.style.right = '';
        menu.style.bottom = '';
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
        setAriaExpandedForControls('bulk-tag-form', false);
        setAriaExpandedForControls('bulk-status-submenu', !!(statusMenu && statusMenu.classList.contains('show')));
    }
    if (kind === 'tag') {
        if (statusMenu) statusMenu.classList.remove('show');
        setAriaExpandedForControls('bulk-status-submenu', false);
        if (tagForm) {
            const willShow = !tagForm.classList.contains('show');
            tagForm.classList.toggle('show', willShow);
            setAriaExpandedForControls('bulk-tag-form', willShow);
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
        menu.style.bottom = '';
        menu.dataset.anchorId = '';
        const statusMenu = document.getElementById('bulk-status-submenu');
        const tagForm = document.getElementById('bulk-tag-form');
        if (statusMenu) statusMenu.classList.remove('show');
        if (tagForm) tagForm.classList.remove('show');
        setAriaExpandedForControls('bulk-menu-dropdown', false);
        setAriaExpandedForControls('bulk-status-submenu', false);
        setAriaExpandedForControls('bulk-tag-form', false);
    }
});

window.addEventListener('scroll', () => {
    const menu = document.getElementById('bulk-menu-dropdown');
    if (!menu || !menu.classList.contains('show')) return;
    const anchorId = menu.dataset.anchorId || '';
    const anchor = anchorId ? document.getElementById(anchorId) : null;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const isListView = !!document.querySelector('.list-view');
    const padding = 8;
    const menuWidth = menu.offsetWidth || 220;
    let left = rect.right - menuWidth;
    left = Math.max(padding, Math.min(left, window.innerWidth - menuWidth - padding));
    menu.style.left = `${left}px`;
    if (isListView) {
        menu.style.position = 'fixed';
        menu.style.right = '';
        menu.style.top = '';
        const bottom = Math.max(padding, window.innerHeight - rect.top + 8);
        menu.style.bottom = `${bottom}px`;
        return;
    }
    let top = rect.bottom + 8;
    if (top + menu.offsetHeight > window.innerHeight - padding) {
        top = Math.max(padding, rect.top - menu.offsetHeight - 8);
    }
    const maxTop = window.innerHeight - menu.offsetHeight - padding;
    top = Math.max(padding, Math.min(top, maxTop));
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
        setAriaExpandedForControls('calendar-bulk-more-dropdown', false);
        return;
    }
    const shouldShow = !menu.classList.contains('show');
    if (shouldShow) restoreCalendarNoteChoiceDropdown(menu);
    menu.classList.toggle('show', shouldShow);
      if (!shouldShow) {
          restoreCalendarNoteChoiceDropdown(menu);
          setAriaExpandedForControls('calendar-bulk-more-dropdown', false);
          return;
      }
    setAriaExpandedForControls('calendar-bulk-more-dropdown', true);

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
        setAriaExpandedForControls('calendar-bulk-more-dropdown', false);
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
    // Use SelectionManager if available
    if (taskSelection) {
        if (isSelected) taskSelection.selectedIds.add(itemId);
        else taskSelection.selectedIds.delete(itemId);
    } else {
        if (isSelected) selectedItems.add(itemId);
        else selectedItems.delete(itemId);
    }
}

function resetTaskSelection() {
    // Use SelectionManager if available
    if (taskSelection) {
        taskSelection.deselectAll();
    } else {
        selectedItems.clear();
        document.querySelectorAll('.task-item.selected').forEach(row => row.classList.remove('selected'));
        const selectAll = document.getElementById('select-all');
        if (selectAll) {
            selectAll.checked = false;
            selectAll.indeterminate = false;
        }
        updateBulkBar();
    }
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
    // Clear selection first
    if (taskSelection) {
        taskSelection.selectedIds.clear();
    } else {
        selectedItems.clear();
    }
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
        } else {
            const err = await res.json().catch(() => ({}));
            if (err && err.error) {
                showToast(err.error, 'error');
            }
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
    organizePhaseBlockedTasks();
    organizeLightListDoneTasks();
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
        organizePhaseBlockedTasks();
        organizeLightListDoneTasks();
        initTaskSelectionUI();
        // Restore selection state after DOM refresh
        const selectedIds = taskSelection ? taskSelection.getIds() : Array.from(selectedItems);
        selectedIds.forEach(id => setTaskSelected(id, true, true));
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

    // Move the dragged items with the finger
    touchDragBlock.forEach((el, index) => {
        const currentTop = parseFloat(el.style.top);
        const newTop = currentTop + deltaY;
        el.style.top = newTop + 'px';
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
    touchDragActive = false;
    touchDragId = null;

    const container = document.getElementById('items-container');
    if (container && touchDragPlaceholder && touchDragPlaceholder.parentElement) {
        // Restore normal positioning for dragged elements
        touchDragBlock.forEach((el) => {
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

        // Move elements to placeholder position
        touchDragBlock.forEach(el => {
            container.insertBefore(el, touchDragPlaceholder);
        });

        // Remove placeholder
        touchDragPlaceholder.parentElement.removeChild(touchDragPlaceholder);
        touchDragPlaceholder = null;
    } else {
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

    await commitOrderFromDOM();
    touchDragBlock = [];
    touchDragStartY = 0;
    touchDragCurrentY = 0;
    touchDragIsPhase = false;
    touchDragPhaseId = null;
    // Re-organize done tasks after drag to maintain proper grouping
    normalizePhaseParents();
    organizePhaseDoneTasks();
    organizePhaseBlockedTasks();
    organizeLightListDoneTasks();
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

function organizeLightListDoneTasks() {
    const listView = document.querySelector('.light-list-view');
    if (!listView) return; // Only run on light lists

    const container = document.getElementById('items-container');
    if (!container) return;

    // Unwrap any previous containers to avoid duplicating bars
    document.querySelectorAll('.light-done-container').forEach(box => {
        while (box.firstChild) {
            container.insertBefore(box.firstChild, box);
        }
        box.remove();
    });
    document.querySelectorAll('.light-done-bar').forEach(bar => bar.remove());

    // Collect all done tasks
    const allTasks = Array.from(container.querySelectorAll('.task-item'));
    const doneTasks = allTasks.filter(task => task.dataset.status === 'done');

    if (!doneTasks.length) return;

    // Create the separator bar
    const bar = document.createElement('div');
    bar.className = 'light-done-bar phase-done-bar';

    const label = document.createElement('span');
    label.className = 'phase-done-label';
    label.textContent = `${doneTasks.length} done task${doneTasks.length === 1 ? '' : 's'}`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-small phase-done-toggle';

    // Create the collapsible container for done tasks
    const doneBox = document.createElement('div');
    doneBox.className = 'light-done-container phase-done-container collapsed';

    const startOpen = currentTaskFilter === 'done';
    if (startOpen) doneBox.classList.remove('collapsed');
    btn.textContent = startOpen ? 'Hide' : 'Show';

    btn.addEventListener('click', () => {
        const isCollapsed = doneBox.classList.toggle('collapsed');
        btn.textContent = isCollapsed ? 'Show' : 'Hide';
    });

    // Move done tasks into the container
    doneTasks.forEach(task => doneBox.appendChild(task));

    // Assemble and append to end of container
    bar.appendChild(label);
    bar.appendChild(btn);
    container.appendChild(bar);
    container.appendChild(doneBox);
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

// --- Hub Calculation ---
function calculateHubProgress() {
    // This is handled by the backend now and rendered in template/API
    // But we might want to update the UI if we didn't reload
    // For now, we rely on reload for simplicity in this version
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
        const events = Array.isArray(calendarState.events) ? calendarState.events : [];
        const phases = events.filter(e => e.is_phase);
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
        const events = Array.isArray(calendarState.events) ? calendarState.events : [];
        const groups = events.filter(e => e.is_group);
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
    const events = Array.isArray(calendarState.events) ? calendarState.events : [];
    const phases = events.filter(e => e.is_phase);
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
    const groups = events.filter(e => e.is_group);
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

    // Timeline-only visibility
    suggestions.push({
        syntax: '&',
        description: 'Timeline only (hide from list section)',
        example: '$ Lunch @12pm-12:30pm &'
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

