import { Router } from 'express';
import crypto from 'crypto';
import { getDB, logAudit } from '../db.js';
import { hashToken } from './auth.js';

// Personal access tokens (used by the MCP endpoint). Each user manages only their own; a token acts as
// that user, with the same workspaces and permissions. The plain token is shown once, at creation.
const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  res.json(db.prepare('SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE account_id = ? ORDER BY created_at DESC').all(req.user.id));
});

router.post('/', (req, res) => {
  const db = getDB();
  const name = String(req.body?.name || '').trim().slice(0, 100) || 'Claude';
  const token = 'ldk_' + crypto.randomBytes(32).toString('hex');
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare('INSERT INTO api_tokens (id, account_id, name, token_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.user.id, name, hashToken(token), token.slice(0, 10), now);
  logAudit('create', 'api_token', id, name, { account: req.user.id });
  res.status(201).json({ id, name, prefix: token.slice(0, 10), created_at: now, last_used_at: null, token });
});

router.delete('/:id', (req, res) => {
  const db = getDB();
  const row = db.prepare('SELECT id, name FROM api_tokens WHERE id = ? AND account_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM api_tokens WHERE id = ?').run(row.id);
  logAudit('delete', 'api_token', row.id, row.name, { account: req.user.id });
  res.json({ ok: true });
});

export default router;
