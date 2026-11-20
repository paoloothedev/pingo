// Workspace backup (JSON) and restore. Restore wipes the workspace's CRM data and re-creates every row with
// a fresh id (old → new maps fix up references), so a backup can be restored into any workspace or install.
import crypto from 'crypto';
import { seedStagesForProject } from '../db.js';
import { ensureDefaultPipeline } from './pipelines.js';
import { isProjectMember } from './scope.js';
import { KEY_RE, ENTITIES, TYPES } from './customFields.js';

export const BACKUP_VERSION = 2;

export function exportProject(db, pid) {
  const all = (sql) => db.prepare(sql).all(pid);
  return {
    version: BACKUP_VERSION,
    exported_at: Date.now(),
    stages: all('SELECT * FROM stages WHERE project_id = ? ORDER BY sort_order'),
    tags: all('SELECT * FROM tags WHERE project_id = ?'),
    companies: all('SELECT * FROM companies WHERE project_id = ?'),
    leads: all('SELECT * FROM leads WHERE project_id = ?'),
    stage_history: all('SELECT sh.* FROM stage_history sh INNER JOIN leads l ON l.id = sh.lead_id WHERE l.project_id = ?'),
    lead_tags: all('SELECT lt.* FROM lead_tags lt INNER JOIN leads l ON l.id = lt.lead_id WHERE l.project_id = ?'),
    campaigns: all('SELECT * FROM campaigns WHERE project_id = ?'),
    campaign_leads: all('SELECT cl.* FROM campaign_leads cl INNER JOIN campaigns c ON c.id = cl.campaign_id WHERE c.project_id = ?'),
    pipelines: all('SELECT * FROM pipelines WHERE project_id = ? ORDER BY sort_order'),
    pipeline_stages: all('SELECT * FROM pipeline_stages WHERE project_id = ? ORDER BY sort_order'),
    deals: all('SELECT * FROM deals WHERE project_id = ?'),
    deal_stage_history: all('SELECT h.* FROM deal_stage_history h INNER JOIN deals d ON d.id = h.deal_id WHERE d.project_id = ?'),
    custom_fields: all('SELECT * FROM custom_fields WHERE project_id = ? ORDER BY entity, sort_order'),
    message_templates: all('SELECT * FROM message_templates WHERE project_id = ?'),
    wa_inbox_chats: all('SELECT * FROM wa_inbox_chats WHERE project_id = ?'),
    wa_inbox_messages: all('SELECT * FROM wa_inbox_messages WHERE project_id = ? ORDER BY at'),
  };
}

const nid = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
const str = (v, max = 10000) => (v === null || v === undefined ? '' : String(v).slice(0, max));
const json = (v) => {
  if (typeof v === 'string') { try { JSON.parse(v); return v; } catch { return '{}'; } }
  return v && typeof v === 'object' ? JSON.stringify(v) : '{}';
};

// custom_fields.options: array in API responses, JSON string in raw exports
const optionsJson = (v) => {
  let arr = v;
  if (typeof v === 'string') { try { arr = JSON.parse(v); } catch { arr = []; } }
  return JSON.stringify(Array.isArray(arr) ? arr.map(String) : []);
};

