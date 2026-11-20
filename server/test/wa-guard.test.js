// lib/waGuard.js against a throwaway DB, in-process (no WhatsApp socket; nothing is sent).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leaddesk-waguard-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.WA_AUTH_DIR = path.join(tmp, 'wa');
process.env.GMAPS_JOBS_FILE = path.join(tmp, 'jobs.json');

let db, G, pid, leadId;
const PHONE = '966500000000';

before(async () => {
  const { getDB } = await import('../db.js');
  G = await import('../lib/waGuard.js');
  db = getDB();
  pid = db.prepare('SELECT id FROM projects ORDER BY created_at LIMIT 1').get().id;
  const stage = db.prepare('SELECT id FROM stages WHERE project_id = ? LIMIT 1').get(pid).id;
  leadId = 'lead_guard1';
  db.prepare(`INSERT INTO leads (id, name, phone, phone_valid, stage_id, created_at, project_id) VALUES (?, 'Guard', ?, 1, ?, ?, ?)`)
    .run(leadId, '+966 50 000 0000', stage, Date.now(), pid);
  // Always-open window, no warm-up, so the tests don't depend on the clock
  G.saveLimits(pid, { windowStartHour: 0, windowEndHour: 24, blockFridayMorning: false, warmup: false });
});
after(() => { db?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('limits are stored per workspace and clamped', () => {
  const l = G.saveLimits(pid, { maxMessagesPerHour: 5000 });
  assert.equal(l.maxMessagesPerHour, 200);
  assert.equal(G.getLimits(pid).maxMessagesPerHour, 200);
  G.saveLimits(pid, { maxMessagesPerHour: 30 });
});

test('first contact is a new chat; after a send it is not, and the contact is done for today', () => {
  assert.equal(G.isNewChat(pid, PHONE), true);
  assert.deepEqual(G.contactCheck(pid, { leadId, phone: PHONE }), { ok: true, newChat: true });
  G.recordSent({ projectId: pid, phone: PHONE, leadId, jobId: 'j1', jobLeadId: 1, waMsgId: 'M1', text: 'Hello there?', newChat: true });
  assert.equal(G.isNewChat(pid, '+966 50 000 0000'), false, 'phone formatting does not matter');
  assert.equal(G.contactCheck(pid, { leadId, phone: PHONE }).code, 'contact_today');
  assert.equal(G.counts(pid).newChatsToday, 1);
  assert.equal(G.sameTextCount(pid, '  hello   THERE? '), 1, 'identical-text check ignores case/spacing');
});

test('a reply is tracked; an opt-out reply marks the contact do-not-contact', () => {
  G._onIncoming(pid, PHONE, 'ممكن التفاصيل؟');
  assert.ok(db.prepare('SELECT replied_at FROM wa_sends WHERE wa_msg_id = ?').get('M1').replied_at);
  assert.equal(db.prepare('SELECT do_not_contact FROM leads WHERE id = ?').get(leadId).do_not_contact, 0);
  G._onIncoming(pid, PHONE, 'لا شكرا');
  assert.equal(db.prepare('SELECT do_not_contact FROM leads WHERE id = ?').get(leadId).do_not_contact, 1);
  assert.equal(G.contactCheck(pid, { leadId, phone: PHONE }).code, 'dnc');
});

test('per-minute cap makes the gate wait', () => {
  assert.equal(G.gate(pid, { phone: '201000000001', newChat: false }).ok, true);
  for (let i = 0; i < 3; i++) G.recordSent({ projectId: pid, phone: '20100000000' + i, text: `msg ${i}?`, newChat: false });
  const g = G.gate(pid, { phone: '201000000009', newChat: false });
  assert.equal(g.ok, false);
  assert.match(g.reason, /Per-minute/);
  assert.ok(g.waitMs > 0 && g.waitMs <= 61000);
});

test('new-chat daily cap and warm-up day 0', () => {
  G.saveLimits(pid, { maxMessagesPerMinute: 10, maxNewChatsPerDay: 1 });
  const g = G.gate(pid, { phone: '201000000077', newChat: true });
  assert.equal(g.ok, false);
  assert.match(g.reason, /new-chat limit/);
  G.saveLimits(pid, { warmup: true, maxNewChatsPerDay: 40 });
  G.setWarmupStart(pid, Date.now() - 1000);
  assert.match(G.gate(pid, { phone: '201000000078', newChat: true }).reason, /Warm-up/);
  assert.equal(G.gate(pid, { phone: '201000000078', newChat: false }).ok, true, 'warm-up only limits new chats');
  G.saveLimits(pid, { warmup: false });
});

test('health events add up; 85+ is a 48 h hard stop with an alert', () => {
  G.addHealthEvent(pid, 'disconnect');
  G.addHealthEvent(pid, 'send_failed');
  let h = G.healthStatus(pid);
  assert.equal(h.score, 25);
  assert.equal(h.level, 'good');
  G.addHealthEvent(pid, 'restricted');
  assert.equal(G.healthStatus(pid).level, 'warning');
  G.addHealthEvent(pid, 'low_reply_rate');
  G.addHealthEvent(pid, 'low_delivery_rate');
  h = G.healthStatus(pid);
  assert.equal(h.level, 'stopped');
  assert.ok(h.paused_until > Date.now() + 47 * 3600 * 1000);
  assert.match(h.alert, /48 h/);
  const g = G.gate(pid, { phone: '201000000050', newChat: false });
  assert.equal(g.ok, false);
  assert.match(g.reason, /hard stop/);
  assert.ok(h.events.some(e => e.type === 'hard_stop'));
});

test('failed connection attempts before a number is linked do not hurt its health', () => {
  const other = 'proj_unlinked_test';
  db.prepare("INSERT INTO projects (id, name, created_at) VALUES (?, 'Unlinked', ?)").run(other, Date.now());
  for (let i = 0; i < 20; i++) G._onEvent({ projectId: other, type: 'close', intentional: false, linked: false, reason: 'Connection Failure' });
  const h = G.healthStatus(other);
  assert.equal(h.score, 0);
  assert.equal(h.paused_until, null);
  G._onEvent({ projectId: other, type: 'close', intentional: false, linked: true, reason: 'Connection Failure' });
  assert.ok(G.healthStatus(other).score > 0, 'a linked number still counts disconnects');
});

test('a number is remembered: relinking restores it, a new one starts fresh, limits follow the number', () => {
  const ws = 'proj_number_identity';
  db.prepare("INSERT INTO projects (id, name, created_at) VALUES (?, 'Numbers', ?)").run(ws, Date.now());
  const A = '201000000001', B = '966500000002';
  const start = Date.now() - 40 * 24 * 3600 * 1000;

  // The first number adopts the workspace's existing state and history
  G.setWarmupStart(ws, start);
  G.recordSent({ projectId: ws, phone: '201111111111', text: 'old', newChat: true });
  db.prepare('UPDATE wa_sends SET sender_phone = NULL WHERE project_id = ?').run(ws);
  G._onEvent({ projectId: ws, type: 'open', phone: A });
  assert.equal(G.getNumber(ws).phone, A);
  assert.equal(G.getNumber(ws).warmup_started_at, start, 'existing warm-up kept');
  assert.equal(db.prepare('SELECT sender_phone FROM wa_sends WHERE project_id = ?').get(ws).sender_phone, A);
  G.saveLimits(ws, { maxNewChatsPerDay: 25 });
  G.addHealthEvent(ws, 'disconnect');

  // Logging out and relinking the same number changes nothing
  G._onEvent({ projectId: ws, type: 'logout' });
  G._onEvent({ projectId: ws, type: 'open', phone: A });
  assert.equal(G.getNumber(ws).warmup_started_at, start, 'logout does not restart warm-up');
  assert.ok(G.healthStatus(ws).score > 0);

  // A different number starts its own warm-up, with a clean score and today's counters
  G._onEvent({ projectId: ws, type: 'logout' });
  G._onEvent({ projectId: ws, type: 'open', phone: B });
  let n = G.getNumber(ws);
  assert.equal(n.phone, B);
  assert.ok(n.warmup_started_at > start);
  assert.equal(G.healthStatus(ws).score, 0);
  assert.equal(G.counts(ws).sentToday, 0, "the other number's sends don't count");
  G.saveLimits(ws, { maxNewChatsPerDay: 10 });

  // Back to the first number: everything it had returns
  G._onEvent({ projectId: ws, type: 'open', phone: A });
  n = G.getNumber(ws);
  assert.equal(n.warmup_started_at, start);
  assert.ok(G.healthStatus(ws).score > 0);
  assert.equal(G.getLimits(ws).maxNewChatsPerDay, 25);
  assert.equal(G.counts(ws).sentToday, 1);

  const list = G.listNumbers(ws);
  assert.deepEqual(list.map(x => x.phone).sort(), [A, B].sort());
  assert.equal(list.find(x => x.phone === A).is_current, true);
  assert.equal(list.find(x => x.phone === A).sent, 1);
  assert.equal(list.find(x => x.phone === B).new_chats_per_day, 10);
  assert.equal(G.isNewChat(ws, '201111111111'), false, 'contacts stay known whichever number messaged them');
});

test('after a restart only workspaces that were connected reconnect', () => {
  const ws = 'proj_auto_connect';
  db.prepare("INSERT INTO projects (id, name, created_at) VALUES (?, 'Auto', ?)").run(ws, Date.now());
  G.getNumber(ws);
  assert.equal(G.autoConnectProjects().includes(ws), false, 'a saved session alone is not enough');
  G._onEvent({ projectId: ws, type: 'open', phone: '201000000010' });
  assert.equal(G.autoConnectProjects().includes(ws), true);
  G._onEvent({ projectId: ws, type: 'close', intentional: true, linked: true, reason: 'shutdown' });
  assert.equal(G.autoConnectProjects().includes(ws), true, 'the server shutting down is not the user disconnecting');
  G._onEvent({ projectId: ws, type: 'logout' });
  assert.equal(G.autoConnectProjects().includes(ws), false);
  G._onEvent({ projectId: ws, type: 'open', phone: '201000000010' });
  G._onEvent({ projectId: ws, type: 'close', intentional: false, linked: true, loggedOut: true, reason: 'status 401' });
  assert.equal(G.autoConnectProjects().includes(ws), false, 'the session is gone');
});
