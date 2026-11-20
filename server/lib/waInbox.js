// WhatsApp inbox: records every 1:1 message of a workspace's number, both ways (replies, broadcasts, what the team sends
// here, what someone sends from the phone itself), and sends the team's replies. Groups, status updates and channels are
// not recorded. Sending goes through the anti-ban guard: replies to someone who wrote to us only stop on a hard stop or
// the per-minute limit; a first message to someone follows the same rules as a broadcast.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { normalizeMessageContent, getContentType } from '@whiskeysockets/baileys';
import { getDB } from '../db.js';
import { onWaEvent, downloadMedia, sendChatText, isOnWhatsApp, getStatus, MEDIA_ROOT } from '../whatsapp.js';
import { contactCheck, gate, replyGate, recordSent, addHealthEvent, digits, _onIncoming } from './waGuard.js';

const DAY = 24 * 60 * 60 * 1000;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
export const MAX_TEXT = 4000;

export class InboxError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const newId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

// ── Reading a Baileys message ───────────────────────────────────

const IGNORED = new Set(['reactionMessage', 'encReactionMessage', 'pollUpdateMessage', 'keepInChatMessage', 'pinInChatMessage',
  'senderKeyDistributionMessage', 'messageContextInfo', 'deviceSentMessage', 'callLogMesssage', 'encEventResponseMessage']);
const MEDIA = { imageMessage: 'image', videoMessage: 'video', ptvMessage: 'video', audioMessage: 'audio', documentMessage: 'document', stickerMessage: 'sticker' };
const LABEL = { image: 'Photo', video: 'Video', audio: 'Voice message', document: 'Document', sticker: 'Sticker', location: 'Location', contact: 'Contact', poll: 'Poll', other: 'Message' };

const num = (v) => (v && typeof v === 'object' && v.toNumber ? v.toNumber() : Number(v) || 0);

// What a message says: { kind: 'message', type, text, mime?, fileName?, size? }, { kind: 'revoke', id },
// { kind: 'edit', id, text }, or null for anything that isn't a message a person would see.
export function parseMessage(raw) {
  const content = normalizeMessageContent(raw);
  if (!content) return null;
  const key = getContentType(content);
  if (!key || IGNORED.has(key)) return null;
  const body = content[key];

  if (key === 'protocolMessage') {
    const id = body?.key?.id;
    if (!id) return null;
    if (body.type === 0) return { kind: 'revoke', id };
    if (body.type === 14 && body.editedMessage) {
      const edited = parseMessage(body.editedMessage);
      if (edited?.kind === 'message') return { kind: 'edit', id, text: edited.text };
    }
    return null;
  }
  if (key === 'conversation') return { kind: 'message', type: 'text', text: body || '' };
  if (key === 'extendedTextMessage') return { kind: 'message', type: 'text', text: body?.text || '' };
  if (MEDIA[key]) {
    return {
      kind: 'message', type: MEDIA[key], text: body?.caption || '', mime: body?.mimetype || null,
      fileName: body?.fileName || null, size: num(body?.fileLength) || null,
    };
  }
  if (key === 'locationMessage' || key === 'liveLocationMessage') {
    return { kind: 'message', type: 'location', text: `${body?.degreesLatitude},${body?.degreesLongitude}` };
  }
  if (key === 'contactMessage') return { kind: 'message', type: 'contact', text: body?.displayName || '' };
  if (key === 'contactsArrayMessage') return { kind: 'message', type: 'contact', text: body?.displayName || '' };
  if (/^pollCreationMessage/.test(key)) return { kind: 'message', type: 'poll', text: body?.name || '' };
  return { kind: 'message', type: 'other', text: typeof body?.text === 'string' ? body.text : '' };
}

const previewOf = (type, text) => {
  if (type === 'text') return String(text || '').slice(0, 200);
  const label = LABEL[type] || 'Message';
  return (text && type !== 'location' ? `${label}: ${text}` : label).slice(0, 200);
};

// ── Chats ───────────────────────────────────────────────────────

const lastNine = (d) => (d.length >= 9 ? d.slice(-9) : d);

