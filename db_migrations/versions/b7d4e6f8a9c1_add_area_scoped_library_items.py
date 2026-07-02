"""add area scoped library items

Revision ID: b7d4e6f8a9c1
Revises: f4a7c2d9e6b1
Create Date: 2026-07-01 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = 'b7d4e6f8a9c1'
down_revision = 'f4a7c2d9e6b1'
branch_labels = None
depends_on = None


TABLES = (
    ('recall_items', 'idx_recall_user_area_updated', ['user_id', 'area_id', 'updated_at']),
    ('bookmark_item', 'idx_bookmark_user_area_pin', ['user_id', 'area_id', 'pinned', 'pin_order']),
    ('document_folder', 'idx_document_folder_user_area_parent', ['user_id', 'area_id', 'parent_id']),
    ('document', 'idx_document_user_area', ['user_id', 'area_id']),
)


def _columns(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column['name'] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    for table_name, index_name, index_columns in TABLES:
        if 'area_id' not in _columns(table_name):
            op.add_column(table_name, sa.Column('area_id', sa.Integer(), nullable=True))
        op.create_index(index_name, table_name, index_columns, unique=False, if_not_exists=True)


def downgrade() -> None:
    for table_name, index_name, _index_columns in reversed(TABLES):
        op.drop_index(index_name, table_name=table_name, if_exists=True)
        if 'area_id' not in _columns(table_name):
            continue
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.drop_column('area_id')
