"""Quick access and bookmark route helpers extracted from app.py."""

import app as _app_module

# Keep access to shared app context, models, and helper callables.
for _name, _value in vars(_app_module).items():
    if not _name.startswith('__'):
        globals()[_name] = _value


def handle_quick_access():
    return handle_quick_access_route(
        request=request,
        jsonify=jsonify,
        get_current_user=get_current_user,
        QuickAccessItem=QuickAccessItem,
        Note=Note,
        NoteFolder=NoteFolder,
        db=db,
    )


def delete_quick_access(item_id):
    return quick_access_item_route(
        item_id=item_id,
        request=request,
        jsonify=jsonify,
        get_current_user=get_current_user,
        QuickAccessItem=QuickAccessItem,
        db=db,
        delete_embedding=delete_embedding,
        entity_bookmark=ENTITY_BOOKMARK,
    )


def update_quick_access_order():
    return quick_access_order_route(
        request=request,
        jsonify=jsonify,
        get_current_user=get_current_user,
        QuickAccessItem=QuickAccessItem,
        db=db,
    )


def handle_bookmarks():
    return handle_bookmarks_route(
        request=request,
        jsonify=jsonify,
        get_current_user=get_current_user,
        BookmarkItem=BookmarkItem,
        db=db,
        start_embedding_job=start_embedding_job,
        entity_bookmark=ENTITY_BOOKMARK,
    )


def bookmark_detail(item_id):
    return bookmark_detail_route(
        item_id=item_id,
        request=request,
        jsonify=jsonify,
        get_current_user=get_current_user,
        BookmarkItem=BookmarkItem,
        db=db,
        start_embedding_job=start_embedding_job,
        delete_embedding=delete_embedding,
        entity_bookmark=ENTITY_BOOKMARK,
    )
