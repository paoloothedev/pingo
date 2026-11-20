import { getDB } from '../db.js';

// Tables that carry project_id directly. Whitelisted because the name is interpolated into SQL.
const SCOPED = new Set([
  'leads', 'campaigns', 'stages', 'tags', 'message_templates', 'broadcast_jobs',
  'clients', 'email_campaigns', 'import_logs', 'companies',
  'pipelines', 'pipeline_stages', 'deals', 'wa_inbox_chats', 'wa_inbox_messages',
]);

function checkTable(table) {
  if (!SCOPED.has(table)) throw new Error(`scope: ${table} is not a project-scoped table`);
}

// Subset of `ids` whose rows in `table` belong to `projectId` (order preserved, duplicates removed).
export function ownedIds(table, projectId, ids) {
  checkTable(table);
  if (!Array.isArray(ids) || !ids.length) return [];
  const unique = [...new Set(ids.filter(id => typeof id === 'string' && id))];
  if (!unique.length) return [];
  const owned = new Set();
  // Chunk to stay under SQLite's bound-parameter limit
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const rows = getDB()
      .prepare(`SELECT id FROM ${table} WHERE project_id = ? AND id IN (${chunk.map(() => '?').join(',')})`)
      .all(projectId, ...chunk);
    for (const r of rows) owned.add(r.id);
  }
  return unique.filter(id => owned.has(id));
}

export function isOwned(table, projectId, id) {
  checkTable(table);
  if (typeof id !== 'string' || !id) return false;
  return !!getDB().prepare(`SELECT 1 FROM ${table} WHERE id = ? AND project_id = ?`).get(id, projectId);
}

// True if the account can be assigned records in this project (admin, or a member of the workspace).
export function isProjectMember(projectId, accountId) {
  if (typeof accountId !== 'string' || !accountId) return false;
  const db = getDB();
  const acc = db.prepare('SELECT role FROM accounts WHERE id = ?').get(accountId);
  if (!acc) return false;
  if (acc.role === 'admin') return true;
  return !!db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND account_id = ?').get(projectId, accountId);
}
