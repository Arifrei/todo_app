"""add area workspace blocks

Revision ID: 8f2d4b1c9e3a
Revises: 6e9f3b2a4c1d
Create Date: 2026-06-23 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = '8f2d4b1c9e3a'
down_revision = '6e9f3b2a4c1d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'area_section',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('area_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=120), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('order_index', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['area_id'], ['area.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'idx_area_section_user_area_order',
        'area_section',
        ['user_id', 'area_id', 'order_index'],
        unique=False,
    )

    op.create_table(
        'area_block',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('area_id', sa.Integer(), nullable=False),
        sa.Column('section_id', sa.Integer(), nullable=True),
        sa.Column('block_type', sa.String(length=30), nullable=False),
        sa.Column('title', sa.String(length=180), nullable=True),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('order_index', sa.Integer(), nullable=True),
        sa.Column('source_note_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.CheckConstraint(
            "block_type IN ('line', 'note', 'list', 'task_list')",
            name='ck_area_block_type',
        ),
        sa.ForeignKeyConstraint(['area_id'], ['area.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['section_id'], ['area_section.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['source_note_id'], ['note.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'idx_area_block_user_area_order',
        'area_block',
        ['user_id', 'area_id', 'order_index'],
        unique=False,
    )
    op.create_index(
        'idx_area_block_user_section_order',
        'area_block',
        ['user_id', 'section_id', 'order_index'],
        unique=False,
    )
    op.create_index(
        'idx_area_block_user_type',
        'area_block',
        ['user_id', 'block_type'],
        unique=False,
    )

    op.create_table(
        'area_block_item',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('area_id', sa.Integer(), nullable=False),
        sa.Column('block_id', sa.Integer(), nullable=False),
        sa.Column('text', sa.String(length=500), nullable=False),
        sa.Column('details', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('checked', sa.Boolean(), nullable=False),
        sa.Column('scheduled_date', sa.Date(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('order_index', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.CheckConstraint(
            "status IN ('open', 'done', 'later')",
            name='ck_area_block_item_status',
        ),
        sa.ForeignKeyConstraint(['area_id'], ['area.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['block_id'], ['area_block.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'idx_area_block_item_user_block_order',
        'area_block_item',
        ['user_id', 'block_id', 'order_index'],
        unique=False,
    )
    op.create_index(
        'idx_area_block_item_user_area_order',
        'area_block_item',
        ['user_id', 'area_id', 'order_index'],
        unique=False,
    )
    op.create_index(
        'idx_area_block_item_user_status',
        'area_block_item',
        ['user_id', 'status'],
        unique=False,
    )
    op.create_index(
        'idx_area_block_item_user_scheduled',
        'area_block_item',
        ['user_id', 'scheduled_date'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('idx_area_block_item_user_scheduled', table_name='area_block_item')
    op.drop_index('idx_area_block_item_user_status', table_name='area_block_item')
    op.drop_index('idx_area_block_item_user_area_order', table_name='area_block_item')
    op.drop_index('idx_area_block_item_user_block_order', table_name='area_block_item')
    op.drop_table('area_block_item')
    op.drop_index('idx_area_block_user_type', table_name='area_block')
    op.drop_index('idx_area_block_user_section_order', table_name='area_block')
    op.drop_index('idx_area_block_user_area_order', table_name='area_block')
    op.drop_table('area_block')
    op.drop_index('idx_area_section_user_area_order', table_name='area_section')
    op.drop_table('area_section')
