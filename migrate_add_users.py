"""
Migration script to add multi-user support to the todo app.
This will:
1. Create the User table
2. Add user_id column to todo_list table
3. Create a default user and assign all existing lists to them
"""
import sqlite3
from werkzeug.security import generate_password_hash

DB_PATH = 'instance/todo.db'

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # Check if User table already exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user'")
        user_table_exists = cursor.fetchone() is not None

        if not user_table_exists:
            print("Creating User table...")
            cursor.execute('''
                CREATE TABLE user (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username VARCHAR(80) UNIQUE NOT NULL,
                    email VARCHAR(120) UNIQUE,
                    password_hash VARCHAR(200) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Create a default user
            default_password = generate_password_hash('admin123')
            cursor.execute('''
                INSERT INTO user (username, email, password_hash)
                VALUES (?, ?, ?)
            ''', ('admin', 'admin@example.com', default_password))
            default_user_id = cursor.lastrowid
            print(f"Created default user 'admin' with password 'admin123' (ID: {default_user_id})")
        else:
            print("User table already exists, getting first user...")
            cursor.execute("SELECT id FROM user LIMIT 1")
            result = cursor.fetchone()
            if result:
                default_user_id = result[0]
            else:
                # Create default user if table exists but is empty
                default_password = generate_password_hash('admin123')
                cursor.execute('''
                    INSERT INTO user (username, email, password_hash)
                    VALUES (?, ?, ?)
                ''', ('admin', 'admin@example.com', default_password))
                default_user_id = cursor.lastrowid
                print(f"Created default user 'admin' (ID: {default_user_id})")

        # Check if user_id column exists in todo_list
        cursor.execute("PRAGMA table_info(todo_list)")
        columns = [row[1] for row in cursor.fetchall()]

        if 'user_id' not in columns:
            print("Adding user_id column to todo_list table...")

            # SQLite doesn't support adding foreign key constraints to existing tables,
            # so we need to recreate the table

            # Get existing data
            cursor.execute("SELECT id, title, type, created_at FROM todo_list")
            existing_lists = cursor.fetchall()

            # Rename old table
            cursor.execute("ALTER TABLE todo_list RENAME TO todo_list_old")

            # Create new table with user_id
            cursor.execute('''
                CREATE TABLE todo_list (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title VARCHAR(100) NOT NULL,
                    type VARCHAR(20) DEFAULT 'list',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    user_id INTEGER NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES user (id)
                )
            ''')

            # Migrate data with default user_id
            for list_data in existing_lists:
                cursor.execute('''
                    INSERT INTO todo_list (id, title, type, created_at, user_id)
                    VALUES (?, ?, ?, ?, ?)
                ''', (*list_data, default_user_id))

            print(f"Migrated {len(existing_lists)} lists to user ID {default_user_id}")

            # Drop old table
            cursor.execute("DROP TABLE todo_list_old")
        else:
            print("user_id column already exists in todo_list table")

        conn.commit()
        print("\nMigration completed successfully!")
        print("Default credentials: username='admin', password='admin123'")
        print("You can now create additional users through the registration page.")

    except Exception as e:
        conn.rollback()
        print(f"Error during migration: {e}")
        raise
    finally:
        conn.close()

if __name__ == '__main__':
    migrate()
