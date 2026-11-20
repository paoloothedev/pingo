// 017 — WhatsApp inbox: every 1:1 conversation of a workspace's number. wa_inbox_chats holds one row per person (phone, or
// only a LID until WhatsApp tells us the phone), wa_inbox_messages every message both ways. (Not wa_chats / wa_messages:
// old installs have unused legacy tables with those names and a different shape.) Broadcast texts already in wa_sends are copied in; replies from
// before this migration were never stored, so they can't be.
import crypto from 'crypto';

export const id = '017-wa-inbox';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_inbox_chats (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      phone TEXT,
      lid TEXT,
      jid TEXT,
      name TEXT,
      lead_id TEXT,
      assigned_to TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      unread INTEGER NOT NULL DEFAULT 0,
      last_message_at INTEGER,
      last_text TEXT,
      last_direction TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_inbox_chats_phone ON wa_inbox_chats(project_id, phone);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_inbox_chats_lid ON wa_inbox_chats(project_id, lid);
    CREATE INDEX IF NOT EXISTS idx_wa_inbox_chats_recent ON wa_inbox_chats(project_id, last_message_at);
    CREATE INDEX IF NOT EXISTS idx_wa_inbox_chats_lead ON wa_inbox_chats(lead_id);

    CREATE TABLE IF NOT EXISTS wa_inbox_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      wa_msg_id TEXT,
      direction TEXT NOT NULL,
      source TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      text TEXT,
      original_text TEXT,
      account_id TEXT,
      job_id TEXT,
      sender_phone TEXT,
      status INTEGER,
      media_state TEXT,
      media_path TEXT,
      media_mime TEXT,
      media_name TEXT,
      media_size INTEGER,
      at INTEGER NOT NULL,
      edited_at INTEGER,
      deleted_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_inbox_messages_wa ON wa_inbox_messages(project_id, wa_msg_id);
    CREATE INDEX IF NOT EXISTS idx_wa_inbox_messages_chat ON wa_inbox_messages(chat_id, at);
  `);

  // Broadcasts already sent become the start of each conversation
  const sends = db.prepare(`SELECT project_id, phone, lead_id, job_id, wa_msg_id, text, sender_phone, sent_at, delivered_at
    FROM wa_sends WHERE legacy = 0 AND text IS NOT NULL AND phone != '' ORDER BY sent_at`).all();
  const findChat = db.prepare('SELECT id FROM wa_inbox_chats WHERE project_id = ? AND phone = ?');
  const insChat = db.prepare(`INSERT INTO wa_inbox_chats (id, project_id, phone, jid, lead_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
  const insMsg = db.prepare(`INSERT OR IGNORE INTO wa_inbox_messages (id, project_id, chat_id, wa_msg_id, direction, source, type, text, job_id, sender_phone, status, at)
    VALUES (?, ?, ?, ?, 'out', ?, 'text', ?, ?, ?, ?, ?)`);
  const touch = db.prepare(`UPDATE wa_inbox_chats SET last_message_at = ?, last_text = ?, last_direction = 'out', lead_id = COALESCE(lead_id, ?) WHERE id = ?`);
  const newId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
  for (const s of sends) {
    let chat = findChat.get(s.project_id, s.phone);
    if (!chat) {
      chat = { id: newId('chat') };
      insChat.run(chat.id, s.project_id, s.phone, `${s.phone}@s.whatsapp.net`, s.lead_id, s.sent_at);
    }
    const waId = s.wa_msg_id && s.wa_msg_id !== 'unknown' ? s.wa_msg_id : null;
    insMsg.run(newId('wam'), s.project_id, chat.id, waId, s.job_id ? 'broadcast' : 'inbox', s.text, s.job_id, s.sender_phone, s.delivered_at ? 3 : 2, s.sent_at);
    touch.run(s.sent_at, s.text.slice(0, 200), s.lead_id, chat.id);
  }
}
