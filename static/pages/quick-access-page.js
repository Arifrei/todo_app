const qaItemsById = new Map();
let qaEditingId = null;
const QA_ICON_DEFAULT = 'fa-solid fa-bookmark';
const QA_ICON_OPTIONS = [
    { icon: 'fa-solid fa-bookmark', label: 'Bookmark' },
    { icon: 'fa-solid fa-star', label: 'Star' },
    { icon: 'fa-solid fa-calendar-day', label: 'Calendar' },
    { icon: 'fa-solid fa-list-check', label: 'Tasks' },
    { icon: 'fa-solid fa-note-sticky', label: 'Note' },
    { icon: 'fa-solid fa-folder', label: 'Folder' },
    { icon: 'fa-solid fa-bolt', label: 'Quick' },
    { icon: 'fa-solid fa-link', label: 'Link' },
    { icon: 'fa-solid fa-briefcase', label: 'Work' },
    { icon: 'fa-solid fa-house', label: 'Home' },
    { icon: 'fa-solid fa-graduation-cap', label: 'Learn' },
    { icon: 'fa-solid fa-heart', label: 'Personal' }
];

function normalizeQAIconClass(iconClass) {
    const normalized = String(iconClass || '').trim();
    return normalized || QA_ICON_DEFAULT;
}

function getQAIconOption(iconClass) {
    return QA_ICON_OPTIONS.find((option) => option.icon === iconClass) || null;
}

function setQAIconDropdownOpen(isOpen) {
    const grid = document.getElementById('qa-icon-grid');
    const button = document.getElementById('qa-icon-dropdown-btn');
    if (!grid || !button) return;
    grid.classList.toggle('u-hidden', !isOpen);
    button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function syncQAIconSelection(iconClass, { updateInput = true } = {}) {
    const normalized = normalizeQAIconClass(iconClass);
    const iconInput = document.getElementById('qa-icon');
    const dropdownSelectedIcon = document.getElementById('qa-icon-dropdown-selected');
    const iconGrid = document.getElementById('qa-icon-grid');
    const previewIcon = document.getElementById('qa-icon-preview-icon');
    const previewText = document.getElementById('qa-icon-preview-text');

    if (updateInput && iconInput) {
        iconInput.value = normalized;
    }
    if (dropdownSelectedIcon) {
        dropdownSelectedIcon.className = normalized;
    }
    if (previewIcon) {
        previewIcon.className = normalized;
    }
    if (iconGrid) {
        iconGrid.querySelectorAll('.qa-icon-grid-item').forEach((btn) => {
            const isSelected = btn.dataset.icon === normalized;
            btn.classList.toggle('selected', isSelected);
            btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        });
    }
    if (previewText) {
        const matched = getQAIconOption(normalized);
        previewText.textContent = matched ? `Selected: ${matched.label}` : 'Selected: Custom icon';
    }
}

function renderQAIconPicker() {
    const grid = document.getElementById('qa-icon-grid');
    if (!grid || grid.dataset.ready === '1') return;
    grid.dataset.ready = '1';
    grid.innerHTML = '';

    QA_ICON_OPTIONS.forEach((option) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'qa-icon-grid-item';
        button.dataset.icon = option.icon;
        button.setAttribute('role', 'option');
        button.setAttribute('aria-label', option.label);
        button.setAttribute('aria-selected', 'false');
        button.title = option.label;
        button.innerHTML = `<i class="${option.icon}" aria-hidden="true"></i>`;
        button.addEventListener('click', () => {
            syncQAIconSelection(option.icon);
            setQAIconDropdownOpen(false);
        });
        grid.appendChild(button);
    });
}

// Load user's quick access items
async function loadQuickAccessItems() {
    try {
        const response = await fetch('/api/quick-access');
        const items = await response.json();
        const grid = document.getElementById('quick-access-grid');

        // Keep the system "Today" button and append custom items
        const systemCards = Array.from(grid.querySelectorAll('.system-item'));
        grid.innerHTML = '';
        systemCards.forEach(card => grid.appendChild(card));
        qaItemsById.clear();

        items.forEach(item => {
            qaItemsById.set(item.id, item);
            const card = document.createElement('a');
            card.className = 'quick-access-card' + (item.is_protected ? ' protected' : '');
            card.href = item.url;
            card.dataset.id = item.id;
            card.dataset.protected = item.is_protected ? 'true' : 'false';
            card.dataset.protectedType = item.protected_type || '';
            card.dataset.itemType = item.item_type || '';
            card.dataset.referenceId = item.reference_id || '';
            if (item.protected_folder_id) {
                card.dataset.protectedFolderId = item.protected_folder_id;
            }

            const lockIcon = item.is_protected ? '<i class="quick-access-lock fa-solid fa-lock"></i>' : '';

            card.innerHTML = `
                <div class="quick-access-icon"><i class="${item.icon}"></i></div>
                <div class="quick-access-title">${escapeHtml(item.title)}${lockIcon}</div>
                <button class="quick-access-edit" type="button" title="Edit">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="quick-access-delete" type="button" title="Delete">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            `;

            // Add click handler for protected items
            card.addEventListener('click', handleQuickAccessCardClick);
            const editBtn = card.querySelector('.quick-access-edit');
            if (editBtn) {
                editBtn.addEventListener('click', (event) => openEditQuickAccessModal(item.id, event));
            }
            const deleteBtn = card.querySelector('.quick-access-delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (event) => deleteQuickAccessItem(item.id, event));
            }

            grid.appendChild(card);
        });

        initQuickAccessEditMode();
    } catch (error) {
        console.error('Failed to load quick access items:', error);
    }
}

// Handle click on quick access card - check for protection
function handleQuickAccessCardClick(e) {
    // Don't intercept edit mode or button clicks
    if (qaEditMode.active || qaDragState.dragMoved || qaTouchState.active) return;
    if (e.target.closest('.quick-access-edit') || e.target.closest('.quick-access-delete')) return;

    const card = e.currentTarget;
    const isProtected = card.dataset.protected === 'true';
    if (!isProtected) return; // Let normal navigation happen

    e.preventDefault();
    e.stopPropagation();

    const protectedType = card.dataset.protectedType;
    const itemType = card.dataset.itemType;
    const referenceId = card.dataset.referenceId;
    const protectedFolderId = card.dataset.protectedFolderId;
    const targetUrl = card.href;
    // Store pending action for PIN verification using Quick Access specific state
    window.qaProtectedState.pendingUrl = targetUrl;
    window.qaProtectedState.protectedType = protectedType;
    window.qaProtectedState.itemType = itemType;
    window.qaProtectedState.referenceId = referenceId ? parseInt(referenceId) : null;
    window.qaProtectedState.protectedFolderId = protectedFolderId ? parseInt(protectedFolderId) : null;
    window.qaProtectedState.active = true;

    openPinModal();
}

