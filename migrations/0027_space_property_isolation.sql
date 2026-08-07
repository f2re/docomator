-- 0027_space_property_isolation.sql
-- Пользовательские определения полей принадлежат пространству.
-- Миграция добавочная: исторические связи восстанавливаются по фактическим
-- значениям, а определения без значений закрепляются за default.

CREATE TABLE space_property_definitions (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  property_definition_id TEXT NOT NULL REFERENCES property_definitions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (space_id, property_definition_id)
);

CREATE INDEX idx_space_property_definitions_property
  ON space_property_definitions(property_definition_id, space_id);

INSERT OR IGNORE INTO space_property_definitions(
  space_id,
  property_definition_id,
  created_at
)
SELECT
  seo.space_id,
  epv.property_definition_id,
  MIN(epv.created_at)
FROM entity_property_values epv
JOIN space_entity_ownership seo ON seo.entity_id = epv.entity_id
GROUP BY seo.space_id, epv.property_definition_id;

INSERT OR IGNORE INTO space_property_definitions(
  space_id,
  property_definition_id,
  created_at
)
SELECT
  default_space.id,
  property_definition.id,
  property_definition.created_at
FROM property_definitions property_definition
JOIN spaces default_space
  ON default_space.id = '00000000-0000-4000-8000-000000000001'
WHERE NOT EXISTS (
  SELECT 1
  FROM space_property_definitions scoped
  WHERE scoped.property_definition_id = property_definition.id
);

-- После миграции новое определение не может получить второго владельца.
-- Исторические определения, реально использованные в нескольких пространствах
-- до этой миграции, сохраняются для недеструктивной совместимости; новые связи
-- к ним из других пространств создать нельзя.
CREATE TRIGGER trg_space_property_definition_single_owner_insert
BEFORE INSERT ON space_property_definitions
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM space_property_definitions existing
  WHERE existing.property_definition_id = NEW.property_definition_id
    AND existing.space_id <> NEW.space_id
)
BEGIN
  SELECT RAISE(ABORT, 'property definition belongs to another space');
END;

CREATE TRIGGER trg_space_property_definition_single_owner_update
BEFORE UPDATE OF space_id, property_definition_id ON space_property_definitions
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM space_property_definitions existing
  WHERE existing.property_definition_id = NEW.property_definition_id
    AND existing.space_id <> NEW.space_id
)
BEGIN
  SELECT RAISE(ABORT, 'property definition belongs to another space');
END;

-- Значение нельзя записать определением из другого пространства даже при обходе HTTP/UI.
CREATE TRIGGER trg_entity_property_value_space_guard
BEFORE INSERT ON entity_property_values
FOR EACH ROW
WHEN EXISTS (
       SELECT 1
       FROM space_entity_ownership ownership
       WHERE ownership.entity_id = NEW.entity_id
     )
 AND EXISTS (
       SELECT 1
       FROM space_property_definitions scoped
       WHERE scoped.property_definition_id = NEW.property_definition_id
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

-- Старые внутренние пути могут создать определение до первого значения.
-- Если определение ещё никому не принадлежит, первое значение закрепляет его
-- за пространством сущности.
CREATE TRIGGER trg_entity_property_value_claim_space
AFTER INSERT ON entity_property_values
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM space_entity_ownership ownership
  WHERE ownership.entity_id = NEW.entity_id
)
BEGIN
  INSERT OR IGNORE INTO space_property_definitions(
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

-- Нельзя просто перенести сущность в другое пространство и тем самым протащить
-- туда значения полей старого пространства. Сначала данные должны быть
-- перенесены/пересозданы через предметную операцию.
CREATE TRIGGER trg_space_entity_property_move_guard
BEFORE UPDATE OF space_id ON space_entity_ownership
FOR EACH ROW
WHEN NEW.space_id <> OLD.space_id
 AND EXISTS (
       SELECT 1
       FROM entity_property_values value
       JOIN space_property_definitions scoped
         ON scoped.property_definition_id = value.property_definition_id
       WHERE value.entity_id = OLD.entity_id
         AND scoped.space_id <> NEW.space_id
     )
BEGIN
  SELECT RAISE(ABORT, 'move entity property values before changing space');
END;
