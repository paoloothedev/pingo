import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './helpers.js';

let srv, P, Q;
before(async () => {
  srv = await startServer();
  const admin = client(srv.base);
  await admin.login();
  P = admin.as((await admin.post('/projects', { name: 'P' })).body.id);
  Q = admin.as((await admin.post('/projects', { name: 'Q' })).body.id);
});
after(async () => { await srv?.stop(); });

test('finds duplicates by phone digits and email, merges everything into the primary', async () => {
  const tag1 = (await P.post('/tags', { name: 't1' })).body.id;
  const tag2 = (await P.post('/tags', { name: 't2' })).body.id;
  const a = (await P.post('/contacts', { name: 'Cafe Nour', phone: '201000000601', tag_ids: [tag1], notes: 'first' })).body;
  const b = (await P.post('/contacts', { name: 'Cafe Nour (2)', phone: '+20 100 000 0601', email: 'nour@cafe.test', tag_ids: [tag2], lifecycle: 'customer', notes: 'second' })).body;
  const c = (await P.post('/contacts', { name: 'Nour again', phone: '201000000699', email: 'NOUR@cafe.test' })).body;
  await P.post('/contacts', { name: 'Unrelated', phone: '201000000602' });
  const deal = (await P.post('/deals', { title: 'Order', contact_id: b.id })).body.id;
  const camp = (await P.post('/campaigns', { name: 'c', count: 0 })).body.id;
  await P.post(`/campaigns/${camp}/leads`, { leadIds: [c.id] });

  const groups = (await P.get('/contacts/duplicates')).body;
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(g => g.reason).sort(), ['email', 'phone']);

  const r = await P.post('/contacts/merge', { primaryId: a.id, duplicateIds: [b.id, c.id, a.id] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.merged, 2);

  const m = (await P.get(`/contacts/${a.id}`)).body;
  assert.equal(m.name, 'Cafe Nour', 'primary values win');
  assert.equal(m.email, 'nour@cafe.test', 'empty fields filled');
  assert.equal(m.lifecycle, 'customer', 'highest lifecycle kept');
  assert.equal(m.notes, 'first\n\nsecond');
  assert.deepEqual(m.tags.map(t => t.name).sort(), ['t1', 't2']);
  assert.deepEqual(m.campaigns.map(x => x.id), [camp]);
  assert.equal(m.deals[0].id, deal);
  assert.equal((await P.get(`/contacts/${b.id}`)).status, 404);
  assert.equal((await P.get('/contacts/duplicates')).body.length, 0);
});

test('merge refuses ids from another workspace', async () => {
  const p = (await P.post('/contacts', { name: 'Mine', phone: '201000000610' })).body.id;
  const q = (await Q.post('/contacts', { name: 'Theirs', phone: '201000000610' })).body.id;
  assert.equal((await P.post('/contacts/merge', { primaryId: p, duplicateIds: [q] })).status, 400);
  assert.equal((await Q.post('/contacts/merge', { primaryId: p, duplicateIds: [q] })).status, 404);
  assert.equal((await Q.get(`/contacts/${q}`)).status, 200);
  assert.equal((await P.get('/contacts/duplicates')).body.length, 0, 'duplicates never span workspaces');
});

test('"not duplicates" hides a group permanently, per workspace', async () => {
  await P.post('/contacts', { name: 'Chain A', phone: '201000000620' });
  await P.post('/contacts', { name: 'Chain B', phone: '201000000620' });
  await Q.post('/contacts', { name: 'Q1', phone: '201000000620' });
  await Q.post('/contacts', { name: 'Q2', phone: '201000000620' });
  const g = (await P.get('/contacts/duplicates')).body.find(x => x.value === '201000000620');
  assert.ok(g);
  assert.equal((await P.post('/contacts/duplicates/dismiss', { reason: g.reason, value: g.value })).status, 200);
  assert.ok(!(await P.get('/contacts/duplicates')).body.some(x => x.value === '201000000620'));
  assert.ok((await Q.get('/contacts/duplicates')).body.some(x => x.value === '201000000620'), 'other workspace unaffected');
  assert.equal((await P.post('/contacts/duplicates/dismiss', { reason: 'name', value: 'x' })).status, 400);
});
