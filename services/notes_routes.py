"""Extracted heavy route handlers from app.py."""

def handle_notes():
    import app as a
    CalendarEvent = a.CalendarEvent
    Note = a.Note
    NoteFolder = a.NoteFolder
    NoteLink = a.NoteLink
    NoteListItem = a.NoteListItem
    PlannerMultiItem = a.PlannerMultiItem
    PlannerMultiLine = a.PlannerMultiLine
    TodoItem = a.TodoItem
    TodoList = a.TodoList
    build_list_preview_text = a.build_list_preview_text
    db = a.db
    get_current_user = a.get_current_user
    is_note_linked = a.is_note_linked
    jsonify = a.jsonify
    normalize_note_type = a.normalize_note_type
    or_ = a.or_
    parse_bool = a.parse_bool
    request = a.request
    """List or create notes/lists for the current user."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    folder_id = request.args.get('folder_id')
    folder_id_int = int(folder_id) if folder_id and str(folder_id).isdigit() else None
    include_all = parse_bool(request.args.get('all'))
    include_hidden = parse_bool(request.args.get('include_hidden'))
    archived_only = parse_bool(request.args.get('archived'))
    planner_multi_item_id = request.args.get('planner_multi_item_id')
    planner_multi_line_id = request.args.get('planner_multi_line_id')
    planner_multi_item_id = int(planner_multi_item_id) if planner_multi_item_id and str(planner_multi_item_id).isdigit() else None
    planner_multi_line_id = int(planner_multi_line_id) if planner_multi_line_id and str(planner_multi_line_id).isdigit() else None
    planner_filter = bool(planner_multi_item_id or planner_multi_line_id)
    if planner_filter and request.args.get('include_hidden') is None:
        include_hidden = True

    if request.method == 'POST':
        data = request.json or {}
        raw_title = (data.get('title') or '').strip()
        content = data.get('content') or ''
        note_type = normalize_note_type(data.get('note_type') or data.get('type'))
        title = raw_title or ('Untitled List' if note_type == 'list' else 'Untitled Note')
        checkbox_mode = parse_bool(data.get('checkbox_mode'))
        has_is_listed = 'is_listed' in data
        planner_item_id = data.get('planner_multi_item_id')
        planner_line_id = data.get('planner_multi_line_id')
        planner_item_id = int(planner_item_id) if planner_item_id and str(planner_item_id).isdigit() else None
        planner_line_id = int(planner_line_id) if planner_line_id and str(planner_line_id).isdigit() else None
        if planner_item_id and planner_line_id:
            return jsonify({'error': 'Provide either planner_multi_item_id or planner_multi_line_id, not both'}), 400
        is_listed = parse_bool(data.get('is_listed'), True)
        if not has_is_listed and (planner_item_id or planner_line_id):
            is_listed = False
        todo_item_id = data.get('todo_item_id')
        calendar_event_id = data.get('calendar_event_id')
        folder_id_value = data.get('folder_id')
        folder_id_value = int(folder_id_value) if folder_id_value and str(folder_id_value).isdigit() else None
        if folder_id_value is not None:
            NoteFolder.query.filter_by(id=folder_id_value, user_id=user.id).first_or_404()
        if todo_item_id and calendar_event_id:
            return jsonify({'error': 'Provide either todo_item_id or calendar_event_id, not both'}), 400
        linked_item = None
        linked_event = None
        if todo_item_id:
            try:
                todo_item_id_int = int(todo_item_id)
            except (TypeError, ValueError):
                return jsonify({'error': 'Invalid todo_item_id'}), 400
            linked_item = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
                TodoItem.id == todo_item_id_int,
                TodoList.user_id == user.id
            ).first()
            if not linked_item:
                return jsonify({'error': 'Task not found for this user'}), 404

        if calendar_event_id:
            try:
                calendar_event_id_int = int(calendar_event_id)
            except (TypeError, ValueError):
                return jsonify({'error': 'Invalid calendar_event_id'}), 400
            linked_event = CalendarEvent.query.filter_by(id=calendar_event_id_int, user_id=user.id).first()
            if not linked_event:
                return jsonify({'error': 'Calendar event not found for this user'}), 404

        if planner_item_id:
            planner_item = PlannerMultiItem.query.filter_by(id=planner_item_id, user_id=user.id).first()
            if not planner_item:
                return jsonify({'error': 'Planner group item not found'}), 404
        if planner_line_id:
            planner_line = PlannerMultiLine.query.filter_by(id=planner_line_id, user_id=user.id).first()
            if not planner_line:
                return jsonify({'error': 'Planner line not found'}), 404

        note = Note(
            title=title,
            content=content if note_type == 'note' else '',
            user_id=user.id,
            todo_item_id=linked_item.id if linked_item else None,
            calendar_event_id=linked_event.id if linked_event else None,
            planner_multi_item_id=planner_item_id,
            planner_multi_line_id=planner_line_id,
            folder_id=folder_id_value,
            note_type=note_type,
            checkbox_mode=checkbox_mode if note_type == 'list' else False,
            is_listed=is_listed
        )
        db.session.add(note)
        db.session.commit()
        return jsonify(note.to_dict()), 201

    notes_query = Note.query.filter_by(user_id=user.id)
    if archived_only:
        notes_query = notes_query.filter(Note.archived_at.isnot(None))
    else:
        notes_query = notes_query.filter(Note.archived_at.is_(None))
    if not include_all and not planner_filter:
        if folder_id_int is None:
            notes_query = notes_query.filter(Note.folder_id.is_(None))
        else:
            notes_query = notes_query.filter_by(folder_id=folder_id_int)
    if planner_multi_item_id:
        notes_query = notes_query.filter(Note.planner_multi_item_id == planner_multi_item_id)
    if planner_multi_line_id:
        notes_query = notes_query.filter(Note.planner_multi_line_id == planner_multi_line_id)
    if not include_hidden:
        notes_query = notes_query.filter(Note.is_listed.is_(True))
    notes = notes_query.order_by(
        Note.pinned.desc(),
        Note.pin_order.asc(),
        Note.updated_at.desc()
    ).all()
    linked_targets = set()
    linked_sources = set()
    if notes:
        note_ids = [n.id for n in notes]
        links = NoteLink.query.filter(
            or_(NoteLink.target_note_id.in_(note_ids), NoteLink.source_note_id.in_(note_ids))
        ).all()
        linked_targets = {link.target_note_id for link in links}
        linked_sources = {link.source_note_id for link in links}
    note_payload = []
    for n in notes:
        note_dict = n.to_dict()
        note_dict['is_linked_note'] = is_note_linked(n, linked_targets, linked_sources)
        # Hide content from protected notes (always locked in list view)
        if n.is_pin_protected:
            note_dict['content'] = ''
            note_dict['locked'] = True
        note_payload.append(note_dict)
    list_ids = [n.id for n in notes if n.note_type == 'list' and not n.is_pin_protected]
    if list_ids:
        items = NoteListItem.query.filter(NoteListItem.note_id.in_(list_ids)).order_by(
            NoteListItem.note_id.asc(),
            NoteListItem.order_index.asc(),
            NoteListItem.id.asc()
        ).all()
        preview_map = {lid: [] for lid in list_ids}
        for item in items:
            previews = preview_map.get(item.note_id)
            if previews is None or len(previews) >= 3:
                continue
            label = build_list_preview_text(item)
            if label:
                previews.append(label)
        for payload in note_payload:
            if payload.get('note_type') == 'list':
                # Don't show list preview for locked protected notes
                if payload.get('locked'):
                    payload['list_preview'] = []
                else:
                    payload['list_preview'] = preview_map.get(payload['id'], [])
    return jsonify(note_payload)

def resolve_note_link():
    import app as a
    Note = a.Note
    NoteFolder = a.NoteFolder
    NoteLink = a.NoteLink
    db = a.db
    func = a.func
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    normalize_note_type = a.normalize_note_type
    parse_bool = a.parse_bool
    request = a.request
    """Resolve or create a linked note from a note editor."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    data = request.json or {}
    source_note_id = data.get('source_note_id')
    title = (data.get('title') or '').strip()
    target_note_id = data.get('target_note_id')
    note_type = normalize_note_type(data.get('note_type') or 'note')
    defer_create = parse_bool(data.get('defer_create'), False)
    is_listed = parse_bool(data.get('is_listed'), True)
    folder_id_value = data.get('folder_id')
    folder_id_value = int(folder_id_value) if folder_id_value and str(folder_id_value).isdigit() else None

    if not source_note_id or not str(source_note_id).isdigit():
        return jsonify({'error': 'Invalid source_note_id'}), 400
    source_note = Note.query.filter_by(id=int(source_note_id), user_id=user.id).first()
    if not source_note:
        return jsonify({'error': 'Source note not found'}), 404

    if target_note_id:
        if not str(target_note_id).isdigit():
            return jsonify({'error': 'Invalid target_note_id'}), 400
        target = Note.query.filter_by(id=int(target_note_id), user_id=user.id).first()
        if not target:
            return jsonify({'error': 'Target note not found'}), 404
        if target.note_type != note_type:
            return jsonify({'error': f'Target is not a {note_type}'}), 400
        existing = NoteLink.query.filter_by(source_note_id=source_note.id, target_note_id=target.id).first()
        if not existing:
            db.session.add(NoteLink(source_note_id=source_note.id, target_note_id=target.id))
            db.session.commit()
        return jsonify({'status': 'linked', 'note': target.to_dict()})

    if not title:
        return jsonify({'error': 'Missing title'}), 400

    matches = Note.query.filter(
        Note.user_id == user.id,
        Note.note_type == note_type,
        func.lower(Note.title) == title.lower()
    ).order_by(Note.updated_at.desc()).all()
    if len(matches) > 1:
        payload = [
            {
                'id': note.id,
                'title': note.title,
                'is_listed': bool(note.is_listed),
                'note_type': note.note_type,
                'updated_at': note.updated_at.isoformat() if note.updated_at else None
            }
            for note in matches
        ]
        return jsonify({'status': 'choose', 'title': title, 'matches': payload})
    if len(matches) == 0 and defer_create:
        return jsonify({'status': 'choose', 'title': title, 'matches': []})
    if len(matches) == 1:
        target = matches[0]
        existing = NoteLink.query.filter_by(source_note_id=source_note.id, target_note_id=target.id).first()
        if not existing:
            db.session.add(NoteLink(source_note_id=source_note.id, target_note_id=target.id))
            db.session.commit()
        return jsonify({'status': 'linked', 'note': target.to_dict()})

    if folder_id_value is not None:
        NoteFolder.query.filter_by(id=folder_id_value, user_id=user.id).first_or_404()
    note = Note(
        title=title,
        content='',
        user_id=user.id,
        folder_id=folder_id_value,
        note_type=note_type,
        checkbox_mode=False,
        is_listed=is_listed
    )
    db.session.add(note)
    db.session.flush()
    db.session.add(NoteLink(source_note_id=source_note.id, target_note_id=note.id))
    db.session.commit()
    return jsonify({'status': 'created', 'note': note.to_dict()})

