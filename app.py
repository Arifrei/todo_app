import os
import re
import json
import html
import logging
import pytz
import secrets
import threading
from datetime import datetime, date, time, timedelta
from dotenv import load_dotenv, find_dotenv
from flask import Flask, render_template, request, jsonify, redirect, url_for, session, send_from_directory
from ai_service import run_ai_chat, get_openai_client
from models import db, User, TodoList, TodoItem, Note, NoteFolder, NoteListItem, CalendarEvent, RecurringEvent, RecurrenceException, Notification, NotificationSetting, PushSubscription, RecallItem, QuickAccessItem, BookmarkItem
from apscheduler.schedulers.background import BackgroundScheduler
from pywebpush import webpush, WebPushException
import requests
from sqlalchemy import or_
from markupsafe import Markup, escape

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DOTENV_PATH = find_dotenv() or os.path.join(BASE_DIR, '.env')
if DOTENV_PATH and os.path.exists(DOTENV_PATH):
    load_dotenv(DOTENV_PATH)

app = Flask(__name__)
# Keep DB path aligned with migration scripts (instance/todo.db)
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get("DATABASE_URL", "sqlite:///todo.db")
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
app.config['PERMANENT_SESSION_LIFETIME'] = 365 * 24 * 60 * 60  # 1 year in seconds
app.config['API_SHARED_KEY'] = os.environ.get('API_SHARED_KEY')  # Optional shared key for API callers
app.config['DEFAULT_TIMEZONE'] = os.environ.get('DEFAULT_TIMEZONE', 'America/New_York')  # EST/EDT
app.config['VAPID_PUBLIC_KEY'] = os.environ.get('VAPID_PUBLIC_KEY', '')
app.config['VAPID_PRIVATE_KEY'] = os.environ.get('VAPID_PRIVATE_KEY', '')
app.config['OPENAI_API_KEY'] = os.environ.get('OPENAI_API_KEY', '')
app.config['OPENAI_STT_MODEL'] = os.environ.get('OPENAI_STT_MODEL', 'whisper-1')

db.init_app(app)
scheduler = None
# Ensure our app logger emits INFO to the console
if app.logger.level > logging.INFO or app.logger.level == logging.NOTSET:
    app.logger.setLevel(logging.INFO)

DEFAULT_SIDEBAR_ORDER = ['home', 'tasks', 'calendar', 'notes', 'recalls', 'bookmarks', 'quick-access', 'ai', 'settings']
DEFAULT_HOMEPAGE_ORDER = ['tasks', 'calendar', 'notes', 'recalls', 'bookmarks', 'quick-access', 'ai', 'settings', 'download']
CALENDAR_ITEM_NOTE_MAX_CHARS = 300
NOTE_LIST_CONVERSION_MIN_LINES = 2
NOTE_LIST_CONVERSION_MAX_LINES = 100
NOTE_LIST_CONVERSION_MAX_CHARS = 80
NOTE_LIST_CONVERSION_MAX_WORDS = 12
NOTE_LIST_CONVERSION_SENTENCE_WORD_LIMIT = 8

LINK_PATTERN = re.compile(r'\[([^\]]+)\]\((https?://[^\s)]+)\)')


def linkify_text(text):
    """Convert [label](url) in task descriptions/notes into safe links."""
    if not text:
        return ''
    parts = []
    last = 0
    for match in LINK_PATTERN.finditer(text):
        parts.append(escape(text[last:match.start()]))
        label = escape(match.group(1))
        url = match.group(2)
        parts.append(Markup(
            f'<a href="{escape(url)}" target="_blank" rel="noopener noreferrer">{label}</a>'
        ))
        last = match.end()
    parts.append(escape(text[last:]))
    return Markup(''.join(str(part) for part in parts))


app.jinja_env.filters['linkify_text'] = linkify_text


def _normalize_note_type(raw):
    if str(raw or '').lower() == 'list':
        return 'list'
    return 'note'

def _extract_note_list_lines(raw_html):
    if not raw_html:
        return None, 'Note is empty.'
    text = str(raw_html)
    text = re.sub(r'(?i)<\s*br\s*/?\s*>', '\n', text)
    text = re.sub(r'(?i)</\s*(p|div|li|h[1-6]|blockquote|pre|tr)\s*>', '\n', text)
    text = re.sub(r'(?i)</\s*(ul|ol|table)\s*>', '\n', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = html.unescape(text)
    text = text.replace('\r', '\n').replace('\xa0', ' ')
    raw_lines = [line.strip() for line in text.split('\n')]

    cleaned_lines = []
    for line in raw_lines:
        if not line:
            continue
        line = re.sub(r'^\s*\[[xX ]\]\s+', '', line)
        line = re.sub(r'^\s*(?:[-*+]|\d+[.)]|\d+\s*[-:]|[A-Za-z][.)])\s+', '', line)
        line = re.sub(r'\s+', ' ', line).strip()
        if line:
            cleaned_lines.append(line)

    if len(cleaned_lines) < NOTE_LIST_CONVERSION_MIN_LINES:
        return None, f'Need at least {NOTE_LIST_CONVERSION_MIN_LINES} non-empty lines.'
    if len(cleaned_lines) > NOTE_LIST_CONVERSION_MAX_LINES:
        return None, f'Too many lines to convert (max {NOTE_LIST_CONVERSION_MAX_LINES}).'

    for line in cleaned_lines:
        if len(line) > NOTE_LIST_CONVERSION_MAX_CHARS:
            return None, f'Lines must be {NOTE_LIST_CONVERSION_MAX_CHARS} characters or fewer.'
        words = re.findall(r"[A-Za-z0-9']+", line)
        if len(words) > NOTE_LIST_CONVERSION_MAX_WORDS:
            return None, f'Lines must be {NOTE_LIST_CONVERSION_MAX_WORDS} words or fewer.'
        sentence_marks = re.findall(r'[.!?]', line)
        if len(sentence_marks) > 1:
            return None, 'Lines must be single phrases, not multiple sentences.'
        if len(sentence_marks) == 1 and len(words) > NOTE_LIST_CONVERSION_SENTENCE_WORD_LIMIT:
            return None, f'Lines must be short phrases (max {NOTE_LIST_CONVERSION_SENTENCE_WORD_LIMIT} words if punctuated).'
    return cleaned_lines, None

def _normalize_calendar_item_note(raw):
    if raw is None:
        return None
    text = str(raw)
    if len(text) > CALENDAR_ITEM_NOTE_MAX_CHARS:
        raise ValueError('Item note exceeds character limit')
    text = text.strip()
    return text or None


def _build_list_preview_text(item):
    base = (item.text or '').strip()
    link_label = (item.link_text or '').strip()
    if base and link_label:
        if base == link_label:
            return base
        return f"{base} {link_label}".strip()
    return base or link_label

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


def _normalize_tags(raw):
    """Turn comma-delimited or list input into a clean list of tags."""
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(t).strip() for t in raw if str(t).strip()]
    return [t.strip() for t in str(raw).split(',') if t.strip()]


def _tags_to_string(tags):
    return ','.join(_normalize_tags(tags))


def _parse_reminder(dt_str):
    if not dt_str:
        return None
    try:
        return datetime.fromisoformat(dt_str)
    except Exception:
        return None


def _now_local():
    tz = pytz.timezone(app.config.get('DEFAULT_TIMEZONE', 'America/New_York'))
    return datetime.now(tz).replace(tzinfo=None)




def _sanitize_sidebar_order(order):
    """Ensure sidebar order is a valid, complete list of allowed items."""
    cleaned = [str(item).strip() for item in (order or []) if isinstance(item, str) and str(item).strip()]
    allowed = set(DEFAULT_SIDEBAR_ORDER)
    cleaned = [item for item in cleaned if item in allowed]
    seen = set()
    final_order = []
    for item in cleaned:
        if item not in seen:
            seen.add(item)
            final_order.append(item)
    for item in DEFAULT_SIDEBAR_ORDER:
        if item not in seen:
            final_order.append(item)
    return final_order


def _load_sidebar_order(user):
    """Load sidebar order from user profile, falling back to defaults."""
    if not user:
        return list(DEFAULT_SIDEBAR_ORDER)
    try:
        raw = user.sidebar_order
        if raw:
            data = json.loads(raw)
            if isinstance(data, list):
                return _sanitize_sidebar_order(data)
    except Exception as exc:
        app.logger.warning(f"Failed to load sidebar order for user {user.id}: {exc}")
    return list(DEFAULT_SIDEBAR_ORDER)


def _save_sidebar_order(user, order):
    """Persist sidebar order to the user's profile."""
    if not user:
        return
    user.sidebar_order = json.dumps(_sanitize_sidebar_order(order))


def _sanitize_homepage_order(order):
    """Ensure homepage order is a valid, complete list of allowed modules."""
    cleaned = [str(item).strip() for item in (order or []) if isinstance(item, str) and str(item).strip()]
    allowed = set(DEFAULT_HOMEPAGE_ORDER)
    cleaned = [item for item in cleaned if item in allowed]
    seen = set()
    final_order = []
    for item in cleaned:
        if item not in seen:
            seen.add(item)
            final_order.append(item)
    # Add any missing modules to maintain completeness
    for item in DEFAULT_HOMEPAGE_ORDER:
        if item not in seen:
            final_order.append(item)
    return final_order


def _load_homepage_order(user):
    """Load homepage order from user profile, falling back to defaults."""
    if not user:
        return list(DEFAULT_HOMEPAGE_ORDER)
    try:
        raw = user.homepage_order
        if raw:
            data = json.loads(raw)
            if isinstance(data, list):
                return _sanitize_homepage_order(data)
    except Exception as exc:
        app.logger.warning(f"Failed to load homepage order for user {user.id}: {exc}")
    return list(DEFAULT_HOMEPAGE_ORDER)


def _save_homepage_order(user, order):
    """Persist homepage order to the user's profile."""
    if not user:
        return
    user.homepage_order = json.dumps(_sanitize_homepage_order(order))


def _call_openai(system_prompt, payload):
    if not app.config.get('OPENAI_API_KEY'):
        return ''
    try:
        client = get_openai_client()
        model_name = os.environ.get('OPENAI_MODEL', 'gpt-4o-mini')
        resp = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": payload}
            ],
            max_tokens=120,
            temperature=0.4
        )
        return (resp.choices[0].message.content or '').strip()
    except Exception as exc:
        app.logger.warning(f"Recall metadata generation failed: {exc}")
        return ''


def try_parse_json(response):
    try:
        return json.loads(response)
    except Exception:
        pass

    match = re.search(r'\{[^{}]*\}', response or '')
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    return None


def start_recall_processing(recall_id):
    """Start background processing for a recall item."""
    from recall_processor import process_recall
    thread = threading.Thread(target=process_recall, args=(recall_id,), daemon=True)
    thread.start()


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
    """Parse 24h or am/pm strings into a time object; return None on failure."""
    if not val:
        return None
    if isinstance(val, time):
        return val
    s = str(val).strip().lower().replace(" ", "")
    # Match hh, hh:mm, or hh:mm:ss with optional am/pm; allow 1-2 digit minutes/seconds
    m = re.match(r"^(?P<hour>\d{1,2})(:(?P<minute>\d{1,2}))?(:(?P<second>\d{1,2}))?(?P<ampm>a|p|am|pm)?$", s)
    if not m:
        return None
    try:
        hour = int(m.group("hour"))
        minute = int(m.group("minute") or 0)
        ampm = m.group("ampm")
        # Ignore seconds but validate if present
        if m.group("second") is not None:
            sec_val = int(m.group("second"))
            if not (0 <= sec_val <= 59):
                return None
        if ampm:
            if ampm in ("p", "pm") and hour != 12:
                hour += 12
            if ampm in ("a", "am") and hour == 12:
                hour = 0
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            return None
        return time(hour=hour, minute=minute)
    except Exception:
        return None


def _time_to_minutes(t):
    return (t.hour * 60) + t.minute


def _event_end_minutes(start_minutes, end_time):
    if end_time:
        end_minutes = _time_to_minutes(end_time)
        if end_minutes > start_minutes:
            return end_minutes
    return min(start_minutes + 30, 24 * 60)


def _task_conflicts_with_event(user_id, day_obj, task_start, task_end, exclude_event_id=None):
    if not task_start:
        return None
    task_start_minutes = _time_to_minutes(task_start)
    task_end_minutes = _time_to_minutes(task_end) if task_end else None
    if task_end_minutes is not None and task_end_minutes < task_start_minutes:
        task_end_minutes = task_start_minutes

    events = CalendarEvent.query.filter(
        CalendarEvent.user_id == user_id,
        CalendarEvent.day == day_obj,
        CalendarEvent.is_event == True,
        CalendarEvent.start_time.isnot(None)
    ).all()

    for ev in events:
        if exclude_event_id and ev.id == exclude_event_id:
            continue
        ev_start_minutes = _time_to_minutes(ev.start_time)
        ev_end_minutes = _event_end_minutes(ev_start_minutes, ev.end_time)
        if task_end_minutes is None:
            if ev_start_minutes <= task_start_minutes < ev_end_minutes:
                return ev
        else:
            if not (task_end_minutes <= ev_start_minutes or task_start_minutes >= ev_end_minutes):
                return ev
    return None


def _next_calendar_order(day_value, user_id):
    """Return next order index for a given day/user."""
    current_max = db.session.query(db.func.max(CalendarEvent.order_index)).filter(
        CalendarEvent.user_id == user_id,
        CalendarEvent.day == day_value
    ).scalar()
    return (current_max or 0) + 1


def _parse_days_of_week(raw):
    if raw is None:
        return []
    if isinstance(raw, list):
        values = raw
    else:
        values = str(raw).split(',')
    days = []
    for val in values:
        try:
            day = int(val)
        except (TypeError, ValueError):
            continue
        if 0 <= day <= 6:
            days.append(day)
    return sorted(set(days))


