import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { getDB, logAudit } from './db.js';
import { exportProject, restoreProject } from './lib/backup.js';
import leadsRouter from './routes/leads.js';
import stagesRouter from './routes/stages.js';
import campaignsRouter from './routes/campaigns.js';
import tagsRouter from './routes/tags.js';
import templatesRouter from './routes/templates.js';
import jobsRouter, { resumeAllProjectJobs } from './routes/jobs.js';
import settingsRouter from './routes/settings.js';
import authRouter, { authMiddleware, requirePermission, getUserFromToken, getUserById, parseCookies } from './routes/auth.js';
import accountsRouter from './routes/accounts.js';
import clientsRouter from './routes/clients.js';
import emailCampaignsRouter from './routes/emailCampaigns.js';
import gmapsRouter from './routes/gmaps.js';
import projectsRouter from './routes/projects.js';
import companiesRouter from './routes/companies.js';
import pipelinesRouter from './routes/pipelines.js';
import dealsRouter from './routes/deals.js';
import customFieldsRouter from './routes/customFields.js';
import { searchRouter, viewsRouter } from './routes/search.js';
import apiTokensRouter from './routes/apiTokens.js';
import mcpRouter from './mcp.js';
import setupRouter from './routes/setup.js';
import inboxRouter from './routes/inbox.js';
import filesRouter from './routes/files.js';
import { initWaInbox, onInboxChange } from './lib/waInbox.js';
import { initWaGuard, setAutoConnect, autoConnectProjects } from './lib/waGuard.js';
import { resolveProject, canAccessProject } from './middleware/project.js';
import { adoptLegacyJobs, resumePendingJobs } from './gmaps/jobs.js';
import { startWorker, stopWorker } from './worker/index.js';
import { initClient, getStatus, onStatusChange, destroyClient, destroyAllClients, logoutClient, migrateLegacyAuth, hasSession } from './whatsapp.js';

import os from 'os';

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err?.message || err);
});

const shutdown = async () => {
  console.log('Shutting down, cleaning up WhatsApp...');
  stopWorker();
  try { await destroyAllClients(); } catch {}
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

initWaGuard();
initWaInbox();

const app = express();
const server = http.createServer(app);
// Browsers may only call the API from LeadDesk's own origin, plus any listed in CORS_ORIGINS (comma separated).
// A Vite dev server on localhost is allowed outside production.
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const originAllowed = (origin) => CORS_ORIGINS.includes(origin) || (process.env.NODE_ENV !== 'production' && LOCAL_ORIGIN.test(origin));
const io = new SocketIOServer(server, { cors: { origin: (origin, cb) => cb(null, !origin || originAllowed(origin)), credentials: true } });
const PORT = parseInt(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

app.use(cors((req, cb) => {
  const origin = req.headers.origin;
  let sameHost = false;
  try { sameHost = !!origin && new URL(origin).host === req.headers.host; } catch {}
  cb(null, { origin: sameHost || (!!origin && originAllowed(origin)), credentials: true });
}));
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  req.cookies = parseCookies(req.headers.cookie);
  next();
});

// ── Auth routes (no project scope) ──────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/setup', setupRouter);
app.use('/api/auth', authRouter);

// ── Project management (auth only, no project scope) ────────────
app.use('/api/projects', authMiddleware, projectsRouter);

// ── Accounts (global, auth only) ────────────────────────────────
app.use('/api/accounts', authMiddleware, accountsRouter);

// ── Personal access tokens + MCP endpoint (token auth, see mcp.js) ──
app.use('/api/tokens', authMiddleware, apiTokensRouter);
app.use('/mcp', mcpRouter);

// ── Global auth for everything else ─────────────────────────────
app.use('/api', authMiddleware);

