from datetime import date, datetime, time


def normalize_note_type(raw):
    return "list" if str(raw or "").lower() == "list" else "note"


def parse_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ["1", "true", "yes", "on"]


def normalize_tags(raw):
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(t).strip() for t in raw if str(t).strip()]
    return [t.strip() for t in str(raw).split(",") if t.strip()]


def tags_to_string(tags):
    return ",".join(normalize_tags(tags))


def normalize_tag_key(tag):
    return " ".join(str(tag or "").split()).lower()


def merge_tag_list(existing, extra):
    merged = []
    seen = set()
    for tag in normalize_tags(existing):
        key = normalize_tag_key(tag)
        if key and key not in seen:
            seen.add(key)
            merged.append(tag)
    for tag in normalize_tags(extra):
        key = normalize_tag_key(tag)
        if key and key not in seen:
            seen.add(key)
            merged.append(tag)
    return merged


def parse_reminder_iso(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def parse_time_str(val):
    """Parse 24h or am/pm strings into a time object; return None on failure."""
    if not val:
        return None
    if isinstance(val, time):
        return val
    s = str(val).strip().lower().replace(" ", "")

    import re

    pattern = r"^(?P<hour>\d{1,2})(:(?P<minute>\d{1,2}))?(:(?P<second>\d{1,2}))?(?P<ampm>a|p|am|pm)?$"
    m = re.match(pattern, s)
    if not m:
        return None
    try:
        hour = int(m.group("hour"))
        minute = int(m.group("minute") or 0)
        ampm = m.group("ampm")
        if m.group("second") is not None:
            sec_val = int(m.group("second"))
            if not (0 <= sec_val <= 59):
                return None
        if ampm:
            if ampm in ("p", "pm") and hour != 12:
                hour += 12
            if ampm in ("a", "am") and hour == 12:
                hour = 0
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            return None
        return time(hour=hour, minute=minute)
    except (TypeError, ValueError):
        return None


def parse_days_of_week(raw):
    if raw is None:
        return []
    if isinstance(raw, list):
        values = raw
    else:
        values = str(raw).split(",")
    days = []
    for val in values:
        try:
            day = int(val)
        except (TypeError, ValueError):
            continue
        if 0 <= day <= 6:
            days.append(day)
    return sorted(set(days))


def parse_day_value(raw):
    if isinstance(raw, date):
        return raw
    try:
        return datetime.strptime(str(raw), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None
