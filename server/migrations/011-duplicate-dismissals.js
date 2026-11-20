// 011 — remember "not duplicates" decisions so a group (e.g. two branches sharing a hotline) stays hidden.
export const id = '011-duplicate-dismissals';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS duplicate_dismissals (
      project_id TEXT NOT NULL,
      key TEXT NOT NULL,
      account_id TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, key)
    );
  `);
}
