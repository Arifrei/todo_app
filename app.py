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


def parse_outline(outline_text, list_type='list'):
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

    if list_type == 'hub':
        return parse_hub_outline(outline_text) # This was missing the return

    # --- Default parsing for simple lists ---
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

def parse_hub_outline(outline_text):
    """Parse a hierarchical outline for a Project Hub."""
    projects = []
    current_project = None

    def split_fields(text):
        notes, description, main = None, None, text
        if ':::' in main: main, notes = main.split(':::', 1)
        if '::' in main: main, description = main.split('::', 1)
        return main.strip(), (description or '').strip() or None, (notes or '').strip() or None

    for raw_line in outline_text.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            continue

        stripped = line.strip()
        indent_level = len(raw_line) - len(raw_line.lstrip(' '))

        # Project: Top-level heading
        if stripped.startswith('# ') and indent_level == 0:
            body = stripped.lstrip('# ').strip()
            project_type = 'list'
            if body.lower().endswith('[hub]'):
                body = body[:-5].strip()
                project_type = 'hub'
            title, description, notes = split_fields(body)
            if title:
                current_project = {
                    'content': title, 'description': description, 'notes': notes, 'project_type': project_type, 'items': []
                }
                projects.append(current_project)
            continue

        if not current_project:
            continue # Skip lines until the first project is defined

        # Phase: Indented heading
        if stripped.startswith('## '):
            title, description, notes = split_fields(stripped.lstrip('## ').strip())
            if title:
                current_project['items'].append({'content': title, 'status': 'phase', 'description': description, 'notes': notes})
            continue

        # Task: Indented list item
        checkbox_match = re.match(r"^[-*]\s*\[(?P<mark>[ xX>~])\]\s*(?P<body>.+)$", stripped)
        if checkbox_match:
            mark = checkbox_match.group('mark').lower()
            body = checkbox_match.group('body').strip()
            status = {'x': 'done', '>': 'in_progress', '~': 'in_progress', ' ': 'not_started'}.get(mark, 'not_started')
            content, description, notes = split_fields(body)
            if content:
                current_project['items'].append({'content': content, 'status': status, 'description': description, 'notes': notes})
            continue

        bullet_match = re.match(r"^[-*]\s+(?P<body>.+)$", stripped)
        if bullet_match:
            body = bullet_match.group('body').strip()
            content, description, notes = split_fields(body)
            if content:
                current_project['items'].append({'content': content, 'status': 'not_started', 'description': description, 'notes': notes})
            continue

    return projects


def insert_item_in_order(todo_list, new_item, phase_id=None):
    """Place a new item in the ordering, optionally directly under a phase."""
    ordered = list(todo_list.items)
    if new_item not in ordered:
        ordered.append(new_item)

    if phase_id:
        phase = next((i for i in ordered if i.id == phase_id and i.is_phase), None)
        if phase:
            try:
                phase_idx = ordered.index(phase)
            except ValueError:
                phase_idx = -1
            insert_idx = phase_idx + 1
            while insert_idx < len(ordered) and ordered[insert_idx].status != 'phase':
                insert_idx += 1
            # Remove and reinsert in the right spot
            ordered = [i for i in ordered if i.id != new_item.id]
            ordered.insert(insert_idx, new_item)

    for idx, item in enumerate(ordered, start=1):
        item.order_index = idx

