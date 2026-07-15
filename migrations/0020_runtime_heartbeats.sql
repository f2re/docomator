-- Runtime service heartbeats for the operational readiness dashboard.

CREATE TABLE IF NOT EXISTS runtime_service_heartbeats (
  service_type TEXT NOT NULL CHECK (service_type IN ('api', 'worker')),
  instance_id TEXT NOT NULL,
  version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('starting', 'running', 'stopping', 'failed')),
  details_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(service_type, instance_id)
);

CREATE INDEX IF NOT EXISTS idx_runtime_service_heartbeats_latest
  ON runtime_service_heartbeats(service_type, updated_at DESC, instance_id);
