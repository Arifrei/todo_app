"""
Baseline migration for a fresh database.

Run once on a new install:
    python migrate.py

Creates/aligns all core tables to the current models:
- user
- todo_list
- todo_item
- note
- calendar_event
The script is idempotent: it only adds missing tables/columns and backfills
order indexes and legacy statuses.
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


def ensure_user_table(cur):
    if table_exists(cur, "user"):
        print("[ok] user table exists")
        return
    cur.execute(
        """
        CREATE TABLE user (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username VARCHAR(80) UNIQUE NOT NULL,
            email VARCHAR(120) UNIQUE,
            password_hash VARCHAR(200) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    print("[add] user table created")


def ensure_todo_list_table(cur):
    if not table_exists(cur, "todo_list"):
        cur.execute(
            """
            CREATE TABLE todo_list (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title VARCHAR(100) NOT NULL,
                type VARCHAR(20) DEFAULT 'list',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                user_id INTEGER NOT NULL
            )
            """
        )
        print("[add] todo_list table created")
        return
    add_column(cur, "todo_list", "user_id", "INTEGER", default_sql="1")


def ensure_todo_item_table(cur):
    if not table_exists(cur, "todo_item"):
        cur.execute(
            """
            CREATE TABLE todo_item (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                list_id INTEGER NOT NULL,
                content VARCHAR(200) NOT NULL,
                description TEXT,
                notes TEXT,
                status VARCHAR(20) DEFAULT 'not_started',
                order_index INTEGER DEFAULT 0,
                is_phase BOOLEAN DEFAULT 0,
                due_date DATE,
                linked_list_id INTEGER,
                phase_id INTEGER
            )
            """
        )
        print("[add] todo_item table created")
        return

    add_column(cur, "todo_item", "description", "TEXT")
    add_column(cur, "todo_item", "notes", "TEXT")
    add_column(cur, "todo_item", "order_index", "INTEGER DEFAULT 0")
    add_column(cur, "todo_item", "is_phase", "BOOLEAN DEFAULT 0")
    add_column(cur, "todo_item", "phase_id", "INTEGER")
    add_column(cur, "todo_item", "due_date", "DATE")
    add_column(cur, "todo_item", "linked_list_id", "INTEGER")

    # Normalize legacy status
    cur.execute("UPDATE todo_item SET status='not_started' WHERE status='pending'")
    # Backfill order_index per list
    rows = cur.execute("SELECT id, list_id FROM todo_item ORDER BY list_id, id").fetchall()
    counters = {}
    for item_id, list_id in rows:
        idx = counters.get(list_id, 1)
        cur.execute("UPDATE todo_item SET order_index=? WHERE id=?", (idx, item_id))
        counters[list_id] = idx + 1
    print("[update] todo_item order_index backfilled")


def ensure_note_table(cur):
    if not table_exists(cur, "note"):
        cur.execute(
            """
            CREATE TABLE note (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                todo_item_id INTEGER,
                calendar_event_id INTEGER,
                title VARCHAR(150) NOT NULL DEFAULT 'Untitled Note',
                content TEXT,
                pinned BOOLEAN DEFAULT 0,
                pin_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                share_token VARCHAR(64) UNIQUE,
                is_public BOOLEAN DEFAULT 0 NOT NULL
            )
            """
        )
        print("[add] note table created")
        # Create index on share_token
        cur.execute("CREATE INDEX IF NOT EXISTS idx_note_share_token ON note(share_token)")
        return
    add_column(cur, "note", "todo_item_id", "INTEGER")
    add_column(cur, "note", "calendar_event_id", "INTEGER")
    add_column(cur, "note", "title", "VARCHAR(150) NOT NULL DEFAULT 'Untitled Note'")
    add_column(cur, "note", "content", "TEXT")
    add_column(cur, "note", "pinned", "BOOLEAN DEFAULT 0")
    add_column(cur, "note", "pin_order", "INTEGER DEFAULT 0")
    add_column(cur, "note", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "note", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "note", "share_token", "VARCHAR(64)")
    add_column(cur, "note", "is_public", "BOOLEAN DEFAULT 0 NOT NULL")
    # Create index on share_token if it doesn't exist
    cur.execute("CREATE INDEX IF NOT EXISTS idx_note_share_token ON note(share_token)")


def ensure_calendar_event_table(cur):
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
                reminder_job_id VARCHAR(255),
                reminder_sent BOOLEAN DEFAULT 0,
                reminder_snoozed_until TIMESTAMP,
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


def ensure_recall_table(cur):
    """Create or align the recalls table used for the Recall module."""
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


def ensure_notification_tables(cur):
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
                default_snooze_minutes INTEGER DEFAULT 10,
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

    # Push subscriptions
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
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    try:
        ensure_user_table(cur)
        ensure_todo_list_table(cur)
        ensure_todo_item_table(cur)
        ensure_note_table(cur)
        ensure_calendar_event_table(cur)
        ensure_recall_table(cur)
        ensure_notification_tables(cur)
        conn.commit()
        print("Baseline migration complete.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
