import importlib
from datetime import date


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


def test_area_library_items_are_scoped(tmp_path, monkeypatch):
    app_module = _load_test_app(tmp_path, monkeypatch, 'area-library.db')

    with app_module.app.app_context():
        app_module.db.create_all()
        user = _create_user(app_module, 'area-library-owner')
        first_area = app_module.Area(user_id=user.id, name='Client A')
        second_area = app_module.Area(user_id=user.id, name='Client B')
        app_module.db.session.add_all([first_area, second_area])
        app_module.db.session.flush()
        app_module.db.session.add_all([
            app_module.RecallItem(
                user_id=user.id,
                title='Global recall',
                payload_type='text',
                payload='global',
                area_id=None,
            ),
            app_module.RecallItem(
                user_id=user.id,
                title='Area recall',
                payload_type='text',
                payload='area',
                area_id=first_area.id,
            ),
        ])
        app_module.db.session.commit()
        user_id = user.id
        first_area_id = first_area.id
        second_area_id = second_area.id

    client = app_module.app.test_client()
    _login(client, user_id)

    global_bookmark = client.post(
        '/api/bookmarks',
        json={'title': 'Global bookmark', 'value': 'https://global.example'},
    ).get_json()
    area_bookmark = client.post(
        f'/api/areas/{first_area_id}/bookmarks',
        json={'title': 'Area bookmark', 'value': 'https://area.example'},
    ).get_json()

    assert [item['id'] for item in client.get('/api/bookmarks').get_json()] == [global_bookmark['id']]
    assert [item['id'] for item in client.get(f'/api/areas/{first_area_id}/bookmarks').get_json()] == [area_bookmark['id']]
    assert client.get(f'/api/areas/{second_area_id}/bookmarks').get_json() == []
    assert client.get(f'/api/bookmarks/{area_bookmark["id"]}').status_code == 404
    assert client.get(f'/api/areas/{first_area_id}/bookmarks/{global_bookmark["id"]}').status_code == 404

    assert [item['title'] for item in client.get('/api/recalls').get_json()] == ['Global recall']
    assert [item['title'] for item in client.get(f'/api/areas/{first_area_id}/recalls').get_json()] == ['Area recall']
    assert client.get(f'/api/areas/{second_area_id}/recalls').get_json() == []

    global_folder = client.post('/api/vault/folders', json={'name': 'Global files'}).get_json()
    area_folder = client.post(f'/api/areas/{first_area_id}/vault/folders', json={'name': 'Area files'}).get_json()

    assert [item['id'] for item in client.get('/api/vault/folders').get_json()] == [global_folder['id']]
    assert [item['id'] for item in client.get(f'/api/areas/{first_area_id}/vault/folders').get_json()] == [area_folder['id']]
    assert client.get(f'/api/areas/{second_area_id}/vault/folders').get_json() == []
    assert client.get(f'/api/vault/folders/{area_folder["id"]}').status_code == 404
    assert client.get(f'/api/areas/{first_area_id}/vault/folders/{global_folder["id"]}').status_code == 404



