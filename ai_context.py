from models import RecallItem, BookmarkItem


def get_recalls_context(user_id):
    """Lightweight recalls summary for AI assistant."""
    recalls = RecallItem.query.filter_by(user_id=user_id).all()

    if not recalls:
        return "No recalls saved."

    lines = []
    for r in recalls:
        # Basic info: title, why
        line = f"- {r.title}"
        if r.why:
            line += f": {r.why}"

        # Add URL if present
        if r.payload_type == 'url':
            line += f" (link: {r.payload})"
        else:
            line += " (text note)"

        # Add summary preview if available
        if r.summary:
            summary_preview = r.summary[:150] + "..." if len(r.summary) > 150 else r.summary
            line += f"\n  Summary: {summary_preview}"

        lines.append(line)

    return "User's recalls:\n" + "\n".join(lines)


def get_bookmarks_context(user_id):
    """Summarize bookmarks for AI assistant."""
    bookmarks = BookmarkItem.query.filter_by(user_id=user_id).order_by(
        BookmarkItem.pinned.desc(),
        BookmarkItem.pin_order.desc(),
        BookmarkItem.updated_at.desc(),
        BookmarkItem.created_at.desc(),
    ).all()

    if not bookmarks:
        return "No bookmarks saved."

    lines = []
    for b in bookmarks:
        pin_flag = "pinned" if b.pinned else "unpinned"
        desc = f" | desc: {b.description}" if b.description else ""
        lines.append(f"- [{pin_flag}] {b.title}{desc} | value: {b.value}")

    return "User's bookmarks:\n" + "\n".join(lines)


def get_all_ai_context(user_id):
    """Aggregate all context for AI assistant."""
    return "\n\n".join([get_recalls_context(user_id), get_bookmarks_context(user_id)])
