import json
from datetime import date, datetime
from types import SimpleNamespace

import pytest

import services.inbox_routes as inbox_routes
from services.inbox_routes import (
    InboxValidationError,
    _ai_suggestion,
    _parse_reminder,
    build_destination_catalog,
    build_heuristic_suggestion,
    build_routing_context,
    extract_capture_schedule,
    generate_suggestion,
    map_inbox_item,
    note_list_insert_index,
)


def make_item(item_id, text, order_index):
    return SimpleNamespace(id=item_id, text=text, order_index=order_index)


def test_extract_capture_schedule_handles_relative_date_time_and_reminder():
    result = extract_capture_schedule(
        'Call Sam tomorrow at 3:30pm, remind me 15 minutes before',
        today=date(2026, 6, 11),
    )

    assert result == {
        'date': '2026-06-12',
        'start_time': '15:30',
        'reminder_minutes_before': 15,
    }


def test_reminder_accepts_arbitrary_minute_value():
    assert _parse_reminder('47') == 47


def test_reminder_accepts_calendar_duration_syntax():
    assert _parse_reminder('30m') == 30
    assert _parse_reminder('2h') == 120
    assert _parse_reminder('1d') == 1440


def test_reminder_rejects_invalid_duration():
    with pytest.raises(InboxValidationError):
        _parse_reminder('two hours')


def test_note_list_insert_index_targets_end_of_subsection():
    items = [
        make_item(1, '[[section]] Work', 1),
        make_item(2, '[[subsection]] Launch', 2),
        make_item(3, 'Existing item', 3),
        make_item(4, '[[subsection]] Follow-up', 4),
        make_item(5, 'Another item', 5),
    ]

    assert note_list_insert_index(items, section_id=1, subsection_id=2) == 3


def test_note_list_insert_index_targets_top_level_before_first_section():
    items = [
        make_item(1, 'Top-level item', 1),
        make_item(2, '[[section]] Work', 2),
        make_item(3, 'Existing item', 3),
    ]

    assert note_list_insert_index(items) == 1


def test_heuristic_suggestion_uses_matching_note_list_subsection():
    catalog = {
        'task_lists': [
            {'id': 10, 'title': 'General tasks', 'type': 'list', 'phases': [], 'samples': []},
        ],
        'notes': [],
        'note_lists': [
            {
                'id': 20,
                'title': 'Shopping',
                'samples': ['Milk', 'Bread'],
                'sections': [
                    {
                        'id': 21,
                        'title': 'Groceries',
                        'subsections': [{'id': 22, 'title': 'Produce'}],
                    },
                ],
            },
        ],
    }

    destination, _reason, _confidence = build_heuristic_suggestion(
        'Add lemons to Shopping Produce list',
        catalog,
        today=date(2026, 6, 11),
    )

    assert destination['kind'] == 'note_list'
    assert destination['note_id'] == 20
    assert destination['section_id'] == 21
    assert destination['subsection_id'] == 22


def test_heuristic_suggestion_keeps_project_work_as_task_when_it_has_date():
    catalog = {
        'task_lists': [
            {
                'id': 10,
                'title': 'Website Launch',
                'type': 'list',
                'phases': [{'id': 11, 'title': 'QA'}],
                'samples': ['Test checkout'],
            },
        ],
        'notes': [],
        'note_lists': [],
    }

    destination, _reason, _confidence = build_heuristic_suggestion(
        'Fix checkout in Website Launch QA tomorrow at 3pm',
        catalog,
        today=date(2026, 6, 11),
    )

    assert destination['kind'] == 'task'
    assert destination['list_id'] == 10
    assert destination['phase_id'] == 11
    assert destination['due_date'] == '2026-06-12'
    assert destination['start_time'] == '15:00'
    assert destination['title'] == 'Fix checkout in Website Launch QA'


def test_heuristic_suggestion_recognizes_scheduled_appointment():
    catalog = {
        'task_lists': [
            {'id': 10, 'title': 'General tasks', 'type': 'list', 'phases': [], 'samples': []},
        ],
        'notes': [],
        'note_lists': [],
    }

    destination, _reason, _confidence = build_heuristic_suggestion(
        'Dentist appointment tomorrow at 9am',
        catalog,
        today=date(2026, 6, 11),
    )

    assert destination['kind'] == 'calendar'
    assert destination['day'] == '2026-06-12'
    assert destination['start_time'] == '09:00'
    assert destination['is_event'] is True
    assert destination['title'] == 'Dentist appointment'


