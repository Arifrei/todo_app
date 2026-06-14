"""Inbox quick-capture, auto-detection, and destination mapping."""

import html
import json
import os
import re
from datetime import date, datetime, time, timedelta

from backend.background_jobs import start_app_context_job
from backend.text_helpers import _html_to_plain_text, _sanitize_note_html
from services.ai_gateway import call_chat_json

LIST_SECTION_PREFIX = '[[section]]'
LIST_SUBSECTION_PREFIX = '[[subsection]]'
MAX_CAPTURE_LENGTH = 5000
MONTH_PATTERN = (
    r'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|'
    r'jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|'
    r'nov(?:ember)?|dec(?:ember)?'
)
WEEKDAY_PATTERN = (
    r'monday|tuesday|wednesday|thursday|friday|saturday|sunday'
)


class InboxValidationError(ValueError):
    pass


def _tokens(value):
    return {
        token
        for token in re.findall(r"[a-z0-9]+", (value or '').lower())
        if len(token) > 1
    }


def _parse_iso_date(value):
    if not value:
        return None
    try:
        return datetime.strptime(str(value).strip(), '%Y-%m-%d').date()
    except (TypeError, ValueError):
        raise InboxValidationError('Use date format YYYY-MM-DD.')


def _parse_clock(value):
    if not value:
        return None
    cleaned = str(value).strip()
    for pattern in ('%H:%M', '%H:%M:%S'):
        try:
            return datetime.strptime(cleaned, pattern).time()
        except ValueError:
            continue
    raise InboxValidationError('Use time format HH:MM.')


def _parse_reminder(value):
    if value in (None, ''):
        return None
    raw = str(value).strip().lower()
    match = re.fullmatch(r'(\d+)\s*([mhd])?', raw)
    if not match:
        raise InboxValidationError('Use 30m, 2h, or 1d for reminders.')
    amount = int(match.group(1))
    unit = match.group(2) or 'm'
    multiplier = {'m': 1, 'h': 60, 'd': 1440}[unit]
    return amount * multiplier


def extract_capture_schedule(content, today=None):
    """Extract common date, time, and reminder phrases without external dependencies."""
    text = (content or '').strip()
    lower = text.lower()
    current_day = today or date.today()
    scheduled_day = None

    iso_match = re.search(r'\b(20\d{2}-\d{2}-\d{2})\b', lower)
    if iso_match:
        try:
            scheduled_day = datetime.strptime(iso_match.group(1), '%Y-%m-%d').date()
        except ValueError:
            scheduled_day = None
    else:
        numeric_match = re.search(r'\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b', lower)
        if numeric_match:
            month_value = int(numeric_match.group(1))
            day_value = int(numeric_match.group(2))
            year_value = numeric_match.group(3)
            if year_value:
                year_value = int(year_value)
                if year_value < 100:
                    year_value += 2000
            else:
                year_value = current_day.year
            try:
                scheduled_day = date(year_value, month_value, day_value)
                if not numeric_match.group(3) and scheduled_day < current_day:
                    scheduled_day = date(year_value + 1, month_value, day_value)
            except ValueError:
                scheduled_day = None

    if scheduled_day is None:
        month_first_match = re.search(
            rf'\b({MONTH_PATTERN})\s+(\d{{1,2}})(?:st|nd|rd|th)?'
            rf'(?:,?\s+(20\d{{2}}))?\b',
            lower,
        )
        day_first_match = re.search(
            rf'\b(\d{{1,2}})(?:st|nd|rd|th)?\s+({MONTH_PATTERN})'
            rf'(?:,?\s+(20\d{{2}}))?\b',
            lower,
        )
        named_match = month_first_match or day_first_match
        if named_match:
            if month_first_match:
                month_text, day_text, year_text = named_match.groups()
            else:
                day_text, month_text, year_text = named_match.groups()
            month_value = datetime.strptime(month_text[:3], '%b').month
            year_value = int(year_text) if year_text else current_day.year
            try:
                scheduled_day = date(year_value, month_value, int(day_text))
                if not year_text and scheduled_day < current_day:
                    scheduled_day = date(year_value + 1, month_value, int(day_text))
            except ValueError:
                scheduled_day = None

    if scheduled_day is None and re.search(r'\bday after tomorrow\b', lower):
        scheduled_day = current_day + timedelta(days=2)
    elif scheduled_day is None and re.search(r'\btomorrow\b', lower):
        scheduled_day = current_day + timedelta(days=1)
    elif scheduled_day is None and re.search(r'\btoday\b', lower):
        scheduled_day = current_day
    elif scheduled_day is None and re.search(r'\bnext week\b', lower):
        scheduled_day = current_day + timedelta(days=7)
    elif scheduled_day is None:
        weekdays = {
            'monday': 0,
            'tuesday': 1,
            'wednesday': 2,
            'thursday': 3,
            'friday': 4,
            'saturday': 5,
            'sunday': 6,
        }
        weekday_match = re.search(
            rf'\b(?:(next)\s+)?({WEEKDAY_PATTERN})\b',
            lower,
        )
        if weekday_match:
            target = weekdays[weekday_match.group(2)]
            delta = (target - current_day.weekday()) % 7
            if delta == 0 or weekday_match.group(1):
                delta += 7
            scheduled_day = current_day + timedelta(days=delta)

    start_time = None
    time_match = re.search(
        r'\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b',
        lower,
    )
    if time_match:
        hour = int(time_match.group(1))
        minute = int(time_match.group(2) or 0)
        meridiem = time_match.group(3).replace('.', '')
        if 1 <= hour <= 12 and minute <= 59:
            if meridiem == 'pm' and hour != 12:
                hour += 12
            if meridiem == 'am' and hour == 12:
                hour = 0
            start_time = time(hour, minute)
    else:
        time_match = re.search(r'\bat\s+([01]?\d|2[0-3]):([0-5]\d)\b', lower)
        if time_match:
            start_time = time(int(time_match.group(1)), int(time_match.group(2)))

    reminder_minutes = None
    reminder_match = re.search(
        r'\b(?:remind(?:er)?(?:\s+me)?(?:\s+at)?|alert)\s+'
        r'(\d+)\s*(minutes?|mins?|hours?|hrs?|days?)\s*(?:before)?\b',
        lower,
    )
    if reminder_match:
        amount = int(reminder_match.group(1))
        unit = reminder_match.group(2)
        multiplier = 1
        if unit.startswith(('hour', 'hr')):
            multiplier = 60
        elif unit.startswith('day'):
            multiplier = 1440
        reminder_minutes = min(amount * multiplier, 10080)
    elif re.search(r'\bremind me\b|\breminder\b|\balert me\b', lower):
        reminder_minutes = 15

    return {
        'date': scheduled_day.isoformat() if scheduled_day else None,
        'start_time': start_time.strftime('%H:%M') if start_time else None,
        'reminder_minutes_before': reminder_minutes,
    }


