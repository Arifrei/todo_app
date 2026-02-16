// Shared UI helpers used across the app runtime.

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function splitTopLevel(expression, delimiter) {
    const parts = [];
    let current = '';
    let depth = 0;
    let quote = null;
    let escapeNext = false;

    for (let i = 0; i < expression.length; i++) {
        const ch = expression[i];
        if (escapeNext) {
            current += ch;
            escapeNext = false;
            continue;
        }
        if (quote) {
            current += ch;
            if (ch === '\\') {
                escapeNext = true;
            } else if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === '"' || ch === '\'' || ch === '`') {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') {
            depth += 1;
            current += ch;
            continue;
        }
        if (ch === ')' || ch === ']' || ch === '}') {
            depth = Math.max(0, depth - 1);
            current += ch;
            continue;
        }
        if (ch === delimiter && depth === 0) {
            if (current.trim()) parts.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

function decodeStringLiteral(token) {
    if (!token || token.length < 2) return token;
    const quote = token[0];
    const inner = token.slice(1, -1);
    if (quote !== '\'' && quote !== '"' && quote !== '`') return token;
    return inner
        .replace(/\\\\/g, '\\')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, '\'')
        .replace(/\\`/g, '`');
}

function parseActionToken(token, event, target) {
    const value = (token || '').trim();
    if (!value) return undefined;
    if (value === 'event') return event;
    if (value === 'this') return target;
    if (value === 'null') return null;
    if (value === 'undefined') return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith('\'') && value.endsWith('\'')) ||
        (value.startsWith('`') && value.endsWith('`'))) {
        return decodeStringLiteral(value);
    }
    if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
        try {
            return JSON.parse(value);
        } catch (e) {
            return value;
        }
    }
    if (Object.prototype.hasOwnProperty.call(window, value)) {
        return window[value];
    }
    return value;
}

function runActionExpression(expression, event = null, target = null) {
    const source = String(expression || '').trim();
    if (!source) return;
    try {
        // Keep legacy behavior so all existing data-on* expressions continue to work.
        const fn = new Function('event', 'target', source);
        fn.call(target || window, event, target);
    } catch (e) {
        console.error('Failed to run action expression:', e, source);
    }
}

function showToast(message, type = 'info', duration = 4000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        container.setAttribute('role', 'status');
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'true');
        document.body.appendChild(container);
    }

    const icons = {
        success: '<i class="fa-solid fa-circle-check"></i>',
        error: '<i class="fa-solid fa-circle-exclamation"></i>',
        warning: '<i class="fa-solid fa-triangle-exclamation"></i>',
        info: '<i class="fa-solid fa-circle-info"></i>'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${message}</span>
        <button class="toast-close" type="button" aria-label="Dismiss notification">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;
    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => toast.remove());
    }

    container.appendChild(toast);

    if (duration > 0) {
        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.remove();
                }
            }, 300);
        }, duration);
    }

    return toast;
}

class SelectionManager {
    constructor(config) {
        this.moduleName = config.moduleName || 'items';
        this.bulkBarId = config.bulkBarId;
        this.countSpanId = config.countSpanId;
        this.selectAllId = config.selectAllId;
        this.itemSelector = config.itemSelector;
        this.itemIdAttr = config.itemIdAttr || 'data-item-id';
        this.selectedClass = config.selectedClass || 'selected';
        this.bodyActiveClass = config.bodyActiveClass || `${this.moduleName}-selection-mode-active`;
        this.onSelectionChange = config.onSelectionChange || null;
        this.getTotalCount = config.getTotalCount || null;
        this.selectedIds = new Set();
    }

    select(id) {
        this.selectedIds.add(id);
        this._updateItemUI(id, true);
        this.updateUI();
    }

    deselect(id) {
        this.selectedIds.delete(id);
        this._updateItemUI(id, false);
        this.updateUI();
    }

    toggle(id) {
        if (this.selectedIds.has(id)) {
            this.deselect(id);
        } else {
            this.select(id);
        }
    }

    selectAll(ids) {
        ids.forEach(id => {
            this.selectedIds.add(id);
            this._updateItemUI(id, true);
        });
        this.updateUI();
    }

    deselectAll() {
        const ids = Array.from(this.selectedIds);
        this.selectedIds.clear();
        ids.forEach(id => this._updateItemUI(id, false));
        this.updateUI();
    }

    isSelected(id) {
        return this.selectedIds.has(id);
    }

