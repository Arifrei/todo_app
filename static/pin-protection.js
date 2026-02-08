// --- PIN Protection Functions ---

if (typeof window.pinState === 'undefined') {
    window.pinState = {
        hasPin: false,
        hasNotesPin: false,
        settingNotesPin: false,
        pendingNoteId: null,
        pendingFolderId: null,
        pendingAction: null
    };
}

async function checkPinStatus() {
    try {
        const res = await fetch('/api/pin');
        if (!res.ok) return;
        const data = await res.json();
        pinState.hasPin = data.has_pin;
    } catch (e) {
        console.error('Error checking PIN status:', e);
    }
}

async function checkNotesPinStatus() {
    try {
        const res = await fetch('/api/notes-pin/status');
        if (!res.ok) return;
        const data = await res.json();
        pinState.hasNotesPin = data.has_notes_pin;
    } catch (e) {
        console.error('Error checking notes PIN status:', e);
    }
}

async function verifyPin(pin) {
    const noteId = pinState.pendingNoteId;
    const folderId = pinState.pendingFolderId;
    const pendingAction = pinState.pendingAction;

    // Handle folder-related actions
    if (folderId && (pendingAction === 'unlock_folder' || pendingAction === 'unprotect_folder' || pendingAction === 'delete_folder' || pendingAction === 'archive_folder' || pendingAction === 'restore_folder')) {
        return await verifyFolderPin(pin, folderId, pendingAction);
    }

    if (!noteId) {
        showToast('No note selected', 'error', 2000);
        return false;
    }

    try {
        // Handle unprotect action - send PIN with the unprotect request
        if (pendingAction === 'unprotect') {
            const res = await fetch(`/api/notes/${noteId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin, is_pin_protected: false })
            });

            if (res.ok) {
                closePinModal();
                pinState.pendingNoteId = null;
                pinState.pendingAction = null;
                showToast('Protection removed', 'success', 2000);
                await loadNotesUnified();
                return true;
            } else {
                const data = await res.json();
                showToast(data.error || 'Incorrect PIN', 'error', 3000);
                const input = document.getElementById('pin-input');
                if (input) input.value = '';
                return false;
            }
        }

        if (pendingAction === 'archive') {
            const res = await fetch(`/api/notes/${noteId}/archive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            });
            if (res.ok) {
                closePinModal();
                pinState.pendingNoteId = null;
                pinState.pendingAction = null;
                showToast('Archived', 'success', 2000);
                await loadNotesUnified();
                return true;
            } else {
                const data = await res.json();
                showToast(data.error || 'Incorrect PIN', 'error', 3000);
                const input = document.getElementById('pin-input');
                if (input) input.value = '';
                return false;
            }
        }

        if (pendingAction === 'restore') {
            const res = await fetch(`/api/notes/${noteId}/restore`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            });
            if (res.ok) {
                closePinModal();
                pinState.pendingNoteId = null;
                pinState.pendingAction = null;
                showToast('Restored', 'success', 2000);
                await loadNotesUnified();
                return true;
            } else {
                const data = await res.json();
                showToast(data.error || 'Incorrect PIN', 'error', 3000);
                const input = document.getElementById('pin-input');
                if (input) input.value = '';
                return false;
            }
        }

        if (pendingAction === 'duplicate') {
            const res = await fetch(`/api/notes/${noteId}/duplicate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            });
            if (res.ok) {
                closePinModal();
                pinState.pendingNoteId = null;
                pinState.pendingAction = null;
                showToast('Note duplicated', 'success', 2000);
                await loadNotesUnified();
                return true;
            } else {
                const data = await res.json();
                showToast(data.error || 'Incorrect PIN', 'error', 3000);
                const input = document.getElementById('pin-input');
                if (input) input.value = '';
                return false;
            }
        }

        // Handle unlock to view - use the unlock endpoint
        const res = await fetch(`/api/notes/${noteId}/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin })
        });

        if (res.ok) {
            const noteData = await res.json();
            closePinModal();
            pinState.pendingNoteId = null;
            pinState.pendingAction = null;
            // Open the note with the unlocked content
            openNoteInEditorWithData(noteId, noteData);
            return true;
        } else {
            const data = await res.json();
            showToast(data.error || 'Incorrect PIN', 'error', 3000);
            const input = document.getElementById('pin-input');
            if (input) input.value = '';
            return false;
        }
    } catch (e) {
        console.error('Error verifying PIN:', e);
        showToast('Error verifying PIN', 'error', 3000);
        return false;
    }
}

