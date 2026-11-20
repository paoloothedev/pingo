// 012 — per-contact outreach message draft (written by hand or by Claude over MCP, copied by the user)
// and personal access tokens for the MCP endpoint. Tokens belong to an account, not a workspace; only the
// sha256 of the token is stored.
export const id = '012-contact-message';

function hasColumn(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

export function up(db) {
  if (!hasColumn(db, 'leads', 'message')) db.exec("ALTER TABLE leads ADD COLUMN message TEXT NOT NULL DEFAULT ''");
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      token_hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_api_tokens_account ON api_tokens(account_id);
  `);
}
