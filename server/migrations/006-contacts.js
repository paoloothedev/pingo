// 006 — contacts: the `leads` table becomes the contact record (lifecycle, owner, company, source, custom
// fields) and every row of the old `clients` table is merged into it. `clients` is kept (read-only after
// Phase 1 UI ships) and `client_contact_map` records which contact each client became, so T-022 can turn
// client stages into deals. See .agents/handoffs/PHASE-1-DESIGN.md.
import crypto from 'crypto';

export const id = '006-contacts';

const FIELDS = ['phone', 'email', 'facebook', 'instagram', 'tiktok', 'link', 'location'];

function hasColumn(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

export function up(db) {
  const add = [
    ['lifecycle', "TEXT NOT NULL DEFAULT 'lead'"],
    ['owner_id', 'TEXT'],
    ['company_id', 'TEXT'],
    ['source', "TEXT NOT NULL DEFAULT ''"],
    ['custom', "TEXT NOT NULL DEFAULT '{}'"],
    ['updated_at', 'INTEGER'],
  ];
  for (const [col, def] of add) {
    if (!hasColumn(db, 'leads', col)) db.exec(`ALTER TABLE leads ADD COLUMN ${col} ${def}`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS client_contact_map (
      client_id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL,
      project_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_leads_project_lifecycle ON leads(project_id, lifecycle);
    CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner_id);
    CREATE INDEX IF NOT EXISTS idx_leads_company ON leads(company_id);
  `);

  const clients = db.prepare(`
    SELECT c.* FROM clients c
    WHERE c.id NOT IN (SELECT client_id FROM client_contact_map)
    ORDER BY c.created_at
  `).all();
  if (!clients.length) return;

  const getLead = db.prepare('SELECT * FROM leads WHERE id = ? AND project_id = ?');
  const firstStage = db.prepare('SELECT id FROM stages WHERE project_id = ? ORDER BY sort_order LIMIT 1');
  const insertLead = db.prepare(`
    INSERT INTO leads (id, name, phone, phone_valid, email, facebook, instagram, tiktok, link, location, notes,
      status, verified, stage_id, created_at, project_id, lifecycle, owner_id, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertHistory = db.prepare('INSERT INTO stage_history (lead_id, stage_id, at) VALUES (?, ?, ?)');
  const copyTags = db.prepare(`
    INSERT OR IGNORE INTO lead_tags (lead_id, tag_id)
    SELECT ?, ct.tag_id FROM client_tags ct INNER JOIN tags t ON t.id = ct.tag_id AND t.project_id = ?
    WHERE ct.client_id = ?
  `);
  const insertMap = db.prepare('INSERT INTO client_contact_map (client_id, contact_id, project_id) VALUES (?, ?, ?)');
  const now = Date.now();

  for (const c of clients) {
    const lifecycle = c.stage === 'closed' ? 'customer' : 'qualified';
    const lead = c.lead_id ? getLead.get(c.lead_id, c.project_id) : null;

    if (lead) {
      const sets = [];
      const vals = [];
      // Only upgrade lifecycle (lead → qualified → customer), never downgrade
      const rank = { lead: 0, qualified: 1, customer: 2, churned: 2 };
      if ((rank[lifecycle] ?? 0) > (rank[lead.lifecycle] ?? 0)) { sets.push('lifecycle = ?'); vals.push(lifecycle); }
      for (const f of FIELDS) {
        if (!lead[f] && c[f]) { sets.push(`${f} = ?`); vals.push(c[f]); }
      }
      if (!lead.phone_valid && c.phone_valid && !lead.phone) { sets.push('phone_valid = 1'); }
      if (c.notes && !(lead.notes || '').includes(c.notes)) {
        sets.push('notes = ?');
        vals.push(lead.notes ? `${lead.notes}\n\n${c.notes}` : c.notes);
      }
      if (!lead.owner_id && c.assigned_to) { sets.push('owner_id = ?'); vals.push(c.assigned_to); }
      sets.push('updated_at = ?'); vals.push(now);
      db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...vals, lead.id);
      copyTags.run(lead.id, c.project_id, c.id);
      insertMap.run(c.id, lead.id, c.project_id);
      continue;
    }

    const stage = firstStage.get(c.project_id);
    if (!stage) continue; // project without stages — nothing sensible to attach to
    const contactId = 'lead_' + crypto.randomBytes(5).toString('hex');
    insertLead.run(
      contactId, c.name || '(unnamed)', c.phone || '', c.phone_valid ? 1 : 0, c.email || '', c.facebook || '',
      c.instagram || '', c.tiktok || '', c.link || '', c.location || '', c.notes || '', stage.id,
      c.created_at || now, c.project_id, lifecycle, c.assigned_to || null,
      c.source && c.source !== 'lead' ? c.source : 'manual', now,
    );
    insertHistory.run(contactId, stage.id, c.created_at || now);
    copyTags.run(contactId, c.project_id, c.id);
    insertMap.run(c.id, contactId, c.project_id);
  }
}
