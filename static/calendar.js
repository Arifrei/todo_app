// --- Calendar ---

function formatCalendarLabel(dayStr) {
    const d = new Date(dayStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: USER_TIMEZONE });
}

function renderCalendarDayLabel(dayStr) {
    const label = document.getElementById('calendar-day-label');
    if (!label) return;
    if (!dayStr) {
        label.textContent = 'Pick a day';
        return;
    }
    const d = new Date(dayStr + 'T00:00:00');
    if (Number.isNaN(d.getTime())) {
        label.textContent = 'Pick a day';
        return;
    }
    const weekday = d.toLocaleDateString(undefined, { weekday: 'long', timeZone: USER_TIMEZONE });
    const dateText = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: USER_TIMEZONE });
    label.innerHTML = '';
    const weekdayEl = document.createElement('div');
    weekdayEl.className = 'calendar-day-label-weekday';
    weekdayEl.textContent = weekday;
    const dateEl = document.createElement('div');
    dateEl.className = 'calendar-day-label-date';
    dateEl.textContent = dateText;
    label.append(weekdayEl, dateEl);
}

function formatMonthLabel(dateObj) {
    return dateObj.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: USER_TIMEZONE });
}

function getMonthRange(dateObj) {
    const start = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1);
    const end = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0);
    return {
        start,
        end,
        startStr: start.toISOString().slice(0, 10),
        endStr: end.toISOString().slice(0, 10)
    };
}

function setDayControlsEnabled(enabled) {
    const picker = document.getElementById('calendar-date-picker');
    const quickInput = document.getElementById('calendar-quick-input');
    const prevBtn = document.getElementById('calendar-prev-day');
    const nextBtn = document.getElementById('calendar-next-day');
    const todayBtn = document.getElementById('calendar-today-btn');
    if (picker) picker.disabled = !enabled;
    if (quickInput) {
        quickInput.disabled = !enabled;
        quickInput.placeholder = enabled
            ? 'Add item...'
            : 'Pick a day';
    }
    if (prevBtn) prevBtn.disabled = !enabled;
    if (nextBtn) nextBtn.disabled = !enabled;
    if (todayBtn) todayBtn.disabled = false; // keep Today usable as an entry point
}

function showDayView() {
    const view = document.getElementById('calendar-day-view');
    if (view) view.classList.remove('is-hidden');
    calendarState.dayViewOpen = true;
    setDayControlsEnabled(true);
    const searchPanel = document.getElementById('calendar-search-panel');
    if (searchPanel) searchPanel.classList.add('is-hidden');
    hideCalendarSearchResults();
}

function hideDayView() {
    const view = document.getElementById('calendar-day-view');
    if (view) view.classList.add('is-hidden');
    calendarState.dayViewOpen = false;
    calendarState.detailsOpen = false;
    setDayControlsEnabled(false);
    renderCalendarDayLabel('');
}

function returnToMonthView() {
    const monthCard = document.getElementById('calendar-month-card');
    const quickAddPanel = document.getElementById('calendar-quick-add-panel');
    const dayView = document.getElementById('calendar-day-view');

    // Show month card
    if (monthCard) monthCard.classList.remove('is-hidden');

    // Hide quick-add panel
    if (quickAddPanel) quickAddPanel.classList.add('is-hidden');

    // Explicitly hide day view
    if (dayView) dayView.classList.add('is-hidden');

    // Reset calendar state
    calendarState.dayViewOpen = false;
    calendarState.detailsOpen = false;
    resetCalendarSelection();
    setDayControlsEnabled(false);

    // Re-render month view
    renderCalendarMonth();

    // Update URL to remove query parameters
    const url = new URL(window.location);
    url.search = '';
    window.history.pushState({}, '', url);
}

function refreshGroupOptionsFromState() {
    const select = document.getElementById('calendar-group-select');
    if (!select) return;
    const prev = select.value;
    select.innerHTML = '';
    const optNone = document.createElement('option');
    optNone.value = '';
    optNone.textContent = 'Ungrouped';
    select.appendChild(optNone);
    const groups = (calendarState.events || []).filter(ev => ev.is_group).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.title || `Group ${g.id}`;
        select.appendChild(opt);
    });
    if (groups.find(g => String(g.id) === prev)) {
        select.value = prev;
    } else {
        select.value = '';
    }
}

function openCalendarPrompt({ title = 'Input', message = '', defaultValue = '', type = 'text', onSubmit }) {
    const modal = document.getElementById('calendar-prompt-modal');
    const titleEl = document.getElementById('calendar-prompt-title');
    const msgEl = document.getElementById('calendar-prompt-message');
    const input = document.getElementById('calendar-prompt-input');
    const saveBtn = document.getElementById('calendar-prompt-save');
    const cancelBtn = document.getElementById('calendar-prompt-cancel');
    if (!modal || !titleEl || !msgEl || !input || !saveBtn || !cancelBtn) return;

    titleEl.textContent = title;
    msgEl.textContent = message;
    input.type = type;
    input.value = defaultValue || '';
    modal.classList.remove('is-hidden');
    input.focus();
    input.select();

    const close = () => {
        modal.classList.add('is-hidden');
        saveBtn.onclick = null;
        cancelBtn.onclick = null;
        input.onkeydown = null;
        modal.onclick = null;
    };

    saveBtn.onclick = () => {
        const val = input.value;
        close();
        if (typeof onSubmit === 'function') onSubmit(val);
    };
    cancelBtn.onclick = close;
    input.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveBtn.click();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    };
    modal.onclick = (e) => {
        if (e.target === modal) {
            close();
        }
    };
}

function openReminderEditor(ev) {
    openCalendarPrompt({
        title: 'Reminder',
        message: 'Enter 30m, 2h, or 1d before start (leave blank to remove)',
        type: 'text',
        defaultValue: formatReminderMinutes(ev.reminder_minutes_before),
        onSubmit: async (val) => {
            if (val === '' || val === null || val === undefined) {
                await updateCalendarEvent(ev.id, { reminder_minutes_before: null });
                return;
            }
            const minutes = parseReminderMinutesInput(val);
            if (minutes === null || minutes < 0) {
                showToast('Use 30m, 2h, or 1d for reminders.', 'error');
                return;
            }
            await updateCalendarEvent(ev.id, { reminder_minutes_before: minutes });
        }
    });
}

function parseReminderMinutesInput(value) {
    const safeValue = (value === null || value === undefined) ? '' : value;
    const raw = String(safeValue).trim().toLowerCase();
    if (!raw) return null;
    const match = raw.match(/^(\d+)\s*([mhd])?$/);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    const unit = match[2] || 'm';
    const multipliers = { m: 1, h: 60, d: 1440 };
    return amount * multipliers[unit];
}

function formatReminderMinutes(minutes) {
    if (minutes === null || minutes === undefined) return '';
    const total = Number(minutes);
    if (!Number.isFinite(total)) return '';
    if (total % 1440 === 0) return `${total / 1440}d`;
    if (total % 60 === 0) return `${total / 60}h`;
    return `${total}m`;
}

const CALENDAR_MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;

