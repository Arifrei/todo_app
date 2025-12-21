"""
Create the calendar_event table if it does not exist.
Usage:  python migrate_calendar.py
"""
from app import app, db
from models import CalendarEvent


def main():
    with app.app_context():
        CalendarEvent.__table__.create(db.engine, checkfirst=True)
        # Backfill new columns added after initial creation
        conn = db.engine.connect()
        try:
            cols = {row[1] for row in conn.execute(db.text("PRAGMA table_info(calendar_event)"))}
            if 'is_event' not in cols:
                conn.execute(db.text("ALTER TABLE calendar_event ADD COLUMN is_event BOOLEAN DEFAULT 0"))
                conn.execute(db.text("UPDATE calendar_event SET is_event = 0 WHERE is_event IS NULL"))
                print("Added calendar_event.is_event column")
            if 'is_group' not in cols:
                conn.execute(db.text("ALTER TABLE calendar_event ADD COLUMN is_group BOOLEAN DEFAULT 0"))
                conn.execute(db.text("UPDATE calendar_event SET is_group = 0 WHERE is_group IS NULL"))
                print("Added calendar_event.is_group column")
            if 'group_id' not in cols:
                conn.execute(db.text("ALTER TABLE calendar_event ADD COLUMN group_id INTEGER"))
                print("Added calendar_event.group_id column")
            print("calendar_event table is ensured.")
        finally:
            conn.close()


if __name__ == '__main__':
    main()