// ── Project-scoped routers ──────────────────────────────────────
app.use('/api/leads', resolveProject, leadsRouter);
// Contacts are the same records as leads (see .agents/handoffs/PHASE-1-DESIGN.md)
app.use('/api/contacts', resolveProject, leadsRouter);
app.use('/api/companies', resolveProject, companiesRouter);
app.use('/api/pipelines', resolveProject, pipelinesRouter);
app.use('/api/deals', resolveProject, dealsRouter);
app.use('/api/custom-fields', resolveProject, customFieldsRouter);
app.use('/api/search', resolveProject, searchRouter);
app.use('/api/views', resolveProject, viewsRouter);
app.use('/api/stages', resolveProject, stagesRouter);
app.use('/api/campaigns', resolveProject, campaignsRouter);
app.use('/api/tags', resolveProject, tagsRouter);
app.use('/api/templates', resolveProject, templatesRouter);
app.use('/api/jobs', resolveProject, jobsRouter);
app.use('/api/settings', resolveProject, settingsRouter);
app.use('/api/clients', resolveProject, clientsRouter);
app.use('/api/email-campaigns', resolveProject, emailCampaignsRouter);
app.use('/api/gmaps', resolveProject, gmapsRouter);
app.use('/api/inbox', resolveProject, inboxRouter);
app.use('/api/files', resolveProject, filesRouter);

