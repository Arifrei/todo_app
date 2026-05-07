import os
from types import SimpleNamespace

os.environ.setdefault('BOOTSTRAP_JOBS_ON_IMPORT', '0')

from services import teamwork_sync as tw


def test_teamwork_context_lines_include_project_task_list_parent_and_link():
    task = {
        'id': 123,
        'content': 'Ship import',
        'projectId': 45,
        'tasklistId': 67,
        'parentTask': {'id': 89, 'content': 'Parent task'},
    }
    included = {
        'projects': {'45': {'name': 'Client project'}},
        'tasklists': {'67': {'name': 'Implementation'}},
    }
    config = SimpleNamespace(base_url='https://example.teamwork.com')

    assert tw._teamwork_context_lines(task, included, config=config) == [
        'Project: Client project',
        'Task list: Implementation',
        'Parent task: Parent task',
        '[Open in Teamwork](https://example.teamwork.com/app/tasks/123)',
    ]


def test_assignee_names_resolve_from_included_users():
    task = {
        'assigneeUserIds': [734285, 734224],
        'assignees': [{'id': 734224}],
    }
    included = {
        'users': {
            '734285': {'firstName': 'Rachie', 'lastName': 'Perlmutter'},
            '734224': {'firstName': 'Ari', 'lastName': 'Stone'},
        }
    }

    assert tw._assignee_names(task, included) == ['Ari Stone', 'Rachie Perlmutter']


def test_teamwork_assignment_filter_rejects_explicit_other_assignee():
    config = SimpleNamespace(assignee_user_id='42')

    assert tw._task_is_assigned_to_configured_user({'responsiblePartyIds': ['42']}, config)
    assert not tw._task_is_assigned_to_configured_user({'responsiblePartyIds': ['7']}, config)


def test_deleted_webhook_deletes_imported_task(monkeypatch):
    calls = {}

    def fake_delete(task_id):
        calls['task_id'] = task_id
        return 1

    monkeypatch.setattr(tw, 'delete_imported_task', fake_delete)

    result = tw.handle_webhook_payload({'taskId': 123}, event_name='task.deleted')

    assert result == {'action': 'deleted', 'task_id': '123', 'reason': 'webhook_deleted'}
    assert calls == {'task_id': '123'}


def test_extract_task_id_handles_teamwork_id_variants():
    assert tw.extract_task_id_from_webhook({'objectId': 123}) == '123'
    assert tw.extract_task_id_from_webhook({'todoItemId': 456}) == '456'
    assert tw.extract_task_id_from_webhook({'task': {'id': 789}}) == '789'


def test_non_deleted_webhook_events_refetch_latest_task(monkeypatch):
    calls = []

    def fake_sync(task_id, completed_fallback=False, single_task_fallback=False):
        calls.append((task_id, completed_fallback, single_task_fallback))
        return {'action': 'updated', 'task_id': task_id}

    monkeypatch.setattr(tw, 'sync_single_task', fake_sync)

    for event_name in ('task.reopened', 'task.updated', 'task.moved'):
        assert tw.handle_webhook_payload({'taskId': 123}, event_name=event_name) == {
            'action': 'updated',
            'task_id': '123',
        }

    assert calls == [
        ('123', False, True),
        ('123', False, True),
        ('123', False, True),
    ]


def test_completed_webhook_refetches_with_done_fallback(monkeypatch):
    calls = []

    def fake_sync(task_id, completed_fallback=False, single_task_fallback=False):
        calls.append((task_id, completed_fallback, single_task_fallback))
        return {'action': 'updated', 'task_id': task_id}

    monkeypatch.setattr(tw, 'sync_single_task', fake_sync)

    assert tw.handle_webhook_payload({'taskId': 123}, event_name='task.completed') == {
        'action': 'updated',
        'task_id': '123',
    }
    assert tw.handle_webhook_payload({'taskId': 456, 'event': 'TASK.COMPLETED'}) == {
        'action': 'updated',
        'task_id': '456',
    }

    assert calls == [('123', True, False), ('456', True, False)]