function calendarEscapeHtml(text) {
    if (typeof escapeHtml === 'function') {
        return escapeHtml(text);
    }
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeCalendarLinkHref(rawHref) {
    const href = String(rawHref || '').trim();
    if (!href) return null;
    if (/^https?:\/\//i.test(href)) return href;
    if (/^mailto:/i.test(href)) return href;
    if (href.startsWith('/')) return href;
    return null;
}

function hasCalendarMarkdownLinks(text) {
    CALENDAR_MARKDOWN_LINK_PATTERN.lastIndex = 0;
    return CALENDAR_MARKDOWN_LINK_PATTERN.test(String(text || ''));
}

function renderCalendarLinkedTextHtml(text) {
    const source = String(text || '');
    CALENDAR_MARKDOWN_LINK_PATTERN.lastIndex = 0;
    let html = '';
    let lastIndex = 0;
    let match;
    while ((match = CALENDAR_MARKDOWN_LINK_PATTERN.exec(source)) !== null) {
        html += calendarEscapeHtml(source.slice(lastIndex, match.index));
        const label = calendarEscapeHtml((match[1] || '').trim() || match[2] || '');
        const href = normalizeCalendarLinkHref(match[2]);
        if (!href) {
            html += calendarEscapeHtml(match[0]);
        } else {
            const external = /^https?:\/\//i.test(href) || /^mailto:/i.test(href);
            html += `<a class="calendar-inline-link" href="${calendarEscapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
        }
        lastIndex = match.index + match[0].length;
    }
    html += calendarEscapeHtml(source.slice(lastIndex));
    return html;
}

function setCalendarLinkedText(element, text, options = {}) {
    if (!element) return;
    const {
        stopPropagation = false
    } = options;
    element.innerHTML = renderCalendarLinkedTextHtml(text);
    if (stopPropagation) {
        element.querySelectorAll('a.calendar-inline-link').forEach((anchor) => {
            anchor.addEventListener('click', (event) => {
                event.stopPropagation();
            });
        });
    }
}

function protectCalendarMarkdownLinks(text) {
    const matches = [];
    CALENDAR_MARKDOWN_LINK_PATTERN.lastIndex = 0;
    const maskedText = String(text || '').replace(CALENDAR_MARKDOWN_LINK_PATTERN, (match) => {
        const token = `__CAL_LINK_${matches.length}__`;
        matches.push({ token, match });
        return token;
    });
    return { maskedText, matches };
}

function restoreCalendarMarkdownLinks(text, matches) {
    let restored = String(text || '');
    (matches || []).forEach(({ token, match }) => {
        restored = restored.split(token).join(match);
    });
    return restored;
}

function appendCalendarEditableTitle(titleWrap, options) {
    const {
        getValue,
        placeholder = '',
        ariaLabel = 'Edit title',
        onSave
    } = options || {};
    const currentTitle = String((typeof getValue === 'function' ? getValue() : '') || '');
    if (!hasCalendarMarkdownLinks(currentTitle)) {
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.value = currentTitle;
        titleInput.placeholder = placeholder;
        titleInput.setAttribute('aria-label', ariaLabel);
        titleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                titleInput.blur();
            }
        });
        titleInput.addEventListener('blur', () => {
            const latest = String((typeof getValue === 'function' ? getValue() : '') || '');
            const next = titleInput.value.trim() || latest;
            if (next !== latest && typeof onSave === 'function') {
                onSave(next);
            }
        });
        titleWrap.appendChild(titleInput);
        return;
    }

    const titleRich = document.createElement('div');
    titleRich.className = 'calendar-title-rich calendar-title-rich-editable';
    titleRich.tabIndex = 0;
    titleRich.setAttribute('role', 'button');
    titleRich.setAttribute('aria-label', ariaLabel);
    setCalendarLinkedText(titleRich, currentTitle || placeholder || 'Untitled', { stopPropagation: true });

    const openEditor = () => {
        const latest = String((typeof getValue === 'function' ? getValue() : '') || '');
        openCalendarPrompt({
            title: 'Edit title',
            message: 'Use [text](https://url) to keep links clickable.',
            defaultValue: latest,
            type: 'text',
            onSubmit: (value) => {
                const next = String(value || '').trim() || latest;
                if (next !== latest && typeof onSave === 'function') {
                    onSave(next);
                }
            }
        });
    };

    titleRich.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        openEditor();
    });
    titleRich.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openEditor();
        }
    });
    titleWrap.appendChild(titleRich);
}

function getCalendarNoteListItemUrl(ev) {
    if (!ev || !ev.note_id) return '/notes';
    return `/notes/${ev.note_id}`;
}

function openCalendarNoteListItem(ev) {
    window.location.href = getCalendarNoteListItemUrl(ev);
}

function buildCalendarMovePreviewMeta(ev) {
    const meta = [];
    if (ev && ev.start_time) {
        const start = formatTimeDisplay(ev.start_time);
        const end = ev.end_time ? formatTimeDisplay(ev.end_time) : '';
        meta.push(end ? `${start}-${end}` : start);
    } else {
        meta.push('No time');
    }
    if (ev && ev.is_phase) {
        meta.push('Phase');
    } else if (ev && ev.is_group) {
        meta.push('Group');
    } else if (ev && ev.is_event) {
        meta.push('Event');
    } else {
        meta.push('Task');
    }
    if (ev && ev.status === 'done') meta.push('Done');
    if (ev && ev.status === 'canceled') meta.push('Canceled');
    return meta.join(' - ');
}

function renderCalendarMovePreviewItems(listEl, events) {
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
        meta.textContent = buildCalendarMovePreviewMeta(ev);
        body.appendChild(meta);

        row.appendChild(body);
        listEl.appendChild(row);
    });
}

async function fetchCalendarDayPreviewEvents(dayStr) {
    if (!dayStr) return [];
    const response = await fetch(`/api/calendar/events?day=${encodeURIComponent(dayStr)}`);
    if (response.status === 401) {
        window.location.href = '/select-user';
        return [];
    }
    if (!response.ok) {
        throw new Error('Could not load day preview.');
    }
    const payload = await response.json();
    return Array.isArray(payload) ? payload : [];
}

async function openCalendarMovePreviewModal({ targetDay, movingLabel = '', excludeEventIds = [], onConfirm, confirmLabel = 'Move here' }) {
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

    const initialConfirmText = confirmLabel || confirmBtn.textContent || 'Move here';
    const close = () => {
        modal.classList.remove('active');
        confirmBtn.disabled = false;
        confirmBtn.textContent = initialConfirmText;
        cancelBtn.onclick = null;
        confirmBtn.onclick = null;
        modal.onclick = null;
    };

    titleEl.textContent = `Move to ${formatCalendarLabel(targetDay)}?`;
    movingEl.textContent = movingLabel ? `Moving ${movingLabel}.` : 'Review this day before moving.';
    summaryEl.textContent = 'Loading items for this day...';
    listEl.innerHTML = '<div class="calendar-move-preview-state">Loading...</div>';
    confirmBtn.disabled = true;
    confirmBtn.textContent = initialConfirmText;
    modal.classList.add('active');

    cancelBtn.onclick = close;
    modal.onclick = (e) => {
        if (e.target === modal) close();
    };
    confirmBtn.onclick = async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Moving...';
        try {
            if (typeof onConfirm === 'function') {
                await onConfirm();
            }
            close();
        } catch (error) {
            console.error('Calendar move failed:', error);
            confirmBtn.disabled = false;
            confirmBtn.textContent = initialConfirmText;
        }
    };

    try {
        const rawEvents = await fetchCalendarDayPreviewEvents(targetDay);
        const excluded = new Set(
            (excludeEventIds || [])
                .map((id) => Number(id))
                .filter((id) => Number.isFinite(id))
        );
        const events = rawEvents.filter((ev) => !excluded.has(Number(ev.id)));
        renderCalendarMovePreviewItems(listEl, events);
        summaryEl.textContent = events.length === 1
            ? '1 item is already scheduled on this day.'
            : `${events.length} items are already scheduled on this day.`;
    } catch (error) {
        console.error('Calendar move preview load failed:', error);
        summaryEl.textContent = 'Could not load this day preview. You can still continue.';
        listEl.innerHTML = '<div class="calendar-move-preview-state error">Preview unavailable.</div>';
    }

    confirmBtn.disabled = false;
}

function openCalendarMovePrompt(ev) {
    const currentDay = ev.day || calendarState.selectedDay || '';
    openCalendarPrompt({
        title: 'Move to day',
        message: 'Pick a new date for this item',
        type: 'date',
        defaultValue: currentDay,
        onSubmit: async (val) => {
            if (!val) return;
            const eventId = Number(ev && ev.id);
            const excludeEventIds = (!ev.is_task_link && Number.isFinite(eventId)) ? [eventId] : [];
            const movingLabel = ev && ev.title ? `"${ev.title}"` : 'this item';
            await openCalendarMovePreviewModal({
                targetDay: val,
                movingLabel,
                excludeEventIds,
                onConfirm: async () => {
                    if (ev.is_task_link && ev.task_id) {
                        await updateLinkedTaskDueDate(ev.task_id, val);
                        await loadCalendarDay(calendarState.selectedDay);
                        if (calendarState.monthCursor) await loadCalendarMonth();
                        return;
                    }
                    await updateCalendarEvent(ev.id, { day: val }, { skipReload: false, skipMonth: false });
                }
            });
        }
    });
}

async function setCalendarDay(dayStr, options = {}) {
    const { skipLoad = false, skipLabel = false } = options;
    calendarState.selectedDay = dayStr;
    resetCalendarSelection();
    const label = document.getElementById('calendar-day-label');
    const picker = document.getElementById('calendar-date-picker');
    if (!skipLabel) {
        if (label) renderCalendarDayLabel(dayStr);
        if (picker) picker.value = dayStr;
    }
    renderCalendarMonth(); // keep the month grid highlight in sync
    if (!skipLoad && calendarState.dayViewOpen && calendarState.detailsOpen) {
        await loadCalendarDay(dayStr);
    }
}

async function setCalendarMonth(anchorDate) {
    const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    calendarState.monthCursor = monthStart;
    await loadCalendarMonth();
}

async function loadCalendarMonth() {
    const grid = document.getElementById('calendar-month-grid');
    const label = document.getElementById('calendar-month-label');
    if (!grid) return;
    const range = getMonthRange(calendarState.monthCursor || new Date());
    if (label) label.textContent = formatMonthLabel(calendarState.monthCursor || new Date());
    try {
        const res = await fetch(`/api/calendar/events?start=${range.startStr}&end=${range.endStr}`);
        if (res.status === 401) {
            window.location.href = '/select-user';
            return;
        }
        if (!res.ok) throw new Error('Failed to load month');
        const data = await res.json();
        calendarState.monthEventsByDay = data.events || {};
        renderCalendarMonth();
    } catch (err) {
        grid.innerHTML = `<div class="calendar-month-error">Could not load month.</div>`;
        console.error(err);
    }
}

function renderCalendarMonth() {
    const grid = document.getElementById('calendar-month-grid');
    const label = document.getElementById('calendar-month-label');
    if (!grid || !calendarState.monthCursor) return;
    if (label) label.textContent = formatMonthLabel(calendarState.monthCursor);

    const todayStr = new Date().toISOString().slice(0, 10);
    const range = getMonthRange(calendarState.monthCursor);
    const startDayOfWeek = range.start.getDay();
    const daysInMonth = range.end.getDate();
    grid.innerHTML = '';

    for (let i = 0; i < startDayOfWeek; i++) {
        const pad = document.createElement('div');
        pad.className = 'calendar-month-cell pad';
        grid.appendChild(pad);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateObj = new Date(calendarState.monthCursor.getFullYear(), calendarState.monthCursor.getMonth(), day);
        const dateStr = dateObj.toISOString().slice(0, 10);
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'calendar-month-cell';
        if (dateStr === todayStr) cell.classList.add('today');
        if (calendarState.selectedDay === dateStr) cell.classList.add('selected');

        const header = document.createElement('div');
        header.className = 'calendar-month-cell-header';
        header.innerHTML = `<span class="day-number">${day}</span>`;
        cell.appendChild(header);

        const eventsWrap = document.createElement('div');
        eventsWrap.className = 'calendar-month-events';
        const eventsForDay = (calendarState.monthEventsByDay || {})[dateStr] || [];
        const previews = eventsForDay.slice(0, 3);
        previews.forEach(ev => {
            const row = document.createElement('div');
            row.className = `calendar-month-event ${ev.is_phase ? 'phase' : ''} ${ev.status === 'done' ? 'done' : ''} ${ev.status === 'canceled' ? 'canceled' : ''}`;
            const time = ev.start_time ? formatTimeDisplay(ev.start_time) + (ev.end_time ? `-${formatTimeDisplay(ev.end_time)}` : '') : '';
            row.innerHTML = `
                <span class="dot priority-${ev.priority || 'medium'}"></span>
                <span class="title">${time ? time + ' · ' : ''}${ev.title || ''}</span>
            `;
            const titleEl = row.querySelector('.title');
            if (titleEl) {
                const timePrefix = time ? `${calendarEscapeHtml(time)} &middot; ` : '';
                titleEl.innerHTML = `${timePrefix}${renderCalendarLinkedTextHtml(ev.title || '')}`;
            }
            eventsWrap.appendChild(row);
        });
        if (eventsForDay.length > previews.length) {
            const more = document.createElement('div');
            more.className = 'calendar-month-more';
            more.textContent = `+${eventsForDay.length - previews.length} more`;
            eventsWrap.appendChild(more);
        }
        if (!eventsForDay.length) {
            const hint = document.createElement('div');
            hint.className = 'calendar-month-hint';
            hint.textContent = '—';
            eventsWrap.appendChild(hint);
        }
        cell.appendChild(eventsWrap);

        let clickTimer = null;
        cell.addEventListener('click', () => {
            if (clickTimer) {
                clearTimeout(clickTimer);
                clickTimer = null;
            }
            clickTimer = setTimeout(() => {
                clickTimer = null;
                selectDayForQuickAdd(dateStr);
            }, 200);
        });
        cell.addEventListener('dblclick', (e) => {
            e.preventDefault();
            if (clickTimer) {
                clearTimeout(clickTimer);
                clickTimer = null;
            }
            navigateToDayPage(dateStr);
        });
        grid.appendChild(cell);
    }
}

async function loadCalendarDay(dayStr) {
    const container = document.getElementById('calendar-events');
    if (!container) return;
    if (!dayStr || !calendarState.detailsOpen) {
        container.innerHTML = `<div class="calendar-empty">Pick a day to see the schedule.</div>`;
        return;
    }
    try {
        const res = await fetch(`/api/calendar/events?day=${dayStr}`);
        if (res.status === 401) {
            window.location.href = '/select-user';
            return;
        }
        if (!res.ok) throw new Error('Failed to load events');
        calendarState.events = await res.json();
        renderCalendarEvents();
        scheduleLocalReminders();
    } catch (err) {
        container.innerHTML = `<div class="calendar-empty">Could not load events.</div>`;
        console.error(err);
    }
}

function ensureMonthMatchesSelectedDay() {
    if (!calendarState.selectedDay || !calendarState.monthCursor) return;
    const selectedDate = new Date(calendarState.selectedDay + 'T00:00:00');
    if (
        selectedDate.getFullYear() !== calendarState.monthCursor.getFullYear() ||
        selectedDate.getMonth() !== calendarState.monthCursor.getMonth()
    ) {
        setCalendarMonth(selectedDate);
    } else {
        renderCalendarMonth();
    }
}

function formatTimeDisplay(timeStr) {
    if (!timeStr) return '';
    const parts = timeStr.split(':').map(Number);
    const hour = parts[0] || 0;
    const minute = parts[1] || 0;
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = ((hour + 11) % 12) + 1;
    return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`;
}

function hideCalendarSearchResults() {
    const resultsEl = document.getElementById('calendar-search-results');
    if (resultsEl) resultsEl.classList.add('is-hidden');
}

function clearCalendarSearch() {
    calendarSearchState.query = '';
    calendarSearchState.results = [];
    calendarSearchState.loading = false;
    if (calendarSearchState.debounceTimer) {
        clearTimeout(calendarSearchState.debounceTimer);
        calendarSearchState.debounceTimer = null;
    }
    renderCalendarSearchResults();
}

function scheduleCalendarSearch(query) {
    if (calendarSearchState.debounceTimer) {
        clearTimeout(calendarSearchState.debounceTimer);
    }
    calendarSearchState.debounceTimer = setTimeout(() => {
        runCalendarSearch(query);
    }, 250);
}

async function runCalendarSearch(query) {
    const trimmed = String(query || '').trim();
    if (trimmed.length < 2) {
        calendarSearchState.results = [];
        calendarSearchState.loading = false;
        renderCalendarSearchResults();
        return;
    }
    const token = ++calendarSearchState.requestToken;
    calendarSearchState.loading = true;
    renderCalendarSearchResults();
    try {
        const res = await fetch(`/api/calendar/search?q=${encodeURIComponent(trimmed)}`);
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        if (token !== calendarSearchState.requestToken) return;
        calendarSearchState.results = Array.isArray(data.results) ? data.results : [];
    } catch (err) {
        if (token !== calendarSearchState.requestToken) return;
        calendarSearchState.results = [];
        console.error(err);
    } finally {
        if (token === calendarSearchState.requestToken) {
            calendarSearchState.loading = false;
            renderCalendarSearchResults();
        }
    }
}

function setCalendarSearchQuery(value) {
    calendarSearchState.query = String(value || '');
    const trimmed = calendarSearchState.query.trim();
    if (trimmed.length < 2) {
        calendarSearchState.results = [];
        calendarSearchState.loading = false;
        renderCalendarSearchResults();
        return;
    }
    scheduleCalendarSearch(trimmed);
}

function renderCalendarSearchResults() {
    const resultsEl = document.getElementById('calendar-search-results');
    const input = document.getElementById('calendar-search-input');
    const clearBtn = document.getElementById('calendar-search-clear');
    if (!resultsEl) return;
    const query = String(calendarSearchState.query || '').trim();

    if (clearBtn) {
        clearBtn.classList.toggle('is-hidden', !query);
    }
    if (input && input.value !== calendarSearchState.query) {
        input.value = calendarSearchState.query;
    }

    if (query.length < 2) {
        resultsEl.innerHTML = '';
        resultsEl.classList.add('is-hidden');
        return;
    }

    if (calendarSearchState.loading) {
        resultsEl.innerHTML = `<div class="calendar-search-empty">Searching...</div>`;
        resultsEl.classList.remove('is-hidden');
        return;
    }

    const results = calendarSearchState.results || [];
    if (!results.length) {
        resultsEl.innerHTML = `<div class="calendar-search-empty">No matches found.</div>`;
        resultsEl.classList.remove('is-hidden');
        return;
    }

    const itemsHtml = results.map((item) => {
        const title = escapeHtml(item.title || '');
        const dayText = item.day ? formatCalendarLabel(item.day) : 'No date';
        const timeText = item.start_time
            ? `${formatTimeDisplay(item.start_time)}${item.end_time ? `–${formatTimeDisplay(item.end_time)}` : ''}`
            : '';
        let typeLabel = item.type === 'task' ? 'Task' : 'Event';
        if (item.is_phase) typeLabel = 'Phase';
        if (item.is_group) typeLabel = 'Group';
        if (item.is_event) typeLabel = 'Event';
        const metaBits = [dayText, timeText, typeLabel, item.task_list_title].filter(Boolean);
        const metaText = escapeHtml(metaBits.join(' • '));
        const dayAttr = escapeHtml(item.day || '');
        const idAttr = escapeHtml(String(item.calendar_event_id || item.id || ''));
        const typeAttr = escapeHtml(String(item.type || ''));
        return `
            <button class="calendar-search-item" type="button" data-day="${dayAttr}" data-id="${idAttr}" data-type="${typeAttr}">
                <div class="calendar-search-item-title">${title}</div>
                <div class="calendar-search-item-meta">${metaText}</div>
            </button>
        `;
    }).join('');

    resultsEl.innerHTML = itemsHtml;
    resultsEl.classList.remove('is-hidden');
}

// --- Calendar Time Modal ---

function openCalendarTimeModal(ev) {
    const modal = document.getElementById('calendar-time-modal');
    const title = document.getElementById('calendar-time-title');
    const startInput = document.getElementById('calendar-time-start');
    const endInput = document.getElementById('calendar-time-end');
    const reminderInput = document.getElementById('calendar-time-reminder');
    if (!modal || !startInput || !endInput || !reminderInput) return;
    timeModalState.eventId = ev.id;
    if (title) title.textContent = ev.title || 'Calendar item';
    const normalize = (t) => {
        if (!t) return '';
        const friendly = formatTimeDisplay(String(t));
        if (friendly) return friendly; // e.g., 6:10 PM
        const parts = String(t).split(':');
        if (parts.length >= 2) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
        return String(t);
    };
    startInput.value = normalize(ev.start_time);
    endInput.value = normalize(ev.end_time);
    reminderInput.value = formatReminderMinutes(ev.reminder_minutes_before);
    modal.classList.add('active');
}

function closeCalendarTimeModal() {
    const modal = document.getElementById('calendar-time-modal');
    if (modal) modal.classList.remove('active');
    timeModalState.eventId = null;
    const reminderInput = document.getElementById('calendar-time-reminder');
    if (reminderInput) reminderInput.value = '';
}

async function saveCalendarTimeModal() {
    if (!timeModalState.eventId) return;
    const startInput = document.getElementById('calendar-time-start');
    const endInput = document.getElementById('calendar-time-end');
    const reminderInput = document.getElementById('calendar-time-reminder');
    const startVal = startInput ? startInput.value.trim() : '';
    const endVal = endInput ? endInput.value.trim() : '';
    const reminderRaw = reminderInput ? reminderInput.value.trim() : '';
    const reminderMinutes = reminderRaw ? parseReminderMinutesInput(reminderRaw) : null;
    if (reminderRaw && reminderMinutes === null) {
        showToast('Use 30m, 2h, or 1d for reminders.', 'error');
        return;
    }
    await updateCalendarEvent(timeModalState.eventId, {
        start_time: startVal || null,
        end_time: endVal || null,
        reminder_minutes_before: reminderMinutes
    });
    closeCalendarTimeModal();
}

function updateRecurringFieldVisibility() {
    const freqEl = document.getElementById('calendar-recurring-frequency');
    const unitEl = document.getElementById('calendar-recurring-interval-unit');
    const daysRow = document.getElementById('calendar-recurring-days-row');
    const monthRow = document.getElementById('calendar-recurring-month-row');
    const weekdayRow = document.getElementById('calendar-recurring-weekday-row');
    const yearRow = document.getElementById('calendar-recurring-year-row');
    const customRow = document.getElementById('calendar-recurring-custom-row');
    if (!freqEl) return;
    const freq = freqEl.value;
    const unit = unitEl ? unitEl.value : 'days';
    const showCustom = freq === 'custom';
    const showDays = freq === 'weekly' || freq === 'biweekly' || (showCustom && unit === 'weeks');
    const showMonth = freq === 'monthly' || freq === 'yearly' || (showCustom && (unit === 'months' || unit === 'years'));
    const showWeekday = freq === 'monthly_weekday';
    const showYear = freq === 'yearly' || (showCustom && unit === 'years');
    if (customRow) customRow.classList.toggle('is-hidden', !showCustom);
    if (daysRow) daysRow.classList.toggle('is-hidden', !showDays);
    if (monthRow) monthRow.classList.toggle('is-hidden', !showMonth || showWeekday);
    if (weekdayRow) weekdayRow.classList.toggle('is-hidden', !showWeekday);
    if (yearRow) yearRow.classList.toggle('is-hidden', !showYear);
}

function openRecurringModal() {
    const modal = document.getElementById('calendar-recurring-modal');
    if (!modal) return;
    // Show list view by default
    showRecurringListView();
    loadRecurringList();
    modal.classList.add('active');
    recurringModalState.open = true;
}

function closeRecurringModal() {
    const modal = document.getElementById('calendar-recurring-modal');
    if (modal) modal.classList.remove('active');
    recurringModalState.open = false;
}

function showRecurringListView() {
    const listView = document.getElementById('recurring-list-view');
    const formView = document.getElementById('recurring-form-view');
    if (listView) listView.classList.remove('is-hidden');
    if (formView) formView.classList.add('is-hidden');
}

function showRecurringFormView(editItem = null) {
    const listView = document.getElementById('recurring-list-view');
    const formView = document.getElementById('recurring-form-view');
    const formTitle = document.getElementById('recurring-form-title');
    const editIdInput = document.getElementById('calendar-recurring-edit-id');
    const modal = document.getElementById('calendar-recurring-modal');

    if (listView) listView.classList.add('is-hidden');
    if (formView) formView.classList.remove('is-hidden');

    // Reset form
    const titleInput = document.getElementById('calendar-recurring-title');
    const startDayInput = document.getElementById('calendar-recurring-start-day');
    const startTimeInput = document.getElementById('calendar-recurring-start-time');
    const endTimeInput = document.getElementById('calendar-recurring-end-time');
    const reminderInput = document.getElementById('calendar-recurring-reminder');
    const rolloverInput = document.getElementById('calendar-recurring-rollover');
    const typeInput = document.getElementById('calendar-recurring-type');
    const priorityInput = document.getElementById('calendar-recurring-priority');
    const freqEl = document.getElementById('calendar-recurring-frequency');
    const intervalEl = document.getElementById('calendar-recurring-interval');
    const unitEl = document.getElementById('calendar-recurring-interval-unit');
    const dayOfMonthEl = document.getElementById('calendar-recurring-day-of-month');
    const monthEl = document.getElementById('calendar-recurring-month');
    const weekOfMonthEl = document.getElementById('calendar-recurring-week-of-month');
    const weekdayOfMonthEl = document.getElementById('calendar-recurring-weekday-of-month');

    const setWeekdayDefaults = (dateObj) => {
        const weekday = (dateObj.getDay() + 6) % 7;
        const firstOfMonth = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1);
        const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
        const firstOccurrence = 1 + ((weekday - firstWeekday + 7) % 7);
        const ordinal = Math.floor((dateObj.getDate() - firstOccurrence) / 7) + 1;
        if (weekOfMonthEl) weekOfMonthEl.value = String(ordinal);
        if (weekdayOfMonthEl) weekdayOfMonthEl.value = String(weekday);
    };

    if (editItem) {
        // Edit mode
        if (formTitle) formTitle.textContent = 'Edit Recurring Item';
        if (editIdInput) editIdInput.value = editItem.id;
        if (titleInput) titleInput.value = editItem.title || '';
        if (typeInput) typeInput.value = editItem.is_event ? 'event' : 'task';
        if (startDayInput) startDayInput.value = editItem.start_day || '';
        if (startTimeInput) startTimeInput.value = editItem.start_time || '';
        if (endTimeInput) endTimeInput.value = editItem.end_time || '';
        if (priorityInput) priorityInput.value = editItem.priority || 'medium';
        if (rolloverInput) rolloverInput.checked = editItem.rollover_enabled;
        if (freqEl) freqEl.value = editItem.frequency || 'daily';
        if (intervalEl) intervalEl.value = editItem.interval || 1;
        if (unitEl) unitEl.value = editItem.interval_unit || 'days';
        if (dayOfMonthEl) dayOfMonthEl.value = editItem.day_of_month || '';
        if (monthEl) monthEl.value = editItem.month_of_year || '';
        if (weekOfMonthEl) weekOfMonthEl.value = editItem.week_of_month || '';
        if (weekdayOfMonthEl) weekdayOfMonthEl.value = (editItem.weekday_of_month !== null && editItem.weekday_of_month !== undefined)
            ? String(editItem.weekday_of_month)
            : '';
        // Reminder
        if (reminderInput) {
            if (editItem.reminder_minutes_before) {
                const mins = editItem.reminder_minutes_before;
                if (mins >= 1440 && mins % 1440 === 0) {
                    reminderInput.value = `${mins / 1440}d`;
                } else if (mins >= 60 && mins % 60 === 0) {
                    reminderInput.value = `${mins / 60}h`;
                } else {
                    reminderInput.value = `${mins}m`;
                }
            } else {
                reminderInput.value = '';
            }
        }
        // Days of week
        if (modal) {
            modal.querySelectorAll('#calendar-recurring-days-row input[type="checkbox"]').forEach(cb => {
                cb.checked = editItem.days_of_week && editItem.days_of_week.includes(Number(cb.value));
            });
        }
        if ((weekOfMonthEl && !weekOfMonthEl.value) || (weekdayOfMonthEl && !weekdayOfMonthEl.value)) {
            if (editItem.start_day) {
                const dateObj = new Date(`${editItem.start_day}T00:00:00`);
                if (!Number.isNaN(dateObj.valueOf())) {
                    setWeekdayDefaults(dateObj);
                }
            }
        }
    } else {
        // Add mode
        if (formTitle) formTitle.textContent = 'Add Recurring Item';
        if (editIdInput) editIdInput.value = '';
        if (titleInput) titleInput.value = '';
        if (typeInput) typeInput.value = 'task';
        if (startTimeInput) startTimeInput.value = '';
        if (endTimeInput) endTimeInput.value = '';
        if (reminderInput) reminderInput.value = '';
        if (rolloverInput) rolloverInput.checked = true;
        if (priorityInput) priorityInput.value = 'medium';
        if (freqEl) freqEl.value = 'daily';
        if (intervalEl) intervalEl.value = '1';
        if (unitEl) unitEl.value = 'days';
        const todayStr = calendarState.selectedDay || new Date().toISOString().slice(0, 10);
        if (startDayInput) startDayInput.value = todayStr;
        const dateObj = new Date(`${todayStr}T00:00:00`);
        if (dayOfMonthEl) dayOfMonthEl.value = dateObj.getDate();
        if (monthEl) monthEl.value = String(dateObj.getMonth() + 1);
        setWeekdayDefaults(dateObj);
        const dow = (dateObj.getDay() + 6) % 7;
        if (modal) {
            modal.querySelectorAll('#calendar-recurring-days-row input[type="checkbox"]').forEach(cb => {
                cb.checked = Number(cb.value) === dow;
            });
        }
    }
    updateRecurringFieldVisibility();
}

async function loadRecurringList() {
    const listEl = document.getElementById('recurring-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="recurring-empty">Loading...</div>';

    try {
        const res = await fetch('/api/calendar/recurring');
        if (!res.ok) throw new Error('Failed to load');
        const items = await res.json();
        window.recurringItemsCache = items;
        renderRecurringList(items);
    } catch (e) {
        console.error('Error loading recurring items:', e);
        listEl.innerHTML = '<div class="recurring-empty">Failed to load recurring items.</div>';
    }
}

function renderRecurringList(items) {
    const listEl = document.getElementById('recurring-list');
    if (!listEl) return;

    if (!items || items.length === 0) {
        listEl.innerHTML = '<div class="recurring-empty">No recurring items yet.<br>Click "Add New" to create one.</div>';
        return;
    }

    const freqLabels = {
        daily: 'Daily',
        weekly: 'Weekly',
        biweekly: 'Bi-weekly',
        monthly: 'Monthly',
        monthly_weekday: 'Monthly (nth weekday)',
        yearly: 'Yearly',
        custom: 'Custom'
    };
    const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function dayLabelFromStartDay(startDay) {
        if (!startDay) return null;
        const date = new Date(`${startDay}T00:00:00`);
        if (Number.isNaN(date.valueOf())) return null;
        const jsDay = date.getDay(); // 0=Sun..6=Sat
        const mondayIndex = (jsDay + 6) % 7;
        return weekdayLabels[mondayIndex];
    }

    function formatDaysOfWeek(item) {
        let days = Array.isArray(item.days_of_week) ? item.days_of_week : [];
        if (!days.length) {
            const fallback = dayLabelFromStartDay(item.start_day);
            return fallback ? fallback : '';
        }
        const labels = days
            .filter(d => d >= 0 && d <= 6)
            .map(d => weekdayLabels[d]);
        return labels.join(', ');
    }

    function formatDayOfMonth(item) {
        let dom = item.day_of_month;
        if (!dom && item.start_day) {
            const date = new Date(`${item.start_day}T00:00:00`);
            if (!Number.isNaN(date.valueOf())) {
                dom = date.getDate();
            }
        }
        return dom ? `Day ${dom}` : '';
    }

    function formatYearly(item) {
        let month = item.month_of_year;
        let dom = item.day_of_month;
        if ((!month || !dom) && item.start_day) {
            const date = new Date(`${item.start_day}T00:00:00`);
            if (!Number.isNaN(date.valueOf())) {
                if (!month) month = date.getMonth() + 1;
                if (!dom) dom = date.getDate();
            }
        }
        if (!month || !dom) return '';
        return `${monthLabels[month - 1]} ${dom}`;
    }

    function formatMonthlyWeekday(item) {
        let week = item.week_of_month;
        let weekday = item.weekday_of_month;
        if ((week === null || week === undefined || weekday === null || weekday === undefined) && item.start_day) {
            const date = new Date(`${item.start_day}T00:00:00`);
            if (!Number.isNaN(date.valueOf())) {
                weekday = (date.getDay() + 6) % 7;
                const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
                const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
                const firstOccurrence = 1 + ((weekday - firstWeekday + 7) % 7);
                week = Math.floor((date.getDate() - firstOccurrence) / 7) + 1;
            }
        }
        if (!week && week !== 0) return '';
        if (weekday === null || weekday === undefined) return '';
        const suffix = ['th', 'st', 'nd', 'rd'][week] || 'th';
        const weekLabel = `${week}${suffix}`;
        return `${weekLabel} ${weekdayLabels[weekday]}`;
    }

    listEl.innerHTML = items.map(item => {
        const typeClass = item.is_event ? 'event' : '';
        const typeLabel = item.is_event ? 'Event' : 'Task';
        const freqLabel = freqLabels[item.frequency] || item.frequency;
        const detailParts = [freqLabel];
        let dayDetail = '';
        if (item.frequency === 'weekly' || item.frequency === 'biweekly') {
            dayDetail = formatDaysOfWeek(item);
        } else if (item.frequency === 'monthly') {
            dayDetail = formatDayOfMonth(item);
        } else if (item.frequency === 'monthly_weekday') {
            dayDetail = formatMonthlyWeekday(item);
        } else if (item.frequency === 'yearly') {
            dayDetail = formatYearly(item);
        } else if (item.frequency === 'custom') {
            if (item.interval_unit === 'weeks') {
                dayDetail = formatDaysOfWeek(item);
            } else if (item.interval_unit === 'months') {
                dayDetail = formatDayOfMonth(item);
            } else if (item.interval_unit === 'years') {
                dayDetail = formatYearly(item);
            }
        }
        if (dayDetail) detailParts.push(dayDetail);
        const reminderOn = item.reminder_minutes_before !== null && item.reminder_minutes_before !== undefined;
        const reminderTitle = reminderOn ? 'Reminder on' : 'Reminder off';
        const reminderIcon = reminderOn ? 'fa-bell' : 'fa-bell-slash';
        return `
            <div class="recurring-item" data-id="${item.id}">
                <div class="recurring-item-info">
                    <div class="recurring-item-title">${escapeHtml(item.title)}</div>
                    <div class="recurring-item-meta">
                        <span class="recurring-item-type ${typeClass}">${typeLabel}</span>
                        <span class="recurring-item-details">${detailParts.join(' | ')}</span>
                        <span class="recurring-item-reminder ${reminderOn ? 'on' : 'off'}" title="${reminderTitle}">
                            <i class="fa-solid ${reminderIcon}"></i>
                        </span>
                    </div>
                </div>
                <div class="recurring-item-actions">
                    <button class="btn-icon" type="button" onclick="editRecurringItem(${item.id})" title="Edit" aria-label="Edit recurring item">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn-icon btn-danger" type="button" onclick="deleteRecurringItem(${item.id})" title="Delete" aria-label="Delete recurring item">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function editRecurringItem(id) {
    const items = window.recurringItemsCache || [];
    const item = items.find(i => i.id === id);
    if (item) {
        showRecurringFormView(item);
    } else {
        // Fetch fresh if not in cache
        try {
            const res = await fetch('/api/calendar/recurring');
            if (!res.ok) throw new Error('Failed to load');
            const freshItems = await res.json();
            window.recurringItemsCache = freshItems;
            const freshItem = freshItems.find(i => i.id === id);
            if (freshItem) {
                showRecurringFormView(freshItem);
            }
        } catch (e) {
            console.error('Error loading recurring item:', e);
            showToast('Could not load item for editing.', 'error');
        }
    }
}

function deleteRecurringItem(id) {
    openConfirmModal('Delete this recurring item? This will also remove all generated instances.', async () => {
        try {
            const res = await fetch(`/api/calendar/recurring/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete');
            await loadRecurringList();
            await loadCalendarMonth();
            if (calendarState.selectedDay) {
                await loadCalendarDay(calendarState.selectedDay);
            }
        } catch (e) {
            console.error('Error deleting recurring item:', e);
            showToast('Could not delete recurring item.', 'error');
        }
    });
}

async function saveRecurringModal() {
    const editIdInput = document.getElementById('calendar-recurring-edit-id');
    const editId = editIdInput ? editIdInput.value : '';
    const isEdit = !!editId;

    const titleInput = document.getElementById('calendar-recurring-title');
    const typeInput = document.getElementById('calendar-recurring-type');
    const startDayInput = document.getElementById('calendar-recurring-start-day');
    const startTimeInput = document.getElementById('calendar-recurring-start-time');
    const endTimeInput = document.getElementById('calendar-recurring-end-time');
    const reminderInput = document.getElementById('calendar-recurring-reminder');
    const rolloverInput = document.getElementById('calendar-recurring-rollover');
    const priorityInput = document.getElementById('calendar-recurring-priority');
    const freqEl = document.getElementById('calendar-recurring-frequency');
    const intervalEl = document.getElementById('calendar-recurring-interval');
    const unitEl = document.getElementById('calendar-recurring-interval-unit');
    const dayOfMonthEl = document.getElementById('calendar-recurring-day-of-month');
    const monthEl = document.getElementById('calendar-recurring-month');
    const weekOfMonthEl = document.getElementById('calendar-recurring-week-of-month');
    const weekdayOfMonthEl = document.getElementById('calendar-recurring-weekday-of-month');

    const title = titleInput ? titleInput.value.trim() : '';
    if (!title) {
        showToast('Title is required.', 'warning');
        return;
    }
    const freq = freqEl ? freqEl.value : 'daily';
    const startDay = (startDayInput && startDayInput.value) ? startDayInput.value : calendarState.selectedDay;
    const reminderRaw = reminderInput ? reminderInput.value.trim() : '';
    const reminderMinutes = reminderRaw ? parseReminderMinutesInput(reminderRaw) : null;
    if (reminderRaw && reminderMinutes === null) {
        showToast('Use 30m, 2h, or 1d for reminders.', 'warning');
        return;
    }
    const payload = {
        title,
        day: startDay,
        start_time: startTimeInput ? startTimeInput.value.trim() || null : null,
        end_time: endTimeInput ? endTimeInput.value.trim() || null : null,
        reminder_minutes_before: reminderMinutes,
        rollover_enabled: rolloverInput ? rolloverInput.checked : false,
        priority: priorityInput ? priorityInput.value : 'medium',
        frequency: freq,
        is_event: typeInput ? typeInput.value === 'event' : false
    };

    if (freq === 'weekly' || freq === 'biweekly' || (freq === 'custom' && unitEl && unitEl.value === 'weeks')) {
        const days = [];
        document.querySelectorAll('#calendar-recurring-days-row input[type="checkbox"]:checked').forEach(cb => {
            days.push(Number(cb.value));
        });
        payload.days_of_week = days;
    }
    if (freq === 'monthly' || freq === 'yearly' || (freq === 'custom' && unitEl && (unitEl.value === 'months' || unitEl.value === 'years'))) {
        payload.day_of_month = (dayOfMonthEl && dayOfMonthEl.value) ? Number(dayOfMonthEl.value) : null;
    }
    if (freq === 'monthly_weekday') {
        payload.week_of_month = (weekOfMonthEl && weekOfMonthEl.value) ? Number(weekOfMonthEl.value) : null;
        payload.weekday_of_month = (weekdayOfMonthEl && weekdayOfMonthEl.value) ? Number(weekdayOfMonthEl.value) : null;
    }
    if (freq === 'yearly' || (freq === 'custom' && unitEl && unitEl.value === 'years')) {
        payload.month_of_year = (monthEl && monthEl.value) ? Number(monthEl.value) : null;
    }
    if (freq === 'custom') {
        payload.interval = intervalEl ? Number(intervalEl.value || '1') : 1;
        payload.interval_unit = unitEl ? unitEl.value : 'days';
    }

    const persistRecurring = async () => {
        const url = isEdit ? `/api/calendar/recurring/${editId}` : '/api/calendar/recurring';
        const method = isEdit ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showToast(data.error || `Could not ${isEdit ? 'update' : 'create'} recurring item.`, 'error');
            return;
        }
        // Go back to list view and refresh
        showRecurringListView();
        await loadRecurringList();
        if (calendarState.selectedDay) {
            await loadCalendarDay(calendarState.selectedDay);
        }
        await loadCalendarMonth();
    };

    if (startDay && typeof openCalendarMovePreviewModal === 'function') {
        const movingLabel = `recurring item "${title}"`;
        await openCalendarMovePreviewModal({
            targetDay: startDay,
            movingLabel,
            confirmLabel: isEdit ? 'Update recurring' : 'Create recurring',
            onConfirm: async () => {
                try {
                    await persistRecurring();
                } catch (e) {
                    console.error(`Error ${isEdit ? 'updating' : 'creating'} recurring item:`, e);
                    showToast(`Could not ${isEdit ? 'update' : 'create'} recurring item.`, 'error');
                    throw e;
                }
            }
        });
        return;
    }

    try {
        await persistRecurring();
    } catch (e) {
        console.error(`Error ${isEdit ? 'updating' : 'creating'} recurring item:`, e);
        showToast(`Could not ${isEdit ? 'update' : 'create'} recurring item.`, 'error');
    }
}

function formatTimeRange(ev) {
    if (!ev.start_time) return '';
    const start = formatTimeDisplay(ev.start_time);
    const end = ev.end_time ? formatTimeDisplay(ev.end_time) : '';
    return end ? `${start} - ${end}` : start;
}

function getCalendarSortMode() {
    return calendarState.daySort || 'time';
}

function parseTimeToMinutes(value) {
    if (!value) return null;
    const parts = String(value).split(':');
    if (!parts.length) return null;
    const hours = parseInt(parts[0], 10);
    const mins = parseInt(parts[1] || '0', 10);
    if (Number.isNaN(hours) || Number.isNaN(mins)) return null;
    return (hours * 60) + mins;
}

function getCalendarDayViewMode() {
    const mode = calendarState.dayViewMode || 'timeline';
    return ['list', 'timeline'].includes(mode) ? mode : 'timeline';
}

function getCalendarDisplayMode(ev) {
    const raw = (ev && ev.display_mode) ? String(ev.display_mode).toLowerCase() : 'both';
    return raw === 'timeline_only' ? 'timeline_only' : 'both';
}

function shouldShowInCalendarList(ev) {
    if (!ev) return false;
    if (ev.is_phase || ev.is_group) return true;
    return getCalendarDisplayMode(ev) !== 'timeline_only';
}

function formatTimelineHourLabel(hour24) {
    const normalized = ((hour24 % 24) + 24) % 24;
    const period = normalized >= 12 ? 'PM' : 'AM';
    const hour = ((normalized + 11) % 12) + 1;
    return `${hour}${period}`;
}

function getTimelineSpanMinutes(ev) {
    const start = parseTimeToMinutes(ev.start_time);
    if (start === null) return null;
    let end = parseTimeToMinutes(ev.end_time);
    if (end === null || end <= start) {
        end = Math.min(start + 30, 24 * 60);
    }
    return { start, end };
}

function placeTimelineItems(items) {
    const placed = [];
    const clusterColumns = {};
    let active = [];
    let clusterId = -1;
    let lastStartHour = null;

    items.forEach((item) => {
        active = active.filter(a => a.end > item.start_minutes);
        const startHour = Math.floor(item.start_minutes / 60);
        // Keep a stable cluster within the same hour so widths stay consistent
        // for items that start in that hour.
        if (!active.length && (startHour !== lastStartHour || clusterId < 0)) {
            clusterId += 1;
        }
        const taken = new Set(active.map(a => a.lane));
        let lane = 0;
        while (taken.has(lane)) lane += 1;
        active.push({ end: item.end_minutes, lane, clusterId });
        const cols = lane + 1;
        clusterColumns[clusterId] = Math.max(clusterColumns[clusterId] || 0, cols);
        placed.push({ ...item, lane, clusterId });
        lastStartHour = startHour;
    });

    return placed.map(item => ({
        ...item,
        overlap_columns: clusterColumns[item.clusterId] || 1
    }));
}

async function openTimelineItemTimeEditor(ev) {
    if (!ev) return;
    if (ev.is_feed_item) {
        const linked = await ensureLinkedFeedEvent(ev);
        if (!linked || !linked.calendar_event_id) return;
        openCalendarTimeModal({ ...linked, id: linked.calendar_event_id });
        return;
    }
    if (ev.is_note_list_item) {
        const linked = await ensureLinkedNoteListEvent(ev);
        if (!linked || !linked.calendar_event_id) return;
        openCalendarTimeModal({ ...linked, id: linked.calendar_event_id });
        return;
    }
    if (ev.is_task_link) {
        const linked = await ensureLinkedTaskEvent(ev);
        if (!linked || !linked.calendar_event_id) return;
        openCalendarTimeModal({ ...linked, id: linked.calendar_event_id });
        return;
    }
    if (ev.is_planner_item) {
        const linked = await ensureLinkedPlannerEvent(ev);
        if (!linked || !linked.calendar_event_id) return;
        openCalendarTimeModal({ ...linked, id: linked.calendar_event_id });
        return;
    }
    openCalendarTimeModal(ev);
}

async function toggleCalendarDisplayMode(ev) {
    if (!ev) return;
    const nextMode = getCalendarDisplayMode(ev) === 'timeline_only' ? 'both' : 'timeline_only';
    if (ev.is_feed_item) {
        const linked = await ensureLinkedFeedEvent(ev);
        if (!linked || !linked.calendar_event_id) return;
        await updateCalendarEvent(linked.calendar_event_id, { display_mode: nextMode });
        ev.display_mode = nextMode;
        return;
    }
    if (ev.is_task_link) {
        const linked = await ensureLinkedTaskEvent(ev);
        if (!linked || !linked.calendar_event_id) return;
        await updateCalendarEvent(linked.calendar_event_id, { display_mode: nextMode });
        ev.display_mode = nextMode;
        return;
    }
    if (ev.is_planner_item) {
        const linked = await ensureLinkedPlannerEvent(ev);
        if (!linked || !linked.calendar_event_id) return;
        await updateCalendarEvent(linked.calendar_event_id, { display_mode: nextMode });
        ev.display_mode = nextMode;
        return;
    }
    if (ev.is_note_list_item) {
        const linked = await ensureLinkedNoteListEvent(ev);
        if (!linked || !linked.calendar_event_id) return;
        await updateCalendarEvent(linked.calendar_event_id, { display_mode: nextMode });
        ev.display_mode = nextMode;
        return;
    }
    await updateCalendarEvent(ev.id, { display_mode: nextMode });
    ev.display_mode = nextMode;
}

function createDisplayModeMenuItem(ev, dropdown) {
    const isTimelineOnly = getCalendarDisplayMode(ev) === 'timeline_only';
    const item = document.createElement('button');
    item.className = 'calendar-item-menu-option';
    item.innerHTML = `<i class="fa-solid fa-chart-column ${isTimelineOnly ? 'active-icon' : ''}"></i> ${isTimelineOnly ? 'Show in list' : 'Timeline only'}`;
    item.onclick = async (e) => {
        e.stopPropagation();
        if (dropdown) dropdown.classList.remove('active');
        await toggleCalendarDisplayMode(ev);
    };
    return item;
}

function renderDayTimelinePanel(allItems) {
    const layout = document.getElementById('calendar-day-layout');
    const wrap = document.getElementById('calendar-timeline-wrap');
    const timelineEl = document.getElementById('calendar-day-timeline');
    const metaEl = document.getElementById('calendar-timeline-meta');
    const unscheduledEl = document.getElementById('calendar-unscheduled-items');
    if (layout) layout.setAttribute('data-view-mode', getCalendarDayViewMode());
    if (!wrap || !timelineEl || !unscheduledEl || !metaEl) return;

    const viewMode = getCalendarDayViewMode();
    const showTimeline = viewMode === 'timeline';
    wrap.classList.toggle('is-hidden', !showTimeline);
    if (!showTimeline) return;

    const setEmptyState = (message) => {
        timelineEl.innerHTML = `<div class="calendar-empty">${message}</div>`;
        unscheduledEl.innerHTML = '';
        metaEl.textContent = '';
    };

    if (!calendarState.selectedDay) {
        setEmptyState('Pick a day to open timeline view.');
        return;
    }
    if (!calendarState.detailsOpen) {
        setEmptyState('Double-click a day to open its full schedule.');
        return;
    }

    const source = Array.isArray(allItems) ? allItems.filter(ev => !ev.is_phase && !ev.is_group) : [];
    if (!source.length) {
        setEmptyState('Nothing planned for this day yet.');
        return;
    }

    const timed = [];
    const unscheduled = [];
    source.forEach((ev) => {
        const span = getTimelineSpanMinutes(ev);
        if (!span) {
            unscheduled.push(ev);
            return;
        }
        timed.push({ ...ev, start_minutes: span.start, end_minutes: span.end });
    });

    timed.sort((a, b) => {
        if (a.start_minutes !== b.start_minutes) return a.start_minutes - b.start_minutes;
        if (a.end_minutes !== b.end_minutes) return a.end_minutes - b.end_minutes;
        return (a.title || '').localeCompare(b.title || '');
    });
    const placed = placeTimelineItems(timed);
    const hourBuckets = new Map();
    placed.forEach((ev) => {
        const hour = Math.floor(ev.start_minutes / 60);
        if (!hourBuckets.has(hour)) hourBuckets.set(hour, []);
        hourBuckets.get(hour).push(ev);
    });
    hourBuckets.forEach((bucket) => {
        bucket.sort((a, b) => {
            if (a.start_minutes !== b.start_minutes) return a.start_minutes - b.start_minutes;
            if (a.end_minutes !== b.end_minutes) return a.end_minutes - b.end_minutes;
            return (a.title || '').localeCompare(b.title || '');
        });
        bucket.forEach((ev, idx) => {
            ev.hour_bucket_count = bucket.length;
            ev.hour_bucket_index = idx;
        });
    });

    const defaultStart = 6 * 60;
    const defaultEnd = 22 * 60;
    const minStart = placed.length ? Math.min(...placed.map(i => i.start_minutes)) : defaultStart;
    const maxEnd = placed.length ? Math.max(...placed.map(i => i.end_minutes)) : defaultEnd;
    const startHour = Math.max(0, Math.floor(Math.min(minStart, defaultStart) / 60));
    const endHour = Math.min(24, Math.ceil(Math.max(maxEnd, defaultEnd) / 60));
    const pixelsPerMinute = 1.3;
    const timelineTopPadding = 14;
    const timelineBottomPadding = 14;
    const timelineHeight = Math.max((endHour - startHour) * 60 * pixelsPerMinute, 320);

    timelineEl.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'calendar-timeline-grid';
    grid.style.height = `${timelineHeight + timelineTopPadding + timelineBottomPadding}px`;
    const track = document.createElement('div');
    track.className = 'calendar-timeline-track';
    grid.appendChild(track);

    for (let hour = startHour; hour <= endHour; hour += 1) {
        const top = timelineTopPadding + ((hour - startHour) * 60 * pixelsPerMinute);
        const label = document.createElement('div');
        label.className = 'calendar-timeline-hour-label';
        label.style.top = `${top}px`;
        label.textContent = formatTimelineHourLabel(hour);
        grid.appendChild(label);

        const line = document.createElement('div');
        line.className = 'calendar-timeline-hour-line';
        line.style.top = `${top}px`;
        track.appendChild(line);
    }

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    if (calendarState.selectedDay === todayStr) {
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        if (nowMinutes >= startHour * 60 && nowMinutes <= endHour * 60) {
            const nowLine = document.createElement('div');
            nowLine.className = 'calendar-timeline-now';
            nowLine.style.top = `${timelineTopPadding + ((nowMinutes - startHour * 60) * pixelsPerMinute)}px`;
            track.appendChild(nowLine);
        }
    }

    placed.forEach((ev) => {
        const block = document.createElement('button');
        block.type = 'button';
        const isTimelineOnly = getCalendarDisplayMode(ev) === 'timeline_only';
        const typeClass = ev.is_event
            ? 'event'
            : (ev.is_task_link
                ? 'task-link'
                : (ev.is_feed_item ? 'feed' : (ev.is_planner_item ? 'planner' : 'task')));
        block.className = `calendar-timeline-block ${typeClass} ${isTimelineOnly ? 'timeline-only' : ''}`;
        const overlapCols = ev.overlap_columns || 1;
        const rawLane = ev.lane || 0;
        const bucketCount = ev.hour_bucket_count || 1;
        const bucketIndex = ev.hour_bucket_index || 0;
        let visualCols = overlapCols;
        let visualLane = rawLane;
        let laneRowOffset = 0;

        // Prefer hour-bucket layout to keep item widths stable when one hour
        // contains many entries.
        if (bucketCount === 2) {
            visualCols = 2;
            visualLane = bucketIndex % 2;
        } else if (bucketCount >= 3) {
            // Dense same-hour schedule: stack full-width rows for readability.
            visualCols = 1;
            visualLane = 0;
            laneRowOffset = bucketIndex * 12;
            block.classList.add('dense');
        } else if (overlapCols >= 3) {
            // Fallback for dense overlap spanning multiple hours.
            visualCols = 1;
            visualLane = 0;
            laneRowOffset = rawLane * 10;
            block.classList.add('dense');
        }

        const durationPx = Math.max((ev.end_minutes - ev.start_minutes) * pixelsPerMinute, 30);
        block.style.top = `${timelineTopPadding + ((ev.start_minutes - startHour * 60) * pixelsPerMinute) + laneRowOffset}px`;
        block.style.height = `${Math.max(durationPx - laneRowOffset, 26)}px`;
        if ((ev.end_minutes - ev.start_minutes) < 20 || bucketCount >= 4 || overlapCols >= 4) {
            block.classList.add('compact');
        }
        const widthPct = 100 / visualCols;
        block.style.left = `calc(${visualLane * widthPct}% + 2px)`;
        block.style.width = `calc(${widthPct}% - 4px)`;
        block.title = `${ev.title || 'Untitled'}${formatTimeRange(ev) ? ` (${formatTimeRange(ev)})` : ''}`;

        const time = document.createElement('span');
        time.className = 'time';
        time.textContent = formatTimeRange(ev) || 'Timed';
        const title = document.createElement('span');
        title.className = 'title';
        setCalendarLinkedText(title, ev.title || 'Untitled', { stopPropagation: true });
        block.append(time, title);
        block.onclick = () => openTimelineItemTimeEditor(ev);
        track.appendChild(block);
    });

    timelineEl.appendChild(grid);
    metaEl.textContent = `${placed.length} timed - ${unscheduled.length} unscheduled`;

    unscheduledEl.innerHTML = '';
    if (!unscheduled.length) {
        unscheduledEl.innerHTML = `<div class="calendar-unscheduled-empty">No unscheduled items.</div>`;
        return;
    }
    unscheduled.forEach((ev) => {
        const row = document.createElement('button');
        row.type = 'button';
        const isTimelineOnly = getCalendarDisplayMode(ev) === 'timeline_only';
        row.className = `calendar-unscheduled-item ${isTimelineOnly ? 'timeline-only' : ''}`;
        const title = document.createElement('span');
        title.className = 'title';
        setCalendarLinkedText(title, ev.title || 'Untitled', { stopPropagation: true });
        const hint = document.createElement('span');
        hint.className = 'hint';
        hint.textContent = isTimelineOnly ? 'timeline only' : 'tap to add time';
        row.append(title, hint);
        row.onclick = () => openTimelineItemTimeEditor(ev);
        unscheduledEl.appendChild(row);
    });
}

function sortCalendarItems(items, mode) {
    const priorityRank = { high: 0, medium: 1, low: 2 };
    const statusRank = { not_started: 0, in_progress: 1, done: 2, canceled: 3 };
    const normalizedMode = mode || 'time';
    const orderIndex = (ev) => (Number.isFinite(ev.order_index) ? ev.order_index : 999999);

    return [...items].sort((a, b) => {
        if (normalizedMode === 'manual') {
            return orderIndex(a) - orderIndex(b);
        }

        if (normalizedMode === 'time') {
            const at = parseTimeToMinutes(a.start_time);
            const bt = parseTimeToMinutes(b.start_time);
            if (at !== null || bt !== null) {
                if (at === null) return 1;
                if (bt === null) return -1;
                if (at !== bt) return at - bt;
            }
        }

        if (normalizedMode === 'priority') {
            const apRaw = priorityRank[a.priority || 'medium'];
            const bpRaw = priorityRank[b.priority || 'medium'];
            const ap = (apRaw === null || apRaw === undefined) ? 3 : apRaw;
            const bp = (bpRaw === null || bpRaw === undefined) ? 3 : bpRaw;
            if (ap !== bp) return ap - bp;
        }

        if (normalizedMode === 'status') {
            const asRaw = statusRank[a.status || 'not_started'];
            const bsRaw = statusRank[b.status || 'not_started'];
            const as = (asRaw === null || asRaw === undefined) ? 3 : asRaw;
            const bs = (bsRaw === null || bsRaw === undefined) ? 3 : bsRaw;
            if (as !== bs) return as - bs;
        }

        const atitle = (a.title || '').toLowerCase();
        const btitle = (b.title || '').toLowerCase();
        if (atitle < btitle) return -1;
        if (atitle > btitle) return 1;
        return orderIndex(a) - orderIndex(b);
    });
}

function renderCalendarEvents() {
    const container = document.getElementById('calendar-events');
    if (!container) return;
    renderDayTimelinePanel(calendarState.events || []);
    const dayViewMode = getCalendarDayViewMode();
    container.classList.toggle('is-hidden', dayViewMode === 'timeline');
    if (dayViewMode === 'timeline') {
        resetCalendarSelection();
        return;
    }
    container.innerHTML = '';
    if (!calendarState.selectedDay) {
        container.innerHTML = `<div class="calendar-empty">Pick a day from the calendar to view its schedule.</div>`;
        resetCalendarSelection();
        return;
    }
    if (!calendarState.detailsOpen) {
        container.innerHTML = `<div class="calendar-empty">Double-click a day to open its full schedule. You can still add quick events once a day is selected.</div>`;
        resetCalendarSelection();
        return;
    }
    if (!calendarState.events || calendarState.events.length === 0) {
        container.innerHTML = `<div class="calendar-empty">Nothing planned for this day. Use the quick add box to start.</div>`;
        resetCalendarSelection();
        return;
    }
    const listEvents = (calendarState.events || []).filter(shouldShowInCalendarList);
    if (!listEvents.length) {
        container.innerHTML = `<div class="calendar-empty">No list items for this day. Use Timeline view or add regular calendar tasks/events.</div>`;
        resetCalendarSelection();
        return;
    }
    const sortMode = getCalendarSortMode();
    const tasksDue = listEvents.filter(ev => ev.is_task_link);
    const timeline = listEvents.filter(ev => !ev.is_task_link);
    const groupMap = new Map();
    const rootItems = [];
    const rootNonGroup = [];

    timeline.forEach(ev => {
        if (ev.is_group) {
            groupMap.set(ev.id, { header: ev, children: [] });
            rootItems.push(ev);
        }
    });

    timeline.forEach(ev => {
        if (ev.is_group) return;
        // Only tasks/phases can be nested under groups (no events)
        if (!ev.is_event && ev.group_id && groupMap.has(ev.group_id)) {
            groupMap.get(ev.group_id).children.push(ev);
        } else {
            rootItems.push(ev);
            rootNonGroup.push(ev);
        }
    });

    const groupsList = sortCalendarItems(timeline.filter(ev => ev.is_group), sortMode);
    groupMap.forEach(group => {
        group.children = sortCalendarItems(group.children, sortMode);
    });

    const phasesAndTasks = [
        ...sortCalendarItems(rootNonGroup.filter(ev => !ev.is_event && !ev.is_group), sortMode),
        ...sortCalendarItems(tasksDue, sortMode)
    ];
    const dayEvents = sortCalendarItems(rootNonGroup.filter(ev => ev.is_event && !ev.is_group), sortMode);

    const renderPhaseOrTask = (ev, isChild = false) => {
        const row = document.createElement('div');
        const doneClass = (!ev.is_phase && ev.status === 'done') ? 'done' : '';
        row.className = `calendar-row ${ev.is_phase ? 'phase' : ''} ${doneClass} ${isChild ? 'child-row' : ''}`;
        row.dataset.id = ev.id;
        row.dataset.groupId = ev.group_id || '';
        row.dataset.type = ev.is_phase ? 'phase' : 'task';

        if (ev.is_task_link) {
            const left = document.createElement('div');
            left.className = 'row-left';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = ev.status === 'done';
            checkbox.onchange = () => updateLinkedTaskStatus(ev.task_id, checkbox.checked ? 'done' : 'not_started');
            left.appendChild(checkbox);

            row.classList.add('task-link-row');
            const titleWrap = document.createElement('div');
            titleWrap.className = 'calendar-title task-link-title';
            const titleText = document.createElement('div');
            titleText.className = 'calendar-title-rich';
            titleText.setAttribute('aria-label', 'Open task');
            setCalendarLinkedText(titleText, ev.title || 'Untitled', { stopPropagation: true });
            titleWrap.appendChild(titleText);
            titleWrap.addEventListener('click', () => {
                window.location.href = `/list/${ev.task_list_id}#item-${ev.task_id}`;
            });

            const timeBtn = document.createElement('button');
            timeBtn.type = 'button';
            timeBtn.className = 'calendar-time-inline';
            const timeLabel = formatTimeRange(ev);
            timeBtn.innerHTML = timeLabel
                ? `<i class="fa-regular fa-clock"></i><span>${timeLabel}</span>`
                : `<i class="fa-regular fa-clock"></i>`;
            if (!timeLabel) {
                timeBtn.classList.add('no-time');
                timeBtn.setAttribute('data-label', 'Add time');
            }
            timeBtn.title = timeLabel || 'Add time';
            timeBtn.onclick = async (e) => {
                e.stopPropagation();
                const linked = await ensureLinkedTaskEvent(ev);
                if (!linked || !linked.calendar_event_id) return;
                openCalendarTimeModal({ ...linked, id: linked.calendar_event_id });
            };
            titleWrap.appendChild(timeBtn);

            const meta = document.createElement('div');
            meta.className = 'calendar-meta-lite';
            const listChip = document.createElement('a');
            listChip.className = 'meta-chip task-link';
            listChip.href = `/list/${ev.task_list_id}#item-${ev.task_id}`;
            listChip.textContent = ev.task_list_title || 'Task list';
            listChip.title = 'Open task';
            meta.append(listChip);
            titleWrap.appendChild(meta);

          const actions = document.createElement('div');
          actions.className = 'calendar-actions-row';
          const noteChips = document.createElement('div');
          noteChips.className = 'calendar-note-chips';
          appendCalendarItemNoteChip(noteChips, ev);
          const priorityDot = document.createElement('button');
          priorityDot.className = `calendar-priority-dot priority-${ev.priority || 'medium'}`;
        priorityDot.title = `Priority: ${(ev.priority || 'medium')}`;
        priorityDot.onclick = (e) => {
            e.stopPropagation();
            openPriorityMenu(priorityDot, ev.priority || 'medium', async (val) => {
                // Only update UI; task link priority isn't editable here
                ev.priority = val;
                renderCalendarEvents();
            }, { readOnly: true });
        };

        const overflowMenuContainer = document.createElement('div');
        overflowMenuContainer.className = 'calendar-overflow-menu';
        const overflowBtn = document.createElement('button');
        overflowBtn.className = 'calendar-icon-btn overflow-trigger';
        overflowBtn.title = 'More options';
        overflowBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
        overflowBtn.style.display = 'inline-flex';
        overflowBtn.style.width = '28px';
        overflowBtn.style.height = '28px';

        const overflowDropdown = document.createElement('div');
        overflowDropdown.className = 'calendar-item-dropdown';

        const reminderActive = ev.reminder_minutes_before !== null && ev.reminder_minutes_before !== undefined;
        const reminderMenuItem = document.createElement('button');
        reminderMenuItem.className = 'calendar-item-menu-option';
        reminderMenuItem.innerHTML = `<i class="fa-solid fa-bell${reminderActive ? '' : '-slash'} ${reminderActive ? 'active-icon' : ''}"></i> ${reminderActive ? `Reminder (${formatReminderMinutes(ev.reminder_minutes_before)})` : 'Set Reminder'}`;
        reminderMenuItem.onclick = async (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            const linked = await ensureLinkedTaskEvent(ev);
            if (!linked || !linked.calendar_event_id) return;
            openReminderEditor({ ...linked, id: linked.calendar_event_id });
        };

        const rolloverMenuItem = document.createElement('button');
        rolloverMenuItem.className = 'calendar-item-menu-option';
        rolloverMenuItem.innerHTML = `<i class="fa-solid fa-rotate ${ev.rollover_enabled ? 'active-icon' : ''}"></i> ${ev.rollover_enabled ? 'Disable' : 'Enable'} Rollover`;
        rolloverMenuItem.onclick = async (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            const linked = await ensureLinkedTaskEvent(ev);
            if (!linked || !linked.calendar_event_id) return;
            const next = !linked.rollover_enabled;
            try {
                await updateCalendarEvent(linked.calendar_event_id, { rollover_enabled: next });
                linked.rollover_enabled = next;
            } catch (err) {
                console.error('Failed to toggle rollover', err);
            }
        };

        const allowOverlapMenuItem = document.createElement('button');
        allowOverlapMenuItem.className = 'calendar-item-menu-option';
        const overlapLabel = ev.allow_overlap ? 'Allow' : 'Disallow';
        allowOverlapMenuItem.innerHTML = `<i class="fa-solid fa-layer-group ${ev.allow_overlap ? 'active-icon' : ''}"></i> ${overlapLabel} Overlap`;
        allowOverlapMenuItem.onclick = async (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            const linked = await ensureLinkedTaskEvent(ev);
            if (!linked || !linked.calendar_event_id) return;
            const next = !linked.allow_overlap;
            try {
                await updateCalendarEvent(linked.calendar_event_id, { allow_overlap: next });
                linked.allow_overlap = next;
            } catch (err) {
                console.error('Failed to toggle allow_overlap', err);
            }
        };

        const openBtn = document.createElement('a');
        openBtn.className = 'calendar-item-menu-option';
        openBtn.href = `/list/${ev.task_list_id}#item-${ev.task_id}`;
        openBtn.innerHTML = '<i class="fa-solid fa-up-right-from-square"></i> Open task';

        const unpinBtn = document.createElement('button');
        unpinBtn.className = 'calendar-item-menu-option';
        unpinBtn.innerHTML = '<i class="fa-solid fa-thumbtack"></i> Unpin from day';
        unpinBtn.onclick = (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            unpinTaskDate(ev.task_id);
        };

        const displayModeMenuItem = createDisplayModeMenuItem(ev, overflowDropdown);
        overflowDropdown.append(reminderMenuItem, rolloverMenuItem, allowOverlapMenuItem, displayModeMenuItem, openBtn, unpinBtn);
        overflowMenuContainer.append(overflowBtn);
        document.body.appendChild(overflowDropdown);

        const positionDropdown = () => {
            const rect = overflowBtn.getBoundingClientRect();
            const dropdownWidth = overflowDropdown.offsetWidth || 200;
            const dropdownHeight = overflowDropdown.offsetHeight || 120;
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;
            const padding = 8;
            overflowDropdown.style.position = 'fixed';
            let topPos = rect.bottom + 8;
            if (screenHeight - rect.bottom < dropdownHeight + padding && rect.top > screenHeight - rect.bottom) {
                topPos = rect.top - dropdownHeight - 8;
            }
            const maxTop = screenHeight - dropdownHeight - padding;
            const minTop = padding;
            topPos = Math.max(minTop, Math.min(topPos, maxTop));
            let leftPos = rect.right - dropdownWidth;
            if (leftPos < padding) leftPos = padding;
            if (leftPos + dropdownWidth > screenWidth - padding) leftPos = screenWidth - dropdownWidth - padding;
            overflowDropdown.style.top = `${topPos}px`;
            overflowDropdown.style.left = `${leftPos}px`;
        };

        overflowBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.calendar-item-dropdown.active').forEach(d => d.classList.remove('active'));
            overflowDropdown.classList.toggle('active');
            positionDropdown();
        });

        window.addEventListener('scroll', () => {
            if (overflowDropdown.classList.contains('active')) positionDropdown();
        }, { passive: true });

          if (noteChips.childNodes.length) actions.append(noteChips);
          actions.append(priorityDot, overflowMenuContainer);

        row.append(left, titleWrap, actions);
        attachCalendarRowSelection(row, ev);
        return row;
        }

        if (ev.is_planner_item) {
            row.classList.add('planner-link-row');
            const left = document.createElement('div');
            left.className = 'row-left';
            left.innerHTML = '<i class="fa-regular fa-square"></i>';

            const titleWrap = document.createElement('div');
            titleWrap.className = 'calendar-title';
            const titleText = document.createElement('div');
            titleText.className = 'calendar-title-rich';
            titleText.setAttribute('aria-label', 'Open in planner');
            setCalendarLinkedText(titleText, ev.title || 'Untitled', { stopPropagation: true });
            titleWrap.appendChild(titleText);

            const plannerUrl = ev.planner_folder_id ? `/planner/folder/${ev.planner_folder_id}` : '/planner';
            titleWrap.addEventListener('click', () => {
                window.location.href = plannerUrl;
            });

            const timeBtn = document.createElement('button');
            timeBtn.type = 'button';
            timeBtn.className = 'calendar-time-inline';
            const timeLabel = formatTimeRange(ev);
            timeBtn.innerHTML = timeLabel
                ? `<i class="fa-regular fa-clock"></i><span>${timeLabel}</span>`
                : `<i class="fa-regular fa-clock"></i>`;
            if (!timeLabel) {
                timeBtn.classList.add('no-time');
                timeBtn.setAttribute('data-label', 'Add time');
            }
            timeBtn.title = timeLabel || 'Add time';
            timeBtn.onclick = async (e) => {
                e.stopPropagation();
                const linked = await ensureLinkedPlannerEvent(ev);
                if (!linked || !linked.calendar_event_id) return;
                openCalendarTimeModal({ ...linked, id: linked.calendar_event_id });
            };
            titleWrap.appendChild(timeBtn);

            const meta = document.createElement('div');
            meta.className = 'calendar-meta-lite';
            const sourceChip = document.createElement('a');
            sourceChip.className = 'meta-chip planner-link';
            sourceChip.href = plannerUrl;
            // For lines: show parent item title. For groups/simple items: show folder name
            if (ev.planner_type === 'line' && ev.planner_item_title) {
                sourceChip.textContent = ev.planner_item_title;
                sourceChip.title = `Line from "${ev.planner_item_title}"`;
            } else {
                sourceChip.textContent = ev.planner_folder_name || 'Planner';
                sourceChip.title = `From ${ev.planner_folder_name || 'Planner'}`;
            }
            meta.append(sourceChip);
            titleWrap.appendChild(meta);

            const actions = document.createElement('div');
            actions.className = 'calendar-actions-row';
            const noteChips = document.createElement('div');
            noteChips.className = 'calendar-note-chips';
            appendCalendarItemNoteChip(noteChips, ev);
            const priorityDot = document.createElement('button');
            priorityDot.className = `calendar-priority-dot priority-${ev.priority || 'medium'}`;
            priorityDot.title = `Priority: ${(ev.priority || 'medium')}`;
            priorityDot.onclick = async (e) => {
                e.stopPropagation();
                const linked = await ensureLinkedPlannerEvent(ev);
                if (!linked || !linked.calendar_event_id) return;
                openPriorityMenu(priorityDot, linked.priority || 'medium', async (val) => {
                    try {
                        await updateCalendarEvent(linked.calendar_event_id, { priority: val });
                        linked.priority = val;
                        ev.priority = val;
                        renderCalendarEvents();
                    } catch (err) {
                        console.error('Failed to update priority', err);
                    }
                });
            };

            const overflowMenuContainer = document.createElement('div');
            overflowMenuContainer.className = 'calendar-overflow-menu';
            const overflowBtn = document.createElement('button');
            overflowBtn.className = 'calendar-icon-btn overflow-trigger';
            overflowBtn.title = 'More options';
            overflowBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
            overflowBtn.style.display = 'inline-flex';
            overflowBtn.style.width = '28px';
            overflowBtn.style.height = '28px';

            const overflowDropdown = document.createElement('div');
            overflowDropdown.className = 'calendar-item-dropdown';

            const reminderActive = ev.reminder_minutes_before !== null && ev.reminder_minutes_before !== undefined;
            const reminderMenuItem = document.createElement('button');
            reminderMenuItem.className = 'calendar-item-menu-option';
            reminderMenuItem.innerHTML = `<i class="fa-solid fa-bell${reminderActive ? '' : '-slash'} ${reminderActive ? 'active-icon' : ''}"></i> ${reminderActive ? `Reminder (${formatReminderMinutes(ev.reminder_minutes_before)})` : 'Set Reminder'}`;
            reminderMenuItem.onclick = async (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                const linked = await ensureLinkedPlannerEvent(ev);
                if (!linked || !linked.calendar_event_id) return;
                openReminderEditor({ ...linked, id: linked.calendar_event_id });
            };

            const rolloverMenuItem = document.createElement('button');
            rolloverMenuItem.className = 'calendar-item-menu-option';
            rolloverMenuItem.innerHTML = `<i class="fa-solid fa-rotate ${ev.rollover_enabled ? 'active-icon' : ''}"></i> ${ev.rollover_enabled ? 'Disable' : 'Enable'} Rollover`;
            rolloverMenuItem.onclick = async (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                const linked = await ensureLinkedPlannerEvent(ev);
                if (!linked || !linked.calendar_event_id) return;
                const next = !linked.rollover_enabled;
                try {
                    await updateCalendarEvent(linked.calendar_event_id, { rollover_enabled: next });
                    linked.rollover_enabled = next;
                    ev.rollover_enabled = next;
                } catch (err) {
                    console.error('Failed to toggle rollover', err);
                }
            };

            const allowOverlapMenuItem = document.createElement('button');
            allowOverlapMenuItem.className = 'calendar-item-menu-option';
            const overlapLabel = ev.allow_overlap ? 'Allow' : 'Disallow';
            allowOverlapMenuItem.innerHTML = `<i class="fa-solid fa-layer-group ${ev.allow_overlap ? 'active-icon' : ''}"></i> ${overlapLabel} Overlap`;
            allowOverlapMenuItem.onclick = async (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                const linked = await ensureLinkedPlannerEvent(ev);
                if (!linked || !linked.calendar_event_id) return;
                const next = !linked.allow_overlap;
                try {
                    await updateCalendarEvent(linked.calendar_event_id, { allow_overlap: next });
                    linked.allow_overlap = next;
                    ev.allow_overlap = next;
                } catch (err) {
                    console.error('Failed to toggle allow_overlap', err);
                }
            };

            const openPlannerBtn = document.createElement('a');
            openPlannerBtn.className = 'calendar-item-menu-option';
            openPlannerBtn.href = plannerUrl;
            openPlannerBtn.innerHTML = '<i class="fa-solid fa-up-right-from-square"></i> Open in planner';

            const unpinBtn = document.createElement('button');
            unpinBtn.className = 'calendar-item-menu-option';
            unpinBtn.innerHTML = '<i class="fa-solid fa-thumbtack"></i> Unpin from day';
            unpinBtn.onclick = (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                unpinPlannerDate(ev);
            };

            const displayModeMenuItem = createDisplayModeMenuItem(ev, overflowDropdown);
            overflowDropdown.append(reminderMenuItem, rolloverMenuItem, allowOverlapMenuItem, displayModeMenuItem, openPlannerBtn, unpinBtn);
            overflowMenuContainer.append(overflowBtn);
            document.body.appendChild(overflowDropdown);

            const positionDropdown = () => {
                const rect = overflowBtn.getBoundingClientRect();
                const dropdownWidth = overflowDropdown.offsetWidth || 200;
                const dropdownHeight = overflowDropdown.offsetHeight || 120;
                const screenWidth = window.innerWidth;
                const screenHeight = window.innerHeight;
                const padding = 8;
                overflowDropdown.style.position = 'fixed';
                let topPos = rect.bottom + 8;
                if (screenHeight - rect.bottom < dropdownHeight + padding && rect.top > screenHeight - rect.bottom) {
                    topPos = rect.top - dropdownHeight - 8;
                }
                const maxTop = screenHeight - dropdownHeight - padding;
                const minTop = padding;
                topPos = Math.max(minTop, Math.min(topPos, maxTop));
                let leftPos = rect.right - dropdownWidth;
                if (leftPos < padding) leftPos = padding;
                if (leftPos + dropdownWidth > screenWidth - padding) leftPos = screenWidth - dropdownWidth - padding;
                overflowDropdown.style.top = `${topPos}px`;
                overflowDropdown.style.left = `${leftPos}px`;
            };

            overflowBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.calendar-item-dropdown.active').forEach(d => d.classList.remove('active'));
                overflowDropdown.classList.toggle('active');
                positionDropdown();
            });

            window.addEventListener('scroll', () => {
                if (overflowDropdown.classList.contains('active')) positionDropdown();
            }, { passive: true });

            if (noteChips.childNodes.length) actions.append(noteChips);
            actions.append(priorityDot, overflowMenuContainer);

            row.append(left, titleWrap, actions);
            attachCalendarRowSelection(row, ev);
            return row;
        }

        if (ev.is_feed_item) {
            row.classList.add('feed-link-row');
            row.dataset.type = 'feed';

            const left = document.createElement('div');
            left.className = 'row-left';
            left.innerHTML = '<i class="fa-regular fa-square"></i>';

            const titleWrap = document.createElement('div');
            titleWrap.className = 'calendar-title';
            const titleText = document.createElement('div');
            titleText.className = 'calendar-title-rich';
            titleText.setAttribute('aria-label', 'Open feed item');
            setCalendarLinkedText(titleText, ev.title || 'Untitled', { stopPropagation: true });
            titleWrap.appendChild(titleText);

            const openUrl = (ev.feed_url || '').trim() || '/feed';
            const isExternal = /^https?:\/\//i.test(openUrl);
            const openFeedItem = () => {
                if (isExternal) {
                    window.open(openUrl, '_blank', 'noopener,noreferrer');
                } else {
                    window.location.href = openUrl;
                }
            };
            titleWrap.addEventListener('click', () => {
                openFeedItem();
            });

            const timeBtn = document.createElement('button');
            timeBtn.type = 'button';
            timeBtn.className = 'calendar-time-inline';
            const timeLabel = formatTimeRange(ev);
            timeBtn.innerHTML = timeLabel
                ? `<i class="fa-regular fa-clock"></i><span>${timeLabel}</span>`
                : `<i class="fa-regular fa-clock"></i>`;
            if (!timeLabel) {
                timeBtn.classList.add('no-time');
                timeBtn.setAttribute('data-label', 'Add time');
            }
            timeBtn.title = timeLabel || 'Add time';
            timeBtn.onclick = async (e) => {
                e.stopPropagation();
                const linked = await ensureLinkedFeedEvent(ev);
                if (!linked || !linked.calendar_event_id) return;
                openCalendarTimeModal({ ...linked, id: linked.calendar_event_id });
            };
            titleWrap.appendChild(timeBtn);

            const meta = document.createElement('div');
            meta.className = 'calendar-meta-lite';
            const sourceChip = document.createElement('a');
            sourceChip.className = 'meta-chip';
            sourceChip.href = openUrl;
            if (isExternal) {
                sourceChip.target = '_blank';
                sourceChip.rel = 'noopener noreferrer';
            }
            const rawState = (ev.feed_state || 'feed').replace(/[_-]+/g, ' ').trim();
            const stateLabel = rawState ? rawState.charAt(0).toUpperCase() + rawState.slice(1) : 'Feed';
            sourceChip.textContent = stateLabel;
            sourceChip.title = `From EverFeed (${stateLabel})`;
            meta.append(sourceChip);
            titleWrap.appendChild(meta);

            const actions = document.createElement('div');
            actions.className = 'calendar-actions-row';
            const noteChips = document.createElement('div');
            noteChips.className = 'calendar-note-chips';
            appendCalendarItemNoteChip(noteChips, ev);
            const priorityDot = document.createElement('button');
            priorityDot.className = `calendar-priority-dot priority-${ev.priority || 'medium'}`;
            priorityDot.title = `Priority: ${(ev.priority || 'medium')}`;
            priorityDot.onclick = async (e) => {
                e.stopPropagation();
                const linked = await ensureLinkedFeedEvent(ev);
                if (!linked || !linked.calendar_event_id) return;
                openPriorityMenu(priorityDot, linked.priority || 'medium', async (val) => {
                    try {
                        await updateCalendarEvent(linked.calendar_event_id, { priority: val });
                        linked.priority = val;
                        ev.priority = val;
                        renderCalendarEvents();
                    } catch (err) {
                        console.error('Failed to update priority', err);
                    }
                });
            };

            const overflowMenuContainer = document.createElement('div');
            overflowMenuContainer.className = 'calendar-overflow-menu';
            const overflowBtn = document.createElement('button');
            overflowBtn.className = 'calendar-icon-btn overflow-trigger';
            overflowBtn.title = 'More options';
            overflowBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
            overflowBtn.style.display = 'inline-flex';
            overflowBtn.style.width = '28px';
            overflowBtn.style.height = '28px';

            const overflowDropdown = document.createElement('div');
            overflowDropdown.className = 'calendar-item-dropdown';

            const reminderActive = ev.reminder_minutes_before !== null && ev.reminder_minutes_before !== undefined;
            const reminderMenuItem = document.createElement('button');
            reminderMenuItem.className = 'calendar-item-menu-option';
            reminderMenuItem.innerHTML = `<i class="fa-solid fa-bell${reminderActive ? '' : '-slash'} ${reminderActive ? 'active-icon' : ''}"></i> ${reminderActive ? `Reminder (${formatReminderMinutes(ev.reminder_minutes_before)})` : 'Set Reminder'}`;
            reminderMenuItem.onclick = async (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                const linked = await ensureLinkedFeedEvent(ev);
                if (!linked || !linked.calendar_event_id) return;
                openReminderEditor({ ...linked, id: linked.calendar_event_id });
            };

            const rolloverMenuItem = document.createElement('button');
            rolloverMenuItem.className = 'calendar-item-menu-option';
            rolloverMenuItem.innerHTML = `<i class="fa-solid fa-rotate ${ev.rollover_enabled ? 'active-icon' : ''}"></i> ${ev.rollover_enabled ? 'Disable' : 'Enable'} Rollover`;
            rolloverMenuItem.onclick = async (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                const linked = await ensureLinkedFeedEvent(ev);
                if (!linked || !linked.calendar_event_id) return;
                const next = !linked.rollover_enabled;
                try {
                    await updateCalendarEvent(linked.calendar_event_id, { rollover_enabled: next });
                    linked.rollover_enabled = next;
                    ev.rollover_enabled = next;
                } catch (err) {
                    console.error('Failed to toggle rollover', err);
                }
            };

            const allowOverlapMenuItem = document.createElement('button');
            allowOverlapMenuItem.className = 'calendar-item-menu-option';
            const overlapLabel = ev.allow_overlap ? 'Allow' : 'Disallow';
            allowOverlapMenuItem.innerHTML = `<i class="fa-solid fa-layer-group ${ev.allow_overlap ? 'active-icon' : ''}"></i> ${overlapLabel} Overlap`;
            allowOverlapMenuItem.onclick = async (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                const linked = await ensureLinkedFeedEvent(ev);
                if (!linked || !linked.calendar_event_id) return;
                const next = !linked.allow_overlap;
                try {
                    await updateCalendarEvent(linked.calendar_event_id, { allow_overlap: next });
                    linked.allow_overlap = next;
                    ev.allow_overlap = next;
                } catch (err) {
                    console.error('Failed to toggle allow_overlap', err);
                }
            };

            const openBtn = document.createElement('a');
            openBtn.className = 'calendar-item-menu-option';
            openBtn.href = openUrl;
            if (isExternal) {
                openBtn.target = '_blank';
                openBtn.rel = 'noopener noreferrer';
            }
            openBtn.innerHTML = '<i class="fa-solid fa-up-right-from-square"></i> Open source';

            const unpinBtn = document.createElement('button');
            unpinBtn.className = 'calendar-item-menu-option';
            unpinBtn.innerHTML = '<i class="fa-solid fa-thumbtack"></i> Unpin from day';
            unpinBtn.onclick = (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                unpinFeedDate(ev.feed_item_id);
            };

            const displayModeMenuItem = createDisplayModeMenuItem(ev, overflowDropdown);
            overflowDropdown.append(reminderMenuItem, rolloverMenuItem, allowOverlapMenuItem, displayModeMenuItem, openBtn, unpinBtn);
            overflowMenuContainer.append(overflowBtn);
            document.body.appendChild(overflowDropdown);

            const positionDropdown = () => {
                const rect = overflowBtn.getBoundingClientRect();
                const dropdownWidth = overflowDropdown.offsetWidth || 200;
                const dropdownHeight = overflowDropdown.offsetHeight || 120;
                const screenWidth = window.innerWidth;
                const screenHeight = window.innerHeight;
                const padding = 8;
                overflowDropdown.style.position = 'fixed';
                let topPos = rect.bottom + 8;
                if (screenHeight - rect.bottom < dropdownHeight + padding && rect.top > screenHeight - rect.bottom) {
                    topPos = rect.top - dropdownHeight - 8;
                }
                const maxTop = screenHeight - dropdownHeight - padding;
                const minTop = padding;
                topPos = Math.max(minTop, Math.min(topPos, maxTop));
                let leftPos = rect.right - dropdownWidth;
                if (leftPos < padding) leftPos = padding;
                if (leftPos + dropdownWidth > screenWidth - padding) leftPos = screenWidth - dropdownWidth - padding;
                overflowDropdown.style.top = `${topPos}px`;
                overflowDropdown.style.left = `${leftPos}px`;
            };

            overflowBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.calendar-item-dropdown.active').forEach(d => d.classList.remove('active'));
                overflowDropdown.classList.toggle('active');
                positionDropdown();
            });

            window.addEventListener('scroll', () => {
                if (overflowDropdown.classList.contains('active')) positionDropdown();
            }, { passive: true });

            if (noteChips.childNodes.length) actions.append(noteChips);
            actions.append(priorityDot, overflowMenuContainer);

            row.append(left, titleWrap, actions);
            return row;
        }

        if (ev.is_note_list_item) {
            row.classList.add('note-list-row');
            row.dataset.type = 'note-list';

            const left = document.createElement('div');
            left.className = 'row-left';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = ev.status === 'done';
            checkbox.onchange = async () => {
                await updateLinkedNoteListStatus(ev, checkbox.checked ? 'done' : 'not_started');
            };
            left.appendChild(checkbox);

            const titleWrap = document.createElement('div');
            titleWrap.className = 'calendar-title task-link-title';
            const titleText = document.createElement('div');
            titleText.className = 'calendar-title-rich';
            titleText.setAttribute('aria-label', 'Open list item');
            setCalendarLinkedText(titleText, ev.title || 'Untitled', { stopPropagation: true });
            titleWrap.appendChild(titleText);

            const openUrl = getCalendarNoteListItemUrl(ev);
            titleWrap.addEventListener('click', () => {
                openCalendarNoteListItem(ev);
            });

            const timeBtn = document.createElement('button');
            timeBtn.type = 'button';
            timeBtn.className = 'calendar-time-inline';
            const timeLabel = formatTimeRange(ev);
            timeBtn.innerHTML = timeLabel
                ? `<i class="fa-regular fa-clock"></i><span>${timeLabel}</span>`
                : `<i class="fa-regular fa-clock"></i>`;
            if (!timeLabel) {
                timeBtn.classList.add('no-time');
                timeBtn.setAttribute('data-label', 'Add time');
            }
            timeBtn.title = timeLabel || 'Add time';
            timeBtn.onclick = async (e) => {
                e.stopPropagation();
                const linked = await ensureLinkedNoteListEvent(ev);
                if (!linked || !linked.calendar_event_id) return;
                openCalendarTimeModal({ ...linked, id: linked.calendar_event_id });
            };
            titleWrap.appendChild(timeBtn);

            const meta = document.createElement('div');
            meta.className = 'calendar-meta-lite';
            const sourceChip = document.createElement('a');
            sourceChip.className = 'meta-chip note';
            sourceChip.href = openUrl;
            sourceChip.textContent = ev.note_title || 'Notes list';
            sourceChip.title = `From ${ev.note_title || 'Notes list'}`;
            meta.append(sourceChip);
            titleWrap.appendChild(meta);

            const actions = document.createElement('div');
            actions.className = 'calendar-actions-row';

            const noteChips = document.createElement('div');
            noteChips.className = 'calendar-note-chips';
            appendCalendarItemNoteChip(noteChips, ev);

            const priorityDot = document.createElement('button');
            priorityDot.className = `calendar-priority-dot priority-${ev.priority || 'medium'}`;
            priorityDot.title = `Priority: ${(ev.priority || 'medium')}`;
            priorityDot.onclick = async (e) => {
                e.stopPropagation();
                const linked = await ensureLinkedNoteListEvent(ev);
                if (!linked || !linked.calendar_event_id) return;
                openPriorityMenu(priorityDot, linked.priority || 'medium', async (val) => {
                    try {
                        await updateCalendarEvent(linked.calendar_event_id, { priority: val });
                        linked.priority = val;
                        ev.priority = val;
                        renderCalendarEvents();
                    } catch (err) {
                        console.error('Failed to update priority', err);
                    }
                });
            };

            const overflowMenuContainer = document.createElement('div');
            overflowMenuContainer.className = 'calendar-overflow-menu';
            const overflowBtn = document.createElement('button');
            overflowBtn.className = 'calendar-icon-btn overflow-trigger';
            overflowBtn.title = 'More options';
            overflowBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
            overflowBtn.style.display = 'inline-flex';
            overflowBtn.style.width = '28px';
            overflowBtn.style.height = '28px';

            const overflowDropdown = document.createElement('div');
            overflowDropdown.className = 'calendar-item-dropdown';

            const reminderActive = ev.reminder_minutes_before !== null && ev.reminder_minutes_before !== undefined;
            const reminderMenuItem = document.createElement('button');
            reminderMenuItem.className = 'calendar-item-menu-option';
            reminderMenuItem.innerHTML = `<i class="fa-solid fa-bell${reminderActive ? '' : '-slash'} ${reminderActive ? 'active-icon' : ''}"></i> ${reminderActive ? `Reminder (${formatReminderMinutes(ev.reminder_minutes_before)})` : 'Set Reminder'}`;
            reminderMenuItem.onclick = async (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                const linked = await ensureLinkedNoteListEvent(ev);
                if (!linked || !linked.calendar_event_id) return;
                openReminderEditor({ ...linked, id: linked.calendar_event_id });
            };

            const rolloverMenuItem = document.createElement('button');
            rolloverMenuItem.className = 'calendar-item-menu-option';
            rolloverMenuItem.innerHTML = `<i class="fa-solid fa-rotate ${ev.rollover_enabled ? 'active-icon' : ''}"></i> ${ev.rollover_enabled ? 'Disable' : 'Enable'} Rollover`;
            rolloverMenuItem.onclick = async (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                const linked = await ensureLinkedNoteListEvent(ev);
                if (!linked || !linked.calendar_event_id) return;
                const next = !linked.rollover_enabled;
                try {
                    await updateCalendarEvent(linked.calendar_event_id, { rollover_enabled: next });
                    linked.rollover_enabled = next;
                    ev.rollover_enabled = next;
                } catch (err) {
                    console.error('Failed to toggle rollover', err);
                }
            };

            const allowOverlapMenuItem = document.createElement('button');
            allowOverlapMenuItem.className = 'calendar-item-menu-option';
            const overlapLabel = ev.allow_overlap ? 'Allow' : 'Disallow';
            allowOverlapMenuItem.innerHTML = `<i class="fa-solid fa-layer-group ${ev.allow_overlap ? 'active-icon' : ''}"></i> ${overlapLabel} Overlap`;
            allowOverlapMenuItem.onclick = async (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                const linked = await ensureLinkedNoteListEvent(ev);
                if (!linked || !linked.calendar_event_id) return;
                const next = !linked.allow_overlap;
                try {
                    await updateCalendarEvent(linked.calendar_event_id, { allow_overlap: next });
                    linked.allow_overlap = next;
                    ev.allow_overlap = next;
                } catch (err) {
                    console.error('Failed to toggle allow_overlap', err);
                }
            };

            const openBtn = document.createElement('a');
            openBtn.className = 'calendar-item-menu-option';
            openBtn.href = openUrl;
            openBtn.innerHTML = '<i class="fa-solid fa-up-right-from-square"></i> Open list item';

            const unpinBtn = document.createElement('button');
            unpinBtn.className = 'calendar-item-menu-option';
            unpinBtn.innerHTML = '<i class="fa-solid fa-thumbtack"></i> Unpin from day';
            unpinBtn.onclick = (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                unpinNoteListDate(ev.note_id, ev.note_list_item_id);
            };

            const displayModeMenuItem = createDisplayModeMenuItem(ev, overflowDropdown);
            overflowDropdown.append(reminderMenuItem, rolloverMenuItem, allowOverlapMenuItem, displayModeMenuItem, openBtn, unpinBtn);
            overflowMenuContainer.append(overflowBtn);
            document.body.appendChild(overflowDropdown);

            const positionDropdown = () => {
                const rect = overflowBtn.getBoundingClientRect();
                const dropdownWidth = overflowDropdown.offsetWidth || 200;
                const dropdownHeight = overflowDropdown.offsetHeight || 120;
                const screenWidth = window.innerWidth;
                const screenHeight = window.innerHeight;
                const padding = 8;
                overflowDropdown.style.position = 'fixed';
                let topPos = rect.bottom + 8;
                if (screenHeight - rect.bottom < dropdownHeight + padding && rect.top > screenHeight - rect.bottom) {
                    topPos = rect.top - dropdownHeight - 8;
                }
                const maxTop = screenHeight - dropdownHeight - padding;
                const minTop = padding;
                topPos = Math.max(minTop, Math.min(topPos, maxTop));
                let leftPos = rect.right - dropdownWidth;
                if (leftPos < padding) leftPos = padding;
                if (leftPos + dropdownWidth > screenWidth - padding) leftPos = screenWidth - dropdownWidth - padding;
                overflowDropdown.style.top = `${topPos}px`;
                overflowDropdown.style.left = `${leftPos}px`;
            };

            overflowBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.calendar-item-dropdown.active').forEach(d => d.classList.remove('active'));
                overflowDropdown.classList.toggle('active');
                positionDropdown();
            });

            window.addEventListener('scroll', () => {
                if (overflowDropdown.classList.contains('active')) positionDropdown();
            }, { passive: true });

            if (noteChips.childNodes.length) actions.append(noteChips);
            actions.append(priorityDot, overflowMenuContainer);

            row.append(left, titleWrap, actions);
            return row;
        }

        if (ev.is_phase) {
            const left = document.createElement('div');
            left.className = 'row-left phase-icon';
            left.innerHTML = '<i class="fa-solid fa-bars-staggered"></i>';

            const titleWrap = document.createElement('div');
            titleWrap.className = 'calendar-title';
            appendCalendarEditableTitle(titleWrap, {
                getValue: () => ev.title,
                placeholder: 'Phase title',
                ariaLabel: 'Edit phase title',
                onSave: (nextTitle) => {
                    updateCalendarEvent(ev.id, { title: nextTitle });
                }
            });

            const actions = document.createElement('div');
            actions.className = 'calendar-actions-row';

            const overflowMenuContainer = document.createElement('div');
            overflowMenuContainer.className = 'calendar-overflow-menu';
            const overflowBtn = document.createElement('button');
            overflowBtn.className = 'calendar-icon-btn overflow-trigger';
            overflowBtn.title = 'More options';
            overflowBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
            overflowBtn.style.display = 'inline-flex';
            overflowBtn.style.width = '28px';
            overflowBtn.style.height = '28px';

            const overflowDropdown = document.createElement('div');
            overflowDropdown.className = 'calendar-item-dropdown';

            const moveUpMenuItem = document.createElement('button');
            moveUpMenuItem.className = 'calendar-item-menu-option';
            moveUpMenuItem.innerHTML = '<i class="fa-solid fa-arrow-up"></i> Move up';
            moveUpMenuItem.onclick = (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                nudgeCalendarEvent(ev.id, -1);
            };

            const moveDownMenuItem = document.createElement('button');
            moveDownMenuItem.className = 'calendar-item-menu-option';
            moveDownMenuItem.innerHTML = '<i class="fa-solid fa-arrow-down"></i> Move down';
            moveDownMenuItem.onclick = (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                nudgeCalendarEvent(ev.id, 1);
            };

            const deleteMenuItem = document.createElement('button');
            deleteMenuItem.className = 'calendar-item-menu-option delete-option';
            deleteMenuItem.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
            deleteMenuItem.onclick = (e) => {
                e.stopPropagation();
                overflowDropdown.classList.remove('active');
                deleteCalendarEvent(ev.id);
            };

            overflowDropdown.append(moveUpMenuItem, moveDownMenuItem, deleteMenuItem);
            overflowMenuContainer.append(overflowBtn);
            document.body.appendChild(overflowDropdown);

            const positionDropdown = () => {
                const rect = overflowBtn.getBoundingClientRect();
                const dropdownWidth = 180;
                const dropdownHeight = overflowDropdown.offsetHeight || 120;
                const screenWidth = window.innerWidth;
                const screenHeight = window.innerHeight;
                const padding = 8;

                overflowDropdown.style.position = 'fixed';
                let topPos = rect.bottom + 8;
                if (screenHeight - rect.bottom < dropdownHeight + padding && rect.top > screenHeight - rect.bottom) {
                    topPos = rect.top - dropdownHeight - 8;
                }
                const maxTop = screenHeight - dropdownHeight - padding;
                const minTop = padding;
                topPos = Math.max(minTop, Math.min(topPos, maxTop));

                let leftPos = rect.right - dropdownWidth;
                if (leftPos < padding) leftPos = padding;
                if (leftPos + dropdownWidth > screenWidth - padding) {
                    leftPos = screenWidth - dropdownWidth - padding;
                }

                overflowDropdown.style.top = `${topPos}px`;
                overflowDropdown.style.left = `${leftPos}px`;
            };

            overflowBtn.onclick = (e) => {
                e.stopPropagation();
                const isOpen = overflowDropdown.classList.contains('active');
                document.querySelectorAll('.calendar-item-dropdown.active').forEach(d => {
                    if (d !== overflowDropdown) d.classList.remove('active');
                });
                if (!isOpen) {
                    positionDropdown();
                    overflowDropdown.classList.add('active');
                } else {
                    overflowDropdown.classList.remove('active');
                }
            };

            overflowDropdown.updatePosition = positionDropdown;
            overflowDropdown.triggerButton = overflowBtn;

            actions.append(overflowMenuContainer);
            row.append(left, titleWrap, actions);
            attachCalendarRowSelection(row, ev);
            return row;
        }

        const left = document.createElement('div');
        left.className = 'row-left';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = ev.status === 'done';
        checkbox.onchange = () => updateCalendarEvent(ev.id, { status: checkbox.checked ? 'done' : 'not_started' });
        left.appendChild(checkbox);

        const titleWrap = document.createElement('div');
        titleWrap.className = 'calendar-title';
        appendCalendarEditableTitle(titleWrap, {
            getValue: () => ev.title,
            placeholder: 'Task title',
            ariaLabel: 'Edit task title',
            onSave: (nextTitle) => {
                updateCalendarEvent(ev.id, { title: nextTitle });
            }
        });

        // Add time inline with title (clickable to edit)
        const timeBtn = document.createElement('button');
        timeBtn.type = 'button';
        timeBtn.className = 'calendar-time-inline';
        const timeLabel = formatTimeRange(ev);
        timeBtn.innerHTML = timeLabel
            ? `<i class="fa-regular fa-clock"></i><span>${timeLabel}</span>`
            : `<i class="fa-regular fa-clock"></i>`;
        if (!timeLabel) {
            timeBtn.classList.add('no-time');
            timeBtn.setAttribute('data-label', 'Add time');
        }
        timeBtn.title = timeLabel || 'Add time';
        timeBtn.onclick = () => openCalendarTimeModal(ev);
        titleWrap.appendChild(timeBtn);

        // Keep phase chip in meta-lite (will show on hover)
        const meta = document.createElement('div');
        meta.className = 'calendar-meta-lite';
        if (ev.phase_id) {
            const chip = document.createElement('span');
            chip.className = 'meta-chip phase';
            chip.textContent = ev.phase_title ? `# ${ev.phase_title}` : 'Phase';
            meta.appendChild(chip);
        }
        const noteChips = document.createElement('div');
        noteChips.className = 'calendar-note-chips';
        (ev.linked_notes || []).forEach(note => {
            const link = document.createElement('a');
            link.className = 'meta-chip note';
            link.href = `/notes/${note.id}`;
            link.title = note.title || `Note #${note.id}`;
            link.setAttribute('aria-label', note.title || `Note #${note.id}`);
            link.innerHTML = '<i class="fa-solid fa-note-sticky"></i>';
            noteChips.appendChild(link);
        });
        appendCalendarItemNoteChip(noteChips, ev);
        if (meta.childNodes.length) titleWrap.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'calendar-actions-row';

        const priorityDot = document.createElement('button');
        priorityDot.className = `calendar-priority-dot priority-${ev.priority || 'medium'}`;
        priorityDot.title = `Priority: ${(ev.priority || 'medium')}`;
        priorityDot.onclick = (e) => {
            e.stopPropagation();
            openPriorityMenu(priorityDot, ev.priority || 'medium', async (val) => {
                await updateCalendarEvent(ev.id, { priority: val });
                ev.priority = val;
                renderCalendarEvents();
            });
        };

        // Overflow menu for less common actions
        const overflowMenuContainer = document.createElement('div');
        overflowMenuContainer.className = 'calendar-overflow-menu';

        const overflowBtn = document.createElement('button');
        overflowBtn.className = 'calendar-icon-btn overflow-trigger';
        overflowBtn.title = 'More options';
        overflowBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
        overflowBtn.style.display = 'inline-flex';
        overflowBtn.style.width = '28px';
        overflowBtn.style.height = '28px';

        const overflowDropdown = document.createElement('div');
        overflowDropdown.className = 'calendar-item-dropdown';

        const reminderActive = ev.reminder_minutes_before !== null && ev.reminder_minutes_before !== undefined;
        const reminderMenuItem = document.createElement('button');
        reminderMenuItem.className = 'calendar-item-menu-option';
        reminderMenuItem.innerHTML = `<i class="fa-solid fa-bell${reminderActive ? '' : '-slash'} ${reminderActive ? 'active-icon' : ''}"></i> ${reminderActive ? `Reminder (${formatReminderMinutes(ev.reminder_minutes_before)})` : 'Set Reminder'}`;
        reminderMenuItem.onclick = (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            openReminderEditor(ev);
        };

        const moveMenuItem = document.createElement('button');
        moveMenuItem.className = 'calendar-item-menu-option';
        moveMenuItem.innerHTML = '<i class="fa-solid fa-calendar-day"></i> Move to day';
        moveMenuItem.onclick = (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            openCalendarMovePrompt(ev);
        };

        const noteMenuItem = document.createElement('button');
        noteMenuItem.className = 'calendar-item-menu-option';
        noteMenuItem.innerHTML = '<i class="fa-solid fa-note-sticky"></i> Add Note...';
        noteMenuItem.onclick = async (e) => {
            e.stopPropagation();
            const resolved = await resolveCalendarEventId(ev);
            if (!resolved) return;
            showCalendarNoteChoiceInDropdown(overflowDropdown, resolved);
        };

        const convertMenuItem = document.createElement('button');
        convertMenuItem.className = 'calendar-item-menu-option';
        convertMenuItem.innerHTML = '<i class="fa-solid fa-list-check"></i> Convert to task';
        convertMenuItem.onclick = async (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            try {
                await updateCalendarEvent(ev.id, { is_event: false });
                ev.is_event = false;
                renderCalendarEvents();
            } catch (err) {
                console.error('Failed to convert event to task', err);
            }
        };

        const rolloverMenuItem = document.createElement('button');
        rolloverMenuItem.className = 'calendar-item-menu-option';
        rolloverMenuItem.innerHTML = `<i class="fa-solid fa-rotate ${ev.rollover_enabled ? 'active-icon' : ''}"></i> ${ev.rollover_enabled ? 'Disable' : 'Enable'} Rollover`;
        rolloverMenuItem.onclick = async (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            const next = !ev.rollover_enabled;
            try {
                await updateCalendarEvent(ev.id, { rollover_enabled: next });
                ev.rollover_enabled = next;
            } catch (err) {
                console.error('Failed to toggle rollover', err);
            }
        };

        const allowOverlapMenuItem = document.createElement('button');
        allowOverlapMenuItem.className = 'calendar-item-menu-option';
        const overlapLabel = ev.is_event
            ? (ev.allow_overlap ? 'Disallow' : 'Allow')
            : (ev.allow_overlap ? 'Allow' : 'Disallow');
        allowOverlapMenuItem.innerHTML = `<i class="fa-solid fa-layer-group ${ev.allow_overlap ? 'active-icon' : ''}"></i> ${overlapLabel} Overlap`;
        allowOverlapMenuItem.onclick = async (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            const next = !ev.allow_overlap;
            try {
                await updateCalendarEvent(ev.id, { allow_overlap: next });
                ev.allow_overlap = next;
            } catch (err) {
                console.error('Failed to toggle allow_overlap', err);
            }
        };

        const deleteMenuItem = document.createElement('button');
        deleteMenuItem.className = 'calendar-item-menu-option delete-option';
        deleteMenuItem.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
        deleteMenuItem.onclick = (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            deleteCalendarEvent(ev.id);
        };

        const displayModeMenuItem = createDisplayModeMenuItem(ev, overflowDropdown);
        // Order: reminder, rollover, allow overlap, timeline mode, note, move, delete
        overflowDropdown.append(reminderMenuItem, rolloverMenuItem, allowOverlapMenuItem, displayModeMenuItem, noteMenuItem, moveMenuItem, deleteMenuItem);
        overflowMenuContainer.append(overflowBtn);
        document.body.appendChild(overflowDropdown); // Append to body instead

        // Function to position dropdown relative to button
        const positionDropdown = () => {
            const rect = overflowBtn.getBoundingClientRect();
            const dropdownWidth = 180;
            const dropdownHeight = overflowDropdown.offsetHeight || 150; // Estimate if not rendered yet
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;
            const padding = 8;

            overflowDropdown.style.position = 'fixed';

            // Determine vertical position - flip up if would spill below screen
            let topPos;
            const spaceBelow = screenHeight - rect.bottom;
            const spaceAbove = rect.top;

            if (spaceBelow < dropdownHeight + padding && spaceAbove > spaceBelow) {
                // Not enough space below, but more space above - position above button
                topPos = rect.top - dropdownHeight - 8;
            } else {
                // Position below button (default)
                topPos = rect.bottom + 8;
            }

            overflowDropdown.style.top = `${topPos}px`;

            // Calculate left position, ensuring it stays on screen
            let leftPos = rect.right - dropdownWidth;

            // If dropdown would go off left edge, align to left edge with padding
            if (leftPos < padding) {
                leftPos = padding;
            }

            // If dropdown would go off right edge, align to right edge with padding
            if (leftPos + dropdownWidth > screenWidth - padding) {
                leftPos = screenWidth - dropdownWidth - padding;
            }

            overflowDropdown.style.left = `${leftPos}px`;
        };

        // Store reference for scroll update
        overflowDropdown.updatePosition = positionDropdown;
        overflowDropdown.triggerButton = overflowBtn;

          overflowBtn.onclick = (e) => {
            e.stopPropagation();
            restoreCalendarNoteChoiceDropdown(overflowDropdown);

            const isOpen = overflowDropdown.classList.contains('active');

            // Close all other dropdowns first
            document.querySelectorAll('.calendar-item-dropdown.active').forEach(d => {
                if (d !== overflowDropdown) {
                    d.classList.remove('active');
                }
            });

            if (!isOpen) {
                positionDropdown();
                overflowDropdown.classList.add('active');
            } else {
                overflowDropdown.classList.remove('active');
            }
        };

        if (noteChips.childNodes.length) actions.append(noteChips);
        actions.append(priorityDot, overflowMenuContainer);
        row.append(left, titleWrap, actions);
        attachCalendarRowSelection(row, ev);
        return row;
    };

    const renderEvent = (ev, isChild = false) => {
        const row = document.createElement('div');
        const canceledClass = ev.status === 'canceled' ? 'canceled' : '';
        row.className = `calendar-row event ${canceledClass} ${isChild ? 'child-row' : ''}`;
        row.dataset.id = ev.id;
        row.dataset.groupId = ev.group_id || '';
        row.dataset.type = 'event';

        const left = document.createElement('div');
        left.className = 'row-left';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'calendar-title';
        appendCalendarEditableTitle(titleWrap, {
            getValue: () => ev.title,
            placeholder: 'Event title',
            ariaLabel: 'Edit event title',
            onSave: (nextTitle) => {
                updateCalendarEvent(ev.id, { title: nextTitle });
            }
        });

        // Add time inline with title
        const timeBtn = document.createElement('button');
        timeBtn.type = 'button';
        timeBtn.className = 'calendar-time-inline';
        const timeLabel = formatTimeRange(ev);
        timeBtn.innerHTML = timeLabel
            ? `<i class="fa-regular fa-clock"></i><span>${timeLabel}</span>`
            : `<i class="fa-regular fa-clock"></i>`;
        if (!timeLabel) {
            timeBtn.classList.add('no-time');
            timeBtn.setAttribute('data-label', 'Add time');
        }
        timeBtn.title = timeLabel || 'Add time';
        timeBtn.onclick = () => openCalendarTimeModal(ev);
        titleWrap.appendChild(timeBtn);

        const noteChips = document.createElement('div');
        noteChips.className = 'calendar-note-chips';
        (ev.linked_notes || []).forEach(note => {
            const link = document.createElement('a');
            link.className = 'meta-chip note';
            link.href = `/notes/${note.id}`;
            link.title = note.title || `Note #${note.id}`;
            link.setAttribute('aria-label', note.title || `Note #${note.id}`);
            link.innerHTML = '<i class="fa-solid fa-note-sticky"></i>';
            noteChips.appendChild(link);
        });

        const actions = document.createElement('div');
        actions.className = 'calendar-actions-row';

        const priorityDot = document.createElement('button');
        priorityDot.className = `calendar-priority-dot priority-${ev.priority || 'medium'}`;
        priorityDot.title = `Priority: ${(ev.priority || 'medium')}`;
        priorityDot.onclick = (e) => {
            e.stopPropagation();
            openPriorityMenu(priorityDot, ev.priority || 'medium', async (val) => {
                await updateCalendarEvent(ev.id, { priority: val });
                ev.priority = val;
                renderCalendarEvents();
            });
        };

        // Overflow menu for events (matching tasks)
        const overflowMenuContainer = document.createElement('div');
        overflowMenuContainer.className = 'calendar-overflow-menu';

        const overflowBtn = document.createElement('button');
        overflowBtn.className = 'calendar-icon-btn overflow-trigger';
        overflowBtn.title = 'More options';
        overflowBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
        overflowBtn.style.display = 'inline-flex';
        overflowBtn.style.width = '28px';
        overflowBtn.style.height = '28px';

        const overflowDropdown = document.createElement('div');
        overflowDropdown.className = 'calendar-item-dropdown';

        const reminderActive = ev.reminder_minutes_before !== null && ev.reminder_minutes_before !== undefined;
        const reminderMenuItem = document.createElement('button');
        reminderMenuItem.className = 'calendar-item-menu-option';
        reminderMenuItem.innerHTML = `<i class="fa-solid fa-bell${reminderActive ? '' : '-slash'} ${reminderActive ? 'active-icon' : ''}"></i> ${reminderActive ? `Reminder (${formatReminderMinutes(ev.reminder_minutes_before)})` : 'Set Reminder'}`;
        reminderMenuItem.onclick = (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            openReminderEditor(ev);
        };

        const canceledActive = ev.status === 'canceled';
        const canceledMenuItem = document.createElement('button');
        canceledMenuItem.className = 'calendar-item-menu-option';
        canceledMenuItem.innerHTML = `<i class="fa-solid fa-ban ${canceledActive ? 'active-icon' : ''}"></i> ${canceledActive ? 'Mark active' : 'Mark canceled'}`;
        canceledMenuItem.onclick = async (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            const nextStatus = canceledActive ? 'not_started' : 'canceled';
            await updateCalendarEvent(ev.id, { status: nextStatus });
            ev.status = nextStatus;
            renderCalendarEvents();
        };

        const noteMenuItem = document.createElement('button');
        noteMenuItem.className = 'calendar-item-menu-option';
        noteMenuItem.innerHTML = '<i class="fa-solid fa-note-sticky"></i> Add Note...';
        noteMenuItem.onclick = async (e) => {
            e.stopPropagation();
            const resolved = await resolveCalendarEventId(ev);
            if (!resolved) return;
            showCalendarNoteChoiceInDropdown(overflowDropdown, resolved);
        };

        const convertMenuItem = document.createElement('button');
        convertMenuItem.className = 'calendar-item-menu-option';
        convertMenuItem.innerHTML = '<i class="fa-solid fa-list-check"></i> Convert to task';
        convertMenuItem.onclick = async (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            try {
                await updateCalendarEvent(ev.id, { is_event: false });
                ev.is_event = false;
                renderCalendarEvents();
            } catch (err) {
                console.error('Failed to convert event to task', err);
            }
        };

        const rolloverMenuItem = document.createElement('button');
        rolloverMenuItem.className = 'calendar-item-menu-option';
        rolloverMenuItem.innerHTML = `<i class="fa-solid fa-rotate ${ev.rollover_enabled ? 'active-icon' : ''}"></i> ${ev.rollover_enabled ? 'Disable' : 'Enable'} Rollover`;
        rolloverMenuItem.onclick = async (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            const next = !ev.rollover_enabled;
            try {
                await updateCalendarEvent(ev.id, { rollover_enabled: next });
                ev.rollover_enabled = next;
            } catch (err) {
                console.error('Failed to toggle rollover', err);
            }
        };

        const allowOverlapMenuItem = document.createElement('button');
        allowOverlapMenuItem.className = 'calendar-item-menu-option';
        const overlapLabel = ev.is_event
            ? (ev.allow_overlap ? 'Disallow' : 'Allow')
            : (ev.allow_overlap ? 'Allow' : 'Disallow');
        allowOverlapMenuItem.innerHTML = `<i class="fa-solid fa-layer-group ${ev.allow_overlap ? 'active-icon' : ''}"></i> ${overlapLabel} Overlap`;
        allowOverlapMenuItem.onclick = async (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            const next = !ev.allow_overlap;
            try {
                await updateCalendarEvent(ev.id, { allow_overlap: next });
                ev.allow_overlap = next;
            } catch (err) {
                console.error('Failed to toggle allow_overlap', err);
            }
        };

        const moveMenuItem = document.createElement('button');
        moveMenuItem.className = 'calendar-item-menu-option';
        moveMenuItem.innerHTML = '<i class="fa-solid fa-calendar-day"></i> Move to day';
        moveMenuItem.onclick = (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            openCalendarMovePrompt(ev);
        };

        const deleteMenuItem = document.createElement('button');
        deleteMenuItem.className = 'calendar-item-menu-option delete-option';
        deleteMenuItem.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
        deleteMenuItem.onclick = (e) => {
            e.stopPropagation();
            overflowDropdown.classList.remove('active');
            deleteCalendarEvent(ev.id);
        };

        const displayModeMenuItem = createDisplayModeMenuItem(ev, overflowDropdown);
        overflowDropdown.append(reminderMenuItem, canceledMenuItem, rolloverMenuItem, allowOverlapMenuItem, displayModeMenuItem, convertMenuItem, noteMenuItem, moveMenuItem, deleteMenuItem);
        overflowMenuContainer.append(overflowBtn);
        document.body.appendChild(overflowDropdown);

        const positionDropdown = () => {
            const rect = overflowBtn.getBoundingClientRect();
            const dropdownWidth = 180;
            const dropdownHeight = overflowDropdown.offsetHeight || 150;
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;
            const padding = 8;

            overflowDropdown.style.position = 'fixed';

            let topPos;
            const spaceBelow = screenHeight - rect.bottom;
            const spaceAbove = rect.top;

            if (spaceBelow < dropdownHeight + padding && spaceAbove > spaceBelow) {
                topPos = rect.top - dropdownHeight - 8;
            } else {
                topPos = rect.bottom + 8;
            }

            overflowDropdown.style.top = `${topPos}px`;

            let leftPos = rect.right - dropdownWidth;
            if (leftPos < padding) {
                leftPos = padding;
            }
            if (leftPos + dropdownWidth > screenWidth - padding) {
                leftPos = screenWidth - dropdownWidth - padding;
            }

            overflowDropdown.style.left = `${leftPos}px`;
        };

        overflowDropdown.updatePosition = positionDropdown;
        overflowDropdown.triggerButton = overflowBtn;

          overflowBtn.onclick = (e) => {
            e.stopPropagation();
            restoreCalendarNoteChoiceDropdown(overflowDropdown);
            const isOpen = overflowDropdown.classList.contains('active');
            document.querySelectorAll('.calendar-item-dropdown.active').forEach(d => {
                if (d !== overflowDropdown) {
                    d.classList.remove('active');
                }
            });
            if (!isOpen) {
                positionDropdown();
                overflowDropdown.classList.add('active');
            } else {
                overflowDropdown.classList.remove('active');
            }
        };

        if (noteChips.childNodes.length) actions.append(noteChips);
        actions.append(priorityDot, overflowMenuContainer);
        row.append(left, titleWrap, actions);
        attachCalendarRowSelection(row, ev);
        return row;
    };

    const renderGroup = (group) => {
        const row = document.createElement('div');
        row.className = 'calendar-row group';
        row.dataset.id = group.id;
        row.dataset.groupCollapsed = 'false';

        const grip = document.createElement('span');
        grip.className = 'group-icon';
        const groupEntry = groupMap.get(group.id);
        const children = (groupEntry && Array.isArray(groupEntry.children)) ? groupEntry.children : [];
        grip.innerHTML = `
            <i class="fa-solid fa-chevron-down" style="font-size: 0.75rem; margin-right: 0.25rem;"></i>
            <i class="fa-solid fa-layer-group"></i>
            <span class="count-badge" style="margin-left: 0.35rem;">${children.length}</span>
        `;
        grip.style.cursor = 'pointer';
        grip.onclick = () => {
            const isCollapsed = row.dataset.groupCollapsed === 'true';
            row.dataset.groupCollapsed = isCollapsed ? 'false' : 'true';
            const chevron = grip.querySelector('.fa-chevron-down');
            if (chevron) {
                chevron.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
            }
            // Toggle children visibility
            children.forEach(child => {
                const childRow = container.querySelector(`[data-id="${child.id}"]`);
                if (childRow && childRow !== row) {
                    childRow.style.display = isCollapsed ? '' : 'none';
                }
            });
        };

        const titleWrap = document.createElement('div');
        titleWrap.className = 'calendar-title';
        appendCalendarEditableTitle(titleWrap, {
            getValue: () => group.title,
            placeholder: 'Group title',
            ariaLabel: 'Edit group title',
            onSave: (nextTitle) => {
                updateCalendarEvent(group.id, { title: nextTitle });
            }
        });

        const actions = document.createElement('div');
        actions.className = 'calendar-actions-row';
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-icon';
        deleteBtn.title = 'Delete';
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteBtn.onclick = () => deleteCalendarEvent(group.id);
        actions.append(deleteBtn);

        row.append(grip, titleWrap, actions);
        container.appendChild(row);

        children.forEach(child => {
            // indent children slightly
            const childRow = child.is_event ? renderEvent(child, true) : renderPhaseOrTask(child, true);
            container.appendChild(childRow);
        });
    };

    const eventItems = dayEvents;
    const taskItems = sortCalendarItems([...groupsList, ...phasesAndTasks], sortMode);

    const toggleSection = (sectionId) => {
        const section = document.getElementById(`calendar-section-${sectionId}`);
        const divider = document.querySelector(`[data-section="${sectionId}"]`);
        if (section && divider) {
            section.classList.toggle('collapsed');
            divider.classList.toggle('collapsed');
        }
    };

    const addDivider = (label, count, sectionId) => {
        const d = document.createElement('div');
        d.className = 'calendar-event-divider';
        d.dataset.section = sectionId;
        d.innerHTML = `
            <span>
                ${label}
                <span class="count-badge">${count}</span>
            </span>
            <i class="fa-solid fa-chevron-down divider-icon"></i>
        `;
        d.onclick = () => toggleSection(sectionId);
        container.appendChild(d);
    };

    const createSection = (id) => {
        const section = document.createElement('div');
        section.id = `calendar-section-${id}`;
        section.className = 'calendar-section';
        return section;
    };

    if (eventItems.length) {
        addDivider('Events', eventItems.length, 'events');
        const eventSection = createSection('events');
        eventItems.forEach(ev => eventSection.appendChild(renderEvent(ev)));
        container.appendChild(eventSection);
    }

    if (taskItems.length) {
        addDivider('Tasks', taskItems.length, 'tasks');
        const taskSection = createSection('tasks');
        taskItems.forEach(ev => {
            if (ev.is_group) {
                renderGroup(ev);
            } else {
                taskSection.appendChild(renderPhaseOrTask(ev));
            }
        });
        container.appendChild(taskSection);
    }

    enableCalendarDragAndDrop(container);

    updateCalendarBulkBar();
}

