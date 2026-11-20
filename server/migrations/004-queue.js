// 004 — durable background job queue (see worker/index.js).
export const id = '004-queue';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      project_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      run_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      last_error TEXT,
      dedupe_key TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_queue_due ON queue(status, run_at);
    CREATE INDEX IF NOT EXISTS idx_queue_project ON queue(project_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_dedupe ON queue(dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'running');
  `);
}