def test_heuristic_suggestion_removes_named_date_from_calendar_title():
    catalog = {
        'task_lists': [
            {'id': 10, 'title': 'General tasks', 'type': 'list', 'phases': [], 'samples': []},
        ],
        'notes': [],
        'note_lists': [],
    }

    destination, _reason, _confidence = build_heuristic_suggestion(
        'Submit registration on June 15, 2026 at 9am',
        catalog,
        today=date(2026, 6, 12),
    )

    assert destination['kind'] == 'calendar'
    assert destination['day'] == '2026-06-15'
    assert destination['start_time'] == '09:00'
    assert destination['title'] == 'Submit registration'


def test_heuristic_suggestion_handles_numeric_date_and_cleans_title():
    catalog = {
        'task_lists': [
            {'id': 10, 'title': 'General tasks', 'type': 'list', 'phases': [], 'samples': []},
        ],
        'notes': [],
        'note_lists': [],
    }

    destination, _reason, _confidence = build_heuristic_suggestion(
        'Renew registration by 6/20/2026',
        catalog,
        today=date(2026, 6, 12),
    )

    assert destination['kind'] == 'calendar'
    assert destination['day'] == '2026-06-20'
    assert destination['title'] == 'Renew registration'


def test_explicit_task_instruction_can_override_calendar_default():
    catalog = {
        'task_lists': [
            {
                'id': 10,
                'title': 'Website Launch',
                'type': 'list',
                'phases': [{'id': 11, 'title': 'QA'}],
                'samples': [],
            },
        ],
        'notes': [],
        'note_lists': [],
    }

    destination, _reason, _confidence = build_heuristic_suggestion(
        'Add task to Website Launch QA tomorrow: verify checkout',
        catalog,
        today=date(2026, 6, 12),
    )

    assert destination['kind'] == 'task'
    assert destination['list_id'] == 10
    assert destination['phase_id'] == 11
    assert destination['due_date'] == '2026-06-13'


def test_generate_suggestion_uses_ai_even_for_high_confidence_rule(monkeypatch):
    fallback = {'kind': 'calendar', 'title': 'Dentist', 'day': '2026-06-13'}
    refined = {'kind': 'task', 'list_id': 10, 'title': 'Dentist follow-up'}
    catalog = {'task_lists': [], 'notes': [], 'note_lists': []}
    item = SimpleNamespace(content='Dentist tomorrow')
    fake_app = SimpleNamespace()

    monkeypatch.setattr(
        inbox_routes,
        'generate_rule_suggestion',
        lambda _a, _user, _item: (fallback, 0.99, catalog),
    )
    monkeypatch.setattr(inbox_routes, '_ai_available', lambda _a: True)
    monkeypatch.setattr(
        inbox_routes,
        'refine_suggestion_with_ai',
        lambda _a, _user, _item, _catalog, _fallback: refined,
    )

    assert generate_suggestion(fake_app, SimpleNamespace(), item) == refined


def test_ai_suggestion_receives_intent_context_and_parsed_schedule(monkeypatch):
    captured = {}
    expected_context = {
        'destination_index': {'task_lists': [], 'notes': [], 'note_lists': []},
        'task_context': [{'id': 10, 'title': 'Website Launch'}],
        'prior_inbox_mappings': [],
    }
    fake_app = SimpleNamespace(
        config={'OPENAI_API_KEY': 'test-key'},
        logger=SimpleNamespace(warning=lambda *_args, **_kwargs: None),
    )
    fake_module = SimpleNamespace(
        app=fake_app,
        _now_local=lambda: datetime(2026, 6, 12, 10, 0),
    )

    monkeypatch.setattr(
        inbox_routes,
        'build_routing_context',
        lambda *_args: expected_context,
    )

    def fake_call(system_prompt, user_content, **_kwargs):
        captured['system_prompt'] = system_prompt
        captured['payload'] = json.loads(user_content)
        return {
            'intent': 'Project work with a deadline',
            'destination': {'kind': 'task', 'list_id': 10, 'title': 'Fix checkout'},
            'reason': 'It matches active Website Launch work.',
            'confidence': 0.91,
        }

    monkeypatch.setattr(inbox_routes, 'call_chat_json', fake_call)
    result = _ai_suggestion(
        fake_module,
        SimpleNamespace(),
        'Fix checkout tomorrow at 3pm',
        {'task_lists': [], 'notes': [], 'note_lists': []},
        {'kind': 'calendar'},
    )

    assert result['destination']['kind'] == 'task'
    assert captured['payload']['organization_context'] == expected_context
    assert captured['payload']['parsed_schedule']['date'] == '2026-06-13'
    assert captured['payload']['parsed_schedule']['start_time'] == '15:00'
    assert 'A date is evidence, not an automatic Calendar decision.' in captured['system_prompt']


