import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './helpers.js';

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv?.stop(); });

test('rejects requests without a session', async () => {
  const r = await client(srv.base).get('/leads');
  assert.equal(r.status, 401);
});

test('rejects bad credentials', async () => {
  const r = await client(srv.base).post('/auth/login', { username: 'admin', password: 'nope' });
  assert.equal(r.status, 401);
});

test('seeded admin can log in and sees the Default project', async () => {
  const c = client(srv.base);
  const me = await c.login();
  assert.equal(me.role, 'admin');
  const projects = await c.get('/projects');
  assert.equal(projects.status, 200);
  assert.ok(projects.body.some(p => p.name === 'Default'));
});

test('project-scoped routes require a valid project', async () => {
  const c = client(srv.base);
  await c.login();
  assert.equal((await c.get('/leads')).status, 400);
  assert.equal((await c.as('proj_missing').get('/leads')).status, 404);
});
