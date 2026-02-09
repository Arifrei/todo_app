// --- Homepage Reordering ---

let homepageEditMode = {
    active: false,
    longPressTimer: null,
    longPressTriggered: false,
    touchStart: { x: 0, y: 0 },
    currentDragCard: null
};

let homepageTouchDragState = {
    active: false,
    card: null,
    clone: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0
};

function initHomepageReorder() {
    const grid = document.getElementById('homepage-grid');
    if (!grid) return; // Not on homepage

    const cards = grid.querySelectorAll('.module-card');
    cards.forEach(card => {
        // Desktop: Long press detection
        let mouseDownTimer = null;

        card.addEventListener('mousedown', (e) => {
            if (homepageEditMode.active) return; // Already in edit mode
            mouseDownTimer = setTimeout(() => {
                enterHomepageEditMode();
            }, 1000); // 1 second for desktop
        });

        card.addEventListener('mouseup', () => {
            clearTimeout(mouseDownTimer);
        });

        card.addEventListener('mouseleave', () => {
            clearTimeout(mouseDownTimer);
        });

        // Mobile: Touch long press
        card.addEventListener('touchstart', handleHomepageTouchStart, { passive: true });
        card.addEventListener('touchmove', handleHomepageTouchMove, { passive: true });
        card.addEventListener('touchend', handleHomepageTouchEnd);
    });

    // Done button
    const doneBtn = document.getElementById('homepage-done-btn');
    if (doneBtn) {
        doneBtn.addEventListener('click', exitHomepageEditMode);
    }

    // Click outside to exit
    document.addEventListener('click', (e) => {
        if (!homepageEditMode.active) return;
        if (!e.target.closest('#homepage-grid') && !e.target.closest('#homepage-done-btn')) {
            exitHomepageEditMode();
        }
    });
}

function handleHomepageTouchStart(e) {
    if (homepageEditMode.active) return; // Already in edit mode, drag will handle

    homepageEditMode.longPressTriggered = false;
    if (e.touches && e.touches.length) {
        homepageEditMode.touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }

    homepageEditMode.longPressTimer = setTimeout(() => {
        homepageEditMode.longPressTimer = null;
        homepageEditMode.longPressTriggered = true;
        enterHomepageEditMode();
    }, 1000); // 1 second for mobile
}

function handleHomepageTouchMove(e) {
    if (!homepageEditMode.longPressTimer || !e.touches || !e.touches.length) return;

    const dx = Math.abs(e.touches[0].clientX - homepageEditMode.touchStart.x);
    const dy = Math.abs(e.touches[0].clientY - homepageEditMode.touchStart.y);

    if (dx > 10 || dy > 10) { // User is scrolling
        clearTimeout(homepageEditMode.longPressTimer);
        homepageEditMode.longPressTimer = null;
    }
}

function handleHomepageTouchEnd(e) {
    if (homepageEditMode.longPressTimer) {
        clearTimeout(homepageEditMode.longPressTimer);
        homepageEditMode.longPressTimer = null;
    }

    if (homepageEditMode.longPressTriggered) {
        e.preventDefault(); // Prevent click navigation
        homepageEditMode.longPressTriggered = false;
    }
}

function enterHomepageEditMode() {
    homepageEditMode.active = true;
    const grid = document.getElementById('homepage-grid');
    const doneBtn = document.getElementById('homepage-done-btn');

    if (grid) {
        grid.classList.add('edit-mode');
        const cards = grid.querySelectorAll('.module-card');
        cards.forEach(card => {
            card.classList.add('wiggle');
            // Prevent navigation while in edit mode
            card.addEventListener('click', preventNavigation);
        });
    }

    if (doneBtn) {
        doneBtn.style.display = 'block';
    }

    // Initialize drag after entering edit mode
    initHomepageDrag();
}

function exitHomepageEditMode() {
    homepageEditMode.active = false;
    const grid = document.getElementById('homepage-grid');
    const doneBtn = document.getElementById('homepage-done-btn');

    if (grid) {
        grid.classList.remove('edit-mode');
        const cards = grid.querySelectorAll('.module-card');
        cards.forEach(card => {
            card.classList.remove('wiggle');
            card.removeEventListener('click', preventNavigation);
            // Clean up drag listeners
            card.removeAttribute('draggable');
        });
    }

    if (doneBtn) {
        doneBtn.style.display = 'none';
    }

    // Save order
    saveHomepageOrder();
}

