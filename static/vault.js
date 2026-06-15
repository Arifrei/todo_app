// Vault
const vaultState = {
    folders: [],
    documents: [],
    activeFolderId: null,
    viewMode: localStorage.getItem('vaultViewMode') || 'grid',
    scope: 'active',
    search: '',
    sort: 'recent',
    stats: null
};

// Vault selection manager
let vaultSelection = null;
let vaultBulkActions = null;
let vaultUploadAbortController = null;
let vaultUploadQueue = [];
let vaultDocumentRequestId = 0;
let vaultActiveMenu = null;
let vaultActiveMenuTrigger = null;
let vaultMoveContext = null;
let vaultPreviewDocument = null;

function initVaultSelection() {
    vaultSelection = new SelectionManager({
        moduleName: 'vault',
        bulkBarId: 'vault-bulk-bar',
        countSpanId: 'vault-bulk-count',
        selectAllId: 'vault-select-all',
        itemSelector: '.vault-item',
        itemIdAttr: 'data-doc-id',
        selectedClass: 'selected',
        bodyActiveClass: 'vault-selection-mode-active',
        getTotalCount: () => vaultState.documents.length
    });

    vaultBulkActions = new BulkActions({
        apiEndpoint: '/api/vault/documents/bulk',
        selectionManager: vaultSelection,
        moduleName: 'document',
        onComplete: () => {
            loadVaultDocuments();
            loadVaultStats();
        }
    });
}

const vaultIconMap = {
    image: 'fa-solid fa-file-image',
    pdf: 'fa-solid fa-file-pdf',
    document: 'fa-solid fa-file-word',
    spreadsheet: 'fa-solid fa-file-excel',
    presentation: 'fa-solid fa-file-powerpoint',
    text: 'fa-solid fa-file-lines',
    archive: 'fa-solid fa-file-zipper',
    audio: 'fa-solid fa-file-audio',
    video: 'fa-solid fa-file-video',
    code: 'fa-solid fa-file-code',
    other: 'fa-solid fa-file'
};

let vaultFabExpanded = false;

function closeVaultFab() {
    const fab = document.getElementById('vault-fab');
    const mainBtn = document.getElementById('vault-fab-main');
    if (!fab) return;
    vaultFabExpanded = false;
    fab.classList.remove('expanded');
    if (mainBtn) mainBtn.setAttribute('aria-expanded', 'false');
}

function initVaultFab() {
    const fab = document.getElementById('vault-fab');
    const mainBtn = document.getElementById('vault-fab-main');
    const newFolderBtn = document.getElementById('vault-new-folder-btn');
    const uploadBtn = document.getElementById('vault-upload-btn');
    if (!fab || !mainBtn) return;

    mainBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        vaultFabExpanded = !vaultFabExpanded;
        fab.classList.toggle('expanded', vaultFabExpanded);
        mainBtn.setAttribute('aria-expanded', vaultFabExpanded ? 'true' : 'false');
    });

    if (newFolderBtn) {
        newFolderBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeVaultFab();
            openVaultFolderModal();
        });
    }

    if (uploadBtn) {
        uploadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeVaultFab();
            openVaultUploadModal();
        });
    }

    document.addEventListener('click', (e) => {
        if (!fab.contains(e.target)) {
            closeVaultFab();
        }
    });
}

function vaultFormatFileSize(bytes) {
    if (!bytes && bytes !== 0) return 'Unknown';
    let size = bytes;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    for (const unit of units) {
        if (size < 1024) {
            return unit === 'B' ? `${Math.round(size)} ${unit}` : `${size.toFixed(1)} ${unit}`;
        }
        size /= 1024;
    }
    return `${size.toFixed(1)} PB`;
}

function vaultGetFolderById(folderId) {
    return vaultState.folders.find(folder => folder.id === folderId);
}

function vaultBuildFolderPath(folderId) {
    const path = [];
    const visited = new Set();
    let current = vaultGetFolderById(folderId);
    while (current && !visited.has(current.id)) {
        visited.add(current.id);
        path.unshift(current);
        current = vaultGetFolderById(current.parent_id);
    }
    return path;
}

function renderVaultBreadcrumb() {
    const breadcrumb = document.getElementById('vault-breadcrumb');
    if (!breadcrumb) return;
    breadcrumb.innerHTML = '';

    const root = document.createElement('button');
    root.className = 'vault-nav-item' + (!vaultState.activeFolderId ? ' active' : '');
    root.innerHTML = vaultIsArchivedScope()
        ? '<i class="fa-solid fa-trash-can"></i><span>Trash</span>'
        : '<i class="fa-solid fa-house"></i>';
    root.setAttribute('aria-label', vaultIsArchivedScope() ? 'Trash root' : 'Vault root');
    root.addEventListener('click', () => vaultSetActiveFolder(null));
    breadcrumb.appendChild(root);

    const path = vaultBuildFolderPath(vaultState.activeFolderId);
    path.forEach((folder, idx) => {
        const sep = document.createElement('span');
        sep.className = 'vault-nav-sep';
        sep.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
        breadcrumb.appendChild(sep);

        const crumb = document.createElement('button');
        crumb.className = 'vault-nav-item' + (idx === path.length - 1 ? ' active' : '');
        crumb.textContent = folder.name;
        crumb.addEventListener('click', () => vaultSetActiveFolder(folder.id));
        breadcrumb.appendChild(crumb);
    });
}

function vaultGetActiveFolders() {
    const parentId = vaultState.activeFolderId || null;
    return vaultState.folders.filter(folder => (folder.parent_id || null) === parentId);
}

