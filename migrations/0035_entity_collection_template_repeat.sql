-- Domain binding for a repeated DOCX row backed by an ordered entity collection.
-- The low-level OOXML repeat contract remains immutable and deterministic; this table
-- binds that physical row to one space-scoped collection owned by the document subject.

CREATE TABLE IF NOT EXISTS entity_collection_template_repeats (
  draft_id TEXT PRIMARY KEY REFERENCES template_drafts(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  collection_definition_id TEXT NOT NULL
    REFERENCES entity_collection_definitions(id) ON DELETE RESTRICT,
  collection_key_snapshot TEXT NOT NULL,
  collection_version_snapshot INTEGER NOT NULL CHECK (collection_version_snapshot >= 1),
  anchor_element_id TEXT NOT NULL,
  part TEXT NOT NULL,
  table_index INTEGER NOT NULL CHECK (table_index >= 0),
  row_index INTEGER NOT NULL CHECK (row_index >= 0),
  numbering_start INTEGER NOT NULL DEFAULT 1 CHECK (numbering_start >= 0 AND numbering_start <= 1000000),
  numbering_step INTEGER NOT NULL DEFAULT 1 CHECK (numbering_step >= 1 AND numbering_step <= 1000000),
  empty_behavior TEXT NOT NULL DEFAULT 'error' CHECK (empty_behavior IN ('error')),
  created_by TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entity_collection_template_repeats_space_collection
  ON entity_collection_template_repeats(space_id, collection_definition_id, draft_id);

CREATE TRIGGER IF NOT EXISTS trg_entity_collection_template_repeat_scope_insert
BEFORE INSERT ON entity_collection_template_repeats
WHEN NOT EXISTS (
  SELECT 1
  FROM template_drafts draft
  JOIN entity_collection_definitions definition
    ON definition.id = NEW.collection_definition_id
   AND definition.space_id = NEW.space_id
  WHERE draft.id = NEW.draft_id
    AND draft.space_id = NEW.space_id
    AND draft.format = 'docx'
    AND definition.status = 'active'
    AND definition.key = NEW.collection_key_snapshot
    AND definition.version = NEW.collection_version_snapshot
)
BEGIN
  SELECT RAISE(ABORT, 'entity collection template repeat must stay inside one space and DOCX draft');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_collection_template_repeat_immutable
BEFORE UPDATE ON entity_collection_template_repeats
BEGIN
  SELECT RAISE(ABORT, 'entity collection template repeat is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_collection_definition_archive_guard
BEFORE UPDATE OF status ON entity_collection_definitions
WHEN NEW.status = 'archived' AND EXISTS (
  SELECT 1
  FROM entity_collection_template_repeats repeat
  WHERE repeat.collection_definition_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'entity collection definition is used by a template repeat');
END;
