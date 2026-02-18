"""Extracted heavy route handlers from app.py."""

def handle_item(item_id):
    import app as a
    CalendarEvent = a.CalendarEvent
    ENTITY_CALENDAR = a.ENTITY_CALENDAR
    ENTITY_TODO_ITEM = a.ENTITY_TODO_ITEM
    ENTITY_TODO_LIST = a.ENTITY_TODO_LIST
    TodoItem = a.TodoItem
    TodoList = a.TodoList
    _cancel_reminder_job = a._cancel_reminder_job
    _next_calendar_order = a._next_calendar_order
    _schedule_reminder_job = a._schedule_reminder_job
    datetime = a.datetime
    db = a.db
    delete_embedding = a.delete_embedding
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    parse_day_value = a.parse_day_value
    pytz = a.pytz
    request = a.request
    start_embedding_job = a.start_embedding_job
    tags_to_string = a.tags_to_string
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    # Verify the item belongs to a list owned by the current user
    item = TodoItem.query.select_from(TodoItem).join(TodoList, TodoItem.list_id == TodoList.id).filter(
        TodoItem.id == item_id,
        TodoList.user_id == user.id
    ).first_or_404()
    
    if request.method == 'DELETE':
        # If it has a linked list, should we delete it? 
        # For now, let's say yes, cascade delete is handled by DB relationship if configured, 
        # but we might need manual cleanup if not strict. 
        # models.py has cascade="all, delete-orphan" on the parent list side, 
        # but the linked_list is a separate relationship.
        phase_id = item.phase_id
        todo_item_ids_to_remove = {item.id}
        if item.linked_list:
            for child_item in (item.linked_list.items or []):
                todo_item_ids_to_remove.add(child_item.id)
        linked_events = CalendarEvent.query.filter(
            CalendarEvent.user_id == user.id,
            CalendarEvent.todo_item_id.in_(list(todo_item_ids_to_remove))
        ).all()
        for linked_event in linked_events:
            _cancel_reminder_job(linked_event)
            delete_embedding(user.id, ENTITY_CALENDAR, linked_event.id)
            db.session.delete(linked_event)
        if item.linked_list:
            delete_embedding(user.id, ENTITY_TODO_LIST, item.linked_list.id)
            db.session.delete(item.linked_list)
            
        delete_embedding(user.id, ENTITY_TODO_ITEM, item.id)
        db.session.delete(item)
        db.session.flush()
        if phase_id:
            phase_item = db.session.get(TodoItem, phase_id)
            if phase_item:
                phase_item.update_phase_status()
        db.session.commit()
        return '', 204
        
    if request.method == 'PUT':
        data = request.json or {}
        old_due_date = item.due_date
        old_status = item.status
        calendar_event_ids_to_refresh = set()
        if 'dependency_ids' in data:
            if not item.list or item.list.type != 'list':
                return jsonify({'error': 'Dependencies are only supported for task lists'}), 400
            raw_ids = data.get('dependency_ids')
            if raw_ids is None:
                dependency_ids = []
            elif not isinstance(raw_ids, list):
                return jsonify({'error': 'dependency_ids must be a list'}), 400
            else:
                dependency_ids = []
                for raw_id in raw_ids:
                    try:
                        dependency_ids.append(int(raw_id))
                    except (TypeError, ValueError):
                        continue
            dependency_ids = [dep_id for dep_id in dependency_ids if dep_id != item.id]
            if dependency_ids:
                deps = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
                    TodoItem.id.in_(dependency_ids),
                    TodoList.user_id == user.id,
                    TodoList.type == 'list',
                    TodoItem.is_phase.is_(False)
                ).all()
                if len(deps) != len(set(dependency_ids)):
                    db.session.rollback()
                    return jsonify({'error': 'Invalid dependency selection'}), 400
                item.dependencies = deps
            else:
                item.dependencies = []
        new_status = data.get('status', item.status)
        allowed_statuses = {'not_started', 'in_progress', 'done'}
        if new_status not in allowed_statuses:
            new_status = item.status
        if new_status == 'done':
            blockers = [dep for dep in (item.dependencies or []) if dep.status != 'done']
            if blockers:
                db.session.rollback()
                return jsonify({'error': 'Task is blocked by incomplete dependencies.'}), 409
        if new_status == 'done':
            if item.status != 'done' or not item.completed_at:
                item.completed_at = datetime.now(pytz.UTC).replace(tzinfo=None)
        else:
            item.completed_at = None
        item.status = new_status
        item.content = data.get('content', item.content)
        item.description = data.get('description', item.description)
        item.notes = data.get('notes', item.notes)
        if 'tags' in data:
            if item.list and item.list.type == 'light':
                item.tags = None
            else:
                tags_value = tags_to_string(data.get('tags'))
                item.tags = tags_value if tags_value else None
        if 'due_date' in data:
            due_date_raw = data.get('due_date')
            item.due_date = parse_day_value(due_date_raw) if due_date_raw else None
            if old_due_date != item.due_date:
                linked_events = CalendarEvent.query.filter_by(user_id=user.id, todo_item_id=item.id).all()
                if linked_events:
                    if item.due_date:
                        primary = next((linked_event for linked_event in linked_events if linked_event.day == item.due_date), None)
                        if primary is None:
                            primary = linked_events[0]
                            primary.day = item.due_date
                            primary.order_index = _next_calendar_order(item.due_date, user.id)
                        for linked_event in linked_events:
                            if linked_event.id == primary.id:
                                continue
                            _cancel_reminder_job(linked_event)
                            delete_embedding(user.id, ENTITY_CALENDAR, linked_event.id)
                            db.session.delete(linked_event)
                        if primary.reminder_minutes_before is not None and primary.start_time:
                            _schedule_reminder_job(primary)
                        calendar_event_ids_to_refresh.add(primary.id)
                    else:
                        for linked_event in linked_events:
                            _cancel_reminder_job(linked_event)
                            delete_embedding(user.id, ENTITY_CALENDAR, linked_event.id)
                            db.session.delete(linked_event)

        if old_status != new_status:
            linked_events = CalendarEvent.query.filter_by(user_id=user.id, todo_item_id=item.id).all()
            for linked_event in linked_events:
                linked_event.status = new_status
                calendar_event_ids_to_refresh.add(linked_event.id)
                if new_status == 'done':
                    _cancel_reminder_job(linked_event)
                    linked_event.reminder_sent = True
                    linked_event.reminder_snoozed_until = None
                elif old_status == 'done':
                    linked_event.reminder_sent = False
                    if linked_event.reminder_minutes_before is not None and linked_event.start_time:
                        _schedule_reminder_job(linked_event)

        # If this task's status changed and it belongs to a phase, update phase status
        if old_status != new_status and item.phase_id:
            phase_item = db.session.get(TodoItem, item.phase_id)
            if phase_item:
                phase_item.update_phase_status()

        db.session.commit()
        start_embedding_job(user.id, ENTITY_TODO_ITEM, item.id)
        for event_id in calendar_event_ids_to_refresh:
            start_embedding_job(user.id, ENTITY_CALENDAR, event_id)
        return jsonify(item.to_dict())

