"""Core non-route application logic extracted from app.py."""

import app as _app_module

# Keep access to shared app context, db/models, constants, and helpers.
for _name, _value in vars(_app_module).items():
    if not _name.startswith('__'):
        globals()[_name] = _value

def _extract_note_list_lines(raw_html):
    return extract_note_list_lines(
        raw_html,
        min_lines=NOTE_LIST_CONVERSION_MIN_LINES,
        max_lines=NOTE_LIST_CONVERSION_MAX_LINES,
        max_chars=NOTE_LIST_CONVERSION_MAX_CHARS,
        max_words=NOTE_LIST_CONVERSION_MAX_WORDS,
        sentence_word_limit=NOTE_LIST_CONVERSION_SENTENCE_WORD_LIMIT,
    )



def _is_note_linked(note, linked_targets=None, linked_sources=None):
    return is_note_linked(note, linked_targets=linked_targets, linked_sources=linked_sources)



def _normalize_calendar_item_note(raw):
    return normalize_calendar_item_note(raw, max_chars=CALENDAR_ITEM_NOTE_MAX_CHARS)



def get_current_user():
    """Resolve the current user from a shared API key + user id header, else fall back to session."""
    # Header-based auth for AI/service callers
    api_key = request.headers.get('X-API-Key')
    api_user_id = request.headers.get('X-User-Id')
    shared_key = app.config.get('API_SHARED_KEY')
    if shared_key and api_key and api_user_id:
        try:
            api_uid_int = int(api_user_id)
        except (TypeError, ValueError):
            api_uid_int = None
        if api_uid_int and api_key == shared_key:
            user = db.session.get(User, api_uid_int)
            if user:
                return user

    # Session-based auth for browser users
    user_id = session.get('user_id')
    if user_id:
        return db.session.get(User, user_id)
    return None



def _ensure_planner_feed_folder(user):
    feed = PlannerFolder.query.filter(
        PlannerFolder.user_id == user.id,
        PlannerFolder.folder_type == 'simple',
        func.lower(PlannerFolder.name) == PLANNER_FEED_FOLDER_NAME.lower()
    ).first()
    touched = False
    if not feed:
        feed = PlannerFolder(
            user_id=user.id,
            parent_id=None,
            name=PLANNER_FEED_FOLDER_NAME,
            folder_type='simple'
        )
        db.session.add(feed)
        db.session.flush()
        touched = True

    simple_folders = PlannerFolder.query.filter_by(user_id=user.id, folder_type='simple').all()
    for folder in simple_folders:
        if folder.id == feed.id:
            continue
        items = PlannerSimpleItem.query.filter_by(user_id=user.id, folder_id=folder.id).all()
        if items:
            for item in items:
                merged_tags = merge_tag_list(item.tags, folder.name)
                item.tags = tags_to_string(merged_tags) if merged_tags else None
                item.folder_id = feed.id
            touched = True
        db.session.delete(folder)
        touched = True

    if touched:
        db.session.commit()
    return feed



def _vault_root_for_user(user_id):
    return os.path.join(app.instance_path, 'vault', str(user_id))



def _vault_sanitize_extension(filename):
    ext = os.path.splitext(filename or '')[1].lower().lstrip('.')
    if not ext:
        return ''
    cleaned = re.sub(r'[^a-z0-9]+', '', ext)
    return cleaned[:12] if cleaned else ''



def _vault_is_blocked_file(filename, mimetype):
    ext = _vault_sanitize_extension(filename)
    if ext in VAULT_BLOCKED_EXTENSIONS:
        return True
    blocked_mimes = {
        'application/x-msdownload',
        'application/x-dosexec',
        'application/x-ms-installer',
        'application/x-bat',
        'application/x-sh',
    }
    return bool(mimetype and mimetype in blocked_mimes)



def _vault_build_download_name(title, original_filename):
    base = (title or '').strip() or os.path.splitext(original_filename or '')[0] or 'document'
    ext = os.path.splitext(original_filename or '')[1]
    candidate = base if base.lower().endswith(ext.lower()) else f"{base}{ext}"
    return secure_filename(candidate) or 'document'



def _vault_archive_folder_recursive(user_id, folder_id, archived_at):
    folder = DocumentFolder.query.filter_by(id=folder_id, user_id=user_id).first()
    if not folder:
        return
    folder.archived_at = archived_at
    folder.updated_at = archived_at
    Document.query.filter_by(user_id=user_id, folder_id=folder_id).update(
        {'archived_at': archived_at, 'updated_at': archived_at},
        synchronize_session=False
    )
    child_ids = [child.id for child in DocumentFolder.query.filter_by(
        user_id=user_id,
        parent_id=folder_id
    ).all()]
    for child_id in child_ids:
        _vault_archive_folder_recursive(user_id, child_id, archived_at)



def _now_local():
    tz = pytz.timezone(app.config.get('DEFAULT_TIMEZONE', 'America/New_York'))
    return datetime.now(tz).replace(tzinfo=None)





def _sanitize_sidebar_order(order):
    """Ensure sidebar order is a valid, complete list of allowed items."""
    cleaned = [str(item).strip() for item in (order or []) if isinstance(item, str) and str(item).strip()]
    allowed = set(DEFAULT_SIDEBAR_ORDER)
    cleaned = [item for item in cleaned if item in allowed]
    seen = set()
    final_order = []
    for item in cleaned:
        if item not in seen:
            seen.add(item)
            final_order.append(item)
    for item in DEFAULT_SIDEBAR_ORDER:
        if item not in seen:
            final_order.append(item)
    return final_order



def _load_sidebar_order(user):
    """Load sidebar order from user profile, falling back to defaults."""
    if not user:
        return list(DEFAULT_SIDEBAR_ORDER)
    try:
        raw = user.sidebar_order
        if raw:
            data = json.loads(raw)
            if isinstance(data, list):
                return _sanitize_sidebar_order(data)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        app.logger.warning(f"Failed to load sidebar order for user {user.id}: {exc}")
    return list(DEFAULT_SIDEBAR_ORDER)



def _save_sidebar_order(user, order):
    """Persist sidebar order to the user's profile."""
    if not user:
        return
    user.sidebar_order = json.dumps(_sanitize_sidebar_order(order))



def _sanitize_homepage_order(order):
    """Ensure homepage order is a valid, complete list of allowed modules."""
    cleaned = [str(item).strip() for item in (order or []) if isinstance(item, str) and str(item).strip()]
    allowed = set(DEFAULT_HOMEPAGE_ORDER)
    cleaned = [item for item in cleaned if item in allowed]
    seen = set()
    final_order = []
    for item in cleaned:
        if item not in seen:
            seen.add(item)
            final_order.append(item)
    # Add any missing modules to maintain completeness
    for item in DEFAULT_HOMEPAGE_ORDER:
        if item not in seen:
            final_order.append(item)
    return final_order



def _load_homepage_order(user):
    """Load homepage order from user profile, falling back to defaults."""
    if not user:
        return list(DEFAULT_HOMEPAGE_ORDER)
    try:
        raw = user.homepage_order
        if raw:
            data = json.loads(raw)
            if isinstance(data, list):
                return _sanitize_homepage_order(data)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        app.logger.warning(f"Failed to load homepage order for user {user.id}: {exc}")
    return list(DEFAULT_HOMEPAGE_ORDER)



def _save_homepage_order(user, order):
    """Persist homepage order to the user's profile."""
    if not user:
        return
    user.homepage_order = json.dumps(_sanitize_homepage_order(order))



def start_recall_processing(recall_id):
    """Start background processing for a recall item."""
    from backend.recall_processor import process_recall
    start_daemon_thread(process_recall, args=(recall_id,))



