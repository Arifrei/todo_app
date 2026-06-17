#!/usr/bin/env python3
"""Copy the local SQLite app database into an empty PostgreSQL database.

The SQLite database is opened read-only with mode=ro and PRAGMA query_only=ON.
This script never writes to, migrates, vacuums, backs up, or otherwise mutates
the source SQLite file.
"""

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from collections import defaultdict, deque
from datetime import date, datetime, time
from pathlib import Path
from typing import Any

from dotenv import find_dotenv, load_dotenv
from sqlalchemy import and_, create_engine, func, inspect, select, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.sql.schema import MetaData, Table
from sqlalchemy.sql.sqltypes import Boolean, Date, DateTime, Time


BASE_DIR = Path(__file__).resolve().parents[1]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

DOTENV_PATH = find_dotenv() or BASE_DIR / ".env"
if DOTENV_PATH and Path(DOTENV_PATH).exists():
    load_dotenv(DOTENV_PATH)

from models import db  # noqa: E402


CHUNK_SIZE = 500
PLACEHOLDER_PASSWORD_HASH = "migrated-placeholder-user-login-disabled"


def resolve_path(path_value: str, base_dir: Path) -> Path:
    path = Path(path_value)
    if path.is_absolute():
        return path
    return (base_dir / path).resolve()


