import { Router } from 'express';
import crypto from 'crypto';
import { requirePermission } from './auth.js';
import { getDB, logAudit } from '../db.js';
import { ownedIds, isProjectMember } from '../lib/scope.js';
import { pageParams, runPaged, groupBy, sendList } from '../lib/paginate.js';
import { validateCustom, customFilterSql } from '../lib/customFields.js';

const router = Router();

const TEXT_FIELDS = ['name', 'domain', 'industry', 'size', 'phone', 'email', 'website', 'address', 'city', 'country', 'notes', 'source'];

function normalizeDomain(v) {
  return String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

// Validates a create/update body. Returns { error } or { sets } (column → value).
function companyFields(body, projectId, { create = false, existing = {} } = {}) {
  const sets = {};
  for (const f of TEXT_FIELDS) {
    if (body[f] !== undefined) sets[f] = String(body[f] ?? '').trim().slice(0, f === 'notes' ? 20000 : 500);
  }
  if (sets.domain !== undefined) sets.domain = normalizeDomain(sets.domain);
  if (create && !sets.domain && sets.website) sets.domain = normalizeDomain(sets.website);
  if ((create || sets.name !== undefined) && !sets.name) return { error: 'Name required' };
  if (body.owner_id !== undefined) {
    if (body.owner_id !== null && !isProjectMember(projectId, body.owner_id)) return { error: 'Owner must be a member of this workspace' };
    sets.owner_id = body.owner_id;
  }
  if (body.custom !== undefined || create) {
    const v = validateCustom(projectId, 'company', body.custom, existing, { create });
    if (v.error) return { error: v.error };
    sets.custom = JSON.stringify(v.value);
  }
  return { sets };
}

function serialize(c) {
  let custom = {};
  try { custom = JSON.parse(c.custom || '{}'); } catch {}
  return { ...c, custom };
}

function getCompany(db, projectId, id) {
  return db.prepare('SELECT * FROM companies WHERE id = ? AND project_id = ?').get(id, projectId);
}

router.get('/', requirePermission('leads.view'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const { search, owner, industry, sortBy, sortOrder } = req.query;
  let sql = 'SELECT * FROM companies WHERE project_id = ?';
  const params = [pid];
  if (search) {
    sql += ' AND (name LIKE ? OR domain LIKE ? OR phone LIKE ? OR email LIKE ? OR city LIKE ?)';
    const p = `%${search}%`;
    params.push(p, p, p, p, p);
  }
  if (owner === 'me') { sql += ' AND owner_id = ?'; params.push(req.user.id); }
  else if (owner === 'none') sql += ' AND owner_id IS NULL';
  else if (owner) { sql += ' AND owner_id = ?'; params.push(owner); }
  if (industry) { sql += ' AND industry = ?'; params.push(industry); }
  const cfFilter = customFilterSql(pid, 'company', req.query);
  sql += cfFilter.sql; params.push(...cfFilter.params);
  const sortCols = ['name', 'created_at', 'updated_at', 'industry', 'city'];
  sql += ` ORDER BY ${sortCols.includes(sortBy) ? sortBy : 'name'} ${sortOrder === 'desc' ? 'DESC' : 'ASC'}`;

  const paging = pageParams(req.query);
  const { rows, total } = runPaged(db, sql, params, paging);
  const counts = groupBy(db, rows.map(r => r.id), ph =>
    `SELECT company_id AS k, COUNT(*) AS n FROM leads WHERE status = 'active' AND company_id IN (${ph}) GROUP BY company_id`);
  sendList(res, rows.map(r => ({ ...serialize(r), contact_count: counts.get(r.id)?.[0]?.n || 0 })), total, paging);
});

router.get('/:id', requirePermission('leads.view'), (req, res) => {
  const db = getDB();
  const company = getCompany(db, req.project.id, req.params.id);
  if (!company) return res.status(404).json({ error: 'Not found' });
  const contacts = db.prepare(`
    SELECT id, name, phone, email, lifecycle, owner_id, status FROM leads
    WHERE company_id = ? AND project_id = ? ORDER BY name
  `).all(company.id, req.project.id);
  const deals = db.prepare('SELECT id, title, value, currency, status, stage_id, contact_id FROM deals WHERE company_id = ? AND project_id = ? ORDER BY created_at DESC').all(company.id, req.project.id);
  res.json({ ...serialize(company), contacts, deals });
});

router.post('/', requirePermission('leads.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const cf = companyFields({ owner_id: req.user.id, source: 'manual', ...req.body }, pid, { create: true });
  if (cf.error) return res.status(400).json({ error: cf.error });
  const id = 'comp_' + crypto.randomBytes(6).toString('hex');
  const now = Date.now();
  const cols = ['id', 'project_id', 'created_at', 'updated_at', ...Object.keys(cf.sets)];
  const vals = [id, pid, now, now, ...Object.values(cf.sets)];
  db.prepare(`INSERT INTO companies (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
  logAudit('create', 'company', id, cf.sets.name, {}, pid);
  res.status(201).json(serialize(getCompany(db, pid, id)));
});

router.put('/:id', requirePermission('leads.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const existing = getCompany(db, pid, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const cf = companyFields(req.body, pid, { existing: serialize(existing).custom });
  if (cf.error) return res.status(400).json({ error: cf.error });
  const sets = { ...cf.sets, updated_at: Date.now() };
  const cols = Object.keys(sets);
  db.prepare(`UPDATE companies SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(sets), existing.id);
  logAudit('edit', 'company', existing.id, existing.name, { changes: Object.keys(cf.sets) }, pid);
  res.json(serialize(getCompany(db, pid, existing.id)));
});

router.delete('/:id', requirePermission('leads.delete'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const existing = getCompany(db, pid, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.transaction(() => {
    db.prepare('UPDATE leads SET company_id = NULL WHERE company_id = ? AND project_id = ?').run(existing.id, pid);
    db.prepare('UPDATE deals SET company_id = NULL WHERE company_id = ? AND project_id = ?').run(existing.id, pid);
    db.prepare('DELETE FROM companies WHERE id = ?').run(existing.id);
  })();
  logAudit('delete', 'company', existing.id, existing.name, {}, pid);
  res.json({ ok: true });
});

// Link contacts to this company (moves them from any previous company)
router.post('/:id/contacts', requirePermission('leads.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const company = getCompany(db, pid, req.params.id);
  if (!company) return res.status(404).json({ error: 'Not found' });
  const ids = ownedIds('leads', pid, req.body.contactIds);
  if (!ids.length) return res.status(400).json({ error: 'No valid contacts' });
  const upd = db.prepare('UPDATE leads SET company_id = ?, updated_at = ? WHERE id = ?');
  db.transaction(() => { for (const id of ids) upd.run(company.id, Date.now(), id); })();
  logAudit('link_contacts', 'company', company.id, company.name, { contactIds: ids }, pid);
  res.json({ ok: true, linked: ids.length });
});

router.delete('/:id/contacts/:contactId', requirePermission('leads.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const company = getCompany(db, pid, req.params.id);
  if (!company) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE leads SET company_id = NULL, updated_at = ? WHERE id = ? AND company_id = ? AND project_id = ?')
    .run(Date.now(), req.params.contactId, company.id, pid);
  res.json({ ok: true });
});

export default router;
