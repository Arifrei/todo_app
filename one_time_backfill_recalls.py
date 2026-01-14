"""
One-time backfill: copy legacy recall_item rows into recall_items with AI metadata.

Run:
    python3 one_time_backfill_recalls.py
"""
import json
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path

from openai import OpenAI

DB_PATH = Path("instance") / "todo.db"


def call_openai(system_prompt, payload):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return ""
    try:
        client = OpenAI(api_key=api_key)
        model_name = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        resp = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": payload},
            ],
            max_tokens=120,
            temperature=0.4,
        )
        return (resp.choices[0].message.content or "").strip()
    except Exception:
        return ""


def try_parse_json(response):
    try:
        return json.loads(response)
    except Exception:
        pass
    match = re.search(r"\{[^{}]*\}", response or "")
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    return None


def generate_fallback(payload):
    words = re.sub(r"[^\w\s]", "", payload or "").split()[:6]
    title = " ".join(words) if words else "Untitled"
    if len(title) > 120:
        title = title[:117] + "..."
    return {"title": title, "why": "Worth revisiting later."}


def generate_recall_metadata(payload, payload_type):
    system_prompt = """You are generating metadata for a recall item.

Given the content below, generate:
1. title: 3-6 words, neutral, descriptive, no punctuation unless necessary
2. why: Exactly 1 sentence explaining future usefulness. Use patterns like "Might help with...", "Could be useful when...", "Worth revisiting for...". Do NOT summarize the content.

Return ONLY valid JSON: {"title": "...", "why": "..."}"""

    response = call_openai(system_prompt, payload)
    result = try_parse_json(response)
    if result:
        return {**result, "payload_type": payload_type, "used_fallback": False}

    retry_prompt = system_prompt + "\n\nIMPORTANT: Return ONLY JSON. No other text."
    response = call_openai(retry_prompt, payload)
    result = try_parse_json(response)
    if result:
        return {**result, "payload_type": payload_type, "used_fallback": False}

    return {**generate_fallback(payload), "payload_type": payload_type, "used_fallback": True}


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
            CREATE TABLE IF NOT EXISTS recall_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title VARCHAR(120) NOT NULL,
                why VARCHAR(500) NOT NULL,
                payload_type VARCHAR(10) NOT NULL,
                payload TEXT NOT NULL,
                when_context VARCHAR(30) NOT NULL,
                created_at TIMESTAMP,
                updated_at TIMESTAMP
            )
            """
        )

        cur.execute(
            """
            SELECT id, user_id, title, content, source_url, summary
            FROM recall_item
            ORDER BY id ASC
            """
        )
        rows = cur.fetchall()

        if not rows:
            print("No legacy recalls to backfill.")
            return

        created = 0
        now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        for old_id, user_id, title, content, source_url, summary in rows:
            payload = (source_url or content or summary or title or "").strip()
            if not payload:
                print(f"[skip] legacy id={old_id} has no payload")
                continue

            payload_type = "url" if (source_url or "").strip() else "text"
            meta = generate_recall_metadata(payload, payload_type)

            # Avoid duplicate inserts
            cur.execute(
                "SELECT 1 FROM recall_items WHERE user_id=? AND payload=? LIMIT 1",
                (user_id or 1, payload),
            )
            if cur.fetchone():
                continue

            cur.execute(
                """
                INSERT INTO recall_items
                    (user_id, title, why, payload_type, payload, when_context, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id or 1,
                    (meta.get("title") or title or "Untitled")[:120],
                    (meta.get("why") or "Worth revisiting later.")[:500],
                    payload_type,
                    payload,
                    "free",
                    now,
                    now,
                ),
            )
            created += 1

        conn.commit()
        print(f"Backfilled {created} recalls into recall_items.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
