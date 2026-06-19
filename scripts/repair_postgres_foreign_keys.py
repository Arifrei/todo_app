#!/usr/bin/env python3
"""Align PostgreSQL foreign keys with the app's delete behavior.

This script changes constraints only. It does not insert, update, or delete data
rows. Nullable links that the app treats as optional use ON DELETE SET NULL;
strict ownership rows use ON DELETE CASCADE. The historical rollover pointer
calendar_event.rolled_from_id intentionally has no foreign key.
"""

import hashlib
import os
import sys
import argparse
from pathlib import Path

from dotenv import find_dotenv, load_dotenv
from sqlalchemy import create_engine, text


BASE_DIR = Path(__file__).resolve().parents[1]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

DOTENV_PATH = find_dotenv() or BASE_DIR / ".env"
if DOTENV_PATH and Path(DOTENV_PATH).exists():
    load_dotenv(DOTENV_PATH)


NO_FOREIGN_KEY_COLUMNS = [
    ("calendar_event", "rolled_from_id"),
]


FOREIGN_KEY_RULES = [
    ("task_dependency", "task_id", "todo_item", "id", "CASCADE"),
    ("task_dependency", "depends_on_id", "todo_item", "id", "CASCADE"),
    ("todo_item", "list_id", "todo_list", "id", "CASCADE"),
    ("todo_item", "linked_list_id", "todo_list", "id", "SET NULL"),
    ("todo_item", "phase_id", "todo_item", "id", "SET NULL"),
    ("note", "todo_item_id", "todo_item", "id", "SET NULL"),
    ("note", "calendar_event_id", "calendar_event", "id", "SET NULL"),
    ("note", "planner_multi_item_id", "planner_multi_item", "id", "SET NULL"),
    ("note", "planner_multi_line_id", "planner_multi_line", "id", "SET NULL"),
    ("note", "folder_id", "note_folder", "id", "SET NULL"),
    ("note_link", "source_note_id", "note", "id", "CASCADE"),
    ("note_link", "target_note_id", "note", "id", "CASCADE"),
    ("note_list_item", "note_id", "note", "id", "CASCADE"),
    ("note_folder", "parent_id", "note_folder", "id", "SET NULL"),
    ("calendar_event", "phase_id", "calendar_event", "id", "SET NULL"),
    ("calendar_event", "group_id", "calendar_event", "id", "SET NULL"),
    ("calendar_event", "recurrence_id", "recurring_event", "id", "SET NULL"),
    ("calendar_event", "todo_item_id", "todo_item", "id", "SET NULL"),
    ("calendar_event", "planner_simple_item_id", "planner_simple_item", "id", "SET NULL"),
    ("calendar_event", "planner_multi_item_id", "planner_multi_item", "id", "SET NULL"),
    ("calendar_event", "planner_multi_line_id", "planner_multi_line", "id", "SET NULL"),
    ("calendar_event", "note_list_item_id", "note_list_item", "id", "SET NULL"),
    ("calendar_event", "do_feed_item_id", "do_feed_item", "id", "SET NULL"),
    ("recurrence_exception", "recurrence_id", "recurring_event", "id", "CASCADE"),
    ("planner_folder", "parent_id", "planner_folder", "id", "SET NULL"),
    ("planner_group", "folder_id", "planner_folder", "id", "CASCADE"),
    ("planner_simple_item", "folder_id", "planner_folder", "id", "CASCADE"),
    ("planner_multi_item", "folder_id", "planner_folder", "id", "CASCADE"),
    ("planner_multi_item", "group_id", "planner_group", "id", "SET NULL"),
    ("planner_multi_line", "item_id", "planner_multi_item", "id", "CASCADE"),
    ("document_folder", "parent_id", "document_folder", "id", "SET NULL"),
    ("document", "folder_id", "document_folder", "id", "SET NULL"),
]


DELETE_CODES = {
    "CASCADE": "c",
    "SET NULL": "n",
}


def database_url() -> str:
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_DATABASE_URL")
    if not url:
        raise SystemExit("Missing DATABASE_URL or POSTGRES_DATABASE_URL.")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if not url.startswith(("postgresql://", "postgresql+")):
        raise SystemExit("This repair is only for PostgreSQL databases.")
    return url


