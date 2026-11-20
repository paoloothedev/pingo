import { Router } from 'express';
import crypto from 'crypto';
import { hasPermission } from './auth.js';
import { getDB } from '../db.js';

// Mounted at /api/search and /api/views
export const searchRouter = Router();
export const viewsRouter = Router();

// One box across contacts, companies and deals (only the kinds the user may view). Matches name/title,
// phone digits, email and company domain.
searchRouter.get('/', (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const q = String(req.query.q || '').trim();
  const limit = Math.min(25, parseInt(req.query.limit) || 8);
  if (q.length < 2) return res.json({ contacts: [], companies: [], deals: [] });
  const like = `%${q}%`;
  const digits = q.replace(/\D/g, '');
  const phoneLike = digits.length >= 3 ? `%${digits}%` : null;
  const out = { contacts: [], companies: [], deals: [] };

  if (hasPermission(req.user, 'leads.view')) {
    out.contacts = db.prepare(`
      SELECT id, name, phone, email, lifecycle, status FROM leads
      WHERE project_id = ? AND (name LIKE ? OR email LIKE ? ${phoneLike ? 'OR phone LIKE ?' : ''})
      ORDER BY status = 'active' DESC, updated_at DESC, created_at DESC LIMIT ?
    `).all(pid, like, like, ...(phoneLike ? [phoneLike] : []), limit);
    out.companies = db.prepare(`
      SELECT id, name, domain, city, industry FROM companies
      WHERE project_id = ? AND (name LIKE ? OR domain LIKE ? OR email LIKE ? ${phoneLike ? 'OR phone LIKE ?' : ''})
      ORDER BY name LIMIT ?
    `).all(pid, like, like, like, ...(phoneLike ? [phoneLike] : []), limit);
  }
  if (hasPermission(req.user, 'deals.view')) {
    out.deals = db.prepare(`
      SELECT d.id, d.title, d.value, d.currency, d.status, s.name AS stage_name FROM deals d
      LEFT JOIN pipeline_stages s ON s.id = d.stage_id
      WHERE d.project_id = ? AND d.title LIKE ? ORDER BY d.updated_at DESC LIMIT ?
    `).all(pid, like, limit);
  }
  res.json(out);
});

const ENTITIES = ['contact', 'company', 'deal'];
const serialize = (v) => { let filters = {}; try { filters = JSON.parse(v.filters); } catch {} return { ...v, filters, shared: !!v.shared }; };

// Own views + views shared with the workspace
viewsRouter.get('/', (req, res) => {
  const { entity } = req.query;
  if (entity && !ENTITIES.includes(entity)) return res.status(400).json({ error: 'Invalid entity' });
  const rows = getDB().prepare(`
    SELECT * FROM saved_views WHERE project_id = ? AND (account_id = ? OR shared = 1) ${entity ? 'AND entity = ?' : ''}
    ORDER BY name
  `).all(req.project.id, req.user.id, ...(entity ? [entity] : []));
  res.json(rows.map(serialize));
});

viewsRouter.post('/', (req, res) => {
  const { entity, filters, shared } = req.body;
  const name = String(req.body.name || '').trim().slice(0, 100);
  if (!ENTITIES.includes(entity)) return res.status(400).json({ error: 'Invalid entity' });
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return res.status(400).json({ error: 'filters must be an object' });
  const json = JSON.stringify(filters);
  if (json.length > 5000) return res.status(400).json({ error: 'filters too large' });
  const id = 'view_' + crypto.randomBytes(6).toString('hex');
  getDB().prepare('INSERT INTO saved_views (id, project_id, account_id, entity, name, filters, shared, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.project.id, req.user.id, entity, name, json, shared ? 1 : 0, Date.now());
  res.status(201).json(serialize(getDB().prepare('SELECT * FROM saved_views WHERE id = ?').get(id)));
});

// Only the creator can delete a view
viewsRouter.delete('/:id', (req, res) => {
  const r = getDB().prepare('DELETE FROM saved_views WHERE id = ? AND project_id = ? AND account_id = ?').run(req.params.id, req.project.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});