function vaultSortDocuments(items) {
    const sorted = [...items];
    if (vaultState.sort === 'title') {
        sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (vaultState.sort === 'size') {
        sorted.sort((a, b) => (b.file_size || 0) - (a.file_size || 0));
    } else if (vaultState.sort === 'type') {
        sorted.sort((a, b) => (a.file_extension || '').localeCompare(b.file_extension || ''));
    }
    return sorted;
}

function vaultIsArchivedScope() {
    return vaultState.scope === 'archived';
}

function vaultFolderPathLabel(folderId) {
    const path = vaultBuildFolderPath(folderId);
    return path.length ? path.map(folder => folder.name).join(' / ') : 'Root';
}

function closeVaultItemMenu(options = {}) {
    const returnFocus = options.returnFocus === true;
    if (vaultActiveMenu) {
        vaultActiveMenu.remove();
        vaultActiveMenu = null;
    }
    if (vaultActiveMenuTrigger) {
        vaultActiveMenuTrigger.setAttribute('aria-expanded', 'false');
        vaultActiveMenuTrigger.removeAttribute('aria-controls');
        if (returnFocus) vaultActiveMenuTrigger.focus();
        vaultActiveMenuTrigger = null;
    }
}

function positionVaultItemMenu(menu, trigger) {
    const rect = trigger.getBoundingClientRect();
    const padding = 8;
    const menuWidth = Math.max(menu.offsetWidth || 210, 210);
    const menuHeight = menu.offsetHeight || 280;
    let top = rect.bottom + padding;
    let left = rect.right - menuWidth;

    if (window.innerHeight - rect.bottom < menuHeight + padding && rect.top > menuHeight + padding) {
        top = rect.top - menuHeight - padding;
    }
    left = Math.max(padding, Math.min(left, window.innerWidth - menuWidth - padding));
    menu.style.top = `${Math.max(padding, top)}px`;
    menu.style.left = `${left}px`;
}

function vaultMenuOption(action, icon, label, danger = false) {
    return `
        <button class="vault-item-menu-option${danger ? ' danger' : ''}" type="button" data-action="${action}" role="menuitem">
            <i class="fa-solid ${icon}"></i>
            <span>${label}</span>
        </button>
    `;
}

function openVaultItemMenu(type, data, trigger) {
    const menuKey = `${type}-${data.id}`;
    if (vaultActiveMenu && vaultActiveMenu.dataset.menuKey === menuKey) {
        closeVaultItemMenu({ returnFocus: true });
        return;
    }

    closeVaultItemMenu();
    const archived = vaultIsArchivedScope();
    const options = [];
    if (type === 'folder') {
        options.push(vaultMenuOption('open', 'fa-folder-open', 'Open'));
        if (archived) {
            options.push(vaultMenuOption('restore', 'fa-rotate-left', 'Restore'));
        } else {
            options.push(vaultMenuOption('rename', 'fa-pen', 'Rename'));
            options.push(vaultMenuOption('move', 'fa-folder-tree', 'Move to folder'));
            options.push(vaultMenuOption('archive', 'fa-box-archive', 'Archive'));
        }
        options.push(vaultMenuOption('delete', 'fa-trash', 'Delete permanently', true));
    } else {
        options.push(vaultMenuOption('open', 'fa-eye', 'Preview'));
        if (archived) {
            options.push(vaultMenuOption('restore', 'fa-rotate-left', 'Restore'));
        } else {
            options.push(vaultMenuOption('edit', 'fa-pen', 'Edit title and tags'));
            options.push(vaultMenuOption('move', 'fa-folder-open', 'Move to folder'));
            options.push(vaultMenuOption('pin', 'fa-thumbtack', data.pinned ? 'Unpin' : 'Pin'));
            options.push(vaultMenuOption('archive', 'fa-box-archive', 'Archive'));
        }
        options.push(vaultMenuOption('download', 'fa-download', 'Download'));
        options.push(vaultMenuOption('delete', 'fa-trash', 'Delete permanently', true));
    }

    const menu = document.createElement('div');
    menu.className = 'vault-item-menu active';
    menu.id = `vault-item-menu-${menuKey}`;
    menu.dataset.menuKey = menuKey;
    menu.setAttribute('role', 'menu');
    menu.innerHTML = options.join('');
    menu.querySelectorAll('.vault-item-menu-option').forEach(option => {
        option.addEventListener('click', (event) => {
            event.stopPropagation();
            const action = option.dataset.action;
            closeVaultItemMenu();
            if (type === 'folder') {
                if (action === 'open') vaultSetActiveFolder(data.id);
                else if (action === 'rename') openVaultFolderModal(data);
                else if (action === 'move') openVaultMoveModal('folder', data);
                else if (action === 'archive') vaultArchiveFolder(data);
                else if (action === 'restore') vaultRestoreFolder(data);
                else if (action === 'delete') vaultDeleteFolder(data);
            } else {
                if (action === 'open') vaultOpenDoc(data);
                else if (action === 'edit') openVaultDocumentModal(data);
                else if (action === 'move') openVaultMoveModal('document', data);
                else if (action === 'pin') vaultTogglePin(data);
                else if (action === 'archive') vaultArchiveDoc(data);
                else if (action === 'restore') vaultRestoreDoc(data);
                else if (action === 'download') vaultDownloadDoc(data);
                else if (action === 'delete') vaultDeleteDoc(data);
            }
        });
    });

    document.body.appendChild(menu);
    positionVaultItemMenu(menu, trigger);
    vaultActiveMenu = menu;
    vaultActiveMenuTrigger = trigger;
    trigger.setAttribute('aria-controls', menu.id);
    trigger.setAttribute('aria-expanded', 'true');
    const firstOption = menu.querySelector('button');
    if (firstOption) firstOption.focus();
}

function renderVaultItems() {
    const grid = document.getElementById('vault-grid');
    const empty = document.getElementById('vault-empty');
    const content = document.getElementById('vault-content');
    if (!grid || !empty) return;

    const folders = vaultState.search ? [] : vaultGetActiveFolders();
    const docs = vaultSortDocuments(vaultState.documents);

    if (!folders.length && !docs.length) {
        grid.innerHTML = '';
        if (content) content.style.display = 'none';
        empty.style.display = 'flex';
        const title = empty.querySelector('h3');
        const message = empty.querySelector('p');
        const actions = empty.querySelector('.vault-empty-actions');
        if (vaultState.search) {
            if (title) title.textContent = 'No matching files';
            if (message) message.textContent = `Nothing matches "${vaultState.search}".`;
            if (actions) actions.style.display = 'none';
        } else if (vaultIsArchivedScope()) {
            if (title) title.textContent = 'Trash is empty';
            if (message) message.textContent = 'Archived files and folders will appear here.';
            if (actions) actions.style.display = 'none';
        } else {
            if (title) title.textContent = 'No files here yet';
            if (message) message.textContent = 'Upload documents or create folders to get started.';
            if (actions) actions.style.display = 'flex';
        }
        return;
    }

    empty.style.display = 'none';
    if (content) content.style.display = 'block';
    grid.className = 'vault-grid' + (vaultState.viewMode === 'list' ? ' list-view' : '');
    grid.innerHTML = '';

    // Render folders
    if (folders.length && !vaultState.search) {
        folders.forEach(folder => {
            const item = document.createElement('div');
            item.className = 'vault-item vault-folder-item';
            item.setAttribute('data-folder-id', folder.id);
            item.setAttribute('tabindex', '0');
            item.setAttribute('role', 'group');
            item.setAttribute('aria-label', `Folder ${folder.name}`);
            item.innerHTML = `
                <div class="vault-item-visual">
                    <div class="vault-item-icon folder"><i class="fa-solid fa-folder"></i></div>
                </div>
                <div class="vault-item-info">
                    <div class="vault-item-name">${escapeHtml(folder.name)}</div>
                    <div class="vault-item-meta">Folder</div>
                </div>
                <button class="vault-item-menu-trigger" type="button" title="Folder actions" aria-label="Actions for ${escapeHtml(folder.name)}" aria-haspopup="menu" aria-expanded="false">
                    <i class="fa-solid fa-ellipsis-vertical"></i>
                </button>
            `;
            const menuTrigger = item.querySelector('.vault-item-menu-trigger');
            menuTrigger.addEventListener('click', (event) => {
                event.stopPropagation();
                openVaultItemMenu('folder', folder, menuTrigger);
            });
            item.addEventListener('click', (event) => {
                if (!event.target.closest('button')) vaultSetActiveFolder(folder.id);
            });
            item.addEventListener('keydown', (event) => {
                if (event.target !== item || !['Enter', ' '].includes(event.key)) return;
                event.preventDefault();
                vaultSetActiveFolder(folder.id);
            });
            grid.appendChild(item);
        });
    }

    // Render documents
    docs.forEach(doc => {
        const iconClass = vaultIconMap[doc.file_category] || vaultIconMap.other;
        const category = doc.file_category || 'other';
        const isSelected = vaultSelection && vaultSelection.isSelected(doc.id);
        const item = document.createElement('div');
        item.className = 'vault-item' + (doc.pinned ? ' pinned' : '') + (isSelected ? ' selected' : '');
        item.setAttribute('data-doc-id', doc.id);
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'group');
        item.setAttribute('aria-label', `File ${doc.title}`);
        const isImage = category === 'image';
        const visual = isImage
            ? `<img class="vault-item-thumbnail" src="/api/vault/documents/${doc.id}/preview" alt="" loading="lazy">`
            : `<div class="vault-item-icon ${category}"><i class="${iconClass}"></i></div>`;
        const location = vaultState.search ? vaultFolderPathLabel(doc.folder_id) : '';
        const extension = (doc.file_extension || '').toUpperCase();
        const size = doc.file_size_formatted || vaultFormatFileSize(doc.file_size);
        const meta = [location, extension, size].filter(Boolean).join(' | ');
        item.innerHTML = `
            <input type="checkbox" class="item-select-checkbox vault-item-checkbox" aria-label="Select ${escapeHtml(doc.title)}" ${isSelected ? 'checked' : ''}>
            <div class="vault-item-visual ${isImage ? 'has-thumbnail' : ''}">${visual}</div>
            <div class="vault-item-info">
                <div class="vault-item-name">${escapeHtml(doc.title)}</div>
                <div class="vault-item-meta">${escapeHtml(meta)}</div>
            </div>
            <button class="vault-item-menu-trigger" type="button" title="File actions" aria-label="Actions for ${escapeHtml(doc.title)}" aria-haspopup="menu" aria-expanded="false">
                <i class="fa-solid fa-ellipsis-vertical"></i>
            </button>
        `;
        const checkbox = item.querySelector('.vault-item-checkbox');
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            if (vaultSelection) {
                if (e.target.checked) {
                    vaultSelection.select(doc.id);
                } else {
                    vaultSelection.deselect(doc.id);
                }
            }
        });
        const thumbnail = item.querySelector('.vault-item-thumbnail');
        if (thumbnail) {
            thumbnail.addEventListener('error', () => {
                const visualWrap = thumbnail.parentElement;
                visualWrap.classList.remove('has-thumbnail');
                visualWrap.innerHTML = `<div class="vault-item-icon image"><i class="${iconClass}"></i></div>`;
            }, { once: true });
        }
        const menuTrigger = item.querySelector('.vault-item-menu-trigger');
        menuTrigger.addEventListener('click', (event) => {
            event.stopPropagation();
            openVaultItemMenu('document', doc, menuTrigger);
        });
        item.addEventListener('click', (e) => {
            if (e.target.closest('button, input')) return;
            if (vaultSelection && vaultSelection.getCount() > 0) {
                vaultSelection.toggle(doc.id);
                checkbox.checked = vaultSelection.isSelected(doc.id);
                item.classList.toggle('selected', checkbox.checked);
            } else {
                vaultOpenDoc(doc);
            }
        });
        item.addEventListener('keydown', (event) => {
            if (event.target !== item || !['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            if (vaultSelection && vaultSelection.getCount() > 0) {
                vaultSelection.toggle(doc.id);
                checkbox.checked = vaultSelection.isSelected(doc.id);
            } else {
                vaultOpenDoc(doc);
            }
        });
        grid.appendChild(item);
    });

    // Update select-all checkbox state
    if (vaultSelection) {
        vaultSelection.updateUI();
    }
}