def cleanup_note_content():
    import app as a
    import html as html_lib
    from difflib import SequenceMatcher
    _html_to_plain_text = a._html_to_plain_text
    _sanitize_note_html = a._sanitize_note_html
    _wrap_plain_text_html = a._wrap_plain_text_html
    app = a.app
    call_chat_json = a.call_chat_json
    get_current_user = a.get_current_user
    json = a.json
    jsonify = a.jsonify
    re = a.re
    request = a.request
    """AI cleanup for a note's HTML content."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    data = request.json or {}
    raw_html = data.get('content') or ''
    title = (data.get('title') or '').strip()
    if not raw_html or not str(raw_html).strip():
        return jsonify({'error': 'Note content is empty'}), 400
    if len(raw_html) > 20000:
        return jsonify({'error': 'Note is too large to clean up at once'}), 400

    plain_text = _html_to_plain_text(raw_html)
    if not plain_text:
        return jsonify({'error': 'Note content is empty'}), 400

    def _normalized_lines(text):
        lines = []
        seen = set()
        for raw_line in (text or '').splitlines():
            compact = ' '.join(raw_line.strip().split())
            if not compact:
                continue
            key = compact.lower()
            if key in seen:
                continue
            seen.add(key)
            lines.append(compact)
        return lines

    def _line_bucket(line):
        lower = line.lower()
        if re.search(r"\b(call|send|check|fix|follow\s*up|book|schedule|resched|remember|pack|submit|review)\b", lower):
            return 'Action Items'
        if re.search(r"\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm|meeting|appointment|deadline|today|tomorrow)\b", lower):
            return 'Schedule'
        if re.search(r"\b(grocer|milk|eggs?|bread|spinach|lemon|buy|shop|shopping)\b", lower):
            return 'Shopping'
        if re.search(r"\b(project|launch|bug|contract|invoice|homepage|login|client|feature)\b", lower):
            return 'Work'
        if re.search(r"\b(idea|brainstorm|maybe|concept)\b", lower):
            return 'Ideas'
        if re.search(r"\b(dentist|mom|birthday|gift|bank|charge|car|oil|gym|trip|passport|meds)\b", lower):
            return 'Personal'
        return 'Other Notes'

    def _fallback_cleanup_html(text):
        # Deterministic local cleanup fallback used when AI is unavailable,
        # malformed, or too weak. Produces consistently structured output.
        lines = _normalized_lines(text)
        if not lines:
            return ''

        ordered_buckets = ['Action Items', 'Schedule', 'Work', 'Shopping', 'Personal', 'Ideas', 'Other Notes']
        buckets = {name: [] for name in ordered_buckets}
        for line in lines:
            buckets[_line_bucket(line)].append(line)

        heading = (title or 'Cleaned Notes').strip()
        parts = [f"<h2>{html_lib.escape(heading, quote=False)}</h2>"]
        for section in ordered_buckets:
            section_lines = buckets.get(section) or []
            if not section_lines:
                continue
            parts.append(f"<h3>{html_lib.escape(section, quote=False)}</h3>")
            parts.append("<ul>")
            for item in section_lines:
                parts.append(f"<li>{html_lib.escape(item, quote=False)}</li>")
            parts.append("</ul>")

        return _sanitize_note_html(''.join(parts))

    def _cleanup_quality_is_weak(cleaned_html, source_text):
        if not cleaned_html:
            return True
        source_lines = _normalized_lines(source_text)
        cleaned_text = _html_to_plain_text(cleaned_html)
        cleaned_lines = _normalized_lines(cleaned_text)
        has_heading = bool(re.search(r"<\s*h[1-4]\b", cleaned_html, re.IGNORECASE))
        has_list = bool(re.search(r"<\s*(ul|ol)\b", cleaned_html, re.IGNORECASE))

        if len(source_lines) >= 5 and (not has_heading or not has_list):
            return True
        if len(source_lines) >= 6 and len(cleaned_lines) <= 2:
            return True

        source_compact = ' '.join(source_lines).lower()
        cleaned_compact = ' '.join(cleaned_lines).lower()
        if source_compact and cleaned_compact:
            similarity = SequenceMatcher(None, source_compact, cleaned_compact).ratio()
            if len(source_lines) >= 4 and similarity >= 0.96:
                return True
        return False

    def _request_cleanup_html(prompt, *, max_tokens=1400, temperature=0.15, retries=2):
        parsed = call_chat_json(
            prompt,
            payload,
            max_tokens=max_tokens,
            temperature=temperature,
            retries=retries,
            logger=app.logger,
        )
        candidate_html = ''
        if isinstance(parsed, dict):
            candidate_html = parsed.get('html') or ''
        if not candidate_html:
            return ''
        if not re.search(r'<\s*/?\s*[a-zA-Z]', candidate_html):
            candidate_html = _wrap_plain_text_html(candidate_html)
        return _sanitize_note_html(candidate_html)

    if not app.config.get('OPENAI_API_KEY'):
        fallback_html = _fallback_cleanup_html(plain_text)
        if fallback_html:
            return jsonify({'html': fallback_html})
        return jsonify({'error': 'AI service not configured'}), 503

    system_prompt = (
        "You are an expert note editor. Transform messy notes into a polished, clearly sorted HTML note. "
        "Preserve all meaningful facts, tasks, dates, names, and intent. Do not invent facts. "
        "ALWAYS produce structured output with visual hierarchy: section headings (h2/h3) and lists (ul/ol) where useful. "
        "Group related items by topic and place actionable tasks near the top. "
        "Merge duplicates, fix typos/grammar, normalize capitalization/punctuation, and keep the original language. "
        "Make the result read like a deliberate, clean notebook page, not a lightly edited dump. "
        "Return ONLY JSON as {\"html\":\"...\"}. "
        "Allowed HTML tags: h1,h2,h3,h4,p,ul,ol,li,blockquote,pre,code,strong,em,u,s,del,br,span,a. "
        "Do not include html/body tags or scripts."
    )
    payload = json.dumps({
        "title": title,
        "text": plain_text,
    })

    sanitized = _request_cleanup_html(system_prompt, max_tokens=1500, temperature=0.15, retries=2)
    if not sanitized:
        fallback_html = _fallback_cleanup_html(plain_text)
        if fallback_html:
            return jsonify({'html': fallback_html})
        return jsonify({'error': 'AI returned an invalid response'}), 502

    if _cleanup_quality_is_weak(sanitized, plain_text):
        strict_prompt = (
            "Rewrite the note into a STRONGLY organized final format. "
            "You must output a polished structure with headings and grouped bullet lists. "
            "Sort by practical usefulness: Action Items, Schedule, Work/Projects, Personal, Ideas, Other. "
            "Keep every factual detail from the source; do not invent anything. "
            "Use concise wording and clear parallel phrasing. "
            "Return ONLY JSON as {\"html\":\"...\"} with safe HTML content."
        )
        strict_sanitized = _request_cleanup_html(strict_prompt, max_tokens=1700, temperature=0.05, retries=2)
        if strict_sanitized:
            sanitized = strict_sanitized

    if not sanitized:
        fallback_html = _fallback_cleanup_html(plain_text)
        if fallback_html:
            return jsonify({'html': fallback_html})
        return jsonify({'error': 'AI cleanup produced empty content'}), 502

    # If the AI output is effectively unchanged, apply deterministic local
    # normalization so the user still gets a visible cleanup pass.
    original_sanitized = _sanitize_note_html(raw_html)
    if original_sanitized and sanitized == original_sanitized:
        fallback_html = _fallback_cleanup_html(plain_text)
        if fallback_html and fallback_html != original_sanitized:
            return jsonify({'html': fallback_html})

    if _cleanup_quality_is_weak(sanitized, plain_text):
        fallback_html = _fallback_cleanup_html(plain_text)
        if fallback_html:
            return jsonify({'html': fallback_html})

    return jsonify({'html': sanitized})

def handle_note(note_id):
    import app as a
    CalendarEvent = a.CalendarEvent
    Note = a.Note
    NoteFolder = a.NoteFolder
    NoteLink = a.NoteLink
    TodoItem = a.TodoItem
    TodoList = a.TodoList
    datetime = a.datetime
    db = a.db
    get_current_user = a.get_current_user
    is_note_linked = a.is_note_linked
    jsonify = a.jsonify
    or_ = a.or_
    parse_bool = a.parse_bool
    pytz = a.pytz
    request = a.request
    """CRUD operations for a single note/list."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()

    # Block DELETE on protected notes - require notes PIN
    if request.method == 'DELETE':
        if note.is_pin_protected:
            data = request.json or {}
            pin = str(data.get('pin', '')).strip()
            if not pin or not user.check_notes_pin(pin):
                return jsonify({'error': 'Note is protected. Please enter notes PIN.'}), 403
        NoteLink.query.filter(
            or_(NoteLink.source_note_id == note.id, NoteLink.target_note_id == note.id)
        ).delete(synchronize_session=False)
        db.session.delete(note)
        db.session.commit()
        return '', 204

    if request.method == 'PUT':
        data = request.json or {}
        if note.archived_at:
            return jsonify({'error': 'Archived notes are read-only.'}), 403
        # For protected notes, require notes PIN for any modification
        if note.is_pin_protected:
            pin = str(data.get('pin', '')).strip()
            if not pin or not user.check_notes_pin(pin):
                return jsonify({'error': 'Note is protected. Please enter notes PIN.'}), 403
        if 'title' in data:
            fallback = 'Untitled List' if note.note_type == 'list' else 'Untitled Note'
            note.title = (data.get('title') or '').strip() or fallback
        if 'content' in data and note.note_type == 'note':
            note.content = data.get('content', note.content)
        if 'checkbox_mode' in data and note.note_type == 'list':
            note.checkbox_mode = parse_bool(data.get('checkbox_mode'))
        if 'is_listed' in data:
            note.is_listed = parse_bool(data.get('is_listed'), True)
        note.updated_at = datetime.now(pytz.UTC).replace(tzinfo=None)
        if 'pinned' in data:
            is_pin = str(data.get('pinned')).lower() in ['1', 'true', 'yes', 'on']
            if is_pin and not note.pinned:
                max_pin = db.session.query(db.func.coalesce(db.func.max(Note.pin_order), 0)).filter(
                    Note.user_id == user.id,
                    Note.pinned.is_(True)
                ).scalar()
                note.pin_order = (max_pin or 0) + 1
            if not is_pin:
                note.pin_order = 0
            note.pinned = is_pin
        if 'todo_item_id' in data:
            todo_item_id = data.get('todo_item_id')
            if todo_item_id is None:
                note.todo_item_id = None
            else:
                try:
                    todo_item_id_int = int(todo_item_id)
                except (TypeError, ValueError):
                    return jsonify({'error': 'Invalid todo_item_id'}), 400
                linked_item = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
                    TodoItem.id == todo_item_id_int,
                    TodoList.user_id == user.id
                ).first()
                if not linked_item:
                    return jsonify({'error': 'Task not found for this user'}), 404
                note.todo_item_id = todo_item_id_int
                note.calendar_event_id = None  # keep note linked to a single target
        if 'calendar_event_id' in data:
            calendar_event_id = data.get('calendar_event_id')
            if calendar_event_id is None:
                note.calendar_event_id = None
            else:
                try:
                    calendar_event_id_int = int(calendar_event_id)
                except (TypeError, ValueError):
                    return jsonify({'error': 'Invalid calendar_event_id'}), 400
                linked_event = CalendarEvent.query.filter_by(id=calendar_event_id_int, user_id=user.id).first()
                if not linked_event:
                    return jsonify({'error': 'Calendar event not found for this user'}), 404
                note.calendar_event_id = calendar_event_id_int
                note.todo_item_id = None  # keep note linked to a single target
        if 'folder_id' in data:
            folder_id = data.get('folder_id')
            if folder_id is None or folder_id == '':
                note.folder_id = None
            else:
                try:
                    folder_id_int = int(folder_id)
                except (TypeError, ValueError):
                    return jsonify({'error': 'Invalid folder_id'}), 400
                folder = NoteFolder.query.filter_by(id=folder_id_int, user_id=user.id).first()
                if not folder:
                    return jsonify({'error': 'Folder not found for this user'}), 404
                note.folder_id = folder_id_int
        # Handle notes PIN protection toggle
        if 'is_pin_protected' in data:
            is_protected = str(data.get('is_pin_protected')).lower() in ['1', 'true', 'yes', 'on']
            if is_protected and not user.has_notes_pin():
                return jsonify({'error': 'Set a notes PIN first before protecting notes'}), 400
            note.is_pin_protected = is_protected
        db.session.commit()
        payload = note.to_dict()
        if note.note_type == 'list':
            payload['items'] = [item.to_dict() for item in note.list_items]
        return jsonify(payload)

    # GET: Return limited data for protected notes (always locked)
    if note.is_pin_protected:
        payload = {
            'id': note.id,
            'title': note.title,
            'is_pin_protected': True,
            'locked': True,
            'note_type': note.note_type,
            'pinned': note.pinned,
            'folder_id': note.folder_id,
            'planner_multi_item_id': note.planner_multi_item_id,
            'planner_multi_line_id': note.planner_multi_line_id,
            'archived_at': note.archived_at.isoformat() if note.archived_at else None,
            'is_archived': bool(note.archived_at),
            'created_at': note.created_at.isoformat() if note.created_at else None,
            'updated_at': note.updated_at.isoformat() if note.updated_at else None,
        }
        return jsonify(payload)

    payload = note.to_dict()
    link_exists = NoteLink.query.filter(
        or_(NoteLink.target_note_id == note.id, NoteLink.source_note_id == note.id)
    ).first() is not None
    payload['is_linked_note'] = is_note_linked(note) or link_exists
    if note.note_type == 'list':
        payload['items'] = [item.to_dict() for item in note.list_items]
    return jsonify(payload)