def reindex_list(todo_list):
    """Ensure order_index is sequential within a list."""
    ordered = sorted(todo_list.items, key=lambda i: i.order_index)
    for idx, item in enumerate(ordered, start=1):
        item.order_index = idx

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
    current_phase = None

    # The relationship is already ordered by order_index
    for item in todo_list.items:
        if item.is_phase:
            if current_phase_items:
                phase_groups.append(current_phase_items)
            phase_groups.append([item]) # The phase header itself
            current_phase = item
            current_phase_items = []
        else:
            # Backfill phase_id if not set
            if current_phase and not item.phase_id:
                item.phase_id = current_phase.id
            current_phase_items.append(item)
    if current_phase_items:
        phase_groups.append(current_phase_items)

    # Commit any backfilled phase_id values
    db.session.commit()

    for group in phase_groups:
        if len(group) == 1 and group[0].is_phase:
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
    query = TodoList.query.outerjoin(TodoItem, TodoList.id == TodoItem.linked_list_id).filter(TodoItem.id == None)
    list_type = request.args.get('type')
    if list_type:
        query = query.filter(TodoList.type == list_type)
    lists = query.all()
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
    todo_list = TodoList.query.get_or_404(list_id)
    data = request.json
    content = data['content']
    description = data.get('description', '')
    notes = data.get('notes', '')
    is_project = data.get('is_project', False)
    project_type = data.get('project_type', 'list') # Default to 'list'
    phase_id = data.get('phase_id')
    status = data.get('status', 'not_started')
    is_phase_item = (status == 'phase')
    if status not in ['not_started', 'in_progress', 'done', 'phase']:
        status = 'not_started'
    if status == 'phase':
        status = 'not_started'  # Phases start as not_started
    if is_project:
        status = 'not_started'
    next_order = db.session.query(db.func.coalesce(db.func.max(TodoItem.order_index), 0)).filter_by(list_id=list_id).scalar() + 1
    new_item = TodoItem(
        list_id=list_id,
        content=content,
        description=description,
        notes=notes,
        status=status,
        order_index=next_order,
        phase_id=int(phase_id) if phase_id else None,
        is_phase=is_phase_item
    )
    
    if is_project:
        # Automatically create a child list
        child_list = TodoList(title=content, type=project_type)
        db.session.add(child_list)
        db.session.flush() # Get ID
        new_item.linked_list_id = child_list.id
    
    db.session.add(new_item)
    db.session.flush()

    # If adding to a specific phase within a list, place it underneath that phase
    if not is_project and phase_id and todo_list.type == 'list':
        try:
            phase_id_int = int(phase_id)
        except (TypeError, ValueError):
            phase_id_int = None
        insert_item_in_order(todo_list, new_item, phase_id=phase_id_int)
        # Update the phase status (mark as incomplete if it was done)
        if phase_id_int:
            phase_item = TodoItem.query.get(phase_id_int)
            if phase_item:
                phase_item.update_phase_status()
    else:
        insert_item_in_order(todo_list, new_item)

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
        old_status = item.status
        new_status = data.get('status', item.status)
        if new_status == 'done' and item.status != 'done':
            item.completed_at = datetime.utcnow()
        elif new_status != 'done':
            item.completed_at = None
        item.status = new_status
        item.content = data.get('content', item.content)
        item.description = data.get('description', item.description)
        item.notes = data.get('notes', item.notes)

        # If this task's status changed and it belongs to a phase, update phase status
        if old_status != new_status and item.phase_id:
            phase_item = TodoItem.query.get(item.phase_id)
            if phase_item:
                phase_item.update_phase_status()

        db.session.commit()
        return jsonify(item.to_dict())

