-- Persistent external keys and import run history for repeatable bulk data loads.

CREATE TABLE IF NOT EXISTS entity_import_keys (
  space_id TEXT NOT NULL REFERENCES spaces(id),
  entity_type_id TEXT NOT NULL REFERENCES entity_types(id),
  external_key TEXT NOT NULL,
  entity_id TEXT NOT NULL UNIQUE REFERENCES entities(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(space_id, entity_type_id, external_key)
);

CREATE INDEX IF NOT EXISTS idx_entity_import_keys_entity
  ON entity_import_keys(entity_id);

CREATE TABLE IF NOT EXISTS data_import_runs (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  entity_type_id TEXT NOT NULL REFERENCES entity_types(id),
  file_name TEXT NOT NULL,
  file_format TEXT NOT NULL CHECK (file_format IN ('csv', 'xlsx')),
  source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
  identity_property_key TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  created_count INTEGER NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  unchanged_count INTEGER NOT NULL DEFAULT 0 CHECK (unchanged_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  property_value_count INTEGER NOT NULL DEFAULT 0 CHECK (property_value_count >= 0),
  group_id TEXT REFERENCES audience_groups(id),
  state TEXT NOT NULL CHECK (state IN ('completed', 'partial', 'failed')),
  details_json TEXT NOT NULL,
  created_by TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_data_import_runs_space
  ON data_import_runs(space_id, created_at DESC, id);

CREATE TRIGGER IF NOT EXISTS trg_entity_import_key_scope_insert
BEFORE INSERT ON entity_import_keys
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM entities e
      JOIN space_entity_ownership seo ON seo.entity_id = e.id
      WHERE e.id = NEW.entity_id
        AND e.entity_type_id = NEW.entity_type_id
        AND seo.space_id = NEW.space_id
    )
    THEN RAISE(ABORT, 'entity import key must match entity space and type')
  END;
END;
