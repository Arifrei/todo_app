"""Extracted route handlers grouped by domain for readability."""

import app as _app_module

# Keep access to shared app context, models, helpers, and constants.
for _name, _value in vars(_app_module).items():
    if not _name.startswith('__'):
        globals()[_name] = _value

def vault_folder_detail(folder_id):
    """Get, update, or archive a vault folder."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    folder = DocumentFolder.query.filter_by(id=folder_id, user_id=user.id).first_or_404()

    if request.method == 'GET':
        return jsonify(folder.to_dict())

    if request.method == 'DELETE':
        archived_at = _now_local()
        _vault_archive_folder_recursive(user.id, folder.id, archived_at)
        db.session.commit()
        return jsonify({'archived': True, 'folder': folder.to_dict()})

    data = request.json or {}
    if 'name' in data:
        name_val = (data.get('name') or '').strip()
        if name_val:
            folder.name = name_val
    folder.updated_at = _now_local()
    db.session.commit()
    return jsonify(folder.to_dict())



def vault_document_download(doc_id):
    """Download the original file."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    doc = Document.query.filter_by(id=doc_id, user_id=user.id).first_or_404()
    vault_dir = _vault_root_for_user(user.id)
    download_name = _vault_build_download_name(doc.title, doc.original_filename)
    return send_from_directory(vault_dir, doc.stored_filename, as_attachment=True, download_name=download_name)



def vault_document_preview(doc_id):
    """Preview supported document types."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    doc = Document.query.filter_by(id=doc_id, user_id=user.id).first_or_404()
    if doc.get_file_category() not in ['image', 'pdf', 'text', 'audio', 'video', 'code']:
        return jsonify({'error': 'Preview not supported'}), 400
    vault_dir = _vault_root_for_user(user.id)
    return send_from_directory(vault_dir, doc.stored_filename, as_attachment=False)



def vault_document_move(doc_id):
    """Move a document to another folder."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    doc = Document.query.filter_by(id=doc_id, user_id=user.id).first_or_404()
    data = request.json or {}
    folder_id = data.get('folder_id')
    if folder_id in (None, ''):
        doc.folder_id = None
    else:
        try:
            folder_id_int = int(folder_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid folder_id'}), 400
        DocumentFolder.query.filter_by(id=folder_id_int, user_id=user.id).first_or_404()
        doc.folder_id = folder_id_int
    doc.updated_at = _now_local()
    db.session.commit()
    return jsonify(doc.to_dict())



def vault_search():
    """Search documents by title, filename, type, or tags."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    query = (request.args.get('q') or '').strip()
    if not query:
        return jsonify([])
    like = f"%{query}%"
    results = Document.query.filter(
        Document.user_id == user.id,
        Document.archived_at.is_(None),
        or_(
            Document.title.ilike(like),
            Document.original_filename.ilike(like),
            Document.file_type.ilike(like),
            Document.tags.ilike(like)
        )
    ).order_by(
        Document.pinned.desc(),
        Document.pin_order.desc(),
        Document.created_at.desc()
    ).all()
    return jsonify([doc.to_dict() for doc in results])



def vault_stats():
    """Return storage usage stats for the current user."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    total_size = db.session.query(db.func.coalesce(db.func.sum(Document.file_size), 0)).filter(
        Document.user_id == user.id,
        Document.archived_at.is_(None)
    ).scalar() or 0
    total_count = Document.query.filter_by(user_id=user.id).filter(Document.archived_at.is_(None)).count()
    pinned_count = Document.query.filter_by(user_id=user.id, pinned=True).filter(Document.archived_at.is_(None)).count()
    return jsonify({
        'total_size': int(total_size),
        'document_count': int(total_count),
        'pinned_count': int(pinned_count)
    })


