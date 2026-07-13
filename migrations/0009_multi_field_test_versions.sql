-- Multi-field tested versions coexist with legacy single-field tested versions.
-- Applied migrations are immutable; add a new migration for later changes.

CREATE TABLE IF NOT EXISTS template_multi_test_versions (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  draft_id TEXT NOT NULL REFERENCES template_drafts(id),
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  format TEXT NOT NULL CHECK (format IN ('docx', 'xlsx')),
  compiled_file_id TEXT NOT NULL REFERENCES files(id),
  trial_file_id TEXT NOT NULL REFERENCES files(id),
  compiled_sha256 TEXT NOT NULL CHECK (length(compiled_sha256) = 64),
  trial_sha256 TEXT NOT NULL CHECK (length(trial_sha256) = 64),
  sample_values_json TEXT NOT NULL,
  verification_json TEXT NOT NULL,
  field_count INTEGER NOT NULL CHECK (field_count >= 1 AND field_count <= 100),
  status TEXT NOT NULL DEFAULT 'tested' CHECK (status IN ('tested')),
  created_by TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(draft_id, version_number),
  UNIQUE(draft_id, compiled_sha256, trial_sha256, sample_values_json)
);

CREATE INDEX IF NOT EXISTS idx_template_multi_test_versions_space
  ON template_multi_test_versions(space_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_template_multi_test_versions_draft
  ON template_multi_test_versions(draft_id, version_number DESC, id);

CREATE TABLE IF NOT EXISTS template_multi_test_version_fields (
  test_version_id TEXT NOT NULL REFERENCES template_multi_test_versions(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES template_draft_fields(id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (
    value_type IN ('string', 'text', 'number', 'integer', 'boolean', 'date', 'date-time')
  ),
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  binding_json TEXT NOT NULL,
  technical_binding_json TEXT NOT NULL,
  sample_value_json TEXT NOT NULL,
  rendered_value TEXT NOT NULL,
  read_back_value TEXT NOT NULL,
  verification_json TEXT NOT NULL,
  PRIMARY KEY(test_version_id, field_id),
  UNIQUE(test_version_id, ordinal),
  UNIQUE(test_version_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_template_multi_test_version_fields_version
  ON template_multi_test_version_fields(test_version_id, ordinal, field_id);

CREATE TRIGGER IF NOT EXISTS trg_template_multi_test_version_space_insert
BEFORE INSERT ON template_multi_test_versions
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM template_drafts d
      WHERE d.id = NEW.draft_id
        AND d.space_id = NEW.space_id
        AND d.status = 'draft'
    )
    THEN RAISE(ABORT, 'multi-field test version must belong to a draft in the same space')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_template_multi_test_field_insert
BEFORE INSERT ON template_multi_test_version_fields
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM template_multi_test_versions v
      JOIN template_draft_fields f ON f.draft_id = v.draft_id
      WHERE v.id = NEW.test_version_id
        AND f.id = NEW.field_id
        AND f.field_key = NEW.field_key
        AND f.value_type = NEW.value_type
    )
    THEN RAISE(ABORT, 'multi-field tested field must belong to the same draft')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_template_multi_test_versions_immutable_update
BEFORE UPDATE ON template_multi_test_versions
BEGIN
  SELECT RAISE(ABORT, 'multi-field test versions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_template_multi_test_versions_immutable_delete
BEFORE DELETE ON template_multi_test_versions
BEGIN
  SELECT RAISE(ABORT, 'multi-field test versions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_template_multi_test_fields_immutable_update
BEFORE UPDATE ON template_multi_test_version_fields
BEGIN
  SELECT RAISE(ABORT, 'multi-field tested fields are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_template_multi_test_fields_immutable_delete
BEFORE DELETE ON template_multi_test_version_fields
BEGIN
  SELECT RAISE(ABORT, 'multi-field tested fields are immutable');
END;
