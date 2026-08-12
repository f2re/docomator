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
