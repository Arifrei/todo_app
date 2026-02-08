# Project Structure

## Root (runtime entrypoints)
- `app.py` - Flask app entrypoint.
- `models.py` - SQLAlchemy models.
- `ai_service.py` - AI task orchestration.
- `requirements.txt` - Python dependencies.
- `package.json` - Capacitor/mobile scripts.

## Backend modules
- `backend/` - Core backend modules (AI, embeddings, processing, helpers).
- `services/` - Route and domain handlers.
- `scripts/` - One-off maintenance scripts.
- `migrations/` - Database migration implementations.

## Frontend
- `templates/` - Jinja templates.
- `static/` - JS/CSS/assets.
- `static/shared-ui.js` - Shared UI helpers/classes extracted from `app.js`.
- `static/app/` - Split app runtime scripts (`core`, `tasks`, `calendar`, `homepage`).
- `static/notes/` - Split notes runtime scripts (`bootstrap`, `editor`, `list-editor`, `detail`).
- `static/css/` - Split stylesheet sections; `static/style.css` now imports these files.

## Platform/mobile
- `android/` - Capacitor Android project.
- `www/` - Capacitor web bundle assets.

## Project support
- `docs/` - Project documentation and guides.
- `tools/` - Build and local utility scripts.
- `certs/` - Local certificate/key files.

## Compatibility wrappers
Root-level wrappers remain for:
- `migrate.py`, `global_migrations.py`, `migration_utils.py`

Use tooling scripts from `tools/` directly.
