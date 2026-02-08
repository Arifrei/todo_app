"""Extracted route handlers grouped by domain for readability."""

import app as _app_module

# Keep access to shared app context, models, helpers, and constants.
for _name, _value in vars(_app_module).items():
    if not _name.startswith('__'):
        globals()[_name] = _value

def api_list_notifications():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    if request.method == 'POST':
        data = request.json or {}
        title = (data.get('title') or '').strip() or 'Notification'
        body = (data.get('body') or '').strip() or None
        notif = Notification(
            user_id=user.id,
            type=(data.get('type') or 'general'),
            title=title,
            body=body,
            link=data.get('link'),
            channel=data.get('channel') or 'in_app'
        )
        db.session.add(notif)
        db.session.commit()
        if notif.channel in ('push', 'mixed'):
            _send_push_to_user(user, title, body, link=notif.link)
        return jsonify(notif.to_dict()), 201
    limit = min(int(request.args.get('limit', 50)), 200)
    items = Notification.query.filter_by(user_id=user.id).order_by(Notification.created_at.desc()).limit(limit).all()
    return jsonify([n.to_dict() for n in items])



def api_mark_notifications_read():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    now = datetime.now(pytz.UTC).replace(tzinfo=None)
    updated = Notification.query.filter_by(user_id=user.id, read_at=None).update({"read_at": now})
    db.session.commit()
    return jsonify({'updated': updated})



def api_mark_notification_read(notification_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    notif = Notification.query.filter_by(id=notification_id, user_id=user.id).first()
    if not notif:
        return jsonify({'error': 'Not found'}), 404
    notif.read_at = datetime.now(pytz.UTC).replace(tzinfo=None)
    db.session.commit()
    return jsonify(notif.to_dict())



def api_notification_settings():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    prefs = _get_or_create_notification_settings(user.id)
    if request.method == 'GET':
        return jsonify(prefs.to_dict())
    data = request.json or {}
    prefs.in_app_enabled = bool(data.get('in_app_enabled', prefs.in_app_enabled))
    prefs.email_enabled = bool(data.get('email_enabled', prefs.email_enabled))
    prefs.push_enabled = bool(data.get('push_enabled', prefs.push_enabled))
    prefs.reminders_enabled = bool(data.get('reminders_enabled', prefs.reminders_enabled))
    prefs.digest_enabled = bool(data.get('digest_enabled', prefs.digest_enabled))
    try:
        hour = int(data.get('digest_hour', prefs.digest_hour))
        if 0 <= hour <= 23:
            prefs.digest_hour = hour
    except (TypeError, ValueError):
        pass
    try:
        snooze_mins = int(data.get('default_snooze_minutes', prefs.default_snooze_minutes))
        if snooze_mins > 0:
            prefs.default_snooze_minutes = snooze_mins
    except (TypeError, ValueError):
        pass
    db.session.commit()
    return jsonify(prefs.to_dict())