def start_embedding_job(user_id, entity_type, entity_id):
    """Start background embedding refresh for a single entity."""
    def _refresh_single_embedding():
        refresh_embedding_for_entity(user_id, entity_type, entity_id)

    def _on_error(exc):
        app.logger.warning(
            "Embedding refresh failed for %s:%s user=%s (%s)",
            entity_type,
            entity_id,
            user_id,
            exc,
        )

    start_app_context_job(app, _refresh_single_embedding, on_error=_on_error)



def delete_embedding(user_id, entity_type, entity_id):
    """Delete a stored embedding for a single entity."""
    try:
        delete_embedding_for_entity(user_id, entity_type, entity_id)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        app.logger.warning(
            "Embedding delete failed for %s:%s user=%s (%s)",
            entity_type,
            entity_id,
            user_id,
            exc,
        )



def start_list_children_embedding_job(user_id, list_id):
    """Refresh embeddings for items inside a list after a list rename."""
    def _refresh_list_children():
        todo_list = TodoList.query.filter_by(id=list_id, user_id=user_id).first()
        if not todo_list:
            return
        for item in todo_list.items:
            refresh_embedding_for_entity(user_id, ENTITY_TODO_ITEM, item.id)

    start_app_context_job(app, _refresh_list_children)


def parse_outline(outline_text, list_type='list'):
    """Parse a pasted outline into item dicts with content/status/description/notes."""

    def split_fields(text):
        """Split a line into content, description, notes using :: and ::: separators."""
        notes = None
        description = None
        main = text
        if ':::' in main:
            main, notes = main.split(':::', 1)
            notes = notes.strip() or None
        if '::' in main:
            main, description = main.split('::', 1)
            description = description.strip() or None
        return main.strip(), description, notes

    if list_type == 'hub':
        return parse_hub_outline(outline_text) # This was missing the return

    # --- Default parsing for simple lists ---
    allow_phases = list_type != 'light'
    items = []
    for raw_line in outline_text.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            continue

        stripped = line.strip()
        if not allow_phases:
            if stripped.startswith('#'):
                stripped = stripped.lstrip('#').strip()
            if stripped.endswith(':') and len(stripped) > 1:
                stripped = stripped[:-1].strip()

        # Headers / phases: markdown-style "#" or trailing colon
        if allow_phases and stripped.startswith('#'):
            title, description, notes = split_fields(stripped.lstrip('#').strip())
            if title:
                items.append({'content': title, 'status': 'not_started', 'is_phase': True, 'description': description, 'notes': notes})
            continue
        if allow_phases and stripped.endswith(':') and len(stripped) > 1:
            title, description, notes = split_fields(stripped[:-1].strip())
            if title:
                items.append({'content': title, 'status': 'not_started', 'is_phase': True, 'description': description, 'notes': notes})
            continue

        # Checkbox tasks: "- [ ]", "- [x]", "- [>]", "- [~]"
        checkbox_match = re.match(r"^[-*]\s*\[(?P<mark>[ xX>~])\]\s*(?P<body>.+)$", stripped)
        if checkbox_match:
            mark = checkbox_match.group('mark').lower()
            body = checkbox_match.group('body').strip()
            status = {
                'x': 'done',
                '>': 'in_progress',
                '~': 'in_progress',
                ' ': 'not_started'
            }.get(mark, 'not_started')
            if body:
                content, description, notes = split_fields(body)
                if content:
                    items.append({'content': content, 'status': status, 'description': description, 'notes': notes, 'is_phase': False})
            continue

        # Bullet tasks: "- task" or "* task"
        bullet_match = re.match(r"^[-*]\s+(?P<body>.+)$", stripped)
        if bullet_match:
            body = bullet_match.group('body').strip()
            if body:
                content, description, notes = split_fields(body)
                if content:
                    items.append({'content': content, 'status': 'not_started', 'description': description, 'notes': notes, 'is_phase': False})
            continue

        # Fallback: treat as a task line
        content, description, notes = split_fields(stripped)
        if content:
            items.append({'content': content, 'status': 'not_started', 'description': description, 'notes': notes, 'is_phase': False})

    return items


def parse_hub_outline(outline_text):
    """Parse a hierarchical outline for a Project Hub."""
    projects = []
    current_project = None

    def split_fields(text):
        notes, description, main = None, None, text
        if ':::' in main: main, notes = main.split(':::', 1)
        if '::' in main: main, description = main.split('::', 1)
        return main.strip(), (description or '').strip() or None, (notes or '').strip() or None

    for raw_line in outline_text.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            continue

        stripped = line.strip()
        indent_level = len(raw_line) - len(raw_line.lstrip(' '))

        # Project: Top-level heading
        if stripped.startswith('# ') and indent_level == 0:
            body = stripped.lstrip('# ').strip()
            project_type = 'list'
            if body.lower().endswith('[hub]'):
                body = body[:-5].strip()
                project_type = 'hub'
            title, description, notes = split_fields(body)
            if title:
                current_project = {
                    'content': title, 'description': description, 'notes': notes, 'project_type': project_type, 'items': []
                }
                projects.append(current_project)
            continue

        if not current_project:
            continue # Skip lines until the first project is defined

        # Phase: Indented heading
        if stripped.startswith('## '):
            title, description, notes = split_fields(stripped.lstrip('## ').strip())
            if title:
                current_project['items'].append({'content': title, 'status': 'not_started', 'is_phase': True, 'description': description, 'notes': notes})
            continue

        # Task: Indented list item
        checkbox_match = re.match(r"^[-*]\s*\[(?P<mark>[ xX>~])\]\s*(?P<body>.+)$", stripped)
        if checkbox_match:
            mark = checkbox_match.group('mark').lower()
            body = checkbox_match.group('body').strip()
            status = {'x': 'done', '>': 'in_progress', '~': 'in_progress', ' ': 'not_started'}.get(mark, 'not_started')
            content, description, notes = split_fields(body)
            if content:
                current_project['items'].append({'content': content, 'status': status, 'description': description, 'notes': notes, 'is_phase': False})
            continue

        bullet_match = re.match(r"^[-*]\s+(?P<body>.+)$", stripped)
        if bullet_match:
            body = bullet_match.group('body').strip()
            content, description, notes = split_fields(body)
            if content:
                current_project['items'].append({'content': content, 'status': 'not_started', 'description': description, 'notes': notes, 'is_phase': False})
            continue

    return projects

# --- Export Helpers ---


def _format_metadata(content, description=None, notes=None):
    """Append :: description and ::: notes to a content string when present."""
    text = (content or '').strip()
    if description:
        text += f" :: {description.strip()}"
    if notes:
        text += f" ::: {notes.strip()}"
    return text


def _status_mark(status):
    """Map item status to checkbox mark for export."""
    return {
        'done': 'x',
        'in_progress': '>',
    }.get(status, ' ')


def export_list_outline(todo_list, indent=0):
    """Export a TodoList (hub or list) to outline lines using import-compatible syntax."""
    prefix = ' ' * indent
    lines = []
    ordered_items = sorted(todo_list.items, key=lambda i: i.order_index or 0)

    if todo_list.type == 'list':
        for item in ordered_items:
            if is_phase_header(item):
                lines.append(f"{prefix}## {_format_metadata(item.content, item.description, item.notes)}")
                continue
            line_prefix = prefix + ('  ' if item.phase_id else '')
            lines.append(f"{line_prefix}- [{_status_mark(item.status)}] {_format_metadata(item.content, item.description, item.notes)}")
        return lines
    if todo_list.type == 'light':
        for item in ordered_items:
            if is_phase_header(item):
                lines.append(f"{prefix}- [{_status_mark('not_started')}] {_format_metadata(item.content, item.description, item.notes)}")
                continue
            lines.append(f"{prefix}- [{_status_mark(item.status)}] {_format_metadata(item.content, item.description, item.notes)}")
        return lines

    # Hub: export each project (linked list) and its children
    for item in ordered_items:
        if item.linked_list:
            child_list = item.linked_list
            title = item.content + (' [hub]' if child_list.type == 'hub' else '')
            lines.append(f"{prefix}# {_format_metadata(title, item.description, item.notes)}")
            lines.extend(export_list_outline(child_list, indent + 2))
        else:
            # Fallback: export plain items at hub level as tasks
            lines.append(f"{prefix}- [{_status_mark(item.status)}] {_format_metadata(item.content, item.description, item.notes)}")
    return lines