    getCount() {
        return this.selectedIds.size;
    }

    getIds() {
        return Array.from(this.selectedIds);
    }

    _updateItemUI(id, isSelected) {
        if (this.itemSelector) {
            const elements = document.querySelectorAll(`${this.itemSelector}[${this.itemIdAttr}="${id}"]`);
            elements.forEach(el => el.classList.toggle(this.selectedClass, isSelected));
        }
    }

    updateUI() {
        const bar = this.bulkBarId ? document.getElementById(this.bulkBarId) : null;
        const countSpan = this.countSpanId ? document.getElementById(this.countSpanId) : null;
        const selectAll = this.selectAllId ? document.getElementById(this.selectAllId) : null;
        const count = this.selectedIds.size;

        if (bar) {
            if (count > 0) {
                bar.classList.add('active');
                bar.style.display = 'flex';
            } else {
                bar.classList.remove('active');
                bar.style.display = 'none';
            }
        }

        if (countSpan) {
            countSpan.textContent = count > 0 ? `${count} selected` : '';
        }

        if (count === 0) {
            document.body.classList.remove(this.bodyActiveClass);
        } else {
            document.body.classList.add(this.bodyActiveClass);
        }

        if (selectAll) {
            const totalCount = this.getTotalCount ? this.getTotalCount() : 0;
            selectAll.checked = totalCount > 0 && count === totalCount;
            selectAll.indeterminate = count > 0 && count < totalCount;
        }

        if (this.onSelectionChange) {
            this.onSelectionChange(this.selectedIds);
        }
    }
}

class BulkActions {
    constructor(config) {
        this.apiEndpoint = config.apiEndpoint;
        this.selectionManager = config.selectionManager;
        this.onComplete = config.onComplete || (() => {});
        this.moduleName = config.moduleName || 'items';
    }

    async execute(action, params = {}) {
        const ids = this.selectionManager.getIds();
        if (ids.length === 0) {
            showToast('No items selected', 'warning');
            return null;
        }

        try {
            const res = await fetch(this.apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids, action, ...params })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(err.error || `Failed to ${action} ${this.moduleName}`, 'error');
                return null;
            }

            const data = await res.json();
            const count = data.updated || data.deleted || ids.length;
            showToast(`${count} ${this.moduleName} ${action}d`, 'success');
            this.selectionManager.deselectAll();
            this.onComplete(data);
            return data;
        } catch (e) {
            console.error(`Error executing bulk ${action}:`, e);
            showToast(`Error: Could not ${action} ${this.moduleName}`, 'error');
            return null;
        }
    }

    async delete(confirmMessage = null) {
        const ids = this.selectionManager.getIds();
        if (ids.length === 0) return;

        const message = confirmMessage || `Delete ${ids.length} ${this.moduleName}?`;
        openConfirmModal(message, async () => {
            await this.execute('delete');
        });
    }

    async archive() {
        await this.execute('archive');
    }

    async unarchive() {
        await this.execute('unarchive');
    }

    async pin() {
        await this.execute('pin');
    }

    async unpin() {
        await this.execute('unpin');
    }

    async move(destinationId, destinationType = 'folder') {
        await this.execute('move', { destination_id: destinationId, destination_type: destinationType });
    }

    async updateStatus(status) {
        await this.execute('status', { status });
    }
}

function showLoading(element, message = 'Loading...') {
    if (!element) return;
    element.dataset.originalContent = element.innerHTML;
    element.dataset.originalDisabled = element.disabled;
    element.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${message}`;
    element.disabled = true;
}

function hideLoading(element) {
    if (!element) return;
    if (element.dataset.originalContent !== undefined) {
        element.innerHTML = element.dataset.originalContent;
        delete element.dataset.originalContent;
    }
    if (element.dataset.originalDisabled !== undefined) {
        element.disabled = element.dataset.originalDisabled === 'true';
        delete element.dataset.originalDisabled;
    } else {
        element.disabled = false;
    }
}

function renderEmptyState(container, icon, message, actionBtn = null) {
    if (!container) return;
    const actionButtonId = actionBtn ? `empty-state-action-${Date.now()}-${Math.floor(Math.random() * 10000)}` : null;
    let html = `
        <div class="empty-state">
            <i class="fa-solid fa-${icon}"></i>
            <p>${message}</p>
    `;
    if (actionBtn) {
        html += `<button class="btn btn-primary" type="button" id="${actionButtonId}">
            ${actionBtn.icon ? `<i class="fa-solid fa-${actionBtn.icon}"></i> ` : ''}${actionBtn.label}
        </button>`;
    }
    html += '</div>';
    container.innerHTML = html;
    if (actionBtn && actionButtonId) {
        const btn = container.querySelector(`#${actionButtonId}`);
        if (btn) {
            btn.addEventListener('click', () => {
                if (typeof actionBtn.onClick === 'function') {
                    actionBtn.onClick();
                    return;
                }
                if (typeof actionBtn.onclick === 'string' && actionBtn.onclick.trim()) {
                    try {
                        // Backward-compatible string action from older call sites.
                        runActionExpression(actionBtn.onclick, null, btn);
                    } catch (e) {
                        console.error('Failed to run empty-state action', e);
                    }
                }
            });
        }
    }
}

