-- 0030_normalize_legacy_shared_properties.sql
--
-- Definitions that were already used by more than one space before migration
-- 0027 are the last historical exception to the one-space-per-property rule.
-- Split each such definition into an independent physical definition per space.
-- The old key is retained only as a space-local compatibility alias so immutable
-- activated template releases can keep resolving their frozen field keys.
--
-- This migration also removes the transitional claim-on-write trigger restored
-- by 0029. After 0030 every property value write requires explicit ownership.

CREATE TABLE IF NOT EXISTS space_property_definition_aliases (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  alias_key TEXT NOT NULL,
  property_definition_id TEXT NOT NULL REFERENCES property_definitions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (space_id, alias_key)
);

CREATE INDEX IF NOT EXISTS idx_space_property_definition_alias_target
  ON space_property_definition_aliases(property_definition_id, space_id);

CREATE TRIGGER IF NOT EXISTS trg_space_property_definition_alias_scope_insert
BEFORE INSERT ON space_property_definition_aliases
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM space_property_definitions scoped
  WHERE scoped.space_id = NEW.space_id
    AND scoped.property_definition_id = NEW.property_definition_id
)
BEGIN
  SELECT RAISE(ABORT, 'property alias must target a definition in the same space');
END;

CREATE TRIGGER IF NOT EXISTS trg_space_property_definition_alias_scope_update
BEFORE UPDATE OF space_id, property_definition_id ON space_property_definition_aliases
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM space_property_definitions scoped
  WHERE scoped.space_id = NEW.space_id
    AND scoped.property_definition_id = NEW.property_definition_id
)
BEGIN
  SELECT RAISE(ABORT, 'property alias must target a definition in the same space');
END;

DROP TABLE IF EXISTS temp._legacy_shared_property_clones;
CREATE TEMP TABLE _legacy_shared_property_clones AS
SELECT
  definition.id AS old_definition_id,
  definition.key AS old_key,
  scoped.space_id AS space_id,
  'legacy-scope:' || replace(lower(definition.id), '-', '') || ':' ||
    replace(lower(scoped.space_id), '-', '') AS clone_definition_id,
  'legacy.' || replace(lower(definition.id), '-', '') || '.' ||
    replace(lower(scoped.space_id), '-', '') AS clone_key,
  definition.created_at AS created_at
FROM property_definitions definition
JOIN space_property_definitions scoped
  ON scoped.property_definition_id = definition.id
WHERE definition.id IN (
  SELECT property_definition_id
  FROM space_property_definitions
  GROUP BY property_definition_id
  HAVING COUNT(*) > 1
);

-- Copy definition metadata verbatim. Only the internal id/key are changed.
INSERT INTO property_definitions(
  id,
  key,
  label,
  description,
  value_type,
  unit,
  cardinality,
  sensitivity,
  applies_to_json,
  validation_json,
  aliases_json,
  version,
  created_at,
  updated_at
)
SELECT
  clone.clone_definition_id,
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
FROM _legacy_shared_property_clones clone
JOIN property_definitions definition
  ON definition.id = clone.old_definition_id;

-- Every clone is owned by exactly one space before any value is rebound.
INSERT INTO space_property_definitions(
  space_id,
  property_definition_id,
  created_at
)
SELECT space_id, clone_definition_id, created_at
FROM _legacy_shared_property_clones;

-- Preserve the historical key only inside the space that used it.
INSERT INTO space_property_definition_aliases(
  space_id,
  alias_key,
  property_definition_id,
  created_at
)
SELECT space_id, old_key, clone_definition_id, created_at
FROM _legacy_shared_property_clones;

-- Rebind every historical value to the clone belonging to the entity's space.
UPDATE entity_property_values
SET property_definition_id = (
  SELECT clone.clone_definition_id
  FROM _legacy_shared_property_clones clone
  JOIN space_entity_ownership ownership
    ON ownership.space_id = clone.space_id
   AND ownership.entity_id = entity_property_values.entity_id
  WHERE clone.old_definition_id = entity_property_values.property_definition_id
)
WHERE EXISTS (
  SELECT 1
  FROM _legacy_shared_property_clones clone
  JOIN space_entity_ownership ownership
    ON ownership.space_id = clone.space_id
   AND ownership.entity_id = entity_property_values.entity_id
  WHERE clone.old_definition_id = entity_property_values.property_definition_id
);