def _slugify_filename(value):
    """Create a simple, safe filename slug."""
    value = (value or '').strip().lower()
    value = re.sub(r'[^a-z0-9]+', '-', value)
    value = re.sub(r'-{2,}', '-', value).strip('-')
    return value or 'list'



def insert_item_in_order(todo_list, new_item, phase_id=None):
    """Place a new item in the ordering, optionally directly under a phase."""
    ordered = sorted(list(todo_list.items), key=lambda i: i.order_index or 0)
    if new_item not in ordered:
        ordered.append(new_item)

    if phase_id:
        phase = next((i for i in ordered if i.id == phase_id and is_phase_header(i)), None)
        if phase:
            try:
                phase_idx = ordered.index(phase)
            except ValueError:
                phase_idx = -1
            insert_idx = phase_idx + 1
            # Walk forward until the next phase header
            while insert_idx < len(ordered) and not is_phase_header(ordered[insert_idx]):
                insert_idx += 1
            # Remove and reinsert in the right spot
            ordered = [i for i in ordered if i.id != new_item.id]
            ordered.insert(insert_idx, new_item)

    for idx, item in enumerate(ordered, start=1):
        item.order_index = idx


def insert_items_under_phase(todo_list, new_items, phase_id=None):
    """Place multiple items under a specific phase (or at end if no phase)."""
    if not new_items:
        return

    ordered = sorted(list(todo_list.items), key=lambda i: i.order_index or 0)
    new_ids = {i.id for i in new_items if i.id is not None}
    ordered = [i for i in ordered if i.id not in new_ids]

    if phase_id:
        phase = next((i for i in ordered if i.id == phase_id and is_phase_header(i)), None)
        if phase:
            try:
                phase_idx = ordered.index(phase)
            except ValueError:
                phase_idx = -1
            insert_idx = phase_idx + 1
            while insert_idx < len(ordered) and not is_phase_header(ordered[insert_idx]):
                insert_idx += 1
            for offset, item in enumerate(new_items):
                ordered.insert(insert_idx + offset, item)
        else:
            ordered.extend(new_items)
    else:
        ordered.extend(new_items)

    for idx, item in enumerate(ordered, start=1):
        item.order_index = idx


def reindex_list(todo_list):
    """Ensure order_index is sequential within a list."""
    ordered = sorted(todo_list.items, key=lambda i: i.order_index or 0)
    for idx, item in enumerate(ordered, start=1):
        item.order_index = idx

# --- Calendar Helpers ---



def _time_to_minutes(t):
    return (t.hour * 60) + t.minute



def _event_end_minutes(start_minutes, end_time):
    if end_time:
        end_minutes = _time_to_minutes(end_time)
        if end_minutes > start_minutes:
            return end_minutes
    return min(start_minutes + 30, 24 * 60)



def _task_conflicts_with_event(user_id, day_obj, task_start, task_end, new_task_exclusive, exclude_event_id=None):
    if not task_start:
        return None
    task_start_minutes = _time_to_minutes(task_start)
    task_end_minutes = _time_to_minutes(task_end) if task_end else None
    if task_end_minutes is not None and task_end_minutes < task_start_minutes:
        task_end_minutes = task_start_minutes

    events_query = CalendarEvent.query.filter(
        CalendarEvent.user_id == user_id,
        CalendarEvent.day == day_obj,
        CalendarEvent.is_event.is_(True),
        CalendarEvent.start_time.isnot(None)
    )
    if not new_task_exclusive:
        events_query = events_query.filter(
            db.or_(CalendarEvent.allow_overlap.is_(False), CalendarEvent.allow_overlap.is_(None))
        )
    events = events_query.all()

    for ev in events:
        if exclude_event_id and ev.id == exclude_event_id:
            continue
        ev_start_minutes = _time_to_minutes(ev.start_time)
        ev_end_minutes = _event_end_minutes(ev_start_minutes, ev.end_time)
        if task_end_minutes is None:
            if ev_start_minutes <= task_start_minutes < ev_end_minutes:
                return ev
        else:
            if not (task_end_minutes <= ev_start_minutes or task_start_minutes >= ev_end_minutes):
                return ev
    return None



def _event_conflicts_with_event(user_id, day_obj, event_start, event_end, new_allow_overlap, exclude_event_id=None):
    if not event_start:
        return None
    event_start_minutes = _time_to_minutes(event_start)
    event_end_minutes = _event_end_minutes(event_start_minutes, event_end)

    events = CalendarEvent.query.filter(
        CalendarEvent.user_id == user_id,
        CalendarEvent.day == day_obj,
        CalendarEvent.is_event.is_(True),
        CalendarEvent.start_time.isnot(None)
    ).all()

    for ev in events:
        if exclude_event_id and ev.id == exclude_event_id:
            continue
        ev_start_minutes = _time_to_minutes(ev.start_time)
        ev_end_minutes = _event_end_minutes(ev_start_minutes, ev.end_time)
        overlaps = not (event_end_minutes <= ev_start_minutes or event_start_minutes >= ev_end_minutes)
        if overlaps and ((ev.allow_overlap is False) or (ev.allow_overlap is None) or (new_allow_overlap is False)):
            return ev
    return None



def _event_conflicts_with_task(user_id, day_obj, event_start, event_end, new_event_allow_overlap, exclude_event_id=None):
    if not event_start:
        return None
    event_start_minutes = _time_to_minutes(event_start)
    event_end_minutes = _event_end_minutes(event_start_minutes, event_end)

    tasks = CalendarEvent.query.filter(
        CalendarEvent.user_id == user_id,
        CalendarEvent.day == day_obj,
        CalendarEvent.is_event.is_(False),
        CalendarEvent.is_phase.is_(False),
        CalendarEvent.is_group.is_(False),
        CalendarEvent.start_time.isnot(None)
    ).all()

    for ev in tasks:
        if exclude_event_id and ev.id == exclude_event_id:
            continue
        ev_start_minutes = _time_to_minutes(ev.start_time)
        ev_end_minutes = _event_end_minutes(ev_start_minutes, ev.end_time)
        overlaps = not (event_end_minutes <= ev_start_minutes or event_start_minutes >= ev_end_minutes)
        if overlaps:
            existing_task_exclusive = ev.allow_overlap is True
            new_event_exclusive = not new_event_allow_overlap
            if existing_task_exclusive or new_event_exclusive:
                return ev
    return None



def _task_conflicts_with_task(user_id, day_obj, task_start, task_end, new_task_exclusive, exclude_event_id=None):
    if not task_start:
        return None
    task_start_minutes = _time_to_minutes(task_start)
    task_end_minutes = _time_to_minutes(task_end) if task_end else None
    if task_end_minutes is not None and task_end_minutes < task_start_minutes:
        task_end_minutes = task_start_minutes

    tasks = CalendarEvent.query.filter(
        CalendarEvent.user_id == user_id,
        CalendarEvent.day == day_obj,
        CalendarEvent.is_event.is_(False),
        CalendarEvent.is_phase.is_(False),
        CalendarEvent.is_group.is_(False),
        CalendarEvent.start_time.isnot(None)
    ).all()

    for ev in tasks:
        if exclude_event_id and ev.id == exclude_event_id:
            continue
        ev_start_minutes = _time_to_minutes(ev.start_time)
        ev_end_minutes = _event_end_minutes(ev_start_minutes, ev.end_time)
        if task_end_minutes is None:
            overlaps = ev_start_minutes <= task_start_minutes < ev_end_minutes
        else:
            overlaps = not (task_end_minutes <= ev_start_minutes or task_start_minutes >= ev_end_minutes)
        if overlaps and (new_task_exclusive or (ev.allow_overlap is True)):
            return ev
    return None