// ── Project-scoped inline routes ────────────────────────────────
app.get('/api/stats', resolveProject, requirePermission('dashboard.view', 'leads.view'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;

  const total = db.prepare("SELECT COUNT(*) as c FROM leads WHERE project_id = ? AND status = 'active'").get(pid).c;
  const verified = db.prepare('SELECT COUNT(*) as c FROM leads WHERE project_id = ? AND status = ? AND verified = ?').get(pid, 'active', 1).c;
  const unverified = total - verified;
  const dead = db.prepare('SELECT COUNT(*) as c FROM leads WHERE project_id = ? AND status = ?').get(pid, 'dead').c;
  const invalidPhone = db.prepare('SELECT COUNT(*) as c FROM leads WHERE project_id = ? AND status = ? AND phone_valid = ?').get(pid, 'active', 0).c;
  const inCampaign = db.prepare(`
    SELECT COUNT(DISTINCT l.id) as c FROM leads l
    INNER JOIN campaign_leads cl ON cl.lead_id = l.id
    WHERE l.project_id = ? AND l.status = ?
  `).get(pid, 'active').c;

  // Keys kept for saved dashboard configs: totalClients = customers, activeClients = qualified contacts
  const totalClients = db.prepare("SELECT COUNT(*) as c FROM leads WHERE project_id = ? AND status = 'active' AND lifecycle = 'customer'").get(pid).c;
  const activeClients = db.prepare("SELECT COUNT(*) as c FROM leads WHERE project_id = ? AND status = 'active' AND lifecycle = 'qualified'").get(pid).c;
  const openDealsRow = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(value), 0) as v FROM deals WHERE project_id = ? AND status = 'open'").get(pid);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const wonRow = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(value), 0) as v FROM deals WHERE project_id = ? AND status = 'won' AND won_at >= ?").get(pid, monthStart.getTime());

  const readyForOutreach = db.prepare(`
    SELECT COUNT(*) as c FROM leads
    WHERE project_id = ? AND status = 'active' AND verified = 1 AND phone_valid = 1
  `).get(pid).c;

  const verifiedNoTags = db.prepare(`
    SELECT COUNT(*) as c FROM leads
    WHERE project_id = ? AND status = 'active' AND verified = 1
    AND id NOT IN (SELECT lead_id FROM lead_tags)
  `).get(pid).c;

  const verifiedNoTagsNoCampaign = db.prepare(`
    SELECT COUNT(*) as c FROM leads
    WHERE project_id = ? AND status = 'active' AND verified = 1
    AND id NOT IN (SELECT lead_id FROM lead_tags)
    AND id NOT IN (SELECT lead_id FROM campaign_leads)
  `).get(pid).c;

  const totalCampaigns = db.prepare('SELECT COUNT(*) as c FROM campaigns WHERE project_id = ?').get(pid).c;
  const activeJobs = db.prepare("SELECT COUNT(*) as c FROM broadcast_jobs WHERE project_id = ? AND status IN ('pending', 'running')").get(pid).c;

  const stageBreakdown = db.prepare(`
    SELECT s.id, s.name, s.color,
      COUNT(l.id) as count,
      SUM(CASE WHEN l.verified = 1 THEN 1 ELSE 0 END) as verified_count,
      SUM(CASE WHEN l.verified = 0 THEN 1 ELSE 0 END) as unverified_count
    FROM stages s
    LEFT JOIN leads l ON l.stage_id = s.id AND l.status = 'active' AND l.project_id = s.project_id
    WHERE s.project_id = ?
    GROUP BY s.id ORDER BY s.sort_order
  `).all(pid);

  const tagBreakdown = db.prepare(`
    SELECT t.id, t.name, t.color,
      COUNT(lt.lead_id) as total,
      SUM(CASE WHEN l.verified = 1 THEN 1 ELSE 0 END) as verified_count,
      SUM(CASE WHEN l.verified = 0 OR l.verified IS NULL THEN 1 ELSE 0 END) as unverified_count
    FROM tags t
    LEFT JOIN lead_tags lt ON lt.tag_id = t.id
    LEFT JOIN leads l ON l.id = lt.lead_id AND l.status = 'active'
    WHERE t.project_id = ? AND t.show_in_dashboard = 1
    GROUP BY t.id ORDER BY t.name
  `).all(pid);

  const recentImports = db.prepare(`
    SELECT * FROM import_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 10
  `).all(pid);

  const recentActivity = db.prepare(`
    SELECT * FROM audit_log WHERE project_id = ? ORDER BY created_at DESC LIMIT 20
  `).all(pid);

  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const outreach = {
    ...db.prepare(`SELECT COUNT(DISTINCT COALESCE(job_lead_id, id)) AS sent,
      COUNT(DISTINCT CASE WHEN delivered_at IS NOT NULL THEN COALESCE(job_lead_id, id) END) AS delivered,
      COUNT(DISTINCT CASE WHEN replied_at IS NOT NULL THEN phone END) AS replied
      FROM wa_sends WHERE project_id = ? AND legacy = 0 AND sent_at > ?`).get(pid, since),
    running: db.prepare("SELECT COUNT(*) AS n FROM broadcast_jobs WHERE project_id = ? AND status IN ('running', 'pending')").get(pid).n,
    scheduled: db.prepare("SELECT COUNT(*) AS n FROM broadcast_jobs WHERE project_id = ? AND status = 'scheduled'").get(pid).n,
  };

  res.json({
    outreach,
    total, verified, unverified, dead, invalidPhone, inCampaign,
    readyForOutreach, verifiedNoTags, verifiedNoTagsNoCampaign,
    totalClients, activeClients, totalCampaigns, activeJobs,
    openDeals: openDealsRow.c, openDealValue: openDealsRow.v, wonDealsThisMonth: wonRow.c, wonValueThisMonth: wonRow.v,
    verifiedPercent: total > 0 ? Math.round((verified / total) * 100) : 0,
    stageBreakdown,
    tagBreakdown,
    recentImports,
    recentActivity,
    metrics: [
      { key: 'total', label: 'Total Leads', type: 'stat' },
      { key: 'verified', label: 'Verified Leads', type: 'stat' },
      { key: 'unverified', label: 'Unverified Leads', type: 'stat' },
      { key: 'dead', label: 'Dead Leads', type: 'stat' },
      { key: 'invalidPhone', label: 'Invalid Phone', type: 'stat' },
      { key: 'inCampaign', label: 'In Campaign', type: 'stat' },
      { key: 'readyForOutreach', label: 'Ready for Outreach', type: 'stat' },
      { key: 'verifiedNoTags', label: 'Verified, No Tags', type: 'stat' },
      { key: 'verifiedNoTagsNoCampaign', label: 'Verified, No Tags & Campaign', type: 'stat' },
      { key: 'totalClients', label: 'Customers', type: 'stat' },
      { key: 'activeClients', label: 'Qualified contacts', type: 'stat' },
      { key: 'openDeals', label: 'Open deals', type: 'stat' },
      { key: 'openDealValue', label: 'Open pipeline value', type: 'stat' },
      { key: 'wonDealsThisMonth', label: 'Deals won this month', type: 'stat' },
      { key: 'wonValueThisMonth', label: 'Revenue won this month', type: 'stat' },
      { key: 'totalCampaigns', label: 'Total Campaigns', type: 'stat' },
      { key: 'activeJobs', label: 'Active Broadcast Jobs', type: 'stat' },
      ...stageBreakdown.map(s => ({ key: `stage:${s.id}`, label: `Stage: ${s.name}`, type: 'stage', stageId: s.id, color: s.color })),
      ...tagBreakdown.map(t => ({ key: `tag:${t.id}`, label: `Tag: ${t.name}`, type: 'tag', tagId: t.id, color: t.color })),
    ],
  });
});

