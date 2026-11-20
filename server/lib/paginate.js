// Shared list helpers: optional pagination and batched "IN (...)" lookups for enriching rows.

// Reads ?page & ?limit. Returns null when the caller didn't ask for pagination (legacy array responses).
export function pageParams(query, { defaultLimit = 50, maxLimit = 500 } = {}) {
  if (query.page === undefined) return null;
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

// Runs `sql` (a SELECT whose params are `params`) with pagination if requested.
// Returns { rows, total } — total is null when not paginated.
export function runPaged(db, sql, params, paging) {
  if (!paging) return { rows: db.prepare(sql).all(...params), total: null };
  const total = db.prepare(`SELECT COUNT(*) AS c FROM (${sql})`).get(...params).c;
  const rows = db.prepare(`${sql} LIMIT ? OFFSET ?`).all(...params, paging.limit, paging.offset);
  return { rows, total };
}

// Groups rows returned by `sqlForChunk(placeholders)` by `keyCol`, for the given ids, in chunks.
// Example: groupBy(db, ids, ph => `SELECT lt.lead_id AS k, t.* FROM ... WHERE lt.lead_id IN (${ph})`)
export function groupBy(db, ids, sqlForChunk, keyCol = 'k') {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = db.prepare(sqlForChunk(chunk.map(() => '?').join(','))).all(...chunk);
    for (const r of rows) {
      const key = r[keyCol];
      delete r[keyCol];
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(r);
    }
  }
  return out;
}

export function sendList(res, rows, total, paging) {
  if (!paging) return res.json(rows);
  res.json({ items: rows, total, page: paging.page, limit: paging.limit });
}
