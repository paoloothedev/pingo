import { Router } from 'express';
import { getDB, logAudit } from '../db.js';
import { isOwned } from '../lib/scope.js';
import { authMiddleware, requirePermission } from './auth.js';
import crypto from 'crypto';

const router = Router();
router.use(authMiddleware);

router.get('/', requirePermission('campaigns.view'), (req, res) => {
  const db = getDB();
  const campaigns = db.prepare('SELECT * FROM email_campaigns WHERE project_id = ? ORDER BY created_at DESC').all(req.project.id);
  for (const c of campaigns) {
    c.leads = db.prepare(`
      SELECT l.id, l.name, l.email, l.phone FROM leads l
      INNER JOIN email_campaign_leads ecl ON ecl.lead_id = l.id
      WHERE ecl.campaign_id = ?
    `).all(c.id);
  }
  res.json(campaigns);
});

router.get('/:id', requirePermission('campaigns.view'), (req, res) => {
  const db = getDB();
  const c = db.prepare('SELECT * FROM email_campaigns WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  c.leads = db.prepare(`
    SELECT l.id, l.name, l.email, l.phone FROM leads l
    INNER JOIN email_campaign_leads ecl ON ecl.lead_id = l.id
    WHERE ecl.campaign_id = ?
  `).all(c.id);
  res.json(c);
});

router.post('/', requirePermission('campaigns.edit'), (req, res) => {
  const db = getDB();
  const { name, subject, body } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO email_campaigns (id, name, subject, body, created_at, project_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, subject || '', body || '', Date.now(), req.project.id);
  logAudit('email_campaign_created', 'email_campaign', id, name, { by: req.user.id }, req.project.id);
  res.json({ id, name });
});

router.put('/:id', requirePermission('campaigns.edit'), (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM email_campaigns WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name, subject, body } = req.body;
  db.prepare('UPDATE email_campaigns SET name=?, subject=?, body=? WHERE id=?')
    .run(name ?? existing.name, subject ?? existing.subject, body ?? existing.body, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', requirePermission('campaigns.delete'), (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM email_campaigns WHERE id = ? AND project_id = ?').run(req.params.id, req.project.id);
  res.json({ ok: true });
});

router.post('/:id/leads', requirePermission('campaigns.edit'), (req, res) => {
  const db = getDB();
  const projectId = req.project.id;
  const { leadIds, count, force } = req.body;
  const c = db.prepare('SELECT * FROM email_campaigns WHERE id = ? AND project_id = ?').get(req.params.id, projectId);
  if (!c) return res.status(404).json({ error: 'Not found' });

  let leads;
  if (leadIds?.length) {
    leads = db.prepare(`SELECT * FROM leads WHERE project_id = ? AND id IN (${leadIds.map(() => '?').join(',')}) AND email != ''`).all(projectId, ...leadIds);
  } else {
    const n = count || 50;
    if (force) {
      leads = db.prepare("SELECT * FROM leads WHERE project_id = ? AND status = 'active' AND email != '' AND id NOT IN (SELECT lead_id FROM email_campaign_leads WHERE campaign_id = ?) LIMIT ?").all(projectId, req.params.id, n);
    } else {
      leads = db.prepare("SELECT * FROM leads WHERE project_id = ? AND status = 'active' AND verified = 1 AND email != '' AND id NOT IN (SELECT lead_id FROM email_campaign_leads) AND id NOT IN (SELECT lead_id FROM email_campaign_leads WHERE campaign_id = ?) LIMIT ?").all(projectId, req.params.id, n);
    }
  }

  const stmt = db.prepare('INSERT OR IGNORE INTO email_campaign_leads (lead_id, campaign_id) VALUES (?, ?)');
  let added = 0;
  for (const l of leads) {
    stmt.run(l.id, req.params.id);
    added++;
  }

  db.prepare('UPDATE email_campaigns SET total = (SELECT COUNT(*) FROM email_campaign_leads WHERE campaign_id = ?) WHERE id = ?').run(req.params.id, req.params.id);
  res.json({ added });
});

router.post('/:id/leads/:leadId', requirePermission('campaigns.edit'), (req, res) => {
  const db = getDB();
  if (!isOwned('email_campaigns', req.project.id, req.params.id)) return res.status(404).json({ error: 'Not found' });
  if (!isOwned('leads', req.project.id, req.params.leadId)) return res.status(404).json({ error: 'Lead not found' });
  db.prepare('INSERT OR IGNORE INTO email_campaign_leads (lead_id, campaign_id) VALUES (?, ?)').run(req.params.leadId, req.params.id);
  db.prepare('UPDATE email_campaigns SET total = (SELECT COUNT(*) FROM email_campaign_leads WHERE campaign_id = ?) WHERE id = ?').run(req.params.id, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id/leads/:leadId', requirePermission('campaigns.edit'), (req, res) => {
  const db = getDB();
  if (!isOwned('email_campaigns', req.project.id, req.params.id)) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM email_campaign_leads WHERE lead_id = ? AND campaign_id = ?').run(req.params.leadId, req.params.id);
  db.prepare('UPDATE email_campaigns SET total = (SELECT COUNT(*) FROM email_campaign_leads WHERE campaign_id = ?) WHERE id = ?').run(req.params.id, req.params.id);
  res.json({ ok: true });
});

export default router;
