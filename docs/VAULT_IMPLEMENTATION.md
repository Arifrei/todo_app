# Document Vault Implementation Plan

## Overview

Adding a document vault feature to the todo app that allows users to store, organize, and manage any type of file with custom titles and folder organization.

---

## Features

### Core Features
1. **File Upload** - Accept any file type (PDF, images, docs, videos, archives, etc.)
2. **Custom Titles** - Give each document a descriptive title (separate from filename)
3. **Folder Organization** - Nested folder hierarchy for organizing documents
4. **File Preview** - Preview common file types (images, PDFs, text) in-app
5. **Download** - Download original files with original or custom filename

### Organization Features
6. **Search** - Search by title, original filename, or file type
7. **Pinning** - Pin important documents for quick access
8. **Tags** - Optional tags for cross-folder categorization
9. **Sort Options** - Sort by title, date added, file size, file type
10. **Breadcrumb Navigation** - Navigate folder hierarchy easily

### Management Features
11. **Move/Copy** - Move documents between folders
12. **Rename** - Edit document titles and folder names
13. **Delete** - Soft delete with archive functionality
14. **Bulk Actions** - Select multiple items for batch operations

### UI/UX Features
15. **Drag & Drop Upload** - Drop files directly into the vault
16. **Grid/List View Toggle** - View as cards or compact list
17. **File Type Icons** - Visual indicators for different file types
18. **Storage Info** - Show file sizes and total storage used

---

## Database Schema

