from backend.text_helpers import _html_to_plain_text, _sanitize_note_html


def test_html_to_plain_text_normalizes_line_breaks():
    raw = "<p>Hello</p><p>World</p>"
    assert _html_to_plain_text(raw) == "Hello\nWorld"


def test_sanitize_note_html_strips_script_tags():
    raw = '<p>Safe</p><script>alert(1)</script>'
    assert _sanitize_note_html(raw) == '<p>Safe</p>alert(1)'
