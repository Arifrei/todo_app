"""Extracted heavy route handlers from app.py."""


def _filter_area_scope(query, model, area_id):
    if area_id is None:
        return query.filter(model.area_id.is_(None))
    return query.filter(model.area_id == area_id)


def _area_scope_or_response(a, area_id):
    user = a.get_current_user()
    if not user:
        return None, None, (a.jsonify({'error': 'No user selected'}), 401)
    area = a.Area.query.filter_by(id=area_id, user_id=user.id).first()
    if not area:
        return user, None, (a.jsonify({'error': 'Area not found'}), 404)
    return user, area, None


def vault_documents(area_id=None):
    import app as a
    DEFAULT_VAULT_MAX_SIZE = a.DEFAULT_VAULT_MAX_SIZE
    Document = a.Document
    DocumentFolder = a.DocumentFolder
    _vault_is_blocked_file = a._vault_is_blocked_file
    _vault_root_for_user = a._vault_root_for_user
    _vault_sanitize_extension = a._vault_sanitize_extension
    app = a.app
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    mimetypes = a.mimetypes
    os = a.os
    request = a.request
    tags_to_string = a.tags_to_string
    uuid = a.uuid
    """List or upload vault documents."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    if request.method == 'GET':
        archived_only = str(request.args.get('archived') or '').lower() in ['1', 'true', 'yes', 'on']
        folder_id = request.args.get('folder_id')
        folder_id_int = int(folder_id) if folder_id and str(folder_id).isdigit() else None
        query = _filter_area_scope(Document.query.filter_by(user_id=user.id), Document, area_id)
        if archived_only:
            query = query.filter(Document.archived_at.isnot(None))
        else:
            query = query.filter(Document.archived_at.is_(None))
        if folder_id is not None:
            if str(folder_id).strip() == '':
                query = query.filter(Document.folder_id.is_(None))
            elif folder_id_int is not None:
                query = query.filter(Document.folder_id == folder_id_int)
            else:
                return jsonify({'error': 'Invalid folder_id'}), 400
        else:
            query = query.filter(Document.folder_id.is_(None))
        docs = query.order_by(
            Document.pinned.desc(),
            Document.pin_order.desc(),
            Document.created_at.desc()
        ).all()
        return jsonify([doc.to_dict() for doc in docs])

    files = []
    for field_name in ['files', 'files[]', 'file', 'file[]']:
        files.extend(request.files.getlist(field_name) or [])
    if not files and request.files:
        for field_name in request.files.keys():
            files.extend(request.files.getlist(field_name) or [])
    deduped_files = []
    seen_file_ids = set()
    for uploaded in files:
        if not uploaded:
            continue
        uploaded_id = id(uploaded)
        if uploaded_id in seen_file_ids:
            continue
        seen_file_ids.add(uploaded_id)
        deduped_files.append(uploaded)
    files = deduped_files
    if not files:
        return jsonify({'error': 'No file uploaded'}), 400

    folder_id = request.form.get('folder_id')
    if folder_id not in (None, '') and not str(folder_id).isdigit():
        return jsonify({'error': 'Invalid folder_id'}), 400
    folder_id_int = int(folder_id) if folder_id and str(folder_id).isdigit() else None
    if folder_id_int is not None:
        DocumentFolder.query.filter_by(
            id=folder_id_int,
            user_id=user.id,
            archived_at=None,
            area_id=area_id,
        ).first_or_404()

    prepared = []
    mime_extension_overrides = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/heic': '.heic',
        'image/heif': '.heif',
        'image/webp': '.webp',
    }
    for file in files:
        if not file:
            continue
        raw_filename = (getattr(file, 'filename', '') or '').strip()
        original_filename = raw_filename.rsplit('/', 1)[-1].rsplit('\\', 1)[-1].strip()
        guessed_type = mimetypes.guess_type(original_filename)[0] if original_filename else None
        file_type = (file.mimetype or guessed_type or 'application/octet-stream').split(';', 1)[0].strip().lower()
        if not original_filename:
            inferred_ext = mime_extension_overrides.get(file_type) or mimetypes.guess_extension(file_type) or ''
            if inferred_ext == '.jpe':
                inferred_ext = '.jpg'
            original_filename = f"upload{inferred_ext}"
        if _vault_is_blocked_file(original_filename, file_type):
            return jsonify({'error': f'Blocked file type: {original_filename}'}), 400
        title = (request.form.get('title') or '').strip()
        if not title or len(files) > 1:
            title = os.path.splitext(original_filename)[0] or 'Untitled'
        tags = tags_to_string(request.form.get('tags'))
        extension = _vault_sanitize_extension(original_filename)
        prepared.append({
            'file': file,
            'original_filename': original_filename,
            'file_type': file_type,
            'title': title,
            'tags': tags,
            'extension': extension
        })

    if not prepared:
        return jsonify({'error': 'No valid files to upload'}), 400

    created = []
    saved_paths = []
    vault_dir = _vault_root_for_user(user.id)
    os.makedirs(vault_dir, exist_ok=True)
    max_size = app.config.get('VAULT_MAX_FILE_SIZE', DEFAULT_VAULT_MAX_SIZE)

    try:
        for item in prepared:
            stored_filename = f"{uuid.uuid4().hex}{('.' + item['extension']) if item['extension'] else ''}"
            file_path = os.path.join(vault_dir, stored_filename)
            item['file'].save(file_path)
            saved_paths.append(file_path)
            file_size = os.path.getsize(file_path)
            if max_size and file_size > max_size:
                raise ValueError('File exceeds size limit')
            doc = Document(
                user_id=user.id,
                area_id=area_id,
                folder_id=folder_id_int,
                title=item['title'],
                original_filename=item['original_filename'],
                stored_filename=stored_filename,
                file_type=item['file_type'],
                file_extension=item['extension'],
                file_size=file_size,
                tags=item['tags'],
                pinned=False,
                pin_order=0
            )
            db.session.add(doc)
            created.append(doc)
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        for path in saved_paths:
            try:
                os.remove(path)
            except OSError:
                pass
        return jsonify({'error': str(exc)}), 400

    if len(created) == 1:
        return jsonify(created[0].to_dict()), 201
    return jsonify([doc.to_dict() for doc in created]), 201


def area_vault_documents(area_id):
    import app as a
    _user, area, response = _area_scope_or_response(a, area_id)
    if response:
        return response
    return vault_documents(area.id)


def vault_folders(area_id=None):
    import app as a
    DocumentFolder = a.DocumentFolder
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    request = a.request
    """List or create vault folders for the current user."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    archived_only = str(request.args.get('archived') or '').lower() in ['1', 'true', 'yes', 'on']
    parent_id = request.args.get('parent_id')
    parent_id_int = int(parent_id) if parent_id and str(parent_id).isdigit() else None

    if request.method == 'POST':
        data = request.json or {}
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({'error': 'Folder name required'}), 400
        parent_id = data.get('parent_id')
        if parent_id not in (None, '') and not str(parent_id).isdigit():
            return jsonify({'error': 'Invalid parent_id'}), 400
        parent_id_int = int(parent_id) if parent_id and str(parent_id).isdigit() else None
        if parent_id_int is not None:
            DocumentFolder.query.filter_by(
                id=parent_id_int,
                user_id=user.id,
                archived_at=None,
                area_id=area_id,
            ).first_or_404()
        max_order = db.session.query(db.func.coalesce(db.func.max(DocumentFolder.order_index), 0)).filter(
            DocumentFolder.user_id == user.id,
            DocumentFolder.area_id.is_(None) if area_id is None else DocumentFolder.area_id == area_id,
            DocumentFolder.parent_id == parent_id_int
        ).scalar()
        folder = DocumentFolder(
            user_id=user.id,
            area_id=area_id,
            parent_id=parent_id_int,
            name=name,
            order_index=(max_order or 0) + 1
        )
        db.session.add(folder)
        db.session.commit()
        return jsonify(folder.to_dict()), 201

    folder_query = _filter_area_scope(DocumentFolder.query.filter_by(user_id=user.id), DocumentFolder, area_id)
    if archived_only:
        folder_query = folder_query.filter(DocumentFolder.archived_at.isnot(None))
    else:
        folder_query = folder_query.filter(DocumentFolder.archived_at.is_(None))
    if parent_id is not None and str(parent_id).strip() != '':
        if not str(parent_id).isdigit():
            return jsonify({'error': 'Invalid parent_id'}), 400
        folder_query = folder_query.filter(DocumentFolder.parent_id == parent_id_int)
    folders = folder_query.order_by(
        DocumentFolder.parent_id.asc(),
        DocumentFolder.order_index.asc(),
        DocumentFolder.name.asc()
    ).all()
    return jsonify([f.to_dict() for f in folders])


