import hashlib
import hmac
import os
from dataclasses import dataclass
from datetime import datetime

import requests
from flask import current_app
from sqlalchemy import func

from backend.embedding_service import ENTITY_CALENDAR, delete_embedding_for_entity
from models import CalendarEvent, TeamworkIgnoredTask, User, db


SOURCE_NAME = 'teamwork'
DEFAULT_PAGE_SIZE = 100
DEFAULT_SYNC_INTERVAL_MINUTES = 15


class TeamworkConfigError(RuntimeError):
    pass


@dataclass
class TeamworkConfig:
    base_url: str
    api_key: str
    assignee_user_id: str | None = None
    sync_project_ids: str | None = None
    webhook_token: str | None = None
    local_user_id: int | None = None
    page_size: int = DEFAULT_PAGE_SIZE
    request_timeout: int = 20


def _clean_env(value):
    if value is None:
        return None
    value = str(value).strip().strip('"').strip("'")
    return value or None


def _normalize_base_url(site):
    site = _clean_env(site)
    if not site:
        raise TeamworkConfigError('TEAMWORK_SITE is required')
    if site.startswith(('http://', 'https://')):
        return site.rstrip('/')
    if '.' in site:
        return f'https://{site}'.rstrip('/')
    return f'https://{site}.teamwork.com'


def _int_env(name, default=None):
    value = _clean_env(os.environ.get(name))
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def get_teamwork_config():
    api_key = _clean_env(os.environ.get('TEAMWORK_API_KEY'))
    if not api_key:
        raise TeamworkConfigError('TEAMWORK_API_KEY is required')

    return TeamworkConfig(
        base_url=_normalize_base_url(os.environ.get('TEAMWORK_SITE')),
        api_key=api_key,
        assignee_user_id=_clean_env(os.environ.get('TEAMWORK_ASSIGNEE_USER_ID')),
        sync_project_ids=(
            _clean_env(os.environ.get('TEAMWORK_SYNC_PROJECT_IDS'))
            or _clean_env(os.environ.get('TEAMWORK_SYNC_PROJECT_ID'))
        ),
        webhook_token=_clean_env(os.environ.get('TEAMWORK_WEBHOOK_TOKEN')) or _clean_env(os.environ.get('API_SHARED_KEY')),
        local_user_id=_int_env('TEAMWORK_LOCAL_USER_ID'),
        page_size=max(1, min(_int_env('TEAMWORK_PAGE_SIZE', DEFAULT_PAGE_SIZE), 250)),
        request_timeout=max(5, _int_env('TEAMWORK_TIMEOUT_SECONDS', 20)),
    )


def teamwork_enabled():
    try:
        get_teamwork_config()
        return True
    except TeamworkConfigError:
        return False


def get_teamwork_sync_interval_minutes():
    return max(1, _int_env('TEAMWORK_SYNC_INTERVAL_MINUTES', DEFAULT_SYNC_INTERVAL_MINUTES))


def get_target_user(config=None):
    config = config or get_teamwork_config()
    if config.local_user_id:
        user = db.session.get(User, config.local_user_id)
        if user:
            return user
        current_app.logger.warning('TEAMWORK_LOCAL_USER_ID=%s did not match a local user', config.local_user_id)
    return User.query.order_by(User.id.asc()).first()


def verify_webhook_signature(raw_body, headers, token):
    if not token:
        return True
    signature = (
        headers.get('X-Projects-Signature')
        or headers.get('Signature')
        or headers.get('X-Teamwork-Signature')
        or ''
    ).strip()
    if not signature:
        return False
    digest = hmac.new(token.encode('utf-8'), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature.lower(), digest.lower())


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _get_any(mapping, *keys):
    if not isinstance(mapping, dict):
        return None
    for key in keys:
        if key in mapping:
            return mapping[key]
    lower_lookup = {str(key).lower(): value for key, value in mapping.items()}
    for key in keys:
        key_l = str(key).lower()
        if key_l in lower_lookup:
            return lower_lookup[key_l]
    return None