-- Persisted import identity keys are runtime metadata, not immutable template
-- bindings. Point them at the physical clone to avoid depending on aliases.
UPDATE data_import_runs
SET identity_property_key = (
  SELECT clone.clone_key
  FROM _legacy_shared_property_clones clone
  WHERE clone.space_id = data_import_runs.space_id
    AND clone.old_key = data_import_runs.identity_property_key
)
WHERE EXISTS (
  SELECT 1
  FROM _legacy_shared_property_clones clone
  WHERE clone.space_id = data_import_runs.space_id
    AND clone.old_key = data_import_runs.identity_property_key
);

-- Publication registry configuration is mutable runtime configuration and must
-- likewise point to the physical per-space clone after normalization.
UPDATE publication_registry_settings
SET publication_year_property_key = (
  SELECT clone.clone_key
  FROM _legacy_shared_property_clones clone
  WHERE clone.space_id = publication_registry_settings.space_id
    AND clone.old_key = publication_registry_settings.publication_year_property_key
)
WHERE EXISTS (
  SELECT 1 FROM _legacy_shared_property_clones clone
  WHERE clone.space_id = publication_registry_settings.space_id
    AND clone.old_key = publication_registry_settings.publication_year_property_key
);

UPDATE publication_registry_settings
SET publication_date_property_key = (
  SELECT clone.clone_key
  FROM _legacy_shared_property_clones clone
  WHERE clone.space_id = publication_registry_settings.space_id
    AND clone.old_key = publication_registry_settings.publication_date_property_key
)
WHERE EXISTS (
  SELECT 1 FROM _legacy_shared_property_clones clone
  WHERE clone.space_id = publication_registry_settings.space_id
    AND clone.old_key = publication_registry_settings.publication_date_property_key
);

UPDATE publication_registry_settings
SET teacher_department_property_key = (
  SELECT clone.clone_key
  FROM _legacy_shared_property_clones clone
  WHERE clone.space_id = publication_registry_settings.space_id
    AND clone.old_key = publication_registry_settings.teacher_department_property_key
)
WHERE EXISTS (
  SELECT 1 FROM _legacy_shared_property_clones clone
  WHERE clone.space_id = publication_registry_settings.space_id
    AND clone.old_key = publication_registry_settings.teacher_department_property_key
);

UPDATE publication_registry_settings
SET doi_property_key = (
  SELECT clone.clone_key
  FROM _legacy_shared_property_clones clone
  WHERE clone.space_id = publication_registry_settings.space_id
    AND clone.old_key = publication_registry_settings.doi_property_key
)
WHERE EXISTS (
  SELECT 1 FROM _legacy_shared_property_clones clone
  WHERE clone.space_id = publication_registry_settings.space_id
    AND clone.old_key = publication_registry_settings.doi_property_key
);

UPDATE publication_registry_settings
SET journal_property_key = (
  SELECT clone.clone_key
  FROM _legacy_shared_property_clones clone
  WHERE clone.space_id = publication_registry_settings.space_id
    AND clone.old_key = publication_registry_settings.journal_property_key
)
WHERE EXISTS (
  SELECT 1 FROM _legacy_shared_property_clones clone
  WHERE clone.space_id = publication_registry_settings.space_id
    AND clone.old_key = publication_registry_settings.journal_property_key
);

UPDATE publication_registry_settings
SET bibliography_property_key = (
  SELECT clone.clone_key
  FROM _legacy_shared_property_clones clone
  WHERE clone.space_id = publication_registry_settings.space_id
    AND clone.old_key = publication_registry_settings.bibliography_property_key
)
WHERE EXISTS (
  SELECT 1 FROM _legacy_shared_property_clones clone
  WHERE clone.space_id = publication_registry_settings.space_id
    AND clone.old_key = publication_registry_settings.bibliography_property_key
);

UPDATE publication_registry_settings
SET status_property_key = (
  SELECT clone.clone_key
  FROM _legacy_shared_property_clones clone
  WHERE clone.space_id = publication_registry_settings.space_id
    AND clone.old_key = publication_registry_settings.status_property_key
)
WHERE EXISTS (
  SELECT 1 FROM _legacy_shared_property_clones clone
  WHERE clone.space_id = publication_registry_settings.space_id
    AND clone.old_key = publication_registry_settings.status_property_key
);

-- The original shared definition remains as an unowned historical record so an
-- immutable template key can still be recognised and routed through the alias.
DELETE FROM space_property_definitions
WHERE EXISTS (
  SELECT 1
  FROM _legacy_shared_property_clones clone
  WHERE clone.old_definition_id = space_property_definitions.property_definition_id
);

-- End the compatibility window introduced by 0029. New values may only be
-- written after ownership is explicitly established by a space-aware mutation.
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

DROP TABLE temp._legacy_shared_property_clones;
