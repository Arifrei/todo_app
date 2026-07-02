"""Extracted route handlers grouped by domain for readability."""

import app as _app_module

# Keep access to shared app context, models, helpers, and constants.
for _name, _value in vars(_app_module).items():
    if not _name.startswith('__'):
        globals()[_name] = _value


def _filter_area_scope(query, model, area_id):
    if area_id is None:
        return query.filter(model.area_id.is_(None))
    return query.filter(model.area_id == area_id)


def _area_scope_or_response(area_id):
    user = get_current_user()
    if not user:
        return None, None, (jsonify({'error': 'No user selected'}), 401)
    area = Area.query.filter_by(id=area_id, user_id=user.id).first()
    if not area:
        return user, None, (jsonify({'error': 'Area not found'}), 404)
    return user, area, None


def _vault_folder_tree(user_id, folder_id, area_id=None):
    folders = _filter_area_scope(DocumentFolder.query.filter_by(user_id=user_id), DocumentFolder, area_id).all()
    by_parent = {}
    by_id = {folder.id: folder for folder in folders}
    for folder in folders:
        by_parent.setdefault(folder.parent_id, []).append(folder.id)

    ordered_ids = []
    stack = [folder_id]
    while stack:
        current_id = stack.pop()
        if current_id in ordered_ids:
            continue
        ordered_ids.append(current_id)
        stack.extend(by_parent.get(current_id, []))
    return [by_id[item_id] for item_id in ordered_ids if item_id in by_id]


def _vault_restore_folder_tree(user_id, folder_id, restored_at, area_id=None):
    folders = _vault_folder_tree(user_id, folder_id, area_id)
    folder_ids = [folder.id for folder in folders]
    for folder in folders:
        folder.archived_at = None
        folder.updated_at = restored_at
    if folder_ids:
        _filter_area_scope(Document.query.filter(
            Document.user_id == user_id,
            Document.folder_id.in_(folder_ids),
        ), Document, area_id).update(
            {'archived_at': None, 'updated_at': restored_at},
            synchronize_session=False,
        )
    return folders


def vault_folder_detail(folder_id, area_id=None):
    """Get, update, or archive a vault folder."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    folder = _filter_area_scope(
        DocumentFolder.query.filter_by(id=folder_id, user_id=user.id),
        DocumentFolder,
        area_id,
    ).first_or_404()

    if request.method == 'GET':
        return jsonify(folder.to_dict())

    if request.method == 'DELETE' and parse_bool(request.args.get('permanent')):
        folders = _vault_folder_tree(user.id, folder.id, area_id)
        folder_ids = [item.id for item in folders]
        docs = _filter_area_scope(Document.query.filter(
            Document.user_id == user.id,
            Document.folder_id.in_(folder_ids),
        ), Document, area_id).all()
        file_paths = [
            os.path.join(
                _vault_root_for_user(user.id),
                os.path.basename(doc.stored_filename or ''),
            )
            for doc in docs
        ]
        for doc in docs:
            db.session.delete(doc)
        for item in reversed(folders):
            db.session.delete(item)
        db.session.commit()
        for file_path in file_paths:
            try:
                if os.path.isfile(file_path):
                    os.remove(file_path)
            except OSError:
                app.logger.warning('Could not remove vault file %s', file_path, exc_info=True)
        return '', 204

    if request.method == 'DELETE':
        archived_at = _now_local()
        _vault_archive_folder_recursive(user.id, folder.id, archived_at)
        db.session.commit()
        return jsonify({'archived': True, 'folder': folder.to_dict()})

    data = request.json or {}
    if 'name' in data:
        name_val = (data.get('name') or '').strip()
        if not name_val:
            return jsonify({'error': 'Folder name is required'}), 400
        folder.name = name_val
    if 'parent_id' in data:
        parent_id = data.get('parent_id')
        if parent_id in (None, ''):
            parent_id_int = None
        else:
            try:
                parent_id_int = int(parent_id)
            except (TypeError, ValueError):
                return jsonify({'error': 'Invalid parent_id'}), 400
            if parent_id_int == folder.id:
                return jsonify({'error': 'A folder cannot contain itself'}), 400
            destination = DocumentFolder.query.filter_by(
                id=parent_id_int,
                user_id=user.id,
                archived_at=None,
                area_id=area_id,
            ).first()
            if not destination:
                return jsonify({'error': 'Destination folder not found'}), 404
            descendant_ids = {item.id for item in _vault_folder_tree(user.id, folder.id, area_id)}
            if parent_id_int in descendant_ids:
                return jsonify({'error': 'A folder cannot be moved into one of its children'}), 400
        folder.parent_id = parent_id_int
        max_order = db.session.query(
            db.func.coalesce(db.func.max(DocumentFolder.order_index), 0)
        ).filter(
            DocumentFolder.user_id == user.id,
            DocumentFolder.area_id.is_(None) if area_id is None else DocumentFolder.area_id == area_id,
            DocumentFolder.parent_id == parent_id_int,
            DocumentFolder.id != folder.id,
        ).scalar()
        folder.order_index = (max_order or 0) + 1
    if 'archived' in data:
        if parse_bool(data.get('archived')):
            _vault_archive_folder_recursive(user.id, folder.id, _now_local())
        else:
            restored_at = _now_local()
            _vault_restore_folder_tree(user.id, folder.id, restored_at, area_id)
            if folder.parent_id is not None:
                parent = DocumentFolder.query.filter_by(
                    id=folder.parent_id,
                    user_id=user.id,
                    area_id=area_id,
                ).first()
                if not parent or parent.archived_at:
                    folder.parent_id = None
    folder.updated_at = _now_local()
    db.session.commit()
    return jsonify(folder.to_dict())


def area_vault_folder_detail(area_id, folder_id):
    _user, area, response = _area_scope_or_response(area_id)
    if response:
        return response
    return vault_folder_detail(folder_id, area.id)


def vault_document_download(doc_id, area_id=None):
    """Download the original file."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    doc = _filter_area_scope(Document.query.filter_by(id=doc_id, user_id=user.id), Document, area_id).first_or_404()
    vault_dir = _vault_root_for_user(user.id)
    download_name = _vault_build_download_name(doc.title, doc.original_filename)
    return send_from_directory(vault_dir, doc.stored_filename, as_attachment=True, download_name=download_name)


