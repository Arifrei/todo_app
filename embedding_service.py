import hashlib
import json
from typing import Dict, Iterable, List, Optional, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from ai_embeddings import embed_text
from models import (
    db,
    BookmarkItem,
    CalendarEvent,
    EmbeddingRecord,
    RecallItem,
    TodoItem,
    TodoList,
)


ENTITY_RECALL = "recall"
ENTITY_BOOKMARK = "bookmark"
ENTITY_TODO_ITEM = "todo_item"
ENTITY_TODO_LIST = "todo_list"
ENTITY_CALENDAR = "calendar_event"


def _normalize_text(parts: Iterable[Optional[str]]) -> str:
    return "\n".join([p.strip() for p in parts if p and p.strip()]).strip()


def build_embedding_text(entity_type: str, item) -> str:
    if entity_type == ENTITY_RECALL:
        return _normalize_text([
            "[RECALL]",
            "module: recall",
            f"payload_type: {item.payload_type}" if getattr(item, "payload_type", None) else None,
            f"when: {item.when_context}" if getattr(item, "when_context", None) else None,
            item.title,
            item.why,
            item.summary,
            item.payload,
        ])
    if entity_type == ENTITY_BOOKMARK:
        return _normalize_text([
            "[BOOKMARK]",
            "module: bookmark",
            "pinned" if getattr(item, "pinned", False) else "unpinned",
            item.title,
            item.description,
            item.value,
        ])
    if entity_type == ENTITY_TODO_ITEM:
        list_title = item.list.title if getattr(item, "list", None) else None
        list_type = item.list.type if getattr(item, "list", None) else None
        tags = ", ".join(item.tag_list()) if hasattr(item, "tag_list") else None
        return _normalize_text([
            "[TASK]",
            "module: task",
            f"status: {item.status}" if getattr(item, "status", None) else None,
            f"project: {list_title}" if list_title else None,
            f"project_type: {list_type}" if list_type else None,
            item.content,
            item.description,
            item.notes,
            tags,
        ])
    if entity_type == ENTITY_TODO_LIST:
        return _normalize_text([
            "[PROJECT]",
            "module: project",
            f"project_type: {item.type}" if getattr(item, "type", None) else None,
            item.title,
        ])
    if entity_type == ENTITY_CALENDAR:
        day = item.day.isoformat() if item.day else None
        start = item.start_time.isoformat(timespec="minutes") if item.start_time else None
        end = item.end_time.isoformat(timespec="minutes") if item.end_time else None
        timing = " ".join([t for t in [day, start, end] if t])
        return _normalize_text([
            "[CALENDAR]",
            "module: calendar",
            f"day: {day}" if day else None,
            f"time: {start}-{end}" if start or end else None,
            f"status: {item.status}" if getattr(item, "status", None) else None,
            f"priority: {item.priority}" if getattr(item, "priority", None) else None,
            item.title,
            item.description,
            getattr(item, "item_note", None),
        ])
    return ""


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _serialize_embedding(vector: List[float]) -> str:
    return json.dumps(vector)


def _deserialize_embedding(raw: str) -> Optional[List[float]]:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def upsert_embedding(user_id: int, entity_type: str, entity_id: int, text: str) -> Optional[List[float]]:
    cleaned = (text or "").strip()
    if not cleaned:
        return None
    source_hash = _hash_text(cleaned)
    record = EmbeddingRecord.query.filter_by(
        user_id=user_id,
        entity_type=entity_type,
        entity_id=entity_id,
    ).first()
    if record and record.source_hash == source_hash and record.embedding_json:
        return _deserialize_embedding(record.embedding_json)

    vector = embed_text(cleaned)
    if not vector:
        return None

    payload = _serialize_embedding(vector)
    if record:
        record.embedding_json = payload
        record.embedding_dim = len(vector)
        record.source_hash = source_hash
        db.session.commit()
        return vector

    record = EmbeddingRecord(
        user_id=user_id,
        entity_type=entity_type,
        entity_id=entity_id,
        embedding_json=payload,
        embedding_dim=len(vector),
        source_hash=source_hash,
    )
    db.session.add(record)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        record = EmbeddingRecord.query.filter_by(
            user_id=user_id,
            entity_type=entity_type,
            entity_id=entity_id,
        ).first()
        if not record:
            return None
        record.embedding_json = payload
        record.embedding_dim = len(vector)
        record.source_hash = source_hash
        db.session.commit()
    return vector


