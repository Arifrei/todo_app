import argparse

from app import app
from models import User
from embedding_service import (
    ENTITY_BOOKMARK,
    ENTITY_CALENDAR,
    ENTITY_RECALL,
    ENTITY_TODO_ITEM,
    ENTITY_TODO_LIST,
    ensure_embeddings_for_type,
)


def backfill_for_user(user_id: int, max_per_type: int) -> None:
    ensure_embeddings_for_type(user_id, ENTITY_RECALL, max_new=max_per_type)
    ensure_embeddings_for_type(user_id, ENTITY_BOOKMARK, max_new=max_per_type)
    ensure_embeddings_for_type(user_id, ENTITY_TODO_ITEM, max_new=max_per_type)
    ensure_embeddings_for_type(user_id, ENTITY_TODO_LIST, max_new=max_per_type)
    ensure_embeddings_for_type(user_id, ENTITY_CALENDAR, max_new=max_per_type)


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill semantic embeddings for app content.")
    parser.add_argument("--user-id", type=int, default=None, help="Limit backfill to a specific user")
    parser.add_argument("--max-per-type", type=int, default=5000, help="Max new embeddings per entity type")
    args = parser.parse_args()

    with app.app_context():
        if args.user_id:
            backfill_for_user(args.user_id, args.max_per_type)
            return
        for user in User.query.all():
            backfill_for_user(user.id, args.max_per_type)


if __name__ == "__main__":
    main()
