-- Extend the immutable 0024 multi-field repeat guard for the separate
-- entity_collection_template_repeats binding introduced by 0035.
-- Legacy audience.members repeats keep the exact previous contract.

DROP TRIGGER IF EXISTS trg_template_multi_test_version_space_insert;

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
          (
            d.repeat_binding_json IS NULL
            AND NEW.repeat_contract_json IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM entity_collection_template_repeats entity_repeat
              WHERE entity_repeat.draft_id = d.id
                AND entity_repeat.space_id = d.space_id
            )
          )
          OR (
            d.repeat_binding_json IS NOT NULL
            AND NEW.repeat_contract_json IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM entity_collection_template_repeats entity_repeat
              WHERE entity_repeat.draft_id = d.id
                AND entity_repeat.space_id = d.space_id
            )
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
          OR EXISTS (
            SELECT 1
            FROM entity_collection_template_repeats entity_repeat
            WHERE entity_repeat.draft_id = d.id
              AND entity_repeat.space_id = d.space_id
              AND d.repeat_binding_json IS NULL
              AND NEW.repeat_contract_json IS NOT NULL
              AND json_extract(NEW.repeat_contract_json, '$.version') = 1
              AND json_extract(NEW.repeat_contract_json, '$.kind') = 'docx.repeat-row-contract'
              AND json_extract(NEW.repeat_contract_json, '$.binding.version') = 1
              AND json_extract(NEW.repeat_contract_json, '$.binding.kind') = 'docx.repeat-row'
              AND json_extract(NEW.repeat_contract_json, '$.binding.source') = 'audience.members'
              AND json_extract(NEW.repeat_contract_json, '$.binding.anchorElementId') = entity_repeat.anchor_element_id
              AND json_extract(NEW.repeat_contract_json, '$.binding.part') = entity_repeat.part
              AND json_extract(NEW.repeat_contract_json, '$.binding.tableIndex') = entity_repeat.table_index
              AND json_extract(NEW.repeat_contract_json, '$.binding.rowIndex') = entity_repeat.row_index
              AND json_extract(NEW.repeat_contract_json, '$.technicalBinding.kind') = 'docx.repeat-sdt'
              AND json_type(NEW.repeat_contract_json, '$.technicalBinding.identifier') = 'text'
              AND length(json_extract(NEW.repeat_contract_json, '$.technicalBinding.identifier')) = 33
              AND substr(json_extract(NEW.repeat_contract_json, '$.technicalBinding.identifier'), 1, 9) = 'airepeat:'
              AND substr(json_extract(NEW.repeat_contract_json, '$.technicalBinding.identifier'), 10) NOT GLOB '*[^0-9a-f]*'
              AND json_extract(NEW.repeat_contract_json, '$.technicalBinding.part') = entity_repeat.part
              AND json_type(NEW.repeat_contract_json, '$.technicalBinding.target') = 'text'
              AND length(json_extract(NEW.repeat_contract_json, '$.technicalBinding.target')) > 0
          )
        )
    )
    THEN RAISE(ABORT, 'multi-field test version must match its draft and repeat binding')
  END;
END;
