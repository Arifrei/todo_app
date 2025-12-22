import json
import os
from datetime import datetime, date, time
from typing import Any, Dict, List, Optional

from openai import OpenAI
from flask import current_app
from models import db, TodoList, TodoItem, CalendarEvent


ALLOWED_STATUSES = {"not_started", "in_progress", "done"}
ALLOWED_PRIORITIES = {"low", "medium", "high"}
ORDINAL_MAP = {
    "first": 1,
    "second": 2,
    "third": 3,
    "fourth": 4,
    "fifth": 5,
    "sixth": 6,
    "seventh": 7,
    "eighth": 8,
    "ninth": 9,
    "tenth": 10,
    "last": -1,
}


def is_phase_header(item: TodoItem) -> bool:
    return getattr(item, "is_phase", False) or getattr(item, "status", None) == "phase"


def canonicalize_phase_flags(items: List[TodoItem]) -> None:
    """Normalize legacy phase markers in-place (no commit)."""
    for item in items:
        if item.status == "phase" and not item.is_phase:
            item.is_phase = True
            item.status = "not_started"


def get_openai_client() -> OpenAI:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")
    return OpenAI(api_key=api_key)


def _list_lists(user_id: int, list_type: Optional[str] = None, search: Optional[str] = None) -> List[Dict[str, Any]]:
    query = TodoList.query.filter_by(user_id=user_id)
    if list_type:
        query = query.filter(TodoList.type == list_type)
    if search:
        like_expr = f"%{search}%"
        query = query.filter(TodoList.title.ilike(like_expr))
    lists = query.order_by(TodoList.title.asc()).all()
    return [{"id": l.id, "title": l.title, "type": l.type} for l in lists]


def _list_items(
    user_id: int,
    list_id: int,
    status: Optional[str] = None,
    phase_id: Optional[int] = None,
    include_phases: bool = True,
) -> List[Dict[str, Any]]:
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user_id).first()
    if not todo_list:
        raise ValueError("List not found")
    canonicalize_phase_flags(todo_list.items)

    items = list(todo_list.items)
    if status:
        if status not in ALLOWED_STATUSES:
            raise ValueError("Invalid status filter")
        items = [i for i in items if i.status == status]
    if not include_phases:
        items = [i for i in items if not is_phase_header(i)]
    if phase_id is not None:
        items = [i for i in items if i.phase_id == phase_id or (include_phases and i.id == phase_id)]

    items = sorted(items, key=lambda i: i.order_index or 0)
    return [_item_dict(i) for i in items]


def _list_hub_tasks(
    user_id: int,
    hub_id: int,
    status: Optional[str] = None,
    include_phases: bool = True,
) -> List[Dict[str, Any]]:
    """Return tasks grouped by child project within a hub."""
    hub = TodoList.query.filter_by(id=hub_id, user_id=user_id, type="hub").first()
    if not hub:
        raise ValueError("Hub not found")

    projects = []
    allowed_statuses = ALLOWED_STATUSES
    for item in sorted(hub.items, key=lambda i: i.order_index or 0):
        if not item.linked_list:
            continue
        child = item.linked_list
        canonicalize_phase_flags(child.items)
        tasks = []
        for t in sorted(child.items, key=lambda i: i.order_index or 0):
            if is_phase_header(t) and not include_phases:
                continue
            if status and t.status != status:
                continue
            tasks.append(_item_dict(t))
        projects.append({
            "project_id": child.id,
            "project_title": child.title,
            "project_type": child.type,
            "tasks": tasks,
        })
    return projects


def _item_dict(item: TodoItem) -> Dict[str, Any]:
    data = item.to_dict()
    data["list_title"] = item.list.title if item.list else None
    data["list_type"] = item.list.type if item.list else None
    data["kind"] = "phase" if is_phase_header(item) else "task"
    return data


