"""add note images

Revision ID: d1e2f3a4b5c6
Revises: c8f2a1d4e6b3
Create Date: 2026-07-01 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = 'd1e2f3a4b5c6'
down_revision = 'c8f2a1d4e6b3'
branch_labels = None
depends_on = None


def _columns(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {c['name'] for c in inspector.get_columns(table_name)}


def _tables() -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return set(inspector.get_table_names())


def upgrade() -> None:
    if 'note_image' not in _tables():
        op.create_table(
            'note_image',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('note_id', sa.Integer(), nullable=True),
            sa.Column('original_filename', sa.String(length=255), nullable=True),
            sa.Column('stored_filename', sa.String(length=100), nullable=False),
            sa.Column('file_type', sa.String(length=50), nullable=False),
            sa.Column('file_size', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['user.id']),
            sa.ForeignKeyConstraint(['note_id'], ['note.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('stored_filename'),
        )
        op.create_index('idx_note_image_user', 'note_image', ['user_id'], unique=False)
        op.create_index('idx_note_image_note', 'note_image', ['note_id'], unique=False)


def downgrade() -> None:
    if 'note_image' in _tables():
        op.drop_index('idx_note_image_note', table_name='note_image')
        op.drop_index('idx_note_image_user', table_name='note_image')
        op.drop_table('note_image')