def _next_calendar_order(day_value, user_id):
    """Return next order index for a given day/user."""
    current_max = db.session.query(db.func.max(CalendarEvent.order_index)).filter(
        CalendarEvent.user_id == user_id,
        CalendarEvent.day == day_value
    ).scalar()
    return (current_max or 0) + 1



def _weekday_occurrence_in_month(day_value):
    weekday = day_value.weekday()
    month_cal = calendar.monthcalendar(day_value.year, day_value.month)
    count = 0
    for week in month_cal:
        if week[weekday]:
            count += 1
            if week[weekday] == day_value.day:
                return count
    return None



def _nth_weekday_of_month(year, month, weekday, nth):
    if weekday is None or nth is None:
        return None
    month_cal = calendar.monthcalendar(year, month)
    days = [week[weekday] for week in month_cal if week[weekday]]
    if not days:
        return None
    if nth > len(days):
        day = days[-1]
    else:
        day = days[max(nth, 1) - 1]
    return date(year, month, day)



def _recurrence_occurs_on(rule, day_value):
    if day_value < rule.start_day:
        return False
    if rule.end_day and day_value > rule.end_day:
        return False

    freq = (rule.frequency or '').lower()
    interval = max(int(rule.interval or 1), 1)
    unit = (rule.interval_unit or '').lower()
    days_of_week = parse_days_of_week(rule.days_of_week)

    if freq == 'monthly_weekday':
        start_day = rule.start_day
        months_since = (day_value.year - start_day.year) * 12 + (day_value.month - start_day.month)
        if months_since < 0 or months_since % interval != 0:
            return False
        weekday = rule.weekday_of_month
        if weekday is None:
            weekday = start_day.weekday()
        week_of_month = rule.week_of_month
        if week_of_month is None:
            week_of_month = _weekday_occurrence_in_month(start_day)
        target = _nth_weekday_of_month(day_value.year, day_value.month, weekday, week_of_month)
        return bool(target) and day_value == target

    if freq == 'daily':
        unit = 'days'
        interval = 1
    elif freq == 'weekly':
        unit = 'weeks'
        interval = 1
    elif freq == 'biweekly':
        unit = 'weeks'
        interval = 2
    elif freq == 'monthly':
        unit = 'months'
        interval = 1
    elif freq == 'yearly':
        unit = 'years'
        interval = 1
    elif freq != 'custom':
        return False

    start_day = rule.start_day
    if unit == 'days':
        days_since = (day_value - start_day).days
        return days_since >= 0 and days_since % interval == 0
    if unit == 'weeks':
        days_since = (day_value - start_day).days
        if days_since < 0:
            return False
        weeks_since = days_since // 7
        if weeks_since % interval != 0:
            return False
        if days_of_week:
            return day_value.weekday() in days_of_week
        return day_value.weekday() == start_day.weekday()
    if unit == 'months':
        months_since = (day_value.year - start_day.year) * 12 + (day_value.month - start_day.month)
        if months_since < 0 or months_since % interval != 0:
            return False
        target_dom = rule.day_of_month or start_day.day
        _, last_dom = calendar.monthrange(day_value.year, day_value.month)
        if target_dom > last_dom:
            target_dom = last_dom
        return day_value.day == target_dom
    if unit == 'years':
        years_since = day_value.year - start_day.year
        if years_since < 0 or years_since % interval != 0:
            return False
        target_month = rule.month_of_year or start_day.month
        target_dom = rule.day_of_month or start_day.day
        _, last_dom = calendar.monthrange(day_value.year, target_month)
        if target_dom > last_dom:
            target_dom = last_dom
        return day_value.month == target_month and day_value.day == target_dom
    return False



def _ensure_recurring_instances(user_id, start_day, end_day):
    if not start_day or not end_day or start_day > end_day:
        return
    rules = RecurringEvent.query.filter(
        RecurringEvent.user_id == user_id,
        RecurringEvent.start_day <= end_day,
        or_(RecurringEvent.end_day.is_(None), RecurringEvent.end_day >= start_day)
    ).all()
    if not rules:
        return

    exceptions = RecurrenceException.query.filter(
        RecurrenceException.user_id == user_id,
        RecurrenceException.day >= start_day,
        RecurrenceException.day <= end_day
    ).all()
    exception_days = {(ex.recurrence_id, ex.day) for ex in exceptions}

    created_events = []
    for rule in rules:
        existing = CalendarEvent.query.filter(
            CalendarEvent.recurrence_id == rule.id,
            CalendarEvent.day >= start_day,
            CalendarEvent.day <= end_day
        ).all()
        existing_days = {ev.day for ev in existing}
        current = start_day
        while current <= end_day:
            if (rule.id, current) not in exception_days and current not in existing_days:
                if _recurrence_occurs_on(rule, current):
                    new_event = CalendarEvent(
                        user_id=user_id,
                        title=rule.title,
                        description=rule.description,
                        day=current,
                        start_time=rule.start_time,
                        end_time=rule.end_time,
                        status=rule.status or 'not_started',
                        priority=rule.priority or 'medium',
                        is_phase=False,
                        is_event=bool(rule.is_event),
                        is_group=False,
                        order_index=_next_calendar_order(current, user_id),
                        reminder_minutes_before=rule.reminder_minutes_before,
                        rollover_enabled=bool(rule.rollover_enabled),
                        recurrence_id=rule.id
                    )
                    db.session.add(new_event)
                    created_events.append(new_event)
            current += timedelta(days=1)

    if created_events:
        db.session.commit()
        for ev in created_events:
            if ev.reminder_minutes_before is not None and ev.start_time:
                _schedule_reminder_job(ev)
            start_embedding_job(user_id, ENTITY_CALENDAR, ev.id)



def _prune_recurring_instances(rule, user_id):
    instances = CalendarEvent.query.filter_by(user_id=user_id, recurrence_id=rule.id).all()
    to_delete = [ev for ev in instances if not _recurrence_occurs_on(rule, ev.day)]
    if to_delete:
        delete_ids = [ev.id for ev in to_delete]
        for ev in to_delete:
            if ev.reminder_job_id:
                _cancel_reminder_job(ev)
            db.session.delete(ev)
        db.session.commit()
        for ev_id in delete_ids:
            delete_embedding(user_id, ENTITY_CALENDAR, ev_id)

    exceptions = RecurrenceException.query.filter_by(user_id=user_id, recurrence_id=rule.id).all()
    stale_exceptions = [ex for ex in exceptions if not _recurrence_occurs_on(rule, ex.day)]
    if stale_exceptions:
        for ex in stale_exceptions:
            db.session.delete(ex)
        db.session.commit()



