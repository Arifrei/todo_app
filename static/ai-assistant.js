// --- AI Assistant ---
let aiMessages = [];
let aiSending = false;
let aiTyping = false;
const AI_STORAGE_KEY = 'ai-messages';
let aiRecognition = null;
let aiVoiceActive = false;
let aiVoiceUserStop = false;
let aiVoiceBaseText = '';
let aiVoiceContext = 'panel';
let aiRecorder = null;
let aiRecorderStream = null;
let aiRecorderChunks = [];
let aiRecorderActive = false;
let aiRecorderContext = 'panel';
let aiRecorderBaseText = '';
let aiRecorderTranscript = '';
const USE_SERVER_STT_ALWAYS = true; // Force server STT to avoid native auto-stopping
const SERVER_STT_CHUNK_MS = 10000; // send chunks every 10s
const aiDebugLog = (...args) => {
    if (window.DEBUG_AI === true) console.log(...args);
};

function isSecureVoiceContext() {
    // getUserMedia typically requires HTTPS or localhost
    return window.isSecureContext || ['https:', 'file:'].includes(location.protocol) ||
        location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

function loadAIMessagesFromStorage() {
    try {
        const raw = localStorage.getItem(AI_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function saveAIMessagesToStorage() {
    try {
        localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(aiMessages));
    } catch (e) {
        // ignore storage errors
    }
}

function getAIInputByContext(context) {
    const inputId = context === 'page' ? 'ai-page-input' : 'ai-input';
    return document.getElementById(inputId);
}

function setAIMicButtonState(active, context) {
    const btn = context === 'page'
        ? document.querySelector('#ai-page-send')?.previousElementSibling
        : document.querySelector('#ai-panel .ai-mic-btn');
    if (!btn) return;
    btn.classList.toggle('listening', active);
}

function ensureRecognition() {
    if (aiRecognition) return aiRecognition;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;
    aiRecognition = new SpeechRecognition();
    aiRecognition.lang = navigator.language || 'en-US';
    aiRecognition.continuous = true;
    aiRecognition.interimResults = true;
    aiRecognition.onresult = (event) => {
        const input = getAIInputByContext(aiVoiceContext);
        if (!input) return;
        let finalText = '';
        let interimText = '';
        for (let i = 0; i < event.results.length; i++) {
            const res = event.results[i];
            if (res.isFinal) finalText += res[0].transcript;
            else interimText += res[0].transcript;
        }
        input.value = `${aiVoiceBaseText}${finalText}${interimText}`.trimStart();
    };
    aiRecognition.onerror = (e) => {
        console.error('Speech recognition error:', e);
        aiVoiceActive = false;
        setAIMicButtonState(false, aiVoiceContext);
    };
    aiRecognition.onstart = () => {
        aiVoiceActive = true;
        setAIMicButtonState(true, aiVoiceContext);
    };
    aiRecognition.onend = () => {
        if (aiVoiceUserStop) {
            aiVoiceActive = false;
            setAIMicButtonState(false, aiVoiceContext);
            return;
        }
        // Keep listening; avoid silence auto-stop
        try {
            aiRecognition.start();
        } catch (err) {
            console.error('Failed to restart speech recognition:', err);
            aiVoiceActive = false;
            setAIMicButtonState(false, aiVoiceContext);
        }
    };
    return aiRecognition;
}

function toggleAIVoice(context = 'panel') {
    aiVoiceContext = context || 'panel';
    const recognition = ensureRecognition();
    const hasNative = !USE_SERVER_STT_ALWAYS && !!recognition;
    const hasMediaRecorder = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

    // If native speech is available, prefer it
    if (!hasNative && !hasMediaRecorder) {
        showToast('Speech recognition is not available in this environment.', 'warning');
        return;
    }

    if (!hasNative && hasMediaRecorder) {
        // Fallback to server STT with recording
        if (aiRecorderActive) {
            stopServerVoice();
        } else {
            startServerVoice(aiVoiceContext);
        }
        return;
    }

    if (aiVoiceActive) {
        aiVoiceUserStop = true;
        try { recognition.stop(); } catch (e) { /* ignore */ }
        aiVoiceActive = false;
        setAIMicButtonState(false, aiVoiceContext);
        return;
    }

    const input = getAIInputByContext(aiVoiceContext);
    if (!input) return;
    aiVoiceBaseText = input.value ? `${input.value.trim()} ` : '';
    aiVoiceUserStop = false;
    try {
        recognition.start();
    } catch (e) {
        console.error('Failed to start speech recognition:', e);
        aiVoiceActive = false;
        setAIMicButtonState(false, aiVoiceContext);
    }
}

function startServerVoice(context = 'panel') {
    aiRecorderContext = context || 'panel';
    const input = getAIInputByContext(aiRecorderContext);
    if (!input) return;
    aiRecorderBaseText = input.value ? input.value.trim() : '';
    aiRecorderTranscript = aiRecorderBaseText;

    if (!isSecureVoiceContext()) {
        showToast('Microphone access is blocked because this page is not served over HTTPS/localhost. Use HTTPS or the installed app.', 'warning');
        return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Microphone is not available in this environment.', 'warning');
        return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        aiRecorderStream = stream;
        aiRecorderChunks = [];

        // Configure MediaRecorder with options for better compatibility
        let options = { mimeType: 'audio/webm' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options = { mimeType: 'audio/ogg' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options = {};
            }
        }

        aiRecorder = new MediaRecorder(stream, options);
        aiDebugLog('MediaRecorder started with mimeType:', aiRecorder.mimeType);

        aiRecorder.ondataavailable = (e) => {
            aiDebugLog('Data available event fired, size:', e.data.size);
            if (e.data && e.data.size > 0) {
                // Accumulate chunks instead of transcribing immediately
                aiRecorderChunks.push(e.data);
                aiDebugLog('Chunk accumulated. Total chunks:', aiRecorderChunks.length);
            } else {
                console.warn('Empty chunk received');
            }
        };

        aiRecorder.onstart = () => {
            aiDebugLog('MediaRecorder started successfully');
        };

        aiRecorder.onerror = (e) => {
            console.error('MediaRecorder error:', e);
        };

        aiRecorder.onstop = () => {
            aiDebugLog('MediaRecorder stopped');
            aiRecorderActive = false;
            setAIMicButtonState(false, aiRecorderContext);

            // Transcribe all accumulated chunks as one complete audio
            if (aiRecorderChunks.length > 0) {
                aiDebugLog('Transcribing', aiRecorderChunks.length, 'accumulated chunks');
                const completeBlob = new Blob(aiRecorderChunks, { type: aiRecorder.mimeType });
                transcribeServerAudioChunk(completeBlob, aiRecorderContext);
            }

            stopServerVoiceStream();
        };

        // Start with timeslice to ensure continuous chunk generation regardless of pauses
        aiRecorder.start(SERVER_STT_CHUNK_MS);
        aiRecorderActive = true;
        setAIMicButtonState(true, aiRecorderContext);
    }).catch(err => {
        console.error('Unable to access microphone:', err);
        showToast('Could not access the microphone. Please check permissions.', 'error');
    });
}

function stopServerVoiceStream() {
    if (aiRecorderStream) {
        aiRecorderStream.getTracks().forEach(t => t.stop());
        aiRecorderStream = null;
    }
    aiRecorder = null;
    // Clear chunks after transcription is done
    aiRecorderChunks = [];
}

function stopServerVoice() {
    if (aiRecorder) {
        try { aiRecorder.stop(); } catch (e) { /* ignore */ }
        // Don't clear chunks here - let onstop handler use them first
    } else {
        stopServerVoiceStream();
        aiRecorderActive = false;
        setAIMicButtonState(false, aiRecorderContext);
    }
}

async function transcribeServerAudioChunk(blob, context) {
    const formData = new FormData();
    formData.append('audio', blob, 'audio.webm');
    aiDebugLog('Sending STT chunk - bytes:', blob.size, 'type:', blob.type);
    try {
        const res = await fetch('/api/ai/stt', {
            method: 'POST',
            body: formData
        });
        aiDebugLog('STT response status:', res.status);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error('STT failed with status', res.status, ':', err);
        } else {
            const data = await res.json();
            const transcript = data.text || '';
            aiDebugLog('STT chunk transcript:', transcript.length, 'chars - "' + transcript + '"');
            appendTranscript(context, transcript);
        }
    } catch (e) {
        console.error('Transcription error:', e);
    }
}

function appendTranscript(context, text) {
    aiDebugLog('appendTranscript called with text:', text);
    if (!text) {
        console.warn('appendTranscript: no text provided');
        return;
    }
    const input = getAIInputByContext(context);
    if (!input) {
        console.error('appendTranscript: no input found for context', context);
        return;
    }
    const current = aiRecorderTranscript || input.value || '';
    const appended = `${current} ${text}`.replace(/\s+/g, ' ').trim();
    aiDebugLog('Appending transcript - before:', current.length, 'chars, after:', appended.length, 'chars');
    aiRecorderTranscript = appended;
    input.value = appended;
}

function toggleAIPanel() {
    const panel = document.getElementById('ai-panel');
    if (!panel) return;
    if (!aiMessages.length) {
        aiMessages = loadAIMessagesFromStorage();
    }
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
        const input = document.getElementById('ai-input');
        if (input) input.focus();
    }
}