def _clean_capture_title(content):
    title = ' '.join((content or '').strip().split())
    patterns = [
        r'\b(?:on|for|by)?\s*20\d{2}-\d{2}-\d{2}\b',
        r'\b(?:on|for|by)?\s*\d{1,2}/\d{1,2}(?:/\d{2,4})?\b',
        rf'\b(?:on|for|by)?\s*(?:{MONTH_PATTERN})\s+'
        r'\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?\b',
        rf'\b(?:on|for|by)?\s*\d{{1,2}}(?:st|nd|rd|th)?\s+'
        rf'(?:{MONTH_PATTERN})(?:,?\s+20\d{{2}})?\b',
        r'\b(?:on|for|by)?\s*(?:the\s+)?day after tomorrow\b',
        r'\b(?:on|for|by)?\s*(?:today|tomorrow|next week)\b',
        rf'\b(?:on|for|by)?\s*(?:next\s+)?(?:{WEEKDAY_PATTERN})\b',
        r'\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b',
        r'\bat\s+(?:[01]?\d|2[0-3]):[0-5]\d\b',
        r'\b(?:remind(?:er)?(?:\s+me)?(?:\s+at)?|alert(?:\s+me)?)\s+'
        r'\d+\s*(?:minutes?|mins?|hours?|hrs?|days?)\s*(?:before)?\b',
        r'\b(?:remind me|reminder|alert me)\b',
    ]
    for pattern in patterns:
        title = re.sub(pattern, ' ', title, flags=re.IGNORECASE)
    title = re.sub(r'\b(?:on|for|by|at)\s*(?=$|[,;:.!?])', ' ', title, flags=re.IGNORECASE)
    title = re.sub(r'\s+([,;:.!?])', r'\1', title)
    title = re.sub(r'\s+', ' ', title).strip(' ,;:-')
    return (title or (content or '').strip())[:200]


def _marker_kind(text):
    value = (text or '').strip()
    if value.startswith(LIST_SECTION_PREFIX):
        return 'section'
    if value.startswith(LIST_SUBSECTION_PREFIX):
        return 'subsection'
    return None


def _marker_title(text):
    value = (text or '').strip()
    kind = _marker_kind(value)
    if kind == 'section':
        return value[len(LIST_SECTION_PREFIX):].strip()
    if kind == 'subsection':
        return value[len(LIST_SUBSECTION_PREFIX):].strip()
    return value


def note_list_insert_index(items, section_id=None, subsection_id=None):
    """Return the zero-based insertion index for a Notes list destination."""
    ordered = sorted(items, key=lambda item: ((item.order_index or 0), (item.id or 0)))
    if subsection_id is not None:
        marker_index = next(
            (
                index
                for index, item in enumerate(ordered)
                if item.id == subsection_id and _marker_kind(item.text) == 'subsection'
            ),
            None,
        )
        if marker_index is None:
            raise InboxValidationError('The selected subsection no longer exists.')
        for index in range(marker_index + 1, len(ordered)):
            if _marker_kind(ordered[index].text) in {'section', 'subsection'}:
                return index
        return len(ordered)

    if section_id is not None:
        marker_index = next(
            (
                index
                for index, item in enumerate(ordered)
                if item.id == section_id and _marker_kind(item.text) == 'section'
            ),
            None,
        )
        if marker_index is None:
            raise InboxValidationError('The selected section no longer exists.')
        for index in range(marker_index + 1, len(ordered)):
            if _marker_kind(ordered[index].text) == 'section':
                return index
        return len(ordered)

    first_section = next(
        (index for index, item in enumerate(ordered) if _marker_kind(item.text) == 'section'),
        None,
    )
    return first_section if first_section is not None else len(ordered)


def _protected_folder_ids(NoteFolder, user_id):
    folders = NoteFolder.query.filter_by(user_id=user_id).all()
    protected = {folder.id for folder in folders if folder.is_pin_protected}
    changed = True
    while changed:
        changed = False
        for folder in folders:
            if folder.parent_id in protected and folder.id not in protected:
                protected.add(folder.id)
                changed = True
    return protected


def _available_notes(a, user):
    protected_folders = _protected_folder_ids(a.NoteFolder, user.id)
    query = a.Note.query.filter(
        a.Note.user_id == user.id,
        a.Note.archived_at.is_(None),
        a.Note.is_pin_protected.is_(False),
    )
    notes = query.order_by(a.Note.updated_at.desc(), a.Note.id.desc()).all()
    return [note for note in notes if note.folder_id not in protected_folders]


def _context_text(value, limit=500):
    cleaned = ' '.join(str(value or '').split())
    return cleaned[:limit] or None


def _note_folder_paths(a, user):
    folders = {
        folder.id: folder
        for folder in a.NoteFolder.query.filter_by(user_id=user.id).all()
    }
    paths = {}
    for folder_id, folder in folders.items():
        parts = []
        current = folder
        visited = set()
        while current and current.id not in visited:
            visited.add(current.id)
            parts.append(current.name)
            current = folders.get(current.parent_id)
        paths[folder_id] = ' / '.join(reversed(parts))
    return paths


