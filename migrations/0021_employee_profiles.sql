-- Standard employee profile support and idempotent employee creation.

INSERT OR IGNORE INTO entity_types(
  id, key, label, description, schema_json, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000002',
  'person',
  'Сотрудник',
  'Карточка сотрудника для подстановки данных в шаблоны.',
  '{}',
  '1970-01-01T00:00:00.000Z',
  '1970-01-01T00:00:00.000Z'
);

CREATE TABLE IF NOT EXISTS employee_create_requests (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  employee_id TEXT NOT NULL UNIQUE REFERENCES entities(id) ON DELETE CASCADE,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(space_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_employee_create_requests_employee
  ON employee_create_requests(employee_id);
