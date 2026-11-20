import { Router } from 'express';
import { requirePermission } from './auth.js';
import { getDB, logAudit } from '../db.js';
import { isOwned, isProjectMember } from '../lib/scope.js';
import { pageParams, runPaged, groupBy, sendList } from '../lib/paginate.js';
import { newId } from '../lib/pipelines.js';
import { validateCustom, customFilterSql } from '../lib/customFields.js';

const router = Router();
const STATUSES = ['open', 'won', 'lost'];

function getDeal(db, pid, id) {
  return db.prepare('SELECT * FROM deals WHERE id = ? AND project_id = ?').get(id, pid);
}
function getStage(db, pid, id) {
  return db.prepare('SELECT * FROM pipeline_stages WHERE id = ? AND project_id = ?').get(id, pid);
}

// Validates editable fields. Returns { error } or { sets }. Stage/pipeline are handled separately (moveDeal).
function dealFields(body, pid, { create = false, existing = {} } = {}) {
  const sets = {};
  if (body.title !== undefined || create) {
    const t = String(body.title ?? '').trim().slice(0, 300);
    if (!t) return { error: 'Title required' };
    sets.title = t;
  }
  if (body.value !== undefined) {
    const v = Number(body.value);
    if (!Number.isFinite(v) || v < 0) return { error: 'Value must be a positive number' };
    sets.value = v;
  }
  if (body.currency !== undefined) {
    const c = String(body.currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) return { error: 'Currency must be a 3-letter code' };
    sets.currency = c;
  }
  if (body.contact_id !== undefined) {
    if (body.contact_id !== null && !isOwned('leads', pid, body.contact_id)) return { error: 'Invalid contact' };
    sets.contact_id = body.contact_id;
  }
  if (body.company_id !== undefined) {
    if (body.company_id !== null && !isOwned('companies', pid, body.company_id)) return { error: 'Invalid company' };
    sets.company_id = body.company_id;
  }
  if (body.owner_id !== undefined) {
    if (body.owner_id !== null && !isProjectMember(pid, body.owner_id)) return { error: 'Owner must be a member of this workspace' };
    sets.owner_id = body.owner_id;
  }
  if (body.expected_close !== undefined) {
    if (body.expected_close === null || body.expected_close === '') sets.expected_close = null;
    else {
      const t = typeof body.expected_close === 'number' ? body.expected_close : Date.parse(body.expected_close);
      if (!Number.isFinite(t)) return { error: 'Invalid expected_close' };
      sets.expected_close = t;
    }
  }
  if (body.notes !== undefined) sets.notes = String(body.notes || '').slice(0, 20000);
  if (body.source !== undefined) sets.source = String(body.source || '').slice(0, 50);
  if (body.custom !== undefined || create) {
    const v = validateCustom(pid, 'deal', body.custom, existing, { create });
    if (v.error) return { error: v.error };
    sets.custom = JSON.stringify(v.value);
  }
  return { sets };
}

// Moves a deal to `stage` (already validated to belong to the project). Stage kind drives status:
// won → status won + won_at, and the contact becomes a customer; lost → status lost + lost_reason.
export function moveDeal(db, deal, stage, accountId, lostReason = '') {
  const now = Date.now();
  const status = stage.kind;
  db.prepare(`UPDATE deals SET pipeline_id = ?, stage_id = ?, status = ?, won_at = ?, lost_at = ?, lost_reason = ?,
      stage_changed_at = ?, updated_at = ? WHERE id = ?`).run(
    stage.pipeline_id, stage.id, status,
    status === 'won' ? (deal.status === 'won' ? deal.won_at : now) : null,
    status === 'lost' ? (deal.status === 'lost' ? deal.lost_at : now) : null,
    status === 'lost' ? String(lostReason || deal.lost_reason || '').slice(0, 500) : '',
    now, now, deal.id,
  );
  db.prepare('INSERT INTO deal_stage_history (deal_id, stage_id, account_id, at) VALUES (?, ?, ?, ?)').run(deal.id, stage.id, accountId, now);
  if (status === 'won' && deal.contact_id) {
    db.prepare("UPDATE leads SET lifecycle = 'customer', updated_at = ? WHERE id = ? AND lifecycle != 'customer'").run(now, deal.contact_id);
  }
}

