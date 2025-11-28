// DOM Elements & State
const listsGrid = document.getElementById('lists-grid');
const createModal = document.getElementById('create-modal');
const addItemModal = document.getElementById('add-item-modal');

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
    return `
        <a href="/list/${list.id}" class="card">
            <div class="card-header">
                <span class="card-title">${list.title}</span>
                <span class="card-type">${list.type === 'hub' ? 'Project Hub' : 'List'}</span>
            </div>
            ${list.type === 'hub' ? `
            <div class="progress-container">
                <div class="progress-bar" style="width: ${list.progress}%"></div>
            </div>
            <div class="progress-text">
                <span>${list.progress}% Complete</span>
            </div>
            ` : `
            <div class="progress-text">
                <span>${list.items.length} Tasks</span>
            </div>
            `}
        </a>
    `;
}

// --- List View Functions ---

async function createItem(listId, listType) {
    const input = document.getElementById('item-content');
    const descriptionInput = document.getElementById('item-description');
    const notesInput = document.getElementById('item-notes');
    const content = input.value.trim();
    if (!content) return;

    try {
        const res = await fetch(`/api/lists/${listId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content,
                description: descriptionInput ? descriptionInput.value.trim() : '',
                notes: notesInput ? notesInput.value.trim() : '',
                is_project: listType === 'hub'
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
    if (!confirm('Are you sure?')) return;

    try {
        const res = await fetch(`/api/items/${itemId}`, { method: 'DELETE' });
        if (res.ok) {
            window.location.reload();
        }
    } catch (e) {
        console.error('Error deleting item:', e);
    }
}

async function deleteList(listId) {
    if (!confirm('Delete this list and all its contents?')) return;

    try {
        const res = await fetch(`/api/lists/${listId}`, { method: 'DELETE' });
        if (res.ok) {
            window.location.href = '/';
        }
    } catch (e) {
        console.error('Error deleting list:', e);
    }
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
            window.location.reload();
        }
    } catch (e) {
        console.error('Error updating item:', e);
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

// Close dropdowns when clicking outside
window.addEventListener('click', function (e) {
    if (!e.target.closest('.status-dropdown-container')) {
        document.querySelectorAll('.status-dropdown-menu').forEach(el => {
            el.classList.remove('active');
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

function openAddItemModal() {
    addItemModal.classList.add('active');
    document.getElementById('item-content').focus();
}

function closeAddItemModal() {
    addItemModal.classList.remove('active');
    document.getElementById('item-content').value = '';
    const descriptionInput = document.getElementById('item-description');
    if (descriptionInput) descriptionInput.value = '';
    const notesInput = document.getElementById('item-notes');
    if (notesInput) notesInput.value = '';
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
        const editModal = document.getElementById('edit-item-modal');
        if (event.target == editModal) closeEditItemModal();
    }
});