async function loadVaultFolders() {
    try {
        const archived = vaultIsArchivedScope() ? '?archived=true' : '';
        const res = await fetch(`/api/vault/folders${archived}`);
        if (!res.ok) throw new Error('Folder load failed');
        vaultState.folders = await res.json();
        renderVaultBreadcrumb();
        populateVaultFolderSelect();
        renderVaultItems();
    } catch (err) {
        console.error(err);
    }
}

async function loadVaultDocuments() {
    const requestId = ++vaultDocumentRequestId;
    const archivedParam = vaultIsArchivedScope() ? '&archived=true' : '';
    const query = vaultState.search
        ? `/api/vault/search?q=${encodeURIComponent(vaultState.search)}${archivedParam}`
        : `/api/vault/documents?folder_id=${vaultState.activeFolderId || ''}${archivedParam}`;
    try {
        const res = await fetch(query);
        if (!res.ok) throw new Error('Document load failed');
        const documents = await res.json();
        if (requestId !== vaultDocumentRequestId) return;
        if (vaultSelection) vaultSelection.deselectAll();
        vaultState.documents = documents;
        renderVaultItems();
    } catch (err) {
        console.error(err);
        showToast('Could not load documents', 'error');
    }
}

async function loadVaultStats() {
    try {
        const res = await fetch('/api/vault/stats');
        if (!res.ok) throw new Error('Stats load failed');
        vaultState.stats = await res.json();
    } catch (err) {
        console.error(err);
    }
}

