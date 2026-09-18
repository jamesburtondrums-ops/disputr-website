CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_support_messages_created_at
  ON support_messages(created_at);

