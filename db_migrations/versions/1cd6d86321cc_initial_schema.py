"""initial schema

Revision ID: 1cd6d86321cc
Revises: 
Create Date: 2026-06-18 21:16:39.328311
"""

from alembic import op
import sqlalchemy as sa



revision = '1cd6d86321cc'
down_revision = None
branch_labels = None
depends_on = None


CALENDAR_NOTE_LIST_FK = 'fk_calendar_event_note_list_item_id_note_list_item'


def _create_calendar_note_list_fk() -> None:
    if op.get_bind().dialect.name == 'sqlite':
        with op.batch_alter_table('calendar_event') as batch_op:
            batch_op.create_foreign_key(
                CALENDAR_NOTE_LIST_FK,
                'note_list_item',
                ['note_list_item_id'],
                ['id'],
                ondelete='SET NULL',
            )
        return

    op.create_foreign_key(
        CALENDAR_NOTE_LIST_FK,
        'calendar_event',
        'note_list_item',
        ['note_list_item_id'],
        ['id'],
        ondelete='SET NULL',
    )


def _drop_calendar_note_list_fk() -> None:
    if op.get_bind().dialect.name == 'sqlite':
        with op.batch_alter_table('calendar_event') as batch_op:
            batch_op.drop_constraint(CALENDAR_NOTE_LIST_FK, type_='foreignkey')
        return

    op.drop_constraint(CALENDAR_NOTE_LIST_FK, 'calendar_event', type_='foreignkey')


