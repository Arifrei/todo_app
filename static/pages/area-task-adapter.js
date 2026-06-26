(function () {
    const context = window.AREA_TASK_CONTEXT;
    if (!context || !context.block_id) return;

    const blockId = Number(context.block_id);
    const areaId = Number(context.area_id);
    const returnUrl = context.return_url || `/areas/${areaId}`;
    const originalFetch = window.fetch.bind(window);

    function jsonResponse(payload, init = {}) {
        return new Response(JSON.stringify(payload), {
            status: init.status || 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    function parseBody(init) {
        if (!init || init.body == null) return {};
        if (typeof init.body === 'string') {
            try {
                return JSON.parse(init.body);
            } catch (err) {
                return {};
            }
        }
        return {};
    }

    function areaBlockToNote(block) {
        const noteType = block && block.block_type === 'list' ? 'list' : 'note';
        return {
            id: block.id,
            area_block_id: block.id,
            title: block.title || (noteType === 'list' ? 'Untitled List' : 'Untitled Note'),
            note_type: noteType,
            folder_id: null,
            is_listed: false,
            is_linked_note: true
        };
    }

    async function fetchAreaLinkableNotes() {
        const response = await originalFetch(`/api/areas/${areaId}/blocks`);
        if (!response.ok) return response;
        const blocks = await response.json();
        const notes = (Array.isArray(blocks) ? blocks : [])
            .filter((block) => block && (block.block_type === 'note' || block.block_type === 'list'))
            .map(areaBlockToNote);
        return jsonResponse(notes);
    }

    async function createAndAttachAreaNote(init) {
        const payload = parseBody(init);
        const itemId = payload.todo_item_id;
        const noteType = payload.note_type === 'list' ? 'list' : 'note';
        const title = (payload.title || '').trim() || (noteType === 'list' ? 'Untitled List' : 'Untitled Note');
        const createResponse = await originalFetch(`/api/areas/${areaId}/blocks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                block_type: noteType === 'list' ? 'list' : 'note',
                title,
                content: payload.content || ''
            })
        });
        if (!createResponse.ok) return createResponse;
        const block = await createResponse.json();
        if (itemId) {
            const attachResponse = await originalFetch(`/api/area-task-items/${itemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ linked_block_id: block.id })
            });
            if (!attachResponse.ok) return attachResponse;
        }
        return jsonResponse(areaBlockToNote(block), { status: 201 });
    }

    function attachAreaNote(noteId, init) {
        const payload = parseBody(init);
        if (!Object.prototype.hasOwnProperty.call(payload, 'todo_item_id')) return null;
        const itemId = payload.todo_item_id;
        if (!itemId) return jsonResponse({});
        return originalFetch(`/api/area-task-items/${itemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ linked_block_id: noteId })
        });
    }

    function rewriteUrl(input) {
        const raw = typeof input === 'string' ? input : input && input.url;
        if (!raw) return input;

        const url = new URL(raw, window.location.origin);
        if (url.origin !== window.location.origin) return input;

        if (url.pathname === '/api/lists' && url.searchParams.get('type') === 'light') {
            url.pathname = '/api/area-task-blocks';
            url.search = `?area_id=${areaId}`;
            return `${url.pathname}${url.search}`;
        }

        if (url.pathname === '/api/items/bulk') {
            url.pathname = '/api/area-task-items/bulk';
            return `${url.pathname}${url.search}`;
        }

        if (url.pathname === '/api/items' && url.searchParams.get('list_id') === String(blockId)) {
            url.pathname = `/api/area-task-blocks/${blockId}/items`;
            url.search = '';
            return `${url.pathname}${url.search}`;
        }

        const listBase = `/api/lists/${blockId}`;
        const areaListBase = `/api/area-task-blocks/${blockId}`;
        if (url.pathname === listBase) {
            url.pathname = areaListBase;
        } else if (url.pathname === `${listBase}/items`) {
            url.pathname = `${areaListBase}/items`;
        } else if (url.pathname === `${listBase}/reorder`) {
            url.pathname = `${areaListBase}/reorder`;
        } else if (url.pathname === `${listBase}/bulk_import`) {
            url.pathname = `${areaListBase}/bulk_import`;
        } else {
            const itemMatch = url.pathname.match(/^\/api\/items\/(\d+)(\/move)?$/);
            if (itemMatch) {
                url.pathname = `/api/area-task-items/${itemMatch[1]}${itemMatch[2] || ''}`;
            } else {
                return input;
            }
        }

        return `${url.pathname}${url.search}${url.hash}`;
    }

    window.fetch = function areaTaskFetch(input, init) {
        const raw = typeof input === 'string' ? input : input && input.url;
        if (raw) {
            const url = new URL(raw, window.location.origin);
            if (url.origin === window.location.origin) {
                if (url.pathname === '/api/hubs') {
                    return Promise.resolve(jsonResponse([]));
                }
                if (url.pathname === '/api/note-folders') {
                    return Promise.resolve(jsonResponse([]));
                }
                if (url.pathname === '/api/notes' && url.searchParams.get('all') === '1') {
                    return fetchAreaLinkableNotes();
                }
                if (url.pathname === '/api/notes' && (init && (init.method || 'GET').toUpperCase()) === 'POST') {
                    const payload = parseBody(init);
                    if (Object.prototype.hasOwnProperty.call(payload, 'todo_item_id')) {
                        return createAndAttachAreaNote(init);
                    }
                }
                const noteMatch = url.pathname.match(/^\/api\/notes\/(\d+)$/);
                if (noteMatch && (init && (init.method || 'GET').toUpperCase()) === 'PUT') {
                    const response = attachAreaNote(Number(noteMatch[1]), init);
                    if (response) return response;
                }
            }
        }
        return originalFetch(rewriteUrl(input), init);
    };

    window.deleteAreaTaskList = function deleteAreaTaskList(listId) {
        const runDelete = async () => {
            const res = await window.fetch(`/api/area-task-blocks/${listId}`, { method: 'DELETE' });
            if (res.ok) {
                window.location.href = returnUrl;
            }
        };
        if (typeof window.openConfirmModal === 'function') {
            window.openConfirmModal('Delete this task list and all its contents?', runDelete);
        } else if (window.confirm('Delete this task list and all its contents?')) {
            runDelete();
        }
    };

})();
