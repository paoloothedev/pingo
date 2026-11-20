// Agency mode: one workspace must never read or modify another's data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './helpers.js';

let srv, A, B, a = {};

before(async () => {
  srv = await startServer();
  const root = client(srv.base);
  await root.login();
  const pa = (await root.post('/projects', { name: 'Agency client A' })).body;
  const pb = (await root.post('/projects', { name: 'Agency client B' })).body;
  A = root.as(pa.id);
  B = root.as(pb.id);

  a.stage = (await A.get('/stages')).body[0].id;
  a.tag = (await A.post('/tags', { name: 'A-tag' })).body.id;
  a.lead = (await A.post('/leads', { name: 'A lead', phone: '201000000001', stage_id: a.stage, verified: true })).body.id;
  a.campaign = (await A.post('/campaigns', { name: 'A camp', count: 0 })).body.id;
  a.client = (await A.post('/clients', { name: 'A client' })).body.id;
  a.email = (await A.post('/email-campaigns', { name: 'A email' })).body.id;
  a.template = (await A.post('/templates', { name: 'A tpl', content: 'hi' })).body.id;
  for (const [k, v] of Object.entries(a)) assert.ok(v, `setup failed for ${k}`);
  b = {};
  b.stage = (await B.get('/stages')).body[0].id;
  b.lead = (await B.post('/leads', { name: 'B lead', phone: '201000000002', stage_id: b.stage })).body.id;
  b.campaign = (await B.post('/campaigns', { name: 'B camp', count: 0 })).body.id;
});
let b;
after(async () => { await srv?.stop(); });

test('lists only show own workspace data', async () => {
  for (const url of ['/leads', '/tags', '/campaigns', '/clients', '/email-campaigns', '/templates']) {
    const r = await B.get(url);
    assert.equal(r.status, 200, url);
    assert.ok(!JSON.stringify(r.body).includes('A '), `${url} leaked A data`);
  }
});

test('cannot read or modify another workspace record by id', async () => {
  assert.equal((await B.get(`/leads/${a.lead}`)).status, 404);
  assert.equal((await B.put(`/leads/${a.lead}`, { name: 'hacked' })).status, 404);
  assert.equal((await B.get(`/clients/${a.client}`)).status, 404);
  assert.equal((await B.put(`/clients/${a.client}`, { name: 'hacked' })).status, 404);
  assert.equal((await B.put(`/templates/${a.template}`, { name: 'hacked' })).status, 404);
  assert.equal((await B.put(`/tags/${a.tag}`, { name: 'hacked' })).status, 404);
  assert.equal((await A.get(`/leads/${a.lead}`)).body.name, 'A lead');
});

test('cannot attach another workspace stage or tag to own leads', async () => {
  assert.equal((await B.post('/leads', { name: 'x', phone: '201000000003', stage_id: a.stage })).status, 400);
  assert.equal((await B.put(`/leads/${b.lead}`, { stage_id: a.stage })).status, 400);
  assert.equal((await B.post('/leads/bulk', { ids: [b.lead], action: 'stage', stageId: a.stage })).status, 400);
  assert.equal((await B.post('/leads/bulk', { ids: [b.lead], action: 'tag', tagId: a.tag })).status, 400);
  await B.put(`/leads/${b.lead}`, { tag_ids: [a.tag] });
  assert.deepEqual((await B.get(`/leads/${b.lead}`)).body.tags, []);
});

test('bulk actions ignore other workspace leads', async () => {
  const r = await B.post('/leads/bulk', { ids: [a.lead], action: 'dead' });
  assert.equal(r.status, 404);
  assert.equal((await A.get(`/leads/${a.lead}`)).body.status, 'active');
});

test('cannot pull another workspace lead into own campaign', async () => {
  await A.post(`/campaigns/${a.campaign}/leads`, { leadIds: [a.lead] });
  const r = await B.post(`/campaigns/${b.campaign}/leads`, { leadIds: [a.lead] });
  assert.equal(r.status, 400);
  assert.ok(!JSON.stringify(r.body).includes('A lead'));
  assert.equal((await B.get(`/campaigns/${a.campaign}/eligible`)).status, 404);
  assert.equal((await B.del(`/campaigns/${a.campaign}`)).status, 404);
  assert.equal((await B.get(`/campaigns/${a.campaign}`)).status, 404);
  assert.equal((await B.put(`/campaigns/${a.campaign}`, { name: 'hacked' })).status, 404);
  const mine = (await A.get(`/campaigns/${a.campaign}`)).body;
  assert.equal(mine.name === 'hacked', false);
  assert.ok(mine.leads.some(l => l.id === a.lead), 'B emptied the campaign of A');
  assert.equal((await B.post('/jobs', { campaignId: a.campaign, leads: [{ id: b.lead }], message: 'Hi?' })).status, 404);
});

