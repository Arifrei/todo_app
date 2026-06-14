const inboxState = {
    items: [],
    destinations: null,
    activeItem: null,
    detectionTimer: null,
    activeCreates: 0,
    nextTemporaryId: -1
};

function formatInboxReminderMinutes(minutes) {
    if (minutes === null || minutes === undefined || minutes === '') return '';
    const total = Number(minutes);
    if (!Number.isFinite(total)) return '';
    if (total % 1440 === 0) return `${total / 1440}d`;
    if (total % 60 === 0) return `${total / 60}h`;
    return `${total}m`;
}

function inboxSetBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
        button.dataset.originalHtml = button.innerHTML;
        button.disabled = true;
        button.textContent = busyLabel;
    } else {
        button.disabled = false;
        button.innerHTML = button.dataset.originalHtml || button.innerHTML;
    }
}

async function inboxReadResponse(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
}

async function loadInboxItems(silent = false) {
    const container = document.getElementById('inbox-items');
    if (silent && inboxState.activeCreates > 0) {
        scheduleInboxDetectionPoll();
        return;
    }
    try {
        const response = await fetch('/api/inbox');
        inboxState.items = await inboxReadResponse(response);
        renderInboxItems();
    } catch (error) {
        if (!silent) {
            if (container) container.innerHTML = '<div class="inbox-empty">Could not load the inbox.</div>';
            showToast(error.message, 'error');
        }
    }
}

function scheduleInboxDetectionPoll() {
    if (inboxState.detectionTimer) {
        clearTimeout(inboxState.detectionTimer);
        inboxState.detectionTimer = null;
    }
    const hasPendingDetection = inboxState.items.some(item => (
        item.temporary || ['pending', 'processing', 'refining'].includes(item.suggestion_status)
    ));
    if (!hasPendingDetection) return;
    inboxState.detectionTimer = window.setTimeout(async () => {
        inboxState.detectionTimer = null;
        await loadInboxItems(true);
    }, 900);
}

function renderInboxItems() {
    const container = document.getElementById('inbox-items');
    const count = document.getElementById('inbox-count');
    if (!container) return;
    const total = inboxState.items.length;
    if (count) count.textContent = `${total} ${total === 1 ? 'item' : 'items'}`;
    if (!total) {
        container.innerHTML = '<div class="inbox-empty"><i class="fa-solid fa-check"></i><strong>Inbox clear</strong><span>New captures will wait here until you map them.</span></div>';
        return;
    }
    container.innerHTML = inboxState.items.map(item => {
        const suggestion = item.suggestion || {};
        const isDetecting = (
            !suggestion.label
            && (item.temporary || ['pending', 'processing'].includes(item.suggestion_status))
        );
        const suggestionHtml = isDetecting
            ? `
                <div class="inbox-suggestion inbox-suggestion-detecting">
                    <strong><i class="fa-solid fa-spinner fa-spin"></i> Detecting destination...</strong>
                </div>
            `
            : suggestion.label
            ? `
                <div class="inbox-suggestion">
                    <strong>${escapeHtml(suggestion.label)}</strong>
                </div>
            `
            : `
                <div class="inbox-suggestion inbox-suggestion-unavailable">
                    <strong>Manual mapping needed</strong>
                </div>
            `;
        return `
            <article class="inbox-card" data-inbox-id="${item.id}">
                <div class="inbox-card-meta">
                    <span><i class="fa-regular fa-clock"></i> ${escapeHtml(inboxFormatDate(item.created_at))}</span>
                </div>
                <div class="inbox-card-content">${escapeHtml(item.content).replace(/\n/g, '<br>')}</div>
                ${suggestionHtml}
                <div class="inbox-card-actions">
                    <button class="btn btn-primary inbox-accept-btn" type="button"
                            data-inbox-id="${item.id}" title="Accept suggestion"
                            aria-label="Accept suggestion" ${suggestion.label && !item.temporary ? '' : 'disabled'}>
                        <i class="fa-solid fa-check"></i>
                        <span class="inbox-action-label inbox-action-label-full">Accept suggestion</span>
                        <span class="inbox-action-label inbox-action-label-short">Accept</span>
                    </button>
                    <button class="btn inbox-manual-btn" type="button" data-inbox-id="${item.id}"
                            title="Map manually" aria-label="Map manually"
                            ${item.temporary ? 'disabled' : ''}>
                        <i class="fa-solid fa-sliders"></i>
                        <span class="inbox-action-label inbox-action-label-full">Map manually</span>
                        <span class="inbox-action-label inbox-action-label-short">Map</span>
                    </button>
                    <button class="btn btn-danger inbox-delete-btn" type="button" data-inbox-id="${item.id}"
                            title="Delete inbox item" aria-label="Delete inbox item"
                            ${item.temporary ? 'disabled' : ''}>
                        <i class="fa-solid fa-trash"></i>
                        <span class="inbox-action-label">Delete</span>
                    </button>
                </div>
            </article>
        `;
    }).join('');
    scheduleInboxDetectionPoll();
}

