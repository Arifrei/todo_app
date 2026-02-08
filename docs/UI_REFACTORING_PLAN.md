# UI Cohesion Refactoring Plan

## Overview
Make the todo_app look and feel like a unified, cohesive application by standardizing UI patterns, fixing visual inconsistencies, and creating reusable components.

---

## Current State Analysis

### What's Already Consistent (Keep These)
- **Color palette** - Blue/purple gradients, emerald success, amber warning, red danger
- **Typography** - Inter font throughout, good size hierarchy
- **Shadow system** - 4-level system (sm, md, lg, xl) used correctly
- **Button styling** - Uniform across modules (gradients, sizing, radius)
- **Card design** - 2px borders, 16px radius, white backgrounds
- **Toast notifications** - Centralized, well-animated
- **Modal animations** - Consistent scale-up with backdrop blur

### Best-Looking Module: Tasks
The Tasks module has the most polished UI with:
- Sophisticated phase styling (gradient backgrounds, 6px left border)
- Clear status indicators (color-coded backgrounds)
- Rich visual hierarchy
- Smooth hover effects (4px translateX)
- Well-styled bulk action bar

---

## Key UI Inconsistencies to Fix

### 1. Empty States (HIGH PRIORITY)
**Problem:** 5+ different class names and markup patterns
```
.notes-empty-state, .calendar-empty, .recall-empty,
.recurring-empty, .note-chooser-empty, .empty-state
```

**Solution:** Create unified `.empty-state` component
```html
<div class="empty-state">
    <i class="fa-solid fa-icon"></i>
    <p>Message here</p>
    <button class="btn btn-primary">Optional action</button>
</div>
```

**Modules to update:**
- templates/notes.html
- templates/calendar.html
- templates/recalls.html
- templates/bookmarks.html
- templates/vault.html
- templates/planner.html
- static/app.js - All dynamic empty state rendering

---

### 2. Search Box Styling (HIGH PRIORITY)
**Problem:** Each module has different search box design
- Calendar: `.calendar-search-bar` with dedicated panel
- Vault: `.vault-search-box`
- Bookmarks: Simple input
- Notes: No search component

**Solution:** Create unified `.module-search` component
```css
.module-search {
    display: flex;
    align-items: center;
    background: var(--bg-color);
    border: 2px solid var(--border-color);
    border-radius: 12px;
    padding: 0.5rem 1rem;
}
.module-search input {
    border: none;
    background: transparent;
    flex: 1;
}
.module-search .search-icon { /* ... */ }
.module-search .clear-btn { /* ... */ }
```

---

### 3. Page Headers (MEDIUM PRIORITY)
**Problem:** Different header patterns per module
- `.list-header-compact` (Tasks list view)
- `.header-row` (Planner, Notes)
- `.calendar-month-header` (Calendar)
- Various custom headers

**Solution:** Create unified `.module-header` pattern
```html
<header class="module-header">
    <div class="module-header-left">
        <button class="btn-back">...</button>
        <h1>Title</h1>
    </div>
    <div class="module-header-right">
        <!-- FAB or action buttons -->
    </div>
</header>
```

---

### 4. FAB Component (MEDIUM PRIORITY)
**Problem:** 4+ separate implementations
- `.tasks-fab-container`
- `.notes-fab-container`
- `.planner-fab`
- `.vault-fab`

**Solution:** Unified `.module-fab` component
```css
.module-fab { position: relative; }
.module-fab-main {
    width: 40px; height: 40px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
}
.module-fab-options { /* Dropdown options */ }
.module-fab-option { /* Individual option */ }
```

```javascript
class ModuleFab {
    constructor(config) {
        this.container = config.container;
        this.options = config.options;
    }
    init() { /* ... */ }
    toggle() { /* ... */ }
}
```

---

### 5. Dropdown Toggle Classes (MEDIUM PRIORITY)
**Problem:** Mixed `.show` vs `.active` for same purpose

**Solution:** Standardize on `.active` class everywhere
- Update all dropdowns to use `.active`
- Single `toggleDropdown()` and `closeAllDropdowns()` functions

---

### 6. Error Handling (MEDIUM PRIORITY)
**Problem:** Mix of `alert()` and `showToast()` for errors