def test_routing_context_includes_existing_items_and_mapping_history(
    tmp_path,
    monkeypatch,
):
    database_path = tmp_path / 'inbox-context.db'
    monkeypatch.setenv('DATABASE_URL', f'sqlite:///{database_path.as_posix()}')

    import importlib
    import app as app_module

    app_module = importlib.reload(app_module)
    app_module.app.config.update(TESTING=True)
    with app_module.app.app_context():
        app_module.db.create_all()
        user = app_module.User(username='context-owner', email=None)
        user.set_password('dummy')
        app_module.db.session.add(user)
        app_module.db.session.flush()

        project = app_module.TodoList(
            user_id=user.id,
            title='Website Launch',
            type='list',
        )
        app_module.db.session.add(project)
        app_module.db.session.flush()
        app_module.db.session.add(app_module.TodoItem(
            list_id=project.id,
            content='Verify checkout flow',
            description='Test the payment confirmation page',
            status='in_progress',
        ))

        note = app_module.Note(
            user_id=user.id,
            title='Launch decisions',
            content='<p>Keep notes about launch scope and tradeoffs here.</p>',
            note_type='note',
        )
        shopping = app_module.Note(
            user_id=user.id,
            title='Shopping',
            note_type='list',
        )
        app_module.db.session.add_all([note, shopping])
        app_module.db.session.flush()
        app_module.db.session.add_all([
            app_module.NoteListItem(
                note_id=shopping.id,
                text='[[section]] Groceries',
                order_index=1,
            ),
            app_module.NoteListItem(
                note_id=shopping.id,
                text='Milk',
                order_index=2,
            ),
        ])
        app_module.db.session.add(app_module.CalendarEvent(
            user_id=user.id,
            title='Weekly launch sync',
            day=date(2026, 6, 15),
            start_time=datetime.strptime('09:00', '%H:%M').time(),
            is_event=True,
        ))
        app_module.db.session.add(app_module.InboxItem(
            user_id=user.id,
            content='Buy lemons',
            status='mapped',
            mapped_destination_type='note_list',
            mapped_destination_id=1,
            mapped_result_json=json.dumps({
                'label': 'List item in Shopping / Groceries',
            }),
            mapped_at=datetime(2026, 6, 11, 12, 0),
        ))
        app_module.db.session.commit()

        catalog = build_destination_catalog(app_module, user, include_context=True)
        context = build_routing_context(
            app_module,
            user,
            'Fix checkout before launch',
            catalog,
        )

    assert context['task_context'][0]['title'] == 'Website Launch'
    assert context['task_context'][0]['items'][0]['title'] == 'Verify checkout flow'
    assert (
        context['destination_index']['task_lists'][0]['sample_items'][0]
        == 'Verify checkout flow'
    )
    assert context['note_context'][0]['snippet'].startswith('Keep notes about launch')
    assert context['note_list_context'][0]['items'][0]['text'] == 'Milk'
    assert context['calendar_patterns'][0]['title'] == 'Weekly launch sync'
    assert context['prior_inbox_mappings'][0]['destination_kind'] == 'note_list'


