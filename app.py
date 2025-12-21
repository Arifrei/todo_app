import os
import re
from datetime import datetime, date, time, timedelta

from dotenv import load_dotenv
from flask import Flask, render_template, request, jsonify, redirect, url_for, session

load_dotenv()

from ai_service import run_ai_chat
from models import db, User, TodoList, TodoItem, Note, CalendarEvent
from apscheduler.schedulers.background import BackgroundScheduler

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///todo.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
app.config['PERMANENT_SESSION_LIFETIME'] = 365 * 24 * 60 * 60  # 1 year in seconds
app.config['API_SHARED_KEY'] = os.environ.get('API_SHARED_KEY')  # Optional shared key for API callers

db.init_app(app)
scheduler = None

def get_current_user():
    """Resolve the current user from a shared API key + user id header, else fall back to session."""
    # Header-based auth for AI/service callers
    api_key = request.headers.get('X-API-Key')
    api_user_id = request.headers.get('X-User-Id')
    shared_key = app.config.get('API_SHARED_KEY')
    if shared_key and api_key and api_user_id:
        try:
            api_uid_int = int(api_user_id)
        except (TypeError, ValueError):
            api_uid_int = None
        if api_uid_int and api_key == shared_key:
            user = db.session.get(User, api_uid_int)
            if user:
                return user

    # Session-based auth for browser users
    user_id = session.get('user_id')
    if user_id:
        return db.session.get(User, user_id)
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
                items.append({'content': title, 'status': 'not_started', 'is_phase': True, 'description': description, 'notes': notes})
            continue
        if stripped.endswith(':') and len(stripped) > 1:
            title, description, notes = split_fields(stripped[:-1].strip())
            if title:
                items.append({'content': title, 'status': 'not_started', 'is_phase': True, 'description': description, 'notes': notes})
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
                    items.append({'content': content, 'status': status, 'description': description, 'notes': notes, 'is_phase': False})
            continue

        # Bullet tasks: "- task" or "* task"
        bullet_match = re.match(r"^[-*]\s+(?P<body>.+)$", stripped)
        if bullet_match:
            body = bullet_match.group('body').strip()
            if body:
                content, description, notes = split_fields(body)
                if content:
                    items.append({'content': content, 'status': 'not_started', 'description': description, 'notes': notes, 'is_phase': False})
            continue

        # Fallback: treat as a task line
        content, description, notes = split_fields(stripped)
        if content:
            items.append({'content': content, 'status': 'not_started', 'description': description, 'notes': notes, 'is_phase': False})

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
                current_project['items'].append({'content': title, 'status': 'not_started', 'is_phase': True, 'description': description, 'notes': notes})
            continue

        # Task: Indented list item
        checkbox_match = re.match(r"^[-*]\s*\[(?P<mark>[ xX>~])\]\s*(?P<body>.+)$", stripped)
        if checkbox_match:
            mark = checkbox_match.group('mark').lower()
            body = checkbox_match.group('body').strip()
            status = {'x': 'done', '>': 'in_progress', '~': 'in_progress', ' ': 'not_started'}.get(mark, 'not_started')
            content, description, notes = split_fields(body)
            if content:
                current_project['items'].append({'content': content, 'status': status, 'description': description, 'notes': notes, 'is_phase': False})
            continue

        bullet_match = re.match(r"^[-*]\s+(?P<body>.+)$", stripped)
        if bullet_match:
            body = bullet_match.group('body').strip()
            content, description, notes = split_fields(body)
            if content:
                current_project['items'].append({'content': content, 'status': 'not_started', 'description': description, 'notes': notes, 'is_phase': False})
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
            if is_phase_header(item):
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


def is_phase_header(item):
    """Canonical check for phase headers (supports legacy 'phase' status)."""
    return getattr(item, 'is_phase', False) or getattr(item, 'status', None) == 'phase'


