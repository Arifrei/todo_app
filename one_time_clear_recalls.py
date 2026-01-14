"""
One-time cleanup: clear recall_items before re-backfill.

Run:
    python one_time_clear_recalls.py
"""
import sqlite3
from pathlib import Path

DB_PATH = Path("instance") / "todo.db"


def main():
    if not DB_PATH.exists():
        print("Database not found.")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM recall_items")
        conn.commit()
        print("Cleared recall_items.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
