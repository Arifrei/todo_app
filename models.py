from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, date, time

db = SQLAlchemy()


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

class TodoList(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(100), nullable=False)
    type = db.Column(db.String(20), default='list') # 'hub' or 'list'
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
        return data


class Note(db.Model):
    """Standalone rich-text note owned by a user."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    todo_item_id = db.Column(db.Integer, db.ForeignKey('todo_item.id'), nullable=True)
    calendar_event_id = db.Column(db.Integer, db.ForeignKey('calendar_event.id'), nullable=True)
    title = db.Column(db.String(150), nullable=False, default='Untitled Note')
    content = db.Column(db.Text, nullable=True)  # Stored as HTML
    pinned = db.Column(db.Boolean, default=False)
    pin_order = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    share_token = db.Column(db.String(64), unique=True, nullable=True, index=True)
    is_public = db.Column(db.Boolean, default=False, nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'content': self.content or '',
            'todo_item_id': self.todo_item_id,
            'calendar_event_id': self.calendar_event_id,
            'pinned': bool(self.pinned),
            'pin_order': self.pin_order or 0,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'is_public': self.is_public,
            'share_token': self.share_token,
        }


class RecallItem(db.Model):
    __tablename__ = 'recall_items'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    # User-entered fields
    title = db.Column(db.String(120), nullable=False)
    payload_type = db.Column(db.String(10), nullable=False)  # 'url' or 'text'
    payload = db.Column(db.Text, nullable=False)
    when_context = db.Column(db.String(30), nullable=False)

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
            'is_group': self.is_group,
            'phase_id': self.phase_id,
            'group_id': self.group_id,
            'order_index': self.order_index,
            'reminder_minutes_before': self.reminder_minutes_before,
            'rollover_enabled': self.rollover_enabled,
            'rolled_from_id': self.rolled_from_id,
            'recurrence_id': self.recurrence_id,
            'todo_item_id': self.todo_item_id,
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
