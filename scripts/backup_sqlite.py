#!/usr/bin/env python3
import argparse
import os
import sqlite3
from datetime import datetime
from pathlib import Path


def resolve_path(path_value: str, base_dir: Path) -> Path:
    path = Path(path_value)
    if path.is_absolute():
        return path
    return (base_dir / path).resolve()


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def backup_sqlite(db_path: Path, output_dir: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_name = f"{db_path.stem}_{timestamp}.db"
    tmp_path = output_dir / f"{backup_name}.tmp"
    final_path = output_dir / backup_name

    if tmp_path.exists():
        tmp_path.unlink()

    source_conn = sqlite3.connect(str(db_path))
    try:
        dest_conn = sqlite3.connect(str(tmp_path))
        try:
            source_conn.backup(dest_conn)
        finally:
            dest_conn.close()
    finally:
        source_conn.close()

    os.replace(tmp_path, final_path)
    return final_path


def prune_backups(output_dir: Path, keep: int) -> int:
    if keep <= 0:
        return 0

    backups = sorted(
        (p for p in output_dir.glob("*.db") if p.is_file()),
        key=lambda p: p.stat().st_mtime,
    )
    to_delete = backups[:-keep]
    for path in to_delete:
        path.unlink()
    return len(to_delete)


def main() -> int:
    parser = argparse.ArgumentParser(description="Backup a SQLite database file.")
    parser.add_argument(
        "--db-path",
        default="instance/todo.db",
        help="Path to the SQLite database file (default: instance/todo.db).",
    )
    parser.add_argument(
        "--output-dir",
        default="instance/backups",
        help="Directory to store backups (default: instance/backups).",
    )
    parser.add_argument(
        "--keep",
        type=int,
        default=5,
        help="Number of backups to keep (default: 5).",
    )
    args = parser.parse_args()

    base_dir = Path(__file__).resolve().parents[1]
    db_path = resolve_path(args.db_path, base_dir)
    output_dir = resolve_path(args.output_dir, base_dir)

    if not db_path.exists():
        raise SystemExit(f"Database not found: {db_path}")

    ensure_dir(output_dir)
    backup_path = backup_sqlite(db_path, output_dir)
    deleted = prune_backups(output_dir, args.keep)

    print(f"Backup created: {backup_path}")
    if deleted:
        print(f"Pruned {deleted} old backups.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
