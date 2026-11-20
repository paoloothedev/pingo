// 007 — companies (organisations). Contacts link to one company via leads.company_id.
export const id = '007-companies';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT '',
      industry TEXT NOT NULL DEFAULT '',
      size TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      owner_id TEXT,
      source TEXT NOT NULL DEFAULT '',
      custom TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_companies_project_name ON companies(project_id, name);
    CREATE INDEX IF NOT EXISTS idx_companies_project_domain ON companies(project_id, domain);
    CREATE INDEX IF NOT EXISTS idx_companies_owner ON companies(owner_id);
  `);
}
