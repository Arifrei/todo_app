from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from models import db, User, TodoList, TodoItem
from datetime import datetime
import os
import re

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///todo.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
app.config['PERMANENT_SESSION_LIFETIME'] = 365 * 24 * 60 * 60  # 1 year in seconds

db.init_app(app)

def get_current_user():
    """Get current user from session, or None if not set"""
    user_id = session.get('user_id')
    if user_id:
        return User.query.get(user_id)
    return None

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

# --- Export Helpers ---

def _format_metadata(content, description=None, notes=None):
    """Append :: description and ::: notes to a content string when present."""
    text = (content or '').strip()
    if description:
        text += f" :: {description.strip()}"
    if notes:
        text += f" ::: {notes.strip()}"
    return text

def _status_mark(status):
    """Map item status to checkbox mark for export."""
    return {
        'done': 'x',
        'in_progress': '>',
    }.get(status, ' ')

def export_list_outline(todo_list, indent=0):
    """Export a TodoList (hub or list) to outline lines using import-compatible syntax."""
    prefix = ' ' * indent
    lines = []
    ordered_items = sorted(todo_list.items, key=lambda i: i.order_index or 0)

    if todo_list.type == 'list':
        for item in ordered_items:
            if item.is_phase:
                lines.append(f"{prefix}## {_format_metadata(item.content, item.description, item.notes)}")
                continue
            line_prefix = prefix + ('  ' if item.phase_id else '')
            lines.append(f"{line_prefix}- [{_status_mark(item.status)}] {_format_metadata(item.content, item.description, item.notes)}")
        return lines

    # Hub: export each project (linked list) and its children
    for item in ordered_items:
        if item.linked_list:
            child_list = item.linked_list
            title = item.content + (' [hub]' if child_list.type == 'hub' else '')
            lines.append(f"{prefix}# {_format_metadata(title, item.description, item.notes)}")
            lines.extend(export_list_outline(child_list, indent + 2))
        else:
            # Fallback: export plain items at hub level as tasks
            lines.append(f"{prefix}- [{_status_mark(item.status)}] {_format_metadata(item.content, item.description, item.notes)}")
    return lines

def _slugify_filename(value):
    """Create a simple, safe filename slug."""
    value = (value or '').strip().lower()
    value = re.sub(r'[^a-z0-9]+', '-', value)
    value = re.sub(r'-{2,}', '-', value).strip('-')
    return value or 'list'


def insert_item_in_order(todo_list, new_item, phase_id=None):
    """Place a new item in the ordering, optionally directly under a phase."""
    def is_phase_header(item):
        return item.is_phase or item.status == 'phase'

    ordered = sorted(list(todo_list.items), key=lambda i: i.order_index or 0)
    if new_item not in ordered:
        ordered.append(new_item)

    if phase_id:
        phase = next((i for i in ordered if i.id == phase_id and is_phase_header(i)), None)
        if phase:
            try:
                phase_idx = ordered.index(phase)
            except ValueError:
                phase_idx = -1
            insert_idx = phase_idx + 1
            # Walk forward until the next phase header
            while insert_idx < len(ordered) and not is_phase_header(ordered[insert_idx]):
                insert_idx += 1
            # Remove and reinsert in the right spot
            ordered = [i for i in ordered if i.id != new_item.id]
            ordered.insert(insert_idx, new_item)

    for idx, item in enumerate(ordered, start=1):
        item.order_index = idx

def insert_items_under_phase(todo_list, new_items, phase_id=None):
    """Place multiple items under a specific phase (or at end if no phase)."""
    if not new_items:
        return

    def is_phase_header(item):
        return item.is_phase or item.status == 'phase'

    ordered = sorted(list(todo_list.items), key=lambda i: i.order_index or 0)
    new_ids = {i.id for i in new_items if i.id is not None}
    ordered = [i for i in ordered if i.id not in new_ids]

    if phase_id:
        phase = next((i for i in ordered if i.id == phase_id and is_phase_header(i)), None)
        if phase:
            try:
                phase_idx = ordered.index(phase)
            except ValueError:
                phase_idx = -1
            insert_idx = phase_idx + 1
            while insert_idx < len(ordered) and not is_phase_header(ordered[insert_idx]):
                insert_idx += 1
            for offset, item in enumerate(new_items):
                ordered.insert(insert_idx + offset, item)
        else:
            ordered.extend(new_items)
    else:
        ordered.extend(new_items)

    for idx, item in enumerate(ordered, start=1):
        item.order_index = idx

