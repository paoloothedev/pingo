// 016 — a contact's business type gets its own field. The scraper used to make one tag per Google category (100+ tags
// in a workspace, making tags unusable as filters). Existing category tags stay until the user cleans them up
// (Settings → Tags), since that deletes tags.
export const id = '016-lead-category';

export function up(db) {
  if (!db.prepare('PRAGMA table_info(leads)').all().some(c => c.name === 'category')) db.exec('ALTER TABLE leads ADD COLUMN category TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_project_category ON leads(project_id, category)');
  const set = db.prepare('UPDATE leads SET category = ? WHERE id = ?');
  for (const l of db.prepare("SELECT id, notes FROM leads WHERE notes LIKE '%Category: %'").all()) {
    const m = String(l.notes).match(/^Category: (.+)$/m);
    if (m) set.run(m[1].trim().slice(0, 120), l.id);
  }
}
