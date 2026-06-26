import importlib


def _load_test_app(tmp_path, monkeypatch, name='areas.db'):
    database_path = tmp_path / name
    monkeypatch.setenv('DATABASE_URL', f'sqlite:///{database_path.as_posix()}')

    import app as app_module

    app_module = importlib.reload(app_module)
    app_module.app.config.update(TESTING=True)
    return app_module


def _create_user(app_module, username):
    user = app_module.User(username=username, email=None)
    user.set_password('dummy')
    app_module.db.session.add(user)
    app_module.db.session.flush()
    return user


def _login(client, user_id):
    with client.session_transaction() as session:
        session['user_id'] = user_id


def test_area_create_edit_archive_restore_and_filters(tmp_path, monkeypatch):
    app_module = _load_test_app(tmp_path, monkeypatch)

    with app_module.app.app_context():
        app_module.db.create_all()
        user = _create_user(app_module, 'area-owner')
        app_module.db.session.commit()
        user_id = user.id

    client = app_module.app.test_client()
    _login(client, user_id)

    home_response = client.get('/')
    assert home_response.status_code == 200
    assert b'href="/areas"' in home_response.data
    assert b'Areas' in home_response.data

    assert client.get('/areas').status_code == 200

    response = client.post(
        '/api/areas',
        json={
            'name': 'Health',
            'description': 'Daily care',
            'color': '#10b981',
            'icon': 'fa-solid fa-heart-pulse',
        },
    )
    assert response.status_code == 201
    area = response.get_json()
    area_id = area['id']
    assert area['name'] == 'Health'
    assert area['is_archived'] is False

    assert client.get(f'/areas/{area_id}').status_code == 200

    response = client.get('/api/areas?archived=0')
    assert response.status_code == 200
    assert [entry['id'] for entry in response.get_json()] == [area_id]

    response = client.put(
        f'/api/areas/{area_id}',
        json={
            'name': 'Wellness',
            'description': 'Maintenance routines',
            'color': '#f59e0b',
            'icon': 'fa-solid fa-seedling',
        },
    )
    assert response.status_code == 200
    edited = response.get_json()
    assert edited['name'] == 'Wellness'
    assert edited['description'] == 'Maintenance routines'

    response = client.delete(f'/api/areas/{area_id}')
    assert response.status_code == 200
    assert response.get_json()['is_archived'] is True

    assert client.get('/api/areas?archived=0').get_json() == []
    archived = client.get('/api/areas?archived=1').get_json()
    assert [entry['id'] for entry in archived] == [area_id]
    all_areas = client.get('/api/areas?archived=all').get_json()
    assert [entry['id'] for entry in all_areas] == [area_id]

    response = client.post(f'/api/areas/{area_id}/restore')
    assert response.status_code == 200
    assert response.get_json()['is_archived'] is False
    assert [entry['id'] for entry in client.get('/api/areas?archived=0').get_json()] == [area_id]


def test_area_item_create_update_status_dates_and_delete(tmp_path, monkeypatch):
    app_module = _load_test_app(tmp_path, monkeypatch, 'area-items.db')

    with app_module.app.app_context():
        app_module.db.create_all()
        user = _create_user(app_module, 'item-owner')
        area = app_module.Area(user_id=user.id, name='Home')
        app_module.db.session.add(area)
        app_module.db.session.commit()
        user_id = user.id
        area_id = area.id

    client = app_module.app.test_client()
    _login(client, user_id)

    response = client.post(f'/api/areas/{area_id}/items', json={'text': 'Fix sink'})
    assert response.status_code == 201
    item = response.get_json()
    item_id = item['id']
    assert item['text'] == 'Fix sink'
    assert item['status'] == 'open'
    assert item['details'] is None

    response = client.put(
        f'/api/area-items/{item_id}',
        json={
            'details': 'Buy washer first',
            'scheduled_date': '2026-07-02',
            'status': 'done',
        },
    )
    assert response.status_code == 200
    updated = response.get_json()
    assert updated['details'] == 'Buy washer first'
    assert updated['scheduled_date'] == '2026-07-02'
    assert updated['status'] == 'done'
    assert updated['completed_at']

    response = client.put(f'/api/area-items/{item_id}', json={'status': 'open'})
    assert response.status_code == 200
    reopened = response.get_json()
    assert reopened['status'] == 'open'
    assert reopened['completed_at'] is None

    response = client.put(
        f'/api/area-items/{item_id}',
        json={'status': 'later', 'scheduled_date': None},
    )
    assert response.status_code == 200
    later = response.get_json()
    assert later['status'] == 'later'
    assert later['scheduled_date'] is None

    response = client.get(f'/api/areas/{area_id}/items?status=later')
    assert response.status_code == 200
    assert [entry['id'] for entry in response.get_json()] == [item_id]

    response = client.delete(f'/api/area-items/{item_id}')
    assert response.status_code == 204
    assert client.get(f'/api/areas/{area_id}/items').get_json() == []