def note_list_items(note_id):
    import app as a
    Note = a.Note
    NoteListItem = a.NoteListItem
    datetime = a.datetime
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    parse_day_value = a.parse_day_value
    pytz = a.pytz
    request = a.request
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()
    if note.note_type != 'list':
        return jsonify({'error': 'Not a list note'}), 400

    if request.method == 'GET':
        items = NoteListItem.query.filter_by(note_id=note.id).order_by(
            NoteListItem.order_index.asc(),
            NoteListItem.id.asc()
        ).all()
        return jsonify([item.to_dict() for item in items])

    data = request.json or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Item text required'}), 400
    note_text = (data.get('note') or '').strip() or None
    inner_note = (data.get('inner_note') or '').strip() or None
    link_text = (data.get('link_text') or '').strip() or None
    link_url = (data.get('link_url') or '').strip() or None
    scheduled_date = parse_day_value(data.get('scheduled_date')) if 'scheduled_date' in data else None
    checked = str(data.get('checked') or '').lower() in ['1', 'true', 'yes', 'on']

    insert_index = data.get('insert_index')
    max_order = db.session.query(db.func.coalesce(db.func.max(NoteListItem.order_index), 0)).filter_by(
        note_id=note.id
    ).scalar() or 0
    if insert_index is None:
        order_index = max_order + 1
    else:
        try:
            insert_index_int = int(insert_index)
        except (TypeError, ValueError):
            insert_index_int = max_order
        insert_index_int = max(0, insert_index_int)
        order_index = min(insert_index_int, max_order) + 1
        db.session.query(NoteListItem).filter(
            NoteListItem.note_id == note.id,
            NoteListItem.order_index >= order_index
        ).update(
            {NoteListItem.order_index: NoteListItem.order_index + 1},
            synchronize_session=False
        )

    item = NoteListItem(
        note_id=note.id,
        text=text,
        note=note_text,
        inner_note=inner_note,
        link_text=link_text,
        link_url=link_url,
        scheduled_date=scheduled_date,
        checked=checked,
        order_index=order_index
    )
    note.updated_at = datetime.now(pytz.UTC).replace(tzinfo=None)
    db.session.add(item)
    db.session.commit()
    return jsonify(item.to_dict()), 201

