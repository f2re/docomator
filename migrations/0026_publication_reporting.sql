-- Publication authorship, classification and immutable report snapshots.
-- The generic entity/property registry remains the source of publication metadata.

CREATE TABLE IF NOT EXISTS publication_registry_settings (
  space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
  publication_entity_type_key TEXT NOT NULL,
  teacher_entity_type_key TEXT NOT NULL,
  publication_year_property_key TEXT,
  publication_date_property_key TEXT,
  teacher_department_property_key TEXT,
  doi_property_key TEXT,
  journal_property_key TEXT,
  bibliography_property_key TEXT,
  status_property_key TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publication_authorships (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  publication_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  author_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'author'
    CHECK (role IN ('author', 'corresponding_author', 'editor', 'translator')),
  position INTEGER NOT NULL CHECK (position >= 0),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(publication_entity_id, author_entity_id),
  UNIQUE(publication_entity_id, position)
);

CREATE INDEX IF NOT EXISTS idx_publication_authorships_space_publication
  ON publication_authorships(space_id, publication_entity_id, position);
CREATE INDEX IF NOT EXISTS idx_publication_authorships_author
  ON publication_authorships(space_id, author_entity_id, publication_entity_id);

CREATE TABLE IF NOT EXISTS publication_classifications (
  publication_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  code TEXT NOT NULL
    CHECK (code IN ('vak', 'rinc', 'mbd', 'scopus', 'web_of_science', 'rinc_core')),
  state TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (state IN ('confirmed', 'review', 'excluded')),
  source TEXT,
  checked_at TEXT,
  note TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(publication_entity_id, code)
);

CREATE INDEX IF NOT EXISTS idx_publication_classifications_filter
  ON publication_classifications(space_id, code, state, publication_entity_id);

CREATE TABLE IF NOT EXISTS publication_report_snapshots (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  criteria_json TEXT NOT NULL,
  totals_json TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count > 0),
  created_by TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_publication_report_snapshots_space_created
  ON publication_report_snapshots(space_id, created_at DESC);

CREATE TABLE IF NOT EXISTS publication_report_rows (
  snapshot_id TEXT NOT NULL REFERENCES publication_report_snapshots(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  publication_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  row_json TEXT NOT NULL,
  PRIMARY KEY(snapshot_id, publication_entity_id),
  UNIQUE(snapshot_id, position)
);

CREATE TRIGGER IF NOT EXISTS trg_publication_authorship_type_guard_insert
BEFORE INSERT ON publication_authorships
WHEN NOT EXISTS (
  SELECT 1
  FROM publication_registry_settings settings
  JOIN entities publication ON publication.id = NEW.publication_entity_id
  JOIN entity_types publication_type ON publication_type.id = publication.entity_type_id
  WHERE settings.space_id = NEW.space_id
    AND publication_type.key = settings.publication_entity_type_key
)
BEGIN
  SELECT RAISE(ABORT, 'authorship source must use the configured publication type');
END;

CREATE TRIGGER IF NOT EXISTS trg_publication_authorship_type_guard_update
BEFORE UPDATE OF space_id, publication_entity_id ON publication_authorships
WHEN NOT EXISTS (
  SELECT 1
  FROM publication_registry_settings settings
  JOIN entities publication ON publication.id = NEW.publication_entity_id
  JOIN entity_types publication_type ON publication_type.id = publication.entity_type_id
  WHERE settings.space_id = NEW.space_id
    AND publication_type.key = settings.publication_entity_type_key
)
BEGIN
  SELECT RAISE(ABORT, 'authorship source must use the configured publication type');
END;

CREATE TRIGGER IF NOT EXISTS trg_publication_authorship_space_guard_insert
BEFORE INSERT ON publication_authorships
WHEN NOT EXISTS (
  SELECT 1
  FROM space_entity_ownership publication_owner
  JOIN space_entity_ownership author_owner
    ON author_owner.space_id = publication_owner.space_id
  WHERE publication_owner.space_id = NEW.space_id
    AND publication_owner.entity_id = NEW.publication_entity_id
    AND author_owner.entity_id = NEW.author_entity_id
)
BEGIN
  SELECT RAISE(ABORT, 'publication and author must belong to the same space');
END;

CREATE TRIGGER IF NOT EXISTS trg_publication_authorship_space_guard_update
BEFORE UPDATE OF space_id, publication_entity_id, author_entity_id ON publication_authorships
WHEN NOT EXISTS (
  SELECT 1
  FROM space_entity_ownership publication_owner
  JOIN space_entity_ownership author_owner
    ON author_owner.space_id = publication_owner.space_id
  WHERE publication_owner.space_id = NEW.space_id
    AND publication_owner.entity_id = NEW.publication_entity_id
    AND author_owner.entity_id = NEW.author_entity_id
)
BEGIN
  SELECT RAISE(ABORT, 'publication and author must belong to the same space');
END;

CREATE TRIGGER IF NOT EXISTS trg_publication_classification_type_guard_insert
BEFORE INSERT ON publication_classifications
WHEN NOT EXISTS (
  SELECT 1
  FROM publication_registry_settings settings
  JOIN entities publication ON publication.id = NEW.publication_entity_id
  JOIN entity_types publication_type ON publication_type.id = publication.entity_type_id
  WHERE settings.space_id = NEW.space_id
    AND publication_type.key = settings.publication_entity_type_key
)
BEGIN
  SELECT RAISE(ABORT, 'classification source must use the configured publication type');
END;

CREATE TRIGGER IF NOT EXISTS trg_publication_classification_type_guard_update
BEFORE UPDATE OF space_id, publication_entity_id ON publication_classifications
WHEN NOT EXISTS (
  SELECT 1
  FROM publication_registry_settings settings
  JOIN entities publication ON publication.id = NEW.publication_entity_id
  JOIN entity_types publication_type ON publication_type.id = publication.entity_type_id
  WHERE settings.space_id = NEW.space_id
    AND publication_type.key = settings.publication_entity_type_key
)
BEGIN
  SELECT RAISE(ABORT, 'classification source must use the configured publication type');
END;

CREATE TRIGGER IF NOT EXISTS trg_publication_classification_space_guard_insert
BEFORE INSERT ON publication_classifications
WHEN NOT EXISTS (
  SELECT 1
  FROM space_entity_ownership ownership
  WHERE ownership.space_id = NEW.space_id
    AND ownership.entity_id = NEW.publication_entity_id
)
BEGIN
  SELECT RAISE(ABORT, 'publication classification must belong to the publication space');
END;

CREATE TRIGGER IF NOT EXISTS trg_publication_classification_space_guard_update
BEFORE UPDATE OF space_id, publication_entity_id ON publication_classifications
WHEN NOT EXISTS (
  SELECT 1
  FROM space_entity_ownership ownership
  WHERE ownership.space_id = NEW.space_id
    AND ownership.entity_id = NEW.publication_entity_id
)
BEGIN
  SELECT RAISE(ABORT, 'publication classification must belong to the publication space');
END;

CREATE TRIGGER IF NOT EXISTS trg_publication_entity_move_guard
BEFORE UPDATE OF space_id ON space_entity_ownership
WHEN EXISTS (
  SELECT 1
  FROM publication_authorships authorship
  WHERE authorship.publication_entity_id = OLD.entity_id
     OR authorship.author_entity_id = OLD.entity_id
)
OR EXISTS (
  SELECT 1
  FROM publication_classifications classification
  WHERE classification.publication_entity_id = OLD.entity_id
)
BEGIN
  SELECT RAISE(ABORT, 'remove publication links before moving the entity');
END;

CREATE TRIGGER IF NOT EXISTS trg_publication_system_property_guard
BEFORE INSERT ON entity_property_values
WHEN NEW.source_type <> 'publication-registry'
  AND EXISTS (
    SELECT 1
    FROM property_definitions definition
    WHERE definition.id = NEW.property_definition_id
      AND json_extract(definition.validation_json, '$.systemManaged') = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'publication derived properties are managed by the publication registry');
END;

CREATE TRIGGER IF NOT EXISTS trg_publication_report_snapshot_immutable
BEFORE UPDATE ON publication_report_snapshots
BEGIN
  SELECT RAISE(ABORT, 'publication report snapshots are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_publication_report_row_immutable
BEFORE UPDATE ON publication_report_rows
BEGIN
  SELECT RAISE(ABORT, 'publication report rows are immutable');
END;