def _rollover_incomplete_events():
    """Clone yesterday's incomplete events with rollover enabled into today."""
    with app.app_context():
        # Acquire distributed lock to prevent concurrent execution across workers
        import os
        worker_id = os.getpid()
        lock_name = 'calendar_rollover'

        # Try to acquire lock with a database transaction
        try:
            from models import JobLock
            from sqlalchemy.exc import IntegrityError

            now = _now_local()
            if db.engine.dialect.name == 'sqlite':
                # SQLite doesn't support FOR UPDATE; use insert + fallback update for stale locks.
                try:
                    lock = JobLock(job_name=lock_name, locked_at=now, locked_by=str(worker_id))
                    db.session.add(lock)
                    db.session.commit()
                except IntegrityError:
                    db.session.rollback()
                    lock = db.session.query(JobLock).filter_by(job_name=lock_name).first()
                    if lock and now - lock.locked_at >= timedelta(minutes=5):
                        lock.locked_at = now
                        lock.locked_by = str(worker_id)
                        db.session.commit()
                    else:
                        if lock:
                            app.logger.info(f"Rollover already running (locked by {lock.locked_by}), skipping")
                        else:
                            app.logger.info("Rollover lock acquisition failed (missing lock), skipping")
                        return
            else:
                # Use SELECT FOR UPDATE to ensure only one worker acquires the lock
                lock = db.session.query(JobLock).filter_by(job_name=lock_name).with_for_update(nowait=True).first()
                if lock:
                    if now - lock.locked_at < timedelta(minutes=5):
                        app.logger.info(f"Rollover already running (locked by {lock.locked_by}), skipping")
                        db.session.rollback()
                        return
                    lock.locked_at = now
                    lock.locked_by = str(worker_id)
                else:
                    lock = JobLock(job_name=lock_name, locked_at=now, locked_by=str(worker_id))
                    db.session.add(lock)

                db.session.commit()
        except Exception as e:
            # Lock acquisition failed (another worker has it)
            db.session.rollback()
            app.logger.info(f"Rollover lock acquisition failed (worker {worker_id}), skipping: {e}")
            return

        try:
            today = date.today()
            yesterday = today - timedelta(days=1)

            # Build a map of phases that need to be recreated
            phases_yesterday = CalendarEvent.query.filter(
                CalendarEvent.day == yesterday,
                CalendarEvent.is_phase.is_(True)
            ).all()

            # For each user, roll their events independently
            user_ids = [u.id for u in User.query.all()]
            for uid in user_ids:
                created_events = 0
                created_phases = 0
                created_calendar_events = []
                created_calendar_phases = []

                # Track already created rollovers so reruns stay idempotent
                existing_rollovers = CalendarEvent.query.filter(
                    CalendarEvent.user_id == uid,
                    CalendarEvent.day == today,
                    CalendarEvent.rolled_from_id.isnot(None)
                ).all()
                rolled_lookup = {}
                duplicates_to_delete = []
                for ev in existing_rollovers:
                    key = ev.rolled_from_id
                    if key in rolled_lookup:
                        keep = rolled_lookup[key]
                        # Keep the earliest created rollover, delete extras
                        if ev.id < keep.id:
                            duplicates_to_delete.append(keep)
                            rolled_lookup[key] = ev
                        else:
                            duplicates_to_delete.append(ev)
                    else:
                        rolled_lookup[key] = ev

                phase_map = {}
                # Collect phases by title to recreate only if needed
                for ph in phases_yesterday:
                    if ph.user_id == uid:
                        existing_phase_copy = rolled_lookup.get(ph.id)
                        phase_map[ph.id] = existing_phase_copy.id if existing_phase_copy and existing_phase_copy.is_phase else None

                events = CalendarEvent.query.filter(
                    CalendarEvent.user_id == uid,
                    CalendarEvent.day == yesterday,
                    CalendarEvent.status != 'done',
                    CalendarEvent.rollover_enabled.is_(True),
                    CalendarEvent.is_phase.is_(False)
                ).order_by(CalendarEvent.order_index.asc()).all()

                if not events:
                    continue

                events_to_delete = {}
                for ev in events:
                    # Skip if this event has already been rolled over today
                    if ev.id in rolled_lookup:
                        events_to_delete[ev.id] = ev
                        continue

                    new_phase_id = None
                    if ev.phase_id:
                        if ev.phase_id not in phase_map or phase_map[ev.phase_id] is None:
                            orig_phase = next((p for p in phases_yesterday if p.id == ev.phase_id and p.user_id == uid), None)
                            if orig_phase:
                                copy_phase = CalendarEvent(
                                    user_id=uid,
                                    title=orig_phase.title,
                                    description=orig_phase.description,
                                    day=today,
                                    is_phase=True,
                                    status='not_started',
                                    priority=orig_phase.priority,
                                    item_note=orig_phase.item_note,
                                    order_index=_next_calendar_order(today, uid),
                                    reminder_minutes_before=None,
                                    rollover_enabled=orig_phase.rollover_enabled,
                                    rolled_from_id=orig_phase.id
                                )
                                db.session.add(copy_phase)
                                db.session.flush()
                                created_calendar_phases.append(copy_phase)
                                phase_map[orig_phase.id] = copy_phase.id
                                created_phases += 1
                        new_phase_id = phase_map.get(ev.phase_id)

                    recurrence_id = ev.recurrence_id
                    if recurrence_id:
                        db.session.add(RecurrenceException(
                            user_id=uid,
                            recurrence_id=recurrence_id,
                            day=today
                        ))

                    copy_event = CalendarEvent(
                        user_id=uid,
                        title=ev.title,
                        description=ev.description,
                        day=today,
                        start_time=ev.start_time,
                        end_time=ev.end_time,
                        status='not_started',
                        priority=ev.priority,
                        is_phase=False,
                        is_event=ev.is_event,
                        allow_overlap=ev.allow_overlap,
                        display_mode=getattr(ev, 'display_mode', None) or 'both',
                        is_group=ev.is_group,
                        phase_id=new_phase_id,
                        order_index=_next_calendar_order(today, uid),
                        reminder_minutes_before=ev.reminder_minutes_before,
                        rollover_enabled=ev.rollover_enabled,
                        rolled_from_id=ev.id,
                        todo_item_id=ev.todo_item_id,
                        recurrence_id=None,
                        item_note=ev.item_note
                    )
                    db.session.add(copy_event)
                    created_calendar_events.append(copy_event)
                    created_events += 1
                    events_to_delete[ev.id] = ev
                    if ev.todo_item_id:
                        linked_item = TodoItem.query.filter_by(id=ev.todo_item_id).first()
                        if linked_item:
                            linked_item.due_date = today

                for dup in duplicates_to_delete:
                    db.session.delete(dup)
                for ev in events_to_delete.values():
                    db.session.delete(ev)

                db.session.commit()
                if created_events or duplicates_to_delete or events_to_delete:
                    app.logger.info(
                        f"Rollover user {uid}: created {created_events} events, "
                        f"created {created_phases} phases, removed {len(duplicates_to_delete)} duplicates"
                    )
                for created in created_calendar_phases + created_calendar_events:
                    start_embedding_job(uid, ENTITY_CALENDAR, created.id)
        finally:
            # Release the lock
            try:
                lock_to_release = db.session.query(JobLock).filter_by(job_name=lock_name).first()
                if lock_to_release and lock_to_release.locked_by == str(worker_id):
                    db.session.delete(lock_to_release)
                    db.session.commit()
            except Exception as e:
                app.logger.error(f"Error releasing rollover lock: {e}")
                db.session.rollback()



def _cleanup_completed_tasks():
    """Delete done tasks that have been completed for 5+ days."""
    with app.app_context():
        try:
            cutoff = datetime.now(pytz.UTC).replace(tzinfo=None) - timedelta(days=5)
            items = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
                TodoItem.status == 'done',
                TodoItem.completed_at.isnot(None),
                TodoItem.completed_at <= cutoff,
                TodoItem.is_phase.is_(False),
                TodoItem.linked_list_id.is_(None)
            ).all()
            if not items:
                return
            for item in items:
                db.session.delete(item)
            db.session.commit()
            app.logger.info(f"Auto-deleted {len(items)} completed tasks older than 5 days")
        except Exception as e:
            app.logger.error(f"Error cleaning completed tasks: {e}")
            db.session.rollback()



def _send_email(to_addr, subject, body, html_body=None):
    """Lightweight SMTP sender using environment variables."""
    host = os.environ.get('SMTP_HOST')
    port = int(os.environ.get('SMTP_PORT', 587))
    user = os.environ.get('SMTP_USER')
    password = os.environ.get('SMTP_PASSWORD')
    from_addr = os.environ.get('SMTP_FROM') or user
    if not host or not from_addr:
        app.logger.warning("SMTP host/from missing; email not sent")
        return False
    import smtplib
    from email.mime.text import MIMEText

    if html_body:
        msg = MIMEText(html_body, 'html')
    else:
        msg = MIMEText(body, 'plain')
    msg['Subject'] = subject
    msg['From'] = from_addr
    msg['To'] = to_addr

    try:
        with smtplib.SMTP(host, port) as server:
            server.starttls()
            if user and password:
                server.login(user, password)
            server.sendmail(from_addr, [to_addr], msg.as_string())
        return True
    except Exception as e:
        app.logger.error(f"SMTP send failed: {e}")
        return False