**Solution:** Replace all `alert()` calls with `showToast('message', 'error')`

**Find and replace in static/app.js:**
- `alert('Could not set date...')` → `showToast('...', 'error')`
- `alert('Select a note...')` → `showToast('...', 'warning')`
- All other `alert()` calls

---

### 7. Loading States (LOWER PRIORITY)
**Problem:** Inconsistent loading indicators
- Some use spinner in button
- Some disable button only
- Different "Loading..." text patterns

**Solution:** Create `showLoading()` and `hideLoading()` helpers
```javascript
function showLoading(element, message = 'Loading...') {
    element.dataset.originalContent = element.innerHTML;
    element.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${message}`;
    element.disabled = true;
}
function hideLoading(element) {
    element.innerHTML = element.dataset.originalContent;
    element.disabled = false;
}
```

---

### 8. Border Width Consistency (LOWER PRIORITY)
**Problem:** Some components use 1px borders, others 2px

**Solution:** Audit and standardize to 2px for cards/panels, 1px for inputs/subtle elements

---

### 9. Button Active/Press States (LOWER PRIORITY)
**Problem:** Missing `:active` styling on some buttons

**Solution:** Add to static/style.css:
```css
.btn-status:active,
.btn:active {
    transform: scale(0.98);
    box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
}
```

---

### 10. Section Headers with Underline (LOWER PRIORITY)
**Problem:** Tasks has nice gradient underline headers, other modules don't

**Solution:** Apply same pattern to section headers in Notes, Calendar, Vault
```css
.section-title {
    font-size: 1.5rem;
    font-weight: 700;
    position: relative;
}
.section-title::after {
    content: '';
    position: absolute;
    bottom: -4px;
    left: 0;
    width: 40px;
    height: 3px;
    background: linear-gradient(90deg, var(--primary-color), var(--secondary-color));
    border-radius: 2px;
}
```

---

### 11. Bulk Action UI (HIGH PRIORITY)
**Problem:** Bulk actions vastly differ between modules

**Current state:**
| Module | Selection UI | Bulk Bar | Bulk Delete | Bulk Status | Bulk Move | Bulk API |
|--------|--------------|----------|-------------|-------------|-----------|----------|
| Tasks | ✓ Checkboxes + select-all | ✓ `#bulk-actions` | ✓ | ✓ | ✓ | ✓ Centralized `/api/items/bulk` |
| Notes | ✓ Checkboxes | ✓ `#notes-bulk-actions` | ✓ | ✗ | ✓ | ✗ Individual calls |
| Calendar | ✓ Checkboxes | ✓ `#calendar-bulk-bar` | ✓ | ✓ | ✓ | ✗ Individual calls |
| Vault | ✗ None | ✗ None | ✗ | ✗ | ✗ | ✗ None |
| Bookmarks | ✗ None | ✗ None | ✗ | ✗ | ✗ | ✗ None |
| Planner | ✗ None | ✗ None | ✗ | ✗ | ✗ | ✗ None |

**Solution:** Create unified bulk action system

**A. Selection Manager (JS)**
```javascript
class SelectionManager {
    constructor(config) {
        this.containerId = config.containerId;
        this.selectedIds = new Set();
        this.onSelectionChange = config.onSelectionChange;
        this.bulkBarId = config.bulkBarId;
    }

    select(id) { this.selectedIds.add(id); this.updateUI(); }
    deselect(id) { this.selectedIds.delete(id); this.updateUI(); }
    toggle(id) { /* ... */ }
    selectAll(ids) { /* ... */ }
    deselectAll() { /* ... */ }
    getCount() { return this.selectedIds.size; }
    updateUI() { /* Show/hide bulk bar, update count */ }
}
```

**B. Unified Bulk Bar (CSS)**
```css
.bulk-bar {
    display: none;
    position: sticky;
    top: 0;
    background: linear-gradient(135deg, var(--indigo), var(--secondary-color));
    color: white;
    padding: 0.75rem 1rem;
    border-radius: 12px;
    align-items: center;
    gap: 1rem;
    z-index: 100;
}
.bulk-bar.active { display: flex; }
.bulk-bar-count { font-weight: 600; }
.bulk-bar-actions { display: flex; gap: 0.5rem; }
.bulk-bar-btn {
    background: rgba(255,255,255,0.2);
    border: none;
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    cursor: pointer;
}
```

