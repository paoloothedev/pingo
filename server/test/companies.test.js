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

test('company CRUD with domain normalisation and owner default', async () => {
  await P.post('/custom-fields', { entity: 'company', label: 'Tier', type: 'select', options: ['gold', 'silver'] });
  const c = (await P.post('/companies', { name: 'Acme Foods', website: 'https://www.acme.example/menu', industry: 'Restaurants' })).body;
  assert.equal(c.domain, 'acme.example');
  assert.equal(c.owner_id, 'admin');
  assert.equal((await P.post('/companies', { name: '' })).status, 400);
  const u = (await P.put(`/companies/${c.id}`, { city: 'Cairo', custom: { tier: 'gold' } })).body;
  assert.equal(u.city, 'Cairo');
  assert.deepEqual(u.custom, { tier: 'gold' });
  const list = (await P.get('/companies?page=1&limit=10&search=acme')).body;
  assert.equal(list.total, 1);
  assert.equal(list.items[0].contact_count, 0);
});

test('contacts link to companies (create, bulk, link endpoint) and delete unlinks', async () => {
  const co = (await P.post('/companies', { name: 'Beta LLC' })).body.id;
  const c1 = (await P.post('/contacts', { name: 'Ann', phone: '201000000041', company_id: co })).body;
  const c2 = (await P.post('/contacts', { name: 'Bob', phone: '201000000042' })).body.id;
  const c3 = (await P.post('/contacts', { name: 'Cy', phone: '201000000043' })).body.id;
  await P.post('/contacts/bulk', { ids: [c2], action: 'company', value: co });
  await P.post(`/companies/${co}/contacts`, { contactIds: [c3] });

  const detail = (await P.get(`/companies/${co}`)).body;
  assert.deepEqual(detail.contacts.map(c => c.name), ['Ann', 'Bob', 'Cy']);
  const listed = (await P.get(`/contacts?company=${co}`)).body;
  assert.equal(listed.length, 3);
  assert.deepEqual(listed[0].company, { id: co, name: 'Beta LLC' });
  assert.equal((await P.get('/companies?search=Beta')).body[0].contact_count, 3);

  await P.del(`/companies/${co}/contacts/${c3}`);
  assert.equal((await P.get(`/contacts/${c3}`)).body.company_id, null);
  await P.del(`/companies/${co}`);
  assert.equal((await P.get(`/contacts/${c1.id}`)).body.company_id, null, 'contacts survive company delete');
});

test('companies are isolated between workspaces', async () => {
  const co = (await P.post('/companies', { name: 'Secret Co' })).body.id;
  const qc = (await Q.post('/contacts', { name: 'Q person', phone: '201000000044' })).body.id;
  assert.equal((await Q.get(`/companies/${co}`)).status, 404);
  assert.equal((await Q.put(`/companies/${co}`, { name: 'x' })).status, 404);
  assert.equal((await Q.del(`/companies/${co}`)).status, 404);
  assert.equal((await Q.put(`/contacts/${qc}`, { company_id: co })).status, 400);
  assert.equal((await Q.post('/contacts/bulk', { ids: [qc], action: 'company', value: co })).status, 400);
  assert.equal((await Q.post(`/companies/${co}/contacts`, { contactIds: [qc] })).status, 404);
  assert.ok(!(await Q.get('/companies')).body.some(c => c.id === co));
});
