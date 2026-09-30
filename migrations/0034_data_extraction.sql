CREATE TABLE data_extraction_templates (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('docx', 'xlsx')),
  sample_source_record_id TEXT NOT NULL REFERENCES document_quarantine_records(id) ON DELETE RESTRICT,
  sample_sha256 TEXT NOT NULL,
  structure_sha256 TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  created_by TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_data_extraction_templates_space
  ON data_extraction_templates(space_id, created_at DESC, id);

CREATE TRIGGER trg_data_extraction_templates_space_source_insert
BEFORE INSERT ON data_extraction_templates
WHEN NOT EXISTS (
  SELECT 1
  FROM document_quarantine_records source
  JOIN files file ON file.id = source.file_id
  WHERE source.id = NEW.sample_source_record_id
    AND source.space_id = NEW.space_id
    AND source.format = NEW.format
    AND file.sha256 = NEW.sample_sha256
)
BEGIN
  SELECT RAISE(ABORT, 'data extraction template source belongs to another space or changed');
END;

CREATE TRIGGER trg_data_extraction_templates_immutable
BEFORE UPDATE ON data_extraction_templates
BEGIN
  SELECT RAISE(ABORT, 'data extraction template is immutable');
END;

CREATE TABLE data_extraction_runs (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES data_extraction_templates(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  template_snapshot_json TEXT NOT NULL,
  created_by TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(space_id, idempotency_key)
);

CREATE INDEX idx_data_extraction_runs_space
  ON data_extraction_runs(space_id, created_at DESC, id);

CREATE TRIGGER trg_data_extraction_runs_space_template_insert
BEFORE INSERT ON data_extraction_runs
WHEN NOT EXISTS (
  SELECT 1
  FROM data_extraction_templates template
  WHERE template.id = NEW.template_id
    AND template.space_id = NEW.space_id
)
BEGIN
  SELECT RAISE(ABORT, 'data extraction template belongs to another space');
END;

CREATE TRIGGER trg_data_extraction_runs_scope_immutable
BEFORE UPDATE OF space_id, template_id, idempotency_key ON data_extraction_runs
WHEN NEW.space_id <> OLD.space_id
  OR NEW.template_id <> OLD.template_id
  OR NEW.idempotency_key <> OLD.idempotency_key
BEGIN
  SELECT RAISE(ABORT, 'data extraction run scope is immutable');
END;

CREATE TABLE data_extraction_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES data_extraction_runs(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(position >= 0),
  source_record_id TEXT NOT NULL REFERENCES document_quarantine_records(id) ON DELETE RESTRICT,
  source_name TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  result_json TEXT NOT NULL,
  issues_json TEXT NOT NULL,
  corrections_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, source_record_id),
  UNIQUE(run_id, position)
);

CREATE INDEX idx_data_extraction_items_run
  ON data_extraction_items(run_id, position, id);

CREATE TRIGGER trg_data_extraction_items_space_source_insert
BEFORE INSERT ON data_extraction_items
WHEN NOT EXISTS (
  SELECT 1
  FROM data_extraction_runs run
  JOIN document_quarantine_records source ON source.id = NEW.source_record_id
  JOIN files file ON file.id = source.file_id
  WHERE run.id = NEW.run_id
    AND run.space_id = NEW.space_id
    AND source.space_id = NEW.space_id
    AND file.sha256 = NEW.source_sha256
)
BEGIN
  SELECT RAISE(ABORT, 'data extraction item crosses a space boundary or source changed');
END;

CREATE TRIGGER trg_data_extraction_items_scope_immutable
BEFORE UPDATE OF run_id, space_id, position, source_record_id, source_name, source_sha256, result_json, issues_json
ON data_extraction_items
WHEN NEW.run_id <> OLD.run_id
  OR NEW.space_id <> OLD.space_id
  OR NEW.position <> OLD.position
  OR NEW.source_record_id <> OLD.source_record_id
  OR NEW.source_name <> OLD.source_name
  OR NEW.source_sha256 <> OLD.source_sha256
  OR NEW.result_json <> OLD.result_json
  OR NEW.issues_json <> OLD.issues_json
BEGIN
  SELECT RAISE(ABORT, 'data extraction item source result is immutable');
END;
