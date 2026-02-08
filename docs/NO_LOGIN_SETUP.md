# No-Login Multi-User Setup

Your todo app now has **session-based user selection** instead of password authentication!

## What Changed

### Removed Features
- ❌ Login page with password
- ❌ Registration with password
- ❌ `@login_required` decorators
- ❌ Flask-Login dependency

### Added Features
- ✅ User selection page at `/select-user`
- ✅ Create new users without passwords
- ✅ Session persists for 1 year (survives browser restarts)
- ✅ User switcher in sidebar
- ✅ All data still isolated per user

## How It Works

### First Visit
1. Visit `http://localhost:5000`
2. You'll see a user selection page showing all available users
3. Click on a user to select them, or create a new one
4. Once selected, you're redirected to the dashboard
5. Your selection is stored in a permanent session cookie

### Subsequent Visits
- You'll automatically be logged in as your previously selected user
- The session persists even when you:
  - Close the browser
  - Restart the app
  - Restart your computer

### Switching Users
- Click "Switch User" in the sidebar
- Select a different user from the list
- Your session immediately switches to that user

## Session Persistence

The session lasts for **1 year** and survives:
- Browser restarts
- App redeployments
- Computer restarts

This is implemented using Flask's `session.permanent = True` with a `PERMANENT_SESSION_LIFETIME` of 365 days.

## Creating New Users

On the user selection page:
1. Enter a username in the text field
2. Click "Create"
3. You're automatically selected as that user

No password needed!

## Migration from Old Login System

If you had the old login system, your users are still there. They can be selected from the user selection page without needing passwords.

## Running the App

```bash
python app.py
```

Visit `http://localhost:5000` and select or create your user!

## Security Note

This approach is suitable for:
- **Local/personal use** - Perfect for a desktop app used by one person with multiple "personas"
- **Trusted environments** - Internal tools where authentication isn't critical
- **Development** - Quick multi-user testing without authentication overhead

**Not suitable for:**
- Public-facing applications
- Situations requiring actual security
- Shared computers where privacy is needed

## Benefits

✅ **No login friction** - Start using the app immediately
✅ **Persistent selection** - Set it once, never think about it again
✅ **Easy switching** - Change users in one click
✅ **Simple user creation** - Just type a name
✅ **Survives restarts** - Session persists across app redeployments

## Technical Details

### Session Storage
- Uses Flask's secure session cookies (signed with `SECRET_KEY`)
- Stored in the browser's cookie storage
- Automatically sent with every request

### User Isolation
- All API routes check `session.get('user_id')`
- Users can only access their own lists and items
- Database still enforces user ownership via foreign keys

### Routes
- `/select-user` - User selection page
- `/api/set-user/<user_id>` - Set current user
- `/api/create-user` - Create new user
- `/api/current-user` - Get current user info
