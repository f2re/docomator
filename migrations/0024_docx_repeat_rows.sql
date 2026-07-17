-- One bounded DOCX table-row repeat sourced from audience.members.
-- Existing scalar drafts and release candidates keep NULL and use the
-- standardized aggregate fallback.
-- Applied migrations are immutable; add a new migration for later changes.

ALTER TABLE template_drafts
  ADD COLUMN repeat_binding_json TEXT
  CHECK (
    repeat_binding_json IS NULL
    OR (
      json_valid(repeat_binding_json)
      AND json_type(repeat_binding_json) = 'object'
      AND length(CAST(repeat_binding_json AS BLOB)) <= 4000
    )
  );

ALTER TABLE template_multi_test_versions
  ADD COLUMN repeat_contract_json TEXT
  CHECK (
    repeat_contract_json IS NULL
    OR (
      json_valid(repeat_contract_json)
      AND json_type(repeat_contract_json) = 'object'
      AND length(CAST(repeat_contract_json AS BLOB)) <= 8000
    )
  );

ALTER TABLE template_release_candidates
  ADD COLUMN repeat_contract_json TEXT
  CHECK (
    repeat_contract_json IS NULL
    OR (
      json_valid(repeat_contract_json)
      AND json_type(repeat_contract_json) = 'object'
      AND length(CAST(repeat_contract_json AS BLOB)) <= 8000
    )
  );

DROP TRIGGER trg_template_multi_test_version_space_insert;
DROP TRIGGER trg_template_release_candidate_insert;
DROP TRIGGER trg_template_test_version_release_candidate;
DROP TRIGGER trg_template_multi_test_version_release_candidate;

CREATE TRIGGER trg_template_multi_test_version_space_insert
BEFORE INSERT ON template_multi_test_versions
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM template_drafts d
      WHERE d.id = NEW.draft_id
        AND d.space_id = NEW.space_id
        AND d.status = 'draft'
        AND (
          (d.repeat_binding_json IS NULL AND NEW.repeat_contract_json IS NULL)
          OR (
            d.repeat_binding_json IS NOT NULL
            AND NEW.repeat_contract_json IS NOT NULL
            AND json_extract(NEW.repeat_contract_json, '$.version') = 1
            AND json_extract(NEW.repeat_contract_json, '$.kind') = 'docx.repeat-row-contract'
            AND json_extract(NEW.repeat_contract_json, '$.technicalBinding.kind') = 'docx.repeat-sdt'
            AND json_type(NEW.repeat_contract_json, '$.technicalBinding.identifier') = 'text'
            AND length(json_extract(NEW.repeat_contract_json, '$.technicalBinding.identifier')) = 33
            AND substr(json_extract(NEW.repeat_contract_json, '$.technicalBinding.identifier'), 1, 9) = 'airepeat:'
            AND substr(json_extract(NEW.repeat_contract_json, '$.technicalBinding.identifier'), 10) NOT GLOB '*[^0-9a-f]*'
            AND json_extract(NEW.repeat_contract_json, '$.technicalBinding.part') = json_extract(NEW.repeat_contract_json, '$.binding.part')
            AND json_type(NEW.repeat_contract_json, '$.technicalBinding.target') = 'text'
            AND length(json_extract(NEW.repeat_contract_json, '$.technicalBinding.target')) > 0
            AND json(json_extract(NEW.repeat_contract_json, '$.binding')) = json(d.repeat_binding_json)
          )
        )
    )
    THEN RAISE(ABORT, 'multi-field test version must match its draft and repeat binding')
  END;
END;

CREATE TRIGGER trg_template_release_candidate_insert
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
        AND NEW.repeat_contract_json IS NULL
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
        AND (
          (v.repeat_contract_json IS NULL AND NEW.repeat_contract_json IS NULL)
          OR v.repeat_contract_json = NEW.repeat_contract_json
        )
    )
    THEN RAISE(ABORT, 'multi release candidate must match its tested version')
  END;
END;

CREATE TRIGGER trg_template_test_version_release_candidate
AFTER INSERT ON template_test_versions
BEGIN
  INSERT INTO template_release_candidates(
    id, kind, space_id, draft_id, source_version_number, format,
    compiled_file_id, trial_file_id, compiled_sha256, trial_sha256,
    field_count, repeat_contract_json, created_at
  ) VALUES (
    NEW.id, 'single', NEW.space_id, NEW.draft_id, NEW.version_number, NEW.format,
    NEW.compiled_file_id, NEW.trial_file_id, NEW.compiled_sha256, NEW.trial_sha256,
    1, NULL, NEW.created_at
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

CREATE TRIGGER trg_template_multi_test_version_release_candidate
AFTER INSERT ON template_multi_test_versions
BEGIN
  INSERT INTO template_release_candidates(
    id, kind, space_id, draft_id, source_version_number, format,
    compiled_file_id, trial_file_id, compiled_sha256, trial_sha256,
    field_count, repeat_contract_json, created_at
  ) VALUES (
    NEW.id, 'multi', NEW.space_id, NEW.draft_id, NEW.version_number, NEW.format,
    NEW.compiled_file_id, NEW.trial_file_id, NEW.compiled_sha256, NEW.trial_sha256,
    NEW.field_count, NEW.repeat_contract_json, NEW.created_at
  );
END;