def reindex_list(todo_list):
    """Ensure order_index is sequential within a list."""
    ordered = sorted(todo_list.items, key=lambda i: i.order_index or 0)
    for idx, item in enumerate(ordered, start=1):
        item.order_index = idx

# User Selection Routes
@app.route('/select-user')
def select_user():
    """Show user selection page"""
    users = User.query.all()
    return render_template('select_user.html', users=users)

@app.route('/api/set-user/<int:user_id>', methods=['POST'])
def set_user(user_id):
    """Set the current user in session"""
    user = User.query.get_or_404(user_id)
    session['user_id'] = user.id
    session.permanent = True  # Make session persistent across browser restarts
    return jsonify({'success': True, 'username': user.username})

@app.route('/api/create-user', methods=['POST'])
def create_user():
    """Create a new user (simplified - no password)"""
    data = request.json
    username = data.get('username', '').strip()

    if not username:
        return jsonify({'error': 'Username is required'}), 400

    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already exists'}), 400

    # Create user with a dummy password (not used anymore)
    user = User(username=username, email=None)
    user.set_password('dummy')
    db.session.add(user)
    db.session.commit()

    # Automatically set as current user
    session['user_id'] = user.id
    session.permanent = True

    return jsonify({'success': True, 'user_id': user.id, 'username': user.username})

@app.route('/api/current-user')
def current_user_info():
    """Get current user info"""
    user = get_current_user()
    if user:
        return jsonify({'user_id': user.id, 'username': user.username})
    return jsonify({'user_id': None, 'username': None})

@app.route('/')
def index():
    # If no user selected, redirect to user selection
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('index.html')

@app.route('/list/<int:list_id>')
def list_view(list_id):
    user = get_current_user()
    if not user:
        return redirect(url_for('select_user'))
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id).first_or_404()

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
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    if request.method == 'POST':
        data = request.json
        new_list = TodoList(title=data['title'], type=data.get('type', 'list'), user_id=user.id)
        db.session.add(new_list)
        db.session.commit()
        return jsonify(new_list.to_dict()), 201

    # Filter out lists that are children (linked to an item)
    # We want lists where NO TodoItem has this list as its linked_list_id
    include_children = (request.args.get('include_children', 'false').lower() in ['1', 'true', 'yes', 'on'])
    query = TodoList.query.filter_by(user_id=user.id)
    if not include_children:
        query = query.outerjoin(TodoItem, TodoList.id == TodoItem.linked_list_id).filter(TodoItem.id == None)
    list_type = request.args.get('type')
    if list_type:
        query = query.filter(TodoList.type == list_type)
    lists = query.all()
    return jsonify([l.to_dict() for l in lists])

@app.route('/api/lists/<int:list_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_list(list_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id).first_or_404()
    
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
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id).first_or_404()
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
        child_list = TodoList(title=content, type=project_type, user_id=user.id)
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
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    # Verify the item belongs to a list owned by the current user
    item = TodoItem.query.select_from(TodoItem).join(TodoList, TodoItem.list_id == TodoList.id).filter(
        TodoItem.id == item_id,
        TodoList.user_id == user.id
    ).first_or_404()
    
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
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    # Verify the item belongs to a list owned by the current user
    item = TodoItem.query.select_from(TodoItem).join(TodoList, TodoItem.list_id == TodoList.id).filter(
        TodoItem.id == item_id,
        TodoList.user_id == user.id
    ).first_or_404()
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

        dest_hub = TodoList.query.filter_by(id=dest_hub_id, user_id=user.id, type='hub').first()
        if not dest_hub:
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

    dest_list = TodoList.query.filter_by(id=dest_list_id, user_id=user.id, type='list').first()
    if not dest_list:
        return jsonify({'error': 'Destination is not a valid project list'}), 404

    # Validate destination phase (optional)
    phase_obj = None
    if dest_phase_id is not None:
        try:
            dest_phase_id_int = int(dest_phase_id)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid destination phase ID'}), 400
        phase_obj = TodoItem.query.get(dest_phase_id_int)
        if not phase_obj or phase_obj.list_id != dest_list.id or not (phase_obj.is_phase or phase_obj.status == 'phase'):
            return jsonify({'error': 'Destination phase not found in that project'}), 404
        dest_phase_id = dest_phase_id_int
    else:
        dest_phase_id = None

    old_list = item.list
    old_phase_id = item.phase_id
    item.list_id = dest_list.id
    item.phase_id = dest_phase_id
    db.session.flush()

    insert_items_under_phase(dest_list, [item], phase_id=dest_phase_id)

    if old_list and old_list.id != dest_list.id:
        reindex_list(old_list)

    if old_phase_id:
        old_phase = TodoItem.query.get(old_phase_id)
        if old_phase:
            old_phase.update_phase_status()
    if dest_phase_id:
        new_phase = TodoItem.query.get(dest_phase_id)
        if new_phase:
            new_phase.update_phase_status()

    db.session.commit()
    return jsonify({'message': 'Task moved successfully'})

