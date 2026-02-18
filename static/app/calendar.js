function updateDynamicHint(text) {
    // No dynamic hint updates - keep it simple
}

function resizeDayQuickInput(inputEl) {
    if (!inputEl) return;
    const styles = window.getComputedStyle(inputEl);
    const lineHeight = parseFloat(styles.lineHeight) || 20;
    const paddingTop = parseFloat(styles.paddingTop) || 0;
    const paddingBottom = parseFloat(styles.paddingBottom) || 0;
    const border = inputEl.offsetHeight - inputEl.clientHeight;
    const maxHeight = Math.ceil((lineHeight * 2) + paddingTop + paddingBottom + border);

    inputEl.style.height = 'auto';
    const nextHeight = Math.min(inputEl.scrollHeight, maxHeight);
    inputEl.style.height = `${nextHeight}px`;
    inputEl.style.overflowY = inputEl.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

let priorityMenuEl = null;
const calendarDebugLog = (...args) => {
    if (window.DEBUG_CALENDAR === true) console.log(...args);
};
function closePriorityMenu() {
    if (priorityMenuEl) {
        priorityMenuEl.classList.add('is-hidden');
    }
}

function openPriorityMenu(target, current, onSelect) {
    if (!priorityMenuEl) {
        priorityMenuEl = document.createElement('div');
        priorityMenuEl.className = 'priority-menu is-hidden';
        document.body.appendChild(priorityMenuEl);
    }
    priorityMenuEl.innerHTML = '';
    ['low', 'medium', 'high'].forEach(val => {
        const btn = document.createElement('button');
        btn.className = `priority-menu-item ${val === current ? 'active' : ''}`;
        btn.textContent = val.charAt(0).toUpperCase() + val.slice(1);
        btn.onclick = async () => {
            await onSelect(val);
            closePriorityMenu();
        };
        priorityMenuEl.appendChild(btn);
    });
    const rect = target.getBoundingClientRect();
    priorityMenuEl.style.top = `${rect.bottom + window.scrollY + 6}px`;
    priorityMenuEl.style.left = `${rect.left + window.scrollX}px`;
    priorityMenuEl.classList.remove('is-hidden');
}

document.addEventListener('click', (e) => {
    if (!priorityMenuEl) return;
    if (priorityMenuEl.classList.contains('is-hidden')) return;
    if (!e.target.closest('.priority-menu')) {
        closePriorityMenu();
    }
});

let bulkPriorityDropdown = null;
function closeBulkPriorityDropdown() {
    if (bulkPriorityDropdown) bulkPriorityDropdown.classList.add('is-hidden');
}

function openBulkPriorityDropdown(anchor, onSelect) {
    if (!bulkPriorityDropdown) {
        bulkPriorityDropdown = document.createElement('div');
        bulkPriorityDropdown.className = 'priority-menu priority-menu-bulk is-hidden';
        document.body.appendChild(bulkPriorityDropdown);
    }
    bulkPriorityDropdown.innerHTML = '';
    ['low', 'medium', 'high'].forEach(val => {
        const btn = document.createElement('button');
        btn.className = 'priority-menu-item';
        btn.textContent = `Set to ${val.charAt(0).toUpperCase() + val.slice(1)}`;
        btn.onclick = async () => {
            await onSelect(val);
            closeBulkPriorityDropdown();
        };
        bulkPriorityDropdown.appendChild(btn);
    });
    const rect = anchor.getBoundingClientRect();
    bulkPriorityDropdown.style.top = `${rect.bottom + window.scrollY + 6}px`;
    bulkPriorityDropdown.style.left = `${rect.left + window.scrollX}px`;
    bulkPriorityDropdown.classList.remove('is-hidden');
}

document.addEventListener('click', (e) => {
    if (bulkPriorityDropdown && !bulkPriorityDropdown.classList.contains('is-hidden')) {
        if (!e.target.closest('.priority-menu-bulk') && !e.target.closest('#calendar-bulk-priority')) {
            closeBulkPriorityDropdown();
        }
    }
});

async function getOrCreatePhase(phaseName) {
    const existing = calendarState.events.find(e => e.is_phase && e.title.toLowerCase() === phaseName.toLowerCase());
    if (existing) {
        return existing.id;
    } else {
        const created = await createCalendarEvent({ title: phaseName, is_phase: true });
        return created ? created.id : null;
    }
}

async function getOrCreateGroup(groupName) {
    const existing = calendarState.events.find(e => e.is_group && e.title.toLowerCase() === groupName.toLowerCase());
    if (existing) {
        return existing.id;
    } else {
        const created = await createCalendarEvent({ title: groupName, is_group: true, is_event: false, is_phase: false });
        return created ? created.id : null;
    }
}

async function handleCalendarQuickAdd() {
    const input = document.getElementById('calendar-quick-input');
    if (!input || !calendarState.selectedDay || !calendarState.dayViewOpen) return;
    const rawValue = input.value || '';
    const parsed = parseCalendarQuickInput(rawValue);
    if (!parsed) return;
    const restoreInput = () => {
        input.value = rawValue;
        resizeDayQuickInput(input);
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    };
    const clearInput = () => {
        input.value = '';
        resizeDayQuickInput(input);
        input.focus();
    };

    // Handle phase creation with task
    if (parsed.create_phase_with_task) {
        const createdPhase = await createCalendarEvent({
            title: parsed.phase_name,
            is_phase: true
        });
        if (!createdPhase) {
            restoreInput();
            return;
        }
        const phaseId = createdPhase ? createdPhase.id : null;

        // Parse task text for all properties
        const taskParsed = parseCalendarQuickInput(parsed.task_text);
        if (taskParsed && !taskParsed.is_phase && !taskParsed.is_group && !taskParsed.create_phase_with_task && !taskParsed.create_group_with_task) {
            const createdTask = await createCalendarEvent({
                title: taskParsed.title,
                is_phase: false,
                is_event: taskParsed.is_event || false,
                allow_overlap: taskParsed.allow_overlap,
                phase_id: phaseId,
                start_time: taskParsed.start_time,
                end_time: taskParsed.end_time,
                priority: taskParsed.priority,
                reminder_minutes_before: taskParsed.reminder_minutes_before,
                display_mode: taskParsed.display_mode,
                group_id: taskParsed.group_name ? (await getOrCreateGroup(taskParsed.group_name)) : null,
                rollover_enabled: taskParsed.rollover_enabled
            });
            if (!createdTask) {
                restoreInput();
                return;
            }
        }

        if (calendarState.detailsOpen) {
            await loadCalendarDay(calendarState.selectedDay);
        } else {
            await loadCalendarMonth();
        }
        clearInput();
        return;
    }

    // Handle group creation with task
    if (parsed.create_group_with_task) {
        const createdGroup = await createCalendarEvent({
            title: parsed.group_name,
            is_group: true,
            is_event: false,
            is_phase: false
        });
        if (!createdGroup) {
            restoreInput();
            return;
        }
        const groupId = createdGroup ? createdGroup.id : null;

        // Parse task text for all properties
        const taskParsed = parseCalendarQuickInput(parsed.task_text);
        if (taskParsed && !taskParsed.is_phase && !taskParsed.is_group && !taskParsed.create_phase_with_task && !taskParsed.create_group_with_task) {
            let phaseId = null;
            if (taskParsed.phase_name) {
                phaseId = await getOrCreatePhase(taskParsed.phase_name);
            }

            const createdTask = await createCalendarEvent({
                title: taskParsed.title,
                is_phase: false,
                is_event: taskParsed.is_event || false,
                allow_overlap: taskParsed.allow_overlap,
                group_id: groupId,
                phase_id: phaseId,
                start_time: taskParsed.start_time,
                end_time: taskParsed.end_time,
                priority: taskParsed.priority,
                reminder_minutes_before: taskParsed.reminder_minutes_before,
                display_mode: taskParsed.display_mode,
                rollover_enabled: taskParsed.rollover_enabled
            });
            if (!createdTask) {
                restoreInput();
                return;
            }
        }

        if (calendarState.detailsOpen) {
            await loadCalendarDay(calendarState.selectedDay);
        } else {
            await loadCalendarMonth();
        }
        clearInput();
        return;
    }

    const isEvent = parsed.is_event || false;
    if (parsed.is_phase) {
        const created = await createCalendarEvent({ title: parsed.title, is_phase: true });
        if (!created) {
            restoreInput();
            return;
        }
        if (calendarState.detailsOpen) {
            await loadCalendarDay(calendarState.selectedDay);
        } else {
            await loadCalendarMonth();
        }
        clearInput();
        return;
    }

    if (parsed.is_group) {
        const created = await createCalendarEvent({ title: parsed.title, is_group: true, is_event: false, is_phase: false });
        if (!created) {
            restoreInput();
            return;
        }
        if (calendarState.detailsOpen) {
            await loadCalendarDay(calendarState.selectedDay);
        } else {
            await loadCalendarMonth();
        }
        clearInput();
        return;
    }

    let phaseId = null;
    if (parsed.phase_name) {
        const existing = calendarState.events.find(e => e.is_phase && e.title.toLowerCase() === parsed.phase_name.toLowerCase());
        if (existing) {
            phaseId = existing.id;
        } else {
            const createdPhase = await createCalendarEvent({ title: parsed.phase_name, is_phase: true });
            phaseId = createdPhase ? createdPhase.id : null;
        }
    } else {
        // Default to most recent phase if present
        const phases = calendarState.events.filter(e => e.is_phase).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
        if (phases.length > 0) {
            phaseId = phases[phases.length - 1].id;
        }
    }

    let finalGroupId = null;
    if (parsed.group_name) {
        const existing = calendarState.events.find(e => e.is_group && e.title.toLowerCase() === parsed.group_name.toLowerCase());
        if (existing) {
            finalGroupId = existing.id;
        } else {
            const createdGroup = await createCalendarEvent({ title: parsed.group_name, is_group: true, is_event: false, is_phase: false });
            finalGroupId = createdGroup ? createdGroup.id : null;
        }
    }

    const created = await createCalendarEvent({
        title: parsed.title,
        is_phase: false,
        is_event: isEvent,
        allow_overlap: parsed.allow_overlap,
        group_id: finalGroupId,
        start_time: parsed.start_time,
        end_time: parsed.end_time,
        priority: parsed.priority,
        reminder_minutes_before: parsed.reminder_minutes_before,
        display_mode: parsed.display_mode,
        phase_id: isEvent ? null : phaseId,
        rollover_enabled: parsed.rollover_enabled
    });
    if (!created) {
        restoreInput();
        return;
    }
    if (calendarState.detailsOpen) {
        await loadCalendarDay(calendarState.selectedDay);
    } else {
        await loadCalendarMonth();
    }
    clearInput();
}

async function handleMonthQuickAdd() {
    const input = document.getElementById('calendar-month-quick-input');
    const panel = document.getElementById('calendar-quick-add-panel');
    if (!input || !calendarState.selectedDay) return;

    const rawValue = input.value || '';
    const parsed = parseCalendarQuickInput(rawValue);
    if (!parsed) return;

    const restoreInput = () => {
        input.value = rawValue;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    };
    const clearInput = () => {
        input.value = '';
        input.focus();
    };

    // Handle phase creation with task
    if (parsed.create_phase_with_task) {
        const createdPhase = await createCalendarEvent({
            title: parsed.phase_name,
            is_phase: true
        });
        if (!createdPhase) {
            restoreInput();
            return;
        }
        const phaseId = createdPhase ? createdPhase.id : null;

        // Parse task text for all properties
        const taskParsed = parseCalendarQuickInput(parsed.task_text);
        if (taskParsed && !taskParsed.is_phase && !taskParsed.is_group && !taskParsed.create_phase_with_task && !taskParsed.create_group_with_task) {
            const monthEvents = await fetchMonthEvents(calendarState.selectedDay);
            let groupId = null;
            if (taskParsed.group_name) {
                const existingGroup = monthEvents.find(e => e.is_group && e.title.toLowerCase() === taskParsed.group_name.toLowerCase());
                if (existingGroup) {
                    groupId = existingGroup.id;
                } else {
                    const createdGroup = await createCalendarEvent({
                        title: taskParsed.group_name,
                        is_group: true,
                        is_event: false,
                        is_phase: false
                    });
                    groupId = createdGroup ? createdGroup.id : null;
                    if (!createdGroup) {
                        restoreInput();
                        return;
                    }
                }
            }

            const createdTask = await createCalendarEvent({
                title: taskParsed.title,
                is_phase: false,
                is_event: taskParsed.is_event || false,
                allow_overlap: taskParsed.allow_overlap,
                phase_id: phaseId,
                group_id: groupId,
                start_time: taskParsed.start_time,
                end_time: taskParsed.end_time,
                priority: taskParsed.priority,
                reminder_minutes_before: taskParsed.reminder_minutes_before,
                display_mode: taskParsed.display_mode,
                rollover_enabled: taskParsed.rollover_enabled
            });
            if (!createdTask) {
                restoreInput();
                return;
            }
        }

        await loadCalendarMonth();
        if (panel) panel.classList.add('is-hidden');
        clearInput();
        return;
    }

    // Handle group creation with task
    if (parsed.create_group_with_task) {
        const createdGroup = await createCalendarEvent({
            title: parsed.group_name,
            is_group: true,
            is_event: false,
            is_phase: false
        });
        if (!createdGroup) {
            restoreInput();
            return;
        }
        const groupId = createdGroup ? createdGroup.id : null;

        // Parse task text for all properties
        const taskParsed = parseCalendarQuickInput(parsed.task_text);
        if (taskParsed && !taskParsed.is_phase && !taskParsed.is_group && !taskParsed.create_phase_with_task && !taskParsed.create_group_with_task) {
            const monthEvents = await fetchMonthEvents(calendarState.selectedDay);
            let phaseId = null;
            if (taskParsed.phase_name) {
                const existingPhase = monthEvents.find(e => e.is_phase && e.title.toLowerCase() === taskParsed.phase_name.toLowerCase());
                if (existingPhase) {
                    phaseId = existingPhase.id;
                } else {
                    const createdPhase = await createCalendarEvent({
                        title: taskParsed.phase_name,
                        is_phase: true
                    });
                    phaseId = createdPhase ? createdPhase.id : null;
                    if (!createdPhase) {
                        restoreInput();
                        return;
                    }
                }
            }

            const createdTask = await createCalendarEvent({
                title: taskParsed.title,
                is_phase: false,
                is_event: taskParsed.is_event || false,
                allow_overlap: taskParsed.allow_overlap,
                group_id: groupId,
                phase_id: phaseId,
                start_time: taskParsed.start_time,
                end_time: taskParsed.end_time,
                priority: taskParsed.priority,
                reminder_minutes_before: taskParsed.reminder_minutes_before,
                display_mode: taskParsed.display_mode,
                rollover_enabled: taskParsed.rollover_enabled
            });
            if (!createdTask) {
                restoreInput();
                return;
            }
        }

        await loadCalendarMonth();
        if (panel) panel.classList.add('is-hidden');
        clearInput();
        return;
    }

    const isEvent = parsed.is_event || false;

    // Load the day's events to get phases and groups
    await loadCalendarMonth();

    if (parsed.is_phase) {
        const created = await createCalendarEvent({ title: parsed.title, is_phase: true });
        if (!created) {
            restoreInput();
            return;
        }
        await loadCalendarMonth();
        if (panel) panel.classList.add('is-hidden');
        clearInput();
        return;
    }

    if (parsed.is_group) {
        const created = await createCalendarEvent({ title: parsed.title, is_group: true, is_event: false, is_phase: false });
        if (!created) {
            restoreInput();
            return;
        }
        await loadCalendarMonth();
        if (panel) panel.classList.add('is-hidden');
        clearInput();
        return;
    }

    let phaseId = null;
    if (parsed.phase_name) {
        const monthEvents = await fetchMonthEvents(calendarState.selectedDay);
        const existing = monthEvents.find(e => e.is_phase && e.title.toLowerCase() === parsed.phase_name.toLowerCase());
        if (existing) {
            phaseId = existing.id;
        } else {
            const createdPhase = await createCalendarEvent({ title: parsed.phase_name, is_phase: true });
            phaseId = createdPhase ? createdPhase.id : null;
            if (!createdPhase) {
                restoreInput();
                return;
            }
        }
    }

    let finalGroupId = null;
    if (parsed.group_name) {
        const monthEvents = await fetchMonthEvents(calendarState.selectedDay);
        const existing = monthEvents.find(e => e.is_group && e.title.toLowerCase() === parsed.group_name.toLowerCase());
        if (existing) {
            finalGroupId = existing.id;
        } else {
            const createdGroup = await createCalendarEvent({ title: parsed.group_name, is_group: true, is_event: false, is_phase: false });
            finalGroupId = createdGroup ? createdGroup.id : null;
            if (!createdGroup) {
                restoreInput();
                return;
            }
        }
    }

    const created = await createCalendarEvent({
        title: parsed.title,
        is_phase: false,
        is_event: isEvent,
        allow_overlap: parsed.allow_overlap,
        group_id: finalGroupId,
        start_time: parsed.start_time,
        end_time: parsed.end_time,
        priority: parsed.priority,
        reminder_minutes_before: parsed.reminder_minutes_before,
        display_mode: parsed.display_mode,
        phase_id: isEvent ? null : phaseId,
        rollover_enabled: parsed.rollover_enabled
    });
    if (!created) {
        restoreInput();
        return;
    }

    await loadCalendarMonth();
    if (panel) panel.classList.add('is-hidden');
    clearInput();
}

async function fetchMonthEvents(dayStr) {
    try {
        const res = await fetch(`/api/calendar/events?day=${dayStr}`);
        if (!res.ok) return [];
        return await res.json();
    } catch (err) {
        console.error(err);
        return [];
    }
}

function renderMonthAutocompleteSuggestions(suggestions) {
    const container = document.getElementById('calendar-month-autocomplete');
    if (!container) return;

    if (!suggestions || suggestions.length === 0) {
        hideMonthAutocomplete();
        return;
    }

    container.innerHTML = '';
    suggestions.forEach((sug, index) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item' + (index === autocompleteState.selectedIndex ? ' selected' : '');
        item.innerHTML = `<strong>${sug.display}</strong> <span class="autocomplete-hint">${sug.hint || ''}</span>`;
        item.onclick = () => {
            const input = document.getElementById('calendar-month-quick-input');
            if (input && sug.insert) {
                const before = input.value.substring(0, autocompleteState.cursorPos);
                const after = input.value.substring(autocompleteState.cursorPos);
                input.value = before + sug.insert + after;
                input.setSelectionRange(
                    autocompleteState.cursorPos + sug.insert.length,
                    autocompleteState.cursorPos + sug.insert.length
                );
                input.focus();
            }
            hideMonthAutocomplete();
        };
        container.appendChild(item);
    });

    container.classList.remove('is-hidden');
}