def _recurrence_occurs_on(rule, day_value):
    if day_value < rule.start_day:
        return False
    if rule.end_day and day_value > rule.end_day:
        return False

    freq = (rule.frequency or '').lower()
    interval = max(int(rule.interval or 1), 1)
    unit = (rule.interval_unit or '').lower()
    days_of_week = _parse_days_of_week(rule.days_of_week)

    if freq == 'daily':
        unit = 'days'
        interval = 1
    elif freq == 'weekly':
        unit = 'weeks'
        interval = 1
    elif freq == 'biweekly':
        unit = 'weeks'
        interval = 2
    elif freq == 'monthly':
        unit = 'months'
        interval = 1
    elif freq == 'yearly':
        unit = 'years'
        interval = 1
    elif freq != 'custom':
        return False

    start_day = rule.start_day
    if unit == 'days':
        days_since = (day_value - start_day).days
        return days_since >= 0 and days_since % interval == 0
    if unit == 'weeks':
        days_since = (day_value - start_day).days
        if days_since < 0:
            return False
        weeks_since = days_since // 7
        if weeks_since % interval != 0:
            return False
        if days_of_week:
            return day_value.weekday() in days_of_week
        return day_value.weekday() == start_day.weekday()
    if unit == 'months':
        months_since = (day_value.year - start_day.year) * 12 + (day_value.month - start_day.month)
        if months_since < 0 or months_since % interval != 0:
            return False
        target_dom = rule.day_of_month or start_day.day
        return day_value.day == target_dom
    if unit == 'years':
        years_since = day_value.year - start_day.year
        if years_since < 0 or years_since % interval != 0:
            return False
        target_month = rule.month_of_year or start_day.month
        target_dom = rule.day_of_month or start_day.day
        return day_value.month == target_month and day_value.day == target_dom
    return False


def _ensure_recurring_instances(user_id, start_day, end_day):
    if not start_day or not end_day or start_day > end_day:
        return
    rules = RecurringEvent.query.filter(
        RecurringEvent.user_id == user_id,
        RecurringEvent.start_day <= end_day,
        or_(RecurringEvent.end_day.is_(None), RecurringEvent.end_day >= start_day)
    ).all()
    if not rules:
        return

    exceptions = RecurrenceException.query.filter(
        RecurrenceException.user_id == user_id,
        RecurrenceException.day >= start_day,
        RecurrenceException.day <= end_day
    ).all()
    exception_days = {(ex.recurrence_id, ex.day) for ex in exceptions}

    created_events = []
    for rule in rules:
        existing = CalendarEvent.query.filter(
            CalendarEvent.recurrence_id == rule.id,
            CalendarEvent.day >= start_day,
            CalendarEvent.day <= end_day
        ).all()
        existing_days = {ev.day for ev in existing}
        current = start_day
        while current <= end_day:
            if (rule.id, current) not in exception_days and current not in existing_days:
                if _recurrence_occurs_on(rule, current):
                    new_event = CalendarEvent(
                        user_id=user_id,
                        title=rule.title,
                        description=rule.description,
                        day=current,
                        start_time=rule.start_time,
                        end_time=rule.end_time,
                        status=rule.status or 'not_started',
                        priority=rule.priority or 'medium',
                        is_phase=False,
                        is_event=bool(rule.is_event),
                        is_group=False,
                        order_index=_next_calendar_order(current, user_id),
                        reminder_minutes_before=rule.reminder_minutes_before,
                        rollover_enabled=bool(rule.rollover_enabled),
                        recurrence_id=rule.id
                    )
                    db.session.add(new_event)
                    created_events.append(new_event)
            current += timedelta(days=1)

    if created_events:
        db.session.commit()
        for ev in created_events:
            if ev.reminder_minutes_before is not None and ev.start_time:
                _schedule_reminder_job(ev)


def _rollover_incomplete_events():
    """Clone yesterday's incomplete events with rollover enabled into today."""
    with app.app_context():
        # Acquire distributed lock to prevent concurrent execution across workers
        import os
        worker_id = os.getpid()
        lock_name = 'calendar_rollover'

        # Try to acquire lock with a database transaction
        try:
            from models import JobLock
            from sqlalchemy.exc import IntegrityError

            now = _now_local()
            if db.engine.dialect.name == 'sqlite':
                # SQLite doesn't support FOR UPDATE; use insert + fallback update for stale locks.
                try:
                    lock = JobLock(job_name=lock_name, locked_at=now, locked_by=str(worker_id))
                    db.session.add(lock)
                    db.session.commit()
                except IntegrityError:
                    db.session.rollback()
                    lock = db.session.query(JobLock).filter_by(job_name=lock_name).first()
                    if lock and now - lock.locked_at >= timedelta(minutes=5):
                        lock.locked_at = now
                        lock.locked_by = str(worker_id)
                        db.session.commit()
                    else:
                        if lock:
                            app.logger.info(f"Rollover already running (locked by {lock.locked_by}), skipping")
                        else:
                            app.logger.info("Rollover lock acquisition failed (missing lock), skipping")
                        return
            else:
                # Use SELECT FOR UPDATE to ensure only one worker acquires the lock
                lock = db.session.query(JobLock).filter_by(job_name=lock_name).with_for_update(nowait=True).first()
                if lock:
                    if now - lock.locked_at < timedelta(minutes=5):
                        app.logger.info(f"Rollover already running (locked by {lock.locked_by}), skipping")
                        db.session.rollback()
                        return
                    lock.locked_at = now
                    lock.locked_by = str(worker_id)
                else:
                    lock = JobLock(job_name=lock_name, locked_at=now, locked_by=str(worker_id))
                    db.session.add(lock)

                db.session.commit()
        except Exception as e:
            # Lock acquisition failed (another worker has it)
            db.session.rollback()
            app.logger.info(f"Rollover lock acquisition failed (worker {worker_id}), skipping: {e}")
            return

        try:
            today = date.today()
            yesterday = today - timedelta(days=1)
            app.logger.info(f"Rollover start (worker {worker_id}): {yesterday} -> {today}")

            # Build a map of phases that need to be recreated
            phases_yesterday = CalendarEvent.query.filter(
                CalendarEvent.day == yesterday,
                CalendarEvent.is_phase.is_(True)
            ).all()

            # For each user, roll their events independently
            user_ids = [u.id for u in User.query.all()]
            for uid in user_ids:
                created_events = 0
                created_phases = 0

                # Track already created rollovers so reruns stay idempotent
                existing_rollovers = CalendarEvent.query.filter(
                    CalendarEvent.user_id == uid,
                    CalendarEvent.day == today,
                    CalendarEvent.rolled_from_id.isnot(None)
                ).all()
                rolled_lookup = {}
                duplicates_to_delete = []
                for ev in existing_rollovers:
                    key = ev.rolled_from_id
                    if key in rolled_lookup:
                        keep = rolled_lookup[key]
                        # Keep the earliest created rollover, delete extras
                        if ev.id < keep.id:
                            duplicates_to_delete.append(keep)
                            rolled_lookup[key] = ev
                        else:
                            duplicates_to_delete.append(ev)
                    else:
                        rolled_lookup[key] = ev

                phase_map = {}
                # Collect phases by title to recreate only if needed
                for ph in phases_yesterday:
                    if ph.user_id == uid:
                        existing_phase_copy = rolled_lookup.get(ph.id)
                        phase_map[ph.id] = existing_phase_copy.id if existing_phase_copy and existing_phase_copy.is_phase else None

                events = CalendarEvent.query.filter(
                    CalendarEvent.user_id == uid,
                    CalendarEvent.day == yesterday,
                    CalendarEvent.status != 'done',
                    CalendarEvent.rollover_enabled.is_(True),
                    CalendarEvent.is_phase.is_(False)
                ).order_by(CalendarEvent.order_index.asc()).all()

                if not events:
                    continue

                events_to_delete = {}
                for ev in events:
                    # Skip if this event has already been rolled over today
                    if ev.id in rolled_lookup:
                        events_to_delete[ev.id] = ev
                        continue

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
                                    item_note=orig_phase.item_note,
                                    order_index=_next_calendar_order(today, uid),
                                    reminder_minutes_before=None,
                                    rollover_enabled=orig_phase.rollover_enabled,
                                    rolled_from_id=orig_phase.id
                                )
                                db.session.add(copy_phase)
                                db.session.flush()
                                phase_map[orig_phase.id] = copy_phase.id
                                created_phases += 1
                        new_phase_id = phase_map.get(ev.phase_id)

                    recurrence_id = ev.recurrence_id
                    if recurrence_id:
                        db.session.add(RecurrenceException(
                            user_id=uid,
                            recurrence_id=recurrence_id,
                            day=today
                        ))

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
                        is_event=ev.is_event,
                        is_group=ev.is_group,
                        phase_id=new_phase_id,
                        order_index=_next_calendar_order(today, uid),
                        reminder_minutes_before=ev.reminder_minutes_before,
                        rollover_enabled=ev.rollover_enabled,
                        rolled_from_id=ev.id,
                        todo_item_id=ev.todo_item_id,
                        recurrence_id=None,
                        item_note=ev.item_note
                    )
                    db.session.add(copy_event)
                    created_events += 1
                    events_to_delete[ev.id] = ev
                    if ev.todo_item_id:
                        linked_item = TodoItem.query.filter_by(id=ev.todo_item_id).first()
                        if linked_item:
                            linked_item.due_date = today

                for dup in duplicates_to_delete:
                    db.session.delete(dup)
                for ev in events_to_delete.values():
                    db.session.delete(ev)

                db.session.commit()
                if created_events or duplicates_to_delete or events_to_delete:
                    app.logger.info(
                        f"Rollover user {uid}: created {created_events} events, "
                        f"created {created_phases} phases, removed {len(duplicates_to_delete)} duplicates"
                    )
            app.logger.info(f"Rollover finished (worker {worker_id})")
        finally:
            # Release the lock
            try:
                lock_to_release = db.session.query(JobLock).filter_by(job_name=lock_name).first()
                if lock_to_release and lock_to_release.locked_by == str(worker_id):
                    db.session.delete(lock_to_release)
                    db.session.commit()
                    app.logger.info(f"Rollover lock released (worker {worker_id})")
            except Exception as e:
                app.logger.error(f"Error releasing rollover lock: {e}")
                db.session.rollback()


def _cleanup_completed_tasks():
    """Delete done tasks that have been completed for 5+ days."""
    with app.app_context():
        try:
            cutoff = datetime.now(pytz.UTC).replace(tzinfo=None) - timedelta(days=5)
            items = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
                TodoItem.status == 'done',
                TodoItem.completed_at.isnot(None),
                TodoItem.completed_at <= cutoff,
                TodoItem.is_phase.is_(False),
                TodoItem.linked_list_id.is_(None)
            ).all()
            if not items:
                return
            for item in items:
                db.session.delete(item)
            db.session.commit()
            app.logger.info(f"Auto-deleted {len(items)} completed tasks older than 5 days")
        except Exception as e:
            app.logger.error(f"Error cleaning completed tasks: {e}")
            db.session.rollback()


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


def _build_daily_digest_body(events_for_day, tasks_due):
    lines = []
    if events_for_day:
        lines.append("Calendar items:")
        for ev in events_for_day:
            prefix = '[x]' if ev.status == 'done' else '[ ]'
            time_block = ''
            if ev.start_time:
                end_str = ev.end_time.isoformat() if ev.end_time else ''
                time_block = f" @ {ev.start_time.isoformat()}{('-' + end_str) if end_str else ''}"
            priority = ev.priority or 'medium'
            lines.append(f"{prefix} {ev.title} ({priority}){time_block}")
    if tasks_due:
        if lines:
            lines.append("")
        lines.append("Due tasks:")
        for item in tasks_due:
            prefix = '[x]' if item.status == 'done' else '[ ]'
            lines.append(f"{prefix} {item.content} (list: {item.list.title if item.list else ''})")
    return '\n'.join(lines)


def _send_daily_email_digest(target_day=None):
    """Send daily digest emails to users who have an email set."""
    if os.environ.get('ENABLE_CALENDAR_EMAIL_DIGEST', '1') != '1':
        return
    with app.app_context():
        tz = pytz.timezone(app.config.get('DEFAULT_TIMEZONE', 'UTC'))
        now_local = datetime.now(tz)
        is_manual = target_day is not None
        if target_day is None:
            target_day = now_local.date()
        users = User.query.all()
        fallback_email = os.environ.get('CONTACT_TO_EMAIL')
        for user_obj in users:
            prefs = _get_or_create_notification_settings(user_obj.id)
            if not prefs.email_enabled or not prefs.digest_enabled:
                continue
            if not is_manual and prefs.digest_hour != now_local.hour:
                continue
            events = CalendarEvent.query.filter(
                CalendarEvent.user_id == user_obj.id,
                CalendarEvent.day == target_day,
                CalendarEvent.is_group.is_(False),
                CalendarEvent.is_phase.is_(False)
            ).order_by(CalendarEvent.order_index.asc()).all()
            tasks_due = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
                TodoList.user_id == user_obj.id,
                TodoItem.due_date == target_day,
                TodoItem.is_phase == False
            ).all()
            if not events and not tasks_due:
                continue
            body = _build_daily_digest_body(events, tasks_due)
            try:
                recipient = user_obj.email or fallback_email
                if recipient:
                    _send_email(recipient, f"Your tasks for {target_day.isoformat()}", body)
            except Exception:
                continue


def _schedule_reminder_job(event):
    """Schedule a one-time reminder job for a calendar event."""
    global scheduler
    if not scheduler or not event.start_time or event.reminder_minutes_before is None:
        return

    # Cancel existing job if present
    if event.reminder_job_id:
        try:
            scheduler.remove_job(event.reminder_job_id)
        except Exception:
            pass

    # Calculate reminder time
    try:
        event_datetime = datetime.combine(event.day, event.start_time)
        event_datetime = pytz.timezone(app.config['DEFAULT_TIMEZONE']).localize(event_datetime)
        reminder_time = event_datetime - timedelta(minutes=event.reminder_minutes_before)

        # Only schedule if reminder is in the future
        now = datetime.now(pytz.timezone(app.config['DEFAULT_TIMEZONE']))
        if reminder_time > now:
            job_id = f"reminder_{event.id}_{int(reminder_time.timestamp())}"
            scheduler.add_job(
                _send_event_reminder,
                'date',
                run_date=reminder_time,
                args=[event.id],
                id=job_id,
                replace_existing=True
            )
            event.reminder_job_id = job_id
            event.reminder_sent = False
            event.reminder_snoozed_until = None
            db.session.commit()
            app.logger.info(f"Scheduled reminder job {job_id} for event {event.id} at {reminder_time}")
    except Exception as e:
        app.logger.error(f"Error scheduling reminder for event {event.id}: {e}")


def _cancel_reminder_job(event):
    """Cancel a scheduled reminder job for a calendar event."""
    global scheduler
    if not scheduler or not event.reminder_job_id:
        return

    try:
        scheduler.remove_job(event.reminder_job_id)
        app.logger.info(f"Cancelled reminder job {event.reminder_job_id} for event {event.id}")
    except Exception as e:
        app.logger.debug(f"Could not cancel job {event.reminder_job_id}: {e}")

    event.reminder_job_id = None
    db.session.commit()


