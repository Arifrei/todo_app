import importlib
from datetime import UTC, datetime, timedelta


def test_completed_tasks_are_retained_by_legacy_cleanup_hook(tmp_path, monkeypatch):
    database_path = tmp_path / 'task-retention.db'
    monkeypatch.setenv('DATABASE_URL', f'sqlite:///{database_path.as_posix()}')
    monkeypatch.setenv('BOOTSTRAP_JOBS_ON_IMPORT', '0')

    import app as app_module
    import backend.app_core_logic as app_core_logic

    app_module = importlib.reload(app_module)
    app_core_logic = importlib.reload(app_core_logic)
    app_module.app.config.update(TESTING=True)

    with app_module.app.app_context():
        app_module.db.create_all()
        user = app_module.User(username='task-retention-owner', email=None)
        user.set_password('dummy')
        app_module.db.session.add(user)
        app_module.db.session.flush()
        task_list = app_module.TodoList(title='Tasks', user_id=user.id)
        task = app_module.TodoItem(
            content='Retain completed task',
            status='done',
            completed_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=30),
            list=task_list,
        )
        app_module.db.session.add_all([task_list, task])
        app_module.db.session.commit()
        task_id = task.id

        app_core_logic._cleanup_completed_tasks()

        retained = app_module.db.session.get(app_module.TodoItem, task_id)
        assert retained is not None
        assert retained.status == 'done'
