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
    return `
        <a href="/list/${list.id}" class="card" style="border-top-color: ${cardColorVar};">
            <div class="card-header">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                    <span class="card-title">${list.title}</span>
                    <span class="card-type ${list.type}">${list.type === 'hub' ? 'Project Hub' : 'List'}</span>
                </div>
            </div>
            ${list.type === 'hub' ? `
            <div class="progress-container">
                <div class="progress-bar" style="width: ${list.progress}%"></div>
            </div>
            <div class="progress-text">
                <span>${list.progress}% Complete</span>
                <button class="btn-icon delete" title="Delete" onclick="event.preventDefault(); event.stopPropagation(); deleteList(${list.id});">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
            ` : `
            <div class="progress-text">
                <span>${list.items.length} Tasks</span>
                <button class="btn-icon delete" title="Delete" onclick="event.preventDefault(); event.stopPropagation(); deleteList(${list.id});">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
            `}
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

    // Add long-press listeners for mobile selection
    document.querySelectorAll('.task-item').forEach(item => {
        item.addEventListener('touchstart', handleTouchStart, { passive: false });
        item.addEventListener('touchend', handleTouchEnd, { passive: false });
        item.addEventListener('touchmove', handleTouchMove, { passive: false });
        item.addEventListener('mousedown', handleMouseHoldStart);
        item.addEventListener('mouseup', handleMouseHoldEnd);
        item.addEventListener('mouseleave', handleMouseHoldEnd);
    });
});

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
