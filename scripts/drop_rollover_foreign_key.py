#!/usr/bin/env python3
"""Drop the invalid PostgreSQL FK on calendar_event.rolled_from_id.

Rollover keeps rolled_from_id as a source id after the source event is deleted.
That means the column is intentionally not referentially constrained.
"""

import os
import sys
from pathlib import Path

from dotenv import find_dotenv, load_dotenv
from sqlalchemy import create_engine, text


BASE_DIR = Path(__file__).resolve().parents[1]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

DOTENV_PATH = find_dotenv() or BASE_DIR / ".env"
if DOTENV_PATH and Path(DOTENV_PATH).exists():
    load_dotenv(DOTENV_PATH)


def database_url() -> str:
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_DATABASE_URL")
    if not url:
        raise SystemExit("Missing DATABASE_URL or POSTGRES_DATABASE_URL.")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if not url.startswith(("postgresql://", "postgresql+")):
        raise SystemExit("This repair is only for PostgreSQL databases.")
    return url


def main() -> int:
    engine = create_engine(database_url(), future=True, pool_pre_ping=True)
    with engine.begin() as conn:
        if conn.dialect.name != "postgresql":
            raise SystemExit("This repair is only for PostgreSQL databases.")

        constraints = conn.execute(
            text(
                """
                SELECT con.conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                JOIN pg_attribute att
                    ON att.attrelid = rel.oid
                    AND att.attnum = ANY(con.conkey)
                WHERE con.contype = 'f'
                    AND nsp.nspname = current_schema()
                    AND rel.relname = 'calendar_event'
                    AND att.attname = 'rolled_from_id'
                """
            )
        ).scalars().all()

        if not constraints:
            print("No rolled_from_id foreign key constraint found.")
            return 0

        for constraint_name in constraints:
            escaped_name = constraint_name.replace('"', '""')
            conn.execute(
                text(f'ALTER TABLE calendar_event DROP CONSTRAINT "{escaped_name}"')
            )
            print(f"Dropped constraint: {constraint_name}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
