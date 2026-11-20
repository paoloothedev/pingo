// Broadcast API with the anti-ban engine: limits, warm-up, health, pre-send checks. WhatsApp is never connected
// in tests, so created jobs only wait — nothing is sent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './helpers.js';

let srv, root, P, pid, leads = [];
const GOOD = 'أهلاً {{name}}، {شفت|لقيت} محلكم على الخريطة. {ينفع|ممكن} أبعت لكم فكرة سريعة؟';

before(async () => {
  srv = await startServer();
  root = client(srv.base);
  await root.login();
  pid = (await root.post('/projects', { name: 'WA' })).body.id;
  P = root.as(pid);
  const names = ['Cafe Nile', 'Bakery Rose', 'Salon Huda', 'Gym Omar', 'Shawarma Ali'];
  for (let i = 0; i < names.length; i++) {
    leads.push((await P.post('/contacts', { name: names[i], phone: `96653000000${i}`, message: `Unique note ${i}: ${'xyz'.repeat(i)} ${names[i]} has ${i + 3} branches — open for a chat?` })).body);
  }
});
after(async () => { await srv?.stop(); });

const ids = (arr) => arr.map(l => ({ id: l.id }));

test('daily status and health: a never-connected number has no new-chat allowance (warm-up)', async () => {
  const d = (await P.get('/jobs/daily-status')).body;
  assert.equal(d.sent, 0);
  assert.equal(d.limit, 0);
  const h = (await P.get('/jobs/health')).body;
  assert.equal(h.score, 0);
  assert.equal(h.level, 'good');
  assert.equal(h.warmup.started_at, null);
});

test('limits: defaults, clamped updates, warm-up override', async () => {
  const l = (await P.get('/jobs/limits')).body;
  assert.equal(l.limits.maxNewChatsPerDay, 40);
  assert.equal(l.bounds.maxNewChatsPerDay[1], 50);
  const u = (await P.put('/jobs/limits', { limits: { maxNewChatsPerDay: 80, minDelaySec: 60 } })).body.limits;
  assert.equal(u.maxNewChatsPerDay, 50);
  assert.equal(u.minDelaySec, 60);
  await P.put('/jobs/limits', { limits: { maxNewChatsPerDay: 40, minDelaySec: 45 } });

  assert.equal((await P.put('/jobs/health/warmup', { days_ago: -1 })).status, 400);
  const h = (await P.put('/jobs/health/warmup', { days_ago: 30 })).body;
  assert.equal(h.warmup.day, 30);
  assert.equal(h.today.new_chat_limit, 40);
});

test('estimate flags links, prices, missing question and look-alike messages; sends nothing', async () => {
  const codes = async (message) => (await P.post('/jobs/estimate', { leads: ids(leads), message })).body.problems.map(p => p.code).sort();
  assert.deepEqual(await codes('Hi {{name}}, see https://x.com — only 99 SAR!'), ['link', 'no_question', 'price']);
  assert.deepEqual(await codes('Hi {{name}}, we help local shops get more WhatsApp orders every week. Interested?'), ['similar']);
  assert.deepEqual(await codes('{{message}}'), []);
  const e = (await P.post('/jobs/estimate', { leads: ids(leads), message: '{{message}}' })).body;
  assert.equal(e.eligible, 5);
  assert.equal(e.new_chats, 5);
  assert.ok(e.estimate.days >= 1);
  assert.equal((await P.get('/jobs')).body.length, 0);
});

test('create is refused (422) when content rules fail', async () => {
  const r = await P.post('/jobs', { leads: ids(leads), message: 'Visit www.shop.sa now' });
  assert.equal(r.status, 422);
  assert.ok(r.body.problems.some(p => p.code === 'link'));
  assert.equal((await P.get('/jobs')).body.length, 0);
});

test('do-not-contact and duplicate numbers are skipped; job waits for WhatsApp', async () => {
  await P.put(`/contacts/${leads[0].id}`, { do_not_contact: true });
  const dup = (await P.post('/contacts', { name: 'Dup of Rose', phone: '+966 53 000 0001' })).body;
  const r = await P.post('/jobs', { leads: [...ids(leads), { id: dup.id }], message: '{{message}}' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.eligible, 4);
  const reasons = r.body.skipped.map(s => s.reason).sort();
  assert.deepEqual(reasons, ['Do not contact (opted out)', 'Duplicate number in this broadcast']);
  const job = (await P.get(`/jobs/${r.body.id}`)).body;
  assert.equal(job.total, 6);
  assert.equal(job.skipped, 2);
  assert.equal(job.leads.filter(l => l.status === 'skipped').length, 2);
  await new Promise(res => setTimeout(res, 300));
  assert.equal((await P.get(`/jobs/${r.body.id}`)).body.wait_reason, 'WhatsApp not connected');
  assert.equal((await P.post(`/jobs/${r.body.id}/stop`)).status, 200);
  assert.equal((await P.get(`/contacts/${leads[0].id}`)).body.do_not_contact, true);
});

test('only broadcast.manage / settings.edit can change limits', async () => {
  await root.post('/accounts', { username: 'sender', password: 'pw123456', permissions: ['campaigns.send', 'leads.view'], projectIds: [pid] });
  const u = client(srv.base, pid);
  await u.login('sender', 'pw123456');
  assert.equal((await u.get('/jobs/limits')).status, 200);
  assert.equal((await u.put('/jobs/limits', { limits: { maxNewChatsPerDay: 50 } })).status, 403);
  assert.equal((await u.put('/jobs/health/warmup', { days_ago: 100 })).status, 403);
});

test('scheduled broadcasts wait for their time, can be moved and cancelled', async () => {
  const at = Date.now() + 3 * 24 * 3600 * 1000;
  assert.equal((await P.post('/jobs', { leads: ids(leads.slice(1, 3)), message: '{{message}}', scheduledAt: Date.now() + 400 * 24 * 3600 * 1000 })).status, 400);
  const est = (await P.post('/jobs/estimate', { leads: ids(leads.slice(1, 3)), message: '{{message}}', scheduledAt: at })).body;
  assert.deepEqual(est.problems, []);
  const r = await P.post('/jobs', { leads: ids(leads.slice(1, 3)), message: '{{message}}', scheduledAt: at });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'scheduled');
  assert.equal(r.body.scheduled_at, at);
  await new Promise(res => setTimeout(res, 300));
  let job = (await P.get(`/jobs/${r.body.id}`)).body;
  assert.equal(job.status, 'scheduled', 'not started early');
  assert.equal(job.started_at, null);
  assert.equal(job.leads.filter(l => l.status === 'pending').length, 2);

  const later = at + 3600 * 1000;
  assert.equal((await P.put(`/jobs/${r.body.id}/schedule`, { scheduledAt: later })).body.scheduled_at, later);
  assert.equal((await P.post(`/jobs/${r.body.id}/pause`)).status, 400);
  assert.equal((await P.post(`/jobs/${r.body.id}/stop`)).status, 200);
  job = (await P.get(`/jobs/${r.body.id}`)).body;
  assert.equal(job.status, 'stopped');
  assert.equal((await P.put(`/jobs/${r.body.id}/schedule`, { scheduledAt: later })).status, 400);
});

test('a schedule time in the past starts the job right away', async () => {
  const r = await P.post('/jobs', { leads: ids(leads.slice(3, 4)), message: '{{message}}', scheduledAt: Date.now() - 1000 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.notEqual(r.body.status, 'scheduled');
  await P.post(`/jobs/${r.body.id}/stop`);
});