async function verifyFolderPin(pin, folderId, action) {
    try {
        if (action === 'unlock_folder') {
            // Verify PIN and navigate to folder
            const res = await fetch(`/api/note-folders/${folderId}/unlock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            });

            if (res.ok) {
                closePinModal();
                pinState.pendingFolderId = null;
                pinState.pendingAction = null;
                // Navigate to the folder
                window.location.href = `/notes/folder/${folderId}`;
                return true;
            } else {
                const data = await res.json();
                showToast(data.error || 'Incorrect PIN', 'error', 3000);
                const input = document.getElementById('pin-input');
                if (input) input.value = '';
                return false;
            }
        }

        if (action === 'unprotect_folder') {
            // Send PIN with the unprotect request
            const res = await fetch(`/api/note-folders/${folderId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin, is_pin_protected: false })
            });

            if (res.ok) {
                closePinModal();
                pinState.pendingFolderId = null;
                pinState.pendingAction = null;
                showToast('Protection removed', 'success', 2000);
                await loadNotesUnified();
                return true;
            } else {
                const data = await res.json();
                showToast(data.error || 'Incorrect PIN', 'error', 3000);
                const input = document.getElementById('pin-input');
                if (input) input.value = '';
                return false;
            }
        }

        if (action === 'delete_folder') {
            // Verify PIN and then delete
            const res = await fetch(`/api/note-folders/${folderId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            });

            if (res.ok) {
                closePinModal();
                pinState.pendingFolderId = null;
                pinState.pendingAction = null;
                showToast('Folder deleted', 'success', 2000);
                await loadNotesUnified();
                return true;
            } else {
                const data = await res.json();
                showToast(data.error || 'Incorrect PIN', 'error', 3000);
                const input = document.getElementById('pin-input');
                if (input) input.value = '';
                return false;
            }
        }

        if (action === 'archive_folder') {
            const res = await fetch(`/api/note-folders/${folderId}/archive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            });

            if (res.ok) {
                closePinModal();
                pinState.pendingFolderId = null;
                pinState.pendingAction = null;
                showToast('Folder archived', 'success', 2000);
                await loadNotesUnified();
                return true;
            } else {
                const data = await res.json();
                showToast(data.error || 'Incorrect PIN', 'error', 3000);
                const input = document.getElementById('pin-input');
                if (input) input.value = '';
                return false;
            }
        }

        if (action === 'restore_folder') {
            const res = await fetch(`/api/note-folders/${folderId}/restore`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            });

            if (res.ok) {
                closePinModal();
                pinState.pendingFolderId = null;
                pinState.pendingAction = null;
                showToast('Folder restored', 'success', 2000);
                await loadNotesUnified();
                return true;
            } else {
                const data = await res.json();
                showToast(data.error || 'Incorrect PIN', 'error', 3000);
                const input = document.getElementById('pin-input');
                if (input) input.value = '';
                return false;
            }
        }

        return false;
    } catch (e) {
        console.error('Error verifying folder PIN:', e);
        showToast('Error verifying PIN', 'error', 3000);
        return false;
    }
}

function openPinModal() {
    const modal = document.getElementById('pin-modal');
    if (modal) {
        modal.classList.add('active');
        const input = document.getElementById('pin-input');
        if (input) {
            input.value = '';
            setTimeout(() => input.focus(), 100);
        }
    }
}

function closePinModal() {
    const modal = document.getElementById('pin-modal');
    if (modal) {
        modal.classList.remove('active');
    }
    pinState.pendingNoteId = null;
    pinState.pendingFolderId = null;
    pinState.pendingAction = null;

    // Reset Quick Access protected state if it exists
    if (window.qaProtectedState) {
        window.qaProtectedState.active = false;
        window.qaProtectedState.pendingUrl = null;
    }
}

function submitPin() {
    const input = document.getElementById('pin-input');
    const pin = input ? input.value.trim() : '';
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        showToast('PIN must be 4 digits', 'warning', 2000);
        return;
    }

    // Check if this is a Quick Access protected item unlock
    if (window.qaProtectedState && window.qaProtectedState.active) {
        if (typeof window.verifyQAProtectedPin === 'function') {
            window.verifyQAProtectedPin(pin);
        }
        return;
    }

    verifyPin(pin);
}

function openSetPinModal() {
    const modal = document.getElementById('set-pin-modal');
    if (modal) {
        modal.classList.add('active');
        const input = document.getElementById('new-pin-input');
        if (input) {
            input.value = '';
            setTimeout(() => input.focus(), 100);
        }
        const confirmInput = document.getElementById('confirm-pin-input');
        if (confirmInput) confirmInput.value = '';
    }
}