function normalizeShareNewlines(value) {
    return String(value || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
}

function cleanInlineShareText(value) {
    return normalizeShareNewlines(value)
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/[ \t]*\n[ \t]*/g, '\n')
        .trim();
}

function compactShareLines(lines) {
    const compacted = [];
    let prevBlank = true;
    (lines || []).forEach((line) => {
        const normalized = String(line ?? '').replace(/\u00a0/g, ' ');
        const isBlank = normalized.trim() === '';
        if (isBlank) {
            if (!prevBlank) compacted.push('');
            prevBlank = true;
            return;
        }
        compacted.push(normalized);
        prevBlank = false;
    });
    while (compacted.length && compacted[compacted.length - 1] === '') compacted.pop();
    return compacted;
}

function renderInlineShareNode(node) {
    if (!node) return '';
    if (node.nodeType === 3) {
        return node.nodeValue || '';
    }
    if (node.nodeType !== 1) return '';

    const tag = node.tagName.toUpperCase();
    if (tag === 'BR') return '\n';
    if (tag === 'INPUT' && node.type === 'checkbox') {
        return node.checked ? '☑' : '☐';
    }

    if (tag === 'SPAN' && node.classList.contains('note-inline-checkbox')) {
        const checkbox = node.querySelector('input[type="checkbox"]');
        const marker = checkbox && checkbox.checked ? '☑' : '☐';
        const parts = [];
        node.childNodes.forEach((child) => {
            if (child.nodeType === 1 && child.tagName.toUpperCase() === 'INPUT') return;
            parts.push(renderInlineShareNode(child));
        });
        const label = cleanInlineShareText(parts.join(''));
        return label ? `${marker} ${label}` : marker;
    }

    let text = '';
    node.childNodes.forEach((child) => {
        text += renderInlineShareNode(child);
    });
    const inlineText = cleanInlineShareText(text);
    if (!inlineText) return '';

    if (tag === 'A') {
        const href = cleanInlineShareText(node.getAttribute('href') || '');
        if (href && inlineText && href !== inlineText) return `${inlineText} (${href})`;
        return inlineText || href;
    }
    if (tag === 'STRONG' || tag === 'B') return inlineText;
    if (tag === 'EM' || tag === 'I') return inlineText;
    if (tag === 'U') return inlineText;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') return inlineText;
    if (tag === 'CODE' && (!node.parentElement || node.parentElement.tagName.toUpperCase() !== 'PRE')) return inlineText;
    return inlineText;
}

function renderListShareBlock(listEl, outputLines, depth = 0) {
    if (!listEl || !outputLines) return;
    const isOrdered = listEl.tagName.toUpperCase() === 'OL';
    const listItems = Array.from(listEl.children).filter((child) => child.tagName && child.tagName.toUpperCase() === 'LI');
    listItems.forEach((li, index) => {
        const marker = isOrdered ? `${index + 1}.` : '•';
        const indent = '  '.repeat(depth);
        const nestedLists = [];
        const inlineNodes = [];
        li.childNodes.forEach((child) => {
            if (child.nodeType === 1) {
                const childTag = child.tagName.toUpperCase();
                if (childTag === 'UL' || childTag === 'OL') {
                    nestedLists.push(child);
                    return;
                }
            }
            inlineNodes.push(child);
        });
        const text = cleanInlineShareText(inlineNodes.map((child) => renderInlineShareNode(child)).join(''));
        if (text) {
            const textLines = text.split('\n');
            outputLines.push(`${indent}${marker} ${textLines[0]}`.trimEnd());
            for (let i = 1; i < textLines.length; i += 1) {
                outputLines.push(`${indent}  ${textLines[i]}`.trimEnd());
            }
        } else {
            outputLines.push(`${indent}${marker}`);
        }

        nestedLists.forEach((nestedList) => renderListShareBlock(nestedList, outputLines, depth + 1));
    });
}

