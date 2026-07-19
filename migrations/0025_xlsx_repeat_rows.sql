-- Extend the existing immutable repeat contract boundary with one bounded XLSX
-- row/range repeat. The JSON columns were added by 0024; only the validating
-- trigger changes here.

DROP TRIGGER trg_template_multi_test_version_space_insert;

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
            AND json(json_extract(NEW.repeat_contract_json, '$.binding')) = json(d.repeat_binding_json)
            AND (
              (
                d.format = 'docx'
                AND json_extract(NEW.repeat_contract_json, '$.kind') = 'docx.repeat-row-contract'
                AND json_extract(NEW.repeat_contract_json, '$.binding.kind') = 'docx.repeat-row'
                AND json_extract(NEW.repeat_contract_json, '$.binding.source') = 'audience.members'
                AND json_extract(NEW.repeat_contract_json, '$.technicalBinding.kind') = 'docx.repeat-sdt'
                AND json_type(NEW.repeat_contract_json, '$.technicalBinding.identifier') = 'text'
                AND length(json_extract(NEW.repeat_contract_json, '$.technicalBinding.identifier')) = 33
                AND substr(json_extract(NEW.repeat_contract_json, '$.technicalBinding.identifier'), 1, 9) = 'airepeat:'
                AND substr(json_extract(NEW.repeat_contract_json, '$.technicalBinding.identifier'), 10) NOT GLOB '*[^0-9a-f]*'
                AND json_extract(NEW.repeat_contract_json, '$.technicalBinding.part') = json_extract(NEW.repeat_contract_json, '$.binding.part')
                AND json_type(NEW.repeat_contract_json, '$.technicalBinding.target') = 'text'
                AND length(json_extract(NEW.repeat_contract_json, '$.technicalBinding.target')) > 0
              )
              OR (
                d.format = 'xlsx'
                AND json_extract(NEW.repeat_contract_json, '$.kind') = 'xlsx.repeat-row-contract'
                AND json_extract(NEW.repeat_contract_json, '$.binding.kind') = 'xlsx.repeat-row'
                AND json_extract(NEW.repeat_contract_json, '$.binding.source') = 'audience.members'
                AND json_extract(NEW.repeat_contract_json, '$.binding.selection') IN ('used-row', 'range')
                AND json_extract(NEW.repeat_contract_json, '$.technicalBinding.kind') = 'xlsx.repeat-defined-name'
                AND json_type(NEW.repeat_contract_json, '$.technicalBinding.identifier') = 'text'
                AND length(json_extract(NEW.repeat_contract_json, '$.technicalBinding.identifier')) = 42
                AND substr(json_extract(NEW.repeat_contract_json, '$.technicalBinding.identifier'), 1, 18) = '_DOCOMATOR_REPEAT_'
                AND substr(json_extract(NEW.repeat_contract_json, '$.technicalBinding.identifier'), 19) NOT GLOB '*[^0-9A-F]*'
                AND json_extract(NEW.repeat_contract_json, '$.technicalBinding.part') = 'xl/workbook.xml'
                AND json_type(NEW.repeat_contract_json, '$.technicalBinding.target') = 'text'
                AND length(json_extract(NEW.repeat_contract_json, '$.technicalBinding.target')) > 0
              )
            )
          )
        )
    )
    THEN RAISE(ABORT, 'multi-field test version must match its draft and repeat binding')
  END;
END;
