def handle_quick_access_route(
    *,
    request,
    jsonify,
    get_current_user,
    QuickAccessItem,
    Note,
    NoteFolder,
    db,
):
    user = get_current_user()
    if not user:
        return jsonify({"error": "No user selected"}), 401

    if request.method == "GET":
        items = (
            QuickAccessItem.query.filter_by(user_id=user.id)
            .order_by(QuickAccessItem.order_index)
            .all()
        )
        result = []
        for item in items:
            item_dict = item.to_dict()
            item_dict["is_protected"] = False
            item_dict["protected_type"] = None
            if item.item_type == "note" and item.reference_id:
                note = Note.query.filter_by(id=item.reference_id, user_id=user.id).first()
                if note:
                    if note.is_pin_protected:
                        item_dict["is_protected"] = True
                        item_dict["protected_type"] = "note"
                    elif note.folder_id:
                        folder = NoteFolder.query.filter_by(
                            id=note.folder_id, user_id=user.id
                        ).first()
                        if folder and folder.is_pin_protected:
                            item_dict["is_protected"] = True
                            item_dict["protected_type"] = "parent_folder"
                            item_dict["protected_folder_id"] = folder.id
            elif item.item_type == "folder" and item.reference_id:
                folder = NoteFolder.query.filter_by(id=item.reference_id, user_id=user.id).first()
                if folder and folder.is_pin_protected:
                    item_dict["is_protected"] = True
                    item_dict["protected_type"] = "folder"
            result.append(item_dict)
        return jsonify(result)

    data = request.get_json(silent=True) or {}
    title = data.get("title", "").strip()
    if not title:
        return jsonify({"error": "Title is required"}), 400

    max_order = (
        db.session.query(db.func.max(QuickAccessItem.order_index))
        .filter_by(user_id=user.id)
        .scalar()
        or 0
    )

    new_item = QuickAccessItem(
        user_id=user.id,
        title=title,
        icon=data.get("icon", "fa-solid fa-bookmark"),
        url=data.get("url", ""),
        item_type=data.get("item_type", "custom"),
        reference_id=data.get("reference_id"),
        order_index=max_order + 1,
    )
    db.session.add(new_item)
    db.session.commit()
    return jsonify(new_item.to_dict()), 201


def quick_access_item_route(
    *,
    item_id,
    request,
    jsonify,
    get_current_user,
    QuickAccessItem,
    db,
    delete_embedding,
    entity_bookmark,
):
    user = get_current_user()
    if not user:
        return jsonify({"error": "No user selected"}), 401

    item = QuickAccessItem.query.filter_by(id=item_id, user_id=user.id).first_or_404()
    if request.method == "PUT":
        data = request.json or {}
        title = (data.get("title") or "").strip()
        if not title:
            return jsonify({"error": "Title is required"}), 400
        item.title = title
        item.icon = (data.get("icon") or item.icon or "fa-solid fa-bookmark").strip()
        item.url = (data.get("url") or "").strip()
        item.item_type = (data.get("item_type") or item.item_type or "custom").strip()
        item.reference_id = data.get("reference_id")
        db.session.commit()
        return jsonify(item.to_dict())

    db.session.delete(item)
    db.session.commit()
    delete_embedding(user.id, entity_bookmark, item.id)
    return jsonify({"message": "Deleted"})


def quick_access_order_route(
    *,
    request,
    jsonify,
    get_current_user,
    QuickAccessItem,
    db,
):
    user = get_current_user()
    if not user:
        return jsonify({"error": "No user selected"}), 401

    data = request.json or {}
    order = data.get("order") or []
    if not isinstance(order, list):
        return jsonify({"error": "Order must be a list"}), 400

    ordered_ids = []
    for raw_id in order:
        try:
            ordered_ids.append(int(raw_id))
        except (TypeError, ValueError):
            continue

    if not ordered_ids:
        return jsonify({"error": "Order is empty"}), 400

    items = QuickAccessItem.query.filter(
        QuickAccessItem.user_id == user.id,
        QuickAccessItem.id.in_(ordered_ids),
    ).all()
    item_map = {item.id: item for item in items}

    order_index = 1
    for item_id in ordered_ids:
        item = item_map.get(item_id)
        if not item:
            continue
        item.order_index = order_index
        order_index += 1

    remaining_items = (
        QuickAccessItem.query.filter(
            QuickAccessItem.user_id == user.id,
            ~QuickAccessItem.id.in_(ordered_ids),
        )
        .order_by(QuickAccessItem.order_index.asc())
        .all()
    )

    for item in remaining_items:
        item.order_index = order_index
        order_index += 1

    db.session.commit()
    return jsonify({"message": "Order updated"})


