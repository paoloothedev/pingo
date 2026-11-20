// 009 — per-workspace custom field definitions for contacts, companies and deals.
// Values live in each entity's `custom` JSON column; lib/customFields.js validates them.
export const id = '009-custom-fields';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_fields (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entity TEXT NOT NULL,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '[]',
      required INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      UNIQUE (project_id, entity, key)
    );
    CREATE INDEX IF NOT EXISTS idx_custom_fields_project ON custom_fields(project_id, entity, sort_order);
  `);
}