def _build_daily_digest_body(events_for_day, tasks_for_day):
    lines = []
    if events_for_day:
        lines.append("Events:")
        for ev in events_for_day:
            prefix = '[x]' if ev.status == 'done' else '[ ]'
            time_block = ''
            if ev.start_time:
                end_str = ev.end_time.isoformat() if ev.end_time else ''
                time_block = f" @ {ev.start_time.isoformat()}{('-' + end_str) if end_str else ''}"
            priority = ev.priority or 'medium'
            lines.append(f"{prefix} {ev.title} ({priority}){time_block}")
    if tasks_for_day:
        if lines:
            lines.append("")
        lines.append("Tasks:")
        for item in tasks_for_day:
            prefix = '[x]' if item.get('status') == 'done' else '[ ]'
            time_block = ''
            if item.get('start_time'):
                end_str = item.get('end_time').isoformat() if item.get('end_time') else ''
                time_block = f" @ {item['start_time'].isoformat()}{('-' + end_str) if end_str else ''}"
            priority = item.get('priority') or 'medium'
            lines.append(f"{prefix} {item['title']} ({priority}){time_block}")
    return '\n'.join(lines)


def _build_daily_digest_html(events_for_day, tasks_for_day, day_value):
    def _priority_style(priority_value):
        val = (priority_value or 'medium').lower()
        if val == 'high':
            return "#f04438"
        if val == 'low':
            return "#12b76a"
        return "#f79009"

    def _event_row(ev):
        start_str = ev.start_time.strftime('%I:%M %p') if ev.start_time else 'No time'
        end_str = ev.end_time.strftime('%I:%M %p') if ev.end_time else ''
        time_block = f"{start_str}{(' - ' + end_str) if end_str else ''}"
        bubble_color = _priority_style(ev.priority)
        return f"""
        <div style="display:flex;background:#f7f8fb;border-radius:12px;margin-bottom:12px;">
          <div style="width:6px;background:{bubble_color};border-radius:12px 0 0 12px;"></div>
          <div style="padding:14px 16px;">
            <div style="font-size:13px;color:#6b6f76;margin-bottom:6px;">{time_block}</div>
            <div style="font-size:16px;font-weight:700;color:#121926;">{ev.title}</div>
          </div>
        </div>
        """

    def _task_row(item):
        start_time = item.get('start_time')
        end_time = item.get('end_time')
        start_str = start_time.strftime('%I:%M %p') if start_time else 'No time'
        end_str = end_time.strftime('%I:%M %p') if end_time else ''
        time_block = f"{start_str}{(' - ' + end_str) if end_str else ''}"
        bubble_color = _priority_style(item.get('priority'))
        return f"""
        <div style="display:flex;background:#f7f8fb;border-radius:12px;margin-bottom:12px;">
          <div style="width:6px;background:{bubble_color};border-radius:12px 0 0 12px;"></div>
          <div style="padding:14px 16px;">
            <div style="font-size:13px;color:#6b6f76;margin-bottom:6px;">{time_block}</div>
            <div style="font-size:16px;font-weight:700;color:#121926;">{item['title']}</div>
          </div>
        </div>
        """

    events_html = ''.join([_event_row(ev) for ev in events_for_day]) or """
        <div style="padding:8px 0;color:#666;">No events today.</div>
    """
    tasks_html = ''.join([_task_row(item) for item in tasks_for_day]) or """
        <div style="padding:8px 0;color:#666;">No tasks today.</div>
    """

    day_label = day_value.strftime('%A, %B %d, %Y') if hasattr(day_value, 'strftime') else str(day_value)
    return f"""
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial, Helvetica, sans-serif;color:#121926;">
    <div style="max-width:640px;margin:0 auto;padding:20px;">
      <div style="font-size:26px;font-weight:800;margin-bottom:6px;">Today's Schedule</div>
      <div style="font-size:16px;color:#4c6fff;margin-bottom:18px;">{day_label}</div>

      <div style="font-size:15px;font-weight:700;margin-bottom:10px;color:#121926;">Events</div>
      <div>
        {events_html}
      </div>

      <div style="font-size:15px;font-weight:700;margin:16px 0 10px;color:#121926;">Tasks</div>
      <div>
        {tasks_html}
      </div>

      <div style="text-align:left;color:#98a2b3;font-size:11px;margin-top:12px;">Automated daily report</div>
    </div>
  </body>
</html>
"""