def _parse_date(value):
    value = _clean_env(value)
    if not value:
        return None
    if value.endswith('Z'):
        value = value[:-1] + '+00:00'
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        pass
    for fmt in ('%Y-%m-%d', '%Y%m%d', '%m/%d/%Y'):
        try:
            return datetime.strptime(value[:10], fmt).date()
        except ValueError:
            continue
    return None


def _parse_datetime(value):
    value = _clean_env(value)
    if not value:
        return None
    if value.endswith('Z'):
        value = value[:-1] + '+00:00'
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo:
            parsed = parsed.astimezone().replace(tzinfo=None)
        return parsed
    except ValueError:
        return None


def _task_id(task):
    task_id = _get_any(task, 'id', 'taskId', 'taskID')
    if task_id is None:
        return None
    return str(task_id)


def _task_name(task):
    return (_clean_env(_get_any(task, 'name', 'content', 'title', 'taskName')) or 'Teamwork task')[:200]


def _task_due_date(task):
    return _parse_date(_get_any(task, 'dueDate', 'dueAt', 'due-date', 'due_on', 'endDate'))


def _task_updated_at(task):
    return _parse_datetime(_get_any(task, 'dateUpdated', 'updatedAt', 'updated_at', 'lastChangedOn'))


def _task_priority(task):
    priority = (_clean_env(_get_any(task, 'priority')) or '').lower()
    if priority in {'low', 'medium', 'high'}:
        return priority
    return 'medium'


def _task_status(task):
    status = (_clean_env(_get_any(task, 'status', 'taskStatus')) or '').lower()
    completed = _get_any(task, 'completed', 'isComplete', 'isCompleted')
    deleted = _get_any(task, 'deleted', 'isDeleted')
    if deleted is True or status == 'deleted':
        return 'deleted'
    if completed is True or status in {'completed', 'complete', 'done'}:
        return 'done'
    if status in {'active', 'in_progress', 'started'}:
        return 'in_progress'
    return 'not_started'


def _task_project_id(task):
    value = _get_any(task, 'projectId', 'projectID')
    project = _get_any(task, 'project')
    if value is None and isinstance(project, dict):
        value = _get_any(project, 'id')
    return str(value) if value is not None else None


def _included_item(included, section, item_id):
    if not included or not item_id:
        return None
    section_data = _get_any(included, section)
    if isinstance(section_data, dict):
        item = section_data.get(str(item_id))
        if item is None and str(item_id).isdigit():
            item = section_data.get(int(item_id))
        return item if isinstance(item, dict) else None
    if isinstance(section_data, list):
        for item in section_data:
            if isinstance(item, dict) and str(_get_any(item, 'id')) == str(item_id):
                return item
    return None


def _task_tasklist_id(task):
    value = _get_any(task, 'tasklistId', 'taskListId', 'todoListId')
    tasklist = _get_any(task, 'tasklist', 'taskList')
    if value is None and isinstance(tasklist, dict):
        value = _get_any(tasklist, 'id')
    return str(value) if value is not None else None


def _included_name(included, section, item_id):
    item = _included_item(included, section, item_id)
    return _clean_env(_get_any(item, 'name', 'title')) if item else None


def _project_name(task, included):
    project = _get_any(task, 'project')
    if isinstance(project, dict):
        name = _clean_env(_get_any(project, 'name', 'title'))
        if name:
            return name

    project_id = _task_project_id(task)
    if project_id:
        name = _included_name(included, 'projects', project_id)
        if name:
            return name

    tasklist = _included_item(included, 'tasklists', _task_tasklist_id(task))
    tasklist_project_id = _get_any(tasklist, 'projectId', 'projectID') if tasklist else None
    return _included_name(included, 'projects', tasklist_project_id)


def _tasklist_name(task, included):
    tasklist = _get_any(task, 'tasklist', 'taskList', 'todoList')
    if isinstance(tasklist, dict):
        name = _clean_env(_get_any(tasklist, 'name', 'title'))
        if name:
            return name

    name = _clean_env(_get_any(task, 'tasklistName', 'taskListName', 'todoListName', 'tasklistTitle'))
    if name:
        return name

    return _included_name(included, 'tasklists', _task_tasklist_id(task))


