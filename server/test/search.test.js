import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './helpers.js';

let srv, admin, P, Q, pid;
before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  await admin.login();
  pid = (await admin.post('/projects', { name: 'P' })).body.id;
  P = admin.as(pid);
  Q = admin.as((await admin.post('/projects', { name: 'Q' })).body.id);
  await P.post('/contacts', { name: 'Omar Hassan', phone: '201000000701', email: 'omar@nile.test' });
  await P.post('/companies', { name: 'Nile Bakery', website: 'https://nilebakery.example' });
  await P.post('/deals', { title: 'Nile Bakery POS' });
  await Q.post('/contacts', { name: 'Nile Secret', phone: '201000000702' });
});
after(async () => { await srv?.stop(); });

test('global search spans contacts, companies and deals within the workspace', async () => {
  const r = (await P.get('/search?q=nile')).body;
  assert.deepEqual(r.contacts.map(c => c.name), ['Omar Hassan'], 'matched by email');
  assert.deepEqual(r.companies.map(c => c.name), ['Nile Bakery']);
  assert.deepEqual(r.deals.map(d => d.title), ['Nile Bakery POS']);
  assert.equal((await P.get('/search?q=0000701')).body.contacts[0].name, 'Omar Hassan', 'phone digits');
  assert.deepEqual((await P.get('/search?q=n')).body, { contacts: [], companies: [], deals: [] });
  assert.ok(!(await Q.get('/search?q=nile')).body.contacts.some(c => c.name === 'Omar Hassan'));
});

test('search respects permissions', async () => {
  await admin.post('/accounts', { username: 'dealsonly', password: 'pw123456', permissions: ['deals.view'], projectIds: [pid] });
  const u = client(srv.base); await u.login('dealsonly', 'pw123456');
  const r = (await u.as(pid).get('/search?q=nile')).body;
  assert.equal(r.contacts.length, 0);
  assert.equal(r.deals.length, 1);
});

test('saved views are per user unless shared', async () => {
  const mine = (await P.post('/views', { entity: 'contact', name: 'Hot customers', filters: { lifecycle: 'customer', tag: 'hot' } })).body;
  await P.post('/views', { entity: 'deal', name: 'Team pipeline', filters: { owner: 'none' }, shared: true });
  assert.equal((await P.post('/views', { entity: 'contact', name: '', filters: {} })).status, 400);
  assert.deepEqual((await P.get('/views?entity=contact')).body.map(v => v.name), ['Hot customers']);

  await admin.post('/accounts', { username: 'teammate', password: 'pw123456', permissions: ['leads.view'], projectIds: [pid] });
  const t = client(srv.base); await t.login('teammate', 'pw123456');
  const theirs = (await t.as(pid).get('/views')).body.map(v => v.name);
  assert.deepEqual(theirs, ['Team pipeline']);
  assert.equal((await t.as(pid).del(`/views/${mine.id}`)).status, 404);
  assert.equal((await P.del(`/views/${mine.id}`)).status, 200);
});