// Quick Access protected state - exposed globally for app.js to check
window.qaProtectedState = {
    active: false,
    pendingUrl: null,
    protectedType: null,
    itemType: null,
    referenceId: null,
    protectedFolderId: null
};

// Verify PIN for Quick Access protected items - exposed globally for app.js to call
window.verifyQAProtectedPin = async function(pin) {
    const { protectedType, itemType, referenceId, protectedFolderId, pendingUrl } = window.qaProtectedState;

    try {
        let unlockEndpoint;

        // Determine what to unlock
        if (protectedType === 'note' && itemType === 'note') {
            unlockEndpoint = `/api/notes/${referenceId}/unlock`;
        } else if (protectedType === 'folder' && itemType === 'folder') {
            unlockEndpoint = `/api/note-folders/${referenceId}/unlock`;
        } else if (protectedType === 'parent_folder') {
            // Note is in a protected folder - unlock the folder first
            unlockEndpoint = `/api/note-folders/${protectedFolderId}/unlock`;
        } else {
            showToast('Unknown protection type', 'error', 3000);
            return false;
        }

        const res = await fetch(unlockEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin })
        });

        if (res.ok) {
            closePinModal();
            window.qaProtectedState.active = false;
            // Navigate to the target
            window.location.href = pendingUrl;
            return true;
        } else {
            const data = await res.json();
            showToast(data.error || 'Incorrect PIN', 'error', 3000);
            const input = document.getElementById('pin-input');
            if (input) input.value = '';
            return false;
        }
    } catch (e) {
        console.error('Error verifying PIN:', e);
        showToast('Error verifying PIN', 'error', 3000);
        return false;
    }
};

function setQuickAccessModalMode(mode) {
    const titleEl = document.getElementById('qa-modal-title');
    const saveBtn = document.getElementById('qa-save-btn');
    if (!titleEl || !saveBtn) return;
    if (mode === 'edit') {
        titleEl.textContent = 'Edit Quick Access Item';
        saveBtn.textContent = 'Save';
    } else {
        titleEl.textContent = 'Add Quick Access Item';
        saveBtn.textContent = 'Add';
    }
}

function openAddQuickAccessModal() {
    qaEditingId = null;
    setQuickAccessModalMode('add');
    document.getElementById('add-quick-access-modal').classList.add('active');
    setQAIconDropdownOpen(false);
    // Reset form
    document.getElementById('qa-title').value = '';
    syncQAIconSelection(QA_ICON_DEFAULT);
    document.getElementById('qa-type').value = 'custom';
    document.getElementById('qa-url').value = '';
    document.getElementById('qa-date').value = '';

    resetQANavState();
    resetQANoteNavState();
    resetQAFolderNavState();
    handleQuickAccessTypeChange();

    // Load lists and notes for dropdowns
    loadListsForQuickAccess();
    loadNotesForQuickAccess();
}

function closeAddQuickAccessModal() {
    document.getElementById('add-quick-access-modal').classList.remove('active');
    setQAIconDropdownOpen(false);
    qaEditingId = null;
    setQuickAccessModalMode('add');
    resetQANavState();
    resetQANoteNavState();
    resetQAFolderNavState();
}

// Close modal when clicking outside
document.addEventListener('click', function(e) {
    const modal = document.getElementById('add-quick-access-modal');
    if (modal && e.target === modal) {
        closeAddQuickAccessModal();
    }
});

function handleQuickAccessTypeChange() {
    const type = document.getElementById('qa-type').value;
    document.getElementById('qa-url-group').style.display = type === 'custom' ? 'block' : 'none';
    document.getElementById('qa-list-group').style.display = type === 'list' ? 'block' : 'none';
    document.getElementById('qa-note-group').style.display = type === 'note' ? 'block' : 'none';
    document.getElementById('qa-folder-group').style.display = type === 'folder' ? 'block' : 'none';
    document.getElementById('qa-date-group').style.display = type === 'calendar' ? 'block' : 'none';

    if (type === 'folder') {
        loadFoldersForQuickAccess();
    }
}

// Quick Access navigation state
let qaNavState = {
    currentParent: null,
    stack: [],
    allLists: [],
    selectedListId: null,
    selectedListTitle: ''
};

function resetQANavState() {
    qaNavState = {
        currentParent: null,
        stack: [],
        allLists: [],
        selectedListId: null,
        selectedListTitle: ''
    };
}

// Quick Access note navigation state
let qaNoteNavState = {
    currentFolderId: null,
    stack: [],
    folders: [],
    notes: [],
    selectedNoteId: null,
    selectedNoteTitle: '',
    selectedNoteType: ''
};

function resetQANoteNavState() {
    qaNoteNavState = {
        currentFolderId: null,
        stack: [],
        folders: [],
        notes: [],
        selectedNoteId: null,
        selectedNoteTitle: '',
        selectedNoteType: ''
    };
}

async function loadListsForQuickAccess(selectedListId = null, selectedListTitle = '') {
    try {
        const response = await fetch('/api/lists?include_children=true');
        qaNavState.allLists = await response.json();
        qaNavState.currentParent = null;
        qaNavState.stack = [];
        if (selectedListId) {
            qaNavState.selectedListId = selectedListId;
            qaNavState.selectedListTitle = selectedListTitle || '';
        }
        renderQANavigation();
    } catch (error) {
        console.error('Failed to load lists:', error);
    }
}

