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
- recall_items
- bookmark_item
- do_feed_item
- planner_folder
- planner_simple_item
- planner_group
- planner_multi_item
- planner_multi_line
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
        add_column(cur, "user", "pin_hash", "VARCHAR(200)")
        add_column(cur, "user", "notes_pin_hash", "VARCHAR(200)")
        add_column(cur, "user", "sidebar_order", "TEXT")
        add_column(cur, "user", "homepage_order", "TEXT")
        print("[ok] user table exists")
        return
    cur.execute(
        """
        CREATE TABLE user (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username VARCHAR(80) UNIQUE NOT NULL,
            email VARCHAR(120) UNIQUE,
            password_hash VARCHAR(200) NOT NULL,
            pin_hash VARCHAR(200),
            notes_pin_hash VARCHAR(200),
            sidebar_order TEXT,
            homepage_order TEXT,
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
                user_id INTEGER NOT NULL,
                order_index INTEGER DEFAULT 0
            )
            """
        )
        print("[add] todo_list table created")
        return
    add_column(cur, "todo_list", "user_id", "INTEGER", default_sql="1")
    add_column(cur, "todo_list", "order_index", "INTEGER DEFAULT 0")
    cur.execute("UPDATE todo_list SET order_index = id WHERE order_index IS NULL")


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
                tags TEXT,
                status VARCHAR(20) DEFAULT 'not_started',
                order_index INTEGER DEFAULT 0,
                is_phase BOOLEAN DEFAULT 0,
                due_date DATE,
                completed_at TIMESTAMP,
                linked_list_id INTEGER,
                phase_id INTEGER
            )
            """
        )
        print("[add] todo_item table created")
        return

    add_column(cur, "todo_item", "description", "TEXT")
    add_column(cur, "todo_item", "notes", "TEXT")
    add_column(cur, "todo_item", "tags", "TEXT")
    add_column(cur, "todo_item", "order_index", "INTEGER DEFAULT 0")
    add_column(cur, "todo_item", "is_phase", "BOOLEAN DEFAULT 0")
    add_column(cur, "todo_item", "phase_id", "INTEGER")
    add_column(cur, "todo_item", "due_date", "DATE")
    add_column(cur, "todo_item", "completed_at", "TIMESTAMP")
    add_column(cur, "todo_item", "linked_list_id", "INTEGER")

    # Normalize legacy status
    cur.execute("UPDATE todo_item SET status='not_started' WHERE status='pending'")
    # Seed completion timestamps for existing done tasks so cleanup can start.
    cur.execute(
        "UPDATE todo_item SET completed_at = CURRENT_TIMESTAMP "
        "WHERE status='done' AND completed_at IS NULL"
    )


def ensure_task_dependency_table(cur):
    if table_exists(cur, "task_dependency"):
        cur.execute("CREATE INDEX IF NOT EXISTS idx_task_dependency_task ON task_dependency(task_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_task_dependency_depends ON task_dependency(depends_on_id)")
        print("[ok] task_dependency table exists")
        return
    cur.execute(
        """
        CREATE TABLE task_dependency (
            task_id INTEGER NOT NULL,
            depends_on_id INTEGER NOT NULL,
            PRIMARY KEY (task_id, depends_on_id)
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_task_dependency_task ON task_dependency(task_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_task_dependency_depends ON task_dependency(depends_on_id)")
    print("[add] task_dependency table created")


def ensure_note_table(cur):
    if not table_exists(cur, "note"):
        cur.execute(
            """
            CREATE TABLE note (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                todo_item_id INTEGER,
                calendar_event_id INTEGER,
                folder_id INTEGER,
                title VARCHAR(150) NOT NULL DEFAULT 'Untitled Note',
                content TEXT,
                note_type VARCHAR(20) NOT NULL DEFAULT 'note',
                checkbox_mode BOOLEAN DEFAULT 0,
                pinned BOOLEAN DEFAULT 0,
                pin_order INTEGER DEFAULT 0,
                archived_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                share_token VARCHAR(64) UNIQUE,
                is_public BOOLEAN DEFAULT 0 NOT NULL,
                is_listed BOOLEAN DEFAULT 1 NOT NULL,
                is_pin_protected BOOLEAN DEFAULT 0 NOT NULL
            )
            """
        )
        print("[add] note table created")
        # Create index on share_token
        cur.execute("CREATE INDEX IF NOT EXISTS idx_note_share_token ON note(share_token)")
        return
    add_column(cur, "note", "todo_item_id", "INTEGER")
    add_column(cur, "note", "calendar_event_id", "INTEGER")
    add_column(cur, "note", "folder_id", "INTEGER")
    add_column(cur, "note", "title", "VARCHAR(150) NOT NULL DEFAULT 'Untitled Note'")
    add_column(cur, "note", "content", "TEXT")
    add_column(cur, "note", "note_type", "VARCHAR(20) NOT NULL DEFAULT 'note'", default_sql="'note'")
    add_column(cur, "note", "checkbox_mode", "BOOLEAN DEFAULT 0", default_sql="0")
    add_column(cur, "note", "pinned", "BOOLEAN DEFAULT 0")
    add_column(cur, "note", "pin_order", "INTEGER DEFAULT 0")
    add_column(cur, "note", "archived_at", "TIMESTAMP")
    add_column(cur, "note", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "note", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "note", "share_token", "VARCHAR(64)")
    add_column(cur, "note", "is_public", "BOOLEAN DEFAULT 0 NOT NULL")
    add_column(cur, "note", "is_listed", "BOOLEAN DEFAULT 1 NOT NULL", default_sql="1")
    add_column(cur, "note", "is_pin_protected", "BOOLEAN DEFAULT 0 NOT NULL")
    # Create index on share_token if it doesn't exist
    cur.execute("CREATE INDEX IF NOT EXISTS idx_note_share_token ON note(share_token)")


def ensure_note_list_item_table(cur):
    if not table_exists(cur, "note_list_item"):
        cur.execute(
            """
            CREATE TABLE note_list_item (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                note_id INTEGER NOT NULL,
                text VARCHAR(300) NOT NULL,
                note TEXT,
                link_text VARCHAR(200),
                link_url VARCHAR(500),
                checked BOOLEAN DEFAULT 0,
                order_index INTEGER DEFAULT 0
            )
            """
        )
        print("[add] note_list_item table created")
        return
    add_column(cur, "note_list_item", "note_id", "INTEGER")
    add_column(cur, "note_list_item", "text", "VARCHAR(300) NOT NULL DEFAULT ''")
    add_column(cur, "note_list_item", "note", "TEXT")
    add_column(cur, "note_list_item", "link_text", "VARCHAR(200)")
    add_column(cur, "note_list_item", "link_url", "VARCHAR(500)")
    add_column(cur, "note_list_item", "checked", "BOOLEAN DEFAULT 0")
    add_column(cur, "note_list_item", "order_index", "INTEGER DEFAULT 0")


def ensure_note_link_table(cur):
    if not table_exists(cur, "note_link"):
        cur.execute(
            """
            CREATE TABLE note_link (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_note_id INTEGER NOT NULL,
                target_note_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(source_note_id, target_note_id)
            )
            """
        )
        print("[add] note_link table created")
        return
    add_column(cur, "note_link", "source_note_id", "INTEGER")
    add_column(cur, "note_link", "target_note_id", "INTEGER")
    add_column(cur, "note_link", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")


def ensure_note_folder_table(cur):
    if not table_exists(cur, "note_folder"):
        cur.execute(
            """
            CREATE TABLE note_folder (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                parent_id INTEGER,
                name VARCHAR(120) NOT NULL,
                order_index INTEGER DEFAULT 0,
                is_pin_protected BOOLEAN DEFAULT 0 NOT NULL,
                archived_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        print("[add] note_folder table created")
        return
    add_column(cur, "note_folder", "parent_id", "INTEGER")
    add_column(cur, "note_folder", "name", "VARCHAR(120) NOT NULL DEFAULT ''")
    add_column(cur, "note_folder", "order_index", "INTEGER DEFAULT 0")
    add_column(cur, "note_folder", "is_pin_protected", "BOOLEAN DEFAULT 0 NOT NULL")
    add_column(cur, "note_folder", "archived_at", "TIMESTAMP")
    add_column(cur, "note_folder", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "note_folder", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")


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
                allow_overlap BOOLEAN DEFAULT 0,
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
                todo_item_id INTEGER,
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
    add_column(cur, "calendar_event", "allow_overlap", "BOOLEAN DEFAULT 0", default_sql="0")
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
    add_column(cur, "calendar_event", "recurrence_id", "INTEGER")
    add_column(cur, "calendar_event", "todo_item_id", "INTEGER")
    add_column(cur, "calendar_event", "item_note", "TEXT")
    add_column(cur, "calendar_event", "priority", "VARCHAR(10) DEFAULT 'medium'")
    add_column(cur, "calendar_event", "status", "VARCHAR(20) DEFAULT 'not_started'")
    add_column(cur, "calendar_event", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "calendar_event", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")


def ensure_recurring_event_table(cur):
    if table_exists(cur, "recurring_event"):
        add_column(cur, "recurring_event", "description", "TEXT")
        add_column(cur, "recurring_event", "end_day", "DATE")
        add_column(cur, "recurring_event", "start_time", "TIME")
        add_column(cur, "recurring_event", "end_time", "TIME")
        add_column(cur, "recurring_event", "status", "VARCHAR(20) DEFAULT 'not_started'")
        add_column(cur, "recurring_event", "priority", "VARCHAR(10) DEFAULT 'medium'")
        add_column(cur, "recurring_event", "is_event", "BOOLEAN DEFAULT 0")
        add_column(cur, "recurring_event", "reminder_minutes_before", "INTEGER")
        add_column(cur, "recurring_event", "rollover_enabled", "BOOLEAN DEFAULT 0")
        add_column(cur, "recurring_event", "interval", "INTEGER DEFAULT 1")
        add_column(cur, "recurring_event", "interval_unit", "VARCHAR(10)")
        add_column(cur, "recurring_event", "days_of_week", "VARCHAR(50)")
        add_column(cur, "recurring_event", "day_of_month", "INTEGER")
        add_column(cur, "recurring_event", "month_of_year", "INTEGER")
        add_column(cur, "recurring_event", "week_of_month", "INTEGER")
        add_column(cur, "recurring_event", "weekday_of_month", "INTEGER")
        add_column(cur, "recurring_event", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
        add_column(cur, "recurring_event", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
        print("[ok] recurring_event table exists")
        return
    cur.execute(
        """
        CREATE TABLE recurring_event (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title VARCHAR(200) NOT NULL,
            description TEXT,
            start_day DATE NOT NULL,
            end_day DATE,
            start_time TIME,
            end_time TIME,
            status VARCHAR(20) DEFAULT 'not_started',
            priority VARCHAR(10) DEFAULT 'medium',
            is_event BOOLEAN DEFAULT 0,
            reminder_minutes_before INTEGER,
            rollover_enabled BOOLEAN DEFAULT 0,
            frequency VARCHAR(20) NOT NULL,
            interval INTEGER DEFAULT 1,
            interval_unit VARCHAR(10),
            days_of_week VARCHAR(50),
            day_of_month INTEGER,
            month_of_year INTEGER,
            week_of_month INTEGER,
            weekday_of_month INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    print("[add] recurring_event table created")


def ensure_recurrence_exception_table(cur):
    if table_exists(cur, "recurrence_exception"):
        add_column(cur, "recurrence_exception", "user_id", "INTEGER")
        add_column(cur, "recurrence_exception", "recurrence_id", "INTEGER")
        add_column(cur, "recurrence_exception", "day", "DATE")
        add_column(cur, "recurrence_exception", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
        print("[ok] recurrence_exception table exists")
        return
    cur.execute(
        """
        CREATE TABLE recurrence_exception (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            recurrence_id INTEGER NOT NULL,
            day DATE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    print("[add] recurrence_exception table created")


def ensure_recall_table(cur):
    """Create or align the recalls table used for the Recall module."""
    if not table_exists(cur, "recall_items"):
        cur.execute(
            """
            CREATE TABLE recall_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title VARCHAR(120) NOT NULL,
                payload_type VARCHAR(10) NOT NULL,
                payload TEXT NOT NULL,
                why VARCHAR(500),
                summary TEXT,
                ai_status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        print("[add] recall_items table created")
        if table_exists(cur, "recall_item"):
            print("[warn] legacy recall_item table exists; drop it with one_time_drop_recalls.py")
        return

    add_column(cur, "recall_items", "title", "VARCHAR(120) NOT NULL DEFAULT ''")
    add_column(cur, "recall_items", "why", "VARCHAR(500)")
    add_column(cur, "recall_items", "summary", "TEXT")
    add_column(cur, "recall_items", "ai_status", "VARCHAR(20) DEFAULT 'pending'")
    add_column(cur, "recall_items", "payload_type", "VARCHAR(10) NOT NULL DEFAULT 'text'")
    add_column(cur, "recall_items", "payload", "TEXT NOT NULL DEFAULT ''")
    add_column(cur, "recall_items", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "recall_items", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")


def ensure_bookmark_table(cur):
    """Create or align the bookmarks table used for the Bookmarks module."""
    if not table_exists(cur, "bookmark_item"):
        cur.execute(
            """
            CREATE TABLE bookmark_item (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                value TEXT NOT NULL,
                pinned BOOLEAN DEFAULT 0,
                pin_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        print("[add] bookmark_item table created")
        return
    add_column(cur, "bookmark_item", "user_id", "INTEGER")
    add_column(cur, "bookmark_item", "title", "VARCHAR(200) NOT NULL DEFAULT ''")
    add_column(cur, "bookmark_item", "description", "TEXT")
    add_column(cur, "bookmark_item", "value", "TEXT NOT NULL DEFAULT ''")
    add_column(cur, "bookmark_item", "pinned", "BOOLEAN DEFAULT 0")
    add_column(cur, "bookmark_item", "pin_order", "INTEGER DEFAULT 0")
    add_column(cur, "bookmark_item", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "bookmark_item", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")


def ensure_do_feed_table(cur):
    """Create or align the do-feed table used for the Do-Feed module."""
    if not table_exists(cur, "do_feed_item"):
        cur.execute(
            """
            CREATE TABLE do_feed_item (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title VARCHAR(200) NOT NULL,
                url VARCHAR(600) NOT NULL,
                description TEXT,
                state VARCHAR(40) NOT NULL DEFAULT 'free',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        print("[add] do_feed_item table created")
        return
    add_column(cur, "do_feed_item", "user_id", "INTEGER")
    add_column(cur, "do_feed_item", "title", "VARCHAR(200) NOT NULL DEFAULT ''")
    add_column(cur, "do_feed_item", "url", "VARCHAR(600) NOT NULL DEFAULT ''")
    add_column(cur, "do_feed_item", "description", "TEXT")
    add_column(cur, "do_feed_item", "state", "VARCHAR(40) NOT NULL DEFAULT 'free'")
    add_column(cur, "do_feed_item", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "do_feed_item", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")


def ensure_planner_folder_table(cur):
    if not table_exists(cur, "planner_folder"):
        cur.execute(
            """
            CREATE TABLE planner_folder (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                parent_id INTEGER,
                name VARCHAR(150) NOT NULL,
                folder_type VARCHAR(20) NOT NULL DEFAULT 'simple',
                order_index INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        print("[add] planner_folder table created")
        return
    add_column(cur, "planner_folder", "user_id", "INTEGER")
    add_column(cur, "planner_folder", "parent_id", "INTEGER")
    add_column(cur, "planner_folder", "name", "VARCHAR(150) NOT NULL DEFAULT ''")
    add_column(cur, "planner_folder", "folder_type", "VARCHAR(20) NOT NULL DEFAULT 'simple'")
    add_column(cur, "planner_folder", "order_index", "INTEGER DEFAULT 0")
    add_column(cur, "planner_folder", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "planner_folder", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")


def ensure_planner_simple_item_table(cur):
    if not table_exists(cur, "planner_simple_item"):
        cur.execute(
            """
            CREATE TABLE planner_simple_item (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                folder_id INTEGER NOT NULL,
                title VARCHAR(200) NOT NULL,
                value VARCHAR(600) NOT NULL,
                description TEXT,
                order_index INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        print("[add] planner_simple_item table created")
        return
    add_column(cur, "planner_simple_item", "user_id", "INTEGER")
    add_column(cur, "planner_simple_item", "folder_id", "INTEGER")
    add_column(cur, "planner_simple_item", "title", "VARCHAR(200) NOT NULL DEFAULT ''")
    add_column(cur, "planner_simple_item", "value", "VARCHAR(600) NOT NULL DEFAULT ''")
    add_column(cur, "planner_simple_item", "description", "TEXT")
    add_column(cur, "planner_simple_item", "order_index", "INTEGER DEFAULT 0")
    add_column(cur, "planner_simple_item", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "planner_simple_item", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")


def ensure_planner_group_table(cur):
    if not table_exists(cur, "planner_group"):
        cur.execute(
            """
            CREATE TABLE planner_group (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                folder_id INTEGER NOT NULL,
                title VARCHAR(200) NOT NULL,
                order_index INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        print("[add] planner_group table created")
        return
    add_column(cur, "planner_group", "user_id", "INTEGER")
    add_column(cur, "planner_group", "folder_id", "INTEGER")
    add_column(cur, "planner_group", "title", "VARCHAR(200) NOT NULL DEFAULT ''")
    add_column(cur, "planner_group", "order_index", "INTEGER DEFAULT 0")
    add_column(cur, "planner_group", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "planner_group", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")


def ensure_planner_multi_item_table(cur):
    if not table_exists(cur, "planner_multi_item"):
        cur.execute(
            """
            CREATE TABLE planner_multi_item (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                folder_id INTEGER NOT NULL,
                group_id INTEGER,
                title VARCHAR(200) NOT NULL,
                order_index INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        print("[add] planner_multi_item table created")
        return
    add_column(cur, "planner_multi_item", "user_id", "INTEGER")
    add_column(cur, "planner_multi_item", "folder_id", "INTEGER")
    add_column(cur, "planner_multi_item", "group_id", "INTEGER")
    add_column(cur, "planner_multi_item", "title", "VARCHAR(200) NOT NULL DEFAULT ''")
    add_column(cur, "planner_multi_item", "order_index", "INTEGER DEFAULT 0")
    add_column(cur, "planner_multi_item", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "planner_multi_item", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")


def ensure_planner_multi_line_table(cur):
    if not table_exists(cur, "planner_multi_line"):
        cur.execute(
            """
            CREATE TABLE planner_multi_line (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                item_id INTEGER NOT NULL,
                line_type VARCHAR(20) NOT NULL DEFAULT 'text',
                value VARCHAR(600) NOT NULL,
                order_index INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        print("[add] planner_multi_line table created")
        return
    add_column(cur, "planner_multi_line", "user_id", "INTEGER")
    add_column(cur, "planner_multi_line", "item_id", "INTEGER")
    add_column(cur, "planner_multi_line", "line_type", "VARCHAR(20) NOT NULL DEFAULT 'text'")
    add_column(cur, "planner_multi_line", "value", "VARCHAR(600) NOT NULL DEFAULT ''")
    add_column(cur, "planner_multi_line", "order_index", "INTEGER DEFAULT 0")
    add_column(cur, "planner_multi_line", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "planner_multi_line", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")


def ensure_embedding_table(cur):
    """Create or align the embeddings table used for semantic search."""
    if not table_exists(cur, "embedding_record"):
        cur.execute(
            """
            CREATE TABLE embedding_record (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                entity_type VARCHAR(30) NOT NULL,
                entity_id INTEGER NOT NULL,
                embedding_json TEXT,
                embedding_dim INTEGER,
                source_hash VARCHAR(64),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_embedding_unique "
            "ON embedding_record(user_id, entity_type, entity_id)"
        )
        print("[add] embedding_record table created")
        return
    add_column(cur, "embedding_record", "user_id", "INTEGER")
    add_column(cur, "embedding_record", "entity_type", "VARCHAR(30)")
    add_column(cur, "embedding_record", "entity_id", "INTEGER")
    add_column(cur, "embedding_record", "embedding_json", "TEXT")
    add_column(cur, "embedding_record", "embedding_dim", "INTEGER")
    add_column(cur, "embedding_record", "source_hash", "VARCHAR(64)")
    add_column(cur, "embedding_record", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "embedding_record", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    cur.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_embedding_unique "
        "ON embedding_record(user_id, entity_type, entity_id)"
    )


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


def ensure_job_lock_table(cur):
    """Ensure job_lock table exists for distributed locking."""
    if table_exists(cur, "job_lock"):
        print("[ok] job_lock table exists")
        return
    cur.execute(
        """
        CREATE TABLE job_lock (
            job_name VARCHAR(100) PRIMARY KEY,
            locked_at TIMESTAMP NOT NULL,
            locked_by VARCHAR(100)
        )
        """
    )
    print("[add] job_lock table created")


def ensure_document_folder_table(cur):
    """Create or align the document_folder table for the vault."""
    if not table_exists(cur, "document_folder"):
        cur.execute(
            """
            CREATE TABLE document_folder (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                parent_id INTEGER,
                name VARCHAR(120) NOT NULL,
                order_index INTEGER DEFAULT 0,
                archived_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        print("[add] document_folder table created")
        return
    add_column(cur, "document_folder", "parent_id", "INTEGER")
    add_column(cur, "document_folder", "name", "VARCHAR(120) NOT NULL DEFAULT ''")
    add_column(cur, "document_folder", "order_index", "INTEGER DEFAULT 0")
    add_column(cur, "document_folder", "archived_at", "TIMESTAMP")
    add_column(cur, "document_folder", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "document_folder", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")


def ensure_document_table(cur):
    """Create or align the document table for the vault."""
    if not table_exists(cur, "document"):
        cur.execute(
            """
            CREATE TABLE document (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                folder_id INTEGER,
                title VARCHAR(255) NOT NULL,
                original_filename VARCHAR(255) NOT NULL,
                stored_filename VARCHAR(255) NOT NULL,
                file_type VARCHAR(100),
                file_extension VARCHAR(20),
                file_size INTEGER,
                tags TEXT,
                pinned BOOLEAN DEFAULT 0,
                pin_order INTEGER DEFAULT 0,
                archived_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_document_user ON document(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_document_folder ON document(folder_id)")
        print("[add] document table created")
        return
    add_column(cur, "document", "folder_id", "INTEGER")
    add_column(cur, "document", "title", "VARCHAR(255) NOT NULL DEFAULT ''")
    add_column(cur, "document", "original_filename", "VARCHAR(255) NOT NULL DEFAULT ''")
    add_column(cur, "document", "stored_filename", "VARCHAR(255) NOT NULL DEFAULT ''")
    add_column(cur, "document", "file_type", "VARCHAR(100)")
    add_column(cur, "document", "file_extension", "VARCHAR(20)")
    add_column(cur, "document", "file_size", "INTEGER")
    add_column(cur, "document", "tags", "TEXT")
    add_column(cur, "document", "pinned", "BOOLEAN DEFAULT 0")
    add_column(cur, "document", "pin_order", "INTEGER DEFAULT 0")
    add_column(cur, "document", "archived_at", "TIMESTAMP")
    add_column(cur, "document", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    add_column(cur, "document", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_document_user ON document(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_document_folder ON document(folder_id)")


def main():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    try:
        ensure_user_table(cur)
        ensure_todo_list_table(cur)
        ensure_todo_item_table(cur)
        ensure_task_dependency_table(cur)
        ensure_note_table(cur)
        ensure_note_link_table(cur)
        ensure_note_list_item_table(cur)
        ensure_note_folder_table(cur)
        ensure_calendar_event_table(cur)
        ensure_recurring_event_table(cur)
        ensure_recurrence_exception_table(cur)
        ensure_recall_table(cur)
        ensure_bookmark_table(cur)
        ensure_do_feed_table(cur)
        ensure_planner_folder_table(cur)
        ensure_planner_simple_item_table(cur)
        ensure_planner_group_table(cur)
        ensure_planner_multi_item_table(cur)
        ensure_planner_multi_line_table(cur)
        ensure_embedding_table(cur)
        ensure_notification_tables(cur)
        ensure_job_lock_table(cur)
        ensure_document_folder_table(cur)
        ensure_document_table(cur)
        conn.commit()
        print("Baseline migration complete.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
