-- Product document generation jobs for aggregate and one-per-member output.
-- Applied migrations are immutable; add a new migration for later changes.

CREATE TABLE IF NOT EXISTS document_generation_jobs (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  active_release_id TEXT NOT NULL REFERENCES template_releases(id),
  snapshot_id TEXT NOT NULL REFERENCES audience_snapshots(id),
  target_mode TEXT NOT NULL CHECK (target_mode IN ('one_per_member', 'aggregate')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (
    state IN ('pending', 'running', 'completed', 'partial', 'failed')
  ),
  expected_count INTEGER NOT NULL CHECK (expected_count >= 1 AND expected_count <= 1000),
  generated_count INTEGER NOT NULL DEFAULT 0 CHECK (generated_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  worker_job_id TEXT NOT NULL REFERENCES worker_jobs(id),
  idempotency_key TEXT,
  archive_file_id TEXT REFERENCES files(id),
  archive_sha256 TEXT CHECK (archive_sha256 IS NULL OR length(archive_sha256) = 64),
  error_json TEXT,
  created_by TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(space_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_document_generation_jobs_space
  ON document_generation_jobs(space_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_document_generation_jobs_worker
  ON document_generation_jobs(worker_job_id);

CREATE TABLE IF NOT EXISTS document_generation_units (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES document_generation_jobs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  unit_key TEXT NOT NULL,
  primary_entity_id TEXT REFERENCES entities(id),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (
    state IN ('pending', 'running', 'completed', 'failed')
  ),
  output_file_id TEXT REFERENCES files(id),
  output_sha256 TEXT CHECK (output_sha256 IS NULL OR length(output_sha256) = 64),
  output_name TEXT,
  error_json TEXT,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id, position),
  UNIQUE(job_id, unit_key)
);

CREATE INDEX IF NOT EXISTS idx_document_generation_units_job
  ON document_generation_units(job_id, position, id);

CREATE TRIGGER IF NOT EXISTS trg_document_generation_job_scope_insert
BEFORE INSERT ON document_generation_jobs
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM template_releases r
      JOIN audience_snapshots s ON s.id = NEW.snapshot_id
      WHERE r.id = NEW.active_release_id
        AND r.space_id = NEW.space_id
        AND s.space_id = NEW.space_id
        AND s.target_mode = NEW.target_mode
    )
    THEN RAISE(ABORT, 'document generation requires an active template and audience snapshot in the same space')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_document_generation_unit_insert
BEFORE INSERT ON document_generation_units
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM document_generation_jobs j
      WHERE j.id = NEW.job_id
        AND (
          (j.target_mode = 'aggregate' AND NEW.primary_entity_id IS NULL)
          OR
          (j.target_mode = 'one_per_member' AND NEW.primary_entity_id IS NOT NULL AND EXISTS (
            SELECT 1
            FROM audience_snapshot_members sm
            WHERE sm.snapshot_id = j.snapshot_id
              AND sm.entity_id = NEW.primary_entity_id
          ))
        )
    )
    THEN RAISE(ABORT, 'document generation unit does not match the audience plan')
  END;
END;
