"""SMS-to-App item capture via IMAP email polling.

Polls an email inbox for SMS-forwarded messages (e.g. via Verizon @vtext.com),
parses routing instructions, and creates items in the appropriate destination.
"""

import imaplib
import email
import os
import re
from datetime import datetime, timedelta


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

_KEYWORD_RE = re.compile(r'^\s*(?:to\s+)?(task|list|calendar|area)\b\s*(.*)', re.IGNORECASE | re.DOTALL)
_TO_RE = re.compile(r'\bto\s+(.+?)(?=\s+(?:in|on|at)\b|$)', re.IGNORECASE)
_IN_RE = re.compile(r'\bin\s+(.+?)(?=\s+(?:on|at)\b|$)', re.IGNORECASE)
_ON_RE = re.compile(r'\bon\s+(.+?)(?=\s+at\b|$)', re.IGNORECASE)
_AT_RE = re.compile(r'\bat\s+(.+?)$', re.IGNORECASE)

_DAY_NAMES = {
    'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3,
    'friday': 4, 'saturday': 5, 'sunday': 6,
}

_MONTH_NAMES = {
    'january': 1, 'february': 2, 'march': 3, 'april': 4,
    'may': 5, 'june': 6, 'july': 7, 'august': 8,
    'september': 9, 'october': 10, 'november': 11, 'december': 12,
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
    'jun': 6, 'jul': 7, 'aug': 8, 'sep': 9,
    'oct': 10, 'nov': 11, 'dec': 12,
}


def _parse_task_routing(remainder, result):
    """Parse task routing: [to] <list> [in <phase>] [on <date>] [at <time>]."""
    m = _TO_RE.search(remainder)
    if m:
        result['list_name'] = m.group(1).strip()
    else:
        bare = re.match(r'(.+?)(?=\s+(?:in|on|at)\b|$)', remainder, re.IGNORECASE)
        if bare and bare.group(1).strip():
            result['list_name'] = bare.group(1).strip()
    m = _IN_RE.search(remainder)
    if m:
        result['phase_name'] = m.group(1).strip()
    m = _ON_RE.search(remainder)
    if m:
        result['date_str'] = m.group(1).strip()
    m = _AT_RE.search(remainder)
    if m:
        result['time_str'] = m.group(1).strip()


def _parse_list_routing(remainder, result):
    """Parse note-list routing: <note name>[, <section>[, <subsection>]]."""
    parts = [p.strip() for p in remainder.split(',') if p.strip()]
    if len(parts) >= 1:
        result['note_list_name'] = parts[0]
    if len(parts) >= 2:
        result['section_name'] = parts[1]
    if len(parts) >= 3:
        result['subsection_name'] = parts[2]


def _parse_calendar_routing(remainder, result):
    """Parse calendar routing: [on <date>] [at <time>]."""
    m = _ON_RE.search(remainder)
    if m:
        result['date_str'] = m.group(1).strip()
    else:
        bare = re.match(r'(.+?)(?=\s+at\b|$)', remainder, re.IGNORECASE)
        if bare and bare.group(1).strip():
            result['date_str'] = bare.group(1).strip()
    m = _AT_RE.search(remainder)
    if m:
        result['time_str'] = m.group(1).strip()


def _parse_area_routing(remainder, result):
    """Parse area routing: <area name>[, <note or task-list block>] [on <date>] [at <time>]."""
    route_part = (remainder or '').strip()
    m = _AT_RE.search(route_part)
    if m:
        result['time_str'] = m.group(1).strip()
        route_part = route_part[:m.start()].strip()
    m = _ON_RE.search(route_part)
    if m:
        result['date_str'] = m.group(1).strip()
        route_part = route_part[:m.start()].strip()
    route_part = re.sub(r'^\s*to\s+', '', route_part, flags=re.IGNORECASE).strip()
    parts = [p.strip() for p in route_part.split(',', 1) if p.strip()]
    if len(parts) >= 1:
        result['area_name'] = parts[0]
    if len(parts) >= 2:
        result['area_block_name'] = parts[1]