def test_area_workspace_sections_blocks_and_rows(tmp_path, monkeypatch):
    app_module = _load_test_app(tmp_path, monkeypatch, 'area-workspace.db')

    with app_module.app.app_context():
        app_module.db.create_all()
        user = _create_user(app_module, 'workspace-owner')
        app_module.db.session.commit()
        user_id = user.id

    client = app_module.app.test_client()
    _login(client, user_id)

    response = client.post('/api/areas', json={'name': 'Business research'})
    assert response.status_code == 201
    area_id = response.get_json()['id']

    workspace = client.get(f'/api/areas/{area_id}/workspace').get_json()
    assert workspace['area']['section_count'] == 3
    assert [section['title'] for section in workspace['sections']] == ['Focus', 'Notes', 'Lists']
    focus_id = workspace['sections'][0]['id']

    response = client.post(
        f'/api/areas/{area_id}/sections',
        json={'title': 'Pipeline', 'description': 'Ideas moving toward action'},
    )
    assert response.status_code == 201
    custom_section_id = response.get_json()['id']

    response = client.post(
        f'/api/areas/{area_id}/blocks',
        json={
            'block_type': 'line',
            'section_id': focus_id,
            'content': 'Explore Google Workspace flows',
        },
    )
    assert response.status_code == 201
    line_block = response.get_json()
    assert line_block['block_type'] == 'line'
    assert line_block['content'] == 'Explore Google Workspace flows'

    response = client.post(
        f'/api/areas/{area_id}/blocks',
        json={
            'block_type': 'note',
            'section_id': custom_section_id,
            'title': 'Client research pattern',
            'content': 'Capture sources, open questions, and next experiments.',
        },
    )
    assert response.status_code == 201
    note_block = response.get_json()
    assert note_block['title'] == 'Client research pattern'
    assert note_block['source_note_id'] is None
    assert note_block['content'] == 'Capture sources, open questions, and next experiments.'
    assert client.get(f'/areas/{area_id}/blocks/{note_block["id"]}').status_code == 200
    fetched_note = client.get(f'/api/area-blocks/{note_block["id"]}').get_json()
    assert fetched_note['id'] == note_block['id']
    assert fetched_note['block_type'] == 'note'

    response = client.put(
        f'/api/area-blocks/{note_block["id"]}',
        json={'title': 'Client research system', 'content': '<p>Keep this note inside the area.</p>'},
    )
    assert response.status_code == 200
    edited_note_block = response.get_json()
    assert edited_note_block['title'] == 'Client research system'
    assert edited_note_block['content'] == '<p>Keep this note inside the area.</p>'

    response = client.post(
        f'/api/areas/{area_id}/blocks',
        json={'block_type': 'list', 'section_id': custom_section_id, 'title': 'Sources'},
    )
    assert response.status_code == 201
    list_block = response.get_json()
    list_block_id = list_block['id']
    assert list_block['source_note_id'] is None
    assert client.get(f'/areas/{area_id}/blocks/{list_block_id}').status_code == 200

    response = client.post(f'/api/area-blocks/{list_block_id}/items', json={'item_type': 'section', 'text': 'Market scans'})
    assert response.status_code == 201
    assert response.get_json()['item_type'] == 'section'

    response = client.post(f'/api/area-blocks/{list_block_id}/items', json={'item_type': 'subsection', 'text': 'Launch channels'})
    assert response.status_code == 201
    assert response.get_json()['item_type'] == 'subsection'

    response = client.post(
        f'/api/area-blocks/{list_block_id}/items',
        json={'item_type': 'linked_note', 'linked_block_id': note_block['id']},
    )
    assert response.status_code == 201
    linked_note_item = response.get_json()
    assert linked_note_item['item_type'] == 'linked_note'
    assert linked_note_item['linked_block_id'] == note_block['id']
    assert linked_note_item['linked_block_type'] == 'note'

    response = client.post(f'/api/area-blocks/{list_block_id}/items', json={'item_type': 'item', 'text': 'Product Hunt'})
    assert response.status_code == 201
    list_item = response.get_json()
    list_item_id = list_item['id']
    assert list_item['item_type'] == 'item'

    response = client.put(
        f'/api/area-block-items/{list_item_id}',
        json={'checked': True, 'inner_note': '<p>Check pricing and positioning.</p>'},
    )
    assert response.status_code == 200
    checked_item = response.get_json()
    assert checked_item['checked'] is True
    assert checked_item['status'] == 'done'
    assert checked_item['completed_at']
    assert checked_item['inner_note'] == '<p>Check pricing and positioning.</p>'

    response = client.post(
        f'/api/areas/{area_id}/blocks',
        json={'block_type': 'task_list', 'section_id': focus_id, 'title': 'Next actions'},
    )
    assert response.status_code == 201
    task_block = response.get_json()
    task_block_id = task_block['id']
    assert task_block['item_count'] == 0
    assert client.get(f'/areas/{area_id}/blocks/{task_block_id}').status_code == 200

    response = client.post(
        f'/api/area-blocks/{list_block_id}/items',
        json={'item_type': 'linked_list', 'linked_block_id': task_block_id},
    )
    assert response.status_code == 201
    linked_list_item = response.get_json()
    assert linked_list_item['item_type'] == 'linked_list'
    assert linked_list_item['linked_block_id'] == task_block_id
    assert linked_list_item['linked_block_type'] == 'task_list'

    with app_module.app.app_context():
        assert app_module.Note.query.count() == 0
        assert app_module.TodoList.query.count() == 0

    response = client.post(f'/api/area-blocks/{task_block_id}/items', json={'text': 'Compare transcription tools'})
    assert response.status_code == 201
    task_item_id = response.get_json()['id']

    response = client.put(
        f'/api/area-block-items/{task_item_id}',
        json={
            'details': 'Use the research note as context',
            'scheduled_date': '2026-07-03',
            'status': 'done',
        },
    )
    assert response.status_code == 200
    task_item = response.get_json()
    assert task_item['details'] == 'Use the research note as context'
    assert task_item['scheduled_date'] == '2026-07-03'
    assert task_item['status'] == 'done'
    assert task_item['completed_at']

    response = client.put(f'/api/area-block-items/{task_item_id}', json={'status': 'open'})
    assert response.status_code == 200
    reopened = response.get_json()
    assert reopened['status'] == 'open'
    assert reopened['completed_at'] is None

    workspace = client.get(f'/api/areas/{area_id}/workspace').get_json()
    assert workspace['area']['block_count'] == 4
    assert len(workspace['blocks']) == 4
    assert any(block['block_type'] == 'task_list' and block['items'][0]['id'] == task_item_id for block in workspace['blocks'])
    source_block = next(block for block in workspace['blocks'] if block['id'] == list_block_id)
    assert any(item['item_type'] == 'section' for item in source_block['items'])
    assert any(item['item_type'] == 'linked_note' and item['linked_block_id'] == note_block['id'] for item in source_block['items'])

    response = client.delete(f'/api/area-block-items/{task_item_id}')
    assert response.status_code == 204
    assert client.get(f'/api/area-blocks/{task_block_id}/items').get_json() == []

    response = client.delete(f'/api/area-blocks/{line_block["id"]}')
    assert response.status_code == 204
    workspace = client.get(f'/api/areas/{area_id}/workspace').get_json()
    assert all(block['id'] != line_block['id'] for block in workspace['blocks'])


