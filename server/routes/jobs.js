import { Router } from 'express';
import { requirePermission } from './auth.js';
import { getDB, logAudit } from '../db.js';
import { ownedIds } from '../lib/scope.js';
import { sendHumanMessage, getStatus, isOnWhatsApp } from '../whatsapp.js';
import { recordOutbound } from '../lib/waInbox.js';
import {
  gate, contactCheck, recordSent, sameTextCount, checkRates, addHealthEvent, getLimits, saveLimits, getNumber,
  healthStatus, counts, setWarmupStart, dismissAlert, digits, isNewChat, listNumbers,
} from '../lib/waGuard.js';
import {
  checkFirstMessage, withOptOut, meanSimilarity, parseSpintax, gaussianBetween, uniformBetween, estimateDuration,
  DEFAULT_LIMITS, HARD_LIMITS,
} from '../lib/waRules.js';

// Broadcast runner. Every send goes through lib/waGuard.js (anti-ban limits, warm-up, health score, recipient
// sending window, contact cadence). When a limit is hit the job keeps status 'running' with wait_reason/resume_at
// and resumes by itself; only an account restriction or a user action pauses it.
// Scheduled jobs (migration 014) have status 'scheduled' and start when scheduled_at is due.
const router = Router();

// Broadcasts with their campaign's name and how many contacts got and answered the message.
export function listJobs(projectId, campaignId, jobId) {
  const where = [campaignId && 'j.campaign_id = ?', jobId && 'j.id = ?'].filter(Boolean).map(w => ` AND ${w}`).join('');
  return getDB().prepare(`SELECT j.*, c.name AS campaign_name, COALESCE(s.delivered, 0) AS delivered, COALESCE(s.replied, 0) AS replied
    FROM broadcast_jobs j
    LEFT JOIN campaigns c ON c.id = j.campaign_id AND c.project_id = j.project_id
    LEFT JOIN (SELECT job_id, COUNT(DISTINCT CASE WHEN delivered_at IS NOT NULL THEN COALESCE(job_lead_id, id) END) AS delivered,
        COUNT(DISTINCT CASE WHEN replied_at IS NOT NULL THEN COALESCE(job_lead_id, id) END) AS replied
      FROM wa_sends WHERE project_id = ? AND job_id IS NOT NULL GROUP BY job_id) s ON s.job_id = j.id
    WHERE j.project_id = ?${where} ORDER BY j.created_at DESC`)
    .all(projectId, projectId, ...[campaignId, jobId].filter(Boolean));
}

const MAX_CONSECUTIVE_FAILS = 3;
const MAX_TIMER_MS = 6 * 60 * 60 * 1000; // re-check at least every 6 h even during long waits

// projectId -> job queue state
const projectStates = new Map();

function getState(projectId) {
  if (!projectStates.has(projectId)) {
    projectStates.set(projectId, {
      projectId,
      processorTimer: null,
      timerDue: null,
      processingJobId: null,
      consecutiveFails: 0,
    });
  }
  return projectStates.get(projectId);
}