def create_item(list_id):
    import app as a
    ENTITY_TODO_ITEM = a.ENTITY_TODO_ITEM
    ENTITY_TODO_LIST = a.ENTITY_TODO_LIST
    TodoItem = a.TodoItem
    TodoList = a.TodoList
    datetime = a.datetime
    db = a.db
    get_current_user = a.get_current_user
    insert_item_in_order = a.insert_item_in_order
    jsonify = a.jsonify
    parse_day_value = a.parse_day_value
    pytz = a.pytz
    request = a.request
    start_embedding_job = a.start_embedding_job
    tags_to_string = a.tags_to_string
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id).first_or_404()
    data = request.get_json(silent=True) or {}
    content = (data.get('content') or '').strip()
    if not content:
        return jsonify({'error': 'content is required'}), 400
    description = data.get('description', '')
    notes = data.get('notes', '')
    tags_raw = data.get('tags')
    is_project = data.get('is_project', False)
    project_type = data.get('project_type', 'list') # Default to 'list'
    phase_id = data.get('phase_id')
    status = data.get('status', 'not_started')
    is_phase_item = bool(data.get('is_phase')) or status == 'phase'
    due_date_raw = data.get('due_date')
    due_date = parse_day_value(due_date_raw) if due_date_raw else None
    allowed_statuses = {'not_started', 'in_progress', 'done'}
    if status not in allowed_statuses:
        status = 'not_started'
    if is_phase_item or is_project:
        status = 'not_started'
    if todo_list.type == 'light':
        is_project = False
        is_phase_item = False
        phase_id = None
        tags_raw = None
    next_order = db.session.query(db.func.coalesce(db.func.max(TodoItem.order_index), 0)).filter_by(list_id=list_id).scalar() + 1
    tags = tags_to_string(tags_raw) if todo_list.type != 'light' else None
    new_item = TodoItem(
        list_id=list_id,
        content=content,
        description=description,
        notes=notes,
        tags=tags if tags else None,
        status=status,
        order_index=next_order,
        phase_id=int(phase_id) if (phase_id and not is_phase_item and todo_list.type == 'list') else None,
        is_phase=is_phase_item,
        due_date=due_date
    )
    if status == 'done' and not is_phase_item:
        new_item.completed_at = datetime.now(pytz.UTC).replace(tzinfo=None)
    
    if is_project:
        # Automatically create a child list
        child_list = TodoList(title=content, type=project_type, user_id=user.id)
        db.session.add(child_list)
        db.session.flush() # Get ID
        new_item.linked_list_id = child_list.id
    
    db.session.add(new_item)
    db.session.flush()

    # If adding to a specific phase within a list, place it underneath that phase
    if not is_project and phase_id and todo_list.type == 'list':
        try:
            phase_id_int = int(phase_id)
        except (TypeError, ValueError):
            phase_id_int = None
        insert_item_in_order(todo_list, new_item, phase_id=phase_id_int)
        # Update the phase status (mark as incomplete if it was done)
        if phase_id_int:
            phase_item = db.session.get(TodoItem, phase_id_int)
            if phase_item:
                phase_item.update_phase_status()
    else:
        insert_item_in_order(todo_list, new_item)

    db.session.commit()
    start_embedding_job(user.id, ENTITY_TODO_ITEM, new_item.id)
    if is_project and new_item.linked_list_id:
        start_embedding_job(user.id, ENTITY_TODO_LIST, new_item.linked_list_id)
    return jsonify(new_item.to_dict()), 201

