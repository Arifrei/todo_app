"""Extracted heavy route handlers from app.py."""

scheduler = None

def snooze_reminder(event_id):
    import app as a
    CalendarEvent = a.CalendarEvent
    _get_or_create_notification_settings = a._get_or_create_notification_settings
    _send_event_reminder = a._send_event_reminder
    app = a.app
    datetime = a.datetime
    db = a.db
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    pytz = a.pytz
    request = a.request
    timedelta = a.timedelta
    """Snooze a calendar event reminder."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    event = CalendarEvent.query.filter_by(id=event_id, user_id=user.id).first_or_404()

    # Get snooze duration from request or use user's default
    data = request.json or {}
    snooze_minutes = data.get('snooze_minutes')

    if snooze_minutes is None:
        # Use user's default snooze time
        prefs = _get_or_create_notification_settings(user.id)
        snooze_minutes = prefs.default_snooze_minutes

    try:
        snooze_minutes = int(snooze_minutes)
        if snooze_minutes <= 0:
            return jsonify({'error': 'Snooze minutes must be positive'}), 400
    except (TypeError, ValueError):
        return jsonify({'error': 'Invalid snooze duration'}), 400

    # Calculate snooze time (in server's local timezone)
    tz = pytz.timezone(app.config['DEFAULT_TIMEZONE'])
    now = datetime.now(tz).replace(tzinfo=None)
    snooze_until = now + timedelta(minutes=snooze_minutes)

    # Update event
    event.reminder_snoozed_until = snooze_until
    event.reminder_sent = False
    db.session.commit()

    # Schedule reminder for snooze time
    global scheduler
    scheduler = a.scheduler
    if scheduler:
        job_id = f"reminder_{event.id}_{int(snooze_until.timestamp())}"
        try:
            scheduler.add_job(
                _send_event_reminder,
                'date',
                run_date=pytz.timezone(app.config['DEFAULT_TIMEZONE']).localize(snooze_until),
                args=[event_id],
                id=job_id,
                replace_existing=True
            )
            event.reminder_job_id = job_id
            db.session.commit()
            app.logger.info(f"Snoozed reminder for event {event_id} for {snooze_minutes} minutes")
        except Exception as e:
            app.logger.error(f"Error scheduling snoozed reminder: {e}")
            return jsonify({'error': 'Failed to schedule snooze'}), 500

    return jsonify({
        'snoozed': True,
        'snooze_until': snooze_until.isoformat(),
        'snooze_minutes': snooze_minutes
    })

def get_pending_reminders():
    import app as a
    CalendarEvent = a.CalendarEvent
    app = a.app
    datetime = a.datetime
    get_current_user = a.get_current_user
    jsonify = a.jsonify
    or_ = a.or_
    pytz = a.pytz
    timedelta = a.timedelta
    """Get upcoming reminders for mobile app to schedule locally."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'No user selected'}), 401

    # Get user's timezone
    tz = pytz.timezone(app.config['DEFAULT_TIMEZONE'])
    now = datetime.now(tz)

    # Get events with reminders in the next 7 days that haven't been sent yet
    end_window = now + timedelta(days=7)

    events = CalendarEvent.query.filter(
        CalendarEvent.user_id == user.id,
        or_(CalendarEvent.reminder_sent.is_(False), CalendarEvent.reminder_sent.is_(None))
    ).all()

    pending = []
    for event in events:
        if not event.start_time:
            continue

        # Combine day and time
        event_datetime = datetime.combine(event.day, event.start_time)

        # Check if snoozed
        if event.reminder_snoozed_until:
            remind_at = event.reminder_snoozed_until
            remind_at_local = remind_at if remind_at.tzinfo else tz.localize(remind_at)
        elif event.reminder_minutes_before is not None:
            event_local = event_datetime if event_datetime.tzinfo else tz.localize(event_datetime)
            remind_at_local = event_local - timedelta(minutes=event.reminder_minutes_before)
        else:
            continue  # No reminder set

        # Only include if reminder is in the future and within our window
        if now < remind_at_local <= end_window:
            remind_at_utc = remind_at_local.astimezone(pytz.UTC)
            pending.append({
                'event_id': event.id,
                'title': event.title,
                'start_time': event.start_time.strftime('%I:%M %p'),
                'day': event.day.isoformat(),
                'remind_at': remind_at_local.replace(tzinfo=None).isoformat(),
                'remind_at_ts': int(remind_at_utc.timestamp() * 1000),
                'url': f'/calendar?day={event.day.isoformat()}'
            })

    return jsonify({'reminders': pending})