def test_inbox_destinations_and_mapping_support_area_targets(tmp_path, monkeypatch):
    database_path = tmp_path / 'inbox-area-targets.db'
    monkeypatch.setenv('DATABASE_URL', f'sqlite:///{database_path.as_posix()}')

    import importlib
    import app as app_module

    app_module = importlib.reload(app_module)
    app_module.app.config.update(TESTING=True)
    with app_module.app.app_context():
        app_module.db.create_all()
        user = app_module.User(username='area-inbox-owner', email=None)
        user.set_password('dummy')
        app_module.db.session.add(user)
        app_module.db.session.flush()

        area = app_module.Area(user_id=user.id, name='Home')
        app_module.db.session.add(area)
        app_module.db.session.flush()
        note_block = app_module.AreaBlock(
            user_id=user.id,
            area_id=area.id,
            block_type='note',
            title='Maintenance notes',
            content='<p>Existing</p>',
            order_index=1,
        )
        task_block = app_module.AreaBlock(
            user_id=user.id,
            area_id=area.id,
            block_type='task_list',
            title='Next actions',
            checkbox_mode=True,
            order_index=2,
        )
        list_block = app_module.AreaBlock(
            user_id=user.id,
            area_id=area.id,
            block_type='list',
            title='Supplies',
            order_index=3,
        )
        app_module.db.session.add_all([note_block, task_block, list_block])
        app_module.db.session.flush()
        section_item = app_module.AreaBlockItem(
            user_id=user.id,
            area_id=area.id,
            block_id=list_block.id,
            item_type='section',
            text='Supplies',
            order_index=1,
        )
        subsection_item = app_module.AreaBlockItem(
            user_id=user.id,
            area_id=area.id,
            block_id=list_block.id,
            item_type='subsection',
            text='Filters',
            order_index=2,
        )
        app_module.db.session.add_all([section_item, subsection_item])
        app_module.db.session.flush()

        catalog = build_destination_catalog(app_module, user, include_context=True)
        assert catalog['areas'][0]['title'] == 'Home'
        assert [entry['id'] for entry in catalog['area_notes']] == [note_block.id]
        assert [entry['id'] for entry in catalog['area_lists']] == [list_block.id]
        assert [entry['id'] for entry in catalog['area_task_lists']] == [task_block.id]
        assert list_block.id not in [entry['id'] for entry in catalog['area_task_lists']]

        line_capture = app_module.InboxItem(user_id=user.id, content='Check furnace filter')
        note_capture = app_module.InboxItem(user_id=user.id, content='Filter size is 20x25')
        list_capture = app_module.InboxItem(user_id=user.id, content='20x25x1 filters')
        task_capture = app_module.InboxItem(user_id=user.id, content='Buy replacement filters')
        app_module.db.session.add_all([line_capture, note_capture, list_capture, task_capture])
        app_module.db.session.flush()

        line_result = map_inbox_item(
            app_module,
            user,
            line_capture,
            {'kind': 'area_line', 'area_id': area.id},
        )
        note_result = map_inbox_item(
            app_module,
            user,
            note_capture,
            {'kind': 'area_note', 'block_id': note_block.id},
        )
        task_result = map_inbox_item(
            app_module,
            user,
            task_capture,
            {
                'kind': 'area_task',
                'block_id': task_block.id,
                'due_date': '2026-06-20',
            },
        )
        list_result = map_inbox_item(
            app_module,
            user,
            list_capture,
            {
                'kind': 'area_list',
                'block_id': list_block.id,
                'section_id': section_item.id,
                'subsection_id': subsection_item.id,
                'note': 'Buy a multipack',
                'scheduled_date': '2026-06-21',
            },
        )

        assert line_result['label'] == 'Line in area: Home'
        line_block = app_module.db.session.get(app_module.AreaBlock, line_result['id'])
        assert line_block.block_type == 'line'
        assert line_block.content == 'Check furnace filter'

        app_module.db.session.refresh(note_block)
        assert '<p>Existing</p>' in note_block.content
        assert '<p>Filter size is 20x25</p>' in note_block.content
        assert note_result['url'] == f'/areas/{area.id}/blocks/{note_block.id}'

        list_item = app_module.db.session.get(app_module.AreaBlockItem, list_result['id'])
        assert list_item.block_id == list_block.id
        assert list_item.text == '20x25x1 filters'
        assert list_item.note == 'Buy a multipack'
        assert list_item.scheduled_date == date(2026, 6, 21)

        task_item = app_module.db.session.get(app_module.AreaBlockItem, task_result['id'])
        assert task_item.block_id == task_block.id
        assert task_item.text == 'Buy replacement filters'
        assert task_item.scheduled_date == date(2026, 6, 20)


def test_inbox_delete_route_only_deletes_current_users_item(tmp_path, monkeypatch):
    database_path = tmp_path / 'inbox-delete.db'
    monkeypatch.setenv('DATABASE_URL', f'sqlite:///{database_path.as_posix()}')

    import importlib
    import app as app_module

    app_module = importlib.reload(app_module)
    app_module.app.config.update(TESTING=True)
    with app_module.app.app_context():
        app_module.db.create_all()
        first_user = app_module.User(username='delete-owner', email=None)
        first_user.set_password('dummy')
        second_user = app_module.User(username='delete-other', email=None)
        second_user.set_password('dummy')
        app_module.db.session.add_all([first_user, second_user])
        app_module.db.session.flush()
        owned_item = app_module.InboxItem(user_id=first_user.id, content='Owned')
        other_item = app_module.InboxItem(user_id=second_user.id, content='Other')
        app_module.db.session.add_all([owned_item, other_item])
        app_module.db.session.commit()
        first_user_id = first_user.id
        owned_item_id = owned_item.id
        other_item_id = other_item.id

    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session['user_id'] = first_user_id

    assert client.delete(f'/api/inbox/{other_item_id}').status_code == 404
    assert client.delete(f'/api/inbox/{owned_item_id}').status_code == 204

    with app_module.app.app_context():
        assert app_module.db.session.get(app_module.InboxItem, owned_item_id) is None
        assert app_module.db.session.get(app_module.InboxItem, other_item_id) is not None