def move_item(item_id):
    import app as a
    ENTITY_TODO_ITEM = a.ENTITY_TODO_ITEM
    TodoItem = a.TodoItem
    TodoList = a.TodoList
    db = a.db
    delete_embedding = a.delete_embedding
    get_current_user = a.get_current_user
    insert_item_in_order = a.insert_item_in_order
    insert_items_under_phase = a.insert_items_under_phase
    is_phase_header = a.is_phase_header
    jsonify = a.jsonify
    reindex_list = a.reindex_list
    request = a.request
    start_embedding_job = a.start_embedding_job
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    # Verify the item belongs to a list owned by the current user
    item = TodoItem.query.select_from(TodoItem).join(TodoList, TodoItem.list_id == TodoList.id).filter(
        TodoItem.id == item_id,
        TodoList.user_id == user.id
    ).first_or_404()
    data = request.json or {}
    dest_hub_id = data.get('destination_hub_id')
    dest_list_id = data.get('destination_list_id')
    dest_phase_id = data.get('destination_phase_id')

    # Prevent moving phase headers for now
    if is_phase_header(item):
        return jsonify({'error': 'Cannot move a phase header.'}), 400

    # --- Moving a Project to another Hub ---
    if item.linked_list_id:
        if dest_hub_id in [None, '', 'null', 'none']:
            child_list = item.linked_list
            if not child_list:
                return jsonify({'error': 'Project list not found'}), 404
            order_query = db.session.query(db.func.coalesce(db.func.max(TodoList.order_index), 0)).filter(
                TodoList.user_id == user.id,
                TodoList.type == child_list.type
            ).outerjoin(TodoItem, TodoList.id == TodoItem.linked_list_id).filter(TodoItem.id.is_(None))
            child_list.order_index = (order_query.scalar() or 0) + 1
            hub_list = item.list
            delete_embedding(user.id, ENTITY_TODO_ITEM, item.id)
            db.session.delete(item)
            db.session.flush()
            if hub_list:
                reindex_list(hub_list)
            db.session.commit()
            return jsonify({'message': 'Moved to main page'})

        try:
            dest_hub_id = int(dest_hub_id)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid destination hub ID'}), 400

        dest_hub = TodoList.query.filter_by(id=dest_hub_id, user_id=user.id, type='hub').first()
        if not dest_hub:
            return jsonify({'error': 'Destination is not a valid hub'}), 404

        item.list_id = dest_hub_id
        db.session.flush()
        insert_item_in_order(dest_hub, item)
        db.session.commit()
        start_embedding_job(user.id, ENTITY_TODO_ITEM, item.id)
        return jsonify({'message': f'Moved to {dest_hub.title}'})

    # --- Moving a Task to another list/phase ---
    if dest_list_id is None:
        return jsonify({'error': 'destination_list_id is required for tasks'}), 400

    try:
        dest_list_id = int(dest_list_id)
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid destination list ID'}), 400

    dest_list = TodoList.query.filter(
        TodoList.id == dest_list_id,
        TodoList.user_id == user.id,
        TodoList.type.in_(['list', 'light'])
    ).first()
    if not dest_list:
        return jsonify({'error': 'Destination is not a valid task list'}), 404

    # Validate destination phase (optional)
    phase_obj = None
    if dest_phase_id is not None and dest_list.type == 'list':
        try:
            dest_phase_id_int = int(dest_phase_id)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid destination phase ID'}), 400
        phase_obj = db.session.get(TodoItem, dest_phase_id_int)
        if not phase_obj or phase_obj.list_id != dest_list.id or not is_phase_header(phase_obj):
            return jsonify({'error': 'Destination phase not found in that project'}), 404
        dest_phase_id = dest_phase_id_int
    else:
        dest_phase_id = None
    if dest_list.type == 'light':
        dest_phase_id = None

    old_list = item.list
    old_phase_id = item.phase_id
    item.list_id = dest_list.id
    item.phase_id = dest_phase_id
    db.session.flush()

    insert_items_under_phase(dest_list, [item], phase_id=dest_phase_id)

    if old_list and old_list.id != dest_list.id:
        reindex_list(old_list)

    if old_phase_id:
        old_phase = db.session.get(TodoItem, old_phase_id)
        if old_phase:
            old_phase.update_phase_status()
    if dest_phase_id:
        new_phase = db.session.get(TodoItem, dest_phase_id)
        if new_phase:
            new_phase.update_phase_status()

    db.session.commit()
    start_embedding_job(user.id, ENTITY_TODO_ITEM, item.id)
    return jsonify({'message': 'Task moved successfully'})

