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
        app=app,
        os_module=os,
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


if __name__ == '__main__':
    debug_enabled = os.environ.get('FLASK_DEBUG', '').lower() in ('1', 'true', 'yes', 'on')
    app.run(host='0.0.0.0', port=5004, debug=debug_enabled)