function preventNavigation(e) {
    if (homepageEditMode.active) {
        e.preventDefault();
        e.stopPropagation();
    }
}

function initHomepageDrag() {
    const grid = document.getElementById('homepage-grid');
    if (!grid) return;

    const cards = grid.querySelectorAll('.module-card');
    cards.forEach(card => {
        card.setAttribute('draggable', 'true');

        // Desktop drag events
        card.addEventListener('dragstart', handleHomepageDragStart);
        card.addEventListener('dragend', handleHomepageDragEnd);
        card.addEventListener('dragover', handleHomepageDragOver);
        card.addEventListener('drop', handleHomepageDrop);

        // Mobile touch drag events
        card.addEventListener('touchstart', handleHomepageTouchDragStart, { passive: false });
        card.addEventListener('touchmove', handleHomepageTouchDragMove, { passive: false });
        card.addEventListener('touchend', handleHomepageTouchDragEnd);
    });
}

function handleHomepageDragStart(e) {
    if (!homepageEditMode.active) return;

    homepageEditMode.currentDragCard = e.currentTarget;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget.innerHTML);
}

function handleHomepageDragEnd(e) {
    if (homepageEditMode.currentDragCard) {
        homepageEditMode.currentDragCard.classList.remove('dragging');
        homepageEditMode.currentDragCard = null;
    }
}

function handleHomepageDragOver(e) {
    if (!homepageEditMode.active || !homepageEditMode.currentDragCard) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const grid = document.getElementById('homepage-grid');
    const afterElement = getHomepageDragAfterElement(grid, e.clientX, e.clientY);
    const draggingCard = homepageEditMode.currentDragCard;

    if (afterElement == null) {
        grid.appendChild(draggingCard);
    } else if (afterElement !== draggingCard) {
        grid.insertBefore(draggingCard, afterElement);
    }
}

function handleHomepageDrop(e) {
    e.preventDefault();
}

function getHomepageDragAfterElement(container, x, y) {
    const draggableElements = [...container.querySelectorAll('.module-card:not(.dragging)')];

    if (draggableElements.length === 0) {
        return null;
    }

    // Grid flows top-to-bottom, left-to-right
    // Find the first element that the cursor is "before" in reading order
    for (const element of draggableElements) {
        const box = element.getBoundingClientRect();
        const centerX = box.left + box.width / 2;
        const centerY = box.top + box.height / 2;

        // If cursor is above this element (in a previous row), insert before it
        if (y < box.top) {
            return element;
        }

        // If cursor is roughly in this element's row
        if (y >= box.top && y <= box.bottom) {
            // Check if cursor is to the left of this element's center
            if (x < centerX) {
                return element;
            }
        }
    }

    // Cursor is after all elements - insert at end
    return null;
}

function handleHomepageTouchDragStart(e) {
    if (!homepageEditMode.active) return;

    const card = e.currentTarget;
    const touch = e.touches[0];

    homepageTouchDragState = {
        active: true,
        card: card,
        clone: null,
        startX: touch.clientX,
        startY: touch.clientY,
        currentX: touch.clientX,
        currentY: touch.clientY
    };

    // Create visual clone
    const clone = card.cloneNode(true);
    clone.style.position = 'fixed';
    clone.style.top = card.getBoundingClientRect().top + 'px';
    clone.style.left = card.getBoundingClientRect().left + 'px';
    clone.style.width = card.offsetWidth + 'px';
    clone.style.height = card.offsetHeight + 'px';
    clone.style.pointerEvents = 'none';
    clone.style.zIndex = '1000';
    clone.style.opacity = '0.9';
    clone.style.transition = 'none';
    clone.classList.add('dragging');
    clone.classList.remove('wiggle'); // Stop wiggle on the clone
    document.body.appendChild(clone);

    homepageTouchDragState.clone = clone;
    card.style.opacity = '0.3';
}

function handleHomepageTouchDragMove(e) {
    if (!homepageTouchDragState.active || !homepageTouchDragState.clone) return;

    e.preventDefault(); // Prevent scrolling while dragging

    const touch = e.touches[0];
    const deltaX = touch.clientX - homepageTouchDragState.startX;
    const deltaY = touch.clientY - homepageTouchDragState.startY;

    homepageTouchDragState.currentX = touch.clientX;
    homepageTouchDragState.currentY = touch.clientY;

    // Move clone
    homepageTouchDragState.clone.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

    // Determine where to insert
    const grid = document.getElementById('homepage-grid');
    const afterElement = getHomepageDragAfterElement(grid, touch.clientX, touch.clientY);
    const draggingCard = homepageTouchDragState.card;

    if (afterElement == null) {
        grid.appendChild(draggingCard);
    } else if (afterElement !== draggingCard) {
        grid.insertBefore(draggingCard, afterElement);
    }
}