def build_destination_catalog(a, user, include_context=False):
    lists = a.TodoList.query.filter(
        a.TodoList.user_id == user.id,
        a.TodoList.type.in_(['list', 'light']),
    ).order_by(a.TodoList.title.asc()).all()
    task_destinations = []
    for todo_list in lists:
        phase_titles = {
            item.id: item.content
            for item in todo_list.items
            if item.is_phase_header()
        }
        phases = [
            {
                'id': item.id,
                'title': item.content,
            }
            for item in todo_list.items
            if item.is_phase_header()
        ]
        entry = {
            'id': todo_list.id,
            'title': todo_list.title,
            'type': todo_list.type,
            'phases': phases,
        }
        if include_context:
            regular_items = [
                item for item in todo_list.items if not item.is_phase_header()
            ]
            regular_items.sort(key=lambda item: (
                item.status == 'done',
                item.status != 'in_progress',
                item.due_date or date.max,
                item.order_index or 0,
                item.id or 0,
            ))
            entry['samples'] = [item.content for item in regular_items[:12]]
            entry['items'] = [
                {
                    'id': item.id,
                    'title': item.content,
                    'status': item.status,
                    'phase_id': item.phase_id,
                    'phase': phase_titles.get(item.phase_id),
                    'description': _context_text(item.description, 350),
                    'notes': _context_text(item.notes, 350),
                    'tags': item.tag_list(),
                    'due_date': item.due_date.isoformat() if item.due_date else None,
                }
                for item in regular_items[:24]
            ]
            entry['item_count'] = len(regular_items)
        task_destinations.append(entry)

    folder_paths = _note_folder_paths(a, user) if include_context else {}
    note_destinations = []
    note_list_destinations = []
    for note in _available_notes(a, user):
        if note.note_type == 'list':
            ordered_items = sorted(
                note.list_items,
                key=lambda item: ((item.order_index or 0), (item.id or 0)),
            )
            sections = []
            current_section = None
            current_subsection = None
            samples = []
            context_items = []
            for item in ordered_items:
                kind = _marker_kind(item.text)
                if kind == 'section':
                    current_section = {
                        'id': item.id,
                        'title': _marker_title(item.text) or 'Untitled section',
                        'subsections': [],
                    }
                    sections.append(current_section)
                    current_subsection = None
                elif kind == 'subsection' and current_section is not None:
                    current_subsection = {
                        'id': item.id,
                        'title': _marker_title(item.text) or 'Untitled subsection',
                    }
                    current_section['subsections'].append(current_subsection)
                elif not kind and include_context:
                    if len(samples) < 12:
                        samples.append(item.text)
                    if len(context_items) < 30:
                        context_items.append({
                            'id': item.id,
                            'text': item.text,
                            'note': _context_text(item.note, 280),
                            'checked': bool(item.checked),
                            'scheduled_date': (
                                item.scheduled_date.isoformat()
                                if item.scheduled_date
                                else None
                            ),
                            'section_id': (
                                current_section['id'] if current_section else None
                            ),
                            'section': (
                                current_section['title'] if current_section else None
                            ),
                            'subsection_id': (
                                current_subsection['id']
                                if current_subsection
                                else None
                            ),
                            'subsection': (
                                current_subsection['title']
                                if current_subsection
                                else None
                            ),
                        })
            entry = {'id': note.id, 'title': note.title, 'sections': sections}
            if include_context:
                entry['samples'] = samples
                entry['items'] = context_items
                entry['item_count'] = len([
                    item for item in ordered_items if not _marker_kind(item.text)
                ])
                entry['folder'] = folder_paths.get(note.folder_id)
            note_list_destinations.append(entry)
            continue

        entry = {'id': note.id, 'title': note.title}
        if include_context:
            entry['snippet'] = _context_text(
                _html_to_plain_text(note.content or ''),
                900,
            )
            entry['folder'] = folder_paths.get(note.folder_id)
            entry['updated_at'] = (
                note.updated_at.isoformat() if note.updated_at else None
            )
        note_destinations.append(entry)

    return {
        'task_lists': task_destinations,
        'notes': note_destinations,
        'note_lists': note_list_destinations,
    }


def _rank_context_entries(content, entries, sample_getter):
    return sorted(
        entries,
        key=lambda entry: (
            _candidate_score(
                content,
                entry.get('title') or '',
                sample_getter(entry),
            ),
            entry.get('item_count') or 0,
        ),
        reverse=True,
    )


def build_routing_context(a, user, content, catalog):
    """Build bounded, user-specific evidence for the AI routing decision."""
    today_value = a._now_local().date()
    task_lists = _rank_context_entries(
        content,
        catalog['task_lists'],
        lambda entry: [
            item.get('title') or ''
            for item in entry.get('items', [])
        ],
    )
    notes = _rank_context_entries(
        content,
        catalog['notes'],
        lambda entry: [entry.get('snippet') or ''],
    )
    note_lists = _rank_context_entries(
        content,
        catalog['note_lists'],
        lambda entry: [
            item.get('text') or ''
            for item in entry.get('items', [])
        ],
    )

    destination_index = {
        'task_lists': [
            {
                'id': entry['id'],
                'title': entry['title'],
                'type': entry['type'],
                'phases': entry.get('phases', []),
                'item_count': entry.get('item_count', 0),
                'sample_items': [
                    item.get('title')
                    for item in entry.get('items', [])[:6]
                ],
            }
            for entry in catalog['task_lists']
        ],
        'notes': [
            {
                'id': entry['id'],
                'title': entry['title'],
                'folder': entry.get('folder'),
                'content_preview': _context_text(entry.get('snippet'), 280),
            }
            for entry in catalog['notes']
        ],
        'note_lists': [
            {
                'id': entry['id'],
                'title': entry['title'],
                'folder': entry.get('folder'),
                'sections': entry.get('sections', []),
                'item_count': entry.get('item_count', 0),
                'sample_items': [
                    item.get('text')
                    for item in entry.get('items', [])[:8]
                ],
            }
            for entry in catalog['note_lists']
        ],
    }

    future_events = (
        a.CalendarEvent.query
        .filter(
            a.CalendarEvent.user_id == user.id,
            a.CalendarEvent.day >= today_value,
        )
        .order_by(
            a.CalendarEvent.day.asc(),
            a.CalendarEvent.start_time.asc(),
            a.CalendarEvent.id.asc(),
        )
        .limit(30)
        .all()
    )
    recent_events = (
        a.CalendarEvent.query
        .filter(
            a.CalendarEvent.user_id == user.id,
            a.CalendarEvent.day < today_value,
        )
        .order_by(a.CalendarEvent.day.desc(), a.CalendarEvent.id.desc())
        .limit(15)
        .all()
    )
    calendar_patterns = []
    for event in future_events + recent_events:
        linked_kind = None
        if event.todo_item_id:
            linked_kind = 'task'
        elif event.note_list_item_id:
            linked_kind = 'note_list'
        elif event.planner_simple_item_id or event.planner_multi_item_id:
            linked_kind = 'planner'
        calendar_patterns.append({
            'title': event.title,
            'day': event.day.isoformat(),
            'start_time': (
                event.start_time.strftime('%H:%M') if event.start_time else None
            ),
            'end_time': (
                event.end_time.strftime('%H:%M') if event.end_time else None
            ),
            'is_event': bool(event.is_event),
            'status': event.status,
            'linked_kind': linked_kind,
        })

    mapping_history = []
    mapped_items = (
        a.InboxItem.query
        .filter_by(user_id=user.id, status='mapped')
        .order_by(a.InboxItem.mapped_at.desc(), a.InboxItem.id.desc())
        .limit(25)
        .all()
    )
    for item in mapped_items:
        try:
            mapped_result = json.loads(item.mapped_result_json or '{}')
        except (TypeError, ValueError, json.JSONDecodeError):
            mapped_result = {}
        mapping_history.append({
            'capture': _context_text(item.content, 500),
            'destination_kind': item.mapped_destination_type,
            'destination_label': mapped_result.get('label'),
            'mapped_at': item.mapped_at.isoformat() if item.mapped_at else None,
        })

    return {
        'destination_index': destination_index,
        'task_context': task_lists[:30],
        'note_context': notes[:35],
        'note_list_context': note_lists[:35],
        'calendar_patterns': calendar_patterns,
        'prior_inbox_mappings': mapping_history,
    }