function isShareBlockElementTag(tag) {
    if (!tag) return false;
    if (tag === 'UL' || tag === 'OL' || tag === 'PRE' || tag === 'BLOCKQUOTE' || tag === 'HR') return true;
    if (/^H[1-6]$/.test(tag)) return true;
    return [
        'ADDRESS', 'ARTICLE', 'ASIDE', 'DIV', 'DL', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
        'FOOTER', 'FORM', 'HEADER', 'MAIN', 'NAV', 'P', 'SECTION', 'TABLE'
    ].includes(tag);
}

function renderBlockShareNode(node, outputLines) {
    if (!node) return;
    if (node.nodeType === 3) {
        const text = cleanInlineShareText(node.nodeValue || '');
        if (text) outputLines.push(text);
        return;
    }
    if (node.nodeType !== 1) return;

    const tag = node.tagName.toUpperCase();
    if (tag === 'UL' || tag === 'OL') {
        renderListShareBlock(node, outputLines, 0);
        outputLines.push('');
        return;
    }
    if (tag === 'PRE') {
        const code = normalizeShareNewlines(node.textContent || '').trimEnd();
        if (code) {
            code.split('\n').forEach((line) => outputLines.push(`    ${line}`));
            outputLines.push('');
        }
        return;
    }
    if (tag === 'BLOCKQUOTE') {
        const innerLines = [];
        node.childNodes.forEach((child) => renderBlockShareNode(child, innerLines));
        const compacted = compactShareLines(innerLines);
        compacted.forEach((line) => {
            outputLines.push(line ? `│ ${line}` : '│');
        });
        if (compacted.length) outputLines.push('');
        return;
    }
    if (tag === 'HR') {
        outputLines.push('────────────────────────');
        outputLines.push('');
        return;
    }
    if (/^H[1-6]$/.test(tag)) {
        const level = parseInt(tag[1], 10) || 1;
        const headingText = cleanInlineShareText(Array.from(node.childNodes).map((child) => renderInlineShareNode(child)).join(''));
        if (headingText) {
            outputLines.push(headingText);
            if (level <= 2) {
                const underlineChar = level === 1 ? '=' : '-';
                outputLines.push(underlineChar.repeat(Math.max(headingText.length, 3)));
            }
            outputLines.push('');
        }
        return;
    }

    if (isShareBlockElementTag(tag)) {
        const inlineNodes = Array.from(node.childNodes).filter((child) => {
            if (child.nodeType !== 1) return true;
            return !isShareBlockElementTag(child.tagName.toUpperCase());
        });
        const text = cleanInlineShareText(inlineNodes.map((child) => renderInlineShareNode(child)).join(''));
        if (text) outputLines.push(...text.split('\n'));

        Array.from(node.children).forEach((child) => {
            const childTag = child.tagName.toUpperCase();
            if (isShareBlockElementTag(childTag)) {
                renderBlockShareNode(child, outputLines);
            }
        });

        if (text) outputLines.push('');
        return;
    }

    const fallbackText = cleanInlineShareText(Array.from(node.childNodes).map((child) => renderInlineShareNode(child)).join(''));
    if (fallbackText) outputLines.push(...fallbackText.split('\n'));
}

function noteHtmlToShareText(html) {
    const container = document.createElement('div');
    container.innerHTML = html || '';
    const lines = [];
    container.childNodes.forEach((node) => renderBlockShareNode(node, lines));
    const compacted = compactShareLines(lines);
    return compacted.join('\n');
}

function buildShareTxtFileName(title, fallback = 'shared-note') {
    const base = String(title || '')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '');
    const safeBase = (base || fallback).slice(0, 80);
    return `${safeBase}.txt`;
}

function sortListItemsForSharing(items) {
    return (items || []).slice().sort((a, b) => {
        const aOrder = a.order_index || 0;
        const bOrder = b.order_index || 0;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return (a.id || 0) - (b.id || 0);
    });
}

function normalizeListDateValueForShare(raw) {
    const str = String(raw || '').trim();
    if (!str) return null;
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
}

