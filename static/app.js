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
    loadNotes({ keepSelection: false });
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
    const { keepSelection = false } = options;
    const listEl = document.getElementById('notes-list');
    if (!listEl) return;
    try {
        const res = await fetch('/api/notes');
        if (!res.ok) throw new Error('Failed to load notes');
        const notes = await res.json();
        notesState.notes = notes;
        renderNotesList();

        if (keepSelection && notesState.activeNoteId) {
            const nextNote = notes.find(n => n.id === notesState.activeNoteId);
            if (nextNote) setActiveNote(nextNote.id, { skipAutosave: true });
            else clearNoteEditor();
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
    return date.toLocaleString('en-US', { timeZone: 'Etc/GMT+5' });
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

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();

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
    initMobileTopbar();
    initNotesPage();
    initAIPage();

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
    if (!sidebar) return;

    const media = window.matchMedia('(max-width: 1024px)');
    let lastScroll = window.scrollY;

    const handleScroll = () => {
        if (!media.matches) {
            sidebar.classList.remove('topbar-hidden');
            lastScroll = window.scrollY;
            return;
        }

        const current = window.scrollY;
        if (current > lastScroll + 8) {
            sidebar.classList.add('topbar-hidden');
        } else if (current < lastScroll - 8) {
            sidebar.classList.remove('topbar-hidden');
        }
        lastScroll = current;
    };

    const handleMediaChange = () => {
        sidebar.classList.remove('topbar-hidden');
        lastScroll = window.scrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
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
    formatted = formatted.replace(/^•\s/gm, '<span class="ai-bullet">• </span>');
    formatted = formatted.replace(/<br>•\s/g, '<br><span class="ai-bullet">• </span>');

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
