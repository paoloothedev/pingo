import { Router } from 'express';
import { getDB, logAudit, createProject, seedStagesForProject } from '../db.js';
import { authMiddleware, requirePermission } from './auth.js';
import { canAccessProject } from '../middleware/project.js';
import { copySetup } from '../lib/workspaceTemplate.js';
import { removeProjectAuth } from '../whatsapp.js';
import { removeInboxMedia } from '../lib/waInbox.js';

const router = Router();
router.use(authMiddleware);

// List the projects this user can access, with quick stats
router.get('/', (req, res) => {
  const db = getDB();
  const projects = req.user.role === 'admin'
    ? db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all()
    : db.prepare(`
        SELECT p.* FROM projects p
        INNER JOIN project_members m ON m.project_id = p.id AND m.account_id = ?
        ORDER BY p.created_at DESC
      `).all(req.user.id);
  const leadCount = db.prepare("SELECT COUNT(*) as c FROM leads WHERE project_id = ? AND status = 'active'");
  const clientCount = db.prepare("SELECT COUNT(*) as c FROM leads WHERE project_id = ? AND status = 'active' AND lifecycle = 'customer'");
  const campaignCount = db.prepare('SELECT COUNT(*) as c FROM campaigns WHERE project_id = ?');
  const tagCount = db.prepare('SELECT COUNT(*) as c FROM tags WHERE project_id = ?');

  const enriched = projects.map(p => ({
    ...p,
    leadCount: leadCount.get(p.id).c,
    clientCount: clientCount.get(p.id).c,
    campaignCount: campaignCount.get(p.id).c,
    tagCount: tagCount.get(p.id).c,
  }));
  res.json(enriched);
});

// People who can be assigned records in a workspace (owner pickers): admins + members.
router.get('/:id/members', (req, res) => {
  const db = getDB();
  if (!canAccessProject(req.user, req.params.id)) return res.status(404).json({ error: 'Not found' });
  const rows = db.prepare(`
    SELECT id, username, display_name, role FROM accounts
    WHERE role = 'admin' OR id IN (SELECT account_id FROM project_members WHERE project_id = ?)
    ORDER BY display_name, username
  `).all(req.params.id);
  res.json(rows);
});

// Create project
router.post('/', requirePermission('projects.manage'), (req, res) => {
  const { name, color, icon } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const { templateFrom } = req.body;
  if (templateFrom && !canAccessProject(req.user, templateFrom)) return res.status(400).json({ error: 'Template workspace not found' });
  const db = getDB();
  let copied = null;
  const project = db.transaction(() => {
    const p = createProject(name.trim(), color, icon, req.user.id);
    if (req.user.role !== 'admin') {
      db.prepare('INSERT OR IGNORE INTO project_members (project_id, account_id, created_at) VALUES (?, ?, ?)').run(p.id, req.user.id, Date.now());
    }
    if (templateFrom) copied = copySetup(db, templateFrom, p.id);
    return p;
  })();
  if (copied) project.copiedFrom = { id: templateFrom, ...copied };
  logAudit('create', 'project', project.id, project.name, { by: req.user.id }, project.id);
  res.status(201).json(project);
});

// Update project
router.put('/:id', requirePermission('settings.edit', 'projects.manage'), (req, res) => {
  const db = getDB();
  const existing = canAccessProject(req.user, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name, color, icon } = req.body;
  db.prepare('UPDATE projects SET name = ?, color = ?, icon = ? WHERE id = ?').run(
    name ?? existing.name,
    color ?? existing.color,
    icon ?? existing.icon,
    req.params.id
  );
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  logAudit('edit', 'project', project.id, project.name, { changes: req.body }, project.id);
  res.json(project);
});

// Delete project + all its data
router.delete('/:id', requirePermission('projects.manage'), (req, res) => {
  const db = getDB();
  const id = req.params.id;
  const project = canAccessProject(req.user, id);
  if (!project) return res.status(404).json({ error: 'Not found' });

  const txn = db.transaction(() => {
    // Child tables first (respect FK order)
    db.prepare('DELETE FROM lead_tags WHERE lead_id IN (SELECT id FROM leads WHERE project_id = ?)').run(id);
    db.prepare('DELETE FROM stage_history WHERE lead_id IN (SELECT id FROM leads WHERE project_id = ?)').run(id);
    db.prepare('DELETE FROM campaign_leads WHERE campaign_id IN (SELECT id FROM campaigns WHERE project_id = ?)').run(id);
    db.prepare('DELETE FROM job_leads WHERE job_id IN (SELECT id FROM broadcast_jobs WHERE project_id = ?)').run(id);
    db.prepare('DELETE FROM client_tags WHERE client_id IN (SELECT id FROM clients WHERE project_id = ?)').run(id);
    db.prepare('DELETE FROM client_activities WHERE client_id IN (SELECT id FROM clients WHERE project_id = ?)').run(id);
    db.prepare('DELETE FROM email_campaign_leads WHERE campaign_id IN (SELECT id FROM email_campaigns WHERE project_id = ?)').run(id);
    // Top-level scoped tables
    db.prepare('DELETE FROM leads WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM campaigns WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM stages WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM tags WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM message_templates WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM broadcast_jobs WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM clients WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM email_campaigns WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM settings WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM import_logs WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM audit_log WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM project_members WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM queue WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM wa_daily_counts WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM wa_number WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM wa_numbers WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM wa_sends WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM wa_events WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM wa_inbox_messages WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM wa_inbox_chats WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM companies WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM deal_stage_history WHERE deal_id IN (SELECT id FROM deals WHERE project_id = ?)').run(id);
    db.prepare('DELETE FROM deals WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM pipeline_stages WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM pipelines WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM custom_fields WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM saved_views WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM duplicate_dismissals WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM files WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  });

  try {
    txn();
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete project: ' + err.message });
  }

  removeProjectAuth(id).catch(() => {});
  removeInboxMedia(id);

  logAudit('delete', 'project', id, project.name, { by: req.user.id }, null);
  res.json({ ok: true });
});

export default router;