function vaultSetActiveFolder(folderId) {
    closeVaultItemMenu();
    vaultState.activeFolderId = folderId;
    renderVaultBreadcrumb();
    loadVaultDocuments();
}

function populateVaultFolderSelect() {
    const select = document.getElementById('vault-folder-select');
    if (!select) return;
    select.innerHTML = '<option value="">Root</option>';
    const visited = new Set();
    const buildOptions = (parentId, prefix) => {
        vaultState.folders
            .filter(folder => (folder.parent_id || null) === parentId && !visited.has(folder.id))
            .forEach(folder => {
                visited.add(folder.id);
                const option = document.createElement('option');
                option.value = folder.id;
                option.textContent = `${prefix}${folder.name}`;
                select.appendChild(option);
                buildOptions(folder.id, `${prefix}- `);
            });
    };
    buildOptions(null, '');
}

async function vaultSetScope(scope) {
    if (!['active', 'archived'].includes(scope) || scope === vaultState.scope) return;
    closeVaultItemMenu();
    if (vaultSelection) vaultSelection.deselectAll();
    vaultState.scope = scope;
    vaultState.activeFolderId = null;
    const activeOnly = document.querySelectorAll('.vault-bulk-active-only');
    activeOnly.forEach(element => {
        element.style.display = vaultIsArchivedScope() ? 'none' : '';
    });
    const fab = document.getElementById('vault-fab');
    if (fab) fab.style.display = vaultIsArchivedScope() ? 'none' : '';
    const archiveLabel = document.getElementById('vault-bulk-archive-label');
    if (archiveLabel) archiveLabel.textContent = vaultIsArchivedScope() ? 'Restore' : 'Archive';
    await Promise.all([loadVaultFolders(), loadVaultDocuments()]);
}

function vaultApplyViewMode() {
    localStorage.setItem('vaultViewMode', vaultState.viewMode);
    const toggle = document.getElementById('vault-view-toggle');
    if (toggle) {
        const icon = toggle.querySelector('i');
        icon.className = vaultState.viewMode === 'grid' ? 'fa-solid fa-grip' : 'fa-solid fa-list';
    }
    renderVaultItems();
}

function vaultUpdateSearchBox() {
    const box = document.getElementById('vault-search-box');
    const input = document.getElementById('vault-search-input');
    if (box && input) {
        box.classList.toggle('has-value', input.value.trim().length > 0);
    }
}

function vaultToggleView() {
    vaultState.viewMode = vaultState.viewMode === 'grid' ? 'list' : 'grid';
    vaultApplyViewMode();
}

function openVaultFolderModal(folder = null) {
    closeVaultItemMenu();
    const modal = document.getElementById('vault-folder-modal');
    const title = document.getElementById('vault-folder-modal-title');
    const nameInput = document.getElementById('vault-folder-name');
    const idInput = document.getElementById('vault-folder-id');
    if (!modal || !title || !nameInput || !idInput) return;
    title.textContent = folder ? 'Rename Folder' : 'New Folder';
    nameInput.value = folder ? folder.name : '';
    idInput.value = folder ? folder.id : '';
    modal.classList.add('active');
    setTimeout(() => nameInput.focus(), 0);
}

function closeVaultFolderModal() {
    const modal = document.getElementById('vault-folder-modal');
    if (modal) modal.classList.remove('active');
}