function closeSetPinModal() {
    const modal = document.getElementById('set-pin-modal');
    if (modal) {
        modal.classList.remove('active');
    }
    // Reset notes PIN setting state if cancelled
    pinState.settingNotesPin = false;
}

async function submitSetPin() {
    const newPinInput = document.getElementById('new-pin-input');
    const confirmPinInput = document.getElementById('confirm-pin-input');
    const newPin = newPinInput ? newPinInput.value.trim() : '';
    const confirmPin = confirmPinInput ? confirmPinInput.value.trim() : '';

    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
        showToast('PIN must be 4 digits', 'warning', 2000);
        return;
    }

    if (newPin !== confirmPin) {
        showToast('PINs do not match', 'warning', 2000);
        return;
    }

    // Check if we're setting the notes PIN
    const settingNotesPin = pinState.settingNotesPin;
    const pendingAction = pinState.pendingAction;
    const pendingNoteId = pinState.pendingNoteId;
    const pendingFolderId = pinState.pendingFolderId;

    try {
        const endpoint = settingNotesPin ? '/api/notes-pin' : '/api/pin';
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: newPin, confirm_pin: confirmPin })
        });
        const data = await res.json();
        if (res.ok) {
            if (settingNotesPin) {
                pinState.hasNotesPin = true;
                pinState.settingNotesPin = false;
            } else {
                pinState.hasPin = true;
            }
            closeSetPinModal();
            showToast('PIN set successfully', 'success', 2000);

            // If there was a pending protection action, execute it now
            if (settingNotesPin && pendingAction === 'protect_after_set' && pendingNoteId) {
                await doProtectNote(pendingNoteId, true);
                pinState.pendingNoteId = null;
                pinState.pendingAction = null;
            } else if (settingNotesPin && pendingAction === 'protect_folder_after_set' && pendingFolderId) {
                await doProtectFolder(pendingFolderId, true);
                pinState.pendingFolderId = null;
                pinState.pendingAction = null;
            }
        } else {
            showToast(data.error || 'Failed to set PIN', 'error', 3000);
        }
    } catch (e) {
        showToast('Error setting PIN', 'error', 3000);
    }
}

