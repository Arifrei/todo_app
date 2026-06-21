# Database Migrations

This directory contains Alembic migrations for the app schema going forward.

Use these migrations for PostgreSQL/Neon and for any new database instances. The
legacy `migrations/migrate.py` and `migrations/global_migrations.py` scripts are
SQLite-only and should not be run against PostgreSQL.

Common commands:

```bash
# Existing production database that already has the current schema:
python -m alembic stamp head

# Empty new database:
python -m alembic upgrade head

# Check current migration state:
python -m alembic current

# Create a future migration after changing models.py:
python -m alembic revision --autogenerate -m "describe change"

# Apply pending migrations:
python -m alembic upgrade head
```

`ALEMBIC_DATABASE_URL` can be used to point Alembic at a database without changing
the app's `DATABASE_URL`.