def note_list_item_detail(note_id, item_id):
    import app as a
    Note = a.Note
    NoteListItem = a.NoteListItem
    _reindex_note_list_items = a._reindex_note_list_items
    datetime = a.datetime
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    parse_day_value = a.parse_day_value
    pytz = a.pytz
    request = a.request
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    item = NoteListItem.query.join(Note, NoteListItem.note_id == Note.id).filter(
        NoteListItem.id == item_id,
        NoteListItem.note_id == note_id,
        Note.user_id == user.id
    ).first_or_404()
    note = item.parent_note
    if note.note_type != 'list':
        return jsonify({'error': 'Not a list note'}), 400

    if request.method == 'DELETE':
        db.session.delete(item)
        _reindex_note_list_items(note.id)
        note.updated_at = datetime.now(pytz.UTC).replace(tzinfo=None)
        db.session.commit()
        return '', 204

    data = request.json or {}
    if 'text' in data:
        text = (data.get('text') or '').strip()
        if not text:
            return jsonify({'error': 'Item text required'}), 400
        item.text = text
    if 'note' in data:
        item.note = (data.get('note') or '').strip() or None
    if 'inner_note' in data:
        item.inner_note = (data.get('inner_note') or '').strip() or None
    if 'link_text' in data:
        item.link_text = (data.get('link_text') or '').strip() or None
    if 'link_url' in data:
        item.link_url = (data.get('link_url') or '').strip() or None
    if 'scheduled_date' in data:
        item.scheduled_date = parse_day_value(data.get('scheduled_date'))
    if 'checked' in data:
        item.checked = str(data.get('checked') or '').lower() in ['1', 'true', 'yes', 'on']
    if 'insert_index' in data:
        try:
            insert_index = int(data.get('insert_index'))
        except (TypeError, ValueError):
            insert_index = None
        if insert_index is not None:
            items = NoteListItem.query.filter_by(note_id=note.id).order_by(
                NoteListItem.order_index.asc(),
                NoteListItem.id.asc()
            ).all()
            item_map = {i.id: i for i in items}
            ordered_ids = [i.id for i in items if i.id != item.id]
            insert_index = max(0, min(insert_index, len(ordered_ids)))
            ordered_ids.insert(insert_index, item.id)
            for idx, item_id in enumerate(ordered_ids, start=1):
                item_map[item_id].order_index = idx
    note.updated_at = datetime.now(pytz.UTC).replace(tzinfo=None)
    db.session.commit()
    return jsonify(item.to_dict())