function hideMonthAutocomplete() {
    const container = document.getElementById('calendar-month-autocomplete');
    if (container) container.classList.add('is-hidden');
    autocompleteState.visible = false;
    autocompleteState.suggestions = [];
}

async function createCalendarEvent(payload, options = {}) {
    const { skipConflictWarning = false } = options;
    try {
        const res = await fetch('/api/calendar/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, day: calendarState.selectedDay })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            // Check if this is a conflict warning (not a hard error)
            if (res.status === 409 && err && err.conflict_warning && !skipConflictWarning) {
                const conflictTitle = err.conflict_event_title;
                const conflictMessage = err.message || (conflictTitle ? `"${conflictTitle}" is scheduled during this time. Add task anyway?` : null);
                // Show modal and let user decide
                return new Promise((resolve) => {
                    openOverlapWarningModal(conflictMessage, async () => {
                        // Retry with force_overlap
                        const result = await createCalendarEvent({ ...payload, force_overlap: true }, { skipConflictWarning: true });
                        if (result) {
                            // Reload calendar to show the new item
                            if (calendarState.detailsOpen && calendarState.selectedDay) {
                                await loadCalendarDay(calendarState.selectedDay);
                            }
                            if (calendarState.monthCursor) {
                                renderCalendarMonth();
                            }
                        }
                        resolve(result);
                    }, () => {
                        resolve(null);
                    });
                });
            }
            if (err && err.error) {
                showToast(err.error, 'warning');
            } else if (!err.conflict_warning) {
                showToast('Could not save calendar item.', 'error');
            }
            console.error(err);
            return null;
        }
        return await res.json();
    } catch (err) {
        console.error(err);
        return null;
    }
}

