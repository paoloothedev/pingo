import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startServer, client } from './helpers.js';
import * as m001 from '../migrations/001-baseline.js';
import * as m002 from '../migrations/002-project-members.js';
import * as m006 from '../migrations/006-contacts.js';
import * as m007 from '../migrations/007-companies.js';
import * as m008 from '../migrations/008-deals.js';

const Database = createRequire(import.meta.url)('better-sqlite3');

test('migration 008 seeds a pipeline, converts legacy clients to deals, grants deal perms', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leaddesk-m008-'));
  const db = new Database(path.join(tmp, 'm.db'));
  try {
    m001.up(db);
    const pid = db.prepare('SELECT id FROM projects').get().id;
    db.prepare("INSERT INTO accounts (id, username, password_hash, role, permissions, created_at) VALUES ('u1', 'u1', 'x', 'user', '[\"leads.view\",\"leads.edit\"]', 1)").run();
    m002.up(db);
    db.prepare("INSERT INTO stages (id, name, color, sort_order, project_id) VALUES ('st1', 'Cold', '#000', 0, ?)").run(pid);
    db.prepare("INSERT INTO leads (id, name, stage_id, created_at, project_id) VALUES ('L1', 'Won shop', 'st1', 1, ?)").run(pid);
    db.prepare("INSERT INTO leads (id, name, stage_id, created_at, project_id) VALUES ('L2', 'Talking shop', 'st1', 1, ?)").run(pid);
    const ins = db.prepare("INSERT INTO clients (id, lead_id, name, stage, assigned_to, created_at, updated_at, project_id) VALUES (?, ?, ?, ?, ?, 1, 5, ?)");
    ins.run('C1', 'L1', 'Won shop', 'closed', 'u1', pid);
    ins.run('C2', 'L2', 'Talking shop', 'negotiating', null, pid);
    m006.up(db); m007.up(db); m008.up(db);
    m008.up(db); // idempotent

    const stages = db.prepare('SELECT * FROM pipeline_stages ORDER BY sort_order').all();
    assert.deepEqual(stages.map(s => s.name), ['Qualified', 'Contact made', 'Proposal', 'Negotiation', 'Won', 'Lost']);
    const deals = db.prepare('SELECT d.*, s.name AS stage FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id ORDER BY d.title').all();
    assert.equal(deals.length, 2);
    assert.deepEqual(deals.map(d => [d.title, d.stage, d.status, d.contact_id]), [
      ['Talking shop', 'Negotiation', 'open', 'L2'],
      ['Won shop', 'Won', 'won', 'L1'],
    ]);
    assert.equal(deals[1].won_at, 5);
    assert.equal(deals[1].owner_id, 'u1');
    const perms = JSON.parse(db.prepare("SELECT permissions FROM accounts WHERE id = 'u1'").get().permissions);
    assert.ok(perms.includes('deals.view') && perms.includes('deals.edit') && !perms.includes('deals.delete'));
  } finally {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

let srv, admin, P, Q, pipe;
const stageByName = (name) => pipe.stages.find(s => s.name === name);
before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  await admin.login();
  P = admin.as((await admin.post('/projects', { name: 'P' })).body.id);
  Q = admin.as((await admin.post('/projects', { name: 'Q' })).body.id);
  pipe = (await P.get('/pipelines')).body[0];
});
after(async () => { await srv?.stop(); });

test('new workspaces get a default Sales pipeline', async () => {
  assert.equal(pipe.name, 'Sales');
  assert.equal(pipe.stages.length, 6);
  assert.deepEqual(pipe.stages.filter(s => s.kind !== 'open').map(s => s.kind), ['won', 'lost']);
});

test('deal lifecycle: create, move, win upgrades contact, lose with reason, history', async () => {
  const contact = (await P.post('/contacts', { name: 'Buyer', phone: '201000000051' })).body;
  const d = (await P.post('/deals', { title: 'Website redesign', value: 1200, contact_id: contact.id })).body;
  assert.equal(d.stage.name, 'Qualified');
  assert.equal(d.status, 'open');
  assert.equal(d.currency, 'USD');
  assert.equal(d.contact.name, 'Buyer');

  await P.post(`/deals/${d.id}/move`, { stage_id: stageByName('Proposal').id });
  const won = (await P.post(`/deals/${d.id}/move`, { stage_id: stageByName('Won').id })).body;
  assert.equal(won.status, 'won');
  assert.ok(won.won_at);
  assert.equal((await P.get(`/contacts/${contact.id}`)).body.lifecycle, 'customer');

  const lost = (await P.put(`/deals/${d.id}`, { stage_id: stageByName('Lost').id, lost_reason: 'Budget' })).body;
  assert.equal(lost.status, 'lost');
  assert.equal(lost.lost_reason, 'Budget');
  assert.equal(lost.won_at, null);

  const detail = (await P.get(`/deals/${d.id}`)).body;
  assert.deepEqual(detail.history.map(h => h.stage_name), ['Lost', 'Won', 'Proposal', 'Qualified']);
  assert.equal((await P.get(`/contacts/${contact.id}`)).body.deals.length, 1);
});