app.get('/api/import-logs', resolveProject, requirePermission('leads.import', 'dashboard.view'), (req, res) => {
  const db = getDB();
  const logs = db.prepare('SELECT * FROM import_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50').all(req.project.id);
  res.json(logs);
});

app.get('/api/audit-log', resolveProject, requirePermission('settings.view', 'dashboard.view'), (req, res) => {
  const db = getDB();
  const { limit } = req.query;
  const logs = db.prepare('SELECT * FROM audit_log WHERE project_id = ? ORDER BY created_at DESC LIMIT ?').all(req.project.id, parseInt(limit) || 100);
  res.json(logs);
});

app.get('/api/export', resolveProject, requirePermission('settings.edit'), (req, res) => {
  res.json(exportProject(getDB(), req.project.id));
});

app.post('/api/import/backup', resolveProject, requirePermission('settings.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  if (!req.body || !Array.isArray(req.body.leads)) return res.status(400).json({ error: 'Invalid backup file' });
  let counts;
  try {
    counts = db.transaction(() => restoreProject(db, pid, req.body))();
  } catch (err) {
    return res.status(400).json({ error: 'Restore failed, nothing was changed: ' + err.message });
  }
  logAudit('restore', 'project', pid, req.project.name, counts, pid);
  res.json({ ok: true, ...counts });
});

