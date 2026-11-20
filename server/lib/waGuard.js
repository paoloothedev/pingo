// WhatsApp anti-ban guard: applies lib/waRules.js to real data (migrations 013, 015). A workspace has one active number
// (wa_number); wa_numbers remembers each number ever linked, so relinking restores its warm-up, health and limits.
// routes/jobs.js asks gate() / contactCheck() before every send and calls recordSent() after; initWaGuard() wires
// connection, delivery-ack and incoming-message events from whatsapp.js into the health score and reply tracking.
import crypto from 'crypto';
import { getDB } from '../db.js';
import { onWaEvent } from '../whatsapp.js';
import {
  normalizeLimits, currentHealthScore, healthLevel, healthMultiplier, dailyNewChatLimit, warmupNewChatLimit,
  HEALTH_POINTS, HARD_STOP_SCORE, HARD_STOP_MS, REDUCED_AFTER_STOP_MS, inSendingWindow, nextWindowStart,
  phoneTimezone, contactCadence, isOptOutReply, normalizeText, daysSince,
} from './waRules.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const digits = (p) => String(p || '').replace(/\D/g, '');
export const textHash = (t) => crypto.createHash('sha1').update(normalizeText(t)).digest('hex');

function startOfToday(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ── Settings ────────────────────────────────────────────────────

export function getLimits(projectId) {
  const row = getDB().prepare("SELECT value FROM settings WHERE project_id = ? AND key = 'wa_limits'").get(projectId);
  let stored = {};
  try { stored = JSON.parse(row?.value || '{}'); } catch {}
  return normalizeLimits(stored);
}

export function saveLimits(projectId, input) {
  const limits = normalizeLimits({ ...getLimits(projectId), ...input });
  getDB().prepare(`INSERT INTO settings (project_id, key, value) VALUES (?, 'wa_limits', ?)
    ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`).run(projectId, JSON.stringify(limits));
  return limits;
}

function workspaceTimezone(projectId) {
  return getDB().prepare("SELECT value FROM settings WHERE project_id = ? AND key = 'timezone'").get(projectId)?.value || 'UTC';
}

// ── Number state & health ───────────────────────────────────────

export function getNumber(projectId) {
  const db = getDB();
  let n = db.prepare('SELECT * FROM wa_number WHERE project_id = ?').get(projectId);
  if (!n) {
    db.prepare('INSERT OR IGNORE INTO wa_number (project_id, health_at) VALUES (?, ?)').run(projectId, Date.now());
    n = db.prepare('SELECT * FROM wa_number WHERE project_id = ?').get(projectId);
  }
  return n;
}

export function addHealthEvent(projectId, type, detail = null, points = HEALTH_POINTS[type] || 0, now = Date.now()) {
  const db = getDB();
  const n = getNumber(projectId);
  const before = currentHealthScore(n, now);
  const score = Math.min(100, before + points);
  let { paused_until, reduced_until, alert } = n;
  if (score >= HARD_STOP_SCORE && !(paused_until > now)) {
    paused_until = now + HARD_STOP_MS;
    reduced_until = paused_until + REDUCED_AFTER_STOP_MS;
    alert = `Health score ${Math.round(score)} — sending stopped for 48 h, then resumes at half volume.`;
    db.prepare('INSERT INTO wa_events (project_id, type, points, detail, at, sender_phone) VALUES (?, ?, 0, ?, ?, ?)').run(projectId, 'hard_stop', alert, now, n.phone);
  } else if (score >= 60 && before < 60) {
    alert = `Health score ${Math.round(score)} — volume cut to 20 %. Check replies and delivery before sending more.`;
  }
  db.prepare('UPDATE wa_number SET health_score = ?, health_at = ?, paused_until = ?, reduced_until = ?, alert = ? WHERE project_id = ?')
    .run(score, now, paused_until, reduced_until, alert, projectId);
  db.prepare('INSERT INTO wa_events (project_id, type, points, detail, at, sender_phone) VALUES (?, ?, ?, ?, ?, ?)').run(projectId, type, points, detail, now, n.phone);
  return score;
}

const NUMBER_STATE = ['warmup_started_at', 'last_active_at', 'health_score', 'health_at', 'paused_until', 'reduced_until', 'alert', 'reply_check_at', 'delivery_check_at'];

function saveNumberProfile(projectId, now) {
  const n = getNumber(projectId);
  if (!n.phone) return;
  getDB().prepare(`INSERT INTO wa_numbers (project_id, phone, ${NUMBER_STATE.join(', ')}, limits, first_linked_at, last_linked_at)
    VALUES (?, ?, ${NUMBER_STATE.map(() => '?').join(', ')}, ?, ?, ?)
    ON CONFLICT(project_id, phone) DO UPDATE SET ${NUMBER_STATE.map(c => `${c} = excluded.${c}`).join(', ')}, limits = excluded.limits`)
    .run(projectId, n.phone, ...NUMBER_STATE.map(c => n[c]), JSON.stringify(getLimits(projectId)), now, now);
}

// Called when WhatsApp opens: same number → nothing changes; a number seen before → its state comes back; a new one
// starts its warm-up. The first number after migration 015 adopts the workspace's existing state and history.
export function linkNumber(projectId, phone, now = Date.now()) {
  const db = getDB();
  const p = digits(phone);
  const n = getNumber(projectId);
  if (!p) {
    if (!n.warmup_started_at) setWarmupStart(projectId, now);
    return;
  }
  db.transaction(() => {
    if (!n.phone) {
      db.prepare('UPDATE wa_number SET phone = ?, warmup_started_at = COALESCE(warmup_started_at, ?) WHERE project_id = ?').run(p, now, projectId);
      db.prepare('UPDATE wa_sends SET sender_phone = ? WHERE project_id = ? AND sender_phone IS NULL').run(p, projectId);
      db.prepare('UPDATE wa_events SET sender_phone = ? WHERE project_id = ? AND sender_phone IS NULL').run(p, projectId);
    } else if (n.phone === p) {
      db.prepare('UPDATE wa_number SET warmup_started_at = COALESCE(warmup_started_at, ?) WHERE project_id = ?').run(now, projectId);
    } else {
      saveNumberProfile(projectId, now);
      const known = db.prepare('SELECT * FROM wa_numbers WHERE project_id = ? AND phone = ?').get(projectId, p);
      const state = known || { warmup_started_at: now, health_score: 0, health_at: now };
      db.prepare(`UPDATE wa_number SET phone = ?, ${NUMBER_STATE.map(c => `${c} = ?`).join(', ')} WHERE project_id = ?`)
        .run(p, ...NUMBER_STATE.map(c => state[c] ?? (c === 'health_score' ? 0 : null)), projectId);
      if (known?.limits) saveLimits(projectId, JSON.parse(known.limits));
      db.prepare('INSERT INTO wa_events (project_id, type, points, detail, at, sender_phone) VALUES (?, ?, 0, ?, ?, ?)')
        .run(projectId, 'number_linked', known ? `+${p} linked again: warm-up, health and limits restored` : `New number +${p}: warm-up starts now`, now, p);
    }
    saveNumberProfile(projectId, now);
    db.prepare('UPDATE wa_numbers SET last_linked_at = ? WHERE project_id = ? AND phone = ?').run(now, projectId, p);
  })();
}

// Every number linked in this workspace, with what it has sent.
export function listNumbers(projectId, now = Date.now()) {
  const db = getDB();
  const current = getNumber(projectId);
  const limits = getLimits(projectId);
  const stats = db.prepare(`SELECT COUNT(DISTINCT COALESCE(job_lead_id, id)) AS sent, COUNT(DISTINCT CASE WHEN new_chat = 1 THEN phone END) AS new_chats,
    COUNT(DISTINCT CASE WHEN delivered_at IS NOT NULL THEN COALESCE(job_lead_id, id) END) AS delivered,
    COUNT(DISTINCT CASE WHEN replied_at IS NOT NULL THEN phone END) AS replied, MAX(sent_at) AS last_sent_at
    FROM wa_sends WHERE project_id = ? AND sender_phone = ? AND legacy = 0`);
  return db.prepare('SELECT * FROM wa_numbers WHERE project_id = ? ORDER BY last_linked_at DESC').all(projectId).map(row => {
    const isCurrent = row.phone === current.phone;
    const n = isCurrent ? current : row;
    return {
      phone: row.phone, is_current: isCurrent,
      first_linked_at: row.first_linked_at, last_linked_at: row.last_linked_at, last_active_at: n.last_active_at,
      warmup_day: n.warmup_started_at ? daysSince(n.warmup_started_at, now) : null,
      health: Math.round(currentHealthScore(n, now)),
      paused_until: n.paused_until > now ? n.paused_until : null,
      new_chats_per_day: isCurrent ? limits.maxNewChatsPerDay : normalizeLimits(JSON.parse(row.limits || '{}')).maxNewChatsPerDay,
      ...stats.get(projectId, row.phone),
    };
  });
}

// Workspaces to reconnect after a restart: connected last time, and not disconnected by the user since. Saved sessions
// that were left disconnected stay that way, so old queued broadcasts don't start sending by surprise.
export function setAutoConnect(projectId, on) {
  getNumber(projectId);
  getDB().prepare('UPDATE wa_number SET auto_connect = ? WHERE project_id = ?').run(on ? 1 : 0, projectId);
}

export function autoConnectProjects() {
  return getDB().prepare('SELECT project_id FROM wa_number WHERE auto_connect = 1').all().map(r => r.project_id);
}

export function setWarmupStart(projectId, ts) {
  getNumber(projectId);
  getDB().prepare('UPDATE wa_number SET warmup_started_at = ? WHERE project_id = ?').run(ts, projectId);
}

export function dismissAlert(projectId) {
  getDB().prepare('UPDATE wa_number SET alert = NULL WHERE project_id = ?').run(projectId);
}

function markActive(projectId, now = Date.now()) {
  getNumber(projectId);
  getDB().prepare('UPDATE wa_number SET last_active_at = ? WHERE project_id = ?').run(now, projectId);
}

// ── Message log ─────────────────────────────────────────────────

export function isNewChat(projectId, phone) {
  return !getDB().prepare('SELECT 1 FROM wa_sends WHERE project_id = ? AND phone = ? LIMIT 1').get(projectId, digits(phone));
}

export function recordSent({ projectId, phone, leadId, jobId, jobLeadId, waMsgId, text, newChat, now = Date.now() }) {
  getDB().prepare(`INSERT INTO wa_sends (project_id, phone, lead_id, job_id, job_lead_id, wa_msg_id, text_hash, text, new_chat, sent_at, sender_phone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(projectId, digits(phone), leadId || null, jobId || null, jobLeadId || null,
    waMsgId || null, textHash(text), text, newChat ? 1 : 0, now, getNumber(projectId).phone);
  markActive(projectId, now);
}

export function sameTextCount(projectId, text, now = Date.now()) {
  return getDB().prepare('SELECT COUNT(*) AS n FROM wa_sends WHERE project_id = ? AND text_hash = ? AND sent_at > ?')
    .get(projectId, textHash(text), now - 7 * DAY).n;
}

// Touch = one broadcast delivery to a contact (job_lead_id), however many message parts it had.
export function contactHistory(projectId, phone, now = Date.now()) {
  const db = getDB();
  const p = digits(phone);
  const lastReply = db.prepare('SELECT MAX(replied_at) AS t FROM wa_sends WHERE project_id = ? AND phone = ?').get(projectId, p).t || 0;
  const touchesToday = db.prepare(`SELECT COUNT(DISTINCT COALESCE(job_lead_id, id)) AS n FROM wa_sends
    WHERE project_id = ? AND phone = ? AND legacy = 0 AND sent_at >= ?`).get(projectId, p, startOfToday(now)).n;
  const un = db.prepare(`SELECT COUNT(DISTINCT COALESCE(job_lead_id, id)) AS n, MIN(sent_at) AS first FROM wa_sends
    WHERE project_id = ? AND phone = ? AND legacy = 0 AND sent_at > ? AND replied_at IS NULL`).get(projectId, p, lastReply);
  return { touchesToday, unanswered: un.n, firstUnansweredAt: un.first, lastReplyAt: lastReply || null };
}

function senderFilter(projectId) {
  const phone = getNumber(projectId).phone;
  return phone ? { sql: ' AND sender_phone = ?', args: [phone] } : { sql: '', args: [] };
}

export function counts(projectId, now = Date.now()) {
  const db = getDB();
  // Limits belong to the number: what another number sent today doesn't use up this one's allowance
  const { sql: mine, args } = senderFilter(projectId);
  const q = (sql, ...a) => db.prepare(sql).get(projectId, ...args, ...a);
  return {
    lastMinute: q(`SELECT COUNT(*) AS n FROM wa_sends WHERE project_id = ?${mine} AND legacy = 0 AND sent_at > ?`, now - MIN).n,
    lastHour: q(`SELECT COUNT(*) AS n FROM wa_sends WHERE project_id = ?${mine} AND legacy = 0 AND sent_at > ?`, now - HOUR).n,
    oldestInHour: q(`SELECT MIN(sent_at) AS t FROM wa_sends WHERE project_id = ?${mine} AND legacy = 0 AND sent_at > ?`, now - HOUR).t,
    oldestInMinute: q(`SELECT MIN(sent_at) AS t FROM wa_sends WHERE project_id = ?${mine} AND legacy = 0 AND sent_at > ?`, now - MIN).t,
    sentToday: q(`SELECT COUNT(*) AS n FROM wa_sends WHERE project_id = ?${mine} AND legacy = 0 AND sent_at >= ?`, startOfToday(now)).n,
    newChatsToday: q(`SELECT COUNT(DISTINCT phone) AS n FROM wa_sends WHERE project_id = ?${mine} AND legacy = 0 AND new_chat = 1
      AND sent_at >= ?`, startOfToday(now)).n,
  };
}

// Reply rate over the last 50 new chats older than 6 h; delivery rate over the last 100 messages older than 15 min.
export function rates(projectId, now = Date.now()) {
  const db = getDB();
  const { sql: mine, args } = senderFilter(projectId);
  const chats = db.prepare(`SELECT phone, MAX(replied_at IS NOT NULL) AS replied FROM wa_sends
    WHERE project_id = ?${mine} AND legacy = 0 AND new_chat = 1 AND sent_at < ? GROUP BY phone ORDER BY MAX(sent_at) DESC LIMIT 50`)
    .all(projectId, ...args, now - 6 * HOUR);
  const msgs = db.prepare(`SELECT delivered_at FROM wa_sends WHERE project_id = ?${mine} AND legacy = 0 AND sent_at < ?
    ORDER BY sent_at DESC LIMIT 100`).all(projectId, ...args, now - 15 * MIN);
  return {
    replySample: chats.length,
    replyRate: chats.length ? chats.filter(c => c.replied).length / chats.length : null,
    deliverySample: msgs.length,
    deliveryRate: msgs.length ? msgs.filter(m => m.delivered_at).length / msgs.length : null,
  };
}

// Low reply / delivery rate penalties — at most once per 24 h / 6 h so one bad batch isn't counted repeatedly.
export function checkRates(projectId, now = Date.now()) {
  const n = getNumber(projectId);
  const r = rates(projectId, now);
  const db = getDB();
  if (r.replySample >= 20 && r.replyRate < 0.1 && !(n.reply_check_at > now - DAY)) {
    addHealthEvent(projectId, 'low_reply_rate', `${Math.round(r.replyRate * 100)}% replies over the last ${r.replySample} new chats`, undefined, now);
    db.prepare('UPDATE wa_number SET reply_check_at = ? WHERE project_id = ?').run(now, projectId);
  }
  if (r.deliverySample >= 20 && r.deliveryRate < 0.85 && !(n.delivery_check_at > now - 6 * HOUR)) {
    addHealthEvent(projectId, 'low_delivery_rate', `${Math.round(r.deliveryRate * 100)}% delivered over the last ${r.deliverySample} messages`, undefined, now);
    db.prepare('UPDATE wa_number SET delivery_check_at = ? WHERE project_id = ?').run(now, projectId);
  }
}

// ── Gates ───────────────────────────────────────────────────────

// Number-level gate for the next message: { ok: true } or { ok: false, waitMs, reason }.
export function gate(projectId, { phone, newChat, now = Date.now() }) {
  const limits = getLimits(projectId);
  const n = getNumber(projectId);
  if (n.paused_until > now) return { ok: false, waitMs: n.paused_until - now, reason: 'Health hard stop (48 h)' };

  const tz = phoneTimezone(phone, workspaceTimezone(projectId));
  if (!inSendingWindow(now, tz, limits)) {
    return { ok: false, waitMs: nextWindowStart(now, tz, limits) - now, reason: `Outside sending hours for the recipient (${tz})` };
  }
  const c = counts(projectId, now);
  if (c.lastMinute >= limits.maxMessagesPerMinute) {
    return { ok: false, waitMs: Math.max(5000, c.oldestInMinute + MIN - now + 1000), reason: `Per-minute limit (${limits.maxMessagesPerMinute})` };
  }
  if (c.lastHour >= limits.maxMessagesPerHour) {
    return { ok: false, waitMs: Math.max(30000, c.oldestInHour + HOUR - now + 1000), reason: `Hourly limit (${limits.maxMessagesPerHour})` };
  }
  if (newChat) {
    const cap = dailyNewChatLimit(n, limits, now);
    if (c.newChatsToday >= cap) {
      const tomorrow = startOfToday(now) + DAY + 5 * MIN;
      const reason = cap === 0
        ? (limits.warmup && daysSince(n.warmup_started_at, now) < 1 ? 'Warm-up: no new chats in the first 24 h after connecting' : 'New chats paused by health score')
        : `Daily new-chat limit reached (${c.newChatsToday}/${cap})`;
      return { ok: false, waitMs: tomorrow - now, reason };
    }
  }
  return { ok: true, limits, tz };
}

// Answering someone who wrote to us: sending hours and new-chat limits don't apply, but a hard stop and the per-minute
// limit do. It still counts towards the number's totals (recordSent).
export function replyGate(projectId, now = Date.now()) {
  const limits = getLimits(projectId);
  const n = getNumber(projectId);
  if (n.paused_until > now) return { ok: false, reason: 'WhatsApp sending is stopped for this number to protect it (health hard stop). See Settings → WhatsApp.' };
  if (counts(projectId, now).lastMinute >= limits.maxMessagesPerMinute) return { ok: false, reason: `Too fast: limit is ${limits.maxMessagesPerMinute} messages a minute. Try again in a moment.` };
  return { ok: true };
}

// Contact-level rules: { ok: true, newChat } or { ok: false, reason } (the contact is skipped, not retried).
export function contactCheck(projectId, { leadId, phone, now = Date.now() }) {
  const db = getDB();
  const limits = getLimits(projectId);
  if (leadId) {
    const lead = db.prepare('SELECT do_not_contact FROM leads WHERE id = ? AND project_id = ?').get(leadId, projectId);
    if (lead?.do_not_contact) return { ok: false, code: 'dnc', reason: 'Do not contact (opted out)' };
  }
  const h = contactHistory(projectId, phone, now);
  const cad = contactCadence(h, limits, now);
  if (!cad.ok) return cad;
  return { ok: true, newChat: isNewChat(projectId, phone) };
}

// ── Dashboard ───────────────────────────────────────────────────

export function healthStatus(projectId, now = Date.now()) {
  const limits = getLimits(projectId);
  const n = getNumber(projectId);
  const score = currentHealthScore(n, now);
  const lvl = healthLevel(score);
  const c = counts(projectId, now);
  const r = rates(projectId, now);
  const { sql: mine, args } = senderFilter(projectId);
  const events = getDB().prepare(`SELECT type, points, detail, at FROM wa_events WHERE project_id = ?${mine} ORDER BY at DESC LIMIT 20`).all(projectId, ...args);
  return {
    phone: n.phone || null,
    score: Math.round(score),
    level: n.paused_until > now ? 'stopped' : lvl.level,
    multiplier: healthMultiplier(n, now),
    paused_until: n.paused_until > now ? n.paused_until : null,
    reduced_until: n.reduced_until > now ? n.reduced_until : null,
    alert: n.alert || null,
    warmup: {
      enabled: limits.warmup,
      started_at: n.warmup_started_at,
      day: n.warmup_started_at ? daysSince(n.warmup_started_at, now) : null,
      base_limit: warmupNewChatLimit(n, limits, now),
    },
    last_active_at: n.last_active_at,
    today: { sent: c.sentToday, new_chats: c.newChatsToday, new_chat_limit: dailyNewChatLimit(n, limits, now) },
    last_hour: c.lastHour,
    hour_limit: limits.maxMessagesPerHour,
    reply_rate: r.replyRate, reply_sample: r.replySample,
    delivery_rate: r.deliveryRate, delivery_sample: r.deliverySample,
    window: { open_now_workspace_tz: inSendingWindow(now, workspaceTimezone(projectId), limits), start: limits.windowStartHour, end: limits.windowEndHour },
    events,
  };
}

// ── WhatsApp events ─────────────────────────────────────────────

function onIncoming(projectId, phone, text, now = Date.now()) {
  const db = getDB();
  const p = digits(phone);
  if (!p) return;
  markActive(projectId, now);
  db.prepare('UPDATE wa_sends SET replied_at = ? WHERE project_id = ? AND phone = ? AND replied_at IS NULL').run(now, projectId, p);
  if (!isOptOutReply(text)) return;
  const ids = new Set(db.prepare('SELECT DISTINCT lead_id FROM wa_sends WHERE project_id = ? AND phone = ? AND lead_id IS NOT NULL').all(projectId, p).map(r => r.lead_id));
  if (!ids.size) return;
  const upd = db.prepare('UPDATE leads SET do_not_contact = 1, updated_at = ? WHERE id = ? AND project_id = ?');
  for (const id of ids) upd.run(now, id, projectId);
  db.prepare('INSERT INTO wa_events (project_id, type, points, detail, at) VALUES (?, ?, 0, ?, ?)')
    .run(projectId, 'opt_out', `${p} replied "${String(text).slice(0, 40)}" → do not contact`, now);
}

let initialised = false;
export function initWaGuard() {
  if (initialised) return;
  initialised = true;
  onWaEvent(onEvent);
}

function onEvent(e) {
    try {
      const db = getDB();
      if (e.type === 'open') {
        linkNumber(e.projectId, e.phone);
        setAutoConnect(e.projectId, true);
      } else if (e.type === 'logout') {
        setAutoConnect(e.projectId, false);
      } else if (e.type === 'close' && e.linked === false) {
        // Connection attempts before a number is linked don't count against its health
      } else if (e.type === 'close' && e.restricted) {
        addHealthEvent(e.projectId, 'restricted', e.reason || null);
      } else if (e.type === 'close' && !e.intentional) {
        if (e.loggedOut) setAutoConnect(e.projectId, false);
        addHealthEvent(e.projectId, 'disconnect', e.reason || null);
        const recent = db.prepare("SELECT COUNT(*) AS n FROM wa_events WHERE project_id = ? AND type = 'disconnect' AND at > ?")
          .get(e.projectId, Date.now() - HOUR).n;
        if (recent >= 3) db.prepare('UPDATE wa_number SET alert = ? WHERE project_id = ?').run(`${recent} disconnects in the last hour.`, e.projectId);
      } else if (e.type === 'ack' && e.id) {
        if (e.status >= 3) db.prepare('UPDATE wa_sends SET delivered_at = COALESCE(delivered_at, ?) WHERE wa_msg_id = ? AND project_id = ?').run(Date.now(), e.id, e.projectId);
        else if (e.status === 0) addHealthEvent(e.projectId, 'send_failed', 'Message rejected (error ack)');
      } else if (e.type === 'incoming') {
        onIncoming(e.projectId, e.phone, e.text);
      }
    } catch (err) {
      console.error('[wa-guard]', err.message);
    }
}

// For tests: run the incoming-message / connection-event paths without a socket.
export const _onIncoming = onIncoming;
export const _onEvent = onEvent;
