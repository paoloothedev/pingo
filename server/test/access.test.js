// Agency mode access control: workspace membership, permissions, account management.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './helpers.js';

let srv, admin, A, B;

async function makeUser(creator, username, permissions, projectIds) {
  const r = await creator.post('/accounts', { username, password: 'pw123456', permissions, projectIds });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const c = client(srv.base);
  await c.login(username, 'pw123456');
  return { id: r.body.id, body: r.body, c };
}

before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  await admin.login();
  A = (await admin.post('/projects', { name: 'Client A' })).body.id;
  B = (await admin.post('/projects', { name: 'Client B' })).body.id;
});
after(async () => { await srv?.stop(); });

test('members only see and enter their own workspaces', async () => {
  const u = await makeUser(admin, 'staff1', ['leads.view'], [A]);
  const names = (await u.c.get('/projects')).body.map(p => p.name);
  assert.deepEqual(names, ['Client A']);
  assert.equal((await u.c.as(A).get('/leads')).status, 200);
  assert.equal((await u.c.as(B).get('/leads')).status, 404);
  assert.equal((await u.c.put(`/projects/${B}`, { name: 'x' })).status, 403);
});

test('permissions are enforced per action', async () => {
  const u = await makeUser(admin, 'viewer', ['leads.view'], [A]);
  const c = u.c.as(A);
  assert.equal((await c.get('/stages')).status, 200, 'reference data readable by members');
  assert.equal((await c.post('/leads', { name: 'x', phone: '201000000021' })).status, 403);
  assert.equal((await c.put('/settings', { key: 'k', value: 'v' })).status, 403);
  assert.equal((await c.get('/campaigns')).status, 403);
  assert.equal((await c.get('/export')).status, 403);
  assert.equal((await c.post('/tags', { name: 't' })).status, 403);

  const editor = (await makeUser(admin, 'editor', ['leads.view', 'leads.edit'], [A])).c.as(A);
  const lead = (await editor.post('/leads', { name: 'y', phone: '201000000022' })).body.id;
  assert.ok(lead);
  assert.equal((await editor.post('/leads/bulk', { ids: [lead], action: 'verify' })).status, 403);
  assert.equal((await editor.post('/leads/bulk', { ids: [lead], action: 'delete' })).status, 403);
});

test('non-admins cannot escalate when managing accounts', async () => {
  const mgr = await makeUser(admin, 'clientmgr', ['accounts.view', 'accounts.manage', 'leads.view'], [A]);
  const sub = await mgr.c.post('/accounts', {
    username: 'sub1', password: 'pw123456', permissions: ['leads.view', 'leads.delete', 'projects.manage'], projectIds: [A, B],
  });
  assert.equal(sub.status, 200);
  assert.deepEqual(sub.body.permissions, ['leads.view']);
  assert.deepEqual(sub.body.projectIds, [A]);

  const other = await makeUser(admin, 'agencystaff', ['leads.view'], [A, B]);
  assert.equal((await mgr.c.put(`/accounts/${other.id}`, { password: 'hijack123' })).status, 403);
  assert.equal((await mgr.c.post(`/accounts/admin/change-password`, { password: 'hijack123' })).status, 403);
  assert.equal((await mgr.c.del(`/accounts/${other.id}`)).status, 403);
  const listed = (await mgr.c.get('/accounts')).body.map(a => a.username).sort();
  assert.deepEqual(listed, ['clientmgr', 'sub1']);
});

test('creating workspaces needs projects.manage; creator becomes a member', async () => {
  const plain = await makeUser(admin, 'plain', ['settings.edit'], [A]);
  assert.equal((await plain.c.post('/projects', { name: 'Nope' })).status, 403);
  assert.equal((await plain.c.del(`/projects/${A}`)).status, 403);

  const lead = await makeUser(admin, 'agencylead', ['projects.manage'], []);
  const p = (await lead.c.post('/projects', { name: 'New client' })).body;
  assert.ok((await lead.c.get('/projects')).body.some(x => x.id === p.id));
  assert.equal((await lead.c.del(`/projects/${B}`)).status, 404, 'cannot delete a workspace it is not in');
});

test('admin can move a user between workspaces', async () => {
  const u = await makeUser(admin, 'mover', ['leads.view'], [A]);
  await admin.put(`/accounts/${u.id}`, { projectIds: [B] });
  assert.equal((await u.c.as(A).get('/leads')).status, 404);
  assert.equal((await u.c.as(B).get('/leads')).status, 200);
});

