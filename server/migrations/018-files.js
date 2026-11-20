// 018 — File library: files uploaded per project, sendable as WhatsApp attachments.
export const id = '018-files';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      disk_path TEXT NOT NULL,
      uploaded_by TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id, created_at DESC);
  `);
}
