-- Unified release candidates, previews and active releases for both single- and multi-field tested versions.
-- Legacy preview and active tables remain unchanged for migration compatibility.
-- Applied migrations are immutable; add a new migration for later changes.

CREATE TABLE IF NOT EXISTS template_release_candidates (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('single', 'multi')),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  draft_id TEXT NOT NULL REFERENCES template_drafts(id),
  source_version_number INTEGER NOT NULL CHECK (source_version_number >= 1),
  format TEXT NOT NULL CHECK (format IN ('docx', 'xlsx')),
  compiled_file_id TEXT NOT NULL REFERENCES files(id),
  trial_file_id TEXT NOT NULL REFERENCES files(id),
  compiled_sha256 TEXT NOT NULL CHECK (length(compiled_sha256) = 64),
  trial_sha256 TEXT NOT NULL CHECK (length(trial_sha256) = 64),
  field_count INTEGER NOT NULL CHECK (field_count >= 1 AND field_count <= 100),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_template_release_candidates_space
  ON template_release_candidates(space_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_template_release_candidates_draft
  ON template_release_candidates(draft_id, source_version_number DESC, id);

CREATE TABLE IF NOT EXISTS template_release_candidate_fields (
  candidate_id TEXT NOT NULL REFERENCES template_release_candidates(id),
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
  PRIMARY KEY(candidate_id, field_id),
  UNIQUE(candidate_id, ordinal),
  UNIQUE(candidate_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_template_release_candidate_fields_candidate
  ON template_release_candidate_fields(candidate_id, ordinal, field_id);

INSERT INTO template_release_candidates(
  id, kind, space_id, draft_id, source_version_number, format,
  compiled_file_id, trial_file_id, compiled_sha256, trial_sha256,
  field_count, created_at
)
SELECT
  id, 'single', space_id, draft_id, version_number, format,
  compiled_file_id, trial_file_id, compiled_sha256, trial_sha256,
  1, created_at
FROM template_test_versions;

INSERT INTO template_release_candidates(
  id, kind, space_id, draft_id, source_version_number, format,
  compiled_file_id, trial_file_id, compiled_sha256, trial_sha256,
  field_count, created_at
)
SELECT
  id, 'multi', space_id, draft_id, version_number, format,
  compiled_file_id, trial_file_id, compiled_sha256, trial_sha256,
  field_count, created_at
FROM template_multi_test_versions;

INSERT INTO template_release_candidate_fields(
  candidate_id, field_id, ordinal, field_key, field_label,
  value_type, required, binding_json, technical_binding_json
)
SELECT
  v.id, f.id, 0, f.field_key, f.label,
  f.value_type, f.required, f.binding_json, v.technical_binding_json
FROM template_test_versions v
JOIN template_draft_fields f ON f.id = v.field_id;

INSERT INTO template_release_candidate_fields(
  candidate_id, field_id, ordinal, field_key, field_label,
  value_type, required, binding_json, technical_binding_json
)
SELECT
  test_version_id, field_id, ordinal, field_key, field_label,
  value_type, required, binding_json, technical_binding_json
FROM template_multi_test_version_fields;

CREATE TRIGGER IF NOT EXISTS trg_template_release_candidate_insert
BEFORE INSERT ON template_release_candidates
BEGIN
  SELECT CASE
    WHEN NEW.kind = 'single' AND NOT EXISTS (
      SELECT 1
      FROM template_test_versions v
      WHERE v.id = NEW.id
        AND v.space_id = NEW.space_id
        AND v.draft_id = NEW.draft_id
        AND v.version_number = NEW.source_version_number
        AND v.format = NEW.format
        AND v.compiled_file_id = NEW.compiled_file_id
        AND v.trial_file_id = NEW.trial_file_id
        AND v.compiled_sha256 = NEW.compiled_sha256
        AND v.trial_sha256 = NEW.trial_sha256
    )
    THEN RAISE(ABORT, 'single release candidate must match its tested version')
  END;
  SELECT CASE
    WHEN NEW.kind = 'multi' AND NOT EXISTS (
      SELECT 1
      FROM template_multi_test_versions v
      WHERE v.id = NEW.id
        AND v.space_id = NEW.space_id
        AND v.draft_id = NEW.draft_id
        AND v.version_number = NEW.source_version_number
        AND v.format = NEW.format
        AND v.compiled_file_id = NEW.compiled_file_id
        AND v.trial_file_id = NEW.trial_file_id
        AND v.compiled_sha256 = NEW.compiled_sha256
        AND v.trial_sha256 = NEW.trial_sha256
        AND v.field_count = NEW.field_count
    )
    THEN RAISE(ABORT, 'multi release candidate must match its tested version')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_template_release_candidate_field_insert
BEFORE INSERT ON template_release_candidate_fields
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM template_release_candidates c
      WHERE c.id = NEW.candidate_id
        AND c.kind = 'single'
    ) AND NOT EXISTS (
      SELECT 1
      FROM template_release_candidates c
      JOIN template_test_versions v
        ON v.id = c.id
       AND v.field_id = NEW.field_id
      JOIN template_draft_fields f
        ON f.id = v.field_id
       AND f.draft_id = c.draft_id
      WHERE c.id = NEW.candidate_id
        AND NEW.ordinal = 0
        AND f.field_key = NEW.field_key
        AND f.label = NEW.field_label
        AND f.value_type = NEW.value_type
        AND f.required = NEW.required
        AND f.binding_json = NEW.binding_json
        AND v.technical_binding_json = NEW.technical_binding_json
    )
    THEN RAISE(ABORT, 'single release candidate field must match its tested version')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM template_release_candidates c
      WHERE c.id = NEW.candidate_id
        AND c.kind = 'multi'
    ) AND NOT EXISTS (
      SELECT 1
      FROM template_release_candidates c
      JOIN template_multi_test_version_fields f
        ON f.test_version_id = c.id
       AND f.field_id = NEW.field_id
      WHERE c.id = NEW.candidate_id
        AND f.ordinal = NEW.ordinal
        AND f.field_key = NEW.field_key
        AND f.field_label = NEW.field_label
        AND f.value_type = NEW.value_type
        AND f.required = NEW.required
        AND f.binding_json = NEW.binding_json
        AND f.technical_binding_json = NEW.technical_binding_json
    )
    THEN RAISE(ABORT, 'multi release candidate field must match its tested version')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_template_test_version_release_candidate
AFTER INSERT ON template_test_versions
BEGIN
  INSERT INTO template_release_candidates(
    id, kind, space_id, draft_id, source_version_number, format,
    compiled_file_id, trial_file_id, compiled_sha256, trial_sha256,
    field_count, created_at
  ) VALUES (
    NEW.id, 'single', NEW.space_id, NEW.draft_id, NEW.version_number, NEW.format,
    NEW.compiled_file_id, NEW.trial_file_id, NEW.compiled_sha256, NEW.trial_sha256,
    1, NEW.created_at
  );

  INSERT INTO template_release_candidate_fields(
    candidate_id, field_id, ordinal, field_key, field_label,
    value_type, required, binding_json, technical_binding_json
  )
  SELECT
    NEW.id, f.id, 0, f.field_key, f.label,
    f.value_type, f.required, f.binding_json, NEW.technical_binding_json
  FROM template_draft_fields f
  WHERE f.id = NEW.field_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_template_multi_test_version_release_candidate
AFTER INSERT ON template_multi_test_versions
BEGIN
  INSERT INTO template_release_candidates(
    id, kind, space_id, draft_id, source_version_number, format,
    compiled_file_id, trial_file_id, compiled_sha256, trial_sha256,
    field_count, created_at
  ) VALUES (
    NEW.id, 'multi', NEW.space_id, NEW.draft_id, NEW.version_number, NEW.format,
    NEW.compiled_file_id, NEW.trial_file_id, NEW.compiled_sha256, NEW.trial_sha256,
    NEW.field_count, NEW.created_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_template_multi_test_field_release_candidate
AFTER INSERT ON template_multi_test_version_fields
BEGIN
  INSERT INTO template_release_candidate_fields(
    candidate_id, field_id, ordinal, field_key, field_label,
    value_type, required, binding_json, technical_binding_json
  ) VALUES (
    NEW.test_version_id, NEW.field_id, NEW.ordinal, NEW.field_key, NEW.field_label,
    NEW.value_type, NEW.required, NEW.binding_json, NEW.technical_binding_json
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_template_release_candidates_immutable_update
BEFORE UPDATE ON template_release_candidates
BEGIN
  SELECT RAISE(ABORT, 'template release candidates are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_template_release_candidates_immutable_delete
BEFORE DELETE ON template_release_candidates
BEGIN
  SELECT RAISE(ABORT, 'template release candidates are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_template_release_candidate_fields_immutable_update
BEFORE UPDATE ON template_release_candidate_fields
BEGIN
  SELECT RAISE(ABORT, 'template release candidate fields are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_template_release_candidate_fields_immutable_delete
BEFORE DELETE ON template_release_candidate_fields
BEGIN
  SELECT RAISE(ABORT, 'template release candidate fields are immutable');
END;

CREATE TABLE IF NOT EXISTS template_release_previews (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  candidate_id TEXT NOT NULL REFERENCES template_release_candidates(id),
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
  UNIQUE(space_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_template_release_previews_space
  ON template_release_previews(space_id, requested_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_template_release_previews_job
  ON template_release_previews(worker_job_id);

INSERT INTO template_release_previews(
  id, space_id, candidate_id, worker_job_id, request_attempt,
  state, preview_file_id, preview_sha256, converter_json, error_json,
  requested_by, correlation_id, requested_at, completed_at, updated_at
)
SELECT
  id, space_id, test_version_id, worker_job_id, request_attempt,
  state, preview_file_id, preview_sha256, converter_json, error_json,
  requested_by, correlation_id, requested_at, completed_at, updated_at
FROM template_preview_requests;

CREATE TRIGGER IF NOT EXISTS trg_template_release_preview_space_insert
BEFORE INSERT ON template_release_previews
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM template_release_candidates c
      WHERE c.id = NEW.candidate_id
        AND c.space_id = NEW.space_id
    )
    THEN RAISE(ABORT, 'template release preview must belong to the candidate space')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_template_release_preview_ready_update
BEFORE UPDATE OF state, preview_file_id, preview_sha256 ON template_release_previews
WHEN NEW.state = 'ready'
BEGIN
  SELECT CASE
    WHEN NEW.preview_file_id IS NULL OR NEW.preview_sha256 IS NULL
    THEN RAISE(ABORT, 'ready template release preview requires a verified file')
  END;
END;

CREATE TABLE IF NOT EXISTS template_releases (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  draft_id TEXT NOT NULL REFERENCES template_drafts(id),
  candidate_id TEXT NOT NULL REFERENCES template_release_candidates(id),
  preview_request_id TEXT NOT NULL REFERENCES template_release_previews(id),
  compiled_file_id TEXT NOT NULL REFERENCES files(id),
  preview_file_id TEXT NOT NULL REFERENCES files(id),
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('docx', 'xlsx')),
  manifest_json TEXT NOT NULL,
  activated_by TEXT,
  correlation_id TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  UNIQUE(draft_id, candidate_id),
  UNIQUE(draft_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_template_releases_space
  ON template_releases(space_id, activated_at DESC, id);

CREATE TABLE IF NOT EXISTS template_release_pointers (
  draft_id TEXT PRIMARY KEY REFERENCES template_drafts(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  release_id TEXT NOT NULL UNIQUE REFERENCES template_releases(id),
  updated_by TEXT,
  correlation_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_template_release_pointers_space
  ON template_release_pointers(space_id, updated_at DESC, draft_id);

INSERT INTO template_releases(
  id, space_id, draft_id, candidate_id, preview_request_id,
  compiled_file_id, preview_file_id, version_number, title,
  format, manifest_json, activated_by, correlation_id, activated_at
)
SELECT
  id, space_id, draft_id, test_version_id, preview_request_id,
  compiled_file_id, preview_file_id, version_number, title,
  format, manifest_json, activated_by, correlation_id, activated_at
FROM template_active_versions;

INSERT INTO template_release_pointers(
  draft_id, space_id, release_id, updated_by, correlation_id, updated_at
)
SELECT
  draft_id, space_id, active_version_id, updated_by, correlation_id, updated_at
FROM template_active_pointers;

CREATE TRIGGER IF NOT EXISTS trg_template_release_insert
BEFORE INSERT ON template_releases
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM template_release_candidates c
      JOIN template_release_previews p
        ON p.candidate_id = c.id
       AND p.space_id = c.space_id
       AND p.state = 'ready'
      WHERE c.id = NEW.candidate_id
        AND c.space_id = NEW.space_id
        AND c.draft_id = NEW.draft_id
        AND c.format = NEW.format
        AND c.compiled_file_id = NEW.compiled_file_id
        AND p.id = NEW.preview_request_id
        AND p.preview_file_id = NEW.preview_file_id
    )
    THEN RAISE(ABORT, 'template release requires a ready preview in the same space')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_template_releases_immutable_update
BEFORE UPDATE ON template_releases
BEGIN
  SELECT RAISE(ABORT, 'template releases are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_template_releases_immutable_delete
BEFORE DELETE ON template_releases
BEGIN
  SELECT RAISE(ABORT, 'template releases are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_template_release_pointer_insert
BEFORE INSERT ON template_release_pointers
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM template_releases r
      WHERE r.id = NEW.release_id
        AND r.draft_id = NEW.draft_id
        AND r.space_id = NEW.space_id
    )
    THEN RAISE(ABORT, 'template release pointer must reference the same draft space')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_template_release_pointer_update
BEFORE UPDATE OF release_id, space_id ON template_release_pointers
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM template_releases r
      WHERE r.id = NEW.release_id
        AND r.draft_id = NEW.draft_id
        AND r.space_id = NEW.space_id
    )
    THEN RAISE(ABORT, 'template release pointer must reference the same draft space')
  END;
END;
