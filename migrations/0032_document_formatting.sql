CREATE TABLE document_formatting_items (
  id TEXT PRIMARY KEY,
  worker_job_id TEXT NOT NULL REFERENCES worker_jobs(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_record_id TEXT NOT NULL REFERENCES document_quarantine_records(id) ON DELETE RESTRICT,
  original_name TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  source_size_bytes INTEGER NOT NULL CHECK (source_size_bytes >= 0),
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'completed', 'failed')),
  output_file_id TEXT REFERENCES files(id) ON DELETE RESTRICT,
  output_name TEXT,
  analysis_json TEXT,
  error_json TEXT,
  created_by TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(worker_job_id, source_record_id)
);

CREATE INDEX idx_document_formatting_space_job
  ON document_formatting_items(space_id, worker_job_id, created_at);

CREATE INDEX idx_document_formatting_job_state
  ON document_formatting_items(worker_job_id, state, created_at);

CREATE TRIGGER trg_document_formatting_items_space_source_insert
BEFORE INSERT ON document_formatting_items
WHEN NOT EXISTS (
  SELECT 1
  FROM document_quarantine_records source
  WHERE source.id = NEW.source_record_id
    AND source.space_id = NEW.space_id
)
BEGIN
  SELECT RAISE(ABORT, 'document formatting source belongs to another space');
END;

CREATE TRIGGER trg_document_formatting_items_scope_immutable
BEFORE UPDATE OF worker_job_id, space_id, source_record_id ON document_formatting_items
WHEN NEW.worker_job_id <> OLD.worker_job_id
  OR NEW.space_id <> OLD.space_id
  OR NEW.source_record_id <> OLD.source_record_id
BEGIN
  SELECT RAISE(ABORT, 'document formatting scope is immutable');
END;

CREATE TABLE publication_bibliography_sources (
  publication_entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_format TEXT NOT NULL CHECK(source_format IN ('bibtex', 'csl-json')),
  source_key TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  record_json TEXT NOT NULL,
  imported_by TEXT,
  correlation_id TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

CREATE INDEX idx_publication_bibliography_sources_space
  ON publication_bibliography_sources(space_id, imported_at DESC);

CREATE TRIGGER trg_publication_bibliography_sources_space_insert
BEFORE INSERT ON publication_bibliography_sources
WHEN NOT EXISTS (
  SELECT 1
  FROM space_entity_ownership ownership
  WHERE ownership.space_id = NEW.space_id
    AND ownership.entity_id = NEW.publication_entity_id
)
BEGIN
  SELECT RAISE(ABORT, 'publication bibliography source belongs to another space');
END;

CREATE TRIGGER trg_publication_bibliography_sources_scope_immutable
BEFORE UPDATE OF publication_entity_id, space_id ON publication_bibliography_sources
WHEN NEW.publication_entity_id <> OLD.publication_entity_id
  OR NEW.space_id <> OLD.space_id
BEGIN
  SELECT RAISE(ABORT, 'publication bibliography scope is immutable');
END;
