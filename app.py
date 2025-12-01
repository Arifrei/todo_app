from flask import Flask, render_template, request, jsonify, redirect, url_for
from models import db, TodoList, TodoItem
from datetime import datetime
import os
import re

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///todo.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

with app.app_context():
    db.create_all()


def parse_outline(outline_text):
    """Parse a pasted outline into item dicts with content/status/description/notes."""

    def split_fields(text):
        """Split a line into content, description, notes using :: and ::: separators."""
        notes = None
        description = None
        main = text
        if ':::' in main:
            main, notes = main.split(':::', 1)
            notes = notes.strip() or None
        if '::' in main:
            main, description = main.split('::', 1)
            description = description.strip() or None
        return main.strip(), description, notes

    items = []
    for raw_line in outline_text.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            continue

        stripped = line.strip()

        # Headers / phases: markdown-style "#" or trailing colon
        if stripped.startswith('#'):
            title, description, notes = split_fields(stripped.lstrip('#').strip())
            if title:
                items.append({'content': title, 'status': 'phase', 'description': description, 'notes': notes})
            continue
        if stripped.endswith(':') and len(stripped) > 1:
            title, description, notes = split_fields(stripped[:-1].strip())
            if title:
                items.append({'content': title, 'status': 'phase', 'description': description, 'notes': notes})
            continue

        # Checkbox tasks: "- [ ]", "- [x]", "- [>]", "- [~]"
        checkbox_match = re.match(r"^[-*]\s*\[(?P<mark>[ xX>~])\]\s*(?P<body>.+)$", stripped)
        if checkbox_match:
            mark = checkbox_match.group('mark').lower()
            body = checkbox_match.group('body').strip()
            status = {
                'x': 'done',
                '>': 'in_progress',
                '~': 'in_progress',
                ' ': 'not_started'
            }.get(mark, 'not_started')
            if body:
                content, description, notes = split_fields(body)
                if content:
                    items.append({'content': content, 'status': status, 'description': description, 'notes': notes})
            continue

        # Bullet tasks: "- task" or "* task"
        bullet_match = re.match(r"^[-*]\s+(?P<body>.+)$", stripped)
        if bullet_match:
            body = bullet_match.group('body').strip()
            if body:
                content, description, notes = split_fields(body)
                if content:
                    items.append({'content': content, 'status': 'not_started', 'description': description, 'notes': notes})
            continue

        # Fallback: treat as a task line
        content, description, notes = split_fields(stripped)
        if content:
            items.append({'content': content, 'status': 'not_started', 'description': description, 'notes': notes})

    return items

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/list/<int:list_id>')
def list_view(list_id):
    todo_list = TodoList.query.get_or_404(list_id)

    # Find parent if exists (if this list is linked by an item)
    parent_item = TodoItem.query.filter_by(linked_list_id=list_id).first()
    parent_list = parent_item.list if parent_item else None

    # Custom sorting: group by phase, then sort incomplete by order_index and complete by completed_at
    sorted_items = []
    phase_groups = []
    current_phase_items = []

    # The relationship is already ordered by order_index
    for item in todo_list.items:
        if item.status == 'phase':
            if current_phase_items:
                phase_groups.append(current_phase_items)
            phase_groups.append([item]) # The phase header itself
            current_phase_items = []
        else:
            current_phase_items.append(item)
    if current_phase_items:
        phase_groups.append(current_phase_items)

    for group in phase_groups:
        if len(group) == 1 and group[0].status == 'phase':
            sorted_items.extend(group)
        else:
            incomplete = sorted([i for i in group if i.status != 'done'], key=lambda x: x.order_index)
            complete = sorted([i for i in group if i.status == 'done'], key=lambda x: x.order_index)
            sorted_items.extend(incomplete + complete)

    return render_template('list_view.html', todo_list=todo_list, parent_list=parent_list, items=sorted_items)

# API Routes
@app.route('/api/lists', methods=['GET', 'POST'])
def handle_lists():
    if request.method == 'POST':
        data = request.json
        new_list = TodoList(title=data['title'], type=data.get('type', 'list'))
        db.session.add(new_list)
        db.session.commit()
        return jsonify(new_list.to_dict()), 201
    
    # Filter out lists that are children (linked to an item)
    # We want lists where NO TodoItem has this list as its linked_list_id
    lists = TodoList.query.outerjoin(TodoItem, TodoList.id == TodoItem.linked_list_id).filter(TodoItem.id == None).all()
    return jsonify([l.to_dict() for l in lists])

