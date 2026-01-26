from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, date, time

db = SQLAlchemy()

task_dependencies = db.Table(
    'task_dependency',
    db.Column('task_id', db.Integer, db.ForeignKey('todo_item.id'), primary_key=True),
    db.Column('depends_on_id', db.Integer, db.ForeignKey('todo_item.id'), primary_key=True)
)


class JobLock(db.Model):
    """Simple distributed lock for background jobs to prevent concurrent execution."""
    job_name = db.Column(db.String(100), primary_key=True)
    locked_at = db.Column(db.DateTime, nullable=False)
    locked_by = db.Column(db.String(100), nullable=True)


def _split_tags(raw):
    """Normalize a comma-separated tag string into a list."""
    if not raw:
        return []
    if isinstance(raw, list):
        return [t.strip() for t in raw if t and str(t).strip()]
    return [t.strip() for t in str(raw).split(',') if t.strip()]


class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=True)
    password_hash = db.Column(db.String(200), nullable=False)
    pin_hash = db.Column(db.String(200), nullable=True)
    notes_pin_hash = db.Column(db.String(200), nullable=True)
    sidebar_order = db.Column(db.Text, nullable=True)
    homepage_order = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    lists = db.relationship('TodoList', backref='owner', lazy=True, cascade="all, delete-orphan")
    notifications = db.relationship('Notification', backref='user', lazy=True, cascade="all, delete-orphan")
    notification_settings = db.relationship('NotificationSetting', backref='user', lazy=True, cascade="all, delete-orphan")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def set_pin(self, pin: str):
        """Persist a hashed 4-digit PIN (digits only)."""
        if not pin or not str(pin).isdigit() or len(str(pin)) != 4:
            raise ValueError("PIN must be exactly 4 digits")
        self.pin_hash = generate_password_hash(str(pin))

    def check_pin(self, pin: str) -> bool:
        if not self.pin_hash:
            return False
        return check_password_hash(self.pin_hash, str(pin))

    def set_notes_pin(self, pin: str):
        """Set a separate 4-digit PIN for unlocking protected notes/folders."""
        if not pin or not str(pin).isdigit() or len(str(pin)) != 4:
            raise ValueError("PIN must be exactly 4 digits")
        self.notes_pin_hash = generate_password_hash(str(pin))

    def check_notes_pin(self, pin: str) -> bool:
        if not self.notes_pin_hash:
            return False
        return check_password_hash(self.notes_pin_hash, str(pin))

    def has_notes_pin(self) -> bool:
        return bool(self.notes_pin_hash)

class TodoList(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(100), nullable=False)
    type = db.Column(db.String(20), default='list') # 'hub', 'list', or 'light'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    order_index = db.Column(db.Integer, default=0)

    # Relationships
    items = db.relationship(
        'TodoItem',
        backref='list',
        lazy=True,
        cascade="all, delete-orphan",
        foreign_keys='TodoItem.list_id',
        order_by="TodoItem.order_index"
    )

    def get_progress(self):
        tasks_only = [i.ensure_phase_canonical() for i in self.items if not i.is_phase_header()]
        total = len(tasks_only)
        if total == 0:
            return 0

        # For items that are linked to child lists, use the child list's progress
        # as the contribution (0.0-1.0). For plain items, contribution is 1.0
        # if status == 'done' else 0.0. This gives the hub a blended progress
        # based on its child projects and simple tasks.
        total_score = 0.0
        for item in tasks_only:
            try:
                if item.linked_list:
                    # Child project contributes its progress (0.0 - 1.0)
                    total_score += item.linked_list.get_progress() / 100.0
                else:
                    # Plain task: done -> 1.0, in_progress -> 0.5, not_started -> 0.0
                    if item.status == 'done':
                        total_score += 1.0
                    elif item.status == 'in_progress':
                        total_score += 0.5
                    else:
                        total_score += 0.0
            except Exception:
                # Defensive: if linked_list lookup fails for any reason, treat
                # it as incomplete.
                total_score += 0.0

        return int((total_score / total) * 100)

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'type': self.type,
            'created_at': self.created_at.isoformat(),
            'order_index': self.order_index or 0,
            'items': [item.to_dict() for item in self.items],
            'progress': self.get_progress()
        }

class TodoItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    list_id = db.Column(db.Integer, db.ForeignKey('todo_list.id'), nullable=False)
    content = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    tags = db.Column(db.Text, nullable=True)  # comma-separated for simplicity
    status = db.Column(db.String(20), default='not_started') # 'not_started', 'in_progress', 'done'
    order_index = db.Column(db.Integer, default=0)  # For manual ordering
    is_phase = db.Column(db.Boolean, default=False)  # Track if this is a phase header
    due_date = db.Column(db.Date, nullable=True)
    completed_at = db.Column(db.DateTime, nullable=True)

    # If this item represents a child project, this links to that list
    linked_list_id = db.Column(db.Integer, db.ForeignKey('todo_list.id'), nullable=True)
    linked_list = db.relationship('TodoList', foreign_keys=[linked_list_id], post_update=True)

    # If this task belongs to a phase, track it here
    phase_id = db.Column(db.Integer, db.ForeignKey('todo_item.id'), nullable=True)
    phase = db.relationship('TodoItem', remote_side=[id], backref='phase_tasks', foreign_keys=[phase_id])
    linked_notes = db.relationship('Note', backref='task', lazy=True, foreign_keys='Note.todo_item_id')
    dependencies = db.relationship(
        'TodoItem',
        secondary=task_dependencies,
        primaryjoin=id == task_dependencies.c.task_id,
        secondaryjoin=id == task_dependencies.c.depends_on_id,
        backref='dependents'
    )

    def is_phase_header(self):
        """Canonical check for phase headers. Support legacy records where status was 'phase'."""
        return self.is_phase or self.status == 'phase'

    def ensure_phase_canonical(self):
        """Normalize legacy 'phase' status to canonical flag + not_started status (no DB commit)."""
        if self.status == 'phase':
            self.is_phase = True
            self.status = 'not_started'
        return self

    def get_phase_progress(self):
        """Calculate completion percentage for a phase based on its tasks"""
        if not self.is_phase_header():
            return 0

        tasks = [task for task in self.phase_tasks if not task.is_phase_header()]
        if not tasks:
            return 0

        done_tasks = sum(1 for task in tasks if task.status == 'done')
        return int((done_tasks / len(tasks)) * 100)

    def update_phase_status(self):
        """Automatically update phase status based on child tasks"""
        if not self.is_phase_header():
            return

        tasks = [task for task in self.phase_tasks if not task.is_phase_header()]
        if not tasks:
            return

        all_done = all(task.status == 'done' for task in tasks)
        any_in_progress = any(task.status == 'in_progress' for task in tasks)

        if all_done:
            self.status = 'done'
        elif any_in_progress:
            self.status = 'in_progress'
        else:
            self.status = 'not_started'

    def tag_list(self):
        return _split_tags(self.tags)

    def to_dict(self):
        self.ensure_phase_canonical()
        data = {
            'id': self.id,
            'list_id': self.list_id,
            'content': self.content,
            'description': self.description,
            'notes': self.notes,
            'tags': self.tag_list(),
            'status': self.status,
            'is_phase': self.is_phase,
            'phase_id': self.phase_id,
            'linked_list_id': self.linked_list_id,
            'order_index': self.order_index,
            'due_date': self.due_date.isoformat() if self.due_date else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
        }
        if self.linked_list:
            data['linked_list_type'] = self.linked_list.type
            data['linked_list_progress'] = self.linked_list.get_progress()
        if hasattr(self, 'linked_notes'):
            data['linked_note_ids'] = [n.id for n in self.linked_notes]
        if hasattr(self, 'dependencies'):
            data['dependency_ids'] = [d.id for d in self.dependencies]
        return data


