-- Persistence kernel projections, queue idempotency and outbox leasing.
-- The bootstrap migration remains immutable; all changes are additive.

ALTER TABLE worker_jobs ADD COLUMN idempotency_key TEXT;
ALTER TABLE worker_jobs ADD COLUMN completed_at TEXT;
ALTER TABLE worker_jobs ADD COLUMN dead_lettered_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_jobs_idempotency
  ON worker_jobs(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_worker_jobs_lease
  ON worker_jobs(state, lease_expires_at)
  WHERE state = 'running';

ALTER TABLE domain_events
  ADD COLUMN dispatch_state TEXT NOT NULL DEFAULT 'pending'
  CHECK (dispatch_state IN ('pending', 'running', 'retry', 'published', 'dead_letter'));
ALTER TABLE domain_events ADD COLUMN dispatch_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE domain_events ADD COLUMN max_dispatch_attempts INTEGER NOT NULL DEFAULT 20;
ALTER TABLE domain_events ADD COLUMN next_dispatch_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
ALTER TABLE domain_events ADD COLUMN dispatch_locked_by TEXT;
ALTER TABLE domain_events ADD COLUMN dispatch_locked_at TEXT;
ALTER TABLE domain_events ADD COLUMN dispatch_lease_expires_at TEXT;
ALTER TABLE domain_events ADD COLUMN dispatch_last_error_json TEXT;

UPDATE domain_events
SET dispatch_state = 'published'
WHERE published_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_domain_events_dispatch
  ON domain_events(dispatch_state, next_dispatch_at, created_at);

CREATE INDEX IF NOT EXISTS idx_domain_events_dispatch_lease
  ON domain_events(dispatch_state, dispatch_lease_expires_at)
  WHERE dispatch_state = 'running';

ALTER TABLE entity_property_values ADD COLUMN value_type TEXT;
ALTER TABLE entity_property_values ADD COLUMN value_text TEXT;
ALTER TABLE entity_property_values ADD COLUMN value_number REAL;
ALTER TABLE entity_property_values ADD COLUMN value_integer INTEGER;
ALTER TABLE entity_property_values ADD COLUMN value_boolean INTEGER;
ALTER TABLE entity_property_values ADD COLUMN value_date TEXT;
ALTER TABLE entity_property_values ADD COLUMN value_datetime TEXT;
ALTER TABLE entity_property_values ADD COLUMN value_entity_id TEXT REFERENCES entities(id);
ALTER TABLE entity_property_values ADD COLUMN value_file_id TEXT REFERENCES files(id);

CREATE INDEX IF NOT EXISTS idx_property_values_text_projection
  ON entity_property_values(property_definition_id, value_text)
  WHERE value_text IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_property_values_number_projection
  ON entity_property_values(property_definition_id, value_number)
  WHERE value_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_property_values_integer_projection
  ON entity_property_values(property_definition_id, value_integer)
  WHERE value_integer IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_property_values_date_projection
  ON entity_property_values(property_definition_id, value_date)
  WHERE value_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_property_values_datetime_projection
  ON entity_property_values(property_definition_id, value_datetime)
  WHERE value_datetime IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_property_values_entity_projection
  ON entity_property_values(property_definition_id, value_entity_id)
  WHERE value_entity_id IS NOT NULL;
