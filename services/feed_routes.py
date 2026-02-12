"""EverFeed route handlers (independent from Planner)."""

import app as _app_module

# Keep access to shared app context, models, helpers, and constants.
for _name, _value in vars(_app_module).items():
    if not _name.startswith('__'):
        globals()[_name] = _value


def _parse_optional_feed_date(payload):
    if 'scheduled_date' not in payload:
        return None, False, None
    raw_date = payload.get('scheduled_date')
    if isinstance(raw_date, str):
        raw_date = raw_date.strip()
    if raw_date in (None, ''):
        return None, True, None
    parsed = parse_day_value(raw_date)
    if parsed is None:
        return None, True, 'Invalid scheduled_date'
    return parsed, True, None


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
    scheduled_date, _, date_error = _parse_optional_feed_date(data)
    if date_error:
        return jsonify({'error': date_error}), 400

    if not title or not url:
        return jsonify({'error': 'Title and URL are required'}), 400

    new_item = DoFeedItem(
        user_id=user.id,
        title=title,
        url=url,
        description=description,
        state=state,
        scheduled_date=scheduled_date
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
        scheduled_date, has_scheduled_date, date_error = _parse_optional_feed_date(data)
        if date_error:
            return jsonify({'error': date_error}), 400
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
        if has_scheduled_date:
            item.scheduled_date = scheduled_date
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
