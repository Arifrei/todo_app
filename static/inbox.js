const inboxState = {
    items: [],
    destinations: null,
    activeItem: null,
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
    if (silent && inboxState.activeCreates > 0) return;
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
        return `
            <article class="inbox-card" data-inbox-id="${item.id}">
                <div class="inbox-card-meta">
                    <span><i class="fa-regular fa-clock"></i> ${escapeHtml(inboxFormatDate(item.created_at))}</span>
                </div>
                <div class="inbox-card-content">${escapeHtml(item.content).replace(/\n/g, '<br>')}</div>
                <div class="inbox-card-actions">
                    <button class="btn btn-primary inbox-manual-btn" type="button" data-inbox-id="${item.id}"
                            title="Move" aria-label="Move"
                            ${item.temporary ? 'disabled' : ''}>
                        <i class="fa-solid fa-arrow-right"></i>
                        <span class="inbox-action-label">Move</span>
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
        if (input) input.focus();
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

function updateInboxAreaListSections(selectedSectionId, selectedSubsectionId) {
    const blockId = Number(document.getElementById('inbox-area-list-target')?.value || 0);
    const areaList = (inboxState.destinations?.area_lists || []).find(entry => entry.id === blockId);
    inboxSetSelectOptions('inbox-area-list-section', areaList?.sections || [], 'Top level', selectedSectionId);
    updateInboxAreaListSubsections(selectedSubsectionId);
}

function updateInboxAreaListSubsections(selectedSubsectionId) {
    const blockId = Number(document.getElementById('inbox-area-list-target')?.value || 0);
    const sectionId = Number(document.getElementById('inbox-area-list-section')?.value || 0);
    const areaList = (inboxState.destinations?.area_lists || []).find(entry => entry.id === blockId);
    const section = areaList?.sections?.find(entry => entry.id === sectionId);
    inboxSetSelectOptions('inbox-area-list-subsection', section?.subsections || [], 'No subsection', selectedSubsectionId);
    const subsectionSelect = document.getElementById('inbox-area-list-subsection');
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
    } else if (kind === 'area_list') {
        const blockId = Number(document.getElementById('inbox-area-list-target')?.value || 0);
        const sectionId = Number(document.getElementById('inbox-area-list-section')?.value || 0);
        const areaList = (inboxState.destinations?.area_lists || []).find(entry => entry.id === blockId);
        const section = areaList?.sections?.find(entry => entry.id === sectionId);
        const subsectionSelect = document.getElementById('inbox-area-list-subsection');
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
    const kind = 'task';
    document.getElementById('inbox-map-kind').value = kind;
    inboxFillValue('inbox-map-title', item.content);

    inboxSetSelectOptions('inbox-task-list', inboxState.destinations.task_lists || [], 'Choose a project or list');
    updateInboxTaskPhases();
    inboxSetSelectOptions('inbox-note-target', inboxState.destinations.notes || [], 'Choose a note');
    inboxSetSelectOptions('inbox-note-list-target', inboxState.destinations.note_lists || [], 'Choose a Notes list');
    updateInboxNoteListSections();
    inboxSetSelectOptions('inbox-area-line-target', inboxState.destinations.areas || [], 'Choose an area');
    inboxSetSelectOptions('inbox-area-note-target', inboxState.destinations.area_notes || [], 'Choose an Area note');
    inboxSetSelectOptions('inbox-area-list-target', inboxState.destinations.area_lists || [], 'Choose an Area list');
    updateInboxAreaListSections();
    inboxSetSelectOptions('inbox-area-task-target', inboxState.destinations.area_task_lists || [], 'Choose an Area task list');

    inboxFillValue('inbox-task-description', '');
    inboxFillValue('inbox-task-notes', '');
    inboxFillValue('inbox-task-tags', '');
    inboxFillValue('inbox-task-date', '');
    inboxFillValue('inbox-task-start', '');
    inboxFillValue('inbox-task-end', '');

    inboxFillValue('inbox-calendar-date', '');
    inboxFillValue('inbox-calendar-start', '');
    inboxFillValue('inbox-calendar-end', '');
    document.getElementById('inbox-calendar-event').checked = false;

    inboxFillValue('inbox-note-list-note', '');
    inboxFillValue('inbox-note-list-date', '');
    inboxFillValue('inbox-note-list-start', '');
    inboxFillValue('inbox-note-list-end', '');
    inboxFillValue('inbox-area-task-description', '');
    inboxFillValue('inbox-area-task-notes', '');
    inboxFillValue('inbox-area-task-date', '');
    inboxFillValue('inbox-area-list-note', '');
    inboxFillValue('inbox-area-list-date', '');

    inboxFillValue('inbox-task-reminder', '');
    inboxFillValue('inbox-calendar-reminder', '');
    inboxFillValue('inbox-note-list-reminder', '');
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
    const title = document.getElementById('inbox-map-title').value;
    if (kind === 'task') {
        return {
            kind,
            list_id: inboxNullableNumber(document.getElementById('inbox-task-list').value),
            phase_id: inboxNullableNumber(document.getElementById('inbox-task-phase').value),
            title,
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
            title,
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
            text: title
        };
    }
    if (kind === 'note_list') {
        return {
            kind,
            note_id: inboxNullableNumber(document.getElementById('inbox-note-list-target').value),
            section_id: inboxNullableNumber(document.getElementById('inbox-note-list-section').value),
            subsection_id: inboxNullableNumber(document.getElementById('inbox-note-list-subsection').value),
            text: title,
            note: document.getElementById('inbox-note-list-note').value,
            scheduled_date: document.getElementById('inbox-note-list-date').value,
            start_time: document.getElementById('inbox-note-list-start').value,
            end_time: document.getElementById('inbox-note-list-end').value,
            reminder_minutes_before: document.getElementById('inbox-note-list-reminder').value
        };
    }
    if (kind === 'area_line') {
        return {
            kind,
            area_id: inboxNullableNumber(document.getElementById('inbox-area-line-target').value),
            text: title
        };
    }
    if (kind === 'area_note') {
        return {
            kind,
            block_id: inboxNullableNumber(document.getElementById('inbox-area-note-target').value),
            text: title
        };
    }
    if (kind === 'area_list') {
        return {
            kind,
            block_id: inboxNullableNumber(document.getElementById('inbox-area-list-target').value),
            section_id: inboxNullableNumber(document.getElementById('inbox-area-list-section').value),
            subsection_id: inboxNullableNumber(document.getElementById('inbox-area-list-subsection').value),
            text: title,
            note: document.getElementById('inbox-area-list-note').value,
            scheduled_date: document.getElementById('inbox-area-list-date').value
        };
    }
    return {
        kind,
        block_id: inboxNullableNumber(document.getElementById('inbox-area-task-target').value),
        title,
        description: document.getElementById('inbox-area-task-description').value,
        notes: document.getElementById('inbox-area-task-notes').value,
        due_date: document.getElementById('inbox-area-task-date').value
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
    document.getElementById('inbox-area-list-target')?.addEventListener('change', () => updateInboxAreaListSections());
    document.getElementById('inbox-area-list-section')?.addEventListener('change', () => updateInboxAreaListSubsections());
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
