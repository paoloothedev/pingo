// Duplicate detection and merging for contacts (rows of `leads`).

const RANK = { lead: 0, qualified: 1, churned: 1, customer: 2 };
const FILL = ['phone', 'email', 'facebook', 'instagram', 'tiktok', 'link', 'location', 'owner_id', 'company_id', 'source', 'message'];

// Groups of 2+ contacts in the workspace sharing a phone (digits only, ≥7) or an email (case-insensitive).
export function findDuplicates(db, pid, { limit = 100 } = {}) {
  const rows = db.prepare(`SELECT id, name, phone, email, lifecycle, status, created_at FROM leads WHERE project_id = ? ORDER BY created_at`).all(pid);
  const byKey = new Map();
  const add = (key, reason, value, row) => {
    if (!byKey.has(key)) byKey.set(key, { reason, value, contacts: [] });
    byKey.get(key).contacts.push(row);
  };
  for (const r of rows) {
    const digits = (r.phone || '').replace(/\D/g, '');
    if (digits.length >= 7) add('p:' + digits, 'phone', digits, r);
    const email = (r.email || '').trim().toLowerCase();
    if (email) add('e:' + email, 'email', email, r);
  }
  // A pair that matches on both phone and email should be listed once; dismissed groups stay hidden
  const dismissed = new Set(db.prepare('SELECT key FROM duplicate_dismissals WHERE project_id = ?').all(pid).map(r => r.key));
  const seen = new Set();
  const groups = [];
  for (const [key, g] of byKey) {
    if (g.contacts.length < 2 || dismissed.has(key)) continue;
    const sig = g.contacts.map(c => c.id).sort().join(',');
    if (seen.has(sig)) continue;
    seen.add(sig);
    groups.push(g);
    if (groups.length >= limit) break;
  }
  return groups;
}

// Merge `duplicateIds` into `primaryId`. All ids must already be verified to belong to `pid`.
// Runs inside the caller's transaction.
export function mergeContacts(db, pid, primaryId, duplicateIds) {
  const get = db.prepare('SELECT * FROM leads WHERE id = ? AND project_id = ?');
  const primary = get.get(primaryId, pid);
  const dups = duplicateIds.map(id => get.get(id, pid)).filter(Boolean);
  const merged = { ...primary };

  for (const d of dups) {
    for (const f of FILL) if (!merged[f] && d[f]) merged[f] = d[f];
    if ((RANK[d.lifecycle] ?? 0) > (RANK[merged.lifecycle] ?? 0)) merged.lifecycle = d.lifecycle;
    if (d.verified) merged.verified = 1;
    if (d.do_not_contact) merged.do_not_contact = 1;
    if (!merged.category && d.category) merged.category = d.category;
    if (d.phone_valid && merged.phone === d.phone) merged.phone_valid = 1;
    if (d.status === 'active' && merged.status === 'dead') { merged.status = 'active'; merged.dead_at = null; }
    if (d.notes && !(merged.notes || '').includes(d.notes)) merged.notes = merged.notes ? `${merged.notes}\n\n${d.notes}` : d.notes;
    let pc = {}, dc = {};
    try { pc = JSON.parse(merged.custom || '{}'); } catch {}
    try { dc = JSON.parse(d.custom || '{}'); } catch {}
    merged.custom = JSON.stringify({ ...dc, ...pc });
    if (d.created_at < merged.created_at) merged.created_at = d.created_at;
  }

  db.prepare(`UPDATE leads SET phone = ?, phone_valid = ?, email = ?, facebook = ?, instagram = ?, tiktok = ?, link = ?, location = ?,
      notes = ?, status = ?, dead_at = ?, verified = ?, lifecycle = ?, owner_id = ?, company_id = ?, source = ?, custom = ?,
      created_at = ?, updated_at = ?, message = ?, do_not_contact = ?, category = ? WHERE id = ?`).run(
    merged.phone || '', merged.phone_valid ? 1 : 0, merged.email || '', merged.facebook || '', merged.instagram || '', merged.tiktok || '',
    merged.link || '', merged.location || '', merged.notes || '', merged.status, merged.dead_at, merged.verified ? 1 : 0,
    merged.lifecycle, merged.owner_id, merged.company_id, merged.source || '', merged.custom, merged.created_at, Date.now(), merged.message || '', merged.do_not_contact ? 1 : 0, merged.category || null, primary.id,
  );

  // Re-point everything that references the duplicates
  const moves = [
    'INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) SELECT ?, tag_id FROM lead_tags WHERE lead_id = ?',
    'INSERT OR IGNORE INTO campaign_leads (lead_id, campaign_id) SELECT ?, campaign_id FROM campaign_leads WHERE lead_id = ?',
    'INSERT OR IGNORE INTO email_campaign_leads (lead_id, campaign_id) SELECT ?, campaign_id FROM email_campaign_leads WHERE lead_id = ?',
    'UPDATE stage_history SET lead_id = ? WHERE lead_id = ?',
    'UPDATE deals SET contact_id = ? WHERE contact_id = ?',
    'UPDATE job_leads SET lead_id = ? WHERE lead_id = ?',
    'UPDATE wa_sends SET lead_id = ? WHERE lead_id = ?',
    'UPDATE wa_inbox_chats SET lead_id = ? WHERE lead_id = ?',
    'UPDATE client_contact_map SET contact_id = ? WHERE contact_id = ?',
    'UPDATE clients SET lead_id = ? WHERE lead_id = ?',
  ].map(sql => db.prepare(sql));
  const del = db.prepare('DELETE FROM leads WHERE id = ?');
  for (const d of dups) {
    for (const m of moves) m.run(primary.id, d.id);
    del.run(d.id); // lead_tags/campaign_leads rows of the duplicate cascade away
  }
  return { primaryId: primary.id, merged: dups.length };
}