function formatAIMessage(text) {
    // Convert markdown-style formatting to HTML
    let formatted = text;

    // Convert markdown links [text](url) to HTML <a> tags (must be done before other conversions)
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="ai-link">$1</a>');

    // Convert **📋 Project:** to styled project header
    formatted = formatted.replace(/\*\*📋 Project: (.+?)\*\*/g, '<strong class="ai-project-header">📋 Project: $1</strong>');

    // Convert **▶ Phase:** to styled phase header
    formatted = formatted.replace(/\*\*▶ Phase: (.+?)\*\*/g, '<strong class="ai-phase-header">▶ Phase: $1</strong>');

    // Calendar: Convert **📅 Day, Month Date, Year** to styled calendar day header
    formatted = formatted.replace(/\*\*📅 (.+?)\*\*/g, '<span class="ai-calendar-day">📅 $1</span>');

    // Calendar: Convert **📁 Group** to styled group header
    formatted = formatted.replace(/\*\*📁 (.+?)\*\*/g, '<span class="ai-calendar-group">📁 $1</span>');

    // Convert remaining **text** to <strong>text</strong>
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Calendar: Convert timed events (⏰ HH:MM-HH:MM | status **title** priority)
    formatted = formatted.replace(/⏰\s*(\d{2}:\d{2})-(\d{2}:\d{2})\s*\|\s*(○|◐|✓)\s*<strong>(.+?)<\/strong>(\s*🔴|\s*🟡)?/g,
        (match, start, end, status, title, priority) => {
            const statusClass = status === '○' ? 'ai-status-todo' : status === '◐' ? 'ai-status-progress' : 'ai-status-done';
            const priorityHtml = priority ? (priority.includes('🔴') ? ' <span class="ai-priority-high">🔴</span>' : ' <span class="ai-priority-medium">🟡</span>') : '';
            return `<span class="ai-calendar-event"><span class="ai-calendar-time">${start}-${end}</span> <span class="ai-status ${statusClass}">${status}</span> <span class="ai-calendar-title">${title}</span>${priorityHtml}</span>`;
        });

    // Calendar: Convert non-timed events (📌 status **title** priority)
    formatted = formatted.replace(/📌\s*(○|◐|✓)\s*<strong>(.+?)<\/strong>(\s*🔴|\s*🟡)?/g,
        (match, status, title, priority) => {
            const statusClass = status === '○' ? 'ai-status-todo' : status === '◐' ? 'ai-status-progress' : 'ai-status-done';
            const priorityHtml = priority ? (priority.includes('🔴') ? ' <span class="ai-priority-high">🔴</span>' : ' <span class="ai-priority-medium">🟡</span>') : '';
            return `<span class="ai-calendar-event"><span class="ai-status ${statusClass}">${status}</span> <span class="ai-calendar-title">${title}</span>${priorityHtml}</span>`;
        });

    // Convert newlines to <br>
    formatted = formatted.replace(/\n/g, '<br>');

    // Style status badges (must be before bullet conversion)
    formatted = formatted.replace(/\[○\]/g, '<span class="ai-status ai-status-todo">○</span>');
    formatted = formatted.replace(/\[◐\]/g, '<span class="ai-status ai-status-progress">◐</span>');
    formatted = formatted.replace(/\[✓\]/g, '<span class="ai-status ai-status-done">✓</span>');

    // Convert bullet points with proper indentation
    formatted = formatted.replace(/^-\s/gm, '<span class="ai-bullet">- </span>');
    formatted = formatted.replace(/<br>-\s/g, '<br><span class="ai-bullet">- </span>');

    // Add spacing for double line breaks
    formatted = formatted.replace(/(<br>){2,}/g, '<br><br>');

    return formatted;
}

