// Personal access tokens, the per-contact message field and the MCP endpoint (server/mcp.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startServer, client } from './helpers.js';

let srv, root, pid, token, origin;

async function mcp(t, { inUrl = true } = {}) {
  const url = new URL(inUrl ? `${origin}/mcp/${t}` : `${origin}/mcp`);
  const transport = new StreamableHTTPClientTransport(url, inUrl ? {} : { requestInit: { headers: { Authorization: `Bearer ${t}` } } });
  const c = new Client({ name: 'test', version: '1.0.0' });
  await c.connect(transport);
  return c;
}

async function call(c, name, args = {}) {
  const r = await c.callTool({ name, arguments: args });
  const text = r.content[0].text;
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { error: !!r.isError, data };
}

before(async () => {
  srv = await startServer();
  origin = srv.base.replace(/\/api$/, '');
  root = client(srv.base);
  await root.login();
  pid = (await root.post('/projects', { name: 'MCP ws' })).body.id;
  const r = await root.post('/tokens', { name: 'test' });
  assert.equal(r.status, 201);
  token = r.body.token;
  assert.match(token, /^ldk_[0-9a-f]{64}$/);
});
after(async () => { await srv?.stop(); });

test('message field is saved, filtered and returned', async () => {
  const W = root.as(pid);
  const lead = (await W.post('/contacts', { name: 'Msg target', phone: '201000000050' })).body;
  assert.equal(lead.message, '');
  const put = await W.put(`/contacts/${lead.id}`, { message: 'Hello Msg target' });
  assert.equal(put.body.message, 'Hello Msg target');
  const withMsg = (await W.get('/contacts?hasMessage=yes')).body.map(c => c.id);
  const without = (await W.get('/contacts?hasMessage=no')).body.map(c => c.id);
  assert.ok(withMsg.includes(lead.id));
  assert.ok(!without.includes(lead.id));
});

