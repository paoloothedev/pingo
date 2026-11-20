// Scraper job lifecycle without a browser: queue, failure status, auto-import into contacts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leaddesk-gmaps-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.WA_AUTH_DIR = path.join(tmp, 'wa');
process.env.GMAPS_JOBS_FILE = path.join(tmp, 'jobs.json');

let db, J, pid;
const biz = (title, phone) => ({ title, phone, category: 'Bakery', address: 'Main St', link: 'https://maps.example/' + title });

async function done(id) {
  for (let i = 0; i < 200; i++) {
    const j = J.getJob(id);
    if (['completed', 'failed'].includes(j.status) && (!j.options.autoImport || j.imported || j.status === 'failed' || !j.results.length)) return j;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('job did not finish');
}

before(async () => {
  db = (await import('../db.js')).getDB();
  J = await import('../gmaps/jobs.js');
  pid = db.prepare('SELECT id FROM projects ORDER BY created_at LIMIT 1').get().id;
});
after(() => { db?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('auto-import adds the results to contacts and companies when the job finishes', async () => {
  J._setScraper(async () => [biz('Sun Bakery', '+201000000701'), biz('Rose Bakery', '+201000000702')]);
  const job = J.createJob('Bakeries', ['bakeries'], { autoImport: true }, pid);
  const j = await done(job.id);
  assert.equal(j.status, 'completed');
  assert.deepEqual([j.imported.added, j.imported.skipped], [2, 0]);
  const rows = db.prepare("SELECT name, source, company_id FROM leads WHERE project_id = ? AND source = 'gmaps' ORDER BY name").all(pid);
  assert.deepEqual(rows.map(r => r.name), ['Rose Bakery', 'Sun Bakery']);
  assert.ok(rows.every(r => r.company_id));
});

test('duplicates are skipped, and without the option nothing is imported', async () => {
  J._setScraper(async () => [biz('Sun Bakery', '+201000000701'), biz('New Bakery', '+201000000703')]);
  const again = await done(J.createJob('Again', ['bakeries'], { autoImport: true }, pid).id);
  assert.deepEqual([again.imported.added, again.imported.skipped], [1, 1]);

  J._setScraper(async () => [biz('Manual Bakery', '+201000000704')]);
  const manual = await done(J.createJob('Manual', ['bakeries'], {}, pid).id);
  assert.equal(manual.imported, undefined);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leads WHERE name = 'Manual Bakery'").get().n, 0);
});

test('jobs run one at a time and a job where every keyword failed is reported as failed', async () => {
  let running = 0, peak = 0;
  J._setScraper(async () => {
    peak = Math.max(peak, ++running);
    await new Promise(r => setTimeout(r, 30));
    running--;
    throw new Error('Maps blocked us');
  });
  const jobs = [1, 2, 3].map(i => J.createJob(`Fail ${i}`, ['x'], { autoImport: true }, pid));
  assert.equal(jobs[2].status, 'pending', 'the third one waits its turn');
  const finished = await Promise.all(jobs.map(j => done(j.id)));
  assert.equal(peak, 1);
  for (const j of finished) {
    assert.equal(j.status, 'failed');
    assert.equal(j.error, 'Maps blocked us');
    assert.equal(j.queryErrors[0].query, 'x');
  }
});

test('one failed keyword keeps the results of the others', async () => {
  J._setScraper(async (q) => {
    if (q === 'bad') throw new Error('timeout');
    return [biz('Partial Bakery', '+201000000705')];
  });
  const j = await done(J.createJob('Partial', ['good', 'bad'], {}, pid).id);
  assert.equal(j.status, 'completed');
  assert.equal(j.results.length, 1);
  assert.deepEqual(j.queryErrors, [{ query: 'bad', error: 'timeout' }]);
});

test('import stores the business type as a category and creates no tag per category', async () => {
  J._setScraper(async () => [biz('Category Bakery', '+201000000706')]);
  await done(J.createJob('Category', ['bakeries'], { autoImport: true }, pid).id);
  assert.equal(db.prepare("SELECT category FROM leads WHERE name = 'Category Bakery'").get().category, 'Bakery');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tags WHERE project_id = ? AND name = 'Bakery'").get(pid).n, 0);
});