function inboxFormatDate(value) {
    if (!value) return 'Just now';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Just now';
    return parsed.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function addInboxItem() {
    const input = document.getElementById('inbox-capture-input');
    const content = input ? input.value.trim() : '';
    if (!content) {
        showToast('Write something to add.', 'warning');
        return;
    }
    const temporaryId = inboxState.nextTemporaryId--;
    const temporaryItem = {
        id: temporaryId,
        content,
        status: 'open',
        suggestion_status: 'processing',
        suggestion: null,
        suggestion_reason: 'Detecting the best destination...',
        created_at: new Date().toISOString(),
        temporary: true
    };
    inboxState.items.unshift(temporaryItem);
    inboxState.activeCreates += 1;
    if (input) {
        input.value = '';
        input.focus();
    }
    renderInboxItems();
    try {
        const response = await fetch('/api/inbox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        const item = await inboxReadResponse(response);
        const temporaryIndex = inboxState.items.findIndex(entry => entry.id === temporaryId);
        if (temporaryIndex === -1) inboxState.items.unshift(item);
        else inboxState.items.splice(temporaryIndex, 1, item);
        renderInboxItems();
        showToast('Added to inbox', 'success');
    } catch (error) {
        inboxState.items = inboxState.items.filter(entry => entry.id !== temporaryId);
        renderInboxItems();
        if (input && !input.value.trim()) input.value = content;
        showToast(error.message, 'error');
    } finally {
        inboxState.activeCreates = Math.max(0, inboxState.activeCreates - 1);
        scheduleInboxDetectionPoll();
        if (input) input.focus();
    }
}

async function acceptInboxSuggestion(itemId, button) {
    inboxSetBusy(button, true, 'Inserting...');
    try {
        const response = await fetch(`/api/inbox/${itemId}/accept`, { method: 'POST' });
        const payload = await inboxReadResponse(response);
        inboxState.items = inboxState.items.filter(item => item.id !== itemId);
        renderInboxItems();
        showToast(payload.result?.label || 'Inbox item mapped', 'success');
    } catch (error) {
        showToast(error.message, 'error');
        inboxSetBusy(button, false);
    }
}

function deleteInboxItem(itemId) {
    openConfirmModal('Delete this inbox item?', async () => {
        try {
            const response = await fetch(`/api/inbox/${itemId}`, { method: 'DELETE' });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || 'Could not delete inbox item');
            }
            inboxState.items = inboxState.items.filter(item => item.id !== itemId);
            renderInboxItems();
            showToast('Inbox item deleted', 'success');
        } catch (error) {
            showToast(error.message, 'error');
        }
    });
}

async function loadInboxDestinations() {
    if (inboxState.destinations) return inboxState.destinations;
    const response = await fetch('/api/inbox/destinations');
    inboxState.destinations = await inboxReadResponse(response);
    return inboxState.destinations;
}

