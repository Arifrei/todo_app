"""Extracted route handlers grouped by domain for readability."""

import app as _app_module

# Keep access to shared app context, models, helpers, and constants.
for _name, _value in vars(_app_module).items():
    if not _name.startswith('__'):
        globals()[_name] = _value

def list_items_in_list(list_id):
    """Return tasks/phases for a list with optional filters for AI/clients."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id).first_or_404()
    canonicalize_phase_flags(todo_list, commit_callback=db.session.commit)

    status_filter = request.args.get('status')
    phase_id = request.args.get('phase_id')
    include_phases = request.args.get('include_phases', 'true').lower() in ['1', 'true', 'yes', 'on']
    if todo_list.type == 'light':
        include_phases = False

    allowed_statuses = {'not_started', 'in_progress', 'done'}
    if status_filter and status_filter not in allowed_statuses:
        return jsonify({'error': 'Invalid status filter'}), 400

    items = list(todo_list.items)
    if status_filter:
        items = [i for i in items if i.status == status_filter]
    if not include_phases:
        items = [i for i in items if not is_phase_header(i)]
    if phase_id is not None:
        try:
            phase_id_int = int(phase_id)
            items = [i for i in items if i.phase_id == phase_id_int or (include_phases and i.id == phase_id_int)]
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid phase_id'}), 400

    items = sorted(items, key=lambda i: i.order_index or 0)
    return jsonify([i.to_dict() for i in items])


def search_entities():
    """Simple search across lists and items for AI resolution."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    q = (request.args.get('q') or '').strip()
    if not q:
        return jsonify({'error': 'Query parameter q is required'}), 400

    try:
        list_limit = int(request.args.get('list_limit', 20))
    except (ValueError, TypeError):
        list_limit = 20
    list_limit = min(max(list_limit, 1), 100)

    try:
        item_limit = int(request.args.get('item_limit', 50))
    except (ValueError, TypeError):
        item_limit = 50
    item_limit = min(max(item_limit, 1), 200)
    like_expr = f"%{q}%"

    lists = TodoList.query.filter(
        TodoList.user_id == user.id,
        TodoList.title.ilike(like_expr)
    ).order_by(TodoList.title.asc()).limit(list_limit).all()

    items = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
        TodoList.user_id == user.id,
        db.or_(TodoItem.content.ilike(like_expr), TodoItem.description.ilike(like_expr))
    ).order_by(TodoItem.list_id, TodoItem.order_index).limit(item_limit).all()

    return jsonify({
        'lists': [{'id': l.id, 'title': l.title, 'type': l.type} for l in lists],
        'items': [{
            'id': i.id,
            'content': i.content,
            'status': i.status,
            'is_phase': i.is_phase,
            'list_id': i.list_id,
            'list_title': i.list.title,
            'list_type': i.list.type,
            'phase_id': i.phase_id
        } for i in items]
    })



def ai_chat():
    """AI chat endpoint that routes through OpenAI with function-calling tools."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    data = request.json or {}
    messages = data.get('messages', [])
    model = data.get('model')
    try:
        result = run_ai_chat(user.id, messages, model=model)
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500
    return jsonify(result)


def move_destinations(list_id):
    """Return possible destinations for moving tasks (all project lists with their phases)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    project_lists = TodoList.query.filter(
        TodoList.user_id == user.id,
        TodoList.type.in_(['list', 'light'])
    ).all()
    payload = []
    for l in project_lists:
        canonicalize_phase_flags(l, commit_callback=db.session.commit)
        payload.append({
            'id': l.id,
            'title': l.title,
            'type': l.type,
            'phases': [{'id': i.id, 'content': i.content} for i in l.items if is_phase_header(i)] if l.type == 'list' else []
        })
    return jsonify(payload)


def list_phases(list_id):
    """Return phases for a specific project list."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id, type='list').first_or_404()
    canonicalize_phase_flags(todo_list, commit_callback=db.session.commit)
    phases = [{'id': i.id, 'content': i.content} for i in todo_list.items if is_phase_header(i)]
    return jsonify({'id': todo_list.id, 'title': todo_list.title, 'phases': phases})


def list_hubs():
    """Return all hubs for the current user (id, title)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    hubs = TodoList.query.filter_by(user_id=user.id, type='hub').all()
    return jsonify([{'id': h.id, 'title': h.title} for h in hubs])


def hub_children(hub_id):
    """Return projects/hubs within a hub for navigation."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    hub = TodoList.query.filter_by(id=hub_id, user_id=user.id, type='hub').first_or_404()
    children = []
    for item in hub.items:
        if not item.linked_list:
            continue
        child_list = item.linked_list
        canonicalize_phase_flags(child_list, commit_callback=db.session.commit)
        entry = {
            'id': child_list.id,
            'title': child_list.title,
            'type': child_list.type,
            'has_children': child_list.type == 'hub'
        }
        if child_list.type == 'list':
            entry['phases'] = [{'id': i.id, 'content': i.content} for i in child_list.items if is_phase_header(i)]
        children.append(entry)
    return jsonify({'hub': {'id': hub.id, 'title': hub.title}, 'children': children})


def export_list(list_id):
    """Export a list or hub (with nested hubs) as plain text outline."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id).first_or_404()
    canonicalize_phase_flags(todo_list, commit_callback=db.session.commit)

    lines = export_list_outline(todo_list)
    content = '\n'.join(lines)
    filename = f"{_slugify_filename(todo_list.title)}-{list_id}.txt"

    response = app.response_class(content, mimetype='text/plain; charset=utf-8')
    response.headers['Content-Disposition'] = f'attachment; filename=\"{filename}\"'
    return response


def reorder_items(list_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id).first_or_404()
    data = request.json or {}
    ordered_ids = data.get('ids', [])
    if not isinstance(ordered_ids, list) or not ordered_ids:
        return jsonify({'error': 'ids array required'}), 400

    items = {item.id: item for item in todo_list.items}
    order_val = 1
    current_phase_id = None

    for item_id in ordered_ids:
        try:
            item_id_int = int(item_id)
        except (ValueError, TypeError):
            continue
        if item_id_int in items:
            item = items[item_id_int]
            item.order_index = order_val
            order_val += 1

            # Update phase tracking and assignment based on position
            if is_phase_header(item):
                current_phase_id = item.id
            else:
                # Assign task to current phase (or None if not under any phase)
                item.phase_id = current_phase_id

    db.session.commit()
    return jsonify({'updated': len(ordered_ids)})


