from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class TodoList(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(100), nullable=False)
    type = db.Column(db.String(20), default='list') # 'hub' or 'list'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
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
    status = db.Column(db.String(20), default='not_started') # 'not_started', 'in_progress', 'done'
    order_index = db.Column(db.Integer, default=0)  # For manual ordering
    
    # If this item represents a child project, this links to that list
    linked_list_id = db.Column(db.Integer, db.ForeignKey('todo_list.id'), nullable=True)
    linked_list = db.relationship('TodoList', foreign_keys=[linked_list_id], post_update=True)

    def to_dict(self):
        data = {
            'id': self.id,
            'list_id': self.list_id,
            'content': self.content,
            'status': self.status,
            'linked_list_id': self.linked_list_id,
            'order_index': self.order_index
        }
        if self.linked_list:
            data['linked_list_progress'] = self.linked_list.get_progress()
        return data