def _parse_legacy_routing(routing, result):
    """Parse old-style routing without keyword. Returns route_kind or None."""
    m = _TO_RE.search(routing)
    if m:
        result['list_name'] = m.group(1).strip()
    m = _IN_RE.search(routing)
    if m:
        result['phase_name'] = m.group(1).strip()
    m = _ON_RE.search(routing)
    if m:
        result['date_str'] = m.group(1).strip()
    m = _AT_RE.search(routing)
    if m:
        result['time_str'] = m.group(1).strip()
    if result['list_name']:
        return 'task'
    if result['date_str'] or result['time_str']:
        return 'calendar'
    return None


def parse_sms_text(raw_text):
    """Parse an SMS body into content + routing fields."""
    raw_text = (raw_text or '').strip()
    if not raw_text:
        return None

    result = {
        'content': None, 'route_kind': None,
        'list_name': None, 'phase_name': None,
        'date_str': None, 'time_str': None,
        'note_list_name': None, 'section_name': None,
        'subsection_name': None,
        'area_name': None, 'area_block_name': None,
    }

    if ';' not in raw_text:
        result['content'] = raw_text
        return result

    content, routing = raw_text.split(';', 1)
    content = content.strip()
    routing = routing.strip()
    if not content:
        return None

    result['content'] = content

    km = _KEYWORD_RE.match(routing)
    if not km:
        result['route_kind'] = _parse_legacy_routing(routing, result)
        return result

    keyword = km.group(1).lower()
    remainder = km.group(2).strip()

    if keyword == 'task':
        result['route_kind'] = 'task'
        _parse_task_routing(remainder, result)
    elif keyword == 'list':
        result['route_kind'] = 'list'
        _parse_list_routing(remainder, result)
    elif keyword == 'calendar':
        result['route_kind'] = 'calendar'
        _parse_calendar_routing(remainder, result)
    elif keyword == 'area':
        result['route_kind'] = 'area'
        _parse_area_routing(remainder, result)

    return result


# ---------------------------------------------------------------------------
# Date / time resolution
# ---------------------------------------------------------------------------

def _resolve_date(date_str, today):
    """Parse a natural-language date string relative to *today*."""
    if not date_str:
        return None
    ds = date_str.lower().strip()

    if ds == 'today':
        return today
    if ds == 'tomorrow':
        return today + timedelta(days=1)

    # Day name (monday-sunday) → next occurrence
    if ds in _DAY_NAMES:
        target_wd = _DAY_NAMES[ds]
        diff = (target_wd - today.weekday()) % 7
        if diff == 0:
            diff = 7
        return today + timedelta(days=diff)

    # "month day" e.g. "june 30" or "jun 30"
    m = re.match(r'([a-z]+)\s+(\d{1,2})$', ds)
    if m:
        month_num = _MONTH_NAMES.get(m.group(1))
        if month_num:
            try:
                return today.replace(month=month_num, day=int(m.group(2)))
            except ValueError:
                pass

    # "m/d" or "m/d/yyyy"
    m = re.match(r'(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?$', ds)
    if m:
        month_num = int(m.group(1))
        day_num = int(m.group(2))
        year = int(m.group(3)) if m.group(3) else today.year
        if year < 100:
            year += 2000
        try:
            return today.replace(year=year, month=month_num, day=day_num)
        except ValueError:
            pass

    return None


