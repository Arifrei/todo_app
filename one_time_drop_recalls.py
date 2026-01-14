"""
One-time script to drop legacy recalls tables and recreate recall_items.

Run:
    python one_time_drop_recalls.py
"""
import sqlite3
from pathlib import Path

DB_PATH = Path("instance") / "todo.db"


def main():
    if not DB_PATH.exists():
        print("Database not found. Run migrate.py first.")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    try:
        cur.execute("DROP TABLE IF EXISTS recall_item")
        cur.execute("DROP TABLE IF EXISTS recall_items")
        cur.execute(
            """
            CREATE TABLE recall_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title VARCHAR(120) NOT NULL,
                why VARCHAR(500) NOT NULL,
                payload_type VARCHAR(10) NOT NULL,
                payload TEXT NOT NULL,
                when_context VARCHAR(30) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.commit()
        print("recall_items dropped and recreated.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
