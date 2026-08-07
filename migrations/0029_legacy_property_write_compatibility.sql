-- 0029_legacy_property_write_compatibility.sql
-- 0028 сделал принадлежность обязательной до первой записи. Это корректный
-- конечный инвариант, но существующие внутренние предметные реестры старого API
-- всё ещё создают определение и закрепляют его за пространством при первой
-- записи значения. Пользовательские HTTP/UI-пути уже используют явный scoped
-- registry; этот переходный триггер сохраняет совместимость внутренних вызовов.
-- Важно: чтение никогда не присваивает поле пространству.

DROP TRIGGER IF EXISTS trg_entity_property_value_scope_required_insert;
DROP TRIGGER IF EXISTS trg_entity_property_value_scope_required_update;

CREATE TRIGGER IF NOT EXISTS trg_entity_property_value_claim_space
AFTER INSERT ON entity_property_values
FOR EACH ROW
WHEN EXISTS (
       SELECT 1
       FROM space_entity_ownership ownership
       WHERE ownership.entity_id = NEW.entity_id
     )
 AND NOT EXISTS (
       SELECT 1
       FROM space_property_definitions scoped
       WHERE scoped.property_definition_id = NEW.property_definition_id
     )
BEGIN
  INSERT INTO space_property_definitions(
    space_id,
    property_definition_id,
    created_at
  )
  SELECT
    ownership.space_id,
    NEW.property_definition_id,
    NEW.created_at
  FROM space_entity_ownership ownership
  WHERE ownership.entity_id = NEW.entity_id;
END;