def _user_display_name(user, fallback_id=None):
    if not isinstance(user, dict):
        return str(fallback_id) if fallback_id is not None else None
    name = _clean_env(_get_any(user, 'name', 'displayName', 'fullName'))
    if name:
        return name
    first = _clean_env(_get_any(user, 'firstName', 'firstname')) or ''
    last = _clean_env(_get_any(user, 'lastName', 'lastname')) or ''
    combined = ' '.join(part for part in (first, last) if part).strip()
    if combined:
        return combined
    email = _clean_env(_get_any(user, 'email'))
    if email:
        return email
    user_id = _get_any(user, 'id', 'userId', 'userID')
    if user_id is not None:
        return str(user_id)
    if fallback_id is not None:
        return str(fallback_id)
    return None


def _assignee_names(task, included):
    names = []
    seen = set()

    def add_name(candidate, fallback_id=None):
        name = _user_display_name(candidate, fallback_id=fallback_id)
        if not name:
            return
        key = name.strip().lower()
        if key in seen:
            return
        seen.add(key)
        names.append(name.strip())

    for raw_user in _as_list(_get_any(task, 'assigneeUsers', 'users', 'people')):
        if isinstance(raw_user, dict):
            user_id = _get_any(raw_user, 'id', 'userId', 'userID')
            included_user = _included_item(included, 'users', user_id)
            add_name(included_user or raw_user, fallback_id=user_id)
        elif raw_user is not None:
            included_user = _included_item(included, 'users', raw_user)
            add_name(included_user, fallback_id=raw_user)

    assignees = _get_any(task, 'assignees')
    for raw_user in _as_list(assignees):
        if isinstance(raw_user, dict):
            user_id = _get_any(raw_user, 'id', 'userId', 'userID')
            included_user = _included_item(included, 'users', user_id)
            add_name(included_user or raw_user, fallback_id=user_id)
        elif raw_user is not None:
            included_user = _included_item(included, 'users', raw_user)
            add_name(included_user, fallback_id=raw_user)

    for user_id in _as_list(_get_any(task, 'assigneeUserIds', 'responsiblePartyIds', 'responsibleUserIds')):
        if isinstance(user_id, dict):
            user_id = _get_any(user_id, 'id', 'userId', 'userID')
        if user_id is None:
            continue
        included_user = _included_item(included, 'users', user_id)
        add_name(included_user, fallback_id=user_id)

    return names


def _parent_task_id(task):
    parent_id = None
    parent = _get_any(task, 'parentTask')
    if isinstance(parent, dict):
        parent_id = _get_any(parent, 'id', 'taskId', 'taskID')
    if parent_id in (None, '', 0, '0'):
        parent_id = _get_any(task, 'parentTaskId', 'parentTaskID')
    if parent_id not in (None, '', 0, '0'):
        return str(parent_id)
    return None


def _parent_task_label(task, parent_lookup=None):
    parent = _get_any(task, 'parentTask')
    if isinstance(parent, dict):
        name = _clean_env(_get_any(parent, 'name', 'content', 'title'))
        if name:
            return name

    parent_id = _parent_task_id(task)
    if parent_id and parent_lookup:
        return parent_lookup(parent_id)
    return None


def _collect_assignee_ids(task):
    ids = set()
    for key in ('responsiblePartyIds', 'responsibleUserIds', 'assigneeUserIds', 'assignedToUserIds', 'userIds'):
        raw = _get_any(task, key)
        if isinstance(raw, str):
            parts = raw.split(',')
        else:
            parts = _as_list(raw)
        for part in parts:
            if isinstance(part, dict):
                part = _get_any(part, 'id', 'userId', 'userID')
            if part is not None:
                ids.add(str(part).strip())

    assignees = _get_any(task, 'assignees')
    if isinstance(assignees, dict):
        for key in ('userIds', 'users', 'people'):
            for user in _as_list(_get_any(assignees, key)):
                if isinstance(user, dict):
                    user = _get_any(user, 'id', 'userId', 'userID')
                if user is not None:
                    ids.add(str(user).strip())
    elif isinstance(assignees, list):
        for user in assignees:
            if isinstance(user, dict):
                user = _get_any(user, 'id', 'userId', 'userID')
            if user is not None:
                ids.add(str(user).strip())
    return {item for item in ids if item}


