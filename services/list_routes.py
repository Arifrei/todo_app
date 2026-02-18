"""List-centric routes extracted from app.py for readability."""


def handle_lists():
    import app as a

    ENTITY_TODO_LIST = a.ENTITY_TODO_LIST
    TodoItem = a.TodoItem
    TodoList = a.TodoList
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    request = a.request
    start_embedding_job = a.start_embedding_job

    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        title = (data.get('title') or '').strip()
        if not title:
            return jsonify({'error': 'title is required'}), 400
        list_type = data.get('type', 'list')
        order_query = db.session.query(db.func.coalesce(db.func.max(TodoList.order_index), 0)).filter(
            TodoList.user_id == user.id,
            TodoList.type == list_type
        ).outerjoin(TodoItem, TodoList.id == TodoItem.linked_list_id).filter(TodoItem.id.is_(None))
        next_order = (order_query.scalar() or 0) + 1
        new_list = TodoList(title=title, type=list_type, user_id=user.id, order_index=next_order)
        db.session.add(new_list)
        db.session.commit()
        start_embedding_job(user.id, ENTITY_TODO_LIST, new_list.id)
        return jsonify(new_list.to_dict()), 201

    include_children = (request.args.get('include_children', 'false').lower() in ['1', 'true', 'yes', 'on'])
    query = TodoList.query.filter_by(user_id=user.id)
    if not include_children:
        query = query.outerjoin(TodoItem, TodoList.id == TodoItem.linked_list_id).filter(TodoItem.id.is_(None))
    list_type = request.args.get('type')
    if list_type:
        query = query.filter(TodoList.type == list_type)
    lists = query.order_by(TodoList.order_index.asc(), TodoList.id.asc()).all()
    return jsonify([l.to_dict() for l in lists])


def reorder_lists():
    import app as a

    TodoList = a.TodoList
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    request = a.request

    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    data = request.get_json(silent=True) or {}
    ids = data.get('ids')
    list_type = data.get('type')
    if not isinstance(ids, list) or not ids:
        return jsonify({'error': 'ids array required'}), 400

    query = TodoList.query.filter(TodoList.user_id == user.id, TodoList.id.in_(ids))
    if list_type in ['hub', 'list', 'light']:
        query = query.filter(TodoList.type == list_type)
    lists = query.all()
    list_map = {l.id: l for l in lists}
    order_val = 1
    for raw_id in ids:
        try:
            lid = int(raw_id)
        except (ValueError, TypeError):
            continue
        item = list_map.get(lid)
        if item:
            item.order_index = order_val
            order_val += 1
    db.session.commit()
    return jsonify({'updated': order_val - 1})


def handle_list(list_id):
    import app as a

    CalendarEvent = a.CalendarEvent
    ENTITY_CALENDAR = a.ENTITY_CALENDAR
    ENTITY_TODO_ITEM = a.ENTITY_TODO_ITEM
    ENTITY_TODO_LIST = a.ENTITY_TODO_LIST
    TodoList = a.TodoList
    _cancel_reminder_job = a._cancel_reminder_job
    canonicalize_phase_flags = a.canonicalize_phase_flags
    db = a.db
    delete_embedding = a.delete_embedding
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    request = a.request
    start_embedding_job = a.start_embedding_job
    start_list_children_embedding_job = a.start_list_children_embedding_job

    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id).first_or_404()
    canonicalize_phase_flags(todo_list, commit_callback=db.session.commit)

    if request.method == 'DELETE':
        todo_item_ids_to_remove = set()
        for item in (todo_list.items or []):
            todo_item_ids_to_remove.add(item.id)
            if item.linked_list:
                for child_item in (item.linked_list.items or []):
                    todo_item_ids_to_remove.add(child_item.id)
        if todo_item_ids_to_remove:
            linked_events = CalendarEvent.query.filter(
                CalendarEvent.user_id == user.id,
                CalendarEvent.todo_item_id.in_(list(todo_item_ids_to_remove))
            ).all()
            for linked_event in linked_events:
                _cancel_reminder_job(linked_event)
                delete_embedding(user.id, ENTITY_CALENDAR, linked_event.id)
                db.session.delete(linked_event)
        for item in todo_list.items:
            if item.linked_list:
                delete_embedding(user.id, ENTITY_TODO_LIST, item.linked_list.id)
                db.session.delete(item.linked_list)
            delete_embedding(user.id, ENTITY_TODO_ITEM, item.id)
        db.session.delete(todo_list)
        delete_embedding(user.id, ENTITY_TODO_LIST, todo_list.id)
        db.session.commit()
        return '', 204

    if request.method == 'PUT':
        data = request.get_json(silent=True) or {}
        title = (data.get('title') or '').strip()
        if not title:
            return jsonify({'error': 'title is required'}), 400
        todo_list.title = title
        db.session.commit()
        start_embedding_job(user.id, ENTITY_TODO_LIST, todo_list.id)
        start_list_children_embedding_job(user.id, todo_list.id)
        return jsonify(todo_list.to_dict())

    return jsonify(todo_list.to_dict())