def duplicate_note(note_id):
    import app as a
    Note = a.Note
    NoteListItem = a.NoteListItem
    _now_local = a._now_local
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    request = a.request
    """Duplicate a note or list, including list items when applicable."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()
    if note.is_pin_protected:
        data = request.json or {}
        pin = str(data.get('pin', '')).strip()
        if not pin or not user.check_notes_pin(pin):
            return jsonify({'error': 'Note is protected. Please enter notes PIN.'}), 403

    copy_note = Note(
        title=f"{note.title or 'Untitled'} (copy)",
        content=note.content or '' if note.note_type != 'list' else '',
        user_id=user.id,
        todo_item_id=None,
        calendar_event_id=None,
        folder_id=note.folder_id,
        note_type=note.note_type or 'note',
        checkbox_mode=bool(note.checkbox_mode) if note.note_type == 'list' else False,
        is_listed=bool(note.is_listed)
    )
    db.session.add(copy_note)
    db.session.flush()

    if note.note_type == 'list':
        items = NoteListItem.query.filter_by(note_id=note.id).order_by(
            NoteListItem.order_index.asc(),
            NoteListItem.id.asc()
        ).all()
        if items:
            copied_items = [
                NoteListItem(
                    note_id=copy_note.id,
                    text=item.text,
                    note=item.note,
                    link_text=item.link_text,
                    link_url=item.link_url,
                    checked=bool(item.checked),
                    order_index=item.order_index or 0
                )
                for item in items
            ]
            db.session.add_all(copied_items)

    copy_note.updated_at = _now_local()
    db.session.commit()
    return jsonify(copy_note.to_dict()), 201

def convert_note_to_list(note_id):
    import app as a
    Note = a.Note
    NoteListItem = a.NoteListItem
    _extract_note_list_lines = a._extract_note_list_lines
    _now_local = a._now_local
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    """Convert a note into a list with strict line-based rules."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()
    if note.note_type != 'note':
        return jsonify({'error': 'Only notes can be converted to lists'}), 400

    lines, error = _extract_note_list_lines(note.content or '')
    if error:
        return jsonify({'error': 'Note does not qualify for list conversion', 'details': error}), 400

    NoteListItem.query.filter_by(note_id=note.id).delete(synchronize_session=False)
    note.note_type = 'list'
    note.checkbox_mode = False
    note.content = ''
    note.updated_at = _now_local()

    for idx, line in enumerate(lines, start=1):
        item = NoteListItem(
            note_id=note.id,
            text=line,
            note=None,
            link_text=None,
            link_url=None,
            checked=False,
            order_index=idx
        )
        db.session.add(item)

    db.session.commit()
    payload = note.to_dict()
    payload['items'] = [item.to_dict() for item in note.list_items]
    return jsonify(payload)