function inboxSetSelectOptions(selectId, items, emptyLabel, selectedValue) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const selected = selectedValue === null || selectedValue === undefined ? '' : String(selectedValue);
    const options = [`<option value="">${escapeHtml(emptyLabel)}</option>`];
    items.forEach(item => {
        options.push(
            `<option value="${item.id}" ${String(item.id) === selected ? 'selected' : ''}>${escapeHtml(item.title)}</option>`
        );
    });
    select.innerHTML = options.join('');
}

function inboxFillValue(id, value) {
    const input = document.getElementById(id);
    if (input) input.value = value === null || value === undefined ? '' : value;
}

function updateInboxTaskPhases(selectedPhaseId) {
    const listId = Number(document.getElementById('inbox-task-list')?.value || 0);
    const list = (inboxState.destinations?.task_lists || []).find(entry => entry.id === listId);
    inboxSetSelectOptions('inbox-task-phase', list?.phases || [], 'No phase', selectedPhaseId);
    const phaseSelect = document.getElementById('inbox-task-phase');
    if (phaseSelect) phaseSelect.disabled = !list || list.type === 'light' || !list.phases.length;
}

function updateInboxNoteListSections(selectedSectionId, selectedSubsectionId) {
    const noteId = Number(document.getElementById('inbox-note-list-target')?.value || 0);
    const noteList = (inboxState.destinations?.note_lists || []).find(entry => entry.id === noteId);
    inboxSetSelectOptions('inbox-note-list-section', noteList?.sections || [], 'Top level', selectedSectionId);
    updateInboxNoteListSubsections(selectedSubsectionId);
}

function updateInboxNoteListSubsections(selectedSubsectionId) {
    const noteId = Number(document.getElementById('inbox-note-list-target')?.value || 0);
    const sectionId = Number(document.getElementById('inbox-note-list-section')?.value || 0);
    const noteList = (inboxState.destinations?.note_lists || []).find(entry => entry.id === noteId);
    const section = noteList?.sections?.find(entry => entry.id === sectionId);
    inboxSetSelectOptions('inbox-note-list-subsection', section?.subsections || [], 'No subsection', selectedSubsectionId);
    const subsectionSelect = document.getElementById('inbox-note-list-subsection');
    if (subsectionSelect) subsectionSelect.disabled = !section || !section.subsections.length;
}

function showInboxMapKind(kind) {
    document.querySelectorAll('.inbox-map-fields').forEach(group => {
        const isActive = group.dataset.kind === kind;
        group.hidden = !isActive;
        group.style.display = isActive ? '' : 'none';
        group.setAttribute('aria-hidden', isActive ? 'false' : 'true');
        if ('inert' in group) group.inert = !isActive;
        group.querySelectorAll('input, select, textarea, button').forEach(control => {
            control.disabled = !isActive;
        });
    });
    if (kind === 'task') {
        const listId = Number(document.getElementById('inbox-task-list')?.value || 0);
        const list = (inboxState.destinations?.task_lists || []).find(entry => entry.id === listId);
        const phaseSelect = document.getElementById('inbox-task-phase');
        if (phaseSelect) {
            phaseSelect.disabled = !list || list.type === 'light' || !list.phases.length;
        }
    } else if (kind === 'note_list') {
        const noteId = Number(document.getElementById('inbox-note-list-target')?.value || 0);
        const sectionId = Number(document.getElementById('inbox-note-list-section')?.value || 0);
        const noteList = (inboxState.destinations?.note_lists || []).find(entry => entry.id === noteId);
        const section = noteList?.sections?.find(entry => entry.id === sectionId);
        const subsectionSelect = document.getElementById('inbox-note-list-subsection');
        if (subsectionSelect) {
            subsectionSelect.disabled = !section || !section.subsections.length;
        }
    }
}

