// 005 — persist WhatsApp messages sent per project per day, so a restart can't reset the daily anti-ban limit.
export const id = '005-wa-daily-counts';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_daily_counts (
      project_id TEXT NOT NULL,
      day TEXT NOT NULL,
      sent INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (project_id, day)
    );
  `);
}
