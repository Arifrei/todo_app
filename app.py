import os
import re
import json
import logging
import calendar
import pytz
import secrets
import mimetypes
import uuid
from datetime import datetime, date, time, timedelta
from dotenv import load_dotenv, find_dotenv
from flask import Flask, render_template, request, jsonify, redirect, url_for, session, send_from_directory
from werkzeug.utils import secure_filename
from backend.ai_service import run_ai_chat
from backend.ai_embeddings import get_openai_client, embed_text
from backend.embedding_service import (
    ENTITY_BOOKMARK,
    ENTITY_CALENDAR,
    ENTITY_RECALL,
    ENTITY_TODO_ITEM,
    ENTITY_TODO_LIST,
    delete_embedding_for_entity,
    refresh_embedding_for_entity,
)
from models import db, User, TodoList, TodoItem, Note, NoteFolder, NoteListItem, NoteLink, CalendarEvent, RecurringEvent, RecurrenceException, Notification, NotificationSetting, PushSubscription, RecallItem, QuickAccessItem, BookmarkItem, DoFeedItem, PlannerFolder, PlannerSimpleItem, PlannerGroup, PlannerMultiItem, PlannerMultiLine, DocumentFolder, Document
from apscheduler.schedulers.background import BackgroundScheduler
from pywebpush import webpush, WebPushException
import requests
from sqlalchemy import or_, func
from backend.background_jobs import start_app_context_job, start_daemon_thread
from backend.phase_utils import canonicalize_phase_flags, is_phase_header
from services.ai_gateway import call_chat_json, call_chat_text, parse_json_object
from services.bulk_handlers import bulk_notes_route, bulk_vault_documents_route
from services.duplicate_service import build_list_preview_text, detect_note_list_duplicates
from services.quick_bookmark_handlers import (
    bookmark_detail_route,
    bulk_bookmarks_route,
    handle_bookmarks_route,
    handle_quick_access_route,
    quick_access_item_route,
    quick_access_order_route,
)
from services.validation_service import (
    merge_tag_list,
    normalize_note_type,
    normalize_tags,
    parse_bool,
    parse_day_value,
    parse_days_of_week,
    parse_time_str,
    tags_to_string,
)
from backend.text_helpers import (
    _html_to_plain_text,
    _sanitize_note_html,
    _wrap_plain_text_html,
    extract_note_list_lines,
    is_note_linked,
    linkify_text,
    normalize_calendar_item_note,
)

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DOTENV_PATH = find_dotenv() or os.path.join(BASE_DIR, '.env')
if DOTENV_PATH and os.path.exists(DOTENV_PATH):
    load_dotenv(DOTENV_PATH)

app = Flask(__name__)
# Keep DB path aligned with migration scripts (instance/todo.db)
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get("DATABASE_URL", "sqlite:///todo.db")
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
app.config['PERMANENT_SESSION_LIFETIME'] = 365 * 24 * 60 * 60  # 1 year in seconds
app.config['API_SHARED_KEY'] = os.environ.get('API_SHARED_KEY')  # Optional shared key for API callers
app.config['DEFAULT_TIMEZONE'] = os.environ.get('DEFAULT_TIMEZONE', 'America/New_York')  # EST/EDT
app.config['VAPID_PUBLIC_KEY'] = os.environ.get('VAPID_PUBLIC_KEY', '')
app.config['VAPID_PRIVATE_KEY'] = os.environ.get('VAPID_PRIVATE_KEY', '')
app.config['OPENAI_API_KEY'] = os.environ.get('OPENAI_API_KEY', '')
app.config['OPENAI_STT_MODEL'] = os.environ.get('OPENAI_STT_MODEL', 'whisper-1')
DEFAULT_VAULT_MAX_SIZE = 50 * 1024 * 1024
try:
    app.config['VAULT_MAX_FILE_SIZE'] = int(os.environ.get('VAULT_MAX_FILE_SIZE', DEFAULT_VAULT_MAX_SIZE))
except (TypeError, ValueError):
    app.config['VAULT_MAX_FILE_SIZE'] = DEFAULT_VAULT_MAX_SIZE

db.init_app(app)
scheduler = None
# Ensure our app logger emits INFO to the console
if app.logger.level > logging.INFO or app.logger.level == logging.NOTSET:
    app.logger.setLevel(logging.INFO)

