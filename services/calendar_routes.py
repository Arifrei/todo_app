"""Extracted heavy route handlers from app.py."""

def calendar_search():
    import app as a
    CalendarEvent = a.CalendarEvent
    TodoItem = a.TodoItem
    TodoList = a.TodoList
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    or_ = a.or_
    request = a.request
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    query = (request.args.get('q') or request.args.get('query') or '').strip()
    if not query:
        return jsonify({'query': '', 'results': []})

    try:
        limit = int(request.args.get('limit') or 50)
    except (TypeError, ValueError):
        limit = 50
    limit = max(1, min(limit, 100))

    like_expr = f"%{query}%"
    events = CalendarEvent.query.filter(
        CalendarEvent.user_id == user.id,
        or_(
            CalendarEvent.title.ilike(like_expr),
            CalendarEvent.description.ilike(like_expr),
            CalendarEvent.item_note.ilike(like_expr)
        )
    ).order_by(
        CalendarEvent.day.asc(),
        CalendarEvent.start_time.asc(),
        CalendarEvent.order_index.asc()
    ).limit(limit).all()

    results = []
    linked_task_ids = set()
    for ev in events:
        if ev.todo_item_id:
            linked_task_ids.add(ev.todo_item_id)
        results.append({
            'type': 'event',
            'id': ev.id,
            'title': ev.title,
            'day': ev.day.isoformat() if ev.day else None,
            'start_time': ev.start_time.isoformat() if ev.start_time else None,
            'end_time': ev.end_time.isoformat() if ev.end_time else None,
            'status': ev.status,
            'priority': ev.priority,
            'is_event': ev.is_event,
            'is_phase': ev.is_phase,
            'is_group': ev.is_group,
            'task_id': ev.todo_item_id,
            'calendar_event_id': ev.id,
            'item_note': ev.item_note
        })

    remaining = max(0, limit - len(results))
    if remaining:
        task_query = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
            TodoList.user_id == user.id,
            TodoItem.due_date.isnot(None),
            TodoItem.is_phase.is_(False),
            or_(
                TodoItem.content.ilike(like_expr),
                TodoItem.description.ilike(like_expr),
                TodoItem.notes.ilike(like_expr)
            )
        )
        if linked_task_ids:
            task_query = task_query.filter(~TodoItem.id.in_(linked_task_ids))
        tasks = task_query.order_by(TodoItem.due_date.asc(), TodoItem.order_index.asc()).limit(remaining).all()
        for item in tasks:
            results.append({
                'type': 'task',
                'id': item.id,
                'title': item.content,
                'day': item.due_date.isoformat() if item.due_date else None,
                'status': item.status,
                'task_id': item.id,
                'task_list_id': item.list_id,
                'task_list_title': item.list.title if item.list else '',
                'calendar_event_id': None
            })

    results.sort(key=lambda r: ((r.get('day') or ''), (r.get('start_time') or ''), (r.get('title') or '')))
    return jsonify({'query': query, 'results': results})