function handleHomepageTouchDragEnd(e) {
    if (!homepageTouchDragState.active) return;

    // Clean up
    if (homepageTouchDragState.clone) {
        homepageTouchDragState.clone.remove();
    }

    if (homepageTouchDragState.card) {
        homepageTouchDragState.card.style.opacity = '';
    }

    homepageTouchDragState = {
        active: false,
        card: null,
        clone: null,
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0
    };
}

async function saveHomepageOrder() {
    const grid = document.getElementById('homepage-grid');
    if (!grid) return;

    const cards = grid.querySelectorAll('.module-card');
    const order = Array.from(cards).map(card => card.dataset.moduleId);

    try {
        const res = await fetch('/api/homepage-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(order)
        });

        if (!res.ok) {
            console.error('Failed to save homepage order');
            showToast('Failed to save order', 'error');
        } else {
            showToast('Homepage layout saved', 'success', 2000);
        }
    } catch (e) {
        console.error('Error saving homepage order:', e);
        showToast('Error saving order', 'error');
    }
}

// --- Initialization ---
function initBaseChrome() {
    if (document.body.dataset.baseChromeReady === '1') return;
    document.body.dataset.baseChromeReady = '1';

    // Prevent accidental form submissions from presentation/action buttons.
    document.querySelectorAll('button:not([type])').forEach((btn) => {
        btn.type = 'button';
    });

    const setCurrentUsername = () => {
        const desktop = document.getElementById('current-username');
        if (!desktop) return;
        fetch('/api/current-user')
            .then(r => r.json())
            .then(data => {
                desktop.textContent = data.username || 'None';
            })
            .catch(() => {
                desktop.textContent = 'None';
            });
    };

    const quickAccessBtn = document.getElementById('mobile-quick-access-btn');
    if (quickAccessBtn) {
        quickAccessBtn.addEventListener('click', () => {
            window.location.href = '/quick-access';
        });
    }

    const aiLauncherBtn = document.getElementById('ai-launcher-btn');
    if (aiLauncherBtn && typeof toggleAIPanel === 'function') {
        aiLauncherBtn.addEventListener('click', () => toggleAIPanel());
    }
    const aiPanelClose = document.getElementById('ai-panel-close-btn');
    if (aiPanelClose && typeof toggleAIPanel === 'function') {
        aiPanelClose.addEventListener('click', () => toggleAIPanel());
    }
    const aiVoiceBtn = document.getElementById('ai-panel-voice-btn');
    if (aiVoiceBtn && typeof toggleAIVoice === 'function') {
        aiVoiceBtn.addEventListener('click', () => toggleAIVoice('panel'));
    }
    const aiSendBtn = document.getElementById('ai-panel-send-btn');
    if (aiSendBtn && typeof sendAIPrompt === 'function') {
        aiSendBtn.addEventListener('click', () => sendAIPrompt());
    }
    const aiClearBtn = document.getElementById('ai-panel-clear-btn');
    if (aiClearBtn && typeof clearAIConversation === 'function') {
        aiClearBtn.addEventListener('click', () => clearAIConversation());
    }
    const aiFullBtn = document.getElementById('ai-panel-fullpage-btn');
    if (aiFullBtn && typeof openFullAIPage === 'function') {
        aiFullBtn.addEventListener('click', () => openFullAIPage());
    }

    const pinCancelBtn = document.getElementById('pin-cancel-btn');
    if (pinCancelBtn && typeof closePinModal === 'function') {
        pinCancelBtn.addEventListener('click', () => closePinModal());
    }
    const pinSubmitBtn = document.getElementById('pin-submit-btn');
    if (pinSubmitBtn && typeof submitPin === 'function') {
        pinSubmitBtn.addEventListener('click', () => submitPin());
    }
    const pinInput = document.getElementById('pin-input');
    if (pinInput && typeof submitPin === 'function') {
        pinInput.addEventListener('keyup', (event) => {
            if (event.key === 'Enter') submitPin();
        });
    }

    const setPinCancelBtn = document.getElementById('set-pin-cancel-btn');
    if (setPinCancelBtn && typeof closeSetPinModal === 'function') {
        setPinCancelBtn.addEventListener('click', () => closeSetPinModal());
    }
    const setPinSubmitBtn = document.getElementById('set-pin-submit-btn');
    if (setPinSubmitBtn && typeof submitSetPin === 'function') {
        setPinSubmitBtn.addEventListener('click', () => submitSetPin());
    }
    const confirmPinInput = document.getElementById('confirm-pin-input');
    if (confirmPinInput && typeof submitSetPin === 'function') {
        confirmPinInput.addEventListener('keyup', (event) => {
            if (event.key === 'Enter') submitSetPin();
        });
    }

    if ('serviceWorker' in navigator) {
        const isNativeApp = typeof window.isNativeApp === 'function' && window.isNativeApp();
        if (!isNativeApp) {
            navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(reg => reg.unregister()));
        }
    }

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K') {
            e.preventDefault();
            window.location.href = '/quick-access';
        }
    });

    const bindDelegatedHandler = (eventName, attrName) => {
        document.addEventListener(eventName, (event) => {
            const target = event.target.closest(`[${attrName}]`);
            if (!target) return;
            const expr = target.getAttribute(attrName);
            if (!expr) return;
            if (eventName === 'click') {
                const isImplicitSubmitButton = target.tagName === 'BUTTON' && (!target.getAttribute('type') || target.getAttribute('type').toLowerCase() === 'submit');
                if (isImplicitSubmitButton || target.tagName === 'A') {
                    event.preventDefault();
                }
            }
            try {
                if (typeof window.runActionExpression === 'function') {
                    window.runActionExpression(expr, event, target);
                }
            } catch (e) {
                console.error(`Failed delegated handler for ${attrName}:`, e);
            }
        });
    };
    bindDelegatedHandler('click', 'data-onclick');
    bindDelegatedHandler('change', 'data-onchange');
    bindDelegatedHandler('keyup', 'data-onkeyup');
    bindDelegatedHandler('input', 'data-oninput');
    bindDelegatedHandler('keypress', 'data-onkeypress');

    setCurrentUsername();
}

