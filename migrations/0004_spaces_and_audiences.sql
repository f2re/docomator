-- Isolated spaces, named audience groups and immutable document target snapshots.
-- Existing entities are assigned to the deterministic default space.

CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO spaces(
  id, key, name, description, status, version, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'default',
  'Основное пространство',
  'Пространство, созданное автоматически для существующих и системных данных.',
  'active',
  1,
  '1970-01-01T00:00:00.000Z',
  '1970-01-01T00:00:00.000Z'
);

CREATE TABLE IF NOT EXISTS space_actor_memberships (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('owner', 'manager', 'editor', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(space_id, actor_id)
);

CREATE INDEX IF NOT EXISTS idx_space_actor_memberships_actor
  ON space_actor_memberships(actor_id, status, space_id);

CREATE TABLE IF NOT EXISTS space_entity_ownership (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  entity_id TEXT NOT NULL UNIQUE REFERENCES entities(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  assigned_at TEXT NOT NULL,
  assigned_by TEXT,
  PRIMARY KEY(space_id, entity_id)
);

INSERT OR IGNORE INTO space_entity_ownership(
  space_id, entity_id, version, assigned_at, assigned_by
)
SELECT
  '00000000-0000-4000-8000-000000000001',
  id,
  1,
  created_at,
  'migration:0004'
FROM entities;

CREATE INDEX IF NOT EXISTS idx_space_entity_ownership_space
  ON space_entity_ownership(space_id, entity_id);

CREATE TRIGGER IF NOT EXISTS trg_entities_assign_default_space
AFTER INSERT ON entities
WHEN NOT EXISTS (
  SELECT 1 FROM space_entity_ownership WHERE entity_id = NEW.id
)
BEGIN
  INSERT INTO space_entity_ownership(
    space_id, entity_id, version, assigned_at, assigned_by
  ) VALUES (
    '00000000-0000-4000-8000-000000000001',
    NEW.id,
    1,
    NEW.created_at,
    'trigger:default-space'
  );
END;

CREATE TABLE IF NOT EXISTS audience_groups (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(space_id, key)
);

CREATE INDEX IF NOT EXISTS idx_audience_groups_space_status
  ON audience_groups(space_id, status, name);

CREATE TABLE IF NOT EXISTS audience_group_members (
  group_id TEXT NOT NULL REFERENCES audience_groups(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  added_at TEXT NOT NULL,
  added_by TEXT,
  PRIMARY KEY(group_id, entity_id),
  UNIQUE(group_id, position)
);

CREATE INDEX IF NOT EXISTS idx_audience_group_members_entity
  ON audience_group_members(entity_id, group_id);

CREATE TRIGGER IF NOT EXISTS trg_audience_group_member_space_guard_insert
BEFORE INSERT ON audience_group_members
WHEN NOT EXISTS (
  SELECT 1
  FROM audience_groups g
  JOIN space_entity_ownership seo
    ON seo.space_id = g.space_id
   AND seo.entity_id = NEW.entity_id
  WHERE g.id = NEW.group_id
)
BEGIN
  SELECT RAISE(ABORT, 'audience group member must belong to the same space');
END;

CREATE TRIGGER IF NOT EXISTS trg_audience_group_member_space_guard_update
BEFORE UPDATE OF group_id, entity_id ON audience_group_members
WHEN NOT EXISTS (
  SELECT 1
  FROM audience_groups g
  JOIN space_entity_ownership seo
    ON seo.space_id = g.space_id
   AND seo.entity_id = NEW.entity_id
  WHERE g.id = NEW.group_id
)
BEGIN
  SELECT RAISE(ABORT, 'audience group member must belong to the same space');
END;

CREATE TRIGGER IF NOT EXISTS trg_space_entity_move_guard
BEFORE UPDATE OF space_id ON space_entity_ownership
WHEN EXISTS (
  SELECT 1
  FROM audience_group_members gm
  WHERE gm.entity_id = OLD.entity_id
)
BEGIN
  SELECT RAISE(ABORT, 'remove entity from audience groups before moving it to another space');
END;

CREATE TABLE IF NOT EXISTS audience_snapshots (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('all_space', 'group', 'selected')),
  source_id TEXT,
  target_mode TEXT NOT NULL
    CHECK (target_mode IN ('one_per_member', 'aggregate')),
  entity_type_key TEXT,
  member_count INTEGER NOT NULL CHECK (member_count > 0),
  criteria_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audience_snapshots_space_created
  ON audience_snapshots(space_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audience_snapshot_members (
  snapshot_id TEXT NOT NULL REFERENCES audience_snapshots(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  display_name_snapshot TEXT NOT NULL,
  entity_type_key_snapshot TEXT NOT NULL,
  entity_status_snapshot TEXT NOT NULL,
  PRIMARY KEY(snapshot_id, entity_id),
  UNIQUE(snapshot_id, position)
);

CREATE TRIGGER IF NOT EXISTS trg_audience_snapshot_member_space_guard
BEFORE INSERT ON audience_snapshot_members
WHEN NOT EXISTS (
  SELECT 1
  FROM audience_snapshots snapshot
  JOIN space_entity_ownership seo
    ON seo.space_id = snapshot.space_id
   AND seo.entity_id = NEW.entity_id
  WHERE snapshot.id = NEW.snapshot_id
)
BEGIN
  SELECT RAISE(ABORT, 'audience snapshot member must belong to the snapshot space');
END;

CREATE TRIGGER IF NOT EXISTS trg_audience_snapshot_immutable
BEFORE UPDATE ON audience_snapshots
BEGIN
  SELECT RAISE(ABORT, 'audience snapshots are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_audience_snapshot_member_immutable
BEFORE UPDATE ON audience_snapshot_members
BEGIN
  SELECT RAISE(ABORT, 'audience snapshot members are immutable');
END;

ALTER TABLE document_jobs
  ADD COLUMN space_id TEXT REFERENCES spaces(id);
ALTER TABLE document_jobs
  ADD COLUMN audience_snapshot_id TEXT REFERENCES audience_snapshots(id);
ALTER TABLE document_jobs
  ADD COLUMN target_mode TEXT
    CHECK (target_mode IS NULL OR target_mode IN ('one_per_member', 'aggregate'));

CREATE INDEX IF NOT EXISTS idx_document_jobs_space_state
  ON document_jobs(space_id, state, created_at);

ALTER TABLE automation_rules
  ADD COLUMN space_id TEXT REFERENCES spaces(id);

CREATE INDEX IF NOT EXISTS idx_automation_rules_space_enabled
  ON automation_rules(space_id, enabled, updated_at);
