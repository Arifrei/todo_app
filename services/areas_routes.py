"""Areas page and API handlers."""

import re
from datetime import datetime, timezone


AREA_BLOCK_TYPES = {'line', 'note', 'list', 'task_list'}
AREA_BLOCK_ITEM_TYPES = {'item', 'section', 'subsection', 'linked_note', 'linked_list'}
AREA_ITEM_STATUSES = {'open', 'done', 'later'}
LIST_SECTION_PREFIX = '[[section]]'
LIST_SUBSECTION_PREFIX = '[[subsection]]'
AREA_TASK_STATUS_TO_TASK = {
    'open': 'not_started',
    'later': 'in_progress',
    'done': 'done',
}
TASK_STATUS_TO_AREA_TASK = {
    'not_started': 'open',
    'in_progress': 'later',
    'done': 'done',
}
DEFAULT_AREA_COLOR = '#3b82f6'
DEFAULT_AREA_ICON = 'fa-solid fa-layer-group'
DEFAULT_SECTION_TITLE = 'Untitled list'
DEFAULT_SECTIONS = (
    ('line', DEFAULT_SECTION_TITLE, 'Quick lines and open loops.'),
    ('note', DEFAULT_SECTION_TITLE, 'Notes and durable reference.'),
    ('list', DEFAULT_SECTION_TITLE, 'Lists and checklists.'),
    ('task_list', DEFAULT_SECTION_TITLE, 'Area task lists.'),
)


def _app_module():
    import app as a

    return a


def _trim(value, max_length=None):
    text = re.sub(r'\s+', ' ', str(value or '')).strip()
    if max_length and len(text) > max_length:
        text = text[:max_length].strip()
    return text


def _nullable_text(value):
    text = str(value or '').strip()
    return text or None


def _parse_optional_date(a, data, key='scheduled_date'):
    if key not in data:
        return None, False, None
    raw_value = data.get(key)
    if isinstance(raw_value, str):
        raw_value = raw_value.strip()
    if raw_value in (None, ''):
        return None, True, None
    parsed = a.parse_day_value(raw_value)
    if parsed is None:
        return None, True, f'Invalid {key}'
    return parsed, True, None


def _parse_order_index(raw_value):
    if raw_value in (None, ''):
        return None
    try:
        return int(raw_value)
    except (TypeError, ValueError):
        return None


def _parse_bool(raw_value):
    if isinstance(raw_value, bool):
        return raw_value
    if isinstance(raw_value, (int, float)):
        return bool(raw_value)
    if isinstance(raw_value, str):
        return raw_value.strip().lower() in {'1', 'true', 'yes', 'on', 'done', 'checked'}
    return False


def _area_query_for_user(a, user):
    return a.Area.query.filter_by(user_id=user.id)


def _area_item_query_for_user(a, user):
    return a.AreaItem.query.filter_by(user_id=user.id)


def _area_section_query_for_user(a, user):
    return a.AreaSection.query.filter_by(user_id=user.id)


def _area_block_query_for_user(a, user):
    return a.AreaBlock.query.filter_by(user_id=user.id)


def _area_block_item_query_for_user(a, user):
    return a.AreaBlockItem.query.filter_by(user_id=user.id)


def _next_order(a, model, **filters):
    query = a.db.session.query(a.func.coalesce(a.func.max(model.order_index), 0))
    for field, value in filters.items():
        query = query.filter(getattr(model, field) == value)
    return (query.scalar() or 0) + 1


def _validate_linked_note(a, user, raw_note_id):
    if raw_note_id in (None, ''):
        return None, None
    try:
        note_id = int(raw_note_id)
    except (TypeError, ValueError):
        return None, 'Invalid linked_note_id'
    note = a.Note.query.filter_by(id=note_id, user_id=user.id).first()
    if not note:
        return None, 'Linked note not found'
    return note_id, None


def _validate_section(a, user, area, raw_section_id, block_type=None):
    if raw_section_id in (None, ''):
        return None, None
    try:
        section_id = int(raw_section_id)
    except (TypeError, ValueError):
        return None, 'Invalid section_id'
    section = _area_section_query_for_user(a, user).filter_by(id=section_id, area_id=area.id).first()
    if not section:
        return None, 'Section not found'
    if block_type and (section.block_type or 'line') != block_type:
        return None, 'Section does not match this item type'
    return section_id, None


def _validate_linked_area_block(a, user, area_id, raw_block_id):
    if raw_block_id in (None, ''):
        return None, None, None
    try:
        block_id = int(raw_block_id)
    except (TypeError, ValueError):
        return None, None, 'Invalid linked_block_id'
    block = _area_block_query_for_user(a, user).filter_by(id=block_id, area_id=area_id).first()
    if not block:
        return None, None, 'Linked area item not found'
    if block.block_type not in {'note', 'list', 'task_list'}:
        return None, None, 'Linked area item must be a note, list, or task list'
    return block_id, block, None


def _apply_area_payload(a, area, data, *, creating=False):
    if creating or 'name' in data:
        name = _trim(data.get('name'), 120)
        if not name:
            return 'Name is required'
        area.name = name
    if 'description' in data:
        area.description = _nullable_text(data.get('description'))
    if 'color' in data:
        color = _trim(data.get('color'), 20)
        area.color = color or DEFAULT_AREA_COLOR
    if 'icon' in data:
        icon = _trim(data.get('icon'), 80)
        area.icon = icon or DEFAULT_AREA_ICON
    if 'order_index' in data:
        order_index = _parse_order_index(data.get('order_index'))
        if order_index is not None:
            area.order_index = order_index
    return None


def _seed_area_workspace(a, user, area):
    if _area_section_query_for_user(a, user).filter_by(area_id=area.id).first():
        return
    for block_type, title, description in DEFAULT_SECTIONS:
        a.db.session.add(
            a.AreaSection(
                user_id=user.id,
                area_id=area.id,
                block_type=block_type,
                title=title,
                description=description,
                order_index=1,
            )
        )


def _ensure_section_for_type(a, user, area, block_type, *, exclude_section_id=None):
    block_type = (block_type or 'line').lower()
    query = _area_section_query_for_user(a, user).filter_by(area_id=area.id, block_type=block_type)
    if exclude_section_id is not None:
        query = query.filter(a.AreaSection.id != exclude_section_id)
    section = query.order_by(a.AreaSection.order_index.asc(), a.AreaSection.id.asc()).first()
    if section:
        return section

    section = a.AreaSection(
        user_id=user.id,
        area_id=area.id,
        block_type=block_type,
        title=DEFAULT_SECTION_TITLE,
        order_index=_next_order(a, a.AreaSection, user_id=user.id, area_id=area.id, block_type=block_type),
    )
    a.db.session.add(section)
    a.db.session.flush()
    return section


def _ensure_area_workspace_lists(a, user, area):
    for block_type, _title, _description in DEFAULT_SECTIONS:
        _ensure_section_for_type(a, user, area, block_type)

    sections = _area_section_query_for_user(a, user).filter_by(area_id=area.id).all()
    section_map = {section.id: section for section in sections}
    default_by_type = {
        block_type: _ensure_section_for_type(a, user, area, block_type)
        for block_type, _title, _description in DEFAULT_SECTIONS
    }

    changed = False
    blocks = _area_block_query_for_user(a, user).filter_by(area_id=area.id).all()
    for block in blocks:
        block_type = block.block_type or 'line'
        section = section_map.get(block.section_id)
        if section and (section.block_type or 'line') == block_type:
            continue
        block.section_id = default_by_type[block_type].id
        changed = True
    if changed:
        a.db.session.flush()


def _apply_section_payload(section, data, *, creating=False):
    if creating or 'block_type' in data or 'type' in data:
        block_type = _trim(data.get('block_type') or data.get('type') or 'line', 30).lower()
        if block_type not in AREA_BLOCK_TYPES:
            return 'Section type must be line, note, list, or task_list'
        if not creating and block_type != (section.block_type or 'line') and section.blocks:
            return 'Section type cannot change while it has items'
        section.block_type = block_type

    if creating or 'title' in data:
        title = _trim(data.get('title'), 120)
        if not title:
            return 'Title is required'
        section.title = title
    if 'description' in data:
        section.description = _nullable_text(data.get('description'))
    if 'order_index' in data:
        order_index = _parse_order_index(data.get('order_index'))
        if order_index is not None:
            section.order_index = order_index
    return None


def _apply_status(item, status):
    previous_status = item.status or 'open'
    item.status = status
    if status == 'done':
        if previous_status != 'done' or item.completed_at is None:
            item.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    else:
        item.completed_at = None


def _apply_area_item_status(item, status):
    _apply_status(item, status)


def _apply_area_item_payload(a, user, item, data, *, creating=False):
    if creating or 'text' in data:
        text = _trim(data.get('text'), 300)
        if not text:
            return 'Text is required'
        item.text = text
    if 'details' in data:
        item.details = _nullable_text(data.get('details'))
    if 'status' in data:
        status = _trim(data.get('status'), 20).lower() or 'open'
        if status not in AREA_ITEM_STATUSES:
            return 'Status must be open, done, or later'
        _apply_area_item_status(item, status)
    elif creating:
        _apply_area_item_status(item, item.status or 'open')

    scheduled_date, has_scheduled_date, date_error = _parse_optional_date(a, data)
    if date_error:
        return date_error
    if has_scheduled_date:
        item.scheduled_date = scheduled_date

    if 'linked_note_id' in data:
        linked_note_id, link_error = _validate_linked_note(a, user, data.get('linked_note_id'))
        if link_error:
            return link_error
        item.linked_note_id = linked_note_id

    if 'order_index' in data:
        order_index = _parse_order_index(data.get('order_index'))
        if order_index is not None:
            item.order_index = order_index
    return None


