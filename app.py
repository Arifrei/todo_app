import os
import re
import json
import logging
import math
import pytz
import secrets
from datetime import datetime, date, time, timedelta
from dotenv import load_dotenv, find_dotenv
from flask import Flask, render_template, request, jsonify, redirect, url_for, session, send_from_directory
from ai_service import run_ai_chat, get_openai_client
from models import db, User, TodoList, TodoItem, Note, CalendarEvent, Notification, NotificationSetting, PushSubscription, RecallItem
from apscheduler.schedulers.background import BackgroundScheduler
from pywebpush import webpush, WebPushException
import requests
from bs4 import BeautifulSoup

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

SIDEBAR_ORDER_FILE = os.path.join(app.instance_path, 'sidebar_order.json')
DEFAULT_SIDEBAR_ORDER = ['home', 'tasks', 'calendar', 'notes', 'recalls', 'ai', 'settings']

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


def _build_recall_blob(title, content, category, type_name, tags, source_url=None, summary=None):
    fields = [
        title or '',
        category or '',
        type_name or '',
        content or '',
        summary or '',
        ' '.join(_normalize_tags(tags)),
        source_url or '',
    ]
    return ' '.join([f.strip() for f in fields if f]).strip()


def _fetch_url_content(url, max_length=3000):
    """Fetch and extract text content from a URL. Returns None on failure."""
    try:
        response = requests.get(url, timeout=10, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        response.raise_for_status()

        soup = BeautifulSoup(response.content, 'html.parser')

        # Remove script and style elements
        for script in soup(['script', 'style', 'nav', 'footer', 'header']):
            script.decompose()

        # Get text content
        text = soup.get_text()

        # Clean up whitespace
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        text = ' '.join(chunk for chunk in chunks if chunk)

        # Truncate if too long
        if len(text) > max_length:
            text = text[:max_length] + '...'

        return text if text else None
    except Exception as exc:
        app.logger.warning(f"URL fetch failed for {url}: {exc}")
        return None


def _load_sidebar_order():
    """Load global sidebar order from disk, falling back to defaults."""
    try:
        if os.path.exists(SIDEBAR_ORDER_FILE):
            with open(SIDEBAR_ORDER_FILE, 'r', encoding='utf-8') as handle:
                data = json.load(handle)
                if isinstance(data, list):
                    order = [str(item).strip() for item in data if isinstance(item, str) and str(item).strip()]
                    allowed = set(DEFAULT_SIDEBAR_ORDER)
                    order = [item for item in order if item in allowed]
                    if order:
                        # Ensure all items present.
                        seen = set(order)
                        order.extend([item for item in DEFAULT_SIDEBAR_ORDER if item not in seen])
                        return order
    except Exception as exc:
        app.logger.warning(f"Failed to load sidebar order: {exc}")
    return list(DEFAULT_SIDEBAR_ORDER)


def _save_sidebar_order(order):
    """Persist global sidebar order to disk."""
    os.makedirs(app.instance_path, exist_ok=True)
    with open(SIDEBAR_ORDER_FILE, 'w', encoding='utf-8') as handle:
        json.dump(order, handle, indent=2)


def _generate_recall_summary(title, content, category, type_name, source_url=None):
    """Generate an intelligent summary. Returns None if not enough context or on failure."""
    if not app.config.get('OPENAI_API_KEY'):
        return None

    # If it's a link, try to fetch the actual content
    url_content = None
    if source_url:
        url_content = _fetch_url_content(source_url)

    # Determine what to summarize
    if url_content:
        # URL content available - summarize that
        main_content = url_content[:2500]
    elif content and len(content.strip()) >= 30:
        # We have substantial user content - summarize that
        main_content = content
    else:
        # Not enough content to warrant a summary
        return None

    # Build the prompt focusing on CONTENT, not title
    if url_content:
        prompt = f"""Summarize what this webpage is about in one brief sentence (max 15 words).
Focus on the actual content, not just the title. Be concise.

Webpage: {main_content}"""
    else:
        prompt = f"""Summarize what this is about in one brief sentence (max 15 words).
Focus on the actual information, not just restating the title. Be concise.

Content: {main_content}"""

    try:
        client = get_openai_client()
        model_name = os.environ.get('OPENAI_MODEL', 'gpt-4o-mini')
        resp = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": "You write brief, informative summaries that describe WHAT the content is about in 15 words or less. Focus on substance over titles. If the content lacks substance or is just a title, return an empty response."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=40,
            temperature=0.3
        )
        summary = (resp.choices[0].message.content or '').strip()

        # Quality checks
        if len(summary) < 15:
            return None

        # Check if summary is just rephrasing the title
        title_lower = title.lower()
        summary_lower = summary.lower()
        # If more than 60% of title words are in summary in same order, it's probably just restating
        title_words = set(title_lower.split())
        summary_words = set(summary_lower.split())
        overlap = len(title_words & summary_words) / max(len(title_words), 1)
        if overlap > 0.7 and len(summary_words) < len(title_words) + 3:
            # Summary is too similar to title, skip it
            return None

        return summary
    except Exception as exc:
        app.logger.warning(f"Recall summary failed: {exc}")
        return None