test('tokens: listed without the secret, bearer auth works on /api, revoked token is rejected', async () => {
  const list = (await root.get('/tokens')).body;
  assert.ok(list.length >= 1);
  assert.ok(!JSON.stringify(list).includes(token));
  const r = await fetch(`${srv.base}/projects`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  const bad = await fetch(`${srv.base}/projects`, { headers: { Authorization: 'Bearer ldk_nope' } });
  assert.equal(bad.status, 401);

  const tmp = (await root.post('/tokens', { name: 'tmp' })).body;
  assert.equal((await root.del(`/tokens/${tmp.id}`)).status, 200);
  assert.equal((await fetch(`${srv.base}/projects`, { headers: { Authorization: `Bearer ${tmp.token}` } })).status, 401);
});

test('mcp rejects missing or bad tokens', async () => {
  const r = await fetch(`${origin}/mcp/ldk_bad`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 401);
  assert.equal((await fetch(`${origin}/mcp`, { method: 'POST', body: '{}' })).status, 401);
});

test('mcp: list tools, read workspaces, create contacts and save messages', async () => {
  const c = await mcp(token);
  const names = (await c.listTools()).tools.map(t => t.name);
  for (const n of ['list_workspaces', 'workspace_overview', 'list_contacts', 'save_messages', 'start_maps_scrape', 'import_maps_job', 'api_request']) {
    assert.ok(names.includes(n), n);
  }
  const wss = (await call(c, 'list_workspaces')).data;
  assert.ok(wss.some(w => w.id === pid));

  const overview = (await call(c, 'workspace_overview', { workspace_id: pid })).data;
  assert.ok(Array.isArray(overview.stages) && overview.stages.length);

  const created = await call(c, 'create_contact', { workspace_id: pid, name: 'Cafe Nile', phone: '201000000051', notes: 'Loves espresso', message: 'first' });
  assert.equal(created.error, false, JSON.stringify(created.data));
  const id = created.data.id;
  assert.equal(created.data.message, 'first');

  const saved = (await call(c, 'save_messages', { workspace_id: pid, messages: [{ contact_id: id, message: 'Hi Cafe Nile, …' }, { contact_id: 'nope', message: 'x' }] })).data;
  assert.equal(saved.saved, 1);
  assert.equal(saved.failed.length, 1);

  const list = (await call(c, 'list_contacts', { workspace_id: pid, has_message: 'yes', search: 'Nile' })).data;
  assert.equal(list.total, 1);
  assert.equal(list.items[0].message, 'Hi Cafe Nile, …');
  assert.ok(list.items[0].stage);

  const viaApi = (await call(c, 'api_request', { method: 'GET', path: `/contacts/${id}`, workspace_id: pid })).data;
  assert.equal(viaApi.notes, 'Loves espresso');
  assert.equal((await call(c, 'api_request', { method: 'POST', path: '/tokens', body: {} })).error, true);
  assert.equal((await call(c, 'api_request', { method: 'GET', path: '/../mcp' })).error, true);

  const jobs = await call(c, 'list_maps_jobs', { workspace_id: pid });
  assert.equal(jobs.error, false);
  await c.close();
});

test('mcp works with a bearer header too', async () => {
  const c = await mcp(token, { inUrl: false });
  assert.ok((await call(c, 'list_workspaces')).data.length);
  await c.close();
});

test('mcp: preview, schedule, reschedule and cancel a WhatsApp broadcast; tune limits', async () => {
  const c = await mcp(token);
  const W = root.as(pid);
  const ids = [];
  for (const [i, name] of ['Bakery Sun', 'Salon Rose'].entries()) {
    const r = await W.post('/contacts', { name, phone: `20100000007${i}` });
    ids.push(r.body.id);
    await W.put(`/contacts/${r.body.id}`, { message: `Hi ${name}, do you take orders on WhatsApp?` });
  }
  const names = (await c.listTools()).tools.map(t => t.name);
  for (const n of ['preview_broadcast', 'send_broadcast', 'list_broadcasts', 'manage_broadcast', 'whatsapp_limits']) assert.ok(names.includes(n), n);

  const preview = await call(c, 'preview_broadcast', { workspace_id: pid, contact_ids: ids, message: '{{message}}' });
  assert.equal(preview.error, false, JSON.stringify(preview.data));
  assert.deepEqual(preview.data.problems, []);
  assert.equal(preview.data.new_chats, 2);
  assert.ok(preview.data.estimate);
  const bad = (await call(c, 'preview_broadcast', { workspace_id: pid, contact_ids: ids, message: 'Visit https://x.com now.' })).data;
  assert.ok(bad.problems.some(p => p.code === 'link'));

  // Never sends without an explicit confirmation flag
  assert.equal((await call(c, 'send_broadcast', { workspace_id: pid, contact_ids: ids, message: '{{message}}' })).error, true);
  assert.equal((await call(c, 'send_broadcast', { workspace_id: pid, contact_ids: ids, message: '{{message}}', send_at: 'tomorrow-ish', user_confirmed: true })).error, true);

  const when = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const job = await call(c, 'send_broadcast', { workspace_id: pid, contact_ids: ids, message: '{{message}}', send_at: when, user_confirmed: true });
  assert.equal(job.error, false, JSON.stringify(job.data));
  assert.equal(job.data.status, 'scheduled');
  assert.equal(job.data.scheduled_at, when);

  const listed = (await call(c, 'list_broadcasts', { workspace_id: pid, status: 'scheduled' })).data;
  assert.ok(listed.some(j => j.id === job.data.id));
  const later = new Date(Date.now() + 40 * 24 * 3600 * 1000).toISOString();
  const moved = (await call(c, 'manage_broadcast', { workspace_id: pid, job_id: job.data.id, action: 'reschedule', send_at: later })).data;
  assert.equal(moved.scheduled_at, later);
  const details = (await call(c, 'manage_broadcast', { workspace_id: pid, job_id: job.data.id, action: 'details' })).data;
  assert.equal(details.contacts.length, 2);
  assert.ok(details.contacts.every(x => x.status === 'pending'));
  assert.equal((await call(c, 'manage_broadcast', { workspace_id: pid, job_id: job.data.id, action: 'stop' })).error, false);
  assert.equal((await W.get(`/jobs/${job.data.id}`)).body.status, 'stopped');

  const lim = (await call(c, 'whatsapp_limits', { workspace_id: pid, limits: { maxNewChatsPerDay: 25 }, number_age_days: 60 })).data;
  assert.equal(lim.limits.maxNewChatsPerDay, 25);
  assert.equal(lim.limits.windowStartHour, lim.defaults.windowStartHour, 'other limits are kept');
  assert.equal(lim.health.warmup.day, 60);
  assert.equal((await call(c, 'whatsapp_limits', { workspace_id: pid, limits: { maxNewChatsPerDay: 999 } })).data.limits.maxNewChatsPerDay, 50);

  // Contacts of another workspace can't be used
  const other = (await root.post('/projects', { name: 'MCP other' })).body.id;
  assert.equal((await call(c, 'preview_broadcast', { workspace_id: other, contact_ids: ids, message: 'Hi?' })).error, true);
  await c.close();
});

test('mcp teaches the tool and guards tags', async () => {
  const c = await mcp(token);
  assert.match((await call(c, 'get_guide')).data, /verified: the USER reviewed/);
  assert.match(c.getInstructions(), /never set it unless asked/);
  // No silent tag creation
  assert.equal((await call(c, 'manage_tags', { workspace_id: pid, action: 'create', name: 'Random' })).error, true);
  assert.equal((await call(c, 'api_request', { method: 'POST', path: '/tags', workspace_id: pid, body: { name: 'Random' } })).error, true);
  assert.ok(!(await root.as(pid).get('/tags')).body.some(t => t.name === 'Random'));
  const made = await call(c, 'manage_tags', { workspace_id: pid, action: 'create', name: 'Asked for', user_confirmed: true });
  assert.equal(made.data.name, 'Asked for');
  assert.ok(Array.isArray((await call(c, 'manage_tags', { workspace_id: pid, action: 'cleanup_preview' })).data.unused_tags));

  // Empty campaign, then contacts
  const camp = (await call(c, 'create_campaign', { workspace_id: pid, name: 'Later' })).data;
  assert.equal(camp.contacts, 0);
  const lead = (await root.as(pid).post('/contacts', { name: 'For later', phone: '201000000821' })).body.id;
  assert.equal((await call(c, 'add_to_campaign', { workspace_id: pid, campaign_id: camp.id, contact_ids: [lead] })).data.added, 1);
  assert.equal((await call(c, 'list_contacts', { workspace_id: pid, verified: 'no', search: 'For later' })).data.total, 1);
  assert.ok('categories' in (await call(c, 'workspace_overview', { workspace_id: pid })).data);
  await c.close();
});

test('mcp: a token only reaches its own workspaces and permissions', async () => {
  const other = (await root.post('/projects', { name: 'Not theirs' })).body.id;
  await root.post('/accounts', { username: 'mcpviewer', password: 'pw123456', permissions: ['leads.view'], projectIds: [pid] });
  const u = client(srv.base);
  await u.login('mcpviewer', 'pw123456');
  const c = await mcp((await u.post('/tokens', { name: 't' })).body.token);
  assert.deepEqual((await call(c, 'list_workspaces')).data.map(w => w.id), [pid]);
  assert.equal((await call(c, 'list_contacts', { workspace_id: pid })).error, false);
  assert.equal((await call(c, 'list_contacts', { workspace_id: other })).error, true);
  assert.equal((await call(c, 'whatsapp_status', { workspace_id: other })).error, true);
  assert.match((await call(c, 'whatsapp_status', { workspace_id: pid })).data, /403/, 'no WhatsApp permission');
  assert.equal((await call(c, 'send_broadcast', { workspace_id: pid, contact_ids: ['x'], message: 'Hi?', user_confirmed: true })).error, true);
  await c.close();
});