def _apply_block_payload(a, user, area, block, data, *, creating=False):
    if creating or 'block_type' in data or 'type' in data:
        block_type = _trim(data.get('block_type') or data.get('type'), 30).lower()
        if block_type not in AREA_BLOCK_TYPES:
            return 'Block type must be line, note, list, or task_list'
        block.block_type = block_type

    if 'section_id' in data:
        section_id, section_error = _validate_section(a, user, area, data.get('section_id'), block.block_type)
        if section_error:
            return section_error
        if section_id is None:
            section_id = _ensure_section_for_type(a, user, area, block.block_type).id
        block.section_id = section_id
    elif creating:
        block.section_id = _ensure_section_for_type(a, user, area, block.block_type).id

    if 'title' in data:
        block.title = _trim(data.get('title'), 180) or None

    if 'content' in data or 'text' in data:
        raw_content = data.get('content') if 'content' in data else data.get('text')
        if (block.block_type or '').lower() == 'note':
            block.content = _nullable_text(a._sanitize_note_html(raw_content or ''))
        else:
            block.content = _nullable_text(raw_content)

    if creating:
        if block.block_type == 'line' and not block.content:
            return 'Line text is required'
        if block.block_type == 'note' and not block.title and not block.content:
            block.title = 'Untitled note'
        if block.block_type == 'list' and not block.title:
            block.title = 'List'
        if block.block_type == 'task_list' and not block.title:
            block.title = 'Task list'
        if block.block_type == 'task_list':
            block.checkbox_mode = True
        if block.block_type in {'list', 'task_list'} and not block.list_mode:
            block.list_mode = 'standard'

    if 'order_index' in data:
        order_index = _parse_order_index(data.get('order_index'))
        if order_index is not None:
            block.order_index = order_index
    return None


def _apply_block_item_payload(a, user, item, data, *, creating=False, block=None):
    owning_block = block or item.block
    linked_block = None
    if creating or 'item_type' in data or 'type' in data:
        item_type = _trim(data.get('item_type') or data.get('type') or 'item', 30).lower()
        if item_type not in AREA_BLOCK_ITEM_TYPES:
            return 'Item type must be item, section, subsection, linked_note, or linked_list'
        if owning_block and owning_block.block_type == 'task_list' and item_type != 'item':
            return 'Task lists only support task rows'
        item.item_type = item_type

    if 'linked_block_id' in data:
        linked_block_id, linked_block, link_error = _validate_linked_area_block(
            a,
            user,
            item.area_id,
            data.get('linked_block_id'),
        )
        if link_error:
            return link_error
        item.linked_block_id = linked_block_id

    if item.linked_block_id and linked_block is None:
        linked_block = _area_block_query_for_user(a, user).filter_by(
            id=item.linked_block_id,
            area_id=item.area_id,
        ).first()

    item_type = item.item_type or 'item'
    if item_type == 'linked_note' and linked_block and linked_block.block_type != 'note':
        return 'Linked note rows must target an Area note'
    if item_type == 'linked_list' and linked_block and linked_block.block_type not in {'list', 'task_list'}:
        return 'Linked list rows must target an Area list or task list'

    if creating or 'text' in data:
        text = _trim(data.get('text') or data.get('title') or data.get('link_text'), 500)
        if not text and linked_block:
            text = _trim(linked_block.title, 500)
        if not text:
            return 'Text is required'
        item.text = text
    if 'details' in data:
        item.details = _nullable_text(data.get('details'))
    if 'note' in data:
        item.note = _nullable_text(data.get('note'))
    if 'inner_note' in data:
        item.inner_note = _nullable_text(a._sanitize_note_html(data.get('inner_note') or ''))
    if 'link_text' in data:
        item.link_text = _trim(data.get('link_text'), 200) or None
    elif creating and linked_block and not item.link_text:
        item.link_text = _trim(linked_block.title, 200) or None
    if 'link_url' in data:
        item.link_url = _trim(data.get('link_url'), 500) or None

    if 'checked' in data:
        item.checked = _parse_bool(data.get('checked'))
        if owning_block and owning_block.block_type == 'list':
            _apply_status(item, 'done' if item.checked else 'open')

    if 'status' in data:
        status = _trim(data.get('status'), 20).lower() or 'open'
        if status not in AREA_ITEM_STATUSES:
            return 'Status must be open, done, or later'
        _apply_status(item, status)
        item.checked = status == 'done'
    elif creating:
        if item.checked:
            _apply_status(item, 'done')
        else:
            _apply_status(item, item.status or 'open')

    scheduled_date, has_scheduled_date, date_error = _parse_optional_date(a, data)
    if date_error:
        return date_error
    if has_scheduled_date:
        item.scheduled_date = scheduled_date

    if 'order_index' in data:
        order_index = _parse_order_index(data.get('order_index'))
        if order_index is not None:
            item.order_index = order_index
    return None


def _normalize_area_list_mode(raw_value):
    value = _trim(raw_value, 20).lower()
    return value if value in {'standard', 'revolving'} else 'standard'


def _area_list_full_text(item):
    text = _trim(getattr(item, 'text', ''), 500)
    item_type = getattr(item, 'item_type', 'item') or 'item'
    if item_type == 'section':
        return f'{LIST_SECTION_PREFIX} {text}'.strip()
    if item_type == 'subsection':
        return f'{LIST_SUBSECTION_PREFIX} {text}'.strip()
    return text


def _parse_area_list_text(raw_text):
    text = _trim(raw_text, 500)
    if text.startswith(LIST_SECTION_PREFIX):
        return 'section', _trim(text[len(LIST_SECTION_PREFIX):], 500) or 'Untitled section'
    if text.startswith(LIST_SUBSECTION_PREFIX):
        return 'subsection', _trim(text[len(LIST_SUBSECTION_PREFIX):], 500) or 'Untitled subsection'
    return 'item', text


def _area_list_preview_items(a, block, *, moving_item_id=None, new_text=None, insert_index=None, preserve_position=False):
    from services.notes_routes import build_note_list_order_preview

    items = _area_block_item_query_for_user(a, a.get_current_user()).filter_by(block_id=block.id).order_by(
        a.AreaBlockItem.order_index.asc(),
        a.AreaBlockItem.id.asc(),
    ).all()
    preview_source = []
    for item in items:
        text = _area_list_full_text(item)
        if moving_item_id is not None and item.id == moving_item_id and new_text is not None:
            text = new_text
        preview_source.append(
            type('AreaListPreviewItem', (), {
                'id': item.id,
                'text': text,
                'order_index': item.order_index or 0,
            })()
        )
    return build_note_list_order_preview(
        preview_source,
        moving_item_id=moving_item_id,
        insert_index=insert_index,
        preserve_position=preserve_position,
    )


def _validate_area_list_structure(a, block, *, moving_item_id=None, new_text=None, insert_index=None, preserve_position=False):
    from services.notes_routes import validate_note_list_structure

    preview_items = _area_list_preview_items(
        a,
        block,
        moving_item_id=moving_item_id,
        new_text=new_text,
        insert_index=insert_index,
        preserve_position=preserve_position,
    )
    return validate_note_list_structure(preview_items)


def _area_list_item_to_note_dict(item):
    return {
        'id': item.id,
        'note_id': item.block_id,
        'text': _area_list_full_text(item),
        'note': item.note,
        'inner_note': item.inner_note,
        'link_text': item.link_text,
        'link_url': item.link_url,
        'scheduled_date': item.scheduled_date.isoformat() if item.scheduled_date else None,
        'checked': bool(item.checked),
        'order_index': item.order_index or 0,
        'calendar_event_id': None,
        'start_time': None,
        'end_time': None,
        'reminder_minutes_before': None,
    }


def _area_list_block_to_note_dict(block, *, include_items=True):
    list_mode = _normalize_area_list_mode(block.list_mode)
    data = {
        'id': block.id,
        'user_id': block.user_id,
        'title': block.title or 'Untitled List',
        'content': block.content or '',
        'note_type': 'list',
        'checkbox_mode': bool(block.checkbox_mode),
        'list_mode': list_mode,
        'pinned': False,
        'archived_at': None,
        'is_archived': False,
        'is_listed': False,
        'is_linked_note': False,
        'is_pin_protected': False,
        'folder_id': None,
        'created_at': block.created_at.isoformat() if block.created_at else None,
        'updated_at': block.updated_at.isoformat() if block.updated_at else None,
    }
    if include_items:
        items = sorted(block.items or [], key=lambda item: ((item.order_index or 0), item.id or 0))
        data['items'] = [_area_list_item_to_note_dict(item) for item in items]
    return data


def _reindex_area_block_items(a, block_id):
    items = _area_block_item_query_for_user(a, a.get_current_user()).filter_by(block_id=block_id).order_by(
        a.AreaBlockItem.order_index.asc(),
        a.AreaBlockItem.id.asc(),
    ).all()
    for index, item in enumerate(items, start=1):
        item.order_index = index


def _promote_area_subsections_after_section_delete(a, user, block_id, deleted_item_id):
    items = _area_block_item_query_for_user(a, user).filter_by(block_id=block_id).order_by(
        a.AreaBlockItem.order_index.asc(),
        a.AreaBlockItem.id.asc(),
    ).all()
    deleted_index = next((index for index, item in enumerate(items) if item.id == deleted_item_id), -1)
    if deleted_index == -1:
        return
    for item in items[deleted_index + 1:]:
        if item.item_type == 'section':
            break
        if item.item_type == 'subsection':
            item.item_type = 'section'


def _area_task_status_to_ui(status):
    return AREA_TASK_STATUS_TO_TASK.get(status or 'open', 'not_started')


def _ui_task_status_to_area(status):
    return TASK_STATUS_TO_AREA_TASK.get(status or 'not_started', 'open')


