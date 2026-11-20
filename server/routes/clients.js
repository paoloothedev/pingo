import { Router } from 'express';
import { getDB, logAudit } from '../db.js';
import { ownedIds, isOwned } from '../lib/scope.js';
import { pageParams, runPaged, groupBy, sendList } from '../lib/paginate.js';
import { authMiddleware, requirePermission } from './auth.js';
import crypto from 'crypto';

const router = Router();
router.use(authMiddleware);

router.get('/', requirePermission('leads.view'), (req, res) => {
  const db = getDB();
  const projectId = req.project.id;
  const { search, status, stage, assigned, tag, sortBy, sortOrder } = req.query;

  let sql = 'SELECT * FROM clients WHERE project_id = ?';
  const params = [projectId];

  if (search) { sql += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)'; const s = `%${search}%`; params.push(s, s, s); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (stage) { sql += ' AND stage = ?'; params.push(stage); }
  if (assigned) { sql += ' AND assigned_to = ?'; params.push(assigned); }

  if (tag) {
    const tagIds = tag.split(',');
    sql += ` AND id IN (SELECT client_id FROM client_tags WHERE tag_id IN (${tagIds.map(() => '?').join(',')}))`;
    params.push(...tagIds);
  }

  const validSort = ['name', 'phone', 'email', 'created_at', 'updated_at', 'stage', 'status'];
  const col = validSort.includes(sortBy) ? sortBy : 'created_at';
  const order = sortOrder === 'asc' ? 'ASC' : 'DESC';
  sql += ` ORDER BY ${col} ${order}`;

  const paging = pageParams(req.query);
  const { rows: clients, total } = runPaged(db, sql, params, paging);

  const tagsBy = groupBy(db, clients.map(c => c.id), ph => `
    SELECT ct.client_id AS k, t.* FROM tags t
    INNER JOIN client_tags ct ON ct.tag_id = t.id
    WHERE ct.client_id IN (${ph})
  `);
  for (const c of clients) c.tags = tagsBy.get(c.id) || [];

  sendList(res, clients, total, paging);
});

router.get('/:id', requirePermission('leads.view'), (req, res) => {
  const db = getDB();
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  client.tags = db.prepare('SELECT t.* FROM tags t INNER JOIN client_tags ct ON ct.tag_id = t.id WHERE ct.client_id = ?').all(client.id);
  client.activities = db.prepare('SELECT * FROM client_activities WHERE client_id = ? ORDER BY created_at DESC LIMIT 50').all(client.id);
  res.json(client);
});

router.post('/', requirePermission('leads.edit'), (req, res) => {
  const db = getDB();
  const { name, phone, phone_valid, email, facebook, instagram, tiktok, link, location, notes, status, stage, source, assigned_to, tag_ids, lead_id } = req.body;
  const id = crypto.randomUUID();
  const now = Date.now();
  if (lead_id && !isOwned('leads', req.project.id, lead_id)) return res.status(400).json({ error: 'Invalid lead' });

  db.prepare(`INSERT INTO clients (id, lead_id, name, phone, phone_valid, email, facebook, instagram, tiktok, link, location, notes, status, stage, source, assigned_to, created_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, lead_id || null, name || '', phone || '', phone_valid ? 1 : 0, email || '', facebook || '', instagram || '', tiktok || '', link || '', location || '', notes || '', status || 'active', stage || 'new', source || '', assigned_to || null, now, req.project.id);

  if (tag_ids?.length) {
    const stmt = db.prepare('INSERT OR IGNORE INTO client_tags (client_id, tag_id) VALUES (?, ?)');
    for (const tid of ownedIds('tags', req.project.id, tag_ids)) stmt.run(id, tid);
  }

  db.prepare('INSERT INTO client_activities (client_id, account_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.user.id, 'created', JSON.stringify({ by: req.user.username }), now);

  logAudit('client_created', 'client', id, name, { by: req.user.id }, req.project.id);
  res.json({ id });
});

router.put('/:id', requirePermission('leads.edit'), (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM clients WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  const { name, phone, phone_valid, email, facebook, instagram, tiktok, link, location, notes, status, stage, source, assigned_to, tag_ids } = req.body;

  db.prepare(`UPDATE clients SET name=?, phone=?, phone_valid=?, email=?, facebook=?, instagram=?, tiktok=?, link=?, location=?, notes=?, status=?, stage=?, source=?, assigned_to=?, updated_at=? WHERE id=?`)
    .run(
      name ?? existing.name, phone ?? existing.phone, phone_valid !== undefined ? (phone_valid ? 1 : 0) : existing.phone_valid,
      email ?? existing.email, facebook ?? existing.facebook, instagram ?? existing.instagram, tiktok ?? existing.tiktok,
      link ?? existing.link, location ?? existing.location, notes ?? existing.notes,
      status ?? existing.status, stage ?? existing.stage, source ?? existing.source,
      assigned_to !== undefined ? assigned_to : existing.assigned_to, Date.now(), req.params.id
    );

  if (tag_ids !== undefined) {
    db.prepare('DELETE FROM client_tags WHERE client_id = ?').run(req.params.id);
    const stmt = db.prepare('INSERT OR IGNORE INTO client_tags (client_id, tag_id) VALUES (?, ?)');
    for (const tid of ownedIds('tags', req.project.id, tag_ids)) stmt.run(req.params.id, tid);
  }

  const changes = [];
  if (status && status !== existing.status) changes.push(`status: ${existing.status} → ${status}`);
  if (stage && stage !== existing.stage) changes.push(`stage: ${existing.stage} → ${stage}`);
  if (assigned_to !== undefined && assigned_to !== existing.assigned_to) changes.push(`assigned to: ${assigned_to || 'nobody'}`);

  if (changes.length) {
    db.prepare('INSERT INTO client_activities (client_id, account_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(req.params.id, req.user.id, 'updated', JSON.stringify({ changes, by: req.user.username }), Date.now());
  }

  logAudit('client_updated', 'client', req.params.id, name || existing.name, { by: req.user.id }, req.project.id);
  res.json({ ok: true });
});

router.delete('/:id', requirePermission('leads.delete'), (req, res) => {
  const db = getDB();
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  logAudit('client_deleted', 'client', req.params.id, client.name, { by: req.user.id }, req.project.id);
  res.json({ ok: true });
});

router.post('/:id/activity', requirePermission('leads.edit'), (req, res) => {
  const db = getDB();
  const { action, details } = req.body;
  if (!action) return res.status(400).json({ error: 'Action required' });
  if (!isOwned('clients', req.project.id, req.params.id)) return res.status(404).json({ error: 'Client not found' });
  const now = Date.now();
  db.prepare('INSERT INTO client_activities (client_id, account_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.params.id, req.user.id, action, JSON.stringify(details || {}), now);
  res.json({ ok: true });
});

export default router;