function renderQANavigation() {
    const container = document.getElementById('qa-list-nav-container');
    const backButton = document.getElementById('qa-back-button');

    if (!container) return;

    container.innerHTML = '';

    // Hide back button at root level
    backButton.style.display = 'none';

    // At root level, show only root-level lists (not nested children)
    // Build a set of all linked_list_ids to identify which lists are children
    const childListIds = new Set();
    qaNavState.allLists.forEach(list => {
        if (list.items) {
            list.items.forEach(item => {
                if (item.linked_list_id) {
                    childListIds.add(item.linked_list_id);
                }
            });
        }
    });

    // Filter to show only lists that are NOT children of any hub
    const itemsToShow = qaNavState.allLists.filter(list => !childListIds.has(list.id));

    if (itemsToShow.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'qa-nav-empty';
        empty.textContent = 'No projects available.';
        container.appendChild(empty);
        return;
    }

    itemsToShow.forEach(list => {
        const item = document.createElement('button');
        item.className = 'qa-nav-item';
        item.dataset.listId = list.id;

        const icon = list.type === 'hub'
            ? '<i class="fa-solid fa-folder-tree"></i>'
            : '<i class="fa-solid fa-list-check"></i>';

        const arrow = list.type === 'hub'
            ? '<i class="fa-solid fa-chevron-right"></i>'
            : '';

        item.innerHTML = `
            ${icon}
            <span>${escapeHtml(list.title)}</span>
            ${arrow}
        `;

        if (list.type === 'hub') {
            // Navigate into hub
            item.onclick = () => navigateIntoHub(list.id);
        } else {
            // Select this list
            item.onclick = () => selectQAList(list.id, list.title);
        }

        container.appendChild(item);
    });

    highlightSelectedQAList();
}

function navigateIntoHub(hubId) {
    qaNavState.stack.push(qaNavState.currentParent);
    qaNavState.currentParent = hubId;

    // Fetch hub's children
    fetch(`/api/lists/${hubId}`)
        .then(r => r.json())
        .then(hub => {
            // Update allLists to include children information
            renderQANavigationWithChildren(hub);
        })
        .catch(err => {
            console.error('Failed to load hub details:', err);
        });
}

function renderQANavigationWithChildren(hub) {
    const container = document.getElementById('qa-list-nav-container');
    const backButton = document.getElementById('qa-back-button');

    if (!container) return;

    container.innerHTML = '';
    backButton.style.display = 'inline-block';

    // Add option to select the hub itself
    const addHubBtn = document.createElement('button');
    addHubBtn.className = 'qa-nav-item qa-nav-current';
    addHubBtn.dataset.listId = hub.id;
    addHubBtn.innerHTML = `
        <i class="fa-solid fa-folder-tree"></i>
        <span>Add "${escapeHtml(hub.title)}" (This Hub)</span>
    `;
    addHubBtn.onclick = () => selectQAList(hub.id, hub.title);
    container.appendChild(addHubBtn);

    const divider = document.createElement('div');
    divider.className = 'qa-nav-divider';
    divider.textContent = 'Or select a child project:';
    container.appendChild(divider);

    // Show child projects
    const children = hub.items.filter(item => item.linked_list_id);

    if (children.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'qa-nav-empty';
        empty.textContent = 'This hub has no child projects.';
        container.appendChild(empty);
        return;
    }

    children.forEach(item => {
        const childList = qaNavState.allLists.find(l => l.id === item.linked_list_id);
        if (!childList) return;

        const navItem = document.createElement('button');
        navItem.className = 'qa-nav-item';
        navItem.dataset.listId = childList.id;

        const icon = childList.type === 'hub'
            ? '<i class="fa-solid fa-folder-tree"></i>'
            : '<i class="fa-solid fa-list-check"></i>';

        const arrow = childList.type === 'hub'
            ? '<i class="fa-solid fa-chevron-right"></i>'
            : '';

        navItem.innerHTML = `
            ${icon}
            <span>${escapeHtml(childList.title)}</span>
            ${arrow}
        `;

        if (childList.type === 'hub') {
            navItem.onclick = () => navigateIntoHub(childList.id);
        } else {
            navItem.onclick = () => selectQAList(childList.id, childList.title);
        }

        container.appendChild(navItem);
    });

    highlightSelectedQAList();
}

function qaNavBack() {
    if (qaNavState.stack.length === 0) return;

    const previousParent = qaNavState.stack.pop();
    qaNavState.currentParent = previousParent;

    if (previousParent === null) {
        renderQANavigation();
    } else {
        // Fetch the previous hub's details
        fetch(`/api/lists/${previousParent}`)
            .then(r => r.json())
            .then(hub => {
                renderQANavigationWithChildren(hub);
            })
            .catch(err => {
                console.error('Failed to load hub details:', err);
                renderQANavigation();
            });
    }
}

function selectQAList(listId, listTitle) {
    qaNavState.selectedListId = listId;
    qaNavState.selectedListTitle = listTitle;

    // Update the title field if it's empty
    const titleInput = document.getElementById('qa-title');
    if (titleInput && !titleInput.value.trim()) {
        titleInput.value = listTitle;
    }

    // Visual feedback
    const container = document.getElementById('qa-list-nav-container');
    if (container) {
        const items = container.querySelectorAll('.qa-nav-item');
        items.forEach(item => item.classList.remove('selected'));

        const selectedItem = Array.from(items).find(item =>
            item.textContent.includes(listTitle)
        );
        if (selectedItem) {
            selectedItem.classList.add('selected');
        }
    }
}

function highlightSelectedQAList() {
    if (!qaNavState.selectedListId) return;
    const container = document.getElementById('qa-list-nav-container');
    if (!container) return;
    const items = container.querySelectorAll('.qa-nav-item');
    items.forEach(item => item.classList.remove('selected'));
    const selectedItem = container.querySelector(`[data-list-id="${qaNavState.selectedListId}"]`);
    if (selectedItem) {
        selectedItem.classList.add('selected');
    }
}

async function loadNotesForQuickAccess(selectedNoteId = '') {
    try {
        const folderReq = fetch('/api/note-folders');
        const noteReq = selectedNoteId ? fetch(`/api/notes/${selectedNoteId}`) : null;

        const [foldersRes, noteRes] = await Promise.all([folderReq, noteReq]);
        const folders = foldersRes.ok ? await foldersRes.json() : [];
        let selectedNote = null;
        if (noteRes && noteRes.ok) {
            selectedNote = await noteRes.json();
        }

        qaNoteNavState.folders = folders || [];
        qaNoteNavState.selectedNoteId = selectedNote ? selectedNote.id : null;
        qaNoteNavState.selectedNoteTitle = selectedNote ? (selectedNote.title || '') : '';
        qaNoteNavState.selectedNoteType = selectedNote ? (selectedNote.note_type || 'note') : '';

        const initialFolderId = selectedNote ? (selectedNote.folder_id || null) : null;
        qaNoteNavState.currentFolderId = initialFolderId;
        qaNoteNavState.stack = buildNoteFolderStack(initialFolderId, qaNoteNavState.folders);

        await renderQANoteNavigation();
    } catch (error) {
        console.error('Failed to load notes:', error);
    }
}