def area_vault_folders(area_id):
    import app as a
    _user, area, response = _area_scope_or_response(a, area_id)
    if response:
        return response
    return vault_folders(area.id)


def vault_document_detail(doc_id, area_id=None):
    import app as a
    Document = a.Document
    DocumentFolder = a.DocumentFolder
    _now_local = a._now_local
    _vault_root_for_user = a._vault_root_for_user
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    os = a.os
    parse_bool = a.parse_bool
    request = a.request
    tags_to_string = a.tags_to_string
    """Get, update, or archive a single document."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    doc = _filter_area_scope(Document.query.filter_by(id=doc_id, user_id=user.id), Document, area_id).first_or_404()

    if request.method == 'GET':
        return jsonify(doc.to_dict())

    if request.method == 'DELETE' and parse_bool(request.args.get('permanent')):
        file_path = os.path.join(
            _vault_root_for_user(user.id),
            os.path.basename(doc.stored_filename or ''),
        )
        db.session.delete(doc)
        db.session.commit()
        try:
            if os.path.isfile(file_path):
                os.remove(file_path)
        except OSError:
            a.app.logger.warning('Could not remove vault file %s', file_path, exc_info=True)
        return '', 204

    if request.method == 'DELETE':
        doc.archived_at = _now_local()
        doc.pinned = False
        doc.pin_order = 0
        doc.updated_at = _now_local()
        db.session.commit()
        return jsonify(doc.to_dict())

    data = request.json or {}
    if 'title' in data:
        title_val = (data.get('title') or '').strip()
        if not title_val:
            return jsonify({'error': 'Title is required'}), 400
        doc.title = title_val
    if 'tags' in data:
        doc.tags = tags_to_string(data.get('tags'))
    if 'folder_id' in data:
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
    if 'archived' in data:
        archived = parse_bool(data.get('archived'))
        if archived:
            doc.archived_at = _now_local()
            doc.pinned = False
            doc.pin_order = 0
        else:
            doc.archived_at = None
            if doc.folder_id is not None:
                folder = DocumentFolder.query.filter_by(
                    id=doc.folder_id,
                    user_id=user.id,
                    area_id=area_id,
                ).first()
                if not folder or folder.archived_at:
                    doc.folder_id = None
    if 'pinned' in data:
        pinned = parse_bool(data.get('pinned'))
        if pinned and not doc.pinned:
            max_pin = db.session.query(db.func.coalesce(db.func.max(Document.pin_order), 0)).filter(
                Document.user_id == user.id,
                Document.area_id.is_(None) if area_id is None else Document.area_id == area_id,
                Document.pinned.is_(True)
            ).scalar()
            doc.pin_order = (max_pin or 0) + 1
        if not pinned:
            doc.pin_order = 0
        doc.pinned = pinned
    doc.updated_at = _now_local()
    db.session.commit()
    return jsonify(doc.to_dict())


def area_vault_document_detail(area_id, doc_id):
    import app as a
    _user, area, response = _area_scope_or_response(a, area_id)
    if response:
        return response
    return vault_document_detail(doc_id, area.id)