@app.route('/api/move-destinations/<int:list_id>', methods=['GET'])
def move_destinations(list_id):
    """Return possible destinations for moving tasks (all project lists with their phases)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    project_lists = TodoList.query.filter_by(user_id=user.id, type='list').all()
    payload = []
    for l in project_lists:
        payload.append({
            'id': l.id,
            'title': l.title,
            'phases': [{'id': i.id, 'content': i.content} for i in l.items if i.is_phase or i.status == 'phase']
        })
    return jsonify(payload)

@app.route('/api/lists/<int:list_id>/phases')
def list_phases(list_id):
    """Return phases for a specific project list."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id, type='list').first_or_404()
    phases = [{'id': i.id, 'content': i.content} for i in todo_list.items if i.is_phase or i.status == 'phase']
    return jsonify({'id': todo_list.id, 'title': todo_list.title, 'phases': phases})

@app.route('/api/hubs')
def list_hubs():
    """Return all hubs for the current user (id, title)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    hubs = TodoList.query.filter_by(user_id=user.id, type='hub').all()
    return jsonify([{'id': h.id, 'title': h.title} for h in hubs])

@app.route('/api/hubs/<int:hub_id>/children')
def hub_children(hub_id):
    """Return projects/hubs within a hub for navigation."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    hub = TodoList.query.filter_by(id=hub_id, user_id=user.id, type='hub').first_or_404()
    children = []
    for item in hub.items:
        if not item.linked_list:
            continue
        child_list = item.linked_list
        entry = {
            'id': child_list.id,
            'title': child_list.title,
            'type': child_list.type,
            'has_children': child_list.type == 'hub'
        }
        if child_list.type == 'list':
            entry['phases'] = [{'id': i.id, 'content': i.content} for i in child_list.items if i.is_phase or i.status == 'phase']
        children.append(entry)
    return jsonify({'hub': {'id': hub.id, 'title': hub.title}, 'children': children})