def _resolve_time(time_str):
    """Parse a time string like '2pm', '14:00', '2:30pm' into 'HH:MM'."""
    if not time_str:
        return None
    ts = time_str.lower().strip()

    m = re.match(r'^(\d{1,2}):(\d{2})\s*(am|pm)?$', ts)
    if m:
        h, mi = int(m.group(1)), int(m.group(2))
        if m.group(3) == 'pm' and h != 12:
            h += 12
        elif m.group(3) == 'am' and h == 12:
            h = 0
        if 0 <= h <= 23 and 0 <= mi <= 59:
            return f'{h:02d}:{mi:02d}'
        return None

    m = re.match(r'^(\d{1,2})\s*(am|pm)$', ts)
    if m:
        h = int(m.group(1))
        if m.group(2) == 'pm' and h != 12:
            h += 12
        elif m.group(2) == 'am' and h == 12:
            h = 0
        if 0 <= h <= 23:
            return f'{h:02d}:00'

    return None


# ---------------------------------------------------------------------------
# Destination resolution
# ---------------------------------------------------------------------------

def _fuzzy_match_list(lists, name):
    """Return the best-matching TodoList for *name*, or None."""
    name_lower = name.lower()
    exact = [l for l in lists if l.title.lower() == name_lower]
    if exact:
        return min(exact, key=lambda l: len(l.title))
    substr = [l for l in lists if name_lower in l.title.lower()]
    if substr:
        return min(substr, key=lambda l: len(l.title))
    return None


def _fuzzy_match_note(notes, name):
    """Return the best-matching Note for *name*, or None."""
    name_lower = name.lower()
    exact = [n for n in notes if n.title.lower() == name_lower]
    if exact:
        return min(exact, key=lambda n: len(n.title))
    substr = [n for n in notes if name_lower in n.title.lower()]
    if substr:
        return min(substr, key=lambda n: len(n.title))
    return None


def _fuzzy_match_area(areas, name):
    """Return the best-matching Area for *name*, or None."""
    name_lower = name.lower()
    exact = [area for area in areas if area.name.lower() == name_lower]
    if exact:
        return min(exact, key=lambda area: len(area.name))
    substr = [area for area in areas if name_lower in area.name.lower()]
    if substr:
        return min(substr, key=lambda area: len(area.name))
    return None


def _fuzzy_match_area_block(blocks, name):
    """Return the best-matching titled Area block for *name*, or None."""
    name_lower = name.lower()
    candidates = [(block, (block.title or '').lower()) for block in blocks if block.title]
    exact = [block for block, title in candidates if title == name_lower]
    if exact:
        return min(exact, key=lambda block: len(block.title or ''))
    substr = [(block, title) for block, title in candidates if name_lower in title]
    if substr:
        return min(substr, key=lambda pair: len(pair[1]))[0]
    return None


def _fuzzy_match_marker(items, name, marker_kind_value, _marker_kind, _marker_title):
    """Return the best-matching NoteListItem marker, or None."""
    name_lower = name.lower()
    candidates = []
    for item in items:
        if _marker_kind(item.text) == marker_kind_value:
            title = (_marker_title(item.text) or '').lower()
            candidates.append((item, title))
    exact = [item for item, t in candidates if t == name_lower]
    if exact:
        return exact[0]
    substr = [(item, t) for item, t in candidates if name_lower in t]
    if substr:
        return min(substr, key=lambda pair: len(pair[1]))[0]
    return None


