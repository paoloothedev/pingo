import crypto from 'crypto';

// 001 — the schema as it existed before versioned migrations (single-project tables + the
// multi-project refactor). Idempotent, so it is safe on both fresh and pre-existing databases.
export const id = '001-baseline';

export function up(db) {
  initSchema(db);
  runMigration(db);
}

function hasColumn(db, table, col) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === col);
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#10b981',
      icon TEXT DEFAULT '📁',
      created_at INTEGER NOT NULL,
      created_by TEXT
    );

    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT DEFAULT '',
      phone_valid INTEGER DEFAULT 0,
      email TEXT DEFAULT '',
      facebook TEXT DEFAULT '',
      instagram TEXT DEFAULT '',
      tiktok TEXT DEFAULT '',
      link TEXT DEFAULT '',
      location TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      verified INTEGER DEFAULT 0,
      stage_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      dead_at INTEGER,
      project_id TEXT
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      project_id TEXT
    );

    CREATE TABLE IF NOT EXISTS campaign_leads (
      lead_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      PRIMARY KEY (lead_id, campaign_id),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stage_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      at INTEGER NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#3d5a45',
      sort_order INTEGER NOT NULL DEFAULT 0,
      project_id TEXT
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#3d5a45',
      created_at INTEGER NOT NULL,
      project_id TEXT
    );

    CREATE TABLE IF NOT EXISTS lead_tags (
      lead_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (lead_id, tag_id),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS message_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      project_id TEXT
    );

    CREATE TABLE IF NOT EXISTS broadcast_jobs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT,
      message TEXT NOT NULL,
      delay_min INTEGER DEFAULT 1,
      delay_max INTEGER DEFAULT 5,
      status TEXT DEFAULT 'pending',
      total INTEGER DEFAULT 0,
      sent INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      project_id TEXT
    );

    CREATE TABLE IF NOT EXISTS job_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      lead_id TEXT NOT NULL,
      phone TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      error TEXT,
      sent_at INTEGER,
      FOREIGN KEY (job_id) REFERENCES broadcast_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      project_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (project_id, key)
    );

    CREATE TABLE IF NOT EXISTS import_logs (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL DEFAULT '',
      rows_total INTEGER NOT NULL DEFAULT 0,
      added INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0,
      details TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      project_id TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id TEXT DEFAULT '',
      entity_name TEXT DEFAULT '',
      details TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      project_id TEXT
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      lead_id TEXT,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT DEFAULT '',
      phone_valid INTEGER DEFAULT 0,
      email TEXT DEFAULT '',
      facebook TEXT DEFAULT '',
      instagram TEXT DEFAULT '',
      tiktok TEXT DEFAULT '',
      link TEXT DEFAULT '',
      location TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      stage TEXT DEFAULT 'new',
      source TEXT DEFAULT '',
      assigned_to TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      project_id TEXT,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS client_tags (
      client_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (client_id, tag_id),
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS client_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      account_id TEXT,
      action TEXT NOT NULL,
      details TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS email_campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      status TEXT DEFAULT 'draft',
      total INTEGER DEFAULT 0,
      sent INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      project_id TEXT
    );

    CREATE TABLE IF NOT EXISTS email_campaign_leads (
      lead_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      PRIMARY KEY (lead_id, campaign_id),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      email TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user',
      parent_id TEXT,
      permissions TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES accounts(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
  `);

  // Legacy column adds for pre-existing installs
  try { db.exec('ALTER TABLE tags ADD COLUMN show_in_dashboard INTEGER NOT NULL DEFAULT 1'); } catch {}
  try { db.exec('ALTER TABLE accounts ADD COLUMN email TEXT DEFAULT ""'); } catch {}
}

const SCOPED_TABLES = [
  'leads', 'campaigns', 'stages', 'tags', 'message_templates',
  'broadcast_jobs', 'clients', 'email_campaigns', 'import_logs', 'audit_log', 'settings',
];

function runMigration(db) {
  // 1. Ensure projects table exists (done in initSchema)
  // 2. Add project_id columns to legacy tables
  for (const t of SCOPED_TABLES) {
    if (!hasColumn(db, t, 'project_id')) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN project_id TEXT`);
    }
  }

  // 3. Recreate settings with composite PK if needed
  const settingsCols = db.prepare('PRAGMA table_info(settings)').all();
  const settingsPk = settingsCols.filter(c => c.pk > 0).map(c => c.name).sort();
  const wantPk = ['key', 'project_id'].sort();
  if (settingsPk.join(',') !== wantPk.join(',')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings_new (
        project_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (project_id, key)
      );
      INSERT OR IGNORE INTO settings_new (project_id, key, value)
        SELECT COALESCE(project_id, ''), key, value FROM settings;
      DROP TABLE settings;
      ALTER TABLE settings_new RENAME TO settings;
    `);
  }

  // 4. Ensure a Default project exists; backfill all legacy rows into it
  const projCount = db.prepare('SELECT COUNT(*) as c FROM projects').get().c;
  let defaultId;

  if (projCount === 0) {
    defaultId = 'proj_' + crypto.randomBytes(6).toString('hex');
    db.prepare('INSERT INTO projects (id, name, color, icon, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(defaultId, 'Default', '#10b981', '📁', Date.now(), 'admin');
  } else {
    defaultId = db.prepare('SELECT id FROM projects ORDER BY created_at ASC LIMIT 1').get().id;
  }

  // Backfill any NULL project_id rows into the default project
  for (const t of SCOPED_TABLES) {
    if (t === 'settings') {
      db.prepare("UPDATE settings SET project_id = ? WHERE project_id IS NULL OR project_id = ''").run(defaultId);
      // Also fix rows that may have empty project_id from the recreate step when no projects existed yet
      db.prepare("DELETE FROM settings WHERE project_id = '' AND EXISTS (SELECT 1 FROM settings s2 WHERE s2.key = settings.key AND s2.project_id = ?)").run(defaultId);
      db.prepare("UPDATE settings SET project_id = ? WHERE project_id = ''").run(defaultId);
    } else {
      db.prepare(`UPDATE ${t} SET project_id = ? WHERE project_id IS NULL`).run(defaultId);
    }
  }

  // 5. Add helpful indexes
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_leads_project ON leads(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_campaigns_project ON campaigns(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_stages_project ON stages(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_tags_project ON tags(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_templates_project ON message_templates(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_jobs_project ON broadcast_jobs(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_clients_project ON clients(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_email_campaigns_project ON email_campaigns(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_import_logs_project ON import_logs(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_log_project ON audit_log(project_id)',
  ];
  for (const sql of indexes) {
    try { db.exec(sql); } catch {}
  }
}

