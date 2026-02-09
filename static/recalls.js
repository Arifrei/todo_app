// --- Recalls ---

if (typeof recallState === 'undefined') {
    window.recallState = {
        items: [],
        modalRecallId: null,
        modalEditMode: false,
        pollingIds: [],
        pollingInterval: null
    };
}

function initRecallsPage() {
    const cardsEl = document.getElementById('recall-cards');
    const addInput = document.getElementById('recall-add-input');
    const addBtn = document.getElementById('recall-add-btn');
    const addForm = document.getElementById('recall-add-form');
    if (!cardsEl) return;
    if (document.body && document.body.dataset.recallsPageInit === '1') return;
    if (document.body) document.body.dataset.recallsPageInit = '1';

    function setRecallAddButtonState(isOpen) {
        if (!addBtn) return;
        addBtn.classList.toggle('active', isOpen);
        addBtn.innerHTML = `<i class="fa-solid ${isOpen ? 'fa-xmark' : 'fa-plus'}"></i>`;
        addBtn.setAttribute('aria-label', isOpen ? 'Close add recall form' : 'Add recall');
        addBtn.title = isOpen ? 'Close add form' : 'Add recall';
    }

    // Toggle add form visibility
    if (addBtn && addForm) {
        addBtn.addEventListener('click', () => {
            const isOpen = addForm.classList.contains('open');
            if (isOpen) {
                addForm.classList.remove('open');
                setRecallAddButtonState(false);
            } else {
                addForm.classList.add('open');
                setRecallAddButtonState(true);
                if (addInput) addInput.focus();
            }
        });
        setRecallAddButtonState(false);
    }

    // Setup add input - Enter key submits immediately
    if (addInput) {
        addInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = addInput.value.trim();
                if (val) handleAddRecall(val);
            }
        });
    }

    // Setup modal overlay click to close
    const overlay = document.getElementById('recall-modal-overlay');
    const closeBtn = document.getElementById('recall-modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeRecallModal);
    }
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeRecallModal();
        });
    }

    loadAllRecalls();
}

async function loadAllRecalls() {
    const cardsEl = document.getElementById('recall-cards');
    if (cardsEl) cardsEl.innerHTML = '<div class="recall-empty">Loading...</div>';
    try {
        const res = await fetch('/api/recalls');
        if (res.status === 401) {
            window.location.href = '/select-user';
            return;
        }
        if (!res.ok) throw new Error('Failed to load recalls');
        recallState.items = await res.json();
        renderRecallCards();
        startPollingPendingAI();
    } catch (err) {
        console.error(err);
        if (cardsEl) cardsEl.innerHTML = '<div class="recall-empty">Could not load recalls.</div>';
    }
}

function renderRecallCards() {
    const container = document.getElementById('recall-cards');
    if (!container) return;

    const items = recallState.items;

    if (!items.length) {
        container.innerHTML = '<div class="recall-empty">No recalls yet. Click Add to create one.</div>';
        return;
    }

    container.innerHTML = '';
    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'recall-card';
        card.dataset.id = item.id;

        // Meta badges (URL + when context)
        let metaHtml = '';
        if (item.payload_type === 'url') {
            metaHtml += `<a href="${recallEscape(item.payload)}" target="_blank" rel="noopener" class="recall-card-url" onclick="event.stopPropagation()"><i class="fa-solid fa-link"></i> URL</a>`;
        }
        // Why display
        let whyHtml = '';
        if (item.ai_status === 'pending' || item.ai_status === 'processing') {
            whyHtml = `<div class="recall-card-why pending">Generating...</div>`;
        } else if (item.why) {
            whyHtml = `<div class="recall-card-why">${recallEscape(item.why)}</div>`;
        }

        card.innerHTML = `
            <div class="recall-card-header">
                <div class="recall-card-title">${recallEscape(item.title)}</div>
                <div class="recall-card-meta">${metaHtml}</div>
            </div>
            ${whyHtml}
        `;

        card.addEventListener('click', () => openRecallModal(item.id));
        container.appendChild(card);
    });
}

