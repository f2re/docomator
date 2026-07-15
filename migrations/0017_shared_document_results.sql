-- Shared result inbox for manual and scheduled document generations.
-- Applied migrations are immutable; add a new migration for later changes.

CREATE TABLE IF NOT EXISTS document_result_items (
  id TEXT PRIMARY KEY,
  document_job_id TEXT NOT NULL UNIQUE REFERENCES document_generation_jobs(id),
  state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'viewed', 'collected', 'deleted')),
  origin TEXT NOT NULL CHECK (origin IN ('manual', 'schedule')),
  schedule_run_id TEXT REFERENCES document_schedule_runs(id),
  available_at TEXT NOT NULL,
  viewed_at TEXT,
  collected_at TEXT,
  deleted_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_result_items_state
  ON document_result_items(state, available_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_document_result_items_job
  ON document_result_items(document_job_id);

CREATE INDEX IF NOT EXISTS idx_document_result_items_schedule_run
  ON document_result_items(schedule_run_id);

INSERT OR IGNORE INTO document_result_items(
  id, document_job_id, state, origin, schedule_run_id,
  available_at, viewed_at, collected_at, deleted_at, updated_at
)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6))),
  j.id,
  'viewed',
  CASE WHEN sr.id IS NULL THEN 'manual' ELSE 'schedule' END,
  sr.id,
  COALESCE(j.completed_at, j.updated_at, j.created_at),
  COALESCE(j.completed_at, j.updated_at, j.created_at),
  NULL,
  NULL,
  COALESCE(j.completed_at, j.updated_at, j.created_at)
FROM document_generation_jobs j
LEFT JOIN document_schedule_runs sr ON sr.document_job_id = j.id
WHERE j.state IN ('completed', 'partial')
  AND j.generated_count > 0;

CREATE TRIGGER IF NOT EXISTS trg_document_result_after_generation
AFTER UPDATE OF state ON document_generation_jobs
WHEN NEW.state IN ('completed', 'partial')
  AND NEW.generated_count > 0
  AND OLD.state NOT IN ('completed', 'partial')
BEGIN
  INSERT OR IGNORE INTO document_result_items(
    id, document_job_id, state, origin, schedule_run_id,
    available_at, viewed_at, collected_at, deleted_at, updated_at
  )
  SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
    NEW.id,
    'new',
    CASE WHEN sr.id IS NULL THEN 'manual' ELSE 'schedule' END,
    sr.id,
    COALESCE(NEW.completed_at, NEW.updated_at),
    NULL,
    NULL,
    NULL,
    COALESCE(NEW.completed_at, NEW.updated_at)
  FROM (SELECT 1) seed
  LEFT JOIN document_schedule_runs sr ON sr.document_job_id = NEW.id
  LIMIT 1;
END;

-- Logical deletion removes every application-level file reference. The immutable
-- object may remain in content-addressed storage until a later garbage collection,
-- but neither the shared route nor legacy job routes can download it.
CREATE TRIGGER IF NOT EXISTS trg_document_result_after_delete
AFTER UPDATE OF state ON document_result_items
WHEN NEW.state = 'deleted' AND OLD.state <> 'deleted'
BEGIN
  UPDATE document_generation_units
  SET output_file_id = NULL,
      output_sha256 = NULL,
      updated_at = NEW.updated_at
  WHERE job_id = NEW.document_job_id;

  UPDATE document_generation_jobs
  SET archive_file_id = NULL,
      archive_sha256 = NULL,
      updated_at = NEW.updated_at
  WHERE id = NEW.document_job_id;
END;