def test_area_blocks_reorder_within_one_type(tmp_path, monkeypatch):
    app_module = _load_test_app(tmp_path, monkeypatch, 'area-block-reorder.db')

    with app_module.app.app_context():
        app_module.db.create_all()
        user = _create_user(app_module, 'area-reorder-owner')
        app_module.db.session.commit()
        user_id = user.id

    client = app_module.app.test_client()
    _login(client, user_id)

    response = client.post('/api/areas', json={'name': 'Operations'})
    area_id = response.get_json()['id']
    sections = client.get(f'/api/areas/{area_id}/sections').get_json()
    focus_id = sections[0]['id']
    notes_id = sections[1]['id']

    first = client.post(
        f'/api/areas/{area_id}/blocks',
        json={'block_type': 'line', 'section_id': focus_id, 'content': 'First'},
    ).get_json()
    second = client.post(
        f'/api/areas/{area_id}/blocks',
        json={'block_type': 'line', 'section_id': focus_id, 'content': 'Second'},
    ).get_json()
    other_section = client.post(
        f'/api/areas/{area_id}/blocks',
        json={'block_type': 'line', 'section_id': notes_id, 'content': 'Other section'},
    ).get_json()

    response = client.post(
        f'/api/areas/{area_id}/blocks/reorder',
        json={'ids': [other_section['id'], second['id'], first['id']]},
    )
    assert response.status_code == 200

    reordered = client.get(f'/api/areas/{area_id}/blocks?type=line').get_json()
    assert [block['id'] for block in reordered] == [other_section['id'], second['id'], first['id']]

    reordered = client.get(f'/api/areas/{area_id}/blocks?type=line&section_id={focus_id}').get_json()
    assert [block['id'] for block in reordered] == [second['id'], first['id']]

    response = client.post(
        f'/api/areas/{area_id}/blocks/reorder',
        json={'ids': [second['id'], other_section['id']]},
    )
    assert response.status_code == 400