def quote_sqlite_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def open_sqlite_read_only(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        raise SystemExit(f"SQLite database not found: {db_path}")

    conn = sqlite3.connect(f"{db_path.as_uri()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    return conn


def sqlite_tables(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master "
        "WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    return {row["name"] for row in rows}


def sqlite_columns(conn: sqlite3.Connection, table_name: str) -> list[str]:
    table_sql = quote_sqlite_identifier(table_name)
    rows = conn.execute(f"PRAGMA table_info({table_sql})").fetchall()
    return [row["name"] for row in rows]


def sqlite_count(conn: sqlite3.Connection, table_name: str) -> int:
    table_sql = quote_sqlite_identifier(table_name)
    return int(conn.execute(f"SELECT COUNT(*) FROM {table_sql}").fetchone()[0])


def sqlite_rows(
    conn: sqlite3.Connection,
    table_name: str,
    column_names: list[str],
) -> list[sqlite3.Row]:
    table_sql = quote_sqlite_identifier(table_name)
    columns_sql = ", ".join(quote_sqlite_identifier(name) for name in column_names)
    return conn.execute(f"SELECT {columns_sql} FROM {table_sql}").fetchall()


def normalize_postgres_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://") :]
    return url


def target_database_url(args: argparse.Namespace) -> str:
    url = (
        args.database_url
        or os.environ.get("POSTGRES_DATABASE_URL")
        or os.environ.get("DATABASE_URL")
    )
    if not url:
        raise SystemExit(
            "Missing target database URL. Pass --database-url or set POSTGRES_DATABASE_URL."
        )

    url = normalize_postgres_url(url)
    if url.startswith("sqlite:"):
        raise SystemExit("Refusing to use a SQLite URL as the PostgreSQL target.")
    if not (url.startswith("postgresql:") or url.startswith("postgresql+")):
        raise SystemExit("Target database URL must start with postgresql://.")
    return url


def create_target_engine(url: str) -> Engine:
    return create_engine(url, future=True, pool_pre_ping=True)


def nullable_fk_columns(table: Table) -> set[str]:
    return {
        column.name
        for column in table.columns
        if column.nullable and column.foreign_keys
    }


def onupdate_columns(table: Table, column_names: list[str]) -> set[str]:
    available = set(column_names)
    return {
        column.name
        for column in table.columns
        if column.name in available and column.onupdate is not None
    }


def required_dependencies(table: Table) -> set[str]:
    dependencies: set[str] = set()
    deferred_columns = nullable_fk_columns(table)
    for column in table.columns:
        if not column.foreign_keys or column.name in deferred_columns:
            continue
        for foreign_key in column.foreign_keys:
            parent_table_name = foreign_key.column.table.name
            if parent_table_name != table.name:
                dependencies.add(parent_table_name)
    return dependencies


def table_copy_order(metadata: MetaData) -> list[Table]:
    tables_by_name = dict(metadata.tables)
    dependency_map = {
        name: {dep for dep in required_dependencies(table) if dep in tables_by_name}
        for name, table in tables_by_name.items()
    }
    children: dict[str, set[str]] = defaultdict(set)
    in_degree = {name: len(deps) for name, deps in dependency_map.items()}
    for name, deps in dependency_map.items():
        for dep in deps:
            children[dep].add(name)

    ready = deque(sorted(name for name, count in in_degree.items() if count == 0))
    ordered_names: list[str] = []
    while ready:
        name = ready.popleft()
        ordered_names.append(name)
        for child in sorted(children[name]):
            in_degree[child] -= 1
            if in_degree[child] == 0:
                ready.append(child)

    if len(ordered_names) != len(tables_by_name):
        remaining = sorted(set(tables_by_name) - set(ordered_names))
        raise SystemExit(
            "Could not determine a safe table copy order. Remaining tables: "
            + ", ".join(remaining)
        )

    return [tables_by_name[name] for name in ordered_names]


def coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "t", "yes", "y", "on"}:
            return True
        if normalized in {"0", "false", "f", "no", "n", "off"}:
            return False
    return bool(value)


def coerce_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, time.min)
    value_text = str(value).strip().replace("Z", "+00:00")
    return datetime.fromisoformat(value_text)


def coerce_date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    value_text = str(value).strip().split(" ", 1)[0]
    return date.fromisoformat(value_text)


def coerce_time(value: Any) -> time:
    if isinstance(value, time):
        return value
    value_text = str(value).strip()
    return time.fromisoformat(value_text)


def coerce_value(table: Table, column_name: str, value: Any) -> Any:
    if value is None:
        return None

    column = table.c[column_name]
    column_type = column.type
    if isinstance(column_type, Boolean):
        return coerce_bool(value)
    if isinstance(column_type, DateTime):
        return coerce_datetime(value)
    if isinstance(column_type, Date):
        return coerce_date(value)
    if isinstance(column_type, Time):
        return coerce_time(value)
    return value


def chunked(rows: list[dict[str, Any]], chunk_size: int) -> list[list[dict[str, Any]]]:
    return [rows[index : index + chunk_size] for index in range(0, len(rows), chunk_size)]


def validate_source_tables(conn: sqlite3.Connection, metadata: MetaData) -> None:
    source_tables = sqlite_tables(conn)
    model_tables = set(metadata.tables)
    extra_tables = sorted(source_tables - model_tables)
    if not extra_tables:
        return

    populated = [name for name in extra_tables if sqlite_count(conn, name) > 0]
    if populated:
        raise SystemExit(
            "Source SQLite has populated tables that are not in models.py: "
            + ", ".join(populated)
            + ". Refusing to skip data."
        )


def validate_source_columns(
    conn: sqlite3.Connection,
    source_tables: set[str],
    table: Table,
) -> list[str]:
    if table.name not in source_tables:
        return []

    source_columns = set(sqlite_columns(conn, table.name))
    model_columns = {column.name for column in table.columns}

    extra_columns = sorted(source_columns - model_columns)
    if extra_columns and sqlite_count(conn, table.name) > 0:
        raise SystemExit(
            f"Source table {table.name} has columns not in models.py: "
            + ", ".join(extra_columns)
            + ". Refusing to skip data."
        )

    missing_required = [
        column.name
        for column in table.columns
        if column.name not in source_columns
        and not column.nullable
        and column.default is None
        and column.server_default is None
        and not column.primary_key
    ]
    if missing_required:
        raise SystemExit(
            f"Source table {table.name} is missing required model columns: "
            + ", ".join(missing_required)
        )

    return [column.name for column in table.columns if column.name in source_columns]


def find_foreign_key_issues(
    conn: sqlite3.Connection,
    metadata: MetaData,
    source_tables: set[str],
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    source_columns_by_table = {
        table_name: set(sqlite_columns(conn, table_name))
        for table_name in source_tables
    }

    for table in metadata.tables.values():
        if table.name not in source_tables:
            continue
        child_columns = source_columns_by_table[table.name]
        for column in table.columns:
            if column.name not in child_columns:
                continue
            for foreign_key in column.foreign_keys:
                parent_table = foreign_key.column.table
                parent_table_name = parent_table.name
                parent_column_name = foreign_key.column.name
                if parent_table_name not in source_tables:
                    continue
                parent_columns = source_columns_by_table[parent_table_name]
                if parent_column_name not in parent_columns:
                    continue

                child_table_sql = quote_sqlite_identifier(table.name)
                child_column_sql = quote_sqlite_identifier(column.name)
                parent_table_sql = quote_sqlite_identifier(parent_table_name)
                parent_column_sql = quote_sqlite_identifier(parent_column_name)
                rows = conn.execute(
                    f"""
                    SELECT DISTINCT child.{child_column_sql} AS value
                    FROM {child_table_sql} child
                    LEFT JOIN {parent_table_sql} parent
                        ON child.{child_column_sql} = parent.{parent_column_sql}
                    WHERE child.{child_column_sql} IS NOT NULL
                        AND parent.{parent_column_sql} IS NULL
                    ORDER BY child.{child_column_sql}
                    """
                ).fetchall()
                if rows:
                    issues.append(
                        {
                            "table": table.name,
                            "column": column.name,
                            "nullable": column.nullable,
                            "parent_table": parent_table_name,
                            "parent_column": parent_column_name,
                            "values": [row["value"] for row in rows],
                        }
                    )
    return issues


def missing_user_ids(foreign_key_issues: list[dict[str, Any]]) -> set[int]:
    values: set[int] = set()
    for issue in foreign_key_issues:
        if issue["parent_table"] != "user" or issue["parent_column"] != "id":
            continue
        values.update(int(value) for value in issue["values"])
    return values


def nullable_orphan_repair_map(
    foreign_key_issues: list[dict[str, Any]],
) -> dict[tuple[str, str], set[Any]]:
    repairs: dict[tuple[str, str], set[Any]] = {}
    for issue in foreign_key_issues:
        if issue["parent_table"] == "user" and issue["parent_column"] == "id":
            continue
        if not issue["nullable"]:
            continue
        repairs[(issue["table"], issue["column"])] = set(issue["values"])
    return repairs


def unrepairable_foreign_key_issues(
    foreign_key_issues: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    unrepairable: list[dict[str, Any]] = []
    for issue in foreign_key_issues:
        if issue["parent_table"] == "user" and issue["parent_column"] == "id":
            continue
        if not issue["nullable"]:
            unrepairable.append(issue)
    return unrepairable


def format_foreign_key_issue(issue: dict[str, Any]) -> str:
    values = ", ".join(str(value) for value in issue["values"])
    return (
        f"{issue['table']}.{issue['column']} -> "
        f"{issue['parent_table']}.{issue['parent_column']}: {values}"
    )


def print_source_integrity_plan(foreign_key_issues: list[dict[str, Any]]) -> None:
    missing_users = sorted(missing_user_ids(foreign_key_issues))
    if missing_users:
        print("")
        print("Target-only placeholder users to create:")
        for user_id in missing_users:
            print(f"  user.id={user_id} username=migrated_missing_user_{user_id}")

    nullable_repairs = nullable_orphan_repair_map(foreign_key_issues)
    if nullable_repairs:
        print("")
        print("Target-only nullable orphan references to clear:")
        for issue in foreign_key_issues:
            if (issue["table"], issue["column"]) not in nullable_repairs:
                continue
            print(f"  {format_foreign_key_issue(issue)}")

    unrepairable = unrepairable_foreign_key_issues(foreign_key_issues)
    if unrepairable:
        print("")
        print("Unrepairable required foreign-key issues:")
        for issue in unrepairable:
            print(f"  {format_foreign_key_issue(issue)}")


def insert_placeholder_users(target_conn: Connection, user_table: Table, user_ids: set[int]) -> int:
    if not user_ids:
        return 0

    now = datetime.utcnow()
    rows = [
        {
            "id": user_id,
            "username": f"migrated_missing_user_{user_id}",
            "email": None,
            "password_hash": PLACEHOLDER_PASSWORD_HASH,
            "pin_hash": None,
            "notes_pin_hash": None,
            "sidebar_order": None,
            "homepage_order": None,
            "created_at": now,
        }
        for user_id in sorted(user_ids)
    ]
    target_conn.execute(user_table.insert(), rows)
    return len(rows)


def placeholder_user_row(user_id: int) -> dict[str, Any]:
    return {
        "id": user_id,
        "username": f"migrated_missing_user_{user_id}",
        "email": None,
        "password_hash": PLACEHOLDER_PASSWORD_HASH,
        "pin_hash": None,
        "notes_pin_hash": None,
        "sidebar_order": None,
        "homepage_order": None,
        "created_at": None,
    }


def assert_empty_target(target_conn: Connection, tables: list[Table]) -> None:
    populated: list[str] = []
    inspector = inspect(target_conn)
    for table in tables:
        if not inspector.has_table(table.name):
            continue
        count = target_conn.execute(select(func.count()).select_from(table)).scalar_one()
        if count:
            populated.append(f"{table.name}={count}")

    if populated:
        raise SystemExit(
            "Target database is not empty. Refusing to merge or overwrite rows: "
            + ", ".join(populated)
        )


def copy_table(
    source_conn: sqlite3.Connection,
    target_conn: Connection,
    table: Table,
    copy_columns: list[str],
    nullable_orphan_repairs: dict[tuple[str, str], set[Any]],
) -> tuple[int, list[dict[str, Any]]]:
    if not copy_columns:
        return 0, []

    deferred_fk_columns = nullable_fk_columns(table)
    preserve_columns = onupdate_columns(table, copy_columns)
    pk_columns = [column.name for column in table.primary_key.columns]
    if deferred_fk_columns and not pk_columns:
        raise SystemExit(f"Table {table.name} has deferred FKs but no primary key.")

    prepared_rows: list[dict[str, Any]] = []
    deferred_updates: list[dict[str, Any]] = []
    rows = sqlite_rows(source_conn, table.name, copy_columns)
    for row in rows:
        insert_row: dict[str, Any] = {}
        update_values: dict[str, Any] = {}
        for column_name in copy_columns:
            value = coerce_value(table, column_name, row[column_name])
            repair_values = nullable_orphan_repairs.get((table.name, column_name), set())
            if value in repair_values:
                value = None
            if column_name in deferred_fk_columns and value is not None:
                insert_row[column_name] = None
                update_values[column_name] = value
            else:
                insert_row[column_name] = value

        if update_values:
            for column_name in preserve_columns:
                update_values[column_name] = insert_row[column_name]
            deferred_updates.append(
                {
                    "pk": {column_name: insert_row[column_name] for column_name in pk_columns},
                    "values": update_values,
                }
            )
        prepared_rows.append(insert_row)

    for chunk in chunked(prepared_rows, CHUNK_SIZE):
        target_conn.execute(table.insert(), chunk)

    return len(prepared_rows), deferred_updates


def apply_deferred_updates(
    target_conn: Connection,
    table: Table,
    deferred_updates: list[dict[str, Any]],
) -> int:
    updated = 0
    for item in deferred_updates:
        conditions = [
            table.c[column_name] == value
            for column_name, value in item["pk"].items()
        ]
        target_conn.execute(
            table.update().where(and_(*conditions)).values(**item["values"])
        )
        updated += 1
    return updated


def reset_postgres_sequences(target_conn: Connection, tables: list[Table]) -> None:
    if target_conn.dialect.name != "postgresql":
        return

    for table in tables:
        if len(table.primary_key.columns) != 1:
            continue
        pk_column = next(iter(table.primary_key.columns))
        if pk_column.name not in table.c:
            continue
        max_id = target_conn.execute(select(pk_column).order_by(pk_column.desc()).limit(1)).scalar()
        if max_id is None:
            continue

        table_name = f'"{table.name.replace(chr(34), chr(34) * 2)}"'
        sequence_name = target_conn.execute(
            text("SELECT pg_get_serial_sequence(:table_name, :column_name)"),
            {"table_name": table_name, "column_name": pk_column.name},
        ).scalar()
        if not sequence_name:
            continue
        target_conn.execute(
            text("SELECT setval(CAST(:sequence_name AS regclass), :value, true)"),
            {"sequence_name": sequence_name, "value": int(max_id)},
        )


def verify_counts(
    source_counts: dict[str, int],
    target_conn: Connection,
    tables: list[Table],
) -> None:
    mismatches: list[str] = []
    for table in tables:
        target_count = int(target_conn.execute(select(func.count()).select_from(table)).scalar_one())
        source_count = source_counts.get(table.name, 0)
        if target_count != source_count:
            mismatches.append(f"{table.name}: source={source_count}, target={target_count}")
    if mismatches:
        raise SystemExit("Row count verification failed: " + "; ".join(mismatches))


def canonical_value(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, datetime):
        return value.isoformat(timespec="microseconds")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, time):
        return value.isoformat(timespec="microseconds")
    if isinstance(value, bytes):
        return value.hex()
    return str(value)


def canonical_row(
    table_name: str,
    row: dict[str, Any],
    columns: list[str],
    placeholder_user_ids: set[int],
) -> str:
    normalized: dict[str, Any] = {}
    is_placeholder_user = (
        table_name == "user"
        and row.get("id") is not None
        and int(row["id"]) in placeholder_user_ids
    )
    for column_name in columns:
        value = row.get(column_name)
        if is_placeholder_user and column_name == "created_at":
            value = "__target_only_placeholder_created_at__"
        normalized[column_name] = canonical_value(value)
    return json.dumps(normalized, sort_keys=True, separators=(",", ":"))


def table_digest(
    table_name: str,
    rows: list[dict[str, Any]],
    columns: list[str],
    placeholder_user_ids: set[int],
) -> tuple[int, str, list[str]]:
    encoded_rows = sorted(
        canonical_row(table_name, row, columns, placeholder_user_ids)
        for row in rows
    )
    digest = hashlib.sha256()
    for encoded_row in encoded_rows:
        digest.update(encoded_row.encode("utf-8"))
        digest.update(b"\n")
    return len(encoded_rows), digest.hexdigest(), encoded_rows


def expected_rows_for_table(
    source_conn: sqlite3.Connection,
    source_tables: set[str],
    table: Table,
    copy_columns: list[str],
    nullable_orphan_repairs: dict[tuple[str, str], set[Any]],
    placeholder_user_ids: set[int],
) -> list[dict[str, Any]]:
    expected_rows: list[dict[str, Any]] = []
    if table.name in source_tables and copy_columns:
        for row in sqlite_rows(source_conn, table.name, copy_columns):
            expected_row: dict[str, Any] = {}
            for column_name in copy_columns:
                value = coerce_value(table, column_name, row[column_name])
                repair_values = nullable_orphan_repairs.get((table.name, column_name), set())
                if value in repair_values:
                    value = None
                expected_row[column_name] = value
            expected_rows.append(expected_row)

    if table.name == "user":
        for user_id in sorted(placeholder_user_ids):
            placeholder = placeholder_user_row(user_id)
            expected_rows.append(
                {column_name: placeholder.get(column_name) for column_name in copy_columns}
            )

    return expected_rows


def target_rows_for_table(
    target_conn: Connection,
    table: Table,
    columns: list[str],
) -> list[dict[str, Any]]:
    if not inspect(target_conn).has_table(table.name):
        raise SystemExit(f"Target database is missing table: {table.name}")
    if not columns:
        return []
    selected_columns = [table.c[column_name] for column_name in columns]
    query = select(*selected_columns)
    for pk_column in table.primary_key.columns:
        if pk_column.name in columns:
            query = query.order_by(table.c[pk_column.name])
    return [dict(row) for row in target_conn.execute(query).mappings().all()]


def first_row_difference(expected_rows: list[str], target_rows: list[str]) -> str:
    max_len = max(len(expected_rows), len(target_rows))
    for index in range(max_len):
        expected = expected_rows[index] if index < len(expected_rows) else "<missing>"
        target = target_rows[index] if index < len(target_rows) else "<missing>"
        if expected != target:
            return f"first difference at sorted row {index + 1}: expected={expected} target={target}"
    return "row content differs"


def verify_full_data(
    source_conn: sqlite3.Connection,
    source_tables: set[str],
    target_conn: Connection,
    tables: list[Table],
    placeholder_user_ids: set[int],
    nullable_orphan_repairs: dict[tuple[str, str], set[Any]],
) -> None:
    mismatches: list[str] = []
    total_rows = 0

    for table in tables:
        copy_columns = validate_source_columns(source_conn, source_tables, table)
        expected_rows = expected_rows_for_table(
            source_conn,
            source_tables,
            table,
            copy_columns,
            nullable_orphan_repairs,
            placeholder_user_ids,
        )
        target_rows = target_rows_for_table(target_conn, table, copy_columns)

        expected_count, expected_hash, expected_encoded = table_digest(
            table.name,
            expected_rows,
            copy_columns,
            placeholder_user_ids,
        )
        target_count, target_hash, target_encoded = table_digest(
            table.name,
            target_rows,
            copy_columns,
            placeholder_user_ids,
        )
        total_rows += expected_count

        if expected_count != target_count or expected_hash != target_hash:
            mismatches.append(
                f"{table.name}: expected count/hash {expected_count}/{expected_hash}, "
                f"target count/hash {target_count}/{target_hash}; "
                f"{first_row_difference(expected_encoded, target_encoded)}"
            )

    if mismatches:
        raise SystemExit("Full data verification failed:\n" + "\n".join(mismatches))

    print(f"Full data verification passed: {len(tables)} tables, {total_rows} expected rows.")


def repair_target_onupdate_columns(
    source_conn: sqlite3.Connection,
    source_tables: set[str],
    target_conn: Connection,
    tables: list[Table],
) -> int:
    repaired = 0
    for table in tables:
        if table.name not in source_tables:
            continue

        copy_columns = validate_source_columns(source_conn, source_tables, table)
        preserve_columns = sorted(onupdate_columns(table, copy_columns))
        if not preserve_columns:
            continue

        pk_columns = [column.name for column in table.primary_key.columns]
        if not pk_columns or any(column_name not in copy_columns for column_name in pk_columns):
            raise SystemExit(f"Cannot repair {table.name}: primary key columns are unavailable.")

        read_columns = list(dict.fromkeys([*pk_columns, *preserve_columns]))
        for row in sqlite_rows(source_conn, table.name, read_columns):
            conditions = [
                table.c[column_name] == coerce_value(table, column_name, row[column_name])
                for column_name in pk_columns
            ]
            values = {
                column_name: coerce_value(table, column_name, row[column_name])
                for column_name in preserve_columns
            }
            result = target_conn.execute(
                table.update().where(and_(*conditions)).values(**values)
            )
            if result.rowcount != 1:
                raise SystemExit(
                    f"Repair expected one target row for {table.name} "
                    f"{dict((name, row[name]) for name in pk_columns)}, "
                    f"updated {result.rowcount}."
                )
            repaired += 1
    return repaired


def print_dry_run(
    source_conn: sqlite3.Connection,
    source_tables: set[str],
    tables: list[Table],
    foreign_key_issues: list[dict[str, Any]],
) -> None:
    print("Dry run only. No PostgreSQL connection was opened.")
    print("SQLite source opened read-only.")
    print("")
    print("Tables to copy:")
    for table in tables:
        count = sqlite_count(source_conn, table.name) if table.name in source_tables else 0
        deferred = sorted(nullable_fk_columns(table))
        suffix = f" deferred FKs: {', '.join(deferred)}" if deferred else ""
        print(f"  {table.name}: {count}{suffix}")
    print_source_integrity_plan(foreign_key_issues)


def migrate(args: argparse.Namespace) -> None:
    sqlite_path = resolve_path(args.sqlite_path, BASE_DIR)
    metadata = db.metadata
    tables = table_copy_order(metadata)

    source_conn = open_sqlite_read_only(sqlite_path)
    try:
        validate_source_tables(source_conn, metadata)
        source_tables = sqlite_tables(source_conn)
        foreign_key_issues = find_foreign_key_issues(source_conn, metadata, source_tables)
        unrepairable = unrepairable_foreign_key_issues(foreign_key_issues)
        if unrepairable:
            print_source_integrity_plan(foreign_key_issues)
            raise SystemExit(
                "Source SQLite contains required foreign-key references that cannot be "
                "repaired safely in the PostgreSQL copy."
            )
        placeholder_user_ids = missing_user_ids(foreign_key_issues)
        nullable_orphan_repairs = nullable_orphan_repair_map(foreign_key_issues)

        if args.dry_run:
            print_dry_run(source_conn, source_tables, tables, foreign_key_issues)
            return

        engine = create_target_engine(target_database_url(args))
        if args.repair_target_updated_at:
            with engine.begin() as target_conn:
                if target_conn.dialect.name != "postgresql":
                    raise SystemExit("Target database must be PostgreSQL.")
                repaired = repair_target_onupdate_columns(
                    source_conn,
                    source_tables,
                    target_conn,
                    tables,
                )
                print(f"Repaired {repaired} target rows with source on-update column values.")
                verify_full_data(
                    source_conn,
                    source_tables,
                    target_conn,
                    tables,
                    placeholder_user_ids,
                    nullable_orphan_repairs,
                )
            print("SQLite source was opened read-only and was not modified.")
            return

        if args.verify_only:
            with engine.connect() as target_conn:
                if target_conn.dialect.name != "postgresql":
                    raise SystemExit("Target database must be PostgreSQL.")
                verify_full_data(
                    source_conn,
                    source_tables,
                    target_conn,
                    tables,
                    placeholder_user_ids,
                    nullable_orphan_repairs,
                )
            print("SQLite source was opened read-only and was not modified.")
            return

        source_counts = {
            table.name: sqlite_count(source_conn, table.name)
            if table.name in source_tables
            else 0
            for table in tables
        }
        source_counts["user"] = source_counts.get("user", 0) + len(placeholder_user_ids)

        print_source_integrity_plan(foreign_key_issues)

        with engine.begin() as target_conn:
            if target_conn.dialect.name != "postgresql":
                raise SystemExit("Target database must be PostgreSQL.")

            if not args.no_create_schema:
                metadata.create_all(target_conn)

            assert_empty_target(target_conn, tables)

            deferred_by_table: dict[str, list[dict[str, Any]]] = {}
            for table in tables:
                copy_columns = validate_source_columns(source_conn, source_tables, table)
                copied, deferred_updates = copy_table(
                    source_conn,
                    target_conn,
                    table,
                    copy_columns,
                    nullable_orphan_repairs,
                )
                deferred_by_table[table.name] = deferred_updates
                print(f"Copied {copied} rows into {table.name}")
                if table.name == "user":
                    placeholders = insert_placeholder_users(
                        target_conn,
                        table,
                        placeholder_user_ids,
                    )
                    if placeholders:
                        print(f"Created {placeholders} target-only placeholder users")

            for table in tables:
                updated = apply_deferred_updates(
                    target_conn,
                    table,
                    deferred_by_table.get(table.name, []),
                )
                if updated:
                    print(f"Applied {updated} deferred FK updates for {table.name}")

            reset_postgres_sequences(target_conn, tables)
            verify_counts(source_counts, target_conn, tables)
            verify_full_data(
                source_conn,
                source_tables,
                target_conn,
                tables,
                placeholder_user_ids,
                nullable_orphan_repairs,
            )

        print("")
        print("Migration complete. Full data verification passed.")
        print("SQLite source was opened read-only and was not modified.")
    finally:
        source_conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Migrate the app's local SQLite database into an empty PostgreSQL database."
    )
    parser.add_argument(
        "--sqlite-path",
        default="instance/todo.db",
        help="Path to the source SQLite database. Default: instance/todo.db",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Target PostgreSQL URL. Defaults to POSTGRES_DATABASE_URL, then DATABASE_URL.",
    )
    parser.add_argument(
        "--no-create-schema",
        action="store_true",
        help="Do not create missing PostgreSQL tables before copying.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Open SQLite read-only, print source counts and copy plan, then exit.",
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Compare SQLite source data to an already-migrated PostgreSQL target without copying.",
    )
    parser.add_argument(
        "--repair-target-updated-at",
        action="store_true",
        help=(
            "Repair PostgreSQL on-update timestamp columns from the read-only SQLite source, "
            "then run full verification."
        ),
    )
    args = parser.parse_args()

    migrate(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