def quote_ident(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def constraint_name(table: str, column: str, parent_table: str, parent_column: str) -> str:
    base = f"fk_{table}_{column}_{parent_table}_{parent_column}"
    if len(base) <= 60:
        return base
    digest = hashlib.sha1(base.encode("utf-8")).hexdigest()[:10]
    return f"{base[:49]}_{digest}"


def foreign_keys_for_column(conn, table: str, column: str) -> list[dict]:
    return [
        dict(row)
        for row in conn.execute(
            text(
                """
                SELECT
                    con.conname,
                    con.confdeltype,
                    parent_rel.relname AS parent_table,
                    parent_att.attname AS parent_column
                FROM pg_constraint con
                JOIN pg_class child_rel ON child_rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = child_rel.relnamespace
                JOIN pg_attribute child_att
                    ON child_att.attrelid = child_rel.oid
                    AND child_att.attnum = ANY(con.conkey)
                JOIN pg_class parent_rel ON parent_rel.oid = con.confrelid
                JOIN pg_attribute parent_att
                    ON parent_att.attrelid = parent_rel.oid
                    AND parent_att.attnum = ANY(con.confkey)
                WHERE con.contype = 'f'
                    AND nsp.nspname = current_schema()
                    AND child_rel.relname = :table_name
                    AND child_att.attname = :column_name
                """
            ),
            {"table_name": table, "column_name": column},
        ).mappings()
    ]


def table_column_exists(conn, table: str, column: str) -> bool:
    return bool(
        conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                    AND table_name = :table_name
                    AND column_name = :column_name
                """
            ),
            {"table_name": table, "column_name": column},
        ).first()
    )


def drop_constraint(conn, table: str, name: str, dry_run: bool) -> None:
    if dry_run:
        return
    conn.execute(
        text(
            f"ALTER TABLE {quote_ident(table)} "
            f"DROP CONSTRAINT {quote_ident(name)}"
        )
    )


def add_constraint(
    conn,
    table: str,
    column: str,
    parent_table: str,
    parent_column: str,
    on_delete: str,
    dry_run: bool,
) -> None:
    if dry_run:
        return
    conn.execute(
        text(
            f"ALTER TABLE {quote_ident(table)} "
            f"ADD CONSTRAINT {quote_ident(constraint_name(table, column, parent_table, parent_column))} "
            f"FOREIGN KEY ({quote_ident(column)}) "
            f"REFERENCES {quote_ident(parent_table)} ({quote_ident(parent_column)}) "
            f"ON DELETE {on_delete}"
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Repair PostgreSQL foreign key ON DELETE rules without changing data rows."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned constraint changes without applying them.",
    )
    args = parser.parse_args()

    engine = create_engine(database_url(), future=True, pool_pre_ping=True)
    with engine.begin() as conn:
        if conn.dialect.name != "postgresql":
            raise SystemExit("This repair is only for PostgreSQL databases.")

        changed = 0
        for table, column in NO_FOREIGN_KEY_COLUMNS:
            existing = foreign_keys_for_column(conn, table, column)
            for item in existing:
                drop_constraint(conn, table, item["conname"], args.dry_run)
                prefix = "Would drop" if args.dry_run else "Dropped"
                print(f"{prefix} {table}.{column} constraint: {item['conname']}")
                changed += 1

        for table, column, parent_table, parent_column, on_delete in FOREIGN_KEY_RULES:
            if not table_column_exists(conn, table, column):
                print(f"Skipped missing column: {table}.{column}")
                continue
            existing = foreign_keys_for_column(conn, table, column)
            desired_code = DELETE_CODES[on_delete]
            matches = [
                item
                for item in existing
                if item["parent_table"] == parent_table
                and item["parent_column"] == parent_column
                and item["confdeltype"] == desired_code
            ]
            extras = [item for item in existing if item not in matches]
            if matches and not extras:
                continue
            for item in existing:
                drop_constraint(conn, table, item["conname"], args.dry_run)
                prefix = "Would drop" if args.dry_run else "Dropped"
                print(f"{prefix} {table}.{column} constraint: {item['conname']}")
                changed += 1
            add_constraint(conn, table, column, parent_table, parent_column, on_delete, args.dry_run)
            prefix = "Would add" if args.dry_run else "Added"
            print(f"{prefix} {table}.{column} ON DELETE {on_delete}")
            changed += 1

        if not changed:
            print("PostgreSQL foreign keys already match expected rules.")
        elif args.dry_run:
            print(f"Dry run complete. Planned constraint changes: {changed}")
        else:
            print(f"Foreign key repair complete. Constraint changes: {changed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
