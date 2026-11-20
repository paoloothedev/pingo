import { Router } from 'express';
import { requirePermission } from './auth.js';
import { getDB, logAudit } from '../db.js';

const router = Router();

function genId() {
  return 'tag_' + Math.random().toString(36).slice(2, 10);
}

// List all tags
router.get('/', (req, res) => {
  const db = getDB();
  const tags = db.prepare(`
    SELECT t.*, COUNT(lt.lead_id) as lead_count
    FROM tags t
    LEFT JOIN lead_tags lt ON lt.tag_id = t.id
    WHERE t.project_id = ?
    GROUP BY t.id ORDER BY t.name
  `).all(req.project.id);
  res.json(tags);
});

// Create tag
router.post('/', requirePermission('tags.edit'), (req, res) => {
  const db = getDB();
  const { name, color } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  // Same name (any case) = the same tag: re-creating one must not leave two filters that look alike
  const same = db.prepare('SELECT * FROM tags WHERE project_id = ? AND LOWER(name) = LOWER(?)').get(req.project.id, name.trim());
  if (same) return res.json({ ...same, lead_count: db.prepare('SELECT COUNT(*) AS n FROM lead_tags WHERE tag_id = ?').get(same.id).n, existed: true });
  const id = genId();
  db.prepare('INSERT INTO tags (id, name, color, created_at, project_id) VALUES (?, ?, ?, ?, ?)').run(id, name.trim(), color || '#3d5a45', Date.now(), req.project.id);
  logAudit('create', 'tag', id, name.trim(), {}, req.project.id);
  const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
  tag.lead_count = 0;
  res.status(201).json(tag);
});

// Tags that only repeat a contact's business type: same name as the category of every contact carrying them.
function categoryTags(projectId) {
  return getDB().prepare(`SELECT t.id, t.name, COUNT(*) AS lead_count FROM tags t
    INNER JOIN lead_tags lt ON lt.tag_id = t.id INNER JOIN leads l ON l.id = lt.lead_id
    WHERE t.project_id = ? GROUP BY t.id
    HAVING SUM(l.category = t.name) > 0 AND SUM(l.category IS NOT NULL AND l.category != '' AND l.category != t.name) = 0
    ORDER BY lead_count DESC, t.name`).all(projectId);
}

function unusedTags(projectId) {
  return getDB().prepare(`SELECT t.id, t.name FROM tags t WHERE t.project_id = ?
    AND NOT EXISTS (SELECT 1 FROM lead_tags lt WHERE lt.tag_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM client_tags ct WHERE ct.tag_id = t.id) ORDER BY t.name`).all(projectId);
}

// Saved contact views keep working when a tag they filter on goes away.
function dropFromSavedViews(projectId, tagIds) {
  const db = getDB();
  const gone = new Set(tagIds);
  const upd = db.prepare('UPDATE saved_views SET filters = ? WHERE id = ?');
  for (const v of db.prepare('SELECT id, filters FROM saved_views WHERE project_id = ?').all(projectId)) {
    let f;
    try { f = JSON.parse(v.filters); } catch { continue; }
    if (!Array.isArray(f.fTag) || !f.fTag.some(t => gone.has(t))) continue;
    f.fTag = f.fTag.filter(t => !gone.has(t));
    upd.run(JSON.stringify(f), v.id);
  }
}

// What a cleanup would remove. Nothing changes.
router.get('/cleanup', requirePermission('tags.edit'), (req, res) => {
  res.json({ category_tags: categoryTags(req.project.id), unused_tags: unusedTags(req.project.id) });
});

// Removes tags that repeat the business type (it stays on each contact as `category`) and, if asked, unused tags.
router.post('/cleanup', requirePermission('tags.edit'), (req, res) => {
  const db = getDB();
  const projectId = req.project.id;
  const { categories = true, unused = false } = req.body || {};
  const fromCategories = categories ? categoryTags(projectId) : [];
  const fromUnused = unused ? unusedTags(projectId) : [];
  const fill = db.prepare(`UPDATE leads SET category = ? WHERE project_id = ? AND (category IS NULL OR category = '')
    AND id IN (SELECT lead_id FROM lead_tags WHERE tag_id = ?)`);
  const delLinks = db.prepare('DELETE FROM lead_tags WHERE tag_id = ?');
  const del = db.prepare('DELETE FROM tags WHERE id = ? AND project_id = ?');
  const ids = [...fromCategories, ...fromUnused].map(t => t.id);
  db.transaction(() => {
    for (const t of fromCategories) { fill.run(t.name, projectId, t.id); delLinks.run(t.id); del.run(t.id, projectId); }
    for (const t of fromUnused) del.run(t.id, projectId);
    dropFromSavedViews(projectId, ids);
  })();
  logAudit('cleanup', 'tag', projectId, `${ids.length} tags`, { categories: fromCategories.map(t => t.name), unused: fromUnused.map(t => t.name) }, projectId);
  res.json({ removed_category_tags: fromCategories.length, removed_unused_tags: fromUnused.length });
});

// Move every contact from this tag onto another one, then delete it.
router.post('/:id/merge', requirePermission('tags.edit'), (req, res) => {
  const db = getDB();
  const projectId = req.project.id;
  const from = db.prepare('SELECT * FROM tags WHERE id = ? AND project_id = ?').get(req.params.id, projectId);
  const into = db.prepare('SELECT * FROM tags WHERE id = ? AND project_id = ?').get(req.body?.into, projectId);
  if (!from || !into) return res.status(404).json({ error: 'Tag not found' });
  if (from.id === into.id) return res.status(400).json({ error: 'Pick a different tag' });
  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) SELECT lead_id, ? FROM lead_tags WHERE tag_id = ?').run(into.id, from.id);
    db.prepare('DELETE FROM lead_tags WHERE tag_id = ?').run(from.id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(from.id);
    dropFromSavedViews(projectId, [from.id]);
  })();
  logAudit('merge', 'tag', into.id, into.name, { from: from.name }, projectId);
  res.json({ ok: true, into: into.id });
});

// Update tag
router.put('/:id', requirePermission('tags.edit'), (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM tags WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name, color, show_in_dashboard } = req.body;
  db.prepare('UPDATE tags SET name=?, color=?, show_in_dashboard=? WHERE id=?').run(
    name ?? existing.name,
    color ?? existing.color,
    show_in_dashboard !== undefined ? (show_in_dashboard ? 1 : 0) : existing.show_in_dashboard,
    req.params.id
  );
  logAudit('edit', 'tag', req.params.id, existing.name, { changes: req.body }, req.project.id);
  const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
  res.json(tag);
});

// Delete tag
router.delete('/:id', requirePermission('tags.edit'), (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT name FROM tags WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  db.prepare('DELETE FROM tags WHERE id = ? AND project_id = ?').run(req.params.id, req.project.id);
  logAudit('delete', 'tag', req.params.id, existing?.name || 'unknown', {}, req.project.id);
  res.json({ ok: true });
});

export default router;
