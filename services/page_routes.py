"""Extracted route handlers grouped by domain for readability."""

import app as _app_module

# Keep access to shared app context, models, helpers, and constants.
for _name, _value in vars(_app_module).items():
    if not _name.startswith('__'):
        globals()[_name] = _value

def index():
    # If no user selected, redirect to user selection
    if not get_current_user():
        return redirect(url_for('select_user'))

    user = get_current_user()
    module_order = _load_homepage_order(user)
    return render_template('home.html', module_order=module_order)



def tasks_page():
    """Main tasks/hubs dashboard."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('index.html')



def download_app():
    """Serve the Android APK for download."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    downloads_dir = os.path.join(app.root_path, 'downloads')
    apk_candidates = [
        filename for filename in os.listdir(downloads_dir)
        if filename.lower().endswith('.apk')
        and os.path.isfile(os.path.join(downloads_dir, filename))
    ]
    if not apk_candidates:
        return "APK not found. Please build and upload the app first.", 404
    # Pick the newest APK by modification time.
    apk_filename = max(
        apk_candidates,
        key=lambda filename: os.path.getmtime(os.path.join(downloads_dir, filename))
    )
    apk_path = os.path.join(downloads_dir, apk_filename)

    if os.path.exists(apk_path):
        return send_from_directory(downloads_dir, apk_filename,
                                   as_attachment=True,
                                   download_name=apk_filename,
                                   mimetype='application/vnd.android.package-archive')
    else:
        return "APK not found. Please build and upload the app first.", 404



def notes_page():
    """Dedicated notes workspace with list-only view."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    note_id = request.args.get('note') or request.args.get('note_id')
    if note_id and str(note_id).isdigit():
        return redirect(url_for('note_editor_page', note_id=int(note_id)))
    return render_template('notes.html', current_folder=None)



def vault_page():
    user = get_current_user()
    if not user:
        return redirect(url_for('select_user'))
    return render_template('vault.html')



def new_note_page():
    """New note editor page."""
    user = get_current_user()
    if not user:
        return redirect(url_for('select_user'))
    return render_template('note_editor.html', note_id=None, body_class='notes-editor-page')



def note_editor_page(note_id):
    """Editor page for a single note/list."""
    user = get_current_user()
    if not user:
        return redirect(url_for('select_user'))
    note = Note.query.filter_by(id=note_id, user_id=user.id).first_or_404()
    if note.note_type == 'list':
        return render_template('list_editor.html', note_id=note_id)
    return render_template('note_editor.html', note_id=note_id, body_class='notes-editor-page')



def notes_folder_page(folder_id):
    """Notes list scoped to a folder."""
    user = get_current_user()
    if not user:
        return redirect(url_for('select_user'))
    folder = NoteFolder.query.filter_by(id=folder_id, user_id=user.id).first_or_404()
    return render_template('notes.html', current_folder=folder)



def recalls_page():
    """Recall inbox/workspace for links, ideas, and sources."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('recalls.html')



def ai_page():
    """AI assistant full page."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('ai.html')



def transcribe_audio():
    """Transcribe audio to text using OpenAI Whisper API."""
    if not get_current_user():
        return jsonify({'error': 'Unauthorized'}), 401

    file = request.files.get('audio')
    if not file:
        return jsonify({'error': 'Missing audio file'}), 400

    # Pull key from config or environment (fallback reload .env if needed)
    api_key = app.config.get('OPENAI_API_KEY') or os.environ.get('OPENAI_API_KEY')
    if not api_key:
        if DOTENV_PATH and os.path.exists(DOTENV_PATH):
            load_dotenv(DOTENV_PATH)
        api_key = os.environ.get('OPENAI_API_KEY')
    model = app.config.get('OPENAI_STT_MODEL', 'whisper-1')
    if not api_key:
        return jsonify({'error': 'Speech-to-text API key not configured'}), 500

    try:
        files = {
            'file': (file.filename or 'audio.webm', file.stream, file.mimetype or 'audio/webm')
        }
        data = {
            'model': model,
            'response_format': 'json',
            'temperature': 0
        }
        headers = {
            'Authorization': f'Bearer {api_key}'
        }
        resp = requests.post(
            'https://api.openai.com/v1/audio/transcriptions',
            headers=headers,
            data=data,
            files=files,
            timeout=60
        )
        if resp.status_code != 200:
            return jsonify({'error': 'STT request failed', 'details': resp.text}), 502
        text = resp.json().get('text', '')
        return jsonify({'text': text})
    except requests.RequestException as e:
        return jsonify({'error': 'STT service unreachable', 'details': str(e)}), 502
    except Exception as e:
        return jsonify({'error': 'STT failed', 'details': str(e)}), 500



def settings_page():
    """Settings page (notification preferences placeholder)."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('settings.html')



def service_worker():
    """Serve service worker at root scope."""
    return send_from_directory('static', 'service-worker.js', mimetype='application/javascript')


def calendar_page():
    """Calendar day-first UI."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template(
        'calendar.html',
        default_timezone=app.config.get('DEFAULT_TIMEZONE'),
        item_note_max_chars=CALENDAR_ITEM_NOTE_MAX_CHARS
    )


def quick_access_page():
    """Quick access shortcuts page."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('quick_access.html')



def bookmarks_page():
    """Bookmarks module page."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('bookmarks.html')


def planner_page():
    """Planner module was removed; redirect to Notes."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return redirect('/notes')


def planner_folder_page(folder_id):
    """Planner module was removed; redirect to Notes."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return redirect('/notes')


def feed_page():
    """Everfeed module page."""
    if not get_current_user():
        return redirect(url_for('select_user'))
    return render_template('feed.html')


def list_view(list_id):
    user = get_current_user()
    if not user:
        return redirect(url_for('select_user'))
    todo_list = TodoList.query.filter_by(id=list_id, user_id=user.id).first_or_404()
    canonicalize_phase_flags(todo_list, commit_callback=db.session.commit)

    # Find parent if exists (if this list is linked by an item)
    parent_item = TodoItem.query.filter_by(linked_list_id=list_id).first()
    parent_list = parent_item.list if parent_item else None

    # Backfill phase_id if not set, but preserve order_index for display
    current_phase = None
    for item in todo_list.items:
        if is_phase_header(item):
            current_phase = item
        else:
            # Backfill phase_id if not set
            if current_phase and not item.phase_id:
                item.phase_id = current_phase.id

    # Commit any backfilled phase_id values
    db.session.commit()

    blocked_ids = set()
    blocked_items = []
    if todo_list.type == 'list':
        for item in todo_list.items:
            if is_phase_header(item):
                continue
            deps = item.dependencies if hasattr(item, 'dependencies') else []
            if deps and any(dep.status != 'done' for dep in deps):
                blocked_ids.add(item.id)
        if blocked_ids:
            blocked_items = [i for i in todo_list.items if i.id in blocked_ids]

    # Use items in their order_index order (no re-sorting by completion status)
    return render_template(
        'list_view.html',
        todo_list=todo_list,
        parent_list=parent_list,
        items=todo_list.items,
        blocked_ids=blocked_ids,
        blocked_items=blocked_items,
        default_timezone=app.config.get('DEFAULT_TIMEZONE')
    )

# API Routes

