// DOM Elements & State
const listsGrid = document.getElementById('lists-grid');
const createModal = document.getElementById('create-modal');
const addItemModal = document.getElementById('add-item-modal');

// --- Dashboard Functions ---

async function loadDashboard() {
    if (!listsGrid) return; // Not on dashboard
    
    try {
        const res = await fetch('/api/lists');
        const lists = await res.json();
        
        listsGrid.innerHTML = lists.map(list => `
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
        `).join('');
    } catch (e) {
        console.error('Error loading lists:', e);
    }
}

// --- List View Functions ---

async function createItem(listId, listType) {
    const input = document.getElementById('item-content');
    const content = input.value.trim();
    if (!content) return;
    
    try {
        const res = await fetch(`/api/lists/${listId}/items`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                content,
                is_project: listType === 'hub'
            })
        });
        
        if (res.ok) {
            closeAddItemModal();
            window.location.reload(); // Simple reload to refresh state
        }
    } catch (e) {
        console.error('Error creating item:', e);
    }
}

async function toggleItemStatus(itemId, currentStatus) {
    const newStatus = currentStatus === 'done' ? 'pending' : 'done';
    updateItemStatus(itemId, newStatus);
}

async function cycleStatus(itemId, currentStatus) {
    const states = ['pending', 'in_progress', 'done'];
    const nextIndex = (states.indexOf(currentStatus) + 1) % states.length;
    updateItemStatus(itemId, states[nextIndex]);
}

async function updateItemStatus(itemId, status) {
    try {
        const res = await fetch(`/api/items/${itemId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ status })
        });
        
        if (res.ok) {
            window.location.reload();
        }
    } catch (e) {
        console.error('Error updating item:', e);
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
}

async function createList() {
    const title = document.getElementById('list-title').value.trim();
    const type = document.getElementById('list-type').value;
    
    if (!title) return;
    
    try {
        const res = await fetch('/api/lists', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ title, type })
        });
        
        if (res.ok) {
            closeCreateModal();
            loadDashboard();
        }
    } catch (e) {
        console.error('Error creating list:', e);
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
    window.onclick = function(event) {
        if (event.target == createModal) closeCreateModal();
        if (event.target == addItemModal) closeAddItemModal();
    }
});
