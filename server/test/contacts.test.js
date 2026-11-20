import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startServer, client } from './helpers.js';
import * as m001 from '../migrations/001-baseline.js';
import * as m006 from '../migrations/006-contacts.js';

const Database = createRequire(import.meta.url)('better-sqlite3');

test('migration 006 merges clients into contacts without duplicates', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leaddesk-m006-'));
  const db = new Database(path.join(tmp, 'm.db'));
  try {
    m001.up(db);
    const pid = db.prepare('SELECT id FROM projects').get().id;
    db.prepare("INSERT INTO stages (id, name, color, sort_order, project_id) VALUES ('st1', 'Cold', '#000', 0, ?)").run(pid);
    db.prepare("INSERT INTO leads (id, name, phone, email, notes, stage_id, created_at, project_id) VALUES ('L1', 'Linked', '201', '', 'lead note', 'st1', 1, ?)").run(pid);
    db.prepare("INSERT INTO tags (id, name, color, created_at, project_id) VALUES ('T1', 'vip', '#000', 1, ?)").run(pid);
    const ins = db.prepare("INSERT INTO clients (id, lead_id, name, phone, email, notes, stage, source, assigned_to, created_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)");
    ins.run('C1', 'L1', 'Linked', '201', 'a@b.c', 'client note', 'negotiating', 'lead', null, pid);
    ins.run('C2', null, 'Walk-in', '202', '', '', 'closed', 'referral', null, pid);
    db.prepare("INSERT INTO client_tags (client_id, tag_id) VALUES ('C1', 'T1')").run();

    m006.up(db);
    m006.up(db); // idempotent: second run must not duplicate anything

    const leads = db.prepare('SELECT * FROM leads ORDER BY name').all();
    assert.equal(leads.length, 2);
    const linked = leads.find(l => l.id === 'L1');
    assert.equal(linked.lifecycle, 'qualified');
    assert.equal(linked.email, 'a@b.c', 'empty field filled from client');
    assert.equal(linked.notes, 'lead note\n\nclient note');
    assert.deepEqual(db.prepare("SELECT tag_id FROM lead_tags WHERE lead_id = 'L1'").all(), [{ tag_id: 'T1' }]);
    const walkin = leads.find(l => l.name === 'Walk-in');
    assert.equal(walkin.lifecycle, 'customer');
    assert.equal(walkin.source, 'referral');
    assert.equal(walkin.stage_id, 'st1');
    assert.equal(db.prepare('SELECT COUNT(*) c FROM client_contact_map').get().c, 2);
  } finally {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

let srv, admin, P, Q, pid, qid;
before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  await admin.login();
  pid = (await admin.post('/projects', { name: 'P' })).body.id;
  qid = (await admin.post('/projects', { name: 'Q' })).body.id;
  P = admin.as(pid);
  Q = admin.as(qid);
});
after(async () => { await srv?.stop(); });

test('contacts API creates and updates lifecycle, owner, source and custom fields', async () => {
  await P.post('/custom-fields', { entity: 'contact', label: 'Budget', type: 'money' });
  const c = (await P.post('/contacts', { name: 'Acme buyer', phone: '201000000031', lifecycle: 'qualified', custom: { budget: 5000 } })).body;
  assert.equal(c.lifecycle, 'qualified');
  assert.equal(c.owner_id, 'admin', 'creator is default owner');
  assert.equal(c.source, 'manual');
  assert.deepEqual(c.custom, { budget: 5000 });
  assert.ok(c.updated_at);

  const u = (await P.put(`/contacts/${c.id}`, { lifecycle: 'customer', owner_id: null })).body;
  assert.equal(u.lifecycle, 'customer');
  assert.equal(u.owner_id, null);
  assert.deepEqual(u.custom, { budget: 5000 }, 'custom untouched when not sent');

  assert.equal((await P.get(`/leads/${c.id}`)).body.name, 'Acme buyer', '/leads and /contacts are the same records');
});

test('contacts API validates lifecycle, custom and owner membership', async () => {
  assert.equal((await P.post('/contacts', { name: 'x', lifecycle: 'vip' })).status, 400);
  assert.equal((await P.post('/contacts', { name: 'x', custom: [1] })).status, 400);
  const onlyQ = (await admin.post('/accounts', { username: 'onlyq', password: 'pw123456', permissions: ['leads.view'], projectIds: [qid] })).body;
  assert.equal((await P.post('/contacts', { name: 'x', owner_id: onlyQ.id })).status, 400, 'owner from another workspace');
  assert.equal((await Q.post('/contacts', { name: 'x', phone: '201000000032', owner_id: onlyQ.id })).status, 201);
});

test('lifecycle and owner filters, bulk lifecycle and owner', async () => {
  const mk = async (name, extra = {}) => (await P.post('/contacts', { name, phone: '2010000001' + Math.floor(Math.random() * 90 + 10), ...extra })).body.id;
  const a = await mk('F-lead');
  const b = await mk('F-cust', { lifecycle: 'customer' });
  const c = await mk('F-none', { owner_id: null });

  const names = async (qs) => (await P.get(`/contacts?page=1&limit=100&search=F-&${qs}`)).body.items.map(x => x.name).sort();
  assert.deepEqual(await names('lifecycle=customer'), ['F-cust']);
  assert.deepEqual(await names('lifecycle=lead,customer'), ['F-cust', 'F-lead', 'F-none']);
  assert.deepEqual(await names('owner=none'), ['F-none']);
  assert.deepEqual(await names('owner=me'), ['F-cust', 'F-lead']);

  assert.equal((await P.post('/contacts/bulk', { ids: [a, c], action: 'lifecycle', value: 'qualified' })).status, 200);
  assert.deepEqual(await names('lifecycle=qualified'), ['F-lead', 'F-none']);
  assert.equal((await P.post('/contacts/bulk', { ids: [a], action: 'lifecycle', value: 'nope' })).status, 400);
  await P.post('/contacts/bulk', { ids: [c], action: 'owner', value: 'admin' });
  assert.deepEqual(await names('owner=none'), []);

  await P.post('/contacts/bulk', { ids: [b], action: 'convert' });
  assert.equal((await P.get(`/contacts/${b}`)).body.lifecycle, 'customer', 'convert never downgrades');
});