test('validation', async () => {
  assert.equal((await P.post('/deals', { title: '' })).status, 400);
  assert.equal((await P.post('/deals', { title: 'x', value: -5 })).status, 400);
  assert.equal((await P.post('/deals', { title: 'x', currency: 'dollars' })).status, 400);
  assert.equal((await P.post('/deals', { title: 'x', expected_close: 'not a date' })).status, 400);
  const d = (await P.post('/deals', { title: 'x', expected_close: '2026-12-31', currency: 'egp' })).body;
  assert.equal(d.currency, 'EGP');
  assert.equal(new Date(d.expected_close).getUTCFullYear(), 2026);
});

test('board groups deals per stage with totals', async () => {
  const s = stageByName('Negotiation').id;
  await P.post('/deals', { title: 'B1', value: 100, stage_id: s });
  await P.post('/deals', { title: 'B2', value: 300, stage_id: s });
  const board = (await P.get(`/deals/board?pipeline=${pipe.id}`)).body;
  const col = board.stages.find(c => c.id === s);
  assert.equal(col.count, 2);
  assert.equal(col.total_value, 400);
  assert.equal(col.weighted_value, 300);
  assert.deepEqual(col.deals.map(d => d.title).sort(), ['B1', 'B2']);
});

test('pipeline & stage management', async () => {
  const p2 = (await P.post('/pipelines', { name: 'Partnerships', stages: [{ name: 'Intro' }, { name: 'Signed', kind: 'won', probability: 100 }] })).body;
  assert.deepEqual(p2.stages.map(s => s.name), ['Intro', 'Signed']);
  const extra = (await P.post(`/pipelines/${p2.id}/stages`, { name: 'Pilot', probability: 60, rot_days: 7 })).body;
  const deal = (await P.post('/deals', { title: 'Partner A', pipeline_id: p2.id })).body;
  assert.equal(deal.stage.name, 'Intro');
  assert.equal((await P.del(`/pipelines/${p2.id}`)).status, 400, 'has deals');
  assert.equal((await P.del(`/pipelines/stages/${deal.stage_id}?moveTo=${stageByName('Won').id}`)).status, 400, 'moveTo must be same pipeline');
  assert.equal((await P.del(`/pipelines/stages/${deal.stage_id}?moveTo=${extra.id}`)).status, 200);
  assert.equal((await P.get(`/deals/${deal.id}`)).body.stage.name, 'Pilot');
  await P.del(`/deals/${deal.id}`);
  assert.equal((await P.del(`/pipelines/${p2.id}`)).status, 200);
  assert.equal((await P.del(`/pipelines/${pipe.id}`)).status, 400, 'last pipeline');
});

test('deleting a contact keeps its deals', async () => {
  const c = (await P.post('/contacts', { name: 'Temp', phone: '201000000052' })).body.id;
  const d = (await P.post('/deals', { title: 'Keep me', contact_id: c })).body.id;
  await P.del(`/contacts/${c}`);
  assert.equal((await P.get(`/deals/${d}`)).body.contact_id, null);
});

test('deals are isolated between workspaces and need deals permissions', async () => {
  const d = (await P.post('/deals', { title: 'Private' })).body.id;
  const qContact = (await Q.post('/contacts', { name: 'Q', phone: '201000000053' })).body.id;
  assert.equal((await Q.get(`/deals/${d}`)).status, 404);
  assert.equal((await Q.post(`/deals/${d}/move`, { stage_id: stageByName('Won').id })).status, 404);
  assert.equal((await Q.post('/deals', { title: 'x', stage_id: stageByName('Won').id })).status, 400);
  assert.equal((await Q.post('/deals', { title: 'x', contact_id: (await P.get('/contacts')).body[0].id })).status, 400);
  assert.equal((await P.post('/deals', { title: 'x', contact_id: qContact })).status, 400);
  assert.equal((await Q.put(`/pipelines/stages/${stageByName('Won').id}`, { name: 'hacked' })).status, 404);
  assert.ok(!(await Q.get('/deals')).body.some(x => x.id === d));

  const pid = (await admin.get('/projects')).body.find(p => p.name === 'P').id;
  const u = (await admin.post('/accounts', { username: 'leadsonly', password: 'pw123456', permissions: ['leads.view'], projectIds: [pid] })).body;
  const uc = client(srv.base); await uc.login('leadsonly', 'pw123456');
  assert.equal((await uc.as(pid).get('/deals')).status, 403);
  assert.equal((await uc.as(pid).get('/pipelines')).status, 200, 'pipelines are reference data');
});
