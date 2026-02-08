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
        count = 0
        for note in notes:
            if not note.pinned:
                note.pinned = True
                count += 1
        db.session.commit()
        return jsonify({"updated": count})

    if action == "unpin":
        count = 0
        for note in notes:
            if note.pinned:
                note.pinned = False
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
    app,
    os_module,
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
        for doc in docs:
            try:
                file_path = os_module.path.join(
                    app.config.get("VAULT_UPLOAD_FOLDER", "vault_uploads"),
                    doc.stored_filename,
                )
                if os_module.path.exists(file_path):
                    os_module.remove(file_path)
            except Exception:
                pass
            db.session.delete(doc)
        db.session.commit()
        return jsonify({"deleted": len(docs)})

    if action == "archive":
        now = datetime.now(pytz.UTC).replace(tzinfo=None)
        count = 0
        for doc in docs:
            if not doc.archived_at:
                doc.archived_at = now
                count += 1
        db.session.commit()
        return jsonify({"updated": count})

    if action == "unarchive":
        count = 0
        for doc in docs:
            if doc.archived_at:
                doc.archived_at = None
                count += 1
        db.session.commit()
        return jsonify({"updated": count})

    if action == "pin":
        count = 0
        for doc in docs:
            if not doc.pinned:
                doc.pinned = True
                count += 1
        db.session.commit()
        return jsonify({"updated": count})

    if action == "unpin":
        count = 0
        for doc in docs:
            if doc.pinned:
                doc.pinned = False
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
            folder = DocumentFolder.query.filter_by(id=folder_id, user_id=user.id).first()
            if not folder:
                return jsonify({"error": "Destination folder not found"}), 404
        else:
            folder_id = None

        for doc in docs:
            doc.folder_id = folder_id
        db.session.commit()
        return jsonify({"updated": len(docs)})

    return jsonify({"error": "Unknown action"}), 400
