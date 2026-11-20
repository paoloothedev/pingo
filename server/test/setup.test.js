// First-run wizard: only while the install has no accounts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './helpers.js';

let srv, api;
const good = { username: 'owner', password: 'pw123456', workspace: 'My Company', countryCode: '+20', timezone: 'Africa/Cairo' };

before(async () => { srv = await startServer({ seedAdmin: false }); api = client(srv.base); });
after(async () => { await srv?.stop(); });

test('a new install has no default login and asks for setup', async () => {
  assert.equal((await fetch(`${srv.base}/health`)).status, 200);
  assert.deepEqual((await api.get('/setup/status')).body, { needed: true });
  const r = await fetch(`${srv.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin' }) });
  assert.equal(r.status, 401);
});

test('setup validates its input and changes nothing on failure', async () => {
  assert.equal((await api.post('/setup', { ...good, password: 'short' })).status, 400);
  assert.equal((await api.post('/setup', { ...good, username: 'a b' })).status, 400);
  assert.equal((await api.post('/setup', { ...good, workspace: '  ' })).status, 400);
  assert.equal((await api.get('/setup/status')).body.needed, true);
});

test('setup creates the admin and workspace, logs in, then closes for good', async () => {
  const r = await fetch(`${srv.base}/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(good) });
  assert.equal(r.status, 200);
  const done = await r.json();
  assert.equal(done.role, 'admin');
  assert.equal(done.default_password, false);
  assert.ok(done.project_id);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const me = await fetch(`${srv.base}/auth/me`, { headers: { Cookie: cookie } });
  assert.equal((await me.json()).username, 'owner');

  const owner = client(srv.base);
  await owner.login('owner', 'pw123456');
  const projects = (await owner.get('/projects')).body;
  assert.deepEqual(projects.map(p => p.name), ['My Company']);
  const settings = (await owner.as(projects[0].id).get('/settings')).body;
  assert.equal(settings.country_code, '20');
  assert.equal(settings.timezone, 'Africa/Cairo');
  assert.ok((await owner.as(projects[0].id).get('/stages')).body.length, 'the workspace is ready to use');

  assert.deepEqual((await api.get('/setup/status')).body, { needed: false });
  assert.equal((await api.post('/setup', { ...good, username: 'attacker' })).status, 403);
  assert.equal((await fetch(`${srv.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'attacker', password: 'pw123456' }) })).status, 401);
});