**C. Bulk Actions Handler (JS)**
```javascript
class BulkActions {
    constructor(config) {
        this.apiEndpoint = config.apiEndpoint;
        this.selectionManager = config.selectionManager;
        this.onComplete = config.onComplete;
    }

    async execute(action, params = {}) {
        const ids = [...this.selectionManager.selectedIds];
        const res = await fetch(this.apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, action, ...params })
        });
        const data = await res.json();
        showToast(`${data.updated || data.deleted} items updated`, 'success');
        this.selectionManager.deselectAll();
        this.onComplete();
    }

    async delete() { await this.execute('delete'); }
    async archive() { await this.execute('archive'); }
    async move(destinationId) { await this.execute('move', { destination_id: destinationId }); }
    async pin() { await this.execute('pin'); }
}
```

**D. Add Bulk API Endpoints**
Create centralized bulk endpoints for modules that lack them:
- `POST /api/notes/bulk` - delete, archive, pin, move
- `POST /api/calendar/events/bulk` - delete, status, move day
- `POST /api/vault/documents/bulk` - delete, archive, move
- `POST /api/bookmarks/bulk` - delete, pin

**E. Add Selection UI to Missing Modules**
- **Vault**: Add checkboxes to documents, add bulk bar
- **Bookmarks**: Add checkboxes to items, add bulk bar
- **Planner**: Consider adding (lower priority)

---

## Implementation Order

| Priority | Task | Files | Effort |
|----------|------|-------|--------|
| 1 | **Create SelectionManager & BulkActions classes** | app.js | High |
| 2 | **Create unified .bulk-bar CSS** | style.css | Medium |
| 3 | **Refactor Tasks bulk to use new classes** | app.js | Medium |
| 4 | **Refactor Notes bulk to use new classes** | app.js | Medium |
| 5 | **Refactor Calendar bulk to use new classes** | app.js | Medium |
| 6 | **Add bulk UI to Vault** | app.js, vault.js, vault.html, app.py | High |
| 7 | **Add bulk UI to Bookmarks** | app.js, bookmarks.html, app.py | High |
| 8 | Unify empty states | style.css, app.js, all templates | Medium |
| 9 | Standardize search boxes | style.css, app.js, templates | Medium |
| 10 | Create ModuleFab class | app.js, vault.js | Medium |
| 11 | Consolidate FAB CSS | style.css | Low |
| 12 | Unify page headers | style.css, templates | Medium |
| 13 | Fix dropdown toggle classes | app.js, style.css | Low |
| 14 | Replace alerts with toasts | app.js | Low |
| 15 | Add loading state helpers | app.js | Low |
| 16 | Fix border consistency | style.css | Low |
| 17 | Add button active states | style.css | Low |
| 18 | Apply section header styling | style.css | Low |

---

## Detailed Implementation Steps

### Step 1: Bulk Action System (Highest Priority)

**1.1 Create SelectionManager class**
- Extract pattern from Tasks module (`selectedItems` Set, `setTaskSelected()`, `updateBulkBar()`)
- Make it generic and reusable
- Handle: select, deselect, toggle, selectAll, deselectAll, getCount, updateUI

**1.2 Create BulkActions class**
- Handle API calls with unified pattern
- Methods: delete(), archive(), move(), pin(), updateStatus()
- Show confirmation modal before destructive actions
- Show toast on completion

**1.3 Create unified .bulk-bar CSS**
- Use Tasks' bulk bar styling as base (indigo gradient, sticky positioning)
- Standard classes: `.bulk-bar`, `.bulk-bar-count`, `.bulk-bar-actions`, `.bulk-bar-btn`

**1.4 Refactor existing modules to use new classes**
- Tasks: Replace `selectedItems` Set with `SelectionManager` instance
- Notes: Replace `selectedNotes` Set with `SelectionManager` instance
- Calendar: Replace `calendarSelection.ids` with `SelectionManager` instance

