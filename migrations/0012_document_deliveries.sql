-- Delivery attempts for generated document results.
-- Applied migrations are immutable; add a new migration for later changes.

CREATE TABLE IF NOT EXISTS document_deliveries (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  document_job_id TEXT NOT NULL REFERENCES document_generation_jobs(id),
  channel TEXT NOT NULL CHECK (channel IN ('network_folder')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed', 'failed')),
  source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
  destination_relative TEXT NOT NULL,
  delivered_name TEXT,
  delivered_bytes INTEGER CHECK (delivered_bytes IS NULL OR delivered_bytes >= 0),
  error_json TEXT,
  requested_by TEXT,
  correlation_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(document_job_id, channel, source_sha256, destination_relative)
);

CREATE INDEX IF NOT EXISTS idx_document_deliveries_space
  ON document_deliveries(space_id, requested_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_document_deliveries_job
  ON document_deliveries(document_job_id, requested_at DESC, id);

CREATE TRIGGER IF NOT EXISTS trg_document_delivery_scope_insert
BEFORE INSERT ON document_deliveries
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM document_generation_jobs j
      WHERE j.id = NEW.document_job_id
        AND j.space_id = NEW.space_id
        AND j.state IN ('completed', 'partial')
        AND j.generated_count > 0
    )
    THEN RAISE(ABORT, 'document delivery requires a completed result in the same space')
  END;
END;