function openRecallModal(id) {
    const recall = recallState.items.find(item => item.id === id);
    if (!recall) return;

    recallState.modalRecallId = id;
    recallState.modalEditMode = false;
    const overlay = document.getElementById('recall-modal-overlay');
    const body = document.getElementById('recall-modal-body');
    const titleText = document.getElementById('recall-modal-title-text');
    if (!overlay || !body) return;

    if (titleText) titleText.textContent = 'Recall';
    renderModalViewMode(recall);
    overlay.classList.add('open');
}

function renderModalViewMode(recall) {
    const body = document.getElementById('recall-modal-body');
    const titleText = document.getElementById('recall-modal-title-text');
    if (!body) return;

    if (titleText) titleText.textContent = 'Recall';

    // URL badge
    let urlHtml = '';
    if (recall.payload_type === 'url') {
        urlHtml = `<a href="${recallEscape(recall.payload)}" target="_blank" rel="noopener" class="recall-view-url"><i class="fa-solid fa-external-link"></i> URL</a>`;
    }

    // Why display
    let whyHtml = '';
    if (recall.ai_status === 'pending' || recall.ai_status === 'processing') {
        whyHtml = `
            <div class="recall-view-block">
                <div class="recall-view-label">Why</div>
                <div class="recall-view-box recall-view-why pending">Generating...</div>
            </div>
        `;
    } else if (recall.why) {
        whyHtml = `
            <div class="recall-view-block">
                <div class="recall-view-label">Why</div>
                <div class="recall-view-box recall-view-why">${recallEscape(recall.why)}</div>
            </div>
        `;
    }

    // Summary display
    let summaryHtml = '';
    if (recall.ai_status === 'pending' || recall.ai_status === 'processing') {
        summaryHtml = `
            <div class="recall-view-block">
                <div class="recall-view-label">Summary</div>
                <div class="recall-view-box recall-view-summary pending">Generating summary...</div>
            </div>
        `;
    } else if (recall.summary) {
        summaryHtml = `
            <div class="recall-view-block">
                <div class="recall-view-label">Summary</div>
                <div class="recall-view-box recall-view-summary">${recallEscape(recall.summary)}</div>
            </div>
        `;
    }

    // Content display for text payloads
    let contentHtml = '';
    if (recall.payload_type === 'text') {
        contentHtml = `
            <div class="recall-view-block">
                <div class="recall-view-label">Content</div>
                <div class="recall-view-box recall-view-content">${recallEscape(recall.payload)}</div>
            </div>
        `;
    }

    body.innerHTML = `
        <div class="recall-view-section">
            <div class="recall-view-title">${recallEscape(recall.title)}</div>
            <div class="recall-view-meta">
                ${urlHtml}
            </div>
        </div>
        ${whyHtml ? `<div class="recall-view-section">${whyHtml}</div>` : ''}
        ${summaryHtml ? `<div class="recall-view-section">${summaryHtml}</div>` : ''}
        ${contentHtml ? `<div class="recall-view-section">${contentHtml}</div>` : ''}
        <div class="recall-modal-actions">
            <div class="recall-modal-actions-left">
                <button type="button" class="recall-modal-delete" id="recall-modal-delete">Delete</button>
                <button type="button" class="recall-modal-edit" id="recall-modal-edit">Edit</button>
            </div>
        </div>
    `;

    // Setup edit button
    const editBtn = document.getElementById('recall-modal-edit');
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            recallState.modalEditMode = true;
            renderModalEditMode(recall);
        });
    }

    // Setup delete button
    const deleteBtn = document.getElementById('recall-modal-delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            closeRecallModal();
            deleteRecall(recall.id);
        });
    }
}

