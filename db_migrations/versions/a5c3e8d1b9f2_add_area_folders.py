"""add area folders

Revision ID: a5c3e8d1b9f2
Revises: f4a7c2d9e6b1
Create Date: 2026-06-30 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = 'a5c3e8d1b9f2'
down_revision = 'f4a7c2d9e6b1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    op.create_table(
        'area_folder',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_area_folder_user_order', 'area_folder', ['user_id', 'order_index'], unique=False)
    op.create_index('idx_area_folder_user_name', 'area_folder', ['user_id', 'name'], unique=False)

    op.add_column(
        'area',
        sa.Column('folder_id', sa.Integer(), nullable=True),
    )
    if bind.dialect.name != 'sqlite':
        op.create_foreign_key(
            'fk_area_folder_id_area_folder',
            'area',
            'area_folder',
            ['folder_id'],
            ['id'],
            ondelete='SET NULL',
        )
    op.create_index('idx_area_user_folder_order', 'area', ['user_id', 'folder_id', 'order_index'], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    op.drop_index('idx_area_user_folder_order', table_name='area')
    if bind.dialect.name != 'sqlite':
        op.drop_constraint('fk_area_folder_id_area_folder', 'area', type_='foreignkey')
    op.drop_column('area', 'folder_id')
    op.drop_index('idx_area_folder_user_name', table_name='area_folder')
    op.drop_index('idx_area_folder_user_order', table_name='area_folder')
    op.drop_table('area_folder')
