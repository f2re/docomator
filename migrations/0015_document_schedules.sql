-- Persistent schedules and idempotent period runs.
-- Applied migrations are immutable; add a new migration for later changes.

CREATE TABLE IF NOT EXISTS document_schedules (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  active_release_id TEXT NOT NULL REFERENCES template_releases(id),
  group_id TEXT NOT NULL REFERENCES audience_groups(id),
  target_mode TEXT NOT NULL CHECK (target_mode IN ('one_per_member', 'aggregate')),
  recurrence_kind TEXT NOT NULL CHECK (recurrence_kind IN ('once', 'daily', 'monthly')),
  timezone TEXT NOT NULL,
  local_time TEXT NOT NULL CHECK (length(local_time) = 5),
  start_date TEXT NOT NULL CHECK (length(start_date) = 10),
  day_of_month INTEGER CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 28),
  delivery_channel TEXT NOT NULL CHECK (delivery_channel IN ('none', 'email')),
  email_recipient_id TEXT REFERENCES space_email_recipients(id),
  email_subject TEXT,
  email_message_text TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  next_run_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by TEXT,
  updated_by TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(space_id, key)
);

CREATE INDEX IF NOT EXISTS idx_document_schedules_due
  ON document_schedules(status, next_run_at, id);

CREATE INDEX IF NOT EXISTS idx_document_schedules_space
  ON document_schedules(space_id, status, name COLLATE NOCASE, id);

CREATE TABLE IF NOT EXISTS document_schedule_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES document_schedules(id),
  space_id TEXT NOT NULL REFERENCES spaces(id),
  period_key TEXT NOT NULL,
  due_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (
    state IN ('pending', 'generation_requested', 'delivery_requested', 'completed', 'skipped', 'failed')
  ),
  schedule_version INTEGER NOT NULL CHECK (schedule_version >= 1),
  snapshot_id TEXT REFERENCES audience_snapshots(id),
  document_job_id TEXT REFERENCES document_generation_jobs(id),
  email_delivery_id TEXT REFERENCES document_email_deliveries(id),
  result_json TEXT,
  error_json TEXT,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(schedule_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_document_schedule_runs_state
  ON document_schedule_runs(state, due_at, id);

CREATE INDEX IF NOT EXISTS idx_document_schedule_runs_schedule
  ON document_schedule_runs(schedule_id, due_at DESC, id);

CREATE TRIGGER IF NOT EXISTS trg_document_schedule_scope_insert
BEFORE INSERT ON document_schedules
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM template_releases r
      JOIN audience_groups g ON g.id = NEW.group_id
      WHERE r.id = NEW.active_release_id
        AND r.space_id = NEW.space_id
        AND g.space_id = NEW.space_id
        AND g.status = 'active'
    )
    THEN RAISE(ABORT, 'schedule template and group must belong to the same space')
  END;
  SELECT CASE
    WHEN NEW.delivery_channel = 'email' AND NOT EXISTS (
      SELECT 1 FROM space_email_recipients e
      WHERE e.id = NEW.email_recipient_id
        AND e.space_id = NEW.space_id
        AND e.status = 'active'
    )
    THEN RAISE(ABORT, 'email schedule requires an active recipient in the same space')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_document_schedule_run_scope_insert
BEFORE INSERT ON document_schedule_runs
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM document_schedules s
      WHERE s.id = NEW.schedule_id
        AND s.space_id = NEW.space_id
    )
    THEN RAISE(ABORT, 'schedule run must belong to the schedule space')
  END;
END;
