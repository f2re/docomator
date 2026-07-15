-- Idempotent employee profile updates. Applied migrations remain immutable.

CREATE TABLE IF NOT EXISTS employee_update_requests (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(space_id, employee_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_employee_update_requests_employee
  ON employee_update_requests(employee_id, created_at DESC);