function buildNoteFolderStack(folderId, folders) {
    if (!folderId) return [];
    const folderMap = new Map((folders || []).map(folder => [folder.id, folder]));
    const path = [];
    let current = folderId;
    while (current) {
        path.unshift(current);
        const folder = folderMap.get(current);
        if (!folder) break;
        current = folder.parent_id || null;
    }
    return [null, ...path.slice(0, -1)];
}

function updateQANoteBackButton() {
    const backButton = document.getElementById('qa-note-back-button');
    if (!backButton) return;
    backButton.style.display = qaNoteNavState.stack.length ? 'inline-flex' : 'none';
}

async function renderQANoteNavigation() {
    const container = document.getElementById('qa-note-nav-container');
    if (!container) return;

    container.innerHTML = '';
    updateQANoteBackButton();

    const folderId = qaNoteNavState.currentFolderId;
    let notes = [];
    try {
        const query = folderId ? `?folder_id=${folderId}` : '';
        const res = await fetch(`/api/notes${query}`);
        notes = res.ok ? await res.json() : [];
    } catch (err) {
        console.error('Failed to load notes for navigation:', err);
        notes = [];
    }

    qaNoteNavState.notes = notes || [];

    const folders = (qaNoteNavState.folders || [])
        .filter(folder => (folder.parent_id || null) === (folderId || null))
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    const hasItems = folders.length || qaNoteNavState.notes.length;
    if (!hasItems) {
        const empty = document.createElement('div');
        empty.className = 'qa-nav-empty';
        empty.textContent = 'No notes here.';
        container.appendChild(empty);
        return;
    }

    folders.forEach(folder => {
        const item = document.createElement('button');
        item.className = 'qa-nav-item';
        item.dataset.folderId = folder.id;
        item.innerHTML = `
            <i class="fa-solid fa-folder"></i>
            <span>${escapeHtml(folder.name)}</span>
            <span class="qa-nav-type">Folder</span>
            <i class="fa-solid fa-chevron-right"></i>
        `;
        item.onclick = () => navigateQANoteFolder(folder.id);
        container.appendChild(item);
    });

    qaNoteNavState.notes.forEach(note => {
        const item = document.createElement('button');
        item.className = 'qa-nav-item';
        item.dataset.noteId = note.id;

        const isList = note.note_type === 'list';
        const icon = isList ? 'fa-list' : 'fa-note-sticky';
        const typeLabel = isList ? 'List' : 'Note';

        item.innerHTML = `
            <i class="fa-solid ${icon}"></i>
            <span>${escapeHtml(note.title || 'Untitled')}</span>
            <span class="qa-nav-type">${typeLabel}</span>
        `;

        item.onclick = () => selectQANote(note);
        container.appendChild(item);
    });

    highlightSelectedQANote();
}

function navigateQANoteFolder(folderId) {
    qaNoteNavState.stack.push(qaNoteNavState.currentFolderId);
    qaNoteNavState.currentFolderId = folderId;
    renderQANoteNavigation();
}

function qaNoteNavBack() {
    if (!qaNoteNavState.stack.length) return;
    const previousParent = qaNoteNavState.stack.pop();
    qaNoteNavState.currentFolderId = previousParent === undefined ? null : previousParent;
    renderQANoteNavigation();
}

function selectQANote(note) {
    qaNoteNavState.selectedNoteId = note.id;
    qaNoteNavState.selectedNoteTitle = note.title || '';
    qaNoteNavState.selectedNoteType = note.note_type || 'note';

    const titleInput = document.getElementById('qa-title');
    if (titleInput && !titleInput.value.trim()) {
        titleInput.value = note.title || '';
    }

    highlightSelectedQANote();
}

function highlightSelectedQANote() {
    if (!qaNoteNavState.selectedNoteId) return;
    const container = document.getElementById('qa-note-nav-container');
    if (!container) return;
    const items = container.querySelectorAll('.qa-nav-item');
    items.forEach(item => item.classList.remove('selected'));
    const selectedItem = container.querySelector(`[data-note-id="${qaNoteNavState.selectedNoteId}"]`);
    if (selectedItem) {
        selectedItem.classList.add('selected');
    }
}

// Quick Access folder navigation state
let qaFolderNavState = {
    currentFolderId: null,
    stack: [],
    folders: [],
    selectedFolderId: null,
    selectedFolderName: ''
};

function buildFolderStack(folderId, folders) {
    if (!folderId) return [];
    const folderMap = new Map((folders || []).map(folder => [folder.id, folder]));
    const path = [];
    let current = folderId;
    while (current) {
        path.unshift(current);
        const folder = folderMap.get(current);
        if (!folder) break;
        current = folder.parent_id || null;
    }
    return [null, ...path.slice(0, -1)];
}

function resetQAFolderNavState() {
    qaFolderNavState = {
        currentFolderId: null,
        stack: [],
        folders: [],
        selectedFolderId: null,
        selectedFolderName: ''
    };
}

async function loadFoldersForQuickAccess(selectedFolderId = null) {
    try {
        const res = await fetch('/api/note-folders');
        qaFolderNavState.folders = res.ok ? await res.json() : [];
        if (selectedFolderId) {
            qaFolderNavState.selectedFolderId = selectedFolderId;
            const folder = qaFolderNavState.folders.find(f => f.id === selectedFolderId);
            qaFolderNavState.selectedFolderName = folder ? folder.name : '';
            qaFolderNavState.currentFolderId = selectedFolderId;
            qaFolderNavState.stack = buildFolderStack(selectedFolderId, qaFolderNavState.folders);
        } else {
            qaFolderNavState.currentFolderId = null;
            qaFolderNavState.stack = [];
        }
        renderQAFolderNavigation();
    } catch (error) {
        console.error('Failed to load folders:', error);
    }
}