async function openInboxMapper(itemId) {
    const item = inboxState.items.find(entry => entry.id === itemId);
    if (!item) return;
    try {
        await loadInboxDestinations();
    } catch (error) {
        showToast(error.message, 'error');
        return;
    }
    inboxState.activeItem = item;
    const suggestion = item.suggestion || {};
    const kind = ['task', 'calendar', 'note', 'note_list'].includes(suggestion.kind)
        ? suggestion.kind
        : 'task';
    document.getElementById('inbox-map-capture').textContent = item.content;
    document.getElementById('inbox-map-kind').value = kind;

    inboxSetSelectOptions('inbox-task-list', inboxState.destinations.task_lists || [], 'Choose a project or list', suggestion.list_id);
    updateInboxTaskPhases(suggestion.phase_id);
    inboxSetSelectOptions('inbox-note-target', inboxState.destinations.notes || [], 'Choose a note', suggestion.note_id);
    inboxSetSelectOptions('inbox-note-list-target', inboxState.destinations.note_lists || [], 'Choose a Notes list', suggestion.note_id);
    updateInboxNoteListSections(suggestion.section_id, suggestion.subsection_id);

    inboxFillValue('inbox-task-title', suggestion.title || item.content);
    inboxFillValue('inbox-task-description', suggestion.description);
    inboxFillValue('inbox-task-notes', suggestion.notes);
    inboxFillValue('inbox-task-tags', Array.isArray(suggestion.tags) ? suggestion.tags.join(', ') : suggestion.tags);
    inboxFillValue('inbox-task-date', suggestion.due_date);
    inboxFillValue('inbox-task-start', suggestion.start_time);
    inboxFillValue('inbox-task-end', suggestion.end_time);

    inboxFillValue('inbox-calendar-title', suggestion.title || item.content);
    inboxFillValue('inbox-calendar-date', suggestion.day || suggestion.due_date || suggestion.scheduled_date);
    inboxFillValue('inbox-calendar-start', suggestion.start_time);
    inboxFillValue('inbox-calendar-end', suggestion.end_time);
    document.getElementById('inbox-calendar-event').checked = Boolean(suggestion.is_event);

    inboxFillValue('inbox-note-text', suggestion.text || item.content);
    inboxFillValue('inbox-note-list-text', suggestion.text || item.content);
    inboxFillValue('inbox-note-list-note', suggestion.note);
    inboxFillValue('inbox-note-list-date', suggestion.scheduled_date || suggestion.due_date);
    inboxFillValue('inbox-note-list-start', suggestion.start_time);
    inboxFillValue('inbox-note-list-end', suggestion.end_time);

    const reminderValue = formatInboxReminderMinutes(suggestion.reminder_minutes_before);
    inboxFillValue('inbox-task-reminder', reminderValue);
    inboxFillValue('inbox-calendar-reminder', reminderValue);
    inboxFillValue('inbox-note-list-reminder', reminderValue);
    showInboxMapKind(kind);
    const modal = document.getElementById('inbox-map-modal');
    modal.classList.add('active');
    modal.querySelector('.modal-content')?.focus();
}

function closeInboxMapper() {
    document.getElementById('inbox-map-modal')?.classList.remove('active');
    inboxState.activeItem = null;
}

function inboxNullableNumber(value) {
    return value === '' || value === null || value === undefined ? null : Number(value);
}

