-- Versioned deterministic display formatters for scalar template fields.
-- Existing rows retain an explicit legacy rendering contract; new API writes
-- an explicit safe Russian formatter selected for the field value type.
-- Applied migrations are immutable; add a new migration for later changes.

ALTER TABLE template_draft_fields
  ADD COLUMN formatter_json TEXT NOT NULL
  DEFAULT '{"version":1,"kind":"legacy"}'
  CHECK (
    json_valid(formatter_json)
    AND json_type(formatter_json) = 'object'
    AND length(CAST(formatter_json AS BLOB)) <= 2000
  );

ALTER TABLE template_multi_test_version_fields
  ADD COLUMN formatter_json TEXT NOT NULL
  DEFAULT '{"version":1,"kind":"legacy"}'
  CHECK (
    json_valid(formatter_json)
    AND json_type(formatter_json) = 'object'
    AND length(CAST(formatter_json AS BLOB)) <= 2000
  );

ALTER TABLE template_release_candidate_fields
  ADD COLUMN formatter_json TEXT NOT NULL
  DEFAULT '{"version":1,"kind":"legacy"}'
  CHECK (
    json_valid(formatter_json)
    AND json_type(formatter_json) = 'object'
    AND length(CAST(formatter_json AS BLOB)) <= 2000
  );

DROP TRIGGER trg_template_multi_test_field_insert;
DROP TRIGGER trg_template_release_candidate_field_insert;
DROP TRIGGER trg_template_test_version_release_candidate;
DROP TRIGGER trg_template_multi_test_field_release_candidate;

CREATE TRIGGER trg_template_multi_test_field_insert
BEFORE INSERT ON template_multi_test_version_fields
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM template_multi_test_versions v
      JOIN template_draft_fields f ON f.draft_id = v.draft_id
      WHERE v.id = NEW.test_version_id
        AND f.id = NEW.field_id
        AND f.field_key = NEW.field_key
        AND f.label = NEW.field_label
        AND f.value_type = NEW.value_type
        AND f.required = NEW.required
        AND f.binding_json = NEW.binding_json
        AND f.formatter_json = NEW.formatter_json
    )
    THEN RAISE(ABORT, 'multi-field tested field must belong to the same draft')
  END;
END;

CREATE TRIGGER trg_template_release_candidate_field_insert
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
        AND f.formatter_json = NEW.formatter_json
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
        AND f.formatter_json = NEW.formatter_json
        AND f.technical_binding_json = NEW.technical_binding_json
    )
    THEN RAISE(ABORT, 'multi release candidate field must match its tested version')
  END;
END;

CREATE TRIGGER trg_template_test_version_release_candidate
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
    value_type, required, binding_json, formatter_json, technical_binding_json
  )
  SELECT
    NEW.id, f.id, 0, f.field_key, f.label,
    f.value_type, f.required, f.binding_json, f.formatter_json,
    NEW.technical_binding_json
  FROM template_draft_fields f
  WHERE f.id = NEW.field_id;
END;

CREATE TRIGGER trg_template_multi_test_field_release_candidate
AFTER INSERT ON template_multi_test_version_fields
BEGIN
  INSERT INTO template_release_candidate_fields(
    candidate_id, field_id, ordinal, field_key, field_label,
    value_type, required, binding_json, formatter_json, technical_binding_json
  ) VALUES (
    NEW.test_version_id, NEW.field_id, NEW.ordinal, NEW.field_key, NEW.field_label,
    NEW.value_type, NEW.required, NEW.binding_json, NEW.formatter_json,
    NEW.technical_binding_json
  );
END;
