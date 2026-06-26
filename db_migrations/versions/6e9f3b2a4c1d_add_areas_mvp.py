"""add areas mvp

Revision ID: 6e9f3b2a4c1d
Revises: 1cd6d86321cc
Create Date: 2026-06-23 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = '6e9f3b2a4c1d'
down_revision = '1cd6d86321cc'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'area',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('color', sa.String(length=20), nullable=True),
        sa.Column('icon', sa.String(length=80), nullable=True),
        sa.Column('order_index', sa.Integer(), nullable=True),
        sa.Column('archived_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'idx_area_user_archived_order',
        'area',
        ['user_id', 'archived_at', 'order_index'],
        unique=False,
    )
    op.create_index('idx_area_user_name', 'area', ['user_id', 'name'], unique=False)

    op.create_table(
        'area_item',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('area_id', sa.Integer(), nullable=False),
        sa.Column('text', sa.String(length=300), nullable=False),
        sa.Column('details', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('scheduled_date', sa.Date(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('order_index', sa.Integer(), nullable=True),
        sa.Column('linked_note_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.CheckConstraint(
            "status IN ('open', 'done', 'later')",
            name='ck_area_item_status',
        ),
        sa.ForeignKeyConstraint(['area_id'], ['area.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['linked_note_id'], ['note.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'idx_area_item_user_area_order',
        'area_item',
        ['user_id', 'area_id', 'order_index'],
        unique=False,
    )
    op.create_index(
        'idx_area_item_user_status',
        'area_item',
        ['user_id', 'status'],
        unique=False,
    )
    op.create_index(
        'idx_area_item_user_scheduled',
        'area_item',
        ['user_id', 'scheduled_date'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('idx_area_item_user_scheduled', table_name='area_item')
    op.drop_index('idx_area_item_user_status', table_name='area_item')
    op.drop_index('idx_area_item_user_area_order', table_name='area_item')
    op.drop_table('area_item')
    op.drop_index('idx_area_user_name', table_name='area')
    op.drop_index('idx_area_user_archived_order', table_name='area')
    op.drop_table('area')