def _send_daily_email_digest(target_day=None):
    """Send daily digest emails to users who have an email set."""
    if os.environ.get('ENABLE_CALENDAR_EMAIL_DIGEST', '1') != '1':
        return {'disabled': True}
    with app.app_context():
        # Acquire distributed lock to avoid duplicate sends across workers.
        import os
        worker_id = os.getpid()
        lock_name = 'daily_email_digest'
        lock_acquired = False
        lock_row = None
        try:
            from models import JobLock
            from sqlalchemy.exc import IntegrityError

            now = _now_local()
            if db.engine.dialect.name == 'sqlite':
                try:
                    lock_row = JobLock(job_name=lock_name, locked_at=now, locked_by=str(worker_id))
                    db.session.add(lock_row)
                    db.session.commit()
                    lock_acquired = True
                except IntegrityError:
                    db.session.rollback()
                    lock_row = db.session.query(JobLock).filter_by(job_name=lock_name).first()
                    if lock_row and now - lock_row.locked_at >= timedelta(minutes=5):
                        lock_row.locked_at = now
                        lock_row.locked_by = str(worker_id)
                        db.session.commit()
                        lock_acquired = True
                    else:
                        if lock_row:
                            app.logger.info(f"Digest already running (locked by {lock_row.locked_by}), skipping")
                        else:
                            app.logger.info("Digest lock acquisition failed (missing lock), skipping")
                        return {'skipped_lock': True}
            else:
                lock_row = db.session.query(JobLock).filter_by(job_name=lock_name).with_for_update(nowait=True).first()
                if lock_row:
                    if now - lock_row.locked_at < timedelta(minutes=5):
                        app.logger.info(f"Digest already running (locked by {lock_row.locked_by}), skipping")
                        db.session.rollback()
                        return {'skipped_lock': True}
                    lock_row.locked_at = now
                    lock_row.locked_by = str(worker_id)
                else:
                    lock_row = JobLock(job_name=lock_name, locked_at=now, locked_by=str(worker_id))
                    db.session.add(lock_row)
                db.session.commit()
                lock_acquired = True
        except Exception as e:
            db.session.rollback()
            app.logger.info(f"Digest lock acquisition failed (worker {worker_id}), skipping: {e}")
            return {'skipped_lock': True}

        try:
            tz = pytz.timezone(app.config.get('DEFAULT_TIMEZONE', 'UTC'))
            now_local = datetime.now(tz)
            is_manual = target_day is not None
            if target_day is None:
                target_day = now_local.date()
            users = User.query.all()
            fallback_email = os.environ.get('CONTACT_TO_EMAIL')
            stats = {
                'day': target_day.isoformat(),
                'users_total': len(users),
                'eligible': 0,
                'sent': 0,
                'skipped_prefs': 0,
                'skipped_hour': 0,
                'skipped_no_items': 0,
                'skipped_no_recipient': 0,
                'errors': 0,
                'manual': is_manual,
            }
            for user_obj in users:
                prefs = _get_or_create_notification_settings(user_obj.id)
                if not prefs.email_enabled or not prefs.digest_enabled:
                    stats['skipped_prefs'] += 1
                    continue
                if not is_manual and prefs.digest_hour != now_local.hour:
                    stats['skipped_hour'] += 1
                    continue
                events = CalendarEvent.query.filter(
                    CalendarEvent.user_id == user_obj.id,
                    CalendarEvent.day == target_day,
                    CalendarEvent.is_group.is_(False),
                    CalendarEvent.is_phase.is_(False),
                    CalendarEvent.is_event.is_(True)
                ).order_by(
                    CalendarEvent.start_time.is_(None),
                    CalendarEvent.start_time.asc()
                ).all()
                calendar_tasks = CalendarEvent.query.filter(
                    CalendarEvent.user_id == user_obj.id,
                    CalendarEvent.day == target_day,
                    CalendarEvent.is_group.is_(False),
                    CalendarEvent.is_phase.is_(False),
                    CalendarEvent.is_event.is_(False)
                ).order_by(
                    CalendarEvent.start_time.is_(None),
                    CalendarEvent.start_time.asc()
                ).all()
                todo_tasks = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
                    TodoList.user_id == user_obj.id,
                    TodoItem.due_date == target_day,
                    TodoItem.is_phase.is_(False)
                ).order_by(TodoItem.order_index.asc()).all()

                tasks_for_day = []
                for task in calendar_tasks:
                    tasks_for_day.append({
                        'title': task.title,
                        'start_time': task.start_time,
                        'end_time': task.end_time,
                        'priority': task.priority,
                        'status': task.status,
                    })
                for task in todo_tasks:
                    tasks_for_day.append({
                        'title': task.content,
                        'start_time': None,
                        'end_time': None,
                        'priority': None,
                        'status': task.status,
                    })
                tasks_for_day.sort(
                    key=lambda item: (
                        item.get('start_time') is None,
                        item.get('start_time') or time.min,
                        item.get('title', '').lower()
                    )
                )

                if not events and not tasks_for_day:
                    stats['skipped_no_items'] += 1
                    continue
                body = _build_daily_digest_body(events, tasks_for_day)
                html_body = _build_daily_digest_html(events, tasks_for_day, target_day)
                try:
                    recipient = fallback_email
                    if recipient:
                        stats['eligible'] += 1
                        app.logger.info(
                            "Digest email recipient=%s user_id=%s day=%s",
                            recipient,
                            user_obj.id,
                            target_day.isoformat()
                        )
                        if _send_email(recipient, f"Your tasks for {target_day.isoformat()}", body, html_body=html_body):
                            stats['sent'] += 1
                        else:
                            stats['errors'] += 1
                    else:
                        stats['skipped_no_recipient'] += 1
                except Exception as e:
                    stats['errors'] += 1
                    app.logger.error(f"Error sending digest for user {user_obj.id}: {e}")
                    continue
            app.logger.info(
                "Digest stats day=%s manual=%s users=%s eligible=%s sent=%s skipped_prefs=%s skipped_hour=%s skipped_no_items=%s skipped_no_recipient=%s errors=%s",
                stats['day'],
                stats['manual'],
                stats['users_total'],
                stats['eligible'],
                stats['sent'],
                stats['skipped_prefs'],
                stats['skipped_hour'],
                stats['skipped_no_items'],
                stats['skipped_no_recipient'],
                stats['errors']
            )
            return stats
        finally:
            if lock_acquired and lock_row:
                try:
                    lock_to_release = db.session.query(JobLock).filter_by(job_name=lock_name).first()
                    if lock_to_release and lock_to_release.locked_by == str(worker_id):
                        db.session.delete(lock_to_release)
                        db.session.commit()
                        app.logger.info(f"Digest lock released (worker {worker_id})")
                except Exception as e:
                    db.session.rollback()
                    app.logger.error(f"Error releasing digest lock: {e}")



def _schedule_reminder_job(event):
    """Schedule a one-time reminder job for a calendar event."""
    global scheduler
    if not scheduler or not event.start_time or event.reminder_minutes_before is None:
        return

    # Cancel existing job if present
    if event.reminder_job_id:
        try:
            scheduler.remove_job(event.reminder_job_id)
        except Exception:
            pass

    # Calculate reminder time
    try:
        event_datetime = datetime.combine(event.day, event.start_time)
        event_datetime = pytz.timezone(app.config['DEFAULT_TIMEZONE']).localize(event_datetime)
        reminder_time = event_datetime - timedelta(minutes=event.reminder_minutes_before)

        # Only schedule if reminder is in the future
        now = datetime.now(pytz.timezone(app.config['DEFAULT_TIMEZONE']))
        if reminder_time > now:
            job_id = f"reminder_{event.id}_{int(reminder_time.timestamp())}"
            scheduler.add_job(
                _send_event_reminder,
                'date',
                run_date=reminder_time,
                args=[event.id],
                id=job_id,
                replace_existing=True
            )
            event.reminder_job_id = job_id
            event.reminder_sent = False
            event.reminder_snoozed_until = None
            db.session.commit()
    except Exception as e:
        app.logger.error(f"Error scheduling reminder for event {event.id}: {e}")



def _cancel_reminder_job(event):
    """Cancel a scheduled reminder job for a calendar event."""
    global scheduler
    if not scheduler or not event.reminder_job_id:
        return

    try:
        scheduler.remove_job(event.reminder_job_id)
        app.logger.info(f"Cancelled reminder job {event.reminder_job_id} for event {event.id}")
    except Exception as e:
        app.logger.debug(f"Could not cancel job {event.reminder_job_id}: {e}")

    event.reminder_job_id = None
    db.session.commit()



def _send_event_reminder(event_id):
    """Send a reminder notification for a specific calendar event."""
    with app.app_context():
        try:
            event = db.session.get(CalendarEvent, event_id)
            if not event:
                return

            # Check if already sent or snoozed
            if event.reminder_sent:
                return

            # Check if snoozed
            if event.reminder_snoozed_until:
                tz = pytz.timezone(app.config['DEFAULT_TIMEZONE'])
                now = datetime.now(tz).replace(tzinfo=None)
                if now < event.reminder_snoozed_until:
                    # Still snoozed, reschedule for snooze time
                    global scheduler
                    if scheduler:
                        job_id = f"reminder_{event.id}_{int(event.reminder_snoozed_until.timestamp())}"
                        scheduler.add_job(
                            _send_event_reminder,
                            'date',
                            run_date=pytz.timezone(app.config['DEFAULT_TIMEZONE']).localize(event.reminder_snoozed_until),
                            args=[event_id],
                            id=job_id,
                            replace_existing=True
                        )
                        event.reminder_job_id = job_id
                        db.session.commit()
                    return

            # Get user
            user = db.session.get(User, event.user_id)
            if not user:
                return

            # Check user preferences
            prefs = _get_or_create_notification_settings(user.id)
            if not prefs.push_enabled or not prefs.reminders_enabled:
                return

            # Send push notification with action buttons
            title = f"Reminder: {event.title}"
            body = f"Starting at {event.start_time.strftime('%I:%M %p')}" if event.start_time else ""
            day_str = event.day.isoformat()
            link = f'/calendar?day={day_str}'

            actions = [
                {'action': 'snooze', 'title': 'Snooze'},
                {'action': 'dismiss', 'title': 'Dismiss'}
            ]

            _send_push_to_user(user, title, body, link=link, event_id=event.id, actions=actions)

            # Mark as sent
            event.reminder_sent = True
            event.reminder_job_id = None
            db.session.commit()

        except Exception as e:
            app.logger.error(f"Error sending reminder for event {event_id}: {e}")



