// In-process test of the queue: points DB_PATH at a temp file before loading the modules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leaddesk-worker-'));
process.env.DB_PATH = path.join(tmp, 'w.db');
const { getDB } = await import('../db.js');
const W = await import('../worker/index.js');

const status = (id) => getDB().prepare('SELECT * FROM queue WHERE id = ?').get(id);
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('runs due jobs with their payload', async () => {
  const seen = [];
  W.registerHandler('t.ok', async (p) => { seen.push(p.n); });
  const id = W.enqueue('t.ok', { n: 1 });
  await W.drain();
  assert.deepEqual(seen, [1]);
  assert.equal(status(id).status, 'done');
});

test('does not run jobs scheduled in the future', async () => {
  let ran = false;
  W.registerHandler('t.later', async () => { ran = true; });
  const id = W.enqueue('t.later', {}, { runAt: Date.now() + 60_000 });
  await W.drain();
  assert.equal(ran, false);
  assert.equal(status(id).status, 'pending');
});

test('failures retry with backoff, then fail permanently', async () => {
  W.registerHandler('t.bad', async () => { throw new Error('boom'); });
  const id = W.enqueue('t.bad', {}, { maxAttempts: 2 });
  await W.drain();
  let j = status(id);
  assert.equal(j.status, 'pending');
  assert.equal(j.attempts, 1);
  assert.ok(j.run_at > Date.now() + 20_000, 'backoff applied');
  getDB().prepare('UPDATE queue SET run_at = 0 WHERE id = ?').run(id);
  await W.drain();
  j = status(id);
  assert.equal(j.status, 'failed');
  assert.equal(j.last_error, 'boom');
});

test('dedupe key prevents duplicate pending jobs; cancel works', async () => {
  const a = W.enqueue('t.later', {}, { runAt: Date.now() + 60_000, dedupeKey: 'reminder:1' });
  const b = W.enqueue('t.later', {}, { runAt: Date.now() + 60_000, dedupeKey: 'reminder:1' });
  assert.equal(a, b);
  assert.equal(W.cancelJobs({ dedupeKey: 'reminder:1' }), 1);
  assert.equal(status(a).status, 'cancelled');
  const c = W.enqueue('t.later', {}, { runAt: Date.now() + 60_000, dedupeKey: 'reminder:1' });
  assert.notEqual(c, a);
});

test('unknown job types fail instead of being lost', async () => {
  const id = W.enqueue('t.nobody', {}, { maxAttempts: 1 });
  await W.drain();
  assert.equal(status(id).status, 'failed');
  assert.match(status(id).last_error, /No handler/);
});