function renderQAFolderNavigation() {
    const container = document.getElementById('qa-folder-nav-container');
    const backButton = document.getElementById('qa-folder-back-button');
    if (!container) return;

    container.innerHTML = '';
    backButton.style.display = qaFolderNavState.stack.length ? 'inline-flex' : 'none';

    const folderId = qaFolderNavState.currentFolderId;
    const folders = (qaFolderNavState.folders || [])
        .filter(folder => (folder.parent_id || null) === (folderId || null))
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    if (folderId) {
        const currentFolder = qaFolderNavState.folders.find(f => f.id === folderId);
        const currentItem = document.createElement('button');
        currentItem.className = 'qa-nav-item qa-nav-current';
        currentItem.dataset.folderId = folderId;
        currentItem.innerHTML = `
            <i class="fa-solid fa-folder-open"></i>
            <span>Add "${escapeHtml(currentFolder ? currentFolder.name : 'Folder')}" (This Folder)</span>
        `;
        currentItem.onclick = () => selectQAFolder(folderId, currentFolder ? currentFolder.name : 'Folder');
        container.appendChild(currentItem);

        const divider = document.createElement('div');
        divider.className = 'qa-nav-divider';
        divider.textContent = 'Or choose a subfolder:';
        container.appendChild(divider);
    }

    if (folders.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'qa-nav-empty';
        empty.textContent = folderId ? 'No subfolders here.' : 'No folders available.';
        container.appendChild(empty);
        return;
    }

    folders.forEach(folder => {
        const item = document.createElement('button');
        item.className = 'qa-nav-item';
        item.dataset.folderId = folder.id;

        const hasChildren = qaFolderNavState.folders.some(f => f.parent_id === folder.id);
        const arrow = '<i class="fa-solid fa-chevron-right"></i>';
        const lockIcon = folder.is_pin_protected ? '<i class="fa-solid fa-lock" style="margin-left: 0.5rem; color: var(--text-muted);"></i>' : '';

        item.innerHTML = `
            <i class="fa-solid fa-folder"></i>
            <span>${escapeHtml(folder.name)}${lockIcon}</span>
            ${arrow}
        `;

        item.onclick = (e) => {
            e.preventDefault();
            navigateQAFolder(folder.id);
        };

        container.appendChild(item);
    });

    highlightSelectedQAFolder();
}

function navigateQAFolder(folderId) {
    qaFolderNavState.stack.push(qaFolderNavState.currentFolderId);
    qaFolderNavState.currentFolderId = folderId;
    renderQAFolderNavigation();
}

function qaFolderNavBack() {
    if (!qaFolderNavState.stack.length) return;
    const previousParent = qaFolderNavState.stack.pop();
    qaFolderNavState.currentFolderId = previousParent === undefined ? null : previousParent;
    renderQAFolderNavigation();
}

function selectQAFolder(folderId, folderName) {
    qaFolderNavState.selectedFolderId = folderId;
    qaFolderNavState.selectedFolderName = folderName;

    const titleInput = document.getElementById('qa-title');
    if (titleInput && !titleInput.value.trim()) {
        titleInput.value = folderName;
    }

    highlightSelectedQAFolder();
}

function highlightSelectedQAFolder() {
    if (!qaFolderNavState.selectedFolderId) return;
    const container = document.getElementById('qa-folder-nav-container');
    if (!container) return;
    const items = container.querySelectorAll('.qa-nav-item');
    items.forEach(item => item.classList.remove('selected'));
    const selectedItem = container.querySelector(`[data-folder-id="${qaFolderNavState.selectedFolderId}"]`);
    if (selectedItem) {
        selectedItem.classList.add('selected');
    }
}

function extractCalendarDate(url) {
    if (!url) return '';
    const match = url.match(/[?&]day=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

function openEditQuickAccessModal(id, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const item = qaItemsById.get(id);
    if (!item) return;

    qaEditingId = id;
    setQuickAccessModalMode('edit');
    document.getElementById('add-quick-access-modal').classList.add('active');
    setQAIconDropdownOpen(false);

    document.getElementById('qa-title').value = item.title || '';
    syncQAIconSelection(item.icon || QA_ICON_DEFAULT);
    document.getElementById('qa-type').value = item.item_type || 'custom';
    document.getElementById('qa-url').value = item.url || '';
    document.getElementById('qa-date').value = item.item_type === 'calendar' ? extractCalendarDate(item.url) : '';

    resetQANavState();
    resetQAFolderNavState();
    if (item.item_type === 'list' && item.reference_id) {
        qaNavState.selectedListId = item.reference_id;
        qaNavState.selectedListTitle = item.title || '';
        loadListsForQuickAccess(item.reference_id, item.title || '');
    } else {
        loadListsForQuickAccess();
    }

    if (item.item_type === 'note' && item.reference_id) {
        loadNotesForQuickAccess(item.reference_id);
    } else {
        loadNotesForQuickAccess();
    }

    if (item.item_type === 'folder' && item.reference_id) {
        loadFoldersForQuickAccess(item.reference_id);
    } else {
        loadFoldersForQuickAccess();
    }

    handleQuickAccessTypeChange();
}

async function saveQuickAccessItem() {
    const type = document.getElementById('qa-type').value;
    const title = document.getElementById('qa-title').value.trim();
    const icon = normalizeQAIconClass(document.getElementById('qa-icon').value);

    if (!title) {
        showToast('Please enter a title', 'warning');
        return;
    }

    let url = '';
    let referenceId = null;

    if (type === 'custom') {
        url = document.getElementById('qa-url').value.trim();
        if (!url) {
            showToast('Please enter a URL', 'warning');
            return;
        }
    } else if (type === 'list') {
        if (!qaNavState.selectedListId) {
            showToast('Please select a list', 'warning');
            return;
        }
        url = `/list/${qaNavState.selectedListId}`;
        referenceId = qaNavState.selectedListId;
    } else if (type === 'note') {
        const noteId = qaNoteNavState.selectedNoteId;
        if (!noteId) {
            showToast('Please select a note', 'warning');
            return;
        }
        url = `/notes/${noteId}`;
        referenceId = parseInt(noteId);
    } else if (type === 'folder') {
        const folderId = qaFolderNavState.selectedFolderId;
        if (!folderId) {
            showToast('Please select a folder', 'warning');
            return;
        }
        url = `/notes/folder/${folderId}`;
        referenceId = parseInt(folderId);
    } else if (type === 'calendar') {
        const dateValue = document.getElementById('qa-date').value;
        if (!dateValue) {
            showToast('Please select a date', 'warning');
            return;
        }
        url = `/calendar?day=${dateValue}&mode=day`;
    }

    try {
        const isEdit = !!qaEditingId;
        const endpoint = isEdit ? `/api/quick-access/${qaEditingId}` : '/api/quick-access';
        const method = isEdit ? 'PUT' : 'POST';
        const response = await fetch(endpoint, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: title,
                icon: icon,
                url: url,
                item_type: type,
                reference_id: referenceId
            })
        });

        if (response.ok) {
            closeAddQuickAccessModal();
            loadQuickAccessItems();
            showToast(isEdit ? 'Quick access item updated' : 'Quick access item added', 'success');
        } else {
            showToast(`Failed to ${isEdit ? 'update' : 'add'} item`, 'error');
        }
    } catch (error) {
        console.error('Failed to save quick access item:', error);
        showToast('Failed to save item', 'error');
    }
}

