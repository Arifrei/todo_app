"""Image upload and serving for the notes editor."""

DEFAULT_NOTE_IMAGE_MAX_SIZE = 10 * 1024 * 1024  # 10 MB

ALLOWED_IMAGE_TYPES = {
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
}

MIME_EXTENSIONS = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
}


def _note_images_dir(user_id):
    import app as a
    return a.os.path.join(a.app.instance_path, 'note_images', str(user_id))


def upload_note_image():
    import app as a
    NoteImage = a.NoteImage
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    os = a.os
    request = a.request
    uuid = a.uuid

    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    files = []
    for field_name in ['file', 'files', 'file[]', 'files[]']:
        files.extend(request.files.getlist(field_name) or [])
    if not files and request.files:
        for field_name in request.files.keys():
            files.extend(request.files.getlist(field_name) or [])

    # Deduplicate by object id
    seen = set()
    deduped = []
    for f in files:
        if f and id(f) not in seen:
            seen.add(id(f))
            deduped.append(f)
    files = deduped

    if not files:
        return jsonify({'error': 'No image uploaded'}), 400

    note_id = request.form.get('note_id')
    note_id_int = int(note_id) if note_id and str(note_id).isdigit() else None

    images_dir = _note_images_dir(user.id)
    os.makedirs(images_dir, exist_ok=True)
    max_size = a.app.config.get('NOTE_IMAGE_MAX_SIZE', DEFAULT_NOTE_IMAGE_MAX_SIZE)

    created = []
    saved_paths = []

    try:
        for file in files:
            raw_filename = (getattr(file, 'filename', '') or '').strip()
            original_filename = raw_filename.rsplit('/', 1)[-1].rsplit('\\', 1)[-1].strip()
            file_type = (file.mimetype or 'application/octet-stream').split(';', 1)[0].strip().lower()

            if file_type not in ALLOWED_IMAGE_TYPES:
                return jsonify({'error': f'Unsupported image type: {file_type}'}), 400

            ext = MIME_EXTENSIONS.get(file_type, 'bin')
            stored_filename = f"{uuid.uuid4().hex}.{ext}"
            file_path = os.path.join(images_dir, stored_filename)

            file.save(file_path)
            saved_paths.append(file_path)

            file_size = os.path.getsize(file_path)
            if max_size and file_size > max_size:
                raise ValueError(f'Image exceeds size limit ({file_size} > {max_size})')

            img = NoteImage(
                user_id=user.id,
                note_id=note_id_int,
                original_filename=original_filename or f'image.{ext}',
                stored_filename=stored_filename,
                file_type=file_type,
                file_size=file_size,
            )
            db.session.add(img)
            created.append(img)

        db.session.commit()
        results = [img.to_dict() for img in created]
        return jsonify(results if len(results) > 1 else results[0]), 201

    except Exception as exc:
        db.session.rollback()
        for path in saved_paths:
            try:
                os.remove(path)
            except OSError:
                pass
        return jsonify({'error': str(exc)}), 400


def serve_note_image(filename):
    import app as a
    NoteImage = a.NoteImage
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    send_from_directory = a.send_from_directory

    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    img = NoteImage.query.filter_by(stored_filename=filename, user_id=user.id).first()
    if not img:
        return jsonify({'error': 'Image not found'}), 404

    images_dir = _note_images_dir(user.id)
    response = send_from_directory(images_dir, img.stored_filename, as_attachment=False)
    response.headers['Content-Type'] = img.file_type
    response.headers['Cache-Control'] = 'private, max-age=31536000, immutable'
    return response