def canonicalize_phase_flags(todo_list):
    """Normalize legacy phase markers on a list; commits only when changes occur."""
    changed = False
    for item in todo_list.items:
        if item.status == 'phase' and not item.is_phase:
            item.is_phase = True
            item.status = 'not_started'
            changed = True
    if changed:
        db.session.commit()


def insert_item_in_order(todo_list, new_item, phase_id=None):
    """Place a new item in the ordering, optionally directly under a phase."""
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

# --- Calendar Helpers ---

def _parse_time_str(val):
    """Parse 'HH' or 'HH:MM' into a time object; return None on failure."""
    if not val:
        return None
    if isinstance(val, time):
        return val
    try:
        parts = str(val).split(':')
        hour = int(parts[0])
        minute = int(parts[1]) if len(parts) > 1 else 0
        return time(hour=hour, minute=minute)
    except Exception:
        return None


def _next_calendar_order(day_value, user_id):
    """Return next order index for a given day/user."""
    current_max = db.session.query(db.func.max(CalendarEvent.order_index)).filter(
        CalendarEvent.user_id == user_id,
        CalendarEvent.day == day_value
    ).scalar()
    return (current_max or 0) + 1


def _rollover_incomplete_events():
    """Clone yesterday's incomplete events with rollover enabled into today."""
    with app.app_context():
        today = date.today()
        yesterday = today - timedelta(days=1)

        # Build a map of phases that need to be recreated
        phases_yesterday = CalendarEvent.query.filter(
            CalendarEvent.day == yesterday,
            CalendarEvent.is_phase.is_(True)
        ).all()

        # For each user, roll their events independently
        user_ids = [u.id for u in User.query.all()]
        for uid in user_ids:
            phase_map = {}
            # Collect phases by title to recreate only if needed
            for ph in phases_yesterday:
                if ph.user_id == uid:
                    phase_map[ph.id] = None  # placeholder

            events = CalendarEvent.query.filter(
                CalendarEvent.user_id == uid,
                CalendarEvent.day == yesterday,
                CalendarEvent.status != 'done',
                CalendarEvent.rollover_enabled.is_(True),
                CalendarEvent.is_phase.is_(False)
            ).order_by(CalendarEvent.order_index.asc()).all()

            if not events:
                continue

            for ev in events:
                new_phase_id = None
                if ev.phase_id:
                    if ev.phase_id not in phase_map or phase_map[ev.phase_id] is None:
                        orig_phase = next((p for p in phases_yesterday if p.id == ev.phase_id and p.user_id == uid), None)
                        if orig_phase:
                            copy_phase = CalendarEvent(
                                user_id=uid,
                                title=orig_phase.title,
                                description=orig_phase.description,
                                day=today,
                                is_phase=True,
                                status='not_started',
                                priority=orig_phase.priority,
                                order_index=_next_calendar_order(today, uid),
                                reminder_minutes_before=None,
                                rollover_enabled=orig_phase.rollover_enabled,
                                rolled_from_id=orig_phase.id
                            )
                            db.session.add(copy_phase)
                            db.session.flush()
                            phase_map[orig_phase.id] = copy_phase.id
                    new_phase_id = phase_map.get(ev.phase_id)

                copy_event = CalendarEvent(
                    user_id=uid,
                    title=ev.title,
                    description=ev.description,
                    day=today,
                    start_time=ev.start_time,
                    end_time=ev.end_time,
                    status='not_started',
                    priority=ev.priority,
                    is_phase=False,
                    phase_id=new_phase_id,
                    order_index=_next_calendar_order(today, uid),
                    reminder_minutes_before=ev.reminder_minutes_before,
                    rollover_enabled=ev.rollover_enabled,
                    rolled_from_id=ev.id
                )
                db.session.add(copy_event)

            db.session.commit()


