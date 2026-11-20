// WhatsApp inbox API: the workspace's conversations (lib/waInbox.js records them). Reading needs whatsapp.view; sending and
// managing chats needs campaigns.send, the permission that already means "may send WhatsApp".
import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import { getDB, logAudit } from '../db.js';
import { wrap } from '../lib/async.js';
import { isOwned, isProjectMember } from '../lib/scope.js';
import { requirePermission } from './auth.js';
import { normalizePhone, isValidPhone } from './leads.js';
import { InboxError, sendInChat, relinkChats, openChatFor, mediaFile, notifyChange } from '../lib/waInbox.js';
import { digits } from '../lib/waGuard.js';

const router = Router();

const CHAT_COLUMNS = `c.id, c.phone, c.lid, c.name, c.lead_id, c.assigned_to, c.status, c.unread, c.last_message_at, c.last_text, c.last_direction, c.created_at,
  l.name AS lead_name, l.do_not_contact AS lead_do_not_contact, a.display_name AS assigned_display, a.username AS assigned_username`;
const CHAT_FROM = `FROM wa_inbox_chats c
  LEFT JOIN leads l ON l.id = c.lead_id AND l.project_id = c.project_id
  LEFT JOIN accounts a ON a.id = c.assigned_to`;

const shape = (c) => ({
  id: c.id, phone: c.phone, name: c.lead_name || c.name || null, whatsapp_name: c.name || null,
  lead_id: c.lead_name != null ? c.lead_id : null, do_not_contact: !!c.lead_do_not_contact,
  assigned_to: c.assigned_to, assigned_name: c.assigned_display || c.assigned_username || null,
  status: c.status, unread: c.unread, last_message_at: c.last_message_at, last_text: c.last_text, last_direction: c.last_direction,
});

function getChat(req, res) {
  const c = getDB().prepare(`SELECT ${CHAT_COLUMNS} ${CHAT_FROM} WHERE c.id = ? AND c.project_id = ?`).get(req.params.id, req.project.id);
  if (!c) res.status(404).json({ error: 'Chat not found' });
  return c;
}

