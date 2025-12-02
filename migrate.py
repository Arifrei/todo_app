"""
One-time migration helper for the production SQLite DB.
Run:  python migrate_all.py

What it does (idempotent):
- Add description TEXT to todo_item
- Add notes TEXT to todo_item
- Normalize status: pending -> not_started
- Add order_index INTEGER (default 0) to todo_item and backfill per list
"""
import sqlite3
from pathlib import Path

DB_PATH = Path("instance") / "todo.db"


def column_exists(cursor, table, column):
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())


def add_column(cursor, table, column, col_type):
    if column_exists(cursor, table, column):
        print(f"[skip] {column} already exists on {table}")
        return
    cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
    print(f"[add] {column} added to {table}")


def add_description_and_notes(cur):
    add_column(cur, "todo_item", "description", "TEXT")
    add_column(cur, "todo_item", "notes", "TEXT")


def normalize_status(cur):
    cur.execute("UPDATE todo_item SET status='not_started' WHERE status='pending'")
    print("[update] normalized pending -> not_started")


def add_order_index(cur):
    add_column(cur, "todo_item", "order_index", "INTEGER DEFAULT 0")
    # Backfill order_index per list by id order
    rows = cur.execute("SELECT id, list_id FROM todo_item ORDER BY list_id, id").fetchall()
    counters = {}
    for item_id, list_id in rows:
        next_idx = counters.get(list_id, 1)
        cur.execute("UPDATE todo_item SET order_index=? WHERE id=?", (next_idx, item_id))
        counters[list_id] = next_idx + 1
    print("[update] backfilled order_index per list")


def add_phase_id(cur):
    add_column(cur, "todo_item", "phase_id", "INTEGER")
    print("[add] phase_id column added")


def add_is_phase(cur):
    add_column(cur, "todo_item", "is_phase", "BOOLEAN DEFAULT 0")
    # Backfill: mark items with status='phase' as is_phase=True
    cur.execute("UPDATE todo_item SET is_phase=1 WHERE status='phase'")
    print("[update] backfilled is_phase for existing phase items")


def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    try:
        add_description_and_notes(cur)
        normalize_status(cur)
        add_order_index(cur)
        add_phase_id(cur)
        add_is_phase(cur)
        conn.commit()
        print("Migration complete.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