function calendarSelectionKey(id) {
    return String(id);
}

function resetCalendarSelection() {
    calendarSelection.ids.clear();
    calendarSelection.active = false;
    document.querySelectorAll('.calendar-row.selected').forEach(row => row.classList.remove('selected'));
    const selectAll = document.getElementById('calendar-select-all');
    if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
    }
    updateCalendarBulkBar();
}

function setCalendarRowSelected(id, isSelected) {
    const row = document.querySelector(`.calendar-row[data-id="${id}"]`);
    if (row) row.classList.toggle('selected', isSelected);
}

function startCalendarSelection(id) {
    if (id === null || id === undefined) return;
    calendarSelection.active = true;
    const key = calendarSelectionKey(id);
    calendarSelection.ids.add(key);
    setCalendarRowSelected(key, true);
    updateCalendarBulkBar();
}

function toggleCalendarSelection(id) {
    if (id === null || id === undefined) return;
    const key = calendarSelectionKey(id);
    if (!calendarSelection.active) {
        calendarSelection.active = true;
    }
    if (calendarSelection.ids.has(key)) {
        calendarSelection.ids.delete(key);
        setCalendarRowSelected(key, false);
    } else {
        calendarSelection.ids.add(key);
        setCalendarRowSelected(key, true);
    }
    if (calendarSelection.ids.size === 0) {
        calendarSelection.active = false;
    }
    updateCalendarBulkBar();
}

