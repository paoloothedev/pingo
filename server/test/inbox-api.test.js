// /api/inbox against a real server with a throwaway DB. Chats are seeded directly in the DB; WhatsApp isn't connected, so
// nothing can be sent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { io } from '../../client/node_modules/socket.io-client/build/esm-debug/index.js';
import { startServer, client } from './helpers.js';

const Database = createRequire(import.meta.url)('better-sqlite3');
let srv, db, admin, A, B, pidA, pidB, chatA, msgA;

function seedChat(pid, phone, name = 'Sara') {
  const chat = `chat_${pid.slice(-6)}_${phone}`;
  db.prepare(`INSERT INTO wa_inbox_chats (id, project_id, phone, jid, name, unread, last_message_at, last_text, last_direction, created_at)
    VALUES (?, ?, ?, ?, ?, 2, ?, 'Do you deliver?', 'in', ?)`).run(chat, pid, phone, `${phone}@s.whatsapp.net`, name, Date.now(), Date.now());
  const msg = `wam_${chat}`;
  db.prepare(`INSERT INTO wa_inbox_messages (id, project_id, chat_id, wa_msg_id, direction, source, type, text, at) VALUES (?, ?, ?, ?, 'in', 'contact', 'text', 'Do you deliver?', ?)`)
    .run(msg, pid, chat, `W${msg}`, Date.now());
  return { chat, msg };
}

before(async () => {
  srv = await startServer();
  db = new Database(srv.dbPath);
  admin = client(srv.base);
  await admin.login();
  pidA = (await admin.post('/projects', { name: 'Inbox A' })).body.id;
  pidB = (await admin.post('/projects', { name: 'Inbox B' })).body.id;
  A = admin.as(pidA);
  B = admin.as(pidB);
  ({ chat: chatA, msg: msgA } = seedChat(pidA, '966500000001'));
});
after(async () => { db?.close(); await srv?.stop(); });

test('lists chats, reads messages, unread clears', async () => {
  const list = await A.get('/inbox/chats');
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.chats[0].name, 'Sara');
  assert.equal((await A.get('/inbox/unread')).body.chats, 1);
  const msgs = await A.get(`/inbox/chats/${chatA}/messages`);
  assert.equal(msgs.body.messages[0].text, 'Do you deliver?');
  assert.equal((await A.post(`/inbox/chats/${chatA}/read`)).status, 200);
  assert.equal((await A.get('/inbox/unread')).body.chats, 0);
});

test('search finds message text; odd characters are literal', async () => {
  assert.equal((await A.get('/inbox/chats?q=deliver')).body.total, 1);
  assert.equal((await A.get('/inbox/chats?q=%25')).body.total, 0);
  assert.equal((await A.get('/inbox/chats?q=nothing')).body.total, 0);
});

test('another workspace sees and changes nothing', async () => {
  assert.equal((await B.get('/inbox/chats')).body.total, 0);
  assert.equal((await B.get(`/inbox/chats/${chatA}`)).status, 404);
  assert.equal((await B.get(`/inbox/chats/${chatA}/messages`)).status, 404);
  assert.equal((await B.post(`/inbox/chats/${chatA}/read`)).status, 404);
  assert.equal((await B.post(`/inbox/chats/${chatA}/messages`, { text: 'hi' })).status, 404);
  assert.equal((await B.req('PATCH', `/inbox/chats/${chatA}`, { status: 'done' })).status, 404);
  assert.equal((await B.post(`/inbox/chats/${chatA}/contact`)).status, 404);
  assert.equal((await B.get(`/inbox/media/${msgA}`)).status, 404);
  const lead = (await A.post('/leads', { name: 'A lead', phone: '+966500000099' })).body;
  assert.equal((await B.post('/inbox/chats', { lead_id: lead.id })).status, 404);
  assert.equal((await A.get(`/inbox/chats/${chatA}`)).body.status, 'open');
});

test('sending while WhatsApp is disconnected fails with the reason and records nothing', async () => {
  const r = await A.post(`/inbox/chats/${chatA}/messages`, { text: 'Hello' });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /not connected/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wa_inbox_messages WHERE chat_id = ?').get(chatA).n, 1);
  assert.equal((await A.post(`/inbox/chats/${chatA}/messages`, { text: '  ' })).status, 400);
});