@app.route('/api/lists/<int:list_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_list(list_id):
    todo_list = TodoList.query.get_or_404(list_id)
    
    if request.method == 'DELETE':
        # Delete any child lists linked from this list (for hubs)
        for item in todo_list.items:
            if item.linked_list:
                db.session.delete(item.linked_list)
        db.session.delete(todo_list)
        db.session.commit()
        return '', 204
    
    if request.method == 'PUT':
        data = request.json
        todo_list.title = data.get('title', todo_list.title)
        db.session.commit()
        return jsonify(todo_list.to_dict())
        
    return jsonify(todo_list.to_dict())

@app.route('/api/lists/<int:list_id>/items', methods=['POST'])
def create_item(list_id):
    data = request.json
    content = data['content']
    description = data.get('description', '')
    notes = data.get('notes', '')
    is_project = data.get('is_project', False)
    next_order = db.session.query(db.func.coalesce(db.func.max(TodoItem.order_index), 0)).filter_by(list_id=list_id).scalar() + 1
    new_item = TodoItem(
        list_id=list_id,
        content=content,
        description=description,
        notes=notes,
        order_index=next_order
    )
    
    if is_project:
        # Automatically create a child list
        child_list = TodoList(title=content, type='list')
        db.session.add(child_list)
        db.session.flush() # Get ID
        new_item.linked_list_id = child_list.id
        
    db.session.add(new_item)
    db.session.commit()
    return jsonify(new_item.to_dict()), 201

@app.route('/api/items/<int:item_id>', methods=['PUT', 'DELETE'])
def handle_item(item_id):
    item = TodoItem.query.get_or_404(item_id)
    
    if request.method == 'DELETE':
        # If it has a linked list, should we delete it? 
        # For now, let's say yes, cascade delete is handled by DB relationship if configured, 
        # but we might need manual cleanup if not strict. 
        # models.py has cascade="all, delete-orphan" on the parent list side, 
        # but the linked_list is a separate relationship.
        if item.linked_list:
            db.session.delete(item.linked_list)
            
        db.session.delete(item)
        db.session.commit()
        return '', 204
        
    if request.method == 'PUT':
        data = request.json
        new_status = data.get('status', item.status)
        if new_status == 'done' and item.status != 'done':
            item.completed_at = datetime.utcnow()
        elif new_status != 'done':
            item.completed_at = None
        item.status = new_status
        item.status = data.get('status', item.status)
        item.content = data.get('content', item.content)
        item.description = data.get('description', item.description)
        item.notes = data.get('notes', item.notes)
        db.session.commit()
        return jsonify(item.to_dict())


@app.route('/api/lists/<int:list_id>/bulk_import', methods=['POST'])
def bulk_import(list_id):
    todo_list = TodoList.query.get_or_404(list_id)
    data = request.json or {}
    outline = data.get('outline', '')

    if not outline.strip():
        return jsonify({'error': 'Outline text is required'}), 400

    parsed_items = parse_outline(outline)
    created_items = []

    for entry in parsed_items:
        content = entry.get('content', '').strip()
        status = entry.get('status', 'not_started')
        description = entry.get('description')
        notes = entry.get('notes')
        if not content:
            continue
        new_item = TodoItem(
            list_id=todo_list.id,
            content=content,
            status=status,
            description=description,
            notes=notes
        )
        db.session.add(new_item)
        created_items.append(new_item)

    if not created_items:
        return jsonify({'error': 'No items were parsed from the outline'}), 400

    db.session.commit()
    return jsonify([item.to_dict() for item in created_items]), 201


@app.route('/api/items/bulk', methods=['POST'])
def bulk_items():
    data = request.json or {}
    ids = data.get('ids') or []
    action = data.get('action')
    list_id = data.get('list_id')

    if not ids or not isinstance(ids, list):
        return jsonify({'error': 'ids list is required'}), 400
    if action not in ['status', 'delete']:
        return jsonify({'error': 'action must be status or delete'}), 400

    items = TodoItem.query.filter(TodoItem.id.in_(ids)).all()

    if list_id is not None:
        items = [i for i in items if i.list_id == list_id]

    if not items:
        return jsonify({'error': 'No matching items found'}), 404

    if action == 'status':
        status = data.get('status')
        if status not in ['not_started', 'in_progress', 'done', 'phase']:
            return jsonify({'error': 'invalid status'}), 400
        for item in items:
            # Avoid changing phases to task statuses inadvertently
            if item.status == 'phase' and status != 'phase':
                continue
            item.status = status
        db.session.commit()
        return jsonify({'updated': len(items)})

    if action == 'delete':
        for item in items:
            if item.linked_list:
                db.session.delete(item.linked_list)
            db.session.delete(item)
        db.session.commit()
        return jsonify({'deleted': len(items)})


@app.route('/api/lists/<int:list_id>/reorder', methods=['POST'])
def reorder_items(list_id):
    todo_list = TodoList.query.get_or_404(list_id)
    data = request.json or {}
    ordered_ids = data.get('ids', [])
    if not isinstance(ordered_ids, list) or not ordered_ids:
        return jsonify({'error': 'ids array required'}), 400

    items = {item.id: item for item in todo_list.items}
    order_val = 1
    for item_id in ordered_ids:
        try:
            item_id_int = int(item_id)
        except (ValueError, TypeError):
            continue
        if item_id_int in items:
            items[item_id_int].order_index = order_val
            order_val += 1

    db.session.commit()
    return jsonify({'updated': len(ordered_ids)})

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True)
