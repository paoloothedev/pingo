import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scrapeGmaps } from './scraper.js';
import { importJobResults } from './import.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_FILE = process.env.GMAPS_JOBS_FILE || path.join(__dirname, 'jobs_data.json');

const jobs = new Map();

// For tests: replace the browser scrape.
let scrape = scrapeGmaps;
export const _setScraper = (fn) => { scrape = fn; };

// One browser at a time, whoever asks: each scrape opens its own Chromium.
let queue = Promise.resolve();
const enqueue = (id) => {
  queue = queue.then(() => runJob(id)).catch(err => console.error(`[gmaps] Job ${id} crashed: ${err.message}`));
  return queue;
};

function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const data = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
      for (const [id, job] of Object.entries(data)) {
        if (job.status === 'running') job.status = 'pending';
        jobs.set(id, job);
      }
      console.log(`[gmaps] Loaded ${jobs.size} jobs from disk`);
    }
  } catch (err) {
    console.error('[gmaps] Failed to load jobs:', err.message);
  }
}

function saveJobs() {
  try {
    const obj = {};
    for (const [id, job] of jobs) {
      obj[id] = { ...job, progress: null };
    }
    fs.writeFileSync(JOBS_FILE, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.error('[gmaps] Failed to save jobs:', err.message);
  }
}

function createJob(name, queries, options = {}, projectId = null) {
  const id = crypto.randomBytes(8).toString('hex');
  const job = {
    id,
    name: name || 'Untitled Scrape',
    queries: Array.isArray(queries) ? queries : [queries],
    options,
    projectId,
    status: 'pending',
    results: [],
    totalFound: 0,
    error: null,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    progress: null,
    currentQuery: null,
  };
  jobs.set(id, job);
  saveJobs();
  enqueue(id);
  return job;
}

async function runJob(id) {
  const job = jobs.get(id);
  if (!job || job.status === 'completed' || job.status === 'failed') return;

  job.status = 'running';
  job.startedAt = Date.now();

  const allResults = [];
  const seen = new Set();
  const queryErrors = [];

  for (let qi = 0; qi < job.queries.length; qi++) {
    const query = job.queries[qi].trim();
    if (!query) continue;

    job.currentQuery = query;
    job.progress = { phase: 'searching', message: `Query ${qi + 1}/${job.queries.length}: ${query}` };

    console.log(`[gmaps] Job ${id}: scraping "${query}" (${qi + 1}/${job.queries.length})`);

    try {
      const results = await scrape(query, {
        depth: job.options.depth || 10,
        lang: job.options.lang || 'en',
        geo: job.options.geo || '',
        zoom: job.options.zoom || 0,
        onProgress: (p) => {
          p.queryIndex = qi;
          p.totalQueries = job.queries.length;
          job.progress = p;
        },
      });

      for (const r of results) {
        const key = (r.title || '') + (r.phone || '') + (r.address || '');
        if (!seen.has(key)) {
          seen.add(key);
          allResults.push(r);
        }
      }

      console.log(`[gmaps] Job ${id}: "${query}" returned ${results.length} results (${allResults.length} total unique)`);
      // Keep what we have so far: a crash or restart loses at most the current keyword
      job.results = allResults;
      job.totalFound = allResults.length;
      saveJobs();
    } catch (err) {
      console.error(`[gmaps] Job ${id}: query "${query}" failed: ${err.message}`);
      queryErrors.push({ query, error: err.message });
    }

    if (qi < job.queries.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  job.results = allResults;
  job.totalFound = allResults.length;
  job.queryErrors = queryErrors;
  // "completed" with nothing to show would hide a broken scrape
  const allFailed = queryErrors.length > 0 && allResults.length === 0;
  job.status = allFailed ? 'failed' : 'completed';
  job.error = allFailed ? queryErrors[0].error : null;
  job.currentQuery = null;
  job.progress = null;
  job.completedAt = Date.now();
  saveJobs();

  if (job.options?.autoImport && !job.imported && allResults.length > 0) {
    try {
      const r = await importJobResults(job, { checkWhatsApp: !!job.options.checkWhatsApp, userId: job.options.userId });
      console.log(`[gmaps] Job ${id}: auto-imported ${r.added} contacts (${r.skipped} skipped)`);
    } catch (err) {
      console.error(`[gmaps] Job ${id}: auto-import failed: ${err.message}`);
      job.importError = err.message;
    }
    saveJobs();
  }

  console.log(`[gmaps] Job ${id}: completed with ${allResults.length} total unique results`);
}

function getJob(id, projectId = null) {
  const job = jobs.get(id) || null;
  if (!job) return null;
  if (projectId && job.projectId !== projectId) return null;
  return job;
}

function listJobs(projectId = null) {
  let list = Array.from(jobs.values());
  if (projectId) list = list.filter(j => j.projectId === projectId);
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

function deleteJob(id, projectId = null) {
  const job = jobs.get(id);
  if (!job) return false;
  if (projectId && job.projectId !== projectId) return false;
  if (job.status === 'running') return false;
  jobs.delete(id);
  saveJobs();
  return true;
}

// Jobs created before multi-project support have no projectId; give them to the default project
// so they don't show up in every workspace.
function adoptLegacyJobs(defaultProjectId) {
  if (!defaultProjectId) return;
  let changed = 0;
  for (const job of jobs.values()) {
    if (!job.projectId) { job.projectId = defaultProjectId; changed++; }
  }
  if (changed) { saveJobs(); console.log(`[gmaps] Assigned ${changed} legacy jobs to ${defaultProjectId}`); }
}

// Jobs that were running/pending when the server stopped are resumed one at a time (each opens a browser).
async function resumePendingJobs() {
  const pending = Array.from(jobs.values()).filter(j => j.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
  if (!pending.length) return;
  console.log(`[gmaps] Resuming ${pending.length} interrupted jobs`);
  await Promise.all(pending.map(job => enqueue(job.id)));
}

export { createJob, getJob, listJobs, deleteJob, adoptLegacyJobs, resumePendingJobs, saveJobs };

loadJobs();