function renderModalEditMode(recall) {
    const body = document.getElementById('recall-modal-body');
    const titleText = document.getElementById('recall-modal-title-text');
    if (!body) return;

    if (titleText) titleText.textContent = 'Edit Recall';

    // Payload field - editable for text and url types
    let payloadHtml = '';
    if (recall.payload_type === 'text') {
        payloadHtml = `
            <div class="recall-modal-field">
                <label>Content</label>
                <textarea class="recall-modal-payload" id="recall-modal-payload">${recallEscape(recall.payload)}</textarea>
            </div>
        `;
    } else if (recall.payload_type === 'url') {
        payloadHtml = `
            <div class="recall-modal-field">
                <label>URL</label>
                <input type="text" class="recall-modal-input" id="recall-modal-payload" value="${recallEscape(recall.payload)}" placeholder="https://...">
            </div>
        `;
    }

    // Summary field
    let summaryHtml = '';
    if (recall.ai_status === 'pending' || recall.ai_status === 'processing') {
        summaryHtml = `
            <div class="recall-modal-field">
                <label>Summary</label>
                <div class="recall-view-summary pending">Generating summary...</div>
            </div>
        `;
    } else {
        summaryHtml = `
            <div class="recall-modal-field">
                <label>Summary</label>
                <textarea class="recall-modal-summary-input" id="recall-modal-summary">${recallEscape(recall.summary || '')}</textarea>
            </div>
        `;
    }

    body.innerHTML = `
        <div class="recall-modal-field">
            <label>Title</label>
            <input type="text" class="recall-modal-input" id="recall-modal-title" value="${recallEscape(recall.title)}">
        </div>
        ${payloadHtml}
        <div class="recall-modal-field">
            <label>Why</label>
            <input type="text" class="recall-modal-input" id="recall-modal-why" value="${recallEscape(recall.why || '')}" placeholder="${recall.ai_status === 'pending' || recall.ai_status === 'processing' ? 'Generating...' : ''}">
        </div>
        ${summaryHtml}
        <div class="recall-modal-actions">
            <button type="button" class="recall-modal-cancel" id="recall-modal-cancel">Cancel</button>
            <button type="button" class="recall-modal-save" id="recall-modal-save">Save</button>
        </div>
    `;

    // Setup cancel button
    const cancelBtn = document.getElementById('recall-modal-cancel');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            recallState.modalEditMode = false;
            renderModalViewMode(recall);
        });
    }

    // Setup save button
    const saveBtn = document.getElementById('recall-modal-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => saveRecallFromModal(recall.id));
    }
}

// Keep for backward compatibility with polling updates
function renderModalContent(recall) {
    if (recallState.modalEditMode) {
        renderModalEditMode(recall);
    } else {
        renderModalViewMode(recall);
    }
}

function closeRecallModal() {
    const overlay = document.getElementById('recall-modal-overlay');
    if (overlay) overlay.classList.remove('open');
    recallState.modalRecallId = null;
    recallState.modalEditMode = false;
}