def test_area_can_be_saved_to_quick_access(tmp_path, monkeypatch):
    app_module = _load_test_app(tmp_path, monkeypatch, 'area-quick-access.db')

    with app_module.app.app_context():
        app_module.db.create_all()
        user = _create_user(app_module, 'area-quick-owner')
        app_module.db.session.commit()
        user_id = user.id

    client = app_module.app.test_client()
    _login(client, user_id)

    area = client.post('/api/areas', json={'name': 'Health'}).get_json()
    response = client.post(
        '/api/quick-access',
        json={
            'title': area['name'],
            'icon': 'fa-solid fa-layer-group',
            'url': f'/areas/{area["id"]}',
            'item_type': 'area',
            'reference_id': area['id'],
        },
    )
    assert response.status_code == 201
    shortcut = response.get_json()
    assert shortcut['item_type'] == 'area'
    assert shortcut['reference_id'] == area['id']

    shortcuts = client.get('/api/quick-access').get_json()
    assert any(item['item_type'] == 'area' and item['reference_id'] == area['id'] for item in shortcuts)


def test_area_list_and_task_blocks_use_full_editor_compatibility_apis(tmp_path, monkeypatch):
    app_module = _load_test_app(tmp_path, monkeypatch, 'area-editor-compat.db')

    with app_module.app.app_context():
        app_module.db.create_all()
        user = _create_user(app_module, 'editor-compat-owner')
        area = app_module.Area(user_id=user.id, name='Research')
        app_module.db.session.add(area)
        app_module.db.session.flush()
        list_block = app_module.AreaBlock(
            user_id=user.id,
            area_id=area.id,
            block_type='list',
            title='Research index',
        )
        task_block = app_module.AreaBlock(
            user_id=user.id,
            area_id=area.id,
            block_type='task_list',
            title='Light tasks',
            checkbox_mode=True,
        )
        app_module.db.session.add_all([list_block, task_block])
        app_module.db.session.commit()
        user_id = user.id
        area_id = area.id
        list_block_id = list_block.id
        task_block_id = task_block.id

    client = app_module.app.test_client()
    _login(client, user_id)

    list_page = client.get(f'/areas/{area_id}/blocks/{list_block_id}')
    assert list_page.status_code == 200
    assert b'id="list-editor-page"' in list_page.data
    assert b'AREA_LIST_CONTEXT' in list_page.data
    assert b'area-editor-area-bubble' in list_page.data
    assert b'Research' in list_page.data

    response = client.get(f'/api/area-list-blocks/{list_block_id}')
    assert response.status_code == 200
    list_payload = response.get_json()
    assert list_payload['note_type'] == 'list'
    assert list_payload['title'] == 'Research index'

    response = client.put(
        f'/api/area-list-blocks/{list_block_id}',
        json={'title': 'Research operating list', 'checkbox_mode': True, 'list_mode': 'revolving'},
    )
    assert response.status_code == 200
    updated_list = response.get_json()
    assert updated_list['checkbox_mode'] is True
    assert updated_list['list_mode'] == 'revolving'

    response = client.post(
        f'/api/area-list-blocks/{list_block_id}/list-items',
        json={'text': '[[section]] Sources'},
    )
    assert response.status_code == 201
    section_item = response.get_json()
    assert section_item['text'] == '[[section]] Sources'

    response = client.post(
        f'/api/area-list-blocks/{list_block_id}/list-items',
        json={'text': '[[subsection]] Primary'},
    )
    assert response.status_code == 201
    subsection_item = response.get_json()
    assert subsection_item['text'] == '[[subsection]] Primary'

    response = client.post(
        f'/api/area-list-blocks/{list_block_id}/list-items',
        json={
            'text': 'Read market scan',
            'note': 'Short note',
            'inner_note': '<p>Rich detail</p>',
            'scheduled_date': '2026-07-05',
        },
    )
    assert response.status_code == 201
    list_item = response.get_json()
    assert list_item['note'] == 'Short note'
    assert list_item['inner_note'] == '<p>Rich detail</p>'
    assert list_item['scheduled_date'] == '2026-07-05'

    response = client.put(
        f'/api/area-list-blocks/{list_block_id}/list-items/{list_item["id"]}',
        json={'checked': True},
    )
    assert response.status_code == 200
    assert response.get_json()['deleted'] is True

    remaining = client.get(f'/api/area-list-blocks/{list_block_id}/list-items').get_json()
    assert [item['text'] for item in remaining] == ['[[section]] Sources', '[[subsection]] Primary']

    response = client.delete(f'/api/area-list-blocks/{list_block_id}/list-items/{section_item["id"]}')
    assert response.status_code == 200
    promoted = client.get(f'/api/area-list-blocks/{list_block_id}/list-items').get_json()
    assert promoted[0]['text'] == '[[section]] Primary'

    task_page = client.get(f'/areas/{area_id}/blocks/{task_block_id}')
    assert task_page.status_code == 200
    assert b'light-list-view' in task_page.data
    assert b'AREA_TASK_CONTEXT' in task_page.data
    assert b'area-editor-area-bubble' in task_page.data
    assert b'Research' in task_page.data

    response = client.post(
        f'/api/area-task-blocks/{task_block_id}/items',
        json={'content': 'Compare tools', 'description': 'Use criteria', 'notes': 'Keep it short'},
    )
    assert response.status_code == 201
    task_item = response.get_json()
    assert task_item['content'] == 'Compare tools'
    assert task_item['status'] == 'not_started'
    assert task_item['description'] == 'Use criteria'

    response = client.put(
        f'/api/area-task-items/{task_item["id"]}',
        json={'status': 'in_progress', 'due_date': '2026-07-06'},
    )
    assert response.status_code == 200
    started = response.get_json()
    assert started['status'] == 'in_progress'
    assert started['due_date'] == '2026-07-06'

    response = client.post(
        f'/api/areas/{area_id}/blocks',
        json={'block_type': 'note', 'title': 'Task context', 'content': '<p>Area-owned context.</p>'},
    )
    assert response.status_code == 201
    linked_note_block = response.get_json()
    response = client.put(
        f'/api/area-task-items/{task_item["id"]}',
        json={'linked_block_id': linked_note_block['id']},
    )
    assert response.status_code == 200
    linked_task = response.get_json()
    assert linked_task['linked_notes'][0]['id'] == linked_note_block['id']
    assert linked_task['linked_notes'][0]['title'] == 'Task context'

    task_page_with_link = client.get(f'/areas/{area_id}/blocks/{task_block_id}')
    assert task_page_with_link.status_code == 200
    assert f'/areas/{area_id}/blocks/{linked_note_block["id"]}'.encode() in task_page_with_link.data

    response = client.post(
        f'/api/area-task-blocks/{task_block_id}/bulk_import',
        json={'outline': '- [ ] Draft memo\n- [x] Send recap'},
    )
    assert response.status_code == 201
    imported = response.get_json()
    assert [item['content'] for item in imported] == ['Draft memo', 'Send recap']
    assert imported[1]['status'] == 'done'

    all_tasks = client.get(f'/api/area-task-blocks/{task_block_id}/items').get_json()
    reversed_ids = [item['id'] for item in reversed(all_tasks)]
    response = client.post(f'/api/area-task-blocks/{task_block_id}/reorder', json={'ids': reversed_ids})
    assert response.status_code == 200
    reordered = client.get(f'/api/area-task-blocks/{task_block_id}/items').get_json()
    assert [item['id'] for item in reordered] == reversed_ids

    response = client.post(
        '/api/area-task-items/bulk',
        json={'action': 'status', 'status': 'done', 'ids': [task_item['id']], 'list_id': task_block_id},
    )
    assert response.status_code == 200
    done_task = client.get(f'/api/area-task-blocks/{task_block_id}/items').get_json()
    assert next(item for item in done_task if item['id'] == task_item['id'])['status'] == 'done'

    response = client.post(
        '/api/area-task-items/bulk',
        json={'action': 'delete', 'ids': [task_item['id']], 'list_id': task_block_id},
    )
    assert response.status_code == 200
    assert all(item['id'] != task_item['id'] for item in client.get(f'/api/area-task-blocks/{task_block_id}/items').get_json())

    with app_module.app.app_context():
        assert app_module.Note.query.count() == 0
        assert app_module.TodoList.query.count() == 0