// Legacy per-day counter (migration 005); kept up to date for old reports, limits now come from wa_sends.
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function countSent(projectId) {
  getDB().prepare(`
    INSERT INTO wa_daily_counts (project_id, day, sent) VALUES (?, ?, 1)
    ON CONFLICT(project_id, day) DO UPDATE SET sent = sent + 1
  `).run(projectId, today());
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function parseMessages(messageStr) {
  try {
    const parsed = JSON.parse(messageStr);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return [messageStr];
}

function replaceVariables(text, lead) {
  if (!text || !lead) return text;
  return text
    .replace(/\{\{name\}\}/gi, lead.name || '')
    .replace(/\{\{phone\}\}/gi, lead.phone || '')
    .replace(/\{\{email\}\}/gi, lead.email || '')
    .replace(/\{\{notes\}\}/gi, lead.notes || '')
    .replace(/\{\{location\}\}/gi, lead.location || '')
    .replace(/\{\{facebook\}\}/gi, lead.facebook || '')
    .replace(/\{\{instagram\}\}/gi, lead.instagram || '')
    .replace(/\{\{tiktok\}\}/gi, lead.tiktok || '')
    .replace(/\{\{message\}\}/gi, lead.message || '');
}

const render = (template, lead) => parseSpintax(replaceVariables(template, lead));

// Checks a broadcast before it is created: who can be messaged, content rules for first messages, variation,
// and how long it will take. `problems` block creation; `skipped` contacts are recorded but never messaged.
function planJob(projectId, leadIds, messages, startAt = Date.now()) {
  const db = getDB();
  const limits = getLimits(projectId);
  const getLead = db.prepare('SELECT * FROM leads WHERE id = ? AND project_id = ?');
  const seen = new Set();
  const eligible = [], skipped = [];
  for (const id of leadIds) {
    const lead = getLead.get(id, projectId);
    if (!lead) continue;
    const phone = digits(lead.phone);
    if (!phone) { skipped.push({ lead, reason: 'No phone' }); continue; }
    if (seen.has(phone)) { skipped.push({ lead, reason: 'Duplicate number in this broadcast' }); continue; }
    seen.add(phone);
    const cc = contactCheck(projectId, { leadId: lead.id, phone });
    if (!cc.ok && cc.code !== 'contact_today') { skipped.push({ lead, reason: cc.reason }); continue; }
    eligible.push({ lead, phone, newChat: isNewChat(projectId, phone) });
  }

  const problems = [];
  const firstNew = eligible.filter(e => e.newChat).map(e => render(messages[0], e.lead));
  const byCode = new Map();
  for (const text of firstNew) {
    for (const p of checkFirstMessage(text, limits)) {
      const cur = byCode.get(p.code) || { ...p, count: 0 };
      cur.count++;
      byCode.set(p.code, cur);
    }
  }
  problems.push(...byCode.values());

  const rendered = eligible.map(e => render(messages[0], e.lead));
  const sim = rendered.length >= 4 ? meanSimilarity(rendered) : 0;
  if (sim > limits.maxSimilarity) {
    problems.push({
      code: 'similar', count: rendered.length,
      message: `Messages are ${Math.round(sim * 100)}% alike (max ${Math.round(limits.maxSimilarity * 100)}%). Personalise them: use {{message}} (a message written per contact), more variables, or spintax like {Hi|Hello|Good morning}.`,
    });
  }

  const newChats = eligible.filter(e => e.newChat).length;
  const estimate = estimateDuration({
    newChats, followUps: eligible.length - newChats, partsPerTouch: messages.length,
    number: getNumber(projectId), limits, now: startAt,
    newChatsToday: new Date(startAt).toDateString() === new Date().toDateString() ? counts(projectId).newChatsToday : 0,
  });
  return { limits, eligible, skipped, problems, similarity: sim, newChats, followUps: eligible.length - newChats, estimate };
}

const planSummary = (plan) => ({
  problems: plan.problems,
  eligible: plan.eligible.length,
  new_chats: plan.newChats,
  follow_ups: plan.followUps,
  skipped: plan.skipped.map(s => ({ id: s.lead.id, name: s.lead.name, reason: s.reason })),
  similarity: Math.round(plan.similarity * 100) / 100,
  estimate: plan.estimate,
});

function readBody(req, res) {
  const { message, leads } = req.body;
  if (!message || !leads || !leads.length) { res.status(400).json({ error: 'Message and leads required' }); return null; }
  // Only this project's leads; phone always comes from the DB, never from the request
  const ids = ownedIds('leads', req.project.id, leads.map(l => l?.id));
  if (!ids.length) { res.status(400).json({ error: 'No valid leads' }); return null; }
  const messages = parseMessages(message).map(String).filter(m => m.trim());
  if (!messages.length) { res.status(400).json({ error: 'Message and leads required' }); return null; }
  let scheduledAt = null;
  if (req.body.scheduledAt !== undefined && req.body.scheduledAt !== null && req.body.scheduledAt !== '') {
    scheduledAt = Number(req.body.scheduledAt);
    const now = Date.now();
    if (!Number.isFinite(scheduledAt) || scheduledAt < now - 60000 || scheduledAt > now + 365 * 24 * 3600 * 1000) {
      res.status(400).json({ error: 'scheduledAt must be a time within the next year' }); return null;
    }
    if (scheduledAt <= now) scheduledAt = null;
  }
  return { ids, messages, scheduledAt };
}

// Dry run: what POST / would do (problems, skipped contacts, estimated duration). Sends nothing.
router.post('/estimate', requirePermission('campaigns.send'), (req, res) => {
  const body = readBody(req, res);
  if (!body) return;
  res.json(planSummary(planJob(req.project.id, body.ids, body.messages, body.scheduledAt || Date.now())));
});

router.post('/', requirePermission('campaigns.send'), (req, res) => {
  const db = getDB();
  const projectId = req.project.id;
  const body = readBody(req, res);
  if (!body) return;
  const { campaignId, name, message, delayMin, delayMax } = req.body;
  // A broadcast belongs to a campaign of this workspace, or to none
  const campaign = campaignId ? db.prepare('SELECT id, name FROM campaigns WHERE id = ? AND project_id = ?').get(campaignId, projectId) : null;
  if (campaignId && !campaign) return res.status(404).json({ error: 'Campaign not found' });
  const plan = planJob(projectId, body.ids, body.messages, body.scheduledAt || Date.now());
  if (plan.problems.length) {
    return res.status(422).json({ error: plan.problems.map(p => p.message).join(' '), ...planSummary(plan) });
  }
  if (!plan.eligible.length) {
    return res.status(400).json({ error: 'None of these contacts can be messaged.', ...planSummary(plan) });
  }

  const id = 'job_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  db.transaction(() => {
    db.prepare(`INSERT INTO broadcast_jobs (id, campaign_id, name, message, delay_min, delay_max, status, total, skipped, created_at, project_id, scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, campaign?.id || null, String(name || campaign?.name || '').trim().slice(0, 120) || null, message, delayMin || 1, delayMax || 5,
      body.scheduledAt ? 'scheduled' : 'pending', plan.eligible.length + plan.skipped.length, plan.skipped.length, now, projectId, body.scheduledAt);
    const insertLead = db.prepare('INSERT INTO job_leads (job_id, lead_id, phone, status, error) VALUES (?, ?, ?, ?, ?)');
    for (const e of plan.eligible) insertLead.run(id, e.lead.id, e.lead.phone || '', 'pending', null);
    for (const s of plan.skipped) insertLead.run(id, s.lead.id, s.lead.phone || '', 'skipped', s.reason);
  })();
  logAudit('create', 'broadcast_job', id, `${plan.eligible.length} contacts`, { by: req.user?.id, skipped: plan.skipped.length, scheduled_at: body.scheduledAt }, projectId);

  const job = db.prepare('SELECT * FROM broadcast_jobs WHERE id = ?').get(id);
  res.status(201).json({ ...job, ...planSummary(plan) });

  const state = getState(projectId);
  if (!state.processingJobId) processNextJob(projectId);
});

// Move a scheduled job to another time (or now).
router.put('/:id/schedule', requirePermission('broadcast.manage', 'campaigns.send'), (req, res) => {
  const db = getDB();
  const projectId = req.project.id;
  const job = db.prepare('SELECT * FROM broadcast_jobs WHERE id = ? AND project_id = ?').get(req.params.id, projectId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'scheduled') return res.status(400).json({ error: 'Job is not scheduled' });
  const at = Number(req.body?.scheduledAt);
  const now = Date.now();
  if (!Number.isFinite(at) || at > now + 365 * 24 * 3600 * 1000) return res.status(400).json({ error: 'scheduledAt must be a time within the next year' });
  db.prepare('UPDATE broadcast_jobs SET scheduled_at = ? WHERE id = ?').run(Math.max(at, now), job.id);
  logAudit('edit', 'broadcast_job', job.id, 'reschedule', { scheduled_at: at }, projectId);
  res.json(db.prepare('SELECT * FROM broadcast_jobs WHERE id = ?').get(job.id));
  if (!getState(projectId).processingJobId) processNextJob(projectId);
});

router.get('/', requirePermission('broadcast.view', 'campaigns.send'), (req, res) => {
  res.json(listJobs(req.project.id, req.query.campaign));
});

router.get('/daily-status', requirePermission('broadcast.view', 'campaigns.send'), (req, res) => {
  const h = healthStatus(req.project.id);
  const limit = h.today.new_chat_limit;
  res.json({
    sent: h.today.sent, new_chats: h.today.new_chats, limit, remaining: Math.max(0, limit - h.today.new_chats),
    last_hour: h.last_hour, hour_limit: h.hour_limit, health: h.score, level: h.level, paused_until: h.paused_until,
  });
});

// ── Anti-ban limits & number health ─────────────────────────────
router.get('/health', requirePermission('broadcast.view', 'campaigns.send', 'whatsapp.view'), (req, res) => {
  res.json(healthStatus(req.project.id));
});

router.get('/limits', requirePermission('broadcast.view', 'campaigns.send', 'whatsapp.view'), (req, res) => {
  res.json({ limits: getLimits(req.project.id), defaults: DEFAULT_LIMITS, bounds: HARD_LIMITS });
});

// Every number ever linked in this workspace (warm-up, health, what it sent).
router.get('/numbers', requirePermission('broadcast.view', 'campaigns.send', 'whatsapp.view'), (req, res) => {
  res.json(listNumbers(req.project.id));
});

router.put('/limits', requirePermission('broadcast.manage', 'settings.edit'), (req, res) => {
  const limits = saveLimits(req.project.id, req.body?.limits || req.body || {});
  logAudit('edit', 'wa_limits', req.project.id, 'WhatsApp limits', { limits }, req.project.id);
  res.json({ limits, defaults: DEFAULT_LIMITS, bounds: HARD_LIMITS });
});

// Tell the warm-up how old the number is (e.g. an established number connected for the first time here).
router.put('/health/warmup', requirePermission('broadcast.manage', 'settings.edit'), (req, res) => {
  const days = Number(req.body?.days_ago);
  if (!Number.isFinite(days) || days < 0 || days > 3650) return res.status(400).json({ error: 'days_ago must be 0–3650' });
  setWarmupStart(req.project.id, Date.now() - days * 24 * 60 * 60 * 1000);
  logAudit('edit', 'wa_warmup', req.project.id, 'WhatsApp warm-up', { days_ago: days }, req.project.id);
  res.json(healthStatus(req.project.id));
});

router.post('/health/dismiss-alert', requirePermission('broadcast.manage', 'settings.edit'), (req, res) => {
  dismissAlert(req.project.id);
  res.json(healthStatus(req.project.id));
});

router.get('/:id', requirePermission('broadcast.view', 'campaigns.send'), (req, res) => {
  const db = getDB();
  const job = db.prepare('SELECT * FROM broadcast_jobs WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  // One row per contact: what happened, and what was actually sent (older sends have no stored text)
  const leads = db.prepare(`SELECT jl.*, l.name AS lead_name, s.delivered_at, s.replied_at, s.text, s.sender_phone FROM job_leads jl
    LEFT JOIN leads l ON l.id = jl.lead_id AND l.project_id = ?
    LEFT JOIN (SELECT job_lead_id, MAX(delivered_at) AS delivered_at, MAX(replied_at) AS replied_at, GROUP_CONCAT(text, char(10) || char(10)) AS text, MAX(sender_phone) AS sender_phone
      FROM wa_sends WHERE job_id = ? AND project_id = ? GROUP BY job_lead_id) s ON s.job_lead_id = jl.id
    WHERE jl.job_id = ? ORDER BY jl.id ASC`).all(req.project.id, job.id, req.project.id, job.id);
  res.json({ ...listJobs(req.project.id, undefined, job.id)[0], leads });
});

router.post('/:id/pause', requirePermission('broadcast.manage'), (req, res) => {
  const db = getDB();
  const job = db.prepare('SELECT * FROM broadcast_jobs WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'running' && job.status !== 'pending') return res.status(400).json({ error: 'Job is not running' });
  db.prepare("UPDATE broadcast_jobs SET status = 'paused', wait_reason = NULL, resume_at = NULL WHERE id = ?").run(job.id);
  res.json({ ok: true });
});

router.post('/:id/resume', requirePermission('broadcast.manage'), (req, res) => {
  const db = getDB();
  const projectId = req.project.id;
  const job = db.prepare('SELECT * FROM broadcast_jobs WHERE id = ? AND project_id = ?').get(req.params.id, projectId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'paused') return res.status(400).json({ error: 'Job is not paused' });
  const state = getState(projectId);
  state.consecutiveFails = 0;
  db.prepare('UPDATE broadcast_jobs SET status = ? WHERE id = ?').run('pending', job.id);
  res.json({ ok: true });
  if (!state.processingJobId) processNextJob(projectId);
});

router.post('/:id/stop', requirePermission('broadcast.manage'), (req, res) => {
  const db = getDB();
  const projectId = req.project.id;
  const job = db.prepare('SELECT * FROM broadcast_jobs WHERE id = ? AND project_id = ?').get(req.params.id, projectId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!['running', 'paused', 'pending', 'scheduled'].includes(job.status)) return res.status(400).json({ error: 'Job is not active' });
  db.prepare("UPDATE broadcast_jobs SET status = 'stopped', completed_at = ?, wait_reason = NULL, resume_at = NULL WHERE id = ?").run(Date.now(), job.id);
  const state = getState(projectId);
  if (state.processingJobId === job.id) state.processingJobId = null;
  res.json({ ok: true });
});

router.delete('/:id', requirePermission('broadcast.manage'), (req, res) => {
  const db = getDB();
  const job = db.prepare('SELECT * FROM broadcast_jobs WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'running' || job.status === 'pending') {
    return res.status(400).json({ error: 'Cannot delete an active job' });
  }
  db.prepare('DELETE FROM job_leads WHERE job_id = ?').run(job.id);
  db.prepare('DELETE FROM broadcast_jobs WHERE id = ?').run(job.id);
  res.json({ ok: true });
});

function processNextJob(projectId) {
  const db = getDB();
  const state = getState(projectId);
  const now = Date.now();
  const job = db.prepare(`SELECT * FROM broadcast_jobs WHERE project_id = ?
    AND (status IN ('pending', 'running') OR (status = 'scheduled' AND scheduled_at <= ?))
    ORDER BY COALESCE(scheduled_at, created_at) ASC LIMIT 1`).get(projectId, now);
  if (!job) {
    state.processingJobId = null;
    const next = db.prepare("SELECT MIN(scheduled_at) AS t FROM broadcast_jobs WHERE project_id = ? AND status = 'scheduled'").get(projectId).t;
    if (next) scheduleProcessor(projectId, next - now);
    return;
  }
  if (job.status === 'scheduled') {
    db.prepare("UPDATE broadcast_jobs SET status = 'pending' WHERE id = ?").run(job.id);
    console.log(`[wa:${projectId}] Scheduled job ${job.id} is due`);
  }

  state.processingJobId = job.id;

  const waStatus = getStatus(projectId);
  if (!waStatus.ready) {
    setWait(job.id, 'WhatsApp not connected', Date.now() + 10000);
    state.processingJobId = null;
    scheduleProcessor(projectId, 10000);
    return;
  }

  db.prepare("UPDATE broadcast_jobs SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?").run(Date.now(), job.id);
  runJob(projectId, job.id).catch(err => {
    console.error(`[wa:${projectId}] Job ${job.id} crashed:`, err);
    state.processingJobId = null;
    scheduleProcessor(projectId, 60000);
  });
}

function setWait(jobId, reason, resumeAt) {
  getDB().prepare('UPDATE broadcast_jobs SET wait_reason = ?, resume_at = ? WHERE id = ?').run(reason, resumeAt, jobId);
}

function jobStatus(jobId) {
  return getDB().prepare('SELECT status FROM broadcast_jobs WHERE id = ?').get(jobId)?.status;
}

function markLead(jobLeadId, jobId, status, error = null) {
  const db = getDB();
  db.prepare('UPDATE job_leads SET status = ?, error = ?, sent_at = CASE WHEN ? = \'sent\' THEN ? ELSE sent_at END WHERE id = ?')
    .run(status, error, status, Date.now(), jobLeadId);
  const col = status === 'sent' ? 'sent' : status === 'skipped' ? 'skipped' : 'failed';
  db.prepare(`UPDATE broadcast_jobs SET ${col} = ${col} + 1 WHERE id = ?`).run(jobId);
}

// Stops the loop and re-runs the processor after `waitMs` (the job stays 'running').
function waitAndReschedule(projectId, jobId, reason, waitMs) {
  const state = getState(projectId);
  const ms = Math.max(1000, Math.min(waitMs, MAX_TIMER_MS));
  setWait(jobId, reason, Date.now() + waitMs);
  console.log(`[wa:${projectId}] ${reason} — waiting ${Math.round(waitMs / 1000)}s`);
  state.processingJobId = null;
  scheduleProcessor(projectId, ms);
}

async function runJob(projectId, jobId) {
  const db = getDB();
  const state = getState(projectId);
  const job = db.prepare('SELECT * FROM broadcast_jobs WHERE id = ?').get(jobId);
  if (!job || (job.status !== 'running' && job.status !== 'pending')) {
    state.processingJobId = null;
    return;
  }
  const messages = parseMessages(job.message);
  const leads = db.prepare("SELECT * FROM job_leads WHERE job_id = ? AND status = 'pending' ORDER BY id ASC").all(jobId);

  for (const jl of leads) {
    const st = jobStatus(jobId);
    if (st !== 'running') {
      if (st === 'stopped') db.prepare('UPDATE broadcast_jobs SET completed_at = COALESCE(completed_at, ?) WHERE id = ?').run(Date.now(), jobId);
      state.processingJobId = null;
      return;
    }
    if (!getStatus(projectId).ready) return waitAndReschedule(projectId, jobId, 'WhatsApp not connected', 10000);

    const phone = digits(jl.phone);
    if (!phone) { markLead(jl.id, jobId, 'failed', 'No phone'); continue; }

    const cc = contactCheck(projectId, { leadId: jl.lead_id, phone });
    if (!cc.ok) { markLead(jl.id, jobId, 'skipped', cc.reason); continue; }

    const g = gate(projectId, { phone, newChat: cc.newChat });
    if (!g.ok) return waitAndReschedule(projectId, jobId, g.reason, g.waitMs);
    setWait(jobId, null, null);
    const limits = g.limits;

    // Check the number exists before writing to it (no health penalty — it's our data, not WhatsApp pushing back)
    try {
      if (!(await isOnWhatsApp(projectId, phone))) {
        markLead(jl.id, jobId, 'failed', 'Not on WhatsApp');
        await sleep(uniformBetween(2000, 5000));
        continue;
      }
    } catch (err) {
      return waitAndReschedule(projectId, jobId, `WhatsApp check failed: ${err.message}`, 60000);
    }

    if (cc.newChat) await sleep(uniformBetween(limits.firstMessageExtraDelayMinSec, limits.firstMessageExtraDelayMaxSec) * 1000);

    const leadData = db.prepare('SELECT * FROM leads WHERE id = ?').get(jl.lead_id);
    let failed = null;
    for (let mi = 0; mi < messages.length; mi++) {
      if (jobStatus(jobId) !== 'running') { state.processingJobId = null; return; }
      if (mi > 0) {
        // Later parts of the same touch: respect per-minute/hour caps inline, ignore the new-chat cap
        for (let g2 = gate(projectId, { phone, newChat: false }); !g2.ok; g2 = gate(projectId, { phone, newChat: false })) {
          if (g2.waitMs > 10 * 60 * 1000) break;
          await sleep(g2.waitMs);
        }
      }

      let text = render(messages[mi], leadData);
      if (mi === 0 && cc.newChat) text = withOptOut(text, limits);
      for (let tries = 0; tries < 5 && sameTextCount(projectId, text) >= limits.maxSameTextCount; tries++) {
        text = render(messages[mi], leadData);
        if (mi === 0 && cc.newChat) text = withOptOut(text, limits);
      }
      if (sameTextCount(projectId, text) >= limits.maxSameTextCount) {
        failed = { status: 'skipped', error: `Identical text already sent ${limits.maxSameTextCount}× — add variation` };
        break;
      }

      try {
        const sent = await sendHumanMessage(projectId, phone, text, {
          typingMsPerChar: uniformBetween(limits.typingMsPerCharMin, limits.typingMsPerCharMax), spin: false,
        });
        recordSent({ projectId, phone, leadId: jl.lead_id, jobId, jobLeadId: jl.id, waMsgId: sent?.key?.id, text, newChat: cc.newChat });
        recordOutbound({ projectId, phone, leadId: jl.lead_id, waMsgId: sent?.key?.id, text, source: 'broadcast', jobId, senderPhone: getStatus(projectId).phone });
        countSent(projectId);
        state.consecutiveFails = 0;
        console.log(`[wa:${projectId}] Sent part ${mi + 1}/${messages.length} to ${phone}${cc.newChat ? ' (new chat)' : ''}`);
      } catch (err) {
        if (err.message.startsWith('Account restricted')) {
          markLead(jl.id, jobId, 'failed', 'Account restricted');
          db.prepare("UPDATE broadcast_jobs SET status = 'paused', wait_reason = 'Account restricted by WhatsApp', resume_at = NULL WHERE id = ?").run(jobId);
          state.processingJobId = null;
          console.log(`[wa:${projectId}] Account restricted — pausing job. ${err.message}`);
          return;
        }
        state.consecutiveFails++;
        addHealthEvent(projectId, 'send_failed', `${phone}: ${err.message}`);
        console.log(`[wa:${projectId}] Failed to ${phone}: ${err.message} (consecutive: ${state.consecutiveFails})`);
        failed = { status: 'failed', error: err.message || 'Send failed' };
        break;
      }

      if (mi < messages.length - 1) await sleep(gaussianBetween(10, 30) * 1000);
    }

    if (failed) markLead(jl.id, jobId, failed.status, failed.error);
    else markLead(jl.id, jobId, 'sent');
    checkRates(projectId);

    if (state.consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
      state.consecutiveFails = 0;
      return waitAndReschedule(projectId, jobId, `${MAX_CONSECUTIVE_FAILS} failed sends in a row — cooling down`, 30 * 60 * 1000);
    }
    if (jobStatus(jobId) !== 'running') { state.processingJobId = null; return; }
    if (failed?.status === 'skipped') continue;

    const delayMs = gaussianBetween(limits.minDelaySec, limits.maxDelaySec) * 1000;
    console.log(`[wa:${projectId}] Waiting ${(delayMs / 1000).toFixed(0)}s before next contact`);
    await sleep(delayMs);
  }

  const updated = db.prepare('SELECT * FROM broadcast_jobs WHERE id = ?').get(jobId);
  if (updated && (updated.sent + updated.failed + updated.skipped) >= updated.total) {
    db.prepare("UPDATE broadcast_jobs SET status = 'completed', completed_at = ?, wait_reason = NULL, resume_at = NULL WHERE id = ?").run(Date.now(), jobId);
  } else if (updated && updated.status === 'running') {
    setImmediate(() => runJob(projectId, jobId));
    return;
  }

  state.processingJobId = null;
  setImmediate(() => processNextJob(projectId));
}

// One timer per workspace; an earlier wake-up wins (a far-off scheduled job must not cancel a short wait).
function scheduleProcessor(projectId, delayMs) {
  const state = getState(projectId);
  const ms = Math.max(1000, Math.min(delayMs, MAX_TIMER_MS));
  const due = Date.now() + ms;
  if (state.processorTimer && state.timerDue <= due) return;
  if (state.processorTimer) clearTimeout(state.processorTimer);
  state.timerDue = due;
  state.processorTimer = setTimeout(() => {
    state.processorTimer = null;
    state.timerDue = null;
    if (!state.processingJobId) processNextJob(projectId);
  }, ms);
}

// On boot, resume pending jobs for any project that has them
export function resumeAllProjectJobs() {
  try {
    const db = getDB();
    const rows = db.prepare("SELECT DISTINCT project_id FROM broadcast_jobs WHERE status IN ('pending', 'running', 'scheduled') AND project_id IS NOT NULL").all();
    for (const r of rows) {
      if (r.project_id) {
        setTimeout(() => processNextJob(r.project_id), 2000);
      }
    }
  } catch {}
}

export default router;