def _send_event_reminder(event_id):
    """Send a reminder notification for a specific calendar event."""
    with app.app_context():
        try:
            event = CalendarEvent.query.get(event_id)
            if not event:
                return

            # Check if already sent or snoozed
            if event.reminder_sent:
                return

            # Check if snoozed
            if event.reminder_snoozed_until:
                tz = pytz.timezone(app.config['DEFAULT_TIMEZONE'])
                now = datetime.now(tz).replace(tzinfo=None)
                if now < event.reminder_snoozed_until:
                    # Still snoozed, reschedule for snooze time
                    global scheduler
                    if scheduler:
                        job_id = f"reminder_{event.id}_{int(event.reminder_snoozed_until.timestamp())}"
                        scheduler.add_job(
                            _send_event_reminder,
                            'date',
                            run_date=pytz.timezone(app.config['DEFAULT_TIMEZONE']).localize(event.reminder_snoozed_until),
                            args=[event_id],
                            id=job_id,
                            replace_existing=True
                        )
                        event.reminder_job_id = job_id
                        db.session.commit()
                    return

            # Get user
            user = User.query.get(event.user_id)
            if not user:
                return

            # Check user preferences
            prefs = _get_or_create_notification_settings(user.id)
            if not prefs.push_enabled or not prefs.reminders_enabled:
                return

            # Send push notification with action buttons
            title = f"Reminder: {event.title}"
            body = f"Starting at {event.start_time.strftime('%I:%M %p')}" if event.start_time else ""
            day_str = event.day.isoformat()
            link = f'/calendar?day={day_str}'

            actions = [
                {'action': 'snooze', 'title': 'Snooze'},
                {'action': 'dismiss', 'title': 'Dismiss'}
            ]

            _send_push_to_user(user, title, body, link=link, event_id=event.id, actions=actions)

            # Mark as sent
            event.reminder_sent = True
            event.reminder_job_id = None
            db.session.commit()

        except Exception as e:
            app.logger.error(f"Error sending reminder for event {event_id}: {e}")


def _check_calendar_reminders():
    """Legacy minute-polling function - now replaced by server-scheduled jobs."""
    # This function is kept for backward compatibility but is no longer used
    # when server-scheduled reminders are enabled
    with app.app_context():
        try:
            now = datetime.now(pytz.UTC).replace(tzinfo=None)
            # Check for events in the next 5 minutes
            upcoming_window = now + timedelta(minutes=5)

            # Get all users
            users = User.query.all()

            for user in users:
                # Get user's notification preferences
                prefs = _get_or_create_notification_settings(user.id)
                if not prefs.push_enabled or not prefs.reminders_enabled:
                    continue

                # Get user's calendar events for today and tomorrow
                today = datetime.now(pytz.timezone(app.config['DEFAULT_TIMEZONE'])).date()
                tomorrow = today + timedelta(days=1)

                for day in [today, tomorrow]:
                    day_str = day.strftime('%Y-%m-%d')
                    events = CalendarEvent.query.filter_by(user_id=user.id, day=day_str, status='pending').all()

                    for event in events:
                        if not event.start_time or event.reminder_minutes_before is None:
                            continue

                        # Parse event time
                        try:
                            event_datetime = datetime.strptime(f"{day_str} {event.start_time}", '%Y-%m-%d %H:%M')
                            event_datetime = pytz.timezone(app.config['DEFAULT_TIMEZONE']).localize(event_datetime)
                            event_utc = event_datetime.astimezone(pytz.UTC).replace(tzinfo=None)

                            # Calculate reminder time
                            reminder_time = event_utc - timedelta(minutes=event.reminder_minutes_before)

                            # Check if reminder should fire now (within next 5 minutes and hasn't been sent)
                            if now <= reminder_time <= upcoming_window:
                                # Check if we already sent this reminder
                                existing_notif = Notification.query.filter_by(
                                    user_id=user.id,
                                    type='reminder',
                                    link=f'/calendar?day={day_str}'
                                ).filter(
                                    Notification.created_at >= now - timedelta(minutes=event.reminder_minutes_before + 1)
                                ).first()

                                if not existing_notif:
                                    # Send push notification
                                    title = f"Reminder: {event.title}"
                                    body = f"Starting at {event.start_time}"
                                    _send_push_to_user(user, title, body, link=f'/calendar?day={day_str}')

                                    # Create in-app notification
                                    notif = Notification(
                                        user_id=user.id,
                                        type='reminder',
                                        title=title,
                                        body=body,
                                        link=f'/calendar?day={day_str}',
                                        channel='push'
                                    )
                                    db.session.add(notif)
                                    db.session.commit()

                        except Exception as e:
                            app.logger.error(f"Error processing reminder for event {event.id}: {e}")
                            continue

        except Exception as e:
            app.logger.error(f"Error in _check_calendar_reminders: {e}")


def _schedule_existing_reminders():
    """Schedule reminder jobs for all existing events with reminders on startup."""
    with app.app_context():
        try:
            now = datetime.now(pytz.timezone(app.config['DEFAULT_TIMEZONE']))
            # Get events with reminders that haven't been sent yet
            events = CalendarEvent.query.filter(
                CalendarEvent.reminder_minutes_before.isnot(None),
                CalendarEvent.start_time.isnot(None),
                CalendarEvent.reminder_sent == False,
                CalendarEvent.day >= now.date()
            ).all()

            scheduled_count = 0
            for event in events:
                try:
                    _schedule_reminder_job(event)
                    scheduled_count += 1
                except Exception as e:
                    app.logger.error(f"Error scheduling reminder for event {event.id}: {e}")

            app.logger.info(f"Scheduled {scheduled_count} existing reminder jobs on startup")
        except Exception as e:
            app.logger.error(f"Error in _schedule_existing_reminders: {e}")


_jobs_bootstrapped = False


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
    scheduler = BackgroundScheduler(timezone=app.config.get('DEFAULT_TIMEZONE', 'UTC'))
    scheduler.add_job(_rollover_incomplete_events, 'cron', hour=0, minute=10)
    scheduler.add_job(
        _cleanup_completed_tasks,
        'cron',
        hour=0,
        minute=20,
        id='cleanup_completed_tasks',
        replace_existing=True
    )
    # Daily digest runs hourly; per-user digest_hour gates delivery.
    scheduler.add_job(
        _send_daily_email_digest,
        'cron',
        hour='*',
        minute=0,
        id='daily_email_digest',
        replace_existing=True
    )
    # Note: Calendar reminders now use server-scheduled jobs (scheduled per-event)
    # Legacy minute-polling has been replaced with precise scheduling
    scheduler.start()

    # Catch up rollover if the server started after the scheduled time
    try:
        _rollover_incomplete_events()
    except Exception as e:
        app.logger.error(f"Error running rollover catch-up: {e}")
    try:
        _cleanup_completed_tasks()
    except Exception as e:
        app.logger.error(f"Error running completed task cleanup: {e}")

    # Schedule existing reminders on startup
    _schedule_existing_reminders()

@app.before_request
def _bootstrap_background_jobs():
    global _jobs_bootstrapped
    if _jobs_bootstrapped and scheduler and scheduler.running:
        return
    _start_scheduler()
    _jobs_bootstrapped = True


# Start scheduler on process startup (not request-dependent).
try:
    _start_scheduler()
    _jobs_bootstrapped = bool(scheduler and scheduler.running)
except Exception as e:
    app.logger.error(f"Error starting scheduler on startup: {e}")

# User Selection Routes
@app.route('/select-user')
def select_user():
    """Show user selection page"""
    users = User.query.all()
    return render_template('select_user.html', users=users)

@app.route('/logout')
def logout_user():
    """Clear the current user session and return to the user selector."""
    session.pop('user_id', None)
    return redirect(url_for('select_user'))

@app.route('/api/set-user/<int:user_id>', methods=['POST'])
def set_user(user_id):
    """Set the current user in session after validating PIN (or set it for legacy users)."""
    data = request.get_json(silent=True) or {}
    pin = str(data.get('pin', '')).strip()

    if not re.fullmatch(r'\d{4}', pin):
        return jsonify({'error': 'A 4-digit PIN is required'}), 400

    user = db.get_or_404(User, user_id)
    pin_created = False
    # Treat anything missing/placeholder/empty as "no PIN set"
    pin_hash_val = str(user.pin_hash or '').strip()
    has_pin = bool(pin_hash_val and pin_hash_val.lower() not in ['none', 'null'])

    if not has_pin:
        # First-time PIN setup for legacy users without a valid PIN
        try:
            user.set_pin(pin)
            db.session.commit()
            pin_created = True
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
    else:
        if not user.check_pin(pin):
            return jsonify({'error': 'Invalid PIN'}), 401

    session['user_id'] = user.id
    session.permanent = True  # Make session persistent across browser restarts
    return jsonify({'success': True, 'username': user.username, 'user_id': user.id, 'pin_created': pin_created})

@app.route('/api/create-user', methods=['POST'])
def create_user():
    """Create a new user (simplified - no password)"""
    data = request.get_json(silent=True) or {}
    username = data.get('username', '').strip()
    pin = str(data.get('pin', '')).strip()

    if not username:
        return jsonify({'error': 'Username is required'}), 400

    if not re.fullmatch(r'\d{4}', pin):
        return jsonify({'error': 'PIN must be exactly 4 digits'}), 400

    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already exists'}), 400

    # Create user with a dummy password (not used anymore)
    user = User(username=username, email=None)
    user.set_password('dummy')
    try:
        user.set_pin(pin)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
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


@app.route('/api/user/profile', methods=['GET', 'PUT'])
def user_profile():
    """Get or update the current user's profile."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    if request.method == 'GET':
        return jsonify({'user_id': user.id, 'username': user.username})

    data = request.json or {}
    current_pin = str(data.get('current_pin') or '').strip()
    if not current_pin:
        return jsonify({'error': 'Current PIN is required'}), 400
    if not user.check_pin(current_pin):
        return jsonify({'error': 'Invalid PIN'}), 403

    new_username = (data.get('username') or '').strip()
    new_pin = (data.get('new_pin') or '').strip()
    confirm_pin = (data.get('confirm_pin') or '').strip()

    if new_username and new_username != user.username:
        if User.query.filter(User.username == new_username, User.id != user.id).first():
            return jsonify({'error': 'Username already exists'}), 400
        user.username = new_username

    if new_pin or confirm_pin:
        if new_pin != confirm_pin:
            return jsonify({'error': 'PINs do not match'}), 400
        try:
            user.set_pin(new_pin)
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

    db.session.commit()
    return jsonify({'success': True, 'username': user.username})

@app.route('/api/sidebar-order', methods=['GET', 'POST'])
def sidebar_order():
    """Get or update the sidebar order stored per user."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    if request.method == 'GET':
        order = _load_sidebar_order(user)
        return jsonify({'order': order})

    data = request.get_json(silent=True)
    order = data if isinstance(data, list) else (data or {}).get('order')
    if not isinstance(order, list):
        return jsonify({'error': 'Order must be a list'}), 400

    final_order = _sanitize_sidebar_order(order)
    _save_sidebar_order(user, final_order)
    db.session.commit()
    return jsonify({'success': True, 'order': final_order})

@app.route('/api/homepage-order', methods=['GET', 'POST'])
def homepage_order():
    """Get or update the homepage module order stored per user."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    if request.method == 'GET':
        order = _load_homepage_order(user)
        return jsonify({'order': order})

    data = request.get_json(silent=True)
    order = data if isinstance(data, list) else (data or {}).get('order')
    if not isinstance(order, list):
        return jsonify({'error': 'Order must be a list'}), 400

    final_order = _sanitize_homepage_order(order)
    _save_homepage_order(user, final_order)
    db.session.commit()
    return jsonify({'success': True, 'order': final_order})

@app.route('/')
def index():
    # If no user selected, redirect to user selection
    if not get_current_user():
        return redirect(url_for('select_user'))

    user = get_current_user()
    module_order = _load_homepage_order(user)
    return render_template('home.html', module_order=module_order)


@app.route('/tasks')
def tasks_page():
    """Main tasks/hubs dashboard."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('index.html')


@app.route('/download/app')
def download_app():
    """Serve the Android APK for download."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    downloads_dir = os.path.join(app.root_path, 'downloads')
    apk_candidates = [
        filename for filename in os.listdir(downloads_dir)
        if filename.lower().endswith('.apk')
        and os.path.isfile(os.path.join(downloads_dir, filename))
    ]
    if not apk_candidates:
        return "APK not found. Please build and upload the app first.", 404
    # Pick the newest APK by modification time.
    apk_filename = max(
        apk_candidates,
        key=lambda filename: os.path.getmtime(os.path.join(downloads_dir, filename))
    )
    apk_path = os.path.join(downloads_dir, apk_filename)

    if os.path.exists(apk_path):
        return send_from_directory(downloads_dir, apk_filename,
                                   as_attachment=True,
                                   download_name=apk_filename,
                                   mimetype='application/vnd.android.package-archive')
    else:
        return "APK not found. Please build and upload the app first.", 404


@app.route('/notes')
def notes_page():
    """Dedicated notes workspace with list-only view."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    note_id = request.args.get('note') or request.args.get('note_id')
    if note_id and str(note_id).isdigit():
        return redirect(url_for('note_editor_page', note_id=int(note_id)))
    return render_template('notes.html', current_folder=None)


@app.route('/notes/new')
def new_note_page():
    """New note editor page."""
    user = get_current_user()
    if not user:
        return redirect(url_for('select_user'))
    return render_template('note_editor.html', note_id=None, body_class='notes-editor-page')


@app.route('/notes/<int:note_id>')
def note_editor_page(note_id):
    """Editor page for a single note/list."""
    user = get_current_user()
    if not user:
        return redirect(url_for('select_user'))
    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()
    if note.note_type == 'list':
        return render_template('list_editor.html', note_id=note_id)
    return render_template('note_editor.html', note_id=note_id, body_class='notes-editor-page')


@app.route('/notes/folder/<int:folder_id>')
def notes_folder_page(folder_id):
    """Notes list scoped to a folder."""
    user = get_current_user()
    if not user:
        return redirect(url_for('select_user'))
    folder = NoteFolder.query.filter_by(id=folder_id, user_id=user.id).first_or_404()
    return render_template('notes.html', current_folder=folder)