def test_area_blocks_move_to_other_area_notes_and_tasks(tmp_path, monkeypatch):
    app_module = _load_test_app(tmp_path, monkeypatch, 'area-block-moves.db')

    with app_module.app.app_context():
        app_module.db.create_all()
        user = _create_user(app_module, 'area-move-owner')
        first_area = app_module.Area(user_id=user.id, name='Research')
        second_area = app_module.Area(user_id=user.id, name='Operations')
        folder = app_module.NoteFolder(user_id=user.id, name='Moved notes')
        app_module.db.session.add_all([first_area, second_area, folder])
        app_module.db.session.flush()
        line_block = app_module.AreaBlock(
            user_id=user.id,
            area_id=first_area.id,
            block_type='line',
            content='Move this line',
        )
        list_block = app_module.AreaBlock(
            user_id=user.id,
            area_id=first_area.id,
            block_type='list',
            title='Research list',
            checkbox_mode=True,
        )
        task_block = app_module.AreaBlock(
            user_id=user.id,
            area_id=first_area.id,
            block_type='task_list',
            title='Area tasks',
            checkbox_mode=True,
        )
        app_module.db.session.add_all([line_block, list_block, task_block])
        app_module.db.session.flush()
        app_module.db.session.add_all(
            [
                app_module.AreaBlockItem(
                    user_id=user.id,
                    area_id=first_area.id,
                    block_id=list_block.id,
                    item_type='section',
                    text='Sources',
                    order_index=1,
                ),
                app_module.AreaBlockItem(
                    user_id=user.id,
                    area_id=first_area.id,
                    block_id=list_block.id,
                    item_type='item',
                    text='Read scan',
                    note='Inline note',
                    checked=True,
                    order_index=2,
                ),
                app_module.AreaBlockItem(
                    user_id=user.id,
                    area_id=first_area.id,
                    block_id=task_block.id,
                    item_type='item',
                    text='Draft recap',
                    status='done',
                    order_index=1,
                ),
            ]
        )
        app_module.db.session.commit()
        user_id = user.id
        second_area_id = second_area.id
        folder_id = folder.id
        line_block_id = line_block.id
        list_block_id = list_block.id
        task_block_id = task_block.id

    client = app_module.app.test_client()
    _login(client, user_id)

    response = client.post(
        f'/api/area-blocks/{line_block_id}/move',
        json={'target': 'area', 'area_id': second_area_id},
    )
    assert response.status_code == 200
    moved_line = response.get_json()['block']
    assert moved_line['area_id'] == second_area_id

    response = client.post(
        f'/api/area-blocks/{list_block_id}/move',
        json={'target': 'notes', 'folder_id': folder_id},
    )
    assert response.status_code == 201
    moved_note = response.get_json()['note']
    assert moved_note['note_type'] == 'list'
    assert moved_note['folder_id'] == folder_id

    response = client.post(f'/api/area-blocks/{task_block_id}/move', json={'target': 'tasks'})
    assert response.status_code == 201
    moved_list = response.get_json()['list']
    assert moved_list['type'] == 'light'
    assert moved_list['title'] == 'Area tasks'

    with app_module.app.app_context():
        assert app_module.AreaBlock.query.filter_by(id=list_block_id).first() is None
        assert app_module.AreaBlock.query.filter_by(id=task_block_id).first() is None
        note = app_module.db.session.get(app_module.Note, moved_note['id'])
        assert note is not None
        assert note.folder_id == folder_id
        assert [item.text for item in note.list_items] == ['[[section]] Sources', 'Read scan']
        assert note.list_items[1].checked is True
        todo_list = app_module.db.session.get(app_module.TodoList, moved_list['id'])
        assert todo_list is not None
        assert todo_list.type == 'light'
        assert [item.content for item in todo_list.items] == ['Draft recap']
        assert todo_list.items[0].status == 'done'


