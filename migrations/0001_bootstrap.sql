-- Initial persistence model for the modular monolith.
-- Migrations are immutable after merge. Add a new numbered file for changes.

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  storage_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS entity_types (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  schema_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  entity_type_id TEXT NOT NULL REFERENCES entity_types(id),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entities_type_status
  ON entities(entity_type_id, status);

CREATE TABLE IF NOT EXISTS property_definitions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  value_type TEXT NOT NULL,
  unit TEXT,
  cardinality TEXT NOT NULL DEFAULT 'single',
  sensitivity TEXT NOT NULL DEFAULT 'internal',
  applies_to_json TEXT NOT NULL DEFAULT '[]',
  validation_json TEXT NOT NULL DEFAULT '{}',
  aliases_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_property_values (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  property_definition_id TEXT NOT NULL REFERENCES property_definitions(id),
  value_json TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  confidence REAL,
  confirmed_by TEXT,
  valid_from TEXT,
  valid_to TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_property_values_lookup
  ON entity_property_values(entity_id, property_definition_id, valid_from, valid_to);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id),
  version INTEGER NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('docx', 'xlsx', 'bundle')),
  original_file_id TEXT REFERENCES files(id),
  compiled_file_id TEXT REFERENCES files(id),
  manifest_json TEXT NOT NULL,
  compatibility_level TEXT NOT NULL DEFAULT 'safe-scalar',
  status TEXT NOT NULL DEFAULT 'draft',
  activated_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(template_id, version)
);

CREATE TABLE IF NOT EXISTS document_jobs (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT,
  template_version_id TEXT NOT NULL REFERENCES template_versions(id),
  state TEXT NOT NULL,
  requested_by TEXT,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT,
  context_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_document_jobs_state
  ON document_jobs(state, created_at);

CREATE TABLE IF NOT EXISTS job_values (
  id TEXT PRIMARY KEY,
  document_job_id TEXT NOT NULL REFERENCES document_jobs(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL,
  value_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(document_job_id, field_id)
);

CREATE TABLE IF NOT EXISTS generated_files (
  id TEXT PRIMARY KEY,
  document_job_id TEXT NOT NULL REFERENCES document_jobs(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id),
  role TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(document_job_id, role, revision)
);

CREATE TABLE IF NOT EXISTS worker_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 100,
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT NOT NULL,
  locked_by TEXT,
  locked_at TEXT,
  lease_expires_at TEXT,
  last_error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_worker_jobs_claim
  ON worker_jobs(state, next_attempt_at, priority, created_at);

CREATE TABLE IF NOT EXISTS domain_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  source TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  entity_id TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  published_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  trigger_json TEXT NOT NULL,
  filter_json TEXT NOT NULL DEFAULT '{}',
  target_json TEXT NOT NULL,
  template_policy_json TEXT NOT NULL,
  execution_policy_json TEXT NOT NULL,
  delivery_policy_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  automation_rule_id TEXT NOT NULL REFERENCES automation_rules(id),
  planned_at TEXT,
  event_id TEXT REFERENCES domain_events(id),
  target_key TEXT,
  state TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  summary_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_tasks (
  id TEXT PRIMARY KEY,
  document_job_id TEXT REFERENCES document_jobs(id),
  automation_run_id TEXT REFERENCES automation_runs(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  assigned_role TEXT,
  due_at TEXT,
  resolution_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  document_job_id TEXT NOT NULL REFERENCES document_jobs(id),
  channel TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL UNIQUE,
  configuration_json TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  result_json TEXT,
  error_json TEXT,
  UNIQUE(delivery_id, attempt)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT,
  correlation_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_correlation
  ON audit_log(correlation_id, occurred_at);
