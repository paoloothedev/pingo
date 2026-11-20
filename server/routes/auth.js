import { Router } from 'express';
import { getDB, logAudit } from '../db.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { wrap } from '../lib/async.js';
import { clientIp, retryAfterSeconds, recordFailure, clearFailures } from '../lib/loginLimit.js';

const router = Router();

const ALL_PERMISSIONS = [
  'dashboard.view',
  'leads.view', 'leads.edit', 'leads.delete', 'leads.verify', 'leads.import',
  'campaigns.view', 'campaigns.edit', 'campaigns.delete', 'campaigns.send',
  'templates.view', 'templates.edit',
  'stages.view', 'stages.edit',
  'tags.view', 'tags.edit',
  'settings.view', 'settings.edit',
  'whatsapp.view', 'whatsapp.control',
  'accounts.view', 'accounts.manage',
  'broadcast.view', 'broadcast.manage',
  'projects.manage',
  'deals.view', 'deals.edit', 'deals.delete',
];

const SESSION_DAYS = 30;

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Resolve a session token to a user object, or null if missing/expired.
export function getUserFromToken(token) {
  if (!token) return null;
  const db = getDB();
  const session = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now());
  if (!session) return null;
  return getUserById(session.account_id);
}

export function getUserById(accountId) {
  const account = getDB().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) return null;
  return {
    id: account.id,
    username: account.username,
    display_name: account.display_name,
    email: account.email || '',
    role: account.role,
    parent_id: account.parent_id,
    permissions: JSON.parse(account.permissions || '[]'),
  };
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) cookies[k] = v.join('=');
  }
  return cookies;
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Personal access token (api_tokens, used by the MCP endpoint) → user object, or null.
export function getUserFromApiToken(token) {
  if (!token || typeof token !== 'string' || !token.startsWith('ldk_')) return null;
  const db = getDB();
  const row = db.prepare('SELECT id, account_id FROM api_tokens WHERE token_hash = ?').get(hashToken(token));
  if (!row) return null;
  db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id);
  return getUserById(row.account_id);
}

// Accepts the session cookie, or `Authorization: Bearer ldk_…` (personal access token).
export function authMiddleware(req, res, next) {
  const bearer = (req.headers.authorization || '').match(/^Bearer\s+(ldk_\w+)$/)?.[1];
  if (bearer) {
    const user = getUserFromApiToken(bearer);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    req.user = user;
    return next();
  }
  const token = req.cookies?.lead_session;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const user = getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Session expired' });
  req.user = user;
  next();
}

export function hasPermission(user, perm) {
  return !!user && (user.role === 'admin' || user.permissions.includes(perm));
}

export function requirePermission(...perms) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.role === 'admin') return next();
    const has = req.user.permissions;
    if (perms.some(p => has.includes(p))) return next();
    res.status(403).json({ error: 'Permission denied' });
  };
}

// Compared when the username doesn't exist, so a wrong username takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

const usesDefaultPassword = (account) => account.username === 'admin' && bcrypt.compare('admin', account.password_hash);

// Logs this browser in. Secure only over https (directly or via a tunnel), so plain http on a LAN keeps working.
export function startSession(req, res, account) {
  const token = generateToken();
  const db = getDB();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(token, account.id, Date.now(), Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const https = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  res.cookie('lead_session', token, { httpOnly: true, maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000, sameSite: 'lax', secure: https });
}

router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const ip = clientIp(req);
  const retryAfter = retryAfterSeconds(ip);
  if (retryAfter) {
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: `Too many failed logins. Try again in ${Math.ceil(retryAfter / 60)} min.` });
  }

  const db = getDB();
  const account = db.prepare('SELECT * FROM accounts WHERE username = ?').get(username);
  const valid = await bcrypt.compare(String(password), account?.password_hash || DUMMY_HASH);
  if (!account || !valid) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  clearFailures(ip);

  startSession(req, res, account);
  logAudit('login', 'account', account.id, account.username);
  res.json({
    id: account.id,
    username: account.username,
    display_name: account.display_name,
    role: account.role,
    permissions: JSON.parse(account.permissions || '[]'),
    default_password: account.username === 'admin' && password === 'admin',
  });
}));

router.post('/logout', (req, res) => {
  const token = req.cookies?.lead_session;
  if (token) {
    const db = getDB();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  res.clearCookie('lead_session');
  res.json({ ok: true });
});

router.get('/me', authMiddleware, wrap(async (req, res) => {
  const account = getDB().prepare('SELECT username, password_hash FROM accounts WHERE id = ?').get(req.user.id);
  res.json({ ...req.user, default_password: account ? await usesDefaultPassword(account) : false });
}));

router.get('/permissions', (req, res) => {
  res.json(ALL_PERMISSIONS);
});

export default router;
