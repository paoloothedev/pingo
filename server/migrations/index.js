// Versioned schema migrations. To change the schema, add a new file NNN-short-name.js exporting
// `id` (same as the filename without .js) and `up(db)`, then append it to MIGRATIONS below.
// Never edit a migration that has already shipped — add a new one.
import * as m001 from './001-baseline.js';
import * as m002 from './002-project-members.js';
import * as m003 from './003-list-indexes.js';
import * as m004 from './004-queue.js';
import * as m005 from './005-wa-daily-counts.js';
import * as m006 from './006-contacts.js';
import * as m007 from './007-companies.js';
import * as m008 from './008-deals.js';
import * as m009 from './009-custom-fields.js';
import * as m010 from './010-saved-views.js';
import * as m011 from './011-duplicate-dismissals.js';
import * as m012 from './012-contact-message.js';
import * as m013 from './013-wa-antiban.js';
import * as m014 from './014-scheduled-broadcasts.js';
import * as m015 from './015-wa-numbers-campaign-links.js';
import * as m016 from './016-lead-category.js';
import * as m017 from './017-wa-inbox.js';
import * as m018 from './018-files.js';

export const MIGRATIONS = [m001, m002, m003, m004, m005, m006, m007, m008, m009, m010, m011, m012, m013, m014, m015, m016, m017, m018];

export function runMigrations(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map(r => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(m.id, Date.now());
    })();
    console.log(`[db] Applied migration ${m.id}`);
  }
}
