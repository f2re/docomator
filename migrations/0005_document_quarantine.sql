-- Immutable quarantine records for checked DOCX/XLSX source files.
-- Accepted source files are stored by SHA-256 and remain scoped to one space.

CREATE TABLE IF NOT EXISTS document_quarantine_records (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  file_id TEXT NOT NULL REFERENCES files(id),
  original_name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('docx', 'xlsx')),
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'accepted_with_warnings')),
  report_json TEXT NOT NULL,
  created_by TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(space_id, file_id)
);

CREATE INDEX IF NOT EXISTS idx_document_quarantine_space_created
  ON document_quarantine_records(space_id, created_at DESC, id);

CREATE TRIGGER IF NOT EXISTS trg_document_quarantine_records_no_update
BEFORE UPDATE ON document_quarantine_records
BEGIN
  SELECT RAISE(ABORT, 'document quarantine records are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_document_quarantine_records_no_delete
BEFORE DELETE ON document_quarantine_records
BEGIN
  SELECT RAISE(ABORT, 'document quarantine records are immutable');
END;
