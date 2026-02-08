import threading


def start_daemon_thread(target, args=(), kwargs=None):
    """Start a daemon thread with a consistent helper API."""
    thread = threading.Thread(target=target, args=args, kwargs=kwargs or {}, daemon=True)
    thread.start()
    return thread


def start_app_context_job(app, target, args=(), kwargs=None, on_error=None):
    """
    Run a callable in a daemon thread inside the provided Flask app context.
    """

    def _run():
        with app.app_context():
            try:
                target(*args, **(kwargs or {}))
            except Exception as exc:
                if on_error:
                    on_error(exc)

    return start_daemon_thread(_run)
