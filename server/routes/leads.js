import { Router } from 'express';
import { wrap } from '../lib/async.js';
import { requirePermission, hasPermission } from './auth.js';
import { getDB, logAudit, DB_PATH } from '../db.js';
import { ownedIds, isOwned, isProjectMember } from '../lib/scope.js';
import { pageParams, runPaged, groupBy, sendList } from '../lib/paginate.js';
import { validateCustom, customFilterSql } from '../lib/customFields.js';
import { findDuplicates, mergeContacts } from '../lib/merge.js';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Lazily loaded WhatsApp functions (may not be available)
let waCheckPhones = null, waGetStatus = null;
try {
  const wa = await import('../whatsapp.js');
  waCheckPhones = wa.checkPhones;
  waGetStatus = wa.getStatus;
} catch {}

export const LIFECYCLES = ['lead', 'qualified', 'customer', 'churned'];
export const MESSAGE_MAX = 10000;

// Validates the contact-level fields (lifecycle, owner, source, custom) present in `body`.
// Returns { error } or { sets } where sets is a column → value map ready for an UPDATE.
function contactFields(body, projectId, { existing = {}, create = false } = {}) {
  const sets = {};
  if (body.lifecycle !== undefined) {
    if (!LIFECYCLES.includes(body.lifecycle)) return { error: 'Invalid lifecycle' };
    sets.lifecycle = body.lifecycle;
  }
  if (body.owner_id !== undefined) {
    if (body.owner_id !== null && !isProjectMember(projectId, body.owner_id)) return { error: 'Owner must be a member of this workspace' };
    sets.owner_id = body.owner_id;
  }
  if (body.company_id !== undefined) {
    if (body.company_id !== null && !isOwned('companies', projectId, body.company_id)) return { error: 'Invalid company' };
    sets.company_id = body.company_id;
  }
  if (body.source !== undefined) sets.source = String(body.source || '').slice(0, 50);
  if (body.do_not_contact !== undefined) sets.do_not_contact = body.do_not_contact ? 1 : 0;
  if (body.category !== undefined) sets.category = String(body.category ?? '').trim().slice(0, 120) || null;
  if (body.message !== undefined) sets.message = String(body.message ?? '').slice(0, MESSAGE_MAX);
  if (body.custom !== undefined || create) {
    const v = validateCustom(projectId, 'contact', body.custom, existing, { create });
    if (v.error) return { error: v.error };
    sets.custom = JSON.stringify(v.value);
  }
  return { sets };
}