test('client activities and email campaign membership are scoped', async () => {
  assert.equal((await B.post(`/clients/${a.client}/activity`, { action: 'note' })).status, 404);
  assert.equal((await B.post(`/email-campaigns/${a.email}/leads/${b.lead}`)).status, 404);
  assert.equal((await B.del(`/email-campaigns/${a.email}/leads/${a.lead}`)).status, 404);
});

test('broadcast jobs only accept own leads', async () => {
  const r = await B.post('/jobs', { message: 'hi', leads: [{ id: a.lead, phone: '201000000001' }] });
  assert.equal(r.status, 400);
});

test('token and MCP access stay inside the account workspaces', async () => {
  const root = client(srv.base);
  await root.login();
  const B_id = B.projectId;
  assert.equal((await root.post('/accounts', { username: 'bonly', password: 'pw123456', permissions: ['leads.view', 'leads.edit'], projectIds: [B_id] })).status, 200);
  const u = client(srv.base);
  await u.login('bonly', 'pw123456');
  const { token } = (await u.post('/tokens', { name: 't' })).body;
  // other users' tokens are not listed or deletable
  assert.ok(!(await root.get('/tokens')).body.some(t => t.name === 't' && t.prefix === token.slice(0, 10)));
  const mine = (await u.get('/tokens')).body[0];
  assert.equal((await root.del(`/tokens/${mine.id}`)).status, 404);

  const h = (pid) => ({ Authorization: `Bearer ${token}`, 'X-Project-Id': pid });
  assert.equal((await fetch(`${srv.base}/leads/${a.lead}`, { headers: h(A.projectId) })).status, 404);
  assert.equal((await fetch(`${srv.base}/leads`, { headers: h(B_id) })).status, 200);

  const origin = srv.base.replace(/\/api$/, '');
  const rpc = async (name, args) => {
    const r = await fetch(`${origin}/mcp/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    return (await r.json()).result;
  };
  const ws = JSON.parse((await rpc('list_workspaces', {})).content[0].text);
  assert.deepEqual(ws.map(w => w.id), [B_id]);
  for (const [name, args] of [
    ['get_contact', { workspace_id: A.projectId, contact_id: a.lead }],
    ['save_messages', { workspace_id: A.projectId, messages: [{ contact_id: a.lead, message: 'x' }] }],
    ['save_messages', { workspace_id: B_id, messages: [{ contact_id: a.lead, message: 'x' }] }],
    ['whatsapp_status', { workspace_id: A.projectId }],
  ]) {
    const r = await rpc(name, args);
    const failed = r.isError || JSON.parse(r.content[0].text).saved === 0;
    assert.ok(failed, `${name} reached workspace A`);
  }
  assert.equal((await A.get(`/leads/${a.lead}`)).body.message, '');
});

test('WhatsApp limits, health and pre-send checks are per workspace', async () => {
  assert.equal((await B.put('/jobs/limits', { limits: { maxMessagesPerHour: 7 } })).status, 200);
  assert.equal((await A.get('/jobs/limits')).body.limits.maxMessagesPerHour, 30);
  await B.put('/jobs/health/warmup', { days_ago: 90 });
  assert.equal((await A.get('/jobs/health')).body.warmup.started_at, null);
  const r = await B.post('/jobs/estimate', { leads: [{ id: a.lead }], message: 'Hi?' });
  assert.equal(r.status, 400);
  assert.ok(!JSON.stringify(r.body).includes('A lead'));
});

test('scheduled jobs cannot be moved or cancelled from another workspace', async () => {
  const at = Date.now() + 2 * 24 * 3600 * 1000;
  const job = (await A.post('/jobs', { leads: [{ id: a.lead }], message: 'Hi there, are you open tomorrow?', scheduledAt: at })).body;
  assert.equal(job.status, 'scheduled', JSON.stringify(job));
  assert.equal((await B.put(`/jobs/${job.id}/schedule`, { scheduledAt: Date.now() })).status, 404);
  assert.equal((await B.post(`/jobs/${job.id}/stop`)).status, 404);
  assert.equal((await A.get(`/jobs/${job.id}`)).body.scheduled_at, at);
  await A.post(`/jobs/${job.id}/stop`);
});
