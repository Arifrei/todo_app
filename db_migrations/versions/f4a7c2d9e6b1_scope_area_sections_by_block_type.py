"""scope area sections by block type

Revision ID: f4a7c2d9e6b1
Revises: e8b4f3a2c9d1
Create Date: 2026-06-28 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = 'f4a7c2d9e6b1'
down_revision = 'e8b4f3a2c9d1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column['name'] for column in inspector.get_columns('area_section')}
    if 'block_type' not in columns:
        op.add_column(
            'area_section',
            sa.Column('block_type', sa.String(length=30), nullable=False, server_default='line'),
        )
    op.execute(
        """
        UPDATE area_section
        SET block_type = CASE
            WHEN lower(title) = 'notes' THEN 'note'
            WHEN lower(title) = 'lists' THEN 'list'
            WHEN lower(title) IN ('tasks', 'task list', 'task lists') THEN 'task_list'
            ELSE COALESCE(
                (
                    SELECT area_block.block_type
                    FROM area_block
                    WHERE area_block.section_id = area_section.id
                    ORDER BY area_block.id
                    LIMIT 1
                ),
                'line'
            )
        END
        """
    )
    if bind.dialect.name != 'sqlite':
        op.alter_column(
            'area_section',
            'block_type',
            existing_type=sa.String(length=30),
            server_default=None,
        )
    indexes = {index['name'] for index in inspector.get_indexes('area_section')}
    if 'idx_area_section_user_area_type_order' not in indexes:
        op.create_index(
            'idx_area_section_user_area_type_order',
            'area_section',
            ['user_id', 'area_id', 'block_type', 'order_index'],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    indexes = {index['name'] for index in inspector.get_indexes('area_section')}
    if 'idx_area_section_user_area_type_order' in indexes:
        op.drop_index('idx_area_section_user_area_type_order', table_name='area_section')
    columns = {column['name'] for column in inspector.get_columns('area_section')}
    if 'block_type' in columns:
        op.drop_column('area_section', 'block_type')
