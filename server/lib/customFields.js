// Custom field definitions + validation of the `custom` JSON on contacts, companies and deals.
import { getDB } from '../db.js';
import { isProjectMember } from './scope.js';

export const ENTITIES = ['contact', 'company', 'deal'];
export const TYPES = ['text', 'textarea', 'number', 'money', 'date', 'select', 'multiselect', 'checkbox', 'url', 'email', 'phone', 'user'];
export const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
// Entity → table holding its `custom` column
export const ENTITY_TABLE = { contact: 'leads', company: 'companies', deal: 'deals' };

export function getDefs(projectId, entity) {
  return getDB().prepare('SELECT * FROM custom_fields WHERE project_id = ? AND entity = ? ORDER BY sort_order, created_at')
    .all(projectId, entity).map(serializeDef);
}

export function serializeDef(d) {
  let options = [];
  try { options = JSON.parse(d.options || '[]'); } catch {}
  return { ...d, options, required: !!d.required };
}

const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

// Coerce one value for a field definition. Returns { value } or { error }.
function coerce(def, v, projectId) {
  if (isEmpty(v)) return { value: null };
  switch (def.type) {
    case 'text': case 'phone': return { value: String(v).slice(0, 500) };
    case 'textarea': return { value: String(v).slice(0, 10000) };
    case 'number': case 'money': {
      const n = Number(v);
      return Number.isFinite(n) ? { value: n } : { error: `${def.label} must be a number` };
    }
    case 'date': {
      const t = typeof v === 'number' ? v : Date.parse(v);
      return Number.isFinite(t) ? { value: t } : { error: `${def.label} must be a date` };
    }
    case 'checkbox': return { value: v === true || v === 'true' || v === 1 || v === '1' };
    case 'url': {
      const s = String(v).trim();
      return /^https?:\/\/\S+$/i.test(s) ? { value: s.slice(0, 1000) } : { error: `${def.label} must be a URL (https://…)` };
    }
    case 'email': {
      const s = String(v).trim();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { value: s.slice(0, 320) } : { error: `${def.label} must be an email address` };
    }
    case 'select':
      return def.options.includes(v) ? { value: v } : { error: `${def.label}: "${v}" is not an option` };
    case 'multiselect': {
      const arr = Array.isArray(v) ? v : [v];
      const bad = arr.find(x => !def.options.includes(x));
      return bad !== undefined ? { error: `${def.label}: "${bad}" is not an option` } : { value: [...new Set(arr)] };
    }
    case 'user':
      return isProjectMember(projectId, v) ? { value: v } : { error: `${def.label} must be a member of this workspace` };
    default:
      return { error: `Unknown field type ${def.type}` };
  }
}

// Merge `input` (partial: keys present are set, null clears) over `existing` values, keeping only defined
// fields. On create, required fields must be present. Returns { value } (object) or { error }.
export function validateCustom(projectId, entity, input, existing = {}, { create = false } = {}) {
  if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) {
    return { error: 'custom must be an object' };
  }
  const defs = getDefs(projectId, entity);
  const out = {};
  for (const def of defs) {
    let val = existing?.[def.key];
    if (input && Object.prototype.hasOwnProperty.call(input, def.key)) {
      const r = coerce(def, input[def.key], projectId);
      if (r.error) return { error: r.error };
      val = r.value;
    }
    if (def.required && isEmpty(val) && (create || (input && Object.prototype.hasOwnProperty.call(input, def.key)))) {
      return { error: `${def.label} is required` };
    }
    if (!isEmpty(val)) out[def.key] = val;
  }
  return { value: out };
}

// Adds `AND json_extract(custom, '$.key') = ?` clauses for ?cf.<key>=value query params.
// Multiselect matches if the array contains the value; checkbox accepts true/false.
export function customFilterSql(projectId, entity, query) {
  const defs = new Map(getDefs(projectId, entity).map(d => [d.key, d]));
  let sql = '';
  const params = [];
  for (const [param, raw] of Object.entries(query)) {
    if (!param.startsWith('cf.')) continue;
    const key = param.slice(3);
    const def = defs.get(key);
    if (!def || !KEY_RE.test(key)) continue;
    if (raw === '__empty') { sql += ` AND json_extract(custom, '$.${key}') IS NULL`; continue; }
    if (def.type === 'multiselect') {
      sql += ` AND EXISTS (SELECT 1 FROM json_each(custom, '$.${key}') WHERE value = ?)`;
      params.push(String(raw));
    } else if (def.type === 'checkbox') {
      sql += ` AND COALESCE(json_extract(custom, '$.${key}'), 0) = ?`;
      params.push(raw === 'true' ? 1 : 0);
    } else if (def.type === 'number' || def.type === 'money') {
      sql += ` AND json_extract(custom, '$.${key}') = ?`;
      params.push(Number(raw));
    } else {
      sql += ` AND json_extract(custom, '$.${key}') = ?`;
      params.push(String(raw));
    }
  }
  return { sql, params };
}
