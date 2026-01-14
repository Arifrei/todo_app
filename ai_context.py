from models import RecallItem


def get_recalls_context(user_id):
    """Lightweight recalls summary for AI assistant."""
    recalls = RecallItem.query.filter_by(user_id=user_id).all()

    if not recalls:
        return "No recalls saved."

    lines = []
    for r in recalls:
        # Basic info: context, title, why
        line = f"- [{r.when_context}] {r.title}"
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


def get_all_ai_context(user_id):
    """Aggregate all context for AI assistant."""
    return get_recalls_context(user_id)
