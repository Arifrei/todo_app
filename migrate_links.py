"""
Add task due_date and link notes to tasks.
Run:  python migrate_links.py
"""
import sqlite3
from pathlib import Path

DB_PATH = Path("instance") / "todo.db"


def column_exists(cur, table, name):
    cur.execute(f"PRAGMA table_info({table})")
    return any(row[1] == name for row in cur.fetchall())


def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    try:
        if not column_exists(cur, "todo_item", "due_date"):
            cur.execute("ALTER TABLE todo_item ADD COLUMN due_date DATE")
            print("[add] todo_item.due_date")
        else:
            print("[skip] todo_item.due_date exists")

        if not column_exists(cur, "note", "todo_item_id"):
            cur.execute("ALTER TABLE note ADD COLUMN todo_item_id INTEGER")
            print("[add] note.todo_item_id")
        else:
            print("[skip] note.todo_item_id exists")

        conn.commit()
        print("Migration complete.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