def test_area_routes_enforce_user_ownership(tmp_path, monkeypatch):
    app_module = _load_test_app(tmp_path, monkeypatch, 'area-ownership.db')

    with app_module.app.app_context():
        app_module.db.create_all()
        first_user = _create_user(app_module, 'first-area-owner')
        second_user = _create_user(app_module, 'second-area-owner')
        first_area = app_module.Area(user_id=first_user.id, name='First')
        second_area = app_module.Area(user_id=second_user.id, name='Second')
        app_module.db.session.add_all([first_area, second_area])
        app_module.db.session.flush()
        second_item = app_module.AreaItem(
            user_id=second_user.id,
            area_id=second_area.id,
            text='Private item',
        )
        second_section = app_module.AreaSection(
            user_id=second_user.id,
            area_id=second_area.id,
            title='Private section',
        )
        app_module.db.session.add_all([second_item, second_section])
        app_module.db.session.flush()
        second_block = app_module.AreaBlock(
            user_id=second_user.id,
            area_id=second_area.id,
            section_id=second_section.id,
            block_type='task_list',
            title='Private tasks',
        )
        app_module.db.session.add(second_block)
        app_module.db.session.flush()
        second_block_item = app_module.AreaBlockItem(
            user_id=second_user.id,
            area_id=second_area.id,
            block_id=second_block.id,
            text='Private task',
        )
        app_module.db.session.add(second_block_item)
        app_module.db.session.commit()
        first_user_id = first_user.id
        first_area_id = first_area.id
        second_area_id = second_area.id
        second_item_id = second_item.id
        second_section_id = second_section.id
        second_block_id = second_block.id
        second_block_item_id = second_block_item.id

    client = app_module.app.test_client()
    _login(client, first_user_id)

    response = client.get('/api/areas')
    assert response.status_code == 200
    assert [entry['id'] for entry in response.get_json()] == [first_area_id]

    assert client.get(f'/api/areas/{second_area_id}').status_code == 404
    assert client.get(f'/api/areas/{second_area_id}/workspace').status_code == 404
    assert client.get(f'/api/areas/{second_area_id}/items').status_code == 404
    assert client.get(f'/areas/{second_area_id}/blocks/{second_block_id}').status_code == 404
    assert client.get(f'/api/area-blocks/{second_block_id}').status_code == 404
    assert client.get(f'/api/area-task-blocks/{second_block_id}').status_code == 404
    assert client.get(f'/api/area-task-blocks/{second_block_id}/items').status_code == 404
    assert client.put(
        f'/api/area-items/{second_item_id}',
        json={'status': 'done'},
    ).status_code == 404
    assert client.delete(f'/api/area-items/{second_item_id}').status_code == 404
    assert client.put(
        f'/api/area-sections/{second_section_id}',
        json={'title': 'Edited'},
    ).status_code == 404
    assert client.put(
        f'/api/area-blocks/{second_block_id}',
        json={'title': 'Edited'},
    ).status_code == 404
    assert client.put(
        f'/api/area-block-items/{second_block_item_id}',
        json={'status': 'done'},
    ).status_code == 404
    assert client.put(
        f'/api/area-task-items/{second_block_item_id}',
        json={'status': 'done'},
    ).status_code == 404

    with app_module.app.app_context():
        assert app_module.db.session.get(app_module.Area, first_area_id) is not None
        assert app_module.db.session.get(app_module.Area, second_area_id) is not None
        assert app_module.db.session.get(app_module.AreaItem, second_item_id) is not None
        assert app_module.db.session.get(app_module.AreaSection, second_section_id) is not None
        assert app_module.db.session.get(app_module.AreaBlock, second_block_id) is not None
        assert app_module.db.session.get(app_module.AreaBlockItem, second_block_item_id) is not None
