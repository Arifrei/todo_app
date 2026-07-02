"""add area section hidden state

Revision ID: c8f2a1d4e6b3
Revises: a5c3e8d1b9f2, b7d4e6f8a9c1
Create Date: 2026-07-01 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = 'c8f2a1d4e6b3'
down_revision = ('a5c3e8d1b9f2', 'b7d4e6f8a9c1')
branch_labels = None
depends_on = None


def _columns(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column['name'] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if 'hidden_at' not in _columns('area_section'):
        op.add_column('area_section', sa.Column('hidden_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    if 'hidden_at' in _columns('area_section'):
        with op.batch_alter_table('area_section') as batch_op:
            batch_op.drop_column('hidden_at')
