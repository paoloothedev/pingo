// 014 — scheduled broadcasts: a job with scheduled_at in the future has status 'scheduled' until it is due.
export const id = '014-scheduled-broadcasts';

function hasColumn(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

export function up(db) {
  if (!hasColumn(db, 'broadcast_jobs', 'scheduled_at')) db.exec('ALTER TABLE broadcast_jobs ADD COLUMN scheduled_at INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS idx_broadcast_jobs_scheduled ON broadcast_jobs(status, scheduled_at)');
}