document.addEventListener('DOMContentLoaded', () => {
    initBaseChrome();

    if (typeof loadDashboard === 'function' && (document.getElementById('lists-grid') || document.getElementById('hubs-grid'))) {
        loadDashboard();
    }
    if (typeof ensureServiceWorkerRegistered === 'function' && document.getElementById('calendar-page')) {
        ensureServiceWorkerRegistered();
    }

    const modal = document.getElementById('calendar-prompt-modal');
    if (modal) modal.classList.add('is-hidden');

    // ===== ANDROID KEYBOARD HANDLING =====
    // Directly manipulate modal heights based on visual viewport (more reliable than CSS dvh/svh)
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        let initialHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        let keyboardOpen = false;
        let rafId = null;

        // Force WebView to repaint an element (fixes Android WebView rendering bugs)
        const forceRepaint = (element) => {
            if (!element) return;
            // Trigger reflow by reading offsetHeight
            void element.offsetHeight;
            // Toggle opacity to force repaint
            element.style.opacity = '0.999';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    element.style.opacity = '1';
                });
            });
        };

        const adjustModalsForKeyboard = (viewportHeight) => {
            const addModal = document.getElementById('add-item-modal');
            const aiPanel = document.getElementById('ai-panel');

            // Adjust add-item-modal
            if (addModal && addModal.classList.contains('active')) {
                const modalContent = addModal.querySelector('.modal-content');
                if (modalContent) {
                    // Set explicit height based on viewport
                    addModal.style.height = viewportHeight + 'px';
                    modalContent.style.maxHeight = (viewportHeight - 20) + 'px';

                    // Force repaint to fix WebView rendering bug
                    forceRepaint(modalContent);

                    // Scroll focused input into view within modal
                    const focused = modalContent.querySelector(':focus');
                    if (focused) {
                        setTimeout(() => {
                            focused.scrollIntoView({ behavior: 'instant', block: 'nearest' });
                            // Force another repaint after scroll
                            forceRepaint(modalContent);
                        }, 50);
                    }
                }
            }

            // Adjust AI panel
            if (aiPanel && aiPanel.classList.contains('open')) {
                const maxH = Math.min(viewportHeight * 0.7, viewportHeight - 20);
                aiPanel.style.maxHeight = maxH + 'px';

                // Shrink messages when keyboard is open
                const messages = aiPanel.querySelector('.ai-messages');
                if (messages && keyboardOpen) {
                    messages.style.maxHeight = '80px';
                    messages.style.minHeight = '50px';
                }

                // Force repaint
                forceRepaint(aiPanel);
            }
        };

        const resetModalStyles = () => {
            const addModal = document.getElementById('add-item-modal');
            const aiPanel = document.getElementById('ai-panel');

            if (addModal) {
                addModal.style.height = '';
                const modalContent = addModal.querySelector('.modal-content');
                if (modalContent) modalContent.style.maxHeight = '';
            }

            if (aiPanel) {
                aiPanel.style.maxHeight = '';
                const messages = aiPanel.querySelector('.ai-messages');
                if (messages) {
                    messages.style.maxHeight = '';
                    messages.style.minHeight = '';
                }
            }
        };

        const handleViewportChange = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                const currentHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
                const heightDiff = initialHeight - currentHeight;
                const isKeyboardNowOpen = heightDiff > 150;

                if (isKeyboardNowOpen !== keyboardOpen) {
                    keyboardOpen = isKeyboardNowOpen;
                    document.body.classList.toggle('keyboard-open', keyboardOpen);
                }

                if (keyboardOpen) {
                    adjustModalsForKeyboard(currentHeight);
                } else {
                    resetModalStyles();
                }
            });
        };

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', handleViewportChange);
            window.visualViewport.addEventListener('scroll', handleViewportChange);
        }

        // Also listen to window resize as fallback
        window.addEventListener('resize', handleViewportChange);

        // Update initial height on orientation change
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                initialHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
                keyboardOpen = false;
                resetModalStyles();
            }, 500);
        });

        // Re-adjust when modals open
        const originalOpenAddItemModal = window.openAddItemModal;
        if (typeof originalOpenAddItemModal === 'function') {
            window.openAddItemModal = function(...args) {
                originalOpenAddItemModal.apply(this, args);
                if (keyboardOpen) {
                    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
                    adjustModalsForKeyboard(vh);
                }
            };
        }

        // Force repaint while typing in modals (fixes WebView not painting text)
        let repaintDebounce = null;
        document.addEventListener('input', (e) => {
            if (!keyboardOpen) return;
            const target = e.target;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
                const modalWrap = target.closest('.modal-content') || target.closest('.ai-panel');
                if (modalWrap) {
                    // Debounce repaint calls
                    if (repaintDebounce) clearTimeout(repaintDebounce);
                    repaintDebounce = setTimeout(() => {
                        forceRepaint(modalWrap);
                    }, 100);
                }
            }
        }, true);

        // Also force repaint on focus changes within modals
        document.addEventListener('focusin', (e) => {
            if (!keyboardOpen) return;
            const target = e.target;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
                const modalWrap = target.closest('.modal-content') || target.closest('.ai-panel');
                if (modalWrap) {
                    setTimeout(() => forceRepaint(modalWrap), 100);
                }
            }
        }, true);
    }

    // Close modals on outside click
    document.addEventListener('click', (event) => {
        const createModalEl = document.getElementById('create-modal');
        if (event.target === createModalEl && typeof closeCreateModal === 'function') closeCreateModal();
        const addItemModalEl = document.getElementById('add-item-modal');
        if (event.target === addItemModalEl && typeof closeAddItemModal === 'function') closeAddItemModal();
        const bulkImportModalEl = document.getElementById('bulk-import-modal');
        if (event.target === bulkImportModalEl && typeof closeBulkImportModal === 'function') closeBulkImportModal();
        const moveItemModalEl = document.getElementById('move-item-modal');
        if (event.target === moveItemModalEl && typeof closeMoveModal === 'function') closeMoveModal();
        const editModal = document.getElementById('edit-item-modal');
        if (event.target === editModal && typeof closeEditItemModal === 'function') closeEditItemModal();
        const confirmModalEl = document.getElementById('confirm-modal');
        if (event.target === confirmModalEl && typeof closeConfirmModal === 'function') closeConfirmModal();
        const overlapWarningModalEl = document.getElementById('overlap-warning-modal');
        if (event.target === overlapWarningModalEl && typeof closeOverlapWarningModal === 'function') closeOverlapWarningModal();
        const editListModal = document.getElementById('edit-list-modal');
        if (event.target === editListModal && typeof closeEditListModal === 'function') closeEditListModal();
        const listSectionModal = document.getElementById('list-section-modal');
        if (event.target === listSectionModal && typeof closeListSectionModal === 'function') closeListSectionModal();

        const mainMenu = document.getElementById('phase-menu-main');
        if (!event.target.closest('.phase-add-dropdown')) {
            if (mainMenu) mainMenu.classList.remove('show');
        }
    });

    if (typeof initDragAndDrop === 'function') initDragAndDrop();
    if (typeof normalizePhaseParents === 'function') normalizePhaseParents();
    if (typeof organizePhaseDoneTasks === 'function') organizePhaseDoneTasks();
    if (typeof organizePhaseBlockedTasks === 'function') organizePhaseBlockedTasks();
    if (typeof organizeLightListDoneTasks === 'function') organizeLightListDoneTasks();
    if (typeof restorePhaseVisibility === 'function') restorePhaseVisibility();
    if (typeof initStickyListHeader === 'function') initStickyListHeader();
    if (typeof initTaskFilters === 'function') initTaskFilters();
    if (typeof initTagFilters === 'function') initTagFilters();
    if (typeof repositionLinkedNoteChips === 'function') repositionLinkedNoteChips();
    if (typeof applyTagColors === 'function') applyTagColors();
    initMobileTopbar();
    initSidebarReorder();
    if (typeof initNotesPage === 'function') initNotesPage();
    if (typeof initRecallsPage === 'function') initRecallsPage();
    if (typeof initAIPage === 'function') initAIPage();
    if (typeof initCalendarPage === 'function') initCalendarPage();
    if (typeof autoEnableCalendarNotificationsIfGranted === 'function') autoEnableCalendarNotificationsIfGranted();

    // Initialize task selection manager (unified with other modules)
    if (typeof initTaskSelection === 'function') initTaskSelection();
    if (typeof initTaskSelectionUI === 'function') initTaskSelectionUI();

    if (typeof initAIPanel === 'function') initAIPanel();
    if (typeof initAIDragLauncher === 'function') initAIDragLauncher();
    initHomepageReorder();
    let noteResizeTimer = null;
    window.addEventListener('resize', () => {
        if (noteResizeTimer) clearTimeout(noteResizeTimer);
        if (typeof repositionLinkedNoteChips === 'function') {
            noteResizeTimer = setTimeout(repositionLinkedNoteChips, 120);
        }
    });
});

