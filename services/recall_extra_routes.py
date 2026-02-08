"""Extracted route handlers grouped by domain for readability."""

import app as _app_module

# Keep access to shared app context, models, helpers, and constants.
for _name, _value in vars(_app_module).items():
    if not _name.startswith('__'):
        globals()[_name] = _value

def handle_recalls():
    """List or create recall items."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    if request.method == 'POST':
        data = request.json or request.form or {}
        title = (data.get('title') or '').strip()
        payload_type = (data.get('payload_type') or '').strip().lower()
        payload = (data.get('payload') or '').strip()
        when_context = (data.get('when_context') or '').strip().lower() or 'future'

        if not title or not payload:
            return jsonify({'error': 'title and payload are required'}), 400
        if payload_type not in ['url', 'text']:
            return jsonify({'error': 'payload_type must be url or text'}), 400

        recall = RecallItem(
            user_id=user.id,
            title=title,
            payload_type=payload_type,
            payload=payload,
            when_context=when_context,
            why='',  # Default empty, AI will populate
            ai_status='pending'
        )
        db.session.add(recall)
        db.session.commit()

        start_embedding_job(user.id, ENTITY_RECALL, recall.id)

        # Start background AI processing
        start_recall_processing(recall.id)

        return jsonify(recall.to_dict()), 201

    recalls = RecallItem.query.filter_by(user_id=user.id).order_by(
        RecallItem.updated_at.desc(),
        RecallItem.created_at.desc()
    ).all()
    return jsonify([r.to_dict() for r in recalls])



def recall_detail(recall_id):
    """Get, update, or delete a single recall item."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    recall = RecallItem.query.filter_by(id=recall_id, user_id=user.id).first()
    if not recall:
        return jsonify({'error': 'Recall not found'}), 404

    if request.method == 'GET':
        return jsonify(recall.to_dict())

    if request.method == 'DELETE':
        delete_embedding(user.id, ENTITY_RECALL, recall.id)
        db.session.delete(recall)
        db.session.commit()
        return jsonify({'deleted': True})

    data = request.json or request.form or {}
    if 'title' in data:
        title_val = (data.get('title') or '').strip()
        if title_val:
            recall.title = title_val
    if 'why' in data:
        why_val = (data.get('why') or '').strip()
        recall.why = why_val if why_val else recall.why
    if 'summary' in data:
        summary_val = (data.get('summary') or '').strip()
        recall.summary = summary_val if summary_val else recall.summary
    if 'payload_type' in data:
        payload_type = (data.get('payload_type') or '').strip().lower()
        if payload_type in ['url', 'text']:
            recall.payload_type = payload_type
    if 'payload' in data:
        payload_val = (data.get('payload') or '').strip()
        if payload_val:
            recall.payload = payload_val

    recall.updated_at = _now_local()
    db.session.commit()
    start_embedding_job(user.id, ENTITY_RECALL, recall.id)
    return jsonify(recall.to_dict())



def regenerate_recall(recall_id):
    """Re-trigger AI processing for a recall item."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    recall = RecallItem.query.filter_by(id=recall_id, user_id=user.id).first()
    if not recall:
        return jsonify({'error': 'Recall not found'}), 404

    recall.ai_status = 'pending'
    recall.why = None
    recall.summary = None
    db.session.commit()

    start_embedding_job(user.id, ENTITY_RECALL, recall.id)
    start_recall_processing(recall.id)
    return jsonify(recall.to_dict())


