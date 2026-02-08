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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModalAccessibility);
} else {
    initModalAccessibility();
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
