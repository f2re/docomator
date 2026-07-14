-- Persistent SMTP delivery jobs for completed document results.
-- Applied migrations are immutable; add a new migration for later changes.

CREATE TABLE IF NOT EXISTS document_email_deliveries (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  document_job_id TEXT NOT NULL REFERENCES document_generation_jobs(id),
  worker_job_id TEXT NOT NULL REFERENCES worker_jobs(id),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (
    state IN ('pending', 'running', 'retry', 'completed', 'failed')
  ),
  source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
  attachment_name TEXT NOT NULL,
  attachment_bytes INTEGER NOT NULL CHECK (attachment_bytes >= 0),
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  subject TEXT NOT NULL,
  message_text TEXT NOT NULL,
  message_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE CHECK (length(dedupe_key) = 64),
  smtp_response TEXT,
  error_json TEXT,
  requested_by TEXT,
  correlation_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_email_deliveries_space
  ON document_email_deliveries(space_id, requested_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_document_email_deliveries_job
  ON document_email_deliveries(document_job_id, requested_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_document_email_deliveries_worker
  ON document_email_deliveries(worker_job_id);

CREATE TRIGGER IF NOT EXISTS trg_document_email_delivery_scope_insert
BEFORE INSERT ON document_email_deliveries
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM document_generation_jobs j
      JOIN files f ON f.sha256 = NEW.source_sha256
      WHERE j.id = NEW.document_job_id
        AND j.space_id = NEW.space_id
        AND j.state IN ('completed', 'partial')
        AND j.generated_count > 0
        AND f.size_bytes = NEW.attachment_bytes
    )
    THEN RAISE(ABORT, 'email delivery requires a completed result in the same space')
  END;
END;