// Chats, newest first. filter: open (default), unread, mine, unassigned, done, all
router.get('/chats', requirePermission('whatsapp.view'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  relinkChats(pid);
  let where = 'c.project_id = ? AND c.last_message_at IS NOT NULL';
  const args = [pid];
  const filter = String(req.query.filter || 'open');
  if (filter === 'open') where += " AND c.status = 'open'";
  else if (filter === 'done') where += " AND c.status = 'done'";
  else if (filter === 'unread') where += ' AND c.unread > 0';
  else if (filter === 'mine') { where += " AND c.assigned_to = ? AND c.status = 'open'"; args.push(req.user.id); }
  else if (filter === 'unassigned') where += " AND c.assigned_to IS NULL AND c.status = 'open'";
  const q = String(req.query.q || '').trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    where += ` AND (c.name LIKE ? ESCAPE '\\' OR l.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM wa_inbox_messages m WHERE m.chat_id = c.id AND m.text LIKE ? ESCAPE '\\'))`;
    args.push(like, like, like, like);
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const total = db.prepare(`SELECT COUNT(*) AS n ${CHAT_FROM} WHERE ${where}`).get(...args).n;
  const rows = db.prepare(`SELECT ${CHAT_COLUMNS} ${CHAT_FROM} WHERE ${where} ORDER BY c.last_message_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  res.json({ chats: rows.map(shape), total });
});

router.get('/unread', requirePermission('whatsapp.view'), (req, res) => {
  const n = getDB().prepare('SELECT COUNT(*) AS n FROM wa_inbox_chats WHERE project_id = ? AND unread > 0').get(req.project.id).n;
  res.json({ chats: n });
});

// Open a chat with a contact or a number (nothing is sent)
router.post('/chats', requirePermission('campaigns.send'), (req, res) => {
  const db = getDB();
  const pid = req.project.id;
  const { lead_id: leadId } = req.body || {};
  let raw = req.body?.phone;
  if (leadId) {
    if (!isOwned('leads', pid, leadId)) return res.status(404).json({ error: 'Contact not found' });
    raw = db.prepare('SELECT phone FROM leads WHERE id = ?').get(leadId).phone;
  }
  const cc = db.prepare("SELECT value FROM settings WHERE project_id = ? AND key = 'country_code'").get(pid)?.value;
  const phone = digits(normalizePhone(raw, cc));
  if (!isValidPhone(phone)) return res.status(400).json({ error: 'Enter a full phone number with its country code' });
  const chat = openChatFor(pid, phone, leadId || null);
  logAudit('create', 'wa_chat', chat.id, phone, { lead_id: leadId || null, by: req.user.id }, pid);
  res.status(201).json({ id: chat.id });
});

router.get('/chats/:id', requirePermission('whatsapp.view'), (req, res) => {
  const c = getChat(req, res);
  if (c) res.json(shape(c));
});

const MESSAGE_COLUMNS = `m.id, m.wa_msg_id, m.direction, m.source, m.type, m.text, m.original_text, m.status, m.media_state, m.media_mime, m.media_name, m.media_size,
  m.at, m.edited_at, m.deleted_at, m.job_id, m.account_id, m.sender_phone, COALESCE(a.display_name, a.username) AS sent_by, j.name AS job_name`;

// Newest `limit` messages (older ones with ?before=<at>), returned oldest first
router.get('/chats/:id/messages', requirePermission('whatsapp.view'), (req, res) => {
  const c = getChat(req, res);
  if (!c) return;
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 300);
  const before = parseInt(req.query.before) || Number.MAX_SAFE_INTEGER;
  const rows = getDB().prepare(`SELECT ${MESSAGE_COLUMNS} FROM wa_inbox_messages m
    LEFT JOIN accounts a ON a.id = m.account_id
    LEFT JOIN broadcast_jobs j ON j.id = m.job_id AND j.project_id = m.project_id
    WHERE m.chat_id = ? AND m.project_id = ? AND m.at < ? ORDER BY m.at DESC, m.rowid DESC LIMIT ?`).all(c.id, req.project.id, before, limit + 1);
  const hasMore = rows.length > limit;
  res.json({ messages: rows.slice(0, limit).reverse(), has_more: hasMore });
});

router.post('/chats/:id/read', requirePermission('whatsapp.view'), (req, res) => {
  const r = getDB().prepare('UPDATE wa_inbox_chats SET unread = 0 WHERE id = ? AND project_id = ?').run(req.params.id, req.project.id);
  if (!r.changes) return res.status(404).json({ error: 'Chat not found' });
  res.json({ ok: true });
});

// Sends a real WhatsApp message
router.post('/chats/:id/messages', requirePermission('campaigns.send'), wrap(async (req, res) => {
  try {
    const message = await sendInChat({ projectId: req.project.id, chatId: req.params.id, text: req.body?.text, accountId: req.user.id });
    res.status(201).json(message);
  } catch (err) {
    if (err instanceof InboxError) return res.status(err.status).json({ error: err.message, code: err.code });
    throw err;
  }
}));

// Assign to a team member, or mark done / reopen
router.patch('/chats/:id', requirePermission('campaigns.send'), (req, res) => {
  const c = getChat(req, res);
  if (!c) return;
  const db = getDB();
  const pid = req.project.id;
  const { assigned_to: assignedTo, status } = req.body || {};
  if (status !== undefined && !['open', 'done'].includes(status)) return res.status(400).json({ error: 'status must be open or done' });
  if (assignedTo !== undefined && assignedTo !== null && !isProjectMember(pid, assignedTo)) return res.status(400).json({ error: 'That person is not in this workspace' });
  if (assignedTo !== undefined) db.prepare('UPDATE wa_inbox_chats SET assigned_to = ? WHERE id = ?').run(assignedTo, c.id);
  if (status !== undefined) db.prepare('UPDATE wa_inbox_chats SET status = ? WHERE id = ?').run(status, c.id);
  logAudit('edit', 'wa_chat', c.id, c.lead_name || c.name || c.phone || c.id, { assigned_to: assignedTo, status, by: req.user.id }, pid);
  notifyChange(pid, c.id);
  res.json(shape(db.prepare(`SELECT ${CHAT_COLUMNS} ${CHAT_FROM} WHERE c.id = ? AND c.project_id = ?`).get(c.id, pid)));
});

// Someone unknown wrote in: save them as a contact
router.post('/chats/:id/contact', requirePermission('leads.edit'), (req, res) => {
  const c = getChat(req, res);
  if (!c) return;
  if (c.lead_name != null) return res.status(409).json({ error: 'This chat already has a contact' });
  if (!c.phone) return res.status(400).json({ error: "WhatsApp hasn't shared this person's number yet" });
  const db = getDB();
  const pid = req.project.id;
  const stage = db.prepare('SELECT id FROM stages WHERE project_id = ? ORDER BY sort_order LIMIT 1').get(pid);
  const name = String(req.body?.name || c.name || `+${c.phone}`).trim().slice(0, 500);
  const id = 'lead_' + crypto.randomBytes(8).toString('hex');
  const now = Date.now();
  db.transaction(() => {
    db.prepare(`INSERT INTO leads (id, name, phone, phone_valid, stage_id, created_at, updated_at, project_id, source, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'whatsapp', 'active')`).run(id, name, `+${c.phone}`, isValidPhone(c.phone) ? 1 : 0, stage?.id || null, now, now, pid);
    db.prepare('UPDATE wa_inbox_chats SET lead_id = ? WHERE id = ?').run(id, c.id);
  })();
  logAudit('create', 'lead', id, name, { from: 'whatsapp chat', by: req.user.id }, pid);
  notifyChange(pid, c.id);
  res.status(201).json({ lead_id: id });
});

// A received photo, voice note or file
router.get('/media/:messageId', requirePermission('whatsapp.view'), (req, res) => {
  const m = getDB().prepare('SELECT media_path, media_mime, media_name FROM wa_inbox_messages WHERE id = ? AND project_id = ?').get(req.params.messageId, req.project.id);
  if (!m?.media_path) return res.status(404).json({ error: 'File not available' });
  const file = mediaFile(req.project.id, m.media_path);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File not available' });
  // Sent by strangers: never let a browser run it on this site's origin
  res.setHeader('Content-Type', m.media_mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Content-Disposition', 'attachment');
  res.sendFile(file);
});

export default router;