def _candidate_score(content, title, samples=None):
    content_tokens = _tokens(content)
    title_tokens = _tokens(title)
    score = len(content_tokens.intersection(title_tokens)) * 5
    if title and title.lower() in content.lower():
        score += 12
    for sample in samples or []:
        score += min(len(content_tokens.intersection(_tokens(sample))), 2)
    return score


def build_heuristic_suggestion(content, catalog, today=None):
    schedule = extract_capture_schedule(content, today=today)
    clean_title = _clean_capture_title(content)
    lower = content.lower()
    best_task = None
    best_task_score = -1
    for todo_list in catalog['task_lists']:
        list_score = _candidate_score(content, todo_list['title'], todo_list.get('samples'))
        phase = None
        phase_score = -1
        for candidate_phase in todo_list.get('phases', []):
            score = _candidate_score(content, candidate_phase['title'])
            if score > phase_score:
                phase = candidate_phase
                phase_score = score
        total = list_score + max(phase_score, 0)
        if total > best_task_score:
            best_task = (todo_list, phase if phase_score >= 5 else None)
            best_task_score = total

    best_note = None
    best_note_score = -1
    for note in catalog['notes']:
        score = _candidate_score(content, note['title'], [note.get('snippet', '')])
        if score > best_note_score:
            best_note = note
            best_note_score = score

    best_note_list = None
    best_note_list_section = None
    best_note_list_subsection = None
    best_note_list_score = -1
    for note_list in catalog['note_lists']:
        base_score = _candidate_score(content, note_list['title'], note_list.get('samples'))
        section_choice = None
        subsection_choice = None
        section_score = 0
        for section in note_list.get('sections', []):
            current_score = _candidate_score(content, section['title'])
            current_subsection = None
            for subsection in section.get('subsections', []):
                subsection_score = _candidate_score(content, subsection['title'])
                if subsection_score > current_score:
                    current_score = subsection_score
                    current_subsection = subsection
            if current_score > section_score:
                section_score = current_score
                section_choice = section
                subsection_choice = current_subsection
        total = base_score + section_score
        if total > best_note_list_score:
            best_note_list = note_list
            best_note_list_section = section_choice if section_score >= 5 else None
            best_note_list_subsection = subsection_choice if section_score >= 5 else None
            best_note_list_score = total

    note_intent = bool(re.search(r'\b(note|notes|write down|journal|reference|idea)\b', lower))
    list_intent = bool(re.search(r'\b(list|shopping|grocer|buy|pack|checklist)\b', lower))
    calendar_intent = bool(
        schedule['date']
        and re.search(r'\b(meeting|appointment|event|reservation|flight|call|visit)\b', lower)
    )
    explicit_container_instruction = bool(
        re.search(
            r'\b(?:add|put|save|append|move|map)\b.+\b(?:to|in|into|under)\b',
            lower,
        )
    )
    explicit_note_list_destination = bool(
        explicit_container_instruction
        and best_note_list
        and best_note_list_score >= 5
        and list_intent
    )
    explicit_note_destination = bool(
        explicit_container_instruction
        and best_note
        and best_note_score >= 5
        and note_intent
    )
    explicit_task_destination = bool(
        explicit_container_instruction
        and best_task
        and best_task_score >= 5
        and re.search(r'\b(?:task|project|phase)\b', lower)
    )
    contextual_task_intent = bool(
        best_task
        and best_task_score >= 5
        and re.search(
            r'\b(?:add|build|call|check|create|draft|email|finish|fix|follow up|'
            r'implement|prepare|review|send|submit|test|update|verify|write)\b',
            lower,
        )
    )

    if best_note_list and (
        explicit_note_list_destination
        or not schedule['date']
    ) and (
        best_note_list_score >= max(best_task_score, best_note_score, 5)
        or (list_intent and best_note_list_score > 0)
    ):
        destination = {
            'kind': 'note_list',
            'note_id': best_note_list['id'],
            'section_id': best_note_list_section['id'] if best_note_list_section else None,
            'subsection_id': (
                best_note_list_subsection['id'] if best_note_list_subsection else None
            ),
            'text': clean_title,
            'note': None,
            'scheduled_date': schedule['date'],
            'start_time': schedule['start_time'],
            'end_time': None,
            'reminder_minutes_before': schedule['reminder_minutes_before'],
        }
        path = best_note_list['title']
        if best_note_list_section:
            path += f" / {best_note_list_section['title']}"
        if best_note_list_subsection:
            path += f" / {best_note_list_subsection['title']}"
        return destination, f'Best match: {path}.', min(0.94, 0.58 + best_note_list_score / 50)

    if (
        best_note
        and note_intent
        and best_note_score >= max(best_task_score, 1)
        and (explicit_note_destination or not schedule['date'])
    ):
        destination = {
            'kind': 'note',
            'note_id': best_note['id'],
            'text': (content or '').strip(),
        }
        return destination, f"Best matching note: {best_note['title']}.", min(0.92, 0.55 + best_note_score / 50)

    if schedule['date'] and not (explicit_task_destination or contextual_task_intent):
        destination = {
            'kind': 'calendar',
            'title': clean_title,
            'day': schedule['date'],
            'start_time': schedule['start_time'],
            'end_time': None,
            'reminder_minutes_before': schedule['reminder_minutes_before'],
            'is_event': calendar_intent,
        }
        return (
            destination,
            'An explicit date makes Calendar the most likely destination.',
            0.93 if calendar_intent else 0.88,
        )

    if best_task:
        todo_list, phase = best_task
        destination = {
            'kind': 'task',
            'list_id': todo_list['id'],
            'phase_id': phase['id'] if phase else None,
            'title': clean_title,
            'description': None,
            'notes': None,
            'tags': [],
            'due_date': schedule['date'],
            'start_time': schedule['start_time'],
            'end_time': None,
            'reminder_minutes_before': schedule['reminder_minutes_before'],
        }
        path = todo_list['title'] + (f" / {phase['title']}" if phase else '')
        confidence = min(0.91, 0.5 + max(best_task_score, 0) / 45)
        return destination, f'Best matching task destination: {path}.', confidence

    if best_note:
        destination = {'kind': 'note', 'note_id': best_note['id'], 'text': content.strip()}
        return destination, f"Only available destination: {best_note['title']}.", 0.42

    destination = {
        'kind': 'calendar',
        'title': clean_title,
        'day': schedule['date'] or (today or date.today()).isoformat(),
        'start_time': schedule['start_time'],
        'end_time': None,
        'reminder_minutes_before': schedule['reminder_minutes_before'],
        'is_event': False,
    }
    return destination, 'No matching container was found; suggested as a calendar task.', 0.3


