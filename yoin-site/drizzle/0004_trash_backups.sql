-- Additive only: soft-delete trash and in-D1 weekly backups.
CREATE TABLE IF NOT EXISTS trash (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL, deleted_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS trash_deleted ON trash(deleted_at);
CREATE TABLE IF NOT EXISTS backups (id TEXT PRIMARY KEY NOT NULL, created INTEGER NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL, chunks INTEGER NOT NULL, summary TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS backup_chunks (backup_id TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (backup_id, idx));