def calendar_events():
    import app as a
    ALLOWED_PRIORITIES = a.ALLOWED_PRIORITIES
    ALLOWED_STATUSES = a.ALLOWED_STATUSES
    CalendarEvent = a.CalendarEvent
    ENTITY_CALENDAR = a.ENTITY_CALENDAR
    PlannerFolder = a.PlannerFolder
    PlannerMultiItem = a.PlannerMultiItem
    PlannerMultiLine = a.PlannerMultiLine
    PlannerSimpleItem = a.PlannerSimpleItem
    TodoItem = a.TodoItem
    TodoList = a.TodoList
    _ensure_recurring_instances = a._ensure_recurring_instances
    _event_conflicts_with_event = a._event_conflicts_with_event
    _event_conflicts_with_task = a._event_conflicts_with_task
    _next_calendar_order = a._next_calendar_order
    _normalize_calendar_item_note = a._normalize_calendar_item_note
    _schedule_reminder_job = a._schedule_reminder_job
    _task_conflicts_with_event = a._task_conflicts_with_event
    _task_conflicts_with_task = a._task_conflicts_with_task
    date = a.date
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    parse_day_value = a.parse_day_value
    parse_time_str = a.parse_time_str
    request = a.request
    start_embedding_job = a.start_embedding_job
    timedelta = a.timedelta
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    # Range fetch for calendar view (start & end inclusive)
    if request.method == 'GET' and (request.args.get('start') or request.args.get('end')):
        start_raw = request.args.get('start')
        end_raw = request.args.get('end')
        start_day = parse_day_value(start_raw) if start_raw else date.today().replace(day=1)
        if not start_day:
            return jsonify({'error': 'Invalid start date'}), 400
        if end_raw:
            end_day = parse_day_value(end_raw)
            if not end_day:
                return jsonify({'error': 'Invalid end date'}), 400
        else:
            # Default end to end-of-month for start_day
            next_month = (start_day.replace(day=28) + timedelta(days=4)).replace(day=1)
            end_day = next_month - timedelta(days=1)
        if end_day < start_day:
            return jsonify({'error': 'end must be on/after start'}), 400

        _ensure_recurring_instances(user.id, start_day, end_day)

        events = CalendarEvent.query.filter(
            CalendarEvent.user_id == user.id,
            CalendarEvent.day >= start_day,
            CalendarEvent.day <= end_day
        ).order_by(CalendarEvent.day.asc(), CalendarEvent.order_index.asc()).all()

        linked_event_map = {}
        linked_planner_simple_map = {}
        linked_planner_multi_map = {}
        linked_planner_line_map = {}
        phase_map_by_day = {}
        for ev in events:
            day_key = ev.day.isoformat()
            if ev.todo_item_id:
                linked_event_map.setdefault(day_key, {})[ev.todo_item_id] = ev
                continue
            if ev.planner_simple_item_id:
                linked_planner_simple_map.setdefault(day_key, {})[ev.planner_simple_item_id] = ev
                continue
            if ev.planner_multi_item_id:
                linked_planner_multi_map.setdefault(day_key, {})[ev.planner_multi_item_id] = ev
                continue
            if ev.planner_multi_line_id:
                linked_planner_line_map.setdefault(day_key, {})[ev.planner_multi_line_id] = ev
                continue
            if ev.is_phase:
                phase_map_by_day.setdefault(day_key, {})[ev.id] = ev.title

        by_day = {}
        for ev in events:
            if ev.todo_item_id or ev.planner_simple_item_id or ev.planner_multi_item_id or ev.planner_multi_line_id:
                continue
            day_key = ev.day.isoformat()
            data = ev.to_dict()
            if ev.phase_id:
                data['phase_title'] = phase_map_by_day.get(day_key, {}).get(ev.phase_id)
            by_day.setdefault(day_key, []).append(data)

        due_items = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
            TodoList.user_id == user.id,
            TodoItem.due_date >= start_day,
            TodoItem.due_date <= end_day,
            TodoItem.is_phase.is_(False)
        ).all()
        for idx, item in enumerate(due_items):
            day_key = item.due_date.isoformat()
            linked_event = linked_event_map.get(day_key, {}).get(item.id)
            by_day.setdefault(day_key, []).append({
                'id': -100000 - idx,
                'title': item.content,
                'status': item.status,
                'is_task_link': True,
                'task_id': item.id,
                'task_list_id': item.list_id,
                'task_list_title': item.list.title if item.list else '',
                'calendar_event_id': linked_event.id if linked_event else None,
                'start_time': linked_event.start_time.isoformat() if linked_event and linked_event.start_time else None,
                'end_time': linked_event.end_time.isoformat() if linked_event and linked_event.end_time else None,
                'reminder_minutes_before': linked_event.reminder_minutes_before if linked_event else None,
                'rollover_enabled': linked_event.rollover_enabled if linked_event else False,
                'allow_overlap': linked_event.allow_overlap if linked_event else False,
                'priority': linked_event.priority if linked_event else 'medium',
                'item_note': linked_event.item_note if linked_event else None,
                'day': day_key,
                'order_index': 100000 + idx
            })

        # Include scheduled planner items
        planner_idx = 0
        simple_items = PlannerSimpleItem.query.filter(
            PlannerSimpleItem.user_id == user.id,
            PlannerSimpleItem.scheduled_date >= start_day,
            PlannerSimpleItem.scheduled_date <= end_day
        ).all()
        for item in simple_items:
            day_key = item.scheduled_date.isoformat()
            folder = db.session.get(PlannerFolder, item.folder_id)
            linked_event = linked_planner_simple_map.get(day_key, {}).get(item.id)
            by_day.setdefault(day_key, []).append({
                'id': -200000 - planner_idx,
                'title': item.title,
                'status': 'not_started',
                'is_planner_item': True,
                'planner_type': 'simple',
                'planner_item_id': item.id,
                'planner_folder_id': item.folder_id,
                'planner_folder_name': folder.name if folder else '',
                'planner_value': item.value,
                'calendar_event_id': linked_event.id if linked_event else None,
                'start_time': linked_event.start_time.isoformat() if linked_event and linked_event.start_time else None,
                'end_time': linked_event.end_time.isoformat() if linked_event and linked_event.end_time else None,
                'reminder_minutes_before': linked_event.reminder_minutes_before if linked_event else None,
                'rollover_enabled': linked_event.rollover_enabled if linked_event else False,
                'allow_overlap': linked_event.allow_overlap if linked_event else False,
                'priority': linked_event.priority if linked_event else 'medium',
                'item_note': linked_event.item_note if linked_event else None,
                'day': day_key,
                'order_index': linked_event.order_index if linked_event else 200000 + planner_idx
            })
            planner_idx += 1

        multi_items = PlannerMultiItem.query.filter(
            PlannerMultiItem.user_id == user.id,
            PlannerMultiItem.scheduled_date >= start_day,
            PlannerMultiItem.scheduled_date <= end_day
        ).all()
        for item in multi_items:
            day_key = item.scheduled_date.isoformat()
            folder = db.session.get(PlannerFolder, item.folder_id)
            linked_event = linked_planner_multi_map.get(day_key, {}).get(item.id)
            by_day.setdefault(day_key, []).append({
                'id': -200000 - planner_idx,
                'title': item.title,
                'status': 'not_started',
                'is_planner_item': True,
                'planner_type': 'group',
                'planner_item_id': item.id,
                'planner_folder_id': item.folder_id,
                'planner_folder_name': folder.name if folder else '',
                'calendar_event_id': linked_event.id if linked_event else None,
                'start_time': linked_event.start_time.isoformat() if linked_event and linked_event.start_time else None,
                'end_time': linked_event.end_time.isoformat() if linked_event and linked_event.end_time else None,
                'reminder_minutes_before': linked_event.reminder_minutes_before if linked_event else None,
                'rollover_enabled': linked_event.rollover_enabled if linked_event else False,
                'allow_overlap': linked_event.allow_overlap if linked_event else False,
                'priority': linked_event.priority if linked_event else 'medium',
                'item_note': linked_event.item_note if linked_event else None,
                'day': day_key,
                'order_index': linked_event.order_index if linked_event else 200000 + planner_idx
            })
            planner_idx += 1

        multi_lines = PlannerMultiLine.query.filter(
            PlannerMultiLine.user_id == user.id,
            PlannerMultiLine.scheduled_date >= start_day,
            PlannerMultiLine.scheduled_date <= end_day
        ).all()
        for line in multi_lines:
            day_key = line.scheduled_date.isoformat()
            parent_item = db.session.get(PlannerMultiItem, line.item_id)
            folder = db.session.get(PlannerFolder, parent_item.folder_id) if parent_item else None
            linked_event = linked_planner_line_map.get(day_key, {}).get(line.id)
            by_day.setdefault(day_key, []).append({
                'id': -200000 - planner_idx,
                'title': line.value,
                'status': 'not_started',
                'is_planner_item': True,
                'planner_type': 'line',
                'planner_line_id': line.id,
                'planner_item_id': line.item_id,
                'planner_item_title': parent_item.title if parent_item else '',
                'planner_folder_id': parent_item.folder_id if parent_item else None,
                'planner_folder_name': folder.name if folder else '',
                'calendar_event_id': linked_event.id if linked_event else None,
                'start_time': linked_event.start_time.isoformat() if linked_event and linked_event.start_time else None,
                'end_time': linked_event.end_time.isoformat() if linked_event and linked_event.end_time else None,
                'reminder_minutes_before': linked_event.reminder_minutes_before if linked_event else None,
                'rollover_enabled': linked_event.rollover_enabled if linked_event else False,
                'allow_overlap': linked_event.allow_overlap if linked_event else False,
                'priority': linked_event.priority if linked_event else 'medium',
                'item_note': linked_event.item_note if linked_event else None,
                'day': day_key,
                'order_index': linked_event.order_index if linked_event else 200000 + planner_idx
            })
            planner_idx += 1

        return jsonify({
            'start': start_day.isoformat(),
            'end': end_day.isoformat(),
            'events': by_day
        })

    if request.method == 'GET':
        day_str = request.args.get('day') or date.today().isoformat()
        day_obj = parse_day_value(day_str)
        if not day_obj:
            return jsonify({'error': 'Invalid day'}), 400
        _ensure_recurring_instances(user.id, day_obj, day_obj)
        events = CalendarEvent.query.filter_by(user_id=user.id, day=day_obj).order_by(
            CalendarEvent.order_index.asc()
        ).all()
        payload = []
        linked_event_map = {}
        linked_planner_simple_map = {}
        linked_planner_multi_map = {}
        linked_planner_line_map = {}
        for ev in events:
            if ev.todo_item_id:
                linked_event_map[ev.todo_item_id] = ev
                continue
            if ev.planner_simple_item_id:
                linked_planner_simple_map[ev.planner_simple_item_id] = ev
                continue
            if ev.planner_multi_item_id:
                linked_planner_multi_map[ev.planner_multi_item_id] = ev
                continue
            if ev.planner_multi_line_id:
                linked_planner_line_map[ev.planner_multi_line_id] = ev
                continue
            data = ev.to_dict()
            if ev.phase_id:
                parent = next((e for e in events if e.id == ev.phase_id), None)
                data['phase_title'] = parent.title if parent else None
            payload.append(data)

        # Also include tasks due on this day (from main task lists) as linkable entries
        due_items = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
            TodoList.user_id == user.id,
            TodoItem.due_date == day_obj,
            TodoItem.is_phase.is_(False)
        ).all()
        for idx, item in enumerate(due_items):
            linked_event = linked_event_map.get(item.id)
            payload.append({
                'id': -100000 - idx,  # synthetic id to avoid collisions
                'title': item.content,
                'status': item.status,
                'is_task_link': True,
                'task_id': item.id,
                'task_list_id': item.list_id,
                'task_list_title': item.list.title if item.list else '',
                'calendar_event_id': linked_event.id if linked_event else None,
                'start_time': linked_event.start_time.isoformat() if linked_event and linked_event.start_time else None,
                'end_time': linked_event.end_time.isoformat() if linked_event and linked_event.end_time else None,
                'reminder_minutes_before': linked_event.reminder_minutes_before if linked_event else None,
                'rollover_enabled': linked_event.rollover_enabled if linked_event else False,
                'allow_overlap': linked_event.allow_overlap if linked_event else False,
                'priority': linked_event.priority if linked_event else 'medium',
                'item_note': linked_event.item_note if linked_event else None,
                'day': day_obj.isoformat(),
                'order_index': 100000 + idx
            })

        # Include scheduled planner items for this day
        planner_idx = 0
        simple_items = PlannerSimpleItem.query.filter_by(user_id=user.id, scheduled_date=day_obj).all()
        for item in simple_items:
            folder = db.session.get(PlannerFolder, item.folder_id)
            linked_event = linked_planner_simple_map.get(item.id)
            payload.append({
                'id': -200000 - planner_idx,
                'title': item.title,
                'status': 'not_started',
                'is_planner_item': True,
                'planner_type': 'simple',
                'planner_item_id': item.id,
                'planner_folder_id': item.folder_id,
                'planner_folder_name': folder.name if folder else '',
                'planner_value': item.value,
                'calendar_event_id': linked_event.id if linked_event else None,
                'start_time': linked_event.start_time.isoformat() if linked_event and linked_event.start_time else None,
                'end_time': linked_event.end_time.isoformat() if linked_event and linked_event.end_time else None,
                'reminder_minutes_before': linked_event.reminder_minutes_before if linked_event else None,
                'rollover_enabled': linked_event.rollover_enabled if linked_event else False,
                'allow_overlap': linked_event.allow_overlap if linked_event else False,
                'priority': linked_event.priority if linked_event else 'medium',
                'item_note': linked_event.item_note if linked_event else None,
                'day': day_obj.isoformat(),
                'order_index': linked_event.order_index if linked_event else 200000 + planner_idx
            })
            planner_idx += 1

        multi_items = PlannerMultiItem.query.filter_by(user_id=user.id, scheduled_date=day_obj).all()
        for item in multi_items:
            folder = db.session.get(PlannerFolder, item.folder_id)
            linked_event = linked_planner_multi_map.get(item.id)
            payload.append({
                'id': -200000 - planner_idx,
                'title': item.title,
                'status': 'not_started',
                'is_planner_item': True,
                'planner_type': 'group',
                'planner_item_id': item.id,
                'planner_folder_id': item.folder_id,
                'planner_folder_name': folder.name if folder else '',
                'calendar_event_id': linked_event.id if linked_event else None,
                'start_time': linked_event.start_time.isoformat() if linked_event and linked_event.start_time else None,
                'end_time': linked_event.end_time.isoformat() if linked_event and linked_event.end_time else None,
                'reminder_minutes_before': linked_event.reminder_minutes_before if linked_event else None,
                'rollover_enabled': linked_event.rollover_enabled if linked_event else False,
                'allow_overlap': linked_event.allow_overlap if linked_event else False,
                'priority': linked_event.priority if linked_event else 'medium',
                'item_note': linked_event.item_note if linked_event else None,
                'day': day_obj.isoformat(),
                'order_index': linked_event.order_index if linked_event else 200000 + planner_idx
            })
            planner_idx += 1

        multi_lines = PlannerMultiLine.query.filter_by(user_id=user.id, scheduled_date=day_obj).all()
        for line in multi_lines:
            parent_item = db.session.get(PlannerMultiItem, line.item_id)
            folder = db.session.get(PlannerFolder, parent_item.folder_id) if parent_item else None
            linked_event = linked_planner_line_map.get(line.id)
            payload.append({
                'id': -200000 - planner_idx,
                'title': line.value,
                'status': 'not_started',
                'is_planner_item': True,
                'planner_type': 'line',
                'planner_line_id': line.id,
                'planner_item_id': line.item_id,
                'planner_item_title': parent_item.title if parent_item else '',
                'planner_folder_id': parent_item.folder_id if parent_item else None,
                'planner_folder_name': folder.name if folder else '',
                'calendar_event_id': linked_event.id if linked_event else None,
                'start_time': linked_event.start_time.isoformat() if linked_event and linked_event.start_time else None,
                'end_time': linked_event.end_time.isoformat() if linked_event and linked_event.end_time else None,
                'reminder_minutes_before': linked_event.reminder_minutes_before if linked_event else None,
                'rollover_enabled': linked_event.rollover_enabled if linked_event else False,
                'allow_overlap': linked_event.allow_overlap if linked_event else False,
                'priority': linked_event.priority if linked_event else 'medium',
                'item_note': linked_event.item_note if linked_event else None,
                'day': day_obj.isoformat(),
                'order_index': linked_event.order_index if linked_event else 200000 + planner_idx
            })
            planner_idx += 1

        return jsonify(payload)

    data = request.json or {}
    todo_item_id = data.get('todo_item_id')
    linked_item = None
    if todo_item_id is not None:
        try:
            todo_item_id_int = int(todo_item_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid todo_item_id'}), 400
        linked_item = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
            TodoItem.id == todo_item_id_int,
            TodoList.user_id == user.id
        ).first()
        if not linked_item:
            return jsonify({'error': 'Task not found'}), 404

    # Handle planner item links
    planner_simple_item_id = data.get('planner_simple_item_id')
    planner_multi_item_id = data.get('planner_multi_item_id')
    planner_multi_line_id = data.get('planner_multi_line_id')
    linked_planner_simple = None
    linked_planner_multi = None
    linked_planner_line = None

    if planner_simple_item_id is not None:
        try:
            planner_simple_item_id_int = int(planner_simple_item_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid planner_simple_item_id'}), 400
        linked_planner_simple = PlannerSimpleItem.query.filter_by(
            id=planner_simple_item_id_int,
            user_id=user.id
        ).first()
        if not linked_planner_simple:
            return jsonify({'error': 'Planner simple item not found'}), 404

    if planner_multi_item_id is not None:
        try:
            planner_multi_item_id_int = int(planner_multi_item_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid planner_multi_item_id'}), 400
        linked_planner_multi = PlannerMultiItem.query.filter_by(
            id=planner_multi_item_id_int,
            user_id=user.id
        ).first()
        if not linked_planner_multi:
            return jsonify({'error': 'Planner multi item not found'}), 404

    if planner_multi_line_id is not None:
        try:
            planner_multi_line_id_int = int(planner_multi_line_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid planner_multi_line_id'}), 400
        linked_planner_line = PlannerMultiLine.query.filter_by(
            id=planner_multi_line_id_int,
            user_id=user.id
        ).first()
        if not linked_planner_line:
            return jsonify({'error': 'Planner line not found'}), 404

    has_planner_link = linked_planner_simple or linked_planner_multi or linked_planner_line

    title = (data.get('title') or '').strip()
    if not title and linked_item:
        title = linked_item.content
    if not title and linked_planner_simple:
        title = linked_planner_simple.title
    if not title and linked_planner_multi:
        title = linked_planner_multi.title
    if not title and linked_planner_line:
        title = linked_planner_line.value
    if not title:
        return jsonify({'error': 'Title is required'}), 400

    day_obj = parse_day_value(data.get('day') or date.today().isoformat())
    if not day_obj:
        return jsonify({'error': 'Invalid day'}), 400

    is_phase = bool(data.get('is_phase'))
    is_event = bool(data.get('is_event'))
    is_group = bool(data.get('is_group'))
    if linked_item or has_planner_link:
        is_phase = False
        is_event = False
        is_group = False
    priority = (data.get('priority') or 'medium').lower()
    if priority not in ALLOWED_PRIORITIES:
        priority = 'medium'
    status = (data.get('status') or 'not_started')
    if status not in ALLOWED_STATUSES:
        status = 'not_started'
    if linked_item:
        status = linked_item.status

    item_note = None
    if 'item_note' in data:
        try:
            item_note = _normalize_calendar_item_note(data.get('item_note'))
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

    reminder_minutes = data.get('reminder_minutes_before')
    try:
        reminder_minutes = int(reminder_minutes) if reminder_minutes is not None else None
    except (TypeError, ValueError):
        reminder_minutes = None

    phase_id = data.get('phase_id')
    resolved_phase_id = None
    if phase_id and not is_phase and not is_group:
        try:
            phase_id_int = int(phase_id)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid phase_id'}), 400
        phase_obj = CalendarEvent.query.filter_by(id=phase_id_int, user_id=user.id, day=day_obj, is_phase=True).first()
        if not phase_obj:
            return jsonify({'error': 'Phase not found for that day'}), 404
        resolved_phase_id = phase_id_int

    group_id = data.get('group_id')
    resolved_group_id = None
    if group_id and not is_group:
        try:
            group_id_int = int(group_id)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid group_id'}), 400
        group_obj = CalendarEvent.query.filter_by(id=group_id_int, user_id=user.id, day=day_obj, is_group=True).first()
        if not group_obj:
            return jsonify({'error': 'Group not found for that day'}), 404
        resolved_group_id = group_id_int

    start_time = parse_time_str(data.get('start_time'))
    end_time = parse_time_str(data.get('end_time'))

    if linked_item:
        existing = CalendarEvent.query.filter_by(
            user_id=user.id,
            todo_item_id=linked_item.id,
            day=day_obj
        ).first()
        if existing:
            return jsonify(existing.to_dict()), 200

    if linked_planner_simple:
        existing = CalendarEvent.query.filter_by(
            user_id=user.id,
            planner_simple_item_id=linked_planner_simple.id,
            day=day_obj
        ).first()
        if existing:
            return jsonify(existing.to_dict()), 200

    if linked_planner_multi:
        existing = CalendarEvent.query.filter_by(
            user_id=user.id,
            planner_multi_item_id=linked_planner_multi.id,
            day=day_obj
        ).first()
        if existing:
            return jsonify(existing.to_dict()), 200

    if linked_planner_line:
        existing = CalendarEvent.query.filter_by(
            user_id=user.id,
            planner_multi_line_id=linked_planner_line.id,
            day=day_obj
        ).first()
        if existing:
            return jsonify(existing.to_dict()), 200

    new_allow_overlap = bool(data.get('allow_overlap'))
    force_overlap = bool(data.get('force_overlap'))
    if (not is_phase) and (not is_group) and start_time and not force_overlap:
        if not is_event:
            conflict = _task_conflicts_with_event(user.id, day_obj, start_time, end_time, new_allow_overlap)
            if conflict:
                return jsonify({
                    'conflict_warning': True,
                    'message': f'"{conflict.title}" is scheduled during this time. Add task anyway?',
                    'conflict_event_id': conflict.id,
                    'conflict_event_title': conflict.title
                }), 409
            conflict = _task_conflicts_with_task(user.id, day_obj, start_time, end_time, new_allow_overlap)
            if conflict:
                return jsonify({
                    'conflict_warning': True,
                    'message': f'"{conflict.title}" is scheduled during this time. Add task anyway?',
                    'conflict_event_id': conflict.id,
                    'conflict_event_title': conflict.title
                }), 409
        else:
            conflict = _event_conflicts_with_event(user.id, day_obj, start_time, end_time, new_allow_overlap)
            if conflict:
                return jsonify({
                    'conflict_warning': True,
                    'message': f'"{conflict.title}" is scheduled during this time. Add event anyway?',
                    'conflict_event_id': conflict.id,
                    'conflict_event_title': conflict.title
                }), 409
            conflict = _event_conflicts_with_task(user.id, day_obj, start_time, end_time, new_allow_overlap)
            if conflict:
                return jsonify({
                    'conflict_warning': True,
                    'message': f'"{conflict.title}" is scheduled during this time. Add event anyway?',
                    'conflict_event_id': conflict.id,
                    'conflict_event_title': conflict.title
                }), 409

    default_rollover = (not is_event) and (not is_group) and (not is_phase)
    new_event = CalendarEvent(
        user_id=user.id,
        title=title,
        description=(data.get('description') or '').strip() or None,
        day=day_obj,
        start_time=start_time,
        end_time=end_time,
        status=status,
        priority=priority,
        is_phase=is_phase,
        is_event=is_event and not is_phase and not is_group,
        allow_overlap=new_allow_overlap if not is_phase and not is_group else False,
        is_group=is_group and not is_phase and not is_event,
        phase_id=resolved_phase_id if not is_phase and not is_group else None,
        group_id=resolved_group_id if not is_group else None,
        reminder_minutes_before=reminder_minutes if not is_phase and not is_group else None,
        rollover_enabled=bool(data.get('rollover_enabled', default_rollover) if not is_group else False),
        todo_item_id=linked_item.id if linked_item else None,
        planner_simple_item_id=linked_planner_simple.id if linked_planner_simple else None,
        planner_multi_item_id=linked_planner_multi.id if linked_planner_multi else None,
        planner_multi_line_id=linked_planner_line.id if linked_planner_line else None,
        item_note=item_note,
        order_index=_next_calendar_order(day_obj, user.id)
    )
    db.session.add(new_event)
    db.session.commit()

    # Schedule reminder job if applicable
    if new_event.reminder_minutes_before is not None and new_event.start_time:
        _schedule_reminder_job(new_event)

    start_embedding_job(user.id, ENTITY_CALENDAR, new_event.id)
    return jsonify(new_event.to_dict()), 201

def create_recurring_calendar_event():
    import app as a
    ALLOWED_PRIORITIES = a.ALLOWED_PRIORITIES
    ALLOWED_STATUSES = a.ALLOWED_STATUSES
    RecurringEvent = a.RecurringEvent
    _ensure_recurring_instances = a._ensure_recurring_instances
    _weekday_occurrence_in_month = a._weekday_occurrence_in_month
    date = a.date
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    parse_day_value = a.parse_day_value
    parse_days_of_week = a.parse_days_of_week
    parse_time_str = a.parse_time_str
    request = a.request
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    data = request.json or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'Title is required'}), 400

    start_day = parse_day_value(data.get('day') or data.get('start_day') or date.today().isoformat())
    if not start_day:
        return jsonify({'error': 'Invalid start day'}), 400

    frequency = (data.get('frequency') or '').lower()
    allowed_freq = {'daily', 'weekly', 'biweekly', 'monthly', 'monthly_weekday', 'yearly', 'custom'}
    if frequency not in allowed_freq:
        return jsonify({'error': 'Invalid frequency'}), 400

    interval = 1
    interval_unit = None
    days_of_week = parse_days_of_week(data.get('days_of_week'))
    day_of_month = data.get('day_of_month')
    month_of_year = data.get('month_of_year')
    week_of_month = data.get('week_of_month')
    weekday_of_month = data.get('weekday_of_month')
    try:
        day_of_month = int(day_of_month) if day_of_month is not None else None
    except (TypeError, ValueError):
        day_of_month = None
    try:
        month_of_year = int(month_of_year) if month_of_year is not None else None
    except (TypeError, ValueError):
        month_of_year = None
    try:
        week_of_month = int(week_of_month) if week_of_month is not None else None
    except (TypeError, ValueError):
        week_of_month = None
    try:
        weekday_of_month = int(weekday_of_month) if weekday_of_month is not None else None
    except (TypeError, ValueError):
        weekday_of_month = None

    if frequency == 'daily':
        interval = 1
        interval_unit = 'days'
    elif frequency == 'weekly':
        interval = 1
        interval_unit = 'weeks'
        if not days_of_week:
            days_of_week = [start_day.weekday()]
    elif frequency == 'biweekly':
        interval = 2
        interval_unit = 'weeks'
        if not days_of_week:
            days_of_week = [start_day.weekday()]
    elif frequency == 'monthly':
        interval = 1
        interval_unit = 'months'
        if day_of_month is None:
            day_of_month = start_day.day
    elif frequency == 'monthly_weekday':
        interval = 1
        interval_unit = 'months'
        if weekday_of_month is None:
            weekday_of_month = start_day.weekday()
        if week_of_month is None:
            week_of_month = _weekday_occurrence_in_month(start_day)
    elif frequency == 'yearly':
        interval = 1
        interval_unit = 'years'
        if day_of_month is None:
            day_of_month = start_day.day
        if month_of_year is None:
            month_of_year = start_day.month
    elif frequency == 'custom':
        try:
            interval = max(int(data.get('interval') or 1), 1)
        except (TypeError, ValueError):
            interval = 1
        interval_unit = (data.get('interval_unit') or 'days').lower()
        if interval_unit not in {'days', 'weeks', 'months', 'years'}:
            return jsonify({'error': 'Invalid interval unit'}), 400
        if interval_unit == 'weeks' and not days_of_week:
            days_of_week = [start_day.weekday()]
        if interval_unit in {'months', 'years'} and day_of_month is None:
            day_of_month = start_day.day
        if interval_unit == 'years' and month_of_year is None:
            month_of_year = start_day.month

    if day_of_month is not None and not (1 <= day_of_month <= 31):
        return jsonify({'error': 'Invalid day of month'}), 400
    if month_of_year is not None and not (1 <= month_of_year <= 12):
        return jsonify({'error': 'Invalid month of year'}), 400
    if week_of_month is not None and not (1 <= week_of_month <= 5):
        return jsonify({'error': 'Invalid week of month'}), 400
    if weekday_of_month is not None and not (0 <= weekday_of_month <= 6):
        return jsonify({'error': 'Invalid weekday of month'}), 400

    start_time = parse_time_str(data.get('start_time'))
    end_time = parse_time_str(data.get('end_time'))
    reminder_minutes = data.get('reminder_minutes_before')
    try:
        reminder_minutes = int(reminder_minutes) if reminder_minutes is not None else None
    except (TypeError, ValueError):
        reminder_minutes = None

    priority = (data.get('priority') or 'medium').lower()
    if priority not in ALLOWED_PRIORITIES:
        priority = 'medium'

    status = (data.get('status') or 'not_started')
    if status not in ALLOWED_STATUSES:
        status = 'not_started'

    is_event = bool(data.get('is_event', False))
    default_rollover = not is_event
    rule = RecurringEvent(
        user_id=user.id,
        title=title,
        description=(data.get('description') or '').strip() or None,
        start_day=start_day,
        end_day=parse_day_value(data.get('end_day')) if data.get('end_day') else None,
        start_time=start_time,
        end_time=end_time,
        status=status,
        priority=priority,
        is_event=is_event,
        reminder_minutes_before=reminder_minutes,
        rollover_enabled=bool(data.get('rollover_enabled', default_rollover)),
        frequency=frequency,
        interval=interval,
        interval_unit=interval_unit,
        days_of_week=(','.join(str(d) for d in days_of_week) if days_of_week else None),
        day_of_month=day_of_month,
        month_of_year=month_of_year,
        week_of_month=week_of_month,
        weekday_of_month=weekday_of_month
    )
    db.session.add(rule)
    db.session.commit()

    _ensure_recurring_instances(user.id, start_day, start_day)
    return jsonify({'id': rule.id}), 201

def recurring_event_detail(rule_id):
    import app as a
    ALLOWED_PRIORITIES = a.ALLOWED_PRIORITIES
    CalendarEvent = a.CalendarEvent
    RecurrenceException = a.RecurrenceException
    RecurringEvent = a.RecurringEvent
    _prune_recurring_instances = a._prune_recurring_instances
    _weekday_occurrence_in_month = a._weekday_occurrence_in_month
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    parse_day_value = a.parse_day_value
    parse_days_of_week = a.parse_days_of_week
    parse_time_str = a.parse_time_str
    request = a.request
    """Update or delete a recurring event template."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    rule = RecurringEvent.query.filter_by(id=rule_id, user_id=user.id).first_or_404()

    if request.method == 'DELETE':
        # Delete all associated exceptions
        RecurrenceException.query.filter_by(recurrence_id=rule.id).delete()
        # Optionally delete future instances (generated events from this rule)
        CalendarEvent.query.filter_by(recurrence_id=rule.id, user_id=user.id).delete()
        db.session.delete(rule)
        db.session.commit()
        return '', 204

    # PUT - update the recurring rule
    data = request.json or {}
    if 'title' in data:
        title = (data.get('title') or '').strip()
        if title:
            rule.title = title
    if 'description' in data:
        rule.description = (data.get('description') or '').strip() or None
    if 'priority' in data:
        priority = (data.get('priority') or '').lower()
        if priority in ALLOWED_PRIORITIES:
            rule.priority = priority
    if 'is_event' in data:
        rule.is_event = bool(data.get('is_event'))
    if 'rollover_enabled' in data:
        rule.rollover_enabled = bool(data.get('rollover_enabled'))
    if 'start_time' in data:
        rule.start_time = parse_time_str(data.get('start_time'))
    if 'end_time' in data:
        rule.end_time = parse_time_str(data.get('end_time'))
    if 'reminder_minutes_before' in data:
        try:
            rule.reminder_minutes_before = int(data['reminder_minutes_before']) if data['reminder_minutes_before'] else None
        except (TypeError, ValueError):
            pass
    if 'day' in data or 'start_day' in data:
        start_raw = data.get('day') if 'day' in data else data.get('start_day')
        if not start_raw:
            return jsonify({'error': 'Invalid start day'}), 400
        start_day = parse_day_value(start_raw)
        if not start_day:
            return jsonify({'error': 'Invalid start day'}), 400
        rule.start_day = start_day
    if 'end_day' in data:
        end_raw = data.get('end_day')
        if not end_raw:
            rule.end_day = None
        else:
            end_day = parse_day_value(end_raw)
            if not end_day:
                return jsonify({'error': 'Invalid end day'}), 400
            rule.end_day = end_day
    if 'frequency' in data:
        freq = (data.get('frequency') or '').lower()
        if freq in {'daily', 'weekly', 'biweekly', 'monthly', 'monthly_weekday', 'yearly', 'custom'}:
            rule.frequency = freq
    if 'interval' in data:
        try:
            rule.interval = max(int(data['interval']), 1)
        except (TypeError, ValueError):
            pass
    if 'interval_unit' in data:
        unit = (data.get('interval_unit') or '').lower()
        if unit in {'days', 'weeks', 'months', 'years'}:
            rule.interval_unit = unit
    if 'days_of_week' in data:
        rule.days_of_week = ','.join(str(d) for d in parse_days_of_week(data.get('days_of_week'))) or None
    if 'day_of_month' in data:
        try:
            dom = int(data['day_of_month']) if data['day_of_month'] else None
            if dom is None or 1 <= dom <= 31:
                rule.day_of_month = dom
        except (TypeError, ValueError):
            pass
    if 'month_of_year' in data:
        try:
            moy = int(data['month_of_year']) if data['month_of_year'] else None
            if moy is None or 1 <= moy <= 12:
                rule.month_of_year = moy
        except (TypeError, ValueError):
            pass
    if 'week_of_month' in data:
        try:
            wom = int(data['week_of_month']) if data['week_of_month'] else None
            if wom is None or 1 <= wom <= 5:
                rule.week_of_month = wom
        except (TypeError, ValueError):
            pass
    if 'weekday_of_month' in data:
        try:
            wom = int(data['weekday_of_month']) if data['weekday_of_month'] else None
            if wom is None or 0 <= wom <= 6:
                rule.weekday_of_month = wom
        except (TypeError, ValueError):
            pass

    if rule.frequency == 'monthly_weekday':
        if rule.weekday_of_month is None:
            rule.weekday_of_month = rule.start_day.weekday()
        if rule.week_of_month is None:
            rule.week_of_month = _weekday_occurrence_in_month(rule.start_day)

    db.session.commit()
    _prune_recurring_instances(rule, user.id)
    return jsonify({'id': rule.id})

def calendar_event_detail(event_id):
    import app as a
    ALLOWED_PRIORITIES = a.ALLOWED_PRIORITIES
    ALLOWED_STATUSES = a.ALLOWED_STATUSES
    CalendarEvent = a.CalendarEvent
    ENTITY_CALENDAR = a.ENTITY_CALENDAR
    RecurrenceException = a.RecurrenceException
    _cancel_reminder_job = a._cancel_reminder_job
    _event_conflicts_with_event = a._event_conflicts_with_event
    _event_conflicts_with_task = a._event_conflicts_with_task
    _next_calendar_order = a._next_calendar_order
    _normalize_calendar_item_note = a._normalize_calendar_item_note
    _schedule_reminder_job = a._schedule_reminder_job
    _task_conflicts_with_event = a._task_conflicts_with_event
    _task_conflicts_with_task = a._task_conflicts_with_task
    db = a.db
    delete_embedding = a.delete_embedding
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    parse_day_value = a.parse_day_value
    parse_time_str = a.parse_time_str
    request = a.request
    start_embedding_job = a.start_embedding_job
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    event = CalendarEvent.query.filter_by(id=event_id, user_id=user.id).first_or_404()

    if request.method == 'DELETE':
        # Cancel reminder job if exists
        _cancel_reminder_job(event)
        delete_embedding(user.id, ENTITY_CALENDAR, event.id)
        if event.recurrence_id:
            db.session.add(RecurrenceException(
                user_id=user.id,
                recurrence_id=event.recurrence_id,
                day=event.day
            ))
        db.session.delete(event)
        db.session.commit()
        return '', 204

    data = request.json or {}
    if 'title' in data:
        title = (data.get('title') or '').strip()
        if title:
            event.title = title
    if 'description' in data:
        event.description = (data.get('description') or '').strip() or None
    if 'item_note' in data:
        try:
            event.item_note = _normalize_calendar_item_note(data.get('item_note'))
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
    if 'priority' in data:
        priority = (data.get('priority') or '').lower()
        if priority in ALLOWED_PRIORITIES:
            event.priority = priority
    old_status = event.status
    status_changed = False
    if 'status' in data:
        status = data.get('status')
        if status in ALLOWED_STATUSES:
            event.status = status
            status_changed = (old_status != event.status)
    if 'is_event' in data and not event.is_phase:
        event.is_event = bool(data.get('is_event'))
    if 'allow_overlap' in data and (not event.is_phase) and (not event.is_group):
        event.allow_overlap = bool(data.get('allow_overlap'))
    if 'is_group' in data and not event.is_phase and not event.is_event:
        event.is_group = bool(data.get('is_group'))
    if 'rollover_enabled' in data:
        event.rollover_enabled = bool(data.get('rollover_enabled'))
    time_changed = False
    if 'start_time' in data:
        old_start = event.start_time
        event.start_time = parse_time_str(data.get('start_time'))
        if old_start != event.start_time:
            time_changed = True
    if 'end_time' in data:
        event.end_time = parse_time_str(data.get('end_time'))
    reminder_changed = False
    if 'reminder_minutes_before' in data:
        old_reminder = event.reminder_minutes_before
        try:
            event.reminder_minutes_before = int(data.get('reminder_minutes_before'))
        except (TypeError, ValueError):
            event.reminder_minutes_before = None
        if old_reminder != event.reminder_minutes_before:
            reminder_changed = True
    day_changed = False
    if 'day' in data:
        new_day = parse_day_value(data.get('day'))
        if not new_day:
            return jsonify({'error': 'Invalid day'}), 400
        if new_day != event.day:
            old_day = event.day
            event.day = new_day
            event.order_index = _next_calendar_order(new_day, user.id)
            day_changed = True
            if event.recurrence_id:
                db.session.add(RecurrenceException(
                    user_id=user.id,
                    recurrence_id=event.recurrence_id,
                    day=old_day
                ))
                event.recurrence_id = None
    if 'phase_id' in data and not event.is_phase:
        if data.get('phase_id') is None:
            event.phase_id = None
        else:
            try:
                pid = int(data.get('phase_id'))
            except (TypeError, ValueError):
                return jsonify({'error': 'Invalid phase_id'}), 400
            phase_obj = CalendarEvent.query.filter_by(id=pid, user_id=user.id, day=event.day, is_phase=True).first()
            if not phase_obj:
                return jsonify({'error': 'Phase not found for that day'}), 404
            event.phase_id = pid
    if 'group_id' in data and not event.is_group:
        if data.get('group_id') is None:
            event.group_id = None
        else:
            try:
                gid = int(data.get('group_id'))
            except (TypeError, ValueError):
                return jsonify({'error': 'Invalid group_id'}), 400
            group_obj = CalendarEvent.query.filter_by(id=gid, user_id=user.id, day=event.day, is_group=True).first()
            if not group_obj:
                return jsonify({'error': 'Group not found for that day'}), 404
            event.group_id = gid

    force_overlap = bool(data.get('force_overlap'))
    if (not event.is_phase) and (not event.is_group) and event.start_time and not force_overlap:
        if not event.is_event:
            conflict = _task_conflicts_with_event(
                user.id,
                event.day,
                event.start_time,
                event.end_time,
                event.allow_overlap,
                exclude_event_id=event.id
            )
            if conflict:
                db.session.rollback()
                return jsonify({
                    'conflict_warning': True,
                    'message': f'"{conflict.title}" is scheduled during this time. Update task anyway?',
                    'conflict_event_id': conflict.id,
                    'conflict_event_title': conflict.title
                }), 409
            conflict = _task_conflicts_with_task(
                user.id,
                event.day,
                event.start_time,
                event.end_time,
                event.allow_overlap,
                exclude_event_id=event.id
            )
            if conflict:
                db.session.rollback()
                return jsonify({
                    'conflict_warning': True,
                    'message': f'"{conflict.title}" is scheduled during this time. Update task anyway?',
                    'conflict_event_id': conflict.id,
                    'conflict_event_title': conflict.title
                }), 409
        else:
            conflict = _event_conflicts_with_event(
                user.id,
                event.day,
                event.start_time,
                event.end_time,
                event.allow_overlap,
                exclude_event_id=event.id
            )
            if conflict:
                db.session.rollback()
                return jsonify({
                    'conflict_warning': True,
                    'message': f'"{conflict.title}" is scheduled during this time. Update event anyway?',
                    'conflict_event_id': conflict.id,
                    'conflict_event_title': conflict.title
                }), 409
            conflict = _event_conflicts_with_task(
                user.id,
                event.day,
                event.start_time,
                event.end_time,
                event.allow_overlap,
                exclude_event_id=event.id
            )
            if conflict:
                db.session.rollback()
                return jsonify({
                    'conflict_warning': True,
                    'message': f'"{conflict.title}" is scheduled during this time. Update event anyway?',
                    'conflict_event_id': conflict.id,
                    'conflict_event_title': conflict.title
                }), 409

    if status_changed:
        if event.status in {'done', 'canceled'}:
            _cancel_reminder_job(event)
            event.reminder_sent = True
            event.reminder_snoozed_until = None
        elif old_status in {'done', 'canceled'}:
            event.reminder_sent = False
    db.session.commit()
    start_embedding_job(user.id, ENTITY_CALENDAR, event.id)

    # Reschedule reminder if relevant fields changed
    if event.status not in {'done', 'canceled'}:
        needs_reschedule = reminder_changed or time_changed or day_changed or (status_changed and old_status in {'done', 'canceled'})
        if needs_reschedule and event.reminder_minutes_before is not None:
            if event.start_time:
                _schedule_reminder_job(event)
            else:
                _cancel_reminder_job(event)
        elif reminder_changed and event.reminder_minutes_before is None:
            # Reminder was removed
            _cancel_reminder_job(event)

    return jsonify(event.to_dict())