DEFAULT_SIDEBAR_ORDER = ['home', 'tasks', 'calendar', 'notes', 'vault', 'recalls', 'bookmarks', 'planner', 'feed', 'quick-access', 'ai', 'settings']
DEFAULT_HOMEPAGE_ORDER = ['tasks', 'calendar', 'notes', 'vault', 'recalls', 'bookmarks', 'planner', 'feed', 'quick-access', 'ai', 'settings', 'download']
CALENDAR_ITEM_NOTE_MAX_CHARS = 300
NOTE_LIST_CONVERSION_MIN_LINES = 2
NOTE_LIST_CONVERSION_MAX_LINES = 100
NOTE_LIST_CONVERSION_MAX_CHARS = 80
NOTE_LIST_CONVERSION_MAX_WORDS = 12
NOTE_LIST_CONVERSION_SENTENCE_WORD_LIMIT = 8
LIST_SECTION_PREFIX = '[[section]]'
PLANNER_FEED_FOLDER_NAME = 'Feed'
ALLOWED_PRIORITIES = {'low', 'medium', 'high'}
ALLOWED_STATUSES = {'not_started', 'in_progress', 'done', 'canceled'}
VAULT_BLOCKED_EXTENSIONS = {
    'exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'ps1', 'vbs', 'vbe', 'wsf', 'wsh'
}

app.jinja_env.filters['linkify_text'] = linkify_text


def _extract_note_list_lines(raw_html):
    from backend.app_core_logic import _extract_note_list_lines as _impl
    return _impl(raw_html)

def _is_note_linked(note, linked_targets=None, linked_sources=None):
    from backend.app_core_logic import _is_note_linked as _impl
    return _impl(note, linked_targets, linked_sources)

def _normalize_calendar_item_note(raw):
    from backend.app_core_logic import _normalize_calendar_item_note as _impl
    return _impl(raw)

def get_current_user():
    from backend.app_core_logic import get_current_user as _impl
    return _impl()

def _ensure_planner_feed_folder(user):
    from backend.app_core_logic import _ensure_planner_feed_folder as _impl
    return _impl(user)

def _vault_root_for_user(user_id):
    from backend.app_core_logic import _vault_root_for_user as _impl
    return _impl(user_id)

def _vault_sanitize_extension(filename):
    from backend.app_core_logic import _vault_sanitize_extension as _impl
    return _impl(filename)

def _vault_is_blocked_file(filename, mimetype):
    from backend.app_core_logic import _vault_is_blocked_file as _impl
    return _impl(filename, mimetype)

def _vault_build_download_name(title, original_filename):
    from backend.app_core_logic import _vault_build_download_name as _impl
    return _impl(title, original_filename)

def _vault_archive_folder_recursive(user_id, folder_id, archived_at):
    from backend.app_core_logic import _vault_archive_folder_recursive as _impl
    return _impl(user_id, folder_id, archived_at)

def _now_local():
    from backend.app_core_logic import _now_local as _impl
    return _impl()

def _sanitize_sidebar_order(order):
    from backend.app_core_logic import _sanitize_sidebar_order as _impl
    return _impl(order)

def _load_sidebar_order(user):
    from backend.app_core_logic import _load_sidebar_order as _impl
    return _impl(user)

def _save_sidebar_order(user, order):
    from backend.app_core_logic import _save_sidebar_order as _impl
    return _impl(user, order)

def _sanitize_homepage_order(order):
    from backend.app_core_logic import _sanitize_homepage_order as _impl
    return _impl(order)

def _load_homepage_order(user):
    from backend.app_core_logic import _load_homepage_order as _impl
    return _impl(user)

def _save_homepage_order(user, order):
    from backend.app_core_logic import _save_homepage_order as _impl
    return _impl(user, order)

def start_recall_processing(recall_id):
    from backend.app_core_logic import start_recall_processing as _impl
    return _impl(recall_id)

def start_embedding_job(user_id, entity_type, entity_id):
    from backend.app_core_logic import start_embedding_job as _impl
    return _impl(user_id, entity_type, entity_id)

def delete_embedding(user_id, entity_type, entity_id):
    from backend.app_core_logic import delete_embedding as _impl
    return _impl(user_id, entity_type, entity_id)

def start_list_children_embedding_job(user_id, list_id):
    from backend.app_core_logic import start_list_children_embedding_job as _impl
    return _impl(user_id, list_id)

def parse_outline(outline_text, list_type='list'):
    from backend.app_core_logic import parse_outline as _impl
    return _impl(outline_text, list_type)

def parse_hub_outline(outline_text):
    from backend.app_core_logic import parse_hub_outline as _impl
    return _impl(outline_text)

def _format_metadata(content, description=None, notes=None):
    from backend.app_core_logic import _format_metadata as _impl
    return _impl(content, description, notes)

def _status_mark(status):
    from backend.app_core_logic import _status_mark as _impl
    return _impl(status)

def export_list_outline(todo_list, indent=0):
    from backend.app_core_logic import export_list_outline as _impl
    return _impl(todo_list, indent)