@app.route('/recalls')
def recalls_page():
    """Recall inbox/workspace for links, ideas, and sources."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('recalls.html')


@app.route('/ai')
def ai_page():
    """AI assistant full page."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('ai.html')


@app.route('/api/ai/stt', methods=['POST'])
def transcribe_audio():
    """Transcribe audio to text using OpenAI Whisper API."""
    if not get_current_user():
        return jsonify({'error': 'Unauthorized'}), 401

    file = request.files.get('audio')
    if not file:
        return jsonify({'error': 'Missing audio file'}), 400

    # Pull key from config or environment (fallback reload .env if needed)
    api_key = app.config.get('OPENAI_API_KEY') or os.environ.get('OPENAI_API_KEY')
    if not api_key:
        if DOTENV_PATH and os.path.exists(DOTENV_PATH):
            load_dotenv(DOTENV_PATH)
        api_key = os.environ.get('OPENAI_API_KEY')
    model = app.config.get('OPENAI_STT_MODEL', 'whisper-1')
    if not api_key:
        return jsonify({'error': 'Speech-to-text API key not configured'}), 500

    try:
        files = {
            'file': (file.filename or 'audio.webm', file.stream, file.mimetype or 'audio/webm')
        }
        data = {
            'model': model,
            'response_format': 'json',
            'temperature': 0
        }
        headers = {
            'Authorization': f'Bearer {api_key}'
        }
        resp = requests.post(
            'https://api.openai.com/v1/audio/transcriptions',
            headers=headers,
            data=data,
            files=files,
            timeout=60
        )
        if resp.status_code != 200:
            return jsonify({'error': 'STT request failed', 'details': resp.text}), 502
        text = resp.json().get('text', '')
        return jsonify({'text': text})
    except requests.RequestException as e:
        return jsonify({'error': 'STT service unreachable', 'details': str(e)}), 502
    except Exception as e:
        return jsonify({'error': 'STT failed', 'details': str(e)}), 500


@app.route('/settings')
def settings_page():
    """Settings page (notification preferences placeholder)."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('settings.html')


@app.route('/service-worker.js')
def service_worker():
    """Serve service worker at root scope."""
    return send_from_directory('static', 'service-worker.js', mimetype='application/javascript')

@app.route('/calendar')
def calendar_page():
    """Calendar day-first UI."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template(
        'calendar.html',
        default_timezone=app.config.get('DEFAULT_TIMEZONE'),
        item_note_max_chars=CALENDAR_ITEM_NOTE_MAX_CHARS
    )

@app.route('/quick-access')
def quick_access_page():
    """Quick access shortcuts page."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('quick_access.html')


@app.route('/bookmarks')
def bookmarks_page():
    """Bookmarks module page."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('bookmarks.html')

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

    # Backfill phase_id if not set, but preserve order_index for display
    current_phase = None
    for item in todo_list.items:
        if is_phase_header(item):
            current_phase = item
        else:
            # Backfill phase_id if not set
            if current_phase and not item.phase_id:
                item.phase_id = current_phase.id

    # Commit any backfilled phase_id values
    db.session.commit()

    # Use items in their order_index order (no re-sorting by completion status)
    return render_template('list_view.html', todo_list=todo_list, parent_list=parent_list, items=todo_list.items, default_timezone=app.config.get('DEFAULT_TIMEZONE'))

# API Routes
@app.route('/api/lists', methods=['GET', 'POST'])
def handle_lists():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    if request.method == 'POST':
        data = request.json
        list_type = data.get('type', 'list')
        order_query = db.session.query(db.func.coalesce(db.func.max(TodoList.order_index), 0)).filter(
            TodoList.user_id == user.id,
            TodoList.type == list_type
        ).outerjoin(TodoItem, TodoList.id == TodoItem.linked_list_id).filter(TodoItem.id == None)
        next_order = (order_query.scalar() or 0) + 1
        new_list = TodoList(title=data['title'], type=list_type, user_id=user.id, order_index=next_order)
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
    lists = query.order_by(TodoList.order_index.asc(), TodoList.id.asc()).all()
    return jsonify([l.to_dict() for l in lists])


@app.route('/api/lists/reorder', methods=['POST'])
def reorder_lists():
    """Reorder top-level lists by explicit id list."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    data = request.json or {}
    ids = data.get('ids')
    list_type = data.get('type')
    if not isinstance(ids, list) or not ids:
        return jsonify({'error': 'ids array required'}), 400

    query = TodoList.query.filter(TodoList.user_id == user.id, TodoList.id.in_(ids))
    if list_type in ['hub', 'list']:
        query = query.filter(TodoList.type == list_type)
    lists = query.all()
    list_map = {l.id: l for l in lists}
    order_val = 1
    for raw_id in ids:
        try:
            lid = int(raw_id)
        except (ValueError, TypeError):
            continue
        item = list_map.get(lid)
        if item:
            item.order_index = order_val
            order_val += 1
    db.session.commit()
    return jsonify({'updated': order_val - 1})


@app.route('/api/notes', methods=['GET', 'POST'])
def handle_notes():
    """List or create notes/lists for the current user."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    folder_id = request.args.get('folder_id')
    folder_id_int = int(folder_id) if folder_id and str(folder_id).isdigit() else None
    include_all = str(request.args.get('all') or '').lower() in ['1', 'true', 'yes', 'on']

    if request.method == 'POST':
        data = request.json or {}
        raw_title = (data.get('title') or '').strip()
        content = data.get('content') or ''
        note_type = _normalize_note_type(data.get('note_type') or data.get('type'))
        title = raw_title or ('Untitled List' if note_type == 'list' else 'Untitled Note')
        checkbox_mode = str(data.get('checkbox_mode') or '').lower() in ['1', 'true', 'yes', 'on']
        todo_item_id = data.get('todo_item_id')
        calendar_event_id = data.get('calendar_event_id')
        folder_id_value = data.get('folder_id')
        folder_id_value = int(folder_id_value) if folder_id_value and str(folder_id_value).isdigit() else None
        if folder_id_value is not None:
            NoteFolder.query.filter_by(id=folder_id_value, user_id=user.id).first_or_404()
        if todo_item_id and calendar_event_id:
            return jsonify({'error': 'Provide either todo_item_id or calendar_event_id, not both'}), 400
        linked_item = None
        linked_event = None
        if todo_item_id:
            try:
                todo_item_id_int = int(todo_item_id)
            except (TypeError, ValueError):
                return jsonify({'error': 'Invalid todo_item_id'}), 400
            linked_item = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
                TodoItem.id == todo_item_id_int,
                TodoList.user_id == user.id
            ).first()
            if not linked_item:
                return jsonify({'error': 'Task not found for this user'}), 404

        if calendar_event_id:
            try:
                calendar_event_id_int = int(calendar_event_id)
            except (TypeError, ValueError):
                return jsonify({'error': 'Invalid calendar_event_id'}), 400
            linked_event = CalendarEvent.query.filter_by(id=calendar_event_id_int, user_id=user.id).first()
            if not linked_event:
                return jsonify({'error': 'Calendar event not found for this user'}), 404

        note = Note(
            title=title,
            content=content if note_type == 'note' else '',
            user_id=user.id,
            todo_item_id=linked_item.id if linked_item else None,
            calendar_event_id=linked_event.id if linked_event else None,
            folder_id=folder_id_value,
            note_type=note_type,
            checkbox_mode=checkbox_mode if note_type == 'list' else False
        )
        db.session.add(note)
        db.session.commit()
        return jsonify(note.to_dict()), 201

    notes_query = Note.query.filter_by(user_id=user.id)
    if not include_all:
        if folder_id_int is None:
            notes_query = notes_query.filter(Note.folder_id.is_(None))
        else:
            notes_query = notes_query.filter_by(folder_id=folder_id_int)
    notes = notes_query.order_by(
        Note.pinned.desc(),
        Note.pin_order.asc(),
        Note.updated_at.desc()
    ).all()
    note_payload = []
    for n in notes:
        note_dict = n.to_dict()
        # Hide content from protected notes (always locked in list view)
        if n.is_pin_protected:
            note_dict['content'] = ''
            note_dict['locked'] = True
        note_payload.append(note_dict)
    list_ids = [n.id for n in notes if n.note_type == 'list' and not n.is_pin_protected]
    if list_ids:
        items = NoteListItem.query.filter(NoteListItem.note_id.in_(list_ids)).order_by(
            NoteListItem.note_id.asc(),
            NoteListItem.order_index.asc(),
            NoteListItem.id.asc()
        ).all()
        preview_map = {lid: [] for lid in list_ids}
        for item in items:
            previews = preview_map.get(item.note_id)
            if previews is None or len(previews) >= 3:
                continue
            label = _build_list_preview_text(item)
            if label:
                previews.append(label)
        for payload in note_payload:
            if payload.get('note_type') == 'list':
                # Don't show list preview for locked protected notes
                if payload.get('locked'):
                    payload['list_preview'] = []
                else:
                    payload['list_preview'] = preview_map.get(payload['id'], [])
    return jsonify(note_payload)


@app.route('/api/notes/reorder', methods=['POST'])
def reorder_notes():
    """Reorder pinned notes by explicit id list (pinned only)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    data = request.json or {}
    ids = data.get('ids')
    if not isinstance(ids, list) or not ids:
        return jsonify({'error': 'ids array required'}), 400

    pinned_notes = Note.query.filter(
        Note.user_id == user.id,
        Note.pinned.is_(True),
        Note.id.in_(ids)
    ).all()
    pinned_map = {n.id: n for n in pinned_notes}
    order_val = 1
    for raw_id in ids:
        try:
            nid = int(raw_id)
        except (ValueError, TypeError):
            continue
        note = pinned_map.get(nid)
        if note:
            note.pin_order = order_val
            order_val += 1
    db.session.commit()
    return jsonify({'pinned': order_val - 1})


@app.route('/api/note-folders', methods=['GET', 'POST'])
def note_folders():
    """List or create note folders for the current user."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    if request.method == 'POST':
        data = request.json or {}
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({'error': 'Folder name required'}), 400
        parent_id = data.get('parent_id')
        parent_id_int = int(parent_id) if parent_id and str(parent_id).isdigit() else None
        if parent_id_int is not None:
            NoteFolder.query.filter_by(id=parent_id_int, user_id=user.id).first_or_404()
        max_order = db.session.query(db.func.coalesce(db.func.max(NoteFolder.order_index), 0)).filter(
            NoteFolder.user_id == user.id,
            NoteFolder.parent_id == parent_id_int
        ).scalar()
        folder = NoteFolder(
            user_id=user.id,
            parent_id=parent_id_int,
            name=name,
            order_index=(max_order or 0) + 1
        )
        db.session.add(folder)
        db.session.commit()
        return jsonify(folder.to_dict()), 201

    folders = NoteFolder.query.filter_by(user_id=user.id).order_by(
        NoteFolder.parent_id.asc(),
        NoteFolder.order_index.asc(),
        NoteFolder.name.asc()
    ).all()
    return jsonify([f.to_dict() for f in folders])


@app.route('/api/note-folders/<int:folder_id>', methods=['GET', 'PUT', 'DELETE'])
def note_folder_detail(folder_id):
    """Get, update, or delete a note folder."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    folder = NoteFolder.query.filter_by(id=folder_id, user_id=user.id).first_or_404()

    if request.method == 'GET':
        return jsonify(folder.to_dict())

    # Block DELETE on protected folders - require PIN
    if request.method == 'DELETE':
        if folder.is_pin_protected:
            data = request.json or {}
            pin = str(data.get('pin', '')).strip()
            if not pin or not user.check_pin(pin):
                return jsonify({'error': 'Folder is protected. Please enter PIN.'}), 403
        parent_id = folder.parent_id
        NoteFolder.query.filter_by(user_id=user.id, parent_id=folder.id).update(
            {'parent_id': parent_id}
        )
        Note.query.filter_by(user_id=user.id, folder_id=folder.id).update(
            {'folder_id': parent_id}
        )
        db.session.delete(folder)
        db.session.commit()
        return jsonify({'deleted': True})

    data = request.json or {}
    # For protected folders, require PIN for any modification
    if folder.is_pin_protected:
        pin = str(data.get('pin', '')).strip()
        if not pin or not user.check_pin(pin):
            return jsonify({'error': 'Folder is protected. Please enter PIN.'}), 403
    if 'name' in data:
        name_val = (data.get('name') or '').strip()
        if name_val:
            folder.name = name_val
    if 'parent_id' in data:
        parent_id = data.get('parent_id')
        parent_id_int = int(parent_id) if parent_id and str(parent_id).isdigit() else None
        if parent_id_int is not None:
            parent = NoteFolder.query.filter_by(id=parent_id_int, user_id=user.id).first()
            if not parent:
                return jsonify({'error': 'Parent folder not found'}), 404
        folder.parent_id = parent_id_int
    # Handle PIN protection toggle
    if 'is_pin_protected' in data:
        is_protected = str(data.get('is_pin_protected')).lower() in ['1', 'true', 'yes', 'on']
        if is_protected and not user.pin_hash:
            return jsonify({'error': 'Set a PIN first before protecting folders'}), 400
        folder.is_pin_protected = is_protected
    folder.updated_at = _now_local()
    db.session.commit()
    return jsonify(folder.to_dict())


@app.route('/api/notes/move', methods=['POST'])
def move_notes():
    """Move one or more notes into a folder (or to root)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    data = request.json or {}
    ids = data.get('ids')
    folder_id = data.get('folder_id')
    if not isinstance(ids, list) or not ids:
        return jsonify({'error': 'ids array required'}), 400
    folder_id_int = int(folder_id) if folder_id and str(folder_id).isdigit() else None
    if folder_id_int is not None:
        NoteFolder.query.filter_by(id=folder_id_int, user_id=user.id).first_or_404()

    notes = Note.query.filter(Note.user_id == user.id, Note.id.in_(ids)).all()
    note_map = {n.id: n for n in notes}
    updated = 0
    for raw_id in ids:
        try:
            nid = int(raw_id)
        except (TypeError, ValueError):
            continue
        note = note_map.get(nid)
        if note:
            note.folder_id = folder_id_int
            updated += 1
    db.session.commit()
    return jsonify({'updated': updated, 'folder_id': folder_id_int})


