"""
Post-baseline migrations for databases created at commit c4b057d2c4fcbf07a778584c20b741946cf33a0a.

Run when upgrading an existing deployment:
    python global_migrations.py

Idempotent updates:
- Ensure todo_item has description, notes, order_index, is_phase, phase_id, due_date, linked_list_id
- Normalize legacy pending -> not_started and backfill order_index
- Ensure todo_list has user_id
- Ensure note has todo_item_id, calendar_event_id, title/content timestamps
- Ensure calendar_event table exists with all current columns (is_event, is_group, group_id, priority, status, reminder_minutes_before, rollover_enabled, timestamps)
"""
import sqlite3
from pathlib import Path

DB_PATH = Path("instance") / "todo.db"


def table_exists(cur, name: str) -> bool:
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,))
    return cur.fetchone() is not None


def column_exists(cur, table: str, column: str) -> bool:
    cur.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cur.fetchall())


def add_column(cur, table: str, column: str, col_type: str, default_sql: str | None = None):
    if column_exists(cur, table, column):
        print(f"[skip] {table}.{column} exists")
        return
    cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
    if default_sql is not None:
        cur.execute(f"UPDATE {table} SET {column} = {default_sql} WHERE {column} IS NULL")
    print(f"[add] {table}.{column}")


def ensure_todo_list(cur):
    if not table_exists(cur, "todo_list"):
        print("[warn] todo_list missing; run baseline migrate.py first")
        return
    add_column(cur, "todo_list", "user_id", "INTEGER", default_sql="1")


def ensure_user(cur):
    if not table_exists(cur, "user"):
        print("[warn] user table missing; run baseline migrate.py first")
        return
    add_column(cur, "user", "pin_hash", "VARCHAR(200)")


def ensure_todo_item(cur):
    if not table_exists(cur, "todo_item"):
        print("[warn] todo_item missing; run baseline migrate.py first")
        return
    add_column(cur, "todo_item", "description", "TEXT")
    add_column(cur, "todo_item", "notes", "TEXT")
    add_column(cur, "todo_item", "order_index", "INTEGER DEFAULT 0")
    add_column(cur, "todo_item", "is_phase", "BOOLEAN DEFAULT 0")
    add_column(cur, "todo_item", "phase_id", "INTEGER")
    add_column(cur, "todo_item", "due_date", "DATE")
    add_column(cur, "todo_item", "linked_list_id", "INTEGER")

    cur.execute("UPDATE todo_item SET status='not_started' WHERE status='pending'")


