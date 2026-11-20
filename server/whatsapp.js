import { makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, fetchLatestWaWebVersion, downloadMediaMessage } from '@whiskeysockets/baileys';
import qrcode from 'qrcode';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isRestrictionNotice } from './lib/waRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_ROOT = process.env.WA_AUTH_DIR || path.join(__dirname, 'baileys_auth');
// Received photos, voice notes and files (see lib/waInbox.js), next to the sessions so they share the same volume
export const MEDIA_ROOT = process.env.WA_MEDIA_DIR || path.join(path.dirname(AUTH_ROOT), 'wa_media');

// projectId -> client state
const clients = new Map();
let statusListeners = [];
let messageListeners = [];
let eventListeners = [];

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch {}
}

function getClientState(projectId) {
  if (!clients.has(projectId)) {
    const authDir = path.join(AUTH_ROOT, projectId);
    ensureDir(authDir);
    clients.set(projectId, {
      projectId,
      sock: null,
      sockReady: false,
      qrData: null,
      status: 'disconnected',
      restrictionReason: null,
      intentionalDisconnect: false,
      reconnectTimer: null,
      failures: 0,
      lastError: null,
      phone: null,
      authDir,
    });
  }
  return clients.get(projectId);
}

function notifyStatus(projectId) {
  const s = clients.get(projectId);
  if (!s) return;
  for (const fn of statusListeners) fn(projectId, s.status, s.qrData);
}

export function onStatusChange(fn) {
  statusListeners.push(fn);
  return () => { statusListeners = statusListeners.filter(f => f !== fn); };
}

export function getStatus(projectId) {
  const s = clients.get(projectId);
  if (!s) return { status: 'disconnected', qr: null, ready: false, restricted: false, restrictionReason: null };
  return {
    status: s.status,
    qr: s.qrData,
    ready: s.sockReady,
    restricted: s.status === 'restricted',
    restrictionReason: s.restrictionReason,
    lastError: s.lastError,
    phone: s.phone,
  };
}

// WhatsApp rejects (405 "Connection Failure") clients that announce an outdated WA Web version, and the version
// bundled with Baileys goes stale — so ask for the current one (cached 6 h, bundled default if the fetch fails).
let waVersion = null, waVersionAt = 0;
async function currentWaVersion() {
  if (waVersion && Date.now() - waVersionAt < 6 * 3600 * 1000) return waVersion;
  try {
    const { version } = await fetchLatestWaWebVersion();
    if (Array.isArray(version)) { waVersion = version; waVersionAt = Date.now(); }
  } catch {}
  return waVersion;
}

const MAX_UNLINKED_FAILURES = 3;

// Low-level events for lib/waGuard.js: open, close {intentional, loggedOut, restricted, reason}, logout,
// ack {id, status} for our own messages, incoming {phone, text} (1:1 chats only), message {msg, phone, lid, upsert,
// senderPhone} for every 1:1 message both ways, including ones sent from the phone.
export function onWaEvent(fn) {
  eventListeners.push(fn);
  return () => { eventListeners = eventListeners.filter(f => f !== fn); };
}

function emit(projectId, event) {
  for (const fn of eventListeners) {
    try { fn({ projectId, ...event }); } catch {}
  }
}

// Phone digits of the other side of a 1:1 chat (Baileys 7 may address chats by LID; the PN is in the alt fields).
function chatPhone(key) {
  for (const jid of [key?.remoteJid, key?.remoteJidAlt, key?.senderPn]) {
    if (typeof jid === 'string' && jid.endsWith('@s.whatsapp.net')) return jid.split('@')[0].split(':')[0];
  }
  return null;
}

