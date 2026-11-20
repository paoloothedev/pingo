// Turns the results of a Maps job into contacts + companies. Used by "Import" and by auto-import when a job finishes.
import crypto from 'crypto';
import { getDB, logAudit } from '../db.js';
import { checkPhones, getStatus } from '../whatsapp.js';

export async function importJobResults(job, { skipDupes = true, selectedIndices, checkWhatsApp = false, userId = null } = {}) {
  const db = getDB();
  const projectId = job.projectId;

  let results = job.results;
  if (Array.isArray(selectedIndices) && selectedIndices.length > 0) {
    results = selectedIndices.map(i => job.results[i]).filter(Boolean);
  }

  const settings = {};
  const rows = db.prepare('SELECT key, value FROM settings WHERE project_id = ?').all(projectId);
  for (const r of rows) settings[r.key] = r.value;
  const countryCode = settings.country_code || '';

  const stage = db.prepare('SELECT id FROM stages WHERE project_id = ? ORDER BY sort_order LIMIT 1').get(projectId);
  const defaultStage = stage?.id || 'new';

  let added = 0, skipped = 0;
  const now = Date.now();

  const insertLead = db.prepare(`INSERT INTO leads (id, name, phone, phone_valid, email, facebook, instagram, tiktok, link, location, notes, status, verified, stage_id, created_at, dead_at, project_id, source, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gmaps', ?)`);
  const insertStageHistory = db.prepare('INSERT INTO stage_history (lead_id, stage_id, at) VALUES (?, ?, ?)');

  const insertTag = db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)');
  const findTag = db.prepare('SELECT id FROM tags WHERE name = ? AND project_id = ?');
  const createTag = db.prepare('INSERT INTO tags (id, name, color, created_at, project_id) VALUES (?, ?, ?, ?, ?)');

  // Every Maps result is a business: reuse the workspace's company with the same phone (or name), else create it.
  const findCompanyByPhone = db.prepare("SELECT id FROM companies WHERE project_id = ? AND phone = ? AND phone != ''");
  const findCompanyByName = db.prepare('SELECT id FROM companies WHERE project_id = ? AND LOWER(name) = LOWER(?)');
  const insertCompany = db.prepare(`INSERT INTO companies (id, project_id, name, phone, website, domain, industry, address, notes, source, owner_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'gmaps', ?, ?, ?)`);
  const linkCompany = db.prepare('UPDATE leads SET company_id = ? WHERE id = ?');
  const companyFor = (r, name, phone, website, notes) => {
    const existing = (phone && findCompanyByPhone.get(projectId, phone)) || findCompanyByName.get(projectId, name);
    if (existing) return existing.id;
    const id = 'comp_' + crypto.randomBytes(6).toString('hex');
    const domain = website ? website.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') : '';
    insertCompany.run(id, projectId, name, phone || '', website || '', domain, r.category || '', r.address || '', notes, userId || null, now, now);
    return id;
  };

  const findLeadByPhone = db.prepare("SELECT id FROM leads WHERE phone = ? AND phone != '' AND project_id = ?");
  const findLeadByName = db.prepare('SELECT id FROM leads WHERE name = ? AND project_id = ?');

  const importTx = db.transaction(() => {
    for (const r of results) {
      const name = r.title || r.name || '(unnamed)';
      let phone = normalizePhone(r.phone || '', countryCode);
      const email = Array.isArray(r.emails) ? r.emails[0] : (r.email || '');
      const location = r.link || r.google_maps_link || '';

      let facebook = '', instagram = '', tiktok = '', otherLink = '';
      const website = r.website || r.web_site || '';
      if (website) {
        if (/facebook/i.test(website)) facebook = website;
        else if (/instagram/i.test(website)) instagram = website;
        else if (/tiktok/i.test(website)) tiktok = website;
        else otherLink = website;
      }

      const phoneValid = isValidPhone(phone);
      const leadStatus = phoneValid ? 'active' : 'dead';

      if (skipDupes) {
        if (phone && findLeadByPhone.get(phone, projectId)) { skipped++; continue; }
        if (findLeadByName.get(name, projectId)) { skipped++; continue; }
      }

      const leadId = 'lead_' + crypto.randomBytes(8).toString('hex');
      const notes = buildNotes(r);

      insertLead.run(
        leadId, name, phone, phoneValid ? 1 : 0, email || '',
        facebook, instagram, tiktok, otherLink,
        location, notes, leadStatus, 0, defaultStage, now,
        leadStatus === 'dead' ? now : null, projectId, r.category ? String(r.category).slice(0, 120) : null
      );
      insertStageHistory.run(leadId, defaultStage, now);
      const social = /facebook|instagram|tiktok/i.test(website);
      linkCompany.run(companyFor(r, name, phone, social ? '' : website, notes), leadId);

      if (isMaybeClosed(r)) {
        let closedTag = findTag.get('MaybeClosed', projectId);
        if (!closedTag) {
          const tagId = 'tag_' + crypto.randomBytes(4).toString('hex');
          createTag.run(tagId, 'MaybeClosed', '#a13a3a', now, projectId);
          closedTag = { id: tagId };
        }
        insertTag.run(leadId, closedTag.id);
      }

      added++;
    }
  });

  importTx();
  logAudit('gmaps_import', 'gmaps_job', job.id, `${added} leads`, { by: userId, skipped }, projectId);

  let waResults = null;
  if (checkWhatsApp && added > 0) {
    try {
      const toCheck = results.filter(r => r.phone).map(r => normalizePhone(r.phone || '', countryCode)).filter(Boolean);
      if (toCheck.length > 0 && getStatus(projectId).ready) {
        waResults = await checkPhones(projectId, toCheck);
        let notWATag = db.prepare('SELECT id FROM tags WHERE name = ? AND project_id = ?').get('Not WhatsApp', projectId);
        if (!notWATag) {
          const tagId = 'tag_' + Math.random().toString(36).slice(2, 10);
          db.prepare('INSERT INTO tags (id, name, color, created_at, project_id) VALUES (?, ?, ?, ?, ?)').run(tagId, 'Not WhatsApp', '#a13a3a', Date.now(), projectId);
          notWATag = { id: tagId };
        }
        const activeLeads = db.prepare("SELECT id, phone FROM leads WHERE status = 'active' AND project_id = ?").all(projectId);
        for (const r of waResults) {
          if (!r.exists) {
            const match = activeLeads.find(l => l.phone.replace(/\D/g, '') === r.phone);
            if (match) {
              db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)').run(match.id, notWATag.id);
            }
          }
        }
      }
    } catch (err) {
      console.error('[gmaps] WhatsApp check failed:', err.message);
    }
  }


  job.imported = { added: (job.imported?.added || 0) + added, skipped, at: now };
  return { added, skipped, total: results.length, waResults };
}