def note_folder_detail(folder_id):
    import app as a
    Note = a.Note
    NoteFolder = a.NoteFolder
    _now_local = a._now_local
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    request = a.request
    """Get, update, or delete a note folder."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    folder = NoteFolder.query.filter_by(id=folder_id, user_id=user.id).first_or_404()

    if request.method == 'GET':
        return jsonify(folder.to_dict())

    # Block DELETE on protected folders - require notes PIN
    if request.method == 'DELETE':
        if folder.is_pin_protected:
            data = request.json or {}
            pin = str(data.get('pin', '')).strip()
            if not pin or not user.check_notes_pin(pin):
                return jsonify({'error': 'Folder is protected. Please enter notes PIN.'}), 403
        parent_id = folder.parent_id
        NoteFolder.query.filter_by(user_id=user.id, parent_id=folder.id).update(
            {'parent_id': parent_id}
        )
        Note.query.filter_by(user_id=user.id, folder_id=folder.id).update(
            {'folder_id': parent_id}
        )
        db.session.delete(folder)
        db.session.commit()
        return jsonify({'deleted': True})

    data = request.json or {}
    # For protected folders, require notes PIN for any modification
    if folder.is_pin_protected:
        pin = str(data.get('pin', '')).strip()
        if not pin or not user.check_notes_pin(pin):
            return jsonify({'error': 'Folder is protected. Please enter notes PIN.'}), 403
    if 'name' in data:
        name_val = (data.get('name') or '').strip()
        if name_val:
            folder.name = name_val
    if 'parent_id' in data:
        parent_id = data.get('parent_id')
        parent_id_int = int(parent_id) if parent_id and str(parent_id).isdigit() else None
        if parent_id_int is not None:
            parent = NoteFolder.query.filter_by(id=parent_id_int, user_id=user.id).first()
            if not parent:
                return jsonify({'error': 'Parent folder not found'}), 404
        folder.parent_id = parent_id_int
    # Handle notes PIN protection toggle
    if 'is_pin_protected' in data:
        is_protected = str(data.get('is_pin_protected')).lower() in ['1', 'true', 'yes', 'on']
        if is_protected and not user.has_notes_pin():
            return jsonify({'error': 'Set a notes PIN first before protecting folders'}), 400
        folder.is_pin_protected = is_protected
    folder.updated_at = _now_local()
    db.session.commit()
    return jsonify(folder.to_dict())

def move_note_folders():
    import app as a
    NoteFolder = a.NoteFolder
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    request = a.request
    """Move one or more note folders under a new parent (or to root)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    data = request.json or {}
    ids = data.get('ids')
    parent_id = data.get('parent_id')
    if not isinstance(ids, list) or not ids:
        return jsonify({'error': 'ids array required'}), 400
    parent_id_int = int(parent_id) if parent_id and str(parent_id).isdigit() else None
    if parent_id_int is not None:
        NoteFolder.query.filter_by(id=parent_id_int, user_id=user.id).first_or_404()

    folders = NoteFolder.query.filter(NoteFolder.user_id == user.id, NoteFolder.id.in_(ids)).all()
    folder_map = {f.id: f for f in folders}

    def is_descendant(candidate_id, ancestor_id):
        seen = set()
        current = candidate_id
        while current and current not in seen:
            seen.add(current)
            folder = folder_map.get(current)
            if not folder:
                folder = NoteFolder.query.filter_by(id=current, user_id=user.id).first()
            if not folder:
                return False
            if folder.parent_id == ancestor_id:
                return True
            current = folder.parent_id
        return False

    updated = 0
    for raw_id in ids:
        try:
            fid = int(raw_id)
        except (TypeError, ValueError):
            continue
        folder = folder_map.get(fid)
        if not folder:
            continue
        if parent_id_int is not None:
            if parent_id_int == folder.id:
                continue
            if is_descendant(parent_id_int, folder.id):
                continue
        folder.parent_id = parent_id_int
        updated += 1

    db.session.commit()
    return jsonify({'updated': updated, 'parent_id': parent_id_int})
