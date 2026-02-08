"""Extracted route handlers grouped by domain for readability."""

import app as _app_module

# Keep access to shared app context, models, helpers, and constants.
for _name, _value in vars(_app_module).items():
    if not _name.startswith('__'):
        globals()[_name] = _value

def reorder_notes():
    """Reorder pinned notes by explicit id list (pinned only)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    data = request.get_json(silent=True) or {}
    ids = data.get('ids')
    if not isinstance(ids, list) or not ids:
        return jsonify({'error': 'ids array required'}), 400

    pinned_notes = Note.query.filter(
        Note.user_id == user.id,
        Note.pinned.is_(True),
        Note.id.in_(ids)
    ).all()
    pinned_map = {n.id: n for n in pinned_notes}
    order_val = 1
    for raw_id in ids:
        try:
            nid = int(raw_id)
        except (ValueError, TypeError):
            continue
        note = pinned_map.get(nid)
        if note:
            note.pin_order = order_val
            order_val += 1
    db.session.commit()
    return jsonify({'pinned': order_val - 1})



def note_folders():
    """List or create note folders for the current user."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    archived_only = str(request.args.get('archived') or '').lower() in ['1', 'true', 'yes', 'on']

    if request.method == 'POST':
        data = request.json or {}
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({'error': 'Folder name required'}), 400
        parent_id = data.get('parent_id')
        parent_id_int = int(parent_id) if parent_id and str(parent_id).isdigit() else None
        if parent_id_int is not None:
            NoteFolder.query.filter_by(id=parent_id_int, user_id=user.id).first_or_404()
        max_order = db.session.query(db.func.coalesce(db.func.max(NoteFolder.order_index), 0)).filter(
            NoteFolder.user_id == user.id,
            NoteFolder.parent_id == parent_id_int
        ).scalar()
        folder = NoteFolder(
            user_id=user.id,
            parent_id=parent_id_int,
            name=name,
            order_index=(max_order or 0) + 1
        )
        db.session.add(folder)
        db.session.commit()
        return jsonify(folder.to_dict()), 201

    folder_query = NoteFolder.query.filter_by(user_id=user.id)
    if archived_only:
        folder_query = folder_query.filter(NoteFolder.archived_at.isnot(None))
    else:
        folder_query = folder_query.filter(NoteFolder.archived_at.is_(None))
    folders = folder_query.order_by(
        NoteFolder.parent_id.asc(),
        NoteFolder.order_index.asc(),
        NoteFolder.name.asc()
    ).all()
    return jsonify([f.to_dict() for f in folders])



def archive_note_folder(folder_id):
    """Archive a note folder."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    folder = NoteFolder.query.filter_by(id=folder_id, user_id=user.id).first_or_404()
    if folder.is_pin_protected:
        data = request.json or {}
        pin = str(data.get('pin', '')).strip()
        if not pin or not user.check_notes_pin(pin):
            return jsonify({'error': 'Folder is protected. Please enter notes PIN.'}), 403
    folder.archived_at = _now_local()
    folder.updated_at = _now_local()
    db.session.commit()
    return jsonify(folder.to_dict())



def restore_note_folder(folder_id):
    """Restore an archived note folder."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    folder = NoteFolder.query.filter_by(id=folder_id, user_id=user.id).first_or_404()
    if folder.is_pin_protected:
        data = request.json or {}
        pin = str(data.get('pin', '')).strip()
        if not pin or not user.check_notes_pin(pin):
            return jsonify({'error': 'Folder is protected. Please enter notes PIN.'}), 403
    folder.archived_at = None
    folder.updated_at = _now_local()
    db.session.commit()
    return jsonify(folder.to_dict())