// CSV export
app.get('/api/export/csv', resolveProject, requirePermission('leads.view'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const leads = db.prepare("SELECT * FROM leads WHERE project_id = ? AND status = 'active' ORDER BY created_at ASC").all(pid);
  const header = 'Name,Phone,Phone Valid,Email,Facebook,Instagram,TikTok,Link,Location,Notes,Verified,Stage,Campaigns';
  const rows = leads.map(l => {
    const campNames = db.prepare('SELECT c.name FROM campaigns c INNER JOIN campaign_leads cl ON cl.campaign_id = c.id WHERE cl.lead_id = ?').all(l.id).map(c => c.name).join('; ');
    const stage = db.prepare('SELECT name FROM stages WHERE id = ?').get(l.stage_id);
    return [
      csvEscape(l.name),
      phoneCsv(l.phone),
      l.phone_valid ? 'Yes' : 'No',
      csvEscape(l.email),
      csvEscape(l.facebook),
      csvEscape(l.instagram),
      csvEscape(l.tiktok),
      csvEscape(l.link),
      csvEscape(l.location),
      csvEscape(l.notes),
      l.verified ? 'Verified' : 'Unverified',
      csvEscape(stage?.name || ''),
      csvEscape(campNames),
    ].join(',');
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leaddesk-export-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('\uFEFF' + header + '\n' + rows.join('\n'));
});

function csvEscape(v) {
  if (!v) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function phoneCsv(v) {
  if (!v) return '';
  return '="' + String(v).replace(/"/g, '""') + '"';
}

// ── Socket.IO — WhatsApp events (per-project rooms) ─────────────
// WhatsApp status (it can carry the QR code that links a phone) only goes to people allowed to see it right now:
// sockets keep their room when someone loses access, so every send re-checks against the database.
const canSeeWhatsApp = (accountId, projectId) => {
  const user = getUserById(accountId);
  return !!user && !!canAccessProject(user, projectId) && (user.role === 'admin' || ['whatsapp.view', 'whatsapp.control'].some(p => user.permissions.includes(p)));
};

async function emitToWhatsAppViewers(projectId, event, payload) {
  const room = 'project:' + projectId;
  for (const s of await io.in(room).fetchSockets()) {
    if (canSeeWhatsApp(s.data.user.id, projectId)) s.emit(event, payload);
    else s.leave(room);
  }
}
const emitWaStatus = (projectId) => emitToWhatsAppViewers(projectId, 'wa_status', { projectId, ...getStatus(projectId) });

const waStatusUnsubscribe = onStatusChange((projectId) => { emitWaStatus(projectId).catch(() => {}); });
// Only says which chat changed; message text is fetched over the API, which checks permissions
onInboxChange((projectId, chatId) => { emitToWhatsAppViewers(projectId, 'wa_inbox', { projectId, chatId }).catch(() => {}); });

// Sockets use the same session cookie as HTTP; every event re-checks project access.
io.use((socket, next) => {
  const user = getUserFromToken(parseCookies(socket.handshake.headers.cookie).lead_session);
  if (!user) return next(new Error('Not authenticated'));
  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  // Read the account on every event: a permission removed while connected must stop working at once
  const me = () => getUserById(socket.data.user.id);
  const allowed = (projectId) => !!canAccessProject(me(), projectId);
  const canControl = () => {
    const u = me();
    return !!u && (u.role === 'admin' || u.permissions.includes('whatsapp.control'));
  };

  // Client joins a project room to receive its WA status
  socket.on('join_project', (projectId) => {
    if (!canSeeWhatsApp(socket.data.user.id, projectId)) return;
    socket.join('project:' + projectId);
    socket.emit('wa_status', { projectId, ...getStatus(projectId) });
  });

  socket.on('leave_project', (projectId) => {
    if (!projectId) return;
    socket.leave('project:' + projectId);
  });

  socket.on('wa_init', async ({ projectId } = {}) => {
    if (!allowed(projectId) || !canControl()) return;
    await initClient(projectId).catch(err => console.error('[wa] init failed:', err.message));
    await emitWaStatus(projectId);
  });

  socket.on('wa_disconnect', async ({ projectId } = {}) => {
    if (!allowed(projectId) || !canControl()) return;
    setAutoConnect(projectId, false);
    await destroyClient(projectId);
    await emitWaStatus(projectId);
  });

  socket.on('wa_logout', async ({ projectId } = {}) => {
    if (!allowed(projectId) || !canControl()) return;
    await logoutClient(projectId);
    await emitWaStatus(projectId);
  });
});

// JSON errors for API routes (async handlers must use lib/async.js wrap() to reach this)
app.use('/api', (err, req, res, next) => {
  console.error(`[api] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Serve static in production
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicPath = join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(join(publicPath, 'index.html'));
    }
  });
}

// Opens the database and runs migrations. A failed migration must stop the server here: the boot code below swallows
// errors, which would leave a site that looks up but fails on every request.
getDB();

server.listen(PORT, HOST, () => {
  const ifaces = os.networkInterfaces();
  const addrs = [];
  Object.values(ifaces).forEach(ifs => {
    if (!ifs) return;
    ifs.forEach(iface => {
      if (iface.family === 'IPv4' && !iface.internal) addrs.push(iface.address);
    });
  });
  console.log(`\n  LeadDesk server running on:\n`);
  console.log(`    Local:   http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    addrs.forEach(ip => console.log(`    Network: http://${ip}:${PORT}`));
  } else {
    console.log(`    Host:    http://${HOST}:${PORT}`);
  }
  if (!addrs.length && HOST === '0.0.0.0') {
    console.log(`    Network: (use your machine's LAN IP)`);
  }
  console.log('');

  // Migrate legacy flat baileys_auth into Default project's dir
  try {
    const db = getDB();
    const def = db.prepare('SELECT id FROM projects ORDER BY created_at ASC LIMIT 1').get();
    if (def) {
      migrateLegacyAuth(def.id);
      adoptLegacyJobs(def.id);
    }
  } catch {}

  // Resume any pending broadcast jobs (per project, lazily)
  setTimeout(() => {
    // Reconnect first: scheduled broadcasts would otherwise wait for someone to press Connect after a reboot
    try {
      for (const projectId of autoConnectProjects()) {
        if (hasSession(projectId)) initClient(projectId).catch(err => console.error(`[wa:${projectId}] Reconnect failed: ${err.message}`));
      }
    } catch (err) { console.error('[wa] Auto-connect failed:', err.message); }
    try { resumeAllProjectJobs(); } catch {}
    resumePendingJobs().catch(() => {});
  }, 3000);

  // Background job queue (reminders, email, sequences…). WORKER=off disables it, e.g. for a second instance.
  if (process.env.WORKER !== 'off') startWorker();

  // WhatsApp clients are now lazy-initialized per project (no global boot init)
  console.log('  WhatsApp: clients initialize per-project on demand.\n');
});
