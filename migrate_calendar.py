"""
Create the calendar_event table if it does not exist.
Usage:  python migrate_calendar.py
"""
from app import app, db
from models import CalendarEvent


def main():
    with app.app_context():
        CalendarEvent.__table__.create(db.engine, checkfirst=True)
        print("calendar_event table is ensured.")


if __name__ == '__main__':
    main()