def list_embedding_vectors(user_id: int, entity_type: str) -> List[Tuple[int, List[float]]]:
    records = EmbeddingRecord.query.filter_by(user_id=user_id, entity_type=entity_type).all()
    vectors = []
    for record in records:
        vec = _deserialize_embedding(record.embedding_json or "")
        if not vec:
            continue
        vectors.append((record.entity_id, vec))
    return vectors


def ensure_embeddings_for_type(user_id: int, entity_type: str, max_new: int = 200) -> int:
    existing = {
        record.entity_id: record.source_hash
        for record in EmbeddingRecord.query.filter_by(user_id=user_id, entity_type=entity_type).all()
    }
    created = 0

    if entity_type == ENTITY_RECALL:
        query = RecallItem.query.filter_by(user_id=user_id)
    elif entity_type == ENTITY_BOOKMARK:
        query = BookmarkItem.query.filter_by(user_id=user_id)
    elif entity_type == ENTITY_TODO_ITEM:
        query = (
            TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id)
            .filter(TodoList.user_id == user_id)
            .options(joinedload(TodoItem.list))
        )
    elif entity_type == ENTITY_TODO_LIST:
        query = TodoList.query.filter_by(user_id=user_id)
    elif entity_type == ENTITY_CALENDAR:
        query = CalendarEvent.query.filter_by(user_id=user_id)
    else:
        return 0

    for item in query:
        text = build_embedding_text(entity_type, item)
        if not text:
            continue
        current_hash = _hash_text(text)
        if item.id in existing and existing[item.id] == current_hash:
            continue
        if upsert_embedding(user_id, entity_type, item.id, text):
            created += 1
        if created >= max_new:
            break
    return created


def cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    mag_a = sum(a * a for a in vec_a) ** 0.5
    mag_b = sum(b * b for b in vec_b) ** 0.5
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def score_embeddings(query_vec: List[float], embeddings: List[Tuple[int, List[float]]], limit: int) -> List[Tuple[float, int]]:
    scored: List[Tuple[float, int]] = []
    for entity_id, vec in embeddings:
        scored.append((cosine_similarity(query_vec, vec), entity_id))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return scored[: max(1, min(limit, 15))]


def refresh_embedding_for_entity(user_id: int, entity_type: str, entity_id: int) -> bool:
    item = None
    if entity_type == ENTITY_RECALL:
        item = RecallItem.query.filter_by(user_id=user_id, id=entity_id).first()
    elif entity_type == ENTITY_BOOKMARK:
        item = BookmarkItem.query.filter_by(user_id=user_id, id=entity_id).first()
    elif entity_type == ENTITY_TODO_ITEM:
        item = (
            TodoItem.query.join(TodoList, TodoItem.list_id == TodoList.id)
            .filter(TodoList.user_id == user_id, TodoItem.id == entity_id)
            .options(joinedload(TodoItem.list))
            .first()
        )
    elif entity_type == ENTITY_TODO_LIST:
        item = TodoList.query.filter_by(user_id=user_id, id=entity_id).first()
    elif entity_type == ENTITY_CALENDAR:
        item = CalendarEvent.query.filter_by(user_id=user_id, id=entity_id).first()
    if not item:
        return False
    text = build_embedding_text(entity_type, item)
    if not text:
        return False
    return bool(upsert_embedding(user_id, entity_type, entity_id, text))