def upgrade() -> None:
    # Baseline schema for new database instances.
    op.create_table('user',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('username', sa.String(length=80), nullable=False),
    sa.Column('email', sa.String(length=120), nullable=True),
    sa.Column('password_hash', sa.String(length=200), nullable=False),
    sa.Column('pin_hash', sa.String(length=200), nullable=True),
    sa.Column('notes_pin_hash', sa.String(length=200), nullable=True),
    sa.Column('sidebar_order', sa.Text(), nullable=True),
    sa.Column('homepage_order', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email'),
    sa.UniqueConstraint('username')
    )
    op.create_table('job_lock',
    sa.Column('job_name', sa.String(length=100), nullable=False),
    sa.Column('locked_at', sa.DateTime(), nullable=False),
    sa.Column('locked_by', sa.String(length=100), nullable=True),
    sa.PrimaryKeyConstraint('job_name')
    )
    op.create_table('bookmark_item',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('value', sa.Text(), nullable=False),
    sa.Column('pinned', sa.Boolean(), nullable=True),
    sa.Column('pin_order', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('do_feed_item',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('url', sa.String(length=600), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('state', sa.String(length=40), nullable=False),
    sa.Column('scheduled_date', sa.Date(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('document_folder',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('parent_id', sa.Integer(), nullable=True),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('order_index', sa.Integer(), nullable=True),
    sa.Column('archived_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['parent_id'], ['document_folder.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('embedding_record',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('entity_type', sa.String(length=30), nullable=False),
    sa.Column('entity_id', sa.Integer(), nullable=False),
    sa.Column('embedding_json', sa.Text(), nullable=True),
    sa.Column('embedding_dim', sa.Integer(), nullable=True),
    sa.Column('source_hash', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'entity_type', 'entity_id', name='uniq_embedding_entity')
    )
    op.create_table('inbox_item',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('suggestion_status', sa.String(length=20), nullable=False),
    sa.Column('suggestion_json', sa.Text(), nullable=True),
    sa.Column('suggestion_source', sa.String(length=20), nullable=True),
    sa.Column('suggestion_reason', sa.String(length=500), nullable=True),
    sa.Column('suggestion_confidence', sa.Float(), nullable=True),
    sa.Column('mapped_destination_type', sa.String(length=30), nullable=True),
    sa.Column('mapped_destination_id', sa.Integer(), nullable=True),
    sa.Column('mapped_result_json', sa.Text(), nullable=True),
    sa.Column('mapped_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_inbox_item_user', 'inbox_item', ['user_id'], unique=False)
    op.create_index('idx_inbox_item_user_status', 'inbox_item', ['user_id', 'status'], unique=False)
    op.create_table('note_folder',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('parent_id', sa.Integer(), nullable=True),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('order_index', sa.Integer(), nullable=True),
    sa.Column('pinned', sa.Boolean(), nullable=True),
    sa.Column('pin_order', sa.Integer(), nullable=True),
    sa.Column('is_pin_protected', sa.Boolean(), nullable=False),
    sa.Column('archived_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['parent_id'], ['note_folder.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('notification',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('type', sa.String(length=50), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('body', sa.Text(), nullable=True),
    sa.Column('link', sa.String(length=300), nullable=True),
    sa.Column('channel', sa.String(length=20), nullable=True),
    sa.Column('read_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('notification_setting',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('in_app_enabled', sa.Boolean(), nullable=True),
    sa.Column('email_enabled', sa.Boolean(), nullable=True),
    sa.Column('push_enabled', sa.Boolean(), nullable=True),
    sa.Column('reminders_enabled', sa.Boolean(), nullable=True),
    sa.Column('digest_enabled', sa.Boolean(), nullable=True),
    sa.Column('digest_hour', sa.Integer(), nullable=True),
    sa.Column('default_snooze_minutes', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id')
    )
    op.create_table('planner_folder',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('parent_id', sa.Integer(), nullable=True),
    sa.Column('name', sa.String(length=150), nullable=False),
    sa.Column('folder_type', sa.String(length=20), nullable=False),
    sa.Column('order_index', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['parent_id'], ['planner_folder.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('push_subscription',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('endpoint', sa.String(length=500), nullable=False),
    sa.Column('p256dh', sa.String(length=255), nullable=False),
    sa.Column('auth', sa.String(length=255), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('endpoint')
    )
    op.create_table('quick_access_item',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('icon', sa.String(length=50), nullable=False),
    sa.Column('url', sa.String(length=500), nullable=False),
    sa.Column('item_type', sa.String(length=30), nullable=False),
    sa.Column('reference_id', sa.Integer(), nullable=True),
    sa.Column('order_index', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('recall_items',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=120), nullable=False),
    sa.Column('payload_type', sa.String(length=10), nullable=False),
    sa.Column('payload', sa.Text(), nullable=False),
    sa.Column('when_context', sa.String(length=30), nullable=False),
    sa.Column('why', sa.String(length=500), nullable=True),
    sa.Column('summary', sa.Text(), nullable=True),
    sa.Column('ai_status', sa.String(length=20), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('recurring_event',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('start_day', sa.Date(), nullable=False),
    sa.Column('end_day', sa.Date(), nullable=True),
    sa.Column('start_time', sa.Time(), nullable=True),
    sa.Column('end_time', sa.Time(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=True),
    sa.Column('priority', sa.String(length=10), nullable=True),
    sa.Column('is_event', sa.Boolean(), nullable=True),
    sa.Column('reminder_minutes_before', sa.Integer(), nullable=True),
    sa.Column('rollover_enabled', sa.Boolean(), nullable=True),
    sa.Column('frequency', sa.String(length=20), nullable=False),
    sa.Column('interval', sa.Integer(), nullable=True),
    sa.Column('interval_unit', sa.String(length=10), nullable=True),
    sa.Column('days_of_week', sa.String(length=50), nullable=True),
    sa.Column('day_of_month', sa.Integer(), nullable=True),
    sa.Column('month_of_year', sa.Integer(), nullable=True),
    sa.Column('week_of_month', sa.Integer(), nullable=True),
    sa.Column('weekday_of_month', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('teamwork_ignored_task',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('task_id', sa.String(length=100), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=True),
    sa.Column('ignored_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'task_id', name='uq_teamwork_ignored_task_user_task')
    )
    op.create_index('idx_teamwork_ignored_task_user_task', 'teamwork_ignored_task', ['user_id', 'task_id'], unique=False)
    op.create_table('todo_list',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=100), nullable=False),
    sa.Column('type', sa.String(length=20), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('order_index', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('document',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('folder_id', sa.Integer(), nullable=True),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('original_filename', sa.String(length=255), nullable=False),
    sa.Column('stored_filename', sa.String(length=255), nullable=False),
    sa.Column('file_type', sa.String(length=100), nullable=True),
    sa.Column('file_extension', sa.String(length=20), nullable=True),
    sa.Column('file_size', sa.Integer(), nullable=True),
    sa.Column('tags', sa.Text(), nullable=True),
    sa.Column('pinned', sa.Boolean(), nullable=True),
    sa.Column('pin_order', sa.Integer(), nullable=True),
    sa.Column('archived_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['folder_id'], ['document_folder.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('planner_group',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('folder_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('order_index', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['folder_id'], ['planner_folder.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('planner_simple_item',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('folder_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('value', sa.String(length=600), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('tags', sa.Text(), nullable=True),
    sa.Column('scheduled_date', sa.Date(), nullable=True),
    sa.Column('order_index', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['folder_id'], ['planner_folder.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('recurrence_exception',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('recurrence_id', sa.Integer(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['recurrence_id'], ['recurring_event.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('todo_item',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('list_id', sa.Integer(), nullable=False),
    sa.Column('content', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('tags', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=True),
    sa.Column('order_index', sa.Integer(), nullable=True),
    sa.Column('is_phase', sa.Boolean(), nullable=True),
    sa.Column('due_date', sa.Date(), nullable=True),
    sa.Column('completed_at', sa.DateTime(), nullable=True),
    sa.Column('linked_list_id', sa.Integer(), nullable=True),
    sa.Column('phase_id', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['linked_list_id'], ['todo_list.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['list_id'], ['todo_list.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['phase_id'], ['todo_item.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('planner_multi_item',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('folder_id', sa.Integer(), nullable=False),
    sa.Column('group_id', sa.Integer(), nullable=True),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('scheduled_date', sa.Date(), nullable=True),
    sa.Column('order_index', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['folder_id'], ['planner_folder.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['group_id'], ['planner_group.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('task_dependency',
    sa.Column('task_id', sa.Integer(), nullable=False),
    sa.Column('depends_on_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['depends_on_id'], ['todo_item.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['task_id'], ['todo_item.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('task_id', 'depends_on_id')
    )
    op.create_table('planner_multi_line',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('item_id', sa.Integer(), nullable=False),
    sa.Column('line_type', sa.String(length=20), nullable=False),
    sa.Column('value', sa.String(length=600), nullable=False),
    sa.Column('scheduled_date', sa.Date(), nullable=True),
    sa.Column('order_index', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['item_id'], ['planner_multi_item.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('calendar_event',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('start_time', sa.Time(), nullable=True),
    sa.Column('end_time', sa.Time(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=True),
    sa.Column('priority', sa.String(length=10), nullable=True),
    sa.Column('is_phase', sa.Boolean(), nullable=True),
    sa.Column('is_event', sa.Boolean(), nullable=True),
    sa.Column('allow_overlap', sa.Boolean(), nullable=True),
    sa.Column('display_mode', sa.String(length=20), nullable=True),
    sa.Column('is_group', sa.Boolean(), nullable=True),
    sa.Column('phase_id', sa.Integer(), nullable=True),
    sa.Column('group_id', sa.Integer(), nullable=True),
    sa.Column('order_index', sa.Integer(), nullable=True),
    sa.Column('reminder_minutes_before', sa.Integer(), nullable=True),
    sa.Column('reminder_job_id', sa.String(length=255), nullable=True),
    sa.Column('reminder_sent', sa.Boolean(), nullable=True),
    sa.Column('reminder_snoozed_until', sa.DateTime(), nullable=True),
    sa.Column('rollover_enabled', sa.Boolean(), nullable=True),
    sa.Column('rolled_from_id', sa.Integer(), nullable=True),
    sa.Column('recurrence_id', sa.Integer(), nullable=True),
    sa.Column('todo_item_id', sa.Integer(), nullable=True),
    sa.Column('planner_simple_item_id', sa.Integer(), nullable=True),
    sa.Column('planner_multi_item_id', sa.Integer(), nullable=True),
    sa.Column('planner_multi_line_id', sa.Integer(), nullable=True),
    sa.Column('note_list_item_id', sa.Integer(), nullable=True),
    sa.Column('do_feed_item_id', sa.Integer(), nullable=True),
    sa.Column('item_note', sa.Text(), nullable=True),
    sa.Column('external_source', sa.String(length=50), nullable=True),
    sa.Column('external_id', sa.String(length=100), nullable=True),
    sa.Column('external_url', sa.String(length=500), nullable=True),
    sa.Column('external_updated_at', sa.DateTime(), nullable=True),
    sa.Column('external_payload_hash', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['do_feed_item_id'], ['do_feed_item.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['group_id'], ['calendar_event.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['phase_id'], ['calendar_event.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['planner_multi_item_id'], ['planner_multi_item.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['planner_multi_line_id'], ['planner_multi_line.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['planner_simple_item_id'], ['planner_simple_item.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['recurrence_id'], ['recurring_event.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['todo_item_id'], ['todo_item.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_calendar_event_external', 'calendar_event', ['user_id', 'external_source', 'external_id'], unique=False)
    op.create_table('note',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('todo_item_id', sa.Integer(), nullable=True),
    sa.Column('calendar_event_id', sa.Integer(), nullable=True),
    sa.Column('planner_multi_item_id', sa.Integer(), nullable=True),
    sa.Column('planner_multi_line_id', sa.Integer(), nullable=True),
    sa.Column('folder_id', sa.Integer(), nullable=True),
    sa.Column('title', sa.String(length=150), nullable=False),
    sa.Column('content', sa.Text(), nullable=True),
    sa.Column('note_type', sa.String(length=20), nullable=False),
    sa.Column('checkbox_mode', sa.Boolean(), nullable=True),
    sa.Column('list_mode', sa.String(length=20), nullable=False),
    sa.Column('pinned', sa.Boolean(), nullable=True),
    sa.Column('pin_order', sa.Integer(), nullable=True),
    sa.Column('archived_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.Column('share_token', sa.String(length=64), nullable=True),
    sa.Column('is_public', sa.Boolean(), nullable=False),
    sa.Column('is_listed', sa.Boolean(), nullable=False),
    sa.Column('is_pin_protected', sa.Boolean(), nullable=False),
    sa.ForeignKeyConstraint(['calendar_event_id'], ['calendar_event.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['folder_id'], ['note_folder.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['planner_multi_item_id'], ['planner_multi_item.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['planner_multi_line_id'], ['planner_multi_line.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['todo_item_id'], ['todo_item.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_note_share_token'), 'note', ['share_token'], unique=True)
    op.create_table('note_list_item',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('note_id', sa.Integer(), nullable=False),
    sa.Column('text', sa.String(length=300), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('inner_note', sa.Text(), nullable=True),
    sa.Column('link_text', sa.String(length=200), nullable=True),
    sa.Column('link_url', sa.String(length=500), nullable=True),
    sa.Column('scheduled_date', sa.Date(), nullable=True),
    sa.Column('checked', sa.Boolean(), nullable=True),
    sa.Column('order_index', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['note_id'], ['note.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    _create_calendar_note_list_fk()
    op.create_table('note_link',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('source_note_id', sa.Integer(), nullable=False),
    sa.Column('target_note_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['source_note_id'], ['note.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['target_note_id'], ['note.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('source_note_id', 'target_note_id', name='uq_note_link_source_target')
    )


def downgrade() -> None:
    _drop_calendar_note_list_fk()
    op.drop_table('note_link')
    op.drop_table('note_list_item')
    op.drop_index(op.f('ix_note_share_token'), table_name='note')
    op.drop_table('note')
    op.drop_index('idx_calendar_event_external', table_name='calendar_event')
    op.drop_table('calendar_event')
    op.drop_table('planner_multi_line')
    op.drop_table('task_dependency')
    op.drop_table('planner_multi_item')
    op.drop_table('todo_item')
    op.drop_table('recurrence_exception')
    op.drop_table('planner_simple_item')
    op.drop_table('planner_group')
    op.drop_table('document')
    op.drop_table('todo_list')
    op.drop_index('idx_teamwork_ignored_task_user_task', table_name='teamwork_ignored_task')
    op.drop_table('teamwork_ignored_task')
    op.drop_table('recurring_event')
    op.drop_table('recall_items')
    op.drop_table('quick_access_item')
    op.drop_table('push_subscription')
    op.drop_table('planner_folder')
    op.drop_table('notification_setting')
    op.drop_table('notification')
    op.drop_table('note_folder')
    op.drop_index('idx_inbox_item_user_status', table_name='inbox_item')
    op.drop_index('idx_inbox_item_user', table_name='inbox_item')
    op.drop_table('inbox_item')
    op.drop_table('embedding_record')
    op.drop_table('document_folder')
    op.drop_table('do_feed_item')
    op.drop_table('bookmark_item')
    op.drop_table('job_lock')
    op.drop_table('user')
