def table_exists(cur, name: str) -> bool:
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,))
    return cur.fetchone() is not None


def column_exists(cur, table: str, column: str) -> bool:
    cur.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cur.fetchall())


def add_column(cur, table: str, column: str, col_type: str, default_sql: str | None = None):
    if column_exists(cur, table, column):
        print(f"[skip] {table}.{column} exists")
        return
    cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
    if default_sql is not None:
        cur.execute(f"UPDATE {table} SET {column} = {default_sql} WHERE {column} IS NULL")
    print(f"[add] {table}.{column}")
