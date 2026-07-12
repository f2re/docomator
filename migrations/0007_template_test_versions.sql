-- Immutable compiled templates and verified trial-render outputs.
-- Applied migrations are immutable; add a new migration for later changes.

CREATE TABLE IF NOT EXISTS template_test_versions (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  draft_id TEXT NOT NULL REFERENCES template_drafts(id),
  field_id TEXT NOT NULL REFERENCES template_draft_fields(id),
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  format TEXT NOT NULL CHECK (format IN ('docx', 'xlsx')),
  compiled_file_id TEXT NOT NULL REFERENCES files(id),
  trial_file_id TEXT NOT NULL REFERENCES files(id),
  compiled_sha256 TEXT NOT NULL CHECK (length(compiled_sha256) = 64),
  trial_sha256 TEXT NOT NULL CHECK (length(trial_sha256) = 64),
  technical_binding_json TEXT NOT NULL,
  sample_value_json TEXT NOT NULL,
  rendered_value TEXT NOT NULL,
  read_back_value TEXT NOT NULL,
  verification_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'tested' CHECK (status IN ('tested')),
  created_by TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(draft_id, version_number),
  UNIQUE(draft_id, field_id, compiled_sha256, trial_sha256, sample_value_json)
);

CREATE INDEX IF NOT EXISTS idx_template_test_versions_draft
  ON template_test_versions(draft_id, version_number DESC, id);

CREATE INDEX IF NOT EXISTS idx_template_test_versions_space
  ON template_test_versions(space_id, created_at DESC, id);

CREATE TRIGGER IF NOT EXISTS trg_template_test_version_space_insert
BEFORE INSERT ON template_test_versions
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM template_drafts d
      JOIN template_draft_fields f ON f.draft_id = d.id
      WHERE d.id = NEW.draft_id
        AND d.space_id = NEW.space_id
        AND d.status = 'draft'
        AND f.id = NEW.field_id
    )
    THEN RAISE(ABORT, 'template test version must belong to the same draft space')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_template_test_versions_immutable_update
BEFORE UPDATE ON template_test_versions
BEGIN
  SELECT RAISE(ABORT, 'template test versions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_template_test_versions_immutable_delete
BEFORE DELETE ON template_test_versions
BEGIN
  SELECT RAISE(ABORT, 'template test versions are immutable');
END;