function applySets(db, id, sets) {
  const cols = Object.keys(sets);
  if (!cols.length) return;
  db.prepare(`UPDATE leads SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map(c => sets[c]), id);
}

function parseCustom(l) {
  try { return JSON.parse(l.custom || '{}'); } catch { return {}; }
}

// List leads / contacts
router.get('/', requirePermission('leads.view'), (req, res) => {
  const db = getDB();
  const projectId = req.project.id;
  const { search, stage, verified, phoneStatus, campaignUse, hasSocial, status, tag, tagNot, tagMode, sortBy, sortOrder, lifecycle, owner, source, company, hasMessage, category } = req.query;

  let sql = 'SELECT * FROM leads WHERE project_id = ?';
  const params = [projectId];

  if (status) {
    sql += ' AND status = ?'; params.push(status);
  } else {
    sql += " AND status = 'active'";
  }

  if (search) {
    sql += ' AND (name LIKE ? OR phone LIKE ? OR notes LIKE ? OR email LIKE ?)';
    const p = `%${search}%`;
    params.push(p, p, p, p);
  }

  if (stage) {
    sql += ' AND stage_id = ?'; params.push(stage);
  }

  if (lifecycle) {
    const list = String(lifecycle).split(',').filter(l => LIFECYCLES.includes(l));
    if (list.length) { sql += ` AND lifecycle IN (${list.map(() => '?').join(',')})`; params.push(...list); }
  }

  if (owner === 'me') { sql += ' AND owner_id = ?'; params.push(req.user.id); }
  else if (owner === 'none') { sql += ' AND owner_id IS NULL'; }
  else if (owner) { sql += ' AND owner_id = ?'; params.push(owner); }

  if (source) { sql += ' AND source = ?'; params.push(source); }

  if (category === '__none') { sql += " AND (category IS NULL OR category = '')"; }
  else if (category) { sql += ' AND category = ?'; params.push(category); }

  if (company === 'none') { sql += ' AND company_id IS NULL'; }
  else if (company) { sql += ' AND company_id = ?'; params.push(company); }

  const cfFilter = customFilterSql(projectId, 'contact', req.query);
  sql += cfFilter.sql; params.push(...cfFilter.params);

  if (verified === 'yes') { sql += ' AND verified = 1'; }
  else if (verified === 'no') { sql += ' AND verified = 0'; }

  if (phoneStatus === 'valid') { sql += ' AND phone_valid = 1'; }
  else if (phoneStatus === 'invalid') { sql += ' AND phone_valid = 0'; }

  if (campaignUse === 'used') {
    sql += ' AND id IN (SELECT lead_id FROM campaign_leads)';
  } else if (campaignUse === 'unused') {
    sql += ' AND id NOT IN (SELECT lead_id FROM campaign_leads)';
  }

  if (hasMessage === 'yes') { sql += " AND message != ''"; }
  else if (hasMessage === 'no') { sql += " AND message = ''"; }

  if (hasSocial === 'true') {
    sql += " AND (facebook != '' OR instagram != '' OR tiktok != '' OR link != '')";
  }

  if (tag) {
    const ids = tag.split(',').filter(Boolean);
    if (ids.length) {
      if (tagMode === 'all') {
        sql += ` AND id IN (SELECT lead_id FROM lead_tags WHERE tag_id IN (${ids.map(() => '?').join(',')}) GROUP BY lead_id HAVING COUNT(DISTINCT tag_id) = ?)`;
        params.push(...ids, ids.length);
      } else {
        sql += ` AND id IN (SELECT lead_id FROM lead_tags WHERE tag_id IN (${ids.map(() => '?').join(',')}))`;
        params.push(...ids);
      }
    }
  } else if (tagNot) {
    const ids = tagNot.split(',').filter(Boolean);
    if (ids.length) {
      sql += ` AND id NOT IN (SELECT lead_id FROM lead_tags WHERE tag_id IN (${ids.map(() => '?').join(',')}))`;
      params.push(...ids);
    }
  }

  const sortCols = ['name', 'phone', 'created_at', 'dead_at', 'verified', 'phone_valid', 'updated_at', 'lifecycle'];
  const col = sortCols.includes(sortBy) ? sortBy : 'created_at';
  const dir = sortOrder === 'asc' ? 'ASC' : 'DESC';
  sql += ` ORDER BY ${col} ${dir}`;

  const paging = pageParams(req.query);
  const { rows: leads, total } = runPaged(db, sql, params, paging);

  const ids = leads.map(l => l.id);
  const campaignsBy = groupBy(db, ids, ph => `
    SELECT cl.lead_id AS k, c.id, c.name FROM campaigns c
    INNER JOIN campaign_leads cl ON cl.campaign_id = c.id
    WHERE cl.lead_id IN (${ph})
  `);
  const historyBy = groupBy(db, ids, ph => `SELECT lead_id AS k, * FROM stage_history WHERE lead_id IN (${ph}) ORDER BY at DESC`);
  const tagsBy = groupBy(db, ids, ph => `
    SELECT lt.lead_id AS k, t.id, t.name, t.color FROM tags t
    INNER JOIN lead_tags lt ON lt.tag_id = t.id
    WHERE lt.lead_id IN (${ph})
  `);
  const companyIds = [...new Set(leads.map(l => l.company_id).filter(Boolean))];
  const companiesBy = groupBy(db, companyIds, ph => `SELECT id AS k, id, name FROM companies WHERE id IN (${ph})`);

  const enriched = leads.map(l => ({
    ...l,
    verified: !!l.verified,
    phone_valid: !!l.phone_valid,
    custom: parseCustom(l),
    company: l.company_id ? companiesBy.get(l.company_id)?.[0] || null : null,
    campaigns: campaignsBy.get(l.id) || [],
    stageHistory: historyBy.get(l.id) || [],
    tags: tagsBy.get(l.id) || [],
  }));

  sendList(res, enriched, total, paging);
});

// Duplicate groups (same phone digits or email) — registered before /:id
// Business types in this workspace (from Google Maps, or set by hand), most common first.
router.get('/categories', requirePermission('leads.view'), (req, res) => {
  res.json(getDB().prepare(`SELECT category AS name, COUNT(*) AS count FROM leads
    WHERE project_id = ? AND status = 'active' AND category IS NOT NULL AND category != ''
    GROUP BY category ORDER BY count DESC, category`).all(req.project.id));
});

router.get('/duplicates', requirePermission('leads.view'), (req, res) => {
  res.json(findDuplicates(getDB(), req.project.id, { limit: Math.min(500, parseInt(req.query.limit) || 100) }));
});

// "Not duplicates": hide a group for good. key = 'p:<digits>' or 'e:<email>' (reason/value from the list).
router.post('/duplicates/dismiss', requirePermission('leads.edit'), (req, res) => {
  const { reason, value } = req.body;
  if (!['phone', 'email'].includes(reason) || !value) return res.status(400).json({ error: 'reason and value required' });
  const key = (reason === 'phone' ? 'p:' : 'e:') + String(value).toLowerCase();
  getDB().prepare('INSERT OR IGNORE INTO duplicate_dismissals (project_id, key, account_id, created_at) VALUES (?, ?, ?, ?)')
    .run(req.project.id, key, req.user.id, Date.now());
  res.json({ ok: true });
});

// Merge duplicates into a primary contact
router.post('/merge', requirePermission('leads.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const { primaryId, duplicateIds } = req.body;
  if (!isOwned('leads', pid, primaryId)) return res.status(404).json({ error: 'Primary contact not found' });
  const ids = ownedIds('leads', pid, duplicateIds).filter(id => id !== primaryId);
  if (!ids.length) return res.status(400).json({ error: 'No duplicates to merge' });
  const result = db.transaction(() => mergeContacts(db, pid, primaryId, ids))();
  logAudit('merge', 'lead', primaryId, '', { merged: ids }, pid);
  res.json(result);
});

// Get single lead
router.get('/:id', requirePermission('leads.view'), (req, res) => {
  const db = getDB();
  const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  lead.verified = !!lead.verified;
  lead.phone_valid = !!lead.phone_valid;
  lead.do_not_contact = !!lead.do_not_contact;
  lead.custom = parseCustom(lead);
  const waPhone = String(lead.phone || '').replace(/\D/g, '');
  lead.whatsapp = {
    sends: db.prepare(`SELECT s.sent_at, s.delivered_at, s.replied_at, s.text, s.job_id, s.sender_phone, s.legacy, j.name AS job_name FROM wa_sends s
      LEFT JOIN broadcast_jobs j ON j.id = s.job_id AND j.project_id = s.project_id
      WHERE s.project_id = ? AND (s.lead_id = ? OR (s.phone = ? AND s.phone != '')) ORDER BY s.sent_at DESC LIMIT 50`).all(req.project.id, lead.id, waPhone),
    upcoming: db.prepare(`SELECT j.id AS job_id, j.name AS job_name, j.status, j.scheduled_at FROM job_leads jl
      INNER JOIN broadcast_jobs j ON j.id = jl.job_id AND j.project_id = ?
      WHERE jl.lead_id = ? AND jl.status = 'pending' AND j.status IN ('scheduled', 'pending', 'running', 'paused') ORDER BY COALESCE(j.scheduled_at, j.created_at)`).all(req.project.id, lead.id),
  };
  lead.company = lead.company_id ? db.prepare('SELECT id, name FROM companies WHERE id = ?').get(lead.company_id) || null : null;
  lead.deals = db.prepare('SELECT id, title, value, currency, status, stage_id FROM deals WHERE contact_id = ? AND project_id = ? ORDER BY created_at DESC').all(lead.id, req.project.id);
  lead.campaigns = db.prepare(`
    SELECT c.id, c.name FROM campaigns c
    INNER JOIN campaign_leads cl ON cl.campaign_id = c.id WHERE cl.lead_id = ?
  `).all(lead.id);
  lead.stageHistory = db.prepare('SELECT * FROM stage_history WHERE lead_id = ? ORDER BY at DESC').all(lead.id);
  lead.tags = db.prepare(`
    SELECT t.id, t.name, t.color FROM tags t
    INNER JOIN lead_tags lt ON lt.tag_id = t.id WHERE lt.lead_id = ?
  `).all(lead.id);
  res.json(lead);
});

// Create lead
router.post('/', requirePermission('leads.edit'), (req, res) => {
  const db = getDB();
  const projectId = req.project.id;
  const { id, name, phone, email, facebook, instagram, tiktok, link, location, notes, status, verified, tag_ids } = req.body;
  let { stage_id } = req.body;
  if (stage_id) {
    if (!isOwned('stages', projectId, stage_id)) return res.status(400).json({ error: 'Invalid stage' });
  } else {
    stage_id = db.prepare('SELECT id FROM stages WHERE project_id = ? ORDER BY sort_order LIMIT 1').get(projectId)?.id;
    if (!stage_id) return res.status(400).json({ error: 'Project has no stages' });
  }
  if (id && db.prepare('SELECT 1 FROM leads WHERE id = ?').get(id)) return res.status(409).json({ error: 'Lead id already exists' });
  const cf = contactFields({ owner_id: req.user.id, source: 'manual', ...req.body }, projectId, { create: true });
  if (cf.error) return res.status(400).json({ error: cf.error });

  const leadId = id || 'lead_' + Math.random().toString(36).slice(2, 10);
  const now = Date.now();
  const phoneValid = isValidPhone(phone) ? 1 : 0;
  const isDead = !phoneValid || !phone;

  db.prepare(`INSERT INTO leads (id, name, phone, phone_valid, email, facebook, instagram, tiktok, link, location, notes, status, verified, stage_id, created_at, dead_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    leadId, name || '(unnamed)', phone || '', phoneValid, email || '', facebook || '', instagram || '', tiktok || '', link || '', location || '', notes || '', isDead ? 'dead' : (status || 'active'), verified ? 1 : 0, stage_id, now, isDead ? now : (status === 'dead' ? now : null), projectId
  );

  db.prepare('INSERT INTO stage_history (lead_id, stage_id, at) VALUES (?, ?, ?)').run(leadId, stage_id, now);
  applySets(db, leadId, { ...cf.sets, updated_at: now });

  if (tag_ids && tag_ids.length) {
    const insertTag = db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)');
    for (const tid of ownedIds('tags', projectId, tag_ids)) insertTag.run(leadId, tid);
  }

  logAudit('create', 'lead', leadId, name || '(unnamed)', { phone, phoneValid, stage_id }, projectId);

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  lead.verified = !!lead.verified;
  lead.phone_valid = !!lead.phone_valid;
  lead.custom = parseCustom(lead);
  lead.campaigns = [];
  lead.stageHistory = db.prepare('SELECT * FROM stage_history WHERE lead_id = ? ORDER BY at DESC').all(leadId);
  lead.tags = db.prepare('SELECT t.id, t.name, t.color FROM tags t INNER JOIN lead_tags lt ON lt.tag_id = t.id WHERE lt.lead_id = ?').all(leadId);
  res.status(201).json(lead);
});