function enrich(db, deals) {
  const contactIds = [...new Set(deals.map(d => d.contact_id).filter(Boolean))];
  const companyIds = [...new Set(deals.map(d => d.company_id).filter(Boolean))];
  const stageIds = [...new Set(deals.map(d => d.stage_id))];
  const contacts = groupBy(db, contactIds, ph => `SELECT id AS k, id, name, phone FROM leads WHERE id IN (${ph})`);
  const companies = groupBy(db, companyIds, ph => `SELECT id AS k, id, name FROM companies WHERE id IN (${ph})`);
  const stages = groupBy(db, stageIds, ph => `SELECT id AS k, id, name, color, probability, kind, rot_days FROM pipeline_stages WHERE id IN (${ph})`);
  const now = Date.now();
  return deals.map(d => {
    let custom = {};
    try { custom = JSON.parse(d.custom || '{}'); } catch {}
    const stage = stages.get(d.stage_id)?.[0] || null;
    const idleDays = Math.floor((now - (d.stage_changed_at || d.created_at)) / 86400000);
    return {
      ...d,
      custom,
      contact: d.contact_id ? contacts.get(d.contact_id)?.[0] || null : null,
      company: d.company_id ? companies.get(d.company_id)?.[0] || null : null,
      stage,
      rotting: !!(d.status === 'open' && stage?.rot_days && idleDays >= stage.rot_days),
    };
  });
}

function buildFilter(req) {
  const { pipeline, stage, status, owner, contact, company, search } = req.query;
  let where = 'project_id = ?';
  const params = [req.project.id];
  if (pipeline) { where += ' AND pipeline_id = ?'; params.push(pipeline); }
  if (stage) { where += ' AND stage_id = ?'; params.push(stage); }
  if (status && STATUSES.includes(status)) { where += ' AND status = ?'; params.push(status); }
  if (owner === 'me') { where += ' AND owner_id = ?'; params.push(req.user.id); }
  else if (owner === 'none') where += ' AND owner_id IS NULL';
  else if (owner) { where += ' AND owner_id = ?'; params.push(owner); }
  if (contact) { where += ' AND contact_id = ?'; params.push(contact); }
  if (company) { where += ' AND company_id = ?'; params.push(company); }
  if (search) { where += ' AND title LIKE ?'; params.push(`%${search}%`); }
  const cf = customFilterSql(req.project.id, 'deal', req.query);
  where += cf.sql; params.push(...cf.params);
  return { where, params };
}

router.get('/', requirePermission('deals.view'), (req, res) => {
  const db = getDB();
  const { where, params } = buildFilter(req);
  const sortCols = ['title', 'value', 'created_at', 'updated_at', 'expected_close', 'stage_changed_at'];
  const col = sortCols.includes(req.query.sortBy) ? req.query.sortBy : 'created_at';
  const sql = `SELECT * FROM deals WHERE ${where} ORDER BY ${col} ${req.query.sortOrder === 'asc' ? 'ASC' : 'DESC'}`;
  const paging = pageParams(req.query);
  const { rows, total } = runPaged(db, sql, params, paging);
  sendList(res, enrich(db, rows), total, paging);
});