def _send_email(to_addr, subject, body):
    """Lightweight SMTP sender using environment variables."""
    host = os.environ.get('SMTP_HOST')
    port = int(os.environ.get('SMTP_PORT', 587))
    user = os.environ.get('SMTP_USER')
    password = os.environ.get('SMTP_PASSWORD')
    from_addr = os.environ.get('SMTP_FROM') or user
    if not host or not from_addr:
        return False
    import smtplib
    from email.mime.text import MIMEText

    msg = MIMEText(body, 'plain')
    msg['Subject'] = subject
    msg['From'] = from_addr
    msg['To'] = to_addr

    with smtplib.SMTP(host, port) as server:
        server.starttls()
        if user and password:
            server.login(user, password)
        server.sendmail(from_addr, [to_addr], msg.as_string())
    return True


def _build_daily_digest_body(events_for_day):
    lines = []
    for ev in events_for_day:
        prefix = '[x]' if ev.status == 'done' else '[ ]'
        time_block = ''
        if ev.start_time:
            end_str = ev.end_time.isoformat() if ev.end_time else ''
            time_block = f" @ {ev.start_time.isoformat()}{('-' + end_str) if end_str else ''}"
        priority = ev.priority or 'medium'
        lines.append(f"{prefix} {ev.title} ({priority}){time_block}")
    return '\n'.join(lines)


def _send_daily_email_digest(target_day=None):
    """Send daily digest emails to users who have an email set."""
    if os.environ.get('ENABLE_CALENDAR_EMAIL_DIGEST', '0') != '1':
        return
    with app.app_context():
        target_day = target_day or date.today()
        users = User.query.filter(User.email != None).all()  # noqa: E711
        for user_obj in users:
            events = CalendarEvent.query.filter(
                CalendarEvent.user_id == user_obj.id,
                CalendarEvent.day == target_day
            ).order_by(CalendarEvent.order_index.asc()).all()
            if not events:
                continue
            body = _build_daily_digest_body(events)
            try:
                _send_email(user_obj.email, f"Your tasks for {target_day.isoformat()}", body)
            except Exception:
                continue


def _start_scheduler():
    """Start background scheduler for rollover and optional digest."""
    global scheduler
    if os.environ.get('ENABLE_CALENDAR_JOBS', '1') != '1':
        return
    if scheduler and scheduler.running:
        return
    # Avoid double-start in Flask debug reloader
    if app.debug and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
        return
    scheduler = BackgroundScheduler()
    scheduler.add_job(_rollover_incomplete_events, 'cron', hour=0, minute=10)
    # Optional daily digest at 7:00 local time
    scheduler.add_job(_send_daily_email_digest, 'cron', hour=int(os.environ.get('DIGEST_HOUR', 7)), minute=0)
    scheduler.start()

_jobs_bootstrapped = False

@app.before_request
def _bootstrap_background_jobs():
    global _jobs_bootstrapped
    if _jobs_bootstrapped:
        return
    _start_scheduler()
    _jobs_bootstrapped = True

# User Selection Routes
@app.route('/select-user')
def select_user():
    """Show user selection page"""
    users = User.query.all()
    return render_template('select_user.html', users=users)

@app.route('/api/set-user/<int:user_id>', methods=['POST'])
def set_user(user_id):
    """Set the current user in session"""
    user = db.get_or_404(User, user_id)
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


@app.route('/notes')
def notes_page():
    """Dedicated notes workspace with rich text editor."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('notes.html')

@app.route('/ai')
def ai_page():
    """AI assistant full page."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('ai.html')

@app.route('/calendar')
def calendar_page():
    """Calendar day-first UI."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('calendar.html')

@app.route('/list/<int:list_id>')
def list_view(list_id):
    user = get_current_user()
    if not user:
        return redirect(url_for('select_user'))
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id).first_or_404()
    canonicalize_phase_flags(todo_list)

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
        if is_phase_header(item):
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
        if len(group) == 1 and is_phase_header(group[0]):
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


@app.route('/api/notes', methods=['GET', 'POST'])
def handle_notes():
    """List or create rich-text notes for the current user."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    if request.method == 'POST':
        data = request.json or {}
        title = (data.get('title') or '').strip() or 'Untitled Note'
        content = data.get('content') or ''
        note = Note(title=title, content=content, user_id=user.id)
        db.session.add(note)
        db.session.commit()
        return jsonify(note.to_dict()), 201

    notes = Note.query.filter_by(user_id=user.id).order_by(Note.updated_at.desc()).all()
    return jsonify([n.to_dict() for n in notes])