def _slugify_filename(value):
    from backend.app_core_logic import _slugify_filename as _impl
    return _impl(value)

def insert_item_in_order(todo_list, new_item, phase_id=None):
    from backend.app_core_logic import insert_item_in_order as _impl
    return _impl(todo_list, new_item, phase_id)

def insert_items_under_phase(todo_list, new_items, phase_id=None):
    from backend.app_core_logic import insert_items_under_phase as _impl
    return _impl(todo_list, new_items, phase_id)

def reindex_list(todo_list):
    from backend.app_core_logic import reindex_list as _impl
    return _impl(todo_list)

def _time_to_minutes(t):
    from backend.app_core_logic import _time_to_minutes as _impl
    return _impl(t)

def _event_end_minutes(start_minutes, end_time):
    from backend.app_core_logic import _event_end_minutes as _impl
    return _impl(start_minutes, end_time)

def _task_conflicts_with_event(user_id, day_obj, task_start, task_end, new_task_exclusive, exclude_event_id=None):
    from backend.app_core_logic import _task_conflicts_with_event as _impl
    return _impl(user_id, day_obj, task_start, task_end, new_task_exclusive, exclude_event_id)

def _event_conflicts_with_event(user_id, day_obj, event_start, event_end, new_allow_overlap, exclude_event_id=None):
    from backend.app_core_logic import _event_conflicts_with_event as _impl
    return _impl(user_id, day_obj, event_start, event_end, new_allow_overlap, exclude_event_id)

def _event_conflicts_with_task(user_id, day_obj, event_start, event_end, new_event_allow_overlap, exclude_event_id=None):
    from backend.app_core_logic import _event_conflicts_with_task as _impl
    return _impl(user_id, day_obj, event_start, event_end, new_event_allow_overlap, exclude_event_id)

def _task_conflicts_with_task(user_id, day_obj, task_start, task_end, new_task_exclusive, exclude_event_id=None):
    from backend.app_core_logic import _task_conflicts_with_task as _impl
    return _impl(user_id, day_obj, task_start, task_end, new_task_exclusive, exclude_event_id)

def _next_calendar_order(day_value, user_id):
    from backend.app_core_logic import _next_calendar_order as _impl
    return _impl(day_value, user_id)

def _weekday_occurrence_in_month(day_value):
    from backend.app_core_logic import _weekday_occurrence_in_month as _impl
    return _impl(day_value)

def _nth_weekday_of_month(year, month, weekday, nth):
    from backend.app_core_logic import _nth_weekday_of_month as _impl
    return _impl(year, month, weekday, nth)

def _recurrence_occurs_on(rule, day_value):
    from backend.app_core_logic import _recurrence_occurs_on as _impl
    return _impl(rule, day_value)

def _ensure_recurring_instances(user_id, start_day, end_day):
    from backend.app_core_logic import _ensure_recurring_instances as _impl
    return _impl(user_id, start_day, end_day)

def _prune_recurring_instances(rule, user_id):
    from backend.app_core_logic import _prune_recurring_instances as _impl
    return _impl(rule, user_id)

def _rollover_incomplete_events():
    from backend.app_core_logic import _rollover_incomplete_events as _impl
    return _impl()

def _cleanup_completed_tasks():
    from backend.app_core_logic import _cleanup_completed_tasks as _impl
    return _impl()

def _send_email(to_addr, subject, body, html_body=None):
    from backend.app_core_logic import _send_email as _impl
    return _impl(to_addr, subject, body, html_body)

def _build_daily_digest_body(events_for_day, tasks_for_day):
    from backend.app_core_logic import _build_daily_digest_body as _impl
    return _impl(events_for_day, tasks_for_day)

def _build_daily_digest_html(events_for_day, tasks_for_day, day_value):
    from backend.app_core_logic import _build_daily_digest_html as _impl
    return _impl(events_for_day, tasks_for_day, day_value)

def _send_daily_email_digest(target_day=None):
    from backend.app_core_logic import _send_daily_email_digest as _impl
    return _impl(target_day)

def _schedule_reminder_job(event):
    from backend.app_core_logic import _schedule_reminder_job as _impl
    return _impl(event)

def _cancel_reminder_job(event):
    from backend.app_core_logic import _cancel_reminder_job as _impl
    return _impl(event)

def _send_event_reminder(event_id):
    from backend.app_core_logic import _send_event_reminder as _impl
    return _impl(event_id)

def _check_calendar_reminders():
    from backend.app_core_logic import _check_calendar_reminders as _impl
    return _impl()

def _schedule_existing_reminders():
    from backend.app_core_logic import _schedule_existing_reminders as _impl
    return _impl()

