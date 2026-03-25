from types import SimpleNamespace

from services.duplicate_service import detect_note_list_duplicates
from services.notes_routes import (
    build_note_list_context,
    promote_subsections_after_section_delete,
    validate_note_list_structure,
)


def make_item(item_id, text, order_index):
    return SimpleNamespace(
        id=item_id,
        text=text,
        order_index=order_index,
        note=None,
        link_text=None,
        link_url=None,
    )


def test_validate_note_list_structure_allows_subsections_inside_sections():
    items = [
        make_item(1, '[[section]] Projects', 1),
        make_item(2, '[[subsection]] Work', 2),
        make_item(3, 'Ship feature', 3),
    ]

    is_valid, error = validate_note_list_structure(items)

    assert is_valid is True
    assert error is None


def test_validate_note_list_structure_rejects_top_level_subsection():
    items = [
        make_item(1, '[[subsection]] Work', 1),
        make_item(2, 'Ship feature', 2),
    ]

    is_valid, error = validate_note_list_structure(items)

    assert is_valid is False
    assert error == 'Subsections must be placed inside a section.'


def test_build_note_list_context_includes_section_path():
    items = [
        make_item(1, '[[section]] Projects', 1),
        make_item(2, '[[subsection]] Work', 2),
        make_item(3, 'Ship feature', 3),
    ]

    context = build_note_list_context(items)

    assert context[3]['section'] == 'Projects'
    assert context[3]['subsection'] == 'Work'
    assert context[3]['label'] == 'Projects > Work'


def test_promote_subsections_after_section_delete():
    items = [
        make_item(1, '[[section]] Projects', 1),
        make_item(2, '[[subsection]] Work', 2),
        make_item(3, 'Ship feature', 3),
        make_item(4, '[[section]] Personal', 4),
    ]

    promote_subsections_after_section_delete(items, 1)

    assert items[1].text == '[[section]] Work'


def test_detect_note_list_duplicates_reports_subsection_context():
    items = [
        make_item(1, '[[section]] Projects', 1),
        make_item(2, '[[subsection]] Work', 2),
        make_item(3, 'Ship feature', 3),
        make_item(4, 'Ship feature', 4),
    ]

    payload = detect_note_list_duplicates(
        items=items,
        section_prefix='[[section]]',
        subsection_prefix='[[subsection]]',
        embed_text_fn=lambda _text: None,
    )

    assert payload['groups']
    assert payload['groups'][0]['items'][0]['section'] == 'Projects > Work'
