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


def test_non_deleted_webhook_events_refetch_latest_task(monkeypatch):
    calls = []

    def fake_sync(task_id):
        calls.append(task_id)
        return {'action': 'updated', 'task_id': task_id}

    monkeypatch.setattr(tw, 'sync_single_task', fake_sync)

    for event_name in ('task.completed', 'task.reopened', 'task.updated', 'task.moved'):
        assert tw.handle_webhook_payload({'taskId': 123}, event_name=event_name) == {
            'action': 'updated',
            'task_id': '123',
        }

    assert calls == ['123', '123', '123', '123']
