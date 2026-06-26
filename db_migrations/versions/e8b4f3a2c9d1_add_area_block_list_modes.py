"""add area block list modes

Revision ID: e8b4f3a2c9d1
Revises: c7a9d12e45f0
Create Date: 2026-06-25 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = 'e8b4f3a2c9d1'
down_revision = 'c7a9d12e45f0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'area_block',
        sa.Column('checkbox_mode', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        'area_block',
        sa.Column('list_mode', sa.String(length=20), nullable=False, server_default='standard'),
    )
    op.execute("UPDATE area_block SET checkbox_mode = TRUE WHERE block_type = 'task_list'")
    op.execute("UPDATE area_block SET list_mode = 'standard' WHERE list_mode IS NULL OR list_mode = ''")
    op.alter_column('area_block', 'checkbox_mode', server_default=None)
    op.alter_column('area_block', 'list_mode', server_default=None)


def downgrade() -> None:
    op.drop_column('area_block', 'list_mode')
    op.drop_column('area_block', 'checkbox_mode')
