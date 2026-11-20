// 002 — workspace membership for agency mode. Admins see every workspace; everyone else only the
// workspaces they are a member of. Existing non-admin accounts are added to every existing workspace so
// nobody loses access on upgrade.
export const id = '002-project-members';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, account_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_project_members_account ON project_members(account_id);
  `);
  db.prepare(`
    INSERT OR IGNORE INTO project_members (project_id, account_id, created_at)
    SELECT p.id, a.id, ? FROM projects p CROSS JOIN accounts a WHERE a.role != 'admin'
  `).run(Date.now());
}
