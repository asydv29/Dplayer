-- Sessions moved from Workers KV to D1 (see SESSION-FIX.txt for why).
-- The Worker also creates this table automatically on first request,
-- so running this manually is optional.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);
