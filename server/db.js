import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { runMigrations } from './migrations/index.js';
import { ensureDefaultPipeline } from './lib/pipelines.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.DB_PATH || join(__dirname, 'leaddesk.db');

let db;

export function logAudit(action, entityType, entityId, entityName, details = {}, projectId = null) {
  try {
    const db2 = getDB();
    db2.prepare('INSERT INTO audit_log (action, entity_type, entity_id, entity_name, details, created_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(action, entityType, entityId || '', entityName || '', JSON.stringify(details), Date.now(), projectId);
  } catch {}
}

export function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    seedAdminAccount();
    ensureStagesForAllProjects();
  }
  return db;
}

function seedAdminAccount() {
  // A new install has no accounts: the setup wizard creates the admin (routes/setup.js). SEED_ADMIN=1 is for tests and
  // scripts that need the old admin/admin login.
  const count = db.prepare('SELECT COUNT(*) as c FROM accounts').get();
  if (count.c === 0 && process.env.SEED_ADMIN === '1') {
    const hash = bcrypt.hashSync('admin', 10);
    db.prepare("INSERT INTO accounts (id, username, password_hash, display_name, role, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run('admin', 'admin', hash, 'Admin', 'admin', '[]', Date.now());
  }
}

const DEFAULT_STAGES = [
  ['s1', 'Cold Calling', '#3d5a45', 0],
  ['s2', 'Contacted', '#c79a3f', 1],
  ['s3', 'Interested', '#3a7ca1', 2],
  ['s4', 'Customer', '#3d7a52', 3],
  ['s5', 'Lost', '#a13a3a', 4],
];

export function seedStagesForProject(projectId) {
  const count = db.prepare('SELECT COUNT(*) as c FROM stages WHERE project_id = ?').get(projectId).c;
  if (count > 0) return;
  const insert = db.prepare('INSERT INTO stages (id, name, color, sort_order, project_id) VALUES (?, ?, ?, ?, ?)');
  // Stage ids must be globally unique (PK). Use a per-project suffix.
  const suffix = projectId.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || crypto.randomBytes(3).toString('hex');
  for (const [id, name, color, order] of DEFAULT_STAGES) {
    insert.run(`${id}_${suffix}`, name, color, order, projectId);
  }
}

function ensureStagesForAllProjects() {
  const projects = db.prepare('SELECT id FROM projects').all();
  for (const p of projects) {
    seedStagesForProject(p.id);
  }
  // Legacy: stages with no project_id (shouldn't happen after migration, but safe)
  try {
    const orphan = db.prepare('SELECT COUNT(*) as c FROM stages WHERE project_id IS NULL').get().c;
    if (orphan > 0) {
      const def = db.prepare('SELECT id FROM projects ORDER BY created_at ASC LIMIT 1').get();
      if (def) db.prepare('UPDATE stages SET project_id = ? WHERE project_id IS NULL').run(def.id);
    }
  } catch {}
}

export function createProject(name, color, icon, createdBy) {
  const id = 'proj_' + crypto.randomBytes(6).toString('hex');
  db.prepare('INSERT INTO projects (id, name, color, icon, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name || 'Untitled', color || '#10b981', icon || '📁', Date.now(), createdBy || null);
  seedStagesForProject(id);
  ensureDefaultPipeline(db, id);
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
}