async function deleteQuickAccessItem(id, event) {
    event.preventDefault();
    event.stopPropagation();
    openConfirmModal('Remove this item from quick access?', async () => {
        try {
            const response = await fetch(`/api/quick-access/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                const card = document.querySelector(`[data-id="${id}"]`);
                if (card) {
                    card.remove();
                }
            } else {
                showToast('Failed to delete item', 'error');
            }
        } catch (error) {
            console.error('Failed to delete quick access item:', error);
            showToast('Failed to delete item', 'error');
        }
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

let qaDragState = {
    draggingEl: null,
    dragMoved: false,
    orderChanged: false
};

let qaTouchState = {
    active: false,
    card: null,
    clone: null,
    offsetX: 0,
    offsetY: 0
};

let qaEditMode = {
    active: false,
    longPressTimer: null,
    longPressTriggered: false,
    touchStart: null,
    currentDragCard: null
};

function initQuickAccessEditMode() {
    const grid = document.getElementById('quick-access-grid');
    if (!grid) return;

    const cards = Array.from(grid.querySelectorAll('.quick-access-card:not(.system-item)'));
    cards.forEach(card => {
        card.classList.add('qa-draggable');
        card.removeAttribute('draggable');
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        if (card.dataset.qaInit !== 'true') {
            card.dataset.qaInit = 'true';
            // Desktop events
            card.addEventListener('click', preventQuickAccessNavigation, true);
            card.addEventListener('mousedown', handleQuickAccessMouseDown);
            card.addEventListener('mouseup', handleQuickAccessMouseUp);
            card.addEventListener('mouseleave', handleQuickAccessMouseUp);
            card.addEventListener('dragstart', handleQuickAccessDragStart);
            card.addEventListener('dragend', handleQuickAccessDragEnd);
            card.addEventListener('dragover', handleQuickAccessDragOver);
            card.addEventListener('drop', handleQuickAccessDrop);

            // Mobile touch events - unified handler
            card.addEventListener('touchstart', handleQuickAccessTouchStart, { passive: false });
            card.addEventListener('touchmove', handleQuickAccessTouchMove, { passive: false });
            card.addEventListener('touchend', handleQuickAccessTouchEnd);
            card.addEventListener('touchcancel', handleQuickAccessTouchEnd);
        }
    });

    const doneBtn = document.getElementById('quick-access-done-btn');
    if (doneBtn && !doneBtn.dataset.qaInit) {
        doneBtn.dataset.qaInit = 'true';
        doneBtn.addEventListener('click', exitQuickAccessEditMode);
    }

    // Global click handler to exit edit mode when clicking outside
    if (!grid.dataset.qaGlobalInit) {
        grid.dataset.qaGlobalInit = 'true';

        // Grid-level dragover for handling drops in empty areas
        grid.addEventListener('dragover', (e) => {
            if (!qaEditMode.active || !qaEditMode.currentDragCard) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const draggingCard = qaEditMode.currentDragCard;
            const targetPosition = getQuickAccessInsertPosition(grid, e.clientX, e.clientY, draggingCard);

            if (targetPosition.insertBefore) {
                if (targetPosition.insertBefore !== draggingCard &&
                    targetPosition.insertBefore !== draggingCard.nextElementSibling) {
                    grid.insertBefore(draggingCard, targetPosition.insertBefore);
                    qaDragState.dragMoved = true;
                }
            } else if (targetPosition.append) {
                const lastChild = grid.lastElementChild;
                if (lastChild !== draggingCard) {
                    grid.appendChild(draggingCard);
                    qaDragState.dragMoved = true;
                }
            }
        });

        document.addEventListener('click', (e) => {
            if (!qaEditMode.active) return;
            if (e.target.closest('.quick-access-card')) return;
            if (e.target.closest('#quick-access-done-btn')) return;
            if (e.target.closest('#add-quick-access-modal')) return;
            if (e.target.closest('.modal')) return;
            exitQuickAccessEditMode();
        });
    }
}

function enterQuickAccessEditMode() {
    if (qaEditMode.active) return;
    qaEditMode.active = true;
    qaDragState.orderChanged = false;

    const grid = document.getElementById('quick-access-grid');
    const doneBtn = document.getElementById('quick-access-done-btn');
    if (grid) {
        grid.classList.add('edit-mode');
        grid.querySelectorAll('.quick-access-card.qa-draggable').forEach(card => {
            card.setAttribute('draggable', 'true');
            card.classList.add('wiggle');
        });
    }
    if (doneBtn) {
        doneBtn.style.display = 'inline-flex';
    }
}

function exitQuickAccessEditMode() {
    if (!qaEditMode.active) return;
    qaEditMode.active = false;

    const grid = document.getElementById('quick-access-grid');
    const doneBtn = document.getElementById('quick-access-done-btn');
    if (grid) {
        grid.classList.remove('edit-mode');
        grid.querySelectorAll('.quick-access-card.qa-draggable').forEach(card => {
            card.removeAttribute('draggable');
            card.classList.remove('dragging');
            card.classList.remove('wiggle');
            card.style.opacity = '';
        });
    }
    if (doneBtn) {
        doneBtn.style.display = 'none';
    }

    // Clean up any leftover clones
    document.querySelectorAll('.touch-drag-clone').forEach(el => el.remove());

    // Save order if changed
    if (qaDragState.orderChanged) {
        saveQuickAccessOrder();
    }

    qaDragState.draggingEl = null;
    qaDragState.dragMoved = false;
    qaDragState.orderChanged = false;
    qaEditMode.currentDragCard = null;
    qaTouchState.active = false;
    qaTouchState.card = null;
    qaTouchState.clone = null;
}

async function saveQuickAccessOrder() {
    const grid = document.getElementById('quick-access-grid');
    if (!grid) return;
    const orderedIds = Array.from(grid.querySelectorAll('.quick-access-card.qa-draggable'))
        .map(card => card.dataset.id)
        .filter(Boolean);
    if (!orderedIds.length) return;

    try {
        await fetch('/api/quick-access/order', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order: orderedIds })
        });
    } catch (error) {
        console.error('Failed to save quick access order:', error);
    }
}

function preventQuickAccessNavigation(e) {
    if (qaEditMode.active || qaDragState.dragMoved || qaTouchState.active) {
        e.preventDefault();
        e.stopPropagation();
    }
}

// Desktop drag-and-drop handlers
function handleQuickAccessDragStart(e) {
    if (!qaEditMode.active) {
        e.preventDefault();
        return;
    }
    qaEditMode.currentDragCard = e.currentTarget;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', e.currentTarget.dataset.id || '');

    // Use a timeout to allow the drag image to be created
    setTimeout(() => {
        if (qaEditMode.currentDragCard) {
            qaEditMode.currentDragCard.style.opacity = '0.4';
        }
    }, 0);
}

function handleQuickAccessDragEnd(e) {
    if (qaEditMode.currentDragCard) {
        qaEditMode.currentDragCard.classList.remove('dragging');
        qaEditMode.currentDragCard.style.opacity = '';
        qaEditMode.currentDragCard = null;
    }
    if (qaDragState.dragMoved) {
        qaDragState.orderChanged = true;
        saveQuickAccessOrder();
    }
    setTimeout(() => { qaDragState.dragMoved = false; }, 50);
}

function handleQuickAccessDragOver(e) {
    if (!qaEditMode.active || !qaEditMode.currentDragCard) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const grid = document.getElementById('quick-access-grid');
    const draggingCard = qaEditMode.currentDragCard;
    const targetPosition = getQuickAccessInsertPosition(grid, e.clientX, e.clientY, draggingCard);

    if (targetPosition.insertBefore) {
        if (targetPosition.insertBefore !== draggingCard &&
            targetPosition.insertBefore !== draggingCard.nextElementSibling) {
            grid.insertBefore(draggingCard, targetPosition.insertBefore);
            qaDragState.dragMoved = true;
        }
    } else if (targetPosition.append) {
        const lastChild = grid.lastElementChild;
        if (lastChild !== draggingCard) {
            grid.appendChild(draggingCard);
            qaDragState.dragMoved = true;
        }
    }
}

function handleQuickAccessDrop(e) {
    e.preventDefault();
}

// Get the correct insert position, ensuring we never place before system items
function getQuickAccessInsertPosition(container, x, y, excludeCard) {
    const grid = container;
    const systemItems = [...grid.querySelectorAll('.quick-access-card.system-item')];
    const draggableCards = [...grid.querySelectorAll('.quick-access-card.qa-draggable')]
        .filter(card => card !== excludeCard);

    // Find the last system item to ensure we never insert before it
    const lastSystemItem = systemItems.length > 0 ? systemItems[systemItems.length - 1] : null;

    // Find where to insert based on position
    let insertBefore = null;

    for (const card of draggableCards) {
        const rect = card.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        // Check if the cursor is in the row above this card
        if (y < rect.top) {
            insertBefore = card;
            break;
        }

        // Check if cursor is on the same row (within vertical bounds)
        if (y >= rect.top && y <= rect.bottom) {
            if (x < centerX) {
                insertBefore = card;
                break;
            }
        }
    }

    // If insertBefore is null, append to end
    if (!insertBefore) {
        return { append: true };
    }

    // Make sure we don't insert before system items
    if (lastSystemItem) {
        const systemRect = lastSystemItem.getBoundingClientRect();
        const insertRect = insertBefore.getBoundingClientRect();

        // If the target position is before or at the system item row, insert after system items
        if (insertRect.top <= systemRect.bottom && insertRect.left <= systemRect.right) {
            // Find the first draggable card after system items
            const firstDraggable = grid.querySelector('.quick-access-card.qa-draggable');
            if (firstDraggable && firstDraggable !== excludeCard) {
                return { insertBefore: firstDraggable };
            }
            return { append: true };
        }
    }

    return { insertBefore };
}

// Mobile touch handlers - unified approach
function handleQuickAccessTouchStart(e) {
    if (!e.touches || e.touches.length !== 1) return;

    const card = e.currentTarget;
    const touch = e.touches[0];

    qaEditMode.touchStart = { x: touch.clientX, y: touch.clientY };
    qaEditMode.longPressTriggered = false;

    // Clear any existing timer
    if (qaEditMode.longPressTimer) {
        clearTimeout(qaEditMode.longPressTimer);
    }

    if (qaEditMode.active) {
        // Already in edit mode - start drag immediately
        e.preventDefault();
        startQuickAccessTouchDrag(card, touch.clientX, touch.clientY);
    } else {
        // Not in edit mode - wait for long press
        qaEditMode.longPressTimer = setTimeout(() => {
            qaEditMode.longPressTimer = null;
            qaEditMode.longPressTriggered = true;

            // Enter edit mode
            enterQuickAccessEditMode();

            // Start dragging this card
            startQuickAccessTouchDrag(card, touch.clientX, touch.clientY);
        }, 600); // 600ms long press
    }
}

function handleQuickAccessTouchMove(e) {
    if (!e.touches || e.touches.length !== 1) return;

    const touch = e.touches[0];

    // If we're actively dragging
    if (qaTouchState.active && qaTouchState.clone) {
        e.preventDefault();

        // Move the clone
        const targetX = touch.clientX - qaTouchState.offsetX;
        const targetY = touch.clientY - qaTouchState.offsetY;
        qaTouchState.clone.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;

        // Find what card we're over and reorder
        const grid = document.getElementById('quick-access-grid');
        const targetPosition = getQuickAccessInsertPosition(grid, touch.clientX, touch.clientY, qaTouchState.card);

        if (targetPosition.insertBefore) {
            if (targetPosition.insertBefore !== qaTouchState.card &&
                targetPosition.insertBefore !== qaTouchState.card.nextElementSibling) {
                grid.insertBefore(qaTouchState.card, targetPosition.insertBefore);
                qaDragState.orderChanged = true;
            }
        } else if (targetPosition.append) {
            const lastChild = grid.lastElementChild;
            if (lastChild !== qaTouchState.card) {
                grid.appendChild(qaTouchState.card);
                qaDragState.orderChanged = true;
            }
        }
        return;
    }

    // Not dragging yet - check if we should cancel long press
    if (qaEditMode.longPressTimer && qaEditMode.touchStart) {
        const dx = Math.abs(touch.clientX - qaEditMode.touchStart.x);
        const dy = Math.abs(touch.clientY - qaEditMode.touchStart.y);

        if (dx > 10 || dy > 10) {
            clearTimeout(qaEditMode.longPressTimer);
            qaEditMode.longPressTimer = null;
        }
    }
}

function handleQuickAccessTouchEnd(e) {
    // Clear long press timer
    if (qaEditMode.longPressTimer) {
        clearTimeout(qaEditMode.longPressTimer);
        qaEditMode.longPressTimer = null;
    }

    // End drag if active
    if (qaTouchState.active) {
        e.preventDefault();
        endQuickAccessTouchDrag();
        return;
    }

    // Prevent navigation if long press was triggered
    if (qaEditMode.longPressTriggered) {
        e.preventDefault();
        qaEditMode.longPressTriggered = false;
    }
}

function startQuickAccessTouchDrag(card, touchX, touchY) {
    if (qaTouchState.active) return; // Already dragging

    const rect = card.getBoundingClientRect();

    // Create clone for dragging visual
    const clone = card.cloneNode(true);
    clone.classList.add('touch-drag-clone');
    clone.classList.remove('wiggle');
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;

    qaTouchState.active = true;
    qaTouchState.card = card;
    qaTouchState.clone = clone;
    qaTouchState.offsetX = touchX - rect.left;
    qaTouchState.offsetY = touchY - rect.top;

    // Style the original card
    card.classList.add('dragging');
    card.style.opacity = '0.3';

    // Position and add clone
    document.body.appendChild(clone);
    const startX = touchX - qaTouchState.offsetX;
    const startY = touchY - qaTouchState.offsetY;
    clone.style.transform = `translate3d(${startX}px, ${startY}px, 0)`;
}

function endQuickAccessTouchDrag() {
    // Remove clone
    if (qaTouchState.clone) {
        qaTouchState.clone.remove();
    }

    // Restore original card
    if (qaTouchState.card) {
        qaTouchState.card.classList.remove('dragging');
        qaTouchState.card.style.opacity = '';
    }

    // Save order if changed
    if (qaDragState.orderChanged) {
        saveQuickAccessOrder();
    }

    // Reset state
    qaTouchState = {
        active: false,
        card: null,
        clone: null,
        offsetX: 0,
        offsetY: 0
    };
    qaDragState.orderChanged = false;
}

// Desktop mouse long-press handlers
function handleQuickAccessMouseDown(e) {
    // Don't trigger on edit/delete buttons
    if (e.target.closest('.quick-access-edit') || e.target.closest('.quick-access-delete')) {
        return;
    }

    if (qaEditMode.active) return;

    qaEditMode.longPressTriggered = false;
    qaEditMode.longPressTimer = setTimeout(() => {
        qaEditMode.longPressTimer = null;
        qaEditMode.longPressTriggered = true;
        enterQuickAccessEditMode();
    }, 600);
}

function handleQuickAccessMouseUp() {
    if (qaEditMode.longPressTimer) {
        clearTimeout(qaEditMode.longPressTimer);
        qaEditMode.longPressTimer = null;
    }
}

// Go to today's calendar in day view
function goToToday(event) {
    event.preventDefault();
    const today = new Date();

    // Get local date components (respects user's timezone)
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;

    window.location.href = `/calendar?day=${todayStr}&mode=day`;
}

// Go to tomorrow's calendar in day view
function goToTomorrow(event) {
    event.preventDefault();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get local date components (respects user's timezone)
    const year = tomorrow.getFullYear();
    const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const day = String(tomorrow.getDate()).padStart(2, '0');
    const tomorrowStr = `${year}-${month}-${day}`;

    window.location.href = `/calendar?day=${tomorrowStr}&mode=day`;
}

function initQuickAccessPage() {
    const addBtn = document.getElementById('qa-add-btn');
    if (addBtn) addBtn.addEventListener('click', openAddQuickAccessModal);

    const todayCard = document.getElementById('qa-system-today');
    if (todayCard) todayCard.addEventListener('click', goToToday);
    const tomorrowCard = document.getElementById('qa-system-tomorrow');
    if (tomorrowCard) tomorrowCard.addEventListener('click', goToTomorrow);

    const typeSelect = document.getElementById('qa-type');
    if (typeSelect) typeSelect.addEventListener('change', handleQuickAccessTypeChange);
    const qaBack = document.getElementById('qa-back-button');
    if (qaBack) qaBack.addEventListener('click', qaNavBack);
    const qaNoteBack = document.getElementById('qa-note-back-button');
    if (qaNoteBack) qaNoteBack.addEventListener('click', qaNoteNavBack);
    const qaFolderBack = document.getElementById('qa-folder-back-button');
    if (qaFolderBack) qaFolderBack.addEventListener('click', qaFolderNavBack);
    const qaCancel = document.getElementById('qa-cancel-btn');
    if (qaCancel) qaCancel.addEventListener('click', closeAddQuickAccessModal);
    const qaSave = document.getElementById('qa-save-btn');
    if (qaSave) qaSave.addEventListener('click', saveQuickAccessItem);
    const iconInput = document.getElementById('qa-icon');
    const iconDropdown = document.getElementById('qa-icon-dropdown');
    const iconDropdownBtn = document.getElementById('qa-icon-dropdown-btn');
    renderQAIconPicker();
    if (iconDropdownBtn) {
        iconDropdownBtn.addEventListener('click', () => {
            const isExpanded = iconDropdownBtn.getAttribute('aria-expanded') === 'true';
            setQAIconDropdownOpen(!isExpanded);
        });
    }
    document.addEventListener('click', (event) => {
        if (iconDropdown && !iconDropdown.contains(event.target)) {
            setQAIconDropdownOpen(false);
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            setQAIconDropdownOpen(false);
        }
    });
    if (iconInput) {
        iconInput.addEventListener('input', () => syncQAIconSelection(iconInput.value, { updateInput: false }));
        syncQAIconSelection(iconInput.value || QA_ICON_DEFAULT, { updateInput: false });
    }

    loadQuickAccessItems();
}

// Load items on page load
document.addEventListener('DOMContentLoaded', initQuickAccessPage);
