import { Router } from 'express';
import crypto from 'crypto';
import { requirePermission } from './auth.js';
import { getDB, logAudit } from '../db.js';
import { ENTITIES, TYPES, KEY_RE, ENTITY_TABLE, getDefs, serializeDef } from '../lib/customFields.js';

const router = Router();

const slug = (label) => label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40);

function cleanOptions(type, options) {
  if (type !== 'select' && type !== 'multiselect') return { value: [] };
  if (!Array.isArray(options)) return { error: 'options must be a list' };
  const list = [...new Set(options.map(o => String(o).trim()).filter(Boolean))].slice(0, 200);
  return list.length ? { value: list } : { error: 'Select fields need at least one option' };
}

function getField(db, pid, id) {
  return db.prepare('SELECT * FROM custom_fields WHERE id = ? AND project_id = ?').get(id, pid);
}

// Definitions are reference data (forms and tables need them): any member can read.
router.get('/', (req, res) => {
  const pid = req.project.id;
  if (req.query.entity) {
    if (!ENTITIES.includes(req.query.entity)) return res.status(400).json({ error: 'Invalid entity' });
    return res.json(getDefs(pid, req.query.entity));
  }
  res.json(Object.fromEntries(ENTITIES.map(e => [e, getDefs(pid, e)])));
});

router.post('/', requirePermission('settings.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const { entity, type, required } = req.body;
  const label = String(req.body.label || '').trim().slice(0, 100);
  if (!ENTITIES.includes(entity)) return res.status(400).json({ error: 'entity must be contact, company or deal' });
  if (!TYPES.includes(type)) return res.status(400).json({ error: `type must be one of ${TYPES.join(', ')}` });
  if (!label) return res.status(400).json({ error: 'Label required' });
  const key = req.body.key ? String(req.body.key) : slug(label);
  if (!KEY_RE.test(key)) return res.status(400).json({ error: 'Key must start with a letter and use a–z, 0–9, _' });
  if (db.prepare('SELECT 1 FROM custom_fields WHERE project_id = ? AND entity = ? AND key = ?').get(pid, entity, key)) {
    return res.status(409).json({ error: `A ${entity} field with key "${key}" already exists` });
  }
  const opts = cleanOptions(type, req.body.options);
  if (opts.error) return res.status(400).json({ error: opts.error });
  const id = 'cf_' + crypto.randomBytes(6).toString('hex');
  const order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM custom_fields WHERE project_id = ? AND entity = ?').get(pid, entity).n;
  db.prepare(`INSERT INTO custom_fields (id, project_id, entity, key, label, type, options, required, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, pid, entity, key, label, type, JSON.stringify(opts.value), required ? 1 : 0, order, Date.now());
  logAudit('create', 'custom_field', id, `${entity}.${key}`, { type }, pid);
  res.status(201).json(serializeDef(getField(db, pid, id)));
});

// Key, type and entity are fixed after creation (stored values depend on them).
router.put('/:id', requirePermission('settings.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const f = getField(db, pid, req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  const sets = {};
  if (req.body.label !== undefined) {
    const label = String(req.body.label).trim().slice(0, 100);
    if (!label) return res.status(400).json({ error: 'Label required' });
    sets.label = label;
  }
  if (req.body.options !== undefined) {
    const opts = cleanOptions(f.type, req.body.options);
    if (opts.error) return res.status(400).json({ error: opts.error });
    sets.options = JSON.stringify(opts.value);
  }
  if (req.body.required !== undefined) sets.required = req.body.required ? 1 : 0;
  if (req.body.sort_order !== undefined) sets.sort_order = parseInt(req.body.sort_order) || 0;
  const cols = Object.keys(sets);
  if (cols.length) db.prepare(`UPDATE custom_fields SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(sets), f.id);
  res.json(serializeDef(getField(db, pid, f.id)));
});

// Deleting a field also removes its stored values.
router.delete('/:id', requirePermission('settings.edit'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const f = getField(db, pid, req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  const table = ENTITY_TABLE[f.entity];
  db.transaction(() => {
    db.prepare(`UPDATE ${table} SET custom = json_remove(custom, '$.${f.key}') WHERE project_id = ? AND json_extract(custom, '$.${f.key}') IS NOT NULL`).run(pid);
    db.prepare('DELETE FROM custom_fields WHERE id = ?').run(f.id);
  })();
  logAudit('delete', 'custom_field', f.id, `${f.entity}.${f.key}`, {}, pid);
  res.json({ ok: true });
});

export default router;
