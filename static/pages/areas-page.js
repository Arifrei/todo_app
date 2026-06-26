(function () {
    const page = document.getElementById('areas-page');
    if (!page) return;

    const state = {
        areaId: page.dataset.areaId ? Number(page.dataset.areaId) : null,
        area: null,
        areas: [],
        sections: [],
        blocks: [],
        legacyItems: [],
        archivedFilter: '0',
        workspaceFilter: 'all',
        modalAreaId: null,
        sectionModalId: null,
        blockModalId: null,
        blockModalType: 'line',
        detailBlockId: null,
        moveBlockId: null,
        moveAreas: [],
        moveFolders: [],
        blockDrag: {
            sourceId: null,
            sourceType: null,
            sourceCard: null,
            originalIds: [],
            moved: false,
        },
        blockTouchDrag: {
            active: false,
            sourceId: null,
            sourceType: null,
            card: null,
            clone: null,
            offsetX: 0,
            offsetY: 0,
            originalIds: [],
            moved: false,
        },
    };

    const typeMeta = {
        line: { label: 'Line', icon: 'fa-solid fa-grip-lines', tone: 'line' },
        note: { label: 'Note', icon: 'fa-regular fa-note-sticky', tone: 'note' },
        list: { label: 'List', icon: 'fa-solid fa-list-ul', tone: 'list' },
        task_list: { label: 'Task list', icon: 'fa-solid fa-list-check', tone: 'task' },
    };

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    function notify(message, type = 'info') {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
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

    function setHidden(node, hidden) {
        if (node) node.hidden = hidden;
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

    function modal(id) {
        return document.getElementById(id);
    }

    function openModal(id) {
        const node = modal(id);
        if (!node) return;
        node.classList.add('active');
        const focusTarget = node.querySelector('input, textarea, select, button');
        if (focusTarget) setTimeout(() => focusTarget.focus(), 20);
    }

    function closeModal(id) {
        const node = modal(id);
        if (node) node.classList.remove('active');
    }

    function closeAnyModal(event) {
        if (event.target.classList && event.target.classList.contains('modal')) {
            event.target.classList.remove('active');
        }
    }

    function confirmAction(message, onConfirm) {
        if (typeof window.openConfirmModal === 'function') {
            window.openConfirmModal(message, onConfirm);
            return;
        }
        if (window.confirm(message)) onConfirm();
    }

    function areaIconMarkup() {
        const wrapper = el('span', 'area-card-icon');
        wrapper.appendChild(icon('fa-solid fa-layer-group'));
        return wrapper;
    }

    function openAreaModal(area = null) {
        state.modalAreaId = area ? area.id : null;
        $('#area-modal-title').textContent = area ? 'Edit area' : 'New area';
        $('#area-name-input').value = area ? area.name || '' : '';
        $('#area-description-input').value = area ? area.description || '' : '';
        $('#area-color-input').value = area ? area.color || '#3b82f6' : '#3b82f6';
        openModal('area-modal');
    }

    function closeAreaCardMenus(exceptMenu = null) {
        $$('.area-card-menu.open').forEach((menu) => {
            if (menu === exceptMenu) return;
            menu.classList.remove('open');
            const trigger = menu.querySelector('.area-card-menu-trigger');
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
        });
    }

    async function saveAreaFromModal() {
        const payload = {
            name: $('#area-name-input').value.trim(),
            description: $('#area-description-input').value.trim() || null,
            color: $('#area-color-input').value || '#3b82f6',
        };
        if (!payload.name) {
            notify('Area name is required', 'warning');
            return;
        }

        try {
            const saved = await api(
                state.modalAreaId ? `/api/areas/${state.modalAreaId}` : '/api/areas',
                {
                    method: state.modalAreaId ? 'PUT' : 'POST',
                    payload,
                }
            );
            closeModal('area-modal');
            notify(state.modalAreaId ? 'Area updated' : 'Area created', 'success');
            if (state.areaId) {
                state.area = saved;
                await loadWorkspace();
            } else {
                await loadAreas();
            }
        } catch (error) {
            notify(error.message || 'Could not save area', 'error');
        }
    }

    function renderAreas() {
        const grid = $('#areas-grid');
        if (!grid) return;
        grid.innerHTML = '';

        const search = ($('#area-search') && $('#area-search').value.trim().toLowerCase()) || '';
        const areas = state.areas.filter((area) => {
            if (!search) return true;
            return `${area.name || ''} ${area.description || ''}`.toLowerCase().includes(search);
        });

        if (!areas.length) {
            const empty = el('div', 'areas-empty');
            empty.innerHTML = `
                <div class="area-empty-icon"><i class="fa-solid fa-layer-group"></i></div>
                <h2>No areas found</h2>
                <p>Create an area for a responsibility, research stream, client, or long-running plan.</p>
            `;
            grid.appendChild(empty);
            return;
        }

        areas.forEach((area) => {
            const card = el('article', 'area-card');
            card.style.setProperty('--area-color', area.color || '#3b82f6');

            const link = el('a', 'area-card-link');
            link.href = `/areas/${area.id}`;
            link.appendChild(areaIconMarkup());

            const content = el('div', 'area-card-content');
            content.appendChild(el('h2', '', area.name || 'Untitled area'));
            if (area.description) content.appendChild(el('p', '', area.description));
            link.appendChild(content);
            card.appendChild(link);

            const stats = el('div', 'area-card-stats');
            stats.appendChild(el('span', '', `${area.section_count || 0} sections`));
            stats.appendChild(el('span', '', `${area.block_count || 0} blocks`));
            stats.appendChild(el('span', '', `${area.open_count || 0} open`));
            card.appendChild(stats);

            const actions = el('div', 'area-card-actions');
            const menu = el('div', 'area-card-menu');
            const menuBtn = el('button', 'area-icon-btn area-card-menu-trigger');
            menuBtn.type = 'button';
            menuBtn.title = 'Area options';
            menuBtn.setAttribute('aria-label', 'Area options');
            menuBtn.setAttribute('aria-haspopup', 'menu');
            menuBtn.setAttribute('aria-expanded', 'false');
            menuBtn.appendChild(icon('fa-solid fa-ellipsis-vertical'));
            menuBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const shouldOpen = !menu.classList.contains('open');
                closeAreaCardMenus(menu);
                menu.classList.toggle('open', shouldOpen);
                menuBtn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
            });

            const dropdown = el('div', 'area-card-dropdown');
            dropdown.setAttribute('role', 'menu');

            const editItem = el('button', 'area-card-menu-item');
            editItem.type = 'button';
            editItem.setAttribute('role', 'menuitem');
            editItem.appendChild(icon('fa-solid fa-pen'));
            editItem.appendChild(el('span', '', 'Edit'));
            editItem.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                closeAreaCardMenus();
                openAreaModal(area);
            });
            dropdown.appendChild(editItem);

            if (!area.is_archived) {
                const archiveItem = el('button', 'area-card-menu-item danger');
                archiveItem.type = 'button';
                archiveItem.setAttribute('role', 'menuitem');
                archiveItem.appendChild(icon('fa-solid fa-box-archive'));
                archiveItem.appendChild(el('span', '', 'Archive'));
                archiveItem.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    closeAreaCardMenus();
                    archiveArea(area.id);
                });
                dropdown.appendChild(archiveItem);
            }

            menu.appendChild(menuBtn);
            menu.appendChild(dropdown);
            actions.appendChild(menu);
            card.appendChild(actions);
            grid.appendChild(card);
        });
    }

    async function loadAreas() {
        try {
            state.areas = await api(`/api/areas?archived=${encodeURIComponent(state.archivedFilter)}`);
            renderAreas();
        } catch (error) {
            notify(error.message || 'Could not load areas', 'error');
        }
    }

    async function archiveArea(id) {
        confirmAction('Archive this area?', async () => {
            try {
                await api(`/api/areas/${id}`, { method: 'DELETE' });
                notify('Area archived', 'success');
                if (state.areaId) await loadWorkspace();
                else await loadAreas();
            } catch (error) {
                notify(error.message || 'Could not archive area', 'error');
            }
        });
    }

    async function restoreArea(id) {
        try {
            await api(`/api/areas/${id}/restore`, { method: 'POST' });
            notify('Area restored', 'success');
            if (state.areaId) await loadWorkspace();
            else await loadAreas();
        } catch (error) {
            notify(error.message || 'Could not restore area', 'error');
        }
    }

    function renderAreaHeader() {
        if (!state.area) return;
        if ($('#area-detail-name')) $('#area-detail-name').textContent = state.area.name || 'Area';
        if ($('#area-detail-description')) $('#area-detail-description').textContent = state.area.description || 'A place for lines, notes, lists, and task lists.';

        const iconWrap = $('#area-detail-icon');
        if (iconWrap) {
            iconWrap.style.setProperty('--area-color', state.area.color || '#3b82f6');
            iconWrap.innerHTML = '';
            iconWrap.appendChild(icon('fa-solid fa-layer-group'));
        }

        setHidden($('#area-detail-archive-btn'), !!state.area.is_archived);
    }

    function renderStats() {
        if (!state.area || !$('#area-stat-blocks')) return;
        $('#area-stat-blocks').textContent = state.area.block_count || 0;
        $('#area-stat-open').textContent = state.area.open_count || 0;
        $('#area-stat-done').textContent = state.area.done_count || 0;
    }

    function blocksForSection(sectionId) {
        return state.blocks
            .filter((block) => {
                const blockSectionId = block.section_id == null ? null : Number(block.section_id);
                return blockSectionId === sectionId;
            })
            .filter((block) => {
                if (state.workspaceFilter === 'all') return true;
                return block.block_type === state.workspaceFilter;
            })
            .sort((a, b) => (a.order_index || 0) - (b.order_index || 0) || a.id - b.id);
    }

    function blocksForType(blockType) {
        return state.blocks
            .filter((block) => block.block_type === blockType)
            .sort((a, b) => (a.order_index || 0) - (b.order_index || 0) || a.id - b.id);
    }

    function normalizedSectionId(sectionId) {
        return sectionId == null || sectionId === '' ? null : Number(sectionId);
    }

    function sectionName(sectionId) {
        const normalized = normalizedSectionId(sectionId);
        if (normalized === null) return 'Unsectioned';
        const section = state.sections.find((entry) => Number(entry.id) === normalized);
        return section ? section.title || 'Section' : 'Section';
    }

    function findBlock(blockId) {
        return state.blocks.find((block) => block.id === blockId) || null;
    }

    function replaceBlock(updated) {
        const index = state.blocks.findIndex((block) => block.id === updated.id);
        if (index !== -1) state.blocks[index] = updated;
    }

    async function updateBlock(blockId, payload) {
        try {
            const updated = await api(`/api/area-blocks/${blockId}`, {
                method: 'PUT',
                payload,
            });
            replaceBlock(updated);
            renderWorkspace();
            refreshDetailModal();
            return updated;
        } catch (error) {
            notify(error.message || 'Could not update item', 'error');
            return null;
        }
    }

    function clearBlockDropIndicators() {
        $$('.area-block-card.area-block-drop-before, .area-block-card.area-block-drop-after, .area-block-card.area-block-dragging').forEach((card) => {
            card.classList.remove('area-block-drop-before', 'area-block-drop-after', 'area-block-dragging');
        });
    }

    function resetBlockDragState() {
        if (state.blockDrag.sourceCard) {
            state.blockDrag.sourceCard.classList.remove('area-block-dragging');
        }
        state.blockDrag = {
            sourceId: null,
            sourceType: null,
            sourceCard: null,
            originalIds: [],
            moved: false,
        };
        clearBlockDropIndicators();
        document.body.classList.remove('area-block-dragging');
    }

    function resetBlockTouchState() {
        if (state.blockTouchDrag.clone) state.blockTouchDrag.clone.remove();
        if (state.blockTouchDrag.card) {
            state.blockTouchDrag.card.classList.remove('area-block-dragging');
            state.blockTouchDrag.card.style.opacity = '';
        }
        state.blockTouchDrag = {
            active: false,
            sourceId: null,
            sourceType: null,
            card: null,
            clone: null,
            offsetX: 0,
            offsetY: 0,
            originalIds: [],
            moved: false,
        };
        document.body.classList.remove('area-block-dragging');
    }

    function idsEqual(first, second) {
        if (!first || !second || first.length !== second.length) return false;
        return first.every((id, index) => Number(id) === Number(second[index]));
    }

    function blockIdsForScope(blockType) {
        return state.blocks
            .filter((block) => block.block_type === blockType)
            .sort((a, b) => (a.order_index || 0) - (b.order_index || 0) || a.id - b.id)
            .map((block) => block.id);
    }

    function blockPaneForType(blockType) {
        return document.querySelector(`.area-type-pane[data-area-pane="${blockType}"] .area-type-pane-body`);
    }

    function domBlockIdsForPane(blockType) {
        const pane = blockPaneForType(blockType);
        if (!pane) return [];
        return Array.from(pane.querySelectorAll('.area-block-card[data-block-id]'))
            .map((card) => Number(card.dataset.blockId))
            .filter((id) => Number.isInteger(id));
    }

    function getBlockInsertBefore(container, x, y, excludeCard) {
        const cards = Array.from(container.querySelectorAll('.area-block-card[data-block-id]'))
            .filter((card) => card !== excludeCard);
        for (const card of cards) {
            const rect = card.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            if (y < rect.top) return card;
            if (y >= rect.top && y <= rect.bottom && x < centerX) return card;
        }
        return null;
    }

    function moveBlockCardAtPoint(container, card, x, y) {
        if (!container || !card) return false;
        const insertBefore = getBlockInsertBefore(container, x, y, card);
        if (!insertBefore) {
            if (container.lastElementChild !== card) {
                container.appendChild(card);
                return true;
            }
            return false;
        }
        if (insertBefore !== card && insertBefore !== card.nextElementSibling) {
            container.insertBefore(card, insertBefore);
            return true;
        }
        return false;
    }

    function autoScrollBlockPane(container, y) {
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const edge = 48;
        if (y < rect.top + edge) {
            container.scrollTop -= 10;
        } else if (y > rect.bottom - edge) {
            container.scrollTop += 10;
        }
    }

    async function persistBlockOrder(blockType, orderedIds) {
        const blockMap = new Map(state.blocks.map((block) => [Number(block.id), block]));
        orderedIds.forEach((id, index) => {
            const block = blockMap.get(Number(id));
            if (block) block.order_index = index + 1;
        });
        renderWorkspace();
        try {
            await api(`/api/areas/${state.areaId}/blocks/reorder`, {
                method: 'POST',
                payload: { ids: orderedIds },
            });
        } catch (error) {
            notify(error.message || 'Could not reorder items', 'error');
            await loadWorkspace();
        }
    }

    function handleBlockDragStart(event, block) {
        const card = event.currentTarget.closest('.area-block-card');
        if (!card) return;
        state.blockDrag.sourceId = block.id;
        state.blockDrag.sourceType = block.block_type;
        state.blockDrag.sourceCard = card;
        state.blockDrag.originalIds = blockIdsForScope(block.block_type);
        state.blockDrag.moved = false;
        document.body.classList.add('area-block-dragging');
        card.classList.add('area-block-dragging');
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(block.id));
        }
    }

    async function finishBlockDrag() {
        const blockType = state.blockDrag.sourceType;
        const originalIds = [...(state.blockDrag.originalIds || [])];
        const orderedIds = blockType ? domBlockIdsForPane(blockType) : [];
        const changed = !!blockType && orderedIds.length > 0 && !idsEqual(orderedIds, originalIds);
        resetBlockDragState();
        if (changed) await persistBlockOrder(blockType, orderedIds);
    }

    function handleBlockDragEnd() {
        finishBlockDrag().catch(() => {
            notify('Could not reorder items', 'error');
            loadWorkspace();
        });
    }

    function handleBlockPaneDragOver(event, blockType) {
        if (!state.blockDrag.sourceId || state.blockDrag.sourceType !== blockType) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        const pane = event.currentTarget;
        autoScrollBlockPane(pane, event.clientY);
        if (moveBlockCardAtPoint(pane, state.blockDrag.sourceCard, event.clientX, event.clientY)) {
            state.blockDrag.moved = true;
        }
    }

    function handleBlockPaneDrop(event) {
        if (!state.blockDrag.sourceId) return;
        event.preventDefault();
    }

    function positionBlockTouchClone(touchX, touchY) {
        const drag = state.blockTouchDrag;
        if (!drag.clone) return;
        drag.clone.style.transform = `translate3d(${touchX - drag.offsetX}px, ${touchY - drag.offsetY}px, 0)`;
    }

    function handleBlockTouchStart(event, block) {
        if (!event.touches || event.touches.length !== 1 || state.blockTouchDrag.active) return;
        const card = event.currentTarget.closest('.area-block-card');
        if (!card) return;
        event.preventDefault();
        const touch = event.touches[0];
        const rect = card.getBoundingClientRect();
        const clone = card.cloneNode(true);
        clone.classList.add('area-touch-drag-clone');
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height}px`;

        state.blockTouchDrag = {
            active: true,
            sourceId: block.id,
            sourceType: block.block_type,
            card,
            clone,
            offsetX: touch.clientX - rect.left,
            offsetY: touch.clientY - rect.top,
            originalIds: blockIdsForScope(block.block_type),
            moved: false,
        };

        document.body.classList.add('area-block-dragging');
        card.classList.add('area-block-dragging');
        card.style.opacity = '0.3';
        document.body.appendChild(clone);
        positionBlockTouchClone(touch.clientX, touch.clientY);
    }

    function handleBlockTouchMove(event) {
        const drag = state.blockTouchDrag;
        if (!drag.active || !event.touches || event.touches.length !== 1) return;
        event.preventDefault();
        const touch = event.touches[0];
        positionBlockTouchClone(touch.clientX, touch.clientY);
        const pane = blockPaneForType(drag.sourceType);
        autoScrollBlockPane(pane, touch.clientY);
        if (moveBlockCardAtPoint(pane, drag.card, touch.clientX, touch.clientY)) {
            drag.moved = true;
        }
    }

    async function finishBlockTouchDrag() {
        const blockType = state.blockTouchDrag.sourceType;
        const originalIds = [...(state.blockTouchDrag.originalIds || [])];
        const orderedIds = blockType ? domBlockIdsForPane(blockType) : [];
        const changed = !!blockType && orderedIds.length > 0 && !idsEqual(orderedIds, originalIds);
        resetBlockTouchState();
        if (changed) await persistBlockOrder(blockType, orderedIds);
    }

    function handleBlockTouchEnd(event) {
        if (!state.blockTouchDrag.active) return;
        event.preventDefault();
        finishBlockTouchDrag().catch(() => {
            notify('Could not reorder items', 'error');
            loadWorkspace();
        });
    }

    function renderSectionMap() {
        const map = $('#area-section-map');
        if (!map) return;
        map.innerHTML = '';

        if (!state.sections.length) {
            map.appendChild(el('p', 'area-map-empty', 'No sections yet.'));
            return;
        }

        state.sections.forEach((section) => {
            const button = el('button', 'area-section-map-btn');
            button.type = 'button';
            button.appendChild(el('span', '', section.title));
            button.appendChild(el('strong', '', String(state.blocks.filter((block) => block.section_id === section.id).length)));
            button.addEventListener('click', () => {
                const target = document.getElementById(`area-section-${section.id}`);
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            map.appendChild(button);
        });
    }

    function blockTypeChip(blockType) {
        const meta = typeMeta[blockType] || typeMeta.line;
        const chip = el('span', `area-block-type ${meta.tone}`);
        chip.title = meta.label;
        chip.setAttribute('aria-label', meta.label);
        chip.appendChild(icon(meta.icon));
        return chip;
    }

    function replaceBlockItem(updated) {
        state.blocks.forEach((block) => {
            const index = (block.items || []).findIndex((item) => item.id === updated.id);
            if (index !== -1) block.items[index] = updated;
        });
    }

    function removeBlockItem(itemId) {
        state.blocks.forEach((block) => {
            block.items = (block.items || []).filter((item) => item.id !== itemId);
        });
    }

    async function updateBlockItem(itemId, payload) {
        try {
            const updated = await api(`/api/area-block-items/${itemId}`, {
                method: 'PUT',
                payload,
            });
            replaceBlockItem(updated);
            renderWorkspace();
            refreshDetailModal();
        } catch (error) {
            notify(error.message || 'Could not update row', 'error');
        }
    }

    async function addBlockItem(block, text) {
        if (!text) return;
        try {
            const saved = await api(`/api/area-blocks/${block.id}/items`, {
                method: 'POST',
                payload: { text },
            });
            block.items = [...(block.items || []), saved];
            renderWorkspace();
            refreshDetailModal();
        } catch (error) {
            notify(error.message || 'Could not add row', 'error');
        }
    }

    async function deleteBlockItem(itemId) {
        confirmAction('Delete this row?', async () => {
            try {
                await api(`/api/area-block-items/${itemId}`, { method: 'DELETE' });
                removeBlockItem(itemId);
                renderWorkspace();
                refreshDetailModal();
            } catch (error) {
                notify(error.message || 'Could not delete row', 'error');
            }
        });
    }

    function buildBlockItemRow(block, item) {
        const isTaskList = block.block_type === 'task_list';
        const row = el('div', `area-block-row${item.status === 'done' || item.checked ? ' done' : ''}`);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.status === 'done' || !!item.checked;
        checkbox.addEventListener('change', () => {
            const payload = isTaskList
                ? { status: checkbox.checked ? 'done' : 'open' }
                : { checked: checkbox.checked };
            updateBlockItem(item.id, payload);
        });
        row.appendChild(checkbox);

        const body = el('div', 'area-block-row-body');
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.className = 'area-row-text-input';
        textInput.value = item.text || '';
        textInput.addEventListener('blur', () => {
            const value = textInput.value.trim();
            if (value && value !== item.text) updateBlockItem(item.id, { text: value });
            if (!value) textInput.value = item.text || '';
        });
        textInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') textInput.blur();
        });
        body.appendChild(textInput);

        if (isTaskList) {
            const controls = el('div', 'area-task-row-controls');

            const laterBtn = el('button', `area-mini-chip${item.status === 'later' ? ' active' : ''}`, 'Later');
            laterBtn.type = 'button';
            laterBtn.addEventListener('click', () => {
                updateBlockItem(item.id, { status: item.status === 'later' ? 'open' : 'later' });
            });
            controls.appendChild(laterBtn);

            const dateInput = document.createElement('input');
            dateInput.type = 'date';
            dateInput.className = 'area-row-date-input';
            dateInput.value = item.scheduled_date || '';
            dateInput.addEventListener('change', () => {
                updateBlockItem(item.id, { scheduled_date: dateInput.value || null });
            });
            controls.appendChild(dateInput);
            body.appendChild(controls);

            const details = document.createElement('textarea');
            details.className = 'area-row-details-input';
            details.rows = 2;
            details.placeholder = 'Details';
            details.value = item.details || '';
            details.addEventListener('blur', () => {
                const value = details.value.trim();
                if (value !== (item.details || '')) updateBlockItem(item.id, { details: value || null });
            });
            body.appendChild(details);
        }

        row.appendChild(body);

        const deleteBtn = el('button', 'area-row-delete');
        deleteBtn.type = 'button';
        deleteBtn.title = 'Delete row';
        deleteBtn.appendChild(icon('fa-solid fa-trash'));
        deleteBtn.addEventListener('click', () => deleteBlockItem(item.id));
        row.appendChild(deleteBtn);
        return row;
    }

    function buildRowsBlock(block) {
        const rowsWrap = el('div', 'area-block-rows');
        const items = (block.items || []).sort((a, b) => (a.order_index || 0) - (b.order_index || 0) || a.id - b.id);

        if (!items.length) {
            rowsWrap.appendChild(el('p', 'area-block-empty', block.block_type === 'task_list' ? 'No tasks yet.' : 'No rows yet.'));
        } else {
            items.forEach((item) => rowsWrap.appendChild(buildBlockItemRow(block, item)));
        }

        const form = el('form', 'area-block-add-row');
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = block.block_type === 'task_list' ? 'Add task' : 'Add row';
        input.autocomplete = 'off';
        const submit = el('button', 'area-row-add-btn');
        submit.type = 'submit';
        submit.appendChild(icon('fa-solid fa-plus'));
        submit.appendChild(el('span', '', 'Add'));
        form.appendChild(input);
        form.appendChild(submit);
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            addBlockItem(block, text);
        });
        rowsWrap.appendChild(form);
        return rowsWrap;
    }

    function blockTitle(block) {
        if (block.title) return block.title;
        if (block.block_type === 'note') return 'Untitled Note';
        if (block.block_type === 'list') return 'Untitled List';
        if (block.block_type === 'task_list') return 'Task list';
        return 'Line';
    }

    function blockDisplayItemCount(block) {
        const items = block.items || [];
        if (block.block_type === 'list') {
            return items.filter((item) => (item.item_type || 'item') === 'item').length;
        }
        if (block.block_type === 'task_list') {
            return items.filter((item) => (item.item_type || 'item') === 'item').length;
        }
        return block.item_count || 0;
    }

    function buildAreaTile(block) {
        const button = el('a', 'area-object-link');
        button.href = `/areas/${state.areaId}/blocks/${block.id}`;

        const sectionBadge = el('span', 'area-block-section-badge', sectionName(block.section_id));
        button.appendChild(sectionBadge);

        const title = el('h3', 'area-block-title', blockTitle(block));
        button.appendChild(title);

        const meta = el('div', 'area-object-meta');
        if (block.block_type === 'note') {
            meta.appendChild(el('span', '', block.content ? 'Has body' : 'Empty note'));
        } else if (block.block_type === 'list') {
            meta.appendChild(el('span', '', `${blockDisplayItemCount(block)} lines`));
        } else {
            meta.appendChild(el('span', '', `${blockDisplayItemCount(block)} tasks`));
            if (block.done_count) meta.appendChild(el('span', '', `${block.done_count} done`));
        }
        button.appendChild(meta);
        return button;
    }

    function renderBlockDetailBody(block) {
        const body = $('#area-block-detail-body');
        if (!body) return;
        body.innerHTML = '';

        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'form-control area-detail-title-input';
        titleInput.value = blockTitle(block);
        titleInput.addEventListener('blur', () => {
            const title = titleInput.value.trim();
            if (title && title !== (block.title || '')) updateBlock(block.id, { title });
            if (!title) titleInput.value = blockTitle(block);
        });
        titleInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') titleInput.blur();
        });
        body.appendChild(titleInput);

        if (block.block_type === 'note') {
            const textarea = document.createElement('textarea');
            textarea.className = 'form-control area-note-body-input';
            textarea.rows = 12;
            textarea.placeholder = 'Write the note here';
            textarea.value = block.content || '';
            textarea.addEventListener('blur', () => {
                const value = textarea.value.trim();
                if (value !== (block.content || '')) updateBlock(block.id, { content: value || null });
            });
            body.appendChild(textarea);
            return;
        }

        body.appendChild(buildRowsBlock(block));
    }

    function openBlockDetailModal(block) {
        state.detailBlockId = block.id;
        $('#area-block-detail-title').textContent = blockTitle(block);
        renderBlockDetailBody(block);
        openModal('area-block-detail-modal');
    }

    function refreshDetailModal() {
        const detailModal = modal('area-block-detail-modal');
        if (!detailModal || !detailModal.classList.contains('active') || !state.detailBlockId) return;
        const block = findBlock(state.detailBlockId);
        if (!block) {
            closeModal('area-block-detail-modal');
            state.detailBlockId = null;
            return;
        }
        $('#area-block-detail-title').textContent = blockTitle(block);
        renderBlockDetailBody(block);
    }

    function buildBlockCard(block) {
        const meta = typeMeta[block.block_type] || typeMeta.line;
        const card = el('article', `area-block-card ${meta.tone}${block.block_type === 'line' ? '' : ' object-tile'}`);
        card.dataset.blockId = String(block.id);
        card.dataset.blockType = block.block_type;
        card.dataset.sectionId = normalizedSectionId(block.section_id) === null ? '' : String(block.section_id);

        const header = el('div', 'area-block-card-header');
        header.appendChild(blockTypeChip(block.block_type));

        const actions = el('div', 'area-block-actions');
        const dragHandle = el('button', 'area-icon-btn area-drag-handle');
        dragHandle.type = 'button';
        dragHandle.title = `Drag to reorder ${meta.label.toLowerCase()}s`;
        dragHandle.draggable = true;
        dragHandle.appendChild(icon('fa-solid fa-grip-vertical'));
        dragHandle.addEventListener('dragstart', (event) => handleBlockDragStart(event, block));
        dragHandle.addEventListener('dragend', handleBlockDragEnd);
        dragHandle.addEventListener('touchstart', (event) => handleBlockTouchStart(event, block), { passive: false });
        dragHandle.addEventListener('touchmove', handleBlockTouchMove, { passive: false });
        dragHandle.addEventListener('touchend', handleBlockTouchEnd);
        dragHandle.addEventListener('touchcancel', handleBlockTouchEnd);
        actions.appendChild(dragHandle);

        const moveBtn = el('button', 'area-icon-btn area-move-btn');
        moveBtn.type = 'button';
        moveBtn.title = 'Move item';
        moveBtn.appendChild(icon('fa-solid fa-arrow-right'));
        moveBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openMoveModal(block);
        });
        actions.appendChild(moveBtn);

        const deleteBtn = el('button', 'area-icon-btn danger');
        deleteBtn.type = 'button';
        deleteBtn.title = 'Delete block';
        deleteBtn.appendChild(icon('fa-solid fa-trash'));
        deleteBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            deleteBlock(block.id);
        });
        actions.appendChild(deleteBtn);
        header.appendChild(actions);
        card.appendChild(header);

        if (block.block_type === 'line') {
            const sectionBadge = el('span', 'area-block-section-badge', sectionName(block.section_id));
            card.appendChild(sectionBadge);
            const lineButton = el('button', 'area-line-content area-line-open', block.content || '');
            lineButton.type = 'button';
            lineButton.addEventListener('click', () => openBlockModal(block.block_type, block));
            card.appendChild(lineButton);
        } else if (block.block_type === 'note') {
            card.appendChild(buildAreaTile(block));
        } else {
            card.appendChild(buildAreaTile(block));
        }

        return card;
    }

    function buildSectionLane(section) {
        const sectionId = section ? section.id : null;
        const lane = el('section', 'area-section-lane');
        if (sectionId) lane.id = `area-section-${sectionId}`;

        const blocks = blocksForSection(sectionId);
        const header = el('div', 'area-section-header');
        const copy = el('div');
        copy.appendChild(el('h2', '', section ? section.title : 'Unsectioned'));
        if (section && section.description) copy.appendChild(el('p', '', section.description));
        header.appendChild(copy);

        lane.appendChild(header);

        const body = el('div', 'area-section-body');
        if (!blocks.length) {
            body.appendChild(el('p', 'area-section-empty', state.workspaceFilter === 'all' ? 'Ready for a line, note, list, or task list.' : 'No matching blocks in this section.'));
        } else {
            blocks.forEach((block) => body.appendChild(buildBlockCard(block)));
        }
        lane.appendChild(body);
        return lane;
    }

    function renderTypePane(blockType, paneId, countId) {
        const pane = document.getElementById(paneId);
        const count = document.getElementById(countId);
        if (!pane) return;
        const blocks = blocksForType(blockType);
        if (pane.dataset.areaDragInit !== 'true') {
            pane.dataset.areaDragInit = 'true';
            pane.addEventListener('dragover', (event) => handleBlockPaneDragOver(event, pane.dataset.blockType));
            pane.addEventListener('drop', handleBlockPaneDrop);
        }
        pane.dataset.blockType = blockType;
        pane.innerHTML = '';
        if (count) count.textContent = String(blocks.length);

        if (!blocks.length) {
            const empty = el('p', 'area-pane-empty', `No ${typeMeta[blockType].label.toLowerCase()}s yet.`);
            pane.appendChild(empty);
            return;
        }

        blocks.forEach((block) => pane.appendChild(buildBlockCard(block)));
    }

    function renderWorkspace() {
        renderAreaHeader();
        renderStats();
        renderSectionMap();
        renderTypePane('line', 'area-lines-pane', 'area-lines-count');
        renderTypePane('note', 'area-notes-pane', 'area-notes-count');
        renderTypePane('list', 'area-lists-pane', 'area-lists-count');
        renderTypePane('task_list', 'area-tasks-pane', 'area-tasks-count');
    }

    async function loadWorkspace() {
        try {
            const workspace = await api(`/api/areas/${state.areaId}/workspace`);
            state.area = workspace.area;
            state.sections = workspace.sections || [];
            state.blocks = workspace.blocks || [];
            state.legacyItems = workspace.legacy_items || [];
            renderWorkspace();
        } catch (error) {
            notify(error.message || 'Could not load area', 'error');
        }
    }

    function openSectionModal(section = null) {
        state.sectionModalId = section ? section.id : null;
        $('#area-section-modal-title').textContent = section ? 'Edit section' : 'Add section';
        $('#area-section-title-input').value = section ? section.title || '' : '';
        $('#area-section-description-input').value = section ? section.description || '' : '';
        openModal('area-section-modal');
    }

    async function saveSectionFromModal() {
        const payload = {
            title: $('#area-section-title-input').value.trim(),
            description: $('#area-section-description-input').value.trim() || null,
        };
        if (!payload.title) {
            notify('Section name is required', 'warning');
            return;
        }

        try {
            await api(
                state.sectionModalId
                    ? `/api/area-sections/${state.sectionModalId}`
                    : `/api/areas/${state.areaId}/sections`,
                {
                    method: state.sectionModalId ? 'PUT' : 'POST',
                    payload,
                }
            );
            closeModal('area-section-modal');
            await loadWorkspace();
        } catch (error) {
            notify(error.message || 'Could not save section', 'error');
        }
    }

    function fillSectionSelect(selectedSectionId) {
        const select = $('#area-block-section-select');
        if (!select) return;
        select.innerHTML = '';

        const unsectioned = document.createElement('option');
        unsectioned.value = '';
        unsectioned.textContent = 'Unsectioned';
        select.appendChild(unsectioned);

        state.sections.forEach((section) => {
            const option = document.createElement('option');
            option.value = String(section.id);
            option.textContent = section.title;
            select.appendChild(option);
        });
        select.value = selectedSectionId ? String(selectedSectionId) : '';
    }

    function renderBlockTypePicker(type, editable = true) {
        $$('[data-block-modal-type]').forEach((button) => {
            const isActive = button.dataset.blockModalType === type;
            button.classList.toggle('active', isActive);
            button.disabled = !editable;
        });
    }

    function configureBlockModalFields(type) {
        const titleGroup = $('#area-block-title-group');
        const contentGroup = $('#area-block-content-group');
        const titleInput = $('#area-block-title-input');
        const contentInput = $('#area-block-content-input');
        const contentLabel = $('#area-block-content-group label');

        titleGroup.hidden = type === 'line';
        contentGroup.hidden = !(type === 'line' || type === 'note');
        if (type === 'note') titleInput.placeholder = 'Note title';
        else if (type === 'task_list') titleInput.placeholder = 'Task list title';
        else titleInput.placeholder = 'List title';
        contentInput.rows = type === 'line' ? 3 : 8;
        contentInput.placeholder = type === 'line' ? 'Write a short line' : 'Write the note';
        contentLabel.textContent = type === 'line' ? 'Line' : 'Body';
    }

    function setAreaAddMenuOpen(isOpen) {
        const menu = $('#area-add-menu');
        const button = $('#area-primary-add-btn');
        if (!menu || !button) return;
        menu.classList.toggle('open', isOpen);
        button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    function setAreaActionsMenuOpen(isOpen) {
        const menu = $('#area-actions-menu');
        const button = $('#area-actions-menu-btn');
        const dropdown = $('#area-actions-dropdown');
        if (!menu || !button || !dropdown) return;
        menu.classList.toggle('open', isOpen);
        dropdown.classList.toggle('show', isOpen);
        button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    function toggleAreaAddMenu(event) {
        event.preventDefault();
        event.stopPropagation();
        const menu = $('#area-add-menu');
        setAreaActionsMenuOpen(false);
        setAreaAddMenuOpen(!menu?.classList.contains('open'));
    }

    function toggleAreaActionsMenu(event) {
        event.preventDefault();
        event.stopPropagation();
        const menu = $('#area-actions-menu');
        setAreaAddMenuOpen(false);
        setAreaActionsMenuOpen(!menu?.classList.contains('open'));
    }

    function handleAreaAddType(type) {
        setAreaAddMenuOpen(false);
        if (!type) return;
        openBlockModal(type);
    }

    function openBlockModal(type, block = null, preferredSectionId = null) {
        state.blockModalId = block ? block.id : null;
        state.blockModalType = block ? block.block_type : type;
        const meta = typeMeta[state.blockModalType] || typeMeta.line;
        $('#area-block-modal-title').textContent = block ? `Edit ${meta.label.toLowerCase()}` : `Add ${meta.label.toLowerCase()}`;
        fillSectionSelect(block ? block.section_id : preferredSectionId);
        renderBlockTypePicker(state.blockModalType, !block);
        configureBlockModalFields(state.blockModalType);
        $('#area-block-title-input').value = block ? block.title || '' : '';
        $('#area-block-content-input').value = block ? block.content || '' : '';
        openModal('area-block-modal');
    }

    async function saveBlockFromModal() {
        const type = state.blockModalType;
        const sectionSelect = $('#area-block-section-select');
        const sectionValue = sectionSelect ? sectionSelect.value : '';
        const payload = {
            block_type: type,
            section_id: sectionValue ? Number(sectionValue) : null,
        };

        if (type === 'line') {
            payload.content = $('#area-block-content-input').value.trim();
            if (!payload.content) {
                notify('Line text is required', 'warning');
                return;
            }
        } else if (type === 'note') {
            payload.title = $('#area-block-title-input').value.trim() || 'Untitled Note';
            payload.content = $('#area-block-content-input').value.trim() || null;
        } else if (type === 'list') {
            payload.title = $('#area-block-title-input').value.trim() || 'Untitled List';
        } else {
            payload.title = $('#area-block-title-input').value.trim() || 'Task list';
        }

        try {
            const saved = await api(
                state.blockModalId
                    ? `/api/area-blocks/${state.blockModalId}`
                    : `/api/areas/${state.areaId}/blocks`,
                {
                    method: state.blockModalId ? 'PUT' : 'POST',
                    payload,
                }
            );
            closeModal('area-block-modal');
            if (!state.blockModalId && type !== 'line' && saved && saved.id) {
                window.location.href = `/areas/${state.areaId}/blocks/${saved.id}`;
                return;
            }
            await loadWorkspace();
        } catch (error) {
            notify(error.message || 'Could not save block', 'error');
        }
    }

    async function deleteBlock(blockId) {
        confirmAction('Delete this item?', async () => {
            try {
                await api(`/api/area-blocks/${blockId}`, { method: 'DELETE' });
                state.blocks = state.blocks.filter((block) => block.id !== blockId);
                if (state.detailBlockId === blockId) {
                    state.detailBlockId = null;
                    closeModal('area-block-detail-modal');
                }
                renderWorkspace();
            } catch (error) {
                notify(error.message || 'Could not delete block', 'error');
            }
        });
    }

    function buildFolderOptions(folders) {
        const byParent = new Map();
        (folders || []).forEach((folder) => {
            const parentId = folder.parent_id == null ? null : Number(folder.parent_id);
            if (!byParent.has(parentId)) byParent.set(parentId, []);
            byParent.get(parentId).push(folder);
        });
        byParent.forEach((entries) => {
            entries.sort((a, b) => (a.order_index || 0) - (b.order_index || 0) || String(a.name || '').localeCompare(String(b.name || '')));
        });

        const options = [{ id: '', label: 'Main notes' }];
        const appendChildren = (parentId, depth) => {
            (byParent.get(parentId) || []).forEach((folder) => {
                options.push({
                    id: String(folder.id),
                    label: `${'  '.repeat(depth)}${folder.name || 'Untitled folder'}`,
                });
                appendChildren(folder.id, depth + 1);
            });
        };
        appendChildren(null, 0);
        return options;
    }

    function setSelectOptions(select, options, emptyLabel = 'No destinations available') {
        if (!select) return;
        select.innerHTML = '';
        if (!options.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = emptyLabel;
            option.disabled = true;
            select.appendChild(option);
            select.disabled = true;
            return;
        }
        select.disabled = false;
        options.forEach((entry) => {
            const option = document.createElement('option');
            option.value = String(entry.id);
            option.textContent = entry.label;
            select.appendChild(option);
        });
    }

    function moveTargetsForBlock(block) {
        const targets = [{ id: 'area', label: 'Another area' }];
        if (['line', 'note', 'list'].includes(block.block_type)) {
            targets.push({ id: 'notes', label: 'Notes module' });
        }
        if (block.block_type === 'task_list') {
            targets.push({ id: 'tasks', label: 'Tasks module' });
        }
        return targets;
    }

    function updateMoveFields() {
        const target = $('#area-move-target')?.value || 'area';
        setHidden($('#area-move-area-group'), target !== 'area');
        setHidden($('#area-move-folder-group'), target !== 'notes');
    }

    async function openMoveModal(block) {
        state.moveBlockId = block.id;
        $('#area-move-item-label').textContent = blockTitle(block);
        setSelectOptions($('#area-move-target'), moveTargetsForBlock(block));

        try {
            const [areas, folders] = await Promise.all([
                api('/api/areas?archived=0'),
                api('/api/note-folders'),
            ]);
            state.moveAreas = areas || [];
            state.moveFolders = folders || [];
        } catch (error) {
            state.moveAreas = [];
            state.moveFolders = [];
            notify(error.message || 'Could not load move destinations', 'error');
        }

        const areaOptions = state.moveAreas
            .filter((area) => Number(area.id) !== Number(state.areaId))
            .map((area) => ({ id: area.id, label: area.name || 'Untitled area' }));
        setSelectOptions($('#area-move-area'), areaOptions);
        setSelectOptions($('#area-move-folder'), buildFolderOptions(state.moveFolders));
        updateMoveFields();
        openModal('area-move-modal');
    }

    async function saveMoveFromModal() {
        const block = findBlock(state.moveBlockId);
        if (!block) return;
        const target = $('#area-move-target')?.value || 'area';
        const payload = { target };

        if (target === 'area') {
            const areaValue = $('#area-move-area')?.value || '';
            if (!areaValue) {
                notify('Choose an area first', 'warning');
                return;
            }
            payload.area_id = Number(areaValue);
        } else if (target === 'notes') {
            payload.folder_id = $('#area-move-folder')?.value || null;
        }

        const message = target === 'area'
            ? 'Move this item to another area?'
            : `Move this item to the ${target === 'tasks' ? 'Tasks' : 'Notes'} module? It will leave this area.`;
        confirmAction(message, async () => {
            try {
                const result = await api(`/api/area-blocks/${block.id}/move`, {
                    method: 'POST',
                    payload,
                });
                closeModal('area-move-modal');
                state.moveBlockId = null;
                state.blocks = state.blocks.filter((entry) => entry.id !== block.id);
                renderWorkspace();
                if (result && result.url) {
                    notify('Item moved', 'success');
                } else {
                    notify('Item moved', 'success');
                }
            } catch (error) {
                notify(error.message || 'Could not move item', 'error');
            }
        });
    }

    function initAreaList() {
        $('#area-add-btn')?.addEventListener('click', () => openAreaModal());
        $('#area-modal-save')?.addEventListener('click', saveAreaFromModal);
        $('#area-modal-cancel')?.addEventListener('click', () => closeModal('area-modal'));
        modal('area-modal')?.addEventListener('click', closeAnyModal);

        $$('.areas-filter-group [data-archived]').forEach((button) => {
            button.addEventListener('click', () => {
                state.archivedFilter = button.dataset.archived;
                $$('.areas-filter-group [data-archived]').forEach((entry) => entry.classList.toggle('active', entry === button));
                loadAreas();
            });
        });

        $('#area-search')?.addEventListener('input', renderAreas);
        $('#area-search-clear')?.addEventListener('click', () => {
            $('#area-search').value = '';
            renderAreas();
        });
        document.addEventListener('click', () => closeAreaCardMenus());
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeAreaCardMenus();
        });
        loadAreas();
    }

    function initAreaDetail() {
        $('#area-actions-menu-btn')?.addEventListener('click', toggleAreaActionsMenu);
        $('#area-detail-edit-btn')?.addEventListener('click', () => {
            setAreaActionsMenuOpen(false);
            openAreaModal(state.area);
        });
        $('#area-detail-archive-btn')?.addEventListener('click', () => {
            setAreaActionsMenuOpen(false);
            archiveArea(state.areaId);
        });

        $('#area-modal-save')?.addEventListener('click', saveAreaFromModal);
        $('#area-modal-cancel')?.addEventListener('click', () => closeModal('area-modal'));
        $('#area-section-modal-save')?.addEventListener('click', saveSectionFromModal);
        $('#area-section-modal-cancel')?.addEventListener('click', () => closeModal('area-section-modal'));
        $('#area-block-modal-save')?.addEventListener('click', saveBlockFromModal);
        $('#area-block-modal-cancel')?.addEventListener('click', () => closeModal('area-block-modal'));
        $('#area-move-save')?.addEventListener('click', saveMoveFromModal);
        $('#area-move-cancel')?.addEventListener('click', () => closeModal('area-move-modal'));
        $('#area-move-target')?.addEventListener('change', updateMoveFields);
        $('#area-block-detail-close')?.addEventListener('click', () => {
            state.detailBlockId = null;
            closeModal('area-block-detail-modal');
        });

        modal('area-modal')?.addEventListener('click', closeAnyModal);
        modal('area-section-modal')?.addEventListener('click', closeAnyModal);
        modal('area-block-modal')?.addEventListener('click', closeAnyModal);
        modal('area-move-modal')?.addEventListener('click', closeAnyModal);
        modal('area-block-detail-modal')?.addEventListener('click', (event) => {
            closeAnyModal(event);
            if (event.target.id === 'area-block-detail-modal') state.detailBlockId = null;
        });

        $('#area-primary-add-btn')?.addEventListener('click', toggleAreaAddMenu);
        $$('[data-area-add-type]').forEach((button) => {
            button.addEventListener('click', () => handleAreaAddType(button.dataset.areaAddType));
        });
        document.addEventListener('click', (event) => {
            if (!event.target.closest('#area-add-menu')) setAreaAddMenuOpen(false);
            if (!event.target.closest('#area-actions-menu')) setAreaActionsMenuOpen(false);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                setAreaAddMenuOpen(false);
                setAreaActionsMenuOpen(false);
            }
        });
        $$('[data-block-modal-type]').forEach((button) => {
            button.addEventListener('click', () => {
                if (state.blockModalId) return;
                state.blockModalType = button.dataset.blockModalType;
                const meta = typeMeta[state.blockModalType] || typeMeta.line;
                $('#area-block-modal-title').textContent = `Add ${meta.label.toLowerCase()}`;
                renderBlockTypePicker(state.blockModalType, true);
                configureBlockModalFields(state.blockModalType);
            });
        });
        $$('[data-workspace-filter]').forEach((button) => {
            button.addEventListener('click', () => {
                state.workspaceFilter = button.dataset.workspaceFilter;
                $$('[data-workspace-filter]').forEach((entry) => entry.classList.toggle('active', entry === button));
                renderWorkspace();
            });
        });

        loadWorkspace();
    }

    if (state.areaId) initAreaDetail();
    else initAreaList();
})();