def _generate_recall_embedding(text):
    """Create an embedding vector for recall search; returns list or None on failure."""
    cleaned = (text or '').strip()
    if not cleaned:
        return None
    if not app.config.get('OPENAI_API_KEY'):
        return None
    try:
        client = get_openai_client()
        model_name = os.environ.get('OPENAI_EMBED_MODEL', 'text-embedding-3-small')
        resp = client.embeddings.create(model=model_name, input=cleaned[:7000])
        return resp.data[0].embedding
    except Exception as exc:
        app.logger.warning(f"Embedding generation failed: {exc}")
        return None


def _cosine_similarity(vec_a, vec_b):
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    mag_a = math.sqrt(sum(a * a for a in vec_a))
    mag_b = math.sqrt(sum(b * b for b in vec_b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def _semantic_search_recalls(user_id, query_text, limit=6, include_archived=False):
    """Rank recalls by semantic similarity with keyword fallback."""
    if not query_text:
        return []

    base_q = RecallItem.query.filter(RecallItem.user_id == user_id)
    if not include_archived:
        base_q = base_q.filter(RecallItem.status != 'archived')
    recalls = base_q.all()

    query_embedding = _generate_recall_embedding(query_text)
    normalized_query = query_text.lower()
    results = []

    for r in recalls:
        emb = None
        if r.embedding:
            try:
                emb = json.loads(r.embedding)
            except Exception:
                emb = None
        similarity = _cosine_similarity(query_embedding, emb) if query_embedding and emb else 0.0

        # Keyword bonus if embedding is unavailable or ties are close
        blob = (r.search_blob or '').lower()
        if normalized_query and normalized_query in blob:
            similarity = max(similarity, 0.35)
        results.append((similarity, r))

    results.sort(key=lambda x: x[0], reverse=True)
    top = results[:limit]
    return [r.to_dict(include_similarity=True, similarity=score) for score, r in top]


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
        app.logger.info(f"Rollover start: {yesterday} -> {today}")

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

            for ev in events:
                # Skip if this event has already been rolled over today
                if ev.id in rolled_lookup:
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
                created_events += 1

            for dup in duplicates_to_delete:
                db.session.delete(dup)

            db.session.commit()
            if created_events or duplicates_to_delete:
                app.logger.info(
                    f"Rollover user {uid}: created {created_events} events, "
                    f"created {created_phases} phases, removed {len(duplicates_to_delete)} duplicates"
                )
        app.logger.info("Rollover finished")


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
    for ev in events_for_day:
        prefix = '[x]' if ev.status == 'done' else '[ ]'
        time_block = ''
        if ev.start_time:
            end_str = ev.end_time.isoformat() if ev.end_time else ''
            time_block = f" @ {ev.start_time.isoformat()}{('-' + end_str) if end_str else ''}"
        priority = ev.priority or 'medium'
        lines.append(f"{prefix} {ev.title} ({priority}){time_block}")
    if tasks_due:
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
        target_day = target_day or date.today()
        users = User.query.filter(User.email != None).all()  # noqa: E711
        for user_obj in users:
            events = CalendarEvent.query.filter(
                CalendarEvent.user_id == user_obj.id,
                CalendarEvent.day == target_day
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
                _send_email(user_obj.email, f"Your tasks for {target_day.isoformat()}", body)
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
    # Optional daily digest at 7:00 local time
    scheduler.add_job(_send_daily_email_digest, 'cron', hour=int(os.environ.get('DIGEST_HOUR', 7)), minute=0)
    # Note: Calendar reminders now use server-scheduled jobs (scheduled per-event)
    # Legacy minute-polling has been replaced with precise scheduling
    scheduler.start()

    # Catch up rollover if the server started after the scheduled time
    try:
        _rollover_incomplete_events()
    except Exception as e:
        app.logger.error(f"Error running rollover catch-up: {e}")

    # Schedule existing reminders on startup
    _schedule_existing_reminders()

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

@app.route('/api/sidebar-order', methods=['GET', 'POST'])
def sidebar_order():
    """Get or update the global sidebar order (stored on disk, not per-user)."""
    if request.method == 'GET':
        order = _load_sidebar_order()
        return jsonify({'order': order})

    data = request.get_json(silent=True)
    order = data if isinstance(data, list) else (data or {}).get('order')
    if not isinstance(order, list):
        return jsonify({'error': 'Order must be a list'}), 400

    cleaned = [str(item).strip() for item in order if isinstance(item, str) and str(item).strip()]
    allowed = set(DEFAULT_SIDEBAR_ORDER)
    cleaned = [item for item in cleaned if item in allowed]
    # Ensure all allowed items exist exactly once, preserving requested order.
    seen = set()
    final_order = []
    for item in cleaned:
        if item not in seen:
            seen.add(item)
            final_order.append(item)
    for item in DEFAULT_SIDEBAR_ORDER:
        if item not in seen:
            final_order.append(item)

    _save_sidebar_order(final_order)
    return jsonify({'success': True, 'order': final_order})

@app.route('/')
def index():
    # If no user selected, redirect to user selection
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('home.html')


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
    apk_filename = 'taskflow.apk'
    apk_path = os.path.join(downloads_dir, apk_filename)

    if os.path.exists(apk_path):
        return send_from_directory(downloads_dir, apk_filename,
                                   as_attachment=True,
                                   download_name='TaskFlow.apk',
                                   mimetype='application/vnd.android.package-archive')
    else:
        return "APK not found. Please build and upload the app first.", 404


@app.route('/notes')
def notes_page():
    """Dedicated notes workspace with rich text editor."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('notes.html')


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
        todo_item_id = data.get('todo_item_id')
        calendar_event_id = data.get('calendar_event_id')
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
            content=content,
            user_id=user.id,
            todo_item_id=linked_item.id if linked_item else None,
            calendar_event_id=linked_event.id if linked_event else None
        )
        db.session.add(note)
        db.session.commit()
        return jsonify(note.to_dict()), 201

    notes = Note.query.filter_by(user_id=user.id).order_by(
        Note.pinned.desc(),
        Note.pin_order.asc(),
        Note.updated_at.desc()
    ).all()
    return jsonify([n.to_dict() for n in notes])


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


@app.route('/api/recalls', methods=['GET', 'POST'])
def handle_recalls():
    """List or create recall items."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    if request.method == 'POST':
        data = request.json or request.form or {}
        title = (data.get('title') or '').strip()
        if not title:
            return jsonify({'error': 'Title is required'}), 400

        category = (data.get('category') or 'General').strip() or 'General'
        type_name = (data.get('type') or 'note').strip() or 'note'
        content = (data.get('content') or '').strip()
        keywords = data.get('keywords') or data.get('tags')
        tags = _normalize_tags(keywords)
        pinned = str(data.get('pinned')).lower() in ['1', 'true', 'yes', 'on']
        reminder_at = _parse_reminder(data.get('reminder_at'))
        status = (data.get('status') or 'active').strip()
        source_url = (data.get('source_url') or '').strip() or None
        summary = (data.get('summary') or '').strip() or None

        if not summary:
            summary = _generate_recall_summary(title, content, category, type_name, source_url)
        blob = _build_recall_blob(title, content, category, type_name, tags, source_url, summary)
        embedding = _generate_recall_embedding(blob)

        recall = RecallItem(
            user_id=user.id,
            title=title,
            category=category,
            type=type_name,
            content=content,
            tags=_tags_to_string(tags),
            priority='medium',
            pinned=pinned,
            reminder_at=reminder_at,
            status=status if status in ['active', 'archived'] else 'active',
            source_url=source_url,
            summary=summary,
            search_blob=blob,
            embedding=json.dumps(embedding) if embedding else None,
        )
        db.session.add(recall)
        db.session.commit()
        return jsonify(recall.to_dict()), 201

    # GET
    query = RecallItem.query.filter_by(user_id=user.id)
    status_filter = request.args.get('status', 'active')
    if status_filter:
        query = query.filter(RecallItem.status == status_filter)
    category = request.args.get('category')
    if category and category.lower() != 'all':
        query = query.filter(RecallItem.category.ilike(category))
    type_filter = request.args.get('type')
    if type_filter and type_filter.lower() != 'all':
        query = query.filter(RecallItem.type.ilike(type_filter))
    tag_filter = request.args.get('tag')
    if tag_filter:
        query = query.filter(RecallItem.tags.ilike(f"%{tag_filter}%"))
    pinned_only = request.args.get('pinned') in ['1', 'true', 'yes', 'on']
    if pinned_only:
        query = query.filter(RecallItem.pinned.is_(True))

    search_q = (request.args.get('q') or '').strip()
    if search_q:
        like_expr = f"%{search_q}%"
        query = query.filter(db.or_(
            RecallItem.title.ilike(like_expr),
            RecallItem.content.ilike(like_expr),
            RecallItem.category.ilike(like_expr),
            RecallItem.tags.ilike(like_expr),
            RecallItem.summary.ilike(like_expr),
        ))

    sort = request.args.get('sort', 'smart')
    if sort == 'newest':
        query = query.order_by(RecallItem.created_at.desc())
    elif sort == 'oldest':
        query = query.order_by(RecallItem.created_at.asc())
    elif sort == 'reminder':
        query = query.order_by(RecallItem.reminder_at.is_(None), RecallItem.reminder_at.asc())
    else:
        # smart: pinned desc, reminder asc, created desc
        query = query.order_by(RecallItem.pinned.desc(), RecallItem.reminder_at.is_(None), RecallItem.reminder_at.asc(), RecallItem.created_at.desc())

    recalls = query.all()
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
    if 'category' in data:
        category_val = (data.get('category') or '').strip()
        if category_val:
            recall.category = category_val
    if 'type' in data:
        type_val = (data.get('type') or '').strip()
        if type_val:
            recall.type = type_val
    if 'content' in data:
        recall.content = (data.get('content') or '').strip()
    if 'tags' in data or 'keywords' in data:
        recall.tags = _tags_to_string(data.get('keywords') or data.get('tags'))
    if 'pinned' in data:
        recall.pinned = str(data.get('pinned')).lower() in ['1', 'true', 'yes', 'on']
    if 'reminder_at' in data:
        recall.reminder_at = _parse_reminder(data.get('reminder_at'))
    if 'status' in data:
        status_val = (data.get('status') or '').strip()
        if status_val in ['active', 'archived']:
            recall.status = status_val
    if 'source_url' in data:
        recall.source_url = (data.get('source_url') or '').strip() or None
    if 'summary' in data:
        recall.summary = (data.get('summary') or '').strip() or None

    # Refresh search blob + embedding if contentful fields changed
    recall.search_blob = _build_recall_blob(
        recall.title,
        recall.content,
        recall.category,
        recall.type,
        _normalize_tags(recall.tags),
        recall.source_url,
        recall.summary
    )
    embedding = _generate_recall_embedding(recall.search_blob)
    recall.embedding = json.dumps(embedding) if embedding else None
    recall.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify(recall.to_dict())


@app.route('/api/recalls/search', methods=['POST'])
def search_recalls():
    """Semantic + keyword recall search for the AI helper and UI."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    data = request.json or {}
    query_text = (data.get('query') or '').strip()
    if not query_text:
        return jsonify({'error': 'Query is required'}), 400
    limit = data.get('limit', 6)
    try:
        limit = int(limit)
    except Exception:
        limit = 6
    limit = max(1, min(limit, 15))
    matches = _semantic_search_recalls(user.id, query_text, limit=limit, include_archived=False)
    return jsonify({'query': query_text, 'results': matches})


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
        if 'title' in data:
            note.title = (data.get('title') or '').strip() or 'Untitled Note'
        if 'content' in data:
            note.content = data.get('content', note.content)
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
        db.session.commit()
        return jsonify(note.to_dict())

    return jsonify(note.to_dict())


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
    return render_template('shared_note.html', note=note)


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

        # Also include tasks due on this day (from main task lists) as linkable entries
        due_items = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
            TodoList.user_id == user.id,
            TodoItem.due_date == day_obj,
            TodoItem.is_phase == False
        ).all()
        for idx, item in enumerate(due_items):
            payload.append({
                'id': -100000 - idx,  # synthetic id to avoid collisions
                'title': item.content,
                'status': item.status,
                'is_task_link': True,
                'task_id': item.id,
                'task_list_id': item.list_id,
                'task_list_title': item.list.title if item.list else '',
                'order_index': 100000 + idx
            })
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
        rollover_enabled=bool(data.get('rollover_enabled', False) if not is_group else False),
        order_index=_next_calendar_order(day_obj, user.id)
    )
    db.session.add(new_event)
    db.session.commit()

    # Schedule reminder job if applicable
    if new_event.reminder_minutes_before is not None and new_event.start_time:
        _schedule_reminder_job(new_event)

    return jsonify(new_event.to_dict()), 201


@app.route('/api/calendar/events/<int:event_id>', methods=['PUT', 'DELETE'])
def calendar_event_detail(event_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    event = CalendarEvent.query.filter_by(id=event_id, user_id=user.id).first_or_404()

    if request.method == 'DELETE':
        # Cancel reminder job if exists
        _cancel_reminder_job(event)
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
            event.day = new_day
            event.order_index = _next_calendar_order(new_day, user.id)
            day_changed = True
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

    # Reschedule reminder if relevant fields changed
    if (reminder_changed or time_changed or day_changed) and event.reminder_minutes_before is not None:
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
    now = datetime.now(tz).replace(tzinfo=None)

    # Get events with reminders in the next 7 days that haven't been sent yet
    end_window = now + timedelta(days=7)

    events = CalendarEvent.query.filter_by(user_id=user.id, reminder_sent=False).all()

    pending = []
    for event in events:
        if not event.start_time:
            continue

        # Combine day and time
        event_datetime = datetime.combine(event.day, event.start_time)

        # Check if snoozed
        if event.reminder_snoozed_until:
            remind_at = event.reminder_snoozed_until
        elif event.reminder_minutes_before:
            remind_at = event_datetime - timedelta(minutes=event.reminder_minutes_before)
        else:
            continue  # No reminder set

        # Only include if reminder is in the future and within our window
        if now < remind_at <= end_window:
            pending.append({
                'event_id': event.id,
                'title': event.title,
                'start_time': event.start_time.strftime('%I:%M %p'),
                'day': event.day.isoformat(),
                'remind_at': remind_at.isoformat(),
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
    new_item = TodoItem(
        list_id=list_id,
        content=content,
        description=description,
        notes=notes,
        status=status,
        order_index=next_order,
        phase_id=int(phase_id) if (phase_id and not is_phase_item) else None,
        is_phase=is_phase_item,
        due_date=due_date
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
            item.completed_at = datetime.now(pytz.UTC).replace(tzinfo=None)
        elif new_status != 'done':
            item.completed_at = None
        item.status = new_status
        item.content = data.get('content', item.content)
        item.description = data.get('description', item.description)
        item.notes = data.get('notes', item.notes)
        if 'due_date' in data:
            due_date_raw = data.get('due_date')
            item.due_date = _parse_day_value(due_date_raw) if due_date_raw else None

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
    app.run(host='0.0.0.0', port=5000)