def _ai_suggestion(a, user, content, catalog, fallback):
    if not _ai_available(a):
        return None
    today_value = a._now_local().date().isoformat()
    routing_context = build_routing_context(a, user, content, catalog)
    system_prompt = f"""
You are the intent-understanding router for a personal organization system.
Today is {today_value}. Analyze what the capture means before choosing where it belongs.
Use the user's existing projects, tasks, notes, maintained lists, calendar behavior, and
prior Inbox mappings as evidence. Do not route by keyword overlap alone.

Important distinctions:
- A date is evidence, not an automatic Calendar decision.
- Use Calendar for a standalone appointment, event, reservation, time block, or dated
  action that has no stronger existing project/list home.
- Use task when the capture is actionable work that belongs to an existing task list or
  project. A mentioned date then becomes due_date, including when the project name is
  implied by related tasks rather than copied verbatim.
- Use note for narrative, reference material, observations, or information that extends
  an existing note.
- Use note_list for one atomic member of an existing checklist, shopping list, packing
  list, or other maintained structured list. Select the best section/subsection.
- Treat prior Inbox mappings as user-specific preference examples, not absolute rules.
- Compare the capture with sibling items and the purpose implied by each container.
- If evidence conflicts, prefer the destination that preserves the capture's intent and
  explain the decisive context briefly.

Choose only IDs present in destination_index. Never invent an ID.
Return one JSON object with keys: intent, destination, reason, confidence.
intent is a short description of what the user is trying to record.
confidence must be a number from 0 to 1.
destination.kind must be task, calendar, note, or note_list.

task destination:
{{"kind":"task","list_id":1,"phase_id":null,"title":"","description":null,
"notes":null,"tags":[],"due_date":"YYYY-MM-DD or null","start_time":"HH:MM or null",
"end_time":"HH:MM or null","reminder_minutes_before":null}}

calendar destination:
{{"kind":"calendar","title":"","day":"YYYY-MM-DD",
"start_time":"HH:MM or null","end_time":"HH:MM or null",
"reminder_minutes_before":null,"is_event":false}}

note destination:
{{"kind":"note","note_id":1,"text":""}}

note_list destination:
{{"kind":"note_list","note_id":1,"section_id":null,"subsection_id":null,
"text":"","note":null,"scheduled_date":"YYYY-MM-DD or null",
"start_time":"HH:MM or null","end_time":"HH:MM or null",
"reminder_minutes_before":null}}

Use the parsed schedule when it reflects the capture, but do not manufacture scheduling.
Remove date, time, and reminder phrases from Calendar titles. Keep Calendar description
out of the result. Make task and list-item titles concise while preserving their meaning.
"""
    payload = {
        'capture': content,
        'parsed_schedule': extract_capture_schedule(
            content,
            today=a._now_local().date(),
        ),
        'organization_context': routing_context,
        'fallback_suggestion': fallback,
    }
    return call_chat_json(
        system_prompt,
        json.dumps(payload, ensure_ascii=True),
        max_tokens=900,
        temperature=0.1,
        retries=1,
        logger=a.app.logger,
    )


def _ai_available(a):
    return bool(a.app.config.get('OPENAI_API_KEY') or os.environ.get('OPENAI_API_KEY'))


def _owned_note(a, user, note_id, expected_type):
    try:
        note_id = int(note_id)
    except (TypeError, ValueError):
        raise InboxValidationError('Choose a valid note.')
    note = next((entry for entry in _available_notes(a, user) if entry.id == note_id), None)
    if not note or note.note_type != expected_type:
        raise InboxValidationError('The selected note is unavailable.')
    return note