function renderAIMessages(context = 'panel') {
    const containerId = context === 'page' ? 'ai-page-messages' : 'ai-messages';
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    // Show placeholder when no messages
    if (!aiMessages.length && !aiTyping) {
        const placeholder = document.createElement('div');
        placeholder.className = 'ai-empty-state';
        placeholder.innerHTML = `
            <i class="fa-solid fa-robot"></i>
            <p>Start a conversation</p>
            <span>Ask me to manage tasks, calendar events, recalls, or bookmarks</span>
        `;
        container.appendChild(placeholder);
        return;
    }

    aiMessages.forEach(m => {
        const div = document.createElement('div');
        div.className = `ai-msg ${m.role === 'user' ? 'user' : 'ai'}`;

        if (m.role === 'assistant') {
            // Format assistant messages with HTML
            div.innerHTML = formatAIMessage(m.content);
        } else {
            // User messages remain as plain text
            div.textContent = m.content;
        }

        container.appendChild(div);
    });
    if (aiTyping) {
        const typing = document.createElement('div');
        typing.className = 'ai-typing';
        typing.innerHTML = `<span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span>`;
        container.appendChild(typing);
    }
    container.scrollTop = container.scrollHeight;
    saveAIMessagesToStorage();
}

async function sendAIPrompt(context = 'panel') {
    if (aiSending) return;
    const inputId = context === 'page' ? 'ai-page-input' : 'ai-input';
    const input = document.getElementById(inputId);
    if (!input) return;
    const text = (input.value || '').trim();
    if (!text) return;

    aiSending = true;
    aiTyping = true;
    aiMessages.push({ role: 'user', content: text });
    renderAIMessages(context);
    input.value = '';

    try {
        const res = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: aiMessages })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            aiMessages.push({ role: 'assistant', content: `Error: ${err.error || 'Request failed'}` });
        } else {
            const data = await res.json();
            const reply = data.reply || 'No reply';
            aiMessages.push({ role: 'assistant', content: reply });
        }
    } catch (e) {
        aiMessages.push({ role: 'assistant', content: 'Error contacting AI.' });
    } finally {
        aiSending = false;
        aiTyping = false;
        renderAIMessages(context);
        saveAIMessagesToStorage();
    }
}