// Who a 1:1 chat is with: phone and/or LID. null for groups, status updates and channels (not recorded).
async function chatAddress(s, key) {
  const jid = key?.remoteJid;
  if (typeof jid !== 'string' || !(jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'))) return null;
  let phone = chatPhone(key);
  const lid = jid.endsWith('@lid') ? jid.split('@')[0].split(':')[0] : null;
  if (!phone && lid) {
    try {
      const pn = await s.sock?.signalRepository?.lidMapping?.getPNForLID(jid);
      if (pn) phone = pn.split('@')[0].split(':')[0];
    } catch {}
  }
  return { phone, lid };
}

export function onMessage(fn) {
  messageListeners.push(fn);
  return () => { messageListeners = messageListeners.filter(f => f !== fn); };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parseSpintax(text) {
  return text.replace(/\{([^{}]*)\}/g, (match, group) => {
    const options = group.split('|');
    return options[Math.floor(Math.random() * options.length)];
  });
}

// Migrate legacy flat baileys_auth/ layout into baileys_auth/<projectId>/
export function migrateLegacyAuth(defaultProjectId) {
  if (!defaultProjectId) return;
  try {
    const legacyCreds = path.join(AUTH_ROOT, 'creds.json');
    if (!fs.existsSync(legacyCreds)) return;
    const dest = path.join(AUTH_ROOT, defaultProjectId);
    ensureDir(dest);
    const entries = fs.readdirSync(AUTH_ROOT);
    for (const name of entries) {
      const src = path.join(AUTH_ROOT, name);
      if (src === dest) continue;
      const stat = fs.statSync(src);
      if (stat.isFile()) {
        fs.renameSync(src, path.join(dest, name));
      }
    }
    console.log(`[wa] Migrated legacy auth into ${defaultProjectId}/`);
  } catch (err) {
    console.error('[wa] Legacy auth migration failed:', err.message);
  }
}

export function hasSession(projectId) {
  return fs.existsSync(path.join(AUTH_ROOT, projectId, 'creds.json'));
}

export async function initClient(projectId) {
  const s = getClientState(projectId);
  s.intentionalDisconnect = false;
  if (s.sock) {
    try { s.sock.end(null); } catch {}
    s.sock = null;
  }
  s.sockReady = false;
  s.qrData = null;
  s.lastError = null;
  s.status = 'connecting';
  notifyStatus(projectId);

  const { state, saveCreds } = await useMultiFileAuthState(s.authDir);
  const version = await currentWaVersion();

  s.sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, undefined),
    },
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: undefined,
    retryRequestDelayMs: 250,
    maxRetries: 4,
    logger: pino({ level: 'silent' }),
  });

  s.sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        s.qrData = await qrcode.toDataURL(qr);
      } catch {
        s.qrData = 'data:image/png;base64,';
      }
      s.status = 'qr_ready';
      s.restrictionReason = null;
      notifyStatus(projectId);
      console.log(`[wa:${projectId}] QR code received — scan with your phone`);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const errorMsg = lastDisconnect?.error?.message || '';
      console.log(`[wa:${projectId}] Connection closed. Status: ${statusCode}. Error: ${errorMsg}`);

      s.sockReady = false;
      // Not linked yet (no QR scanned): failures here say nothing about the number's health
      const linked = !!state.creds?.me;

      if (linked && errorMsg.includes('restricted')) {
        s.status = 'restricted';
        s.restrictionReason = 'Your account on linked devices is restricted. This usually lasts 24-72 hours for new or flagged Business accounts. Wait for the restriction to lift, or use a regular WhatsApp account.';
        notifyStatus(projectId);
        emit(projectId, { type: 'close', intentional: s.intentionalDisconnect, restricted: true, reason: errorMsg || `status ${statusCode}` });
        console.log(`[wa:${projectId}] Account restricted — pausing all activity`);
        return;
      }

      s.status = 'disconnected';
      s.restrictionReason = null;
      if (statusCode === DisconnectReason.loggedOut && !s.intentionalDisconnect) {
        s.lastError = 'WhatsApp logged this device out (removed from the phone, or WhatsApp restricted it). Check the phone, then press Connect and scan the QR again.';
        s.phone = null;
      }
      notifyStatus(projectId);
      emit(projectId, { type: 'close', intentional: s.intentionalDisconnect, linked, loggedOut: statusCode === DisconnectReason.loggedOut, reason: errorMsg || `status ${statusCode}` });

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect && !s.intentionalDisconnect) {
        s.failures++;
        if (!linked && s.failures >= MAX_UNLINKED_FAILURES) {
          // Never got as far as a QR code: stop instead of retrying forever; the user can press Connect again.
          s.lastError = `Could not reach WhatsApp (${errorMsg || `status ${statusCode}`}). Press Connect to try again.`;
          s.failures = 0;
          waVersion = null;
          notifyStatus(projectId);
          console.log(`[wa:${projectId}] Gave up after ${MAX_UNLINKED_FAILURES} failed attempts without a session`);
          return;
        }
        // Back off: 5 s, 10 s, 20 s … up to 5 min
        const delay = Math.min(5000 * 2 ** (s.failures - 1), 5 * 60 * 1000);
        if (s.reconnectTimer) clearTimeout(s.reconnectTimer);
        s.reconnectTimer = setTimeout(() => initClient(projectId), delay);
      } else if (statusCode === DisconnectReason.loggedOut) {
        console.log(`[wa:${projectId}] Logged out — clearing auth state`);
        try { fs.rmSync(s.authDir, { recursive: true, force: true }); } catch {}
        ensureDir(s.authDir);
        s.status = 'disconnected';
        notifyStatus(projectId);
      }
    }

    if (connection === 'open') {
      s.failures = 0;
      s.lastError = null;
      s.sockReady = true;
      s.qrData = null;
      s.restrictionReason = null;
      s.status = 'connected';
      s.phone = String(s.sock?.user?.id || state.creds?.me?.id || '').split(/[:@]/)[0] || null;
      notifyStatus(projectId);
      emit(projectId, { type: 'open', phone: s.phone });
      console.log(`[wa:${projectId}] Connected to WhatsApp`);
    }
  });

  s.sock.ev.on('creds.update', saveCreds);

  s.sock.ev.on('messaging-history.set', async ({ messages }) => {
    // What WhatsApp hands over when a number is first linked: recent messages, recorded but not counted as unread
    for (const msg of messages || []) {
      const address = await chatAddress(s, msg.key);
      if (address) emit(projectId, { type: 'message', msg, upsert: 'history', senderPhone: s.phone, ...address });
    }
  });

  s.sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      const address = await chatAddress(s, msg.key);
      if (address) emit(projectId, { type: 'message', msg, upsert: type, senderPhone: s.phone, ...address });
      if (type !== 'notify' || msg.key.fromMe) continue;
      const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      const from = msg.key.remoteJid;

      // Only WhatsApp's own system messages can signal a restriction — never a contact's reply
      if (isRestrictionNotice(from, body)) {
        console.log(`[wa:${projectId}] RESTRICTION notice from ${from}: ${body}`);
        s.status = 'restricted';
        s.restrictionReason = body;
        notifyStatus(projectId);
      }

      for (const fn of messageListeners) fn({ projectId, from, body, msg });
      const phone = chatPhone(msg.key);
      if (phone) emit(projectId, { type: 'incoming', phone, text: body });
    }
  });

  s.sock.ev.on('messages.update', (messages) => {
    for (const msg of messages) {
      if (msg.update.status) {
        const ack = msg.update.status;
        const id = msg.key?.id || 'unknown';
        console.log(`[wa:${projectId}] message_ack: ${msg.key?.remoteJid || 'unknown'} msgId: ${id} ack: ${ack}`);
        if (msg.key?.fromMe) emit(projectId, { type: 'ack', id: msg.key.id, status: ack });
      }
    }
  });

  console.log(`[wa:${projectId}] Initializing Baileys client...`);
}