function initStickyListHeader() {
    const header = document.querySelector('.list-header');
    if (!header) return;
    header.classList.add('sticky-header');

    let lastScroll = window.scrollY;
    window.addEventListener('scroll', () => {
        const current = window.scrollY;
        if (current > lastScroll + 10) {
            header.classList.add('header-hidden');
        } else if (current < lastScroll - 10) {
            header.classList.remove('header-hidden');
        }
        lastScroll = current;
    }, { passive: true });
}

function initMobileTopbar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const trigger = document.getElementById('mobile-menu-btn');
    if (!sidebar || !overlay || !trigger) return;

    const media = window.matchMedia('(max-width: 1024px)');

    function closeDrawer() {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', 'Open navigation');
    }

    function openDrawer() {
        sidebar.classList.add('open');
        overlay.classList.add('active');
        trigger.setAttribute('aria-expanded', 'true');
        trigger.setAttribute('aria-label', 'Close navigation');
    }

    window.toggleSidebarDrawer = (forceOpen) => {
        if (!media.matches) return;
        const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !sidebar.classList.contains('open');
        if (shouldOpen) openDrawer(); else closeDrawer();
    };

    trigger.addEventListener('click', () => toggleSidebarDrawer());
    overlay.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDrawer();
    });

    const handleMediaChange = () => {
        if (!media.matches) {
            closeDrawer();
            sidebar.style.transform = '';
        }
    };

    if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', handleMediaChange);
    } else if (typeof media.addListener === 'function') {
        media.addListener(handleMediaChange);
    }
}