class Note(db.Model):
    """Standalone rich-text note owned by a user."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    todo_item_id = db.Column(db.Integer, db.ForeignKey('todo_item.id'), nullable=True)
    calendar_event_id = db.Column(db.Integer, db.ForeignKey('calendar_event.id'), nullable=True)
    folder_id = db.Column(db.Integer, db.ForeignKey('note_folder.id'), nullable=True)
    title = db.Column(db.String(150), nullable=False, default='Untitled Note')
    content = db.Column(db.Text, nullable=True)  # Stored as HTML
    note_type = db.Column(db.String(20), nullable=False, default='note')  # note | list
    checkbox_mode = db.Column(db.Boolean, default=False)
    pinned = db.Column(db.Boolean, default=False)
    pin_order = db.Column(db.Integer, default=0)
    archived_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    share_token = db.Column(db.String(64), unique=True, nullable=True, index=True)
    is_public = db.Column(db.Boolean, default=False, nullable=False)
    is_listed = db.Column(db.Boolean, default=True, nullable=False)
    is_pin_protected = db.Column(db.Boolean, default=False, nullable=False)
    list_items = db.relationship('NoteListItem', backref='parent_note', lazy=True, cascade="all, delete-orphan", order_by="NoteListItem.order_index")

    def to_dict(self):
        note_type = self.note_type or 'note'
        return {
            'id': self.id,
            'title': self.title,
            'content': self.content or '',
            'todo_item_id': self.todo_item_id,
            'calendar_event_id': self.calendar_event_id,
            'folder_id': self.folder_id,
            'note_type': note_type,
            'checkbox_mode': bool(self.checkbox_mode) if note_type == 'list' else False,
            'pinned': bool(self.pinned),
            'pin_order': self.pin_order or 0,
            'archived_at': self.archived_at.isoformat() if self.archived_at else None,
            'is_archived': bool(self.archived_at),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'is_public': self.is_public,
            'share_token': self.share_token,
            'is_pin_protected': bool(self.is_pin_protected),
            'is_listed': bool(self.is_listed),
        }


class NoteLink(db.Model):
    """Directed link between notes for nested relationships."""
    __tablename__ = 'note_link'
    __table_args__ = (
        db.UniqueConstraint('source_note_id', 'target_note_id', name='uq_note_link_source_target'),
    )

    id = db.Column(db.Integer, primary_key=True)
    source_note_id = db.Column(db.Integer, db.ForeignKey('note.id'), nullable=False)
    target_note_id = db.Column(db.Integer, db.ForeignKey('note.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class NoteListItem(db.Model):
    """List item for a Notes list."""
    __tablename__ = 'note_list_item'

    id = db.Column(db.Integer, primary_key=True)
    note_id = db.Column(db.Integer, db.ForeignKey('note.id'), nullable=False)
    text = db.Column(db.String(300), nullable=False)
    note = db.Column(db.Text, nullable=True)
    link_text = db.Column(db.String(200), nullable=True)
    link_url = db.Column(db.String(500), nullable=True)
    checked = db.Column(db.Boolean, default=False)
    order_index = db.Column(db.Integer, default=0)

    def to_dict(self):
        return {
            'id': self.id,
            'note_id': self.note_id,
            'text': self.text,
            'note': self.note,
            'link_text': self.link_text,
            'link_url': self.link_url,
            'checked': bool(self.checked),
            'order_index': self.order_index or 0,
        }


class NoteFolder(db.Model):
    """Folder for organizing notes (can be nested)."""
    __tablename__ = 'note_folder'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    parent_id = db.Column(db.Integer, db.ForeignKey('note_folder.id'), nullable=True)
    name = db.Column(db.String(120), nullable=False)
    order_index = db.Column(db.Integer, default=0)
    is_pin_protected = db.Column(db.Boolean, default=False, nullable=False)
    archived_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'parent_id': self.parent_id,
            'name': self.name,
            'order_index': self.order_index or 0,
            'is_pin_protected': bool(self.is_pin_protected),
            'archived_at': self.archived_at.isoformat() if self.archived_at else None,
            'is_archived': bool(self.archived_at),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class RecallItem(db.Model):
    __tablename__ = 'recall_items'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    # User-entered fields
    title = db.Column(db.String(120), nullable=False)
    payload_type = db.Column(db.String(10), nullable=False)  # 'url' or 'text'
    payload = db.Column(db.Text, nullable=False)
    when_context = db.Column(db.String(30), nullable=False, default='future')

    # AI-generated fields (populated in background)
    why = db.Column(db.String(500), nullable=True)
    summary = db.Column(db.Text, nullable=True)
    ai_status = db.Column(db.String(20), default='pending')  # pending|processing|done|failed

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'why': self.why,
            'summary': self.summary,
            'ai_status': self.ai_status,
            'payload_type': self.payload_type,
            'payload': self.payload,
            'when_context': self.when_context,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }


class CalendarEvent(db.Model):
    """
    Single-day calendar entry. Supports phases (is_phase) and tasks nested via phase_id.
    All dates/times are stored as naive dates/times in server local timezone.
    """
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    day = db.Column(db.Date, nullable=False, default=date.today)
    start_time = db.Column(db.Time, nullable=True)
    end_time = db.Column(db.Time, nullable=True)
    status = db.Column(db.String(20), default='not_started')  # not_started | in_progress | done
    priority = db.Column(db.String(10), default='medium')  # low | medium | high
    is_phase = db.Column(db.Boolean, default=False)
    is_event = db.Column(db.Boolean, default=False)  # informational event (not a task)
    allow_overlap = db.Column(db.Boolean, default=False)  # allow tasks to overlap this event
    is_group = db.Column(db.Boolean, default=False)  # grouping header
    phase_id = db.Column(db.Integer, db.ForeignKey('calendar_event.id'), nullable=True)
    phase = db.relationship('CalendarEvent', remote_side=[id], backref='phase_events', foreign_keys=[phase_id])
    group_id = db.Column(db.Integer, db.ForeignKey('calendar_event.id'), nullable=True)
    group = db.relationship('CalendarEvent', remote_side=[id], backref='group_items', foreign_keys=[group_id])
    order_index = db.Column(db.Integer, default=0)
    reminder_minutes_before = db.Column(db.Integer, nullable=True)
    reminder_job_id = db.Column(db.String(255), nullable=True)
    reminder_sent = db.Column(db.Boolean, default=False)
    reminder_snoozed_until = db.Column(db.DateTime, nullable=True)
    rollover_enabled = db.Column(db.Boolean, default=False)
    rolled_from_id = db.Column(db.Integer, db.ForeignKey('calendar_event.id'), nullable=True)
    recurrence_id = db.Column(db.Integer, db.ForeignKey('recurring_event.id'), nullable=True)
    todo_item_id = db.Column(db.Integer, db.ForeignKey('todo_item.id'), nullable=True)
    recurrence = db.relationship('RecurringEvent', backref='instances', foreign_keys=[recurrence_id])
    item_note = db.Column(db.Text, nullable=True)
    notes = db.relationship('Note', backref='calendar_event', lazy=True, foreign_keys='Note.calendar_event_id')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def is_phase_header(self):
        return self.is_phase

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'title': self.title,
            'description': self.description,
            'day': self.day.isoformat() if self.day else None,
            'start_time': self.start_time.isoformat() if self.start_time else None,
            'end_time': self.end_time.isoformat() if self.end_time else None,
            'status': self.status,
            'priority': self.priority,
            'is_phase': self.is_phase,
            'is_event': self.is_event,
            'allow_overlap': self.allow_overlap,
            'is_group': self.is_group,
            'phase_id': self.phase_id,
            'group_id': self.group_id,
            'order_index': self.order_index,
            'reminder_minutes_before': self.reminder_minutes_before,
            'rollover_enabled': self.rollover_enabled,
            'rolled_from_id': self.rolled_from_id,
            'recurrence_id': self.recurrence_id,
            'todo_item_id': self.todo_item_id,
            'item_note': self.item_note,
            'linked_notes': [{'id': n.id, 'title': n.title} for n in (self.notes or [])]
        }


class RecurringEvent(db.Model):
    """Template for recurring calendar items."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    start_day = db.Column(db.Date, nullable=False)
    end_day = db.Column(db.Date, nullable=True)
    start_time = db.Column(db.Time, nullable=True)
    end_time = db.Column(db.Time, nullable=True)
    status = db.Column(db.String(20), default='not_started')
    priority = db.Column(db.String(10), default='medium')
    is_event = db.Column(db.Boolean, default=False)
    reminder_minutes_before = db.Column(db.Integer, nullable=True)
    rollover_enabled = db.Column(db.Boolean, default=False)
    frequency = db.Column(db.String(20), nullable=False)  # daily, weekly, biweekly, monthly, yearly, custom
    interval = db.Column(db.Integer, default=1)
    interval_unit = db.Column(db.String(10), nullable=True)  # days, weeks, months, years
    days_of_week = db.Column(db.String(50), nullable=True)  # CSV of 0-6
    day_of_month = db.Column(db.Integer, nullable=True)
    month_of_year = db.Column(db.Integer, nullable=True)
    week_of_month = db.Column(db.Integer, nullable=True)
    weekday_of_month = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class RecurrenceException(db.Model):
    """Skip a specific recurrence day (e.g., deleted instance)."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    recurrence_id = db.Column(db.Integer, db.ForeignKey('recurring_event.id'), nullable=False)
    day = db.Column(db.Date, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Notification(db.Model):
    """In-app/push/email notification record."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    type = db.Column(db.String(50), nullable=False, default='general')  # e.g., reminder, digest
    title = db.Column(db.String(200), nullable=False)
    body = db.Column(db.Text, nullable=True)
    link = db.Column(db.String(300), nullable=True)  # optional deep link (relative URL)
    channel = db.Column(db.String(20), nullable=True)  # in_app | email | push | mixed
    read_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'type': self.type,
            'title': self.title,
            'body': self.body,
            'link': self.link,
            'channel': self.channel,
            'read_at': self.read_at.isoformat() if self.read_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class NotificationSetting(db.Model):
    """Per-user notification preferences."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, unique=True)
    in_app_enabled = db.Column(db.Boolean, default=True)
    email_enabled = db.Column(db.Boolean, default=True)
    push_enabled = db.Column(db.Boolean, default=False)
    reminders_enabled = db.Column(db.Boolean, default=True)
    digest_enabled = db.Column(db.Boolean, default=True)
    digest_hour = db.Column(db.Integer, default=7)  # local hour for daily digest
    default_snooze_minutes = db.Column(db.Integer, default=10)  # default snooze duration
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'in_app_enabled': self.in_app_enabled,
            'email_enabled': self.email_enabled,
            'push_enabled': self.push_enabled,
            'reminders_enabled': self.reminders_enabled,
            'digest_enabled': self.digest_enabled,
            'digest_hour': self.digest_hour,
            'default_snooze_minutes': self.default_snooze_minutes,
        }


class PushSubscription(db.Model):
    """Stored Web Push subscriptions for a user (VAPID)."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    endpoint = db.Column(db.String(500), nullable=False, unique=True)
    p256dh = db.Column(db.String(255), nullable=False)
    auth = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'endpoint': self.endpoint,
            'p256dh': self.p256dh,
            'auth': self.auth,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class BookmarkItem(db.Model):
    """User's saved bookmarks for quick reference."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    value = db.Column(db.Text, nullable=False)
    pinned = db.Column(db.Boolean, default=False)
    pin_order = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'title': self.title,
            'description': self.description,
            'value': self.value,
            'pinned': bool(self.pinned),
            'pin_order': self.pin_order or 0,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class DoFeedItem(db.Model):
    """Minimal saved links to revisit in specific contexts."""
    __tablename__ = 'do_feed_item'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    url = db.Column(db.String(600), nullable=False)
    description = db.Column(db.Text, nullable=True)
    state = db.Column(db.String(40), nullable=False, default='free')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'title': self.title,
            'url': self.url,
            'description': self.description,
            'state': self.state,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class EmbeddingRecord(db.Model):
    """Stored embeddings for semantic search across app entities."""
    __tablename__ = 'embedding_record'
    __table_args__ = (
        db.UniqueConstraint('user_id', 'entity_type', 'entity_id', name='uniq_embedding_entity'),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    entity_type = db.Column(db.String(30), nullable=False)
    entity_id = db.Column(db.Integer, nullable=False)
    embedding_json = db.Column(db.Text, nullable=True)
    embedding_dim = db.Column(db.Integer, nullable=True)
    source_hash = db.Column(db.String(64), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'entity_type': self.entity_type,
            'entity_id': self.entity_id,
            'embedding_dim': self.embedding_dim,
            'source_hash': self.source_hash,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class QuickAccessItem(db.Model):
    """User's quick access pinned items."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    icon = db.Column(db.String(50), nullable=False, default='fa-solid fa-bookmark')
    url = db.Column(db.String(500), nullable=False)
    item_type = db.Column(db.String(30), nullable=False, default='custom')  # custom | list | note | calendar | system
    reference_id = db.Column(db.Integer, nullable=True)  # ID of referenced list/note/event if applicable
    order_index = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'title': self.title,
            'icon': self.icon,
            'url': self.url,
            'item_type': self.item_type,
            'reference_id': self.reference_id,
            'order_index': self.order_index,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class DocumentFolder(db.Model):
    """Folder for organizing documents in the vault (can be nested)."""
    __tablename__ = 'document_folder'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    parent_id = db.Column(db.Integer, db.ForeignKey('document_folder.id'), nullable=True)
    name = db.Column(db.String(120), nullable=False)
    order_index = db.Column(db.Integer, default=0)
    archived_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Self-referential relationship for nested folders
    children = db.relationship('DocumentFolder', backref=db.backref('parent', remote_side=[id]), lazy=True)
    documents = db.relationship('Document', backref='folder', lazy=True)

    def to_dict(self, include_children=False):
        data = {
            'id': self.id,
            'parent_id': self.parent_id,
            'name': self.name,
            'order_index': self.order_index or 0,
            'archived_at': self.archived_at.isoformat() if self.archived_at else None,
            'is_archived': bool(self.archived_at),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_children:
            data['children'] = [c.to_dict(include_children=True) for c in self.children if not c.archived_at]
        return data


class Document(db.Model):
    """Document stored in the vault."""
    __tablename__ = 'document'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    folder_id = db.Column(db.Integer, db.ForeignKey('document_folder.id'), nullable=True)
    title = db.Column(db.String(255), nullable=False)
    original_filename = db.Column(db.String(255), nullable=False)
    stored_filename = db.Column(db.String(255), nullable=False)  # UUID-based filename on disk
    file_type = db.Column(db.String(100), nullable=True)  # MIME type
    file_extension = db.Column(db.String(20), nullable=True)  # e.g., 'pdf', 'jpg'
    file_size = db.Column(db.Integer, nullable=True)  # Size in bytes
    tags = db.Column(db.Text, nullable=True)  # Comma-separated tags
    pinned = db.Column(db.Boolean, default=False)
    pin_order = db.Column(db.Integer, default=0)
    archived_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def tag_list(self):
        return _split_tags(self.tags)

    def get_file_category(self):
        """Return a category based on file extension for icon display."""
        ext = (self.file_extension or '').lower()
        if ext in ('jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'):
            return 'image'
        elif ext in ('pdf',):
            return 'pdf'
        elif ext in ('doc', 'docx', 'odt', 'rtf'):
            return 'document'
        elif ext in ('xls', 'xlsx', 'ods', 'csv'):
            return 'spreadsheet'
        elif ext in ('ppt', 'pptx', 'odp'):
            return 'presentation'
        elif ext in ('txt', 'md', 'json', 'xml', 'yaml', 'yml'):
            return 'text'
        elif ext in ('zip', 'rar', '7z', 'tar', 'gz', 'bz2'):
            return 'archive'
        elif ext in ('mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'):
            return 'audio'
        elif ext in ('mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv'):
            return 'video'
        elif ext in ('js', 'py', 'html', 'css', 'java', 'cpp', 'c', 'h', 'ts', 'jsx', 'tsx', 'go', 'rs', 'rb', 'php'):
            return 'code'
        else:
            return 'other'

    def format_file_size(self):
        """Return human-readable file size."""
        if not self.file_size:
            return 'Unknown'
        size = self.file_size
        for unit in ('B', 'KB', 'MB', 'GB'):
            if size < 1024:
                return f"{size:.1f} {unit}" if unit != 'B' else f"{size} {unit}"
            size /= 1024
        return f"{size:.1f} TB"

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'folder_id': self.folder_id,
            'title': self.title,
            'original_filename': self.original_filename,
            'stored_filename': self.stored_filename,
            'file_type': self.file_type,
            'file_extension': self.file_extension,
            'file_size': self.file_size,
            'file_size_formatted': self.format_file_size(),
            'file_category': self.get_file_category(),
            'tags': self.tag_list(),
            'pinned': bool(self.pinned),
            'pin_order': self.pin_order or 0,
            'archived_at': self.archived_at.isoformat() if self.archived_at else None,
            'is_archived': bool(self.archived_at),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