def test_area_folders_create_assign_move_and_delete(tmp_path, monkeypatch):
    app_module = _load_test_app(tmp_path, monkeypatch, 'area-folders.db')

    with app_module.app.app_context():
        app_module.db.create_all()
        user = _create_user(app_module, 'area-folder-owner')
        other_user = _create_user(app_module, 'other-area-owner')
        other_folder = app_module.AreaFolder(user_id=other_user.id, name='Other folder')
        app_module.db.session.add(other_folder)
        app_module.db.session.commit()
        user_id = user.id
        other_folder_id = other_folder.id

    client = app_module.app.test_client()
    _login(client, user_id)

    response = client.post('/api/area-folders', json={'name': 'Work'})
    assert response.status_code == 201
    folder = response.get_json()
    folder_id = folder['id']
    assert folder['name'] == 'Work'

    root_response = client.post('/api/areas', json={'name': 'Home'})
    assert root_response.status_code == 201
    root_area = root_response.get_json()
    assert root_area['folder_id'] is None

    folder_response = client.post('/api/areas', json={'name': 'Client work', 'folder_id': folder_id})
    assert folder_response.status_code == 201
    folder_area = folder_response.get_json()
    assert folder_area['folder_id'] == folder_id

    root_areas = client.get('/api/areas?folder_id=root').get_json()
    assert [entry['id'] for entry in root_areas] == [root_area['id']]

    folder_areas = client.get(f'/api/areas?folder_id={folder_id}').get_json()
    assert [entry['id'] for entry in folder_areas] == [folder_area['id']]

    response = client.put(f'/api/areas/{root_area["id"]}', json={'folder_id': folder_id})
    assert response.status_code == 200
    moved_area = response.get_json()
    assert moved_area['folder_id'] == folder_id
    assert client.get('/api/areas?folder_id=root').get_json() == []
    assert [entry['id'] for entry in client.get(f'/api/areas?folder_id={folder_id}').get_json()] == [folder_area['id'], root_area['id']]

    response = client.put(f'/api/areas/{root_area["id"]}', json={'folder_id': None})
    assert response.status_code == 200
    assert response.get_json()['folder_id'] is None

    response = client.put(f'/api/areas/{root_area["id"]}', json={'folder_id': other_folder_id})
    assert response.status_code == 400
    assert response.get_json()['error'] == 'Folder not found'

    response = client.delete(f'/api/area-folders/{folder_id}')
    assert response.status_code == 200
    assert response.get_json()['deleted'] is True
    assert client.get('/api/area-folders').get_json() == []
    root_areas = client.get('/api/areas?folder_id=root').get_json()
    assert sorted(entry['id'] for entry in root_areas) == sorted([root_area['id'], folder_area['id']])

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
    assert workspace['area']['section_count'] == 4
    sections_by_type = {section['block_type']: section for section in workspace['sections']}
    assert set(sections_by_type) == {'line', 'note', 'list', 'task_list'}
    assert all(section['title'] == 'Untitled list' for section in sections_by_type.values())
    line_section_id = sections_by_type['line']['id']
    task_section_id = sections_by_type['task_list']['id']

    response = client.get(f'/api/areas/{area_id}/sections?block_type=note')
    assert response.status_code == 200
    assert [section['block_type'] for section in response.get_json()] == ['note']

    response = client.post(
        f'/api/areas/{area_id}/sections',
        json={'block_type': 'note', 'title': 'Pipeline', 'description': 'Ideas moving toward action'},
    )
    assert response.status_code == 201
    note_section_id = response.get_json()['id']

    response = client.post(
        f'/api/areas/{area_id}/sections',
        json={'block_type': 'list', 'title': 'Sources', 'description': 'Reference lists'},
    )
    assert response.status_code == 201
    list_section_id = response.get_json()['id']

    response = client.post(
        f'/api/areas/{area_id}/blocks',
        json={
            'block_type': 'line',
            'section_id': line_section_id,
            'content': 'Explore Google Workspace flows',
        },
    )
    assert response.status_code == 201
    line_block = response.get_json()
    assert line_block['block_type'] == 'line'
    assert line_block['content'] == 'Explore Google Workspace flows'

    response = client.post(
        f'/api/areas/{area_id}/sections',
        json={'block_type': 'line', 'title': 'Later lines'},
    )
    assert response.status_code == 201
    later_line_section_id = response.get_json()['id']

    response = client.put(
        f'/api/area-blocks/{line_block["id"]}',
        json={'section_id': later_line_section_id},
    )
    assert response.status_code == 200
    assert response.get_json()['section_id'] == later_line_section_id

    response = client.put(
        f'/api/area-blocks/{line_block["id"]}',
        json={'section_id': None},
    )
    assert response.status_code == 200
    fallback_line_section_id = response.get_json()['section_id']
    assert fallback_line_section_id is not None
    assert fallback_line_section_id in {line_section_id, later_line_section_id}

    response = client.post(
        f'/api/areas/{area_id}/blocks',
        json={
            'block_type': 'note',
            'section_id': line_section_id,
            'title': 'Wrong section',
        },
    )
    assert response.status_code == 400
    assert response.get_json()['error'] == 'Section does not match this item type'

    response = client.post(
        f'/api/areas/{area_id}/blocks',
        json={
            'block_type': 'note',
            'section_id': note_section_id,
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
        json={'block_type': 'list', 'section_id': list_section_id, 'title': 'Sources'},
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
        json={'block_type': 'task_list', 'section_id': task_section_id, 'title': 'Next actions'},
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


def test_area_sections_can_be_hidden_and_restored(tmp_path, monkeypatch):
    app_module = _load_test_app(tmp_path, monkeypatch, 'area-hidden-sections.db')

    with app_module.app.app_context():
        app_module.db.create_all()
        user = _create_user(app_module, 'area-section-hider')
        app_module.db.session.commit()
        user_id = user.id

    client = app_module.app.test_client()
    _login(client, user_id)

    response = client.post('/api/areas', json={'name': 'Seasonal focus'})
    assert response.status_code == 201
    area_id = response.get_json()['id']

    sections = client.get(f'/api/areas/{area_id}/sections?block_type=line').get_json()
    line_section_id = sections[0]['id']
    line_block = client.post(
        f'/api/areas/{area_id}/blocks',
        json={'block_type': 'line', 'section_id': line_section_id, 'content': 'Pause this initiative'},
    ).get_json()

    response = client.put(f'/api/area-sections/{line_section_id}', json={'hidden': True})
    assert response.status_code == 200
    hidden_section = response.get_json()
    assert hidden_section['is_hidden'] is True
    assert hidden_section['hidden_at']

    hidden_sections = client.get(f'/api/areas/{area_id}/sections?block_type=line&hidden=1').get_json()
    assert [section['id'] for section in hidden_sections] == [line_section_id]
    visible_sections = client.get(f'/api/areas/{area_id}/sections?block_type=line&hidden=0').get_json()
    assert visible_sections == []

    workspace = client.get(f'/api/areas/{area_id}/workspace').get_json()
    stored_section = next(section for section in workspace['sections'] if section['id'] == line_section_id)
    stored_block = next(block for block in workspace['blocks'] if block['id'] == line_block['id'])
    assert stored_section['is_hidden'] is True
    assert stored_block['section_id'] == line_section_id

    response = client.post(
        f'/api/areas/{area_id}/blocks',
        json={'block_type': 'line', 'content': 'A visible follow-up'},
    )
    assert response.status_code == 201
    visible_block = response.get_json()
    assert visible_block['section_id'] != line_section_id

    visible_sections = client.get(f'/api/areas/{area_id}/sections?block_type=line&hidden=0').get_json()
    assert [section['id'] for section in visible_sections] == [visible_block['section_id']]

    response = client.put(f'/api/area-sections/{line_section_id}', json={'is_hidden': False})
    assert response.status_code == 200
    restored_section = response.get_json()
    assert restored_section['is_hidden'] is False
    assert restored_section['hidden_at'] is None


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
    sections = client.get(f'/api/areas/{area_id}/sections?block_type=line').get_json()
    focus_id = sections[0]['id']
    response = client.post(
        f'/api/areas/{area_id}/sections',
        json={'block_type': 'line', 'title': 'Later'},
    )
    assert response.status_code == 201
    later_id = response.get_json()['id']

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
        json={'block_type': 'line', 'section_id': later_id, 'content': 'Other section'},
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
        line_to_section_block = app_module.AreaBlock(
            user_id=user.id,
            area_id=first_area.id,
            block_type='line',
            content='Route to section',
        )
        line_to_subsection_block = app_module.AreaBlock(
            user_id=user.id,
            area_id=first_area.id,
            block_type='line',
            content='Route to subsection',
        )
        line_to_area_task_block = app_module.AreaBlock(
            user_id=user.id,
            area_id=first_area.id,
            block_type='line',
            content='Make an area task',
        )
        line_to_light_task_block = app_module.AreaBlock(
            user_id=user.id,
            area_id=first_area.id,
            block_type='line',
            content='Make a light task',
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
        light_list = app_module.TodoList(
            user_id=user.id,
            title='Quick tasks',
            type='light',
        )
        app_module.db.session.add_all([
            line_block,
            line_to_section_block,
            line_to_subsection_block,
            line_to_area_task_block,
            line_to_light_task_block,
            list_block,
            task_block,
            light_list,
        ])
        app_module.db.session.flush()
        section_item = app_module.AreaBlockItem(
            user_id=user.id,
            area_id=first_area.id,
            block_id=list_block.id,
            item_type='section',
            text='Sources',
            order_index=1,
        )
        subsection_item = app_module.AreaBlockItem(
            user_id=user.id,
            area_id=first_area.id,
            block_id=list_block.id,
            item_type='subsection',
            text='APIs',
            order_index=2,
        )
        read_item = app_module.AreaBlockItem(
            user_id=user.id,
            area_id=first_area.id,
            block_id=list_block.id,
            item_type='item',
            text='Read scan',
            note='Inline note',
            checked=True,
            order_index=3,
        )
        task_item = app_module.AreaBlockItem(
            user_id=user.id,
            area_id=first_area.id,
            block_id=task_block.id,
            item_type='item',
            text='Draft recap',
            status='done',
            order_index=1,
        )
        app_module.db.session.add_all([section_item, subsection_item, read_item, task_item])
        app_module.db.session.commit()
        user_id = user.id
        second_area_id = second_area.id
        folder_id = folder.id
        line_block_id = line_block.id
        line_to_section_block_id = line_to_section_block.id
        line_to_subsection_block_id = line_to_subsection_block.id
        line_to_area_task_block_id = line_to_area_task_block.id
        line_to_light_task_block_id = line_to_light_task_block.id
        list_block_id = list_block.id
        task_block_id = task_block.id
        light_list_id = light_list.id
        section_item_id = section_item.id
        subsection_item_id = subsection_item.id

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
        f'/api/area-blocks/{line_to_section_block_id}/move',
        json={
            'target': 'area_list',
            'destination_block_id': list_block_id,
            'section_item_id': section_item_id,
        },
    )
    assert response.status_code == 201
    moved_section_item = response.get_json()['item']
    assert moved_section_item['text'] == 'Route to section'

    response = client.post(
        f'/api/area-blocks/{line_to_subsection_block_id}/move',
        json={
            'target': 'area_list',
            'destination_block_id': list_block_id,
            'section_item_id': section_item_id,
            'subsection_item_id': subsection_item_id,
        },
    )
    assert response.status_code == 201
    moved_subsection_item = response.get_json()['item']
    assert moved_subsection_item['text'] == 'Route to subsection'
    routed_items = response.get_json()['block']['items']
    assert [item['text'] for item in routed_items] == [
        'Sources',
        'Route to section',
        'APIs',
        'Read scan',
        'Route to subsection',
    ]

    response = client.post(
        f'/api/area-blocks/{line_to_area_task_block_id}/move',
        json={'target': 'area_task_list', 'destination_block_id': task_block_id},
    )
    assert response.status_code == 201
    moved_area_task = response.get_json()['item']
    assert moved_area_task['text'] == 'Make an area task'
    assert response.get_json()['block']['block_type'] == 'task_list'

    response = client.post(
        f'/api/area-blocks/{line_to_light_task_block_id}/move',
        json={'target': 'light_task_list', 'destination_list_id': light_list_id},
    )
    assert response.status_code == 201
    moved_light_task = response.get_json()['item']
    assert moved_light_task['content'] == 'Make a light task'

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
        assert app_module.AreaBlock.query.filter_by(id=line_to_section_block_id).first() is None
        assert app_module.AreaBlock.query.filter_by(id=line_to_subsection_block_id).first() is None
        assert app_module.AreaBlock.query.filter_by(id=line_to_area_task_block_id).first() is None
        assert app_module.AreaBlock.query.filter_by(id=line_to_light_task_block_id).first() is None
        assert app_module.AreaBlock.query.filter_by(id=list_block_id).first() is None
        assert app_module.AreaBlock.query.filter_by(id=task_block_id).first() is None
        note = app_module.db.session.get(app_module.Note, moved_note['id'])
        assert note is not None
        assert note.folder_id == folder_id
        assert [item.text for item in note.list_items] == [
            '[[section]] Sources',
            'Route to section',
            '[[subsection]] APIs',
            'Read scan',
            'Route to subsection',
        ]
        assert note.list_items[3].checked is True
        quick_list = app_module.db.session.get(app_module.TodoList, light_list_id)
        assert quick_list is not None
        assert quick_list.type == 'light'
        assert [item.content for item in quick_list.items] == ['Make a light task']
        todo_list = app_module.db.session.get(app_module.TodoList, moved_list['id'])
        assert todo_list is not None
        assert todo_list.type == 'light'
        assert [item.content for item in todo_list.items] == ['Draft recap', 'Make an area task']
        assert todo_list.items[0].status == 'done'


def test_notes_and_note_lists_move_into_area_blocks(tmp_path, monkeypatch):
    app_module = _load_test_app(tmp_path, monkeypatch, 'notes-to-area.db')

    with app_module.app.app_context():
        app_module.db.create_all()
        user = _create_user(app_module, 'notes-to-area-owner')
        area = app_module.Area(user_id=user.id, name='Home')
        note = app_module.Note(
            user_id=user.id,
            title='Paint notes',
            content='<p>Use eggshell finish.</p>',
            note_type='note',
        )
        note_list = app_module.Note(
            user_id=user.id,
            title='Supply list',
            note_type='list',
            checkbox_mode=True,
            list_mode='revolving',
        )
        app_module.db.session.add_all([area, note, note_list])
        app_module.db.session.flush()
        app_module.db.session.add_all([
            app_module.NoteListItem(note_id=note_list.id, text='[[section]] Store', order_index=1),
            app_module.NoteListItem(
                note_id=note_list.id,
                text='Brushes',
                note='Buy angled brush',
                inner_note='<p>Two inch.</p>',
                scheduled_date=date(2026, 7, 1),
                checked=True,
                order_index=2,
            ),
        ])
        app_module.db.session.commit()
        user_id = user.id
        area_id = area.id
        note_id = note.id
        note_list_id = note_list.id

    client = app_module.app.test_client()
    _login(client, user_id)

    response = client.post(
        '/api/notes/move',
        json={'ids': [note_id, note_list_id], 'target': 'area', 'area_id': area_id},
    )
    assert response.status_code == 201
    payload = response.get_json()
    assert payload['moved'] == 2

    with app_module.app.app_context():
        assert app_module.db.session.get(app_module.Note, note_id) is None
        assert app_module.db.session.get(app_module.Note, note_list_id) is None
        blocks = app_module.AreaBlock.query.filter_by(area_id=area_id).order_by(
            app_module.AreaBlock.order_index.asc()
        ).all()
        assert [block.block_type for block in blocks] == ['note', 'list']
        assert blocks[0].title == 'Paint notes'
        assert blocks[0].content == '<p>Use eggshell finish.</p>'
        assert blocks[1].title == 'Supply list'
        assert blocks[1].checkbox_mode is True
        assert blocks[1].list_mode == 'revolving'
        assert [(item.item_type, item.text, item.checked) for item in blocks[1].items] == [
            ('section', 'Store', False),
            ('item', 'Brushes', True),
        ]
        assert blocks[1].items[1].note == 'Buy angled brush'
        assert blocks[1].items[1].inner_note == '<p>Two inch.</p>'
        assert blocks[1].items[1].scheduled_date == date(2026, 7, 1)


def test_task_list_moves_into_area_task_block(tmp_path, monkeypatch):
    app_module = _load_test_app(tmp_path, monkeypatch, 'task-list-to-area.db')

    with app_module.app.app_context():
        app_module.db.create_all()
        user = _create_user(app_module, 'tasks-to-area-owner')
        area = app_module.Area(user_id=user.id, name='Operations')
        task_list = app_module.TodoList(user_id=user.id, title='Launch tasks', type='list')
        app_module.db.session.add_all([area, task_list])
        app_module.db.session.flush()
        phase = app_module.TodoItem(
            list_id=task_list.id,
            content='Prep',
            is_phase=True,
            status='not_started',
            order_index=1,
        )
        done_task = app_module.TodoItem(
            list_id=task_list.id,
            content='Draft brief',
            description='One page',
            notes='Include risks',
            status='done',
            phase=phase,
            due_date=date(2026, 7, 2),
            order_index=2,
        )
        open_task = app_module.TodoItem(
            list_id=task_list.id,
            content='Review budget',
            status='not_started',
            order_index=3,
        )
        app_module.db.session.add_all([phase, done_task, open_task])
        app_module.db.session.commit()
        user_id = user.id
        area_id = area.id
        list_id = task_list.id

    client = app_module.app.test_client()
    _login(client, user_id)

    response = client.post(
        f'/api/lists/{list_id}/move',
        json={'target': 'area', 'area_id': area_id},
    )
    assert response.status_code == 201
    block = response.get_json()['block']
    assert block['block_type'] == 'task_list'
    assert block['title'] == 'Launch tasks'

    with app_module.app.app_context():
        assert app_module.db.session.get(app_module.TodoList, list_id) is None
        area_block = app_module.AreaBlock.query.filter_by(area_id=area_id, block_type='task_list').first()
        assert area_block is not None
        assert [item.text for item in area_block.items] == ['Draft brief', 'Review budget']
        assert area_block.items[0].details == 'Phase: Prep\n\nOne page'
        assert area_block.items[0].note == 'Include risks'
        assert area_block.items[0].status == 'done'
        assert area_block.items[0].checked is True
        assert area_block.items[0].scheduled_date == date(2026, 7, 2)
        assert area_block.items[1].status == 'open'


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
            block_type='task_list',
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
