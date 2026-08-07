-- 0029_normalize_legacy_shared_properties.sql
-- Исторические определения, использованные несколькими пространствами до 0027,
-- физически разделяются без изменения неизменяемых template bindings.
-- Старый key становится пространственным alias на новый независимый definition.

CREATE TABLE space_property_definition_aliases (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  alias_key TEXT NOT NULL,
  property_definition_id TEXT NOT NULL REFERENCES property_definitions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (space_id, alias_key)
);

CREATE INDEX idx_space_property_definition_aliases_definition
  ON space_property_definition_aliases(property_definition_id, space_id);

CREATE TEMP TABLE legacy_property_clones AS
SELECT
  scoped.space_id,
  definition.id AS original_id,
  definition.key AS original_key,
  'legacy-scope:' || lower(hex(definition.id)) || ':' || lower(hex(scoped.space_id)) AS clone_id,
  'legacy.' || lower(hex(definition.id)) || '.' || lower(hex(scoped.space_id)) AS clone_key
FROM space_property_definitions scoped
JOIN property_definitions definition
  ON definition.id = scoped.property_definition_id
WHERE scoped.property_definition_id IN (
  SELECT property_definition_id
  FROM space_property_definitions
  GROUP BY property_definition_id
  HAVING COUNT(*) > 1
);

INSERT INTO property_definitions(
  id, key, label, description, value_type, unit,
  cardinality, sensitivity, applies_to_json,
  validation_json, aliases_json, version, created_at, updated_at
)
SELECT
  clone.clone_id,
  clone.clone_key,
  definition.label,
  definition.description,
  definition.value_type,
  definition.unit,
  definition.cardinality,
  definition.sensitivity,
  definition.applies_to_json,
  definition.validation_json,
  definition.aliases_json,
  definition.version,
  definition.created_at,
  definition.updated_at
FROM legacy_property_clones clone
JOIN property_definitions definition
  ON definition.id = clone.original_id;

INSERT INTO space_property_definitions(
  space_id,
  property_definition_id,
  created_at
)
SELECT
  clone.space_id,
  clone.clone_id,
  definition.created_at
FROM legacy_property_clones clone
JOIN property_definitions definition
  ON definition.id = clone.original_id;

INSERT INTO space_property_definition_aliases(
  space_id,
  alias_key,
  property_definition_id,
  created_at
)
SELECT
  clone.space_id,
  clone.original_key,
  clone.clone_id,
  definition.created_at
FROM legacy_property_clones clone
JOIN property_definitions definition
  ON definition.id = clone.original_id;

-- Перепривязываем только значения сущностей того же пространства. Триггеры 0028
-- проверяют, что clone уже принадлежит пространству сущности.
UPDATE entity_property_values
SET property_definition_id = (
  SELECT clone.clone_id
  FROM legacy_property_clones clone
  JOIN space_entity_ownership ownership
    ON ownership.space_id = clone.space_id
   AND ownership.entity_id = entity_property_values.entity_id
  WHERE clone.original_id = entity_property_values.property_definition_id
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM legacy_property_clones clone
  JOIN space_entity_ownership ownership
    ON ownership.space_id = clone.space_id
   AND ownership.entity_id = entity_property_values.entity_id
  WHERE clone.original_id = entity_property_values.property_definition_id
);

-- Реестр публикаций использует ключи напрямую в SQL-отчётах, поэтому его
-- конфигурация переводится на физический ключ clone. Immutable template bindings
-- не переписываются: для них остаётся alias выше.
UPDATE publication_registry_settings
SET
  publication_year_property_key = COALESCE((
    SELECT definition.key
    FROM space_property_definition_aliases alias
    JOIN property_definitions definition ON definition.id = alias.property_definition_id
    WHERE alias.space_id = publication_registry_settings.space_id
      AND alias.alias_key = publication_registry_settings.publication_year_property_key
  ), publication_year_property_key),
  publication_title_property_key = COALESCE((
    SELECT definition.key
    FROM space_property_definition_aliases alias
    JOIN property_definitions definition ON definition.id = alias.property_definition_id
    WHERE alias.space_id = publication_registry_settings.space_id
      AND alias.alias_key = publication_registry_settings.publication_title_property_key
  ), publication_title_property_key),
  department_property_key = COALESCE((
    SELECT definition.key
    FROM space_property_definition_aliases alias
    JOIN property_definitions definition ON definition.id = alias.property_definition_id
    WHERE alias.space_id = publication_registry_settings.space_id
      AND alias.alias_key = publication_registry_settings.department_property_key
  ), department_property_key),
  vak_property_key = COALESCE((
    SELECT definition.key
    FROM space_property_definition_aliases alias
    JOIN property_definitions definition ON definition.id = alias.property_definition_id
    WHERE alias.space_id = publication_registry_settings.space_id
      AND alias.alias_key = publication_registry_settings.vak_property_key
  ), vak_property_key),
  rinc_property_key = COALESCE((
    SELECT definition.key
    FROM space_property_definition_aliases alias
    JOIN property_definitions definition ON definition.id = alias.property_definition_id
    WHERE alias.space_id = publication_registry_settings.space_id
      AND alias.alias_key = publication_registry_settings.rinc_property_key
  ), rinc_property_key),
  international_property_key = COALESCE((
    SELECT definition.key
    FROM space_property_definition_aliases alias
    JOIN property_definitions definition ON definition.id = alias.property_definition_id
    WHERE alias.space_id = publication_registry_settings.space_id
      AND alias.alias_key = publication_registry_settings.international_property_key
  ), international_property_key),
  international_index_property_key = COALESCE((
    SELECT definition.key
    FROM space_property_definition_aliases alias
    JOIN property_definitions definition ON definition.id = alias.property_definition_id
    WHERE alias.space_id = publication_registry_settings.space_id
      AND alias.alias_key = publication_registry_settings.international_index_property_key
  ), international_index_property_key
WHERE EXISTS (
  SELECT 1
  FROM space_property_definition_aliases alias
  WHERE alias.space_id = publication_registry_settings.space_id
    AND alias.alias_key IN (
      publication_registry_settings.publication_year_property_key,
      publication_registry_settings.publication_title_property_key,
      publication_registry_settings.department_property_key,
      publication_registry_settings.vak_property_key,
      publication_registry_settings.rinc_property_key,
      publication_registry_settings.international_property_key,
      publication_registry_settings.international_index_property_key
    )
);

-- История импорта остаётся читаемой с актуальным физическим ключом выбранного
-- пространства. Содержимое импортированных данных при этом не меняется.
UPDATE data_import_runs
SET identity_property_key = COALESCE((
  SELECT definition.key
  FROM space_property_definition_aliases alias
  JOIN property_definitions definition ON definition.id = alias.property_definition_id
  WHERE alias.space_id = data_import_runs.space_id
    AND alias.alias_key = data_import_runs.identity_property_key
), identity_property_key)
WHERE EXISTS (
  SELECT 1
  FROM space_property_definition_aliases alias
  WHERE alias.space_id = data_import_runs.space_id
    AND alias.alias_key = data_import_runs.identity_property_key
);

-- Старый definition больше не является ресурсом ни одного пространства. Он
-- остаётся только как историческая запись key -> alias и не участвует в values.
DELETE FROM space_property_definitions
WHERE property_definition_id IN (
  SELECT DISTINCT original_id FROM legacy_property_clones
);

DROP TABLE legacy_property_clones;
