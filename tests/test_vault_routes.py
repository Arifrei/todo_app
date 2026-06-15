import importlib


def _load_test_app(tmp_path, monkeypatch):
    database_path = tmp_path / 'vault.db'
    vault_path = tmp_path / 'vault-files'
    monkeypatch.setenv('DATABASE_URL', f'sqlite:///{database_path.as_posix()}')

    import app as app_module
    import backend.app_core_logic as app_core_logic
    import services.bulk_extra_routes as bulk_extra_routes
    import services.inline_routes as inline_routes
    import services.vault_extra_routes as vault_extra_routes
    import services.vault_routes as vault_routes

    app_module = importlib.reload(app_module)
    importlib.reload(app_core_logic)
    importlib.reload(vault_routes)
    importlib.reload(vault_extra_routes)
    importlib.reload(bulk_extra_routes)
    importlib.reload(inline_routes)

    app_module.app.config.update(TESTING=True)

    def vault_root_for_user(user_id):
        return str(vault_path / str(user_id))

    monkeypatch.setattr(app_module, '_vault_root_for_user', vault_root_for_user)
    monkeypatch.setattr(vault_extra_routes, '_vault_root_for_user', vault_root_for_user)
    monkeypatch.setattr(bulk_extra_routes, '_vault_root_for_user', vault_root_for_user)
    return app_module, vault_path


def _create_user(app_module, username):
    user = app_module.User(username=username, email=None)
    user.set_password('dummy')
    app_module.db.session.add(user)
    app_module.db.session.flush()
    return user


def _login(client, user_id):
    with client.session_transaction() as session:
        session['user_id'] = user_id


def test_vault_permanent_delete_uses_user_storage_and_preview_is_inert(tmp_path, monkeypatch):
    app_module, vault_path = _load_test_app(tmp_path, monkeypatch)

    with app_module.app.app_context():
        app_module.db.create_all()
        user = _create_user(app_module, 'vault-owner')
        app_module.db.session.commit()
        user_id = user.id

        user_vault = vault_path / str(user_id)
        user_vault.mkdir(parents=True)
        single_path = user_vault / 'single.txt'
        bulk_path = user_vault / 'bulk.txt'
        preview_path = user_vault / 'preview.html'
        single_path.write_text('single', encoding='utf-8')
        bulk_path.write_text('bulk', encoding='utf-8')
        preview_path.write_text('<script>alert(1)</script>', encoding='utf-8')

        single = app_module.Document(
            user_id=user_id,
            title='Single',
            original_filename='single.txt',
            stored_filename=single_path.name,
            file_type='text/plain',
            file_extension='txt',
            file_size=single_path.stat().st_size,
        )
        bulk = app_module.Document(
            user_id=user_id,
            title='Bulk',
            original_filename='bulk.txt',
            stored_filename=bulk_path.name,
            file_type='text/plain',
            file_extension='txt',
            file_size=bulk_path.stat().st_size,
        )
        preview = app_module.Document(
            user_id=user_id,
            title='Preview',
            original_filename='preview.html',
            stored_filename=preview_path.name,
            file_type='text/html',
            file_extension='html',
            file_size=preview_path.stat().st_size,
        )
        app_module.db.session.add_all([single, bulk, preview])
        app_module.db.session.commit()
        single_id = single.id
        bulk_id = bulk.id
        preview_id = preview.id

    client = app_module.app.test_client()
    _login(client, user_id)

    response = client.get(f'/api/vault/documents/{preview_id}/preview')
    assert response.status_code == 200
    assert response.mimetype == 'text/plain'
    assert response.headers['X-Content-Type-Options'] == 'nosniff'
    assert response.headers['Content-Security-Policy'] == "sandbox; default-src 'none'"

    assert client.delete(
        f'/api/vault/documents/{single_id}?permanent=true'
    ).status_code == 204
    assert not single_path.exists()

    response = client.post(
        '/api/vault/documents/bulk',
        json={'ids': [bulk_id], 'action': 'delete'},
    )
    assert response.status_code == 200
    assert response.get_json()['deleted'] == 1
    assert not bulk_path.exists()

    with app_module.app.app_context():
        assert app_module.db.session.get(app_module.Document, single_id) is None
        assert app_module.db.session.get(app_module.Document, bulk_id) is None
        assert app_module.db.session.get(app_module.Document, preview_id) is not None


def test_vault_folder_move_restore_and_recursive_delete(tmp_path, monkeypatch):
    app_module, vault_path = _load_test_app(tmp_path, monkeypatch)

    with app_module.app.app_context():
        app_module.db.create_all()
        user = _create_user(app_module, 'vault-folder-owner')
        app_module.db.session.flush()
        root = app_module.DocumentFolder(user_id=user.id, name='Root')
        app_module.db.session.add(root)
        app_module.db.session.flush()
        child = app_module.DocumentFolder(user_id=user.id, parent_id=root.id, name='Child')
        app_module.db.session.add(child)
        app_module.db.session.flush()

        user_vault = vault_path / str(user.id)
        user_vault.mkdir(parents=True)
        stored_path = user_vault / 'nested.txt'
        stored_path.write_text('nested', encoding='utf-8')
        document = app_module.Document(
            user_id=user.id,
            folder_id=child.id,
            title='Nested',
            original_filename='nested.txt',
            stored_filename=stored_path.name,
            file_type='text/plain',
            file_extension='txt',
            file_size=stored_path.stat().st_size,
        )
        app_module.db.session.add(document)
        app_module.db.session.commit()
        user_id = user.id
        root_id = root.id
        child_id = child.id
        document_id = document.id

    client = app_module.app.test_client()
    _login(client, user_id)

    response = client.put(
        f'/api/vault/folders/{root_id}',
        json={'parent_id': child_id},
    )
    assert response.status_code == 400
    assert 'children' in response.get_json()['error']

    assert client.delete(f'/api/vault/folders/{root_id}').status_code == 200
    with app_module.app.app_context():
        assert app_module.db.session.get(app_module.DocumentFolder, root_id).archived_at
        assert app_module.db.session.get(app_module.DocumentFolder, child_id).archived_at
        assert app_module.db.session.get(app_module.Document, document_id).archived_at

    response = client.put(
        f'/api/vault/folders/{root_id}',
        json={'archived': False},
    )
    assert response.status_code == 200
    with app_module.app.app_context():
        assert app_module.db.session.get(app_module.DocumentFolder, root_id).archived_at is None
        assert app_module.db.session.get(app_module.DocumentFolder, child_id).archived_at is None
        assert app_module.db.session.get(app_module.Document, document_id).archived_at is None

    assert client.delete(
        f'/api/vault/folders/{root_id}?permanent=true'
    ).status_code == 204
    assert not stored_path.exists()
    with app_module.app.app_context():
        assert app_module.db.session.get(app_module.DocumentFolder, root_id) is None
        assert app_module.db.session.get(app_module.DocumentFolder, child_id) is None
        assert app_module.db.session.get(app_module.Document, document_id) is None
