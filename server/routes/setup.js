import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { getDB, logAudit, createProject } from '../db.js';
import { wrap } from '../lib/async.js';
import { startSession } from './auth.js';

// First-run wizard. Open to anyone, but only while the install has no accounts at all: the first person to finish it
// becomes the admin, and from then on both routes are closed.
const router = Router();

const needsSetup = () => getDB().prepare('SELECT COUNT(*) AS c FROM accounts').get().c === 0;

router.get('/status', (req, res) => res.json({ needed: needsSetup() }));

router.post('/', wrap(async (req, res) => {
  if (!needsSetup()) return res.status(403).json({ error: 'Setup is already done' });
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const workspace = String(req.body?.workspace || '').trim().slice(0, 100);
  const countryCode = String(req.body?.countryCode || '').replace(/\D/g, '').slice(0, 4);
  const timezone = String(req.body?.timezone || '').slice(0, 64);
  if (!/^[\w.@-]{2,50}$/.test(username)) return res.status(400).json({ error: 'Username must be 2–50 letters, numbers or . _ - @' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!workspace) return res.status(400).json({ error: 'Workspace name is required' });

  const hash = await bcrypt.hash(password, 10);
  const db = getDB();
  const done = db.transaction(() => {
    if (!needsSetup()) return null; // someone else finished while the password was hashing
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO accounts (id, username, password_hash, display_name, role, permissions, created_at) VALUES (?, ?, ?, ?, 'admin', '[]', ?)")
      .run(id, username, hash, String(req.body?.displayName || '').trim().slice(0, 100) || username, Date.now());
    let project = db.prepare('SELECT * FROM projects ORDER BY created_at ASC LIMIT 1').get();
    if (project) db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(workspace, project.id);
    else project = createProject(workspace, null, null, id);
    const setting = db.prepare('INSERT OR REPLACE INTO settings (project_id, key, value) VALUES (?, ?, ?)');
    if (countryCode) setting.run(project.id, 'country_code', countryCode);
    if (timezone) setting.run(project.id, 'timezone', timezone);
    return { account: db.prepare('SELECT * FROM accounts WHERE id = ?').get(id), projectId: project.id };
  })();
  if (!done) return res.status(403).json({ error: 'Setup is already done' });

  logAudit('setup', 'account', done.account.id, username, {}, done.projectId);
  startSession(req, res, done.account);
  res.json({
    id: done.account.id, username, display_name: done.account.display_name, role: 'admin', permissions: [],
    default_password: false, project_id: done.projectId,
  });
}));

export default router;