def _check_calendar_reminders():
    """Legacy minute-polling function - now replaced by server-scheduled jobs."""
    # This function is kept for backward compatibility but is no longer used
    # when server-scheduled reminders are enabled
    with app.app_context():
        try:
            now = datetime.now(pytz.UTC).replace(tzinfo=None)
            # Check for events in the next 5 minutes
            upcoming_window = now + timedelta(minutes=5)

            # Get all users
            users = User.query.all()

            for user in users:
                # Get user's notification preferences
                prefs = _get_or_create_notification_settings(user.id)
                if not prefs.push_enabled or not prefs.reminders_enabled:
                    continue

                # Get user's calendar events for today and tomorrow
                today = datetime.now(pytz.timezone(app.config['DEFAULT_TIMEZONE'])).date()
                tomorrow = today + timedelta(days=1)

                for day in [today, tomorrow]:
                    day_str = day.strftime('%Y-%m-%d')
                    events = CalendarEvent.query.filter_by(user_id=user.id, day=day_str, status='pending').all()

                    for event in events:
                        if not event.start_time or event.reminder_minutes_before is None:
                            continue

                        # Parse event time
                        try:
                            event_datetime = datetime.strptime(f"{day_str} {event.start_time}", '%Y-%m-%d %H:%M')
                            event_datetime = pytz.timezone(app.config['DEFAULT_TIMEZONE']).localize(event_datetime)
                            event_utc = event_datetime.astimezone(pytz.UTC).replace(tzinfo=None)

                            # Calculate reminder time
                            reminder_time = event_utc - timedelta(minutes=event.reminder_minutes_before)

                            # Check if reminder should fire now (within next 5 minutes and hasn't been sent)
                            if now <= reminder_time <= upcoming_window:
                                # Check if we already sent this reminder
                                existing_notif = Notification.query.filter_by(
                                    user_id=user.id,
                                    type='reminder',
                                    link=f'/calendar?day={day_str}'
                                ).filter(
                                    Notification.created_at >= now - timedelta(minutes=event.reminder_minutes_before + 1)
                                ).first()

                                if not existing_notif:
                                    # Send push notification
                                    title = f"Reminder: {event.title}"
                                    body = f"Starting at {event.start_time}"
                                    _send_push_to_user(user, title, body, link=f'/calendar?day={day_str}')

                                    # Create in-app notification
                                    notif = Notification(
                                        user_id=user.id,
                                        type='reminder',
                                        title=title,
                                        body=body,
                                        link=f'/calendar?day={day_str}',
                                        channel='push'
                                    )
                                    db.session.add(notif)
                                    db.session.commit()

                        except Exception as e:
                            app.logger.error(f"Error processing reminder for event {event.id}: {e}")
                            continue

        except Exception as e:
            app.logger.error(f"Error in _check_calendar_reminders: {e}")



def _schedule_existing_reminders():
    """Schedule reminder jobs for all existing events with reminders on startup."""
    with app.app_context():
        try:
            now = datetime.now(pytz.timezone(app.config['DEFAULT_TIMEZONE']))
            # Get events with reminders that haven't been sent yet
            events = CalendarEvent.query.filter(
                CalendarEvent.reminder_minutes_before.isnot(None),
                CalendarEvent.start_time.isnot(None),
                CalendarEvent.reminder_sent.is_(False),
                CalendarEvent.status != 'done',
                CalendarEvent.status != 'canceled',
                CalendarEvent.day >= now.date()
            ).all()

            scheduled_count = 0
            for event in events:
                try:
                    _schedule_reminder_job(event)
                    scheduled_count += 1
                except Exception as e:
                    app.logger.error(f"Error scheduling reminder for event {event.id}: {e}")

        except Exception as e:
            app.logger.error(f"Error in _schedule_existing_reminders: {e}")


_jobs_bootstrapped = False



def _start_scheduler():
    """Start background scheduler for rollover and optional digest."""
    global scheduler
    if os.environ.get('ENABLE_CALENDAR_JOBS', '1') != '1':
        return
    if scheduler and scheduler.running:
        return
    # Avoid double-start in Flask debug reloader
    if app.debug and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
        return
    scheduler = BackgroundScheduler(timezone=app.config.get('DEFAULT_TIMEZONE', 'UTC'))
    scheduler.add_job(_rollover_incomplete_events, 'cron', hour=0, minute=10)
    scheduler.add_job(
        _cleanup_completed_tasks,
        'cron',
        hour=0,
        minute=20,
        id='cleanup_completed_tasks',
        replace_existing=True
    )
    # Daily digest runs hourly; per-user digest_hour gates delivery.
    scheduler.add_job(
        _send_daily_email_digest,
        'cron',
        hour='*',
        minute=0,
        id='daily_email_digest',
        replace_existing=True
    )
    # Note: Calendar reminders now use server-scheduled jobs (scheduled per-event)
    # Legacy minute-polling has been replaced with precise scheduling
    scheduler.start()

    # Catch up rollover if the server started after the scheduled time
    try:
        _rollover_incomplete_events()
    except Exception as e:
        app.logger.error(f"Error running rollover catch-up: {e}")
    try:
        _cleanup_completed_tasks()
    except Exception as e:
        app.logger.error(f"Error running completed task cleanup: {e}")

    # Schedule existing reminders on startup
    _schedule_existing_reminders()


def _bootstrap_background_jobs():
    global _jobs_bootstrapped
    if _jobs_bootstrapped and scheduler and scheduler.running:
        return
    _start_scheduler()
    _jobs_bootstrapped = True


# Start scheduler on process startup (not request-dependent).
# Can be disabled for tooling/scripts that only need app context.
if os.environ.get('BOOTSTRAP_JOBS_ON_IMPORT', '1') == '1':
    try:
        _start_scheduler()
        _jobs_bootstrapped = bool(scheduler and scheduler.running)
    except Exception as e:
        app.logger.error(f"Error starting scheduler on startup: {e}")

# User Selection Routes

def _reindex_note_list_items(note_id):
    items = NoteListItem.query.filter_by(note_id=note_id).order_by(
        NoteListItem.order_index.asc(),
        NoteListItem.id.asc()
    ).all()
    for idx, item in enumerate(items, start=1):
        item.order_index = idx



def _get_or_create_notification_settings(user_id):
    prefs = NotificationSetting.query.filter_by(user_id=user_id).first()
    if not prefs:
        prefs = NotificationSetting(user_id=user_id)
        db.session.add(prefs)
        db.session.commit()
    return prefs



def _send_push_to_user(user, title, body=None, link=None, event_id=None, actions=None):
    public_key = app.config.get('VAPID_PUBLIC_KEY')
    private_key = app.config.get('VAPID_PRIVATE_KEY')
    if not public_key or not private_key:
        return 0
    subs = PushSubscription.query.filter_by(user_id=user.id).all()
    if not subs:
        return 0
    app.logger.info("Sending push to %s subs for user %s", len(subs), user.id)

    payload_data = {
        'title': title,
        'body': body or '',
        'data': {'url': link or '/'}
    }
    if event_id:
        payload_data['data']['event_id'] = event_id
    if actions:
        payload_data['actions'] = actions

    payload = json.dumps(payload_data)
    sent = 0
    # Use high urgency for reminders to ensure delivery on mobile even when screen is off
    headers = {'Urgency': 'high', 'Topic': 'reminder'} if event_id else {}
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    'endpoint': sub.endpoint,
                    'keys': {'p256dh': sub.p256dh, 'auth': sub.auth}
                },
                data=payload,
                vapid_private_key=private_key,
                vapid_claims={"sub": "mailto:{}".format(os.environ.get('VAPID_SUBJECT', 'admin@example.com'))},
                headers=headers
            )
            sent += 1
        except WebPushException as exc:
            # Clean up invalid subscriptions
            if exc.response and exc.response.status_code in (404, 410):
                app.logger.warning("Deleting invalid push subscription %s due to %s", sub.endpoint, exc.response.status_code)
                db.session.delete(sub)
                db.session.commit()
            continue
        except Exception:
            app.logger.exception("Push send error")
            continue
    return sent