// Returns counts. Throws on invalid data; the caller runs it inside a transaction.
export function restoreProject(db, pid, data) {
  if (!data || !Array.isArray(data.leads)) throw new Error('Invalid backup file');
  const map = { stage: new Map(), tag: new Map(), company: new Map(), lead: new Map(), camp: new Map(), pipe: new Map(), pst: new Map(), deal: new Map() };
  const now = Date.now();
  const owner = (id) => (id && isProjectMember(pid, id) ? id : null);

  // Wipe this workspace's CRM data (children first)
  const wipe = [
    'DELETE FROM deal_stage_history WHERE deal_id IN (SELECT id FROM deals WHERE project_id = ?)',
    'DELETE FROM deals WHERE project_id = ?',
    'DELETE FROM pipeline_stages WHERE project_id = ?',
    'DELETE FROM pipelines WHERE project_id = ?',
    'DELETE FROM lead_tags WHERE lead_id IN (SELECT id FROM leads WHERE project_id = ?)',
    'DELETE FROM stage_history WHERE lead_id IN (SELECT id FROM leads WHERE project_id = ?)',
    'DELETE FROM campaign_leads WHERE campaign_id IN (SELECT id FROM campaigns WHERE project_id = ?)',
    'DELETE FROM leads WHERE project_id = ?',
    'DELETE FROM companies WHERE project_id = ?',
    'DELETE FROM campaigns WHERE project_id = ?',
    'DELETE FROM stages WHERE project_id = ?',
    'DELETE FROM tags WHERE project_id = ?',
  ];
  // Older backups (v1) don't carry these; keep the workspace's current ones in that case.
  if (Array.isArray(data.custom_fields)) wipe.push('DELETE FROM custom_fields WHERE project_id = ?');
  if (Array.isArray(data.message_templates)) wipe.push('DELETE FROM message_templates WHERE project_id = ?');
  if (Array.isArray(data.wa_inbox_chats)) wipe.push('DELETE FROM wa_inbox_messages WHERE project_id = ?', 'DELETE FROM wa_inbox_chats WHERE project_id = ?');
  for (const sql of wipe) db.prepare(sql).run(pid);

  const ins = (sql) => db.prepare(sql);
  const insStage = ins('INSERT INTO stages (id, name, color, sort_order, project_id) VALUES (?, ?, ?, ?, ?)');
  for (const s of data.stages || []) {
    const id = nid('stage'); map.stage.set(s.id, id);
    insStage.run(id, str(s.name, 100) || 'Stage', str(s.color, 20) || '#3d5a45', s.sort_order || 0, pid);
  }
  if (!map.stage.size) seedStagesForProject(pid);
  const fallbackStage = db.prepare('SELECT id FROM stages WHERE project_id = ? ORDER BY sort_order LIMIT 1').get(pid).id;

  const insTag = ins('INSERT INTO tags (id, name, color, created_at, project_id, show_in_dashboard) VALUES (?, ?, ?, ?, ?, ?)');
  for (const t of data.tags || []) {
    const id = nid('tag'); map.tag.set(t.id, id);
    insTag.run(id, str(t.name, 100) || 'Tag', str(t.color, 20) || '#3d5a45', t.created_at || now, pid, t.show_in_dashboard === 0 ? 0 : 1);
  }

  const insCompany = ins(`INSERT INTO companies (id, project_id, name, domain, industry, size, phone, email, website, address, city, country,
    notes, owner_id, source, custom, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const c of data.companies || []) {
    const id = nid('comp'); map.company.set(c.id, id);
    insCompany.run(id, pid, str(c.name, 500) || 'Company', str(c.domain, 500), str(c.industry, 500), str(c.size, 500), str(c.phone, 500),
      str(c.email, 500), str(c.website, 500), str(c.address, 500), str(c.city, 500), str(c.country, 500), str(c.notes, 20000),
      owner(c.owner_id), str(c.source, 50), json(c.custom), c.created_at || now, c.updated_at || now);
  }

  const LIFECYCLES = ['lead', 'qualified', 'customer', 'churned'];
  const insLead = ins(`INSERT INTO leads (id, name, phone, phone_valid, email, facebook, instagram, tiktok, link, location, notes, status,
    verified, stage_id, created_at, dead_at, project_id, lifecycle, owner_id, company_id, source, custom, updated_at, message, do_not_contact, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const l of data.leads) {
    const id = nid('lead'); map.lead.set(l.id, id);
    insLead.run(id, str(l.name, 500), str(l.phone, 50), l.phone_valid ? 1 : 0, str(l.email, 320), str(l.facebook, 1000), str(l.instagram, 1000),
      str(l.tiktok, 1000), str(l.link, 1000), str(l.location, 2000), str(l.notes, 20000), l.status === 'dead' ? 'dead' : 'active',
      l.verified ? 1 : 0, map.stage.get(l.stage_id) || fallbackStage, l.created_at || now, l.dead_at || null, pid,
      LIFECYCLES.includes(l.lifecycle) ? l.lifecycle : 'lead', owner(l.owner_id), map.company.get(l.company_id) || null,
      str(l.source, 50), json(l.custom), l.updated_at || null, str(l.message, 10000), l.do_not_contact ? 1 : 0, l.category ? str(l.category, 120) : null);
  }
  const insSH = ins('INSERT INTO stage_history (lead_id, stage_id, at) VALUES (?, ?, ?)');
  for (const h of data.stage_history || []) {
    if (map.lead.has(h.lead_id)) insSH.run(map.lead.get(h.lead_id), map.stage.get(h.stage_id) || fallbackStage, h.at || now);
  }
  const insLT = ins('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)');
  for (const lt of data.lead_tags || []) {
    if (map.lead.has(lt.lead_id) && map.tag.has(lt.tag_id)) insLT.run(map.lead.get(lt.lead_id), map.tag.get(lt.tag_id));
  }

  const insCamp = ins('INSERT INTO campaigns (id, name, created_at, project_id) VALUES (?, ?, ?, ?)');
  for (const c of data.campaigns || []) {
    const id = nid('camp'); map.camp.set(c.id, id);
    insCamp.run(id, str(c.name, 200) || 'Campaign', c.created_at || now, pid);
  }
  const insCL = ins('INSERT OR IGNORE INTO campaign_leads (lead_id, campaign_id) VALUES (?, ?)');
  for (const cl of data.campaign_leads || []) {
    if (map.lead.has(cl.lead_id) && map.camp.has(cl.campaign_id)) insCL.run(map.lead.get(cl.lead_id), map.camp.get(cl.campaign_id));
  }

  const insPipe = ins('INSERT INTO pipelines (id, project_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const p of data.pipelines || []) {
    const id = nid('pipe'); map.pipe.set(p.id, id);
    insPipe.run(id, pid, str(p.name, 100) || 'Pipeline', p.sort_order || 0, p.created_at || now);
  }
  const insPst = ins(`INSERT INTO pipeline_stages (id, pipeline_id, project_id, name, color, sort_order, probability, rot_days, kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const s of data.pipeline_stages || []) {
    if (!map.pipe.has(s.pipeline_id)) continue;
    const id = nid('pst'); map.pst.set(s.id, id);
    insPst.run(id, map.pipe.get(s.pipeline_id), pid, str(s.name, 100) || 'Stage', str(s.color, 20) || '#64748b', s.sort_order || 0,
      Math.max(0, Math.min(100, Number(s.probability) || 0)), s.rot_days || null, ['open', 'won', 'lost'].includes(s.kind) ? s.kind : 'open', s.created_at || now);
  }
  // Pipelines whose stages were all missing would be unusable
  for (const [, newPipe] of map.pipe) {
    if (!db.prepare('SELECT 1 FROM pipeline_stages WHERE pipeline_id = ?').get(newPipe)) {
      db.prepare('DELETE FROM pipelines WHERE id = ?').run(newPipe);
    }
  }
  ensureDefaultPipeline(db, pid);

  const insDeal = ins(`INSERT INTO deals (id, project_id, pipeline_id, stage_id, title, value, currency, contact_id, company_id, owner_id,
    expected_close, status, lost_reason, won_at, lost_at, notes, source, custom, created_at, updated_at, stage_changed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const stageRow = db.prepare('SELECT id, pipeline_id, kind FROM pipeline_stages WHERE id = ?');
  const firstStage = db.prepare("SELECT s.id, s.pipeline_id, s.kind FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id WHERE p.project_id = ? ORDER BY p.sort_order, s.sort_order LIMIT 1");
  for (const d of data.deals || []) {
    const stage = (map.pst.has(d.stage_id) && stageRow.get(map.pst.get(d.stage_id))) || firstStage.get(pid);
    const id = nid('deal'); map.deal.set(d.id, id);
    insDeal.run(id, pid, stage.pipeline_id, stage.id, str(d.title, 300) || 'Deal', Math.max(0, Number(d.value) || 0),
      /^[A-Z]{3}$/.test(d.currency) ? d.currency : 'USD', map.lead.get(d.contact_id) || null, map.company.get(d.company_id) || null,
      owner(d.owner_id), d.expected_close || null, stage.kind, str(d.lost_reason, 500), stage.kind === 'won' ? d.won_at || now : null,
      stage.kind === 'lost' ? d.lost_at || now : null, str(d.notes, 20000), str(d.source, 50), json(d.custom),
      d.created_at || now, d.updated_at || now, d.stage_changed_at || d.created_at || now);
  }
  const insDH = ins('INSERT INTO deal_stage_history (deal_id, stage_id, account_id, at) VALUES (?, ?, ?, ?)');
  for (const h of data.deal_stage_history || []) {
    if (map.deal.has(h.deal_id)) insDH.run(map.deal.get(h.deal_id), map.pst.get(h.stage_id) || h.stage_id, owner(h.account_id), h.at || now);
  }

  if (Array.isArray(data.custom_fields)) {
    const insCF = ins(`INSERT OR IGNORE INTO custom_fields (id, project_id, entity, key, label, type, options, required, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const f of data.custom_fields) {
      if (!ENTITIES.includes(f.entity) || !TYPES.includes(f.type) || !KEY_RE.test(f.key)) continue;
      insCF.run(nid('cf'), pid, f.entity, f.key, str(f.label, 100) || f.key, f.type, optionsJson(f.options),
        f.required ? 1 : 0, f.sort_order || 0, f.created_at || now);
    }
  }
  if (Array.isArray(data.message_templates)) {
    const insTpl = ins('INSERT INTO message_templates (id, name, content, created_at, project_id) VALUES (?, ?, ?, ?, ?)');
    for (const t of data.message_templates) insTpl.run(nid('tpl'), str(t.name, 200) || 'Template', str(t.content, 20000), t.created_at || now, pid);
  }

  // Message history (media files aren't in the backup; those messages restore with their captions only)
  if (Array.isArray(data.wa_inbox_chats)) {
    const chatIds = new Map();
    const insChat = ins(`INSERT OR IGNORE INTO wa_inbox_chats (id, project_id, phone, lid, jid, name, lead_id, assigned_to, status, unread, last_message_at, last_text, last_direction, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const c of data.wa_inbox_chats) {
      const id = nid('chat'); chatIds.set(c.id, id);
      insChat.run(id, pid, c.phone ? str(c.phone, 30) : null, c.lid ? str(c.lid, 60) : null, c.jid ? str(c.jid, 100) : null, c.name ? str(c.name, 200) : null,
        map.lead.get(c.lead_id) || null, owner(c.assigned_to), c.status === 'done' ? 'done' : 'open', Number(c.unread) || 0,
        c.last_message_at || null, str(c.last_text, 200), c.last_direction === 'in' ? 'in' : 'out', c.created_at || now);
    }
    const insMsg = ins(`INSERT OR IGNORE INTO wa_inbox_messages (id, project_id, chat_id, wa_msg_id, direction, source, type, text, original_text, account_id, sender_phone, status, media_state, media_mime, media_name, media_size, at, edited_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const m of data.wa_inbox_messages || []) {
      if (!chatIds.has(m.chat_id)) continue;
      insMsg.run(nid('wam'), pid, chatIds.get(m.chat_id), m.wa_msg_id ? str(m.wa_msg_id, 200) : null, m.direction === 'in' ? 'in' : 'out', str(m.source, 20) || 'contact', str(m.type, 20) || 'text',
        str(m.text, 70000), m.original_text ? str(m.original_text, 70000) : null, owner(m.account_id), m.sender_phone ? str(m.sender_phone, 30) : null, Number.isInteger(m.status) ? m.status : null,
        m.media_state ? 'unavailable' : null, m.media_mime ? str(m.media_mime, 200) : null, m.media_name ? str(m.media_name, 500) : null, Number(m.media_size) || null, m.at || now, m.edited_at || null, m.deleted_at || null);
    }
  }

  return { leads: map.lead.size, companies: map.company.size, deals: map.deal.size, stages: map.stage.size, tags: map.tag.size, campaigns: map.camp.size };
}