def bulk_import(list_id):
    import app as a
    ENTITY_TODO_ITEM = a.ENTITY_TODO_ITEM
    ENTITY_TODO_LIST = a.ENTITY_TODO_LIST
    TodoItem = a.TodoItem
    TodoList = a.TodoList
    datetime = a.datetime
    db = a.db
    get_current_user = a.get_current_user
    insert_item_in_order = a.insert_item_in_order
    jsonify = a.jsonify
    parse_outline = a.parse_outline
    pytz = a.pytz
    request = a.request
    start_embedding_job = a.start_embedding_job
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id).first_or_404()
    data = request.json or {}
    outline = data.get('outline', '')

    if not outline.strip():
        return jsonify({'error': 'Outline text is required'}), 400

    parsed_items = parse_outline(outline, list_type=todo_list.type)
    created_items = []
    created_lists = []

    if todo_list.type == 'hub':
        # For hubs, parsed_items is a list of projects
        for project_data in parsed_items:
            # Create the main project item in the hub
            project_item = TodoItem(
                list_id=todo_list.id,
                content=project_data['content'],
                description=project_data.get('description'),
                notes=project_data.get('notes'),
                status='not_started'
            )
            # Create the child list for this project
            child_list = TodoList(title=project_data['content'], type=project_data.get('project_type', 'list'), user_id=user.id)
            db.session.add(child_list)
            db.session.flush() # Get ID for child_list
            project_item.linked_list_id = child_list.id
            db.session.add(project_item)
            created_items.append(project_item)
            created_lists.append(child_list)

            # Add phases and tasks to the child list
            for item_data in project_data.get('items', []):
                status = item_data.get('status', 'not_started')
                is_phase = bool(item_data.get('is_phase')) or status == 'phase'
                if status not in ['not_started', 'in_progress', 'done']:
                    status = 'not_started'
                if is_phase:
                    status = 'not_started'
                child_item = TodoItem(
                    list_id=child_list.id,
                    content=item_data.get('content', ''),
                    description=item_data.get('description'),
                    notes=item_data.get('notes'),
                    status=status,
                    is_phase=is_phase
                )
                if status == 'done' and not is_phase:
                    child_item.completed_at = datetime.now(pytz.UTC).replace(tzinfo=None)
                db.session.add(child_item)
                created_items.append(child_item)
    else:
        # For simple lists, parsed_items is a flat list of tasks/phases
        for entry in parsed_items:
            content = entry.get('content', '').strip()
            if not content:
                continue
            status = entry.get('status', 'not_started')
            is_phase = bool(entry.get('is_phase')) or status == 'phase'
            if status not in ['not_started', 'in_progress', 'done']:
                status = 'not_started'
            if is_phase:
                status = 'not_started'
            new_item = TodoItem(
                list_id=todo_list.id,
                content=content,
                status=status,
                description=entry.get('description'),
                notes=entry.get('notes'),
                is_phase=is_phase
            )
            if status == 'done' and not is_phase:
                new_item.completed_at = datetime.now(pytz.UTC).replace(tzinfo=None)
            db.session.add(new_item)
            created_items.append(new_item)

    if not created_items:
        return jsonify({'error': 'No items were parsed from the outline'}), 400

    db.session.commit()
    # Re-order all items after bulk creation
    for item in created_items:
        insert_item_in_order(item.list, item)
    db.session.commit()
    for item in created_items:
        start_embedding_job(user.id, ENTITY_TODO_ITEM, item.id)
    for child_list in created_lists:
        start_embedding_job(user.id, ENTITY_TODO_LIST, child_list.id)
    return jsonify([item.to_dict() for item in created_items]), 201