def _create_item(
    user_id: int,
    list_id: int,
    content: str,
    description: Optional[str] = None,
    notes: Optional[str] = None,
    phase_id: Optional[int] = None,
    is_phase: bool = False,
    is_project: bool = False,
    project_type: str = "list",
) -> Dict[str, Any]:
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user_id).first()
    if not todo_list:
        raise ValueError("List not found")

    canonicalize_phase_flags(todo_list.items)

    status = "not_started"
    if project_type not in ["list", "hub"]:
        project_type = "list"

    # Validate destination phase if provided
    target_phase = None
    if phase_id:
        target_phase = TodoItem.query.filter_by(id=phase_id, list_id=list_id).first()
        if not target_phase or not is_phase_header(target_phase):
            raise ValueError("Phase not found in that project")

    new_item = TodoItem(
        list_id=list_id,
        content=content.strip(),
        description=(description or "").strip() or None,
        notes=(notes or "").strip() or None,
        status=status,
        order_index=0,
        phase_id=phase_id if (phase_id and not is_phase) else None,
        is_phase=bool(is_phase),
    )

    if is_project:
        child = TodoList(title=content.strip(), type=project_type, user_id=user_id)
        db.session.add(child)
        db.session.flush()
        new_item.linked_list_id = child.id

    db.session.add(new_item)
    db.session.flush()

    # Place in order (under phase if provided)
    _insert_item_in_order(todo_list, new_item, phase_id=new_item.phase_id if not is_phase else None)
    db.session.commit()
    return _item_dict(new_item)


def _update_item(
    user_id: int,
    item_id: int,
    status: Optional[str] = None,
    content: Optional[str] = None,
    description: Optional[str] = None,
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    item = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
        TodoItem.id == item_id,
        TodoList.user_id == user_id,
    ).first()
    if not item:
        raise ValueError("Item not found")

    if status:
        if status not in ALLOWED_STATUSES:
            raise ValueError("Invalid status")
        item.status = status
    if content is not None:
        item.content = content
    if description is not None:
        item.description = description
    if notes is not None:
        item.notes = notes

    db.session.commit()
    return _item_dict(item)


def _move_item(
    user_id: int,
    item_id: int,
    destination_list_id: int,
    destination_phase_id: Optional[int] = None,
) -> Dict[str, Any]:
    item = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
        TodoItem.id == item_id,
        TodoList.user_id == user_id,
    ).first()
    if not item:
        raise ValueError("Item not found")
    if is_phase_header(item):
        raise ValueError("Cannot move a phase header")
    if item.linked_list_id:
        raise ValueError("Cannot move a linked project via this tool")

    dest_list = TodoList.query.filter_by(id=destination_list_id, user_id=user_id).first()
    if not dest_list:
        raise ValueError("Destination list not found")

    canonicalize_phase_flags(dest_list.items)

    dest_phase = None
    if destination_phase_id:
        dest_phase = TodoItem.query.filter_by(id=destination_phase_id, list_id=destination_list_id).first()
        if not dest_phase or not is_phase_header(dest_phase):
            raise ValueError("Destination phase not found")

    item.list_id = dest_list.id
    item.phase_id = dest_phase.id if dest_phase else None
    item.order_index = db.session.query(db.func.coalesce(db.func.max(TodoItem.order_index), 0)).filter_by(list_id=dest_list.id).scalar() + 1

    db.session.commit()
    return _item_dict(item)


def _search_entities(user_id: int, q: str, list_limit: int = 10, item_limit: int = 20) -> Dict[str, Any]:
    if not q:
        raise ValueError("Query is required")
    like_expr = f"%{q}%"

    lists = TodoList.query.filter(
        TodoList.user_id == user_id,
        TodoList.title.ilike(like_expr)
    ).order_by(TodoList.title.asc()).limit(list_limit).all()

    items = TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id).filter(
        TodoList.user_id == user_id,
        db.or_(TodoItem.content.ilike(like_expr), TodoItem.description.ilike(like_expr))
    ).order_by(TodoItem.list_id, TodoItem.order_index).limit(item_limit).all()

    canonicalize_phase_flags(items)

    return {
        "lists": [{"id": l.id, "title": l.title, "type": l.type} for l in lists],
        "items": [_item_dict(i) for i in items],
    }


def _find_list_by_name(user_id: int, name: str, list_type: Optional[str] = None) -> Optional[TodoList]:
    """Case-insensitive lookup for a list by title."""
    if not name:
        return None
    name = name.strip()
    query = TodoList.query.filter(TodoList.user_id == user_id)
    if list_type:
        query = query.filter(TodoList.type == list_type)
    # Exact (case-insensitive)
    exact = query.filter(db.func.lower(TodoList.title) == name.lower()).first()
    if exact:
        return exact
    # Fallback partial
    like_expr = f"%{name}%"
    return query.filter(TodoList.title.ilike(like_expr)).order_by(TodoList.title.asc()).first()


