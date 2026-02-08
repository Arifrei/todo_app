// Vault
const vaultState = {
    folders: [],
    documents: [],
    activeFolderId: null,
    viewMode: localStorage.getItem('vaultViewMode') || 'grid',
    search: '',
    sort: 'recent',
    stats: null
};

// Vault selection manager
let vaultSelection = null;
let vaultBulkActions = null;

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
    if (!fab) return;
    vaultFabExpanded = false;
    fab.classList.remove('expanded');
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
    let current = vaultGetFolderById(folderId);
    while (current) {
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
    root.innerHTML = '<i class="fa-solid fa-house"></i>';
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
            item.className = 'vault-item';
            item.innerHTML = `
                <div class="vault-item-icon folder"><i class="fa-solid fa-folder"></i></div>
                <div class="vault-item-info">
                    <div class="vault-item-name">${escapeHtml(folder.name)}</div>
                    <div class="vault-item-meta">Folder</div>
                </div>
                <div class="vault-item-actions">
                    <button class="vault-item-btn" title="Open" type="button"><i class="fa-solid fa-folder-open"></i></button>
                    <button class="vault-item-btn" title="Rename" type="button"><i class="fa-solid fa-pen"></i></button>
                    <button class="vault-item-btn danger" title="Archive" type="button"><i class="fa-solid fa-box-archive"></i></button>
                </div>
            `;
            const btns = item.querySelectorAll('.vault-item-btn');
            btns[0].addEventListener('click', (e) => { e.stopPropagation(); vaultSetActiveFolder(folder.id); });
            btns[1].addEventListener('click', (e) => { e.stopPropagation(); openVaultFolderModal(folder); });
            btns[2].addEventListener('click', (e) => { e.stopPropagation(); vaultArchiveFolder(folder); });
            item.addEventListener('click', () => vaultSetActiveFolder(folder.id));
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
        item.innerHTML = `
            <input type="checkbox" class="item-select-checkbox vault-item-checkbox" ${isSelected ? 'checked' : ''}>
            <div class="vault-item-icon ${category}"><i class="${iconClass}"></i></div>
            <div class="vault-item-info">
                <div class="vault-item-name">${escapeHtml(doc.title)}</div>
                <div class="vault-item-meta">${doc.file_size_formatted || vaultFormatFileSize(doc.file_size)}</div>
            </div>
            <div class="vault-item-actions">
                <button class="vault-item-btn" title="${doc.pinned ? 'Unpin' : 'Pin'}" type="button"><i class="fa-solid fa-thumbtack"></i></button>
                <button class="vault-item-btn" title="Open" type="button"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>
                <button class="vault-item-btn" title="Download" type="button"><i class="fa-solid fa-download"></i></button>
                <button class="vault-item-btn danger" title="Archive" type="button"><i class="fa-solid fa-box-archive"></i></button>
            </div>
        `;
        const checkbox = item.querySelector('.vault-item-checkbox');
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            if (vaultSelection) vaultSelection.toggle(doc.id);
        });
        checkbox.addEventListener('change', (e) => {
            if (vaultSelection) {
                if (e.target.checked) {
                    vaultSelection.select(doc.id);
                } else {
                    vaultSelection.deselect(doc.id);
                }
            }
        });
        const btns = item.querySelectorAll('.vault-item-btn');
        btns[0].addEventListener('click', (e) => { e.stopPropagation(); vaultTogglePin(doc); });
        btns[1].addEventListener('click', (e) => { e.stopPropagation(); vaultOpenDoc(doc); });
        btns[2].addEventListener('click', (e) => { e.stopPropagation(); vaultDownloadDoc(doc); });
        btns[3].addEventListener('click', (e) => { e.stopPropagation(); vaultArchiveDoc(doc); });
        item.addEventListener('click', (e) => {
            // If in selection mode, toggle selection instead of opening
            if (vaultSelection && vaultSelection.getCount() > 0 && !e.target.closest('.vault-item-actions')) {
                vaultSelection.toggle(doc.id);
                checkbox.checked = vaultSelection.isSelected(doc.id);
                item.classList.toggle('selected', checkbox.checked);
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
        const res = await fetch('/api/vault/folders');
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
    const query = vaultState.search ? `/api/vault/search?q=${encodeURIComponent(vaultState.search)}` : `/api/vault/documents?folder_id=${vaultState.activeFolderId || ''}`;
    try {
        const res = await fetch(query);
        if (!res.ok) throw new Error('Document load failed');
        vaultState.documents = await res.json();
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
    vaultState.activeFolderId = folderId;
    renderVaultBreadcrumb();
    loadVaultDocuments();
    renderVaultItems();
}

function populateVaultFolderSelect() {
    const select = document.getElementById('vault-folder-select');
    if (!select) return;
    select.innerHTML = '<option value="">Root</option>';
    const buildOptions = (parentId, prefix) => {
        vaultState.folders
            .filter(folder => (folder.parent_id || null) === parentId)
            .forEach(folder => {
                const option = document.createElement('option');
                option.value = folder.id;
                option.textContent = `${prefix}${folder.name}`;
                select.appendChild(option);
                buildOptions(folder.id, `${prefix}- `);
            });
    };
    buildOptions(null, '');
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
    const modal = document.getElementById('vault-folder-modal');
    const title = document.getElementById('vault-folder-modal-title');
    const nameInput = document.getElementById('vault-folder-name');
    const idInput = document.getElementById('vault-folder-id');
    if (!modal || !title || !nameInput || !idInput) return;
    title.textContent = folder ? 'Rename Folder' : 'New Folder';
    nameInput.value = folder ? folder.name : '';
    idInput.value = folder ? folder.id : '';
    modal.classList.add('active');
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
    const modal = document.getElementById('vault-upload-modal');
    if (modal) modal.classList.add('active');
    const tagsInput = document.getElementById('vault-tags-input');
    const fileInput = document.getElementById('vault-file-input');
    const filesContainer = document.getElementById('vault-upload-files');
    if (tagsInput) tagsInput.value = '';
    if (fileInput) fileInput.value = '';
    if (filesContainer) filesContainer.innerHTML = '';
}

function closeVaultUploadModal() {
    const modal = document.getElementById('vault-upload-modal');
    if (modal) modal.classList.remove('active');
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

function vaultOpenDoc(doc) {
    const previewTypes = ['image', 'pdf', 'text', 'audio', 'video', 'code'];
    const path = previewTypes.includes(doc.file_category)
        ? `/api/vault/documents/${doc.id}/preview`
        : `/api/vault/documents/${doc.id}/download`;
    window.open(path, '_blank', 'noopener');
}

function vaultArchiveDoc(doc) {
    openConfirmModal(`Archive "${doc.title}"?`, async () => {
        try {
            const res = await fetch(`/api/vault/documents/${doc.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Archive failed');
            vaultState.documents = vaultState.documents.filter(item => item.id !== doc.id);
            renderVaultItems();
            showToast('Archived', 'success');
        } catch (err) {
            console.error(err);
            showToast('Could not archive document', 'error');
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

function openVaultBulkMoveModal() {
    // Reuse the folder modal to select destination
    const modal = document.getElementById('vault-folder-modal');
    const title = document.getElementById('vault-folder-modal-title');
    const nameInput = document.getElementById('vault-folder-name');
    const idInput = document.getElementById('vault-folder-id');
    const saveBtn = document.getElementById('vault-folder-save');

    if (!modal || !title) return;

    // Create or reuse a folder select dropdown
    let selectHtml = '<select id="vault-bulk-move-select" class="form-control"><option value="">Root folder</option>';
    const buildOptions = (parentId, prefix) => {
        vaultState.folders
            .filter(folder => (folder.parent_id || null) === parentId && folder.id !== vaultState.activeFolderId)
            .forEach(folder => {
                selectHtml += `<option value="${folder.id}">${prefix}${escapeHtml(folder.name)}</option>`;
                buildOptions(folder.id, `${prefix}- `);
            });
    };
    buildOptions(null, '');
    selectHtml += '</select>';

    title.textContent = `Move ${vaultSelection.getCount()} document(s)`;
    if (nameInput) nameInput.style.display = 'none';
    if (idInput) idInput.value = '';

    // Add select to modal body
    const formGroup = nameInput ? nameInput.parentElement : null;
    if (formGroup) {
        const label = formGroup.querySelector('label');
        if (label) label.textContent = 'Destination folder';
        formGroup.innerHTML = '<label>Destination folder</label>' + selectHtml;
    }

    // Override save button behavior
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    newSaveBtn.textContent = 'Move';
    newSaveBtn.addEventListener('click', async () => {
        const select = document.getElementById('vault-bulk-move-select');
        const folderId = select ? (select.value || null) : null;
        if (vaultBulkActions) {
            await vaultBulkActions.move(folderId, 'folder');
        }
        closeVaultFolderModal();
        // Reset modal for folder creation
        resetVaultFolderModal();
    });

    modal.classList.add('active');
}

function resetVaultFolderModal() {
    const title = document.getElementById('vault-folder-modal-title');
    const formGroup = document.querySelector('#vault-folder-modal .form-group');
    const saveBtn = document.getElementById('vault-folder-save');

    if (title) title.textContent = 'New Folder';
    if (formGroup) {
        formGroup.innerHTML = '<label>Folder name</label><input type="text" id="vault-folder-name" class="form-control" placeholder="Enter folder name...">';
    }
    if (saveBtn) {
        const newSaveBtn = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
        newSaveBtn.id = 'vault-folder-save';
        newSaveBtn.textContent = 'Save';
        newSaveBtn.addEventListener('click', saveVaultFolder);
    }
}

function vaultHandleUpload() {
    const fileInput = document.getElementById('vault-file-input');
    if (!fileInput || !fileInput.files.length) {
        showToast('Select at least one file', 'warning');
        return;
    }
    const formData = new FormData();
    [...fileInput.files].forEach(file => formData.append('files', file));
    const tagsInput = document.getElementById('vault-tags-input');
    const folderSelect = document.getElementById('vault-folder-select');
    if (tagsInput && tagsInput.value.trim()) formData.append('tags', tagsInput.value.trim());
    if (folderSelect) formData.append('folder_id', folderSelect.value || '');

    const progressWrap = document.getElementById('vault-upload-progress');
    const progressBar = document.getElementById('vault-upload-bar');
    if (progressWrap && progressBar) {
        progressWrap.style.display = 'block';
        progressBar.style.width = '0%';
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/vault/documents');
    xhr.upload.addEventListener('progress', (evt) => {
        if (!progressBar || !evt.lengthComputable) return;
        const percent = Math.round((evt.loaded / evt.total) * 100);
        progressBar.style.width = `${percent}%`;
    });
    xhr.onload = async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
            showToast('Upload complete', 'success');
            closeVaultUploadModal();
            fileInput.value = '';
            await loadVaultDocuments();
            await loadVaultStats();
        } else {
            showToast('Upload failed', 'error');
        }
        if (progressWrap) progressWrap.style.display = 'none';
    };
    xhr.onerror = () => {
        showToast('Upload failed', 'error');
        if (progressWrap) progressWrap.style.display = 'none';
    };
    xhr.send(formData);
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
            fileInput.files = e.dataTransfer.files;
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
    const emptyUpload = document.getElementById('vault-empty-upload');

    // Bulk action buttons
    const selectAll = document.getElementById('vault-select-all');
    const bulkClear = document.getElementById('vault-bulk-clear');
    const bulkPin = document.getElementById('vault-bulk-pin');
    const bulkMove = document.getElementById('vault-bulk-move');
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
                vaultBulkActions.delete('Delete selected documents?');
            }
        });
    }

    if (viewToggle) viewToggle.addEventListener('click', vaultToggleView);
    if (folderSave) folderSave.addEventListener('click', saveVaultFolder);
    if (folderCancel) folderCancel.addEventListener('click', closeVaultFolderModal);
    if (uploadCancel) uploadCancel.addEventListener('click', closeVaultUploadModal);
    if (uploadSubmit) uploadSubmit.addEventListener('click', vaultHandleUpload);
    if (browseBtn && fileInput) browseBtn.addEventListener('click', () => fileInput.click());
    if (emptyUpload) emptyUpload.addEventListener('click', openVaultUploadModal);

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

    // File input change handler for showing selected files
    if (fileInput) {
        fileInput.addEventListener('change', () => {
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
    const fileInput = document.getElementById('vault-file-input');
    const container = document.getElementById('vault-upload-files');
    if (!fileInput || !container) return;

    const files = [...(fileInput.files || [])];
    if (!files.length) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = files.map((file, idx) => `
        <div class="vault-upload-file" data-idx="${idx}">
            <i class="fa-solid fa-file"></i>
            <span>${escapeHtml(file.name)}</span>
            <button type="button" title="Remove"><i class="fa-solid fa-xmark"></i></button>
        </div>
    `).join('');

    container.querySelectorAll('.vault-upload-file button').forEach(btn => {
        btn.addEventListener('click', () => {
            // Note: Can't remove individual files from FileList, so just clear all
            fileInput.value = '';
            container.innerHTML = '';
        });
    });
}

document.addEventListener('DOMContentLoaded', initVaultPage);
