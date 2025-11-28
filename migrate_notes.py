import sqlite3

def add_notes_column():
    conn = sqlite3.connect('instance/todo.db')
    cursor = conn.cursor()
    
    try:
        cursor.execute("ALTER TABLE todo_item ADD COLUMN notes TEXT")
        conn.commit()
        print("Successfully added 'notes' column to todo_item table.")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("'notes' column already exists.")
        else:
            print(f"Error adding column: {e}")
    finally:
        conn.close()

if __name__ == '__main__':
    add_notes_column()
