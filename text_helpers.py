import html
import re
from difflib import SequenceMatcher
from html.parser import HTMLParser

from markupsafe import Markup, escape


LINK_PATTERN = re.compile(r"\[([^\]]+)\]\((https?://[^\s)]+)\)")


def linkify_text(text):
    """Convert [label](url) in task descriptions/notes into safe links."""
    if not text:
        return ""
    parts = []
    last = 0
    for match in LINK_PATTERN.finditer(text):
        parts.append(escape(text[last:match.start()]))
        label = escape(match.group(1))
        url = match.group(2)
        parts.append(
            Markup(
                f'<a href="{escape(url)}" target="_blank" rel="noopener noreferrer">{label}</a>'
            )
        )
        last = match.end()
    parts.append(escape(text[last:]))
    return Markup("".join(str(part) for part in parts))


def _html_to_plain_text(raw_html: str) -> str:
    if not raw_html:
        return ""
    text = str(raw_html)
    text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", text)
    text = re.sub(r"(?i)</\s*(p|div|li|h[1-6]|blockquote|pre|tr)\s*>", "\n", text)
    text = re.sub(r"(?i)</\s*(ul|ol|table)\s*>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = text.replace("\r", "\n").replace("\xa0", " ")
    raw_lines = [line.rstrip() for line in text.split("\n")]
    cleaned_lines = []
    blank_streak = 0
    for line in raw_lines:
        if not line.strip():
            blank_streak += 1
            if blank_streak > 1:
                continue
            cleaned_lines.append("")
            continue
        blank_streak = 0
        cleaned_lines.append(re.sub(r"\s+", " ", line).strip())
    return "\n".join(cleaned_lines).strip()


class _NoteHTMLSanitizer(HTMLParser):
    _allowed_tags = {
        "p",
        "div",
        "br",
        "ul",
        "ol",
        "li",
        "strong",
        "b",
        "em",
        "i",
        "u",
        "s",
        "del",
        "blockquote",
        "pre",
        "code",
        "h1",
        "h2",
        "h3",
        "h4",
        "span",
        "a",
        "input",
    }
    _void_tags = {"br", "input"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._parts = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag not in self._allowed_tags:
            return
        if tag == "input":
            attrs_dict = {name.lower(): (value or "") for name, value in attrs}
            if attrs_dict.get("type", "").lower() != "checkbox":
                return
            pieces = ['type="checkbox"']
            if attrs_dict.get("checked") is not None:
                pieces.append("checked")
            self._parts.append(f"<input {' '.join(pieces)}>")
            return
        clean_attrs = []
        if tag == "a":
            attrs_dict = {name.lower(): (value or "") for name, value in attrs}
            href = attrs_dict.get("href", "").strip()
            if href and (
                href.startswith("http://")
                or href.startswith("https://")
                or href.startswith("mailto:")
                or href.startswith("/notes/")
            ):
                clean_attrs.append(f'href="{html.escape(href, quote=True)}"')
            class_name = (attrs_dict.get("class") or "").strip()
            if class_name == "note-link":
                clean_attrs.append('class="note-link"')
            if class_name == "external-link":
                clean_attrs.append('class="external-link"')
            data_note_id = (attrs_dict.get("data-note-id") or "").strip()
            if data_note_id.isdigit():
                clean_attrs.append(f'data-note-id="{data_note_id}"')
            data_note_title = (attrs_dict.get("data-note-title") or "").strip()
            if data_note_title:
                clean_attrs.append(
                    f'data-note-title="{html.escape(data_note_title, quote=True)}"'
                )
        if tag == "span":
            attrs_dict = {name.lower(): (value or "") for name, value in attrs}
            class_name = (attrs_dict.get("class") or "").strip()
            if class_name == "note-inline-checkbox":
                clean_attrs.append('class="note-inline-checkbox"')
            style = (attrs_dict.get("style") or "").strip()
            if style:
                match = re.search(r"font-size\s*:\s*([\d.]+)(px|%)", style)
                if match:
                    clean_attrs.append(
                        f'style="font-size: {match.group(1)}{match.group(2)}"'
                    )
        attr_text = f" {' '.join(clean_attrs)}" if clean_attrs else ""
        if tag in self._void_tags:
            self._parts.append(f"<{tag}{attr_text}>")
        else:
            self._parts.append(f"<{tag}{attr_text}>")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in self._allowed_tags and tag not in self._void_tags:
            self._parts.append(f"</{tag}>")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_data(self, data):
        if data:
            self._parts.append(html.escape(data, quote=False))

    def get_html(self) -> str:
        return "".join(self._parts).strip()


def _sanitize_note_html(raw_html: str) -> str:
    sanitizer = _NoteHTMLSanitizer()
    sanitizer.feed(raw_html or "")
    sanitizer.close()
    return sanitizer.get_html()


def _wrap_plain_text_html(text: str) -> str:
    if not text:
        return ""
    lines = (text or "").splitlines()
    escaped_lines = [html.escape(line, quote=False) for line in lines]
    return "<p>" + "<br>".join(escaped_lines) + "</p>"


def extract_note_list_lines(
    raw_html,
    *,
    min_lines=2,
    max_lines=100,
    max_chars=80,
    max_words=12,
    sentence_word_limit=8,
):
    if not raw_html:
        return None, "Note is empty."
    text = str(raw_html)
    text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", text)
    text = re.sub(r"(?i)</\s*(p|div|li|h[1-6]|blockquote|pre|tr)\s*>", "\n", text)
    text = re.sub(r"(?i)</\s*(ul|ol|table)\s*>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = text.replace("\r", "\n").replace("\xa0", " ")
    raw_lines = [line.strip() for line in text.split("\n")]

    cleaned_lines = []
    for line in raw_lines:
        if not line:
            continue
        line = re.sub(r"^\s*\[[xX ]\]\s+", "", line)
        line = re.sub(r"^\s*(?:[-*+]|\d+[.)]|\d+\s*[-:]|[A-Za-z][.)])\s+", "", line)
        line = re.sub(r"\s+", " ", line).strip()
        if line:
            cleaned_lines.append(line)

    if len(cleaned_lines) < min_lines:
        return None, f"Need at least {min_lines} non-empty lines."
    if len(cleaned_lines) > max_lines:
        return None, f"Too many lines to convert (max {max_lines})."

    for line in cleaned_lines:
        if len(line) > max_chars:
            return None, f"Lines must be {max_chars} characters or fewer."
        words = re.findall(r"[A-Za-z0-9']+", line)
        if len(words) > max_words:
            return None, f"Lines must be {max_words} words or fewer."
        sentence_marks = re.findall(r"[.!?]", line)
        if len(sentence_marks) > 1:
            return None, "Lines must be single phrases, not multiple sentences."
        if len(sentence_marks) == 1 and len(words) > sentence_word_limit:
            return None, (
                f"Lines must be short phrases (max {sentence_word_limit} words if punctuated)."
            )
    return cleaned_lines, None


def is_note_linked(note, linked_targets=None, linked_sources=None):
    if not note:
        return False
    if (
        note.todo_item_id
        or note.calendar_event_id
        or note.planner_multi_item_id
        or note.planner_multi_line_id
    ):
        return True
    if linked_targets is not None and note.id in linked_targets:
        return True
    if linked_sources is not None and note.id in linked_sources:
        return True
    return False


def normalize_calendar_item_note(raw, *, max_chars=300):
    if raw is None:
        return None
    text = str(raw)
    if len(text) > max_chars:
        raise ValueError("Item note exceeds character limit")
    text = text.strip()
    return text or None


def _normalize_similarity_text(text):
    cleaned = re.sub(r"[^\w\s]", " ", str(text or "").lower())
    cleaned = re.sub(r"\b0+(\d+)\b", r"\1", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _tokenize_similarity(text):
    if not text:
        return []
    return [token for token in text.split(" ") if token]


def _sequence_similarity(a, b):
    return SequenceMatcher(None, a, b).ratio()


def _substring_similarity(a, b):
    if not a or not b:
        return 0.0
    short = a if len(a) <= len(b) else b
    long = b if len(a) <= len(b) else a
    if len(short) < 3:
        return 0.0
    if short in long:
        return 0.95
    return 0.0


def _jaccard_similarity(tokens_a, tokens_b):
    set_a = set(tokens_a)
    set_b = set(tokens_b)
    if not set_a or not set_b:
        return 0.0
    return len(set_a & set_b) / len(set_a | set_b)


def _containment_similarity(tokens_a, tokens_b):
    if not tokens_a or not tokens_b:
        return 0.0
    set_a = set(tokens_a)
    set_b = set(tokens_b)
    intersection = len(set_a & set_b)
    min_size = min(len(set_a), len(set_b))
    if min_size == 0:
        return 0.0
    return intersection / min_size


def _cosine_similarity(vec_a, vec_b):
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for a_val, b_val in zip(vec_a, vec_b):
        dot += a_val * b_val
        norm_a += a_val * a_val
        norm_b += b_val * b_val
    if norm_a <= 0.0 or norm_b <= 0.0:
        return 0.0
    return dot / ((norm_a ** 0.5) * (norm_b ** 0.5))


def _group_duplicates(items, similarity_fn, threshold):
    parent = list(range(len(items)))

    def find(idx):
        while parent[idx] != idx:
            parent[idx] = parent[parent[idx]]
            idx = parent[idx]
        return idx

    def union(a, b):
        root_a = find(a)
        root_b = find(b)
        if root_a != root_b:
            parent[root_b] = root_a

    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if similarity_fn(i, j) >= threshold:
                union(i, j)

    groups = {}
    for idx, item in enumerate(items):
        root = find(idx)
        groups.setdefault(root, []).append(item)
    return [group for group in groups.values() if len(group) > 1]
