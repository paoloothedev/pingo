import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './helpers.js';

let srv, A, B;
before(async () => {
  srv = await startServer();
  const root = client(srv.base);
  await root.login();
  A = root.as((await root.post('/projects', { name: 'A' })).body.id);
  B = root.as((await root.post('/projects', { name: 'B' })).body.id);
  const stage = (await A.get('/stages')).body[1].id;
  const tag = (await A.post('/tags', { name: 'vip' })).body.id;
  await A.post('/leads', { name: 'Alpha', phone: '201000000011', stage_id: stage, tag_ids: [tag] });
  await A.post('/leads', { name: 'Beta', phone: '201000000012', stage_id: stage });
  await B.post('/leads', { name: 'Old B lead', phone: '201000000013' });
});
after(async () => { await srv?.stop(); });

test('restoring A backup into B replaces B data with fresh ids and leaves A untouched', async () => {
  const backup = (await A.get('/export')).body;
  const r = await B.post('/import/backup', backup);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.leads, 2);

  const bLeads = (await B.get('/leads')).body;
  const aLeads = (await A.get('/leads')).body;
  assert.deepEqual(bLeads.map(l => l.name).sort(), ['Alpha', 'Beta']);
  assert.equal(aLeads.length, 2, 'A lost data');
  const aIds = new Set(aLeads.map(l => l.id));
  assert.ok(bLeads.every(l => !aIds.has(l.id)), 'ids were reused');

  const bStages = new Set((await B.get('/stages')).body.map(s => s.id));
  assert.ok(bLeads.every(l => bStages.has(l.stage_id)), 'lead points to a stage outside B');
  const alpha = bLeads.find(l => l.name === 'Alpha');
  assert.deepEqual(alpha.tags.map(t => t.name), ['vip']);
  assert.ok((await B.get('/tags')).body.some(t => t.id === alpha.tags[0].id));
});

test('invalid backup is rejected without wiping data', async () => {
  const before = (await B.get('/leads')).body.length;
  assert.equal((await B.post('/import/backup', { nope: true })).status, 400);
  assert.equal((await B.get('/leads')).body.length, before);
});

test('backup round-trips companies, deals, pipelines, custom fields and templates', async () => {
  await A.post('/custom-fields', { entity: 'contact', label: 'Seats', type: 'number' });
  const co = (await A.post('/companies', { name: 'Acme' })).body.id;
  const contact = (await A.post('/contacts', { name: 'Gamma', phone: '201000000014', company_id: co, lifecycle: 'qualified', custom: { seats: 12 } })).body.id;
  const won = (await A.get('/pipelines')).body[0].stages.find(s => s.kind === 'won').id;
  await A.post('/deals', { title: 'Big deal', value: 900, contact_id: contact, stage_id: won });
  await A.post('/templates', { name: 'Hello', content: 'Hi {{name}}' });

  const backup = (await A.get('/export')).body;
  assert.equal(backup.version, 2);
  const r = await B.post('/import/backup', backup);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.deals, 1);

  const bContact = (await B.get('/contacts?search=Gamma')).body[0];
  assert.equal(bContact.lifecycle, 'customer', 'won deal made the contact a customer in A; restored as-is');
  assert.equal(bContact.custom.seats, 12);
  assert.equal(bContact.company.name, 'Acme');
  assert.notEqual(bContact.company.id, co, 'fresh company id');
  const deals = (await B.get('/deals')).body;
  assert.equal(deals.length, 1);
  assert.equal(deals[0].status, 'won');
  assert.equal(deals[0].contact.id, bContact.id);
  assert.equal((await B.get(`/deals/${deals[0].id}`)).body.history.length, 1);
  assert.equal((await B.get('/custom-fields?entity=contact')).body[0].key, 'seats');
  assert.ok((await B.get('/templates')).body.some(t => t.name === 'Hello'));
  assert.equal((await A.get('/deals')).body.length, 1, 'source workspace untouched');
});