def area_vault_document_download(area_id, doc_id):
    _user, area, response = _area_scope_or_response(area_id)
    if response:
        return response
    return vault_document_download(doc_id, area.id)


def vault_document_preview(doc_id, area_id=None):
    """Preview supported document types."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    doc = _filter_area_scope(Document.query.filter_by(id=doc_id, user_id=user.id), Document, area_id).first_or_404()
    if doc.get_file_category() not in ['image', 'pdf', 'text', 'audio', 'video', 'code']:
        return jsonify({'error': 'Preview not supported'}), 400
    vault_dir = _vault_root_for_user(user.id)
    response = send_from_directory(vault_dir, doc.stored_filename, as_attachment=False)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    if doc.get_file_category() in ['text', 'code']:
        response.mimetype = 'text/plain'
        response.headers['Content-Security-Policy'] = "sandbox; default-src 'none'"
    elif (doc.file_extension or '').lower() == 'svg':
        response.headers['Content-Security-Policy'] = "sandbox; default-src 'none'"
    return response


def area_vault_document_preview(area_id, doc_id):
    _user, area, response = _area_scope_or_response(area_id)
    if response:
        return response
    return vault_document_preview(doc_id, area.id)


def vault_document_move(doc_id, area_id=None):
    """Move a document to another folder."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    doc = _filter_area_scope(Document.query.filter_by(id=doc_id, user_id=user.id), Document, area_id).first_or_404()
    data = request.json or {}
    folder_id = data.get('folder_id')
    if folder_id in (None, ''):
        doc.folder_id = None
    else:
        try:
            folder_id_int = int(folder_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid folder_id'}), 400
        DocumentFolder.query.filter_by(
            id=folder_id_int,
            user_id=user.id,
            archived_at=None,
            area_id=area_id,
        ).first_or_404()
        doc.folder_id = folder_id_int
    doc.updated_at = _now_local()
    db.session.commit()
    return jsonify(doc.to_dict())


def area_vault_document_move(area_id, doc_id):
    _user, area, response = _area_scope_or_response(area_id)
    if response:
        return response
    return vault_document_move(doc_id, area.id)


def vault_search(area_id=None):
    """Search documents by title, filename, type, or tags."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    query = (request.args.get('q') or '').strip()
    if not query:
        return jsonify([])
    archived_only = parse_bool(request.args.get('archived'))
    like = f"%{query}%"
    query = _filter_area_scope(Document.query.filter(
        Document.user_id == user.id,
        Document.archived_at.isnot(None) if archived_only else Document.archived_at.is_(None),
        or_(
            Document.title.ilike(like),
            Document.original_filename.ilike(like),
            Document.file_type.ilike(like),
            Document.tags.ilike(like)
        )
    ), Document, area_id)
    results = query.order_by(
        Document.pinned.desc(),
        Document.pin_order.desc(),
        Document.created_at.desc()
    ).all()
    return jsonify([doc.to_dict() for doc in results])


def area_vault_search(area_id):
    _user, area, response = _area_scope_or_response(area_id)
    if response:
        return response
    return vault_search(area.id)


def vault_stats(area_id=None):
    """Return storage usage stats for the current user."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    total_size = db.session.query(db.func.coalesce(db.func.sum(Document.file_size), 0)).filter(
        Document.user_id == user.id,
        Document.area_id.is_(None) if area_id is None else Document.area_id == area_id,
        Document.archived_at.is_(None)
    ).scalar() or 0
    total_count = _filter_area_scope(Document.query.filter_by(user_id=user.id), Document, area_id).filter(Document.archived_at.is_(None)).count()
    pinned_count = _filter_area_scope(Document.query.filter_by(user_id=user.id, pinned=True), Document, area_id).filter(Document.archived_at.is_(None)).count()
    return jsonify({
        'total_size': int(total_size),
        'document_count': int(total_count),
        'pinned_count': int(pinned_count)
    })


def area_vault_stats(area_id):
    _user, area, response = _area_scope_or_response(area_id)
    if response:
        return response
    return vault_stats(area.id)