def _find_phase_by_name(list_obj: TodoList, phase_name: str) -> Optional[TodoItem]:
    if not phase_name:
        return None
    canonicalize_phase_flags(list_obj.items)
    phase_name = phase_name.strip()
    phases = sorted([i for i in list_obj.items if is_phase_header(i)], key=lambda x: x.order_index or 0)
    if not phases:
        return None

    lower_name = phase_name.lower()
    # Exact match
    for p in phases:
        if p.content.strip().lower() == lower_name:
            return p
    # Partial match
    for p in phases:
        if lower_name in p.content.strip().lower():
            return p
    # Numeric like "phase 2"
    import re
    num_match = re.search(r'(\d+)', lower_name)
    if num_match:
        idx = int(num_match.group(1)) - 1
        if 0 <= idx < len(phases):
            return phases[idx]
    # Ordinal words
    for word, ordinal_idx in ORDINAL_MAP.items():
        if word in lower_name:
            if ordinal_idx == -1:
                return phases[-1]
            idx = ordinal_idx - 1
            if 0 <= idx < len(phases):
                return phases[idx]
    return None


def _create_task_by_names(
    user_id: int,
    list_name: str,
    content: str,
    phase_name: Optional[str] = None,
    description: Optional[str] = None,
    notes: Optional[str] = None,
    list_type: Optional[str] = None,
) -> Dict[str, Any]:
    target_list = _find_list_by_name(user_id, list_name, list_type=list_type)
    if not target_list:
        raise ValueError("List not found by that name")

    target_phase = _find_phase_by_name(target_list, phase_name) if phase_name else None
    if phase_name and not target_phase:
        raise ValueError("Phase not found by that name in the project")
    phase_id = target_phase.id if target_phase else None
    created = _create_item(
        user_id=user_id,
        list_id=target_list.id,
        content=content,
        description=description,
        notes=notes,
        phase_id=phase_id,
        is_phase=False,
        is_project=False,
    )
    created["list_title"] = target_list.title
    created["phase_title"] = target_phase.content if target_phase else None
    return created


def _insert_item_in_order(todo_list: TodoList, new_item: TodoItem, phase_id: Optional[int] = None) -> None:
    """Insert item in list ordering, optionally under a specific phase."""
    def is_phase(item: TodoItem) -> bool:
        return is_phase_header(item)

    ordered = sorted(list(todo_list.items), key=lambda i: i.order_index or 0)
    if new_item not in ordered:
        ordered.append(new_item)

    if phase_id:
        phase = next((i for i in ordered if i.id == phase_id and is_phase(i)), None)
        if phase:
            try:
                phase_idx = ordered.index(phase)
            except ValueError:
                phase_idx = -1
            insert_idx = phase_idx + 1
            while insert_idx < len(ordered) and not is_phase(ordered[insert_idx]):
                insert_idx += 1
            ordered = [i for i in ordered if i.id != new_item.id]
            ordered.insert(insert_idx, new_item)

    for idx, item in enumerate(ordered, start=1):
        item.order_index = idx


def _parse_day_str(raw: str) -> date:
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except Exception as exc:
        raise ValueError("Invalid day (expected YYYY-MM-DD)") from exc


def _parse_time_str(raw: Optional[str]) -> Optional[time]:
    if not raw:
        return None
    try:
        parts = raw.split(":")
        if len(parts) == 1:
            return time(hour=int(parts[0]), minute=0)
        return time(hour=int(parts[0]), minute=int(parts[1]))
    except Exception as exc:
        raise ValueError("Invalid time (expected HH or HH:MM 24h)") from exc


def _calendar_event_dict(ev: CalendarEvent) -> Dict[str, Any]:
    data = ev.to_dict()
    # Flatten linked notes for convenience
    data["linked_note_ids"] = [n.id for n in ev.notes] if getattr(ev, "notes", None) else []
    return data