@app.route('/api/recalls', methods=['GET', 'POST'])
def handle_recalls():
    """List or create recall items."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    if request.method == 'POST':
        data = request.json or request.form or {}
        title = (data.get('title') or '').strip()
        payload_type = (data.get('payload_type') or '').strip().lower()
        payload = (data.get('payload') or '').strip()
        when_context = (data.get('when_context') or '').strip()

        if not title or not payload or not when_context:
            return jsonify({'error': 'title, payload, and when_context are required'}), 400
        if payload_type not in ['url', 'text']:
            return jsonify({'error': 'payload_type must be url or text'}), 400

        recall = RecallItem(
            user_id=user.id,
            title=title,
            payload_type=payload_type,
            payload=payload,
            when_context=when_context,
            why='',  # Default empty, AI will populate
            ai_status='pending'
        )
        db.session.add(recall)
        db.session.commit()

        # Start background AI processing
        start_recall_processing(recall.id)

        return jsonify(recall.to_dict()), 201

    recalls = RecallItem.query.filter_by(user_id=user.id).order_by(
        RecallItem.updated_at.desc(),
        RecallItem.created_at.desc()
    ).all()
    return jsonify([r.to_dict() for r in recalls])


@app.route('/api/recalls/<int:recall_id>', methods=['GET', 'PUT', 'DELETE'])
def recall_detail(recall_id):
    """Get, update, or delete a single recall item."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    recall = RecallItem.query.filter_by(id=recall_id, user_id=user.id).first()
    if not recall:
        return jsonify({'error': 'Recall not found'}), 404

    if request.method == 'GET':
        return jsonify(recall.to_dict())

    if request.method == 'DELETE':
        db.session.delete(recall)
        db.session.commit()
        return jsonify({'deleted': True})

    data = request.json or request.form or {}
    if 'title' in data:
        title_val = (data.get('title') or '').strip()
        if title_val:
            recall.title = title_val
    if 'why' in data:
        why_val = (data.get('why') or '').strip()
        recall.why = why_val if why_val else recall.why
    if 'summary' in data:
        summary_val = (data.get('summary') or '').strip()
        recall.summary = summary_val if summary_val else recall.summary
    if 'payload_type' in data:
        payload_type = (data.get('payload_type') or '').strip().lower()
        if payload_type in ['url', 'text']:
            recall.payload_type = payload_type
    if 'payload' in data:
        payload_val = (data.get('payload') or '').strip()
        if payload_val:
            recall.payload = payload_val
    if 'when_context' in data:
        when_val = (data.get('when_context') or '').strip()
        if when_val:
            recall.when_context = when_val

    recall.updated_at = _now_local()
    db.session.commit()
    return jsonify(recall.to_dict())


@app.route('/api/recalls/<int:recall_id>/regenerate', methods=['POST'])
def regenerate_recall(recall_id):
    """Re-trigger AI processing for a recall item."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    recall = RecallItem.query.filter_by(id=recall_id, user_id=user.id).first()
    if not recall:
        return jsonify({'error': 'Recall not found'}), 404

    recall.ai_status = 'pending'
    recall.why = None
    recall.summary = None
    db.session.commit()

    start_recall_processing(recall.id)
    return jsonify(recall.to_dict())


@app.route('/api/notes/<int:note_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_note(note_id):
    """CRUD operations for a single note/list."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()

    # Block DELETE on protected notes - require PIN
    if request.method == 'DELETE':
        if note.is_pin_protected:
            data = request.json or {}
            pin = str(data.get('pin', '')).strip()
            if not pin or not user.check_pin(pin):
                return jsonify({'error': 'Note is protected. Please enter PIN.'}), 403
        db.session.delete(note)
        db.session.commit()
        return '', 204

    if request.method == 'PUT':
        data = request.json or {}
        # For protected notes, require PIN for any modification
        if note.is_pin_protected:
            pin = str(data.get('pin', '')).strip()
            if not pin or not user.check_pin(pin):
                return jsonify({'error': 'Note is protected. Please enter PIN.'}), 403
        if 'title' in data:
            fallback = 'Untitled List' if note.note_type == 'list' else 'Untitled Note'
            note.title = (data.get('title') or '').strip() or fallback
        if 'content' in data and note.note_type == 'note':
            note.content = data.get('content', note.content)
        if 'checkbox_mode' in data and note.note_type == 'list':
            note.checkbox_mode = str(data.get('checkbox_mode') or '').lower() in ['1', 'true', 'yes', 'on']
        note.updated_at = datetime.now(pytz.UTC).replace(tzinfo=None)
        if 'pinned' in data:
            is_pin = str(data.get('pinned')).lower() in ['1', 'true', 'yes', 'on']
            if is_pin and not note.pinned:
                max_pin = db.session.query(db.func.coalesce(db.func.max(Note.pin_order), 0)).filter(
                    Note.user_id == user.id,
                    Note.pinned.is_(True)
                ).scalar()
                note.pin_order = (max_pin or 0) + 1
            if not is_pin:
                note.pin_order = 0
            note.pinned = is_pin
        if 'todo_item_id' in data:
            todo_item_id = data.get('todo_item_id')
            if todo_item_id is None:
                note.todo_item_id = None
            else:
                try:
                    todo_item_id_int = int(todo_item_id)
                except (TypeError, ValueError):
                    return jsonify({'error': 'Invalid todo_item_id'}), 400
                linked_item = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
                    TodoItem.id == todo_item_id_int,
                    TodoList.user_id == user.id
                ).first()
                if not linked_item:
                    return jsonify({'error': 'Task not found for this user'}), 404
                note.todo_item_id = todo_item_id_int
                note.calendar_event_id = None  # keep note linked to a single target
        if 'calendar_event_id' in data:
            calendar_event_id = data.get('calendar_event_id')
            if calendar_event_id is None:
                note.calendar_event_id = None
            else:
                try:
                    calendar_event_id_int = int(calendar_event_id)
                except (TypeError, ValueError):
                    return jsonify({'error': 'Invalid calendar_event_id'}), 400
                linked_event = CalendarEvent.query.filter_by(id=calendar_event_id_int, user_id=user.id).first()
                if not linked_event:
                    return jsonify({'error': 'Calendar event not found for this user'}), 404
                note.calendar_event_id = calendar_event_id_int
                note.todo_item_id = None  # keep note linked to a single target
        if 'folder_id' in data:
            folder_id = data.get('folder_id')
            if folder_id is None or folder_id == '':
                note.folder_id = None
            else:
                try:
                    folder_id_int = int(folder_id)
                except (TypeError, ValueError):
                    return jsonify({'error': 'Invalid folder_id'}), 400
                folder = NoteFolder.query.filter_by(id=folder_id_int, user_id=user.id).first()
                if not folder:
                    return jsonify({'error': 'Folder not found for this user'}), 404
                note.folder_id = folder_id_int
        # Handle PIN protection toggle
        if 'is_pin_protected' in data:
            is_protected = str(data.get('is_pin_protected')).lower() in ['1', 'true', 'yes', 'on']
            if is_protected and not user.pin_hash:
                return jsonify({'error': 'Set a PIN first before protecting notes'}), 400
            note.is_pin_protected = is_protected
        db.session.commit()
        payload = note.to_dict()
        if note.note_type == 'list':
            payload['items'] = [item.to_dict() for item in note.list_items]
        return jsonify(payload)

    # GET: Return limited data for protected notes (always locked)
    if note.is_pin_protected:
        payload = {
            'id': note.id,
            'title': note.title,
            'is_pin_protected': True,
            'locked': True,
            'note_type': note.note_type,
            'pinned': note.pinned,
            'folder_id': note.folder_id,
            'created_at': note.created_at.isoformat() if note.created_at else None,
            'updated_at': note.updated_at.isoformat() if note.updated_at else None,
        }
        return jsonify(payload)

    payload = note.to_dict()
    if note.note_type == 'list':
        payload['items'] = [item.to_dict() for item in note.list_items]
    return jsonify(payload)


@app.route('/api/notes/<int:note_id>/convert-to-list', methods=['POST'])
def convert_note_to_list(note_id):
    """Convert a note into a list with strict line-based rules."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()
    if note.note_type != 'note':
        return jsonify({'error': 'Only notes can be converted to lists'}), 400

    lines, error = _extract_note_list_lines(note.content or '')
    if error:
        return jsonify({'error': 'Note does not qualify for list conversion', 'details': error}), 400

    NoteListItem.query.filter_by(note_id=note.id).delete(synchronize_session=False)
    note.note_type = 'list'
    note.checkbox_mode = False
    note.content = ''
    note.updated_at = _now_local()

    for idx, line in enumerate(lines, start=1):
        item = NoteListItem(
            note_id=note.id,
            text=line,
            note=None,
            link_text=None,
            link_url=None,
            checked=False,
            order_index=idx
        )
        db.session.add(item)

    db.session.commit()
    payload = note.to_dict()
    payload['items'] = [item.to_dict() for item in note.list_items]
    return jsonify(payload)


def _reindex_note_list_items(note_id):
    items = NoteListItem.query.filter_by(note_id=note_id).order_by(
        NoteListItem.order_index.asc(),
        NoteListItem.id.asc()
    ).all()
    for idx, item in enumerate(items, start=1):
        item.order_index = idx


@app.route('/api/notes/<int:note_id>/list-items', methods=['GET', 'POST'])
def note_list_items(note_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()
    if note.note_type != 'list':
        return jsonify({'error': 'Not a list note'}), 400

    if request.method == 'GET':
        items = NoteListItem.query.filter_by(note_id=note.id).order_by(
            NoteListItem.order_index.asc(),
            NoteListItem.id.asc()
        ).all()
        return jsonify([item.to_dict() for item in items])

    data = request.json or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Item text required'}), 400
    note_text = (data.get('note') or '').strip() or None
    link_text = (data.get('link_text') or '').strip() or None
    link_url = (data.get('link_url') or '').strip() or None
    checked = str(data.get('checked') or '').lower() in ['1', 'true', 'yes', 'on']

    insert_index = data.get('insert_index')
    max_order = db.session.query(db.func.coalesce(db.func.max(NoteListItem.order_index), 0)).filter_by(
        note_id=note.id
    ).scalar() or 0
    if insert_index is None:
        order_index = max_order + 1
    else:
        try:
            insert_index_int = int(insert_index)
        except (TypeError, ValueError):
            insert_index_int = max_order
        insert_index_int = max(0, insert_index_int)
        order_index = min(insert_index_int, max_order) + 1
        db.session.query(NoteListItem).filter(
            NoteListItem.note_id == note.id,
            NoteListItem.order_index >= order_index
        ).update(
            {NoteListItem.order_index: NoteListItem.order_index + 1},
            synchronize_session=False
        )

    item = NoteListItem(
        note_id=note.id,
        text=text,
        note=note_text,
        link_text=link_text,
        link_url=link_url,
        checked=checked,
        order_index=order_index
    )
    note.updated_at = datetime.now(pytz.UTC).replace(tzinfo=None)
    db.session.add(item)
    db.session.commit()
    return jsonify(item.to_dict()), 201


@app.route('/api/notes/<int:note_id>/list-items/<int:item_id>', methods=['PUT', 'DELETE'])
def note_list_item_detail(note_id, item_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    item = NoteListItem.query.join(Note, NoteListItem.note_id == Note.id).filter(
        NoteListItem.id == item_id,
        NoteListItem.note_id == note_id,
        Note.user_id == user.id
    ).first_or_404()
    note = item.parent_note
    if note.note_type != 'list':
        return jsonify({'error': 'Not a list note'}), 400

    if request.method == 'DELETE':
        db.session.delete(item)
        _reindex_note_list_items(note.id)
        note.updated_at = datetime.now(pytz.UTC).replace(tzinfo=None)
        db.session.commit()
        return '', 204

    data = request.json or {}
    if 'text' in data:
        text = (data.get('text') or '').strip()
        if not text:
            return jsonify({'error': 'Item text required'}), 400
        item.text = text
    if 'note' in data:
        item.note = (data.get('note') or '').strip() or None
    if 'link_text' in data:
        item.link_text = (data.get('link_text') or '').strip() or None
    if 'link_url' in data:
        item.link_url = (data.get('link_url') or '').strip() or None
    if 'checked' in data:
        item.checked = str(data.get('checked') or '').lower() in ['1', 'true', 'yes', 'on']
    note.updated_at = datetime.now(pytz.UTC).replace(tzinfo=None)
    db.session.commit()
    return jsonify(item.to_dict())


@app.route('/api/notes/<int:note_id>/share', methods=['POST', 'DELETE'])
def share_note(note_id):
    """Generate or revoke a shareable link for a note."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()

    if request.method == 'POST':
        # Generate a new share token
        note.share_token = secrets.token_urlsafe(32)
        note.is_public = True
        db.session.commit()
        share_url = url_for('view_shared_note', token=note.share_token, _external=True)
        return jsonify({
            'share_token': note.share_token,
            'share_url': share_url,
            'is_public': note.is_public
        })

    if request.method == 'DELETE':
        # Revoke sharing
        note.share_token = None
        note.is_public = False
        db.session.commit()
        return jsonify({'message': 'Sharing revoked'})


@app.route('/shared/<token>')
def view_shared_note(token):
    """Public view for shared notes (no authentication required)."""
    note = Note.query.filter_by(share_token=token, is_public=True).first_or_404()
    tz_name = app.config.get('DEFAULT_TIMEZONE', 'America/New_York')
    tz = pytz.timezone(tz_name)
    updated_local = None
    if note.updated_at:
        updated_at = note.updated_at
        if updated_at.tzinfo is None:
            updated_at = pytz.UTC.localize(updated_at)
        updated_local = updated_at.astimezone(tz)
    return render_template('shared_note.html', note=note, note_updated_at_local=updated_local)


# PIN Protection API
@app.route('/api/pin', methods=['GET'])
def check_pin_status():
    """Check if current user has a PIN set."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    return jsonify({
        'has_pin': bool(user.pin_hash)
    })


@app.route('/api/pin', methods=['POST'])
def set_pin():
    """Set or update the master PIN."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    data = request.json or {}
    new_pin = str(data.get('pin', '')).strip()
    current_pin = str(data.get('current_pin', '')).strip()

    # If PIN already exists, require current PIN verification
    if user.pin_hash and not user.check_pin(current_pin):
        return jsonify({'error': 'Current PIN is incorrect'}), 403

    try:
        user.set_pin(new_pin)
        db.session.commit()
        return jsonify({'success': True, 'message': 'PIN set successfully'})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/pin', methods=['DELETE'])