test('assign and done; assignee must belong to the workspace; a new message reopens', async () => {
  const me = (await A.get('/auth/me')).body;
  const r = await A.req('PATCH', `/inbox/chats/${chatA}`, { assigned_to: me.id, status: 'done' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'done');
  assert.equal((await A.get('/inbox/chats?filter=mine')).body.total, 0, 'done chats leave Mine');
  assert.equal((await A.get('/inbox/chats?filter=done')).body.total, 1);
  assert.equal((await A.get('/inbox/chats')).body.total, 0);
  await A.req('PATCH', `/inbox/chats/${chatA}`, { status: 'open' });
  assert.equal((await A.get('/inbox/chats?filter=mine')).body.total, 1);

  const outsider = (await admin.post('/accounts', { username: 'outsider', password: 'pw123456', permissions: ['leads.view'], projectIds: [pidB] })).body;
  assert.equal((await A.req('PATCH', `/inbox/chats/${chatA}`, { assigned_to: outsider.id })).status, 400);
  assert.equal((await A.req('PATCH', `/inbox/chats/${chatA}`, { status: 'nonsense' })).status, 400);
});

test('open a chat with a contact or number; local numbers use the workspace country code', async () => {
  await A.put('/settings', { key: 'country_code', value: '20' });
  const lead = (await A.post('/leads', { name: 'Local', phone: '01000000123' })).body;
  const r = await A.post('/inbox/chats', { lead_id: lead.id });
  assert.equal(r.status, 201);
  const chat = (await A.get(`/inbox/chats/${r.body.id}`)).body;
  assert.equal(chat.phone, '201000000123');
  assert.equal(chat.lead_id, lead.id);
  assert.equal((await A.get('/inbox/chats')).body.chats.some(c => c.id === r.body.id), false, 'an empty chat stays out of the list');
  assert.equal((await A.post('/inbox/chats', { phone: '+20 100 000 0123' })).body.id, r.body.id, 'same person, same chat');
  assert.equal((await A.post('/inbox/chats', { phone: '123' })).status, 400);
});

test('save an unknown person as a contact, once', async () => {
  const { chat } = seedChat(pidA, '966500000077', 'New Person');
  const r = await A.post(`/inbox/chats/${chat}/contact`);
  assert.equal(r.status, 201);
  const lead = (await A.get(`/leads/${r.body.lead_id}`)).body;
  assert.deepEqual([lead.name, lead.phone, lead.source, lead.status], ['New Person', '+966500000077', 'whatsapp', 'active']);
  assert.equal((await A.get(`/inbox/chats/${chat}`)).body.lead_id, r.body.lead_id);
  assert.equal((await A.post(`/inbox/chats/${chat}/contact`)).status, 409);
});

test('roles: a viewer reads but cannot send or manage; no WhatsApp permission means no access', async () => {
  await admin.post('/accounts', { username: 'viewer1', password: 'pw123456', permissions: ['whatsapp.view'], projectIds: [pidA] });
  await admin.post('/accounts', { username: 'noperm1', password: 'pw123456', permissions: ['leads.view'], projectIds: [pidA] });
  const viewer = client(srv.base, pidA);
  await viewer.login('viewer1', 'pw123456');
  assert.equal((await viewer.get('/inbox/chats?filter=all')).status, 200);
  assert.equal((await viewer.post(`/inbox/chats/${chatA}/messages`, { text: 'hi' })).status, 403);
  assert.equal((await viewer.req('PATCH', `/inbox/chats/${chatA}`, { status: 'done' })).status, 403);
  assert.equal((await viewer.post('/inbox/chats', { phone: '+966500000111' })).status, 403);
  const noperm = client(srv.base, pidA);
  await noperm.login('noperm1', 'pw123456');
  assert.equal((await noperm.get('/inbox/chats')).status, 403);
  assert.equal((await noperm.get(`/inbox/chats/${chatA}/messages`)).status, 403);
  assert.equal((await noperm.get(`/inbox/media/${msgA}`)).status, 403);
});

test('files are served only inside the workspace, as downloads that cannot run on this site', async () => {
  const dir = path.join(path.dirname(srv.dbPath), 'wa_media', pidA);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, msgA), '<script>alert(1)</script>');
  db.prepare("UPDATE wa_inbox_messages SET media_path = ?, media_mime = 'text/html', media_state = 'saved' WHERE id = ?").run(msgA, msgA);
  const login = await fetch(srv.base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const r = await fetch(`${srv.base}/inbox/media/${msgA}`, { headers: { Cookie: cookie, 'X-Project-Id': pidA } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /attachment/);
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  db.prepare("UPDATE wa_inbox_messages SET media_path = '../../test.db' WHERE id = ?").run(msgA);
  const evil = await fetch(`${srv.base}/inbox/media/${msgA}`, { headers: { Cookie: cookie, 'X-Project-Id': pidA } });
  assert.equal(evil.status, 404, 'a stored path cannot climb out of the media folder');
});

test('merging contacts moves the chat link', async () => {
  const one = (await A.post('/leads', { name: 'Dup one', phone: '+966500000201' })).body;
  const two = (await A.post('/leads', { name: 'Dup two', phone: '+966500000202' })).body;
  const opened = (await A.post('/inbox/chats', { lead_id: two.id })).body.id;
  assert.equal((await A.post('/contacts/merge', { primaryId: one.id, duplicateIds: [two.id] })).status, 200);
  assert.equal(db.prepare('SELECT lead_id FROM wa_inbox_chats WHERE id = ?').get(opened).lead_id, one.id);
});

test('backup carries the history; restore links it to the restored contacts; deleting a workspace removes it', async () => {
  const P = (await admin.post('/projects', { name: 'Backup inbox' })).body.id;
  const C = admin.as(P);
  const lead = (await C.post('/leads', { name: 'Keep', phone: '+966500000301' })).body;
  const { chat } = seedChat(P, '966500000301', 'Keep');
  db.prepare('UPDATE wa_inbox_chats SET lead_id = ? WHERE id = ?').run(lead.id, chat);
  const backup = (await C.get('/export')).body;
  assert.equal(backup.wa_inbox_chats.length, 1);
  assert.equal(backup.wa_inbox_messages.length, 1);
  assert.equal((await C.post('/import/backup', backup)).status, 200);
  const list = (await C.get('/inbox/chats')).body;
  assert.equal(list.total, 1);
  assert.equal(list.chats[0].name, 'Keep');
  assert.notEqual(list.chats[0].lead_id, null);
  assert.equal((await C.get(`/inbox/chats/${list.chats[0].id}/messages`)).body.messages[0].text, 'Do you deliver?');

  const dir = path.join(path.dirname(srv.dbPath), 'wa_media', P);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'file'), 'x');
  assert.equal((await admin.del(`/projects/${P}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wa_inbox_chats WHERE project_id = ?').get(P).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wa_inbox_messages WHERE project_id = ?').get(P).n, 0);
  assert.equal(fs.existsSync(dir), false, 'files go too');
});

test('live updates reach only people who may see WhatsApp in that workspace, and stop when access is removed', async () => {
  const origin = srv.base.replace(/\/api$/, '');
  const made = (await admin.post('/accounts', { username: 'live1', password: 'pw123456', permissions: ['whatsapp.view'], projectIds: [pidA] })).body;
  await admin.post('/accounts', { username: 'live2', password: 'pw123456', permissions: ['whatsapp.view'], projectIds: [pidB] });
  const connect = async (username) => {
    const login = await fetch(srv.base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'pw123456' }) });
    const s = io(origin, { transports: ['websocket'], extraHeaders: { Cookie: login.headers.get('set-cookie').split(';')[0] }, reconnection: false });
    await new Promise(r => s.on('connect', r));
    return s;
  };
  const settle = () => new Promise(r => setTimeout(r, 300));
  const member = await connect('live1');
  const other = await connect('live2');
  const seenMember = [], seenOther = [];
  member.on('wa_inbox', p => seenMember.push(p));
  other.on('wa_inbox', p => seenOther.push(p));
  member.emit('join_project', pidA);
  other.emit('join_project', pidA);
  await settle();

  await A.req('PATCH', `/inbox/chats/${chatA}`, { status: 'open' });
  await settle();
  assert.deepEqual(seenMember, [{ projectId: pidA, chatId: chatA }], 'says which chat, carries no text');
  assert.equal(seenOther.length, 0);

  await admin.put(`/accounts/${made.id}`, { permissions: ['leads.view'] });
  await A.req('PATCH', `/inbox/chats/${chatA}`, { status: 'open' });
  await settle();
  assert.equal(seenMember.length, 1, 'no more updates once the permission is gone');
  member.close();
  other.close();
});