def bulk_items():
    import app as a
    CalendarEvent = a.CalendarEvent
    ENTITY_CALENDAR = a.ENTITY_CALENDAR
    ENTITY_TODO_ITEM = a.ENTITY_TODO_ITEM
    ENTITY_TODO_LIST = a.ENTITY_TODO_LIST
    TodoItem = a.TodoItem
    TodoList = a.TodoList
    _cancel_reminder_job = a._cancel_reminder_job
    _schedule_reminder_job = a._schedule_reminder_job
    datetime = a.datetime
    db = a.db
    delete_embedding = a.delete_embedding
    get_current_user = a.get_current_user
    insert_items_under_phase = a.insert_items_under_phase
    is_phase_header = a.is_phase_header
    jsonify = a.jsonify
    normalize_tags = a.normalize_tags
    pytz = a.pytz
    reindex_list = a.reindex_list
    request = a.request
    start_embedding_job = a.start_embedding_job
    tags_to_string = a.tags_to_string
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    data = request.json or {}
    raw_ids = data.get('ids') or []
    action = data.get('action')
    list_id = data.get('list_id')

    if not raw_ids or not isinstance(raw_ids, list):
        return jsonify({'error': 'ids list is required'}), 400
    if action not in ['status', 'delete', 'move', 'add_tag']:
        return jsonify({'error': 'action must be status, delete, move, or add_tag'}), 400

    # Normalize IDs to integers
    ids = []
    for raw_id in raw_ids:
        try:
            ids.append(int(raw_id))
        except (ValueError, TypeError):
            continue
    if not ids:
        return jsonify({'error': 'No valid item ids provided'}), 400

    # Filter items by user ownership
    items = TodoItem.query.select_from(TodoItem).join(TodoList, TodoItem.list_id == TodoList.id).filter(
        TodoItem.id.in_(ids),
        TodoList.user_id == user.id
    ).all()

    if list_id is not None:
        try:
            list_id_int = int(list_id)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid list_id'}), 400
        items = [i for i in items if i.list_id == list_id_int]
        list_id = list_id_int

    if not items:
        return jsonify({'error': 'No matching items found'}), 404

    if action == 'status':
        status = data.get('status')
        if status not in ['not_started', 'in_progress', 'done', 'phase']:
            return jsonify({'error': 'invalid status'}), 400
        if status == 'done':
            blocked = [
                item for item in items
                if not is_phase_header(item)
                and hasattr(item, 'dependencies')
                and any(dep.status != 'done' for dep in (item.dependencies or []))
            ]
            if blocked:
                return jsonify({'error': f'{len(blocked)} task(s) are blocked by dependencies.'}), 409

        affected_phases = set()
        calendar_event_ids_to_refresh = set()
        events_to_reschedule = []
        for item in items:
            # Avoid changing phases to task statuses inadvertently
            if is_phase_header(item):
                continue
            old_status = item.status
            if status == 'done':
                if item.status != 'done' or not item.completed_at:
                    item.completed_at = datetime.now(pytz.UTC).replace(tzinfo=None)
            else:
                item.completed_at = None
            item.status = status
            if item.phase_id:
                affected_phases.add(item.phase_id)
            if old_status != item.status:
                linked_events = CalendarEvent.query.filter_by(user_id=user.id, todo_item_id=item.id).all()
                for linked_event in linked_events:
                    linked_event.status = item.status
                    calendar_event_ids_to_refresh.add(linked_event.id)
                    if item.status == 'done':
                        _cancel_reminder_job(linked_event)
                        linked_event.reminder_sent = True
                        linked_event.reminder_snoozed_until = None
                    elif old_status == 'done':
                        linked_event.reminder_sent = False
                        if linked_event.reminder_minutes_before is not None and linked_event.start_time:
                            events_to_reschedule.append(linked_event)

        # Update all affected phase statuses
        for phase_id in affected_phases:
            phase_item = db.session.get(TodoItem, phase_id)
            if phase_item:
                phase_item.update_phase_status()

        db.session.commit()
        for linked_event in events_to_reschedule:
            _schedule_reminder_job(linked_event)
        for event_id in calendar_event_ids_to_refresh:
            start_embedding_job(user.id, ENTITY_CALENDAR, event_id)
        return jsonify({'updated': len(items)})

    if action == 'add_tag':
        tag_value = data.get('tag') or data.get('tags')
        tags_to_add = normalize_tags(tag_value)
        if not tags_to_add:
            return jsonify({'error': 'tag is required'}), 400

        updated = 0
        for item in items:
            if is_phase_header(item):
                continue
            if item.list and item.list.type == 'light':
                continue
            current_tags = normalize_tags(item.tags)
            changed = False
            for tag in tags_to_add:
                if tag not in current_tags:
                    current_tags.append(tag)
                    changed = True
            if changed:
                item.tags = tags_to_string(current_tags)
                updated += 1

        db.session.commit()
        return jsonify({'updated': updated})

    if action == 'delete':
        todo_item_ids_to_remove = set()
        for item in items:
            todo_item_ids_to_remove.add(item.id)
            if item.linked_list:
                for child_item in (item.linked_list.items or []):
                    todo_item_ids_to_remove.add(child_item.id)
        linked_events = CalendarEvent.query.filter(
            CalendarEvent.user_id == user.id,
            CalendarEvent.todo_item_id.in_(list(todo_item_ids_to_remove))
        ).all()
        for linked_event in linked_events:
            _cancel_reminder_job(linked_event)
            delete_embedding(user.id, ENTITY_CALENDAR, linked_event.id)
            db.session.delete(linked_event)
        for item in items:
            if item.linked_list:
                delete_embedding(user.id, ENTITY_TODO_LIST, item.linked_list.id)
                db.session.delete(item.linked_list)
            delete_embedding(user.id, ENTITY_TODO_ITEM, item.id)
            db.session.delete(item)
        db.session.commit()
        return jsonify({'deleted': len(items)})

    if action == 'move':
        dest_list_id = data.get('destination_list_id')
        dest_phase_id = data.get('destination_phase_id')

        if dest_list_id is None:
            return jsonify({'error': 'destination_list_id is required for move'}), 400
        try:
            dest_list_id = int(dest_list_id)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid destination list ID'}), 400

        dest_list = TodoList.query.filter(
            TodoList.id == dest_list_id,
            TodoList.user_id == user.id,
            TodoList.type.in_(['list', 'light'])
        ).first()
        if not dest_list:
            return jsonify({'error': 'Destination is not a valid task list'}), 404

        dest_phase_obj = None
        if dest_phase_id is not None and dest_list.type == 'list':
            try:
                dest_phase_id_int = int(dest_phase_id)
            except (ValueError, TypeError):
                return jsonify({'error': 'Invalid destination phase ID'}), 400
            dest_phase_obj = db.session.get(TodoItem, dest_phase_id_int)
            if not dest_phase_obj or dest_phase_obj.list_id != dest_list.id or not is_phase_header(dest_phase_obj):
                return jsonify({'error': 'Destination phase not found in that project'}), 404
            dest_phase_id = dest_phase_id_int
        else:
            dest_phase_id = None
        if dest_list.type == 'light':
            dest_phase_id = None

        # Only move regular tasks (no phases or linked projects)
        movable_items = [i for i in items if not is_phase_header(i) and not i.linked_list]
        skipped = len(items) - len(movable_items)
        if not movable_items:
            return jsonify({'error': 'No movable tasks found (cannot move phases or projects).'}), 400

        old_lists = set()
        old_phase_ids = set()

        for item in movable_items:
            if item.phase_id:
                old_phase_ids.add(item.phase_id)
            if item.list_id != dest_list.id and item.list:
                old_lists.add(item.list)
            item.list_id = dest_list.id
            item.phase_id = dest_phase_id
            # Ensure relationship collection is aware of the move before ordering
            if item not in dest_list.items:
                dest_list.items.append(item)
            db.session.flush()

        insert_items_under_phase(dest_list, movable_items, phase_id=dest_phase_id)

        for l in old_lists:
            reindex_list(l)

        # Reindex destination list to ensure contiguous ordering after multiple inserts
        dest_list_refreshed = db.session.get(TodoList, dest_list.id)
        if dest_list_refreshed:
            reindex_list(dest_list_refreshed)

        for pid in old_phase_ids:
            phase = db.session.get(TodoItem, pid)
            if phase:
                phase.update_phase_status()
        if dest_phase_id:
            dest_phase_obj = db.session.get(TodoItem, dest_phase_id)
            if dest_phase_obj:
                dest_phase_obj.update_phase_status()

        db.session.commit()
        for item in movable_items:
            start_embedding_job(user.id, ENTITY_TODO_ITEM, item.id)
        return jsonify({'moved': len(movable_items), 'skipped': skipped})

