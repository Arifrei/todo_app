"""Extracted route handlers grouped by domain for readability."""

import app as _app_module

# Keep access to shared app context, models, helpers, and constants.
for _name, _value in vars(_app_module).items():
    if not _name.startswith('__'):
        globals()[_name] = _value

def bulk_notes():
    """Bulk operations on notes: delete, archive, unarchive, pin, unpin, move."""
    return bulk_notes_route(
        request=request,
        jsonify=jsonify,
        get_current_user=get_current_user,
        Note=Note,
        NoteFolder=NoteFolder,
        db=db,
        delete_embedding=delete_embedding,
    )



def bulk_vault_documents():
    """Bulk operations on vault documents: delete, archive, unarchive, pin, unpin, move."""
    return bulk_vault_documents_route(
        request=request,
        jsonify=jsonify,
        get_current_user=get_current_user,
        Document=Document,
        DocumentFolder=DocumentFolder,
        db=db,
        os_module=os,
        vault_root_for_user=_vault_root_for_user,
        now_local=_now_local,
    )


def _area_scope_or_response(area_id):
    user = get_current_user()
    if not user:
        return None, (jsonify({'error': 'No user selected'}), 401)
    area = Area.query.filter_by(id=area_id, user_id=user.id).first()
    if not area:
        return None, (jsonify({'error': 'Area not found'}), 404)
    return area, None


def area_bulk_vault_documents(area_id):
    """Bulk operations on Area vault documents."""
    area, response = _area_scope_or_response(area_id)
    if response:
        return response
    return bulk_vault_documents_route(
        request=request,
        jsonify=jsonify,
        get_current_user=get_current_user,
        Document=Document,
        DocumentFolder=DocumentFolder,
        db=db,
        os_module=os,
        vault_root_for_user=_vault_root_for_user,
        now_local=_now_local,
        area_id=area.id,
    )



def bulk_bookmarks():
    """Bulk operations on bookmarks: delete, pin, unpin."""
    return bulk_bookmarks_route(
        request=request,
        jsonify=jsonify,
        get_current_user=get_current_user,
        BookmarkItem=BookmarkItem,
        db=db,
    )


def area_bulk_bookmarks(area_id):
    """Bulk operations on Area bookmarks."""
    area, response = _area_scope_or_response(area_id)
    if response:
        return response
    return bulk_bookmarks_route(
        request=request,
        jsonify=jsonify,
        get_current_user=get_current_user,
        BookmarkItem=BookmarkItem,
        db=db,
        area_id=area.id,
    )


if __name__ == '__main__':
    debug_enabled = os.environ.get('FLASK_DEBUG', '').lower() in ('1', 'true', 'yes', 'on')
    app.run(host='0.0.0.0', port=5000, debug=debug_enabled)