// Kanban data for one pipeline: every stage with its deals (newest first, capped) and totals.
router.get('/board', requirePermission('deals.view'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const pipeline = req.query.pipeline
    ? db.prepare('SELECT * FROM pipelines WHERE id = ? AND project_id = ?').get(req.query.pipeline, pid)
    : db.prepare('SELECT * FROM pipelines WHERE project_id = ? ORDER BY sort_order, created_at LIMIT 1').get(pid);
  if (!pipeline) return res.status(404).json({ error: 'Pipeline not found' });
  const perColumn = Math.min(500, parseInt(req.query.limit) || 100);
  const { where, params } = buildFilter({ ...req, query: { ...req.query, pipeline: pipeline.id, stage: undefined, status: undefined } });
  const stages = db.prepare('SELECT * FROM pipeline_stages WHERE pipeline_id = ? ORDER BY sort_order').all(pipeline.id);
  const columns = stages.map(s => {
    const totals = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(value), 0) AS value FROM deals WHERE ${where} AND stage_id = ?`).get(...params, s.id);
    const deals = db.prepare(`SELECT * FROM deals WHERE ${where} AND stage_id = ? ORDER BY stage_changed_at DESC, created_at DESC LIMIT ?`).all(...params, s.id, perColumn);
    return { ...s, count: totals.count, total_value: totals.value, weighted_value: totals.value * s.probability / 100, deals: enrich(db, deals) };
  });
  res.json({ pipeline, stages: columns });
});

router.get('/:id', requirePermission('deals.view'), (req, res) => {
  const db = getDB();
  const deal = getDeal(db, req.project.id, req.params.id);
  if (!deal) return res.status(404).json({ error: 'Not found' });
  const [d] = enrich(db, [deal]);
  d.history = db.prepare(`
    SELECT h.stage_id, h.account_id, h.at, s.name AS stage_name, s.color FROM deal_stage_history h
    LEFT JOIN pipeline_stages s ON s.id = h.stage_id WHERE h.deal_id = ? ORDER BY h.at DESC, h.id DESC
  `).all(deal.id);
  res.json(d);
});

router.post('/', requirePermission('deals.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const defaultCurrency = db.prepare("SELECT value FROM settings WHERE project_id = ? AND key = 'currency'").get(pid)?.value || 'USD';
  const f = dealFields({ owner_id: req.user.id, currency: defaultCurrency, source: 'manual', ...req.body }, pid, { create: true });
  if (f.error) return res.status(400).json({ error: f.error });

  let stage;
  if (req.body.stage_id) {
    stage = getStage(db, pid, req.body.stage_id);
    if (!stage) return res.status(400).json({ error: 'Invalid stage' });
  } else {
    const pipeline = req.body.pipeline_id
      ? db.prepare('SELECT id FROM pipelines WHERE id = ? AND project_id = ?').get(req.body.pipeline_id, pid)
      : db.prepare('SELECT id FROM pipelines WHERE project_id = ? ORDER BY sort_order, created_at LIMIT 1').get(pid);
    if (!pipeline) return res.status(400).json({ error: 'Invalid pipeline' });
    stage = db.prepare("SELECT * FROM pipeline_stages WHERE pipeline_id = ? AND kind = 'open' ORDER BY sort_order LIMIT 1").get(pipeline.id)
      || db.prepare('SELECT * FROM pipeline_stages WHERE pipeline_id = ? ORDER BY sort_order LIMIT 1').get(pipeline.id);
    if (!stage) return res.status(400).json({ error: 'Pipeline has no stages' });
  }
  // A deal on a contact inherits the contact's company unless one was given
  if (f.sets.contact_id && f.sets.company_id === undefined) {
    const cid = db.prepare('SELECT company_id FROM leads WHERE id = ?').get(f.sets.contact_id)?.company_id;
    if (cid) f.sets.company_id = cid;
  }

  const id = newId('deal');
  const now = Date.now();
  db.transaction(() => {
    const cols = ['id', 'project_id', 'pipeline_id', 'stage_id', 'status', 'created_at', 'updated_at', 'stage_changed_at', ...Object.keys(f.sets)];
    db.prepare(`INSERT INTO deals (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(id, pid, stage.pipeline_id, stage.id, 'open', now, now, now, ...Object.values(f.sets));
    moveDeal(db, getDeal(db, pid, id), stage, req.user.id, req.body.lost_reason);
  })();
  logAudit('create', 'deal', id, f.sets.title, { value: f.sets.value }, pid);
  res.status(201).json(enrich(db, [getDeal(db, pid, id)])[0]);
});

router.put('/:id', requirePermission('deals.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const deal = getDeal(db, pid, req.params.id);
  if (!deal) return res.status(404).json({ error: 'Not found' });
  let existingCustom = {};
  try { existingCustom = JSON.parse(deal.custom || '{}'); } catch {}
  const f = dealFields(req.body, pid, { existing: existingCustom });
  if (f.error) return res.status(400).json({ error: f.error });
  let stage = null;
  if (req.body.stage_id && req.body.stage_id !== deal.stage_id) {
    stage = getStage(db, pid, req.body.stage_id);
    if (!stage) return res.status(400).json({ error: 'Invalid stage' });
  }
  db.transaction(() => {
    const sets = { ...f.sets, updated_at: Date.now() };
    db.prepare(`UPDATE deals SET ${Object.keys(sets).map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(sets), deal.id);
    if (stage) moveDeal(db, getDeal(db, pid, deal.id), stage, req.user.id, req.body.lost_reason);
  })();
  logAudit('edit', 'deal', deal.id, deal.title, { changes: Object.keys(req.body) }, pid);
  res.json(enrich(db, [getDeal(db, pid, deal.id)])[0]);
});

// Kanban drag & drop
router.post('/:id/move', requirePermission('deals.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const deal = getDeal(db, pid, req.params.id);
  if (!deal) return res.status(404).json({ error: 'Not found' });
  const stage = getStage(db, pid, req.body.stage_id);
  if (!stage) return res.status(400).json({ error: 'Invalid stage' });
  if (stage.id !== deal.stage_id) {
    db.transaction(() => moveDeal(db, deal, stage, req.user.id, req.body.lost_reason))();
    logAudit('move', 'deal', deal.id, deal.title, { from: deal.stage_id, to: stage.id }, pid);
  }
  res.json(enrich(db, [getDeal(db, pid, deal.id)])[0]);
});

router.delete('/:id', requirePermission('deals.delete'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const deal = getDeal(db, pid, req.params.id);
  if (!deal) return res.status(404).json({ error: 'Not found' });
  db.transaction(() => {
    db.prepare('DELETE FROM deal_stage_history WHERE deal_id = ?').run(deal.id);
    db.prepare('DELETE FROM deals WHERE id = ?').run(deal.id);
  })();
  logAudit('delete', 'deal', deal.id, deal.title, {}, pid);
  res.json({ ok: true });
});

export default router;
