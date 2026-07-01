from datetime import date

from backend.sms_inbox import parse_sms_text, resolve_destination


def test_sms_area_routing_resolves_line_note_and_task_targets(tmp_path, monkeypatch):
    database_path = tmp_path / 'sms-area-routing.db'
    monkeypatch.setenv('DATABASE_URL', f'sqlite:///{database_path.as_posix()}')

    import importlib
    import app as app_module

    app_module = importlib.reload(app_module)
    app_module.app.config.update(TESTING=True)
    with app_module.app.app_context():
        app_module.db.create_all()
        user = app_module.User(username='sms-area-owner', email=None)
        user.set_password('dummy')
        app_module.db.session.add(user)
        app_module.db.session.flush()

        area = app_module.Area(user_id=user.id, name='Home')
        app_module.db.session.add(area)
        app_module.db.session.flush()
        note_block = app_module.AreaBlock(
            user_id=user.id,
            area_id=area.id,
            block_type='note',
            title='Maintenance notes',
            order_index=1,
        )
        task_block = app_module.AreaBlock(
            user_id=user.id,
            area_id=area.id,
            block_type='task_list',
            title='Next actions',
            checkbox_mode=True,
            order_index=2,
        )
        list_block = app_module.AreaBlock(
            user_id=user.id,
            area_id=area.id,
            block_type='list',
            title='Supplies',
            order_index=3,
        )
        app_module.db.session.add_all([note_block, task_block, list_block])
        app_module.db.session.commit()

        parsed = parse_sms_text('Check furnace filter; area Home')
        destination, routed = resolve_destination(
            app_module,
            user,
            parsed,
            date(2026, 6, 19),
        )
        assert routed is True
        assert destination == {
            'kind': 'area_line',
            'area_id': area.id,
            'text': 'Check furnace filter',
        }

        parsed = parse_sms_text('Filter size is 20x25; area Home, Maintenance')
        destination, routed = resolve_destination(
            app_module,
            user,
            parsed,
            date(2026, 6, 19),
        )
        assert routed is True
        assert destination == {
            'kind': 'area_note',
            'block_id': note_block.id,
            'text': 'Filter size is 20x25',
        }

        parsed = parse_sms_text('Buy replacement filters; area Home, Next on tomorrow')
        destination, routed = resolve_destination(
            app_module,
            user,
            parsed,
            date(2026, 6, 19),
        )
        assert routed is True
        assert destination == {
            'kind': 'area_task',
            'block_id': task_block.id,
            'title': 'Buy replacement filters',
            'due_date': '2026-06-20',
        }

        parsed = parse_sms_text('Buy filters; area Home, Supplies')
        destination, routed = resolve_destination(
            app_module,
            user,
            parsed,
            date(2026, 6, 19),
        )
        assert routed is False
        assert destination is None