async function saveRecallFromModal(id) {
    const titleInput = document.getElementById('recall-modal-title');
    const whyInput = document.getElementById('recall-modal-why');
    const payloadInput = document.getElementById('recall-modal-payload');
    const summaryInput = document.getElementById('recall-modal-summary');

    const fields = {};
    if (titleInput) fields.title = titleInput.value.trim();
    if (whyInput) fields.why = whyInput.value.trim();
    if (payloadInput) fields.payload = payloadInput.value.trim();
    if (summaryInput) fields.summary = summaryInput.value.trim();

    try {
        const res = await fetch(`/api/recalls/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields)
        });
        if (!res.ok) throw new Error('Update failed');
        const updated = await res.json();
        const idx = recallState.items.findIndex(item => item.id === id);
        if (idx !== -1) recallState.items[idx] = updated;
        renderRecallCards();
        closeRecallModal();
        showToast('Recall updated', 'success');
    } catch (err) {
        console.error(err);
        showToast('Could not update recall.', 'error');
    }
}

function detectPayloadType(input) {
    const trimmed = (input || '').trim();
    return /^https?:\/\/\S+$/i.test(trimmed) ? 'url' : 'text';
}

function parseRecallInput(input) {
    // Use ";" (semicolon) as delimiter for easier mobile typing
    const idx = input.indexOf(';');
    if (idx === -1) return null;
    const title = input.substring(0, idx).trim();
    const content = input.substring(idx + 1).trim();
    if (!title || !content) return null;
    return { title, content };
}

async function handleAddRecall(input) {
    const parsed = parseRecallInput(input);
    if (!parsed) {
        showToast('Use format: Title; Content or URL', 'error');
        return;
    }

    const payload_type = detectPayloadType(parsed.content);

    try {
        const res = await fetch('/api/recalls', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: parsed.title,
                payload: parsed.content,
                payload_type
            })
        });
        if (!res.ok) throw new Error('Save failed');
        const saved = await res.json();

        recallState.items.unshift(saved);

        // Start polling for this item if AI is pending
        if (saved.ai_status === 'pending') {
            startPollingForRecall(saved.id);
        }

        const addInput = document.getElementById('recall-add-input');
        if (addInput) addInput.value = '';

        // Close the add form
        const addForm = document.getElementById('recall-add-form');
        const addBtn = document.getElementById('recall-add-btn');
        if (addForm) addForm.classList.remove('open');
        if (addBtn) {
            addBtn.classList.remove('active');
            addBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
            addBtn.setAttribute('aria-label', 'Add recall');
            addBtn.title = 'Add recall';
        }

        renderRecallCards();
        showToast('Recall saved', 'success');
    } catch (err) {
        console.error(err);
        showToast('Could not save recall.', 'error');
    }
}

function startPollingForRecall(id) {
    if (!recallState.pollingIds.includes(id)) {
        recallState.pollingIds.push(id);
    }

    if (!recallState.pollingInterval) {
        recallState.pollingInterval = setInterval(pollPendingAI, 3000);
    }
}

function startPollingPendingAI() {
    // Find any items that are still pending
    const pendingIds = recallState.items
        .filter(item => item.ai_status === 'pending' || item.ai_status === 'processing')
        .map(item => item.id);

    if (pendingIds.length > 0) {
        recallState.pollingIds = pendingIds;
        recallState.pollingInterval = setInterval(pollPendingAI, 3000);
    }
}

async function pollPendingAI() {
    if (recallState.pollingIds.length === 0) {
        if (recallState.pollingInterval) {
            clearInterval(recallState.pollingInterval);
            recallState.pollingInterval = null;
        }
        return;
    }

    const idsToCheck = [...recallState.pollingIds];

    for (const id of idsToCheck) {
        try {
            const res = await fetch(`/api/recalls/${id}`);
            if (!res.ok) continue;
            const recall = await res.json();

            if (recall.ai_status === 'done' || recall.ai_status === 'failed') {
                // Update local state
                const idx = recallState.items.findIndex(r => r.id === id);
                if (idx !== -1) {
                    recallState.items[idx] = recall;
                }

                // Remove from polling
                recallState.pollingIds = recallState.pollingIds.filter(i => i !== id);

                // Re-render
                renderRecallCards();

                // Update modal if it's open for this item
                if (recallState.modalRecallId === id) {
                    renderModalContent(recall);
                }
            }
        } catch (err) {
            console.error('Poll error for recall', id, err);
        }
    }
}

function deleteRecall(id) {
    openConfirmModal('Delete this recall?', async () => {
        try {
            const res = await fetch(`/api/recalls/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            recallState.items = recallState.items.filter(item => item.id !== id);
            recallState.pollingIds = recallState.pollingIds.filter(i => i !== id);
            renderRecallCards();
            closeConfirmModal();
            showToast('Recall deleted', 'success');
        } catch (err) {
            console.error(err);
            showToast('Could not delete recall.', 'error');
            closeConfirmModal();
        }
    });
}

function recallEscape(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRecallsPage);
} else {
    initRecallsPage();
}