// Update lead
router.put('/:id', requirePermission('leads.edit'), (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM leads WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { name, phone, email, facebook, instagram, tiktok, link, location, notes, status, verified, stage_id, tag_ids } = req.body;
  if (stage_id && !isOwned('stages', req.project.id, stage_id)) return res.status(400).json({ error: 'Invalid stage' });
  const cf = contactFields(req.body, req.project.id, { existing: parseCustom(existing) });
  if (cf.error) return res.status(400).json({ error: cf.error });
  const phoneValid = phone !== undefined ? (isValidPhone(phone) ? 1 : 0) : existing.phone_valid;
  const stageChanged = stage_id && stage_id !== existing.stage_id;
  const wasDead = existing.status === 'dead';
  const now = Date.now();

  db.prepare(`UPDATE leads SET name=?, phone=?, phone_valid=?, email=?, facebook=?, instagram=?, tiktok=?, link=?, location=?, notes=?, status=?, verified=?, stage_id=?, dead_at=? WHERE id=?`).run(
    name ?? existing.name, phone ?? existing.phone, phoneValid, email ?? existing.email,
    facebook ?? existing.facebook, instagram ?? existing.instagram, tiktok ?? existing.tiktok,
    link ?? existing.link, location ?? existing.location, notes ?? existing.notes,
    status ?? existing.status, verified !== undefined ? (verified ? 1 : 0) : existing.verified,
    stage_id ?? existing.stage_id,
    status === 'dead' && !wasDead ? now : (status === 'active' && wasDead ? null : existing.dead_at),
    req.params.id
  );

  applySets(db, req.params.id, { ...cf.sets, updated_at: now });

  if (stageChanged) {
    db.prepare('INSERT INTO stage_history (lead_id, stage_id, at) VALUES (?, ?, ?)').run(req.params.id, stage_id, now);
  }

  if (tag_ids !== undefined) {
    db.prepare('DELETE FROM lead_tags WHERE lead_id = ?').run(req.params.id);
    const insertTag = db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)');
    for (const tid of ownedIds('tags', req.project.id, tag_ids)) insertTag.run(req.params.id, tid);
  }

  logAudit('edit', 'lead', req.params.id, existing.name, { changes: req.body }, req.project.id);

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  lead.verified = !!lead.verified;
  lead.phone_valid = !!lead.phone_valid;
  lead.custom = parseCustom(lead);
  lead.campaigns = db.prepare('SELECT c.id, c.name FROM campaigns c INNER JOIN campaign_leads cl ON cl.campaign_id = c.id WHERE cl.lead_id = ?').all(lead.id);
  lead.stageHistory = db.prepare('SELECT * FROM stage_history WHERE lead_id = ? ORDER BY at DESC').all(lead.id);
  lead.tags = db.prepare('SELECT t.id, t.name, t.color FROM tags t INNER JOIN lead_tags lt ON lt.tag_id = t.id WHERE lt.lead_id = ?').all(lead.id);
  res.json(lead);
});

