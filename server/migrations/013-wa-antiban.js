// 013 — WhatsApp anti-ban engine (lib/waRules.js + lib/waGuard.js).
// wa_number: one row per workspace (= one WhatsApp number): warm-up start, last activity, health score, hard stop.
// wa_sends (not wa_messages — old installs have an unused legacy table with that name): every message part sent, with delivery/reply timestamps — drives rate limits, new-chat counting,
//   follow-up cadence, reply/delivery rates and the identical-text cap. Rows backfilled from old broadcast history
//   are `legacy` (only used to know a number is not a new chat).
// wa_events: health-score incidents (disconnect, failed send, low reply/delivery rate, pause) for the dashboard.
export const id = '013-wa-antiban';

function hasColumn(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_number (
      project_id TEXT PRIMARY KEY,
      warmup_started_at INTEGER,
      last_active_at INTEGER,
      health_score REAL NOT NULL DEFAULT 0,
      health_at INTEGER,
      paused_until INTEGER,
      reduced_until INTEGER,
      alert TEXT,
      reply_check_at INTEGER,
      delivery_check_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS wa_sends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      lead_id TEXT,
      job_id TEXT,
      job_lead_id INTEGER,
      wa_msg_id TEXT,
      text_hash TEXT,
      new_chat INTEGER NOT NULL DEFAULT 0,
      legacy INTEGER NOT NULL DEFAULT 0,
      sent_at INTEGER NOT NULL,
      delivered_at INTEGER,
      replied_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_wa_sends_project_sent ON wa_sends(project_id, sent_at);
    CREATE INDEX IF NOT EXISTS idx_wa_sends_phone ON wa_sends(project_id, phone);
    CREATE INDEX IF NOT EXISTS idx_wa_sends_msgid ON wa_sends(wa_msg_id);
    CREATE TABLE IF NOT EXISTS wa_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      points REAL NOT NULL DEFAULT 0,
      detail TEXT,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wa_events_project ON wa_events(project_id, at);
  `);
  if (!hasColumn(db, 'leads', 'do_not_contact')) db.exec('ALTER TABLE leads ADD COLUMN do_not_contact INTEGER NOT NULL DEFAULT 0');
  for (const [col, def] of [['skipped', 'INTEGER NOT NULL DEFAULT 0'], ['wait_reason', 'TEXT'], ['resume_at', 'INTEGER']]) {
    if (!hasColumn(db, 'broadcast_jobs', col)) db.exec(`ALTER TABLE broadcast_jobs ADD COLUMN ${col} ${def}`);
  }

  // Backfill: numbers already messaged are not "new chats"; numbers already in use are not reset to warm-up day 0.
  db.exec(`
    INSERT INTO wa_sends (project_id, phone, lead_id, job_id, job_lead_id, legacy, sent_at)
    SELECT j.project_id, jl.phone, jl.lead_id, jl.job_id, jl.id, 1, COALESCE(jl.sent_at, j.created_at)
    FROM job_leads jl INNER JOIN broadcast_jobs j ON j.id = jl.job_id
    WHERE jl.status = 'sent' AND j.project_id IS NOT NULL AND jl.phone != ''
  `);
  // Normalise to digits (phones in job_leads may contain spaces / +)
  const rows = db.prepare('SELECT id, phone FROM wa_sends WHERE legacy = 1').all();
  const fix = db.prepare('UPDATE wa_sends SET phone = ? WHERE id = ?');
  for (const r of rows) fix.run(String(r.phone).replace(/\D/g, ''), r.id);

  // Warm-up start = first known send (daily counter or backfilled broadcast history); last activity = latest send.
  const firstUse = db.prepare(`
    SELECT project_id, MIN(t) AS first, MAX(t) AS last FROM (
      SELECT project_id, sent_at AS t FROM wa_sends WHERE legacy = 1
      UNION ALL
      SELECT project_id, CAST(strftime('%s', day || ' 00:00:00') AS INTEGER) * 1000 AS t FROM wa_daily_counts WHERE sent > 0
    ) GROUP BY project_id
  `).all();
  const ins = db.prepare('INSERT OR IGNORE INTO wa_number (project_id, warmup_started_at, last_active_at, health_at) VALUES (?, ?, ?, ?)');
  for (const r of firstUse) ins.run(r.project_id, r.first, r.last, Date.now());
}
