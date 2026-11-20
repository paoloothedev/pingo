import { Router } from 'express';
import { wrap } from '../lib/async.js';
import { requirePermission } from './auth.js';
import { createJob, getJob, listJobs, deleteJob, saveJobs } from '../gmaps/jobs.js';
import { importJobResults } from '../gmaps/import.js';
import { logAudit } from '../db.js';

const router = Router();

router.post('/scrape', requirePermission('leads.import'), (req, res) => {
  const { name, query, queries, depth, lang, geo, zoom, autoImport, checkWhatsApp } = req.body;

  let queryList = [];
  if (queries && Array.isArray(queries) && queries.length > 0) {
    queryList = queries.map(q => q.trim()).filter(Boolean);
  } else if (query && query.trim()) {
    queryList = [query.trim()];
  }

  if (!queryList.length) return res.status(400).json({ error: 'At least one query is required' });

  const job = createJob(name || queryList[0], queryList, {
    depth: Math.min(Math.max(parseInt(depth) || 10, 1), 20),
    lang: lang || 'en',
    geo: geo || '',
    zoom: Math.min(Math.max(parseInt(zoom) || 0, 0), 21),
    autoImport: !!autoImport,
    checkWhatsApp: !!checkWhatsApp,
    userId: req.user?.id || null,
  }, req.project.id);

  logAudit('gmaps_scrape', 'gmaps_job', job.id, job.name, { by: req.user?.id, queries: queryList, geo, zoom }, req.project.id);
  res.json({ job_id: job.id, status: job.status });
});

router.get('/jobs', requirePermission('leads.import'), (req, res) => {
  const allJobs = listJobs(req.project.id).map(j => ({
    id: j.id,
    name: j.name,
    queries: j.queries,
    options: j.options,
    status: j.status,
    result_count: j.results?.length || 0,
    total_found: j.totalFound || 0,
    error: j.error,
    query_errors: j.queryErrors || [],
    imported: j.imported || null,
    import_error: j.importError || null,
    progress: j.progress,
    current_query: j.currentQuery,
    created_at: j.createdAt,
    started_at: j.startedAt,
    completed_at: j.completedAt,
  }));
  res.json(allJobs);
});

router.get('/jobs/:id', requirePermission('leads.import'), (req, res) => {
  const job = getJob(req.params.id, req.project.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.json({
    id: job.id,
    name: job.name,
    queries: job.queries,
    options: job.options,
    status: job.status,
    results: job.results,
    result_count: job.results?.length || 0,
    total_found: job.totalFound || 0,
    error: job.error,
    query_errors: job.queryErrors || [],
    imported: job.imported || null,
    import_error: job.importError || null,
    progress: job.progress,
    current_query: job.currentQuery,
    created_at: job.createdAt,
    started_at: job.startedAt,
    completed_at: job.completedAt,
  });
});

router.delete('/jobs/:id', requirePermission('leads.import'), (req, res) => {
  const ok = deleteJob(req.params.id, req.project.id);
  if (!ok) return res.status(404).json({ error: 'Job not found or still running' });
  res.json({ ok: true });
});

router.get('/jobs/:id/download', requirePermission('leads.import'), (req, res) => {
  const job = getJob(req.params.id, req.project.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'completed' || !job.results?.length) return res.status(400).json({ error: 'No results' });

  const headers = [
    'input_id', 'link', 'title', 'category', 'address', 'open_hours',
    'popular_times', 'website', 'phone', 'plus_code', 'review_count',
    'review_rating', 'reviews_per_rating', 'latitude', 'longitude', 'cid',
    'status', 'descriptions', 'reviews_link', 'thumbnail', 'timezone',
    'price_range', 'data_id', 'street_view_url', 'place_id', 'images',
    'reservations', 'order_online', 'menu', 'owner', 'complete_address',
    'about', 'user_reviews', 'user_reviews_extended', 'emails',
  ];

  const escapeCSV = (val) => {
    const s = val == null ? '' : String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  let csv = headers.join(',') + '\n';
  for (const r of job.results) {
    const email = Array.isArray(r.emails) ? r.emails.join(', ') : (r.email || '');
    const row = [
      r.id || r.input_id || '',
      r.link || '',
      r.title || r.name || '',
      r.category || (Array.isArray(r.categories) ? r.categories[0] : ''),
      r.address || '',
      r.open_hours ? JSON.stringify(r.open_hours) : '',
      r.popular_times ? JSON.stringify(r.popular_times) : '',
      r.website || r.web_site || '',
      r.phone || '',
      r.plus_code || '',
      r.review_count || 0,
      r.review_rating || 0,
      r.reviews_per_rating ? JSON.stringify(r.reviews_per_rating) : '',
      r.latitude || 0,
      r.longitude || r.longtitude || 0,
      r.cid || '',
      r.status || '',
      r.description || '',
      r.reviews_link || '',
      r.thumbnail || '',
      r.timezone || '',
      r.price_range || '',
      r.data_id || '',
      r.street_view_url || '',
      r.place_id || '',
      r.images ? JSON.stringify(r.images) : '',
      r.reservations ? JSON.stringify(r.reservations) : '',
      r.order_online ? JSON.stringify(r.order_online) : '',
      r.menu ? JSON.stringify(r.menu) : '',
      r.owner ? JSON.stringify(r.owner) : '',
      r.complete_address ? JSON.stringify(r.complete_address) : '',
      r.about ? JSON.stringify(r.about) : '',
      r.user_reviews ? JSON.stringify(r.user_reviews) : '',
      r.user_reviews_extended ? JSON.stringify(r.user_reviews_extended) : '',
      email,
    ];
    csv += row.map(escapeCSV).join(',') + '\n';
  }

  const safeName = (job.query || 'gmaps-results').replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '-');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.csv"`);
  res.send(csv);
});

router.post('/jobs/:id/import', requirePermission('leads.import'), wrap(async (req, res) => {
  const job = getJob(req.params.id, req.project.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'completed') return res.status(400).json({ error: 'Job not completed' });
  if (!job.results?.length) return res.status(400).json({ error: 'No results to import' });

  const { skipDupes = true, selectedIndices, checkWhatsApp = false } = req.body;
  const result = await importJobResults(job, { skipDupes, selectedIndices, checkWhatsApp, userId: req.user?.id });
  saveJobs();
  res.json(result);
}));

export default router;
