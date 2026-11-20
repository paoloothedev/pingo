// 010 — saved views: a user's named filter set for a list (contacts, companies, deals).
export const id = '010-saved-views';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_views (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      entity TEXT NOT NULL,
      name TEXT NOT NULL,
      filters TEXT NOT NULL DEFAULT '{}',
      shared INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_saved_views_owner ON saved_views(project_id, account_id, entity);
  `);
}