def remove_pin():
    """Remove the master PIN (requires current PIN)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    data = request.json or {}
    current_pin = str(data.get('pin', '')).strip()

    if not user.pin_hash:
        return jsonify({'error': 'No PIN is set'}), 400

    if not user.check_pin(current_pin):
        return jsonify({'error': 'PIN is incorrect'}), 403

    user.pin_hash = None
    # Unprotect all notes when PIN is removed
    Note.query.filter_by(user_id=user.id, is_pin_protected=True).update({'is_pin_protected': False})
    db.session.commit()
    session.pop('unlocked_note_ids', None)
    return jsonify({'success': True, 'message': 'PIN removed'})


@app.route('/api/pin/verify', methods=['POST'])
def verify_pin():
    """Verify PIN only (no persistent unlock)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    data = request.json or {}
    pin = str(data.get('pin', '')).strip()

    if not user.pin_hash:
        return jsonify({'error': 'No PIN is set'}), 400

    if user.check_pin(pin):
        return jsonify({'success': True, 'valid': True})
    else:
        return jsonify({'error': 'Incorrect PIN'}), 403


@app.route('/api/notes/<int:note_id>/unlock', methods=['POST'])
def unlock_note(note_id):
    """Verify PIN and return full note content (one-time, no session persistence)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()

    if not note.is_pin_protected:
        # Not protected, just return the content
        payload = note.to_dict()
        if note.note_type == 'list':
            payload['items'] = [item.to_dict() for item in note.list_items]
        return jsonify(payload)

    data = request.json or {}
    pin = str(data.get('pin', '')).strip()

    if not user.pin_hash:
        return jsonify({'error': 'No PIN is set'}), 400

    if not user.check_pin(pin):
        return jsonify({'error': 'Incorrect PIN'}), 403

    # PIN correct - return full note content
    payload = note.to_dict()
    if note.note_type == 'list':
        payload['items'] = [item.to_dict() for item in note.list_items]
    return jsonify(payload)


@app.route('/api/note-folders/<int:folder_id>/unlock', methods=['POST'])
def unlock_folder(folder_id):
    """Verify PIN for a protected folder (one-time, no session persistence)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    folder = NoteFolder.query.filter_by(id=folder_id, user_id=user.id).first_or_404()

    if not folder.is_pin_protected:
        # Not protected, just return success
        return jsonify({'unlocked': True, 'folder': folder.to_dict()})

    data = request.json or {}
    pin = str(data.get('pin', '')).strip()

    if not user.pin_hash:
        return jsonify({'error': 'No PIN is set'}), 400

    if not user.check_pin(pin):
        return jsonify({'error': 'Incorrect PIN'}), 403

    # PIN correct - return success
    return jsonify({'unlocked': True, 'folder': folder.to_dict()})


# Quick Access API
@app.route('/api/quick-access', methods=['GET', 'POST'])
def handle_quick_access():
    """Get or create quick access items."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    if request.method == 'GET':
        items = QuickAccessItem.query.filter_by(user_id=user.id).order_by(QuickAccessItem.order_index).all()
        return jsonify([item.to_dict() for item in items])

    if request.method == 'POST':
        data = request.json
        title = data.get('title', '').strip()
        if not title:
            return jsonify({'error': 'Title is required'}), 400

        # Get max order_index to append new item at the end
        max_order = db.session.query(db.func.max(QuickAccessItem.order_index)).filter_by(user_id=user.id).scalar() or 0

        new_item = QuickAccessItem(
            user_id=user.id,
            title=title,
            icon=data.get('icon', 'fa-solid fa-bookmark'),
            url=data.get('url', ''),
            item_type=data.get('item_type', 'custom'),
            reference_id=data.get('reference_id'),
            order_index=max_order + 1
        )
        db.session.add(new_item)
        db.session.commit()
        return jsonify(new_item.to_dict()), 201


@app.route('/api/quick-access/<int:item_id>', methods=['DELETE', 'PUT'])
def delete_quick_access(item_id):
    """Delete or update a quick access item."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    item = QuickAccessItem.query.filter_by(id=item_id, user_id=user.id).first_or_404()
    if request.method == 'PUT':
        data = request.json or {}
        title = (data.get('title') or '').strip()
        if not title:
            return jsonify({'error': 'Title is required'}), 400
        item.title = title
        item.icon = (data.get('icon') or item.icon or 'fa-solid fa-bookmark').strip()
        item.url = (data.get('url') or '').strip()
        item.item_type = (data.get('item_type') or item.item_type or 'custom').strip()
        item.reference_id = data.get('reference_id')
        db.session.commit()
        return jsonify(item.to_dict())
    db.session.delete(item)
    db.session.commit()
    return jsonify({'message': 'Deleted'})


@app.route('/api/quick-access/order', methods=['PUT'])
def update_quick_access_order():
    """Update quick access order for the current user."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    data = request.json or {}
    order = data.get('order') or []
    if not isinstance(order, list):
        return jsonify({'error': 'Order must be a list'}), 400

    ordered_ids = []
    for raw_id in order:
        try:
            ordered_ids.append(int(raw_id))
        except (TypeError, ValueError):
            continue

    if not ordered_ids:
        return jsonify({'error': 'Order is empty'}), 400

    items = QuickAccessItem.query.filter(
        QuickAccessItem.user_id == user.id,
        QuickAccessItem.id.in_(ordered_ids)
    ).all()
    item_map = {item.id: item for item in items}

    order_index = 1
    for item_id in ordered_ids:
        item = item_map.get(item_id)
        if not item:
            continue
        item.order_index = order_index
        order_index += 1

    remaining_items = QuickAccessItem.query.filter(
        QuickAccessItem.user_id == user.id,
        ~QuickAccessItem.id.in_(ordered_ids)
    ).order_by(QuickAccessItem.order_index.asc()).all()

    for item in remaining_items:
        item.order_index = order_index
        order_index += 1

    db.session.commit()
    return jsonify({'message': 'Order updated'})


# Bookmarks API
@app.route('/api/bookmarks', methods=['GET', 'POST'])
def handle_bookmarks():
    """List or create bookmark items."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    if request.method == 'GET':
        items = BookmarkItem.query.filter_by(user_id=user.id).order_by(
            BookmarkItem.pinned.desc(),
            BookmarkItem.pin_order.desc(),
            BookmarkItem.updated_at.desc(),
            BookmarkItem.created_at.desc()
        ).all()
        return jsonify([item.to_dict() for item in items])

    data = request.json or {}
    title = (data.get('title') or '').strip()
    value = (data.get('value') or '').strip()
    description = (data.get('description') or '').strip() or None
    pinned = bool(data.get('pinned', False))
    if not title or not value:
        return jsonify({'error': 'Title and value are required'}), 400

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
        pin_order=pin_order
    )
    db.session.add(new_item)
    db.session.commit()
    return jsonify(new_item.to_dict()), 201


@app.route('/api/bookmarks/<int:item_id>', methods=['GET', 'PUT', 'DELETE'])
def bookmark_detail(item_id):
    """Get, update, or delete a bookmark item."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    item = BookmarkItem.query.filter_by(id=item_id, user_id=user.id).first_or_404()

    if request.method == 'GET':
        return jsonify(item.to_dict())

    if request.method == 'PUT':
        data = request.json or {}
        if 'title' in data:
            title = (data.get('title') or '').strip()
            if not title:
                return jsonify({'error': 'Title is required'}), 400
            item.title = title
        if 'value' in data:
            value = (data.get('value') or '').strip()
            if not value:
                return jsonify({'error': 'Value is required'}), 400
            item.value = value
        if 'description' in data:
            description = (data.get('description') or '').strip()
            item.description = description or None

        if 'pinned' in data:
            pinned = bool(data.get('pinned'))
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
        return jsonify(item.to_dict())

    db.session.delete(item)
    db.session.commit()
    return jsonify({'message': 'Deleted'})


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

        _ensure_recurring_instances(user.id, start_day, end_day)

        events = CalendarEvent.query.filter(
            CalendarEvent.user_id == user.id,
            CalendarEvent.day >= start_day,
            CalendarEvent.day <= end_day
        ).order_by(CalendarEvent.day.asc(), CalendarEvent.order_index.asc()).all()

        linked_event_map = {}
        phase_map_by_day = {}
        for ev in events:
            if ev.todo_item_id:
                day_key = ev.day.isoformat()
                linked_event_map.setdefault(day_key, {})[ev.todo_item_id] = ev
                continue
            if ev.is_phase:
                day_key = ev.day.isoformat()
                phase_map_by_day.setdefault(day_key, {})[ev.id] = ev.title

        by_day = {}
        for ev in events:
            if ev.todo_item_id:
                continue
            day_key = ev.day.isoformat()
            data = ev.to_dict()
            if ev.phase_id:
                data['phase_title'] = phase_map_by_day.get(day_key, {}).get(ev.phase_id)
            by_day.setdefault(day_key, []).append(data)

        due_items = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
            TodoList.user_id == user.id,
            TodoItem.due_date >= start_day,
            TodoItem.due_date <= end_day,
            TodoItem.is_phase == False
        ).all()
        for idx, item in enumerate(due_items):
            day_key = item.due_date.isoformat()
            linked_event = linked_event_map.get(day_key, {}).get(item.id)
            by_day.setdefault(day_key, []).append({
                'id': -100000 - idx,
                'title': item.content,
                'status': item.status,
                'is_task_link': True,
                'task_id': item.id,
                'task_list_id': item.list_id,
                'task_list_title': item.list.title if item.list else '',
                'calendar_event_id': linked_event.id if linked_event else None,
                'start_time': linked_event.start_time.isoformat() if linked_event and linked_event.start_time else None,
                'end_time': linked_event.end_time.isoformat() if linked_event and linked_event.end_time else None,
                'reminder_minutes_before': linked_event.reminder_minutes_before if linked_event else None,
                'rollover_enabled': linked_event.rollover_enabled if linked_event else False,
                'priority': linked_event.priority if linked_event else 'medium',
                'item_note': linked_event.item_note if linked_event else None,
                'day': day_key,
                'order_index': 100000 + idx
            })

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
        _ensure_recurring_instances(user.id, day_obj, day_obj)
        events = CalendarEvent.query.filter_by(user_id=user.id, day=day_obj).order_by(
            CalendarEvent.order_index.asc()
        ).all()
        payload = []
        linked_event_map = {}
        for ev in events:
            if ev.todo_item_id:
                linked_event_map[ev.todo_item_id] = ev
                continue
            data = ev.to_dict()
            if ev.phase_id:
                parent = next((e for e in events if e.id == ev.phase_id), None)
                data['phase_title'] = parent.title if parent else None
            payload.append(data)

        # Also include tasks due on this day (from main task lists) as linkable entries
        due_items = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
            TodoList.user_id == user.id,
            TodoItem.due_date == day_obj,
            TodoItem.is_phase == False
        ).all()
        for idx, item in enumerate(due_items):
            linked_event = linked_event_map.get(item.id)
            payload.append({
                'id': -100000 - idx,  # synthetic id to avoid collisions
                'title': item.content,
                'status': item.status,
                'is_task_link': True,
                'task_id': item.id,
                'task_list_id': item.list_id,
                'task_list_title': item.list.title if item.list else '',
                'calendar_event_id': linked_event.id if linked_event else None,
                'start_time': linked_event.start_time.isoformat() if linked_event and linked_event.start_time else None,
                'end_time': linked_event.end_time.isoformat() if linked_event and linked_event.end_time else None,
                'reminder_minutes_before': linked_event.reminder_minutes_before if linked_event else None,
                'rollover_enabled': linked_event.rollover_enabled if linked_event else False,
                'priority': linked_event.priority if linked_event else 'medium',
                'item_note': linked_event.item_note if linked_event else None,
                'day': day_obj.isoformat(),
                'order_index': 100000 + idx
            })
        return jsonify(payload)

    data = request.json or {}
    todo_item_id = data.get('todo_item_id')
    linked_item = None
    if todo_item_id is not None:
        try:
            todo_item_id_int = int(todo_item_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid todo_item_id'}), 400
        linked_item = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
            TodoItem.id == todo_item_id_int,
            TodoList.user_id == user.id
        ).first()
        if not linked_item:
            return jsonify({'error': 'Task not found'}), 404

    title = (data.get('title') or '').strip()
    if not title and linked_item:
        title = linked_item.content
    if not title:
        return jsonify({'error': 'Title is required'}), 400

    day_obj = _parse_day_value(data.get('day') or date.today().isoformat())
    if not day_obj:
        return jsonify({'error': 'Invalid day'}), 400

    is_phase = bool(data.get('is_phase'))
    is_event = bool(data.get('is_event'))
    is_group = bool(data.get('is_group'))
    if linked_item:
        is_phase = False
        is_event = False
        is_group = False
    priority = (data.get('priority') or 'medium').lower()
    if priority not in ALLOWED_PRIORITIES:
        priority = 'medium'
    status = (data.get('status') or 'not_started')
    if status not in ALLOWED_STATUSES:
        status = 'not_started'
    if linked_item:
        status = linked_item.status

    item_note = None
    if 'item_note' in data:
        try:
            item_note = _normalize_calendar_item_note(data.get('item_note'))
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

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

    if linked_item:
        existing = CalendarEvent.query.filter_by(
            user_id=user.id,
            todo_item_id=linked_item.id,
            day=day_obj
        ).first()
        if existing:
            return jsonify(existing.to_dict()), 200

    if (not is_event) and (not is_phase) and (not is_group) and start_time:
        conflict = _task_conflicts_with_event(user.id, day_obj, start_time, end_time)
        if conflict:
            return jsonify({
                'error': f'Cannot add a task during "{conflict.title}" because an event is already scheduled.',
                'conflict_event_id': conflict.id,
                'conflict_event_title': conflict.title
            }), 409

    default_rollover = (not is_event) and (not is_group) and (not is_phase)
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
        rollover_enabled=bool(data.get('rollover_enabled', default_rollover) if not is_group else False),
        todo_item_id=linked_item.id if linked_item else None,
        item_note=item_note,
        order_index=_next_calendar_order(day_obj, user.id)
    )
    db.session.add(new_event)
    db.session.commit()

    # Schedule reminder job if applicable
    if new_event.reminder_minutes_before is not None and new_event.start_time:
        _schedule_reminder_job(new_event)

    return jsonify(new_event.to_dict()), 201


@app.route('/api/calendar/recurring', methods=['POST'])
def create_recurring_calendar_event():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    data = request.json or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'Title is required'}), 400

    start_day = _parse_day_value(data.get('day') or data.get('start_day') or date.today().isoformat())
    if not start_day:
        return jsonify({'error': 'Invalid start day'}), 400

    frequency = (data.get('frequency') or '').lower()
    allowed_freq = {'daily', 'weekly', 'biweekly', 'monthly', 'yearly', 'custom'}
    if frequency not in allowed_freq:
        return jsonify({'error': 'Invalid frequency'}), 400

    interval = 1
    interval_unit = None
    days_of_week = _parse_days_of_week(data.get('days_of_week'))
    day_of_month = data.get('day_of_month')
    month_of_year = data.get('month_of_year')
    try:
        day_of_month = int(day_of_month) if day_of_month is not None else None
    except (TypeError, ValueError):
        day_of_month = None
    try:
        month_of_year = int(month_of_year) if month_of_year is not None else None
    except (TypeError, ValueError):
        month_of_year = None

    if frequency == 'daily':
        interval = 1
        interval_unit = 'days'
    elif frequency == 'weekly':
        interval = 1
        interval_unit = 'weeks'
        if not days_of_week:
            days_of_week = [start_day.weekday()]
    elif frequency == 'biweekly':
        interval = 2
        interval_unit = 'weeks'
        if not days_of_week:
            days_of_week = [start_day.weekday()]
    elif frequency == 'monthly':
        interval = 1
        interval_unit = 'months'
        if day_of_month is None:
            day_of_month = start_day.day
    elif frequency == 'yearly':
        interval = 1
        interval_unit = 'years'
        if day_of_month is None:
            day_of_month = start_day.day
        if month_of_year is None:
            month_of_year = start_day.month
    elif frequency == 'custom':
        try:
            interval = max(int(data.get('interval') or 1), 1)
        except (TypeError, ValueError):
            interval = 1
        interval_unit = (data.get('interval_unit') or 'days').lower()
        if interval_unit not in {'days', 'weeks', 'months', 'years'}:
            return jsonify({'error': 'Invalid interval unit'}), 400
        if interval_unit == 'weeks' and not days_of_week:
            days_of_week = [start_day.weekday()]
        if interval_unit in {'months', 'years'} and day_of_month is None:
            day_of_month = start_day.day
        if interval_unit == 'years' and month_of_year is None:
            month_of_year = start_day.month

    if day_of_month is not None and not (1 <= day_of_month <= 31):
        return jsonify({'error': 'Invalid day of month'}), 400
    if month_of_year is not None and not (1 <= month_of_year <= 12):
        return jsonify({'error': 'Invalid month of year'}), 400

    start_time = _parse_time_str(data.get('start_time'))
    end_time = _parse_time_str(data.get('end_time'))
    reminder_minutes = data.get('reminder_minutes_before')
    try:
        reminder_minutes = int(reminder_minutes) if reminder_minutes is not None else None
    except (TypeError, ValueError):
        reminder_minutes = None

    priority = (data.get('priority') or 'medium').lower()
    if priority not in ALLOWED_PRIORITIES:
        priority = 'medium'

    status = (data.get('status') or 'not_started')
    if status not in ALLOWED_STATUSES:
        status = 'not_started'

    is_event = bool(data.get('is_event', False))
    default_rollover = not is_event
    rule = RecurringEvent(
        user_id=user.id,
        title=title,
        description=(data.get('description') or '').strip() or None,
        start_day=start_day,
        end_day=_parse_day_value(data.get('end_day')) if data.get('end_day') else None,
        start_time=start_time,
        end_time=end_time,
        status=status,
        priority=priority,
        is_event=is_event,
        reminder_minutes_before=reminder_minutes,
        rollover_enabled=bool(data.get('rollover_enabled', default_rollover)),
        frequency=frequency,
        interval=interval,
        interval_unit=interval_unit,
        days_of_week=(','.join(str(d) for d in days_of_week) if days_of_week else None),
        day_of_month=day_of_month,
        month_of_year=month_of_year
    )
    db.session.add(rule)
    db.session.commit()

    _ensure_recurring_instances(user.id, start_day, start_day)
    return jsonify({'id': rule.id}), 201


@app.route('/api/calendar/recurring', methods=['GET'])
def list_recurring_events():
    """List all recurring event templates for the current user."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    rules = RecurringEvent.query.filter_by(user_id=user.id).order_by(RecurringEvent.title).all()
    result = []
    for r in rules:
        result.append({
            'id': r.id,
            'title': r.title,
            'description': r.description,
            'start_day': r.start_day.isoformat() if r.start_day else None,
            'end_day': r.end_day.isoformat() if r.end_day else None,
            'start_time': r.start_time.strftime('%H:%M') if r.start_time else None,
            'end_time': r.end_time.strftime('%H:%M') if r.end_time else None,
            'priority': r.priority,
            'is_event': r.is_event,
            'reminder_minutes_before': r.reminder_minutes_before,
            'rollover_enabled': r.rollover_enabled,
            'frequency': r.frequency,
            'interval': r.interval,
            'interval_unit': r.interval_unit,
            'days_of_week': [int(d) for d in r.days_of_week.split(',')] if r.days_of_week else [],
            'day_of_month': r.day_of_month,
            'month_of_year': r.month_of_year
        })
    return jsonify(result)