def ensure_note(cur):
    if not table_exists(cur, "note"):
        print("[warn] note table missing; run baseline migrate.py first")
        return
    add_column(cur, "note", "todo_item_id", "INTEGER")
    add_column(cur, "note", "calendar_event_id", "INTEGER")
    add_column(cur, "note", "title", "VARCHAR(150) NOT NULL DEFAULT 'Untitled Note'")
    add_column(cur, "note", "content", "TEXT")
    add_column(cur, "note", "pinned", "BOOLEAN DEFAULT 0")
    add_column(cur, "note", "pin_order", "INTEGER DEFAULT 0")
    add_column(cur, "note", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "note", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")


def ensure_calendar_event(cur):
    if not table_exists(cur, "calendar_event"):
        cur.execute(
            """
            CREATE TABLE calendar_event (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                day DATE NOT NULL,
                start_time TIME,
                end_time TIME,
                status VARCHAR(20) DEFAULT 'not_started',
                priority VARCHAR(10) DEFAULT 'medium',
                is_phase BOOLEAN DEFAULT 0,
                is_event BOOLEAN DEFAULT 0,
                is_group BOOLEAN DEFAULT 0,
                phase_id INTEGER,
                group_id INTEGER,
                order_index INTEGER DEFAULT 0,
                reminder_minutes_before INTEGER,
                rollover_enabled BOOLEAN DEFAULT 1,
                rolled_from_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        print("[add] calendar_event table created")
        return

    add_column(cur, "calendar_event", "description", "TEXT")
    add_column(cur, "calendar_event", "is_phase", "BOOLEAN DEFAULT 0")
    add_column(cur, "calendar_event", "is_event", "BOOLEAN DEFAULT 0")
    add_column(cur, "calendar_event", "is_group", "BOOLEAN DEFAULT 0")
    add_column(cur, "calendar_event", "phase_id", "INTEGER")
    add_column(cur, "calendar_event", "group_id", "INTEGER")
    add_column(cur, "calendar_event", "order_index", "INTEGER DEFAULT 0")
    add_column(cur, "calendar_event", "reminder_minutes_before", "INTEGER")
    add_column(cur, "calendar_event", "reminder_job_id", "VARCHAR(255)")
    add_column(cur, "calendar_event", "reminder_sent", "BOOLEAN DEFAULT 0")
    add_column(cur, "calendar_event", "reminder_snoozed_until", "TIMESTAMP")
    add_column(cur, "calendar_event", "rollover_enabled", "BOOLEAN DEFAULT 1")
    add_column(cur, "calendar_event", "rolled_from_id", "INTEGER")
    add_column(cur, "calendar_event", "priority", "VARCHAR(10) DEFAULT 'medium'")
    add_column(cur, "calendar_event", "status", "VARCHAR(20) DEFAULT 'not_started'")
    add_column(cur, "calendar_event", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "calendar_event", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")


def ensure_recalls(cur):
    if not table_exists(cur, "recall_item"):
        cur.execute(
            """
            CREATE TABLE recall_item (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title VARCHAR(200) NOT NULL,
                category VARCHAR(80) NOT NULL DEFAULT 'General',
                type VARCHAR(30) NOT NULL DEFAULT 'note',
                content TEXT,
                tags TEXT,
                priority VARCHAR(10) NOT NULL DEFAULT 'medium',
                pinned BOOLEAN DEFAULT 0,
                reminder_at TIMESTAMP,
                status VARCHAR(20) NOT NULL DEFAULT 'active',
                source_url VARCHAR(400),
                summary TEXT,
                search_blob TEXT,
                embedding TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        print("[add] recall_item table created")
        return

    add_column(cur, "recall_item", "category", "VARCHAR(80) NOT NULL DEFAULT 'General'")
    add_column(cur, "recall_item", "type", "VARCHAR(30) NOT NULL DEFAULT 'note'")
    add_column(cur, "recall_item", "content", "TEXT")
    add_column(cur, "recall_item", "tags", "TEXT")
    add_column(cur, "recall_item", "priority", "VARCHAR(10) NOT NULL DEFAULT 'medium'")
    add_column(cur, "recall_item", "pinned", "BOOLEAN DEFAULT 0")
    add_column(cur, "recall_item", "reminder_at", "TIMESTAMP")
    add_column(cur, "recall_item", "status", "VARCHAR(20) NOT NULL DEFAULT 'active'")
    add_column(cur, "recall_item", "source_url", "VARCHAR(400)")
    add_column(cur, "recall_item", "summary", "TEXT")
    add_column(cur, "recall_item", "search_blob", "TEXT")
    add_column(cur, "recall_item", "embedding", "TEXT")
    add_column(cur, "recall_item", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "recall_item", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")


def ensure_notifications(cur):
    if not table_exists(cur, "notification"):
        cur.execute(
            """
            CREATE TABLE notification (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type VARCHAR(50) NOT NULL DEFAULT 'general',
                title VARCHAR(200) NOT NULL,
                body TEXT,
                link VARCHAR(300),
                channel VARCHAR(20),
                read_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        print("[add] notification table created")
    else:
        add_column(cur, "notification", "type", "VARCHAR(50) NOT NULL DEFAULT 'general'")
        add_column(cur, "notification", "title", "VARCHAR(200) NOT NULL DEFAULT ''")
        add_column(cur, "notification", "body", "TEXT")
        add_column(cur, "notification", "link", "VARCHAR(300)")
        add_column(cur, "notification", "channel", "VARCHAR(20)")
        add_column(cur, "notification", "read_at", "TIMESTAMP")
        add_column(cur, "notification", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")

    if not table_exists(cur, "notification_setting"):
        cur.execute(
            """
            CREATE TABLE notification_setting (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE,
                in_app_enabled BOOLEAN DEFAULT 1,
                email_enabled BOOLEAN DEFAULT 1,
                push_enabled BOOLEAN DEFAULT 0,
                reminders_enabled BOOLEAN DEFAULT 1,
                digest_enabled BOOLEAN DEFAULT 1,
                digest_hour INTEGER DEFAULT 7,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        print("[add] notification_setting table created")
    else:
        add_column(cur, "notification_setting", "in_app_enabled", "BOOLEAN DEFAULT 1")
        add_column(cur, "notification_setting", "email_enabled", "BOOLEAN DEFAULT 1")
        add_column(cur, "notification_setting", "push_enabled", "BOOLEAN DEFAULT 0")
        add_column(cur, "notification_setting", "reminders_enabled", "BOOLEAN DEFAULT 1")
        add_column(cur, "notification_setting", "digest_enabled", "BOOLEAN DEFAULT 1")
        add_column(cur, "notification_setting", "digest_hour", "INTEGER DEFAULT 7")
        add_column(cur, "notification_setting", "default_snooze_minutes", "INTEGER DEFAULT 10")
        add_column(cur, "notification_setting", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
        add_column(cur, "notification_setting", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")

    if not table_exists(cur, "push_subscription"):
        cur.execute(
            """
            CREATE TABLE push_subscription (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                endpoint VARCHAR(500) NOT NULL UNIQUE,
                p256dh VARCHAR(255) NOT NULL,
                auth VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        print("[add] push_subscription table created")
    else:
        add_column(cur, "push_subscription", "user_id", "INTEGER")
        add_column(cur, "push_subscription", "endpoint", "VARCHAR(500)")
        add_column(cur, "push_subscription", "p256dh", "VARCHAR(255)")
        add_column(cur, "push_subscription", "auth", "VARCHAR(255)")
        add_column(cur, "push_subscription", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")


def main():
    if not DB_PATH.exists():
        print("Database not found. Run baseline migrate.py first.")
        return
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    try:
        ensure_user(cur)
        ensure_todo_list(cur)
        ensure_todo_item(cur)
        ensure_note(cur)
        ensure_calendar_event(cur)
        ensure_recalls(cur)
        ensure_notifications(cur)
        conn.commit()
        print("Global migrations complete.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
