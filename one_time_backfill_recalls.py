"""
One-time backfill: copy legacy recall_item rows into recall_items with AI metadata.

Run:
    python3 one_time_backfill_recalls.py
"""
import sqlite3
from datetime import datetime
from pathlib import Path

from app import app
from models import RecallItem, db
from recall_processor import generate_why_and_summary, generate_fallback

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

            # Avoid duplicate inserts
            cur = db.session.connection().connection.cursor()
            cur.execute(
                "SELECT 1 FROM recall_items WHERE user_id=? AND payload=? LIMIT 1",
                (user_id or 1, payload),
            )
            if cur.fetchone():
                continue

            recall = RecallItem(
                user_id=user_id or 1,
                title=(title or payload)[:120],
                payload_type=payload_type,
                payload=payload,
                when_context="free",
                ai_status="processing",
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            db.session.add(recall)
            db.session.flush()

            # Prefer legacy content/summary as AI input to avoid URL-only titles.
            content_for_ai = (content or summary or payload).strip()
            try:
                result = generate_why_and_summary(recall.title, content_for_ai)
            except Exception:
                result = generate_fallback(recall.title, content_for_ai)

            recall.why = (result.get("why") or "Worth revisiting later.")[:500]
            recall.summary = (result.get("summary") or "")[:2000]
            recall.ai_status = "done"
            created += 1

        db.session.commit()
        print(f"Backfilled {created} recalls into recall_items.")


if __name__ == "__main__":
    main()
