import { Router } from 'express';
import { requirePermission } from './auth.js';
import { getDB } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const stages = db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM leads l WHERE l.stage_id = s.id AND l.project_id = s.project_id AND l.status = 'active') AS lead_count
    FROM stages s WHERE s.project_id = ? ORDER BY s.sort_order
  `).all(req.project.id);
  res.json(stages);
});

router.post('/', requirePermission('stages.edit'), (req, res) => {
  const db = getDB();
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = 'stage_' + Math.random().toString(36).slice(2, 10);
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM stages WHERE project_id = ?').get(req.project.id).m || 0;
  db.prepare('INSERT INTO stages (id, name, color, sort_order, project_id) VALUES (?, ?, ?, ?, ?)').run(id, name, color || '#3d5a45', maxOrder + 1, req.project.id);
  const stage = db.prepare('SELECT * FROM stages WHERE id = ?').get(id);
  res.status(201).json(stage);
});

router.put('/:id', requirePermission('stages.edit'), (req, res) => {
  const db = getDB();
  const { name, color } = req.body;
  const existing = db.prepare('SELECT * FROM stages WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE stages SET name = ?, color = ? WHERE id = ?').run(name || existing.name, color || existing.color, req.params.id);
  const stage = db.prepare('SELECT * FROM stages WHERE id = ?').get(req.params.id);
  res.json(stage);
});

router.delete('/:id', requirePermission('stages.edit'), (req, res) => {
  const db = getDB();
  const projectId = req.project.id;
  const count = db.prepare('SELECT COUNT(*) as c FROM stages WHERE project_id = ?').get(projectId).c;
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete last stage' });
  const fallback = db.prepare('SELECT id FROM stages WHERE id != ? AND project_id = ? ORDER BY sort_order LIMIT 1').get(req.params.id, projectId);
  if (fallback) {
    db.prepare('UPDATE leads SET stage_id = ? WHERE stage_id = ? AND project_id = ?').run(fallback.id, req.params.id, projectId);
  }
  db.prepare('DELETE FROM stages WHERE id = ? AND project_id = ?').run(req.params.id, projectId);
  res.json({ ok: true });
});

router.post('/reorder', requirePermission('stages.edit'), (req, res) => {
  const db = getDB();
  const { orderedIds } = req.body;
  if (!orderedIds || !orderedIds.length) return res.status(400).json({ error: 'orderedIds required' });
  const update = db.prepare('UPDATE stages SET sort_order = ? WHERE id = ? AND project_id = ?');
  const txn = db.transaction(() => {
    orderedIds.forEach((id, idx) => update.run(idx, id, req.project.id));
  });
  txn();
  const stages = db.prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY sort_order').all(req.project.id);
  res.json(stages);
});

export default router;
