import { Router } from 'express';
import { getDB, logAudit } from '../db.js';
import { authMiddleware, requirePermission } from './auth.js';
import { canAccessProject } from '../middleware/project.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const router = Router();

router.use(authMiddleware);

// Non-admins may only manage accounts they created, only grant permissions they hold themselves,
// and only assign workspaces they can access.
function canManage(user, account) {
  return user.role === 'admin' ? account.role !== 'admin' || account.id === user.id : account.parent_id === user.id;
}
function grantable(user, permissions) {
  const list = Array.isArray(permissions) ? permissions.filter(p => typeof p === 'string') : [];
  return user.role === 'admin' ? list : list.filter(p => user.permissions.includes(p));
}
function accessibleProjectIds(user, projectIds) {
  if (!Array.isArray(projectIds)) return [];
  return [...new Set(projectIds)].filter(pid => canAccessProject(user, pid));
}
function setMemberships(db, accountId, projectIds, user) {
  // Only touch memberships of workspaces the acting user can see
  const visible = user.role === 'admin'
    ? db.prepare('SELECT id FROM projects').all().map(r => r.id)
    : db.prepare('SELECT project_id AS id FROM project_members WHERE account_id = ?').all(user.id).map(r => r.id);
  const del = db.prepare('DELETE FROM project_members WHERE account_id = ? AND project_id = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO project_members (project_id, account_id, created_at) VALUES (?, ?, ?)');
  const wanted = new Set(accessibleProjectIds(user, projectIds));
  db.transaction(() => {
    for (const pid of visible) {
      if (wanted.has(pid)) ins.run(pid, accountId, Date.now());
      else del.run(accountId, pid);
    }
  })();
}
// The site can be public, so a user's password must not be guessable in a few tries.
const MIN_PASSWORD = 8;
const weakPassword = (password) => String(password).length < MIN_PASSWORD;

function projectIdsOf(db, accountId) {
  return db.prepare('SELECT project_id FROM project_members WHERE account_id = ?').all(accountId).map(r => r.project_id);
}

router.get('/me', (req, res) => {
  const db = getDB();
  const account = db.prepare('SELECT id, username, display_name, email, role, permissions FROM accounts WHERE id = ?').get(req.user.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  account.permissions = JSON.parse(account.permissions || '[]');
  res.json(account);
});

router.put('/me', (req, res) => {
  const { display_name, email, username } = req.body;
  const db = getDB();
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.user.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  if (username && username !== account.username) {
    const exists = db.prepare('SELECT id FROM accounts WHERE username = ? AND id != ?').get(username, req.user.id);
    if (exists) return res.status(400).json({ error: 'Username already taken' });
    db.prepare('UPDATE accounts SET username = ? WHERE id = ?').run(username, req.user.id);
  }

  if (display_name !== undefined) {
    db.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').run(display_name, req.user.id);
  }

  if (email !== undefined) {
    db.prepare('UPDATE accounts SET email = ? WHERE id = ?').run(email, req.user.id);
  }

  logAudit('profile_updated', 'account', req.user.id, req.user.username, { by: req.user.id });
  res.json({ ok: true });
});

router.get('/', requirePermission('accounts.view'), (req, res) => {
  const db = getDB();
  let accounts;
  if (req.user.role === 'admin') {
    accounts = db.prepare('SELECT id, username, display_name, role, parent_id, permissions, created_at FROM accounts WHERE id != ? ORDER BY created_at DESC').all(req.user.id);
  } else {
    accounts = db.prepare('SELECT id, username, display_name, role, parent_id, permissions, created_at FROM accounts WHERE id = ? OR parent_id = ? ORDER BY created_at DESC').all(req.user.id, req.user.id);
  }
  res.json(accounts.map(a => ({ ...a, permissions: JSON.parse(a.permissions || '[]'), projectIds: projectIdsOf(db, a.id) })));
});

router.post('/', requirePermission('accounts.manage'), (req, res) => {
  const { username, password, display_name, permissions, projectIds } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (weakPassword(password)) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });

  const db = getDB();
  const exists = db.prepare('SELECT id FROM accounts WHERE username = ?').get(username);
  if (exists) return res.status(400).json({ error: 'Username already taken' });

  const id = crypto.randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  const perms = JSON.stringify(grantable(req.user, permissions));

  db.prepare('INSERT INTO accounts (id, username, password_hash, display_name, role, parent_id, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, username, hash, display_name || username, 'user', req.user.id, perms, Date.now());

  setMemberships(db, id, projectIds, req.user);

  logAudit('account_created', 'account', id, username, { admin: req.user.id });
  res.json({ id, username, display_name: display_name || username, role: 'user', permissions: JSON.parse(perms), projectIds: projectIdsOf(db, id) });
});

router.put('/:id', requirePermission('accounts.manage'), (req, res) => {
  const { id } = req.params;
  const { display_name, permissions, password, projectIds } = req.body;
  const db = getDB();

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (!canManage(req.user, account)) return res.status(403).json({ error: 'Cannot edit this account' });
  if (password && weakPassword(password)) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });

  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hash, id);
  }

  if (display_name !== undefined) {
    db.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').run(display_name, id);
  }

  if (permissions !== undefined && account.id !== req.user.id) {
    db.prepare('UPDATE accounts SET permissions = ? WHERE id = ?').run(JSON.stringify(grantable(req.user, permissions)), id);
  }

  if (projectIds !== undefined && account.role !== 'admin') {
    setMemberships(db, id, projectIds, req.user);
  }

  logAudit('account_updated', 'account', id, account.username, { by: req.user.id });
  res.json({ ok: true });
});

router.delete('/:id', requirePermission('accounts.manage'), (req, res) => {
  const { id } = req.params;
  const db = getDB();

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.role === 'admin') return res.status(403).json({ error: 'Cannot delete admin accounts' });
  if (account.id === req.user.id) return res.status(403).json({ error: 'Cannot delete yourself' });
  if (!canManage(req.user, account)) return res.status(403).json({ error: 'Cannot delete this account' });

  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  db.prepare('DELETE FROM api_tokens WHERE account_id = ?').run(id);
  logAudit('account_deleted', 'account', id, account.username, { by: req.user.id });
  res.json({ ok: true });
});

router.post('/:id/change-password', (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  if (weakPassword(password)) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });

  const db = getDB();
  const target = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Account not found' });
  if (req.user.id !== id && !canManage(req.user, target)) {
    return res.status(403).json({ error: 'Permission denied' });
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hash, id);
  res.json({ ok: true });
});

export default router;
