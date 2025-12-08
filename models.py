from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime

db = SQLAlchemy()

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=True)
    password_hash = db.Column(db.String(200), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    lists = db.relationship('TodoList', backref='owner', lazy=True, cascade="all, delete-orphan")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class TodoList(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(100), nullable=False)
    type = db.Column(db.String(20), default='list') # 'hub' or 'list'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

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
        total = len(self.items)
        if total == 0:
            return 0

        # For items that are linked to child lists, use the child list's progress
        # as the contribution (0.0-1.0). For plain items, contribution is 1.0
        # if status == 'done' else 0.0. This gives the hub a blended progress
        # based on its child projects and simple tasks.
        total_score = 0.0
        for item in self.items:
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
            'items': [item.to_dict() for item in self.items],
            'progress': self.get_progress()
        }

class TodoItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    list_id = db.Column(db.Integer, db.ForeignKey('todo_list.id'), nullable=False)
    content = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), default='not_started') # 'not_started', 'in_progress', 'done', 'phase'
    order_index = db.Column(db.Integer, default=0)  # For manual ordering
    is_phase = db.Column(db.Boolean, default=False)  # Track if this is a phase header

    # If this item represents a child project, this links to that list
    linked_list_id = db.Column(db.Integer, db.ForeignKey('todo_list.id'), nullable=True)
    linked_list = db.relationship('TodoList', foreign_keys=[linked_list_id], post_update=True)

    # If this task belongs to a phase, track it here
    phase_id = db.Column(db.Integer, db.ForeignKey('todo_item.id'), nullable=True)
    phase = db.relationship('TodoItem', remote_side=[id], backref='phase_tasks', foreign_keys=[phase_id])

    def get_phase_progress(self):
        """Calculate completion percentage for a phase based on its tasks"""
        if not self.is_phase:
            return 0

        tasks = [task for task in self.phase_tasks if not task.is_phase]
        if not tasks:
            return 0

        done_tasks = sum(1 for task in tasks if task.status == 'done')
        return int((done_tasks / len(tasks)) * 100)

    def update_phase_status(self):
        """Automatically update phase status based on child tasks"""
        if not self.is_phase:
            return

        tasks = [task for task in self.phase_tasks if not task.is_phase]
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

    def to_dict(self):
        data = {
            'id': self.id,
            'list_id': self.list_id,
            'content': self.content,
            'status': self.status,
            'is_phase': self.is_phase,
            'linked_list_id': self.linked_list_id,
            'order_index': self.order_index
        }
        if self.linked_list:
            data['linked_list_progress'] = self.linked_list.get_progress()
        return data


class Note(db.Model):
    """Standalone rich-text note owned by a user."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(150), nullable=False, default='Untitled Note')
    content = db.Column(db.Text, nullable=True)  # Stored as HTML
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'content': self.content or '',
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
