// Durable background jobs, stored in the `queue` table and run inside the server process.
//
//   registerHandler('email.send', async (payload, job) => { ... })   // at module load
//   enqueue('email.send', { to }, { projectId, runAt, dedupeKey })   // anywhere
//
// Handlers must be idempotent: a job can run again if the process dies mid-run. Throwing retries the job
// with exponential backoff until max_attempts, then it is marked 'failed' (kept for inspection).
import { getDB } from '../db.js';

const handlers = new Map();
let timer = null;
let running = 0;
let stopping = false;

const CONCURRENCY = 2;
const TICK_MS = 1000;
const BASE_BACKOFF_MS = 30_000;
const KEEP_DONE_MS = 7 * 24 * 60 * 60 * 1000;

export function registerHandler(type, fn) {
  handlers.set(type, fn);
}

// Returns the job id, or the existing job's id if a pending/running job has the same dedupeKey.
export function enqueue(type, payload = {}, { projectId = null, runAt = Date.now(), maxAttempts = 5, dedupeKey = null } = {}) {
  const db = getDB();
  if (dedupeKey) {
    const existing = db.prepare("SELECT id FROM queue WHERE dedupe_key = ? AND status IN ('pending', 'running')").get(dedupeKey);
    if (existing) return existing.id;
  }
  const now = Date.now();
  return db.prepare(`
    INSERT INTO queue (type, payload, project_id, status, run_at, max_attempts, dedupe_key, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)
  `).run(type, JSON.stringify(payload), projectId, runAt, maxAttempts, dedupeKey, now, now).lastInsertRowid;
}

export function cancelJobs({ type, projectId, dedupeKey }) {
  const where = ["status = 'pending'"];
  const params = [];
  if (type) { where.push('type = ?'); params.push(type); }
  if (projectId) { where.push('project_id = ?'); params.push(projectId); }
  if (dedupeKey) { where.push('dedupe_key = ?'); params.push(dedupeKey); }
  return getDB().prepare(`UPDATE queue SET status = 'cancelled', updated_at = ? WHERE ${where.join(' AND ')}`).run(Date.now(), ...params).changes;
}

// Atomically take the next due job (single process, but keeps it safe against overlapping ticks).
function claim() {
  const db = getDB();
  return db.transaction(() => {
    const job = db.prepare("SELECT * FROM queue WHERE status = 'pending' AND run_at <= ? ORDER BY run_at, id LIMIT 1").get(Date.now());
    if (!job) return null;
    db.prepare("UPDATE queue SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?").run(Date.now(), job.id);
    return { ...job, attempts: job.attempts + 1 };
  })();
}

async function runOne(job) {
  const db = getDB();
  const handler = handlers.get(job.type);
  try {
    if (!handler) throw new Error(`No handler registered for ${job.type}`);
    await handler(JSON.parse(job.payload || '{}'), job);
    db.prepare("UPDATE queue SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?").run(Date.now(), job.id);
  } catch (err) {
    const msg = String(err?.message || err).slice(0, 1000);
    if (job.attempts >= job.max_attempts) {
      db.prepare("UPDATE queue SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?").run(msg, Date.now(), job.id);
      console.error(`[worker] ${job.type}#${job.id} failed permanently: ${msg}`);
    } else {
      const delay = BASE_BACKOFF_MS * 2 ** (job.attempts - 1);
      db.prepare("UPDATE queue SET status = 'pending', last_error = ?, run_at = ?, updated_at = ? WHERE id = ?").run(msg, Date.now() + delay, Date.now(), job.id);
    }
  }
}

// Run due jobs until none are left or concurrency is full. Exported for tests.
export async function drain() {
  const inflight = [];
  while (!stopping && running < CONCURRENCY) {
    const job = claim();
    if (!job) break;
    running++;
    inflight.push(runOne(job).finally(() => { running--; }));
  }
  await Promise.all(inflight);
}

export function startWorker() {
  if (timer) return;
  stopping = false;
  const db = getDB();
  // Jobs left 'running' by a crash/restart go back to the queue.
  const recovered = db.prepare("UPDATE queue SET status = 'pending', updated_at = ? WHERE status = 'running'").run(Date.now()).changes;
  if (recovered) console.log(`[worker] Re-queued ${recovered} interrupted jobs`);
  let lastPrune = 0;
  const tick = async () => {
    try {
      await drain();
      if (Date.now() - lastPrune > 60 * 60 * 1000) {
        lastPrune = Date.now();
        db.prepare("DELETE FROM queue WHERE status IN ('done', 'cancelled') AND updated_at < ?").run(Date.now() - KEEP_DONE_MS);
      }
    } catch (err) {
      console.error('[worker] tick failed:', err.message);
    }
    if (!stopping) timer = setTimeout(tick, TICK_MS);
  };
  timer = setTimeout(tick, TICK_MS);
}

export function stopWorker() {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = null;
}
