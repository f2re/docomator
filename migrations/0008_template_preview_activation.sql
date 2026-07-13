-- Persistent preview requests and append-only active template versions.
-- Applied migrations are immutable; add a new migration for later changes.

CREATE TABLE IF NOT EXISTS template_preview_requests (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  test_version_id TEXT NOT NULL REFERENCES template_test_versions(id),
  worker_job_id TEXT NOT NULL REFERENCES worker_jobs(id),
  request_attempt INTEGER NOT NULL DEFAULT 1 CHECK (request_attempt >= 1),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ready', 'failed')),
  preview_file_id TEXT REFERENCES files(id),
  preview_sha256 TEXT CHECK (preview_sha256 IS NULL OR length(preview_sha256) = 64),
  converter_json TEXT,
  error_json TEXT,
  requested_by TEXT,
  correlation_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(space_id, test_version_id)
);

CREATE INDEX IF NOT EXISTS idx_template_preview_requests_space
  ON template_preview_requests(space_id, requested_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_template_preview_requests_job
  ON template_preview_requests(worker_job_id);

CREATE TABLE IF NOT EXISTS template_active_versions (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  draft_id TEXT NOT NULL REFERENCES template_drafts(id),
  test_version_id TEXT NOT NULL REFERENCES template_test_versions(id),
  preview_request_id TEXT NOT NULL REFERENCES template_preview_requests(id),
  compiled_file_id TEXT NOT NULL REFERENCES files(id),
  preview_file_id TEXT NOT NULL REFERENCES files(id),
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('docx', 'xlsx')),
  manifest_json TEXT NOT NULL,
  activated_by TEXT,
  correlation_id TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  UNIQUE(draft_id, test_version_id),
  UNIQUE(draft_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_template_active_versions_space
  ON template_active_versions(space_id, activated_at DESC, id);

CREATE TABLE IF NOT EXISTS template_active_pointers (
  draft_id TEXT PRIMARY KEY REFERENCES template_drafts(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  active_version_id TEXT NOT NULL UNIQUE REFERENCES template_active_versions(id),
  updated_by TEXT,
  correlation_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_template_active_pointers_space
  ON template_active_pointers(space_id, updated_at DESC, draft_id);

CREATE TRIGGER IF NOT EXISTS trg_template_preview_space_insert
BEFORE INSERT ON template_preview_requests
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM template_test_versions v
      WHERE v.id = NEW.test_version_id
        AND v.space_id = NEW.space_id
    )
    THEN RAISE(ABORT, 'template preview must belong to the tested version space')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_template_preview_ready_update
BEFORE UPDATE OF state, preview_file_id, preview_sha256 ON template_preview_requests
WHEN NEW.state = 'ready'
BEGIN
  SELECT CASE
    WHEN NEW.preview_file_id IS NULL OR NEW.preview_sha256 IS NULL
    THEN RAISE(ABORT, 'ready template preview requires a verified file')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_template_active_version_insert
BEFORE INSERT ON template_active_versions
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM template_test_versions v
      JOIN template_drafts d ON d.id = v.draft_id
      JOIN template_preview_requests p
        ON p.test_version_id = v.id
       AND p.space_id = v.space_id
       AND p.state = 'ready'
      WHERE v.id = NEW.test_version_id
        AND v.space_id = NEW.space_id
        AND d.id = NEW.draft_id
        AND d.space_id = NEW.space_id
        AND p.id = NEW.preview_request_id
        AND v.compiled_file_id = NEW.compiled_file_id
        AND p.preview_file_id = NEW.preview_file_id
    )
    THEN RAISE(ABORT, 'active template version requires a ready preview in the same space')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_template_active_versions_immutable_update
BEFORE UPDATE ON template_active_versions
BEGIN
  SELECT RAISE(ABORT, 'active template versions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_template_active_versions_immutable_delete
BEFORE DELETE ON template_active_versions
BEGIN
  SELECT RAISE(ABORT, 'active template versions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_template_active_pointer_insert
BEFORE INSERT ON template_active_pointers
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM template_active_versions v
      WHERE v.id = NEW.active_version_id
        AND v.draft_id = NEW.draft_id
        AND v.space_id = NEW.space_id
    )
    THEN RAISE(ABORT, 'active template pointer must reference the same draft space')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_template_active_pointer_update
BEFORE UPDATE OF active_version_id, space_id ON template_active_pointers
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM template_active_versions v
      WHERE v.id = NEW.active_version_id
        AND v.draft_id = NEW.draft_id
        AND v.space_id = NEW.space_id
    )
    THEN RAISE(ABORT, 'active template pointer must reference the same draft space')
  END;
END;