async function saveVaultFolder() {
    const nameInput = document.getElementById('vault-folder-name');
    const idInput = document.getElementById('vault-folder-id');
    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) {
        showToast('Folder name is required', 'warning');
        return;
    }
    try {
        let res;
        if (idInput && idInput.value) {
            res = await fetch(`/api/vault/folders/${idInput.value}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
        } else {
            res = await fetch('/api/vault/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, parent_id: vaultState.activeFolderId })
            });
        }
        if (!res.ok) throw new Error('Folder save failed');
        await loadVaultFolders();
        closeVaultFolderModal();
        showToast('Folder saved', 'success');
    } catch (err) {
        console.error(err);
        showToast('Could not save folder', 'error');
    }
}

function openVaultUploadModal() {
    if (vaultIsArchivedScope()) return;
    const modal = document.getElementById('vault-upload-modal');
    if (modal) modal.classList.add('active');
    const tagsInput = document.getElementById('vault-tags-input');
    if (tagsInput) tagsInput.value = '';
    vaultUploadQueue = [];
    renderVaultUploadFiles();
    const folderSelect = document.getElementById('vault-folder-select');
    if (folderSelect) folderSelect.value = vaultState.activeFolderId || '';
}

function closeVaultUploadModal(options = {}) {
    const abortUpload = options.abortUpload !== false;
    if (abortUpload && vaultUploadAbortController) {
        vaultUploadAbortController.abort();
        vaultUploadAbortController = null;
    }
    const modal = document.getElementById('vault-upload-modal');
    if (modal) modal.classList.remove('active');
    const progressWrap = document.getElementById('vault-upload-progress');
    const progressBar = document.getElementById('vault-upload-bar');
    if (progressWrap) progressWrap.style.display = 'none';
    if (progressBar) progressBar.style.width = '0%';
    vaultUploadQueue = [];
    const fileInput = document.getElementById('vault-file-input');
    if (fileInput) fileInput.value = '';
    renderVaultUploadFiles();
}

function openVaultDocumentModal(doc) {
    closeVaultItemMenu();
    const modal = document.getElementById('vault-document-modal');
    const idInput = document.getElementById('vault-document-id');
    const titleInput = document.getElementById('vault-document-title');
    const tagsInput = document.getElementById('vault-document-tags');
    if (!modal || !idInput || !titleInput || !tagsInput) return;
    idInput.value = doc.id;
    titleInput.value = doc.title || '';
    tagsInput.value = Array.isArray(doc.tags) ? doc.tags.join(', ') : (doc.tags || '');
    modal.classList.add('active');
    setTimeout(() => {
        titleInput.focus();
        titleInput.select();
    }, 0);
}

function closeVaultDocumentModal() {
    const modal = document.getElementById('vault-document-modal');
    if (modal) modal.classList.remove('active');
}

async function saveVaultDocument() {
    const idInput = document.getElementById('vault-document-id');
    const titleInput = document.getElementById('vault-document-title');
    const tagsInput = document.getElementById('vault-document-tags');
    if (!idInput || !titleInput || !tagsInput) return;
    const title = titleInput.value.trim();
    if (!title) {
        showToast('Title is required', 'warning');
        titleInput.focus();
        return;
    }
    try {
        const res = await fetch(`/api/vault/documents/${idInput.value}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, tags: tagsInput.value.trim() })
        });
        if (!res.ok) throw new Error('Document update failed');
        closeVaultDocumentModal();
        await loadVaultDocuments();
        showToast('File updated', 'success');
    } catch (err) {
        console.error(err);
        showToast('Could not update file', 'error');
    }
}

function vaultFolderDescendantIds(folderId) {
    const descendants = new Set([folderId]);
    let changed = true;
    while (changed) {
        changed = false;
        vaultState.folders.forEach(folder => {
            if (descendants.has(folder.parent_id) && !descendants.has(folder.id)) {
                descendants.add(folder.id);
                changed = true;
            }
        });
    }
    return descendants;
}

function populateVaultMoveSelect(context) {
    const select = document.getElementById('vault-move-select');
    if (!select) return;
    select.innerHTML = '<option value="">Root</option>';
    const excluded = context.type === 'folder'
        ? vaultFolderDescendantIds(context.item.id)
        : new Set();
    const visited = new Set();
    const buildOptions = (parentId, prefix) => {
        vaultState.folders
            .filter(folder => (
                (folder.parent_id || null) === parentId
                && !excluded.has(folder.id)
                && !visited.has(folder.id)
            ))
            .forEach(folder => {
                visited.add(folder.id);
                const option = document.createElement('option');
                option.value = folder.id;
                option.textContent = `${prefix}${folder.name}`;
                select.appendChild(option);
                buildOptions(folder.id, `${prefix}- `);
            });
    };
    buildOptions(null, '');
}

function openVaultMoveModal(type, item = null) {
    if (vaultIsArchivedScope()) return;
    closeVaultItemMenu();
    const modal = document.getElementById('vault-move-modal');
    const title = document.getElementById('vault-move-modal-title');
    const select = document.getElementById('vault-move-select');
    if (!modal || !title || !select) return;
    vaultMoveContext = { type, item };
    const count = type === 'bulk' && vaultSelection ? vaultSelection.getCount() : 1;
    title.textContent = type === 'bulk' ? `Move ${count} files` : `Move ${type}`;
    populateVaultMoveSelect(vaultMoveContext);
    if (type === 'folder') select.value = item.parent_id || '';
    else if (type === 'document') select.value = item.folder_id || '';
    else select.value = vaultState.activeFolderId || '';
    modal.classList.add('active');
    setTimeout(() => select.focus(), 0);
}

function closeVaultMoveModal() {
    const modal = document.getElementById('vault-move-modal');
    if (modal) modal.classList.remove('active');
    vaultMoveContext = null;
}

