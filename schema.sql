CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  credentials TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS watches (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  subject TEXT NOT NULL,
  subject_code TEXT NOT NULL,
  class_code TEXT NOT NULL,
  state TEXT CHECK(state IN ('open', 'closed') OR state IS NULL),
  last_error TEXT,
  checked_at TEXT
);
CREATE TABLE IF NOT EXISTS destinations (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id),
  kind TEXT NOT NULL CHECK(kind IN ('discord', 'whatsapp', 'phone')),
  config TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  destination_id TEXT NOT NULL REFERENCES destinations(id),
  watch_id TEXT NOT NULL REFERENCES watches(id),
  availability TEXT CHECK(availability IN ('open', 'closed')),
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  next_attempt_at TEXT
);
CREATE TABLE IF NOT EXISTS monitor_status (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  started_at TEXT,
  finished_at TEXT,
  last_error TEXT,
  last_summary TEXT
);