def _resolve_task(a, user, parsed, today):
    """Resolve a 'task' keyword route."""
    list_name = parsed.get('list_name')
    phase_name = parsed.get('phase_name')
    resolved_date = _resolve_date(parsed.get('date_str'), today)
    resolved_time = _resolve_time(parsed.get('time_str'))
    content = parsed['content']

    matched_list = None
    matched_phase_id = None

    if list_name:
        candidates = a.TodoList.query.filter(
            a.TodoList.user_id == user.id,
            a.TodoList.type.in_(['list', 'light']),
        ).all()
        matched_list = _fuzzy_match_list(candidates, list_name)
        if not matched_list:
            return None, False

        if phase_name and matched_list.type != 'light':
            phases = a.TodoItem.query.filter_by(
                list_id=matched_list.id, is_phase=True
            ).all()
            phase_lower = phase_name.lower()
            exact = [p for p in phases if p.content.lower() == phase_lower]
            if exact:
                matched_phase_id = exact[0].id
            else:
                substr = [p for p in phases if phase_lower in p.content.lower()]
                if substr:
                    matched_phase_id = min(substr, key=lambda p: len(p.content)).id

    if matched_list and resolved_date:
        return {
            'kind': 'task', 'list_id': matched_list.id,
            'phase_id': matched_phase_id, 'title': content,
            'due_date': resolved_date.isoformat(), 'start_time': resolved_time,
        }, True

    if matched_list:
        return {
            'kind': 'task', 'list_id': matched_list.id,
            'phase_id': matched_phase_id, 'title': content,
        }, True

    if resolved_date:
        return {
            'kind': 'calendar', 'title': content,
            'day': resolved_date.isoformat(), 'start_time': resolved_time,
        }, True

    return None, False


def _resolve_note_list(a, user, parsed):
    """Resolve a 'list' keyword route to a note_list destination."""
    from services.inbox_routes import _marker_kind, _marker_title

    note_list_name = parsed.get('note_list_name')
    section_name = parsed.get('section_name')
    subsection_name = parsed.get('subsection_name')

    if not note_list_name:
        return None, False

    candidates = a.Note.query.filter(
        a.Note.user_id == user.id,
        a.Note.note_type == 'list',
        a.Note.archived_at.is_(None),
    ).all()
    matched_note = _fuzzy_match_note(candidates, note_list_name)
    if not matched_note:
        return None, False

    section_id = None
    subsection_id = None

    if section_name or subsection_name:
        items = a.NoteListItem.query.filter_by(
            note_id=matched_note.id
        ).order_by(
            a.NoteListItem.order_index.asc(),
            a.NoteListItem.id.asc(),
        ).all()

        if section_name:
            matched_section = _fuzzy_match_marker(
                items, section_name, 'section', _marker_kind, _marker_title)
            if matched_section:
                section_id = matched_section.id
            else:
                return None, False

        if subsection_name:
            if section_id:
                in_section = False
                section_items = []
                for item in items:
                    if item.id == section_id:
                        in_section = True
                        continue
                    if in_section:
                        if _marker_kind(item.text) == 'section':
                            break
                        section_items.append(item)
                matched_sub = _fuzzy_match_marker(
                    section_items, subsection_name, 'subsection',
                    _marker_kind, _marker_title)
            else:
                matched_sub = _fuzzy_match_marker(
                    items, subsection_name, 'subsection',
                    _marker_kind, _marker_title)
            if matched_sub:
                subsection_id = matched_sub.id
            else:
                return None, False

    return {
        'kind': 'note_list',
        'note_id': matched_note.id,
        'section_id': section_id,
        'subsection_id': subsection_id,
        'text': parsed['content'],
    }, True


def _resolve_calendar(parsed, today):
    """Resolve a 'calendar' keyword route."""
    resolved_date = _resolve_date(parsed.get('date_str'), today)
    resolved_time = _resolve_time(parsed.get('time_str'))
    if not resolved_date:
        return None, False
    return {
        'kind': 'calendar', 'title': parsed['content'],
        'day': resolved_date.isoformat(), 'start_time': resolved_time,
    }, True


