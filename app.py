from flask import Flask, render_template, request, jsonify, redirect, url_for
from models import db, TodoList, TodoItem
import os

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///todo.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

with app.app_context():
    db.create_all()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/list/<int:list_id>')
def list_view(list_id):
    todo_list = TodoList.query.get_or_404(list_id)
    
    # Find parent if exists (if this list is linked by an item)
    parent_item = TodoItem.query.filter_by(linked_list_id=list_id).first()
    parent_list = parent_item.list if parent_item else None
    
    return render_template('list_view.html', todo_list=todo_list, parent_list=parent_list)

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
    lists = TodoList.query.outerjoin(TodoItem, TodoList.id == TodoItem.linked_list_id).filter(TodoItem.id == None).all()
    return jsonify([l.to_dict() for l in lists])

@app.route('/api/lists/<int:list_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_list(list_id):
    todo_list = TodoList.query.get_or_404(list_id)
    
    if request.method == 'DELETE':
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
    data = request.json
    content = data['content']
    description = data.get('description', '')
    notes = data.get('notes', '')
    is_project = data.get('is_project', False)
    
    new_item = TodoItem(list_id=list_id, content=content, description=description, notes=notes)
    
    if is_project:
        # Automatically create a child list
        child_list = TodoList(title=content, type='list')
        db.session.add(child_list)
        db.session.flush() # Get ID
        new_item.linked_list_id = child_list.id
        
    db.session.add(new_item)
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
        item.status = data.get('status', item.status)
        item.content = data.get('content', item.content)
        item.description = data.get('description', item.description)
        item.notes = data.get('notes', item.notes)
        db.session.commit()
        return jsonify(item.to_dict())

if __name__ == '__main__':
    app.run(debug=True)
