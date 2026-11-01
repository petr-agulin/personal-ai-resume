-- What visitors typed into the AI panel, and AI errors (SPEC §9).
-- No IP address, user agent, cookie or visitor ID is ever stored.
CREATE TABLE entries (
  id      INTEGER PRIMARY KEY,
  ts      TEXT NOT NULL,          -- ISO 8601 UTC
  kind    TEXT NOT NULL,          -- 'chat' | 'fit' | 'error'
  lang    TEXT,                   -- page language
  text    TEXT NOT NULL,          -- what the visitor typed, or a short error description
  score   INTEGER,                -- fit only
  label   TEXT,                   -- fit only
  role    TEXT,                   -- fit only, extracted by the AI
  company TEXT                    -- fit only, extracted by the AI
);
CREATE INDEX entries_ts ON entries(ts);
CREATE INDEX entries_kind_ts ON entries(kind, ts);