function initSidebarReorder() {
    const navList = document.querySelector('.nav-links');
    if (!navList) return;

    let draggingEl = null;
    let touchDragItem = null;
    let touchDragActive = false;
    let touchDragMoved = false;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchHoldTimer = null;
    let ignoreNextNavClick = false;

    function applyOrder(order) {
        if (!Array.isArray(order) || !order.length) return;
        const items = Array.from(navList.querySelectorAll('li[data-nav-id]'));
        const map = new Map(items.map(item => [item.getAttribute('data-nav-id'), item]));
        order.forEach(id => {
            const item = map.get(id);
            if (item) navList.appendChild(item);
        });
    }

    function persistOrder() {
        const order = Array.from(navList.querySelectorAll('li[data-nav-id]'))
            .map(item => item.getAttribute('data-nav-id'))
            .filter(Boolean);
        fetch('/api/sidebar-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order })
        }).catch(err => console.error('Failed to save sidebar order:', err));
    }

    fetch('/api/sidebar-order')
        .then(r => r.json())
        .then(data => applyOrder(data.order || []))
        .catch(err => console.error('Failed to load sidebar order:', err));

    navList.addEventListener('click', (e) => {
        if (!ignoreNextNavClick) return;
        e.preventDefault();
        e.stopPropagation();
        ignoreNextNavClick = false;
    }, true);

    navList.querySelectorAll('li[data-nav-id]').forEach(item => {
        item.setAttribute('draggable', 'true');

        item.addEventListener('dragstart', (e) => {
            draggingEl = item;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', () => {
            if (draggingEl) draggingEl.classList.remove('dragging');
            draggingEl = null;
            persistOrder();
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            const target = e.currentTarget;
            if (!draggingEl || draggingEl === target) return;
            const rect = target.getBoundingClientRect();
            const shouldInsertAfter = e.clientY > rect.top + rect.height / 2;
            navList.insertBefore(draggingEl, shouldInsertAfter ? target.nextSibling : target);
        });

        item.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            touchDragMoved = false;
            touchDragActive = false;
            touchDragItem = item;
            touchHoldTimer = setTimeout(() => {
                touchDragActive = true;
                item.classList.add('dragging');
            }, 200);
        }, { passive: true });

        item.addEventListener('touchmove', (e) => {
            if (!touchDragItem) return;
            const touch = e.touches[0];
            const dx = Math.abs(touch.clientX - touchStartX);
            const dy = Math.abs(touch.clientY - touchStartY);
            if (!touchDragActive && (dx > 6 || dy > 6)) {
                clearTimeout(touchHoldTimer);
            }
            if (!touchDragActive) return;
            e.preventDefault();
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            const targetItem = target ? target.closest('li[data-nav-id]') : null;
            if (!targetItem || targetItem === touchDragItem) return;
            const rect = targetItem.getBoundingClientRect();
            const shouldInsertAfter = touch.clientY > rect.top + rect.height / 2;
            navList.insertBefore(touchDragItem, shouldInsertAfter ? targetItem.nextSibling : targetItem);
            touchDragMoved = true;
        }, { passive: false });

        item.addEventListener('touchend', () => {
            clearTimeout(touchHoldTimer);
            if (touchDragItem) touchDragItem.classList.remove('dragging');
            if (touchDragActive && touchDragMoved) {
                ignoreNextNavClick = true;
                persistOrder();
            }
            touchDragItem = null;
            touchDragActive = false;
            touchDragMoved = false;
        });
    });
}