def _start_scheduler():
    from backend.app_core_logic import _start_scheduler as _impl
    return _impl()

@app.before_request
def _bootstrap_background_jobs():
    from backend.app_core_logic import _bootstrap_background_jobs as _impl
    return _impl()

@app.route('/select-user')
def select_user():
    from services.user_routes import select_user as _impl
    return _impl()

@app.route('/logout')
def logout_user():
    from services.user_routes import logout_user as _impl
    return _impl()

@app.route('/api/set-user/<int:user_id>', methods=['POST'])
def set_user(user_id):
    from services.user_routes import set_user as _impl
    return _impl(user_id)

@app.route('/api/create-user', methods=['POST'])
def create_user():
    from services.user_routes import create_user as _impl
    return _impl()

@app.route('/api/current-user')
def current_user_info():
    from services.user_routes import current_user_info as _impl
    return _impl()


@app.route('/api/user/profile', methods=['GET', 'PUT'])
def user_profile():
    from services.user_routes import user_profile as _impl
    return _impl()

@app.route('/api/sidebar-order', methods=['GET', 'POST'])
def sidebar_order():
    from services.user_routes import sidebar_order as _impl
    return _impl()

@app.route('/api/homepage-order', methods=['GET', 'POST'])
def homepage_order():
    from services.user_routes import homepage_order as _impl
    return _impl()

@app.route('/')
def index():
    from services.inline_routes import index as _impl
    return _impl()

@app.route('/tasks')
def tasks_page():
    from services.inline_routes import tasks_page as _impl
    return _impl()

@app.route('/download/app')
def download_app():
    from services.inline_routes import download_app as _impl
    return _impl()

@app.route('/notes')
def notes_page():
    from services.inline_routes import notes_page as _impl
    return _impl()

@app.route('/vault')
def vault_page():
    from services.inline_routes import vault_page as _impl
    return _impl()

@app.route('/notes/new')
def new_note_page():
    from services.inline_routes import new_note_page as _impl
    return _impl()

@app.route('/notes/<int:note_id>')
def note_editor_page(note_id):
    from services.inline_routes import note_editor_page as _impl
    return _impl(note_id)

@app.route('/notes/folder/<int:folder_id>')
def notes_folder_page(folder_id):
    from services.inline_routes import notes_folder_page as _impl
    return _impl(folder_id)

@app.route('/recalls')
def recalls_page():
    from services.inline_routes import recalls_page as _impl
    return _impl()

@app.route('/ai')
def ai_page():
    from services.inline_routes import ai_page as _impl
    return _impl()

@app.route('/api/ai/stt', methods=['POST'])
def transcribe_audio():
    from services.inline_routes import transcribe_audio as _impl
    return _impl()

@app.route('/settings')
def settings_page():
    from services.inline_routes import settings_page as _impl
    return _impl()

@app.route('/service-worker.js')
def service_worker():
    from services.inline_routes import service_worker as _impl
    return _impl()

@app.route('/calendar')
def calendar_page():
    from services.inline_routes import calendar_page as _impl
    return _impl()

@app.route('/quick-access')
def quick_access_page():
    from services.inline_routes import quick_access_page as _impl
    return _impl()

@app.route('/bookmarks')
def bookmarks_page():
    from services.inline_routes import bookmarks_page as _impl
    return _impl()

@app.route('/planner')
def planner_page():
    from services.inline_routes import planner_page as _impl
    return _impl()

@app.route('/planner/folder/<int:folder_id>')
def planner_folder_page(folder_id):
    from services.inline_routes import planner_folder_page as _impl
    return _impl(folder_id)

@app.route('/feed')
def feed_page():
    from services.inline_routes import feed_page as _impl
    return _impl()

@app.route('/list/<int:list_id>')
def list_view(list_id):
    from services.inline_routes import list_view as _impl
    return _impl(list_id)

@app.route('/api/lists', methods=['GET', 'POST'])
def handle_lists():
    from services.list_routes import handle_lists as _impl
    return _impl()


@app.route('/api/lists/reorder', methods=['POST'])
def reorder_lists():
    from services.list_routes import reorder_lists as _impl
    return _impl()


@app.route('/api/notes', methods=['GET', 'POST'])
def handle_notes():
    from services.notes_routes import handle_notes as _impl
    return _impl()


@app.route('/api/notes/resolve-link', methods=['POST'])
def resolve_note_link():
    from services.notes_routes import resolve_note_link as _impl
    return _impl()


@app.route('/api/notes/cleanup', methods=['POST'])
def cleanup_note_content():
    from services.notes_routes import cleanup_note_content as _impl
    return _impl()


