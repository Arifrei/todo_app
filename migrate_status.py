from app import app, db, TodoItem

with app.app_context():
    items = TodoItem.query.filter_by(status='pending').all()
    print(f"Found {len(items)} items to update.")
    for item in items:
        item.status = 'not_started'
    db.session.commit()
    print("Update complete.")
