import { Router } from 'express';
import { requirePermission } from './auth.js';
import { getDB, logAudit } from '../db.js';
import { createPipeline, newId } from '../lib/pipelines.js';

const router = Router();
const KINDS = ['open', 'won', 'lost'];

function stageFields(body, { create = false } = {}) {
  const sets = {};
  if (body.name !== undefined || create) {
    const name = String(body.name ?? '').trim().slice(0, 100);
    if (!name) return { error: 'Stage name required' };
    sets.name = name;
  }
  if (body.color !== undefined) sets.color = String(body.color).slice(0, 20);
  if (body.probability !== undefined) {
    const p = Number(body.probability);
    if (!Number.isFinite(p) || p < 0 || p > 100) return { error: 'Probability must be 0–100' };
    sets.probability = Math.round(p);
  }
  if (body.rot_days !== undefined) {
    if (body.rot_days === null || body.rot_days === '') sets.rot_days = null;
    else {
      const d = parseInt(body.rot_days);
      if (!(d > 0)) return { error: 'rot_days must be a positive number' };
      sets.rot_days = d;
    }
  }
  if (body.kind !== undefined) {
    if (!KINDS.includes(body.kind)) return { error: 'kind must be open, won or lost' };
    sets.kind = body.kind;
  }
  return { sets };
}

function getPipeline(db, pid, id) {
  return db.prepare('SELECT * FROM pipelines WHERE id = ? AND project_id = ?').get(id, pid);
}
function getStage(db, pid, id) {
  return db.prepare('SELECT * FROM pipeline_stages WHERE id = ? AND project_id = ?').get(id, pid);
}

function listPipelines(db, pid) {
  const pipelines = db.prepare('SELECT * FROM pipelines WHERE project_id = ? ORDER BY sort_order, created_at').all(pid);
  const stages = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM deals d WHERE d.stage_id = s.id) AS deal_count,
      (SELECT COALESCE(SUM(d.value), 0) FROM deals d WHERE d.stage_id = s.id) AS deal_value
    FROM pipeline_stages s WHERE s.project_id = ? ORDER BY s.sort_order
  `).all(pid);
  return pipelines.map(p => ({ ...p, stages: stages.filter(s => s.pipeline_id === p.id) }));
}

// Pipelines (with stages) are reference data: any member can read them.
router.get('/', (req, res) => {
  res.json(listPipelines(getDB(), req.project.id));
});

router.post('/', requirePermission('settings.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  let stages;
  if (Array.isArray(req.body.stages) && req.body.stages.length) {
    stages = [];
    for (const s of req.body.stages) {
      const f = stageFields({ kind: 'open', probability: 0, ...s }, { create: true });
      if (f.error) return res.status(400).json({ error: f.error });
      stages.push([f.sets.name, f.sets.color || '#64748b', f.sets.probability, f.sets.kind]);
    }
  }
  const { pipelineId } = db.transaction(() => createPipeline(db, pid, name, stages))();
  logAudit('create', 'pipeline', pipelineId, name, {}, pid);
  res.status(201).json(listPipelines(db, pid).find(p => p.id === pipelineId));
});

router.put('/:id', requirePermission('settings.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const p = getPipeline(db, pid, req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const name = String(req.body.name ?? p.name).trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  db.prepare('UPDATE pipelines SET name = ? WHERE id = ?').run(name, p.id);
  res.json(listPipelines(db, pid).find(x => x.id === p.id));
});

router.delete('/:id', requirePermission('settings.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const p = getPipeline(db, pid, req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (db.prepare('SELECT COUNT(*) c FROM pipelines WHERE project_id = ?').get(pid).c <= 1) {
    return res.status(400).json({ error: 'Cannot delete the last pipeline' });
  }
  if (db.prepare('SELECT 1 FROM deals WHERE pipeline_id = ?').get(p.id)) {
    return res.status(400).json({ error: 'Move or delete this pipeline\'s deals first' });
  }
  db.transaction(() => {
    db.prepare('DELETE FROM pipeline_stages WHERE pipeline_id = ?').run(p.id);
    db.prepare('DELETE FROM pipelines WHERE id = ?').run(p.id);
  })();
  logAudit('delete', 'pipeline', p.id, p.name, {}, pid);
  res.json({ ok: true });
});

router.post('/:id/stages', requirePermission('settings.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const p = getPipeline(db, pid, req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const f = stageFields({ kind: 'open', probability: 0, ...req.body }, { create: true });
  if (f.error) return res.status(400).json({ error: f.error });
  const order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM pipeline_stages WHERE pipeline_id = ?').get(p.id).n;
  const id = newId('pst');
  db.prepare(`INSERT INTO pipeline_stages (id, pipeline_id, project_id, name, color, sort_order, probability, rot_days, kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, p.id, pid, f.sets.name, f.sets.color || '#64748b', order,
    f.sets.probability, f.sets.rot_days ?? null, f.sets.kind, Date.now());
  res.status(201).json(getStage(db, pid, id));
});

router.put('/stages/:stageId', requirePermission('settings.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const s = getStage(db, pid, req.params.stageId);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const f = stageFields(req.body);
  if (f.error) return res.status(400).json({ error: f.error });
  const cols = Object.keys(f.sets);
  if (cols.length) db.prepare(`UPDATE pipeline_stages SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(f.sets), s.id);
  res.json(getStage(db, pid, s.id));
});

// Delete a stage; its deals move to ?moveTo=<stageId> (same pipeline) or the first other stage.
router.delete('/stages/:stageId', requirePermission('settings.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const s = getStage(db, pid, req.params.stageId);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const others = db.prepare('SELECT * FROM pipeline_stages WHERE pipeline_id = ? AND id != ? ORDER BY sort_order').all(s.pipeline_id, s.id);
  if (!others.length) return res.status(400).json({ error: 'Cannot delete the last stage of a pipeline' });
  const target = req.query.moveTo ? others.find(o => o.id === req.query.moveTo) : others[0];
  if (!target) return res.status(400).json({ error: 'moveTo must be another stage of the same pipeline' });
  db.transaction(() => {
    db.prepare('UPDATE deals SET stage_id = ?, updated_at = ? WHERE stage_id = ?').run(target.id, Date.now(), s.id);
    db.prepare('DELETE FROM pipeline_stages WHERE id = ?').run(s.id);
  })();
  logAudit('delete', 'pipeline_stage', s.id, s.name, { movedTo: target.id }, pid);
  res.json({ ok: true, movedTo: target.id });
});

router.post('/:id/stages/reorder', requirePermission('settings.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const p = getPipeline(db, pid, req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds required' });
  const upd = db.prepare('UPDATE pipeline_stages SET sort_order = ? WHERE id = ? AND pipeline_id = ?');
  db.transaction(() => orderedIds.forEach((id, i) => upd.run(i, id, p.id)))();
  res.json(listPipelines(db, pid).find(x => x.id === p.id));
});

export default router;