async function toggleNoteProtection(noteId) {
    if (!noteId) {
        noteId = notesState.activeNoteId;
    }
    if (!noteId) {
        showToast('No note selected', 'warning', 2000);
        return;
    }

    // Check if user has notes PIN set
    if (!pinState.hasNotesPin) {
        pinState.settingNotesPin = true;
        pinState.pendingNoteId = noteId;
        pinState.pendingAction = 'protect_after_set';
        openSetPinModal();
        return;
    }

    const note = notesState.notes.find(n => n.id === noteId);
    if (!note) return;

    // If unprotecting, require PIN first
    if (note.is_pin_protected) {
        pinState.pendingNoteId = noteId;
        pinState.pendingAction = 'unprotect';
        openPinModal();
        return;
    }

    // Protecting an unprotected note
    try {
        const res = await fetch(`/api/notes/${noteId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_pin_protected: true })
        });

        if (!res.ok) {
            const data = await res.json();
            showToast(data.error || 'Failed to update protection', 'error', 3000);
            return;
        }

        // Update local state
        note.is_pin_protected = true;

        // Update UI
        updateProtectButton(true);
        showToast('Note protected', 'success', 2000);
    } catch (e) {
        console.error('Error toggling protection:', e);
        showToast('Error updating protection', 'error', 3000);
    }
}

function updateProtectButton(isProtected) {
    // Update note protect button
    const noteBtn = document.getElementById('note-protect-btn');
    if (noteBtn) {
        const icon = noteBtn.querySelector('i');
        const label = noteBtn.querySelector('span');
        if (isProtected) {
            if (icon) icon.className = 'fa-solid fa-lock-open';
            if (label) label.textContent = ' Unprotect';
        } else {
            if (icon) icon.className = 'fa-solid fa-lock';
            if (label) label.textContent = ' Protect';
        }
    }

    // Update list protect button
    const listBtn = document.getElementById('list-protect-btn');
    if (listBtn) {
        const icon = listBtn.querySelector('i');
        const label = listBtn.querySelector('span');
        if (isProtected) {
            if (icon) icon.className = 'fa-solid fa-lock-open';
            if (label) label.textContent = ' Unprotect';
        } else {
            if (icon) icon.className = 'fa-solid fa-lock';
            if (label) label.textContent = ' Protect';
        }
    }
}

function updateArchiveButton(isArchived) {
    const noteBtn = document.getElementById('note-archive-btn');
    if (noteBtn) {
        const icon = noteBtn.querySelector('i');
        const label = noteBtn.querySelector('span');
        if (isArchived) {
            if (icon) icon.className = 'fa-solid fa-rotate-left';
            if (label) label.textContent = ' Restore';
        } else {
            if (icon) icon.className = 'fa-solid fa-box-archive';
            if (label) label.textContent = ' Archive';
        }
    }

    const listBtn = document.getElementById('list-archive-btn');
    if (listBtn) {
        const icon = listBtn.querySelector('i');
        const label = listBtn.querySelector('span');
        if (isArchived) {
            if (icon) icon.className = 'fa-solid fa-rotate-left';
            if (label) label.textContent = ' Restore';
        } else {
            if (icon) icon.className = 'fa-solid fa-box-archive';
            if (label) label.textContent = ' Archive';
        }
    }
}

async function toggleCurrentNoteArchive() {
    const noteId = notesState.activeNoteId;
    if (!noteId) {
        showToast('No note selected', 'warning', 2000);
        return;
    }
    const note = getNoteById(noteId) || (notesState.notes || [])[0];
    const shouldArchive = !(note && note.is_archived);
    if (note && note.is_pin_protected) {
        pinState.pendingNoteId = noteId;
        pinState.pendingAction = shouldArchive ? 'archive' : 'restore';
        openPinModal();
        return;
    }
    try {
        const res = await fetch(`/api/notes/${noteId}/${shouldArchive ? 'archive' : 'restore'}`, { method: 'POST' });
        if (!res.ok) throw new Error('Update failed');
        const updated = await res.json();
        notesState.notes = [updated];
        updateArchiveButton(!!updated.is_archived);
        showToast(shouldArchive ? 'Archived' : 'Restored', 'success', 2000);
        if (shouldArchive) {
            window.location.href = getNoteReturnUrl();
        }
    } catch (e) {
        console.error('Archive toggle failed:', e);
        showToast('Failed to update archive state', 'error', 3000);
    }
}

async function toggleCurrentListArchive() {
    const listId = listState.listId;
    if (!listId) {
        showToast('No list selected', 'warning', 2000);
        return;
    }
    const note = getNoteById(listId) || (notesState.notes || [])[0];
    const shouldArchive = !(note && note.is_archived);
    if (note && note.is_pin_protected) {
        pinState.pendingNoteId = listId;
        pinState.pendingAction = shouldArchive ? 'archive' : 'restore';
        openPinModal();
        return;
    }
    try {
        const res = await fetch(`/api/notes/${listId}/${shouldArchive ? 'archive' : 'restore'}`, { method: 'POST' });
        if (!res.ok) throw new Error('Update failed');
        const updated = await res.json();
        notesState.notes = [updated];
        updateArchiveButton(!!updated.is_archived);
        showToast(shouldArchive ? 'Archived' : 'Restored', 'success', 2000);
        if (shouldArchive) {
            window.location.href = getListReturnUrl();
        }
    } catch (e) {
        console.error('Archive toggle failed:', e);
        showToast('Failed to update archive state', 'error', 3000);
    }
}

async function toggleListProtection() {
    const listId = listState.listId;
    if (!listId) {
        showToast('No list selected', 'warning', 2000);
        return;
    }

    // Check if user has notes PIN set
    if (!pinState.hasNotesPin) {
        pinState.settingNotesPin = true;
        pinState.pendingNoteId = listId;
        pinState.pendingAction = 'protect_after_set';
        openSetPinModal();
        return;
    }

    // Check current protection state from notesState or protectButton state
    const note = notesState.notes.find(n => n.id === listId);
    const isCurrentlyProtected = note ? note.is_pin_protected : false;

    // If unprotecting, require PIN first
    if (isCurrentlyProtected) {
        pinState.pendingNoteId = listId;
        pinState.pendingAction = 'unprotect';
        openPinModal();
        return;
    }

    // Protecting an unprotected list
    try {
        const updateRes = await fetch(`/api/notes/${listId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_pin_protected: true })
        });

        if (!updateRes.ok) {
            const data = await updateRes.json();
            showToast(data.error || 'Failed to update protection', 'error', 3000);
            return;
        }

        // Update local state if note exists
        if (note) note.is_pin_protected = true;

        // Update UI
        updateProtectButton(true);
        showToast('List protected', 'success', 2000);
    } catch (e) {
        console.error('Error toggling list protection:', e);
        showToast('Error updating protection', 'error', 3000);
    }
}
