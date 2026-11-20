// Campaign ↔ broadcast ↔ contact links, plus login protection and CORS.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import * as m015 from '../migrations/015-wa-numbers-campaign-links.js';
import { startServer, client } from './helpers.js';

let srv, root, W, pid, ids = [];
const FUTURE = () => Date.now() + 30 * 24 * 3600 * 1000;

before(async () => {
  srv = await startServer();
  root = client(srv.base);
  await root.login();
  pid = (await root.post('/projects', { name: 'Links' })).body.id;
  W = root.as(pid);
  const tag = (await W.post('/tags', { name: 'Priority A', color: '#111111' })).body.id;
  for (const [i, name] of ['Bakery', 'Salon', 'Cafe'].entries()) {
    const c = (await W.post('/contacts', { name, phone: `2010000009${i}0`, tag_ids: [tag] })).body;
    await W.put(`/contacts/${c.id}`, { verified: true, message: `Hi ${name}, do you take orders on WhatsApp?` });
    ids.push(c.id);
  }
});
after(async () => { await srv?.stop(); });

test('tagged contacts can join a campaign; opted-out and "Not WhatsApp" contacts cannot', async () => {
  await W.put(`/contacts/${ids[2]}`, { do_not_contact: true });
  const r = await W.post('/campaigns', { name: 'Tagged', count: 10 });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.leads.map(l => l.id).sort(), [ids[0], ids[1]].sort());
  await W.del(`/campaigns/${r.body.id}`);
  await W.put(`/contacts/${ids[2]}`, { do_not_contact: false });
  const unverified = (await W.post('/contacts', { name: 'New', phone: '201000000999' })).body.id;
  const all = await W.post('/campaigns', { name: 'All', count: 10, verifiedOnly: false });
  assert.ok(all.body.leads.some(l => l.id === unverified));
  await W.del(`/campaigns/${all.body.id}`);
  await W.del(`/contacts/${unverified}`);
});

test('a broadcast links campaign, contacts and history together', async () => {
  const camp = (await W.post('/campaigns', { name: 'Riyadh food', leadIds: [ids[0], ids[1]] })).body;
  assert.equal(camp.leads.length, 2);
  assert.equal((await W.put(`/campaigns/${camp.id}`, { name: 'Riyadh F&B' })).body.name, 'Riyadh F&B');

  const job = (await W.post('/jobs', { campaignId: camp.id, leads: [{ id: ids[0] }, { id: ids[1] }], message: '{{message}}', scheduledAt: FUTURE() })).body;
  assert.equal(job.campaign_id, camp.id);
  assert.equal(job.name, 'Riyadh F&B');

  const list = (await W.get('/campaigns')).body.find(c => c.id === camp.id);
  assert.equal(list.lead_count, 2);
  assert.equal(list.broadcast_count, 1);
  assert.equal(list.pending, 2);
  assert.equal(list.leads, undefined, 'the list stays light');

  const detail = (await W.get(`/campaigns/${camp.id}`)).body;
  assert.equal(detail.broadcasts[0].id, job.id);
  assert.equal(detail.broadcasts[0].campaign_name, 'Riyadh F&B');
  assert.equal(detail.leads[0].outreach.status, 'pending');

  const full = (await W.get(`/jobs/${job.id}`)).body;
  assert.equal(full.campaign_name, 'Riyadh F&B');
  assert.deepEqual(full.leads.map(l => l.lead_name).sort(), ['Bakery', 'Salon']);
  assert.ok('delivered' in full && 'replied' in full);
  assert.equal((await W.get('/jobs?campaign=' + camp.id)).body.length, 1);
  assert.equal((await W.get('/jobs?campaign=nope')).body.length, 0);

  const contact = (await W.get(`/contacts/${ids[0]}`)).body;
  assert.deepEqual(contact.whatsapp.sends, []);
  assert.equal(contact.whatsapp.upcoming[0].job_id, job.id);
  assert.equal(contact.whatsapp.upcoming[0].job_name, 'Riyadh F&B');

  assert.equal((await W.post(`/jobs/${job.id}/stop`)).status, 200);
  assert.deepEqual((await W.get(`/contacts/${ids[0]}`)).body.whatsapp.upcoming, []);
  assert.equal((await W.post('/jobs', { campaignId: 'camp_nope', leads: [{ id: ids[0] }], message: 'Hi?' })).status, 404);
  assert.deepEqual((await W.get('/jobs/numbers')).body, []);
});