def _task_is_assigned_to_configured_user(task, config):
    if not config.assignee_user_id:
        return True
    assignee_ids = _collect_assignee_ids(task)
    return not assignee_ids or str(config.assignee_user_id) in assignee_ids


def _task_url(task, config):
    url = _clean_env(_get_any(task, 'url', 'appUrl', 'htmlUrl'))
    if url:
        return url
    task_id = _task_id(task)
    if not task_id:
        return None
    return f'{config.base_url}/app/tasks/{task_id}'


def _payload_hash(task, due_date_value):
    payload = '|'.join([
        _task_id(task) or '',
        _task_name(task),
        due_date_value.isoformat() if due_date_value else '',
        _task_status(task),
        _task_priority(task),
        _clean_env(_get_any(task, 'dateUpdated', 'updatedAt', 'updated_at')) or '',
    ])
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def _next_order_for_day(user_id, day_value):
    max_order = db.session.query(func.max(CalendarEvent.order_index)).filter(
        CalendarEvent.user_id == user_id,
        CalendarEvent.day == day_value
    ).scalar()
    return (max_order or 0) + 1


def _teamwork_context_lines(task, included, config=None, parent_lookup=None):
    parts = []
    project_name = _project_name(task, included)
    tasklist_name = _tasklist_name(task, included)
    assignee_names = _assignee_names(task, included)
    parent_label = _parent_task_label(task, parent_lookup=parent_lookup)
    if project_name:
        parts.append(f'Project: {project_name}')
    if tasklist_name:
        parts.append(f'Task list: {tasklist_name}')
    if assignee_names:
        parts.append(f"Assignees: {', '.join(assignee_names)}")
    if parent_label:
        parts.append(f'Parent task: {parent_label}')
    if config:
        url = _task_url(task, config)
        if url:
            parts.append(f'[Open in Teamwork]({url})')
    return parts


def _calendar_description(task, config, included, parent_lookup=None):
    return '\n'.join(
        _teamwork_context_lines(task, included, config=config, parent_lookup=parent_lookup)
    ) or None


def _is_generated_teamwork_note(value):
    note = _clean_env(value)
    if not note:
        return False
    lines = [line.strip() for line in note.splitlines() if line.strip()]
    if not lines:
        return False
    known_prefixes = ('Project:', 'Task list:', 'Assignees:', 'Parent task:')
    has_teamwork_link = any(line.startswith('[Open in Teamwork](') for line in lines)
    has_only_generated_lines = all(
        line.startswith(known_prefixes) or line.startswith('[Open in Teamwork](')
        for line in lines
    )
    return has_teamwork_link and has_only_generated_lines


def _clear_generated_teamwork_note(event):
    if event and _is_generated_teamwork_note(event.item_note):
        event.item_note = None