@app.route('/api/lists/<int:list_id>/export', methods=['GET'])
def export_list(list_id):
    """Export a list or hub (with nested hubs) as plain text outline."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id).first_or_404()

    lines = export_list_outline(todo_list)
    content = '\n'.join(lines)
    filename = f"{_slugify_filename(todo_list.title)}-{list_id}.txt"

    response = app.response_class(content, mimetype='text/plain; charset=utf-8')
    response.headers['Content-Disposition'] = f'attachment; filename=\"{filename}\"'
    return response

@app.route('/api/lists/<int:list_id>/bulk_import', methods=['POST'])
def bulk_import(list_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id).first_or_404()
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
            child_list = TodoList(title=project_data['content'], type=project_data.get('project_type', 'list'), user_id=user.id)
            db.session.add(child_list)
            db.session.flush() # Get ID for child_list
            project_item.linked_list_id = child_list.id
            db.session.add(project_item)
            created_items.append(project_item)

            # Add phases and tasks to the child list
            for item_data in project_data.get('items', []):
                status = item_data.get('status', 'not_started')
                is_phase = status == 'phase'
                if is_phase:
                    status = 'not_started'
                child_item = TodoItem(
                    list_id=child_list.id,
                    content=item_data.get('content', ''),
                    description=item_data.get('description'),
                    notes=item_data.get('notes'),
                    status=status,
                    is_phase=is_phase
                )
                db.session.add(child_item)
    else:
        # For simple lists, parsed_items is a flat list of tasks/phases
        for entry in parsed_items:
            content = entry.get('content', '').strip()
            if not content:
                continue
            status = entry.get('status', 'not_started')
            is_phase = status == 'phase'
            if is_phase:
                status = 'not_started'
            new_item = TodoItem(
                list_id=todo_list.id,
                content=content,
                status=status,
                description=entry.get('description'),
                notes=entry.get('notes'),
                is_phase=is_phase
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
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    data = request.json or {}
    raw_ids = data.get('ids') or []
    action = data.get('action')
    list_id = data.get('list_id')

    if not raw_ids or not isinstance(raw_ids, list):
        return jsonify({'error': 'ids list is required'}), 400
    if action not in ['status', 'delete', 'move']:
        return jsonify({'error': 'action must be status, delete, or move'}), 400

    # Normalize IDs to integers
    ids = []
    for raw_id in raw_ids:
        try:
            ids.append(int(raw_id))
        except (ValueError, TypeError):
            continue
    if not ids:
        return jsonify({'error': 'No valid item ids provided'}), 400

    # Filter items by user ownership
    items = TodoItem.query.select_from(TodoItem).join(TodoList, TodoItem.list_id == TodoList.id).filter(
        TodoItem.id.in_(ids),
        TodoList.user_id == user.id
    ).all()

    if list_id is not None:
        try:
            list_id_int = int(list_id)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid list_id'}), 400
        items = [i for i in items if i.list_id == list_id_int]
        list_id = list_id_int

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

    if action == 'move':
        dest_list_id = data.get('destination_list_id')
        dest_phase_id = data.get('destination_phase_id')

        if dest_list_id is None:
            return jsonify({'error': 'destination_list_id is required for move'}), 400
        try:
            dest_list_id = int(dest_list_id)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid destination list ID'}), 400

        dest_list = TodoList.query.filter_by(id=dest_list_id, user_id=user.id, type='list').first()
        if not dest_list:
            return jsonify({'error': 'Destination is not a valid project list'}), 404

        dest_phase_obj = None
        if dest_phase_id is not None:
            try:
                dest_phase_id_int = int(dest_phase_id)
            except (ValueError, TypeError):
                return jsonify({'error': 'Invalid destination phase ID'}), 400
            dest_phase_obj = TodoItem.query.get(dest_phase_id_int)
            if not dest_phase_obj or dest_phase_obj.list_id != dest_list.id or not (dest_phase_obj.is_phase or dest_phase_obj.status == 'phase'):
                return jsonify({'error': 'Destination phase not found in that project'}), 404
            dest_phase_id = dest_phase_id_int
        else:
            dest_phase_id = None

        # Only move regular tasks (no phases or linked projects)
        movable_items = [i for i in items if not i.is_phase and not i.linked_list]
        skipped = len(items) - len(movable_items)
        if not movable_items:
            return jsonify({'error': 'No movable tasks found (cannot move phases or projects).'}), 400

        old_lists = set()
        old_phase_ids = set()

        for item in movable_items:
            if item.phase_id:
                old_phase_ids.add(item.phase_id)
            if item.list_id != dest_list.id and item.list:
                old_lists.add(item.list)
            item.list_id = dest_list.id
            item.phase_id = dest_phase_id
            # Ensure relationship collection is aware of the move before ordering
            if item not in dest_list.items:
                dest_list.items.append(item)
            db.session.flush()

        insert_items_under_phase(dest_list, movable_items, phase_id=dest_phase_id)

        for l in old_lists:
            reindex_list(l)

        # Reindex destination list to ensure contiguous ordering after multiple inserts
        dest_list_refreshed = TodoList.query.get(dest_list.id)
        if dest_list_refreshed:
            reindex_list(dest_list_refreshed)

        for pid in old_phase_ids:
            phase = TodoItem.query.get(pid)
            if phase:
                phase.update_phase_status()
        if dest_phase_id:
            dest_phase_obj = TodoItem.query.get(dest_phase_id)
            if dest_phase_obj:
                dest_phase_obj.update_phase_status()

        db.session.commit()
        return jsonify({'moved': len(movable_items), 'skipped': skipped})


@app.route('/api/lists/<int:list_id>/reorder', methods=['POST'])
def reorder_items(list_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id).first_or_404()
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
