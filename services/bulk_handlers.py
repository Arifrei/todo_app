from datetime import datetime

import pytz


def _normalize_ids(raw_ids):
    ids = []
    for raw_id in raw_ids:
        try:
            ids.append(int(raw_id))
        except (ValueError, TypeError):
            continue
    return ids


def bulk_notes_route(
    *,
    request,
    jsonify,
    get_current_user,
    Note,
    NoteFolder,
    db,
    delete_embedding,
    entity_note=None,
):
    user = get_current_user()
    if not user:
        return jsonify({"error": "No user selected"}), 401

    data = request.json or {}
    raw_ids = data.get("ids") or []
    action = data.get("action")

    if not raw_ids or not isinstance(raw_ids, list):
        return jsonify({"error": "ids list is required"}), 400
    if action not in ["delete", "archive", "unarchive", "pin", "unpin", "move"]:
        return (
            jsonify(
                {
                    "error": "action must be delete, archive, unarchive, pin, unpin, or move"
                }
            ),
            400,
        )

    ids = _normalize_ids(raw_ids)
    if not ids:
        return jsonify({"error": "No valid note ids provided"}), 400

    notes = Note.query.filter(Note.id.in_(ids), Note.user_id == user.id).all()
    if not notes:
        return jsonify({"error": "No matching notes found"}), 404

    if action == "delete":
        for note in notes:
            if entity_note:
                delete_embedding(user.id, entity_note, note.id)
            db.session.delete(note)
        db.session.commit()
        return jsonify({"deleted": len(notes)})

    if action == "archive":
        now = datetime.now(pytz.UTC).replace(tzinfo=None)
        count = 0
        for note in notes:
            if not note.archived_at:
                note.archived_at = now
                count += 1
        db.session.commit()
        return jsonify({"updated": count})

    if action == "unarchive":
        count = 0
        for note in notes:
            if note.archived_at:
                note.archived_at = None
                count += 1
        db.session.commit()
        return jsonify({"updated": count})

    if action == "pin":
        max_note_pin = (
            db.session.query(db.func.coalesce(db.func.max(Note.pin_order), 0))
            .filter(Note.user_id == user.id, Note.pinned.is_(True))
            .scalar()
            or 0
        )
        max_folder_pin = (
            db.session.query(db.func.coalesce(db.func.max(NoteFolder.pin_order), 0))
            .filter(NoteFolder.user_id == user.id, NoteFolder.pinned.is_(True))
            .scalar()
            or 0
        )
        next_pin_order = max(max_note_pin, max_folder_pin) + 1
        count = 0
        for note in notes:
            if not note.pinned:
                note.pinned = True
                note.pin_order = next_pin_order
                next_pin_order += 1
                count += 1
        db.session.commit()
        return jsonify({"updated": count})

    if action == "unpin":
        count = 0
        for note in notes:
            if note.pinned:
                note.pinned = False
                note.pin_order = 0
                count += 1
        db.session.commit()
        return jsonify({"updated": count})

    if action == "move":
        folder_id = data.get("destination_id")
        if folder_id is not None:
            try:
                folder_id = int(folder_id)
            except (ValueError, TypeError):
                return jsonify({"error": "Invalid destination_id"}), 400
            folder = NoteFolder.query.filter_by(id=folder_id, user_id=user.id).first()
            if not folder:
                return jsonify({"error": "Destination folder not found"}), 404
        else:
            folder_id = None

        for note in notes:
            note.folder_id = folder_id
        db.session.commit()
        return jsonify({"updated": len(notes)})

    return jsonify({"error": "Unknown action"}), 400


def bulk_vault_documents_route(
    *,
    request,
    jsonify,
    get_current_user,
    Document,
    DocumentFolder,
    db,
    os_module,
    vault_root_for_user,
    now_local,
):
    user = get_current_user()
    if not user:
        return jsonify({"error": "No user selected"}), 401

    data = request.json or {}
    raw_ids = data.get("ids") or []
    action = data.get("action")

    if not raw_ids or not isinstance(raw_ids, list):
        return jsonify({"error": "ids list is required"}), 400
    if action not in ["delete", "archive", "unarchive", "pin", "unpin", "move"]:
        return (
            jsonify(
                {
                    "error": "action must be delete, archive, unarchive, pin, unpin, or move"
                }
            ),
            400,
        )

    ids = _normalize_ids(raw_ids)
    if not ids:
        return jsonify({"error": "No valid document ids provided"}), 400

    docs = Document.query.filter(Document.id.in_(ids), Document.user_id == user.id).all()
    if not docs:
        return jsonify({"error": "No matching documents found"}), 404

    if action == "delete":
        file_paths = []
        for doc in docs:
            file_paths.append(
                os_module.path.join(
                    vault_root_for_user(user.id),
                    os_module.path.basename(doc.stored_filename or ""),
                )
            )
            db.session.delete(doc)
        db.session.commit()
        for file_path in file_paths:
            try:
                if os_module.path.isfile(file_path):
                    os_module.remove(file_path)
            except OSError:
                pass
        return jsonify({"deleted": len(docs)})

    if action == "archive":
        now = now_local()
        count = 0
        for doc in docs:
            if not doc.archived_at:
                doc.archived_at = now
                doc.pinned = False
                doc.pin_order = 0
                doc.updated_at = now
                count += 1
        db.session.commit()
        return jsonify({"updated": count})

    if action == "unarchive":
        now = now_local()
        count = 0
        for doc in docs:
            if doc.archived_at:
                doc.archived_at = None
                if doc.folder_id is not None:
                    folder = DocumentFolder.query.filter_by(
                        id=doc.folder_id,
                        user_id=user.id,
                    ).first()
                    if not folder or folder.archived_at:
                        doc.folder_id = None
                doc.updated_at = now
                count += 1
        db.session.commit()
        return jsonify({"updated": count})

    if action == "pin":
        max_pin = (
            db.session.query(db.func.coalesce(db.func.max(Document.pin_order), 0))
            .filter(Document.user_id == user.id, Document.pinned.is_(True))
            .scalar()
            or 0
        )
        count = 0
        for doc in docs:
            if not doc.pinned:
                max_pin += 1
                doc.pinned = True
                doc.pin_order = max_pin
                doc.updated_at = now_local()
                count += 1
        db.session.commit()
        return jsonify({"updated": count})

    if action == "unpin":
        count = 0
        for doc in docs:
            if doc.pinned:
                doc.pinned = False
                doc.pin_order = 0
                doc.updated_at = now_local()
                count += 1
        db.session.commit()
        return jsonify({"updated": count})

    if action == "move":
        folder_id = data.get("destination_id")
        if folder_id is not None:
            try:
                folder_id = int(folder_id)
            except (ValueError, TypeError):
                return jsonify({"error": "Invalid destination_id"}), 400
            folder = DocumentFolder.query.filter_by(
                id=folder_id,
                user_id=user.id,
                archived_at=None,
            ).first()
            if not folder:
                return jsonify({"error": "Destination folder not found"}), 404
        else:
            folder_id = None

        for doc in docs:
            doc.folder_id = folder_id
            doc.updated_at = now_local()
        db.session.commit()
        return jsonify({"updated": len(docs)})

    return jsonify({"error": "Unknown action"}), 400