def _area_task_linked_notes(item):
    linked_block = item.linked_block
    if not linked_block or linked_block.block_type not in {'note', 'list'}:
        return []
    note_type = 'list' if linked_block.block_type == 'list' else 'note'
    fallback_title = 'Untitled List' if note_type == 'list' else 'Untitled Note'
    return [
        {
            'id': linked_block.id,
            'area_block_id': linked_block.id,
            'title': linked_block.title or fallback_title,
            'note_type': note_type,
        }
    ]


def _area_task_item_to_dict(item):
    return {
        'id': item.id,
        'list_id': item.block_id,
        'content': item.text,
        'description': item.details,
        'notes': item.note,
        'tags': None,
        'status': _area_task_status_to_ui(item.status),
        'order_index': item.order_index or 0,
        'is_phase': False,
        'phase_id': None,
        'due_date': item.scheduled_date.isoformat() if item.scheduled_date else None,
        'completed_at': item.completed_at.isoformat() if item.completed_at else None,
        'linked_list_id': None,
        'linked_notes': _area_task_linked_notes(item),
        'dependencies': [],
    }


def _area_task_block_to_list_dict(block, *, include_items=True):
    items = sorted(block.items or [], key=lambda item: ((item.order_index or 0), item.id or 0))
    task_items = [_area_task_item_to_dict(item) for item in items]
    done_count = sum(1 for item in task_items if item['status'] == 'done')
    total = len(task_items)
    data = {
        'id': block.id,
        'title': block.title or 'Task list',
        'type': 'light',
        'created_at': block.created_at.isoformat() if block.created_at else None,
        'user_id': block.user_id,
        'order_index': block.order_index or 0,
        'progress': int((done_count / total) * 100) if total else 0,
    }
    if include_items:
        data['items'] = task_items
    return data


class _AreaTaskItemView:
    def __init__(self, item):
        self.id = item.id
        self.list_id = item.block_id
        self.content = item.text
        self.description = item.details
        self.notes = item.note
        self.tags = None
        self.status = _area_task_status_to_ui(item.status)
        self.order_index = item.order_index or 0
        self.is_phase = False
        self.phase_id = None
        self.due_date = item.scheduled_date
        self.completed_at = item.completed_at
        self.linked_list = None
        self.linked_list_id = None
        self.linked_notes = _area_task_linked_notes(item)
        self.dependencies = []

    def tag_list(self):
        return []

    def to_dict(self):
        return {
            'id': self.id,
            'list_id': self.list_id,
            'content': self.content,
            'description': self.description,
            'notes': self.notes,
            'tags': self.tags,
            'status': self.status,
            'order_index': self.order_index,
            'is_phase': self.is_phase,
            'phase_id': self.phase_id,
            'due_date': self.due_date.isoformat() if self.due_date else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'linked_list_id': self.linked_list_id,
            'linked_notes': self.linked_notes,
            'dependencies': [],
        }


class _AreaTaskListView:
    def __init__(self, block, items):
        self.id = block.id
        self.title = block.title or 'Task list'
        self.type = 'light'
        self.created_at = block.created_at
        self.user_id = block.user_id
        self.order_index = block.order_index or 0
        self.items = items

    def get_progress(self):
        if not self.items:
            return 0
        done_count = sum(1 for item in self.items if item.status == 'done')
        return int((done_count / len(self.items)) * 100)

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'type': self.type,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'user_id': self.user_id,
            'order_index': self.order_index,
            'progress': self.get_progress(),
            'items': [item.to_dict() for item in self.items],
        }


def _render_area_task_block(a, area, block):
    item_models = sorted(block.items or [], key=lambda item: ((item.order_index or 0), item.id or 0))
    items = [_AreaTaskItemView(item) for item in item_models]
    todo_list = _AreaTaskListView(block, items)
    return a.render_template(
        'list_view.html',
        todo_list=todo_list,
        parent_list=None,
        items=items,
        blocked_ids=set(),
        blocked_items=[],
        linked_calendar_events={},
        default_timezone=a.app.config.get('DEFAULT_TIMEZONE'),
        area_task_context={
            'area_id': area.id,
            'area_name': area.name,
            'block_id': block.id,
            'return_url': f'/areas/{area.id}',
        },
    )


def areas_page():
    a = _app_module()
    if not a.get_current_user():
        return a.redirect(a.url_for('select_user'))
    return a.render_template('areas.html', area_id=None)