def _resolve_area(a, user, parsed, today):
    """Resolve an 'area' keyword route.

    With only an area name, create a line in the area. With a second comma-separated
    target, route only to Area notes or Area task lists.
    """
    area_name = parsed.get('area_name')
    block_name = parsed.get('area_block_name')
    if not area_name:
        return None, False

    areas = a.Area.query.filter(
        a.Area.user_id == user.id,
        a.Area.archived_at.is_(None),
    ).all()
    matched_area = _fuzzy_match_area(areas, area_name)
    if not matched_area:
        return None, False

    if not block_name:
        return {
            'kind': 'area_line',
            'area_id': matched_area.id,
            'text': parsed['content'],
        }, True

    blocks = a.AreaBlock.query.filter(
        a.AreaBlock.user_id == user.id,
        a.AreaBlock.area_id == matched_area.id,
        a.AreaBlock.block_type.in_(['note', 'task_list']),
    ).all()
    matched_block = _fuzzy_match_area_block(blocks, block_name)
    if not matched_block:
        return None, False

    if matched_block.block_type == 'note':
        return {
            'kind': 'area_note',
            'block_id': matched_block.id,
            'text': parsed['content'],
        }, True

    resolved_date = _resolve_date(parsed.get('date_str'), today)
    destination = {
        'kind': 'area_task',
        'block_id': matched_block.id,
        'title': parsed['content'],
    }
    if resolved_date:
        destination['due_date'] = resolved_date.isoformat()
    return destination, True


def resolve_destination(a, user, parsed, today):
    """Map parsed SMS fields to a raw_destination dict for map_inbox_item.

    Returns (destination_dict, routed) or (None, False).
    """
    route_kind = parsed.get('route_kind')
    if route_kind == 'task':
        return _resolve_task(a, user, parsed, today)
    if route_kind == 'list':
        return _resolve_note_list(a, user, parsed)
    if route_kind == 'calendar':
        return _resolve_calendar(parsed, today)
    if route_kind == 'area':
        return _resolve_area(a, user, parsed, today)
    return None, False


# ---------------------------------------------------------------------------
# Email processing
# ---------------------------------------------------------------------------

def _strip_carrier_footer(body):
    """Remove common carrier signature lines from SMS-forwarded email bodies."""
    lines = body.splitlines()
    cleaned = []
    for line in lines:
        if line.strip().startswith('--'):
            break
        cleaned.append(line)
    return '\n'.join(cleaned).strip()


def _extract_plain_body(msg):
    """Extract the plain-text body from an email.message.Message."""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == 'text/plain':
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or 'utf-8'
                    return payload.decode(charset, errors='replace')
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or 'utf-8'
            return payload.decode(charset, errors='replace')
    return ''


def process_sms_email(a, user, body):
    """Parse and route a single SMS email body.

    Creates the appropriate item (task, calendar, or inbox).
    """
    from services.inbox_routes import map_inbox_item, queue_inbox_suggestion

    parsed = parse_sms_text(body)
    if not parsed:
        return

    content = parsed['content']
    today = a._now_local().date()
    dest, routed = resolve_destination(a, user, parsed, today)

    if routed and dest:
        inbox_item = a.InboxItem(user_id=user.id, content=content, status='open')
        a.db.session.add(inbox_item)
        a.db.session.flush()
        map_inbox_item(a, user, inbox_item, dest)
    else:
        inbox_item = a.InboxItem(user_id=user.id, content=content)
        a.db.session.add(inbox_item)
        a.db.session.commit()
        queue_inbox_suggestion(a, inbox_item)


# ---------------------------------------------------------------------------
# IMAP polling job
# ---------------------------------------------------------------------------