function calendarSelectAll(checked) {
    const rows = document.querySelectorAll('.calendar-row.selectable');
    calendarSelection.active = checked;
    calendarSelection.ids.clear();
    rows.forEach(row => {
        const id = row.dataset.id;
        if (!id) return;
        setCalendarRowSelected(id, checked);
        if (checked) calendarSelection.ids.add(calendarSelectionKey(id));
    });
    updateCalendarBulkBar();
}

function getSelectedCalendarEvents(includeTaskLinks = true) {
    const selectedKeys = calendarSelection.ids;
    if (!selectedKeys.size) return [];
    return (calendarState.events || []).filter(ev =>
        selectedKeys.has(calendarSelectionKey(ev.id)) &&
        (includeTaskLinks || !ev.is_task_link)
    );
}

function shouldIgnoreCalendarSelection(target) {
    if (!target) return false;
    return !!target.closest('input, textarea, select, button, a, .calendar-item-dropdown, .priority-menu');
}

function handleCalendarRowClick(e, ev) {
    if (ev.is_phase || ev.is_group) return;
    if (shouldIgnoreCalendarSelection(e.target)) return;
    const metaPressed = e.metaKey || e.ctrlKey;
    if (!calendarSelection.active && !metaPressed) return;
    e.preventDefault();
    toggleCalendarSelection(ev.id);
}