def normalize_destination(a, user, raw_destination, capture_content):
    if not isinstance(raw_destination, dict):
        raise InboxValidationError('Destination details are required.')
    kind = (raw_destination.get('kind') or '').strip().lower()
    if kind == 'task':
        try:
            list_id = int(raw_destination.get('list_id'))
        except (TypeError, ValueError):
            raise InboxValidationError('Choose a task list or project.')
        todo_list = a.TodoList.query.filter(
            a.TodoList.id == list_id,
            a.TodoList.user_id == user.id,
            a.TodoList.type.in_(['list', 'light']),
        ).first()
        if not todo_list:
            raise InboxValidationError('The selected task list is unavailable.')
        phase_id = raw_destination.get('phase_id')
        if phase_id in (None, '', 'none', 'null') or todo_list.type == 'light':
            phase_id = None
        else:
            try:
                phase_id = int(phase_id)
            except (TypeError, ValueError):
                raise InboxValidationError('Choose a valid project phase.')
            phase = a.TodoItem.query.filter_by(id=phase_id, list_id=todo_list.id).first()
            if not phase or not phase.is_phase_header():
                raise InboxValidationError('The selected phase is unavailable.')
        due_date = _parse_iso_date(raw_destination.get('due_date'))
        start_time = _parse_clock(raw_destination.get('start_time'))
        end_time = _parse_clock(raw_destination.get('end_time'))
        reminder = _parse_reminder(raw_destination.get('reminder_minutes_before'))
        if (start_time or end_time or reminder is not None) and not due_date:
            raise InboxValidationError('Choose a due date before adding time or a reminder.')
        if reminder is not None and not start_time:
            raise InboxValidationError('Choose a start time before adding a reminder.')
        if start_time and end_time and end_time <= start_time:
            raise InboxValidationError('End time must be after start time.')
        title = (raw_destination.get('title') or _clean_capture_title(capture_content)).strip()
        if not title:
            raise InboxValidationError('Task title is required.')
        tags = raw_destination.get('tags') or []
        if isinstance(tags, str):
            tags = [tag.strip() for tag in tags.split(',') if tag.strip()]
        return {
            'kind': 'task',
            'list_id': todo_list.id,
            'phase_id': phase_id,
            'title': title[:200],
            'description': (raw_destination.get('description') or '').strip() or None,
            'notes': (raw_destination.get('notes') or '').strip() or None,
            'tags': tags if todo_list.type != 'light' else [],
            'due_date': due_date.isoformat() if due_date else None,
            'start_time': start_time.strftime('%H:%M') if start_time else None,
            'end_time': end_time.strftime('%H:%M') if end_time else None,
            'reminder_minutes_before': reminder,
        }

    if kind == 'calendar':
        day = _parse_iso_date(raw_destination.get('day'))
        if not day:
            raise InboxValidationError('Calendar date is required.')
        start_time = _parse_clock(raw_destination.get('start_time'))
        end_time = _parse_clock(raw_destination.get('end_time'))
        reminder = _parse_reminder(raw_destination.get('reminder_minutes_before'))
        if reminder is not None and not start_time:
            raise InboxValidationError('Choose a start time before adding a reminder.')
        if start_time and end_time and end_time <= start_time:
            raise InboxValidationError('End time must be after start time.')
        title = _clean_capture_title(
            raw_destination.get('title') or capture_content
        ).strip()
        if not title:
            raise InboxValidationError('Calendar title is required.')
        return {
            'kind': 'calendar',
            'title': title[:200],
            'day': day.isoformat(),
            'start_time': start_time.strftime('%H:%M') if start_time else None,
            'end_time': end_time.strftime('%H:%M') if end_time else None,
            'reminder_minutes_before': reminder,
            'is_event': bool(raw_destination.get('is_event')),
        }

    if kind == 'note':
        note = _owned_note(a, user, raw_destination.get('note_id'), 'note')
        text = (raw_destination.get('text') or capture_content).strip()
        if not text:
            raise InboxValidationError('Note text is required.')
        return {'kind': 'note', 'note_id': note.id, 'text': text}

    if kind == 'note_list':
        note = _owned_note(a, user, raw_destination.get('note_id'), 'list')
        section_id = raw_destination.get('section_id')
        subsection_id = raw_destination.get('subsection_id')
        section_id = int(section_id) if str(section_id or '').isdigit() else None
        subsection_id = int(subsection_id) if str(subsection_id or '').isdigit() else None
        marker_map = {item.id: item for item in note.list_items}
        if section_id:
            section = marker_map.get(section_id)
            if not section or _marker_kind(section.text) != 'section':
                raise InboxValidationError('The selected section is unavailable.')
        if subsection_id:
            subsection = marker_map.get(subsection_id)
            if not subsection or _marker_kind(subsection.text) != 'subsection':
                raise InboxValidationError('The selected subsection is unavailable.')
            ordered = sorted(note.list_items, key=lambda item: ((item.order_index or 0), item.id))
            current_section_id = None
            subsection_parent_id = None
            for item in ordered:
                kind_value = _marker_kind(item.text)
                if kind_value == 'section':
                    current_section_id = item.id
                elif item.id == subsection_id:
                    subsection_parent_id = current_section_id
                    break
            if section_id and subsection_parent_id != section_id:
                raise InboxValidationError('The subsection is not inside the selected section.')
            section_id = subsection_parent_id
        scheduled_date = _parse_iso_date(raw_destination.get('scheduled_date'))
        start_time = _parse_clock(raw_destination.get('start_time'))
        end_time = _parse_clock(raw_destination.get('end_time'))
        reminder = _parse_reminder(raw_destination.get('reminder_minutes_before'))
        if (start_time or end_time or reminder is not None) and not scheduled_date:
            raise InboxValidationError('Choose a date before adding time or a reminder.')
        if reminder is not None and not start_time:
            raise InboxValidationError('Choose a start time before adding a reminder.')
        if start_time and end_time and end_time <= start_time:
            raise InboxValidationError('End time must be after start time.')
        text = (raw_destination.get('text') or _clean_capture_title(capture_content)).strip()
        if not text:
            raise InboxValidationError('List item text is required.')
        return {
            'kind': 'note_list',
            'note_id': note.id,
            'section_id': section_id,
            'subsection_id': subsection_id,
            'text': text[:300],
            'note': (raw_destination.get('note') or '').strip() or None,
            'scheduled_date': scheduled_date.isoformat() if scheduled_date else None,
            'start_time': start_time.strftime('%H:%M') if start_time else None,
            'end_time': end_time.strftime('%H:%M') if end_time else None,
            'reminder_minutes_before': reminder,
        }

    raise InboxValidationError('Choose a supported destination type.')


def describe_destination(a, user, destination):
    kind = destination.get('kind')
    if kind == 'task':
        todo_list = a.db.session.get(a.TodoList, destination['list_id'])
        label = todo_list.title if todo_list else 'Task list'
        if destination.get('phase_id'):
            phase = a.db.session.get(a.TodoItem, destination['phase_id'])
            if phase:
                label += f' / {phase.content}'
        return f'Task in {label}'
    if kind == 'calendar':
        schedule = destination.get('day') or 'calendar'
        if destination.get('start_time'):
            schedule += f" at {destination['start_time']}"
        return f'Calendar on {schedule}'
    note = a.db.session.get(a.Note, destination.get('note_id'))
    if kind == 'note':
        return f'Append to note: {note.title if note else "Note"}'
    if kind == 'note_list':
        label = note.title if note else 'Notes list'
        marker_ids = [destination.get('section_id'), destination.get('subsection_id')]
        marker_titles = []
        for marker_id in marker_ids:
            if marker_id:
                marker = a.db.session.get(a.NoteListItem, marker_id)
                if marker:
                    marker_titles.append(_marker_title(marker.text))
        if marker_titles:
            label += ' / ' + ' / '.join(marker_titles)
        return f'List item in {label}'
    return 'Unknown destination'


def _apply_suggestion(
    a,
    user,
    inbox_item,
    destination,
    reason,
    confidence,
    source,
):
    destination = normalize_destination(a, user, destination, inbox_item.content)
    destination['label'] = describe_destination(a, user, destination)
    inbox_item.suggestion_json = json.dumps(destination)
    inbox_item.suggestion_status = 'ready'
    inbox_item.suggestion_source = source
    inbox_item.suggestion_reason = str(reason or '')[:500]
    inbox_item.suggestion_confidence = round(
        max(0.0, min(float(confidence), 1.0)),
        3,
    )
    return destination