class TeamworkClient:
    def __init__(self, config=None):
        self.config = config or get_teamwork_config()
        self.session = requests.Session()
        self.session.auth = (self.config.api_key, 'password')
        self.session.headers.update({'Accept': 'application/json'})
        self._task_name_cache = {}

    def _get(self, path, params=None):
        url = f'{self.config.base_url}{path}'
        response = self.session.get(url, params=params or {}, timeout=self.config.request_timeout)
        response.raise_for_status()
        return response.json()

    def iter_tasks(self, include_completed=False, ids=None):
        page = 1
        while True:
            params = {
                'page': page,
                'pageSize': self.config.page_size,
                'orderBy': 'updatedat',
                'orderMode': 'desc',
                'include': 'projects,tasklists,users',
                'includeCompletedTasks': 'true' if include_completed else 'false',
                'includeTasksWithoutDueDates': 'true',
                'onlyAssignedTasks': 'true',
            }
            if self.config.assignee_user_id:
                params['responsiblePartyIds'] = self.config.assignee_user_id
            if self.config.sync_project_ids:
                params['projectIds'] = self.config.sync_project_ids
            if ids:
                params['ids'] = ','.join(str(item) for item in ids)

            data = self._get('/projects/api/v3/tasks.json', params=params)
            tasks = data.get('tasks') or []
            included = data.get('included') or {}
            for task in tasks:
                if isinstance(task, dict):
                    yield task, included

            if ids or len(tasks) < self.config.page_size:
                break
            page += 1

    def get_assigned_task(self, task_id, include_completed=True):
        for task, included in self.iter_tasks(include_completed=include_completed, ids=[task_id]):
            return task, included
        return None, {}

    def get_task(self, task_id):
        data = self._get(
            f'/projects/api/v3/tasks/{task_id}.json',
            params={'include': 'projects,tasklists,users'},
        )
        task = data.get('task')
        if not isinstance(task, dict):
            tasks = data.get('tasks') or []
            task = tasks[0] if tasks and isinstance(tasks[0], dict) else None
        return task, data.get('included') or {}

    def get_task_name(self, task_id):
        task_id = str(task_id)
        if task_id not in self._task_name_cache:
            try:
                task, _included = self.get_task(task_id)
                self._task_name_cache[task_id] = _task_name(task) if task else None
            except Exception:
                current_app.logger.exception('Failed resolving Teamwork parent task %s', task_id)
                self._task_name_cache[task_id] = None
        return self._task_name_cache[task_id]


def get_ignored_task_ids(user_id):
    return {
        str(task_id) for (task_id,) in db.session.query(TeamworkIgnoredTask.task_id)
        .filter_by(user_id=user_id)
        .all()
        if task_id is not None
    }


def ignore_teamwork_task_for_user(user_id, task_id, title=None, commit=True):
    task_id = str(task_id)
    ignored = TeamworkIgnoredTask.query.filter_by(user_id=user_id, task_id=task_id).first()
    if not ignored:
        ignored = TeamworkIgnoredTask(user_id=user_id, task_id=task_id, title=_clean_env(title))
        db.session.add(ignored)
    elif title:
        ignored.title = _clean_env(title)
    db.session.flush()
    deleted = delete_imported_task(task_id, user_id=user_id, commit=False)
    if commit:
        db.session.commit()
    return {
        'status': 'ok',
        'task_id': task_id,
        'deleted': deleted,
        'ignored_id': ignored.id,
    }


def delete_imported_task(task_id, user_id=None, commit=True):
    task_id = str(task_id)
    query = CalendarEvent.query.filter_by(external_source=SOURCE_NAME, external_id=task_id)
    if user_id:
        query = query.filter_by(user_id=user_id)
    events = query.all()
    deleted = 0
    for event in events:
        event_id = event.id
        target_user_id = event.user_id
        db.session.delete(event)
        deleted += 1
        try:
            delete_embedding_for_entity(target_user_id, ENTITY_CALENDAR, event_id)
        except Exception:
            current_app.logger.exception('Failed deleting embedding for Teamwork calendar event %s', event_id)
    if commit and deleted:
        db.session.commit()
    return deleted


def mark_imported_task_done(task_id, user_id=None, commit=True, reason='webhook_completed'):
    task_id = str(task_id)
    query = CalendarEvent.query.filter_by(external_source=SOURCE_NAME, external_id=task_id)
    if user_id:
        query = query.filter_by(user_id=user_id)
    events = query.all()
    if not events:
        return {'action': 'skipped', 'reason': 'not_imported', 'task_id': task_id}
    for event in events:
        event.status = 'done'
        event.is_event = False
    if commit:
        db.session.commit()
    return {
        'action': 'updated',
        'reason': reason,
        'task_id': task_id,
        'event_ids': [event.id for event in events],
    }


