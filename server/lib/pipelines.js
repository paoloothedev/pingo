import crypto from 'crypto';

export const DEFAULT_PIPELINE_STAGES = [
  // name, color, probability, kind
  ['Qualified', '#64748b', 10, 'open'],
  ['Contact made', '#3b82f6', 20, 'open'],
  ['Proposal', '#8b5cf6', 50, 'open'],
  ['Negotiation', '#f59e0b', 75, 'open'],
  ['Won', '#10b981', 100, 'won'],
  ['Lost', '#ef4444', 0, 'lost'],
];

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

// Creates a pipeline with the given stages; returns { pipelineId, stageIds: [...] } in stage order.
export function createPipeline(db, projectId, name = 'Sales', stages = DEFAULT_PIPELINE_STAGES) {
  const now = Date.now();
  const pipelineId = newId('pipe');
  const order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM pipelines WHERE project_id = ?').get(projectId).n;
  db.prepare('INSERT INTO pipelines (id, project_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)').run(pipelineId, projectId, name, order, now);
  const ins = db.prepare(`INSERT INTO pipeline_stages (id, pipeline_id, project_id, name, color, sort_order, probability, kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const stageIds = stages.map(([sname, color, probability, kind], i) => {
    const id = newId('pst');
    ins.run(id, pipelineId, projectId, sname, color, i, probability, kind, now);
    return id;
  });
  return { pipelineId, stageIds };
}

export function ensureDefaultPipeline(db, projectId) {
  const has = db.prepare('SELECT 1 FROM pipelines WHERE project_id = ?').get(projectId);
  if (!has) createPipeline(db, projectId);
}