def fetch_and_process_emails():
    """Poll the IMAP inbox for new SMS-forwarded emails and process them."""
    import app as a

    if os.environ.get('ENABLE_SMS_INBOX', '0') != '1':
        return

    # Reuse the existing SMTP credentials — Gmail uses the same creds for IMAP.
    # Derive IMAP host from SMTP host (smtp.gmail.com → imap.gmail.com).
    smtp_host = os.environ.get('SMTP_HOST', 'smtp.gmail.com')
    imap_host = smtp_host.replace('smtp.', 'imap.', 1)
    imap_port = 993
    imap_user = os.environ.get('SMTP_USER', '')
    imap_pass = os.environ.get('SMTP_PASSWORD', '')
    allowed_raw = os.environ.get('SMS_ALLOWED_SENDERS', '')
    default_user_id = int(os.environ.get('SMS_DEFAULT_USER_ID', '1'))

    if not imap_user or not imap_pass:
        a.app.logger.warning('SMS inbox: IMAP_USER or IMAP_PASSWORD not set, skipping')
        return

    allowed_senders = {
        s.strip().lower() for s in allowed_raw.split(',') if s.strip()
    }

    with a.app.app_context():
        # Acquire distributed lock
        from models import JobLock
        from sqlalchemy.exc import IntegrityError

        lock_name = 'sms_inbox_poll'
        now = a._now_local()
        worker_id = os.getpid()

        try:
            if a.db.engine.dialect.name == 'sqlite':
                try:
                    lock = JobLock(job_name=lock_name, locked_at=now, locked_by=str(worker_id))
                    a.db.session.add(lock)
                    a.db.session.commit()
                except IntegrityError:
                    a.db.session.rollback()
                    lock = a.db.session.query(JobLock).filter_by(job_name=lock_name).first()
                    if lock and now - lock.locked_at >= timedelta(minutes=5):
                        lock.locked_at = now
                        lock.locked_by = str(worker_id)
                        a.db.session.commit()
                    else:
                        a.app.logger.info('SMS inbox poll already running, skipping')
                        return
            else:
                lock = a.db.session.query(JobLock).filter_by(
                    job_name=lock_name
                ).with_for_update(nowait=True).first()
                if lock:
                    if now - lock.locked_at < timedelta(minutes=5):
                        a.app.logger.info('SMS inbox poll already running, skipping')
                        a.db.session.rollback()
                        return
                    lock.locked_at = now
                    lock.locked_by = str(worker_id)
                else:
                    lock = JobLock(job_name=lock_name, locked_at=now, locked_by=str(worker_id))
                    a.db.session.add(lock)
                a.db.session.commit()
        except Exception as e:
            a.db.session.rollback()
            a.app.logger.info(f'SMS inbox lock acquisition failed: {e}')
            return

        try:
            user = a.User.query.get(default_user_id)
            if not user:
                a.app.logger.error(f'SMS inbox: user {default_user_id} not found')
                return

            a.app.logger.info(f'SMS inbox: connecting to {imap_host}:{imap_port} as {imap_user}')
            conn = imaplib.IMAP4_SSL(imap_host, imap_port, timeout=30)
            conn.login(imap_user, imap_pass)
            a.app.logger.info('SMS inbox: IMAP login successful')
            conn.select('INBOX')

            # Search per allowed sender (server-side) so we never fetch unrelated emails
            ids = []
            for sender_addr in allowed_senders:
                _, msg_ids = conn.search(None, 'UNSEEN', 'FROM', sender_addr)
                if msg_ids[0]:
                    ids.extend(msg_ids[0].split())
            a.app.logger.info(f'SMS inbox: found {len(ids)} unseen emails from allowed senders')

            for mid in ids:
                try:
                    _, data = conn.fetch(mid, '(RFC822)')
                    raw_email = data[0][1]
                    msg = email.message_from_bytes(raw_email)

                    body = _extract_plain_body(msg)
                    body = _strip_carrier_footer(body)
                    if not body.strip():
                        conn.store(mid, '+FLAGS', '\\Seen')
                        continue

                    process_sms_email(a, user, body.strip())
                    conn.store(mid, '+FLAGS', '\\Seen')
                except Exception as e:
                    a.app.logger.error(f'SMS inbox: error processing email {mid}: {e}')
                    conn.store(mid, '+FLAGS', '\\Seen')

            conn.close()
            conn.logout()
        except Exception as e:
            a.app.logger.error(f'SMS inbox: IMAP error: {e}')
        finally:
            try:
                lock = a.db.session.query(JobLock).filter_by(job_name=lock_name).first()
                if lock:
                    a.db.session.delete(lock)
                    a.db.session.commit()
            except Exception:
                a.db.session.rollback()
