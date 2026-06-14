from datetime import date
from types import SimpleNamespace

import pytest

from services.inbox_routes import (
    InboxValidationError,
    _parse_reminder,
    build_heuristic_suggestion,
    extract_capture_schedule,
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


def test_heuristic_suggestion_prefers_calendar_when_capture_has_date():
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

    assert destination['kind'] == 'calendar'
    assert destination['day'] == '2026-06-12'
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