@app.route('/api/items/<int:item_id>/move', methods=['POST'])
def move_item(item_id):
    item = TodoItem.query.get_or_404(item_id)
    data = request.json or {}
    dest_hub_id = data.get('destination_hub_id')
    dest_list_id = data.get('destination_list_id')
    dest_phase_id = data.get('destination_phase_id')

    # Prevent moving phase headers for now
    if item.is_phase:
        return jsonify({'error': 'Cannot move a phase header.'}), 400

    # --- Moving a Project to another Hub ---
    if item.linked_list_id:
        if dest_hub_id is None:
            return jsonify({'error': 'destination_hub_id is required for projects'}), 400
        try:
            dest_hub_id = int(dest_hub_id)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid destination hub ID'}), 400

        dest_hub = TodoList.query.get(dest_hub_id)
        if not dest_hub or dest_hub.type != 'hub':
            return jsonify({'error': 'Destination is not a valid hub'}), 404

        item.list_id = dest_hub_id
        db.session.flush()
        insert_item_in_order(dest_hub, item)
        db.session.commit()
        return jsonify({'message': f'Moved to {dest_hub.title}'})

    # --- Moving a Task to another list/phase ---
    if dest_list_id is None:
        return jsonify({'error': 'destination_list_id is required for tasks'}), 400

    try:
        dest_list_id = int(dest_list_id)
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid destination list ID'}), 400

    dest_list = TodoList.query.get(dest_list_id)
    if not dest_list or dest_list.type != 'list':
        return jsonify({'error': 'Destination is not a valid project list'}), 404

    # Validate destination phase (optional)
    phase_obj = None
    if dest_phase_id is not None:
        try:
            dest_phase_id_int = int(dest_phase_id)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid destination phase ID'}), 400
        phase_obj = TodoItem.query.get(dest_phase_id_int)
        if not phase_obj or phase_obj.list_id != dest_list.id or phase_obj.status != 'phase':
            return jsonify({'error': 'Destination phase not found in that project'}), 404
        dest_phase_id = dest_phase_id_int
    else:
        dest_phase_id = None

    old_list = item.list
    item.list_id = dest_list.id
    db.session.flush()

    if dest_phase_id:
        insert_item_in_order(dest_list, item, phase_id=dest_phase_id)
    else:
        insert_item_in_order(dest_list, item)

    if old_list and old_list.id != dest_list.id:
        reindex_list(old_list)

    db.session.commit()
    return jsonify({'message': 'Task moved successfully'})

@app.route('/api/move-destinations/<int:list_id>', methods=['GET'])
def move_destinations(list_id):
    """Return possible destinations for moving tasks (all project lists with their phases)."""
    project_lists = TodoList.query.filter_by(type='list').all()
    payload = []
    for l in project_lists:
        payload.append({
            'id': l.id,
            'title': l.title,
            'phases': [{'id': i.id, 'content': i.content} for i in l.items if i.is_phase]
        })
    return jsonify(payload)

@app.route('/api/lists/<int:list_id>/bulk_import', methods=['POST'])
def bulk_import(list_id):
    todo_list = TodoList.query.get_or_404(list_id)
    data = request.json or {}
    outline = data.get('outline', '')

    if not outline.strip():
        return jsonify({'error': 'Outline text is required'}), 400

    parsed_items = parse_outline(outline, list_type=todo_list.type)
    created_items = []

    if todo_list.type == 'hub':
        # For hubs, parsed_items is a list of projects
        for project_data in parsed_items:
            # Create the main project item in the hub
            project_item = TodoItem(
                list_id=todo_list.id,
                content=project_data['content'],
                description=project_data.get('description'),
                notes=project_data.get('notes'),
                status='not_started'
            )
            # Create the child list for this project
            child_list = TodoList(title=project_data['content'], type=project_data.get('project_type', 'list'))
            db.session.add(child_list)
            db.session.flush() # Get ID for child_list
            project_item.linked_list_id = child_list.id
            db.session.add(project_item)
            created_items.append(project_item)

            # Add phases and tasks to the child list
            for item_data in project_data.get('items', []):
                child_item = TodoItem(list_id=child_list.id, **item_data)
                db.session.add(child_item)
    else:
        # For simple lists, parsed_items is a flat list of tasks/phases
        for entry in parsed_items:
            content = entry.get('content', '').strip()
            if not content:
                continue
            new_item = TodoItem(
                list_id=todo_list.id,
                content=content,
                status=entry.get('status', 'not_started'),
                description=entry.get('description'),
                notes=entry.get('notes')
            )
            db.session.add(new_item)
            created_items.append(new_item)

    if not created_items:
        return jsonify({'error': 'No items were parsed from the outline'}), 400

    db.session.commit()
    # Re-order all items after bulk creation
    for item in created_items:
        insert_item_in_order(item.list, item)
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

        affected_phases = set()
        for item in items:
            # Avoid changing phases to task statuses inadvertently
            if item.is_phase:
                continue
            item.status = status
            if item.phase_id:
                affected_phases.add(item.phase_id)

        # Update all affected phase statuses
        for phase_id in affected_phases:
            phase_item = TodoItem.query.get(phase_id)
            if phase_item:
                phase_item.update_phase_status()

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
