"""extend area block items for full editors

Revision ID: c7a9d12e45f0
Revises: 8f2d4b1c9e3a
Create Date: 2026-06-24 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = 'c7a9d12e45f0'
down_revision = '8f2d4b1c9e3a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'area_block_item',
        sa.Column('item_type', sa.String(length=30), nullable=False, server_default='item'),
    )
    op.add_column('area_block_item', sa.Column('note', sa.Text(), nullable=True))
    op.add_column('area_block_item', sa.Column('inner_note', sa.Text(), nullable=True))
    op.add_column('area_block_item', sa.Column('link_text', sa.String(length=200), nullable=True))
    op.add_column('area_block_item', sa.Column('link_url', sa.String(length=500), nullable=True))
    op.add_column('area_block_item', sa.Column('linked_block_id', sa.Integer(), nullable=True))
    op.create_check_constraint(
        'ck_area_block_item_type',
        'area_block_item',
        "item_type IN ('item', 'section', 'subsection', 'linked_note', 'linked_list')",
    )
    op.create_foreign_key(
        'fk_area_block_item_linked_block_id_area_block',
        'area_block_item',
        'area_block',
        ['linked_block_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.alter_column('area_block_item', 'item_type', server_default=None)


def downgrade() -> None:
    op.drop_constraint('fk_area_block_item_linked_block_id_area_block', 'area_block_item', type_='foreignkey')
    op.drop_constraint('ck_area_block_item_type', 'area_block_item', type_='check')
    op.drop_column('area_block_item', 'linked_block_id')
    op.drop_column('area_block_item', 'link_url')
    op.drop_column('area_block_item', 'link_text')
    op.drop_column('area_block_item', 'inner_note')
    op.drop_column('area_block_item', 'note')
    op.drop_column('area_block_item', 'item_type')
