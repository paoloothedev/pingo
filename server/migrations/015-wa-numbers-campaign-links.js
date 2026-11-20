// 015 — the WhatsApp number becomes an identity, and broadcasts link properly to campaigns.
// wa_number keeps the workspace's active state, now with the number it belongs to. wa_numbers remembers every number
// ever linked here (warm-up, health, limits), so relinking one restores it and a different one starts fresh.
// wa_sends / wa_events record which number they belong to; wa_sends also keeps the text actually sent.
// broadcast_jobs.campaign_id used to hold the campaign *name*: it moves to the new `name` column and campaign_id
// becomes a real id (NULL when that campaign no longer exists).
// wa_number.auto_connect: this workspace was connected and nobody disconnected it, so a server restart reconnects it.
export const id = '015-wa-numbers-campaign-links';

function addColumn(db, table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

export function up(db) {
  addColumn(db, 'wa_number', 'phone', 'TEXT');
  addColumn(db, 'wa_number', 'auto_connect', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'wa_sends', 'sender_phone', 'TEXT');
  addColumn(db, 'wa_sends', 'text', 'TEXT');
  addColumn(db, 'wa_events', 'sender_phone', 'TEXT');
  addColumn(db, 'broadcast_jobs', 'name', 'TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_numbers (
      project_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      warmup_started_at INTEGER,
      last_active_at INTEGER,
      health_score REAL NOT NULL DEFAULT 0,
      health_at INTEGER,
      paused_until INTEGER,
      reduced_until INTEGER,
      alert TEXT,
      reply_check_at INTEGER,
      delivery_check_at INTEGER,
      limits TEXT,
      first_linked_at INTEGER,
      last_linked_at INTEGER,
      PRIMARY KEY (project_id, phone)
    );
    CREATE INDEX IF NOT EXISTS idx_wa_sends_job ON wa_sends(job_id);
    CREATE INDEX IF NOT EXISTS idx_wa_sends_job_lead ON wa_sends(job_lead_id);
    CREATE INDEX IF NOT EXISTS idx_wa_sends_lead ON wa_sends(lead_id);
    CREATE INDEX IF NOT EXISTS idx_broadcast_jobs_campaign ON broadcast_jobs(campaign_id);
  `);

  const find = db.prepare('SELECT id FROM campaigns WHERE project_id = ? AND (id = ? OR name = ?) ORDER BY created_at DESC LIMIT 1');
  const upd = db.prepare('UPDATE broadcast_jobs SET name = ?, campaign_id = ? WHERE id = ?');
  for (const j of db.prepare('SELECT id, project_id, campaign_id FROM broadcast_jobs WHERE campaign_id IS NOT NULL').all()) {
    upd.run(j.campaign_id, find.get(j.project_id, j.campaign_id, j.campaign_id)?.id || null, j.id);
  }
}
