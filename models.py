from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class TodoList(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(100), nullable=False)
    type = db.Column(db.String(20), default='list') # 'hub' or 'list'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    items = db.relationship('TodoItem', backref='list', lazy=True, cascade="all, delete-orphan", foreign_keys='TodoItem.list_id')

    def get_progress(self):
        total = len(self.items)
        if total == 0:
            return 0
        done = sum(1 for item in self.items if item.status == 'done')
        return int((done / total) * 100)

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
    status = db.Column(db.String(20), default='pending') # 'pending', 'in_progress', 'done'
    
    # If this item represents a child project, this links to that list
    linked_list_id = db.Column(db.Integer, db.ForeignKey('todo_list.id'), nullable=True)
    linked_list = db.relationship('TodoList', foreign_keys=[linked_list_id], post_update=True)

    def to_dict(self):
        data = {
            'id': self.id,
            'list_id': self.list_id,
            'content': self.content,
            'status': self.status,
            'linked_list_id': self.linked_list_id
        }
        if self.linked_list:
            data['linked_list_progress'] = self.linked_list.get_progress()
        return data
