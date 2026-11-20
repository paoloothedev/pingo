import { Router } from 'express';
import { requirePermission } from './auth.js';
import { getDB, logAudit } from '../db.js';
import { ownedIds, isOwned } from '../lib/scope.js';
import { listJobs } from './jobs.js';

const router = Router();

// Who can be pulled into a campaign: reachable contacts that haven't opted out and aren't marked as a bad target.
// Ordinary tags (industry, priority…) don't exclude anyone.
const REACHABLE = `l.project_id = ? AND l.status = 'active' AND l.phone_valid = 1 AND l.do_not_contact = 0
  AND l.id NOT IN (SELECT lt.lead_id FROM lead_tags lt INNER JOIN tags t ON t.id = lt.tag_id WHERE t.project_id = l.project_id AND t.name IN ('Not WhatsApp', 'MaybeClosed'))`;

// Contacts to pull into a campaign, by count and optional filters; verified only unless told otherwise.
function pickLeads(projectId, { count, verifiedOnly = true, tagId, stageId, category, force }, campaignId) {
  if (tagId && !isOwned('tags', projectId, tagId)) return { error: 'Tag not found' };
  if (stageId && !isOwned('stages', projectId, stageId)) return { error: 'Stage not found' };
  const args = [projectId];
  let sql = `SELECT l.id FROM leads l WHERE ${REACHABLE}`;
  if (force && campaignId) { sql += ' AND l.id NOT IN (SELECT lead_id FROM campaign_leads WHERE campaign_id = ?)'; args.push(campaignId); }
  else sql += ' AND l.id NOT IN (SELECT lead_id FROM campaign_leads)';
  if (verifiedOnly) sql += ' AND l.verified = 1';
  if (tagId) { sql += ' AND l.id IN (SELECT lead_id FROM lead_tags WHERE tag_id = ?)'; args.push(tagId); }
  if (stageId) { sql += ' AND l.stage_id = ?'; args.push(stageId); }
  if (category) { sql += ' AND l.category = ?'; args.push(category); }
  return { ids: getDB().prepare(sql + ' ORDER BY l.created_at ASC LIMIT ?').all(...args, parseInt(count) || 100).map(r => r.id) };
}

function leadsOf(campaignId) {
  const db = getDB();
  const getLeadTags = db.prepare('SELECT t.id, t.name, t.color FROM tags t INNER JOIN lead_tags lt ON lt.tag_id = t.id WHERE lt.lead_id = ?');
  return db.prepare('SELECT l.* FROM leads l INNER JOIN campaign_leads cl ON cl.lead_id = l.id WHERE cl.campaign_id = ?').all(campaignId)
    .map(l => ({ ...l, verified: !!l.verified, phone_valid: !!l.phone_valid, do_not_contact: !!l.do_not_contact, tags: getLeadTags.all(l.id) }));
}

// Latest outreach per contact across this campaign's broadcasts.
function outreachByLead(projectId, campaignId) {
  const rows = getDB().prepare(`SELECT jl.lead_id, jl.status, jl.error, jl.sent_at, jl.job_id, MAX(s.delivered_at) AS delivered_at, MAX(s.replied_at) AS replied_at
    FROM job_leads jl
    INNER JOIN broadcast_jobs j ON j.id = jl.job_id AND j.project_id = ? AND j.campaign_id = ?
    LEFT JOIN wa_sends s ON s.job_lead_id = jl.id AND s.project_id = ?
    GROUP BY jl.id ORDER BY j.created_at ASC, jl.id ASC`).all(projectId, campaignId, projectId);
  return new Map(rows.map(r => [r.lead_id, r]));
}

function summarize(outreach) {
  const list = [...outreach.values()];
  return {
    sent: list.filter(o => o.status === 'sent').length,
    delivered: list.filter(o => o.delivered_at).length,
    replied: list.filter(o => o.replied_at).length,
    failed: list.filter(o => o.status === 'failed').length,
    skipped: list.filter(o => o.status === 'skipped').length,
    pending: list.filter(o => o.status === 'pending').length,
  };
}

router.get('/', requirePermission('campaigns.view'), (req, res) => {
  const db = getDB();
  const projectId = req.project.id;
  const counts = db.prepare(`SELECT COUNT(*) AS lead_count, COALESCE(SUM(l.verified), 0) AS verified_count FROM campaign_leads cl
    INNER JOIN leads l ON l.id = cl.lead_id WHERE cl.campaign_id = ?`);
  const jobCount = db.prepare('SELECT COUNT(*) AS n FROM broadcast_jobs WHERE project_id = ? AND campaign_id = ?');
  res.json(db.prepare('SELECT * FROM campaigns WHERE project_id = ? ORDER BY created_at DESC').all(projectId).map(c => ({
    ...c, ...counts.get(c.id), broadcast_count: jobCount.get(projectId, c.id).n, ...summarize(outreachByLead(projectId, c.id)),
  })));
});