def generate_rule_suggestion(a, user, inbox_item, catalog=None):
    catalog = catalog or build_destination_catalog(a, user, include_context=True)
    today_value = a._now_local().date()
    destination, reason, confidence = build_heuristic_suggestion(
        inbox_item.content,
        catalog,
        today=today_value,
    )
    destination = _apply_suggestion(
        a,
        user,
        inbox_item,
        destination,
        reason,
        confidence,
        'rules',
    )
    return destination, confidence, catalog


def refine_suggestion_with_ai(a, user, inbox_item, catalog, fallback_destination):
    ai_result = _ai_suggestion(
        a,
        user,
        inbox_item.content,
        catalog,
        fallback_destination,
    )
    if isinstance(ai_result, dict) and isinstance(ai_result.get('destination'), dict):
        try:
            return _apply_suggestion(
                a,
                user,
                inbox_item,
                ai_result['destination'],
                ai_result.get('reason') or 'AI matched this capture to existing context.',
                ai_result.get('confidence', 0.7),
                'ai',
            )
        except (InboxValidationError, TypeError, ValueError):
            pass
    return None


def generate_suggestion(a, user, inbox_item):
    """Generate a suggestion synchronously for scripts and focused tests."""
    destination, _confidence, catalog = generate_rule_suggestion(a, user, inbox_item)
    if _ai_available(a):
        refined = refine_suggestion_with_ai(
            a,
            user,
            inbox_item,
            catalog,
            destination,
        )
        if refined:
            destination = refined
    return destination


def process_inbox_suggestion(item_id):
    """Publish a local suggestion first, then optionally refine it with AI."""
    import app as a

    item = a.db.session.get(a.InboxItem, item_id)
    if not item or item.status != 'open':
        return
    user = a.db.session.get(a.User, item.user_id)
    if not user:
        return

    try:
        destination, confidence, catalog = generate_rule_suggestion(a, user, item)
        should_refine = _ai_available(a)
        if should_refine:
            item.suggestion_status = 'refining'
        a.db.session.commit()
    except Exception as exc:
        a.db.session.rollback()
        item = a.db.session.get(a.InboxItem, item_id)
        if item and item.status == 'open':
            item.suggestion_status = 'failed'
            item.suggestion_source = 'rules-failed'
            item.suggestion_reason = 'Automatic detection failed. Map this item manually.'
            a.db.session.commit()
        a.app.logger.warning('Inbox rule detection failed for item %s: %s', item_id, exc)
        return

    if not should_refine:
        return

    try:
        item = a.db.session.get(a.InboxItem, item_id)
        if not item or item.status != 'open':
            return
        user = a.db.session.get(a.User, item.user_id)
        refined = refine_suggestion_with_ai(
            a,
            user,
            item,
            catalog,
            destination,
        )
        if refined and item.status == 'open':
            a.db.session.commit()
        elif item.status == 'open':
            item.suggestion_status = 'ready'
            a.db.session.commit()
    except Exception as exc:
        # The rules-based suggestion is already committed and remains usable.
        a.db.session.rollback()
        item = a.db.session.get(a.InboxItem, item_id)
        if item and item.status == 'open' and item.suggestion_json:
            item.suggestion_status = 'ready'
            a.db.session.commit()
        a.app.logger.warning('Inbox AI refinement failed for item %s: %s', item_id, exc)


def queue_inbox_suggestion(a, inbox_item):
    if inbox_item.status != 'open':
        return
    inbox_item.suggestion_status = 'processing'
    inbox_item.suggestion_reason = 'Detecting the best destination...'
    a.db.session.commit()
    start_app_context_job(
        a.app,
        process_inbox_suggestion,
        args=(inbox_item.id,),
    )


def _append_note_html(existing_html, text):
    paragraphs = [
        f'<p>{html.escape(line.strip())}</p>'
        for line in re.split(r'\r?\n+', text)
        if line.strip()
    ]
    addition = ''.join(paragraphs)
    if not addition:
        raise InboxValidationError('Note text is required.')
    current = (existing_html or '').strip()
    return _sanitize_note_html(f'{current}{addition}')