function collectInboxDestination() {
    const kind = document.getElementById('inbox-map-kind').value;
    if (kind === 'task') {
        return {
            kind,
            list_id: inboxNullableNumber(document.getElementById('inbox-task-list').value),
            phase_id: inboxNullableNumber(document.getElementById('inbox-task-phase').value),
            title: document.getElementById('inbox-task-title').value,
            description: document.getElementById('inbox-task-description').value,
            notes: document.getElementById('inbox-task-notes').value,
            tags: document.getElementById('inbox-task-tags').value,
            due_date: document.getElementById('inbox-task-date').value,
            start_time: document.getElementById('inbox-task-start').value,
            end_time: document.getElementById('inbox-task-end').value,
            reminder_minutes_before: document.getElementById('inbox-task-reminder').value
        };
    }
    if (kind === 'calendar') {
        return {
            kind,
            title: document.getElementById('inbox-calendar-title').value,
            day: document.getElementById('inbox-calendar-date').value,
            start_time: document.getElementById('inbox-calendar-start').value,
            end_time: document.getElementById('inbox-calendar-end').value,
            reminder_minutes_before: document.getElementById('inbox-calendar-reminder').value,
            is_event: document.getElementById('inbox-calendar-event').checked
        };
    }
    if (kind === 'note') {
        return {
            kind,
            note_id: inboxNullableNumber(document.getElementById('inbox-note-target').value),
            text: document.getElementById('inbox-note-text').value
        };
    }
    return {
        kind,
        note_id: inboxNullableNumber(document.getElementById('inbox-note-list-target').value),
        section_id: inboxNullableNumber(document.getElementById('inbox-note-list-section').value),
        subsection_id: inboxNullableNumber(document.getElementById('inbox-note-list-subsection').value),
        text: document.getElementById('inbox-note-list-text').value,
        note: document.getElementById('inbox-note-list-note').value,
        scheduled_date: document.getElementById('inbox-note-list-date').value,
        start_time: document.getElementById('inbox-note-list-start').value,
        end_time: document.getElementById('inbox-note-list-end').value,
        reminder_minutes_before: document.getElementById('inbox-note-list-reminder').value
    };
}

async function submitInboxMapping() {
    const item = inboxState.activeItem;
    if (!item) return;
    const button = document.getElementById('inbox-map-submit');
    inboxSetBusy(button, true, 'Inserting...');
    try {
        const response = await fetch(`/api/inbox/${item.id}/map`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ destination: collectInboxDestination() })
        });
        const payload = await inboxReadResponse(response);
        inboxState.items = inboxState.items.filter(entry => entry.id !== item.id);
        closeInboxMapper();
        renderInboxItems();
        showToast(payload.result?.label || 'Inbox item mapped', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        inboxSetBusy(button, false);
    }
}

function initInboxPage() {
    if (!document.getElementById('inbox-items')) return;
    document.getElementById('inbox-capture-form')?.addEventListener('submit', event => {
        event.preventDefault();
        addInboxItem();
    });
    document.getElementById('inbox-capture-input')?.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            addInboxItem();
        }
    });
    document.getElementById('inbox-items')?.addEventListener('click', event => {
        const accept = event.target.closest('.inbox-accept-btn');
        if (accept) {
            acceptInboxSuggestion(Number(accept.dataset.inboxId), accept);
            return;
        }
        const manual = event.target.closest('.inbox-manual-btn');
        if (manual) {
            openInboxMapper(Number(manual.dataset.inboxId));
            return;
        }
        const deleteButton = event.target.closest('.inbox-delete-btn');
        if (deleteButton) deleteInboxItem(Number(deleteButton.dataset.inboxId));
    });
    document.getElementById('inbox-map-kind')?.addEventListener('change', event => {
        showInboxMapKind(event.target.value);
    });
    document.getElementById('inbox-task-list')?.addEventListener('change', () => updateInboxTaskPhases());
    document.getElementById('inbox-note-list-target')?.addEventListener('change', () => updateInboxNoteListSections());
    document.getElementById('inbox-note-list-section')?.addEventListener('change', () => updateInboxNoteListSubsections());
    document.getElementById('inbox-map-form')?.addEventListener('submit', event => {
        event.preventDefault();
        submitInboxMapping();
    });
    document.getElementById('inbox-map-close')?.addEventListener('click', closeInboxMapper);
    document.getElementById('inbox-map-cancel')?.addEventListener('click', closeInboxMapper);
    document.getElementById('inbox-map-modal')?.addEventListener('click', event => {
        if (event.target.id === 'inbox-map-modal') closeInboxMapper();
    });
    loadInboxItems();
    document.getElementById('inbox-capture-input')?.focus();
}

document.addEventListener('DOMContentLoaded', initInboxPage);