function handleCalendarTouchStart(e, ev) {
    if (ev.is_phase || ev.is_group) return;
    if (shouldIgnoreCalendarSelection(e.target)) return;
    calendarSelection.longPressTriggered = false;
    calendarSelection.touchMoved = false;
    if (calendarSelection.longPressTimer) {
        clearTimeout(calendarSelection.longPressTimer);
    }
    if (e.touches && e.touches.length) {
        calendarSelection.touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    calendarSelection.longPressTimer = setTimeout(() => {
        calendarSelection.longPressTimer = null;
        calendarSelection.longPressTriggered = true;
        startCalendarSelection(ev.id);
    }, 450);
}

function handleCalendarTouchMove(e) {
    if (!e.touches || !e.touches.length || !calendarSelection.touchStart) return;
    const dx = Math.abs(e.touches[0].clientX - calendarSelection.touchStart.x);
    const dy = Math.abs(e.touches[0].clientY - calendarSelection.touchStart.y);
    // If moved more than threshold, mark as scrolling
    if (dx > 8 || dy > 8) {
        calendarSelection.touchMoved = true;
        if (calendarSelection.longPressTimer) {
            clearTimeout(calendarSelection.longPressTimer);
            calendarSelection.longPressTimer = null;
        }
    }
}

function handleCalendarTouchEnd(e, ev) {
    if (calendarSelection.longPressTimer) {
        clearTimeout(calendarSelection.longPressTimer);
        calendarSelection.longPressTimer = null;
    }
    if (calendarSelection.longPressTriggered) {
        e.preventDefault();
        calendarSelection.longPressTriggered = false;
        return;
    }
    // Don't toggle selection if user was scrolling
    if (calendarSelection.touchMoved) {
        calendarSelection.touchMoved = false;
        return;
    }
    if (calendarSelection.active && !shouldIgnoreCalendarSelection(e.target)) {
        e.preventDefault();
        toggleCalendarSelection(ev.id);
    }
}

function attachCalendarRowSelection(row, ev) {
    if (!row || ev.is_phase || ev.is_group || ev.is_note_list_item) return;
    row.classList.add('selectable');
    if (calendarSelection.ids.has(calendarSelectionKey(ev.id))) {
        row.classList.add('selected');
    }
    const indicator = document.createElement('div');
    indicator.className = 'calendar-select-indicator';
    indicator.innerHTML = '<i class="fa-solid fa-check"></i>';
    row.appendChild(indicator);

    row.addEventListener('click', (e) => handleCalendarRowClick(e, ev));
    row.addEventListener('touchstart', (e) => handleCalendarTouchStart(e, ev), { passive: true });
    row.addEventListener('touchmove', handleCalendarTouchMove, { passive: true });
    row.addEventListener('touchend', (e) => handleCalendarTouchEnd(e, ev));
}

function updateCalendarBulkBar() {
    const bar = document.getElementById('calendar-bulk-bar');
    const count = document.getElementById('calendar-bulk-count');
    const selectAll = document.getElementById('calendar-select-all');
    const hasSelection = calendarSelection.ids.size > 0;
    if (bar) {
        // Use display property for unified bulk bar styling
        bar.style.display = hasSelection ? 'flex' : 'none';
    }
    if (count) {
        count.textContent = hasSelection ? `${calendarSelection.ids.size} selected` : '0 selected';
    }
    if (selectAll) {
        const selectableRows = document.querySelectorAll('.calendar-row.selectable');
        const total = selectableRows.length;
        selectAll.checked = hasSelection && total > 0 && calendarSelection.ids.size >= total;
        selectAll.indeterminate = hasSelection && total > 0 && calendarSelection.ids.size > 0 && calendarSelection.ids.size < total;
    }
    document.body.classList.toggle('calendar-selection-active', hasSelection);
}

async function finalizeCalendarBulkUpdate({ reloadDay = true } = {}) {
    if (reloadDay && calendarState.selectedDay) {
        await loadCalendarDay(calendarState.selectedDay);
    } else {
        renderCalendarEvents();
    }
    if (calendarState.monthCursor) {
        await loadCalendarMonth();
    }
    resetCalendarSelection();
}

async function bulkCalendarUpdateStatus(status) {
    const targets = getSelectedCalendarEvents(true).filter(ev => !ev.is_phase && !ev.is_group);
    if (!targets.length) return;
    const normalEvents = targets.filter(ev => !ev.is_task_link);
    const linkedTasks = targets.filter(ev => ev.is_task_link && ev.task_id);
    await Promise.all(normalEvents.map(ev => updateCalendarEvent(ev.id, { status }, { skipReload: true, skipMonth: true })));
    await Promise.all(linkedTasks.map(ev => updateLinkedTaskStatus(ev.task_id, status)));
    await finalizeCalendarBulkUpdate();
}

async function bulkCalendarToggleRollover() {
    const targets = getSelectedCalendarEvents(false).filter(ev => !ev.is_phase && !ev.is_group && !ev.is_task_link);
    if (!targets.length) return;
    await Promise.all(targets.map(ev => {
        const current = ev.rollover_enabled !== false;
        return updateCalendarEvent(ev.id, { rollover_enabled: !current }, { skipReload: true, skipMonth: true });
    }));
    await finalizeCalendarBulkUpdate();
}

async function bulkCalendarChangePriority(priority) {
    if (!['low', 'medium', 'high'].includes(priority)) return;
    const targets = getSelectedCalendarEvents(false).filter(ev => !ev.is_phase && !ev.is_group && !ev.is_task_link);
    if (!targets.length) return;
    await Promise.all(targets.map(ev => updateCalendarEvent(ev.id, { priority }, { skipReload: true, skipMonth: true })));
    await finalizeCalendarBulkUpdate();
}

async function bulkCalendarDelete() {
    const targets = getSelectedCalendarEvents(false).filter(ev => !ev.is_phase && !ev.is_group && !ev.is_task_link);
    if (!targets.length) return;
    openConfirmModal(`Delete ${targets.length} selected item(s)?`, async () => {
        try {
            await Promise.all(targets.map(ev => fetch(`/api/calendar/events/${ev.id}`, { method: 'DELETE' })));
            calendarState.events = calendarState.events.filter(ev => !calendarSelection.ids.has(calendarSelectionKey(ev.id)));
        } catch (err) {
            console.error('Bulk delete failed', err);
        }
        await finalizeCalendarBulkUpdate({ reloadDay: true });
    });
}

async function bulkCalendarMove(dayStr) {
    if (!dayStr) return;
    const targets = getSelectedCalendarEvents(false).filter(ev => !ev.is_phase && !ev.is_group && !ev.is_task_link);
    if (!targets.length) return;
    await Promise.all(targets.map(ev => updateCalendarEvent(ev.id, { day: dayStr }, { skipReload: true })));
    await finalizeCalendarBulkUpdate();
}

function startBulkCalendarMovePrompt() {
    const targets = getSelectedCalendarEvents(false).filter(ev => !ev.is_phase && !ev.is_group && !ev.is_task_link);
    if (!targets.length) return;
    openCalendarPrompt({
        title: 'Move to day',
        message: 'Choose a date',
        type: 'date',
        defaultValue: calendarState.selectedDay || '',
        onSubmit: async (val) => {
            if (!val) return;
            const excludeEventIds = targets
                .map(ev => Number(ev.id))
                .filter(id => Number.isFinite(id));
            const movingLabel = `${targets.length} selected item${targets.length === 1 ? '' : 's'}`;
            await openCalendarMovePreviewModal({
                targetDay: val,
                movingLabel,
                excludeEventIds,
                onConfirm: async () => {
                    await bulkCalendarMove(val);
                }
            });
        }
    });
}

function startBulkCalendarPriorityPicker(anchor) {
    const button = anchor || document.getElementById('calendar-bulk-priority');
    if (!button) return;
    const hasSelection = calendarSelection.ids.size > 0;
    if (!hasSelection) return;
    openBulkPriorityDropdown(button, (val) => bulkCalendarChangePriority(val));
}

function startBulkCalendarNoteLink(anchor = null) {
    const targets = getSelectedCalendarEvents(true).filter(ev => !ev.is_phase && !ev.is_group && !ev.is_task_link);
    if (!targets.length) return;
    if (targets.length > 1) {
        showToast('Link note works one item at a time. Select one item to continue.', 'warning');
        return;
    }
    const ev = targets[0];
    const menu = document.getElementById('calendar-bulk-more-dropdown');
    if (!menu) return;
    showCalendarNoteChoiceInDropdown(menu, ev);
}

function enableCalendarDragAndDrop(container) {
    const rows = Array.from(container.querySelectorAll('.calendar-row'));
    if (!rows.length) return;
    let dragSrc = null;

    const typeKey = (row) => `${row.dataset.type || 'task'}|${row.dataset.groupId || ''}`;

    rows.forEach(row => {
        if ((row.dataset.type || '') === 'note-list' || (row.dataset.type || '') === 'feed') {
            row.draggable = false;
            return;
        }
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
            if (calendarSelection.ids.size) {
                e.preventDefault();
                return;
            }
            dragSrc = row;
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            rows.forEach(r => r.classList.remove('drag-over'));
            dragSrc = null;
        });
        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!dragSrc) return;
            if (typeKey(dragSrc) !== typeKey(row)) return;
            row.classList.add('drag-over');
        });
        row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            rows.forEach(r => r.classList.remove('drag-over'));
            if (!dragSrc) return;
            if (typeKey(dragSrc) !== typeKey(row)) return;
            if (dragSrc === row) return;
            const order = Array.from(container.querySelectorAll('.calendar-row'));
            const srcIdx = order.indexOf(dragSrc);
            const tgtIdx = order.indexOf(row);
            if (srcIdx === -1 || tgtIdx === -1) return;
            order.splice(tgtIdx, 0, order.splice(srcIdx, 1)[0]);
            // Rebuild events order and commit
            const idToEvent = new Map(calendarState.events.map(ev => [String(ev.id), ev]));
            calendarState.events = order.map(r => idToEvent.get(r.dataset.id)).filter(Boolean);
            commitCalendarOrder();
            renderCalendarEvents();
        });
    });
}

