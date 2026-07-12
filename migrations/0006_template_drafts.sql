-- Draft templates and verified scalar field bindings.
-- Applied migrations are immutable; add a new migration for later changes.

CREATE TABLE IF NOT EXISTS template_drafts (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  source_record_id TEXT NOT NULL REFERENCES document_quarantine_records(id),
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('docx', 'xlsx')),
  source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
  structure_version INTEGER NOT NULL DEFAULT 1 CHECK (structure_version >= 1),
  structure_sha256 TEXT NOT NULL CHECK (length(structure_sha256) = 64),
  structure_json TEXT NOT NULL,
  structure_truncated INTEGER NOT NULL DEFAULT 0 CHECK (structure_truncated IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(space_id, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_template_drafts_space_updated
  ON template_drafts(space_id, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS template_draft_fields (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES template_drafts(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (
    value_type IN ('string', 'text', 'number', 'integer', 'boolean', 'date', 'date-time')
  ),
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  element_id TEXT NOT NULL,
  element_kind TEXT NOT NULL CHECK (element_kind IN ('paragraph', 'cell')),
  binding_json TEXT NOT NULL,
  original_preview TEXT NOT NULL DEFAULT '',
  structure_sha256 TEXT NOT NULL CHECK (length(structure_sha256) = 64),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(draft_id, field_key),
  UNIQUE(draft_id, element_id)
);

CREATE INDEX IF NOT EXISTS idx_template_draft_fields_draft
  ON template_draft_fields(draft_id, created_at, id);

CREATE TRIGGER IF NOT EXISTS trg_template_draft_source_space_insert
BEFORE INSERT ON template_drafts
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM document_quarantine_records q
      WHERE q.id = NEW.source_record_id
        AND q.space_id = NEW.space_id
    )
    THEN RAISE(ABORT, 'template draft source must belong to the same space')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_template_draft_fields_structure_insert
BEFORE INSERT ON template_draft_fields
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM template_drafts d
      WHERE d.id = NEW.draft_id
        AND d.structure_sha256 = NEW.structure_sha256
        AND d.status = 'draft'
    )
    THEN RAISE(ABORT, 'template draft field must match the current structure')
  END;
END;