def query_items():
    import app as a
    TodoItem = a.TodoItem
    TodoList = a.TodoList
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    request = a.request
    """Query items across lists with filters for AI/clients."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    status_filter = request.args.get('status')
    list_id = request.args.get('list_id')
    phase_id = request.args.get('phase_id')
    is_phase_param = request.args.get('is_phase')
    search = request.args.get('q', '').strip()
    try:
        limit = int(request.args.get('limit', 100))
    except (ValueError, TypeError):
        limit = 100
    limit = min(max(limit, 1), 250)

    allowed_statuses = {'not_started', 'in_progress', 'done'}
    if status_filter and status_filter not in allowed_statuses:
        return jsonify({'error': 'Invalid status filter'}), 400

    query = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(TodoList.user_id == user.id)
    if list_id:
        try:
            list_id_int = int(list_id)
            query = query.filter(TodoItem.list_id == list_id_int)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid list_id'}), 400
    if phase_id:
        try:
            phase_id_int = int(phase_id)
            query = query.filter(TodoItem.phase_id == phase_id_int)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid phase_id'}), 400
    if status_filter:
        query = query.filter(TodoItem.status == status_filter)
    if is_phase_param is not None:
        is_phase_bool = is_phase_param.lower() in ['1', 'true', 'yes', 'on']
        query = query.filter(TodoItem.is_phase == is_phase_bool)
    if search:
        like_expr = f"%{search}%"
        query = query.filter(db.or_(TodoItem.content.ilike(like_expr), TodoItem.description.ilike(like_expr)))

    items = query.order_by(TodoItem.list_id, TodoItem.order_index).limit(limit).all()
    payload = []
    for item in items:
        data = item.to_dict()
        data['list_title'] = item.list.title
        data['list_type'] = item.list.type
        payload.append(data)
    return jsonify(payload)