def map_inbox_item(a, user, inbox_item, raw_destination):
    if inbox_item.status != 'open':
        raise InboxValidationError('This inbox item has already been mapped.')
    destination = normalize_destination(a, user, raw_destination, inbox_item.content)
    kind = destination['kind']
    result = None
    calendar_event = None

    if kind == 'task':
        todo_list = a.db.session.get(a.TodoList, destination['list_id'])
        next_order = (
            a.db.session.query(a.db.func.coalesce(a.db.func.max(a.TodoItem.order_index), 0))
            .filter_by(list_id=todo_list.id)
            .scalar()
            + 1
        )
        due_date = _parse_iso_date(destination.get('due_date'))
        item = a.TodoItem(
            list_id=todo_list.id,
            content=destination['title'],
            description=destination.get('description'),
            notes=destination.get('notes'),
            tags=a.tags_to_string(destination.get('tags')) or None,
            status='not_started',
            order_index=next_order,
            phase_id=destination.get('phase_id'),
            due_date=due_date,
        )
        a.db.session.add(item)
        a.db.session.flush()
        a.insert_item_in_order(todo_list, item, phase_id=destination.get('phase_id'))
        if destination.get('phase_id'):
            phase = a.db.session.get(a.TodoItem, destination['phase_id'])
            if phase:
                phase.update_phase_status()
        if due_date and (
            destination.get('start_time')
            or destination.get('end_time')
            or destination.get('reminder_minutes_before') is not None
        ):
            calendar_event = a.CalendarEvent(
                user_id=user.id,
                title=item.content,
                description=item.description,
                day=due_date,
                start_time=_parse_clock(destination.get('start_time')),
                end_time=_parse_clock(destination.get('end_time')),
                status='not_started',
                priority='medium',
                order_index=a._next_calendar_order(due_date, user.id),
                reminder_minutes_before=destination.get('reminder_minutes_before'),
                todo_item_id=item.id,
                rollover_enabled=True,
            )
            a.db.session.add(calendar_event)
            a.db.session.flush()
        result = {
            'kind': kind,
            'id': item.id,
            'label': describe_destination(a, user, destination),
            'url': f'/list/{todo_list.id}',
        }

    elif kind == 'calendar':
        day_value = _parse_iso_date(destination['day'])
        calendar_event = a.CalendarEvent(
            user_id=user.id,
            title=destination['title'],
            day=day_value,
            start_time=_parse_clock(destination.get('start_time')),
            end_time=_parse_clock(destination.get('end_time')),
            status='not_started',
            priority='medium',
            is_event=bool(destination.get('is_event')),
            order_index=a._next_calendar_order(day_value, user.id),
            reminder_minutes_before=destination.get('reminder_minutes_before'),
            rollover_enabled=not bool(destination.get('is_event')),
        )
        a.db.session.add(calendar_event)
        a.db.session.flush()
        result = {
            'kind': kind,
            'id': calendar_event.id,
            'label': describe_destination(a, user, destination),
            'url': f"/calendar?date={destination['day']}",
        }

    elif kind == 'note':
        note = a.db.session.get(a.Note, destination['note_id'])
        note.content = _append_note_html(note.content, destination['text'])
        note.updated_at = a._now_local()
        result = {
            'kind': kind,
            'id': note.id,
            'label': describe_destination(a, user, destination),
            'url': f'/notes/{note.id}',
        }

    elif kind == 'note_list':
        note = a.db.session.get(a.Note, destination['note_id'])
        existing_items = a.NoteListItem.query.filter_by(note_id=note.id).order_by(
            a.NoteListItem.order_index.asc(),
            a.NoteListItem.id.asc(),
        ).all()
        insert_index = note_list_insert_index(
            existing_items,
            section_id=destination.get('section_id'),
            subsection_id=destination.get('subsection_id'),
        )
        for index, existing_item in enumerate(existing_items):
            existing_item.order_index = index + 1 if index < insert_index else index + 2
        scheduled_date = _parse_iso_date(destination.get('scheduled_date'))
        item = a.NoteListItem(
            note_id=note.id,
            text=destination['text'],
            note=destination.get('note'),
            scheduled_date=scheduled_date,
            checked=False,
            order_index=insert_index + 1,
        )
        note.updated_at = a._now_local()
        a.db.session.add(item)
        a.db.session.flush()
        if scheduled_date and (
            destination.get('start_time')
            or destination.get('end_time')
            or destination.get('reminder_minutes_before') is not None
        ):
            calendar_event = a.CalendarEvent(
                user_id=user.id,
                title=item.text,
                day=scheduled_date,
                start_time=_parse_clock(destination.get('start_time')),
                end_time=_parse_clock(destination.get('end_time')),
                status='not_started',
                priority='medium',
                order_index=a._next_calendar_order(scheduled_date, user.id),
                reminder_minutes_before=destination.get('reminder_minutes_before'),
                note_list_item_id=item.id,
                rollover_enabled=True,
            )
            a.db.session.add(calendar_event)
            a.db.session.flush()
        result = {
            'kind': kind,
            'id': item.id,
            'label': describe_destination(a, user, destination),
            'url': f'/notes/{note.id}',
        }

    inbox_item.status = 'mapped'
    inbox_item.mapped_destination_type = kind
    inbox_item.mapped_destination_id = result['id']
    inbox_item.mapped_result_json = json.dumps(result)
    inbox_item.mapped_at = a._now_local()
    a.db.session.commit()

    if calendar_event:
        if (
            calendar_event.reminder_minutes_before is not None
            and calendar_event.start_time
        ):
            a._schedule_reminder_job(calendar_event)
        a.start_embedding_job(user.id, a.ENTITY_CALENDAR, calendar_event.id)
    if kind == 'task':
        a.start_embedding_job(user.id, a.ENTITY_TODO_ITEM, result['id'])
    return result


def inbox_page():
    import app as a

    if not a.get_current_user():
        return a.redirect(a.url_for('select_user'))
    return a.render_template('inbox.html')


def inbox_items():
    import app as a

    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    if a.request.method == 'GET':
        items = a.InboxItem.query.filter_by(user_id=user.id, status='open').order_by(
            a.InboxItem.created_at.desc(),
            a.InboxItem.id.desc(),
        ).all()
        stale_before = a._now_local() - timedelta(minutes=5)
        for item in items:
            is_stalled = (
                item.suggestion_status == 'processing'
                and item.updated_at
                and item.updated_at < stale_before
            )
            needs_legacy_retry = (
                item.suggestion_status == 'failed'
                and not item.suggestion_json
                and not item.suggestion_source
            )
            if item.suggestion_status == 'pending' or is_stalled or needs_legacy_retry:
                queue_inbox_suggestion(a, item)
        return a.jsonify([item.to_dict() for item in items])

    data = a.request.get_json(silent=True) or {}
    content = (data.get('content') or '').strip()
    if not content:
        return a.jsonify({'error': 'Write something to add to the inbox.'}), 400
    if len(content) > MAX_CAPTURE_LENGTH:
        return a.jsonify({'error': f'Inbox items are limited to {MAX_CAPTURE_LENGTH} characters.'}), 400
    item = a.InboxItem(user_id=user.id, content=content)
    a.db.session.add(item)
    a.db.session.commit()
    queue_inbox_suggestion(a, item)
    return a.jsonify(item.to_dict()), 201


def inbox_destinations():
    import app as a

    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    return a.jsonify(build_destination_catalog(a, user, include_context=False))


def accept_inbox_suggestion(item_id):
    import app as a

    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    item = a.InboxItem.query.filter_by(id=item_id, user_id=user.id).first_or_404()
    if not item.suggestion_json:
        return a.jsonify({'error': 'No automatic suggestion is available.'}), 409
    try:
        destination = json.loads(item.suggestion_json)
        result = map_inbox_item(a, user, item, destination)
        return a.jsonify({'mapped': True, 'result': result})
    except InboxValidationError as exc:
        a.db.session.rollback()
        return a.jsonify({'error': str(exc)}), 400
    except Exception:
        a.db.session.rollback()
        a.app.logger.exception('Failed to accept inbox suggestion %s', item_id)
        return a.jsonify({'error': 'Could not map this inbox item.'}), 500


def map_inbox_item_route(item_id):
    import app as a

    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    item = a.InboxItem.query.filter_by(id=item_id, user_id=user.id).first_or_404()
    data = a.request.get_json(silent=True) or {}
    destination = data.get('destination') if isinstance(data.get('destination'), dict) else data
    try:
        result = map_inbox_item(a, user, item, destination)
        return a.jsonify({'mapped': True, 'result': result})
    except InboxValidationError as exc:
        a.db.session.rollback()
        return a.jsonify({'error': str(exc)}), 400
    except Exception:
        a.db.session.rollback()
        a.app.logger.exception('Failed to map inbox item %s', item_id)
        return a.jsonify({'error': 'Could not map this inbox item.'}), 500


def delete_inbox_item(item_id):
    import app as a

    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    item = a.InboxItem.query.filter_by(id=item_id, user_id=user.id).first_or_404()
    a.db.session.delete(item)
    a.db.session.commit()
    return '', 204