let mouseHoldTimer = null;

function handleMouseHoldStart(e) {
    // Only trigger on left click
    if (e.button !== 0) return;
    const item = e.currentTarget;
    if (shouldIgnoreTaskSelection(e.target)) return;
    if (e.target.closest('.drag-handle') || e.target.closest('.task-actions-dropdown')) return;
    mouseHoldTimer = setTimeout(() => {
        mouseHoldTimer = null;
        const itemId = parseInt(item.dataset.itemId, 10);
        setTaskSelected(itemId, true);
        updateBulkBar();
    }, 500);
}

function handleMouseHoldEnd() {
    clearTimeout(mouseHoldTimer);
    mouseHoldTimer = null;
}

function initTaskSelectionUI() {
    const rows = document.querySelectorAll('.task-item');
    rows.forEach(row => {
        if (row.dataset.selectionBound === 'true') return;
        row.dataset.selectionBound = 'true';
        row.classList.add('selectable');
        row.addEventListener('touchstart', handleTouchStart, { passive: false });
        row.addEventListener('touchend', handleTouchEnd, { passive: false });
        row.addEventListener('touchmove', handleTouchMove, { passive: false });
        row.addEventListener('mousedown', handleMouseHoldStart);
        row.addEventListener('mouseup', handleMouseHoldEnd);
        row.addEventListener('mouseleave', handleMouseHoldEnd);
        row.addEventListener('click', handleTaskClick);
    });
}