function formatListScheduledDateForShare(raw) {
    const value = normalizeListDateValueForShare(raw);
    if (!value) return '';
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.getTime() === today.getTime()) return 'Today';
    if (date.getTime() === tomorrow.getTime()) return 'Tomorrow';

    const diffDays = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 0 && diffDays <= 7) {
        return date.toLocaleDateString('en-US', { weekday: 'long' });
    }

    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
    });
}

function isListSectionItemForShare(item) {
    const textValue = String(item && item.text ? item.text : '').trim();
    return textValue.startsWith('[[section]]');
}

function getListSectionTitleForShare(item) {
    const textValue = String(item && item.text ? item.text : '').trim();
    if (!textValue.startsWith('[[section]]')) return '';
    return textValue.slice('[[section]]'.length).trim();
}

function buildListShareTextForShare(items, checkboxMode) {
    const sorted = sortListItemsForSharing(items);
    const lines = [];

    sorted.forEach((item) => {
        if (isListSectionItemForShare(item)) {
            const title = getListSectionTitleForShare(item);
            if (lines.length) lines.push('');
            if (title) lines.push(title);
            lines.push('');
            return;
        }

        const textValue = String(item && item.text ? item.text : '').trim();
        const linkLabel = String(item && item.link_text ? item.link_text : '').trim();
        const linkUrl = String(item && item.link_url ? item.link_url : '').trim();
        const noteValue = String(item && item.note ? item.note : '').trim();
        const dateValue = normalizeListDateValueForShare(item ? item.scheduled_date : null);
        let line = textValue;

        if (linkLabel) {
            if (line && linkLabel !== line) line = `${line} - ${linkLabel}`;
            else if (!line) line = linkLabel;
        }
        if (linkUrl) {
            if (line) line = `${line} (${linkUrl})`;
            else line = linkUrl;
        }
        if (noteValue) {
            line = line ? `${line} - ${noteValue}` : noteValue;
        }
        if (dateValue) {
            const label = formatListScheduledDateForShare(dateValue) || dateValue;
            line = line ? `${line} [${label}]` : `[${label}]`;
        }
        if (!line) return;

        if (checkboxMode) {
            lines.push(`${item && item.checked ? '☑' : '☐'} ${line}`);
            return;
        }
        lines.push(`• ${line}`);
    });

    while (lines.length && lines[0] === '') lines.shift();
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
}

function formatDayPreviewDateLabel(dayStr) {
    if (!dayStr) return 'this day';
    const date = new Date(`${dayStr}T00:00:00`);
    if (Number.isNaN(date.getTime())) return dayStr;
    const timezone = window.USER_TIMEZONE || undefined;
    return date.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: timezone
    });
}

function formatDayPreviewTimeLabel(timeStr) {
    if (!timeStr) return '';
    const match = String(timeStr).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return String(timeStr);
    const hour24 = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isFinite(hour24) || !Number.isFinite(minute)) return String(timeStr);
    const period = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = ((hour24 + 11) % 12) + 1;
    return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

function buildDayPreviewMetaLabel(ev) {
    const meta = [];
    if (ev && ev.start_time) {
        const start = formatDayPreviewTimeLabel(ev.start_time);
        const end = ev.end_time ? formatDayPreviewTimeLabel(ev.end_time) : '';
        meta.push(end ? `${start}-${end}` : start);
    } else {
        meta.push('No time');
    }
    if (ev && ev.is_phase) meta.push('Phase');
    else if (ev && ev.is_group) meta.push('Group');
    else if (ev && ev.is_event) meta.push('Event');
    else meta.push('Task');
    if (ev && ev.status === 'done') meta.push('Done');
    if (ev && ev.status === 'canceled') meta.push('Canceled');
    return meta.join(' - ');
}

function renderDayPreviewItems(listEl, events) {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!Array.isArray(events) || !events.length) {
        const empty = document.createElement('div');
        empty.className = 'calendar-move-preview-state';
        empty.textContent = 'No items are scheduled on this day yet.';
        listEl.appendChild(empty);
        return;
    }

    events.forEach((ev) => {
        const row = document.createElement('div');
        row.className = `calendar-move-preview-item ${ev && ev.status === 'done' ? 'done' : ''} ${ev && ev.status === 'canceled' ? 'canceled' : ''}`;

        const dot = document.createElement('span');
        dot.className = `calendar-move-preview-dot priority-${(ev && ev.priority) || 'medium'}`;
        row.appendChild(dot);

        const body = document.createElement('div');
        body.className = 'calendar-move-preview-body';

        const title = document.createElement('div');
        title.className = 'calendar-move-preview-title';
        title.textContent = (ev && ev.title) ? ev.title : 'Untitled';
        body.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'calendar-move-preview-meta';
        meta.textContent = buildDayPreviewMetaLabel(ev);
        body.appendChild(meta);

        row.appendChild(body);
        listEl.appendChild(row);
    });
}