test('migration 015 turns campaign names into ids and keeps the name', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE wa_number (project_id TEXT PRIMARY KEY); CREATE TABLE wa_sends (id INTEGER PRIMARY KEY, job_id TEXT, job_lead_id INTEGER, lead_id TEXT);
    CREATE TABLE wa_events (id INTEGER PRIMARY KEY);
    CREATE TABLE campaigns (id TEXT, name TEXT, project_id TEXT, created_at INTEGER);
    CREATE TABLE broadcast_jobs (id TEXT, campaign_id TEXT, project_id TEXT);
    INSERT INTO campaigns VALUES ('camp_1', 'Spring', 'p1', 1), ('camp_2', 'Spring', 'p2', 1);
    INSERT INTO broadcast_jobs VALUES ('j1', 'Spring', 'p1'), ('j2', 'Deleted one', 'p1'), ('j3', NULL, 'p1'), ('j4', 'Spring', 'p2');
  `);
  m015.up(db);
  const job = (id) => db.prepare('SELECT campaign_id, name FROM broadcast_jobs WHERE id = ?').get(id);
  assert.deepEqual(job('j1'), { campaign_id: 'camp_1', name: 'Spring' });
  assert.deepEqual(job('j2'), { campaign_id: null, name: 'Deleted one' });
  assert.deepEqual(job('j3'), { campaign_id: null, name: null });
  assert.deepEqual(job('j4'), { campaign_id: 'camp_2', name: 'Spring' }, 'same name in another workspace stays separate');
  db.close();
});

test('CORS only allows LeadDesk itself', async () => {
  const origin = async (o) => (await fetch(`${srv.base}/auth/permissions`, { headers: { Origin: o } })).headers.get('access-control-allow-origin');
  assert.equal(await origin('https://evil.example'), null);
  assert.equal(await origin(new URL(srv.base).origin), new URL(srv.base).origin);
});

test('login: secure cookie over https, default password flagged, repeated failures locked out', async () => {
  const login = (password, ip = '203.0.113.7', proto = 'http') => fetch(`${srv.base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, 'X-Forwarded-Proto': proto },
    body: JSON.stringify({ username: 'admin', password }),
  });
  assert.match((await login('admin', '203.0.113.9', 'https')).headers.get('set-cookie'), /; Secure/);
  assert.doesNotMatch((await login('admin', '203.0.113.9', 'http')).headers.get('set-cookie'), /; Secure/);
  assert.equal((await root.get('/auth/me')).body.default_password, true);

  for (let i = 0; i < 10; i++) assert.equal((await login('wrong')).status, 401);
  const blocked = await login('admin');
  assert.equal(blocked.status, 429, 'even the right password waits');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal((await login('admin', '203.0.113.8')).status, 200, 'other clients are not affected');
});

test('a campaign can start empty and be filled later by filters', async () => {
  const camp = await W.post('/campaigns', { name: 'Empty first' });
  assert.equal(camp.status, 201);
  assert.deepEqual(camp.body.leads, []);
  assert.equal((await W.get(`/campaigns/${camp.body.id}`)).body.lead_count, 0);
  await W.put(`/contacts/${ids[2]}`, { category: 'Cafe' });
  const added = await W.post(`/campaigns/${camp.body.id}/leads`, { count: 10, category: 'Cafe', verifiedOnly: false });
  assert.equal(added.status, 200);
  assert.deepEqual(added.body.leads.map(l => l.id), [ids[2]]);
  assert.equal((await W.post(`/campaigns/${camp.body.id}/leads`, { count: 10, category: 'Nothing like this' })).status, 400);
  await W.del(`/campaigns/${camp.body.id}`);
});

