-- 0028_space_property_scope_enforcement.sql
-- После перевода предметных путей на явный контекст пространства определение
-- свойства больше не должно получать владельца как побочный эффект записи значения.
-- Исторические определения, уже использованные в нескольких пространствах до 0027,
-- сохраняются без разрушительного переписывания ключей: активные неизменяемые
-- шаблоны могут ссылаться на эти ключи. Новые неявные или межпространственные
-- связи запрещаются на уровне SQLite.

DROP TRIGGER IF EXISTS trg_entity_property_value_claim_space;

CREATE TRIGGER IF NOT EXISTS trg_entity_property_value_scope_required_insert
BEFORE INSERT ON entity_property_values
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM space_property_definitions scoped
  WHERE scoped.property_definition_id = NEW.property_definition_id
)
BEGIN
  SELECT RAISE(ABORT, 'property definition must belong to a space before value insert');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_property_value_scope_required_update
BEFORE UPDATE OF entity_id, property_definition_id ON entity_property_values
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM space_property_definitions scoped
  WHERE scoped.property_definition_id = NEW.property_definition_id
)
BEGIN
  SELECT RAISE(ABORT, 'property definition must belong to a space before value update');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_property_value_space_guard_update
BEFORE UPDATE OF entity_id, property_definition_id ON entity_property_values
FOR EACH ROW
WHEN EXISTS (
       SELECT 1
       FROM space_entity_ownership ownership
       WHERE ownership.entity_id = NEW.entity_id
     )
 AND NOT EXISTS (
       SELECT 1
       FROM space_entity_ownership ownership
       JOIN space_property_definitions scoped
         ON scoped.space_id = ownership.space_id
       WHERE ownership.entity_id = NEW.entity_id
         AND scoped.property_definition_id = NEW.property_definition_id
     )
BEGIN
  SELECT RAISE(ABORT, 'property definition is outside entity space');
END;

-- Диагностическое представление позволяет штатно обнаружить наследованные
-- определения, которые до 0027 уже использовались в нескольких пространствах.
-- Оно не является источником данных и не изменяет историю.
CREATE VIEW IF NOT EXISTS legacy_shared_property_definitions AS
SELECT
  definition.id AS property_definition_id,
  definition.key AS property_key,
  definition.label AS property_label,
  COUNT(*) AS space_count,
  GROUP_CONCAT(scoped.space_id, ',') AS space_ids
FROM property_definitions definition
JOIN space_property_definitions scoped
  ON scoped.property_definition_id = definition.id
GROUP BY definition.id, definition.key, definition.label
HAVING COUNT(*) > 1;