@app.route('/api/notes/reorder', methods=['POST'])
def reorder_notes():
    from services.inline_routes import reorder_notes as _impl
    return _impl()

@app.route('/api/note-folders', methods=['GET', 'POST'])
def note_folders():
    from services.inline_routes import note_folders as _impl
    return _impl()

@app.route('/api/note-folders/<int:folder_id>', methods=['GET', 'PUT', 'DELETE'])
def note_folder_detail(folder_id):
    from services.notes_routes import note_folder_detail as _impl
    return _impl(folder_id)


@app.route('/api/note-folders/<int:folder_id>/archive', methods=['POST'])
def archive_note_folder(folder_id):
    from services.inline_routes import archive_note_folder as _impl
    return _impl(folder_id)

@app.route('/api/note-folders/<int:folder_id>/restore', methods=['POST'])
def restore_note_folder(folder_id):
    from services.inline_routes import restore_note_folder as _impl
    return _impl(folder_id)

@app.route('/api/notes/move', methods=['POST'])
def move_notes():
    from services.inline_routes import move_notes as _impl
    return _impl()

@app.route('/api/note-folders/move', methods=['POST'])
def move_note_folders():
    from services.notes_routes import move_note_folders as _impl
    return _impl()


@app.route('/api/vault/folders', methods=['GET', 'POST'])
def vault_folders():
    from services.vault_routes import vault_folders as _impl
    return _impl()


@app.route('/api/vault/folders/<int:folder_id>', methods=['GET', 'PUT', 'DELETE'])
def vault_folder_detail(folder_id):
    from services.inline_routes import vault_folder_detail as _impl
    return _impl(folder_id)

@app.route('/api/vault/documents', methods=['GET', 'POST'])
def vault_documents():
    from services.vault_routes import vault_documents as _impl
    return _impl()


@app.route('/api/vault/documents/<int:doc_id>', methods=['GET', 'PUT', 'DELETE'])
def vault_document_detail(doc_id):
    from services.vault_routes import vault_document_detail as _impl
    return _impl(doc_id)


@app.route('/api/vault/documents/<int:doc_id>/download', methods=['GET'])
def vault_document_download(doc_id):
    from services.inline_routes import vault_document_download as _impl
    return _impl(doc_id)

@app.route('/api/vault/documents/<int:doc_id>/preview', methods=['GET'])
def vault_document_preview(doc_id):
    from services.inline_routes import vault_document_preview as _impl
    return _impl(doc_id)

@app.route('/api/vault/documents/<int:doc_id>/move', methods=['POST'])
def vault_document_move(doc_id):
    from services.inline_routes import vault_document_move as _impl
    return _impl(doc_id)

@app.route('/api/vault/search', methods=['GET'])
def vault_search():
    from services.inline_routes import vault_search as _impl
    return _impl()

@app.route('/api/vault/stats', methods=['GET'])
def vault_stats():
    from services.inline_routes import vault_stats as _impl
    return _impl()

@app.route('/api/recalls', methods=['GET', 'POST'])
def handle_recalls():
    from services.inline_routes import handle_recalls as _impl
    return _impl()

@app.route('/api/recalls/<int:recall_id>', methods=['GET', 'PUT', 'DELETE'])
def recall_detail(recall_id):
    from services.inline_routes import recall_detail as _impl
    return _impl(recall_id)

@app.route('/api/recalls/<int:recall_id>/regenerate', methods=['POST'])
def regenerate_recall(recall_id):
    from services.inline_routes import regenerate_recall as _impl
    return _impl(recall_id)

