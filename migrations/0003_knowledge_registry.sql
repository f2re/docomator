-- Knowledge registry integrity and history indexes.

CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_property_value_version
  ON entity_property_values(entity_id, property_definition_id, version);

CREATE INDEX IF NOT EXISTS idx_entity_property_value_history
  ON entity_property_values(entity_id, property_definition_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_entity_property_value_validity
  ON entity_property_values(entity_id, valid_from, valid_to);