def handle_bookmarks_route(
    *,
    request,
    jsonify,
    get_current_user,
    BookmarkItem,
    db,
    start_embedding_job,
    entity_bookmark,
):
    user = get_current_user()
    if not user:
        return jsonify({"error": "No user selected"}), 401

    if request.method == "GET":
        items = BookmarkItem.query.filter_by(user_id=user.id).order_by(
            BookmarkItem.pinned.desc(),
            BookmarkItem.pin_order.desc(),
            BookmarkItem.updated_at.desc(),
            BookmarkItem.created_at.desc(),
        ).all()
        return jsonify([item.to_dict() for item in items])

    data = request.json or {}
    title = (data.get("title") or "").strip()
    value = (data.get("value") or "").strip()
    description = (data.get("description") or "").strip() or None
    pinned = bool(data.get("pinned", False))
    if not title or not value:
        return jsonify({"error": "Title and value are required"}), 400

    pin_order = 0
    if pinned:
        pin_order = (
            db.session.query(db.func.coalesce(db.func.max(BookmarkItem.pin_order), 0))
            .filter_by(user_id=user.id)
            .scalar()
        ) + 1

    new_item = BookmarkItem(
        user_id=user.id,
        title=title,
        description=description,
        value=value,
        pinned=pinned,
        pin_order=pin_order,
    )
    db.session.add(new_item)
    db.session.commit()
    start_embedding_job(user.id, entity_bookmark, new_item.id)
    return jsonify(new_item.to_dict()), 201


def bookmark_detail_route(
    *,
    item_id,
    request,
    jsonify,
    get_current_user,
    BookmarkItem,
    db,
    start_embedding_job,
    delete_embedding,
    entity_bookmark,
):
    user = get_current_user()
    if not user:
        return jsonify({"error": "No user selected"}), 401

    item = BookmarkItem.query.filter_by(id=item_id, user_id=user.id).first_or_404()

    if request.method == "GET":
        return jsonify(item.to_dict())

    if request.method == "PUT":
        data = request.json or {}
        if "title" in data:
            title = (data.get("title") or "").strip()
            if not title:
                return jsonify({"error": "Title is required"}), 400
            item.title = title
        if "value" in data:
            value = (data.get("value") or "").strip()
            if not value:
                return jsonify({"error": "Value is required"}), 400
            item.value = value
        if "description" in data:
            description = (data.get("description") or "").strip()
            item.description = description or None

        if "pinned" in data:
            pinned = bool(data.get("pinned"))
            if pinned and not item.pinned:
                max_pin = (
                    db.session.query(db.func.coalesce(db.func.max(BookmarkItem.pin_order), 0))
                    .filter_by(user_id=user.id)
                    .scalar()
                )
                item.pin_order = (max_pin or 0) + 1
            elif not pinned:
                item.pin_order = 0
            item.pinned = pinned

        db.session.commit()
        start_embedding_job(user.id, entity_bookmark, item.id)
        return jsonify(item.to_dict())

    delete_embedding(user.id, entity_bookmark, item.id)
    db.session.delete(item)
    db.session.commit()
    return jsonify({"message": "Deleted"})


def bulk_bookmarks_route(
    *,
    request,
    jsonify,
    get_current_user,
    BookmarkItem,
    db,
):
    user = get_current_user()
    if not user:
        return jsonify({"error": "No user selected"}), 401

    data = request.json or {}
    raw_ids = data.get("ids") or []
    action = data.get("action")

    if not raw_ids or not isinstance(raw_ids, list):
        return jsonify({"error": "ids list is required"}), 400
    if action not in ["delete", "pin", "unpin"]:
        return jsonify({"error": "action must be delete, pin, or unpin"}), 400

    ids = []
    for raw_id in raw_ids:
        try:
            ids.append(int(raw_id))
        except (ValueError, TypeError):
            continue
    if not ids:
        return jsonify({"error": "No valid bookmark ids provided"}), 400

    bookmarks = BookmarkItem.query.filter(
        BookmarkItem.id.in_(ids), BookmarkItem.user_id == user.id
    ).all()
    if not bookmarks:
        return jsonify({"error": "No matching bookmarks found"}), 404

    if action == "delete":
        for bookmark in bookmarks:
            db.session.delete(bookmark)
        db.session.commit()
        return jsonify({"deleted": len(bookmarks)})

    if action == "pin":
        count = 0
        for bookmark in bookmarks:
            if not bookmark.pinned:
                bookmark.pinned = True
                count += 1
        db.session.commit()
        return jsonify({"updated": count})

    if action == "unpin":
        count = 0
        for bookmark in bookmarks:
            if bookmark.pinned:
                bookmark.pinned = False
                count += 1
        db.session.commit()
        return jsonify({"updated": count})

    return jsonify({"error": "Unknown action"}), 400
