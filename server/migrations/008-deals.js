// 008 — pipelines, pipeline stages, deals. Seeds a "Sales" pipeline per workspace, turns every legacy client
// (via client_contact_map from 006) into a deal at the matching stage, and gives users who could work leads
// the matching deals permissions.
import crypto from 'crypto';

export const id = '008-deals';

const STAGES = [
  ['Qualified', '#64748b', 10, 'open'],
  ['Contact made', '#3b82f6', 20, 'open'],
  ['Proposal', '#8b5cf6', 50, 'open'],
  ['Negotiation', '#f59e0b', 75, 'open'],
  ['Won', '#10b981', 100, 'won'],
  ['Lost', '#ef4444', 0, 'lost'],
];
// legacy clients.stage → index into STAGES
const CLIENT_STAGE = { new: 0, contacted: 1, interested: 2, negotiating: 3, closed: 4, lost: 5 };

const nid = (p) => `${p}_${crypto.randomBytes(6).toString('hex')}`;

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pipelines (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pipeline_stages (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#64748b',
      sort_order INTEGER NOT NULL DEFAULT 0,
      probability INTEGER NOT NULL DEFAULT 0,
      rot_days INTEGER,
      kind TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      pipeline_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      title TEXT NOT NULL,
      value REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      contact_id TEXT,
      company_id TEXT,
      owner_id TEXT,
      expected_close INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      lost_reason TEXT NOT NULL DEFAULT '',
      won_at INTEGER,
      lost_at INTEGER,
      notes TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      custom TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      stage_changed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS deal_stage_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      stage_id TEXT NOT NULL,
      account_id TEXT,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pipelines_project ON pipelines(project_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_deals_project_pipeline ON deals(project_id, pipeline_id, stage_id);
    CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);
    CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id);
    CREATE INDEX IF NOT EXISTS idx_deals_owner ON deals(owner_id);
    CREATE INDEX IF NOT EXISTS idx_deal_history_deal ON deal_stage_history(deal_id);
  `);

  const now = Date.now();
  const insPipe = db.prepare('INSERT INTO pipelines (id, project_id, name, sort_order, created_at) VALUES (?, ?, ?, 0, ?)');
  const insStage = db.prepare(`INSERT INTO pipeline_stages (id, pipeline_id, project_id, name, color, sort_order, probability, kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insDeal = db.prepare(`INSERT INTO deals (id, project_id, pipeline_id, stage_id, title, currency, contact_id, owner_id, status,
      won_at, lost_at, notes, source, created_at, updated_at, stage_changed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'client-migration', ?, ?, ?)`);
  const insHist = db.prepare('INSERT INTO deal_stage_history (deal_id, stage_id, account_id, at) VALUES (?, ?, NULL, ?)');
  const clientsOf = db.prepare(`
    SELECT c.*, m.contact_id FROM clients c INNER JOIN client_contact_map m ON m.client_id = c.id
    WHERE c.project_id = ? ORDER BY c.created_at
  `);
  const currencyOf = db.prepare("SELECT value FROM settings WHERE project_id = ? AND key = 'currency'");

  for (const { id: projectId } of db.prepare('SELECT id FROM projects').all()) {
    if (db.prepare('SELECT 1 FROM pipelines WHERE project_id = ?').get(projectId)) continue;
    const pipelineId = nid('pipe');
    insPipe.run(pipelineId, projectId, 'Sales', now);
    const stageIds = STAGES.map(([name, color, prob, kind], i) => {
      const sid = nid('pst');
      insStage.run(sid, pipelineId, projectId, name, color, i, prob, kind, now);
      return sid;
    });
    const currency = currencyOf.get(projectId)?.value || 'USD';
    for (const c of clientsOf.all(projectId)) {
      const idx = CLIENT_STAGE[c.stage] ?? 0;
      const kind = STAGES[idx][3];
      const at = c.updated_at || c.created_at || now;
      const dealId = nid('deal');
      insDeal.run(dealId, projectId, pipelineId, stageIds[idx], c.name || 'Deal', currency, c.contact_id, c.assigned_to || null,
        kind, kind === 'won' ? at : null, kind === 'lost' ? at : null, c.created_at || now, at, at);
      insHist.run(dealId, stageIds[idx], at);
    }
  }

  // Keep existing users able to work their pipeline: leads.* → deals.*
  const grant = { 'leads.view': 'deals.view', 'leads.edit': 'deals.edit', 'leads.delete': 'deals.delete' };
  for (const a of db.prepare("SELECT id, permissions FROM accounts WHERE role != 'admin'").all()) {
    let perms; try { perms = JSON.parse(a.permissions || '[]'); } catch { perms = []; }
    const next = new Set(perms);
    for (const [from, to] of Object.entries(grant)) if (next.has(from)) next.add(to);
    if (next.size !== perms.length) db.prepare('UPDATE accounts SET permissions = ? WHERE id = ?').run(JSON.stringify([...next]), a.id);
  }
}
