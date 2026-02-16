"""Extracted route handlers grouped by domain for readability."""

import app as _app_module

# Keep access to shared app context, models, helpers, and constants.
for _name, _value in vars(_app_module).items():
    if not _name.startswith('__'):
        globals()[_name] = _value

def list_recurring_events():
    """List all recurring event templates for the current user."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    rules = RecurringEvent.query.filter_by(user_id=user.id).order_by(RecurringEvent.title).all()
    result = []
    for r in rules:
        result.append({
            'id': r.id,
            'title': r.title,
            'description': r.description,
            'start_day': r.start_day.isoformat() if r.start_day else None,
            'end_day': r.end_day.isoformat() if r.end_day else None,
            'start_time': r.start_time.strftime('%I:%M %p') if r.start_time else None,
            'end_time': r.end_time.strftime('%I:%M %p') if r.end_time else None,
            'priority': r.priority,
            'is_event': r.is_event,
            'reminder_minutes_before': r.reminder_minutes_before,
            'rollover_enabled': r.rollover_enabled,
            'frequency': r.frequency,
            'interval': r.interval,
            'interval_unit': r.interval_unit,
            'days_of_week': [int(d) for d in r.days_of_week.split(',')] if r.days_of_week else [],
            'day_of_month': r.day_of_month,
            'month_of_year': r.month_of_year,
            'week_of_month': r.week_of_month,
            'weekday_of_month': r.weekday_of_month
        })
    return jsonify(result)



def reorder_calendar_events():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    data = request.json or {}
    ids = data.get('ids') or []
    day_obj = parse_day_value(data.get('day') or _now_local().date().isoformat())
    if not ids or not isinstance(ids, list):
        return jsonify({'error': 'ids array required'}), 400
    if not day_obj:
        return jsonify({'error': 'Invalid day'}), 400

    items = CalendarEvent.query.filter(
        CalendarEvent.user_id == user.id,
        CalendarEvent.id.in_(ids),
        CalendarEvent.day == day_obj
    ).all()
    position = 1
    for eid in ids:
        try:
            eid_int = int(eid)
        except (TypeError, ValueError):
            continue
        item = next((i for i in items if i.id == eid_int), None)
        if item:
            item.order_index = position
            position += 1
    db.session.commit()
    return jsonify({'updated': position - 1})



def manual_rollover():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    app.logger.info(f"Manual rollover triggered by user {user.id}")
    _rollover_incomplete_events()
    app.logger.info("Manual rollover completed")
    return jsonify({'status': 'ok'})



def send_digest_now():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401
    day_obj = parse_day_value(request.json.get('day') if request.json else None) or _now_local().date()
    stats = _send_daily_email_digest(target_day=day_obj) or {}
    payload = {'status': 'sent', 'day': day_obj.isoformat()}
    payload.update(stats)
    return jsonify(payload)



def dismiss_reminder(event_id):
    """Dismiss a calendar event reminder (mark as sent, no more notifications)."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    event = CalendarEvent.query.filter_by(id=event_id, user_id=user.id).first_or_404()

    # Mark as sent (dismissed)
    event.reminder_sent = True
    event.reminder_snoozed_until = None

    # Cancel any scheduled jobs
    _cancel_reminder_job(event)

    db.session.commit()

    return jsonify({'dismissed': True})