def area_detail_page(area_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.redirect(a.url_for('select_user'))
    _area_query_for_user(a, user).filter_by(id=area_id).first_or_404()
    return a.render_template('areas.html', area_id=area_id)


def area_block_editor_page(area_id, block_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.redirect(a.url_for('select_user'))
    area = _area_query_for_user(a, user).filter_by(id=area_id).first_or_404()
    block = _area_block_query_for_user(a, user).filter_by(id=block_id, area_id=area.id).first_or_404()
    if block.block_type == 'line':
        return a.redirect(a.url_for('area_detail_page', area_id=area.id))
    if block.block_type == 'list':
        return a.render_template(
            'list_editor.html',
            note_id=block.id,
            area_list_context={
                'area_id': area.id,
                'area_name': area.name,
                'block_id': block.id,
                'return_url': f'/areas/{area.id}',
            },
        )
    if block.block_type == 'task_list':
        return _render_area_task_block(a, area, block)
    return a.render_template(
        'area_block_editor.html',
        area_id=area.id,
        block_id=block.id,
        block_type=block.block_type,
    )


def handle_areas():
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401

    if a.request.method == 'GET':
        archived_filter = str(a.request.args.get('archived', '0')).strip().lower()
        query = _area_query_for_user(a, user)
        if archived_filter in {'1', 'true', 'yes', 'archived'}:
            query = query.filter(a.Area.archived_at.isnot(None))
        elif archived_filter != 'all':
            query = query.filter(a.Area.archived_at.is_(None))

        search = _trim(a.request.args.get('search') or a.request.args.get('q'))
        if search:
            escaped = search.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
            query = query.filter(
                a.or_(
                    a.Area.name.ilike(f'%{escaped}%', escape='\\'),
                    a.Area.description.ilike(f'%{escaped}%', escape='\\'),
                )
            )

        areas = query.order_by(
            a.Area.order_index.asc(),
            a.Area.updated_at.desc(),
            a.Area.id.asc(),
        ).all()
        return a.jsonify([area.to_dict(include_counts=True) for area in areas])

    data = a.request.get_json(silent=True) or {}
    area = a.Area(
        user_id=user.id,
        name='',
        color=DEFAULT_AREA_COLOR,
        icon=DEFAULT_AREA_ICON,
        order_index=_next_order(a, a.Area, user_id=user.id),
    )
    error = _apply_area_payload(a, area, data, creating=True)
    if error:
        return a.jsonify({'error': error}), 400
    a.db.session.add(area)
    a.db.session.flush()
    if data.get('seed_workspace', True):
        _seed_area_workspace(a, user, area)
    a.db.session.commit()
    return a.jsonify(area.to_dict(include_counts=True)), 201


def area_detail(area_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401

    area = _area_query_for_user(a, user).filter_by(id=area_id).first_or_404()

    if a.request.method == 'GET':
        return a.jsonify(area.to_dict(include_counts=True))

    if a.request.method == 'PUT':
        data = a.request.get_json(silent=True) or {}
        error = _apply_area_payload(a, area, data)
        if error:
            return a.jsonify({'error': error}), 400
        a.db.session.commit()
        return a.jsonify(area.to_dict(include_counts=True))

    if area.archived_at is None:
        area.archived_at = a._now_local()
    a.db.session.commit()
    return a.jsonify(area.to_dict(include_counts=True))


def restore_area(area_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    area = _area_query_for_user(a, user).filter_by(id=area_id).first_or_404()
    area.archived_at = None
    a.db.session.commit()
    return a.jsonify(area.to_dict(include_counts=True))


def area_workspace(area_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    area = _area_query_for_user(a, user).filter_by(id=area_id).first_or_404()
    _ensure_area_workspace_lists(a, user, area)
    a.db.session.commit()

    sections = _area_section_query_for_user(a, user).filter_by(area_id=area.id).order_by(
        a.AreaSection.order_index.asc(),
        a.AreaSection.id.asc(),
    ).all()
    blocks = _area_block_query_for_user(a, user).filter_by(area_id=area.id).order_by(
        a.AreaBlock.order_index.asc(),
        a.AreaBlock.id.asc(),
    ).all()
    legacy_items = _area_item_query_for_user(a, user).filter_by(area_id=area.id).order_by(
        a.AreaItem.order_index.asc(),
        a.AreaItem.id.asc(),
    ).all()
    return a.jsonify(
        {
            'area': area.to_dict(include_counts=True),
            'sections': [section.to_dict() for section in sections],
            'blocks': [block.to_dict(include_items=True) for block in blocks],
            'legacy_items': [item.to_dict() for item in legacy_items],
            'block_types': sorted(AREA_BLOCK_TYPES),
        }
    )


def area_sections(area_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    area = _area_query_for_user(a, user).filter_by(id=area_id).first_or_404()
    _ensure_area_workspace_lists(a, user, area)
    a.db.session.commit()

    if a.request.method == 'GET':
        query = _area_section_query_for_user(a, user).filter_by(area_id=area.id)
        block_type = _trim(a.request.args.get('type') or a.request.args.get('block_type'), 30).lower()
        if block_type:
            if block_type not in AREA_BLOCK_TYPES:
                return a.jsonify({'error': 'Invalid section type'}), 400
            query = query.filter(a.AreaSection.block_type == block_type)
        sections = query.order_by(
            a.AreaSection.order_index.asc(),
            a.AreaSection.id.asc(),
        ).all()
        return a.jsonify([section.to_dict() for section in sections])

    data = a.request.get_json(silent=True) or {}
    block_type = _trim(data.get('block_type') or data.get('type') or 'line', 30).lower()
    if block_type not in AREA_BLOCK_TYPES:
        return a.jsonify({'error': 'Section type must be line, note, list, or task_list'}), 400
    section = a.AreaSection(
        user_id=user.id,
        area_id=area.id,
        block_type=block_type,
        title='',
        order_index=_next_order(a, a.AreaSection, user_id=user.id, area_id=area.id, block_type=block_type),
    )
    error = _apply_section_payload(section, data, creating=True)
    if error:
        return a.jsonify({'error': error}), 400
    a.db.session.add(section)
    a.db.session.commit()
    return a.jsonify(section.to_dict()), 201


def area_section_detail(section_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    section = _area_section_query_for_user(a, user).filter_by(id=section_id).first_or_404()

    if a.request.method == 'PUT':
        data = a.request.get_json(silent=True) or {}
        error = _apply_section_payload(section, data)
        if error:
            return a.jsonify({'error': error}), 400
        a.db.session.commit()
        return a.jsonify(section.to_dict())

    replacement = _ensure_section_for_type(
        a,
        user,
        section.area,
        section.block_type or 'line',
        exclude_section_id=section.id,
    )
    for block in list(section.blocks or []):
        block.section_id = replacement.id
    a.db.session.delete(section)
    a.db.session.commit()
    return '', 204


def area_blocks(area_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    area = _area_query_for_user(a, user).filter_by(id=area_id).first_or_404()
    _ensure_area_workspace_lists(a, user, area)

    if a.request.method == 'GET':
        a.db.session.commit()
        query = _area_block_query_for_user(a, user).filter_by(area_id=area.id)
        block_type = _trim(a.request.args.get('type') or a.request.args.get('block_type'), 30).lower()
        if block_type:
            if block_type not in AREA_BLOCK_TYPES:
                return a.jsonify({'error': 'Invalid block type'}), 400
            query = query.filter(a.AreaBlock.block_type == block_type)
        if 'section_id' in a.request.args:
            raw_section_id = a.request.args.get('section_id')
            if raw_section_id in (None, '', 'none', 'null'):
                query = query.filter(a.AreaBlock.section_id.is_(None))
            else:
                section_id, section_error = _validate_section(a, user, area, raw_section_id, block_type or None)
                if section_error:
                    return a.jsonify({'error': section_error}), 400
                query = query.filter(a.AreaBlock.section_id == section_id)
        blocks = query.order_by(a.AreaBlock.order_index.asc(), a.AreaBlock.id.asc()).all()
        return a.jsonify([block.to_dict(include_items=True) for block in blocks])

    data = a.request.get_json(silent=True) or {}
    block = a.AreaBlock(
        user_id=user.id,
        area_id=area.id,
        block_type='line',
        order_index=_next_order(a, a.AreaBlock, user_id=user.id, area_id=area.id),
    )
    error = _apply_block_payload(a, user, area, block, data, creating=True)
    if error:
        return a.jsonify({'error': error}), 400
    a.db.session.add(block)
    a.db.session.commit()
    return a.jsonify(block.to_dict(include_items=True)), 201


def reorder_area_blocks(area_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    area = _area_query_for_user(a, user).filter_by(id=area_id).first_or_404()
    data = a.request.get_json(silent=True) or {}
    raw_ids = data.get('ids') or []
    if not isinstance(raw_ids, list) or not raw_ids:
        return a.jsonify({'error': 'ids must be a non-empty list'}), 400
    try:
        ids = [int(raw_id) for raw_id in raw_ids]
    except (TypeError, ValueError):
        return a.jsonify({'error': 'ids must be integers'}), 400
    if len(ids) != len(set(ids)):
        return a.jsonify({'error': 'ids must be unique'}), 400

    blocks = _area_block_query_for_user(a, user).filter(
        a.AreaBlock.area_id == area.id,
        a.AreaBlock.id.in_(ids),
    ).all()
    block_map = {block.id: block for block in blocks}
    if set(block_map.keys()) != set(ids):
        return a.jsonify({'error': 'ids must reference blocks in this area'}), 400

    block_types = {block.block_type for block in blocks}
    if len(block_types) != 1:
        return a.jsonify({'error': 'Blocks can only be reordered within one item type'}), 400

    block_type = next(iter(block_types))
    scoped_query = _area_block_query_for_user(a, user).filter_by(
        area_id=area.id,
        block_type=block_type,
    )
    scoped_blocks = scoped_query.all()
    scoped_ids = {block.id for block in scoped_blocks}
    if set(ids) != scoped_ids:
        return a.jsonify({'error': 'ids must include every block in this item type'}), 400

    for index, block_id in enumerate(ids, start=1):
        block_map[block_id].order_index = index
    a.db.session.commit()
    return a.jsonify({'status': 'ok', 'ids': ids})


def area_block_detail(block_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    block = _area_block_query_for_user(a, user).filter_by(id=block_id).first_or_404()
    area = _area_query_for_user(a, user).filter_by(id=block.area_id).first_or_404()

    if a.request.method == 'GET':
        return a.jsonify(block.to_dict(include_items=True))

    if a.request.method == 'PUT':
        data = a.request.get_json(silent=True) or {}
        error = _apply_block_payload(a, user, area, block, data)
        if error:
            return a.jsonify({'error': error}), 400
        a.db.session.commit()
        return a.jsonify(block.to_dict(include_items=True))

    a.db.session.delete(block)
    a.db.session.commit()
    return '', 204


def _validate_destination_area(a, user, raw_area_id):
    try:
        area_id = int(raw_area_id)
    except (TypeError, ValueError):
        return None, 'Invalid area_id'
    area = _area_query_for_user(a, user).filter_by(id=area_id).first()
    if not area:
        return None, 'Destination area not found'
    return area, None


def _validate_note_folder(a, user, raw_folder_id):
    if raw_folder_id in (None, '', 'root', 'none', 'null'):
        return None, None
    try:
        folder_id = int(raw_folder_id)
    except (TypeError, ValueError):
        return None, 'Invalid folder_id'
    folder = a.NoteFolder.query.filter_by(id=folder_id, user_id=user.id).first()
    if not folder:
        return None, 'Folder not found'
    return folder.id, None


def _move_area_block_to_area(a, user, block, data):
    destination_area, area_error = _validate_destination_area(a, user, data.get('area_id'))
    if area_error:
        return None, area_error
    _ensure_area_workspace_lists(a, user, destination_area)
    section_id, section_error = _validate_section(a, user, destination_area, data.get('section_id'), block.block_type)
    if section_error:
        return None, section_error
    if section_id is None:
        section_id = _ensure_section_for_type(a, user, destination_area, block.block_type).id

    block.area_id = destination_area.id
    block.section_id = section_id
    block.order_index = _next_order(a, a.AreaBlock, user_id=user.id, area_id=destination_area.id)
    for item in block.items or []:
        item.area_id = destination_area.id
    a.db.session.commit()
    return {
        'status': 'moved',
        'target': 'area',
        'area_id': destination_area.id,
        'block': block.to_dict(include_items=True),
    }, None


def _area_block_to_note(a, user, block, folder_id):
    note_type = 'list' if block.block_type == 'list' else 'note'
    fallback = 'Untitled List' if note_type == 'list' else 'Untitled Note'
    note = a.Note(
        user_id=user.id,
        title=block.title or fallback,
        content=(block.content or '') if note_type == 'note' else '',
        note_type=note_type,
        checkbox_mode=bool(block.checkbox_mode) if note_type == 'list' else False,
        list_mode=_normalize_area_list_mode(block.list_mode) if note_type == 'list' else 'standard',
        folder_id=folder_id,
        is_listed=True,
    )
    a.db.session.add(note)
    a.db.session.flush()

    if note_type == 'list':
        items = sorted(block.items or [], key=lambda item: ((item.order_index or 0), item.id or 0))
        for index, item in enumerate(items, start=1):
            a.db.session.add(
                a.NoteListItem(
                    note_id=note.id,
                    text=_area_list_full_text(item),
                    note=item.note,
                    inner_note=item.inner_note,
                    link_text=item.link_text,
                    link_url=item.link_url,
                    scheduled_date=item.scheduled_date,
                    checked=bool(item.checked),
                    order_index=index,
                )
            )
    return note


def _area_task_block_to_todo_list(a, user, block):
    todo_list = a.TodoList(
        user_id=user.id,
        title=block.title or 'Task list',
        type='light',
        order_index=_next_order(a, a.TodoList, user_id=user.id, type='light'),
    )
    a.db.session.add(todo_list)
    a.db.session.flush()
    items = sorted(block.items or [], key=lambda item: ((item.order_index or 0), item.id or 0))
    for index, item in enumerate(items, start=1):
        if (item.item_type or 'item') != 'item':
            continue
        content = _trim(item.text, 200) or 'Task'
        a.db.session.add(
            a.TodoItem(
                list_id=todo_list.id,
                content=content,
                description=item.details,
                notes=item.note,
                status=_area_task_status_to_ui(item.status),
                order_index=index,
                due_date=item.scheduled_date,
                completed_at=item.completed_at,
            )
        )
    return todo_list


def _cleanup_note_source_after_area_move(a, user, note):
    if note.note_type == 'list':
        list_item_ids = [item.id for item in (note.list_items or [])]
        if list_item_ids:
            linked_events = a.CalendarEvent.query.filter(
                a.CalendarEvent.user_id == user.id,
                a.CalendarEvent.note_list_item_id.in_(list_item_ids),
            ).all()
            for linked_event in linked_events:
                a._cancel_reminder_job(linked_event)
                a.delete_embedding(user.id, a.ENTITY_CALENDAR, linked_event.id)
                a.db.session.delete(linked_event)

    a.NoteLink.query.filter(
        a.or_(a.NoteLink.source_note_id == note.id, a.NoteLink.target_note_id == note.id)
    ).delete(synchronize_session=False)
    a.db.session.delete(note)


def _note_to_area_block(a, user, note, area, section_id=None):
    note_type = note.note_type or 'note'
    is_list = note_type == 'list'
    block = a.AreaBlock(
        user_id=user.id,
        area_id=area.id,
        section_id=section_id,
        block_type='list' if is_list else 'note',
        title=note.title or ('Untitled List' if is_list else 'Untitled Note'),
        content='' if is_list else (note.content or ''),
        checkbox_mode=bool(note.checkbox_mode) if is_list else False,
        list_mode=_normalize_area_list_mode(note.list_mode) if is_list else 'standard',
        order_index=_next_order(a, a.AreaBlock, user_id=user.id, area_id=area.id),
    )
    a.db.session.add(block)
    a.db.session.flush()

    if is_list:
        completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        items = sorted(note.list_items or [], key=lambda item: ((item.order_index or 0), item.id or 0))
        for index, item in enumerate(items, start=1):
            item_type, text = _parse_area_list_text(item.text)
            checked = bool(item.checked)
            a.db.session.add(
                a.AreaBlockItem(
                    user_id=user.id,
                    area_id=area.id,
                    block_id=block.id,
                    item_type=item_type,
                    text=text or 'Untitled item',
                    note=item.note,
                    inner_note=item.inner_note,
                    link_text=item.link_text,
                    link_url=item.link_url,
                    status='done' if checked else 'open',
                    checked=checked,
                    scheduled_date=item.scheduled_date,
                    completed_at=completed_at if checked else None,
                    order_index=index,
                )
            )

    return block


def move_note_to_area_block(a, user, note, raw_area_id, raw_section_id=None):
    destination_area, area_error = _validate_destination_area(a, user, raw_area_id)
    if area_error:
        return None, area_error
    _ensure_area_workspace_lists(a, user, destination_area)
    target_block_type = 'list' if (note.note_type or 'note') == 'list' else 'note'
    section_id, section_error = _validate_section(a, user, destination_area, raw_section_id, target_block_type)
    if section_error:
        return None, section_error
    if section_id is None:
        section_id = _ensure_section_for_type(a, user, destination_area, target_block_type).id

    block = _note_to_area_block(a, user, note, destination_area, section_id)
    _cleanup_note_source_after_area_move(a, user, note)
    return block, None


def _cleanup_todo_list_source_after_area_move(a, user, todo_list):
    todo_item_ids_to_remove = set()
    for item in list(todo_list.items or []):
        todo_item_ids_to_remove.add(item.id)
        if item.linked_list:
            for child_item in (item.linked_list.items or []):
                todo_item_ids_to_remove.add(child_item.id)

    if todo_item_ids_to_remove:
        linked_events = a.CalendarEvent.query.filter(
            a.CalendarEvent.user_id == user.id,
            a.CalendarEvent.todo_item_id.in_(list(todo_item_ids_to_remove)),
        ).all()
        for linked_event in linked_events:
            a._cancel_reminder_job(linked_event)
            a.delete_embedding(user.id, a.ENTITY_CALENDAR, linked_event.id)
            a.db.session.delete(linked_event)

    for item in list(todo_list.items or []):
        if item.linked_list:
            a.delete_embedding(user.id, a.ENTITY_TODO_LIST, item.linked_list.id)
            a.db.session.delete(item.linked_list)
        a.delete_embedding(user.id, a.ENTITY_TODO_ITEM, item.id)
    a.delete_embedding(user.id, a.ENTITY_TODO_LIST, todo_list.id)
    a.db.session.delete(todo_list)


def _todo_list_to_area_task_block(a, user, todo_list, area, section_id=None):
    block = a.AreaBlock(
        user_id=user.id,
        area_id=area.id,
        section_id=section_id,
        block_type='task_list',
        title=todo_list.title or 'Task list',
        checkbox_mode=True,
        list_mode='standard',
        order_index=_next_order(a, a.AreaBlock, user_id=user.id, area_id=area.id),
    )
    a.db.session.add(block)
    a.db.session.flush()

    source_items = sorted(todo_list.items or [], key=lambda item: ((item.order_index or 0), item.id or 0))
    phase_titles = {
        item.id: item.content
        for item in source_items
        if item.ensure_phase_canonical().is_phase_header()
    }
    order_index = 1
    for item in source_items:
        item.ensure_phase_canonical()
        if item.is_phase_header():
            continue
        details = item.description
        phase_title = phase_titles.get(item.phase_id)
        if phase_title:
            phase_line = f'Phase: {phase_title}'
            details = f'{phase_line}\n\n{details}' if details else phase_line
        status = _ui_task_status_to_area(item.status)
        a.db.session.add(
            a.AreaBlockItem(
                user_id=user.id,
                area_id=area.id,
                block_id=block.id,
                item_type='item',
                text=_trim(item.content, 500) or 'Task',
                details=details,
                note=item.notes,
                status=status,
                checked=status == 'done',
                scheduled_date=item.due_date,
                completed_at=item.completed_at,
                order_index=order_index,
            )
        )
        order_index += 1

    return block


def move_todo_list_to_area_block(a, user, todo_list, raw_area_id, raw_section_id=None):
    if todo_list.type not in {'list', 'light'}:
        return None, 'Only task lists and light task lists can move to Areas'
    destination_area, area_error = _validate_destination_area(a, user, raw_area_id)
    if area_error:
        return None, area_error
    _ensure_area_workspace_lists(a, user, destination_area)
    section_id, section_error = _validate_section(a, user, destination_area, raw_section_id, 'task_list')
    if section_error:
        return None, section_error
    if section_id is None:
        section_id = _ensure_section_for_type(a, user, destination_area, 'task_list').id

    block = _todo_list_to_area_task_block(a, user, todo_list, destination_area, section_id)
    _cleanup_todo_list_source_after_area_move(a, user, todo_list)
    return block, None


def _area_list_marker_kind(item):
    item_type = getattr(item, 'item_type', None) or 'item'
    return item_type if item_type in {'section', 'subsection'} else None


def _area_list_insert_index(items, *, section_id=None, subsection_id=None):
    ordered = sorted(items, key=lambda item: ((item.order_index or 0), (item.id or 0)))

    if subsection_id is not None:
        marker_index = next(
            (
                index
                for index, item in enumerate(ordered)
                if item.id == subsection_id and _area_list_marker_kind(item) == 'subsection'
            ),
            None,
        )
        if marker_index is None:
            return None, 'The selected subsection no longer exists.'
        for index in range(marker_index + 1, len(ordered)):
            if _area_list_marker_kind(ordered[index]) in {'section', 'subsection'}:
                return index, None
        return len(ordered), None

    if section_id is not None:
        marker_index = next(
            (
                index
                for index, item in enumerate(ordered)
                if item.id == section_id and _area_list_marker_kind(item) == 'section'
            ),
            None,
        )
        if marker_index is None:
            return None, 'The selected section no longer exists.'
        insert_index = len(ordered)
        for index in range(marker_index + 1, len(ordered)):
            marker_kind = _area_list_marker_kind(ordered[index])
            if marker_kind in {'section', 'subsection'}:
                insert_index = index
                break
        return insert_index, None

    first_section = next(
        (index for index, item in enumerate(ordered) if _area_list_marker_kind(item) == 'section'),
        None,
    )
    return (first_section if first_section is not None else len(ordered)), None


def _validate_area_list_route(items, *, section_id=None, subsection_id=None):
    if subsection_id is None:
        return section_id, None

    ordered = sorted(items, key=lambda item: ((item.order_index or 0), (item.id or 0)))
    current_section_id = None
    subsection_parent_id = None
    for item in ordered:
        marker_kind = _area_list_marker_kind(item)
        if marker_kind == 'section':
            current_section_id = item.id
        elif item.id == subsection_id and marker_kind == 'subsection':
            subsection_parent_id = current_section_id
            break

    if subsection_parent_id is None:
        return None, 'The selected subsection no longer exists.'
    if section_id is not None and subsection_parent_id != section_id:
        return None, 'The selected subsection is not in that section.'
    return subsection_parent_id, None


def _move_area_line_to_area_list(a, user, block, data):
    if block.block_type != 'line':
        return None, 'Only lines can move into an Area list'
    try:
        destination_id = int(data.get('destination_block_id') or data.get('list_block_id'))
    except (TypeError, ValueError):
        return None, 'Choose an Area list'
    destination = _area_block_query_for_user(a, user).filter_by(id=destination_id, block_type='list').first()
    if not destination:
        return None, 'Destination is not a valid Area list'

    items = _area_block_item_query_for_user(a, user).filter_by(block_id=destination.id).order_by(
        a.AreaBlockItem.order_index.asc(),
        a.AreaBlockItem.id.asc(),
    ).all()
    section_id = _parse_order_index(data.get('section_item_id') or data.get('section_id'))
    subsection_id = _parse_order_index(data.get('subsection_item_id') or data.get('subsection_id'))
    section_id, route_error = _validate_area_list_route(
        items,
        section_id=section_id,
        subsection_id=subsection_id,
    )
    if route_error:
        return None, route_error

    insert_index, insert_error = _area_list_insert_index(
        items,
        section_id=section_id,
        subsection_id=subsection_id,
    )
    if insert_error:
        return None, insert_error

    text = _trim(block.content, 500)
    if not text:
        return None, 'Line text is required'

    item = a.AreaBlockItem(
        user_id=user.id,
        area_id=destination.area_id,
        block_id=destination.id,
        item_type='item',
        text=text,
        status='open',
        checked=False,
        order_index=(insert_index or 0) + 1,
    )
    ordered = list(items)
    ordered.insert(insert_index, item)
    for index, entry in enumerate(ordered, start=1):
        entry.order_index = index

    destination.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    a.db.session.add(item)
    a.db.session.delete(block)
    a.db.session.commit()
    return {
        'status': 'moved',
        'target': 'area_list',
        'block': destination.to_dict(include_items=True),
        'item': item.to_dict(),
        'url': f'/areas/{destination.area_id}/blocks/{destination.id}',
    }, None


def _move_area_line_to_area_task_list(a, user, block, data):
    if block.block_type != 'line':
        return None, 'Only lines can move into an Area task list'
    try:
        destination_id = int(data.get('destination_block_id') or data.get('task_block_id'))
    except (TypeError, ValueError):
        return None, 'Choose an Area task list'
    destination = _area_block_query_for_user(a, user).filter_by(id=destination_id, block_type='task_list').first()
    if not destination:
        return None, 'Destination is not a valid Area task list'

    text = _trim(block.content, 500)
    if not text:
        return None, 'Line text is required'

    item = a.AreaBlockItem(
        user_id=user.id,
        area_id=destination.area_id,
        block_id=destination.id,
        item_type='item',
        text=text,
        status='open',
        checked=False,
        order_index=_next_order(a, a.AreaBlockItem, user_id=user.id, block_id=destination.id),
    )
    destination.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    a.db.session.add(item)
    a.db.session.delete(block)
    a.db.session.commit()
    return {
        'status': 'moved',
        'target': 'area_task_list',
        'block': destination.to_dict(include_items=True),
        'item': item.to_dict(),
        'url': f'/areas/{destination.area_id}/blocks/{destination.id}',
    }, None


def _move_area_line_to_light_task_list(a, user, block, data):
    if block.block_type != 'line':
        return None, 'Only lines can move into a light task list'
    try:
        destination_id = int(data.get('destination_list_id') or data.get('light_list_id'))
    except (TypeError, ValueError):
        return None, 'Choose a light task list'
    todo_list = a.TodoList.query.filter_by(id=destination_id, user_id=user.id, type='light').first()
    if not todo_list:
        return None, 'Destination is not a valid light task list'

    content = _trim(block.content, 500)
    if not content:
        return None, 'Line text is required'

    item = a.TodoItem(
        list_id=todo_list.id,
        content=content,
        status='not_started',
        order_index=_next_order(a, a.TodoItem, list_id=todo_list.id),
    )
    a.db.session.add(item)
    a.db.session.delete(block)
    a.db.session.commit()
    a.start_embedding_job(user.id, a.ENTITY_TODO_ITEM, item.id)
    return {
        'status': 'moved',
        'target': 'light_task_list',
        'list': todo_list.to_dict(),
        'item': item.to_dict(),
        'url': f'/list/{todo_list.id}',
    }, None


def move_area_block(block_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    block = _area_block_query_for_user(a, user).filter_by(id=block_id).first_or_404()
    data = a.request.get_json(silent=True) or {}
    target = _trim(data.get('target'), 20).lower()

    if target == 'area':
        payload, error = _move_area_block_to_area(a, user, block, data)
        if error:
            return a.jsonify({'error': error}), 400
        return a.jsonify(payload)

    if target in {'notes', 'note'}:
        if block.block_type not in {'line', 'note', 'list'}:
            return a.jsonify({'error': 'Only lines, notes, and lists can move to Notes'}), 400
        folder_id, folder_error = _validate_note_folder(a, user, data.get('folder_id'))
        if folder_error:
            return a.jsonify({'error': folder_error}), 400
        note = _area_block_to_note(a, user, block, folder_id)
        a.db.session.delete(block)
        a.db.session.commit()
        return a.jsonify(
            {
                'status': 'moved',
                'target': 'notes',
                'note': note.to_dict(),
                'url': f'/notes/{note.id}',
            }
        ), 201

    if target in {'area_list', 'list_item'}:
        payload, error = _move_area_line_to_area_list(a, user, block, data)
        if error:
            return a.jsonify({'error': error}), 400
        return a.jsonify(payload), 201

    if target in {'area_task_list', 'area_light_task_list'}:
        payload, error = _move_area_line_to_area_task_list(a, user, block, data)
        if error:
            return a.jsonify({'error': error}), 400
        return a.jsonify(payload), 201

    if target in {'light_task_list', 'light_tasks'}:
        payload, error = _move_area_line_to_light_task_list(a, user, block, data)
        if error:
            return a.jsonify({'error': error}), 400
        return a.jsonify(payload), 201

    if target in {'tasks', 'task'}:
        if block.block_type != 'task_list':
            return a.jsonify({'error': 'Only task lists can move to Tasks'}), 400
        todo_list = _area_task_block_to_todo_list(a, user, block)
        a.db.session.delete(block)
        a.db.session.commit()
        return a.jsonify(
            {
                'status': 'moved',
                'target': 'tasks',
                'list': todo_list.to_dict(),
                'url': f'/list/{todo_list.id}',
            }
        ), 201

    return a.jsonify({'error': 'target must be area, notes, tasks, area_list, area_task_list, or light_task_list'}), 400


def area_block_items(block_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    block = _area_block_query_for_user(a, user).filter_by(id=block_id).first_or_404()
    if block.block_type not in {'list', 'task_list'}:
        return a.jsonify({'error': 'Block does not support rows'}), 400

    if a.request.method == 'GET':
        query = _area_block_item_query_for_user(a, user).filter_by(block_id=block.id)
        status_filter = _trim(a.request.args.get('status'), 20).lower()
        if status_filter:
            if status_filter not in AREA_ITEM_STATUSES:
                return a.jsonify({'error': 'Invalid status'}), 400
            query = query.filter(a.AreaBlockItem.status == status_filter)
        items = query.order_by(a.AreaBlockItem.order_index.asc(), a.AreaBlockItem.id.asc()).all()
        return a.jsonify([item.to_dict() for item in items])

    data = a.request.get_json(silent=True) or {}
    item = a.AreaBlockItem(
        user_id=user.id,
        area_id=block.area_id,
        block_id=block.id,
        item_type=_trim(data.get('item_type') or data.get('type') or 'item', 30).lower() or 'item',
        text='',
        status=_trim(data.get('status'), 20).lower() or 'open',
        checked=_parse_bool(data.get('checked')),
        order_index=_next_order(a, a.AreaBlockItem, user_id=user.id, block_id=block.id),
    )
    error = _apply_block_item_payload(a, user, item, data, creating=True, block=block)
    if error:
        return a.jsonify({'error': error}), 400
    a.db.session.add(item)
    a.db.session.commit()
    return a.jsonify(item.to_dict()), 201


def area_block_item_detail(item_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    item = _area_block_item_query_for_user(a, user).filter_by(id=item_id).first_or_404()

    if a.request.method == 'PUT':
        data = a.request.get_json(silent=True) or {}
        error = _apply_block_item_payload(a, user, item, data)
        if error:
            return a.jsonify({'error': error}), 400
        a.db.session.commit()
        return a.jsonify(item.to_dict())

    a.db.session.delete(item)
    a.db.session.commit()
    return '', 204


def area_list_block_detail(block_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    block = _area_block_query_for_user(a, user).filter_by(id=block_id, block_type='list').first_or_404()

    if a.request.method == 'GET':
        return a.jsonify(_area_list_block_to_note_dict(block, include_items=True))

    if a.request.method == 'PUT':
        data = a.request.get_json(silent=True) or {}
        if 'title' in data:
            block.title = _trim(data.get('title'), 180) or 'Untitled List'
        if 'checkbox_mode' in data:
            block.checkbox_mode = _parse_bool(data.get('checkbox_mode'))
        if 'list_mode' in data:
            block.list_mode = _normalize_area_list_mode(data.get('list_mode'))
        if _normalize_area_list_mode(block.list_mode) == 'revolving':
            block.checkbox_mode = True
        block.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        a.db.session.commit()
        return a.jsonify(_area_list_block_to_note_dict(block, include_items=True))

    a.db.session.delete(block)
    a.db.session.commit()
    return '', 204


def area_list_block_items(block_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    block = _area_block_query_for_user(a, user).filter_by(id=block_id, block_type='list').first_or_404()

    if a.request.method == 'GET':
        items = _area_block_item_query_for_user(a, user).filter_by(block_id=block.id).order_by(
            a.AreaBlockItem.order_index.asc(),
            a.AreaBlockItem.id.asc(),
        ).all()
        return a.jsonify([_area_list_item_to_note_dict(item) for item in items])

    data = a.request.get_json(silent=True) or {}
    raw_text = data.get('text')
    item_type, text = _parse_area_list_text(raw_text)
    if not text:
        return a.jsonify({'error': 'Item text required'}), 400
    note_text = _nullable_text(data.get('note'))
    raw_inner_note = (data.get('inner_note') or '').strip()
    inner_note = a._sanitize_note_html(raw_inner_note) if raw_inner_note else None
    scheduled_date, has_scheduled_date, date_error = _parse_optional_date(a, data)
    if date_error:
        return a.jsonify({'error': date_error}), 400
    checked = _parse_bool(data.get('checked'))
    if _normalize_area_list_mode(block.list_mode) == 'revolving':
        checked = False

    existing_items = _area_block_item_query_for_user(a, user).filter_by(block_id=block.id).order_by(
        a.AreaBlockItem.order_index.asc(),
        a.AreaBlockItem.id.asc(),
    ).all()
    insert_index = data.get('insert_index')
    insert_index_int = None
    if insert_index is not None:
        try:
            insert_index_int = int(insert_index)
        except (TypeError, ValueError):
            insert_index_int = len(existing_items)
        insert_index_int = max(0, min(insert_index_int, len(existing_items)))

    preview_entries = [
        type('AreaListPreviewItem', (), {
            'id': item.id,
            'text': _area_list_full_text(item),
            'order_index': item.order_index or 0,
        })()
        for item in existing_items
    ]
    preview_item = type('AreaListPreviewItem', (), {'id': None, 'text': raw_text, 'order_index': 0})()
    if insert_index_int is None:
        preview_entries.append(preview_item)
    else:
        preview_entries.insert(insert_index_int, preview_item)
    from services.notes_routes import validate_note_list_structure

    is_valid, validation_error = validate_note_list_structure(preview_entries)
    if not is_valid:
        return a.jsonify({'error': validation_error}), 400

    max_order = a.db.session.query(a.func.coalesce(a.func.max(a.AreaBlockItem.order_index), 0)).filter_by(
        block_id=block.id
    ).scalar() or 0
    if insert_index_int is None:
        order_index = max_order + 1
    else:
        order_index = min(insert_index_int, max_order) + 1
        a.db.session.query(a.AreaBlockItem).filter(
            a.AreaBlockItem.block_id == block.id,
            a.AreaBlockItem.order_index >= order_index,
        ).update(
            {a.AreaBlockItem.order_index: a.AreaBlockItem.order_index + 1},
            synchronize_session=False,
        )

    item = a.AreaBlockItem(
        user_id=user.id,
        area_id=block.area_id,
        block_id=block.id,
        item_type=item_type,
        text=text,
        note=note_text,
        inner_note=inner_note,
        link_text=_trim(data.get('link_text'), 200) or None,
        link_url=_trim(data.get('link_url'), 500) or None,
        scheduled_date=scheduled_date if has_scheduled_date else None,
        checked=checked,
        status='done' if checked else 'open',
        order_index=order_index,
    )
    block.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    a.db.session.add(item)
    a.db.session.commit()
    return a.jsonify(_area_list_item_to_note_dict(item)), 201


def area_list_block_item_detail(block_id, item_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    block = _area_block_query_for_user(a, user).filter_by(id=block_id, block_type='list').first_or_404()
    item = _area_block_item_query_for_user(a, user).filter_by(id=item_id, block_id=block.id).first_or_404()

    if a.request.method == 'DELETE':
        if item.item_type == 'section':
            _promote_area_subsections_after_section_delete(a, user, block.id, item.id)
        a.db.session.delete(item)
        _reindex_area_block_items(a, block.id)
        block.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        a.db.session.commit()
        return a.jsonify({'deleted': True, 'id': item_id})

    data = a.request.get_json(silent=True) or {}
    if 'text' in data:
        item_type, text = _parse_area_list_text(data.get('text'))
        if not text:
            return a.jsonify({'error': 'Item text required'}), 400
        insert_index = None
        if 'insert_index' in data:
            try:
                insert_index = int(data.get('insert_index'))
            except (TypeError, ValueError):
                insert_index = None
        is_valid, validation_error = _validate_area_list_structure(
            a,
            block,
            moving_item_id=item.id,
            new_text=data.get('text'),
            insert_index=insert_index,
            preserve_position='insert_index' not in data,
        )
        if not is_valid:
            return a.jsonify({'error': validation_error}), 400
        item.item_type = item_type
        item.text = text
    if 'note' in data:
        item.note = _nullable_text(data.get('note'))
    if 'inner_note' in data:
        raw_inner_note = (data.get('inner_note') or '').strip()
        item.inner_note = a._sanitize_note_html(raw_inner_note) if raw_inner_note else None
    if 'link_text' in data:
        item.link_text = _trim(data.get('link_text'), 200) or None
    if 'link_url' in data:
        item.link_url = _trim(data.get('link_url'), 500) or None
    scheduled_date, has_scheduled_date, date_error = _parse_optional_date(a, data)
    if date_error:
        return a.jsonify({'error': date_error}), 400
    if has_scheduled_date:
        item.scheduled_date = scheduled_date
    if 'checked' in data:
        requested_checked = _parse_bool(data.get('checked'))
        if requested_checked and _normalize_area_list_mode(block.list_mode) == 'revolving' and item.item_type == 'item':
            a.db.session.delete(item)
            _reindex_area_block_items(a, block.id)
            block.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            a.db.session.commit()
            return a.jsonify({'deleted': True, 'id': item_id})
        item.checked = requested_checked
        _apply_status(item, 'done' if requested_checked else 'open')
    if 'insert_index' in data:
        try:
            insert_index = int(data.get('insert_index'))
        except (TypeError, ValueError):
            insert_index = None
        if insert_index is not None:
            items = _area_block_item_query_for_user(a, user).filter_by(block_id=block.id).order_by(
                a.AreaBlockItem.order_index.asc(),
                a.AreaBlockItem.id.asc(),
            ).all()
            item_map = {entry.id: entry for entry in items}
            ordered_ids = [entry.id for entry in items if entry.id != item.id]
            insert_index = max(0, min(insert_index, len(ordered_ids)))
            ordered_ids.insert(insert_index, item.id)
            for index, ordered_id in enumerate(ordered_ids, start=1):
                item_map[ordered_id].order_index = index
    block.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    a.db.session.commit()
    return a.jsonify(_area_list_item_to_note_dict(item))


def reorder_area_list_block_items(block_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    block = _area_block_query_for_user(a, user).filter_by(id=block_id, block_type='list').first_or_404()
    data = a.request.get_json(silent=True) or {}
    ids = data.get('ids') or []
    if not isinstance(ids, list):
        return a.jsonify({'error': 'ids must be a list'}), 400
    try:
        ids = [int(raw_id) for raw_id in ids]
    except (TypeError, ValueError):
        return a.jsonify({'error': 'ids must be integers'}), 400
    items = _area_block_item_query_for_user(a, user).filter_by(block_id=block.id).all()
    item_map = {item.id: item for item in items}
    if len(ids) != len(item_map) or set(ids) != set(item_map.keys()):
        return a.jsonify({'error': 'ids must include every item'}), 400
    from services.notes_routes import validate_note_list_structure

    ordered_preview = [
        type('AreaListPreviewItem', (), {
            'id': item_id,
            'text': _area_list_full_text(item_map[item_id]),
            'order_index': index,
        })()
        for index, item_id in enumerate(ids, start=1)
    ]
    is_valid, validation_error = validate_note_list_structure(ordered_preview)
    if not is_valid:
        return a.jsonify({'error': validation_error}), 400
    for index, item_id in enumerate(ids, start=1):
        item_map[item_id].order_index = index
    block.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    a.db.session.commit()
    return a.jsonify({'status': 'ok'})


def area_list_block_item_duplicates(block_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    block = _area_block_query_for_user(a, user).filter_by(id=block_id, block_type='list').first_or_404()
    items = _area_block_item_query_for_user(a, user).filter_by(block_id=block.id).order_by(
        a.AreaBlockItem.order_index.asc(),
        a.AreaBlockItem.id.asc(),
    ).all()
    preview_items = [
        type('AreaListDuplicateItem', (), {
            'id': item.id,
            'text': _area_list_full_text(item),
            'note': item.note,
            'link_text': item.link_text,
            'link_url': item.link_url,
            'order_index': item.order_index or 0,
        })()
        for item in items
    ]
    payload = a.detect_note_list_duplicates(
        items=preview_items,
        section_prefix=LIST_SECTION_PREFIX,
        subsection_prefix=LIST_SUBSECTION_PREFIX,
        embed_text_fn=a.embed_text,
    )
    return a.jsonify(payload)


def area_task_blocks_for_area():
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    raw_area_id = a.request.args.get('area_id')
    query = _area_block_query_for_user(a, user).filter_by(block_type='task_list')
    if raw_area_id not in (None, ''):
        try:
            area_id = int(raw_area_id)
        except (TypeError, ValueError):
            return a.jsonify({'error': 'Invalid area_id'}), 400
        query = query.filter(a.AreaBlock.area_id == area_id)
    blocks = query.order_by(a.AreaBlock.order_index.asc(), a.AreaBlock.id.asc()).all()
    return a.jsonify([_area_task_block_to_list_dict(block, include_items=False) for block in blocks])


def area_task_block_detail(block_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    block = _area_block_query_for_user(a, user).filter_by(id=block_id, block_type='task_list').first_or_404()

    if a.request.method == 'GET':
        return a.jsonify(_area_task_block_to_list_dict(block, include_items=True))

    if a.request.method == 'PUT':
        data = a.request.get_json(silent=True) or {}
        title = _trim(data.get('title'), 180)
        if not title:
            return a.jsonify({'error': 'title is required'}), 400
        block.title = title
        block.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        a.db.session.commit()
        return a.jsonify(_area_task_block_to_list_dict(block, include_items=True))

    a.db.session.delete(block)
    a.db.session.commit()
    return '', 204


def area_task_block_items(block_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    block = _area_block_query_for_user(a, user).filter_by(id=block_id, block_type='task_list').first_or_404()

    if a.request.method == 'GET':
        items = _area_block_item_query_for_user(a, user).filter_by(block_id=block.id).order_by(
            a.AreaBlockItem.order_index.asc(),
            a.AreaBlockItem.id.asc(),
        ).all()
        return a.jsonify([_area_task_item_to_dict(item) for item in items])

    data = a.request.get_json(silent=True) or {}
    content = _trim(data.get('content') or data.get('text'), 500)
    if not content:
        return a.jsonify({'error': 'content is required'}), 400
    due_date = a.parse_day_value(data.get('due_date')) if data.get('due_date') else None
    status = _ui_task_status_to_area(data.get('status'))
    item = a.AreaBlockItem(
        user_id=user.id,
        area_id=block.area_id,
        block_id=block.id,
        item_type='item',
        text=content,
        details=_nullable_text(data.get('description')),
        note=_nullable_text(data.get('notes')),
        status=status,
        checked=status == 'done',
        scheduled_date=due_date,
        order_index=_next_order(a, a.AreaBlockItem, user_id=user.id, block_id=block.id),
    )
    if status == 'done':
        item.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    block.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    a.db.session.add(item)
    a.db.session.commit()
    return a.jsonify(_area_task_item_to_dict(item)), 201


def area_task_item_detail(item_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    item = _area_block_item_query_for_user(a, user).filter_by(id=item_id, item_type='item').first_or_404()
    block = _area_block_query_for_user(a, user).filter_by(id=item.block_id, block_type='task_list').first_or_404()

    if a.request.method == 'DELETE':
        a.db.session.delete(item)
        _reindex_area_block_items(a, block.id)
        block.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        a.db.session.commit()
        return '', 204

    data = a.request.get_json(silent=True) or {}
    if 'content' in data or 'text' in data:
        content = _trim(data.get('content') if 'content' in data else data.get('text'), 500)
        if not content:
            return a.jsonify({'error': 'content is required'}), 400
        item.text = content
    if 'description' in data:
        item.details = _nullable_text(data.get('description'))
    if 'notes' in data:
        item.note = _nullable_text(data.get('notes'))
    if 'due_date' in data:
        item.scheduled_date = a.parse_day_value(data.get('due_date')) if data.get('due_date') else None
    if 'status' in data:
        status = _ui_task_status_to_area(data.get('status'))
        _apply_status(item, status)
        item.checked = status == 'done'
    if 'linked_block_id' in data:
        linked_block_id, linked_block, link_error = _validate_linked_area_block(
            a,
            user,
            item.area_id,
            data.get('linked_block_id'),
        )
        if link_error:
            return a.jsonify({'error': link_error}), 400
        if linked_block and linked_block.block_type not in {'note', 'list'}:
            return a.jsonify({'error': 'Task notes can link to an Area note or list'}), 400
        item.linked_block_id = linked_block_id
    block.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    a.db.session.commit()
    return a.jsonify(_area_task_item_to_dict(item))


def reorder_area_task_block_items(block_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    block = _area_block_query_for_user(a, user).filter_by(id=block_id, block_type='task_list').first_or_404()
    data = a.request.get_json(silent=True) or {}
    ids = data.get('ids') or []
    if not isinstance(ids, list) or not ids:
        return a.jsonify({'error': 'ids array required'}), 400
    items = _area_block_item_query_for_user(a, user).filter_by(block_id=block.id).all()
    item_map = {item.id: item for item in items}
    order_value = 1
    for raw_id in ids:
        try:
            item_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        item = item_map.get(item_id)
        if item:
            item.order_index = order_value
            order_value += 1
    block.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    a.db.session.commit()
    return a.jsonify({'updated': order_value - 1})


def area_task_block_bulk_import(block_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    block = _area_block_query_for_user(a, user).filter_by(id=block_id, block_type='task_list').first_or_404()
    data = a.request.get_json(silent=True) or {}
    outline = data.get('outline') or ''
    if not outline.strip():
        return a.jsonify({'error': 'Outline text is required'}), 400
    parsed_items = a.parse_outline(outline, list_type='light')
    created = []
    next_order = _next_order(a, a.AreaBlockItem, user_id=user.id, block_id=block.id)
    for entry in parsed_items:
        content = _trim(entry.get('content'), 500)
        if not content:
            continue
        status = _ui_task_status_to_area(entry.get('status'))
        item = a.AreaBlockItem(
            user_id=user.id,
            area_id=block.area_id,
            block_id=block.id,
            item_type='item',
            text=content,
            details=_nullable_text(entry.get('description')),
            note=_nullable_text(entry.get('notes')),
            status=status,
            checked=status == 'done',
            order_index=next_order,
        )
        next_order += 1
        if status == 'done':
            item.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        a.db.session.add(item)
        created.append(item)
    if not created:
        return a.jsonify({'error': 'No items were parsed from the outline'}), 400
    block.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    a.db.session.commit()
    return a.jsonify([_area_task_item_to_dict(item) for item in created]), 201


def area_task_items_bulk():
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    data = a.request.get_json(silent=True) or {}
    raw_ids = data.get('ids') or []
    action = data.get('action')
    if not isinstance(raw_ids, list) or not raw_ids:
        return a.jsonify({'error': 'ids list is required'}), 400
    try:
        ids = [int(raw_id) for raw_id in raw_ids]
    except (TypeError, ValueError):
        return a.jsonify({'error': 'No valid item ids provided'}), 400
    query = _area_block_item_query_for_user(a, user).filter(a.AreaBlockItem.id.in_(ids))
    raw_block_id = data.get('list_id')
    if raw_block_id not in (None, ''):
        try:
            block_id = int(raw_block_id)
        except (TypeError, ValueError):
            return a.jsonify({'error': 'Invalid list_id'}), 400
        query = query.filter(a.AreaBlockItem.block_id == block_id)
    items = [item for item in query.all() if item.block and item.block.block_type == 'task_list']
    if not items:
        return a.jsonify({'error': 'No matching items found'}), 404

    if action == 'status':
        status = _ui_task_status_to_area(data.get('status'))
        for item in items:
            _apply_status(item, status)
            item.checked = status == 'done'
        a.db.session.commit()
        return a.jsonify({'updated': len(items)})

    if action == 'delete':
        block_ids = {item.block_id for item in items}
        for item in items:
            a.db.session.delete(item)
        for block_id in block_ids:
            _reindex_area_block_items(a, block_id)
        a.db.session.commit()
        return a.jsonify({'deleted': len(items)})

    if action == 'move':
        raw_destination_id = data.get('destination_list_id')
        try:
            destination_id = int(raw_destination_id)
        except (TypeError, ValueError):
            return a.jsonify({'error': 'Invalid destination list ID'}), 400
        destination = _area_block_query_for_user(a, user).filter_by(id=destination_id, block_type='task_list').first()
        if not destination:
            return a.jsonify({'error': 'Destination is not a valid area task list'}), 404
        moved = 0
        next_order = _next_order(a, a.AreaBlockItem, user_id=user.id, block_id=destination.id)
        for item in items:
            item.block_id = destination.id
            item.area_id = destination.area_id
            item.order_index = next_order
            next_order += 1
            moved += 1
        a.db.session.commit()
        return a.jsonify({'moved': moved, 'skipped': 0})

    return a.jsonify({'error': 'action must be status, delete, or move'}), 400


def move_area_task_item(item_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    item = _area_block_item_query_for_user(a, user).filter_by(id=item_id, item_type='item').first_or_404()
    data = a.request.get_json(silent=True) or {}
    try:
        destination_id = int(data.get('destination_list_id'))
    except (TypeError, ValueError):
        return a.jsonify({'error': 'Invalid destination list ID'}), 400
    destination = _area_block_query_for_user(a, user).filter_by(id=destination_id, block_type='task_list').first()
    if not destination:
        return a.jsonify({'error': 'Destination is not a valid area task list'}), 404
    old_block_id = item.block_id
    item.block_id = destination.id
    item.area_id = destination.area_id
    item.order_index = _next_order(a, a.AreaBlockItem, user_id=user.id, block_id=destination.id)
    _reindex_area_block_items(a, old_block_id)
    a.db.session.commit()
    return a.jsonify({'message': 'Task moved successfully'})


def area_task_block_export(block_id):
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401
    block = _area_block_query_for_user(a, user).filter_by(id=block_id, block_type='task_list').first_or_404()
    items = _area_block_item_query_for_user(a, user).filter_by(block_id=block.id).order_by(
        a.AreaBlockItem.order_index.asc(),
        a.AreaBlockItem.id.asc(),
    ).all()
    lines = [block.title or 'Task list', '']
    for item in items:
        mark = '[x]' if item.status == 'done' else '[>]' if item.status == 'later' else '[ ]'
        line = f'- {mark} {item.text}'
        if item.details:
            line += f' :: {item.details}'
        if item.note:
            line += f' ::: {item.note}'
        lines.append(line)
    response = a.app.response_class('\n'.join(lines).strip() + '\n', mimetype='text/plain; charset=utf-8')
    response.headers['Content-Disposition'] = f'attachment; filename="area-task-list-{block.id}.txt"'
    return response


def area_items(area_id):
    """Compatibility endpoint for the original MVP Area Items API."""
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401

    area = _area_query_for_user(a, user).filter_by(id=area_id).first_or_404()

    if a.request.method == 'GET':
        query = _area_item_query_for_user(a, user).filter_by(area_id=area.id)
        status_filter = _trim(a.request.args.get('status'), 20).lower()
        if status_filter and status_filter in AREA_ITEM_STATUSES:
            query = query.filter(a.AreaItem.status == status_filter)
        items = query.order_by(
            a.AreaItem.order_index.asc(),
            a.AreaItem.created_at.asc(),
            a.AreaItem.id.asc(),
        ).all()
        return a.jsonify([item.to_dict() for item in items])

    data = a.request.get_json(silent=True) or {}
    item = a.AreaItem(
        user_id=user.id,
        area_id=area.id,
        text='',
        status=_trim(data.get('status'), 20).lower() or 'open',
        order_index=_next_order(a, a.AreaItem, user_id=user.id, area_id=area.id),
    )
    error = _apply_area_item_payload(a, user, item, data, creating=True)
    if error:
        return a.jsonify({'error': error}), 400
    a.db.session.add(item)
    a.db.session.commit()
    return a.jsonify(item.to_dict()), 201


def area_item_detail(item_id):
    """Compatibility endpoint for the original MVP Area Items API."""
    a = _app_module()
    user = a.get_current_user()
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401

    item = _area_item_query_for_user(a, user).filter_by(id=item_id).first_or_404()

    if a.request.method == 'PUT':
        data = a.request.get_json(silent=True) or {}
        error = _apply_area_item_payload(a, user, item, data)
        if error:
            return a.jsonify({'error': error}), 400
        a.db.session.commit()
        return a.jsonify(item.to_dict())

    a.db.session.delete(item)
    a.db.session.commit()
    return '', 204
