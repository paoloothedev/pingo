import { Router } from 'express';
import { requirePermission } from './auth.js';
import { getDB } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const rows = db.prepare('SELECT key, value FROM settings WHERE project_id = ?').all(req.project.id);
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

router.put('/', requirePermission('settings.edit'), (req, res) => {
  const db = getDB();
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'Key is required' });
  db.prepare('INSERT OR REPLACE INTO settings (project_id, key, value) VALUES (?, ?, ?)').run(req.project.id, key, String(value));
  res.json({ ok: true });
});

export default router;