@app.route('/api/calendar/recurring/<int:rule_id>', methods=['PUT', 'DELETE'])
def recurring_event_detail(rule_id):
    """Update or delete a recurring event template."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    rule = RecurringEvent.query.filter_by(id=rule_id, user_id=user.id).first_or_404()

    if request.method == 'DELETE':
        # Delete all associated exceptions
        RecurrenceException.query.filter_by(recurrence_id=rule.id).delete()
        # Optionally delete future instances (generated events from this rule)
        CalendarEvent.query.filter_by(recurrence_id=rule.id, user_id=user.id).delete()
        db.session.delete(rule)
        db.session.commit()
        return '', 204

    # PUT - update the recurring rule
    data = request.json or {}
    if 'title' in data:
        title = (data.get('title') or '').strip()
        if title:
            rule.title = title
    if 'description' in data:
        rule.description = (data.get('description') or '').strip() or None
    if 'priority' in data:
        priority = (data.get('priority') or '').lower()
        if priority in ALLOWED_PRIORITIES:
            rule.priority = priority
    if 'is_event' in data:
        rule.is_event = bool(data.get('is_event'))
    if 'rollover_enabled' in data:
        rule.rollover_enabled = bool(data.get('rollover_enabled'))
    if 'start_time' in data:
        rule.start_time = _parse_time_str(data.get('start_time'))
    if 'end_time' in data:
        rule.end_time = _parse_time_str(data.get('end_time'))
    if 'reminder_minutes_before' in data:
        try:
            rule.reminder_minutes_before = int(data['reminder_minutes_before']) if data['reminder_minutes_before'] else None
        except (TypeError, ValueError):
            pass
    if 'frequency' in data:
        freq = (data.get('frequency') or '').lower()
        if freq in {'daily', 'weekly', 'biweekly', 'monthly', 'yearly', 'custom'}:
            rule.frequency = freq
    if 'interval' in data:
        try:
            rule.interval = max(int(data['interval']), 1)
        except (TypeError, ValueError):
            pass
    if 'interval_unit' in data:
        unit = (data.get('interval_unit') or '').lower()
        if unit in {'days', 'weeks', 'months', 'years'}:
            rule.interval_unit = unit
    if 'days_of_week' in data:
        rule.days_of_week = ','.join(str(d) for d in _parse_days_of_week(data.get('days_of_week'))) or None
    if 'day_of_month' in data:
        try:
            dom = int(data['day_of_month']) if data['day_of_month'] else None
            if dom is None or 1 <= dom <= 31:
                rule.day_of_month = dom
        except (TypeError, ValueError):
            pass
    if 'month_of_year' in data:
        try:
            moy = int(data['month_of_year']) if data['month_of_year'] else None
            if moy is None or 1 <= moy <= 12:
                rule.month_of_year = moy
        except (TypeError, ValueError):
            pass

    db.session.commit()
    return jsonify({'id': rule.id})


@app.route('/api/calendar/events/<int:event_id>', methods=['PUT', 'DELETE'])
def calendar_event_detail(event_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    event = CalendarEvent.query.filter_by(id=event_id, user_id=user.id).first_or_404()

    if request.method == 'DELETE':
        # Cancel reminder job if exists
        _cancel_reminder_job(event)
        if event.recurrence_id:
            db.session.add(RecurrenceException(
                user_id=user.id,
                recurrence_id=event.recurrence_id,
                day=event.day
            ))
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
    if 'item_note' in data:
        try:
            event.item_note = _normalize_calendar_item_note(data.get('item_note'))
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
    if 'priority' in data:
        priority = (data.get('priority') or '').lower()
        if priority in ALLOWED_PRIORITIES:
            event.priority = priority
    old_status = event.status
    status_changed = False
    if 'status' in data:
        status = data.get('status')
        if status in ALLOWED_STATUSES:
            event.status = status
            status_changed = (old_status != event.status)
    if 'is_event' in data and not event.is_phase:
        event.is_event = bool(data.get('is_event'))
    if 'is_group' in data and not event.is_phase and not event.is_event:
        event.is_group = bool(data.get('is_group'))
    if 'rollover_enabled' in data:
        event.rollover_enabled = bool(data.get('rollover_enabled'))
    time_changed = False
    if 'start_time' in data:
        old_start = event.start_time
        event.start_time = _parse_time_str(data.get('start_time'))
        if old_start != event.start_time:
            time_changed = True
    if 'end_time' in data:
        event.end_time = _parse_time_str(data.get('end_time'))
    reminder_changed = False
    if 'reminder_minutes_before' in data:
        old_reminder = event.reminder_minutes_before
        try:
            event.reminder_minutes_before = int(data.get('reminder_minutes_before'))
        except (TypeError, ValueError):
            event.reminder_minutes_before = None
        if old_reminder != event.reminder_minutes_before:
            reminder_changed = True
    day_changed = False
    if 'day' in data:
        new_day = _parse_day_value(data.get('day'))
        if not new_day:
            return jsonify({'error': 'Invalid day'}), 400
        if new_day != event.day:
            old_day = event.day
            event.day = new_day
            event.order_index = _next_calendar_order(new_day, user.id)
            day_changed = True
            if event.recurrence_id:
                db.session.add(RecurrenceException(
                    user_id=user.id,
                    recurrence_id=event.recurrence_id,
                    day=old_day
                ))
                event.recurrence_id = None
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

    if (not event.is_event) and (not event.is_phase) and (not event.is_group) and event.start_time:
        conflict = _task_conflicts_with_event(user.id, event.day, event.start_time, event.end_time, exclude_event_id=event.id)
        if conflict:
            db.session.rollback()
            return jsonify({
                'error': f'Cannot add a task during "{conflict.title}" because an event is already scheduled.',
                'conflict_event_id': conflict.id,
                'conflict_event_title': conflict.title
            }), 409

    if status_changed:
        if event.status == 'done':
            _cancel_reminder_job(event)
            event.reminder_sent = True
            event.reminder_snoozed_until = None
        elif old_status == 'done':
            event.reminder_sent = False
    db.session.commit()

    # Reschedule reminder if relevant fields changed
    if event.status != 'done':
        needs_reschedule = reminder_changed or time_changed or day_changed or (status_changed and old_status == 'done')
        if needs_reschedule and event.reminder_minutes_before is not None:
            if event.start_time:
                _schedule_reminder_job(event)
            else:
                _cancel_reminder_job(event)
        elif reminder_changed and event.reminder_minutes_before is None:
            # Reminder was removed
            _cancel_reminder_job(event)

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
    app.logger.info(f"Manual rollover triggered by user {user.id}")
    _rollover_incomplete_events()
    app.logger.info("Manual rollover completed")
    return jsonify({'status': 'ok'})


@app.route('/api/calendar/digest/email', methods=['POST'])
def send_digest_now():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    day_obj = _parse_day_value(request.json.get('day') if request.json else None) or date.today()
    _send_daily_email_digest(target_day=day_obj)
    return jsonify({'status': 'sent', 'day': day_obj.isoformat()})


def _get_or_create_notification_settings(user_id):
    prefs = NotificationSetting.query.filter_by(user_id=user_id).first()
    if not prefs:
        prefs = NotificationSetting(user_id=user_id)
        db.session.add(prefs)
        db.session.commit()
    return prefs


@app.route('/api/notifications', methods=['GET', 'POST'])
def api_list_notifications():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    if request.method == 'POST':
        data = request.json or {}
        title = (data.get('title') or '').strip() or 'Notification'
        body = (data.get('body') or '').strip() or None
        notif = Notification(
            user_id=user.id,
            type=(data.get('type') or 'general'),
            title=title,
            body=body,
            link=data.get('link'),
            channel=data.get('channel') or 'in_app'
        )
        db.session.add(notif)
        db.session.commit()
        if notif.channel in ('push', 'mixed'):
            _send_push_to_user(user, title, body, link=notif.link)
        return jsonify(notif.to_dict()), 201
    limit = min(int(request.args.get('limit', 50)), 200)
    items = Notification.query.filter_by(user_id=user.id).order_by(Notification.created_at.desc()).limit(limit).all()
    return jsonify([n.to_dict() for n in items])


@app.route('/api/notifications/read_all', methods=['POST'])
def api_mark_notifications_read():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    now = datetime.now(pytz.UTC).replace(tzinfo=None)
    updated = Notification.query.filter_by(user_id=user.id, read_at=None).update({"read_at": now})
    db.session.commit()
    return jsonify({'updated': updated})


@app.route('/api/notifications/<int:notification_id>/read', methods=['POST'])
def api_mark_notification_read(notification_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    notif = Notification.query.filter_by(id=notification_id, user_id=user.id).first()
    if not notif:
        return jsonify({'error': 'Not found'}), 404
    notif.read_at = datetime.now(pytz.UTC).replace(tzinfo=None)
    db.session.commit()
    return jsonify(notif.to_dict())


@app.route('/api/notifications/settings', methods=['GET', 'PUT'])
def api_notification_settings():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    prefs = _get_or_create_notification_settings(user.id)
    if request.method == 'GET':
        return jsonify(prefs.to_dict())
    data = request.json or {}
    prefs.in_app_enabled = bool(data.get('in_app_enabled', prefs.in_app_enabled))
    prefs.email_enabled = bool(data.get('email_enabled', prefs.email_enabled))
    prefs.push_enabled = bool(data.get('push_enabled', prefs.push_enabled))
    prefs.reminders_enabled = bool(data.get('reminders_enabled', prefs.reminders_enabled))
    prefs.digest_enabled = bool(data.get('digest_enabled', prefs.digest_enabled))
    try:
        hour = int(data.get('digest_hour', prefs.digest_hour))
        if 0 <= hour <= 23:
            prefs.digest_hour = hour
    except (TypeError, ValueError):
        pass
    try:
        snooze_mins = int(data.get('default_snooze_minutes', prefs.default_snooze_minutes))
        if snooze_mins > 0:
            prefs.default_snooze_minutes = snooze_mins
    except (TypeError, ValueError):
        pass
    db.session.commit()
    return jsonify(prefs.to_dict())


def _send_push_to_user(user, title, body=None, link=None, event_id=None, actions=None):
    public_key = app.config.get('VAPID_PUBLIC_KEY')
    private_key = app.config.get('VAPID_PRIVATE_KEY')
    if not public_key or not private_key:
        return 0
    subs = PushSubscription.query.filter_by(user_id=user.id).all()
    if not subs:
        return 0
    app.logger.info("Sending push to %s subs for user %s", len(subs), user.id)

    payload_data = {
        'title': title,
        'body': body or '',
        'data': {'url': link or '/'}
    }
    if event_id:
        payload_data['data']['event_id'] = event_id
    if actions:
        payload_data['actions'] = actions

    payload = json.dumps(payload_data)
    sent = 0
    # Use high urgency for reminders to ensure delivery on mobile even when screen is off
    headers = {'Urgency': 'high', 'Topic': 'reminder'} if event_id else {}
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    'endpoint': sub.endpoint,
                    'keys': {'p256dh': sub.p256dh, 'auth': sub.auth}
                },
                data=payload,
                vapid_private_key=private_key,
                vapid_claims={"sub": "mailto:{}".format(os.environ.get('VAPID_SUBJECT', 'admin@example.com'))},
                headers=headers
            )
            sent += 1
        except WebPushException as exc:
            # Clean up invalid subscriptions
            if exc.response and exc.response.status_code in (404, 410):
                app.logger.warning("Deleting invalid push subscription %s due to %s", sub.endpoint, exc.response.status_code)
                db.session.delete(sub)
                db.session.commit()
            continue
        except Exception:
            app.logger.exception("Push send error")
            continue
    return sent


@app.route('/api/push/subscribe', methods=['POST'])
def api_push_subscribe():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    data = request.json or {}
    sub = data.get('subscription') or {}
    endpoint = sub.get('endpoint')
    keys = sub.get('keys') or {}
    p256dh = keys.get('p256dh')
    auth = keys.get('auth')
    if not endpoint or not p256dh or not auth:
        app.logger.warning("Push subscribe missing fields: endpoint=%s p256dh=%s auth=%s", bool(endpoint), bool(p256dh), bool(auth))
        return jsonify({'error': 'Invalid subscription'}), 400
    app.logger.info("Push subscribe for user %s endpoint %s", user.id, endpoint)
    # Remove existing subs for this user to avoid duplicates
    PushSubscription.query.filter_by(user_id=user.id).delete()
    db.session.commit()
    db.session.add(PushSubscription(user_id=user.id, endpoint=endpoint, p256dh=p256dh, auth=auth))
    db.session.commit()
    # Ensure push setting is on
    prefs = _get_or_create_notification_settings(user.id)
    prefs.push_enabled = True
    db.session.commit()
    return jsonify({'status': 'subscribed'})


@app.route('/api/push/unsubscribe', methods=['POST'])
def api_push_unsubscribe():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    data = request.json or {}
    endpoint = data.get('endpoint')
    if not endpoint:
        return jsonify({'error': 'endpoint required'}), 400
    PushSubscription.query.filter_by(endpoint=endpoint, user_id=user.id).delete()
    db.session.commit()
    return jsonify({'status': 'unsubscribed'})


@app.route('/api/push/subscriptions', methods=['GET'])
def api_push_list():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    subs = PushSubscription.query.filter_by(user_id=user.id).all()
    return jsonify([s.to_dict() for s in subs])


@app.route('/api/push/subscriptions/clear', methods=['POST'])
def api_push_clear():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    deleted = PushSubscription.query.filter_by(user_id=user.id).delete()
    db.session.commit()
    return jsonify({'deleted': deleted})


@app.route('/api/push/test', methods=['POST'])
def api_push_test():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    title = 'Test push'
    body = 'This is a test push notification.'
    sent = _send_push_to_user(user, title, body, link='/')
    return jsonify({'sent': sent})


@app.route('/api/calendar/events/<int:event_id>/snooze', methods=['POST'])
def snooze_reminder(event_id):
    """Snooze a calendar event reminder."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    event = CalendarEvent.query.filter_by(id=event_id, user_id=user.id).first_or_404()

    # Get snooze duration from request or use user's default
    data = request.json or {}
    snooze_minutes = data.get('snooze_minutes')

    if snooze_minutes is None:
        # Use user's default snooze time
        prefs = _get_or_create_notification_settings(user.id)
        snooze_minutes = prefs.default_snooze_minutes

    try:
        snooze_minutes = int(snooze_minutes)
        if snooze_minutes <= 0:
            return jsonify({'error': 'Snooze minutes must be positive'}), 400
    except (TypeError, ValueError):
        return jsonify({'error': 'Invalid snooze duration'}), 400

    # Calculate snooze time (in server's local timezone)
    tz = pytz.timezone(app.config['DEFAULT_TIMEZONE'])
    now = datetime.now(tz).replace(tzinfo=None)
    snooze_until = now + timedelta(minutes=snooze_minutes)

    # Update event
    event.reminder_snoozed_until = snooze_until
    event.reminder_sent = False
    db.session.commit()

    # Schedule reminder for snooze time
    global scheduler
    if scheduler:
        job_id = f"reminder_{event.id}_{int(snooze_until.timestamp())}"
        try:
            scheduler.add_job(
                _send_event_reminder,
                'date',
                run_date=pytz.timezone(app.config['DEFAULT_TIMEZONE']).localize(snooze_until),
                args=[event_id],
                id=job_id,
                replace_existing=True
            )
            event.reminder_job_id = job_id
            db.session.commit()
            app.logger.info(f"Snoozed reminder for event {event_id} for {snooze_minutes} minutes")
        except Exception as e:
            app.logger.error(f"Error scheduling snoozed reminder: {e}")
            return jsonify({'error': 'Failed to schedule snooze'}), 500

    return jsonify({
        'snoozed': True,
        'snooze_until': snooze_until.isoformat(),
        'snooze_minutes': snooze_minutes
    })


