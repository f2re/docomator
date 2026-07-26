-- Persistent visual identity for organizational spaces.
-- The backend performs strict #RRGGBB validation; the database keeps a safe
-- default for installations upgraded from earlier versions. This migration
-- must be deployed together with the space registry that reads and writes color.

ALTER TABLE spaces
  ADD COLUMN color TEXT NOT NULL DEFAULT '#5B8DEF'
    CHECK (length(color) = 7 AND substr(color, 1, 1) = '#');
