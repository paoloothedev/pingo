// lib/waInbox.js against a throwaway DB, in-process. Baileys messages are hand-made and the transport is a stub:
// nothing touches WhatsApp and nothing is sent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leaddesk-inbox-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.WA_AUTH_DIR = path.join(tmp, 'wa');
process.env.GMAPS_JOBS_FILE = path.join(tmp, 'jobs.json');

let db, I, G, pid, leadId, stage;
const PHONE = '966500000001';
let sentLog = [];
let waId = 0;

const incoming = (text, over = {}) => ({
  key: { id: `IN${++waId}`, fromMe: false, remoteJid: `${PHONE}@s.whatsapp.net` },
  message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Sara', ...over,
});
const event = (msg, over = {}) => ({ type: 'message', projectId: pid, msg, phone: PHONE, lid: null, upsert: 'notify', senderPhone: '966599999999', ...over });
const chatOf = (phone = PHONE) => db.prepare('SELECT * FROM wa_inbox_chats WHERE project_id = ? AND phone = ?').get(pid, phone);
const messagesOf = (id) => db.prepare('SELECT * FROM wa_inbox_messages WHERE chat_id = ? ORDER BY at, rowid').all(id);

before(async () => {
  const { getDB } = await import('../db.js');
  I = await import('../lib/waInbox.js');
  G = await import('../lib/waGuard.js');
  db = getDB();
  pid = db.prepare('SELECT id FROM projects ORDER BY created_at LIMIT 1').get().id;
  stage = db.prepare('SELECT id FROM stages WHERE project_id = ? LIMIT 1').get(pid).id;
  leadId = 'lead_inbox1';
  db.prepare(`INSERT INTO leads (id, name, phone, phone_valid, stage_id, created_at, project_id) VALUES (?, 'Sara Shop', '+966 50 000 0001', 1, ?, ?, ?)`).run(leadId, stage, Date.now(), pid);
  G.saveLimits(pid, { windowStartHour: 0, windowEndHour: 24, blockFridayMorning: false, warmup: false });
  I._setTransport({
    ready: () => true,
    exists: async () => true,
    send: async (projectId, jid, text) => { sentLog.push({ jid, text }); return { key: { id: `OUT${++waId}` } }; },
  });
});
after(() => { db?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('parseMessage understands the kinds of message people send, and skips technical ones', () => {
  const P = I.parseMessage;
  assert.deepEqual(P({ conversation: 'hi' }), { kind: 'message', type: 'text', text: 'hi' });
  assert.equal(P({ extendedTextMessage: { text: 'link' } }).text, 'link');
  const img = P({ imageMessage: { caption: 'look', mimetype: 'image/jpeg', fileLength: 2048 } });
  assert.deepEqual([img.type, img.text, img.mime, img.size], ['image', 'look', 'image/jpeg', 2048]);
  assert.equal(P({ audioMessage: { mimetype: 'audio/ogg', ptt: true } }).type, 'audio');
  assert.equal(P({ documentMessage: { fileName: 'a.pdf' } }).fileName, 'a.pdf');
  assert.equal(P({ ephemeralMessage: { message: { conversation: 'wrapped' } } }).text, 'wrapped');
  assert.equal(P({ locationMessage: { degreesLatitude: 30, degreesLongitude: 31 } }).text, '30,31');
  assert.equal(P({ reactionMessage: { text: '👍' } }), null);
  assert.equal(P(null), null);
  assert.deepEqual(P({ protocolMessage: { type: 0, key: { id: 'X' } } }), { kind: 'revoke', id: 'X' });
  assert.deepEqual(P({ protocolMessage: { type: 14, key: { id: 'X' }, editedMessage: { conversation: 'new' } } }), { kind: 'edit', id: 'X', text: 'new' });
});

test('an incoming message creates the chat, links the contact by phone, counts as unread', () => {
  I._onEvent(event(incoming('السلام عليكم')));
  const c = chatOf();
  assert.equal(c.lead_id, leadId, 'stored as +966 50 000 0001, still matched');
  assert.equal(c.unread, 1);
  assert.equal(c.name, 'Sara');
  assert.equal(c.last_text, 'السلام عليكم');
  const [m] = messagesOf(c.id);
  assert.deepEqual([m.direction, m.source, m.text], ['in', 'contact', 'السلام عليكم']);
});

test('the same message delivered twice is recorded once', () => {
  const msg = incoming('once');
  const before = chatOf();
  I._onEvent(event(msg));
  I._onEvent(event(msg, { upsert: 'append' }));
  const c = chatOf();
  assert.equal(c.unread, before.unread + 1);
  assert.equal(messagesOf(c.id).filter(m => m.text === 'once').length, 1);
});

test('messages sent from the phone are recorded, and clear unread', () => {
  I._onEvent(event(incoming('from phone', { key: { id: `PH${++waId}`, fromMe: true, remoteJid: `${PHONE}@s.whatsapp.net` } })));
  const c = chatOf();
  assert.equal(c.unread, 0);
  const m = messagesOf(c.id).at(-1);
  assert.deepEqual([m.direction, m.source, m.text], ['out', 'phone', 'from phone']);
  assert.equal(c.name, 'Sara', "our own push name must not rename the chat");
});

test('groups, status and channels never reach the inbox (no address)', () => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM wa_inbox_messages').get().n;
  I._onEvent(event(incoming('group'), { phone: null, lid: null }));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wa_inbox_messages').get().n, count);
});

test('a broadcast seen on the socket first keeps its broadcast label once recorded', () => {
  const id = 'BROADCAST1';
  I._onEvent(event(incoming('hello from job', { key: { id, fromMe: true, remoteJid: `${PHONE}@s.whatsapp.net` } }), { upsert: 'append' }));
  assert.equal(db.prepare('SELECT source FROM wa_inbox_messages WHERE wa_msg_id = ?').get(id).source, 'phone');
  I.recordOutbound({ projectId: pid, phone: PHONE, leadId, waMsgId: id, text: 'hello from job', source: 'broadcast', jobId: 'job_1' });
  const rows = db.prepare('SELECT source, job_id FROM wa_inbox_messages WHERE wa_msg_id = ?').all(id);
  assert.deepEqual(rows.map(r => [r.source, r.job_id]), [['broadcast', 'job_1']]);
  // And in the other order
  I.recordOutbound({ projectId: pid, phone: PHONE, leadId, waMsgId: 'BROADCAST2', text: 'second', source: 'broadcast', jobId: 'job_1' });
  I._onEvent(event(incoming('second', { key: { id: 'BROADCAST2', fromMe: true, remoteJid: `${PHONE}@s.whatsapp.net` } }), { upsert: 'append' }));
  assert.equal(db.prepare('SELECT source FROM wa_inbox_messages WHERE wa_msg_id = ?').get('BROADCAST2').source, 'broadcast');
});

test('delivery acks update the status and never go backwards; errors show', () => {
  I._onEvent({ type: 'ack', projectId: pid, id: 'BROADCAST1', status: 4 });
  I._onEvent({ type: 'ack', projectId: pid, id: 'BROADCAST1', status: 3 });
  assert.equal(db.prepare('SELECT status FROM wa_inbox_messages WHERE wa_msg_id = ?').get('BROADCAST1').status, 4);
  I._onEvent({ type: 'ack', projectId: pid, id: 'BROADCAST2', status: 0 });
  assert.equal(db.prepare('SELECT status FROM wa_inbox_messages WHERE wa_msg_id = ?').get('BROADCAST2').status, 0);
});

test('a message deleted on WhatsApp stays recorded; an edit keeps the original', () => {
  const msg = incoming('secret offer');
  I._onEvent(event(msg));
  I._onEvent(event(incoming('', { message: { protocolMessage: { type: 14, key: { id: msg.key.id }, editedMessage: { conversation: 'better offer' } } } })));
  let m = db.prepare('SELECT * FROM wa_inbox_messages WHERE wa_msg_id = ?').get(msg.key.id);
  assert.deepEqual([m.text, m.original_text], ['better offer', 'secret offer']);
  assert.ok(m.edited_at);
  I._onEvent(event(incoming('', { message: { protocolMessage: { type: 0, key: { id: msg.key.id } } } })));
  m = db.prepare('SELECT * FROM wa_inbox_messages WHERE wa_msg_id = ?').get(msg.key.id);
  assert.ok(m.deleted_at);
  assert.equal(m.text, 'better offer', 'the text is kept');
});

test('history from linking a phone is recorded without unread', () => {
  const phone = '966500000002';
  I._onEvent(event(incoming('old message', { key: { id: 'HIST1', fromMe: false, remoteJid: `${phone}@s.whatsapp.net` } }), { phone, upsert: 'history' }));
  const c = chatOf(phone);
  assert.equal(c.unread, 0);
  assert.equal(messagesOf(c.id).length, 1);
});

test('a LID-only chat becomes the phone chat when the phone is learned', () => {
  const phone = '966500000003', lid = '12345678';
  I._onEvent(event(incoming('via lid', { key: { id: 'LID1', fromMe: false, remoteJid: `${lid}@lid` } }), { phone: null, lid }));
  const lidChat = db.prepare('SELECT * FROM wa_inbox_chats WHERE project_id = ? AND lid = ?').get(pid, lid);
  assert.equal(lidChat.phone, null);
  I._onEvent(event(incoming('now with phone', { key: { id: 'LID2', fromMe: false, remoteJid: `${lid}@lid` } }), { phone, lid }));
  const c = chatOf(phone);
  assert.equal(c.id, lidChat.id);
  assert.equal(messagesOf(c.id).length, 2);
});

test('separate LID and phone chats of one person merge with their messages', () => {
  const phone = '966500000004', lid = '87654321';
  I._onEvent(event(incoming('by phone', { key: { id: 'M1', fromMe: false, remoteJid: `${phone}@s.whatsapp.net` } }), { phone, lid: null }));
  I._onEvent(event(incoming('by lid', { key: { id: 'M2', fromMe: false, remoteJid: `${lid}@lid` } }), { phone: null, lid }));
  I._onEvent(event(incoming('both', { key: { id: 'M3', fromMe: false, remoteJid: `${lid}@lid` } }), { phone, lid }));
  const c = chatOf(phone);
  assert.equal(messagesOf(c.id).length, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wa_inbox_chats WHERE project_id = ? AND lid = ?').get(pid, lid).n, 1);
  assert.equal(c.lid, lid);
  assert.equal(c.unread, 3);
});

test('replying in a chat sends, records who sent it, and counts towards the limits', async () => {
  const before = G.counts(pid).lastHour;
  sentLog = [];
  const m = await I.sendInChat({ projectId: pid, chatId: chatOf().id, text: ' Thanks! ', accountId: 'acc_1' });
  assert.deepEqual(sentLog, [{ jid: `${PHONE}@s.whatsapp.net`, text: 'Thanks!' }]);
  assert.deepEqual([m.direction, m.source, m.account_id, m.text], ['out', 'inbox', 'acc_1', 'Thanks!']);
  assert.equal(G.counts(pid).lastHour, before + 1);
});

test('replies are allowed outside sending hours; a hard stop still blocks them', async () => {
  G.saveLimits(pid, { windowStartHour: 3, windowEndHour: 4 });
  const nightTime = new Date(); nightTime.setHours(12, 0, 0, 0);
  await I.sendInChat({ projectId: pid, chatId: chatOf().id, text: 'Reply at noon', now: nightTime.getTime() });
  G.saveLimits(pid, { windowStartHour: 0, windowEndHour: 24 });
  db.prepare('UPDATE wa_number SET paused_until = ? WHERE project_id = ?').run(Date.now() + 3600000, pid);
  await assert.rejects(() => I.sendInChat({ projectId: pid, chatId: chatOf().id, text: 'blocked' }), (e) => e.status === 409 && /hard stop/.test(e.message));
  db.prepare('UPDATE wa_number SET paused_until = 0 WHERE project_id = ?').run(pid);
});

test('a first message follows the broadcast rules: daily new-chat cap and sending hours', async () => {
  const chat = I.openChatFor(pid, '966500000010');
  G.saveLimits(pid, { windowStartHour: 0, windowEndHour: 24, warmup: false, maxNewChatsPerDay: 0 });
  sentLog = [];
  await assert.rejects(() => I.sendInChat({ projectId: pid, chatId: chat.id, text: 'Hello, are you open?' }), (e) => e.status === 409 && e.code === 'limit');
  assert.equal(sentLog.length, 0);
  G.saveLimits(pid, { maxNewChatsPerDay: 20 });
  G.saveLimits(pid, { windowStartHour: 3, windowEndHour: 4 });
  const noon = new Date(); noon.setHours(12, 0, 0, 0);
  const chat2 = I.openChatFor(pid, '966500000011');
  await assert.rejects(() => I.sendInChat({ projectId: pid, chatId: chat2.id, text: 'Hello?', now: noon.getTime() }), (e) => e.status === 409 && /sending hours/.test(e.message));
  G.saveLimits(pid, { windowStartHour: 0, windowEndHour: 24 });
});

test('a first message is refused when the number is not on WhatsApp', async () => {
  const chat = I.openChatFor(pid, '966500000012');
  I._setTransport({ exists: async () => false });
  await assert.rejects(() => I.sendInChat({ projectId: pid, chatId: chat.id, text: 'Hello?' }), (e) => e.code === 'not_on_whatsapp');
  I._setTransport({ exists: async () => true });
});

test('opted-out contacts, empty text, long text, offline and other workspaces are all refused', async () => {
  const id = chatOf().id;
  await assert.rejects(() => I.sendInChat({ projectId: pid, chatId: id, text: '   ' }), (e) => e.status === 400);
  await assert.rejects(() => I.sendInChat({ projectId: pid, chatId: id, text: 'x'.repeat(4001) }), (e) => e.status === 400);
  await assert.rejects(() => I.sendInChat({ projectId: 'proj_other', chatId: id, text: 'hi' }), (e) => e.status === 404);
  I._setTransport({ ready: () => false });
  await assert.rejects(() => I.sendInChat({ projectId: pid, chatId: id, text: 'hi' }), (e) => e.code === 'offline');
  I._setTransport({ ready: () => true });
  db.prepare('UPDATE leads SET do_not_contact = 1 WHERE id = ?').run(leadId);
  sentLog = [];
  await assert.rejects(() => I.sendInChat({ projectId: pid, chatId: id, text: 'hi' }), (e) => e.code === 'dnc');
  assert.equal(sentLog.length, 0);
  db.prepare('UPDATE leads SET do_not_contact = 0 WHERE id = ?').run(leadId);
});

test('a failed send records nothing and reports why', async () => {
  const id = chatOf().id;
  const count = messagesOf(id).length;
  I._setTransport({ send: async () => { throw new Error('socket closed'); } });
  await assert.rejects(() => I.sendInChat({ projectId: pid, chatId: id, text: 'will fail' }), (e) => e.status === 502 && /socket closed/.test(e.message));
  assert.equal(messagesOf(id).length, count);
  I._setTransport({ send: async (p, jid, text) => { sentLog.push({ jid, text }); return { key: { id: `OUT${++waId}` } }; } });
});

test('replying to a LID-only chat goes to its jid and stays in that chat', async () => {
  const lid = '55555555';
  I._onEvent(event(incoming('no phone known', { key: { id: 'LID9', fromMe: false, remoteJid: `${lid}@lid` } }), { phone: null, lid }));
  const chat = db.prepare('SELECT * FROM wa_inbox_chats WHERE project_id = ? AND lid = ?').get(pid, lid);
  sentLog = [];
  await I.sendInChat({ projectId: pid, chatId: chat.id, text: 'hello lid' });
  assert.equal(sentLog[0].jid, `${lid}@lid`);
  assert.equal(messagesOf(chat.id).length, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wa_inbox_chats WHERE project_id = ? AND lid = ?').get(pid, lid).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM wa_inbox_chats WHERE project_id = ? AND phone IS NULL AND lid IS NULL").get(pid).n, 0, 'no stray empty chat');
});

test('replies that came in while offline still count as replies and opt-outs', () => {
  const phone = '966500000020';
  G.recordSent({ projectId: pid, phone, leadId, waMsgId: 'OFF1', text: 'Hi there?', newChat: true });
  I._onEvent(event(incoming('Yes please', { key: { id: 'OFFIN', fromMe: false, remoteJid: `${phone}@s.whatsapp.net` } }), { phone, upsert: 'append' }));
  assert.ok(db.prepare('SELECT replied_at FROM wa_sends WHERE wa_msg_id = ?').get('OFF1').replied_at);
});

test('a contact created later is linked; a deleted contact is unlinked', () => {
  const phone = '966500000030';
  I._onEvent(event(incoming('hi', { key: { id: 'LATE1', fromMe: false, remoteJid: `${phone}@s.whatsapp.net` } }), { phone }));
  assert.equal(chatOf(phone).lead_id, null);
  db.prepare(`INSERT INTO leads (id, name, phone, phone_valid, stage_id, created_at, project_id) VALUES ('lead_late', 'Late', '0500000030', 1, ?, ?, ?)`).run(stage, Date.now(), pid);
  I.relinkChats(pid);
  assert.equal(chatOf(phone).lead_id, 'lead_late', 'matched on the last nine digits');
  db.prepare("DELETE FROM leads WHERE id = 'lead_late'").run();
  I.relinkChats(pid);
  assert.equal(chatOf(phone).lead_id, null);
});

test('a contact from another workspace is never linked', () => {
  const other = db.prepare("INSERT INTO projects (id, name, created_at) VALUES ('proj_other', 'Other', ?) RETURNING id").get(Date.now()).id;
  const s2 = 'stage_other';
  db.prepare("INSERT INTO stages (id, name, color, sort_order, project_id) VALUES (?, 'S', '#000', 0, ?)").run(s2, other);
  db.prepare(`INSERT INTO leads (id, name, phone, phone_valid, stage_id, created_at, project_id) VALUES ('lead_other', 'Other', '+966500000040', 1, ?, ?, ?)`).run(s2, Date.now(), other);
  const phone = '966500000040';
  I._onEvent(event(incoming('hi', { key: { id: 'XW1', fromMe: false, remoteJid: `${phone}@s.whatsapp.net` } }), { phone }));
  assert.equal(chatOf(phone).lead_id, null);
});

test('an old install with legacy wa_chats / wa_messages tables migrates, and they are left alone', async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaddesk-legacy-'));
  const file = path.join(dir, 'old.db');
  const setup = new (db.constructor)(file);
  setup.exec(`CREATE TABLE wa_chats (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, wa_jid TEXT NOT NULL);
    CREATE TABLE wa_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT);
    INSERT INTO wa_chats (session_id, wa_jid) VALUES ('s', 'j');`);
  setup.close();
  const script = `import('./db.js').then(({ getDB }) => {
    const d = getDB();
    console.log(JSON.stringify({
      inbox: d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('wa_inbox_chats', 'wa_inbox_messages')").get().n,
      legacy: d.prepare('SELECT wa_jid FROM wa_chats').get().wa_jid,
      applied: !!d.prepare("SELECT 1 FROM schema_migrations WHERE id = '017-wa-inbox'").get(),
    }));
    d.close();
  })`;
  const r = spawnSync(process.execPath, ['-e', script], { cwd: path.join(import.meta.dirname, '..'), encoding: 'utf8',
    env: { ...process.env, DB_PATH: file, WA_AUTH_DIR: path.join(dir, 'wa'), GMAPS_JOBS_FILE: path.join(dir, 'j.json') } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()), { inbox: 2, legacy: 'j', applied: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migration 017 copies broadcast texts into chats', async () => {
  const { up } = await import('../migrations/017-wa-inbox.js');
  const phone = '966500000050';
  db.prepare(`INSERT INTO wa_sends (project_id, phone, lead_id, job_id, wa_msg_id, text_hash, text, new_chat, sent_at, delivered_at, legacy) VALUES (?, ?, ?, 'job_old', 'OLD1', 'h', 'old broadcast', 1, 1000, 2000, 0)`).run(pid, phone, leadId);
  db.prepare(`INSERT INTO wa_sends (project_id, phone, wa_msg_id, sent_at, legacy) VALUES (?, ?, 'OLD2', 500, 1)`).run(pid, phone);
  up(db);
  up(db); // running twice changes nothing
  const c = chatOf(phone);
  const msgs = messagesOf(c.id);
  assert.deepEqual(msgs.map(m => [m.text, m.source, m.status]), [['old broadcast', 'broadcast', 3]]);
  assert.equal(c.lead_id, leadId);
});