router.post('/', requirePermission('campaigns.edit'), (req, res) => {
  const db = getDB();
  const projectId = req.project.id;
  const { name, leadIds } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name required' });
  // A campaign can start empty: contacts are only pulled in when asked for
  let ids = [];
  if (Array.isArray(leadIds)) ids = ownedIds('leads', projectId, leadIds);
  else if (parseInt(req.body.count) > 0) {
    const picked = pickLeads(projectId, req.body);
    if (picked.error) return res.status(404).json({ error: picked.error });
    ids = picked.ids;
  }

  const id = 'camp_' + Math.random().toString(36).slice(2, 10);
  db.prepare('INSERT INTO campaigns (id, name, created_at, project_id) VALUES (?, ?, ?, ?)').run(id, String(name).trim(), Date.now(), projectId);
  const insertCL = db.prepare('INSERT OR IGNORE INTO campaign_leads (lead_id, campaign_id) VALUES (?, ?)');
  for (const leadId of ids) insertCL.run(leadId, id);

  logAudit('create', 'campaign', id, name, { leads: ids.length }, projectId);
  res.status(201).json({ ...db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id), leads: leadsOf(id) });
});

// Everything about one campaign: contacts with their outreach status, and the broadcasts sent to it.
router.get('/:id', requirePermission('campaigns.view'), (req, res) => {
  const projectId = req.project.id;
  const campaign = getDB().prepare('SELECT * FROM campaigns WHERE id = ? AND project_id = ?').get(req.params.id, projectId);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  const outreach = outreachByLead(projectId, campaign.id);
  const leads = leadsOf(campaign.id).map(l => ({ ...l, outreach: outreach.get(l.id) || null }));
  res.json({
    ...campaign, leads, lead_count: leads.length, verified_count: leads.filter(l => l.verified).length,
    ...summarize(outreach), broadcasts: listJobs(projectId, campaign.id),
  });
});

router.put('/:id', requirePermission('campaigns.edit'), (req, res) => {
  const db = getDB();
  const camp = db.prepare('SELECT * FROM campaigns WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  if (!camp) return res.status(404).json({ error: 'Campaign not found' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  db.prepare('UPDATE campaigns SET name = ? WHERE id = ?').run(name, camp.id);
  logAudit('edit', 'campaign', camp.id, name, { from: camp.name }, req.project.id);
  res.json({ ...camp, name });
});

router.delete('/:id', requirePermission('campaigns.delete'), (req, res) => {
  const db = getDB();
  const camp = db.prepare('SELECT name FROM campaigns WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  if (!camp) return res.status(404).json({ error: 'Campaign not found' });
  db.prepare('DELETE FROM campaign_leads WHERE campaign_id = ?').run(req.params.id);
  db.prepare('DELETE FROM campaigns WHERE id = ? AND project_id = ?').run(req.params.id, req.project.id);
  logAudit('delete', 'campaign', req.params.id, camp.name, {}, req.project.id);
  res.json({ ok: true });
});

// Add leads to existing campaign
router.post('/:id/leads', requirePermission('campaigns.edit'), (req, res) => {
  const db = getDB();
  const projectId = req.project.id;
  const { leadIds, count } = req.body;
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND project_id = ?').get(req.params.id, projectId);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  let ids = leadIds ? ownedIds('leads', projectId, leadIds) : null;

  if (!ids && count) {
    const picked = pickLeads(projectId, req.body, req.params.id);
    if (picked.error) return res.status(404).json({ error: picked.error });
    ids = picked.ids;
    if (!ids.length) return res.status(400).json({ error: 'No eligible leads available.' });
  }

  if (!ids || !ids.length) return res.status(400).json({ error: 'No leadIds' });

  const insert = db.prepare('INSERT OR IGNORE INTO campaign_leads (lead_id, campaign_id) VALUES (?, ?)');
  for (const lid of ids) insert.run(lid, req.params.id);

  logAudit('add_leads', 'campaign', req.params.id, campaign.name, { count: ids.length, leadIds: ids }, projectId);
  res.json({ ...campaign, leads: leadsOf(req.params.id), added: ids.length });
});

// Remove a specific lead from a campaign
router.delete('/:id/leads/:leadId', requirePermission('campaigns.edit'), (req, res) => {
  const db = getDB();
  const { id, leadId } = req.params;
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND project_id = ?').get(id, req.project.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  const lead = db.prepare('SELECT name FROM leads WHERE id = ? AND project_id = ?').get(leadId, req.project.id);
  db.prepare('DELETE FROM campaign_leads WHERE campaign_id = ? AND lead_id = ?').run(id, leadId);
  logAudit('remove_lead', 'campaign', id, campaign.name, { leadId, leadName: lead?.name }, req.project.id);
  res.json({ ok: true });
});

// Get eligible leads for adding to a campaign
router.get('/:id/eligible', requirePermission('campaigns.view'), (req, res) => {
  const db = getDB();
  const projectId = req.project.id;
  const { force } = req.query;
  if (!isOwned('campaigns', projectId, req.params.id)) return res.status(404).json({ error: 'Campaign not found' });

  const normal = db.prepare(`SELECT l.id, l.name, l.phone FROM leads l WHERE ${REACHABLE} AND l.verified = 1
    AND l.id NOT IN (SELECT lead_id FROM campaign_leads) ORDER BY l.created_at ASC`).all(projectId);

  const usedElsewhere = force ? db.prepare(`SELECT DISTINCT l.id, l.name, l.phone FROM leads l
    INNER JOIN campaign_leads cl ON cl.lead_id = l.id
    WHERE ${REACHABLE} AND l.verified = 1 AND l.id NOT IN (SELECT lead_id FROM campaign_leads WHERE campaign_id = ?)
    ORDER BY l.created_at ASC`).all(projectId, req.params.id) : [];

  res.json({ normal, usedElsewhere });
});

export default router;
