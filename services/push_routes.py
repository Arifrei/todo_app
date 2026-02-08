"""Push subscription routes extracted from app.py for readability."""


def api_push_subscribe():
    import app as a

    PushSubscription = a.PushSubscription
    _get_or_create_notification_settings = a._get_or_create_notification_settings
    app = a.app
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    request = a.request

    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    data = request.get_json(silent=True) or {}
    sub = data.get('subscription') or {}
    endpoint = sub.get('endpoint')
    keys = sub.get('keys') or {}
    p256dh = keys.get('p256dh')
    auth = keys.get('auth')
    if not endpoint or not p256dh or not auth:
        app.logger.warning("Push subscribe missing fields: endpoint=%s p256dh=%s auth=%s", bool(endpoint), bool(p256dh), bool(auth))
        return jsonify({'error': 'Invalid subscription'}), 400
    app.logger.info("Push subscribe for user %s endpoint %s", user.id, endpoint)

    PushSubscription.query.filter_by(user_id=user.id).delete()
    db.session.commit()
    db.session.add(PushSubscription(user_id=user.id, endpoint=endpoint, p256dh=p256dh, auth=auth))
    db.session.commit()

    prefs = _get_or_create_notification_settings(user.id)
    prefs.push_enabled = True
    db.session.commit()
    return jsonify({'status': 'subscribed'})


def api_push_unsubscribe():
    import app as a

    PushSubscription = a.PushSubscription
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    request = a.request

    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    data = request.get_json(silent=True) or {}
    endpoint = data.get('endpoint')
    if not endpoint:
        return jsonify({'error': 'endpoint required'}), 400
    PushSubscription.query.filter_by(endpoint=endpoint, user_id=user.id).delete()
    db.session.commit()
    return jsonify({'status': 'unsubscribed'})


def api_push_list():
    import app as a

    PushSubscription = a.PushSubscription
    get_current_user = a.get_current_user
    jsonify = a.jsonify

    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    subs = PushSubscription.query.filter_by(user_id=user.id).all()
    return jsonify([s.to_dict() for s in subs])


def api_push_clear():
    import app as a

    PushSubscription = a.PushSubscription
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify

    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    deleted = PushSubscription.query.filter_by(user_id=user.id).delete()
    db.session.commit()
    return jsonify({'deleted': deleted})


def api_push_test():
    import app as a

    _send_push_to_user = a._send_push_to_user
    get_current_user = a.get_current_user
    jsonify = a.jsonify

    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    title = 'Test push'
    body = 'This is a test push notification.'
    sent = _send_push_to_user(user, title, body, link='/')
    return jsonify({'sent': sent})