def upsert_task(task, included=None, user=None, config=None, commit=True, parent_lookup=None, ignored_task_ids=None):
    config = config or get_teamwork_config()
    user = user or get_target_user(config)
    if not user:
        raise TeamworkConfigError('No local user exists for Teamwork calendar sync')

    included = included or {}
    task_id = _task_id(task)
    if not task_id:
        return {'action': 'skipped', 'reason': 'missing_task_id'}
    ignored_task_ids = ignored_task_ids if ignored_task_ids is not None else get_ignored_task_ids(user.id)
    if task_id in ignored_task_ids:
        deleted = delete_imported_task(task_id, user_id=user.id, commit=False)
        if commit:
            db.session.commit()
        return {'action': 'deleted' if deleted else 'skipped', 'reason': 'ignored', 'task_id': task_id}
    if not _task_is_assigned_to_configured_user(task, config):
        deleted = delete_imported_task(task_id, user_id=user.id, commit=False)
        if commit:
            db.session.commit()
        return {'action': 'deleted' if deleted else 'skipped', 'reason': 'not_assigned', 'task_id': task_id}

    status = _task_status(task)
    due_date_value = _task_due_date(task)
    if status == 'deleted' or not due_date_value:
        deleted = delete_imported_task(task_id, user_id=user.id, commit=False)
        if commit:
            db.session.commit()
        return {
            'action': 'deleted' if deleted else 'skipped',
            'reason': 'deleted' if status == 'deleted' else 'missing_due_date',
            'task_id': task_id,
        }

    event = CalendarEvent.query.filter_by(
        user_id=user.id,
        external_source=SOURCE_NAME,
        external_id=task_id,
    ).first()

    action = 'created'
    if not event:
        event = CalendarEvent(
            user_id=user.id,
            external_source=SOURCE_NAME,
            external_id=task_id,
            day=due_date_value,
            order_index=_next_order_for_day(user.id, due_date_value),
            is_event=False,
            rollover_enabled=False,
            allow_overlap=False,
            display_mode='both',
        )
        db.session.add(event)
    else:
        action = 'updated'
        if event.day != due_date_value:
            event.day = due_date_value
            event.order_index = _next_order_for_day(user.id, due_date_value)

    event.title = _task_name(task)
    event.description = _calendar_description(task, config, included, parent_lookup=parent_lookup)
    event.status = status
    event.priority = _task_priority(task)
    event.is_phase = False
    event.is_group = False
    event.is_event = False
    event.rollover_enabled = False
    _clear_generated_teamwork_note(event)
    event.external_url = _task_url(task, config)
    event.external_updated_at = _task_updated_at(task)
    event.external_payload_hash = _payload_hash(task, due_date_value)

    if commit:
        db.session.commit()
    return {'action': action, 'task_id': task_id, 'event_id': event.id, 'day': due_date_value.isoformat()}


