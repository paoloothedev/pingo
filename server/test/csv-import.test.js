import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, client } from './helpers.js';

let srv, P;
before(async () => {
  srv = await startServer();
  const admin = client(srv.base);
  await admin.login();
  P = admin.as((await admin.post('/projects', { name: 'CSV' })).body.id);
});
after(async () => { await srv?.stop(); });

test('CSV import adds contacts with source csv, skips duplicates, backs up the DB', async () => {
  // rows come from /import/preview, which sets phoneValid
  const rows = [
    { name: 'Alpha Cafe', phone: '201000000301', phoneValid: true, email: 'a@x.test' },
    { name: 'Beta Bakery', phone: '201000000302', phoneValid: true },
  ];
  const r1 = await P.post('/leads/import/confirm', { rows, skipDupes: true, filename: 'a.csv' });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const contacts = (await P.get('/contacts?source=csv')).body;
  assert.deepEqual(contacts.map(c => c.name).sort(), ['Alpha Cafe', 'Beta Bakery']);

  const r2 = await P.post('/leads/import/confirm', { rows, skipDupes: true, filename: 'a.csv' });
  assert.equal(r2.status, 200);
  assert.equal((await P.get('/contacts?source=csv')).body.length, 2, 'duplicates skipped');

  const backups = fs.readdirSync(path.dirname(srv.dbPath)).filter(f => f.includes('.backup.'));
  assert.ok(backups.length >= 1);
});