async function saveVaultMove() {
    const select = document.getElementById('vault-move-select');
    if (!select || !vaultMoveContext) return;
    const destinationId = select.value || null;
    const context = vaultMoveContext;
    try {
        if (context.type === 'bulk') {
            await vaultBulkActions.move(destinationId, 'folder');
        } else {
            const endpoint = context.type === 'folder'
                ? `/api/vault/folders/${context.item.id}`
                : `/api/vault/documents/${context.item.id}`;
            const payload = context.type === 'folder'
                ? { parent_id: destinationId }
                : { folder_id: destinationId };
            const res = await fetch(endpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const error = await res.json().catch(() => ({}));
                throw new Error(error.error || 'Move failed');
            }
            await Promise.all([loadVaultFolders(), loadVaultDocuments()]);
            showToast(`${context.type === 'folder' ? 'Folder' : 'File'} moved`, 'success');
        }
        closeVaultMoveModal();
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Could not move item', 'error');
    }
}

function vaultDownloadDoc(doc) {
    window.location.href = `/api/vault/documents/${doc.id}/download`;
}

async function vaultTogglePin(doc) {
    try {
        const res = await fetch(`/api/vault/documents/${doc.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pinned: !doc.pinned })
        });
        if (!res.ok) throw new Error('Pin failed');
        const updated = await res.json();
        const idx = vaultState.documents.findIndex(item => item.id === updated.id);
        if (idx !== -1) vaultState.documents[idx] = updated;
        renderVaultItems();
    } catch (err) {
        console.error(err);
        showToast('Could not update pin', 'error');
    }
}

function closeVaultPreviewModal() {
    const modal = document.getElementById('vault-preview-modal');
    const body = document.getElementById('vault-preview-body');
    if (modal) modal.classList.remove('active');
    if (body) body.innerHTML = '';
    vaultPreviewDocument = null;
}

function vaultOpenDoc(doc) {
    const previewTypes = ['image', 'pdf', 'text', 'audio', 'video', 'code'];
    if (!previewTypes.includes(doc.file_category)) {
        vaultDownloadDoc(doc);
        return;
    }
    const modal = document.getElementById('vault-preview-modal');
    const title = document.getElementById('vault-preview-title');
    const body = document.getElementById('vault-preview-body');
    const archiveBtn = document.getElementById('vault-preview-archive');
    const editBtn = document.getElementById('vault-preview-edit');
    if (!modal || !title || !body) return;
    const path = `/api/vault/documents/${doc.id}/preview`;
    vaultPreviewDocument = doc;
    title.textContent = doc.title;
    if (doc.file_category === 'image') {
        body.innerHTML = `<img src="${path}" alt="${escapeHtml(doc.title)}">`;
    } else if (doc.file_category === 'video') {
        body.innerHTML = `<video src="${path}" controls playsinline></video>`;
    } else if (doc.file_category === 'audio') {
        body.innerHTML = `<audio src="${path}" controls></audio>`;
    } else {
        body.innerHTML = `<iframe src="${path}" title="Preview of ${escapeHtml(doc.title)}" sandbox></iframe>`;
    }
    if (archiveBtn) {
        archiveBtn.innerHTML = vaultIsArchivedScope()
            ? '<i class="fa-solid fa-rotate-left"></i> Restore'
            : '<i class="fa-solid fa-box-archive"></i> Archive';
    }
    if (editBtn) editBtn.style.display = vaultIsArchivedScope() ? 'none' : '';
    modal.classList.add('active');
}

function vaultArchiveDoc(doc) {
    openConfirmModal(`Archive "${doc.title}"?`, async () => {
        try {
            const res = await fetch(`/api/vault/documents/${doc.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Archive failed');
            closeVaultPreviewModal();
            await loadVaultDocuments();
            showToast('Archived', 'success');
        } catch (err) {
            console.error(err);
            showToast('Could not archive document', 'error');
        }
    });
}

async function vaultRestoreDoc(doc) {
    try {
        const res = await fetch(`/api/vault/documents/${doc.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ archived: false })
        });
        if (!res.ok) throw new Error('Restore failed');
        closeVaultPreviewModal();
        await loadVaultDocuments();
        showToast('File restored', 'success');
    } catch (err) {
        console.error(err);
        showToast('Could not restore file', 'error');
    }
}

function vaultDeleteDoc(doc) {
    openConfirmModal(`Permanently delete "${doc.title}"? This cannot be undone.`, async () => {
        try {
            const res = await fetch(`/api/vault/documents/${doc.id}?permanent=true`, {
                method: 'DELETE'
            });
            if (!res.ok) throw new Error('Delete failed');
            closeVaultPreviewModal();
            await Promise.all([loadVaultDocuments(), loadVaultStats()]);
            showToast('File permanently deleted', 'success');
        } catch (err) {
            console.error(err);
            showToast('Could not delete file', 'error');
        }
    });
}

function vaultArchiveFolder(folder) {
    openConfirmModal(`Archive folder "${folder.name}"?`, async () => {
        try {
            const res = await fetch(`/api/vault/folders/${folder.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Archive failed');
            await loadVaultFolders();
            if (vaultState.activeFolderId === folder.id) {
                vaultSetActiveFolder(null);
            } else {
                loadVaultDocuments();
            }
            showToast('Folder archived', 'success');
        } catch (err) {
            console.error(err);
            showToast('Could not archive folder', 'error');
        }
    });
}

