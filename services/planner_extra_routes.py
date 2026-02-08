"""Extracted route handlers grouped by domain for readability."""

import app as _app_module

# Keep access to shared app context, models, helpers, and constants.
for _name, _value in vars(_app_module).items():
    if not _name.startswith('__'):
        globals()[_name] = _value

def _planner_line_type(value: str) -> str:
    raw = (value or '').strip()
    if re.match(r'^(https?://|www\.)', raw, re.IGNORECASE):
        return 'url'
    return 'text'


# Planner API


def create_planner_folder():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    payload = request.get_json() or {}
    name = (payload.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Folder name required'}), 400

    parent_id = payload.get('parent_id')
    folder_type = (payload.get('folder_type') or 'simple').strip().lower()
    if parent_id:
        parent = PlannerFolder.query.filter_by(id=parent_id, user_id=user.id).first()
        if not parent:
            return jsonify({'error': 'Parent folder not found'}), 404
        if parent.folder_type != 'multi':
            return jsonify({'error': 'Cannot create subfolder inside a simple folder'}), 400
        folder_type = parent.folder_type
    else:
        if folder_type == 'simple':
            return jsonify({'error': 'Simple folders have been replaced by tags'}), 400
        if folder_type not in ('multi',):
            return jsonify({'error': 'Invalid folder type'}), 400

    folder = PlannerFolder(
        user_id=user.id,
        parent_id=parent_id,
        name=name,
        folder_type=folder_type
    )
    db.session.add(folder)
    db.session.commit()
    return jsonify(folder.to_dict())



def update_planner_folder(folder_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    folder = PlannerFolder.query.filter_by(id=folder_id, user_id=user.id).first_or_404()
    feed_folder = _ensure_planner_feed_folder(user)
    if feed_folder and folder.id == feed_folder.id:
        return jsonify({'error': 'Feed folder cannot be modified'}), 400
    if request.method == 'DELETE':
        db.session.delete(folder)
        db.session.commit()
        return jsonify({'message': 'Deleted'})

    payload = request.get_json() or {}
    name = payload.get('name')
    if name is not None:
        folder.name = name.strip() or folder.name
    db.session.commit()
    return jsonify(folder.to_dict())



def create_planner_simple_item():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    payload = request.get_json() or {}
    title = (payload.get('title') or '').strip()
    value = (payload.get('value') or '').strip()
    description = (payload.get('description') or '').strip()
    scheduled_date = parse_day_value(payload.get('scheduled_date'))
    tags = tags_to_string(payload.get('tags'))
    if not title or not value:
        return jsonify({'error': 'Title and value required'}), 400

    feed_folder = _ensure_planner_feed_folder(user)

    item = PlannerSimpleItem(
        user_id=user.id,
        folder_id=feed_folder.id,
        title=title,
        value=value,
        description=description or None,
        scheduled_date=scheduled_date,
        tags=tags or None
    )
    db.session.add(item)
    db.session.commit()
    return jsonify(item.to_dict())



def update_planner_simple_item(item_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    item = PlannerSimpleItem.query.filter_by(id=item_id, user_id=user.id).first_or_404()

    if request.method == 'DELETE':
        db.session.delete(item)
        db.session.commit()
        return jsonify({'message': 'Deleted'})

    payload = request.get_json() or {}
    if 'title' in payload:
        item.title = (payload.get('title') or '').strip() or item.title
    if 'value' in payload:
        item.value = (payload.get('value') or '').strip() or item.value
    if 'description' in payload:
        item.description = (payload.get('description') or '').strip() or None
    if 'tags' in payload:
        item.tags = tags_to_string(payload.get('tags')) or None
    if 'scheduled_date' in payload:
        item.scheduled_date = parse_day_value(payload.get('scheduled_date'))
    if 'folder_id' in payload:
        feed_folder = _ensure_planner_feed_folder(user)
        item.folder_id = feed_folder.id

    db.session.commit()
    return jsonify(item.to_dict())



def planner_simple_item_to_recall(item_id):
    """Convert a planner simple item into a recall and remove it from the planner."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    item = PlannerSimpleItem.query.filter_by(id=item_id, user_id=user.id).first_or_404()
    title = (item.title or '').strip()
    value = (item.value or '').strip()
    description = (item.description or '').strip()
    if not title or not value:
        return jsonify({'error': 'Planner item is missing title or value'}), 400

    payload_type = _planner_line_type(value)
    payload = value
    if payload_type == 'url' and payload.lower().startswith('www.'):
        payload = f"https://{payload}"

    recall = RecallItem(
        user_id=user.id,
        title=title,
        payload_type=payload_type,
        payload=payload,
        when_context='future',
        why=description or '',
        ai_status='pending'
    )
    db.session.add(recall)
    db.session.delete(item)
    db.session.commit()

    start_embedding_job(user.id, ENTITY_RECALL, recall.id)
    start_recall_processing(recall.id)

    return jsonify({'recall': recall.to_dict(), 'deleted_id': item_id}), 201



def create_planner_group():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    payload = request.get_json() or {}
    folder_id = payload.get('folder_id')
    title = (payload.get('title') or '').strip()
    if not folder_id or not title:
        return jsonify({'error': 'Folder and title required'}), 400

    folder = PlannerFolder.query.filter_by(id=folder_id, user_id=user.id).first()
    if not folder:
        return jsonify({'error': 'Folder not found'}), 404
    if folder.folder_type != 'multi':
        return jsonify({'error': 'Groups can only be added to multi folders'}), 400

    group = PlannerGroup(
        user_id=user.id,
        folder_id=folder_id,
        title=title
    )
    db.session.add(group)
    db.session.commit()
    return jsonify(group.to_dict())



def update_planner_group(group_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    group = PlannerGroup.query.filter_by(id=group_id, user_id=user.id).first_or_404()

    if request.method == 'DELETE':
        db.session.delete(group)
        db.session.commit()
        return jsonify({'message': 'Deleted'})

    payload = request.get_json() or {}
    if 'title' in payload:
        group.title = (payload.get('title') or '').strip() or group.title
    if 'folder_id' in payload:
        new_folder_id = payload.get('folder_id')
        if new_folder_id and new_folder_id != group.folder_id:
            folder = PlannerFolder.query.filter_by(id=new_folder_id, user_id=user.id).first()
            if not folder:
                return jsonify({'error': 'Folder not found'}), 404
            if folder.folder_type != 'multi':
                return jsonify({'error': 'Groups can only move to multi folders'}), 400
            group.folder_id = new_folder_id
            PlannerMultiItem.query.filter_by(group_id=group.id, user_id=user.id).update(
                {'folder_id': new_folder_id}
            )

    db.session.commit()
    return jsonify(group.to_dict())



def update_planner_multi_item(item_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    item = PlannerMultiItem.query.filter_by(id=item_id, user_id=user.id).first_or_404()

    if request.method == 'DELETE':
        db.session.delete(item)
        db.session.commit()
        return jsonify({'message': 'Deleted'})

    payload = request.get_json() or {}
    if 'title' in payload:
        item.title = (payload.get('title') or '').strip() or item.title
    if 'scheduled_date' in payload:
        item.scheduled_date = parse_day_value(payload.get('scheduled_date'))

    if 'group_id' in payload:
        group_id = payload.get('group_id')
        if group_id:
            group = PlannerGroup.query.filter_by(id=group_id, user_id=user.id).first()
            if not group:
                return jsonify({'error': 'Group not found'}), 404
            item.group_id = group.id
            item.folder_id = group.folder_id
        else:
            item.group_id = None

    if 'folder_id' in payload:
        new_folder_id = payload.get('folder_id')
        if new_folder_id and new_folder_id != item.folder_id:
            folder = PlannerFolder.query.filter_by(id=new_folder_id, user_id=user.id).first()
            if not folder:
                return jsonify({'error': 'Folder not found'}), 404
            if folder.folder_type != 'multi':
                return jsonify({'error': 'Multi items can only move to multi folders'}), 400
            item.folder_id = new_folder_id
            if 'group_id' not in payload:
                item.group_id = None

    db.session.commit()
    return jsonify(item.to_dict())



def update_planner_multi_item_order():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    payload = request.get_json() or {}
    folder_id = payload.get('folder_id')
    order = payload.get('order') or []
    if not folder_id or not isinstance(order, list):
        return jsonify({'error': 'Folder and order list required'}), 400

    folder = PlannerFolder.query.filter_by(id=folder_id, user_id=user.id).first()
    if not folder:
        return jsonify({'error': 'Folder not found'}), 404
    if folder.folder_type != 'multi':
        return jsonify({'error': 'Order can only be set for multi folders'}), 400

    items = PlannerMultiItem.query.filter_by(user_id=user.id, folder_id=folder_id).all()
    item_ids = [item.id for item in items]
    if len(order) != len(item_ids) or set(order) != set(item_ids):
        return jsonify({'error': 'Order list does not match folder items'}), 400

    items_by_id = {item.id: item for item in items}
    for index, item_id in enumerate(order):
        item = items_by_id.get(item_id)
        if item:
            item.order_index = index

    db.session.commit()
    return jsonify({'message': 'Order updated'})



def create_planner_multi_line():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    payload = request.get_json() or {}
    item_id = payload.get('item_id')
    value = (payload.get('value') or '').strip()
    scheduled_date = parse_day_value(payload.get('scheduled_date'))
    if not item_id or not value:
        return jsonify({'error': 'Item and value required'}), 400

    item = PlannerMultiItem.query.filter_by(id=item_id, user_id=user.id).first()
    if not item:
        return jsonify({'error': 'Multi item not found'}), 404

    max_order = db.session.query(func.max(PlannerMultiLine.order_index)).filter_by(
        item_id=item.id,
        user_id=user.id
    ).scalar()
    order_index = (max_order + 1) if max_order is not None else 0
    line = PlannerMultiLine(
        user_id=user.id,
        item_id=item.id,
        line_type=_planner_line_type(value),
        value=value,
        scheduled_date=scheduled_date,
        order_index=order_index
    )
    db.session.add(line)
    db.session.commit()
    return jsonify(line.to_dict())



def update_planner_multi_line(line_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    line = PlannerMultiLine.query.filter_by(id=line_id, user_id=user.id).first_or_404()

    if request.method == 'DELETE':
        db.session.delete(line)
        db.session.commit()
        return jsonify({'message': 'Deleted'})

    payload = request.get_json() or {}
    if 'value' in payload:
        value = (payload.get('value') or '').strip()
        if value:
            line.value = value
            line.line_type = _planner_line_type(value)
    if 'scheduled_date' in payload:
        line.scheduled_date = parse_day_value(payload.get('scheduled_date'))
    db.session.commit()
    return jsonify(line.to_dict())



def handle_feed():
    """List or create feed items."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    if request.method == 'GET':
        state_filter = (request.args.get('state') or '').strip().lower()
        query = DoFeedItem.query.filter_by(user_id=user.id)
        if state_filter and state_filter != 'all':
            query = query.filter(DoFeedItem.state == state_filter)
        items = query.order_by(
            DoFeedItem.updated_at.desc(),
            DoFeedItem.created_at.desc()
        ).all()
        return jsonify([item.to_dict() for item in items])

    data = request.json or {}
    title = (data.get('title') or '').strip()
    url = (data.get('url') or '').strip()
    description = (data.get('description') or '').strip() or None
    raw_state = data.get('state') or 'free'
    state = re.sub(r'\s+', ' ', str(raw_state)).strip().lower()
    if not state:
        state = 'free'

    if not title or not url:
        return jsonify({'error': 'Title and URL are required'}), 400

    new_item = DoFeedItem(
        user_id=user.id,
        title=title,
        url=url,
        description=description,
        state=state
    )
    db.session.add(new_item)
    db.session.commit()
    return jsonify(new_item.to_dict()), 201



def feed_detail(item_id):
    """Get, update, or delete a feed item."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    item = DoFeedItem.query.filter_by(id=item_id, user_id=user.id).first_or_404()

    if request.method == 'GET':
        return jsonify(item.to_dict())

    if request.method == 'PUT':
        data = request.json or {}
        if 'title' in data:
            title = (data.get('title') or '').strip()
            if not title:
                return jsonify({'error': 'Title is required'}), 400
            item.title = title
        if 'url' in data:
            url = (data.get('url') or '').strip()
            if not url:
                return jsonify({'error': 'URL is required'}), 400
            item.url = url
        if 'description' in data:
            description = (data.get('description') or '').strip()
            item.description = description or None
        if 'state' in data:
            raw_state = data.get('state') or 'free'
            state = re.sub(r'\s+', ' ', str(raw_state)).strip().lower()
            item.state = state or 'free'
        db.session.commit()
        return jsonify(item.to_dict())

    db.session.delete(item)
    db.session.commit()
    return jsonify({'message': 'Deleted'})



def feed_to_recall(item_id):
    """Convert a feed item into a recall and remove it from the feed."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    item = DoFeedItem.query.filter_by(id=item_id, user_id=user.id).first_or_404()
    title = (item.title or '').strip()
    url = (item.url or '').strip()
    if not title or not url:
        return jsonify({'error': 'Feed item is missing title or URL'}), 400

    why_text = (item.description or '').strip()
    when_context = (item.state or '').strip().lower() or 'future'
    recall = RecallItem(
        user_id=user.id,
        title=title,
        payload_type='url',
        payload=url,
        when_context=when_context,
        why=why_text or None,
        ai_status='pending'
    )
    db.session.add(recall)
    db.session.delete(item)
    db.session.commit()

    start_embedding_job(user.id, ENTITY_RECALL, recall.id)
    start_recall_processing(recall.id)

    return jsonify({'recall': recall.to_dict(), 'deleted_id': item_id}), 201


# Calendar API
ALLOWED_PRIORITIES = {'low', 'medium', 'high'}
ALLOWED_STATUSES = {'not_started', 'in_progress', 'done', 'canceled'}


