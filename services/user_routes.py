"""User/session and preference routes extracted from app.py for readability."""


def select_user():
    import app as a

    User = a.User
    render_template = a.render_template

    users = User.query.all()
    return render_template('select_user.html', users=users)


def logout_user():
    import app as a

    redirect = a.redirect
    session = a.session
    url_for = a.url_for

    session.pop('user_id', None)
    return redirect(url_for('select_user'))


def set_user(user_id):
    import app as a

    User = a.User
    db = a.db
    jsonify = a.jsonify
    re = a.re
    request = a.request
    session = a.session

    data = request.get_json(silent=True) or {}
    pin = str(data.get('pin', '')).strip()

    if not re.fullmatch(r'\d{4}', pin):
        return jsonify({'error': 'A 4-digit PIN is required'}), 400

    user = db.get_or_404(User, user_id)
    pin_created = False
    pin_hash_val = str(user.pin_hash or '').strip()
    has_pin = bool(pin_hash_val and pin_hash_val.lower() not in ['none', 'null'])

    if not has_pin:
        try:
            user.set_pin(pin)
            db.session.commit()
            pin_created = True
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
    else:
        if not user.check_pin(pin):
            return jsonify({'error': 'Invalid PIN'}), 401

    session['user_id'] = user.id
    session.permanent = True
    return jsonify({'success': True, 'username': user.username, 'user_id': user.id, 'pin_created': pin_created})


def create_user():
    import app as a

    User = a.User
    db = a.db
    jsonify = a.jsonify
    re = a.re
    request = a.request
    session = a.session

    data = request.get_json(silent=True) or {}
    username = data.get('username', '').strip()
    pin = str(data.get('pin', '')).strip()

    if not username:
        return jsonify({'error': 'Username is required'}), 400

    if not re.fullmatch(r'\d{4}', pin):
        return jsonify({'error': 'PIN must be exactly 4 digits'}), 400

    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already exists'}), 400

    user = User(username=username, email=None)
    user.set_password('dummy')
    try:
        user.set_pin(pin)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    db.session.add(user)
    db.session.commit()

    session['user_id'] = user.id
    session.permanent = True

    return jsonify({'success': True, 'user_id': user.id, 'username': user.username})


def current_user_info():
    import app as a

    get_current_user = a.get_current_user
    jsonify = a.jsonify

    user = get_current_user()
    if user:
        return jsonify({'user_id': user.id, 'username': user.username})
    return jsonify({'user_id': None, 'username': None})


def user_profile():
    import app as a

    User = a.User
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    request = a.request

    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    if request.method == 'GET':
        return jsonify({'user_id': user.id, 'username': user.username})

    data = request.get_json(silent=True) or {}
    current_pin = str(data.get('current_pin') or '').strip()
    if not current_pin:
        return jsonify({'error': 'Current PIN is required'}), 400
    if not user.check_pin(current_pin):
        return jsonify({'error': 'Invalid PIN'}), 403

    new_username = (data.get('username') or '').strip()
    new_pin = (data.get('new_pin') or '').strip()
    confirm_pin = (data.get('confirm_pin') or '').strip()

    if new_username and new_username != user.username:
        if User.query.filter(User.username == new_username, User.id != user.id).first():
            return jsonify({'error': 'Username already exists'}), 400
        user.username = new_username

    if new_pin or confirm_pin:
        if new_pin != confirm_pin:
            return jsonify({'error': 'PINs do not match'}), 400
        try:
            user.set_pin(new_pin)
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

    db.session.commit()
    return jsonify({'success': True, 'username': user.username})


def sidebar_order():
    import app as a

    _load_sidebar_order = a._load_sidebar_order
    _sanitize_sidebar_order = a._sanitize_sidebar_order
    _save_sidebar_order = a._save_sidebar_order
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    request = a.request

    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    if request.method == 'GET':
        order = _load_sidebar_order(user)
        return jsonify({'order': order})

    data = request.get_json(silent=True)
    order = data if isinstance(data, list) else (data or {}).get('order')
    if not isinstance(order, list):
        return jsonify({'error': 'Order must be a list'}), 400

    final_order = _sanitize_sidebar_order(order)
    _save_sidebar_order(user, final_order)
    db.session.commit()
    return jsonify({'success': True, 'order': final_order})


def homepage_order():
    import app as a

    _load_homepage_order = a._load_homepage_order
    _sanitize_homepage_order = a._sanitize_homepage_order
    _save_homepage_order = a._save_homepage_order
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    request = a.request

    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    if request.method == 'GET':
        order = _load_homepage_order(user)
        return jsonify({'order': order})

    data = request.get_json(silent=True)
    order = data if isinstance(data, list) else (data or {}).get('order')
    if not isinstance(order, list):
        return jsonify({'error': 'Order must be a list'}), 400

    final_order = _sanitize_homepage_order(order)
    _save_homepage_order(user, final_order)
    db.session.commit()
    return jsonify({'success': True, 'order': final_order})