async function vaultRestoreFolder(folder) {
    try {
        const res = await fetch(`/api/vault/folders/${folder.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ archived: false })
        });
        if (!res.ok) throw new Error('Restore failed');
        await Promise.all([loadVaultFolders(), loadVaultDocuments()]);
        showToast('Folder restored', 'success');
    } catch (err) {
        console.error(err);
        showToast('Could not restore folder', 'error');
    }
}

function vaultDeleteFolder(folder) {
    openConfirmModal(
        `Permanently delete "${folder.name}" and everything inside it? This cannot be undone.`,
        async () => {
            try {
                const res = await fetch(`/api/vault/folders/${folder.id}?permanent=true`, {
                    method: 'DELETE'
                });
                if (!res.ok) throw new Error('Delete failed');
                if (vaultState.activeFolderId === folder.id) vaultState.activeFolderId = null;
                await Promise.all([loadVaultFolders(), loadVaultDocuments(), loadVaultStats()]);
                showToast('Folder permanently deleted', 'success');
            } catch (err) {
                console.error(err);
                showToast('Could not delete folder', 'error');
            }
        }
    );
}

function openVaultBulkMoveModal() {
    openVaultMoveModal('bulk');
}

async function vaultHandleUpload() {
    const files = vaultUploadQueue.slice();
    if (!files.length) {
        showToast('Select at least one file', 'warning');
        return;
    }
    if (vaultUploadAbortController) {
        showToast('Upload already in progress', 'info');
        return;
    }
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    const tagsInput = document.getElementById('vault-tags-input');
    const folderSelect = document.getElementById('vault-folder-select');
    if (tagsInput && tagsInput.value.trim()) formData.append('tags', tagsInput.value.trim());
    if (folderSelect) formData.append('folder_id', folderSelect.value || '');

    const progressWrap = document.getElementById('vault-upload-progress');
    const progressBar = document.getElementById('vault-upload-bar');
    if (progressWrap && progressBar) {
        progressWrap.style.display = 'block';
        progressBar.style.width = '35%';
    }
    vaultUploadAbortController = new AbortController();
    try {
        const res = await fetch('/api/vault/documents', {
            method: 'POST',
            body: formData,
            signal: vaultUploadAbortController.signal
        });

        if (progressBar) progressBar.style.width = '100%';

        if (!res.ok) {
            let message = 'Upload failed';
            try {
                const data = await res.clone().json();
                if (data && data.error) message = data.error;
            } catch (jsonErr) {
                try {
                    const text = await res.text();
                    if (text) message = text;
                } catch (textErr) {
                    console.error('Upload error parsing failed:', textErr);
                }
            }
            throw new Error(message);
        }

        showToast('Upload complete', 'success');
        closeVaultUploadModal({ abortUpload: false });
        await loadVaultDocuments();
        await loadVaultStats();
    } catch (err) {
        if (err && err.name === 'AbortError') {
            showToast('Upload canceled', 'info');
        } else {
            console.error(err);
            showToast(err && err.message ? err.message : 'Upload failed', 'error');
        }
    } finally {
        vaultUploadAbortController = null;
        if (progressWrap) progressWrap.style.display = 'none';
    }
}

function bindVaultDropZone() {
    const dropZone = document.getElementById('vault-drop-zone');
    const fileInput = document.getElementById('vault-file-input');
    if (!dropZone || !fileInput) return;
    ['dragenter', 'dragover'].forEach(evt => {
        dropZone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
    });
    ['dragleave', 'drop'].forEach(evt => {
        dropZone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
        });
    });
    dropZone.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files.length) {
            vaultUploadQueue = vaultUploadQueue.concat(Array.from(e.dataTransfer.files));
            renderVaultUploadFiles();
        }
    });
}

function initVaultPage() {
    if (!document.querySelector('.vault-page')) return;

    // Initialize selection manager
    initVaultSelection();

    const viewToggle = document.getElementById('vault-view-toggle');
    const folderSave = document.getElementById('vault-folder-save');
    const folderCancel = document.getElementById('vault-folder-cancel');
    const uploadCancel = document.getElementById('vault-upload-cancel');
    const uploadSubmit = document.getElementById('vault-upload-submit');
    const browseBtn = document.getElementById('vault-browse-btn');
    const fileInput = document.getElementById('vault-file-input');
    const searchInput = document.getElementById('vault-search-input');
    const searchClear = document.getElementById('vault-search-clear');
    const sortSelect = document.getElementById('vault-sort-select');
    const scopeSelect = document.getElementById('vault-scope-select');
    const emptyUpload = document.getElementById('vault-empty-upload');
    const emptyFolder = document.getElementById('vault-empty-folder');
    const documentSave = document.getElementById('vault-document-save');
    const documentCancel = document.getElementById('vault-document-cancel');
    const moveSave = document.getElementById('vault-move-save');
    const moveCancel = document.getElementById('vault-move-cancel');
    const previewClose = document.getElementById('vault-preview-close');
    const previewEdit = document.getElementById('vault-preview-edit');
    const previewArchive = document.getElementById('vault-preview-archive');
    const previewDownload = document.getElementById('vault-preview-download');

    // Bulk action buttons
    const selectAll = document.getElementById('vault-select-all');
    const bulkClear = document.getElementById('vault-bulk-clear');
    const bulkPin = document.getElementById('vault-bulk-pin');
    const bulkMove = document.getElementById('vault-bulk-move');
    const bulkArchive = document.getElementById('vault-bulk-archive');
    const bulkDelete = document.getElementById('vault-bulk-delete');

    if (selectAll) {
        selectAll.addEventListener('change', (e) => {
            if (vaultSelection) {
                if (e.target.checked) {
                    const allIds = vaultState.documents.map(doc => doc.id);
                    vaultSelection.selectAll(allIds);
                } else {
                    vaultSelection.deselectAll();
                }
                renderVaultItems();
            }
        });
    }

    if (bulkClear) {
        bulkClear.addEventListener('click', () => {
            if (vaultSelection) {
                vaultSelection.deselectAll();
                renderVaultItems();
            }
        });
    }

    if (bulkPin) {
        bulkPin.addEventListener('click', async () => {
            if (vaultBulkActions) {
                // Check if any selected docs are unpinned - if so, pin all. Otherwise unpin all.
                const selectedIds = vaultSelection.getIds();
                const anyUnpinned = vaultState.documents.some(doc => selectedIds.includes(doc.id) && !doc.pinned);
                await vaultBulkActions.execute(anyUnpinned ? 'pin' : 'unpin');
            }
        });
    }

    if (bulkMove) {
        bulkMove.addEventListener('click', () => {
            if (vaultSelection && vaultSelection.getCount() > 0) {
                openVaultBulkMoveModal();
            }
        });
    }

    if (bulkDelete) {
        bulkDelete.addEventListener('click', () => {
            if (vaultBulkActions) {
                vaultBulkActions.delete('Permanently delete selected files? This cannot be undone.');
            }
        });
    }

    if (bulkArchive) {
        bulkArchive.addEventListener('click', async () => {
            if (!vaultBulkActions) return;
            await vaultBulkActions.execute(vaultIsArchivedScope() ? 'unarchive' : 'archive');
        });
    }

    if (viewToggle) viewToggle.addEventListener('click', vaultToggleView);
    if (folderSave) folderSave.addEventListener('click', saveVaultFolder);
    if (folderCancel) folderCancel.addEventListener('click', closeVaultFolderModal);
    if (documentSave) documentSave.addEventListener('click', saveVaultDocument);
    if (documentCancel) documentCancel.addEventListener('click', closeVaultDocumentModal);
    if (moveSave) moveSave.addEventListener('click', saveVaultMove);
    if (moveCancel) moveCancel.addEventListener('click', closeVaultMoveModal);
    if (uploadCancel) uploadCancel.addEventListener('click', closeVaultUploadModal);
    if (uploadSubmit) uploadSubmit.addEventListener('click', vaultHandleUpload);
    if (browseBtn && fileInput) browseBtn.addEventListener('click', () => fileInput.click());
    if (emptyUpload) emptyUpload.addEventListener('click', openVaultUploadModal);
    if (emptyFolder) emptyFolder.addEventListener('click', () => openVaultFolderModal());
    if (previewClose) previewClose.addEventListener('click', closeVaultPreviewModal);
    if (previewEdit) {
        previewEdit.addEventListener('click', () => {
            if (!vaultPreviewDocument) return;
            const doc = vaultPreviewDocument;
            closeVaultPreviewModal();
            openVaultDocumentModal(doc);
        });
    }
    if (previewArchive) {
        previewArchive.addEventListener('click', () => {
            if (!vaultPreviewDocument) return;
            const doc = vaultPreviewDocument;
            closeVaultPreviewModal();
            if (vaultIsArchivedScope()) vaultRestoreDoc(doc);
            else vaultArchiveDoc(doc);
        });
    }
    if (previewDownload) {
        previewDownload.addEventListener('click', () => {
            if (vaultPreviewDocument) vaultDownloadDoc(vaultPreviewDocument);
        });
    }

    if (searchInput) {
        let searchTimer;
        searchInput.addEventListener('input', (e) => {
            vaultState.search = e.target.value.trim();
            vaultUpdateSearchBox();
            clearTimeout(searchTimer);
            searchTimer = setTimeout(loadVaultDocuments, 250);
        });
    }

    if (searchClear) {
        searchClear.addEventListener('click', () => {
            if (searchInput) {
                searchInput.value = '';
                vaultState.search = '';
                vaultUpdateSearchBox();
                loadVaultDocuments();
            }
        });
    }

    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            vaultState.sort = e.target.value;
            renderVaultItems();
        });
    }

    if (scopeSelect) {
        scopeSelect.addEventListener('change', (event) => {
            vaultSetScope(event.target.value);
        });
    }

    document.addEventListener('click', (event) => {
        if (vaultActiveMenu && !vaultActiveMenu.contains(event.target)) {
            closeVaultItemMenu();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && vaultActiveMenu) {
            event.preventDefault();
            closeVaultItemMenu({ returnFocus: true });
        }
    });
    window.addEventListener('resize', () => closeVaultItemMenu());
    window.addEventListener('scroll', () => closeVaultItemMenu(), true);

    // File input change handler for showing selected files
    if (fileInput) {
        fileInput.addEventListener('change', () => {
            const selectedFiles = Array.from(fileInput.files || []);
            if (selectedFiles.length) {
                vaultUploadQueue = vaultUploadQueue.concat(selectedFiles);
                fileInput.value = '';
            }
            renderVaultUploadFiles();
        });
    }

    bindVaultDropZone();
    vaultApplyViewMode();
    initVaultFab();
    loadVaultFolders();
    loadVaultDocuments();
    loadVaultStats();
}

function renderVaultUploadFiles() {
    const container = document.getElementById('vault-upload-files');
    if (!container) return;

    const files = vaultUploadQueue;
    if (!files.length) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = files.map((file, idx) => `
        <div class="vault-upload-file" data-idx="${idx}">
            <i class="fa-solid fa-file"></i>
            <span>${escapeHtml((file.name || '').trim() || `Camera item ${idx + 1}`)}</span>
            <button type="button" title="Remove"><i class="fa-solid fa-xmark"></i></button>
        </div>
    `).join('');

    container.querySelectorAll('.vault-upload-file button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const row = e.currentTarget.closest('.vault-upload-file');
            const idx = row ? Number(row.dataset.idx) : -1;
            if (idx >= 0 && idx < vaultUploadQueue.length) {
                vaultUploadQueue.splice(idx, 1);
            }
            renderVaultUploadFiles();
        });
    });
}

document.addEventListener('DOMContentLoaded', initVaultPage);
