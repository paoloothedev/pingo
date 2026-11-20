import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './helpers.js';

let srv, P, stages, tag;
before(async () => {
  srv = await startServer();
  const root = client(srv.base);
  await root.login();
  P = root.as((await root.post('/projects', { name: 'Lists' })).body.id);
  stages = (await P.get('/stages')).body;
  tag = (await P.post('/tags', { name: 'hot' })).body.id;
  for (let i = 0; i < 23; i++) {
    const r = await P.post('/leads', {
      name: `Lead ${String(i).padStart(2, '0')}`, phone: `2010000001${String(i).padStart(2, '0')}`,
      stage_id: stages[i % 2].id, tag_ids: i % 3 === 0 ? [tag] : [], verified: true,
    });
    assert.equal(r.status, 201);
  }
});
after(async () => { await srv?.stop(); });

test('leads list paginates with a total', async () => {
  const p1 = (await P.get('/leads?page=1&limit=10&sortBy=name&sortOrder=asc')).body;
  const p3 = (await P.get('/leads?page=3&limit=10&sortBy=name&sortOrder=asc')).body;
  assert.equal(p1.total, 23);
  assert.equal(p1.items.length, 10);
  assert.equal(p3.items.length, 3);
  assert.equal(p1.items[0].name, 'Lead 00');
  assert.equal(p3.items[2].name, 'Lead 22');
});

test('filters apply before paging', async () => {
  const r = (await P.get(`/leads?page=1&limit=5&tag=${tag}`)).body;
  assert.equal(r.total, 8);
  assert.ok(r.items.every(l => l.tags.some(t => t.id === tag)));
});

test('unpaged response is unchanged and matches paged enrichment', async () => {
  const all = (await P.get('/leads?sortBy=name&sortOrder=asc')).body;
  assert.ok(Array.isArray(all));
  assert.equal(all.length, 23);
  const paged = (await P.get('/leads?page=1&limit=100&sortBy=name&sortOrder=asc')).body.items;
  assert.deepEqual(paged, all);
  assert.equal(all[0].stageHistory.length, 1);
  assert.equal(typeof all[0].verified, 'boolean');
});

test('stages carry lead counts', async () => {
  const s = (await P.get('/stages')).body;
  assert.equal(s[0].lead_count, 12);
  assert.equal(s[1].lead_count, 11);
});

test('clients list paginates and filters by stage', async () => {
  for (const [name, stage] of [['C1', 'new'], ['C2', 'won'], ['C3', 'new']]) {
    await P.post('/clients', { name, stage, tag_ids: [tag] });
  }
  const r = (await P.get('/clients?page=1&limit=2&stage=new')).body;
  assert.equal(r.total, 2);
  assert.ok(r.items.every(c => c.stage === 'new' && c.tags.length === 1));
  assert.ok(Array.isArray((await P.get('/clients')).body));
});

test('stats count customers from contacts and include deal metrics', async () => {
  const c = (await P.post('/contacts', { name: 'Paying', phone: '201000000199', lifecycle: 'customer' })).body.id;
  const won = (await P.get('/pipelines')).body[0].stages.find(s => s.kind === 'won').id;
  await P.post('/deals', { title: 'Open one', value: 50 });
  await P.post('/deals', { title: 'Won one', value: 70, stage_id: won, contact_id: c });
  const s = (await P.get('/stats')).body;
  assert.equal(s.totalClients, 1);
  assert.equal(s.openDeals, 1);
  assert.equal(s.openDealValue, 50);
  assert.equal(s.wonDealsThisMonth, 1);
  assert.equal(s.wonValueThisMonth, 70);
});