test('tags: same name reuses the tag, categories filter contacts, cleanup removes only tags that repeat the business type', async () => {
  const P = (await root.post('/projects', { name: 'Tags' })).body.id;
  const T = root.as(P);
  const agency = (await T.post('/tags', { name: 'Marketing agency', color: '#111111' })).body;
  const again = await T.post('/tags', { name: 'marketing AGENCY' });
  assert.equal(again.body.id, agency.id);
  const keep = (await T.post('/tags', { name: 'Priority' })).body;
  const unused = (await T.post('/tags', { name: 'Egypt' })).body;
  const a = (await T.post('/contacts', { name: 'Agency One', phone: '201000000801', tag_ids: [agency.id, keep.id] })).body.id;
  await T.put(`/contacts/${a}`, { category: 'Marketing agency' });
  const b = (await T.post('/contacts', { name: 'Agency Two', phone: '201000000802', tag_ids: [agency.id] })).body.id;
  const c = (await T.post('/contacts', { name: 'Bakery', phone: '201000000803', tag_ids: [keep.id] })).body.id;
  await T.put(`/contacts/${c}`, { category: 'Bakery' });

  assert.deepEqual((await T.get('/contacts/categories')).body.map(x => x.name).sort(), ['Bakery', 'Marketing agency']);
  assert.equal((await T.get('/contacts?category=Bakery')).body.length, 1);
  assert.equal((await T.get('/contacts?category=__none')).body.length, 1);

  const view = (await T.post('/views', { entity: 'contact', name: 'Agencies', filters: { fTag: [agency.id, keep.id] } })).body;

  const preview = (await T.get('/tags/cleanup')).body;
  assert.deepEqual(preview.category_tags.map(t => t.id), [agency.id]);
  assert.deepEqual(preview.unused_tags.map(t => t.id), [unused.id]);
  assert.equal((await T.get('/tags')).body.length, 3, 'preview changes nothing');

  const r = (await T.post('/tags/cleanup', { categories: true, unused: true })).body;
  assert.deepEqual([r.removed_category_tags, r.removed_unused_tags], [1, 1]);
  assert.deepEqual((await T.get('/tags')).body.map(t => t.id), [keep.id]);
  assert.equal((await T.get(`/contacts/${b}`)).body.category, 'Marketing agency', 'the business type survives on contacts without one');
  assert.deepEqual((await T.get(`/contacts/${a}`)).body.tags.map(t => t.id), [keep.id]);
  assert.deepEqual((await T.get('/views?entity=contact')).body.find(v => v.id === view.id).filters.fTag, [keep.id]);
});

test('tags merge, and cleanup and merge stay inside the workspace', async () => {
  const P = (await root.post('/projects', { name: 'Merge' })).body.id;
  const T = root.as(P);
  const x = (await T.post('/tags', { name: 'X' })).body.id, y = (await T.post('/tags', { name: 'Y' })).body.id;
  const lead = (await T.post('/contacts', { name: 'L', phone: '201000000811', tag_ids: [x] })).body.id;
  assert.equal((await T.post(`/tags/${x}/merge`, { into: x })).status, 400);

  const O = (await root.post('/projects', { name: 'Other' })).body.id;
  const other = root.as(O);
  assert.equal((await other.post(`/tags/${x}/merge`, { into: y })).status, 404);
  assert.deepEqual((await other.post('/tags/cleanup', { categories: true, unused: true })).body, { removed_category_tags: 0, removed_unused_tags: 0 });
  assert.equal((await T.get('/tags')).body.length, 2);

  assert.equal((await T.post(`/tags/${x}/merge`, { into: y })).status, 200);
  assert.deepEqual((await T.get(`/contacts/${lead}`)).body.tags.map(t => t.id), [y]);
});