// Stored numbers come in every format (+966 50…, 0100…): match on the last 9 digits, preferring an exact number.
function pickLead(rows, phone) {
  const d = digits(phone);
  if (!d) return null;
  const hits = rows.filter(r => { const p = digits(r.phone); return p && (p === d || (p.length >= 9 && lastNine(p) === lastNine(d))); });
  const rank = (r) => (digits(r.phone) === d ? 2 : 0) + (r.status === 'active' ? 1 : 0);
  return hits.sort((a, b) => rank(b) - rank(a))[0]?.id || null;
}

function findLead(projectId, phone) {
  return pickLead(getDB().prepare("SELECT id, phone, status FROM leads WHERE project_id = ? AND phone != ''").all(projectId), phone);
}

// Finds or creates the chat for an address. When a LID-only chat learns its phone, it becomes that phone's chat.
function chatFor(projectId, { phone, lid, jid }, now) {
  const db = getDB();
  const byPhone = phone ? db.prepare('SELECT * FROM wa_inbox_chats WHERE project_id = ? AND phone = ?').get(projectId, phone) : null;
  const byLid = lid ? db.prepare('SELECT * FROM wa_inbox_chats WHERE project_id = ? AND lid = ?').get(projectId, lid) : null;
  if (byPhone && byLid && byPhone.id !== byLid.id) {
    db.prepare('UPDATE wa_inbox_messages SET chat_id = ? WHERE chat_id = ?').run(byPhone.id, byLid.id);
    db.prepare('DELETE FROM wa_inbox_chats WHERE id = ?').run(byLid.id);
    db.prepare('UPDATE wa_inbox_chats SET lid = ?, unread = unread + ?, name = COALESCE(name, ?), last_text = CASE WHEN COALESCE(last_message_at, 0) < ? THEN ? ELSE last_text END, last_direction = CASE WHEN COALESCE(last_message_at, 0) < ? THEN ? ELSE last_direction END, last_message_at = MAX(COALESCE(last_message_at, 0), ?) WHERE id = ?')
      .run(lid, byLid.unread, byLid.name, byLid.last_message_at || 0, byLid.last_text, byLid.last_message_at || 0, byLid.last_direction, byLid.last_message_at || 0, byPhone.id);
    return db.prepare('SELECT * FROM wa_inbox_chats WHERE id = ?').get(byPhone.id);
  }
  const chat = byPhone || byLid;
  if (chat) {
    if ((phone && !chat.phone) || (lid && !chat.lid)) {
      db.prepare('UPDATE wa_inbox_chats SET phone = COALESCE(phone, ?), lid = COALESCE(lid, ?), lead_id = COALESCE(lead_id, ?) WHERE id = ?')
        .run(phone || null, lid || null, phone ? findLead(projectId, phone) : null, chat.id);
      return db.prepare('SELECT * FROM wa_inbox_chats WHERE id = ?').get(chat.id);
    }
    return chat;
  }
  const id = newId('chat');
  db.prepare('INSERT INTO wa_inbox_chats (id, project_id, phone, lid, jid, lead_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, projectId, phone || null, lid || null, jid || (phone ? `${phone}@s.whatsapp.net` : null), phone ? findLead(projectId, phone) : null, now);
  return db.prepare('SELECT * FROM wa_inbox_chats WHERE id = ?').get(id);
}

function touchChat(chatId, { at, type, text, direction, unreadDelta = 0, name = null }) {
  getDB().prepare(`UPDATE wa_inbox_chats SET
      last_text = CASE WHEN COALESCE(last_message_at, 0) <= @at THEN @preview ELSE last_text END,
      last_direction = CASE WHEN COALESCE(last_message_at, 0) <= @at THEN @direction ELSE last_direction END,
      last_message_at = MAX(COALESCE(last_message_at, 0), @at),
      unread = CASE WHEN @direction = 'out' AND COALESCE(last_message_at, 0) <= @at THEN 0 ELSE unread + @unreadDelta END,
      status = CASE WHEN @unreadDelta > 0 THEN 'open' ELSE status END,
      name = COALESCE(@name, name)
    WHERE id = @chatId`).run({ at, preview: previewOf(type, text), direction, unreadDelta, name, chatId });
}

// ── Change notifications (index.js passes them to browsers) ─────

let changeListeners = [];
export function onInboxChange(fn) {
  changeListeners.push(fn);
  return () => { changeListeners = changeListeners.filter(f => f !== fn); };
}
export function notifyChange(projectId, chatId) {
  for (const fn of changeListeners) { try { fn(projectId, chatId); } catch {} }
}

// ── Recording ───────────────────────────────────────────────────

// A message seen on the socket. Returns { inserted, chatId, messageId, parsed } or null if there's nothing to record.
export function recordFromSocket({ projectId, msg, phone, lid, upsert, senderPhone, now = Date.now() }) {
  const parsed = parseMessage(msg.message);
  if (!parsed || (!phone && !lid)) return null;
  const db = getDB();
  const waId = msg.key?.id || null;

  if (parsed.kind === 'revoke' || parsed.kind === 'edit') {
    const row = db.prepare('SELECT id, chat_id, text, original_text FROM wa_inbox_messages WHERE project_id = ? AND wa_msg_id = ?').get(projectId, parsed.id);
    if (!row) return null;
    if (parsed.kind === 'revoke') {
      db.prepare('UPDATE wa_inbox_messages SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?').run(now, row.id);
    } else {
      db.prepare('UPDATE wa_inbox_messages SET text = ?, original_text = COALESCE(original_text, ?), edited_at = ? WHERE id = ?').run(parsed.text, row.text, now, row.id);
    }
    return { inserted: false, chatId: row.chat_id, messageId: row.id, parsed };
  }

  const direction = msg.key?.fromMe ? 'out' : 'in';
  const ts = num(msg.messageTimestamp);
  const at = ts ? Math.min(ts * 1000, now) : now;
  const isHistory = upsert === 'history';
  const hasMedia = !!MEDIA_TYPES[parsed.type];
  const id = newId('wam');

  return db.transaction(() => {
    const chat = chatFor(projectId, { phone, lid, jid: msg.key?.remoteJid }, now);
    const r = db.prepare(`INSERT OR IGNORE INTO wa_inbox_messages (id, project_id, chat_id, wa_msg_id, direction, source, type, text, sender_phone, status, media_state, media_mime, media_name, media_size, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, chat.id, waId, direction, direction === 'out' ? 'phone' : 'contact',
      parsed.type, parsed.text, senderPhone || null, direction === 'out' ? 2 : null, hasMedia ? 'pending' : null, parsed.mime || null, parsed.fileName || null, parsed.size || null, at);
    if (r.changes !== 1) return { inserted: false, chatId: chat.id, parsed };
    touchChat(chat.id, {
      at, type: parsed.type, text: parsed.text, direction,
      unreadDelta: direction === 'in' && !isHistory ? 1 : 0,
      name: direction === 'in' && msg.pushName ? String(msg.pushName).slice(0, 200) : null,
    });
    return { inserted: true, chatId: chat.id, messageId: id, parsed, direction, at };
  })();
}

const MEDIA_TYPES = { image: 1, video: 1, audio: 1, document: 1, sticker: 1 };

// A message we sent (broadcast or inbox reply). The socket may already have recorded it as "from the phone" a moment
// earlier, so the same WhatsApp id updates that row. Never throws: a broadcast must not fail because of the inbox.
export function recordOutbound({ projectId, chatId, phone, leadId, waMsgId, text, source, jobId, accountId, senderPhone, now = Date.now() }) {
  try {
    const db = getDB();
    const p = digits(phone);
    const result = db.transaction(() => {
      const chat = chatId ? { id: chatId } : chatFor(projectId, { phone: p || null }, now);
      if (leadId) db.prepare('UPDATE wa_inbox_chats SET lead_id = COALESCE(lead_id, ?) WHERE id = ?').run(leadId, chat.id);
      const id = newId('wam');
      db.prepare(`INSERT INTO wa_inbox_messages (id, project_id, chat_id, wa_msg_id, direction, source, type, text, account_id, job_id, sender_phone, status, at)
        VALUES (?, ?, ?, ?, 'out', ?, 'text', ?, ?, ?, ?, 2, ?)
        ON CONFLICT(project_id, wa_msg_id) DO UPDATE SET source = excluded.source, text = COALESCE(wa_inbox_messages.text, excluded.text),
          account_id = excluded.account_id, job_id = excluded.job_id`)
        .run(id, projectId, chat.id, waMsgId && waMsgId !== 'unknown' ? waMsgId : null, source, text, accountId || null, jobId || null, senderPhone || null, now);
      touchChat(chat.id, { at: now, type: 'text', text, direction: 'out' });
      return chat.id;
    })();
    notifyChange(projectId, result);
    return result;
  } catch (err) {
    console.error('[wa-inbox] record failed:', err.message);
    return null;
  }
}

async function saveMedia(projectId, messageId, chatId, msg, parsed) {
  const db = getDB();
  const setState = (state, file = null) => db.prepare('UPDATE wa_inbox_messages SET media_state = ?, media_path = ? WHERE id = ?').run(state, file, messageId);
  try {
    if (parsed.size && parsed.size > MAX_MEDIA_BYTES) { setState('too_large'); return; }
    const buffer = await downloadMedia(projectId, msg);
    if (buffer.length > MAX_MEDIA_BYTES) { setState('too_large'); return; }
    const dir = path.join(MEDIA_ROOT, projectId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, messageId), buffer);
    db.prepare('UPDATE wa_inbox_messages SET media_size = ? WHERE id = ?').run(buffer.length, messageId);
    setState('saved', messageId);
  } catch (err) {
    console.error(`[wa-inbox:${projectId}] media download failed: ${err.message}`);
    setState('failed');
  }
  notifyChange(projectId, chatId);
}

function onEvent(e) {
  try {
    if (e.type === 'message') {
      const r = recordFromSocket({ projectId: e.projectId, msg: e.msg, phone: e.phone, lid: e.lid, upsert: e.upsert, senderPhone: e.senderPhone });
      if (!r) return;
      if (r.inserted && MEDIA_TYPES[r.parsed.type]) {
        if (e.upsert !== 'history' && Date.now() - r.at < 7 * DAY) saveMedia(e.projectId, r.messageId, r.chatId, e.msg, r.parsed);
        else getDB().prepare("UPDATE wa_inbox_messages SET media_state = 'unavailable' WHERE id = ?").run(r.messageId);
      }
      // Replies that arrived while LeadDesk was offline come as 'append': they still count as replies and opt-outs
      if (r.inserted && r.direction === 'in' && e.upsert === 'append' && e.phone && Date.now() - r.at < 3 * DAY) _onIncoming(e.projectId, e.phone, r.parsed.text);
      if (e.upsert !== 'history') notifyChange(e.projectId, r.chatId);
    } else if (e.type === 'ack' && e.id) {
      const db = getDB();
      const row = db.prepare('SELECT id, chat_id FROM wa_inbox_messages WHERE project_id = ? AND wa_msg_id = ?').get(e.projectId, e.id);
      if (!row) return;
      db.prepare('UPDATE wa_inbox_messages SET status = CASE WHEN ? = 0 THEN 0 ELSE MAX(COALESCE(status, 0), ?) END WHERE id = ?').run(e.status, e.status, row.id);
      notifyChange(e.projectId, row.chat_id);
    }
  } catch (err) {
    console.error('[wa-inbox]', err.message);
  }
}

let initialised = false;
export function initWaInbox() {
  if (initialised) return;
  initialised = true;
  onWaEvent(onEvent);
}

// ── Sending ─────────────────────────────────────────────────────

let transport = { send: sendChatText, exists: isOnWhatsApp, ready: (projectId) => getStatus(projectId).ready };

// Sends text in a chat and records who sent it. Throws InboxError with the reason when the rules say no.
export async function sendInChat({ projectId, chatId, text, accountId, now = Date.now() }) {
  const db = getDB();
  const body = String(text || '').trim();
  if (!body) throw new InboxError(400, 'Write a message first');
  if (body.length > MAX_TEXT) throw new InboxError(400, `Too long: the limit is ${MAX_TEXT} characters`);
  const chat = db.prepare('SELECT * FROM wa_inbox_chats WHERE id = ? AND project_id = ?').get(chatId, projectId);
  if (!chat) throw new InboxError(404, 'Chat not found');

  const lead = chat.lead_id ? db.prepare('SELECT do_not_contact FROM leads WHERE id = ? AND project_id = ?').get(chat.lead_id, projectId) : null;
  if (lead?.do_not_contact) throw new InboxError(409, 'This contact opted out. To message them again, clear "Do not contact" on their contact page.', 'dnc');

  const stats = db.prepare(`SELECT SUM(direction = 'in') AS incoming, COUNT(*) AS total FROM wa_inbox_messages WHERE chat_id = ?`).get(chat.id);
  const isReply = stats.incoming > 0;
  const address = chat.phone || chat.lid;
  let newChat = false;

  if (isReply) {
    const g = replyGate(projectId, now);
    if (!g.ok) throw new InboxError(409, g.reason, 'limit');
  } else {
    const cc = contactCheck(projectId, { leadId: chat.lead_id, phone: address, now });
    if (!cc.ok) throw new InboxError(409, cc.reason, cc.code || 'limit');
    newChat = cc.newChat && !stats.total;
    const g = gate(projectId, { phone: address, newChat, now });
    if (!g.ok) throw new InboxError(409, g.reason, 'limit');
  }

  if (!transport.ready(projectId)) throw new InboxError(409, 'WhatsApp is not connected. Connect it in Settings → WhatsApp.', 'offline');
  if (!isReply && chat.phone && !(await transport.exists(projectId, chat.phone))) throw new InboxError(409, 'This number is not on WhatsApp', 'not_on_whatsapp');

  let sent;
  try {
    sent = await transport.send(projectId, chat.phone ? `${chat.phone}@s.whatsapp.net` : chat.jid, body);
  } catch (err) {
    if (!err.message.startsWith('Account restricted')) addHealthEvent(projectId, 'send_failed', `${address}: ${err.message}`);
    throw new InboxError(502, `Could not send: ${err.message}`, 'send_failed');
  }
  const waMsgId = sent?.key?.id;
  recordSent({ projectId, phone: address, leadId: chat.lead_id, waMsgId, text: body, newChat, now: Date.now() });
  recordOutbound({ projectId, chatId: chat.id, leadId: chat.lead_id, waMsgId, text: body, source: 'inbox', accountId, senderPhone: getStatus(projectId).phone });
  return db.prepare('SELECT * FROM wa_inbox_messages WHERE chat_id = ? ORDER BY at DESC, rowid DESC LIMIT 1').get(chat.id);
}

// ── Reading (routes/inbox.js) ───────────────────────────────────

// Chats started before their contact existed, or whose contact was deleted, get linked again
export function relinkChats(projectId) {
  const db = getDB();
  const open = db.prepare(`SELECT c.id, c.phone FROM wa_inbox_chats c LEFT JOIN leads l ON l.id = c.lead_id AND l.project_id = c.project_id
    WHERE c.project_id = ? AND l.id IS NULL AND (c.phone IS NOT NULL OR c.lead_id IS NOT NULL)`).all(projectId);
  if (!open.length) return;
  const leads = db.prepare("SELECT id, phone, status FROM leads WHERE project_id = ? AND phone != ''").all(projectId);
  const set = db.prepare('UPDATE wa_inbox_chats SET lead_id = ? WHERE id = ?');
  for (const c of open) set.run(c.phone ? pickLead(leads, c.phone) : null, c.id);
}

// Start (or reopen) a chat with a number; messages go through sendInChat
export function openChatFor(projectId, phone, leadId, now = Date.now()) {
  const db = getDB();
  const chat = db.transaction(() => chatFor(projectId, { phone }, now))();
  if (leadId) db.prepare('UPDATE wa_inbox_chats SET lead_id = ? WHERE id = ?').run(leadId, chat.id);
  return db.prepare('SELECT * FROM wa_inbox_chats WHERE id = ?').get(chat.id);
}

export function removeInboxMedia(projectId) {
  try { fs.rmSync(path.join(MEDIA_ROOT, projectId), { recursive: true, force: true }); } catch {}
}

export function mediaFile(projectId, file) {
  return path.join(MEDIA_ROOT, projectId, path.basename(file));
}

// For tests: no WhatsApp socket; nothing is sent.
export const _onEvent = onEvent;
export function _setTransport(t) { transport = { ...transport, ...t }; }
