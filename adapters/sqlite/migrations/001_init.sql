CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  id TEXT,
  value BLOB,
  trace_id TEXT,
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS state (
  id TEXT PRIMARY KEY,
  value BLOB
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_trace_id_id ON events(trace_id, id) WHERE trace_id IS NOT NULL AND id IS NOT NULL;