test('workspace members list is visible to members only', async () => {
  const u = await makeUser(admin, 'memberlist', ['leads.view'], [A]);
  const names = (await u.c.get(`/projects/${A}/members`)).body.map(m => m.username);
  assert.ok(names.includes('admin') && names.includes('memberlist'));
  assert.equal((await u.c.get(`/projects/${B}/members`)).status, 404);
});

test('new workspace can copy another workspace setup (not its data)', async () => {
  const src = admin.as(A);
  await src.post('/tags', { name: 'VIP' });
  await src.post('/templates', { name: 'Intro', content: 'Hi {{name}}' });
  await src.post('/custom-fields', { entity: 'deal', label: 'Package', type: 'select', options: ['Basic', 'Pro'] });
  await src.post('/pipelines', { name: 'Onboarding', stages: [{ name: 'Kickoff' }, { name: 'Live', kind: 'won', probability: 100 }] });
  await src.put('/settings', { key: 'country_code', value: '20' });
  await src.post('/contacts', { name: 'Private contact', phone: '201000000501' });

  const p = (await admin.post('/projects', { name: 'Client C', templateFrom: A })).body;
  assert.ok(p.copiedFrom && p.copiedFrom.pipelines === 2);
  const C = admin.as(p.id);
  assert.deepEqual((await C.get('/pipelines')).body.map(x => x.name).sort(), ['Onboarding', 'Sales']);
  assert.ok((await C.get('/tags')).body.some(t => t.name === 'VIP'));
  assert.ok((await C.get('/templates')).body.some(t => t.name === 'Intro'));
  assert.equal((await C.get('/custom-fields?entity=deal')).body[0].key, 'package');
  assert.equal((await C.get('/settings')).body.country_code, '20');
  assert.equal((await C.get('/contacts')).body.length, 0, 'no data copied');
  const srcStages = (await src.get('/stages')).body.map(s => s.name);
  assert.deepEqual((await C.get('/stages')).body.map(s => s.name), srcStages);

  const outsider = await makeUser(admin, 'outsider', ['projects.manage'], [B]);
  assert.equal((await outsider.c.post('/projects', { name: 'Steal', templateFrom: A })).status, 400);
});

test('a user given one workspace is locked to it, and changes apply at once', async () => {
  const sales = ['dashboard.view', 'leads.view', 'leads.edit', 'campaigns.view', 'campaigns.edit', 'campaigns.send', 'broadcast.view'];
  const u = await makeUser(admin, 'oneworkspace', sales, [A]);
  assert.deepEqual(u.body.projectIds, [A]);
  assert.deepEqual((await u.c.get('/projects')).body.map(p => p.id), [A]);

  const inB = u.c.as(B);
  for (const path of ['/contacts', '/campaigns', '/jobs', '/jobs/numbers', '/jobs/health', '/tags', '/tags/cleanup', '/stats', '/search?q=ab', '/settings', '/gmaps/jobs', '/contacts/categories']) {
    assert.equal((await inB.get(path)).status, 404, path);
  }
  assert.equal((await inB.post('/campaigns', { name: 'x' })).status, 404);
  assert.equal((await inB.post('/jobs', { leads: [{ id: 'x' }], message: 'Hi?' })).status, 404);

  const inA = u.c.as(A);
  assert.equal((await inA.get('/campaigns')).status, 200);
  assert.equal((await inA.post('/campaigns', { name: 'Allowed' })).status, 201);
  assert.equal((await inA.get('/tags/cleanup')).status, 403, 'tags.edit not granted');
  assert.equal((await inA.get('/gmaps/jobs')).status, 403, 'leads.import not granted');
  assert.equal((await inA.get('/jobs/limits')).status, 200);
  assert.equal((await inA.put('/jobs/limits', { limits: {} })).status, 403);

  // Moved to the other workspace: the old one closes straight away, with the same session
  assert.equal((await admin.put(`/accounts/${u.id}`, { projectIds: [B] })).status, 200);
  assert.equal((await inA.get('/contacts')).status, 404);
  assert.equal((await inB.get('/contacts')).status, 200);

  // Permission removed: same
  assert.equal((await admin.put(`/accounts/${u.id}`, { permissions: ['leads.view'] })).status, 200);
  assert.equal((await inB.post('/contacts', { name: 'n', phone: '201000000031' })).status, 403);
});

test('account passwords need at least 8 characters', async () => {
  assert.equal((await admin.post('/accounts', { username: 'shortpw', password: 'abc' })).status, 400);
  const u = await makeUser(admin, 'pwuser', ['leads.view'], [A]);
  assert.equal((await admin.put(`/accounts/${u.id}`, { password: 'abc' })).status, 400);
  assert.equal((await u.c.post(`/accounts/${u.id}/change-password`, { password: 'abc' })).status, 400);
});