async function updateCalendarEvent(id, payload, options = {}) {
    const { skipReload = false, skipMonth = false, skipConflictWarning = false } = options;
    const prevEvent = Array.isArray(calendarState.events) ? calendarState.events.find(e => e.id === id) : null;
    const prevDay = prevEvent ? prevEvent.day : null;
    const prevReminderId = prevEvent ? (prevEvent.calendar_event_id || prevEvent.id) : null;
    const prevHadReminder = !!(
        prevEvent &&
        prevEvent.start_time &&
        prevEvent.reminder_minutes_before !== null &&
        prevEvent.reminder_minutes_before !== undefined
    );
    const reminderAffecting = payload && ['status', 'reminder_minutes_before', 'start_time', 'day'].some(key => Object.prototype.hasOwnProperty.call(payload, key));
    try {
        const res = await fetch(`/api/calendar/events/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            // Check if this is a conflict warning (not a hard error)
            if (res.status === 409 && err && err.conflict_warning && !skipConflictWarning) {
                const conflictTitle = err.conflict_event_title;
                const conflictMessage = err.message || (conflictTitle ? `"${conflictTitle}" is scheduled during this time. Update task anyway?` : null);
                // Show modal and let user decide
                openOverlapWarningModal(conflictMessage, async () => {
                    // Retry with force_overlap
                    await updateCalendarEvent(id, { ...payload, force_overlap: true }, { ...options, skipConflictWarning: true });
                });
                return;
            }
            if (err && err.error) {
                showToast(err.error, 'warning');
            } else if (!err.conflict_warning) {
                showToast('Could not update calendar item.', 'error');
            }
            console.error(err);
            return;
        }

        let updated = null;
        try {
            updated = await res.json();
        } catch (_) {
            // Some updates may not return JSON; skip in that case
        }
        if (window.isNativeApp && window.isNativeApp() && prevReminderId && prevHadReminder) {
            const movedDay = !!(updated && prevDay && updated.day && updated.day !== prevDay);
            const updatedReminderStillActive = !!(
                updated &&
                updated.status !== 'done' &&
                updated.status !== 'canceled' &&
                updated.start_time &&
                updated.reminder_minutes_before !== null &&
                updated.reminder_minutes_before !== undefined
            );
            const payloadLikelyCancels = (
                (Object.prototype.hasOwnProperty.call(payload, 'status') && ['done', 'canceled'].includes(payload.status)) ||
                (Object.prototype.hasOwnProperty.call(payload, 'reminder_minutes_before') && (payload.reminder_minutes_before === null || payload.reminder_minutes_before === undefined || payload.reminder_minutes_before === '')) ||
                (Object.prototype.hasOwnProperty.call(payload, 'start_time') && !payload.start_time) ||
                (Object.prototype.hasOwnProperty.call(payload, 'day') && prevDay && payload.day && payload.day !== prevDay)
            );
            if (movedDay || !updatedReminderStillActive || (!updated && payloadLikelyCancels)) {
                if (window.NotificationService && typeof window.NotificationService.cancel === 'function') {
                    await window.NotificationService.cancel(prevReminderId);
                }
            }
        }

        // Optimistically update local state so the UI reflects changes without waiting on a reload
        if (updated && Array.isArray(calendarState.events)) {
            const movedOffDay = updated.day && calendarState.selectedDay && updated.day !== calendarState.selectedDay;
            calendarState.events = calendarState.events
                .map(ev => ev.id === id ? { ...ev, ...updated } : ev)
                .filter(ev => !(ev.id === id && movedOffDay));
        }

        const newDay = (updated && updated.day) ? updated.day : calendarState.selectedDay;
        if (calendarState.monthEventsByDay) {
            // Remove from previous day bucket if it changed
            if (prevDay && updated && updated.day && prevDay !== updated.day && Array.isArray(calendarState.monthEventsByDay[prevDay])) {
                calendarState.monthEventsByDay[prevDay] = calendarState.monthEventsByDay[prevDay].filter(ev => ev.id !== id);
            }
            if (newDay) {
                const bucket = calendarState.monthEventsByDay[newDay] || [];
                const replaced = bucket.some(ev => ev.id === id);
                const nextBucket = replaced
                    ? bucket.map(ev => ev.id === id ? { ...ev, ...updated } : ev)
                    : [...bucket, { ...updated }];
                calendarState.monthEventsByDay[newDay] = nextBucket;
            }
        }

        if (!skipReload) {
            if (calendarState.detailsOpen && calendarState.selectedDay) {
                await loadCalendarDay(calendarState.selectedDay);
            } else if (updated) {
                renderCalendarEvents();
            }
        }
        if (calendarState.monthCursor && !skipMonth) {
            renderCalendarMonth();
        }
        if (reminderAffecting) {
            await scheduleLocalReminders();
        }
    } catch (err) {
        console.error(err);
    }
}

async function deleteCalendarEvent(id) {
    try {
        await fetch(`/api/calendar/events/${id}`, { method: 'DELETE' });
        if (window.isNativeApp && window.isNativeApp()) {
            if (window.NotificationService && typeof window.NotificationService.cancel === 'function') {
                await window.NotificationService.cancel(id);
            }
        }
        calendarState.events = calendarState.events.filter(e => e.id !== id);
        renderCalendarEvents();
    } catch (err) {
        console.error(err);
    }
}

async function commitCalendarOrder() {
    const ids = calendarState.events.filter(e => !e.is_task_link).map(e => e.id);
    try {
        await fetch('/api/calendar/events/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ day: calendarState.selectedDay, ids })
        });
    } catch (err) {
        console.error(err);
    }
}

function nudgeCalendarEvent(id, delta) {
    const idx = calendarState.events.findIndex(e => e.id === id && !e.is_task_link);
    if (idx === -1) return;
    const target = idx + delta;
    if (target < 0 || target >= calendarState.events.length) return;
    const swapped = [...calendarState.events];
    const tmp = swapped[idx];
    swapped[idx] = swapped[target];
    swapped[target] = tmp;
    calendarState.events = swapped.map((ev, i) => ({ ...ev, order_index: i + 1 }));
    renderCalendarEvents();
    commitCalendarOrder();
}

async function scheduleLocalReminders() {
    // Clear old timers (only needed for web mode)
    Object.values(calendarReminderTimers).forEach(t => clearTimeout(t));
    calendarReminderTimers = {};

    if (!calendarNotifyEnabled || !calendarState.selectedDay) return;

    const now = new Date();

    // In native app mode, use Capacitor Local Notifications
    if (window.isNativeApp && window.isNativeApp()) {
        // Cancel reminder IDs tied to events in the active day before recalculating this day's schedule.
        const cancelIds = new Set();
        calendarState.events.forEach((ev) => {
            if (!ev.start_time || ev.reminder_minutes_before === null || ev.reminder_minutes_before === undefined) return;
            const reminderId = ev.calendar_event_id || ev.id;
            cancelIds.add(reminderId);
        });
        for (const id of cancelIds) {
            if (window.NotificationService && typeof window.NotificationService.cancel === 'function') {
                await window.NotificationService.cancel(id);
            }
        }

        // Schedule new notifications
        calendarState.events.forEach(async (ev) => {
            if (ev.status === 'done' || ev.status === 'canceled') return;
            if (!ev.start_time || ev.reminder_minutes_before === null || ev.reminder_minutes_before === undefined) return;

            const target = new Date(`${calendarState.selectedDay}T${ev.start_time}`);
            const reminderAt = new Date(target.getTime() - ev.reminder_minutes_before * 60000);
            const reminderId = ev.calendar_event_id || ev.id;

            if (reminderAt.getTime() > now.getTime()) {
                const body = ev.start_time ? `${formatTimeRange(ev)} - ${ev.title}` : ev.title;

                if (window.NotificationService && typeof window.NotificationService.schedule === 'function') {
                    await window.NotificationService.schedule({
                        id: reminderId,
                        title: 'Upcoming Event',
                        body: body,
                        at: reminderAt,
                        extra: { url: '/calendar', eventId: ev.id }
                    });
                }
            }
        });
    } else {
        // Web mode: use setTimeout as before
        calendarState.events.forEach(ev => {
            if (ev.status === 'done' || ev.status === 'canceled') return;
            if (!ev.start_time || ev.reminder_minutes_before === null || ev.reminder_minutes_before === undefined) return;
            const target = new Date(`${calendarState.selectedDay}T${ev.start_time}`);
            const reminderAt = new Date(target.getTime() - ev.reminder_minutes_before * 60000);
            const delay = reminderAt.getTime() - now.getTime();
            if (delay > 0) {
                const reminderId = ev.calendar_event_id || ev.id;
                calendarReminderTimers[reminderId] = setTimeout(() => {
                    triggerLocalNotification(ev);
                }, delay);
            }
        });
    }
}

function triggerLocalNotification(ev) {
    const body = ev.start_time ? `${formatTimeRange(ev)} - ${ev.title}` : ev.title;
    showNativeNotification('Upcoming event', { body, data: { url: '/calendar' } });
}

async function enableCalendarNotifications() {
    // In native app, use NotificationService
    if (window.isNativeApp && window.isNativeApp()) {
        const hasPermission = window.NotificationService && typeof window.NotificationService.initialize === 'function'
            ? await window.NotificationService.initialize()
            : false;
        if (hasPermission) {
            calendarNotifyEnabled = true;
            await scheduleLocalReminders();

            // Show success notification
            if (window.NotificationService && typeof window.NotificationService.show === 'function') {
                await window.NotificationService.show('Notifications Enabled', {
                    body: 'You will now receive notifications for your calendar events and reminders.'
                });
            }
        } else {
            calendarNotifyEnabled = false;
            showToast('Notification permission denied. Enable in device settings.', 'warning');
        }
        return;
    }

    // Web mode: use existing web notification system
    if (!('Notification' in window)) {
        showToast('Notifications are not supported in this browser', 'warning');
        return;
    }

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
        calendarNotifyEnabled = false;
        showToast('Notification permission denied. Enable in browser settings.', 'warning');
        return;
    }

    const registration = await ensureServiceWorkerRegistered();
    if (!registration) {
        showToast('Could not register service worker. Notifications may not work.', 'error');
        calendarNotifyEnabled = true;
        scheduleLocalReminders();
        return;
    }

    // Subscribe to push notifications
    await subscribeToPushNotifications(registration);

    calendarNotifyEnabled = true;
    scheduleLocalReminders();

    // Show success notification
    showNativeNotification('Notifications Enabled', {
        body: 'You will now receive notifications for your calendar events and reminders.',
        icon: '/static/favicon.png'
    });
}

async function subscribeToPushNotifications(registration) {
    if (!registration) {
        console.warn('No registration provided for push subscription');
        return;
    }

    try {
        // Check if service worker is active
        if (!registration.active) {
            console.warn('Service worker not active yet, waiting...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (!registration.active) {
                throw new Error('Service worker failed to activate');
            }
        }

        // VAPID public key from server
        const vapidPublicKey = 'BPIc2hbTVNzSXKqIVlMPYEl5CJ3tH6fT9QLNnyD2UQESX2JzIBNljsIVDBkWyYrbeET3tHWpmPyjOYq8PKnMWVQ';

        // Convert base64 to Uint8Array
        const convertedKey = urlBase64ToUint8Array(vapidPublicKey);

        calendarDebugLog('Subscribing to push notifications...');

        // Subscribe to push notifications
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: convertedKey
        });

        calendarDebugLog('Push subscription created:', subscription.endpoint);

        // Send subscription to server
        const response = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                subscription: subscription.toJSON()
            })
        });

        if (!response.ok) {
            throw new Error(`Server rejected subscription: ${response.status}`);
        }

        calendarDebugLog('Push notification subscription successful');
    } catch (error) {
        console.error('Push subscription failed:', error);
        // Don't fail entirely - local notifications can still work
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function autoEnableCalendarNotificationsIfGranted() {
    // In native app, check permission via NotificationService
    if (window.isNativeApp && window.isNativeApp()) {
        const hasPermission = window.NotificationService && typeof window.NotificationService.hasPermission === 'function'
            ? await window.NotificationService.hasPermission()
            : false;
        if (hasPermission) {
            calendarNotifyEnabled = true;
            await scheduleLocalReminders();
        }
        return;
    }

    // Web mode: check browser notification permission
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
        calendarNotifyEnabled = true;
        const registration = await ensureServiceWorkerRegistered();
        if (registration) {
            // Ensure push subscription is active
            await subscribeToPushNotifications(registration);
        }
        scheduleLocalReminders();
    }
}

async function ensureServiceWorkerRegistered() {
    if (!('serviceWorker' in navigator)) {
        console.warn('Service workers not supported');
        return null;
    }
    try {
        // Check if already registered
        let registration = await navigator.serviceWorker.getRegistration('/');

        if (!registration) {
            // Register new service worker
            calendarDebugLog('Registering service worker...');
            registration = await navigator.serviceWorker.register('/service-worker.js', {
                scope: '/'
            });
            calendarDebugLog('Service worker registered:', registration);
        } else {
            calendarDebugLog('Service worker already registered');
        }

        // Wait for service worker to be ready (active)
        calendarDebugLog('Waiting for service worker to be ready...');
        const readyRegistration = await navigator.serviceWorker.ready;
        calendarDebugLog('Service worker ready and active:', readyRegistration.active);

        return readyRegistration;
    } catch (error) {
        console.error('Service worker registration failed:', error);
        return null;
    }
}

async function showNativeNotification(title, options = {}) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
        const reg = await ensureServiceWorkerRegistered();
        if (reg && reg.active && reg.active.state === 'activated') {
            await reg.showNotification(title, options);
            return;
        }
    } catch (e) {
        console.error('SW showNotification failed, falling back', e);
    }
    // Fallback to page notification
    new Notification(title, options);
}

async function sendCalendarDigest(dayStr) {
    try {
        await fetch('/api/calendar/digest/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ day: dayStr })
        });
        window.dispatchEvent(new Event('notifications:refresh'));
    } catch (err) {
        console.error(err);
    }
}

async function triggerManualRollover() {
    try {
        await fetch('/api/calendar/rollover-now', { method: 'POST' });
        if (calendarState.selectedDay) {
            await loadCalendarDay(calendarState.selectedDay);
        }
    } catch (err) {
        console.error(err);
    }
}

function selectDayForQuickAdd(dayStr) {
    if (!dayStr) return;
    calendarState.selectedDay = dayStr;
    const panel = document.getElementById('calendar-quick-add-panel');
    const dateLabel = document.getElementById('calendar-quick-add-date');
    const input = document.getElementById('calendar-month-quick-input');

    if (!panel) return;

    // Format the date nicely
    const date = new Date(dayStr + 'T00:00:00');
    const options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
    const formattedDate = date.toLocaleDateString('en-US', options);

    if (dateLabel) dateLabel.textContent = formattedDate;
    if (input) {
        input.disabled = false;
        input.value = '';
    }

    panel.classList.remove('is-hidden');

    // Scroll to the bottom smoothly after animation
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    smoothScrollTo(maxScroll, 220);

    // Update month grid to highlight selected day
    renderCalendarMonth();
}

function smoothScrollTo(targetY, durationMs = 250) {
    const startY = window.scrollY || window.pageYOffset || 0;
    const delta = targetY - startY;
    if (Math.abs(delta) < 1) return;
    const start = performance.now();

    const step = (now) => {
        const elapsed = now - start;
        const t = Math.min(1, elapsed / durationMs);
        const eased = t * (2 - t); // easeOutQuad
        window.scrollTo(0, startY + delta * eased);
        if (t < 1) {
            window.requestAnimationFrame(step);
        }
    };

    window.requestAnimationFrame(step);
}

function openDayDetails(dayStr) {
    if (!dayStr) return;
    showDayView();
    calendarState.detailsOpen = true;
    setCalendarDay(dayStr);
    ensureMonthMatchesSelectedDay();
    const view = document.getElementById('calendar-day-view');
    if (view) view.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function navigateToDayPage(dayStr) {
    if (!dayStr) return;
    window.location.href = `/calendar?day=${dayStr}&mode=day`;
}

function initCalendarPage() {
    const page = document.getElementById('calendar-page');
    if (!page) return;
    if (document.body && document.body.dataset.calendarPageInit === '1') return;
    if (document.body) document.body.dataset.calendarPageInit = '1';
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const params = new URLSearchParams(window.location.search);
    const initialDayParam = params.get('day');
    const initialMode = params.get('mode');
    const initialDayStr = initialDayParam || todayStr;
    calendarState.selectedDay = initialDayStr;
    const monthCard = document.getElementById('calendar-month-card');

    const prevMonthBtn = document.getElementById('calendar-prev-month');
    const nextMonthBtn = document.getElementById('calendar-next-month');
    const prevBtn = document.getElementById('calendar-prev-day');
    const nextBtn = document.getElementById('calendar-next-day');
    const picker = document.getElementById('calendar-date-picker');
    const todayBtn = document.getElementById('calendar-today-btn');
    const quickInput = document.getElementById('calendar-quick-input');
    const notifyBtn = document.getElementById('calendar-enable-notify');
    const digestBtn = document.getElementById('calendar-send-digest');
    const timeModal = document.getElementById('calendar-time-modal');
    const timeSaveBtn = document.getElementById('calendar-time-save');
    const timeCancelBtn = document.getElementById('calendar-time-cancel');
    const rolloverBtn = document.getElementById('calendar-rollover-btn');
    const backBtn = document.getElementById('calendar-back-month');
    const menuBtn = document.getElementById('calendar-menu-btn');
    const dropdownMenu = document.getElementById('calendar-dropdown-menu');
    const sortBtn = document.getElementById('calendar-day-sort-btn');
    const sortMenu = document.getElementById('calendar-day-sort-menu');
    const sortMobileToggle = document.getElementById('calendar-sort-mobile-toggle');
    const sortMobileMenu = document.getElementById('calendar-sort-mobile');
    const bulkClearBtn = document.getElementById('calendar-bulk-clear');
    const bulkDoneBtn = document.getElementById('calendar-bulk-done');
    const bulkUndoneBtn = document.getElementById('calendar-bulk-undone');
    const bulkRolloverBtn = document.getElementById('calendar-bulk-rollover');
    const bulkPriorityBtn = document.getElementById('calendar-bulk-priority');
    const bulkMoveBtn = document.getElementById('calendar-bulk-move');
    const bulkNoteBtn = document.getElementById('calendar-bulk-note');
    const bulkDeleteBtn = document.getElementById('calendar-bulk-delete');
    const bulkMoreBtn = document.getElementById('calendar-bulk-more-btn');
    const selectAllCheckbox = document.getElementById('calendar-select-all');
    const dayQuickAdd = document.getElementById('calendar-day-quick-add');
    const quickToggleBtn = document.getElementById('calendar-quick-toggle');
    const recurringBtn = document.getElementById('calendar-recurring-btn');
    const recurringModal = document.getElementById('calendar-recurring-modal');
    const recurringSaveBtn = document.getElementById('calendar-recurring-save');
    const recurringCancelBtn = document.getElementById('calendar-recurring-cancel');
    const recurringFreq = document.getElementById('calendar-recurring-frequency');
    const recurringUnit = document.getElementById('calendar-recurring-interval-unit');
    const recurringType = document.getElementById('calendar-recurring-type');
    const itemNoteModal = document.getElementById('calendar-item-note-modal');
    const itemNoteInput = document.getElementById('calendar-item-note-input');
    const itemNoteCloseBtn = document.getElementById('calendar-item-note-close');
    const itemNoteEditBtn = document.getElementById('calendar-item-note-edit');
    const itemNoteDeleteBtn = document.getElementById('calendar-item-note-delete');
    const itemNoteConvertBtn = document.getElementById('calendar-item-note-convert');
    const itemNoteSaveBtn = document.getElementById('calendar-item-note-save');
    const itemNoteCancelBtn = document.getElementById('calendar-item-note-cancel');
    const searchToggleBtn = document.getElementById('calendar-search-toggle');
    const searchPanel = document.getElementById('calendar-search-panel');
    const searchInput = document.getElementById('calendar-search-input');
    const searchClearBtn = document.getElementById('calendar-search-clear');
    const searchResults = document.getElementById('calendar-search-results');
    const dayLayout = document.getElementById('calendar-day-layout');
    const viewModeBtn = document.getElementById('calendar-view-mode-btn');
    const viewModeMenu = document.getElementById('calendar-view-mode-menu');
    const viewModeDropdown = document.getElementById('calendar-view-mode-dropdown');
    const viewModeOptions = Array.from(document.querySelectorAll('.calendar-view-mode-option'));

    const sortLabelMap = {
        time: 'Time',
        title: 'Title',
        priority: 'Priority',
        status: 'Status',
        manual: 'Manual'
    };

    const setDaySort = (mode) => {
        const next = mode || 'time';
        calendarState.daySort = next;
        localStorage.setItem('calendarDaySort', next);
        const label = sortLabelMap[next] || 'Time';
        if (sortBtn) sortBtn.setAttribute('title', `Sort: ${label}`);
        document.querySelectorAll('[data-sort]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-sort') === next);
        });
        if (calendarState.detailsOpen) {
            renderCalendarEvents();
        }
    };

    const setDayViewMode = (mode) => {
        const dayViewLabelMap = {
            list: 'List',
            timeline: 'Timeline'
        };
        const dayViewIconMap = {
            list: 'fa-list-ul',
            timeline: 'fa-clock'
        };
        const allowed = new Set(['list', 'timeline']);
        const next = allowed.has(mode) ? mode : 'timeline';
        calendarState.dayViewMode = next;
        localStorage.setItem('calendarDayViewMode', next);
        if (dayLayout) {
            dayLayout.setAttribute('data-view-mode', next);
        }
        viewModeOptions.forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-view-mode') === next);
        });
        if (viewModeBtn) {
            const label = dayViewLabelMap[next] || 'Timeline';
            const icon = dayViewIconMap[next] || 'fa-clock';
            viewModeBtn.innerHTML = `<i class="fa-solid ${icon}"></i><span>${label}</span><i class="fa-solid fa-chevron-down chevron"></i>`;
        }
        if (next === 'timeline') {
            resetCalendarSelection();
        }
        renderCalendarEvents();
    };

    // Dropdown menu toggle
    if (menuBtn && dropdownMenu) {
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            const nextOpen = !dropdownMenu.classList.contains('active');
            dropdownMenu.classList.toggle('active', nextOpen);
            menuBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        };
        // Close dropdown when clicking outside
          document.addEventListener('click', (e) => {
              if (!e.target.closest('.calendar-actions-menu')) {
                  dropdownMenu.classList.remove('active');
                  menuBtn.setAttribute('aria-expanded', 'false');
                  if (sortMobileMenu) sortMobileMenu.classList.remove('active');
                  if (sortMobileToggle) sortMobileToggle.setAttribute('aria-expanded', 'false');
              }
              if (sortMenu && !e.target.closest('.calendar-sort-menu')) {
                  sortMenu.classList.remove('active');
                  if (sortBtn) sortBtn.setAttribute('aria-expanded', 'false');
              }
              if (viewModeMenu && !e.target.closest('.calendar-view-mode-menu')) {
                  viewModeMenu.classList.remove('active');
                  if (viewModeBtn) viewModeBtn.setAttribute('aria-expanded', 'false');
              }
              if (!e.target.closest('.calendar-search')) {
                  hideCalendarSearchResults();
              }
              // Also close all calendar item dropdowns
              if (!e.target.closest('.calendar-overflow-menu') && !e.target.closest('.calendar-item-dropdown')) {
                  document.querySelectorAll('.calendar-item-dropdown.active').forEach(d => {
                      d.classList.remove('active');
                      restoreCalendarNoteChoiceDropdown(d);
                  });
              }
        });

        // Update dropdown positions on scroll instead of closing them
          window.addEventListener('scroll', () => {
              document.querySelectorAll('.calendar-item-dropdown.active').forEach(dropdown => {
                  if (dropdown.updatePosition && typeof dropdown.updatePosition === 'function') {
                      dropdown.updatePosition();
                  }
              });
          }, true);

    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && calendarSelection.active) {
            resetCalendarSelection();
        }
    });

    if (prevMonthBtn) prevMonthBtn.onclick = () => {
        const current = calendarState.monthCursor || new Date();
        const prev = new Date(current.getFullYear(), current.getMonth() - 1, 1);
        setCalendarMonth(prev);
    };
    if (nextMonthBtn) nextMonthBtn.onclick = () => {
        const current = calendarState.monthCursor || new Date();
        const next = new Date(current.getFullYear(), current.getMonth() + 1, 1);
        setCalendarMonth(next);
    };


    if (itemNoteCloseBtn) itemNoteCloseBtn.onclick = closeCalendarItemNoteModal;
    if (itemNoteEditBtn) itemNoteEditBtn.onclick = () => {
        if (itemNoteInput && calendarItemNoteState.event) {
            itemNoteInput.value = calendarItemNoteState.event.item_note || '';
            updateCalendarItemNoteCounter();
        }
        setCalendarItemNoteMode('edit');
    };
    if (itemNoteDeleteBtn) itemNoteDeleteBtn.onclick = deleteCalendarItemNote;
    if (itemNoteConvertBtn) itemNoteConvertBtn.onclick = convertCalendarItemNote;
    if (itemNoteSaveBtn) itemNoteSaveBtn.onclick = saveCalendarItemNote;
    if (itemNoteCancelBtn) itemNoteCancelBtn.onclick = () => {
        if (calendarItemNoteState.isNew) {
            closeCalendarItemNoteModal();
        } else {
            setCalendarItemNoteMode('view');
        }
    };
    if (itemNoteInput) {
        itemNoteInput.addEventListener('input', updateCalendarItemNoteCounter);
    }
    if (searchInput) {
        searchInput.addEventListener('input', (e) => setCalendarSearchQuery(e.target.value));
        searchInput.addEventListener('focus', () => renderCalendarSearchResults());
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                clearCalendarSearch();
                searchInput.blur();
            }
        });
    }
    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            clearCalendarSearch();
            if (searchInput) {
                searchInput.focus();
            }
        });
    }
    if (searchResults) {
        searchResults.addEventListener('click', (e) => {
            const item = e.target.closest('.calendar-search-item');
            if (!item) return;
            const day = item.getAttribute('data-day');
            if (!day) return;
            navigateToDayPage(day);
            clearCalendarSearch();
        });
    }

    if (prevBtn) prevBtn.onclick = () => {
        if (!calendarState.selectedDay) return;
        const current = new Date(calendarState.selectedDay + 'T00:00:00');
        current.setDate(current.getDate() - 1);
        openDayDetails(current.toISOString().slice(0, 10));
    };
    if (nextBtn) nextBtn.onclick = () => {
        if (!calendarState.selectedDay) return;
        const current = new Date(calendarState.selectedDay + 'T00:00:00');
        current.setDate(current.getDate() + 1);
        openDayDetails(current.toISOString().slice(0, 10));
    };
    if (picker) picker.onchange = (e) => openDayDetails(e.target.value);
    if (todayBtn) todayBtn.onclick = () => openDayDetails(todayStr);
    const goToBtn = document.getElementById('calendar-go-to-btn');
    if (goToBtn) {
        goToBtn.onclick = () => {
            closeCalendarMonthMenu();
            openCalendarPrompt({
                title: 'Go to date',
                message: 'Pick any date to jump to.',
                type: 'date',
                defaultValue: calendarState.selectedDay || todayStr,
                onSubmit: (val) => {
                    if (!val) return;
                    // Jump to the month containing the selected date
                    const targetDate = new Date(val + 'T00:00:00');
                    setCalendarMonth(targetDate);
                }
            });
        };
    }
    // Today button in month view - jumps to current month
    const todayMonthBtn = document.getElementById('calendar-today-month-btn');
    if (todayMonthBtn) {
        todayMonthBtn.onclick = () => {
            setCalendarMonth(new Date());
            closeCalendarMonthMenu();
        };
    }

    // Calendar month menu dropdown toggle
    const monthMenuBtn = document.getElementById('calendar-month-menu-btn');
    const monthMenu = document.querySelector('.calendar-month-menu');
    if (monthMenuBtn && monthMenu) {
        const setMonthMenuOpenState = (open) => {
            monthMenu.classList.toggle('open', open);
            monthMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        };
        monthMenuBtn.onclick = (e) => {
            e.stopPropagation();
            setMonthMenuOpenState(!monthMenu.classList.contains('open'));
        };
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!monthMenu.contains(e.target)) {
                setMonthMenuOpenState(false);
            }
        });
        // Close dropdown when clicking menu items
        monthMenu.querySelectorAll('.calendar-month-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                setMonthMenuOpenState(false);
            });
        });
    }
    if (searchToggleBtn) {
        searchToggleBtn.onclick = () => {
            if (!searchPanel) return;
            const willOpen = searchPanel.classList.contains('is-hidden');
            searchPanel.classList.toggle('is-hidden', !willOpen);
            searchToggleBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            if (willOpen && searchInput) {
                searchInput.focus();
                searchInput.select();
                renderCalendarSearchResults();
            }
            if (!willOpen) {
                hideCalendarSearchResults();
            }
        };
    }
    function closeCalendarMonthMenu() {
        const menu = document.querySelector('.calendar-month-menu');
        const menuBtn = document.getElementById('calendar-month-menu-btn');
        if (menu) menu.classList.remove('open');
        if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
    }

    if (quickInput) {
        resizeDayQuickInput(quickInput);
        quickInput.addEventListener('focus', () => resizeDayQuickInput(quickInput));

        quickInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleCalendarQuickAdd();
            }

            // Navigation in autocomplete
            if (autocompleteState.visible) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    autocompleteState.selectedIndex =
                        Math.min(autocompleteState.selectedIndex + 1, autocompleteState.suggestions.length - 1);
                    renderAutocompleteSuggestions(autocompleteState.suggestions);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    autocompleteState.selectedIndex = Math.max(autocompleteState.selectedIndex - 1, 0);
                    renderAutocompleteSuggestions(autocompleteState.suggestions);
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    const selected = autocompleteState.suggestions[autocompleteState.selectedIndex];
                    if (selected) insertSuggestion(selected.syntax);
                } else if (e.key === 'Escape') {
                    hideAutocomplete();
                }
            }

            // Trigger autocomplete with Ctrl+Space
            if (e.key === ' ' && e.ctrlKey) {
                e.preventDefault();
                const suggestions = getSyntaxSuggestions(quickInput.value, quickInput.selectionStart);
                renderAutocompleteSuggestions(suggestions);
            }
        });

        // Auto-trigger suggestions for # and > with continuous filtering
        quickInput.addEventListener('input', () => {
            resizeDayQuickInput(quickInput);
            const text = quickInput.value;
            const cursorPos = quickInput.selectionStart;
            const beforeCursor = text.substring(0, cursorPos);

            // Check if we're currently typing after # or >
            const hasPhase = beforeCursor.match(/#([A-Za-z0-9 _-]*)$/);
            const hasGroup = beforeCursor.match(/>([A-Za-z0-9 _-]*)$/);

            if (hasPhase || hasGroup) {
                const suggestions = getSyntaxSuggestions(text, cursorPos);
                renderAutocompleteSuggestions(suggestions);
            } else {
                // Hide autocomplete if not typing after # or >
                hideAutocomplete();
            }
        });

        // Hide autocomplete when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.quick-add-input-wrapper')) {
                hideAutocomplete();
            }
        });

        // Mobile-friendly help button
        const helpBtn = document.getElementById('calendar-help-btn');
        if (helpBtn) {
            helpBtn.onclick = (e) => {
                e.stopPropagation();
                const suggestions = getSyntaxSuggestions(quickInput.value, quickInput.selectionStart);
                renderAutocompleteSuggestions(suggestions);
                quickInput.focus();
            };
        }
    }
    if (notifyBtn) notifyBtn.onclick = enableCalendarNotifications;
    if (digestBtn) digestBtn.onclick = () => {
        if (!calendarState.selectedDay) return;
        sendCalendarDigest(calendarState.selectedDay);
    };
    if (rolloverBtn) rolloverBtn.onclick = triggerManualRollover;
    if (backBtn) backBtn.onclick = returnToMonthView;
    if (timeCancelBtn) timeCancelBtn.onclick = closeCalendarTimeModal;
    if (timeSaveBtn) timeSaveBtn.onclick = saveCalendarTimeModal;
    if (timeModal) {
        timeModal.addEventListener('click', (e) => {
            if (e.target === timeModal) closeCalendarTimeModal();
        });
    }
    if (recurringBtn) recurringBtn.onclick = () => {
        closeCalendarMonthMenu();
        openRecurringModal();
    };
    if (recurringSaveBtn) recurringSaveBtn.onclick = saveRecurringModal;
    if (recurringCancelBtn) recurringCancelBtn.onclick = showRecurringListView;
    if (recurringFreq) recurringFreq.onchange = updateRecurringFieldVisibility;
    if (recurringUnit) recurringUnit.onchange = updateRecurringFieldVisibility;
    if (recurringType) recurringType.onchange = () => {
        const rolloverInput = document.getElementById('calendar-recurring-rollover');
        if (rolloverInput) rolloverInput.checked = recurringType.value !== 'event';
    };
    // New recurring modal buttons
    const recurringAddNewBtn = document.getElementById('recurring-add-new-btn');
    const recurringBackBtn = document.getElementById('recurring-back-btn');
    const recurringCloseBtn = document.getElementById('calendar-recurring-close');
    if (recurringAddNewBtn) recurringAddNewBtn.onclick = () => showRecurringFormView(null);
    if (recurringBackBtn) recurringBackBtn.onclick = showRecurringListView;
    if (recurringCloseBtn) recurringCloseBtn.onclick = closeRecurringModal;
    if (recurringModal) {
        recurringModal.addEventListener('click', (e) => {
            if (e.target === recurringModal) closeRecurringModal();
        });
    }
    if (bulkClearBtn) bulkClearBtn.onclick = resetCalendarSelection;
    if (bulkDoneBtn) bulkDoneBtn.onclick = () => {
        bulkCalendarUpdateStatus('done');
        toggleCalendarBulkMenu(null, true);
    };
    if (bulkUndoneBtn) bulkUndoneBtn.onclick = () => {
        bulkCalendarUpdateStatus('not_started');
        toggleCalendarBulkMenu(null, true);
    };
    if (bulkRolloverBtn) bulkRolloverBtn.onclick = bulkCalendarToggleRollover;
    if (bulkPriorityBtn) bulkPriorityBtn.onclick = (e) => {
        toggleCalendarBulkMenu(null, true);
        startBulkCalendarPriorityPicker(e.currentTarget);
    };
    if (bulkMoveBtn) bulkMoveBtn.onclick = () => {
        toggleCalendarBulkMenu(null, true);
        startBulkCalendarMovePrompt();
    };
    if (bulkNoteBtn) bulkNoteBtn.onclick = () => {
        toggleCalendarBulkMenu(null, true);
        startBulkCalendarNoteLink(bulkNoteBtn);
    };
    if (bulkDeleteBtn) bulkDeleteBtn.onclick = bulkCalendarDelete;
    if (bulkMoreBtn) bulkMoreBtn.onclick = toggleCalendarBulkMenu;
    if (selectAllCheckbox) selectAllCheckbox.onchange = (e) => calendarSelectAll(e.target.checked);

    const savedSort = localStorage.getItem('calendarDaySort');
    if (savedSort) {
        calendarState.daySort = savedSort;
    }
    setDaySort(calendarState.daySort || 'time');

    if (viewModeBtn && viewModeMenu && viewModeDropdown) {
        viewModeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const nextOpen = !viewModeMenu.classList.contains('active');
            viewModeMenu.classList.toggle('active', nextOpen);
            viewModeBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        });
        viewModeOptions.forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = btn.getAttribute('data-view-mode') || 'timeline';
                setDayViewMode(mode);
                viewModeMenu.classList.remove('active');
                viewModeBtn.setAttribute('aria-expanded', 'false');
            });
        });
    }
    const savedDayViewMode = localStorage.getItem('calendarDayViewMode');
    setDayViewMode(savedDayViewMode || calendarState.dayViewMode || 'timeline');

    if (sortBtn && sortMenu) {
        sortBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const nextOpen = !sortMenu.classList.contains('active');
            sortMenu.classList.toggle('active', nextOpen);
            sortBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        });
    }

    if (sortMobileToggle && sortMobileMenu) {
        sortMobileToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const nextOpen = !sortMobileMenu.classList.contains('active');
            sortMobileMenu.classList.toggle('active', nextOpen);
            sortMobileToggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        });
    }

    document.querySelectorAll('.calendar-sort-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.getAttribute('data-sort') || 'time';
            setDaySort(mode);
            if (sortMenu) sortMenu.classList.remove('active');
            if (sortBtn) sortBtn.setAttribute('aria-expanded', 'false');
            if (dropdownMenu) dropdownMenu.classList.remove('active');
            if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
            if (sortMobileMenu) sortMobileMenu.classList.remove('active');
            if (sortMobileToggle) sortMobileToggle.setAttribute('aria-expanded', 'false');
        });
    });

    if (dayQuickAdd && quickToggleBtn) {
        const setQuickAddCollapsed = (collapsed) => {
            dayQuickAdd.classList.toggle('is-collapsed', collapsed);
            const icon = quickToggleBtn.querySelector('i');
            if (icon) {
                icon.className = collapsed ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
            }
            const label = collapsed ? 'Expand quick add' : 'Minimize quick add';
            quickToggleBtn.setAttribute('aria-label', label);
            quickToggleBtn.setAttribute('title', label);
            quickToggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        };

        quickToggleBtn.addEventListener('click', () => {
            const collapsed = !dayQuickAdd.classList.contains('is-collapsed');
            setQuickAddCollapsed(collapsed);
        });

        setQuickAddCollapsed(false);
    }

    // Quick-add panel event handlers
    const quickAddPanel = document.getElementById('calendar-quick-add-panel');
    const quickAddCloseBtn = document.getElementById('calendar-quick-add-close');
    const monthQuickInput = document.getElementById('calendar-month-quick-input');

    if (quickAddCloseBtn && quickAddPanel) {
        quickAddCloseBtn.onclick = () => {
            quickAddPanel.classList.add('is-hidden');
            if (monthQuickInput) monthQuickInput.value = '';
        };
    }

    if (monthQuickInput) {
        monthQuickInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                await handleMonthQuickAdd();
            }
        });
    }

    // Syntax guide toggle
    const quickHelpToggle = document.getElementById('calendar-quick-help-toggle');
    const syntaxGuide = document.getElementById('calendar-quick-syntax-guide');

    if (quickHelpToggle && syntaxGuide) {
        quickHelpToggle.onclick = () => {
            const isHidden = syntaxGuide.classList.toggle('is-hidden');
            quickHelpToggle.textContent = isHidden ? 'Show syntax guide' : 'Hide syntax guide';
            quickHelpToggle.setAttribute('aria-expanded', isHidden ? 'false' : 'true');
        };
    }

    const startInDayMode = initialMode === 'day';
    if (startInDayMode) {
        if (monthCard) monthCard.classList.add('is-hidden');
        showDayView();
        calendarState.detailsOpen = true;
        setCalendarDay(initialDayStr, { skipLoad: false, skipLabel: false });
    } else {
        hideDayView(); // start collapsed on calendar view
        setCalendarDay(todayStr, { skipLoad: true, skipLabel: true });
    }

    setCalendarMonth(new Date(initialDayStr + 'T00:00:00'));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCalendarPage);
} else {
    initCalendarPage();
}