def sync_all_assigned_tasks():
    config = get_teamwork_config()
    user = get_target_user(config)
    if not user:
        raise TeamworkConfigError('No local user exists for Teamwork calendar sync')
    client = TeamworkClient(config)
    ignored_task_ids = get_ignored_task_ids(user.id)
    stats = {
        'created': 0,
        'updated': 0,
        'deleted': 0,
        'skipped': 0,
        'errors': 0,
        'user_id': user.id,
    }
    seen_task_ids = set()

    def _count_result(result):
        action = result.get('action')
        if action in stats:
            stats[action] += 1
        else:
            stats['skipped'] += 1

    for task, included in client.iter_tasks(include_completed=False):
        try:
            task_id = _task_id(task)
            if task_id:
                seen_task_ids.add(task_id)
            if task_id and task_id in ignored_task_ids:
                result = {
                    'action': 'deleted' if delete_imported_task(task_id, user_id=user.id, commit=False) else 'skipped',
                    'reason': 'ignored',
                    'task_id': task_id,
                }
            else:
                result = upsert_task(
                    task,
                    included=included,
                    user=user,
                    config=config,
                    commit=False,
                    parent_lookup=client.get_task_name,
                    ignored_task_ids=ignored_task_ids,
                )
            _count_result(result)
        except Exception:
            stats['errors'] += 1
            current_app.logger.exception('Failed syncing Teamwork task')

    existing_task_ids = [
        external_id for (external_id,) in db.session.query(CalendarEvent.external_id)
        .filter_by(user_id=user.id, external_source=SOURCE_NAME)
        .all()
        if external_id and external_id not in seen_task_ids
    ]
    for task_id in existing_task_ids:
        try:
            task, included = client.get_assigned_task(task_id, include_completed=True)
            if not task:
                deleted = delete_imported_task(task_id, user_id=user.id, commit=False)
                _count_result({
                    'action': 'deleted' if deleted else 'skipped',
                    'reason': 'not_found_or_not_assigned',
                    'task_id': str(task_id),
                })
                continue
            result = upsert_task(
                task,
                included=included,
                user=user,
                config=config,
                commit=False,
                parent_lookup=client.get_task_name,
                ignored_task_ids=ignored_task_ids,
            )
            _count_result(result)
        except Exception:
            stats['errors'] += 1
            current_app.logger.exception('Failed refreshing imported Teamwork task %s', task_id)

    db.session.commit()
    current_app.logger.info('Teamwork sync complete: %s', stats)
    return stats


def sync_single_task(task_id, completed_fallback=False, single_task_fallback=False):
    config = get_teamwork_config()
    user = get_target_user(config)
    if not user:
        raise TeamworkConfigError('No local user exists for Teamwork calendar sync')
    if str(task_id) in get_ignored_task_ids(user.id):
        deleted = delete_imported_task(task_id, user_id=user.id)
        return {'action': 'deleted' if deleted else 'skipped', 'reason': 'ignored', 'task_id': str(task_id)}
    client = TeamworkClient(config)
    task, included = client.get_assigned_task(task_id, include_completed=True)
    if not task and (completed_fallback or single_task_fallback):
        task, included = client.get_task(task_id)
    if not task:
        if completed_fallback:
            return mark_imported_task_done(task_id, user_id=user.id)
        deleted = delete_imported_task(task_id, user_id=user.id)
        return {'action': 'deleted' if deleted else 'skipped', 'reason': 'not_found_or_not_assigned', 'task_id': str(task_id)}
    return upsert_task(task, included=included, user=user, config=config, parent_lookup=client.get_task_name)


def extract_task_id_from_webhook(payload):
    if not isinstance(payload, dict):
        return None
    for key in ('task', 'todo-item', 'todoItem', 'item'):
        value = payload.get(key)
        if isinstance(value, dict):
            task_id = _task_id(value)
            if task_id:
                return task_id
    for key in (
        'taskId',
        'taskID',
        'todoItemId',
        'todoItemID',
        'todo-item-id',
        'itemId',
        'objectId',
        'objectID',
        'id',
    ):
        value = payload.get(key)
        if value is not None:
            return str(value)
    return None


def _webhook_event_text(payload, event_name=None):
    parts = [event_name or '']
    if isinstance(payload, dict):
        for key in ('event', 'eventName', 'eventType', 'type', 'action', 'verb'):
            value = payload.get(key)
            if value is not None:
                parts.append(str(value))
    return ' '.join(parts).lower()


def handle_webhook_payload(payload, event_name=None):
    task_id = extract_task_id_from_webhook(payload)
    if not task_id:
        return {'action': 'skipped', 'reason': 'missing_task_id'}
    event_l = _webhook_event_text(payload, event_name)
    if 'deleted' in event_l:
        deleted = delete_imported_task(task_id)
        return {'action': 'deleted' if deleted else 'skipped', 'task_id': task_id, 'reason': 'webhook_deleted'}
    return sync_single_task(
        task_id,
        completed_fallback='completed' in event_l,
        single_task_fallback=any(
            value in event_l for value in ('updated', 'assigned', 'moved', 'reopened')
        ),
    )