def move_notes():
    """Move one or more notes into a folder (or to root)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    data = request.json or {}
    ids = data.get('ids')
    folder_id = data.get('folder_id')
    if not isinstance(ids, list) or not ids:
        return jsonify({'error': 'ids array required'}), 400
    folder_id_int = int(folder_id) if folder_id and str(folder_id).isdigit() else None
    if folder_id_int is not None:
        NoteFolder.query.filter_by(id=folder_id_int, user_id=user.id).first_or_404()

    notes = Note.query.filter(Note.user_id == user.id, Note.id.in_(ids)).all()
    note_map = {n.id: n for n in notes}
    updated = 0
    for raw_id in ids:
        try:
            nid = int(raw_id)
        except (TypeError, ValueError):
            continue
        note = note_map.get(nid)
        if note:
            note.folder_id = folder_id_int
            updated += 1
    db.session.commit()
    return jsonify({'updated': updated, 'folder_id': folder_id_int})



def archive_note(note_id):
    """Archive a note or list."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()
    if note.is_pin_protected:
        data = request.json or {}
        pin = str(data.get('pin', '')).strip()
        if not pin or not user.check_notes_pin(pin):
            return jsonify({'error': 'Note is protected. Please enter notes PIN.'}), 403
    note.archived_at = _now_local()
    note.pinned = False
    note.pin_order = 0
    note.updated_at = _now_local()
    db.session.commit()
    return jsonify(note.to_dict())



def restore_note(note_id):
    """Restore an archived note or list."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()
    if note.is_pin_protected:
        data = request.json or {}
        pin = str(data.get('pin', '')).strip()
        if not pin or not user.check_notes_pin(pin):
            return jsonify({'error': 'Note is protected. Please enter notes PIN.'}), 403
    note.archived_at = None
    note.updated_at = _now_local()
    db.session.commit()
    return jsonify(note.to_dict())



def note_list_item_duplicates(note_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()
    if note.note_type != 'list':
        return jsonify({'error': 'Not a list note'}), 400

    items = NoteListItem.query.filter_by(note_id=note.id).order_by(
        NoteListItem.order_index.asc(),
        NoteListItem.id.asc()
    ).all()

    payload = detect_note_list_duplicates(
        items=items,
        section_prefix=LIST_SECTION_PREFIX,
        embed_text_fn=embed_text,
    )
    return jsonify(payload)



def reorder_note_list_items(note_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()
    if note.note_type != 'list':
        return jsonify({'error': 'Not a list note'}), 400

    data = request.json or {}
    ids = data.get('ids') or []
    if not isinstance(ids, list):
        return jsonify({'error': 'ids must be a list'}), 400
    try:
        ids = [int(i) for i in ids]
    except (TypeError, ValueError):
        return jsonify({'error': 'ids must be integers'}), 400

    items = NoteListItem.query.filter_by(note_id=note.id).all()
    item_map = {item.id: item for item in items}
    if len(ids) != len(item_map) or set(ids) != set(item_map.keys()):
        return jsonify({'error': 'ids must include every item'}), 400

    for idx, item_id in enumerate(ids, start=1):
        item_map[item_id].order_index = idx

    note.updated_at = datetime.now(pytz.UTC).replace(tzinfo=None)
    db.session.commit()
    return jsonify({'status': 'ok'})



def share_note(note_id):
    """Generate or revoke a shareable link for a note."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()

    if request.method == 'POST':
        # Generate a new share token
        note.share_token = secrets.token_urlsafe(32)
        note.is_public = True
        db.session.commit()
        share_url = url_for('view_shared_note', token=note.share_token, _external=True)
        return jsonify({
            'share_token': note.share_token,
            'share_url': share_url,
            'is_public': note.is_public
        })

    if request.method == 'DELETE':
        # Revoke sharing
        note.share_token = None
        note.is_public = False
        db.session.commit()
        return jsonify({'message': 'Sharing revoked'})



def view_shared_note(token):
    """Public view for shared notes (no authentication required)."""
    note = Note.query.filter_by(share_token=token, is_public=True).first_or_404()
    tz_name = app.config.get('DEFAULT_TIMEZONE', 'America/New_York')
    tz = pytz.timezone(tz_name)
    updated_local = None
    if note.updated_at:
        updated_at = note.updated_at
        if updated_at.tzinfo is None:
            updated_at = pytz.UTC.localize(updated_at)
        updated_local = updated_at.astimezone(tz)
    return render_template('shared_note.html', note=note, note_updated_at_local=updated_local)


