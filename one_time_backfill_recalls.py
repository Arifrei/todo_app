"""
One-time backfill: copy legacy recall_item rows into recall_items with AI metadata.

Run:
    python one_time_backfill_recalls.py
"""
import sqlite3
from pathlib import Path

from app import app, generate_recall_metadata
from models import RecallItem, db

DB_PATH = Path("instance") / "todo.db"


def main():
    if not DB_PATH.exists():
        print("Database not found.")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    try:
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='recall_item'")
        if not cur.fetchone():
            print("No legacy recall_item table found.")
            return

        cur.execute(
            """
            SELECT id, user_id, title, content, source_url, summary
            FROM recall_item
            ORDER BY id ASC
            """
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    if not rows:
        print("No legacy recalls to backfill.")
        return

    with app.app_context():
        created = 0
        for old_id, user_id, title, content, source_url, summary in rows:
            payload = (source_url or content or summary or title or "").strip()
            if not payload:
                print(f"[skip] legacy id={old_id} has no payload")
                continue

            payload_type = "url" if (source_url or "").strip() else "text"
            meta = generate_recall_metadata(payload, payload_type)

            recall = RecallItem(
                user_id=user_id or 1,
                title=(meta.get("title") or title or "Untitled").strip()[:120],
                why=(meta.get("why") or "Worth revisiting later.").strip()[:500],
                payload_type=payload_type,
                payload=payload,
                when_context="free",
            )
            db.session.add(recall)
            created += 1

        db.session.commit()
        print(f"Backfilled {created} recalls into recall_items.")


if __name__ == "__main__":
    main()
