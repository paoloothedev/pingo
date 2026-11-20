import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { getDB, logAudit } from '../db.js';
import { requirePermission } from './auth.js';
import { wrap } from '../lib/async.js';
import { sendFileMessage } from '../whatsapp.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

export const FILES_ROOT = process.env.FILES_DIR ||
  path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'files');

function projectDir(projectId) {
  const dir = path.join(FILES_ROOT, projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveFileToDisk(projectId, buffer, originalName) {
  const id = crypto.randomUUID();
  const ext = path.extname(originalName) || '';
  const diskPath = path.join(projectDir(projectId), id + ext);
  fs.writeFileSync(diskPath, buffer);
  return { id, diskPath };
}

// List files
router.get('/', requirePermission('leads.view'), wrap((req, res) => {
  const db = getDB();
  const files = db.prepare('SELECT id, name, original_name, mime_type, size, uploaded_by, created_at FROM files WHERE project_id = ? ORDER BY created_at DESC').all(req.project.id);
  res.json({ items: files });
}));

// Upload via multipart (browser)
router.post('/upload', requirePermission('leads.edit'), upload.single('file'), wrap((req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const name = (req.body.name || req.file.originalname || 'file').slice(0, 200);
  const { id, diskPath } = saveFileToDisk(req.project.id, req.file.buffer, req.file.originalname);
  const db = getDB();
  db.prepare('INSERT INTO files (id, project_id, name, original_name, mime_type, size, disk_path, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, req.project.id, name, req.file.originalname, req.file.mimetype, req.file.size, diskPath, req.user.id, Date.now());
  logAudit('create', 'file', id, name, { size: req.file.size }, req.project.id);
  res.json({ id, name, original_name: req.file.originalname, mime_type: req.file.mimetype, size: req.file.size, created_at: Date.now() });
}));

// Upload via base64 (MCP / Claude)
router.post('/from-base64', requirePermission('leads.edit'), wrap((req, res) => {
  const { name, mime_type, content_base64 } = req.body || {};
  if (!name || !content_base64) return res.status(400).json({ error: 'name and content_base64 required' });
  const buffer = Buffer.from(content_base64, 'base64');
  if (buffer.length > 25 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 25 MB)' });
  const mimeType = mime_type || 'application/octet-stream';
  const { id, diskPath } = saveFileToDisk(req.project.id, buffer, name);
  const db = getDB();
  db.prepare('INSERT INTO files (id, project_id, name, original_name, mime_type, size, disk_path, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, req.project.id, name, name, mimeType, buffer.length, diskPath, req.user.id, Date.now());
  logAudit('create', 'file', id, name, { size: buffer.length }, req.project.id);
  res.json({ id, name, original_name: name, mime_type: mimeType, size: buffer.length, created_at: Date.now() });
}));

// Delete file
router.delete('/:id', requirePermission('leads.edit'), wrap((req, res) => {
  const db = getDB();
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(file.disk_path); } catch {}
  db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
  logAudit('delete', 'file', file.id, file.name, {}, req.project.id);
  res.json({ ok: true });
}));

// Send file to a contact via WhatsApp
router.post('/:id/send', requirePermission('whatsapp.send'), wrap(async (req, res) => {
  const db = getDB();
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND project_id = ?').get(req.params.id, req.project.id);
  if (!file) return res.status(404).json({ error: 'File not found' });

  const { contact_id, phone, caption } = req.body || {};
  let targetPhone = phone;
  if (!targetPhone && contact_id) {
    const contact = db.prepare('SELECT phone FROM leads WHERE id = ? AND project_id = ?').get(contact_id, req.project.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    targetPhone = contact.phone;
  }
  if (!targetPhone) return res.status(400).json({ error: 'contact_id or phone required' });

  const buffer = fs.readFileSync(file.disk_path);
  await sendFileMessage(req.project.id, targetPhone, buffer, file.mime_type, file.original_name, caption || '');

  logAudit('send_file', 'file', file.id, file.name, { to: targetPhone, contact_id: contact_id || null }, req.project.id);
  res.json({ ok: true });
}));

export default router;
