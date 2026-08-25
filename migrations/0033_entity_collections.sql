-- Ordered, typed, space-scoped collections owned by one entity.
-- First vertical slice for nested document tables: one owner has 0..1000 rows,
-- every row follows one collection schema, and @row_number is computed from position.

CREATE TABLE IF NOT EXISTS entity_collection_definitions (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  owner_entity_type_key TEXT NOT NULL REFERENCES entity_types(key) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  min_items INTEGER NOT NULL DEFAULT 0
    CHECK (min_items >= 0 AND min_items <= 1000),
  max_items INTEGER NOT NULL DEFAULT 1000
    CHECK (max_items >= 1 AND max_items <= 1000 AND max_items >= min_items),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(space_id, key)
);

CREATE INDEX IF NOT EXISTS idx_entity_collection_definitions_space_type
  ON entity_collection_definitions(space_id, owner_entity_type_key, status, label);

CREATE TABLE IF NOT EXISTS entity_collection_fields (
  id TEXT PRIMARY KEY,
  collection_definition_id TEXT NOT NULL
    REFERENCES entity_collection_definitions(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  value_type TEXT NOT NULL
    CHECK (value_type IN (
      'string', 'text', 'number', 'integer', 'boolean', 'date', 'date-time', 'enum'
    )),
  unit TEXT,
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  validation_json TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL CHECK (position >= 0 AND position < 100),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(collection_definition_id, key),
  UNIQUE(collection_definition_id, position)
);

CREATE INDEX IF NOT EXISTS idx_entity_collection_fields_definition_position
  ON entity_collection_fields(collection_definition_id, position, id);

CREATE TABLE IF NOT EXISTS entity_collection_items (
  id TEXT PRIMARY KEY,
  collection_definition_id TEXT NOT NULL
    REFERENCES entity_collection_definitions(id) ON DELETE CASCADE,
  owner_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0 AND position < 1000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(collection_definition_id, owner_entity_id, position)
);

CREATE INDEX IF NOT EXISTS idx_entity_collection_items_owner
  ON entity_collection_items(owner_entity_id, collection_definition_id, position);

CREATE TABLE IF NOT EXISTS entity_collection_item_values (
  item_id TEXT NOT NULL REFERENCES entity_collection_items(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES entity_collection_fields(id) ON DELETE RESTRICT,
  value_json TEXT NOT NULL,
  value_text TEXT,
  value_number REAL,
  value_integer INTEGER,
  value_boolean INTEGER CHECK (value_boolean IS NULL OR value_boolean IN (0, 1)),
  value_date TEXT,
  value_datetime TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(item_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_collection_item_values_field
  ON entity_collection_item_values(field_id, item_id);

-- Definition and owner must share one space, and the owner type must match
-- the collection's declared owner type. This is enforced at the DB boundary,
-- not only in UI/API code.
CREATE TRIGGER IF NOT EXISTS trg_entity_collection_item_scope_insert
BEFORE INSERT ON entity_collection_items
WHEN NOT EXISTS (
  SELECT 1
  FROM entity_collection_definitions d
  JOIN space_entity_ownership seo
    ON seo.space_id = d.space_id
   AND seo.entity_id = NEW.owner_entity_id
  JOIN entities e ON e.id = NEW.owner_entity_id
  JOIN entity_types et ON et.id = e.entity_type_id
  WHERE d.id = NEW.collection_definition_id
    AND et.key = d.owner_entity_type_key
)
BEGIN
  SELECT RAISE(ABORT, 'entity collection owner must belong to the definition space and type');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_collection_item_scope_update
BEFORE UPDATE OF collection_definition_id, owner_entity_id ON entity_collection_items
WHEN NOT EXISTS (
  SELECT 1
  FROM entity_collection_definitions d
  JOIN space_entity_ownership seo
    ON seo.space_id = d.space_id
   AND seo.entity_id = NEW.owner_entity_id
  JOIN entities e ON e.id = NEW.owner_entity_id
  JOIN entity_types et ON et.id = e.entity_type_id
  WHERE d.id = NEW.collection_definition_id
    AND et.key = d.owner_entity_type_key
)
BEGIN
  SELECT RAISE(ABORT, 'entity collection owner must belong to the definition space and type');
END;

-- A row value may refer only to a field from the same collection schema.
CREATE TRIGGER IF NOT EXISTS trg_entity_collection_value_field_insert
BEFORE INSERT ON entity_collection_item_values
WHEN NOT EXISTS (
  SELECT 1
  FROM entity_collection_items item
  JOIN entity_collection_fields field
    ON field.collection_definition_id = item.collection_definition_id
   AND field.id = NEW.field_id
  WHERE item.id = NEW.item_id
)
BEGIN
  SELECT RAISE(ABORT, 'entity collection value field must belong to the item collection');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_collection_value_field_update
BEFORE UPDATE OF item_id, field_id ON entity_collection_item_values
WHEN NOT EXISTS (
  SELECT 1
  FROM entity_collection_items item
  JOIN entity_collection_fields field
    ON field.collection_definition_id = item.collection_definition_id
   AND field.id = NEW.field_id
  WHERE item.id = NEW.item_id
)
BEGIN
  SELECT RAISE(ABORT, 'entity collection value field must belong to the item collection');
END;

-- Moving an owner to another space while it still has collection rows would
-- make the collection inaccessible and violate the space boundary.
CREATE TRIGGER IF NOT EXISTS trg_space_entity_collection_move_guard
BEFORE UPDATE OF space_id ON space_entity_ownership
WHEN EXISTS (
  SELECT 1
  FROM entity_collection_items item
  WHERE item.owner_entity_id = OLD.entity_id
)
BEGIN
  SELECT RAISE(ABORT, 'remove entity collection items before moving entity to another space');
END;
