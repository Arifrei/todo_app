(function () {
    const context = window.AREA_LIST_CONTEXT;
    if (!context || !context.block_id) return;

    const blockId = Number(context.block_id);
    const areaId = Number(context.area_id);
    const returnUrl = context.return_url || `/areas/${context.area_id}`;
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

    function normalizeNoteType(value) {
        return value === 'list' ? 'list' : 'note';
    }

    function areaBlockTypeForNoteType(noteType) {
        return noteType === 'list' ? 'list' : 'note';
    }

    function areaBlockToNote(block) {
        const noteType = block && block.block_type === 'list' ? 'list' : 'note';
        return {
            id: block.id,
            area_block_id: block.id,
            title: block.title || (noteType === 'list' ? 'Untitled List' : 'Untitled Note'),
            content: block.content || '',
            note_type: noteType,
            folder_id: null,
            is_listed: false,
            is_linked_note: true,
            updated_at: block.updated_at || null
        };
    }

    async function loadAreaBlocks(blockType) {
        const response = await originalFetch(`/api/areas/${areaId}/blocks?type=${encodeURIComponent(blockType)}`);
        if (!response.ok) throw new Error('Could not load Area blocks');
        const blocks = await response.json();
        return Array.isArray(blocks) ? blocks : [];
    }

    async function resolveAreaNoteLink(init) {
        const payload = parseBody(init);
        const noteType = normalizeNoteType(payload.note_type);
        const blockType = areaBlockTypeForNoteType(noteType);
        const blocks = await loadAreaBlocks(blockType);
        const targetId = Number(payload.target_note_id || 0);

        if (targetId) {
            const target = blocks.find((block) => Number(block.id) === targetId);
            if (!target) return jsonResponse({ error: `Target is not a ${noteType}` }, { status: 400 });
            return jsonResponse({ status: 'linked', note: areaBlockToNote(target) });
        }

        const title = String(payload.title || '').trim();
        if (!title) return jsonResponse({ error: 'Missing title' }, { status: 400 });

        const matches = blocks.filter((block) => String(block.title || '').trim().toLowerCase() === title.toLowerCase());
        if (matches.length > 1) {
            return jsonResponse({
                status: 'choose',
                title,
                matches: matches.map(areaBlockToNote)
            });
        }
        if (!matches.length && payload.defer_create) {
            return jsonResponse({ status: 'choose', title, matches: [] });
        }
        if (matches.length === 1) {
            return jsonResponse({ status: 'linked', note: areaBlockToNote(matches[0]) });
        }

        const createResponse = await originalFetch(`/api/areas/${areaId}/blocks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                block_type: blockType,
                title,
                content: ''
            })
        });
        if (!createResponse.ok) return createResponse;
        const block = await createResponse.json();
        return jsonResponse({ status: 'created', note: areaBlockToNote(block) }, { status: 201 });
    }

    function patchAreaNoteNavigation() {
        window.openNoteInEditor = function openAreaBlockInEditor(noteId) {
            window.location.href = `/areas/${areaId}/blocks/${noteId}`;
        };
    }

    function ensureReturnUrl() {
        try {
            const url = new URL(window.location.href);
            if (!url.searchParams.has('return')) {
                url.searchParams.set('return', returnUrl);
                window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
            }
        } catch (err) {
            console.warn('Could not set area list return URL:', err);
        }
    }

    function rewriteUrl(input) {
        const raw = typeof input === 'string' ? input : input && input.url;
        if (!raw) return input;

        const url = new URL(raw, window.location.origin);
        if (url.origin !== window.location.origin) return input;

        const noteBase = `/api/notes/${blockId}`;
        const areaBase = `/api/area-list-blocks/${blockId}`;

        if (url.pathname === noteBase) {
            url.pathname = areaBase;
        } else if (url.pathname === `${noteBase}/list-items`) {
            url.pathname = `${areaBase}/list-items`;
        } else if (url.pathname.startsWith(`${noteBase}/list-items/`)) {
            url.pathname = url.pathname.replace(`${noteBase}/list-items`, `${areaBase}/list-items`);
        } else {
            return input;
        }

        return `${url.pathname}${url.search}${url.hash}`;
    }

    window.fetch = function areaListFetch(input, init) {
        const raw = typeof input === 'string' ? input : input && input.url;
        if (raw) {
            const url = new URL(raw, window.location.origin);
            if (url.origin === window.location.origin && url.pathname === '/api/notes/resolve-link') {
                return resolveAreaNoteLink(init);
            }
        }
        return originalFetch(rewriteUrl(input), init);
    };

    ensureReturnUrl();
    document.addEventListener('DOMContentLoaded', patchAreaNoteNavigation);
})();
