import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './helpers.js';

let srv, admin, P, Q;
before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  await admin.login();
  P = admin.as((await admin.post('/projects', { name: 'P' })).body.id);
  Q = admin.as((await admin.post('/projects', { name: 'Q' })).body.id);
});
after(async () => { await srv?.stop(); });

test('field definitions: create, key slug, validation, uniqueness', async () => {
  const f = (await P.post('/custom-fields', { entity: 'contact', label: 'Cuisine type', type: 'select', options: ['Pizza', 'Grill', 'Pizza'] })).body;
  assert.equal(f.key, 'cuisine_type');
  assert.deepEqual(f.options, ['Pizza', 'Grill']);
  assert.equal((await P.post('/custom-fields', { entity: 'contact', label: 'Cuisine type', type: 'text' })).status, 409);
  assert.equal((await P.post('/custom-fields', { entity: 'lead', label: 'x', type: 'text' })).status, 400);
  assert.equal((await P.post('/custom-fields', { entity: 'contact', label: 'x', type: 'color' })).status, 400);
  assert.equal((await P.post('/custom-fields', { entity: 'contact', label: 'Tags2', type: 'select', options: [] })).status, 400);
  const all = (await P.get('/custom-fields')).body;
  assert.deepEqual(Object.keys(all), ['contact', 'company', 'deal']);
  assert.equal(all.contact.length, 1);
  assert.equal((await Q.get('/custom-fields?entity=contact')).body.length, 0, 'per workspace');
});

test('values are validated, coerced, merged and unknown keys dropped', async () => {
  await P.post('/custom-fields', { entity: 'contact', label: 'Seats', type: 'number' });
  await P.post('/custom-fields', { entity: 'contact', label: 'Opened', type: 'date' });
  await P.post('/custom-fields', { entity: 'contact', label: 'Delivery', type: 'checkbox' });
  await P.post('/custom-fields', { entity: 'contact', label: 'Channels', type: 'multiselect', options: ['Talabat', 'Elmenus', 'Own'] });
  await P.post('/custom-fields', { entity: 'contact', label: 'Menu', type: 'url' });
  await P.post('/custom-fields', { entity: 'contact', label: 'Account manager', type: 'user' });

  const c = (await P.post('/contacts', { name: 'Pizza Roma', phone: '201000000401', custom: {
    cuisine_type: 'Pizza', seats: '40', opened: '2020-05-01', delivery: 'true', channels: ['Talabat', 'Own'],
    menu: 'https://roma.example/menu', account_manager: 'admin', not_a_field: 'x',
  } })).body;
  assert.equal(c.custom.seats, 40);
  assert.equal(c.custom.delivery, true);
  assert.equal(typeof c.custom.opened, 'number');
  assert.deepEqual(c.custom.channels, ['Talabat', 'Own']);
  assert.equal(c.custom.not_a_field, undefined);

  const bad = async (custom) => (await P.put(`/contacts/${c.id}`, { custom })).status;
  assert.equal(await bad({ cuisine_type: 'Sushi' }), 400);
  assert.equal(await bad({ seats: 'many' }), 400);
  assert.equal(await bad({ menu: 'not a url' }), 400);
  assert.equal(await bad({ channels: ['Uber'] }), 400);
  assert.equal(await bad({ account_manager: 'nobody' }), 400);

  const u = (await P.put(`/contacts/${c.id}`, { custom: { seats: 45, menu: null } })).body;
  assert.equal(u.custom.seats, 45);
  assert.equal(u.custom.menu, undefined, 'null clears a value');
  assert.equal(u.custom.cuisine_type, 'Pizza', 'other values kept (merge)');
});

test('required fields are enforced on create and cannot be cleared', async () => {
  const f = (await P.post('/custom-fields', { entity: 'deal', label: 'Source channel', type: 'text', required: true })).body;
  assert.equal((await P.post('/deals', { title: 'No channel' })).status, 400);
  const d = (await P.post('/deals', { title: 'With channel', custom: { source_channel: 'Referral' } })).body;
  assert.equal(d.custom.source_channel, 'Referral');
  assert.equal((await P.put(`/deals/${d.id}`, { value: 10 })).status, 200, 'untouched required field is fine');
  assert.equal((await P.put(`/deals/${d.id}`, { custom: { source_channel: '' } })).status, 400);
  await P.put(`/custom-fields/${f.id}`, { required: false });
});

test('filter lists by custom field values', async () => {
  await P.post('/contacts', { name: 'Grill House', phone: '201000000402', custom: { cuisine_type: 'Grill', channels: ['Elmenus'], delivery: false } });
  const names = async (qs) => (await P.get(`/contacts?${qs}`)).body.map(c => c.name).sort();
  assert.deepEqual(await names('cf.cuisine_type=Grill'), ['Grill House']);
  assert.deepEqual(await names('cf.channels=Talabat'), ['Pizza Roma']);
  assert.deepEqual(await names('cf.delivery=true'), ['Pizza Roma']);
  assert.deepEqual(await names('cf.seats=45'), ['Pizza Roma']);
  assert.deepEqual(await names('cf.menu=__empty&cf.cuisine_type=Grill'), ['Grill House']);
  assert.equal((await P.get("/contacts?cf.bogus'key=1")).status, 200, 'unknown keys ignored');
});

test('deleting a field removes its values; other workspaces cannot touch definitions', async () => {
  const defs = (await P.get('/custom-fields?entity=contact')).body;
  const seats = defs.find(d => d.key === 'seats');
  assert.equal((await Q.put(`/custom-fields/${seats.id}`, { label: 'x' })).status, 404);
  assert.equal((await Q.del(`/custom-fields/${seats.id}`)).status, 404);
  await P.del(`/custom-fields/${seats.id}`);
  const roma = (await P.get('/contacts?search=Roma')).body[0];
  assert.equal(roma.custom.seats, undefined);
  assert.equal(roma.custom.cuisine_type, 'Pizza');
});