def test_completed_sync_falls_back_to_single_task_fetch(monkeypatch):
    class FakeClient:
        def __init__(self, config):
            self.config = config

        def get_assigned_task(self, task_id, include_completed=True):
            return None, {}

        def get_task(self, task_id):
            return {'id': task_id, 'content': 'Completed task', 'completed': True, 'dueDate': '2026-04-21'}, {}

        def get_task_name(self, task_id):
            return None

    monkeypatch.setattr(tw, 'get_teamwork_config', lambda: SimpleNamespace())
    monkeypatch.setattr(tw, 'get_target_user', lambda _config: SimpleNamespace(id=1))
    monkeypatch.setattr(tw, 'get_ignored_task_ids', lambda user_id: set())
    monkeypatch.setattr(tw, 'TeamworkClient', FakeClient)
    monkeypatch.setattr(
        tw,
        'upsert_task',
        lambda task, **_kwargs: {'action': 'updated', 'task_id': str(task['id'])},
    )

    assert tw.sync_single_task(123, completed_fallback=True) == {
        'action': 'updated',
        'task_id': '123',
    }


def test_completed_sync_marks_existing_done_when_refetch_empty(monkeypatch):
    class FakeClient:
        def __init__(self, config):
            self.config = config

        def get_assigned_task(self, task_id, include_completed=True):
            return None, {}

        def get_task(self, task_id):
            return None, {}

    monkeypatch.setattr(tw, 'get_teamwork_config', lambda: SimpleNamespace())
    monkeypatch.setattr(tw, 'get_target_user', lambda _config: SimpleNamespace(id=1))
    monkeypatch.setattr(tw, 'get_ignored_task_ids', lambda user_id: set())
    monkeypatch.setattr(tw, 'TeamworkClient', FakeClient)
    monkeypatch.setattr(
        tw,
        'mark_imported_task_done',
        lambda task_id, user_id=None: {
            'action': 'updated',
            'reason': 'webhook_completed',
            'task_id': str(task_id),
            'user_id': user_id,
        },
    )

    assert tw.sync_single_task(123, completed_fallback=True) == {
        'action': 'updated',
        'reason': 'webhook_completed',
        'task_id': '123',
        'user_id': 1,
    }


def test_updated_sync_can_import_from_single_task_fallback(monkeypatch):
    class FakeClient:
        def __init__(self, config):
            self.config = config

        def get_assigned_task(self, task_id, include_completed=True):
            return None, {}

        def get_task(self, task_id):
            return {
                'id': task_id,
                'content': 'Newly assigned task',
                'assigneeUserIds': ['42'],
                'dueDate': '2026-04-21',
            }, {}

        def get_task_name(self, task_id):
            return None

    monkeypatch.setattr(tw, 'get_teamwork_config', lambda: SimpleNamespace(assignee_user_id='42'))
    monkeypatch.setattr(tw, 'get_target_user', lambda _config: SimpleNamespace(id=1))
    monkeypatch.setattr(tw, 'get_ignored_task_ids', lambda user_id: set())
    monkeypatch.setattr(tw, 'TeamworkClient', FakeClient)
    monkeypatch.setattr(
        tw,
        'upsert_task',
        lambda task, **_kwargs: {'action': 'created', 'task_id': str(task['id'])},
    )

    assert tw.sync_single_task(123, single_task_fallback=True) == {
        'action': 'created',
        'task_id': '123',
    }


def test_sync_single_task_skips_ignored_task(monkeypatch):
    monkeypatch.setattr(tw, 'get_teamwork_config', lambda: SimpleNamespace())
    monkeypatch.setattr(tw, 'get_target_user', lambda _config: SimpleNamespace(id=1))
    monkeypatch.setattr(tw, 'get_ignored_task_ids', lambda user_id: {'123'})
    calls = {}

    def fake_delete(task_id, user_id=None):
        calls['task_id'] = str(task_id)
        calls['user_id'] = user_id
        return 1

    monkeypatch.setattr(tw, 'delete_imported_task', fake_delete)

    assert tw.sync_single_task(123) == {
        'action': 'deleted',
        'reason': 'ignored',
        'task_id': '123',
    }
    assert calls == {'task_id': '123', 'user_id': 1}