@app.route('/api/calendar/events/<int:event_id>/dismiss', methods=['POST'])
def dismiss_reminder(event_id):
    """Dismiss a calendar event reminder (mark as sent, no more notifications)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    event = CalendarEvent.query.filter_by(id=event_id, user_id=user.id).first_or_404()

    # Mark as sent (dismissed)
    event.reminder_sent = True
    event.reminder_snoozed_until = None

    # Cancel any scheduled jobs
    _cancel_reminder_job(event)

    db.session.commit()

    return jsonify({'dismissed': True})


@app.route('/api/calendar/events/pending-reminders', methods=['GET'])
def get_pending_reminders():
    """Get upcoming reminders for mobile app to schedule locally."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    # Get user's timezone
    tz = pytz.timezone(app.config['DEFAULT_TIMEZONE'])
    now = datetime.now(tz)

    # Get events with reminders in the next 7 days that haven't been sent yet
    end_window = now + timedelta(days=7)

    events = CalendarEvent.query.filter(
        CalendarEvent.user_id == user.id,
        or_(CalendarEvent.reminder_sent.is_(False), CalendarEvent.reminder_sent.is_(None))
    ).all()

    pending = []
    for event in events:
        if not event.start_time:
            continue

        # Combine day and time
        event_datetime = datetime.combine(event.day, event.start_time)

        # Check if snoozed
        if event.reminder_snoozed_until:
            remind_at = event.reminder_snoozed_until
            remind_at_local = remind_at if remind_at.tzinfo else tz.localize(remind_at)
        elif event.reminder_minutes_before is not None:
            event_local = event_datetime if event_datetime.tzinfo else tz.localize(event_datetime)
            remind_at_local = event_local - timedelta(minutes=event.reminder_minutes_before)
        else:
            continue  # No reminder set

        # Only include if reminder is in the future and within our window
        if now < remind_at_local <= end_window:
            remind_at_utc = remind_at_local.astimezone(pytz.UTC)
            pending.append({
                'event_id': event.id,
                'title': event.title,
                'start_time': event.start_time.strftime('%I:%M %p'),
                'day': event.day.isoformat(),
                'remind_at': remind_at_local.replace(tzinfo=None).isoformat(),
                'remind_at_ts': int(remind_at_utc.timestamp() * 1000),
                'url': f'/calendar?day={event.day.isoformat()}'
            })

    return jsonify({'reminders': pending})


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
    tags_raw = data.get('tags')
    is_project = data.get('is_project', False)
    project_type = data.get('project_type', 'list') # Default to 'list'
    phase_id = data.get('phase_id')
    status = data.get('status', 'not_started')
    is_phase_item = bool(data.get('is_phase')) or status == 'phase'
    due_date_raw = data.get('due_date')
    due_date = _parse_day_value(due_date_raw) if due_date_raw else None
    allowed_statuses = {'not_started', 'in_progress', 'done'}
    if status not in allowed_statuses:
        status = 'not_started'
    if is_phase_item or is_project:
        status = 'not_started'
    next_order = db.session.query(db.func.coalesce(db.func.max(TodoItem.order_index), 0)).filter_by(list_id=list_id).scalar() + 1
    tags = _tags_to_string(tags_raw)
    new_item = TodoItem(
        list_id=list_id,
        content=content,
        description=description,
        notes=notes,
        tags=tags if tags else None,
        status=status,
        order_index=next_order,
        phase_id=int(phase_id) if (phase_id and not is_phase_item) else None,
        is_phase=is_phase_item,
        due_date=due_date
    )
    if status == 'done' and not is_phase_item:
        new_item.completed_at = datetime.now(pytz.UTC).replace(tzinfo=None)
    
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
        old_due_date = item.due_date
        old_status = item.status
        new_status = data.get('status', item.status)
        allowed_statuses = {'not_started', 'in_progress', 'done'}
        if new_status not in allowed_statuses:
            new_status = item.status
        if new_status == 'done':
            if item.status != 'done' or not item.completed_at:
                item.completed_at = datetime.now(pytz.UTC).replace(tzinfo=None)
        else:
            item.completed_at = None
        item.status = new_status
        item.content = data.get('content', item.content)
        item.description = data.get('description', item.description)
        item.notes = data.get('notes', item.notes)
        if 'tags' in data:
            tags_value = _tags_to_string(data.get('tags'))
            item.tags = tags_value if tags_value else None
        if 'due_date' in data:
            due_date_raw = data.get('due_date')
            item.due_date = _parse_day_value(due_date_raw) if due_date_raw else None
            if old_due_date != item.due_date:
                linked_event = CalendarEvent.query.filter_by(user_id=user.id, todo_item_id=item.id).first()
                if linked_event:
                    if item.due_date:
                        linked_event.day = item.due_date
                        linked_event.order_index = _next_calendar_order(item.due_date, user.id)
                        if linked_event.reminder_minutes_before is not None and linked_event.start_time:
                            _schedule_reminder_job(linked_event)
                    else:
                        _cancel_reminder_job(linked_event)
                        db.session.delete(linked_event)

        if old_status != new_status:
            linked_event = CalendarEvent.query.filter_by(user_id=user.id, todo_item_id=item.id).first()
            if linked_event:
                if new_status == 'done':
                    _cancel_reminder_job(linked_event)
                    linked_event.reminder_sent = True
                    linked_event.reminder_snoozed_until = None
                elif old_status == 'done':
                    linked_event.reminder_sent = False
                    if linked_event.reminder_minutes_before is not None and linked_event.start_time:
                        _schedule_reminder_job(linked_event)

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
        if dest_hub_id in [None, '', 'null', 'none']:
            child_list = item.linked_list
            if not child_list:
                return jsonify({'error': 'Project list not found'}), 404
            order_query = db.session.query(db.func.coalesce(db.func.max(TodoList.order_index), 0)).filter(
                TodoList.user_id == user.id,
                TodoList.type == child_list.type
            ).outerjoin(TodoItem, TodoList.id == TodoItem.linked_list_id).filter(TodoItem.id == None)
            child_list.order_index = (order_query.scalar() or 0) + 1
            hub_list = item.list
            db.session.delete(item)
            db.session.flush()
            if hub_list:
                reindex_list(hub_list)
            db.session.commit()
            return jsonify({'message': 'Moved to main page'})

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
                if status == 'done' and not is_phase:
                    child_item.completed_at = datetime.now(pytz.UTC).replace(tzinfo=None)
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
            if status == 'done' and not is_phase:
                new_item.completed_at = datetime.now(pytz.UTC).replace(tzinfo=None)
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
    if action not in ['status', 'delete', 'move', 'add_tag']:
        return jsonify({'error': 'action must be status, delete, move, or add_tag'}), 400

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
            if status == 'done':
                if item.status != 'done' or not item.completed_at:
                    item.completed_at = datetime.now(pytz.UTC).replace(tzinfo=None)
            else:
                item.completed_at = None
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

    if action == 'add_tag':
        tag_value = data.get('tag') or data.get('tags')
        tags_to_add = _normalize_tags(tag_value)
        if not tags_to_add:
            return jsonify({'error': 'tag is required'}), 400

        updated = 0
        for item in items:
            if is_phase_header(item):
                continue
            current_tags = _normalize_tags(item.tags)
            changed = False
            for tag in tags_to_add:
                if tag not in current_tags:
                    current_tags.append(tag)
                    changed = True
            if changed:
                item.tags = _tags_to_string(current_tags)
                updated += 1

        db.session.commit()
        return jsonify({'updated': updated})

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
    current_phase_id = None

    for item_id in ordered_ids:
        try:
            item_id_int = int(item_id)
        except (ValueError, TypeError):
            continue
        if item_id_int in items:
            item = items[item_id_int]
            item.order_index = order_val
            order_val += 1

            # Update phase tracking and assignment based on position
            if is_phase_header(item):
                current_phase_id = item.id
            else:
                # Assign task to current phase (or None if not under any phase)
                item.phase_id = current_phase_id

    db.session.commit()
    return jsonify({'updated': len(ordered_ids)})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