function parseCalendarQuickInput(text) {
    const raw = text.trim();
    if (!raw) return null;

    // Phase creation with task
    if (raw.startsWith('#')) {
        const afterSymbol = raw.substring(1).trim();
        let phaseName, taskText;

        // Check for comma separator for multi-word phase names
        if (afterSymbol.includes(',')) {
            const parts = afterSymbol.split(',');
            phaseName = parts[0].trim();
            taskText = parts.slice(1).join(',').trim();
        } else {
            // Split on first space
            const firstSpaceIndex = afterSymbol.indexOf(' ');
            if (firstSpaceIndex === -1) {
                // No space, just create the phase
                return { is_phase: true, title: afterSymbol || 'Untitled Phase' };
            }
            phaseName = afterSymbol.substring(0, firstSpaceIndex).trim();
            taskText = afterSymbol.substring(firstSpaceIndex + 1).trim();
        }

        if (!taskText) {
            // No task text, just create phase
            return { is_phase: true, title: phaseName };
        }

        // Return indicator to create both phase and task
        return {
            create_phase_with_task: true,
            phase_name: phaseName,
            task_text: taskText
        };
    }

    // Group creation with task
    if (raw.startsWith('>')) {
        const afterSymbol = raw.substring(1).trim();
        let groupName, taskText;

        // Check for comma separator for multi-word group names
        if (afterSymbol.includes(',')) {
            const parts = afterSymbol.split(',');
            groupName = parts[0].trim();
            taskText = parts.slice(1).join(',').trim();
        } else {
            // Split on first space
            const firstSpaceIndex = afterSymbol.indexOf(' ');
            if (firstSpaceIndex === -1) {
                // No space, just create the group
                return { is_group: true, title: afterSymbol || 'Untitled Group' };
            }
            groupName = afterSymbol.substring(0, firstSpaceIndex).trim();
            taskText = afterSymbol.substring(firstSpaceIndex + 1).trim();
        }

        if (!taskText) {
            // No task text, just create group
            return { is_group: true, title: groupName };
        }

        // Return indicator to create both group and task
        return {
            create_group_with_task: true,
            group_name: groupName,
            task_text: taskText
        };
    }

    const protectedLinks = protectCalendarMarkdownLinks(raw);
    let working = protectedLinks.maskedText;
    let startTime = null;
    let endTime = null;
    let priority = 'medium';
    let reminder = null;
    let phaseName = null;
    let rollover = true;
    let isEvent = false;
    let allowOverlap = false;
    let displayMode = 'both';
    let groupName = null;

    // SYMBOL-BASED SYNTAX

    // Event marker: $
    if (working.includes('$')) {
        isEvent = true;
        working = working.replace(/\$/g, '').trim();
        rollover = false;
    }

    // Overlap marker: ? (events allow overlap; tasks disallow overlap)
    if (working.includes('?')) {
        allowOverlap = true;
        working = working.replace(/\?/g, '').trim();
    }

    // Timeline-only marker: & (hide from day list, keep in timeline)
    // Also supports legacy "~" marker.
    const timelineOnlyPattern = /(^|\s)[&~](?=\s|$)/;
    if (timelineOnlyPattern.test(working)) {
        displayMode = 'timeline_only';
        working = working.replace(/(^|\s)[&~](?=\s|$)/g, ' ').trim();
    }

    // Time: @time or @time-time
    const timeMatch = working.match(/@(\d{1,2}(?::\d{2})?(?:am|pm)?)\s*(?:-\s*(\d{1,2}(?::\d{2})?(?:am|pm)?))?/i);
    if (timeMatch) {
        startTime = timeMatch[1];
        endTime = timeMatch[2] || null;
        working = working.replace(timeMatch[0], '').trim();
    }

    // Priority: !h, !m, !l OR !high, !medium, !low
    const priorityMatch = working.match(/!(h|m|l|high|med|medium|low)/i);
    if (priorityMatch) {
        const val = priorityMatch[1].toLowerCase();
        if (val === 'h' || val === 'high') priority = 'high';
        else if (val === 'l' || val === 'low') priority = 'low';
        else priority = 'medium';
        working = working.replace(priorityMatch[0], '').trim();
    }

    // Reminder: *30, *2h, *1d
    const reminderMatch = working.match(/\*(\d+)\s*([mhd])?/i);
    if (reminderMatch) {
        reminder = parseReminderMinutesInput(`${reminderMatch[1]}${reminderMatch[2] || ''}`);
        working = working.replace(reminderMatch[0], '').trim();
    }

    // Phase: #name
    const phaseMatch = working.match(/#([A-Za-z0-9 _-]+)/);
    if (phaseMatch) {
        phaseName = phaseMatch[1].trim();
        working = working.replace(phaseMatch[0], '').trim();
    }

    // Group: >name
    const groupMatch = working.match(/>([A-Za-z0-9 _-]+)/);
    if (groupMatch) {
        groupName = groupMatch[1].trim();
        working = working.replace(groupMatch[0], '').trim();
    }

    // Disable rollover: -
    if (working.includes('-')) {
        rollover = false;
        working = working.replace(/-/g, '').trim();
    }
    // Enable rollover: +
    if (working.includes('+')) {
        rollover = true;
        working = working.replace(/\+/g, '').trim();
    }

    const restored = restoreCalendarMarkdownLinks(working.trim(), protectedLinks.matches);
    const title = restored.trim();
    if (!title) return null;

    return {
        title,
        is_phase: false,
        is_event: isEvent,
        allow_overlap: allowOverlap,
        start_time: startTime,
        end_time: endTime,
        priority,
        reminder_minutes_before: reminder,
        phase_name: phaseName,
        group_name: groupName,
        display_mode: displayMode,
        rollover_enabled: rollover
    };
}
