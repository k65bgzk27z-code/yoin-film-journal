-- Additive only: new tables for user lists, notices and the want-list availability checker.
CREATE TABLE IF NOT EXISTS lists (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS notices (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS notices_created ON notices(created);
CREATE TABLE IF NOT EXISTS watch_checks (record_id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, checked_at INTEGER NOT NULL);
