// Copy a workspace's *setup* (not its data) into a freshly created workspace: outreach stages, tags,
// message templates, deal pipelines + stages, custom field definitions and settings.
// Used when an agency onboards a new client business from an existing one.
import crypto from 'crypto';

const nid = (p) => `${p}_${crypto.randomBytes(6).toString('hex')}`;

// Settings that belong to one business and must not be copied
const PRIVATE_SETTINGS = new Set(['smtp_password', 'imap_password', 'api_key']);

export function copySetup(db, fromPid, toPid) {
  const now = Date.now();
  // The new workspace was seeded with defaults; replace them with the template's
  db.prepare('DELETE FROM pipeline_stages WHERE project_id = ?').run(toPid);
  db.prepare('DELETE FROM pipelines WHERE project_id = ?').run(toPid);
  db.prepare('DELETE FROM stages WHERE project_id = ?').run(toPid);

  const copied = { stages: 0, tags: 0, templates: 0, pipelines: 0, custom_fields: 0, settings: 0 };
  const insStage = db.prepare('INSERT INTO stages (id, name, color, sort_order, project_id) VALUES (?, ?, ?, ?, ?)');
  for (const s of db.prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY sort_order').all(fromPid)) {
    insStage.run(nid('stage'), s.name, s.color, s.sort_order, toPid); copied.stages++;
  }
  const insTag = db.prepare('INSERT INTO tags (id, name, color, created_at, project_id, show_in_dashboard) VALUES (?, ?, ?, ?, ?, ?)');
  for (const t of db.prepare('SELECT * FROM tags WHERE project_id = ?').all(fromPid)) {
    insTag.run(nid('tag'), t.name, t.color, now, toPid, t.show_in_dashboard); copied.tags++;
  }
  const insTpl = db.prepare('INSERT INTO message_templates (id, name, content, created_at, project_id) VALUES (?, ?, ?, ?, ?)');
  for (const t of db.prepare('SELECT * FROM message_templates WHERE project_id = ?').all(fromPid)) {
    insTpl.run(nid('tpl'), t.name, t.content, now, toPid); copied.templates++;
  }
  const insPipe = db.prepare('INSERT INTO pipelines (id, project_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)');
  const insPst = db.prepare(`INSERT INTO pipeline_stages (id, pipeline_id, project_id, name, color, sort_order, probability, rot_days, kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const p of db.prepare('SELECT * FROM pipelines WHERE project_id = ? ORDER BY sort_order').all(fromPid)) {
    const pipeId = nid('pipe');
    insPipe.run(pipeId, toPid, p.name, p.sort_order, now); copied.pipelines++;
    for (const s of db.prepare('SELECT * FROM pipeline_stages WHERE pipeline_id = ? ORDER BY sort_order').all(p.id)) {
      insPst.run(nid('pst'), pipeId, toPid, s.name, s.color, s.sort_order, s.probability, s.rot_days, s.kind, now);
    }
  }
  const insCF = db.prepare(`INSERT INTO custom_fields (id, project_id, entity, key, label, type, options, required, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const f of db.prepare('SELECT * FROM custom_fields WHERE project_id = ?').all(fromPid)) {
    insCF.run(nid('cf'), toPid, f.entity, f.key, f.label, f.type, f.options, f.required, f.sort_order, now); copied.custom_fields++;
  }
  const insSet = db.prepare('INSERT OR REPLACE INTO settings (project_id, key, value) VALUES (?, ?, ?)');
  for (const s of db.prepare('SELECT * FROM settings WHERE project_id = ?').all(fromPid)) {
    if (!PRIVATE_SETTINGS.has(s.key)) { insSet.run(toPid, s.key, s.value); copied.settings++; }
  }
  return copied;
}
