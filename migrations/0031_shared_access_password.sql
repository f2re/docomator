-- One shared application password, no users/roles/ACL.
CREATE TABLE shared_access_password (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  password_hash TEXT NOT NULL,
  configured_at TEXT NOT NULL
);