@app.route('/api/notes/<int:note_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_note(note_id):
    from services.notes_routes import handle_note as _impl
    return _impl(note_id)


@app.route('/api/notes/<int:note_id>/archive', methods=['POST'])
def archive_note(note_id):
    from services.inline_routes import archive_note as _impl
    return _impl(note_id)

@app.route('/api/notes/<int:note_id>/restore', methods=['POST'])
def restore_note(note_id):
    from services.inline_routes import restore_note as _impl
    return _impl(note_id)

@app.route('/api/notes/<int:note_id>/duplicate', methods=['POST'])
def duplicate_note(note_id):
    from services.notes_routes import duplicate_note as _impl
    return _impl(note_id)


@app.route('/api/notes/<int:note_id>/convert-to-list', methods=['POST'])
def convert_note_to_list(note_id):
    from services.notes_routes import convert_note_to_list as _impl
    return _impl(note_id)


def _reindex_note_list_items(note_id):
    from backend.app_core_logic import _reindex_note_list_items as _impl
    return _impl(note_id)

@app.route('/api/notes/<int:note_id>/list-items', methods=['GET', 'POST'])
def note_list_items(note_id):
    from services.notes_routes import note_list_items as _impl
    return _impl(note_id)


@app.route('/api/notes/<int:note_id>/list-items/duplicates', methods=['GET'])
def note_list_item_duplicates(note_id):
    from services.inline_routes import note_list_item_duplicates as _impl
    return _impl(note_id)

@app.route('/api/notes/<int:note_id>/list-items/<int:item_id>', methods=['PUT', 'DELETE'])
def note_list_item_detail(note_id, item_id):
    from services.notes_routes import note_list_item_detail as _impl
    return _impl(note_id, item_id)


@app.route('/api/notes/<int:note_id>/list-items/reorder', methods=['POST'])
def reorder_note_list_items(note_id):
    from services.inline_routes import reorder_note_list_items as _impl
    return _impl(note_id)

@app.route('/api/notes/<int:note_id>/share', methods=['POST', 'DELETE'])
def share_note(note_id):
    from services.inline_routes import share_note as _impl
    return _impl(note_id)

@app.route('/shared/<token>')
def view_shared_note(token):
    from services.inline_routes import view_shared_note as _impl
    return _impl(token)

@app.route('/api/pin', methods=['GET'])
def check_pin_status():
    from services.inline_routes import check_pin_status as _impl
    return _impl()

@app.route('/api/pin', methods=['POST'])
def set_pin():
    from services.inline_routes import set_pin as _impl
    return _impl()

@app.route('/api/pin', methods=['DELETE'])
def remove_pin():
    from services.inline_routes import remove_pin as _impl
    return _impl()

@app.route('/api/pin/verify', methods=['POST'])
def verify_pin():
    from services.inline_routes import verify_pin as _impl
    return _impl()

@app.route('/api/notes-pin/status', methods=['GET'])
def notes_pin_status():
    from services.inline_routes import notes_pin_status as _impl
    return _impl()

@app.route('/api/notes-pin', methods=['POST'])
def set_notes_pin():
    from services.inline_routes import set_notes_pin as _impl
    return _impl()

@app.route('/api/notes/<int:note_id>/unlock', methods=['POST'])
def unlock_note(note_id):
    from services.inline_routes import unlock_note as _impl
    return _impl(note_id)

@app.route('/api/note-folders/<int:folder_id>/unlock', methods=['POST'])
def unlock_folder(folder_id):
    from services.inline_routes import unlock_folder as _impl
    return _impl(folder_id)

@app.route('/api/quick-access', methods=['GET', 'POST'])
def handle_quick_access():
    from services.inline_routes import handle_quick_access as _impl
    return _impl()

@app.route('/api/quick-access/<int:item_id>', methods=['DELETE', 'PUT'])
def delete_quick_access(item_id):
    from services.inline_routes import delete_quick_access as _impl
    return _impl(item_id)

@app.route('/api/quick-access/order', methods=['PUT'])
def update_quick_access_order():
    from services.inline_routes import update_quick_access_order as _impl
    return _impl()

@app.route('/api/bookmarks', methods=['GET', 'POST'])
def handle_bookmarks():
    from services.inline_routes import handle_bookmarks as _impl
    return _impl()

@app.route('/api/bookmarks/<int:item_id>', methods=['GET', 'PUT', 'DELETE'])
def bookmark_detail(item_id):
    from services.inline_routes import bookmark_detail as _impl
    return _impl(item_id)

@app.route('/api/planner', methods=['GET'])
def get_planner_data():
    from services.planner_routes import get_planner_data as _impl
    return _impl()


@app.route('/api/planner/folders', methods=['POST'])
def create_planner_folder():
    from services.inline_routes import create_planner_folder as _impl
    return _impl()

@app.route('/api/planner/folders/<int:folder_id>', methods=['PUT', 'DELETE'])
def update_planner_folder(folder_id):
    from services.inline_routes import update_planner_folder as _impl
    return _impl(folder_id)

@app.route('/api/planner/simple-items', methods=['POST'])
def create_planner_simple_item():
    from services.inline_routes import create_planner_simple_item as _impl
    return _impl()

@app.route('/api/planner/simple-items/<int:item_id>', methods=['PUT', 'DELETE'])
def update_planner_simple_item(item_id):
    from services.inline_routes import update_planner_simple_item as _impl
    return _impl(item_id)

@app.route('/api/planner/simple-items/<int:item_id>/to-recall', methods=['POST'])
def planner_simple_item_to_recall(item_id):
    from services.inline_routes import planner_simple_item_to_recall as _impl
    return _impl(item_id)

@app.route('/api/planner/groups', methods=['POST'])
def create_planner_group():
    from services.inline_routes import create_planner_group as _impl
    return _impl()

@app.route('/api/planner/groups/<int:group_id>', methods=['PUT', 'DELETE'])
def update_planner_group(group_id):
    from services.inline_routes import update_planner_group as _impl
    return _impl(group_id)

@app.route('/api/planner/multi-items', methods=['POST'])
def create_planner_multi_item():
    from services.planner_routes import create_planner_multi_item as _impl
    return _impl()


@app.route('/api/planner/multi-items/<int:item_id>', methods=['PUT', 'DELETE'])
def update_planner_multi_item(item_id):
    from services.inline_routes import update_planner_multi_item as _impl
    return _impl(item_id)

@app.route('/api/planner/multi-items/order', methods=['POST'])
def update_planner_multi_item_order():
    from services.inline_routes import update_planner_multi_item_order as _impl
    return _impl()

@app.route('/api/planner/multi-lines', methods=['POST'])
def create_planner_multi_line():
    from services.inline_routes import create_planner_multi_line as _impl
    return _impl()

@app.route('/api/planner/multi-lines/<int:line_id>', methods=['PUT', 'DELETE'])
def update_planner_multi_line(line_id):
    from services.inline_routes import update_planner_multi_line as _impl
    return _impl(line_id)

@app.route('/api/feed', methods=['GET', 'POST'])
def handle_feed():
    from services.inline_routes import handle_feed as _impl
    return _impl()

@app.route('/api/feed/<int:item_id>', methods=['GET', 'PUT', 'DELETE'])
def feed_detail(item_id):
    from services.inline_routes import feed_detail as _impl
    return _impl(item_id)

@app.route('/api/feed/<int:item_id>/to-recall', methods=['POST'])
def feed_to_recall(item_id):
    from services.inline_routes import feed_to_recall as _impl
    return _impl(item_id)

@app.route('/api/calendar/search', methods=['GET'])
def calendar_search():
    from services.calendar_routes import calendar_search as _impl
    return _impl()


@app.route('/api/calendar/events', methods=['GET', 'POST'])
def calendar_events():
    from services.calendar_routes import calendar_events as _impl
    return _impl()


@app.route('/api/calendar/recurring', methods=['POST'])
def create_recurring_calendar_event():
    from services.calendar_routes import create_recurring_calendar_event as _impl
    return _impl()


@app.route('/api/calendar/recurring', methods=['GET'])
def list_recurring_events():
    from services.inline_routes import list_recurring_events as _impl
    return _impl()

@app.route('/api/calendar/recurring/<int:rule_id>', methods=['PUT', 'DELETE'])
def recurring_event_detail(rule_id):
    from services.calendar_routes import recurring_event_detail as _impl
    return _impl(rule_id)


@app.route('/api/calendar/events/<int:event_id>', methods=['PUT', 'DELETE'])
def calendar_event_detail(event_id):
    from services.calendar_routes import calendar_event_detail as _impl
    return _impl(event_id)


@app.route('/api/calendar/events/reorder', methods=['POST'])
def reorder_calendar_events():
    from services.inline_routes import reorder_calendar_events as _impl
    return _impl()

@app.route('/api/calendar/rollover-now', methods=['POST'])
def manual_rollover():
    from services.inline_routes import manual_rollover as _impl
    return _impl()

@app.route('/api/calendar/digest/email', methods=['POST'])
def send_digest_now():
    from services.inline_routes import send_digest_now as _impl
    return _impl()

def _get_or_create_notification_settings(user_id):
    from backend.app_core_logic import _get_or_create_notification_settings as _impl
    return _impl(user_id)

@app.route('/api/notifications', methods=['GET', 'POST'])
def api_list_notifications():
    from services.inline_routes import api_list_notifications as _impl
    return _impl()

@app.route('/api/notifications/read_all', methods=['POST'])
def api_mark_notifications_read():
    from services.inline_routes import api_mark_notifications_read as _impl
    return _impl()

@app.route('/api/notifications/<int:notification_id>/read', methods=['POST'])
def api_mark_notification_read(notification_id):
    from services.inline_routes import api_mark_notification_read as _impl
    return _impl(notification_id)

@app.route('/api/notifications/settings', methods=['GET', 'PUT'])
def api_notification_settings():
    from services.inline_routes import api_notification_settings as _impl
    return _impl()

def _send_push_to_user(user, title, body=None, link=None, event_id=None, actions=None):
    from backend.app_core_logic import _send_push_to_user as _impl
    return _impl(user, title, body, link, event_id, actions)

@app.route('/api/push/subscribe', methods=['POST'])
def api_push_subscribe():
    from services.push_routes import api_push_subscribe as _impl
    return _impl()


@app.route('/api/push/unsubscribe', methods=['POST'])
def api_push_unsubscribe():
    from services.push_routes import api_push_unsubscribe as _impl
    return _impl()


@app.route('/api/push/subscriptions', methods=['GET'])
def api_push_list():
    from services.push_routes import api_push_list as _impl
    return _impl()


@app.route('/api/push/subscriptions/clear', methods=['POST'])
def api_push_clear():
    from services.push_routes import api_push_clear as _impl
    return _impl()


@app.route('/api/push/test', methods=['POST'])
def api_push_test():
    from services.push_routes import api_push_test as _impl
    return _impl()


@app.route('/api/calendar/events/<int:event_id>/snooze', methods=['POST'])
def snooze_reminder(event_id):
    from services.notification_routes import snooze_reminder as _impl
    return _impl(event_id)


@app.route('/api/calendar/events/<int:event_id>/dismiss', methods=['POST'])
def dismiss_reminder(event_id):
    from services.inline_routes import dismiss_reminder as _impl
    return _impl(event_id)

@app.route('/api/calendar/events/pending-reminders', methods=['GET'])
def get_pending_reminders():
    from services.notification_routes import get_pending_reminders as _impl
    return _impl()


@app.route('/api/lists/<int:list_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_list(list_id):
    from services.list_routes import handle_list as _impl
    return _impl(list_id)


@app.route('/api/lists/<int:list_id>/items', methods=['GET'])
def list_items_in_list(list_id):
    from services.inline_routes import list_items_in_list as _impl
    return _impl(list_id)

@app.route('/api/lists/<int:list_id>/items', methods=['POST'])
def create_item(list_id):
    from services.items_routes import create_item as _impl
    return _impl(list_id)

@app.route('/api/items/<int:item_id>', methods=['PUT', 'DELETE'])
def handle_item(item_id):
    from services.items_routes import handle_item as _impl
    return _impl(item_id)


@app.route('/api/items', methods=['GET'])
def query_items():
    from services.items_routes import query_items as _impl
    return _impl()


@app.route('/api/search')
def search_entities():
    from services.inline_routes import search_entities as _impl
    return _impl()

@app.route('/api/ai/chat', methods=['POST'])
def ai_chat():
    from services.inline_routes import ai_chat as _impl
    return _impl()

@app.route('/api/items/<int:item_id>/move', methods=['POST'])
def move_item(item_id):
    from services.items_routes import move_item as _impl
    return _impl(item_id)

@app.route('/api/move-destinations/<int:list_id>', methods=['GET'])
def move_destinations(list_id):
    from services.inline_routes import move_destinations as _impl
    return _impl(list_id)

@app.route('/api/lists/<int:list_id>/phases')
def list_phases(list_id):
    from services.inline_routes import list_phases as _impl
    return _impl(list_id)

@app.route('/api/hubs')
def list_hubs():
    from services.inline_routes import list_hubs as _impl
    return _impl()

@app.route('/api/hubs/<int:hub_id>/children')
def hub_children(hub_id):
    from services.inline_routes import hub_children as _impl
    return _impl(hub_id)

@app.route('/api/lists/<int:list_id>/export', methods=['GET'])
def export_list(list_id):
    from services.inline_routes import export_list as _impl
    return _impl(list_id)

@app.route('/api/lists/<int:list_id>/bulk_import', methods=['POST'])
def bulk_import(list_id):
    from services.items_routes import bulk_import as _impl
    return _impl(list_id)


@app.route('/api/items/bulk', methods=['POST'])
def bulk_items():
    from services.items_routes import bulk_items as _impl
    return _impl()


@app.route('/api/lists/<int:list_id>/reorder', methods=['POST'])
def reorder_items(list_id):
    from services.inline_routes import reorder_items as _impl
    return _impl(list_id)

@app.route('/api/notes/bulk', methods=['POST'])
def bulk_notes():
    from services.inline_routes import bulk_notes as _impl
    return _impl()

@app.route('/api/vault/documents/bulk', methods=['POST'])
def bulk_vault_documents():
    from services.inline_routes import bulk_vault_documents as _impl
    return _impl()

@app.route('/api/bookmarks/bulk', methods=['POST'])
def bulk_bookmarks():
    from services.inline_routes import bulk_bookmarks as _impl
    return _impl()


if __name__ == '__main__':
    host = os.environ.get('HOST', '127.0.0.1')
    try:
        port = int(os.environ.get('PORT', '5004'))
    except (TypeError, ValueError):
        port = 5004
    debug = os.environ.get('FLASK_DEBUG', '0').lower() in ('1', 'true', 'yes', 'on')
    app.run(host=host, port=port, debug=True)
