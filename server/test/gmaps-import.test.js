import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './helpers.js';

const place = (title, phone, extra = {}) => ({ title, phone, category: 'Restaurant', address: '1 Nile St, Cairo', website: '', link: 'https://maps.google.com/?cid=1', ...extra });
const job = {
  id: 'job1', name: 'Cairo food', queries: ['food'], options: {}, status: 'completed', createdAt: 1,
  results: [
    place('Koshary Hub', '+20 100 000 0001', { website: 'https://www.kosharyhub.example/menu' }),
    place('Falafel King', '+20 100 000 0002', { website: 'https://facebook.com/falafelking' }),
    place('Koshary Hub', '+20 100 000 0001'), // duplicate place
  ],
};

let srv, D;
before(async () => {
  srv = await startServer({ gmapsJobs: { job1: job } });
  const admin = client(srv.base);
  await admin.login();
  D = admin.as((await admin.get('/projects')).body.find(p => p.name === 'Default').id);
});
after(async () => { await srv?.stop(); });

test('Google Maps import creates a company per business and links the contact', async () => {
  const r = await D.post('/gmaps/jobs/job1/import', { skipDupes: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const companies = (await D.get('/companies?sortBy=name')).body;
  assert.deepEqual(companies.map(c => c.name), ['Falafel King', 'Koshary Hub'], 'duplicate place reuses the company');
  const hub = companies.find(c => c.name === 'Koshary Hub');
  assert.equal(hub.source, 'gmaps');
  assert.equal(hub.industry, 'Restaurant');
  assert.equal(hub.domain, 'kosharyhub.example');
  assert.equal(hub.contact_count, 2);
  assert.equal(companies.find(c => c.name === 'Falafel King').website, '', 'social links are not a company website');

  const contacts = (await D.get('/contacts?source=gmaps')).body;
  assert.equal(contacts.length, 3);
  assert.ok(contacts.every(c => c.company));
});
