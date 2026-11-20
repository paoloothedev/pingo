import { Router } from 'express';
import { requirePermission } from './auth.js';
import { getDB } from '../db.js';

const router = Router();

function genId() {
  return 'tpl_' + Math.random().toString(36).slice(2, 10);
}

// List all templates
router.get('/', (req, res) => {
  const db = getDB();
  const templates = db.prepare('SELECT * FROM message_templates WHERE project_id = ? ORDER BY created_at DESC').all(req.project.id);
  res.json(templates);
});

// Create template
router.post('/', requirePermission('templates.edit'), (req, res) => {
  const db = getDB();
  const { name, content } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });
  const id = genId();
  db.prepare('INSERT INTO message_templates (id, name, content, created_at, project_id) VALUES (?, ?, ?, ?, ?)').run(id, name.trim(), content.trim(), Date.now(), req.project.id);
  const tpl = db.prepare('SELECT * FROM message_templates WHERE id = ?').get(id);
  res.status(201).json(tpl);
});

// Update template
router.put('/:id', requirePermission('templates.edit'), (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM message_templates WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name, content } = req.body;
  db.prepare('UPDATE message_templates SET name=?, content=? WHERE id=?').run(
    name ?? existing.name,
    content ?? existing.content,
    req.params.id
  );
  const tpl = db.prepare('SELECT * FROM message_templates WHERE id = ?').get(req.params.id);
  res.json(tpl);
});

// Delete template
router.delete('/:id', requirePermission('templates.edit'), (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM message_templates WHERE id = ? AND project_id = ?').run(req.params.id, req.project.id);
  res.json({ ok: true });
});

export default router;
