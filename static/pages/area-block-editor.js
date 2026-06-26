(function () {
    const page = document.getElementById('area-block-editor-page');
    if (!page) return;

    const state = {
        areaId: Number(page.dataset.areaId),
        blockId: Number(page.dataset.blockId),
        blockType: page.dataset.blockType || 'note',
        block: null,
        area: null,
        workspaceBlocks: [],
        dirty: false,
        saving: false,
        rowModalType: 'item',
        rowModalId: null,
        innerNoteItemId: null,
        rowDrag: {
            sourceId: null,
            targetId: null,
            dropPosition: null,
        },
    };

    const typeMeta = {
        note: { label: 'Area note', fallback: 'Untitled note' },
        list: { label: 'Area list', fallback: 'Untitled list' },
        task_list: { label: 'Area task list', fallback: 'Task list' },
    };

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    function notify(message, type = 'info') {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
        } else if (type === 'error') {
            console.error(message);
        }
    }

    function el(tag, className = '', text = '') {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    function icon(className) {
        const node = document.createElement('i');
        node.className = className;
        return node;
    }

    async function api(url, options = {}) {
        const requestOptions = {
            method: options.method || 'GET',
            headers: {
                Accept: 'application/json',
                ...(options.headers || {}),
            },
        };
        if (Object.prototype.hasOwnProperty.call(options, 'payload')) {
            requestOptions.headers['Content-Type'] = 'application/json';
            requestOptions.body = JSON.stringify(options.payload);
        }
        const response = await fetch(url, requestOptions);
        if (response.status === 204) return null;
        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json') ? await response.json() : null;
        if (!response.ok) {
            throw new Error((data && data.error) || `Request failed with ${response.status}`);
        }
        return data;
    }

    function blockTitle(block = state.block) {
        if (!block) return '';
        const meta = typeMeta[block.block_type] || typeMeta.note;
        return block.title || meta.fallback;
    }

    function itemTitle(item) {
        return item.link_text || item.text || item.linked_block_title || 'Untitled';
    }

    function formatUpdated(value) {
        if (!value) return 'Saved';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Saved';
        return `Saved ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
    }

    function setDirty(next = true) {
        state.dirty = !!next;
        const saveBtn = $('#area-editor-save-btn');
        if (saveBtn) saveBtn.disabled = state.saving;
    }

    function setUpdatedLabel(text) {
        ['area-editor-updated-label', 'area-list-updated-label', 'area-task-updated-label'].forEach((id) => {
            const node = document.getElementById(id);
            if (node) node.textContent = text;
        });
    }

    function showOnlyPanel(panelId) {
        ['area-note-panel', 'area-list-panel', 'area-task-panel'].forEach((id) => {
            const node = document.getElementById(id);
            if (node) node.hidden = id !== panelId;
        });
        page.dataset.editorMode = state.blockType;
    }

    function titleInputForType() {
        if (state.blockType === 'note') return $('#area-block-title');
        if (state.blockType === 'task_list') return $('#area-task-title');
        return $('#area-list-title');
    }

    async function loadWorkspaceBlocks() {
        try {
            const workspace = await api(`/api/areas/${state.areaId}/workspace`);
            state.area = workspace.area || null;
            state.workspaceBlocks = (workspace.blocks || []).filter((block) => block.id !== state.blockId);
        } catch (_) {
            state.area = null;
            state.workspaceBlocks = [];
        }
    }

    async function loadBlock() {
        state.block = await api(`/api/area-blocks/${state.blockId}`);
        state.blockType = state.block.block_type;
        await loadWorkspaceBlocks();
        render();
    }

    async function saveBlock({ closeAfter = false } = {}) {
        if (!state.block || state.saving) return;
        const titleInput = titleInputForType();
        const meta = typeMeta[state.blockType] || typeMeta.note;
        const payload = {
            title: titleInput ? (titleInput.value.trim() || meta.fallback) : meta.fallback,
        };

        if (state.blockType === 'note') {
            const editor = $('#area-note-editor');
            const rawContent = editor ? (editor.innerHTML || '').trim() : '';
            const markdown = window.NoteMarkdown;
            payload.content = markdown && typeof markdown.normalizeNoteEditorHtml === 'function'
                ? markdown.normalizeNoteEditorHtml(rawContent)
                : rawContent;
        }

        try {
            state.saving = true;
            const saved = await api(`/api/area-blocks/${state.blockId}`, {
                method: 'PUT',
                payload,
            });
            state.block = saved;
            setDirty(false);
            setUpdatedLabel(formatUpdated(saved.updated_at));
            if (closeAfter) window.location.href = `/areas/${state.areaId}`;
        } catch (error) {
            notify(error.message || 'Could not save', 'error');
        } finally {
            state.saving = false;
            setDirty(state.dirty);
        }
    }

    async function saveBeforeLeaving() {
        if (state.dirty) await saveBlock();
        window.location.href = `/areas/${state.areaId}`;
    }

    function render() {
        if (!state.block) return;
        const meta = typeMeta[state.blockType] || typeMeta.note;
        $('#area-editor-heading').textContent = meta.label;
        renderAreaBubble();
        setUpdatedLabel(formatUpdated(state.block.updated_at));

        if (state.blockType === 'note') {
            showOnlyPanel('area-note-panel');
            renderNoteEditor();
        } else if (state.blockType === 'task_list') {
            showOnlyPanel('area-task-panel');
            renderTaskEditor();
        } else {
            showOnlyPanel('area-list-panel');
            renderListEditor();
        }
        setDirty(false);
    }

    function renderAreaBubble() {
        const bubble = $('#area-editor-area-bubble');
        if (!bubble) return;
        const label = bubble.querySelector('span');
        if (label) label.textContent = state.area?.name || 'Area';
        bubble.href = `/areas/${state.areaId}`;
        bubble.hidden = false;
    }

    function renderNoteEditor() {
        const titleInput = $('#area-block-title');
        const editor = $('#area-note-editor');
        if (titleInput) titleInput.value = blockTitle();
        if (!editor) return;
        const markdown = window.NoteMarkdown;
        editor.innerHTML = markdown && typeof markdown.renderNoteContentForEditor === 'function'
            ? markdown.renderNoteContentForEditor(state.block.content || '')
            : (state.block.content || '');
        bindEditorCheckboxes(editor);
    }

    function sortedItems() {
        return [...(state.block?.items || [])]
            .sort((a, b) => (a.order_index || 0) - (b.order_index || 0) || a.id - b.id);
    }

    function renderListEditor() {
        const titleInput = $('#area-list-title');
        if (titleInput) titleInput.value = blockTitle();
        renderRows($('#area-list-stack'), sortedItems(), 'list');
    }

    function renderTaskEditor() {
        const titleInput = $('#area-task-title');
        if (titleInput) titleInput.value = blockTitle();
        renderRows($('#area-task-stack'), sortedItems(), 'task');
    }

    function renderRows(stack, items, mode) {
        if (!stack) return;
        stack.innerHTML = '';
        if (!items.length) {
            const empty = el('div', 'area-editor-empty');
            empty.appendChild(icon(mode === 'task' ? 'fa-solid fa-list-check' : 'fa-solid fa-list-ul'));
            empty.appendChild(el('span', '', mode === 'task' ? 'No tasks yet.' : 'No list items yet.'));
            stack.appendChild(empty);
            return;
        }
        items.forEach((item) => {
            stack.appendChild(mode === 'task' ? buildTaskRow(item) : buildListRow(item));
        });
    }

    function clearRowDropIndicators() {
        $$('.area-editor-row.row-dragging, .area-editor-row.row-drop-before, .area-editor-row.row-drop-after').forEach((row) => {
            row.classList.remove('row-dragging', 'row-drop-before', 'row-drop-after');
        });
    }

    function resetRowDragState() {
        state.rowDrag = {
            sourceId: null,
            targetId: null,
            dropPosition: null,
        };
        clearRowDropIndicators();
        document.body.classList.remove('area-row-dragging');
    }

    function markRowDropTarget(itemId, dropPosition) {
        $$('.area-editor-row.row-drop-before, .area-editor-row.row-drop-after').forEach((row) => {
            row.classList.remove('row-drop-before', 'row-drop-after');
        });
        const target = document.querySelector(`.area-editor-row[data-item-id="${itemId}"]`);
        if (!target) return;
        target.classList.add(dropPosition === 'after' ? 'row-drop-after' : 'row-drop-before');
    }

    function moveItemId(ids, sourceId, targetId, dropPosition) {
        const next = ids.filter((id) => Number(id) !== Number(sourceId));
        const targetIndex = next.findIndex((id) => Number(id) === Number(targetId));
        if (targetIndex === -1) return ids;
        next.splice(targetIndex + (dropPosition === 'after' ? 1 : 0), 0, sourceId);
        return next;
    }

    function reorderEndpoint() {
        if (state.blockType === 'task_list') return `/api/area-task-blocks/${state.blockId}/reorder`;
        return `/api/area-list-blocks/${state.blockId}/list-items/reorder`;
    }

    async function persistRowOrder(orderedIds) {
        const itemMap = new Map((state.block.items || []).map((item) => [Number(item.id), item]));
        state.block.items = orderedIds
            .map((id, index) => {
                const item = itemMap.get(Number(id));
                if (item) item.order_index = index + 1;
                return item;
            })
            .filter(Boolean);
        if (state.blockType === 'task_list') renderTaskEditor();
        else renderListEditor();

        try {
            await api(reorderEndpoint(), {
                method: 'POST',
                payload: { ids: orderedIds },
            });
        } catch (error) {
            notify(error.message || 'Could not reorder rows', 'error');
            await loadBlock();
        }
    }

    function attachRowDropEvents(row, item) {
        row.dataset.itemId = String(item.id);
        row.addEventListener('dragover', (event) => {
            const sourceId = state.rowDrag.sourceId;
            if (!sourceId || sourceId === item.id) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            const rect = row.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const dropPosition = event.clientY >= midpoint ? 'after' : 'before';
            if (state.rowDrag.targetId !== item.id || state.rowDrag.dropPosition !== dropPosition) {
                state.rowDrag.targetId = item.id;
                state.rowDrag.dropPosition = dropPosition;
                markRowDropTarget(item.id, dropPosition);
            }
        });
        row.addEventListener('dragleave', (event) => {
            const related = event.relatedTarget;
            if (related && row.contains(related)) return;
            if (state.rowDrag.targetId === item.id) {
                state.rowDrag.targetId = null;
                state.rowDrag.dropPosition = null;
                clearRowDropIndicators();
                const source = document.querySelector(`.area-editor-row[data-item-id="${state.rowDrag.sourceId}"]`);
                if (source) source.classList.add('row-dragging');
            }
        });
        row.addEventListener('drop', async (event) => {
            const sourceId = state.rowDrag.sourceId;
            if (!sourceId || sourceId === item.id) return;
            event.preventDefault();
            const currentIds = sortedItems().map((entry) => entry.id);
            const orderedIds = moveItemId(currentIds, sourceId, item.id, state.rowDrag.dropPosition || 'before');
            resetRowDragState();
            if (orderedIds.join(',') === currentIds.join(',')) return;
            await persistRowOrder(orderedIds);
        });
    }

    function buildRowDragHandle(item) {
        const handle = el('button', 'area-editor-row-drag');
        handle.type = 'button';
        handle.title = 'Drag to reorder';
        handle.draggable = true;
        handle.appendChild(icon('fa-solid fa-grip-vertical'));
        handle.addEventListener('dragstart', (event) => {
            state.rowDrag.sourceId = item.id;
            state.rowDrag.targetId = null;
            state.rowDrag.dropPosition = null;
            document.body.classList.add('area-row-dragging');
            const row = event.currentTarget.closest('.area-editor-row');
            if (row) row.classList.add('row-dragging');
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', String(item.id));
            }
        });
        handle.addEventListener('dragend', resetRowDragState);
        return handle;
    }

    function buildListRow(item) {
        const type = item.item_type || 'item';
        if (type === 'section') return buildSectionRow(item, false);
        if (type === 'subsection') return buildSectionRow(item, true);
        if (type === 'linked_note' || type === 'linked_list') return buildLinkedRow(item);
        return buildListItemRow(item);
    }

    function buildSectionRow(item, isSubsection) {
        const row = el('div', `area-editor-row ${isSubsection ? 'subsection' : 'section'}`);
        attachRowDropEvents(row, item);
        row.appendChild(buildRowDragHandle(item));
        row.appendChild(icon(isSubsection ? 'fa-solid fa-turn-down' : 'fa-solid fa-layer-group'));
        row.appendChild(el('strong', 'area-editor-struct-title', item.text || (isSubsection ? 'Subsection' : 'Section')));
        row.appendChild(buildRowActions(item, { note: false, date: false, later: false }));
        return row;
    }

    function buildLinkedRow(item) {
        const row = el('div', `area-editor-row linked ${item.item_type === 'linked_note' ? 'note' : 'list'}`);
        attachRowDropEvents(row, item);
        row.appendChild(buildRowDragHandle(item));
        const link = el('a', 'area-editor-linked-main');
        link.href = item.linked_block_id ? `/areas/${state.areaId}/blocks/${item.linked_block_id}` : '#';
        if (!item.linked_block_id) link.addEventListener('click', (event) => event.preventDefault());
        link.appendChild(icon(item.item_type === 'linked_note' ? 'fa-regular fa-note-sticky' : 'fa-solid fa-list-ul'));
        const copy = el('span');
        copy.appendChild(el('strong', '', itemTitle(item)));
        copy.appendChild(el('small', '', item.item_type === 'linked_note' ? 'Area note' : 'Area list'));
        link.appendChild(copy);
        row.appendChild(link);
        row.appendChild(buildRowActions(item, { note: false, date: false, later: false }));
        return row;
    }

    function buildListItemRow(item) {
        const done = item.status === 'done' || item.checked;
        const row = el('div', `area-editor-row item list-item${done ? ' done' : ''}`);
        attachRowDropEvents(row, item);
        row.appendChild(buildRowDragHandle(item));
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = done;
        checkbox.addEventListener('change', () => updateItem(item.id, { checked: checkbox.checked }));
        row.appendChild(checkbox);
        row.appendChild(buildEditableRowMain(item));
        row.appendChild(buildRowActions(item, { note: true, date: false, later: false }));
        return row;
    }

    function buildTaskRow(item) {
        const done = item.status === 'done' || item.checked;
        const row = el('div', `area-editor-row item task-item${done ? ' done' : ''}`);
        attachRowDropEvents(row, item);
        row.appendChild(buildRowDragHandle(item));
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = done;
        checkbox.addEventListener('change', () => updateItem(item.id, { status: checkbox.checked ? 'done' : 'open' }));
        row.appendChild(checkbox);
        row.appendChild(buildEditableRowMain(item));
        row.appendChild(buildRowActions(item, { note: true, date: true, later: true }));
        return row;
    }

    function buildEditableRowMain(item) {
        const main = el('div', 'area-editor-row-main');
        const title = document.createElement('input');
        title.type = 'text';
        title.className = 'area-editor-row-title';
        title.value = item.text || '';
        title.addEventListener('blur', () => {
            const value = title.value.trim();
            if (!value) {
                title.value = item.text || '';
                return;
            }
            if (value !== item.text) updateItem(item.id, { text: value });
        });
        title.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') title.blur();
        });
        main.appendChild(title);

        const meta = el('div', 'area-editor-row-meta');
        if (item.scheduled_date) meta.appendChild(el('span', 'area-editor-chip', item.scheduled_date));
        if (item.details) meta.appendChild(el('span', 'area-editor-chip muted', item.details));
        if (item.inner_note) {
            const noteChip = el('button', 'area-editor-chip', 'Note');
            noteChip.type = 'button';
            noteChip.addEventListener('click', () => openInnerNoteModal(item));
            meta.appendChild(noteChip);
        }
        if (item.status === 'later') meta.appendChild(el('span', 'area-editor-chip muted', 'Later'));
        if (meta.childNodes.length) main.appendChild(meta);
        return main;
    }

    function buildRowActions(item, options) {
        const actions = el('div', 'area-editor-row-actions');
        if (options.later) {
            const laterBtn = el('button', `area-icon-btn${item.status === 'later' ? ' active' : ''}`);
            laterBtn.type = 'button';
            laterBtn.title = 'Later';
            laterBtn.appendChild(icon('fa-regular fa-clock'));
            laterBtn.addEventListener('click', () => updateItem(item.id, { status: item.status === 'later' ? 'open' : 'later' }));
            actions.appendChild(laterBtn);
        }
        if (options.note) {
            const noteBtn = el('button', 'area-icon-btn');
            noteBtn.type = 'button';
            noteBtn.title = 'Row note';
            noteBtn.appendChild(icon('fa-regular fa-note-sticky'));
            noteBtn.addEventListener('click', () => openInnerNoteModal(item));
            actions.appendChild(noteBtn);
        }
        const editBtn = el('button', 'area-icon-btn');
        editBtn.type = 'button';
        editBtn.title = 'Edit';
        editBtn.appendChild(icon(options.date ? 'fa-solid fa-pen-to-square' : 'fa-solid fa-pen'));
        editBtn.addEventListener('click', () => openRowModal(item.item_type || 'item', item));
        actions.appendChild(editBtn);

        const deleteBtn = el('button', 'area-icon-btn danger');
        deleteBtn.type = 'button';
        deleteBtn.title = 'Delete';
        deleteBtn.appendChild(icon('fa-solid fa-trash'));
        deleteBtn.addEventListener('click', () => deleteItem(item.id));
        actions.appendChild(deleteBtn);
        return actions;
    }

    async function addItem(text, itemType = 'item') {
        const value = String(text || '').trim();
        if (!value) return;
        try {
            const saved = await api(`/api/area-blocks/${state.blockId}/items`, {
                method: 'POST',
                payload: { item_type: itemType, text: value },
            });
            state.block.items = [...(state.block.items || []), saved];
            state.block.item_count = (state.block.item_count || 0) + 1;
            if (state.blockType === 'task_list') renderTaskEditor();
            else renderListEditor();
        } catch (error) {
            notify(error.message || 'Could not add item', 'error');
        }
    }

    async function updateItem(itemId, payload) {
        try {
            const updated = await api(`/api/area-block-items/${itemId}`, {
                method: 'PUT',
                payload,
            });
            const index = (state.block.items || []).findIndex((item) => item.id === itemId);
            if (index !== -1) state.block.items[index] = updated;
            if (state.blockType === 'task_list') renderTaskEditor();
            else renderListEditor();
        } catch (error) {
            notify(error.message || 'Could not update item', 'error');
        }
    }

    async function deleteItem(itemId) {
        if (!window.confirm('Delete this item?')) return;
        try {
            await api(`/api/area-block-items/${itemId}`, { method: 'DELETE' });
            state.block.items = (state.block.items || []).filter((item) => item.id !== itemId);
            if (state.blockType === 'task_list') renderTaskEditor();
            else renderListEditor();
        } catch (error) {
            notify(error.message || 'Could not delete item', 'error');
        }
    }

    function rowTypeLabel(type) {
        return {
            item: state.blockType === 'task_list' ? 'Task' : 'List item',
            section: 'Section',
            subsection: 'Subsection',
            linked_note: 'Linked note',
            linked_list: 'Linked list',
        }[type] || 'Item';
    }

    function openRowModal(type, item = null) {
        state.rowModalType = type;
        state.rowModalId = item ? item.id : null;
        const isLinked = type === 'linked_note' || type === 'linked_list';
        const isStructural = type === 'section' || type === 'subsection';
        const targetGroup = $('#area-row-target-group');
        const detailsGroup = $('#area-row-details-group');
        const dateGroup = $('#area-row-date-group');

        $('#area-row-modal-title').textContent = `${item ? 'Edit' : 'Add'} ${rowTypeLabel(type).toLowerCase()}`;
        $('#area-row-text').value = item ? itemTitle(item) : '';
        $('#area-row-text').placeholder = isLinked ? 'Title, or leave blank to use the target title' : 'Title';
        $('#area-row-details').value = item ? item.details || '' : '';
        $('#area-row-date').value = item ? item.scheduled_date || '' : '';
        if (targetGroup) targetGroup.hidden = !isLinked;
        if (detailsGroup) detailsGroup.hidden = isLinked || isStructural;
        if (dateGroup) dateGroup.hidden = state.blockType !== 'task_list' || isLinked || isStructural;
        if (isLinked) populateLinkedTargetSelect($('#area-row-target'), type, item);
        openModal('area-row-modal');
        setTimeout(() => $('#area-row-text')?.focus(), 20);
    }

    function populateLinkedTargetSelect(select, type, item = null) {
        if (!select) return;
        select.innerHTML = '';
        const createOption = document.createElement('option');
        createOption.value = '';
        createOption.textContent = type === 'linked_note' ? 'Create new Area note' : 'Create new Area list';
        select.appendChild(createOption);

        const acceptedTypes = type === 'linked_note' ? ['note'] : ['list', 'task_list'];
        state.workspaceBlocks
            .filter((block) => acceptedTypes.includes(block.block_type))
            .sort((a, b) => blockTitle(a).localeCompare(blockTitle(b)))
            .forEach((block) => {
                const option = document.createElement('option');
                option.value = String(block.id);
                option.textContent = blockTitle(block);
                select.appendChild(option);
            });
        if (item && item.linked_block_id) select.value = String(item.linked_block_id);
    }

    async function saveRowModal() {
        const type = state.rowModalType;
        const textInput = $('#area-row-text');
        const target = $('#area-row-target');
        let linkedBlockId = target && target.value ? Number(target.value) : null;
        const text = textInput ? textInput.value.trim() : '';

        try {
            if (!state.rowModalId && (type === 'linked_note' || type === 'linked_list') && !linkedBlockId) {
                if (!text) {
                    notify('Title is required', 'warning');
                    return;
                }
                const newBlock = await api(`/api/areas/${state.areaId}/blocks`, {
                    method: 'POST',
                    payload: {
                        block_type: type === 'linked_note' ? 'note' : 'list',
                        title: text,
                    },
                });
                linkedBlockId = newBlock.id;
                state.workspaceBlocks.push(newBlock);
            }

            const payload = {
                item_type: type,
                text,
            };

            if (type === 'section' && !payload.text) payload.text = 'Section';
            if (type === 'subsection' && !payload.text) payload.text = 'Subsection';
            if (type === 'linked_note' || type === 'linked_list') {
                payload.linked_block_id = linkedBlockId;
                payload.link_text = text || null;
                if (!payload.text && linkedBlockId) {
                    const linked = state.workspaceBlocks.find((block) => block.id === linkedBlockId);
                    payload.text = linked ? blockTitle(linked) : rowTypeLabel(type);
                }
            }
            if (type === 'item') {
                if (!payload.text) {
                    notify('Title is required', 'warning');
                    return;
                }
                payload.details = $('#area-row-details').value.trim() || null;
                if (state.blockType === 'task_list') payload.scheduled_date = $('#area-row-date').value || null;
            }

            const saved = state.rowModalId
                ? await api(`/api/area-block-items/${state.rowModalId}`, { method: 'PUT', payload })
                : await api(`/api/area-blocks/${state.blockId}/items`, { method: 'POST', payload });

            if (state.rowModalId) {
                const index = (state.block.items || []).findIndex((item) => item.id === state.rowModalId);
                if (index !== -1) state.block.items[index] = saved;
            } else {
                state.block.items = [...(state.block.items || []), saved];
            }
            closeModal('area-row-modal');
            if (state.blockType === 'task_list') renderTaskEditor();
            else renderListEditor();
        } catch (error) {
            notify(error.message || 'Could not save item', 'error');
        }
    }

    function openInnerNoteModal(item) {
        state.innerNoteItemId = item.id;
        const editor = $('#area-inner-note-editor');
        const markdown = window.NoteMarkdown;
        if (editor) {
            editor.innerHTML = markdown && typeof markdown.renderNoteContentForEditor === 'function'
                ? markdown.renderNoteContentForEditor(item.inner_note || '')
                : (item.inner_note || '');
        }
        openModal('area-inner-note-modal');
        setTimeout(() => editor?.focus(), 20);
    }

    async function saveInnerNote() {
        if (!state.innerNoteItemId) return;
        const editor = $('#area-inner-note-editor');
        const markdown = window.NoteMarkdown;
        const raw = editor ? (editor.innerHTML || '').trim() : '';
        const innerNote = markdown && typeof markdown.normalizeNoteEditorHtml === 'function'
            ? markdown.normalizeNoteEditorHtml(raw)
            : raw;
        await updateItem(state.innerNoteItemId, { inner_note: innerNote || null });
        closeModal('area-inner-note-modal');
        state.innerNoteItemId = null;
    }

    function clearInnerNote() {
        const editor = $('#area-inner-note-editor');
        if (editor) editor.innerHTML = '';
    }

    function openModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('active');
    }

    function closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.remove('active');
    }

    function focusEditable(editor) {
        if (!editor) return;
        editor.focus();
        const selection = window.getSelection();
        if (!selection) return;
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function applyRichCommand(command, editor) {
        if (!editor) return;
        focusEditable(editor);
        if (command === 'checkbox') {
            document.execCommand('insertHTML', false, '<span class="note-inline-checkbox"><input type="checkbox"> </span>');
        } else if (command === 'quote') {
            document.execCommand('formatBlock', false, 'blockquote');
        } else if (command === 'code') {
            document.execCommand('formatBlock', false, 'pre');
        } else {
            document.execCommand(command, false, null);
        }
        bindEditorCheckboxes(editor);
        setDirty(true);
    }

    function bindEditorCheckboxes(editor) {
        if (!editor) return;
        editor.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
            if (checkbox.dataset.areaBound === '1') return;
            checkbox.dataset.areaBound = '1';
            checkbox.addEventListener('change', () => setDirty(true));
        });
    }

    function bindEvents() {
        $('#area-editor-back-btn')?.addEventListener('click', saveBeforeLeaving);
        $('#area-editor-save-btn')?.addEventListener('click', () => saveBlock());
        $('#area-block-title')?.addEventListener('input', () => setDirty(true));
        $('#area-list-title')?.addEventListener('input', () => setDirty(true));
        $('#area-task-title')?.addEventListener('input', () => setDirty(true));

        $('#area-list-add-row-form')?.addEventListener('submit', (event) => {
            event.preventDefault();
            const input = $('#area-list-new-item');
            const text = input ? input.value.trim() : '';
            if (!text) return;
            input.value = '';
            addItem(text, 'item');
        });
        $('#area-task-add-row-form')?.addEventListener('submit', (event) => {
            event.preventDefault();
            const input = $('#area-task-new-item');
            const text = input ? input.value.trim() : '';
            if (!text) return;
            input.value = '';
            addItem(text, 'item');
        });
        $('#area-list-add-section-btn')?.addEventListener('click', () => openRowModal('section'));
        $('#area-list-add-subsection-btn')?.addEventListener('click', () => openRowModal('subsection'));
        $('#area-list-link-note-btn')?.addEventListener('click', () => openRowModal('linked_note'));
        $('#area-list-link-list-btn')?.addEventListener('click', () => openRowModal('linked_list'));

        const noteEditor = $('#area-note-editor');
        if (noteEditor) {
            noteEditor.addEventListener('input', (event) => {
                const markdown = window.NoteMarkdown;
                let converted = false;
                if (markdown && typeof markdown.tryConvertBlockMarkdownAtSelection === 'function') {
                    converted = markdown.tryConvertBlockMarkdownAtSelection(noteEditor, event) || converted;
                }
                if (markdown && typeof markdown.tryConvertInlineMarkdownAtSelection === 'function') {
                    converted = markdown.tryConvertInlineMarkdownAtSelection(noteEditor, event) || converted;
                }
                if (converted) bindEditorCheckboxes(noteEditor);
                setDirty(true);
            });
            noteEditor.addEventListener('paste', (event) => {
                const clipboard = event.clipboardData || window.clipboardData;
                const text = clipboard ? clipboard.getData('text/plain') : '';
                const markdown = window.NoteMarkdown;
                if (!text || !markdown || typeof markdown.shouldConvertPastedMarkdown !== 'function') return;
                if (!markdown.shouldConvertPastedMarkdown(text)) return;
                const html = typeof markdown.markdownToHtml === 'function' ? markdown.markdownToHtml(text) : '';
                if (!html) return;
                event.preventDefault();
                document.execCommand('insertHTML', false, html);
                bindEditorCheckboxes(noteEditor);
                setDirty(true);
            });
        }

        $('#area-note-toolbar')?.addEventListener('mousedown', (event) => {
            if (event.target.closest('button')) event.preventDefault();
        });
        $('#area-note-toolbar')?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-area-note-command]');
            if (!button) return;
            applyRichCommand(button.dataset.areaNoteCommand, $('#area-note-editor'));
        });
        $('#area-note-font-size')?.addEventListener('change', (event) => {
            focusEditable($('#area-note-editor'));
            document.execCommand('fontSize', false, '3');
            $$('#area-note-editor font[size="3"]').forEach((font) => {
                font.removeAttribute('size');
                font.style.fontSize = `${event.target.value}px`;
            });
            setDirty(true);
        });

        $('#area-row-save-btn')?.addEventListener('click', saveRowModal);
        $('#area-row-cancel-btn')?.addEventListener('click', () => closeModal('area-row-modal'));
        $('#area-row-text')?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                saveRowModal();
            }
        });
        $('#area-inner-note-save-btn')?.addEventListener('click', saveInnerNote);
        $('#area-inner-note-cancel-btn')?.addEventListener('click', () => closeModal('area-inner-note-modal'));
        $('#area-inner-note-clear-btn')?.addEventListener('click', clearInnerNote);
        $('#area-inner-note-toolbar')?.addEventListener('mousedown', (event) => {
            if (event.target.closest('button')) event.preventDefault();
        });
        $('#area-inner-note-toolbar')?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-area-inner-command]');
            if (!button) return;
            applyRichCommand(button.dataset.areaInnerCommand, $('#area-inner-note-editor'));
        });

        ['area-row-modal', 'area-inner-note-modal'].forEach((id) => {
            const modal = document.getElementById(id);
            if (!modal) return;
            modal.addEventListener('click', (event) => {
                if (event.target === modal) closeModal(id);
            });
        });

        window.addEventListener('beforeunload', (event) => {
            if (!state.dirty) return;
            event.preventDefault();
            event.returnValue = '';
        });
    }

    bindEvents();
    loadBlock().catch((error) => {
        notify(error.message || 'Could not load item', 'error');
    });
})();