// Delete lead
router.delete('/:id', requirePermission('leads.delete'), (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT id, name FROM leads WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  db.prepare('UPDATE deals SET contact_id = NULL WHERE contact_id = ? AND project_id = ?').run(req.params.id, req.project.id);
  db.prepare('DELETE FROM leads WHERE id = ? AND project_id = ?').run(req.params.id, req.project.id);
  logAudit('delete', 'lead', req.params.id, existing?.name || 'unknown', {}, req.project.id);
  res.json({ ok: true });
});

// Bulk actions
router.post('/bulk', requirePermission('leads.edit', 'leads.verify', 'leads.delete'), (req, res) => {
  const db = getDB();
  const projectId = req.project.id;
  const { ids, action, stageId, tagId, value } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs' });
  const now = Date.now();
  const needed = action === 'verify' ? 'leads.verify' : action === 'delete' ? 'leads.delete' : 'leads.edit';
  if (!hasPermission(req.user, needed)) return res.status(403).json({ error: 'Permission denied' });
  if (action === 'stage' && !isOwned('stages', projectId, stageId)) return res.status(400).json({ error: 'Invalid stage' });
  if ((action === 'tag' || action === 'untag') && !isOwned('tags', projectId, tagId)) return res.status(400).json({ error: 'Invalid tag' });
  if (action === 'lifecycle' && !LIFECYCLES.includes(value)) return res.status(400).json({ error: 'Invalid lifecycle' });
  if (action === 'company' && value !== null && !isOwned('companies', projectId, value)) return res.status(400).json({ error: 'Invalid company' });
  if (action === 'owner' && value !== null && !isProjectMember(projectId, value)) return res.status(400).json({ error: 'Owner must be a member of this workspace' });

  // Only allow acting on leads in this project
  const placeholders = ids.map(() => '?').join(',');
  const owned = db.prepare(`SELECT id FROM leads WHERE project_id = ? AND id IN (${placeholders})`).all(projectId, ...ids);
  const ownedIds = owned.map(r => r.id);
  if (!ownedIds.length) return res.status(404).json({ error: 'No matching leads' });
  const ownedPh = ownedIds.map(() => '?').join(',');

  if (action === 'verify') {
    db.prepare(`UPDATE leads SET verified = 1 WHERE id IN (${ownedPh})`).run(...ownedIds);
  } else if (action === 'dead') {
    db.prepare(`UPDATE leads SET status = 'dead', dead_at = ? WHERE id IN (${ownedPh})`).run(now, ...ownedIds);
  } else if (action === 'stage' && stageId) {
    db.prepare(`UPDATE leads SET stage_id = ? WHERE id IN (${ownedPh})`).run(stageId, ...ownedIds);
    const insert = db.prepare('INSERT INTO stage_history (lead_id, stage_id, at) VALUES (?, ?, ?)');
    for (const id of ownedIds) insert.run(id, stageId, now);
  } else if (action === 'tag' && tagId) {
    const insert = db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)');
    for (const id of ownedIds) insert.run(id, tagId);
  } else if (action === 'untag' && tagId) {
    const del = db.prepare('DELETE FROM lead_tags WHERE lead_id = ? AND tag_id = ?');
    for (const id of ownedIds) del.run(id, tagId);
  } else if (action === 'delete') {
    db.prepare(`UPDATE deals SET contact_id = NULL WHERE contact_id IN (${ownedPh})`).run(...ownedIds);
    db.prepare(`DELETE FROM leads WHERE id IN (${ownedPh})`).run(...ownedIds);
  } else if (action === 'lifecycle') {
    db.prepare(`UPDATE leads SET lifecycle = ?, updated_at = ? WHERE id IN (${ownedPh})`).run(value, now, ...ownedIds);
  } else if (action === 'company') {
    db.prepare(`UPDATE leads SET company_id = ?, updated_at = ? WHERE id IN (${ownedPh})`).run(value, now, ...ownedIds);
  } else if (action === 'owner') {
    db.prepare(`UPDATE leads SET owner_id = ?, updated_at = ? WHERE id IN (${ownedPh})`).run(value, now, ...ownedIds);
  } else if (action === 'convert') {
    // Legacy "Convert to CRM": still creates client rows until the Clients page is replaced (T-023),
    // and marks the contacts as qualified (never downgrading customers).
    db.prepare(`UPDATE leads SET lifecycle = 'qualified', updated_at = ? WHERE lifecycle = 'lead' AND id IN (${ownedPh})`).run(now, ...ownedIds);
    const insertClient = db.prepare(`INSERT OR IGNORE INTO clients (id, lead_id, name, phone, phone_valid, email, facebook, instagram, tiktok, link, location, notes, status, source, created_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const getLead = db.prepare('SELECT * FROM leads WHERE id = ?');
    for (const id of ownedIds) {
      const l = getLead.get(id);
      if (l) {
        insertClient.run(crypto.randomUUID(), l.id, l.name, l.phone, l.phone_valid, l.email, l.facebook, l.instagram, l.tiktok, l.link, l.location, l.notes, 'active', 'lead', Date.now(), projectId);
      }
    }
  }

  logAudit('bulk', 'lead', ownedIds.join(','), `${action} (${ownedIds.length} leads)`, { action, stageId, tagId, value }, projectId);
  res.json({ ok: true });
});

// Import preview (CSV upload)
router.post('/import/preview', requirePermission('leads.import'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const text = req.file.buffer.toString('utf-8');
  const records = parseCSV(text);
  res.json({ rows: records });
});

// Import confirm — with update mode
router.post('/import/confirm', requirePermission('leads.import'), wrap(async (req, res) => {
  const db = getDB();
  const projectId = req.project.id;
  const { rows, skipDupes, updateMode, checkWhatsApp, filename } = req.body;
  let added = 0, skipped = 0, updated = 0;
  const now = Date.now();
  const firstStage = db.prepare('SELECT id FROM stages WHERE project_id = ? ORDER BY sort_order LIMIT 1').get(projectId);

  // Read country code setting for phone normalization
  const ccSetting = db.prepare("SELECT value FROM settings WHERE project_id = ? AND key = 'country_code'").get(projectId);
  const countryCode = ccSetting ? ccSetting.value : '';

  // Normalize phone numbers
  for (const row of rows) {
    if (row.phone) row.phone = normalizePhone(row.phone, countryCode);
  }

  // Auto-backup DB before import (online backup is consistent in WAL mode); keep the 5 most recent
  try {
    await db.backup(DB_PATH + '.backup.' + now);
    const dir = path.dirname(DB_PATH);
    const base = path.basename(DB_PATH) + '.backup.';
    const old = fs.readdirSync(dir).filter(f => f.startsWith(base)).sort().slice(0, -5);
    for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  } catch (err) {
    console.error('[import] pre-import backup failed:', err.message);
  }

  const insertActive = db.prepare(`INSERT INTO leads (id, name, phone, phone_valid, email, facebook, instagram, tiktok, link, location, notes, status, verified, stage_id, created_at, project_id, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'active', 0, ?, ?, ?, 'csv')`);
  const insertDead = db.prepare(`INSERT INTO leads (id, name, phone, phone_valid, email, facebook, instagram, tiktok, link, location, notes, status, verified, stage_id, created_at, dead_at, project_id, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'dead', 0, ?, ?, ?, ?, 'csv')`);
  const insertHistory = db.prepare('INSERT INTO stage_history (lead_id, stage_id, at) VALUES (?, ?, ?)');
  const updateByPhone = db.prepare(`UPDATE leads SET name=?, phone_valid=?, email=?, facebook=?, instagram=?, tiktok=?, link=?, location=? WHERE id=?`);
  const findDupe = db.prepare("SELECT id FROM leads WHERE project_id = ? AND LOWER(name) = ? AND phone != '' AND phone = ?");
  const findDupeNoPhone = db.prepare("SELECT id FROM leads WHERE project_id = ? AND LOWER(name) = ? AND (phone = '' OR phone IS NULL)");
  const findPhone = db.prepare("SELECT id FROM leads WHERE project_id = ? AND phone != '' AND phone = ?");

  const txn = db.transaction(() => {
    const maybeClosedIds = [];
    for (const row of rows) {
      if (updateMode && row.phone) {
        const existing = findPhone.get(projectId, row.phone);
        if (existing) {
          updateByPhone.run(row.name, row.phoneValid ? 1 : 0, row.email || '', row.facebook || '', row.instagram || '', row.tiktok || '', row.link || '', row.location || '', existing.id);
          if (row.maybeClosed) maybeClosedIds.push(existing.id);
          updated++;
          continue;
        }
      }

      if (skipDupes) {
        let dupe;
        if (row.phone) {
          dupe = findDupe.get(projectId, row.name.toLowerCase(), row.phone);
        } else {
          dupe = findDupeNoPhone.get(projectId, row.name.toLowerCase());
        }
        if (dupe) { skipped++; continue; }
      }

      const id = 'lead_' + Math.random().toString(36).slice(2, 10);
      const isDead = !row.phoneValid || !row.phone;
      if (isDead) {
        insertDead.run(id, row.name, row.phone, row.phoneValid ? 1 : 0, row.email || '', row.facebook || '', row.instagram || '', row.tiktok || '', row.link || '', row.location || '', firstStage?.id || 's1', now, now, projectId);
      } else {
        insertActive.run(id, row.name, row.phone, row.phoneValid ? 1 : 0, row.email || '', row.facebook || '', row.instagram || '', row.tiktok || '', row.link || '', row.location || '', firstStage?.id || 's1', now, projectId);
      }
      insertHistory.run(id, firstStage?.id || 's1', now);
      if (row.maybeClosed) maybeClosedIds.push(id);
      added++;
    }
    return maybeClosedIds;
  });
  const maybeClosedIds = txn();

  // Tag MaybeClosed leads
  if (maybeClosedIds.length > 0) {
    let maybeClosedTag = db.prepare('SELECT id FROM tags WHERE name = ? AND project_id = ?').get('MaybeClosed', projectId);
    if (!maybeClosedTag) {
      const tagId = 'tag_' + Math.random().toString(36).slice(2, 10);
      db.prepare('INSERT INTO tags (id, name, color, created_at, project_id) VALUES (?, ?, ?, ?, ?)').run(tagId, 'MaybeClosed', '#8B4513', Date.now(), projectId);
      maybeClosedTag = { id: tagId };
    }
    const assignTag = db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)');
    for (const id of maybeClosedIds) assignTag.run(id, maybeClosedTag.id);
  }

  // After import, optionally check WhatsApp
  let waResults = null;
  if (checkWhatsApp && added > 0) {
    try {
      const toCheck = rows.filter(r => r.phone && r.phoneValid).map(r => r.phone);
      if (toCheck.length > 0) {
        if (waCheckPhones && waGetStatus && waGetStatus(projectId).ready) {
          waResults = await waCheckPhones(projectId, toCheck);
          let notWATag = db.prepare('SELECT id FROM tags WHERE name = ? AND project_id = ?').get('Not WhatsApp', projectId);
          if (!notWATag) {
            const tagId = 'tag_' + Math.random().toString(36).slice(2, 10);
            db.prepare('INSERT INTO tags (id, name, color, created_at, project_id) VALUES (?, ?, ?, ?, ?)').run(tagId, 'Not WhatsApp', '#a13a3a', Date.now(), projectId);
            notWATag = { id: tagId };
          }
          const activeLeads = db.prepare("SELECT id, phone FROM leads WHERE status = 'active' AND project_id = ?").all(projectId);
          for (const r of waResults) {
            if (!r.exists) {
              const match = activeLeads.find(l => l.phone.replace(/\D/g, '') === r.phone);
              if (match) {
                db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)').run(match.id, notWATag.id);
              }
            }
          }
        }
      }
    } catch {}
  }

  // Log import
  const importId = 'imp_' + Math.random().toString(36).slice(2, 10);
  db.prepare('INSERT INTO import_logs (id, filename, rows_total, added, skipped, updated, details, created_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(importId, filename || '', rows.length, added, skipped, updated, JSON.stringify({ waResults }), now, projectId);
  logAudit('import', 'import', importId, filename || 'unknown.csv', { added, skipped, updated, rows: rows.length }, projectId);

  res.json({ added, skipped, updated, waResults });
}));

function parseCSV(text) {
  const lines = text.split('\n');
  const cleanLines = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    let inQ = false;
    for (const c of lines[i]) {
      if (c === '"') inQ = !inQ;
    }
    if (!inQ) cleanLines.push(lines[i]);
  }
  const cleanText = cleanLines.join('\n');

  let raw;
  try {
    raw = parse(cleanText, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
      trim: true,
    });
  } catch {
    raw = [];
  }
  if (!raw.length) return [];

  const data = [];
  for (const row of raw) {
    const name = row.title || row.name || row.Name || '(unnamed)';
    const phone = row.phone || row.Phone || '';
    const website = row.website || row.Website || '';
    const mapsLink = row.link || row.Link || row.google_maps_link || '';
    const emailRaw = row.emails || row.email || row.Email || '';
    let email = '';
    if (emailRaw && emailRaw !== '[]') {
      const cleaned = emailRaw.replace(/[\[\]"]/g, '').trim();
      if (cleaned) email = cleaned.split(',')[0].trim();
    }
    const linkType = classifyLink(website);
    const userReviewsRaw = row.user_reviews || '';
    const openHoursRaw = row.open_hours || '';
    const popularTimesRaw = row.popular_times || '';
    const statusRaw = row.status || '';
    const maybeClosed = getMaybeClosed(userReviewsRaw, openHoursRaw, popularTimesRaw, statusRaw);
    data.push({
      name: name.trim(),
      phone: phone.trim(),
      email,
      facebook: linkType === 'facebook' ? website : '',
      instagram: linkType === 'instagram' ? website : '',
      tiktok: linkType === 'tiktok' ? website : '',
      link: linkType === 'link' ? website : '',
      location: mapsLink || '',
      phoneValid: isValidPhone(phone),
      maybeClosed,
    });
  }
  return data;
}

function getMaybeClosed(userReviewsRaw, openHoursRaw, popularTimesRaw, statusRaw) {
  if (userReviewsRaw && userReviewsRaw !== 'null' && userReviewsRaw !== '[]') {
    try {
      const reviews = JSON.parse(userReviewsRaw);
      if (Array.isArray(reviews) && reviews.length > 0) {
        const newest = reviews.reduce((max, r) => {
          const ts = r.posted_at_unix_micros ? Math.floor(r.posted_at_unix_micros / 1000) : 0;
          return ts > max ? ts : max;
        }, 0);
        if (newest) {
          const nineMonthsAgo = Date.now() - 9 * 30 * 24 * 60 * 60 * 1000;
          if (newest < nineMonthsAgo) return true;
        }
      }
    } catch {}
  }

  if ((!openHoursRaw || openHoursRaw === '{}') && (!popularTimesRaw || popularTimesRaw === '{}')) return true;

  if (openHoursRaw && openHoursRaw !== '{}') {
    try {
      const oh = JSON.parse(openHoursRaw);
      if (Object.values(oh).every(v => String(v).toLowerCase().includes('closed'))) return true;
    } catch {}
  }

  if (statusRaw && (String(statusRaw).toLowerCase().includes('closed') || String(statusRaw).toLowerCase().includes('permanently'))) return true;

  return false;
}

export function isValidPhone(raw) {
  if (!raw) return false;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return false;
  if (/^0{6,}$/.test(digits)) return false;
  if (/^(\d)\1{6,}$/.test(digits)) return false;
  return true;
}

function classifyLink(url) {
  if (!url) return null;
  const u = String(url).toLowerCase();
  if (u.includes('facebook.com') || u.includes('fb.com')) return 'facebook';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('tiktok.com')) return 'tiktok';
  return 'link';
}

export function normalizePhone(raw, countryCode) {
  if (!raw) return raw;
  let cleaned = String(raw).replace(/\s+/g, '');
  if (cleaned.includes('+')) {
    return cleaned.replace(/\D/g, '');
  }
  const digits = cleaned.replace(/\D/g, '');
  if (!digits || !countryCode) return digits;
  const withoutLeadingZero = digits.replace(/^0+/, '');
  if (!withoutLeadingZero.startsWith(countryCode)) {
    return countryCode + withoutLeadingZero;
  }
  return withoutLeadingZero;
}

export default router;
