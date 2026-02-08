"""Extracted heavy route handlers from app.py."""

def get_planner_data():
    import app as a
    Note = a.Note
    NoteListItem = a.NoteListItem
    PlannerFolder = a.PlannerFolder
    PlannerGroup = a.PlannerGroup
    PlannerMultiItem = a.PlannerMultiItem
    PlannerMultiLine = a.PlannerMultiLine
    PlannerSimpleItem = a.PlannerSimpleItem
    _ensure_planner_feed_folder = a._ensure_planner_feed_folder
    build_list_preview_text = a.build_list_preview_text
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    or_ = a.or_
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    feed_folder = _ensure_planner_feed_folder(user)
    folders = PlannerFolder.query.filter_by(user_id=user.id).order_by(
        PlannerFolder.order_index.asc(),
        PlannerFolder.created_at.asc()
    ).all()
    simple_items = PlannerSimpleItem.query.filter_by(user_id=user.id).order_by(
        PlannerSimpleItem.order_index.asc(),
        PlannerSimpleItem.created_at.asc()
    ).all()
    groups = PlannerGroup.query.filter_by(user_id=user.id).order_by(
        PlannerGroup.order_index.asc(),
        PlannerGroup.created_at.asc()
    ).all()
    multi_items = PlannerMultiItem.query.filter_by(user_id=user.id).order_by(
        PlannerMultiItem.order_index.asc(),
        PlannerMultiItem.created_at.asc()
    ).all()
    multi_lines = PlannerMultiLine.query.filter_by(user_id=user.id).order_by(
        PlannerMultiLine.order_index.asc(),
        PlannerMultiLine.created_at.asc()
    ).all()
    planner_notes = Note.query.filter_by(user_id=user.id).filter(
        Note.archived_at.is_(None),
        or_(
            Note.planner_multi_item_id.isnot(None),
            Note.planner_multi_line_id.isnot(None)
        )
    ).order_by(Note.updated_at.desc()).all()
    planner_note_payload = []
    for note in planner_notes:
        note_dict = note.to_dict()
        if note.is_pin_protected:
            note_dict['content'] = ''
            note_dict['locked'] = True
        planner_note_payload.append(note_dict)
    list_ids = [n.id for n in planner_notes if n.note_type == 'list' and not n.is_pin_protected]
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
        for payload in planner_note_payload:
            if payload.get('note_type') == 'list':
                if payload.get('locked'):
                    payload['list_preview'] = []
                else:
                    payload['list_preview'] = preview_map.get(payload['id'], [])

    return jsonify({
        'folders': [f.to_dict() for f in folders],
        'feed_folder': feed_folder.to_dict() if feed_folder else None,
        'simple_items': [i.to_dict() for i in simple_items],
        'groups': [g.to_dict() for g in groups],
        'multi_items': [i.to_dict() for i in multi_items],
        'multi_lines': [l.to_dict() for l in multi_lines],
        'planner_notes': planner_note_payload,
    })

def create_planner_multi_item():
    import app as a
    PlannerFolder = a.PlannerFolder
    PlannerGroup = a.PlannerGroup
    PlannerMultiItem = a.PlannerMultiItem
    PlannerMultiLine = a.PlannerMultiLine
    _planner_line_type = a._planner_line_type
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    parse_day_value = a.parse_day_value
    request = a.request
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    payload = request.get_json() or {}
    title = (payload.get('title') or '').strip()
    folder_id = payload.get('folder_id')
    group_id = payload.get('group_id')
    lines = payload.get('lines') or []
    scheduled_date = parse_day_value(payload.get('scheduled_date'))
    if not title or (not folder_id and not group_id):
        return jsonify({'error': 'Title and destination required'}), 400

    if group_id:
        group = PlannerGroup.query.filter_by(id=group_id, user_id=user.id).first()
        if not group:
            return jsonify({'error': 'Group not found'}), 404
        folder_id = group.folder_id

    folder = PlannerFolder.query.filter_by(id=folder_id, user_id=user.id).first()
    if not folder:
        return jsonify({'error': 'Folder not found'}), 404
    if folder.folder_type != 'multi':
        return jsonify({'error': 'Multi items can only be added to multi folders'}), 400

    item = PlannerMultiItem(
        user_id=user.id,
        folder_id=folder_id,
        group_id=group_id,
        title=title,
        scheduled_date=scheduled_date
    )
    db.session.add(item)
    db.session.flush()

    order_index = 0
    for raw in lines:
        line_value = (raw or '').strip()
        if not line_value:
            continue
        db.session.add(PlannerMultiLine(
            user_id=user.id,
            item_id=item.id,
            line_type=_planner_line_type(line_value),
            value=line_value,
            order_index=order_index
        ))
        order_index += 1

    db.session.commit()
    return jsonify(item.to_dict())