### DocumentFolder Table
```sql
CREATE TABLE document_folder (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    parent_id INTEGER,                    -- Self-reference for nesting
    name VARCHAR(120) NOT NULL,
    order_index INTEGER DEFAULT 0,
    archived_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Document Table
```sql
CREATE TABLE document (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    folder_id INTEGER,                    -- NULL = root level
    title VARCHAR(255) NOT NULL,          -- User-defined title
    original_filename VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(255) NOT NULL, -- UUID-based on disk
    file_type VARCHAR(100),               -- MIME type
    file_extension VARCHAR(20),           -- e.g., 'pdf', 'jpg'
    file_size INTEGER,                    -- Bytes
    tags TEXT,                            -- Comma-separated
    pinned BOOLEAN DEFAULT 0,
    pin_order INTEGER DEFAULT 0,
    archived_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## File Storage

- **Location**: `instance/vault/<user_id>/<uuid>.<ext>`
- **Naming**: UUID-based filenames to avoid conflicts
- **Original filename**: Stored in database for display/download
- **Max file size**: 50MB (configurable)

---

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/vault` | Render vault page |
| GET | `/api/vault/folders` | List folders (optional parent_id filter) |
| POST | `/api/vault/folders` | Create folder |
| PUT | `/api/vault/folders/<id>` | Update folder (rename) |
| DELETE | `/api/vault/folders/<id>` | Archive folder |
| GET | `/api/vault/documents` | List documents (optional folder_id filter) |
| POST | `/api/vault/documents` | Upload document (multipart form) |
| GET | `/api/vault/documents/<id>` | Get document metadata |
| PUT | `/api/vault/documents/<id>` | Update document (title, tags, folder) |
| DELETE | `/api/vault/documents/<id>` | Archive document |
| GET | `/api/vault/documents/<id>/download` | Download file |
| GET | `/api/vault/documents/<id>/preview` | Get preview (images, PDFs) |
| POST | `/api/vault/documents/<id>/move` | Move to different folder |
| GET | `/api/vault/search` | Search documents |
| GET | `/api/vault/stats` | Storage usage stats |

---

## File Type Categories

| Category | Extensions | Icon | Preview Support |
|----------|------------|------|-----------------|
| image | jpg, jpeg, png, gif, webp, svg, bmp, ico | fa-image | Yes (inline) |
| pdf | pdf | fa-file-pdf | Yes (embedded) |
| document | doc, docx, odt, rtf | fa-file-word | No |
| spreadsheet | xls, xlsx, ods, csv | fa-file-excel | No |
| presentation | ppt, pptx, odp | fa-file-powerpoint | No |
| text | txt, md, json, xml, yaml, yml | fa-file-lines | Yes |
| archive | zip, rar, 7z, tar, gz, bz2 | fa-file-zipper | No |
| audio | mp3, wav, ogg, flac, aac, m4a | fa-file-audio | Yes (player) |
| video | mp4, webm, mov, avi, mkv, wmv | fa-file-video | Yes (player) |
| code | js, py, html, css, java, cpp, etc. | fa-file-code | Yes (syntax) |
| other | * | fa-file | No |

---

## Implementation Progress

### Completed
- [x] **models.py** - Added `DocumentFolder` and `Document` models
  - DocumentFolder: id, user_id, parent_id, name, order_index, archived_at, timestamps
  - Document: id, user_id, folder_id, title, original_filename, stored_filename, file_type, file_extension, file_size, tags, pinned, pin_order, archived_at, timestamps
  - Helper methods: tag_list(), get_file_category(), format_file_size(), to_dict()

- [x] **migrate.py** - Added migration functions
  - ensure_document_folder_table()
  - ensure_document_table()
  - Added indexes on user_id and folder_id

### In Progress
- [ ] **migrate.py** - Call new migration functions in main()

### Pending
- [ ] **app.py** - Add vault route and API endpoints
  - File upload handling with UUID storage
  - MIME type detection
  - File size limits
  - Security validation

- [ ] **templates/vault.html** - Create vault UI
  - Folder sidebar/tree
  - Document grid/list view
  - Upload modal with drag & drop
  - Breadcrumb navigation
  - Search bar

- [ ] **static/app.js** - Add vault JavaScript
  - vaultState object
  - File upload with progress
  - Drag & drop handlers
  - Folder navigation
  - Grid/list toggle
  - Search functionality

- [ ] **static/style.css** - Add vault styles
  - Document cards
  - File type icons
  - Upload zone
  - Folder tree

- [ ] **templates/base.html** - Add Vault to sidebar

---

## UI Design

### Document Card (Grid View)
```
┌─────────────────────┐
│   [File Type Icon]  │
│      fa-file-pdf    │
├─────────────────────┤
│ Document Title      │
│ original-file.pdf   │
│ 2.4 MB · Jan 25     │
│ [Pin] [Download] [⋮]│
└─────────────────────┘
```

### List View Row
```
[Icon] | Document Title | original-file.pdf | 2.4 MB | Jan 25, 2026 | [Actions]
```

### Folder Structure
```
Vault (root)
├── Work/
│   ├── Projects/
│   │   └── Q1 Reports/
│   └── Contracts/
├── Personal/
└── Archives/
```

### Breadcrumb
```
Vault > Work > Projects > Q1 Reports
```

---

## Security Considerations

1. **File validation** - Check MIME types, reject dangerous executables
2. **Size limits** - Configurable max file size (default 50MB)
3. **Path traversal** - Sanitize filenames, use UUIDs for storage
4. **User isolation** - Files stored in user-specific directories
5. **Access control** - Verify user owns document before serving

---

## Files Modified/Created

| File | Status | Changes |
|------|--------|---------|
| models.py | Modified | Added DocumentFolder, Document models |
| migrate.py | Modified | Added migration functions |
| app.py | Pending | Add routes and API endpoints |
| templates/vault.html | Pending | New file - vault UI |
| templates/base.html | Pending | Add sidebar link |
| static/app.js | Pending | Add vault JavaScript |
| static/style.css | Pending | Add vault styles |

---

## Testing Checklist

- [ ] Create folder
- [ ] Create nested folder
- [ ] Rename folder
- [ ] Delete/archive folder
- [ ] Upload single file
- [ ] Upload multiple files
- [ ] Upload via drag & drop
- [ ] Set custom title on upload
- [ ] Edit document title
- [ ] Add/edit tags
- [ ] Move document to folder
- [ ] Pin/unpin document
- [ ] Download file
- [ ] Preview image
- [ ] Preview PDF
- [ ] Preview text file
- [ ] Search by title
- [ ] Search by filename
- [ ] Filter by file type
- [ ] Sort documents
- [ ] Grid/list view toggle
- [ ] Breadcrumb navigation
- [ ] Archive document
- [ ] View storage stats