async function fetchDayPreviewEvents(dayStr) {
    if (!dayStr) return [];
    const response = await fetch(`/api/calendar/events?day=${encodeURIComponent(dayStr)}`);
    if (response.status === 401) {
        window.location.href = '/select-user';
        return [];
    }
    if (!response.ok) throw new Error('Could not load day preview.');
    const payload = await response.json();
    return Array.isArray(payload) ? payload : [];
}

async function openCalendarMovePreviewModal({ targetDay, movingLabel = '', excludeEventIds = [], onConfirm, confirmLabel = 'Continue' }) {
    if (!targetDay) {
        if (typeof onConfirm === 'function') await onConfirm();
        return;
    }
    const modal = document.getElementById('calendar-move-preview-modal');
    const titleEl = document.getElementById('calendar-move-preview-title');
    const movingEl = document.getElementById('calendar-move-preview-moving');
    const summaryEl = document.getElementById('calendar-move-preview-summary');
    const listEl = document.getElementById('calendar-move-preview-list');
    const confirmBtn = document.getElementById('calendar-move-preview-confirm');
    const cancelBtn = document.getElementById('calendar-move-preview-cancel');
    if (!modal || !titleEl || !movingEl || !summaryEl || !listEl || !confirmBtn || !cancelBtn) {
        if (typeof onConfirm === 'function') await onConfirm();
        return;
    }

    const initialConfirmText = confirmLabel || confirmBtn.textContent || 'Continue';
    const close = () => {
        modal.classList.remove('active');
        confirmBtn.disabled = false;
        confirmBtn.textContent = initialConfirmText;
        cancelBtn.onclick = null;
        confirmBtn.onclick = null;
        modal.onclick = null;
        deactivateModalA11y(modal);
    };

    titleEl.textContent = `Move to ${formatDayPreviewDateLabel(targetDay)}?`;
    movingEl.textContent = movingLabel ? `Moving ${movingLabel}.` : 'Review this day before continuing.';
    summaryEl.textContent = 'Loading items for this day...';
    listEl.innerHTML = '<div class="calendar-move-preview-state">Loading...</div>';
    confirmBtn.disabled = true;
    confirmBtn.textContent = initialConfirmText;
    modal.classList.add('active');
    activateModalA11y(modal, cancelBtn);

    cancelBtn.onclick = close;
    modal.onclick = (e) => {
        if (e.target === modal) close();
    };
    confirmBtn.onclick = async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Saving...';
        try {
            if (typeof onConfirm === 'function') {
                await onConfirm();
            }
            close();
        } catch (error) {
            console.error('Day preview confirm failed:', error);
            confirmBtn.disabled = false;
            confirmBtn.textContent = initialConfirmText;
        }
    };

    try {
        const rawEvents = await fetchDayPreviewEvents(targetDay);
        const excluded = new Set(
            (excludeEventIds || [])
                .map((id) => Number(id))
                .filter((id) => Number.isFinite(id))
        );
        const events = rawEvents.filter((ev) => !excluded.has(Number(ev.id)));
        renderDayPreviewItems(listEl, events);
        summaryEl.textContent = events.length === 1
            ? '1 item is already scheduled on this day.'
            : `${events.length} items are already scheduled on this day.`;
    } catch (error) {
        console.error('Day preview load failed:', error);
        summaryEl.textContent = 'Could not load this day preview. You can still continue.';
        listEl.innerHTML = '<div class="calendar-move-preview-state error">Preview unavailable.</div>';
    }

    confirmBtn.disabled = false;
}

window.openCalendarMovePreviewModal = openCalendarMovePreviewModal;

const confirmModal = document.getElementById('confirm-modal');
const confirmMessage = document.getElementById('confirm-message');
const confirmYesButton = document.getElementById('confirm-yes-button');
const confirmCancelButton = document.getElementById('confirm-cancel-button');
let pendingConfirmAction = null;
const modalLastFocus = new WeakMap();
let activeA11yModal = null;

function getFocusableElements(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
}