def _list_calendar_events(
    user_id: int,
    day: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> List[Dict[str, Any]]:
    query = CalendarEvent.query.filter_by(user_id=user_id)
    if day:
        day_obj = _parse_day_str(day)
        query = query.filter(CalendarEvent.day == day_obj)
    if start:
        start_day = _parse_day_str(start)
        query = query.filter(CalendarEvent.day >= start_day)
    if end:
        end_day = _parse_day_str(end)
        query = query.filter(CalendarEvent.day <= end_day)
    events = query.order_by(CalendarEvent.day.asc(), CalendarEvent.order_index.asc()).all()
    return [_calendar_event_dict(e) for e in events]


def _create_calendar_event(
    user_id: int,
    title: str,
    day: str,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    status: str = "not_started",
    priority: str = "medium",
    is_phase: bool = False,
    is_event: bool = False,
    is_group: bool = False,
    phase_id: Optional[int] = None,
    group_id: Optional[int] = None,
    reminder_minutes_before: Optional[int] = None,
    description: Optional[str] = None,
) -> Dict[str, Any]:
    if status not in ALLOWED_STATUSES:
        raise ValueError("Invalid status")
    if priority not in ALLOWED_PRIORITIES:
        raise ValueError("Invalid priority")
    day_obj = _parse_day_str(day)
    start_t = _parse_time_str(start_time)
    end_t = _parse_time_str(end_time)

    if phase_id and (is_phase or is_group):
        raise ValueError("phase_id not allowed when creating a phase or group")

    event = CalendarEvent(
        user_id=user_id,
        title=title.strip(),
        description=(description or "").strip() or None,
        day=day_obj,
        start_time=start_t,
        end_time=end_t,
        status=status,
        priority=priority,
        is_phase=bool(is_phase),
        is_event=bool(is_event and not is_phase and not is_group),
        is_group=bool(is_group and not is_phase and not is_event),
        phase_id=phase_id if phase_id and not is_phase and not is_group else None,
        group_id=group_id if group_id and not is_group else None,
        reminder_minutes_before=int(reminder_minutes_before) if reminder_minutes_before is not None else None,
        rollover_enabled=not is_group,
        order_index=0,
    )
    db.session.add(event)
    db.session.flush()

    # Place at end of day ordering
    max_order = (
        db.session.query(db.func.coalesce(db.func.max(CalendarEvent.order_index), 0))
        .filter_by(user_id=user_id, day=day_obj)
        .scalar()
    )
    event.order_index = max_order + 1
    db.session.commit()
    return _calendar_event_dict(event)


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_lists",
            "description": "List the user's projects/hubs",
            "parameters": {
                "type": "object",
                "properties": {
                    "list_type": {"type": "string", "enum": ["list", "hub"], "description": "Filter by list type"},
                    "search": {"type": "string", "description": "Optional search string for titles"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_items",
            "description": "List items in a project",
            "parameters": {
                "type": "object",
                "properties": {
                    "list_id": {"type": "integer"},
                    "status": {"type": "string", "enum": ["not_started", "in_progress", "done"]},
                    "phase_id": {"type": "integer"},
                    "include_phases": {"type": "boolean", "default": True},
                },
                "required": ["list_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_hub_tasks",
            "description": "List tasks across projects inside a hub, grouped by project",
            "parameters": {
                "type": "object",
                "properties": {
                    "hub_id": {"type": "integer"},
                    "status": {"type": "string", "enum": ["not_started", "in_progress", "done"]},
                    "include_phases": {"type": "boolean", "default": True},
                },
                "required": ["hub_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_item",
            "description": "Create a task/phase/project in a project",
            "parameters": {
                "type": "object",
                "properties": {
                    "list_id": {"type": "integer"},
                    "content": {"type": "string"},
                    "description": {"type": "string"},
                    "notes": {"type": "string"},
                    "phase_id": {"type": "integer"},
                    "is_phase": {"type": "boolean"},
                    "is_project": {"type": "boolean"},
                    "project_type": {"type": "string", "enum": ["list", "hub"]},
                },
                "required": ["list_id", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_item",
            "description": "Update a task status or fields",
            "parameters": {
                "type": "object",
                "properties": {
                    "item_id": {"type": "integer"},
                    "status": {"type": "string", "enum": ["not_started", "in_progress", "done"]},
                    "content": {"type": "string"},
                    "description": {"type": "string"},
                    "notes": {"type": "string"},
                },
                "required": ["item_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "move_item",
            "description": "Move a task to another project/phase",
            "parameters": {
                "type": "object",
                "properties": {
                    "item_id": {"type": "integer"},
                    "destination_list_id": {"type": "integer"},
                    "destination_phase_id": {"type": "integer"},
                },
                "required": ["item_id", "destination_list_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_entities",
            "description": "Search lists and items by text",
            "parameters": {
                "type": "object",
                "properties": {
                    "q": {"type": "string"},
                    "list_limit": {"type": "integer"},
                    "item_limit": {"type": "integer"},
                },
                "required": ["q"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_task_by_names",
            "description": "Create a task by resolving project and optional phase by name",
            "parameters": {
                "type": "object",
                "properties": {
                    "list_name": {"type": "string"},
                    "phase_name": {"type": "string"},
                    "content": {"type": "string"},
                    "description": {"type": "string"},
                    "notes": {"type": "string"},
                    "list_type": {"type": "string", "enum": ["list", "hub"]},
                },
                "required": ["list_name", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_calendar_events",
            "description": "List calendar events/tasks for a specific day or date range",
            "parameters": {
                "type": "object",
                "properties": {
                    "day": {"type": "string", "description": "Day in YYYY-MM-DD"},
                    "start": {"type": "string", "description": "Start date (YYYY-MM-DD)"},
                    "end": {"type": "string", "description": "End date (YYYY-MM-DD)"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_calendar_event",
            "description": "Create a calendar entry (task/event/phase/group) with full properties",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "day": {"type": "string", "description": "YYYY-MM-DD"},
                    "start_time": {"type": "string", "description": "HH or HH:MM 24h"},
                    "end_time": {"type": "string", "description": "HH or HH:MM 24h"},
                    "status": {"type": "string", "enum": ["not_started", "in_progress", "done"]},
                    "priority": {"type": "string", "enum": ["low", "medium", "high"]},
                    "is_phase": {"type": "boolean"},
                    "is_event": {"type": "boolean"},
                    "is_group": {"type": "boolean"},
                    "phase_id": {"type": "integer", "description": "Parent phase id"},
                    "group_id": {"type": "integer", "description": "Parent group id"},
                    "reminder_minutes_before": {"type": "integer"},
                    "description": {"type": "string"},
                },
                "required": ["title", "day"],
            },
        },
    },
]


def _build_system_prompt(today_iso: str, timezone: str) -> str:
    return f"""You are a task/project assistant. Follow these rules:
- Today's date is {today_iso} (timezone: {timezone}). When the user says things like "today", "tomorrow", "next Monday", convert them to an explicit YYYY-MM-DD in that timezone before calling tools. If ambiguous, ask a short clarifying question.
- Determine intent: list tasks/projects; add tasks/phases/projects; move tasks; update status/content.
- You can also manage the calendar: list calendar entries by day/range and create new entries (tasks/events/phases/groups). Always set day (YYYY-MM-DD) and use precise fields (start_time/end_time HH:MM 24h, status, priority, flags is_event/is_phase/is_group, phase_id/group_id when nesting, reminder_minutes_before, description).
- Always use tools to fetch ids before mutating. Do not guess ids.
- When user refers to names, search then pick the closest; if multiple matches, ask a short clarifying question.
- If user says "first/second/third/last phase", choose that phase by order_index (1-based; last = final phase).
- If a referenced project or phase name is not an exact match:
  * Suggest the closest match(es) and ask the user to confirm which to use, or whether to create a new one with that name.
  * Do not create or modify anything until the user confirms.
- For creation: default status not_started; phases use is_phase=true; projects use is_project=true and project_type=list unless specified. Prefer create_task_by_names when the user provides project/phase names.
- When listing tasks for a hub, use list_hub_tasks so you return tasks grouped by child project (and phases when requested).
- Listing format (use markdown for clear visual hierarchy):
  * Project headers: "**📋 Project: <name>** (<type>)" - bold with project emoji
  * Phase headers (kind == phase): "**▶ Phase: <name>**" - bold with arrow emoji, then list only its tasks beneath
  * Regular tasks (kind == task): "• [status] <task>" - bullet point with styled status badge
  * If tasks are not assigned to a phase, list them after all phases under the project
  * Status badges (use these exact formats for visual styling):
    - not_started: "• [○] <task>" - empty circle
    - in_progress: "• [◐] <task>" - half-filled circle
    - done: "• [✓] <task>" - checkmark
  * Add blank lines between projects and between phases for readability
- Keep responses concise; report what you changed. When you add or update, just confirm success and what was added/changed (no need to list all tasks)."""


def _call_tool(user_id: int, name: str, args: Dict[str, Any]) -> Any:
    if name == "list_lists":
        return _list_lists(user_id, args.get("list_type"), args.get("search"))
    if name == "list_items":
        return _list_items(
            user_id=user_id,
            list_id=int(args["list_id"]),
            status=args.get("status"),
            phase_id=args.get("phase_id"),
            include_phases=args.get("include_phases", True),
        )
    if name == "list_hub_tasks":
        return _list_hub_tasks(
            user_id=user_id,
            hub_id=int(args["hub_id"]),
            status=args.get("status"),
            include_phases=args.get("include_phases", True),
        )
    if name == "create_item":
        return _create_item(
            user_id=user_id,
            list_id=int(args["list_id"]),
            content=args["content"],
            description=args.get("description"),
            notes=args.get("notes"),
            phase_id=args.get("phase_id"),
            is_phase=bool(args.get("is_phase")),
            is_project=bool(args.get("is_project")),
            project_type=args.get("project_type", "list"),
        )
    if name == "update_item":
        return _update_item(
            user_id=user_id,
            item_id=int(args["item_id"]),
            status=args.get("status"),
            content=args.get("content"),
            description=args.get("description"),
            notes=args.get("notes"),
        )
    if name == "move_item":
        return _move_item(
            user_id=user_id,
            item_id=int(args["item_id"]),
            destination_list_id=int(args["destination_list_id"]),
            destination_phase_id=args.get("destination_phase_id"),
        )
    if name == "search_entities":
        return _search_entities(
            user_id=user_id,
            q=args.get("q", ""),
            list_limit=args.get("list_limit", 10),
            item_limit=args.get("item_limit", 20),
        )
    if name == "create_task_by_names":
        return _create_task_by_names(
            user_id=user_id,
            list_name=args.get("list_name", ""),
            content=args.get("content", ""),
            phase_name=args.get("phase_name"),
            description=args.get("description"),
            notes=args.get("notes"),
            list_type=args.get("list_type"),
        )
    if name == "list_calendar_events":
        return _list_calendar_events(
            user_id=user_id,
            day=args.get("day"),
            start=args.get("start"),
            end=args.get("end"),
        )
    if name == "create_calendar_event":
        return _create_calendar_event(
            user_id=user_id,
            title=args.get("title", ""),
            day=args.get("day", ""),
            start_time=args.get("start_time"),
            end_time=args.get("end_time"),
            status=args.get("status", "not_started"),
            priority=args.get("priority", "medium"),
            is_phase=bool(args.get("is_phase")),
            is_event=bool(args.get("is_event")),
            is_group=bool(args.get("is_group")),
            phase_id=args.get("phase_id"),
            group_id=args.get("group_id"),
            reminder_minutes_before=args.get("reminder_minutes_before"),
            description=args.get("description"),
        )
    raise ValueError(f"Unknown tool: {name}")


def run_ai_chat(user_id: int, messages: List[Dict[str, Any]], model: Optional[str] = None, max_tool_loops: int = 5) -> Dict[str, Any]:
    client = get_openai_client()
    model_name = model or os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

    # Build message list with system prompt
    today_iso = date.today().isoformat()
    timezone = os.environ.get("DEFAULT_TIMEZONE", "UTC")
    convo = [{"role": "system", "content": _build_system_prompt(today_iso, timezone)}]
    for m in messages:
        role = m.get("role")
        content = m.get("content")
        if not role or content is None:
            continue
        convo.append({"role": role, "content": content})

    tool_results = []

    for _ in range(max_tool_loops):
        response = client.chat.completions.create(
            model=model_name,
            messages=convo,
            tools=TOOLS,
            tool_choice="auto",
        )
        msg = response.choices[0].message

        if msg.tool_calls:
            # Append the assistant tool-call message once, then add tool responses
            convo.append(msg)
            for tc in msg.tool_calls:
                name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                try:
                    result = _call_tool(user_id, name, args)
                except Exception as exc:  # surface errors to the model
                    result = {"error": str(exc)}

                tool_results.append({"name": name, "args": args, "result": result})
                convo.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result)})
            continue

        # Final answer
        return {
            "reply": msg.content,
            "actions": tool_results,
            "model": model_name,
        }

    return {
        "reply": "Unable to complete after multiple tool calls.",
        "actions": tool_results,
        "model": model_name,
    }
