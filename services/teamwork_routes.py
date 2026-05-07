import json
import os

from backend.background_jobs import start_app_context_job
from services.teamwork_sync import (
    TeamworkConfigError,
    get_teamwork_config,
    get_target_user,
    handle_webhook_payload,
    ignore_teamwork_task_for_user,
    sync_all_assigned_tasks,
    verify_webhook_signature,
)


def teamwork_sync_now():
    import app as a

    user = a.get_current_user()
    if not user and not os.environ.get('TEAMWORK_LOCAL_USER_ID'):
        return a.jsonify({'error': 'No user selected'}), 401
    try:
        stats = sync_all_assigned_tasks()
    except TeamworkConfigError as exc:
        return a.jsonify({'error': str(exc)}), 400
    except Exception as exc:
        a.app.logger.exception('Teamwork sync failed')
        return a.jsonify({'error': str(exc)}), 502
    return a.jsonify({'status': 'ok', 'stats': stats})


def teamwork_webhook():
    import app as a

    raw_body = a.request.get_data() or b''
    try:
        config = get_teamwork_config()
    except TeamworkConfigError as exc:
        return a.jsonify({'error': str(exc)}), 400

    query_token = a.request.args.get('token') or a.request.headers.get('X-Webhook-Token')
    if config.webhook_token:
        has_valid_signature = verify_webhook_signature(raw_body, a.request.headers, config.webhook_token)
        has_valid_query_token = query_token and query_token == config.webhook_token
        if not has_valid_signature and not has_valid_query_token:
            return a.jsonify({'error': 'Invalid Teamwork webhook signature'}), 401

    try:
        payload = a.request.get_json(silent=True)
        if payload is None and raw_body:
            payload = json.loads(raw_body.decode('utf-8'))
    except (TypeError, ValueError):
        payload = {}

    event_name = (
        a.request.headers.get('X-Projects-Event')
        or a.request.headers.get('X-Teamwork-Event')
        or a.request.headers.get('Event')
        or a.request.headers.get('X-Event')
        or ''
    )

    def _on_error(exc):
        a.app.logger.exception('Teamwork webhook processing failed: %s', exc)

    start_app_context_job(
        a.app,
        handle_webhook_payload,
        args=(payload or {}, event_name),
        on_error=_on_error,
    )
    return a.jsonify({'status': 'accepted'})


def teamwork_ignore_task():
    import app as a
    from models import CalendarEvent

    user = a.get_current_user()
    if not user:
        try:
            user = get_target_user(get_teamwork_config())
        except TeamworkConfigError:
            user = None
    if not user:
        return a.jsonify({'error': 'No user selected'}), 401

    payload = a.request.get_json(silent=True) or {}
    task_id = payload.get('task_id') or payload.get('taskId') or payload.get('external_id')
    title = payload.get('title')
    event_id = payload.get('event_id') or payload.get('eventId') or payload.get('calendar_event_id')

    if not task_id and event_id is not None:
        event = CalendarEvent.query.filter_by(
            id=event_id,
            user_id=user.id,
            external_source='teamwork',
        ).first()
        if not event or not event.external_id:
            return a.jsonify({'error': 'Teamwork calendar item not found'}), 404
        task_id = event.external_id
        title = title or event.title

    if not task_id:
        return a.jsonify({'error': 'task_id or event_id is required'}), 400

    try:
        result = ignore_teamwork_task_for_user(user.id, task_id, title=title)
    except Exception as exc:
        a.app.logger.exception('Teamwork ignore failed')
        return a.jsonify({'error': str(exc)}), 502
    return a.jsonify(result)
