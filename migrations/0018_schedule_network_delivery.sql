-- Optional network-folder delivery settings for persistent schedules.
-- The base schedule keeps delivery_channel='none' for compatibility with the
-- immutable 0015 table constraint; this companion row makes it network-backed.

CREATE TABLE IF NOT EXISTS document_schedule_network_settings (
  schedule_id TEXT PRIMARY KEY REFERENCES document_schedules(id) ON DELETE CASCADE,
  subdirectory_template TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_schedule_network_settings_updated
  ON document_schedule_network_settings(updated_at DESC, schedule_id);

CREATE TRIGGER IF NOT EXISTS trg_document_schedule_network_setting_insert
BEFORE INSERT ON document_schedule_network_settings
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM document_schedules s
      WHERE s.id = NEW.schedule_id
        AND s.delivery_channel = 'none'
        AND s.email_recipient_id IS NULL
    )
    THEN RAISE(ABORT, 'network schedule must use the compatible none base channel')
  END;
END;
