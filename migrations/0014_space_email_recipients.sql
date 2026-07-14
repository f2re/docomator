-- Saved email recipients scoped to one workspace.
-- Applied migrations are immutable; add a new migration for later changes.

CREATE TABLE IF NOT EXISTS space_email_recipients (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by TEXT,
  updated_by TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(space_id, key),
  UNIQUE(space_id, email)
);

CREATE INDEX IF NOT EXISTS idx_space_email_recipients_space
  ON space_email_recipients(space_id, status, name COLLATE NOCASE, id);
