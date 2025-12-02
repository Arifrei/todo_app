# Multi-User Setup Guide

Your todo app now supports multiple users with authentication!

## What Changed

### Database Schema
- Added `User` table with username, email, and password fields
- Added `user_id` foreign key to `TodoList` table
- All lists and items are now owned by specific users

### Authentication
- Login page at `/login`
- Registration page at `/register`
- Logout functionality at `/logout`
- All routes now require authentication (except login/register)

### Security
- Passwords are hashed using Werkzeug's security functions
- Flask-Login handles session management
- Users can only see and modify their own lists and items

## Default Credentials

After running the migration, a default admin user was created:

- **Username:** `admin`
- **Password:** `admin123`

⚠️ **Important:** Change this password or create a new user for production use!

## Creating New Users

1. Navigate to `http://localhost:5000/register`
2. Fill in the registration form:
   - Username (required)
   - Email (optional, for future features like password recovery)
   - Password (minimum 6 characters)
3. Click "Sign Up"
4. You'll be redirected to the login page

## How It Works

### User Isolation
- Each user has their own dashboard showing only their lists
- Lists, items, and all related data are filtered by the logged-in user
- Users cannot access or modify other users' data

### Migration
The `migrate_add_users.py` script:
1. Created the User table
2. Added user_id column to todo_list table
3. Assigned all existing lists to the default admin user

## Running the App

```bash
python app.py
```

Then visit `http://localhost:5000` and you'll be redirected to the login page.

## Next Steps (Optional Enhancements)

Consider implementing:
- Password reset functionality
- Email verification
- User profile settings
- Shared lists between users
- Admin panel for user management
- Remember me functionality
- Rate limiting for login attempts