@app.route('/api/notes/<int:note_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_note(note_id):
    """CRUD operations for a single note."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()

    if request.method == 'DELETE':
        db.session.delete(note)
        db.session.commit()
        return '', 204

    if request.method == 'PUT':
        data = request.json or {}
        note.title = (data.get('title') or '').strip() or 'Untitled Note'
        note.content = data.get('content', note.content)
        note.updated_at = datetime.utcnow()
        db.session.commit()
        return jsonify(note.to_dict())

    return jsonify(note.to_dict())

# Calendar API
ALLOWED_PRIORITIES = {'low', 'medium', 'high'}
ALLOWED_STATUSES = {'not_started', 'in_progress', 'done'}

def _parse_day_value(raw):
    if isinstance(raw, date):
        return raw
    try:
        return datetime.strptime(str(raw), '%Y-%m-%d').date()
    except Exception:
        return None


@app.route('/api/calendar/events', methods=['GET', 'POST'])
def calendar_events():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    # Range fetch for calendar view (start & end inclusive)
    if request.method == 'GET' and (request.args.get('start') or request.args.get('end')):
        start_raw = request.args.get('start')
        end_raw = request.args.get('end')
        start_day = _parse_day_value(start_raw) if start_raw else date.today().replace(day=1)
        if not start_day:
            return jsonify({'error': 'Invalid start date'}), 400
        if end_raw:
            end_day = _parse_day_value(end_raw)
            if not end_day:
                return jsonify({'error': 'Invalid end date'}), 400
        else:
            # Default end to end-of-month for start_day
            next_month = (start_day.replace(day=28) + timedelta(days=4)).replace(day=1)
            end_day = next_month - timedelta(days=1)
        if end_day < start_day:
            return jsonify({'error': 'end must be on/after start'}), 400

        events = CalendarEvent.query.filter(
            CalendarEvent.user_id == user.id,
            CalendarEvent.day >= start_day,
            CalendarEvent.day <= end_day
        ).order_by(CalendarEvent.day.asc(), CalendarEvent.order_index.asc()).all()

        phase_map_by_day = {}
        for ev in events:
            if ev.is_phase:
                day_key = ev.day.isoformat()
                phase_map_by_day.setdefault(day_key, {})[ev.id] = ev.title

        by_day = {}
        for ev in events:
            day_key = ev.day.isoformat()
            data = ev.to_dict()
            if ev.phase_id:
                data['phase_title'] = phase_map_by_day.get(day_key, {}).get(ev.phase_id)
            by_day.setdefault(day_key, []).append(data)

        return jsonify({
            'start': start_day.isoformat(),
            'end': end_day.isoformat(),
            'events': by_day
        })

    if request.method == 'GET':
        day_str = request.args.get('day') or date.today().isoformat()
        day_obj = _parse_day_value(day_str)
        if not day_obj:
            return jsonify({'error': 'Invalid day'}), 400
        events = CalendarEvent.query.filter_by(user_id=user.id, day=day_obj).order_by(
            CalendarEvent.order_index.asc()
        ).all()
        payload = []
        for ev in events:
            data = ev.to_dict()
            if ev.phase_id:
                parent = next((e for e in events if e.id == ev.phase_id), None)
                data['phase_title'] = parent.title if parent else None
            payload.append(data)
        return jsonify(payload)

    data = request.json or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'Title is required'}), 400

    day_obj = _parse_day_value(data.get('day') or date.today().isoformat())
    if not day_obj:
        return jsonify({'error': 'Invalid day'}), 400

    is_phase = bool(data.get('is_phase'))
    is_event = bool(data.get('is_event'))
    is_group = bool(data.get('is_group'))
    priority = (data.get('priority') or 'medium').lower()
    if priority not in ALLOWED_PRIORITIES:
        priority = 'medium'
    status = (data.get('status') or 'not_started')
    if status not in ALLOWED_STATUSES:
        status = 'not_started'

    reminder_minutes = data.get('reminder_minutes_before')
    try:
        reminder_minutes = int(reminder_minutes) if reminder_minutes is not None else None
    except (TypeError, ValueError):
        reminder_minutes = None

    phase_id = data.get('phase_id')
    resolved_phase_id = None
    if phase_id and not is_phase and not is_group:
        try:
            phase_id_int = int(phase_id)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid phase_id'}), 400
        phase_obj = CalendarEvent.query.filter_by(id=phase_id_int, user_id=user.id, day=day_obj, is_phase=True).first()
        if not phase_obj:
            return jsonify({'error': 'Phase not found for that day'}), 404
        resolved_phase_id = phase_id_int

    group_id = data.get('group_id')
    resolved_group_id = None
    if group_id and not is_group:
        try:
            group_id_int = int(group_id)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid group_id'}), 400
        group_obj = CalendarEvent.query.filter_by(id=group_id_int, user_id=user.id, day=day_obj, is_group=True).first()
        if not group_obj:
            return jsonify({'error': 'Group not found for that day'}), 404
        resolved_group_id = group_id_int

    start_time = _parse_time_str(data.get('start_time'))
    end_time = _parse_time_str(data.get('end_time'))

    new_event = CalendarEvent(
        user_id=user.id,
        title=title,
        description=(data.get('description') or '').strip() or None,
        day=day_obj,
        start_time=start_time,
        end_time=end_time,
        status=status,
        priority=priority,
        is_phase=is_phase,
        is_event=is_event and not is_phase and not is_group,
        is_group=is_group and not is_phase and not is_event,
        phase_id=resolved_phase_id if not is_phase and not is_group else None,
        group_id=resolved_group_id if not is_group else None,
        reminder_minutes_before=reminder_minutes if not is_phase and not is_group else None,
        rollover_enabled=bool(data.get('rollover_enabled', True) if not is_group else False),
        order_index=_next_calendar_order(day_obj, user.id)
    )
    db.session.add(new_event)
    db.session.commit()
    return jsonify(new_event.to_dict()), 201


@app.route('/api/calendar/events/<int:event_id>', methods=['PUT', 'DELETE'])
def calendar_event_detail(event_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    event = CalendarEvent.query.filter_by(id=event_id, user_id=user.id).first_or_404()

    if request.method == 'DELETE':
        db.session.delete(event)
        db.session.commit()
        return '', 204

    data = request.json or {}
    if 'title' in data:
        title = (data.get('title') or '').strip()
        if title:
            event.title = title
    if 'description' in data:
        event.description = (data.get('description') or '').strip() or None
    if 'priority' in data:
        priority = (data.get('priority') or '').lower()
        if priority in ALLOWED_PRIORITIES:
            event.priority = priority
    if 'status' in data:
        status = data.get('status')
        if status in ALLOWED_STATUSES:
            event.status = status
    if 'is_event' in data and not event.is_phase:
        event.is_event = bool(data.get('is_event'))
    if 'is_group' in data and not event.is_phase and not event.is_event:
        event.is_group = bool(data.get('is_group'))
    if 'rollover_enabled' in data:
        event.rollover_enabled = bool(data.get('rollover_enabled'))
    if 'start_time' in data:
        event.start_time = _parse_time_str(data.get('start_time'))
    if 'end_time' in data:
        event.end_time = _parse_time_str(data.get('end_time'))
    if 'reminder_minutes_before' in data:
        try:
            event.reminder_minutes_before = int(data.get('reminder_minutes_before'))
        except (TypeError, ValueError):
            event.reminder_minutes_before = None
    if 'day' in data:
        new_day = _parse_day_value(data.get('day'))
        if not new_day:
            return jsonify({'error': 'Invalid day'}), 400
        if new_day != event.day:
            event.day = new_day
            event.order_index = _next_calendar_order(new_day, user.id)
    if 'phase_id' in data and not event.is_phase:
        if data.get('phase_id') is None:
            event.phase_id = None
        else:
            try:
                pid = int(data.get('phase_id'))
            except (TypeError, ValueError):
                return jsonify({'error': 'Invalid phase_id'}), 400
            phase_obj = CalendarEvent.query.filter_by(id=pid, user_id=user.id, day=event.day, is_phase=True).first()
            if not phase_obj:
                return jsonify({'error': 'Phase not found for that day'}), 404
            event.phase_id = pid
    if 'group_id' in data and not event.is_group:
        if data.get('group_id') is None:
            event.group_id = None
        else:
            try:
                gid = int(data.get('group_id'))
            except (TypeError, ValueError):
                return jsonify({'error': 'Invalid group_id'}), 400
            group_obj = CalendarEvent.query.filter_by(id=gid, user_id=user.id, day=event.day, is_group=True).first()
            if not group_obj:
                return jsonify({'error': 'Group not found for that day'}), 404
            event.group_id = gid
    db.session.commit()
    return jsonify(event.to_dict())


@app.route('/api/calendar/events/reorder', methods=['POST'])
def reorder_calendar_events():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    data = request.json or {}
    ids = data.get('ids') or []
    day_obj = _parse_day_value(data.get('day') or date.today().isoformat())
    if not ids or not isinstance(ids, list):
        return jsonify({'error': 'ids array required'}), 400
    if not day_obj:
        return jsonify({'error': 'Invalid day'}), 400

    items = CalendarEvent.query.filter(
        CalendarEvent.user_id == user.id,
        CalendarEvent.id.in_(ids),
        CalendarEvent.day == day_obj
    ).all()
    position = 1
    for eid in ids:
        try:
            eid_int = int(eid)
        except (TypeError, ValueError):
            continue
        item = next((i for i in items if i.id == eid_int), None)
        if item:
            item.order_index = position
            position += 1
    db.session.commit()
    return jsonify({'updated': position - 1})


@app.route('/api/calendar/rollover-now', methods=['POST'])
def manual_rollover():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    _rollover_incomplete_events()
    return jsonify({'status': 'ok'})


@app.route('/api/calendar/digest/email', methods=['POST'])
def send_digest_now():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    day_obj = _parse_day_value(request.json.get('day') if request.json else None) or date.today()
    _send_daily_email_digest(target_day=day_obj)
    return jsonify({'status': 'sent', 'day': day_obj.isoformat()})

@app.route('/api/lists/<int:list_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_list(list_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id).first_or_404()
    canonicalize_phase_flags(todo_list)
    
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


@app.route('/api/lists/<int:list_id>/items', methods=['GET'])
def list_items_in_list(list_id):
    """Return tasks/phases for a list with optional filters for AI/clients."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id).first_or_404()
    canonicalize_phase_flags(todo_list)

    status_filter = request.args.get('status')
    phase_id = request.args.get('phase_id')
    include_phases = request.args.get('include_phases', 'true').lower() in ['1', 'true', 'yes', 'on']

    allowed_statuses = {'not_started', 'in_progress', 'done'}
    if status_filter and status_filter not in allowed_statuses:
        return jsonify({'error': 'Invalid status filter'}), 400

    items = list(todo_list.items)
    if status_filter:
        items = [i for i in items if i.status == status_filter]
    if not include_phases:
        items = [i for i in items if not is_phase_header(i)]
    if phase_id is not None:
        try:
            phase_id_int = int(phase_id)
            items = [i for i in items if i.phase_id == phase_id_int or (include_phases and i.id == phase_id_int)]
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid phase_id'}), 400

    items = sorted(items, key=lambda i: i.order_index or 0)
    return jsonify([i.to_dict() for i in items])

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
    is_phase_item = bool(data.get('is_phase')) or status == 'phase'
    allowed_statuses = {'not_started', 'in_progress', 'done'}
    if status not in allowed_statuses:
        status = 'not_started'
    if is_phase_item or is_project:
        status = 'not_started'
    next_order = db.session.query(db.func.coalesce(db.func.max(TodoItem.order_index), 0)).filter_by(list_id=list_id).scalar() + 1
    new_item = TodoItem(
        list_id=list_id,
        content=content,
        description=description,
        notes=notes,
        status=status,
        order_index=next_order,
        phase_id=int(phase_id) if (phase_id and not is_phase_item) else None,
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
            phase_item = db.session.get(TodoItem, phase_id_int)
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
        allowed_statuses = {'not_started', 'in_progress', 'done'}
        if new_status not in allowed_statuses:
            new_status = item.status
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
            phase_item = db.session.get(TodoItem, item.phase_id)
            if phase_item:
                phase_item.update_phase_status()

        db.session.commit()
        return jsonify(item.to_dict())


@app.route('/api/items', methods=['GET'])
def query_items():
    """Query items across lists with filters for AI/clients."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    status_filter = request.args.get('status')
    list_id = request.args.get('list_id')
    phase_id = request.args.get('phase_id')
    is_phase_param = request.args.get('is_phase')
    search = request.args.get('q', '').strip()
    try:
        limit = int(request.args.get('limit', 100))
    except (ValueError, TypeError):
        limit = 100
    limit = min(max(limit, 1), 250)

    allowed_statuses = {'not_started', 'in_progress', 'done'}
    if status_filter and status_filter not in allowed_statuses:
        return jsonify({'error': 'Invalid status filter'}), 400

    query = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(TodoList.user_id == user.id)
    if list_id:
        try:
            list_id_int = int(list_id)
            query = query.filter(TodoItem.list_id == list_id_int)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid list_id'}), 400
    if phase_id:
        try:
            phase_id_int = int(phase_id)
            query = query.filter(TodoItem.phase_id == phase_id_int)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid phase_id'}), 400
    if status_filter:
        query = query.filter(TodoItem.status == status_filter)
    if is_phase_param is not None:
        is_phase_bool = is_phase_param.lower() in ['1', 'true', 'yes', 'on']
        query = query.filter(TodoItem.is_phase == is_phase_bool)
    if search:
        like_expr = f"%{search}%"
        query = query.filter(db.or_(TodoItem.content.ilike(like_expr), TodoItem.description.ilike(like_expr)))

    items = query.order_by(TodoItem.list_id, TodoItem.order_index).limit(limit).all()
    payload = []
    for item in items:
        data = item.to_dict()
        data['list_title'] = item.list.title
        data['list_type'] = item.list.type
        payload.append(data)
    return jsonify(payload)


@app.route('/api/search')
def search_entities():
    """Simple search across lists and items for AI resolution."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    q = (request.args.get('q') or '').strip()
    if not q:
        return jsonify({'error': 'Query parameter q is required'}), 400

    try:
        list_limit = int(request.args.get('list_limit', 20))
    except (ValueError, TypeError):
        list_limit = 20
    list_limit = min(max(list_limit, 1), 100)

    try:
        item_limit = int(request.args.get('item_limit', 50))
    except (ValueError, TypeError):
        item_limit = 50
    item_limit = min(max(item_limit, 1), 200)
    like_expr = f"%{q}%"

    lists = TodoList.query.filter(
        TodoList.user_id == user.id,
        TodoList.title.ilike(like_expr)
    ).order_by(TodoList.title.asc()).limit(list_limit).all()

    items = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
        TodoList.user_id == user.id,
        db.or_(TodoItem.content.ilike(like_expr), TodoItem.description.ilike(like_expr))
    ).order_by(TodoItem.list_id, TodoItem.order_index).limit(item_limit).all()

    return jsonify({
        'lists': [{'id': l.id, 'title': l.title, 'type': l.type} for l in lists],
        'items': [{
            'id': i.id,
            'content': i.content,
            'status': i.status,
            'is_phase': i.is_phase,
            'list_id': i.list_id,
            'list_title': i.list.title,
            'list_type': i.list.type,
            'phase_id': i.phase_id
        } for i in items]
    })


@app.route('/api/ai/chat', methods=['POST'])
def ai_chat():
    """AI chat endpoint that routes through OpenAI with function-calling tools."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    data = request.json or {}
    messages = data.get('messages', [])
    model = data.get('model')
    try:
        result = run_ai_chat(user.id, messages, model=model)
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500
    return jsonify(result)

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
    if is_phase_header(item):
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
        phase_obj = db.session.get(TodoItem, dest_phase_id_int)
        if not phase_obj or phase_obj.list_id != dest_list.id or not is_phase_header(phase_obj):
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
        old_phase = db.session.get(TodoItem, old_phase_id)
        if old_phase:
            old_phase.update_phase_status()
    if dest_phase_id:
        new_phase = db.session.get(TodoItem, dest_phase_id)
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
        canonicalize_phase_flags(l)
        payload.append({
            'id': l.id,
            'title': l.title,
            'phases': [{'id': i.id, 'content': i.content} for i in l.items if is_phase_header(i)]
        })
    return jsonify(payload)

@app.route('/api/lists/<int:list_id>/phases')
def list_phases(list_id):
    """Return phases for a specific project list."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id, type='list').first_or_404()
    canonicalize_phase_flags(todo_list)
    phases = [{'id': i.id, 'content': i.content} for i in todo_list.items if is_phase_header(i)]
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
        canonicalize_phase_flags(child_list)
        entry = {
            'id': child_list.id,
            'title': child_list.title,
            'type': child_list.type,
            'has_children': child_list.type == 'hub'
        }
        if child_list.type == 'list':
            entry['phases'] = [{'id': i.id, 'content': i.content} for i in child_list.items if is_phase_header(i)]
        children.append(entry)
    return jsonify({'hub': {'id': hub.id, 'title': hub.title}, 'children': children})

@app.route('/api/lists/<int:list_id>/export', methods=['GET'])
def export_list(list_id):
    """Export a list or hub (with nested hubs) as plain text outline."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id).first_or_404()
    canonicalize_phase_flags(todo_list)

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
                is_phase = bool(item_data.get('is_phase')) or status == 'phase'
                if status not in ['not_started', 'in_progress', 'done']:
                    status = 'not_started'
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
                created_items.append(child_item)
    else:
        # For simple lists, parsed_items is a flat list of tasks/phases
        for entry in parsed_items:
            content = entry.get('content', '').strip()
            if not content:
                continue
            status = entry.get('status', 'not_started')
            is_phase = bool(entry.get('is_phase')) or status == 'phase'
            if status not in ['not_started', 'in_progress', 'done']:
                status = 'not_started'
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
            if is_phase_header(item):
                continue
            item.status = status
            if item.phase_id:
                affected_phases.add(item.phase_id)

        # Update all affected phase statuses
        for phase_id in affected_phases:
            phase_item = db.session.get(TodoItem, phase_id)
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
            dest_phase_obj = db.session.get(TodoItem, dest_phase_id_int)
            if not dest_phase_obj or dest_phase_obj.list_id != dest_list.id or not is_phase_header(dest_phase_obj):
                return jsonify({'error': 'Destination phase not found in that project'}), 404
            dest_phase_id = dest_phase_id_int
        else:
            dest_phase_id = None

        # Only move regular tasks (no phases or linked projects)
        movable_items = [i for i in items if not is_phase_header(i) and not i.linked_list]
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
        dest_list_refreshed = db.session.get(TodoList, dest_list.id)
        if dest_list_refreshed:
            reindex_list(dest_list_refreshed)

        for pid in old_phase_ids:
            phase = db.session.get(TodoItem, pid)
            if phase:
                phase.update_phase_status()
        if dest_phase_id:
            dest_phase_obj = db.session.get(TodoItem, dest_phase_id)
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