**1.5 Add bulk endpoints to backend (app.py)**
- `POST /api/notes/bulk` - actions: delete, archive, pin, move
- `POST /api/calendar/events/bulk` - actions: delete, status, move_day
- `POST /api/vault/documents/bulk` - actions: delete, archive, move
- `POST /api/bookmarks/bulk` - actions: delete, pin

**1.6 Add bulk UI to Vault**
- Add checkboxes to document items
- Add select-all checkbox
- Add `.bulk-bar` with delete, move, archive buttons
- Wire up to `SelectionManager` and `BulkActions`

**1.7 Add bulk UI to Bookmarks**
- Add checkboxes to bookmark items
- Add select-all checkbox
- Add `.bulk-bar` with delete, pin buttons
- Wire up to `SelectionManager` and `BulkActions`

---

### Step 2: Empty States
1. Create unified `.empty-state` CSS class
2. Create `renderEmptyState(container, icon, message, action)` JS helper
3. Update each module to use the helper:
   - Notes empty state
   - Calendar day empty
   - Recalls empty
   - Bookmarks empty
   - Vault folder empty
   - Planner empty
   - Note list chooser empty

### Step 3: Search Component
1. Create `.module-search` CSS
2. Create `ModuleSearch` JS class with debounced input
3. Replace in Calendar (`.calendar-search-bar`)
4. Replace in Vault (`.vault-search-box`)
5. Add to Bookmarks (currently basic)
6. Consider adding to Notes

### Step 4: FAB Component
1. Create `ModuleFab` class in app.js
2. Extract best implementation (Tasks FAB)
3. Create `.module-fab` CSS (consolidate from 4 implementations)
4. Refactor Tasks to use new class
5. Refactor Notes to use new class
6. Refactor Vault to use new class
7. Refactor Planner to use new class

### Step 5: Page Headers
1. Create `.module-header` CSS
2. Apply to list_view.html
3. Apply to notes.html
4. Apply to calendar.html
5. Apply to vault.html
6. Apply to planner.html
7. Apply to bookmarks.html

### Step 6: Remaining Fixes
1. Fix dropdown toggle classes (standardize on `.active`)
2. Replace all `alert()` with `showToast()`
3. Add `showLoading()` / `hideLoading()` helpers
4. Fix border consistency (2px for cards, 1px for inputs)
5. Add button `:active` press states
6. Apply section header gradient underline styling

---

## Files to Modify

### Backend (for bulk API endpoints)
- app.py - Add bulk endpoints for Notes, Calendar, Vault, Bookmarks

### Primary Frontend Files
- static/style.css - CSS consolidation (~13K lines)
- static/app.js - JS components: SelectionManager, BulkActions, ModuleFab, ModuleSearch (~17K lines)
- static/vault.js - Vault bulk UI + FAB refactor

### Templates (add bulk UI)
- templates/vault.html - Add checkboxes, bulk bar
- templates/bookmarks.html - Add checkboxes, bulk bar

### Templates (other UI fixes)
- templates/notes.html
- templates/calendar.html
- templates/planner.html
- templates/recalls.html
- templates/list_view.html
- templates/feed.html
- templates/quick_access.html

---

## Verification

After each step:
1. Open each affected module in browser
2. Check visual consistency
3. Test interactions (hover, click, empty states)
4. Check browser console for errors
5. Test on mobile viewport

### Bulk Action Testing
1. **Tasks**: Select multiple items → bulk delete, status change, move, add tag
2. **Notes**: Select multiple notes → bulk delete, archive, pin, move to folder
3. **Calendar**: Select multiple events → bulk delete, status change, move day
4. **Vault**: Select multiple documents → bulk delete, archive, move to folder
5. **Bookmarks**: Select multiple items → bulk delete, pin/unpin
6. Test select-all checkbox in each module
7. Test that bulk bar shows/hides correctly with selection count
8. Test confirmation modals appear before destructive actions

### Final Verification
1. Navigate through all modules - do they feel unified?
2. Check empty states look identical everywhere
3. Check search boxes look identical
4. Check FABs work the same way
5. Check headers have consistent styling
6. Check bulk action bars look and work identically
7. Check selection UI (checkboxes) is consistent
8. No more alert() popups - all toasts