export async function sendMessage(projectId, phone, text) {
  const s = getClientState(projectId);
  if (!s.sock || !s.sockReady) throw new Error('WhatsApp not connected');
  if (s.status === 'restricted') throw new Error('Account restricted: ' + (s.restrictionReason || 'Linked device restricted by WhatsApp'));
  const cleaned = phone.replace(/\D/g, '');
  const jid = cleaned + '@s.whatsapp.net';

  try { await s.sock.sendPresenceUpdate('available'); } catch {}
  await sleep(1000 + Math.random() * 2000);

  try { await s.sock.sendPresenceUpdate('composing', jid); } catch {}
  const typingDuration = Math.max(3000, text.length * 25);
  await sleep(typingDuration);

  const varied = parseSpintax(text);
  await s.sock.sendMessage(jid, { text: varied });

  try { await s.sock.sendPresenceUpdate('paused', jid); } catch {}
  await sleep(2000 + Math.random() * 2000);

  try { await s.sock.sendPresenceUpdate('unavailable'); } catch {}
}

// `typingMsPerChar`: composing time per character (anti-ban limits); `spin: false` when the caller already expanded
// spintax (routes/jobs.js does, so the identical-text check sees the final text).
export async function sendHumanMessage(projectId, phone, text, { typingMsPerChar = 25, spin = true } = {}) {
  const s = getClientState(projectId);
  if (!s.sock || !s.sockReady) throw new Error('WhatsApp not connected');
  if (s.status === 'restricted') throw new Error('Account restricted: ' + (s.restrictionReason || 'Linked device restricted by WhatsApp'));
  const cleaned = phone.replace(/\D/g, '');
  const jid = cleaned + '@s.whatsapp.net';

  await sleep(2000 + Math.random() * 3000);

  try { await s.sock.sendPresenceUpdate('available'); } catch {}
  await sleep(1000 + Math.random() * 2000);

  try { await s.sock.sendPresenceUpdate('composing', jid); } catch {}
  const typingDuration = Math.min(25000, Math.max(2000, text.length * typingMsPerChar));
  await sleep(typingDuration);

  const varied = spin ? parseSpintax(text) : text;
  const sentMsg = await s.sock.sendMessage(jid, { text: varied });
  const msgId = sentMsg?.key?.id || 'unknown';
  console.log(`[wa:${projectId}] Sent to ${jid}, msgId: ${msgId}`);

  try { await s.sock.sendPresenceUpdate('paused', jid); } catch {}
  await sleep(2000 + Math.random() * 3000);

  try { await s.sock.sendPresenceUpdate('unavailable'); } catch {}
  await sleep(1000 + Math.random() * 1500);

  return sentMsg;
}