function clearAIConversation() {
    openConfirmModal('Clear all AI conversation history? This cannot be undone.', () => {
        aiMessages = [];
        saveAIMessagesToStorage();

        // Re-render both contexts in case both are visible
        const panelMessages = document.getElementById('ai-messages');
        const pageMessages = document.getElementById('ai-page-messages');
        if (panelMessages) renderAIMessages('panel');
        if (pageMessages) renderAIMessages('page');

        showToast('AI conversation cleared. Start a new conversation to use the updated AI instructions.', 'success', 5000);
        closeConfirmModal();
    });
}

function openFullAIPage() {
    if (!aiMessages.length) {
        aiMessages = loadAIMessagesFromStorage();
    }
    saveAIMessagesToStorage();
    window.location.href = '/ai';
}

function initAIPanel() {
    if (!aiMessages.length) {
        aiMessages = loadAIMessagesFromStorage();
    }
    renderAIMessages('panel');
}

function initAIDragLauncher() {
    const launcher = document.querySelector('.ai-launcher');
    if (!launcher) return;

    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let baseX = 0;
    let baseY = 0;
    let dragMoved = false;

    const parseTranslate = (el) => {
        const value = window.getComputedStyle(el).transform;
        if (!value || value === 'none') return { x: 0, y: 0 };
        if (typeof DOMMatrixReadOnly !== 'undefined') {
            const matrix = new DOMMatrixReadOnly(value);
            return { x: matrix.m41, y: matrix.m42 };
        }
        const match = value.match(/matrix\(([^)]+)\)/);
        if (!match) return { x: 0, y: 0 };
        const parts = match[1].split(',').map(Number);
        return { x: parts[4] || 0, y: parts[5] || 0 };
    };

    launcher.addEventListener('pointerdown', (e) => {
        pointerId = e.pointerId;
        launcher.setPointerCapture(pointerId);
        const pos = parseTranslate(launcher);
        baseX = pos.x;
        baseY = pos.y;
        startX = e.clientX;
        startY = e.clientY;
        dragMoved = false;
        launcher.classList.add('dragging');
    });

    launcher.addEventListener('pointermove', (e) => {
        if (pointerId === null || e.pointerId !== pointerId) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
            dragMoved = true;
        }

        const rect = launcher.getBoundingClientRect();
        const padding = 8;
        const minDx = padding - rect.left;
        const maxDx = window.innerWidth - padding - rect.right;
        const minDy = padding - rect.top;
        const maxDy = window.innerHeight - padding - rect.bottom;

        const clampedDx = Math.max(minDx, Math.min(maxDx, dx));
        const clampedDy = Math.max(minDy, Math.min(maxDy, dy));

        launcher.style.transform = `translate(${baseX + clampedDx}px, ${baseY + clampedDy}px)`;
    });

    const endDrag = (e) => {
        if (pointerId === null || e.pointerId !== pointerId) return;
        launcher.releasePointerCapture(pointerId);
        pointerId = null;
        launcher.classList.remove('dragging');
        if (dragMoved) {
            launcher.dataset.justDragged = 'true';
            window.setTimeout(() => {
                delete launcher.dataset.justDragged;
            }, 0);
        }
    };

    launcher.addEventListener('pointerup', endDrag);
    launcher.addEventListener('pointercancel', endDrag);

    launcher.addEventListener('click', (e) => {
        if (launcher.dataset.justDragged) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, true);
}

function initAIPage() {
    aiMessages = loadAIMessagesFromStorage();
    const pageMessages = document.getElementById('ai-page-messages');
    const pageInput = document.getElementById('ai-page-input');
    const pageSend = document.getElementById('ai-page-send');
    if (!pageMessages || !pageInput || !pageSend) return;
    renderAIMessages('page');
    pageSend.addEventListener('click', () => sendAIPrompt('page'));
    pageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            sendAIPrompt('page');
        }
    });
}