function ensureModalSemantics(modal) {
    if (!modal) return;
    if (!modal.getAttribute('role')) modal.setAttribute('role', 'dialog');
    if (!modal.getAttribute('aria-modal')) modal.setAttribute('aria-modal', 'true');
    const content = modal.querySelector('.modal-content');
    if (content && !content.hasAttribute('tabindex')) content.setAttribute('tabindex', '-1');
    if (!modal.getAttribute('aria-labelledby')) {
        const title = content ? content.querySelector('h1, h2, h3') : null;
        if (title) {
            if (!title.id) title.id = `${modal.id || 'modal'}-title`;
            modal.setAttribute('aria-labelledby', title.id);
        }
    }
}

function activateModalA11y(modal, preferredFocus = null) {
    if (!modal) return;
    ensureModalSemantics(modal);
    if (!modalLastFocus.has(modal)) modalLastFocus.set(modal, document.activeElement);
    activeA11yModal = modal;
    const content = modal.querySelector('.modal-content');
    const focusables = getFocusableElements(content);
    const focusTarget = preferredFocus || focusables[0] || content;
    if (focusTarget && typeof focusTarget.focus === 'function') {
        setTimeout(() => focusTarget.focus(), 0);
    }
}

function deactivateModalA11y(modal) {
    if (!modal) return;
    if (activeA11yModal === modal) activeA11yModal = null;
    const returnFocus = modalLastFocus.get(modal);
    modalLastFocus.delete(modal);
    if (returnFocus && typeof returnFocus.focus === 'function') {
        setTimeout(() => returnFocus.focus(), 0);
    }
}

function closeActiveModalViaIntent(modal) {
    if (!modal) return;
    const modalId = modal.id || '';
    if (modalId === 'confirm-modal') {
        closeConfirmModal();
        return;
    }
    if (modalId === 'overlap-warning-modal') {
        closeOverlapWarningModal();
        return;
    }
    if (modalId === 'pin-modal' && typeof window.closePinModal === 'function') {
        window.closePinModal();
        return;
    }
    if (modalId === 'set-pin-modal' && typeof window.closeSetPinModal === 'function') {
        window.closeSetPinModal();
        return;
    }
    const closeCandidate = modal.querySelector('[data-modal-close], .modal-close, [id$="-cancel"], .btn[aria-label="Close"]');
    if (closeCandidate) {
        closeCandidate.click();
        return;
    }
    modal.classList.remove('active');
}

function openConfirmModal(message, onConfirm) {
    if (confirmMessage) confirmMessage.textContent = message || 'Are you sure?';
    pendingConfirmAction = typeof onConfirm === 'function' ? onConfirm : null;
    if (confirmModal) {
        confirmModal.classList.add('active');
        activateModalA11y(confirmModal, confirmCancelButton || confirmYesButton);
    }
}

function closeConfirmModal() {
    pendingConfirmAction = null;
    if (confirmModal) {
        confirmModal.classList.remove('active');
        deactivateModalA11y(confirmModal);
    }
}

if (confirmYesButton) {
    confirmYesButton.addEventListener('click', async () => {
        const action = pendingConfirmAction;
        pendingConfirmAction = null;
        if (typeof action === 'function') {
            try {
                await action();
            } catch (e) {
                console.error('Error running confirm action:', e);
            }
        }
        closeConfirmModal();
    });
}

if (confirmCancelButton) {
    confirmCancelButton.addEventListener('click', () => closeConfirmModal());
}

const overlapWarningModal = document.getElementById('overlap-warning-modal');
const overlapWarningMessage = document.getElementById('overlap-warning-message');
const overlapAddAnywayButton = document.getElementById('overlap-add-anyway-button');
const overlapCancelButton = document.getElementById('overlap-cancel-button');
let pendingOverlapAction = null;
let pendingOverlapCancelAction = null;

function openOverlapWarningModal(message, onAddAnyway, onCancel) {
    if (overlapWarningMessage) {
        overlapWarningMessage.textContent = message || 'An event is scheduled during this time.';
    }
    pendingOverlapAction = typeof onAddAnyway === 'function' ? onAddAnyway : null;
    pendingOverlapCancelAction = typeof onCancel === 'function' ? onCancel : null;
    if (overlapWarningModal) {
        overlapWarningModal.classList.add('active');
        activateModalA11y(overlapWarningModal, overlapCancelButton || overlapAddAnywayButton);
    }
}