# PIN Protection API


def check_pin_status():
    """Check if current user has a PIN set."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    return jsonify({
        'has_pin': bool(user.pin_hash)
    })



def set_pin():
    """Set or update the master PIN."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    data = request.json or {}
    new_pin = str(data.get('pin', '')).strip()
    current_pin = str(data.get('current_pin', '')).strip()

    # If PIN already exists, require current PIN verification
    if user.pin_hash and not user.check_pin(current_pin):
        return jsonify({'error': 'Current PIN is incorrect'}), 403

    try:
        user.set_pin(new_pin)
        db.session.commit()
        return jsonify({'success': True, 'message': 'PIN set successfully'})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400



def remove_pin():
    """Remove the master PIN (requires current PIN)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    data = request.json or {}
    current_pin = str(data.get('pin', '')).strip()

    if not user.pin_hash:
        return jsonify({'error': 'No PIN is set'}), 400

    if not user.check_pin(current_pin):
        return jsonify({'error': 'PIN is incorrect'}), 403

    user.pin_hash = None
    # Unprotect all notes when PIN is removed
    Note.query.filter_by(user_id=user.id, is_pin_protected=True).update({'is_pin_protected': False})
    db.session.commit()
    session.pop('unlocked_note_ids', None)
    return jsonify({'success': True, 'message': 'PIN removed'})



def verify_pin():
    """Verify PIN only (no persistent unlock)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    data = request.json or {}
    pin = str(data.get('pin', '')).strip()

    if not user.pin_hash:
        return jsonify({'error': 'No PIN is set'}), 400

    if user.check_pin(pin):
        return jsonify({'success': True, 'valid': True})
    else:
        return jsonify({'error': 'Incorrect PIN'}), 403



def notes_pin_status():
    """Check if user has a notes PIN set."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    return jsonify({'has_notes_pin': user.has_notes_pin()})



def set_notes_pin():
    """Set or update the notes PIN."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    data = request.json or {}
    pin = str(data.get('pin', '')).strip()
    confirm_pin = str(data.get('confirm_pin', '')).strip()

    if not pin or len(pin) != 4 or not pin.isdigit():
        return jsonify({'error': 'PIN must be exactly 4 digits'}), 400

    if pin != confirm_pin:
        return jsonify({'error': 'PINs do not match'}), 400

    try:
        user.set_notes_pin(pin)
        db.session.commit()
        return jsonify({'success': True})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400



def unlock_note(note_id):
    """Verify PIN and return full note content (one-time, no session persistence)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()

    if not note.is_pin_protected:
        # Not protected, just return the content
        payload = note.to_dict()
        if note.note_type == 'list':
            payload['items'] = [item.to_dict() for item in note.list_items]
        return jsonify(payload)

    data = request.json or {}
    pin = str(data.get('pin', '')).strip()

    if not user.has_notes_pin():
        return jsonify({'error': 'No notes PIN is set'}), 400

    if not user.check_notes_pin(pin):
        return jsonify({'error': 'Incorrect PIN'}), 403

    # PIN correct - return full note content
    payload = note.to_dict()
    if note.note_type == 'list':
        payload['items'] = [item.to_dict() for item in note.list_items]
    return jsonify(payload)



def unlock_folder(folder_id):
    """Verify PIN for a protected folder (one-time, no session persistence)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    folder = NoteFolder.query.filter_by(id=folder_id, user_id=user.id).first_or_404()

    if not folder.is_pin_protected:
        # Not protected, just return success
        return jsonify({'unlocked': True, 'folder': folder.to_dict()})

    data = request.json or {}
    pin = str(data.get('pin', '')).strip()

    if not user.has_notes_pin():
        return jsonify({'error': 'No notes PIN is set'}), 400

    if not user.check_notes_pin(pin):
        return jsonify({'error': 'Incorrect PIN'}), 403

    # PIN correct - return success
    return jsonify({'unlocked': True, 'folder': folder.to_dict()})


# Quick Access API