// A person typing in the inbox: they already took their time, so only a short typing indicator. `address` is a full jid.
export async function sendChatText(projectId, address, text) {
  const s = getClientState(projectId);
  if (!s.sock || !s.sockReady) throw new Error('WhatsApp not connected');
  if (s.status === 'restricted') throw new Error('Account restricted: ' + (s.restrictionReason || 'Linked device restricted by WhatsApp'));
  try { await s.sock.sendPresenceUpdate('composing', address); } catch {}
  await sleep(Math.min(4000, 800 + text.length * 15));
  const sent = await s.sock.sendMessage(address, { text });
  s.sock.sendPresenceUpdate('paused', address).catch(() => {});
  return sent;
}

// Send a file (PDF, image, etc.) as a WhatsApp document or image message.
export async function sendFileMessage(projectId, phone, buffer, mimeType, fileName, caption = '') {
  const s = getClientState(projectId);
  if (!s.sock || !s.sockReady) throw new Error('WhatsApp not connected');
  if (s.status === 'restricted') throw new Error('Account restricted: ' + (s.restrictionReason || 'Linked device restricted by WhatsApp'));
  const cleaned = phone.replace(/\D/g, '');
  const jid = cleaned + '@s.whatsapp.net';

  await sleep(2000 + Math.random() * 2000);
  try { await s.sock.sendPresenceUpdate('available'); } catch {}
  await sleep(500 + Math.random() * 1000);

  const isImage = mimeType.startsWith('image/');
  const content = isImage
    ? { image: buffer, mimetype: mimeType, caption: caption || undefined }
    : { document: buffer, mimetype: mimeType, fileName, caption: caption || undefined };

  const sentMsg = await s.sock.sendMessage(jid, content);

  try { await s.sock.sendPresenceUpdate('unavailable'); } catch {}
  await sleep(1000 + Math.random() * 1500);

  return sentMsg;
}

export async function downloadMedia(projectId, msg) {
  const s = getClientState(projectId);
  return downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: s.sock?.updateMediaMessage });
}

export async function isOnWhatsApp(projectId, phone) {
  const s = getClientState(projectId);
  if (!s.sock || !s.sockReady) throw new Error('WhatsApp not connected');
  const [res] = await s.sock.onWhatsApp(phone.replace(/\D/g, '') + '@s.whatsapp.net');
  return !!res?.exists;
}

export async function checkPhones(projectId, phones) {
  const s = getClientState(projectId);
  if (!s.sock || !s.sockReady) throw new Error('WhatsApp not connected');
  const results = [];
  for (const phone of phones) {
    const cleaned = phone.replace(/\D/g, '');
    if (!cleaned || cleaned.length < 7) {
      results.push({ phone: cleaned, exists: false, error: 'Invalid number' });
      continue;
    }
    try {
      const [exists] = await s.sock.onWhatsApp(cleaned + '@s.whatsapp.net');
      results.push({ phone: cleaned, exists: exists || false, error: null });
    } catch (err) {
      results.push({ phone: cleaned, exists: false, error: err.message });
    }
  }
  return results;
}

export async function destroyClient(projectId) {
  const s = clients.get(projectId);
  if (!s) return;
  s.intentionalDisconnect = true;
  if (s.reconnectTimer) { clearTimeout(s.reconnectTimer); s.reconnectTimer = null; }
  if (s.sock) {
    try { s.sock.end(null); } catch {}
    s.sock = null;
    s.sockReady = false;
    s.status = 'disconnected';
    notifyStatus(projectId);
  }
}

export async function logoutClient(projectId) {
  const s = getClientState(projectId);
  s.intentionalDisconnect = true;
  if (s.reconnectTimer) { clearTimeout(s.reconnectTimer); s.reconnectTimer = null; }
  if (s.sock) {
    try { s.sock.logout(); } catch {}
    try { s.sock.end(null); } catch {}
    s.sock = null;
    s.sockReady = false;
  }
  s.qrData = null;
  s.phone = null;
  s.status = 'disconnected';
  notifyStatus(projectId);
  emit(projectId, { type: 'logout' });
  try { fs.rmSync(s.authDir, { recursive: true, force: true }); } catch {}
  ensureDir(s.authDir);
}

export async function destroyAllClients() {
  for (const projectId of Array.from(clients.keys())) {
    try { await destroyClient(projectId); } catch {}
  }
}

// Called when a project is deleted: close its socket and remove its session files.
export async function removeProjectAuth(projectId) {
  await destroyClient(projectId);
  clients.delete(projectId);
  try { fs.rmSync(path.join(AUTH_ROOT, projectId), { recursive: true, force: true }); } catch {}
}

export function formatPhoneForWA(phone) {
  return phone.replace(/\D/g, '');
}