function closeOverlapWarningModal(options = {}) {
    const { skipCancel = false } = options;
    if (!skipCancel && typeof pendingOverlapCancelAction === 'function') {
        pendingOverlapCancelAction();
    }
    pendingOverlapAction = null;
    pendingOverlapCancelAction = null;
    if (overlapWarningModal) {
        overlapWarningModal.classList.remove('active');
        deactivateModalA11y(overlapWarningModal);
    }
}

if (overlapAddAnywayButton) {
    overlapAddAnywayButton.addEventListener('click', async () => {
        if (typeof pendingOverlapAction === 'function') {
            await pendingOverlapAction();
        }
        closeOverlapWarningModal({ skipCancel: true });
    });
}

if (overlapCancelButton) {
    overlapCancelButton.addEventListener('click', () => closeOverlapWarningModal());
}

function initModalAccessibility() {
    const modals = Array.from(document.querySelectorAll('.modal'));
    modals.forEach((modal) => {
        ensureModalSemantics(modal);
        const observer = new MutationObserver(() => {
            if (modal.classList.contains('active')) activateModalA11y(modal);
            else deactivateModalA11y(modal);
        });
        observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
    });

    document.addEventListener('keydown', (event) => {
        const modal = activeA11yModal;
        if (!modal || !modal.classList.contains('active')) return;
        const content = modal.querySelector('.modal-content');
        if (!content) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeActiveModalViaIntent(modal);
            return;
        }
        if (event.key !== 'Tab') return;
        const focusables = getFocusableElements(content);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const current = document.activeElement;
        if (event.shiftKey && current === first) {
            event.preventDefault();
            last.focus();
            return;
        }
        if (!event.shiftKey && current === last) {
            event.preventDefault();
            first.focus();
        }
    });

    document.addEventListener('click', (event) => {
        const modal = activeA11yModal;
        if (!modal || !modal.classList.contains('active')) return;
        if (event.target === modal) {
            closeActiveModalViaIntent(modal);
        }
    });
}

function isControlledRegionExpanded(region) {
    if (!region) return false;
    if (region.classList.contains('is-hidden')) return false;
    if (region.hasAttribute('hidden')) return false;
    if (region.getAttribute('aria-hidden') === 'true') return false;
    if (
        region.classList.contains('active') ||
        region.classList.contains('open') ||
        region.classList.contains('show') ||
        region.classList.contains('expanded')
    ) {
        return true;
    }
    const computed = window.getComputedStyle(region);
    if (!computed) return false;
    return computed.display !== 'none' && computed.visibility !== 'hidden';
}

function syncAriaExpandedState(control) {
    if (!control) return;
    const controlledId = control.getAttribute('aria-controls');
    if (!controlledId) return;
    const region = document.getElementById(controlledId);
    if (!region) return;
    control.setAttribute('aria-expanded', isControlledRegionExpanded(region) ? 'true' : 'false');
}

function initAriaControls() {
    const controls = Array.from(document.querySelectorAll('[aria-controls]'));
    if (!controls.length) return;

    const controlsById = new Map();
    controls.forEach((control) => {
        const controlledId = control.getAttribute('aria-controls');
        if (!controlledId) return;
        if (!controlsById.has(controlledId)) controlsById.set(controlledId, []);
        controlsById.get(controlledId).push(control);
        syncAriaExpandedState(control);

        control.addEventListener('click', () => {
            setTimeout(() => syncAriaExpandedState(control), 0);
        });
    });

    controlsById.forEach((linkedControls, controlledId) => {
        const region = document.getElementById(controlledId);
        if (!region) return;
        const observer = new MutationObserver(() => {
            linkedControls.forEach((control) => syncAriaExpandedState(control));
        });
        observer.observe(region, { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initModalAccessibility();
        initAriaControls();
    });
} else {
    initModalAccessibility();
    initAriaControls();
}

window.escapeHtml = escapeHtml;
window.showToast = showToast;
window.SelectionManager = SelectionManager;
window.BulkActions = BulkActions;
window.showLoading = showLoading;
window.hideLoading = hideLoading;
window.renderEmptyState = renderEmptyState;
window.runActionExpression = runActionExpression;
window.openConfirmModal = openConfirmModal;
window.closeConfirmModal = closeConfirmModal;
window.openOverlapWarningModal = openOverlapWarningModal;
window.closeOverlapWarningModal = closeOverlapWarningModal;
window.noteHtmlToShareText = noteHtmlToShareText;
window.buildShareTxtFileName = buildShareTxtFileName;
window.buildListShareTextForShare = buildListShareTextForShare;