function isMaybeClosed(r) {
  if (r.status && (String(r.status).toLowerCase().includes('closed') || String(r.status).toLowerCase().includes('permanently'))) return true;
  if (r.open_hours && typeof r.open_hours === 'object' && Object.keys(r.open_hours).length > 0) {
    if (Object.values(r.open_hours).every(v => String(v).toLowerCase().includes('closed'))) return true;
  }
  if (r.open_hours && typeof r.open_hours === 'object' && Object.keys(r.open_hours).length === 0 &&
      r.popular_times && typeof r.popular_times === 'object' && Object.keys(r.popular_times).length === 0) return true;
  if (r.user_reviews && Array.isArray(r.user_reviews) && r.user_reviews.length > 0) {
    const newest = r.user_reviews.reduce((max, rev) => {
      const ts = rev.posted_at_unix_micros ? Math.floor(rev.posted_at_unix_micros / 1000) : 0;
      return ts > max ? ts : max;
    }, 0);
    if (newest && newest < Date.now() - 9 * 30 * 24 * 60 * 60 * 1000) return true;
  }
  return false;
}

function normalizePhone(raw, countryCode) {
  if (!raw) return '';
  let phone = raw.replace(/[^\d+]/g, '');
  if (!phone.startsWith('+') && countryCode) {
    phone = '+' + countryCode + phone.replace(/^0+/, '');
  }
  return phone;
}

function isValidPhone(raw) {
  if (!raw) return false;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return false;
  if (/^0{10,}$/.test(digits)) return false;
  if (/^(\d)\1{9,}$/.test(digits)) return false;
  return true;
}

function buildNotes(r) {
  const parts = [];
  if (r.address) parts.push(`Address: ${r.address}`);
  if (r.category) parts.push(`Category: ${r.category}`);
  if (r.review_rating) parts.push(`Rating: ${r.review_rating}/5 (${r.review_count || 0} reviews)`);
  if (r.price_range) parts.push(`Price: ${r.price_range}`);
  if (r.description) parts.push(r.description);
  if (r.status && /closed/i.test(r.status)) parts.push(`Status: ${r.status}`);
  return parts.join('\n');
}

