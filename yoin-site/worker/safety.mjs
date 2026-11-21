// ゴミ箱 (soft delete, 30 days) and automatic in-D1 backups (weekly, keep 8).
// Deleting a record or list moves the row into `trash` in the same transaction.
const TRASH_DAYS = 30, BACKUP_KEEP = 8, BACKUP_CHUNK = 250000, BACKUP_EVERY = 7 * 86400000;
export async function softDelete(env, kind, id, revision) {
  const table = kind === 'list' ? 'lists' : 'films', now = Date.now();
  const r = await env.DB.batch([
    env.DB.prepare(`INSERT INTO trash (id, kind, item_id, body, revision, deleted_at) SELECT ?, ?, id, body, revision, ? FROM ${table} WHERE id = ? AND revision = ?`).bind(kind + ':' + id + ':' + now, kind, now, id, revision),
    env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND revision = ?`).bind(id, revision)
  ]);
  return r[1].meta.changes === 1;
}
export async function trashList(env) {
  const { results } = await env.DB.prepare("SELECT id, kind, item_id, deleted_at, coalesce(json_extract(body,'$.title'), json_extract(body,'$.name')) AS title, json_extract(body,'$.status') AS status, json_extract(body,'$.rating') AS rating, json_extract(body,'$.movie.poster') AS poster FROM trash ORDER BY deleted_at DESC").all();
  return results.map(r => ({ id: r.id, kind: r.kind, itemId: r.item_id, title: r.title || '', status: r.status || null, rating: r.rating ?? null, poster: typeof r.poster === 'string' ? r.poster : '', deletedAt: r.deleted_at, purgeAt: r.deleted_at + TRASH_DAYS * 86400000 }));
}
export async function trashRestore(env, trashId) {
  const row = await env.DB.prepare('SELECT * FROM trash WHERE id = ?').bind(trashId).first();
  if (!row) return [404, { error: 'ゴミ箱に見つかりません。' }];
  const table = row.kind === 'list' ? 'lists' : 'films';
  if (await env.DB.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).bind(row.item_id).first()) return [409, { error: '同じIDのデータがすでにあります。' }];
  if (row.kind === 'record') {
    const body = JSON.parse(row.body);
    if (body.movie?.id) {
      const dup = await env.DB.prepare("SELECT json_extract(body,'$.title') AS title FROM films WHERE json_extract(body,'$.movie.id') = ? AND coalesce(json_extract(body,'$.movie.mediaType'),'movie') = ?").bind(body.movie.id, body.movie.mediaType || 'movie').first();
      if (dup) return [409, { error: `同じ作品（${dup.title}）がすでに棚にあります。先にそちらを削除するか、そのままにしてください。` }];
    }
  }
  const r = await env.DB.batch([
    env.DB.prepare(`INSERT INTO ${table} (id, body, revision) SELECT item_id, body, revision + 1 FROM trash WHERE id = ? AND NOT EXISTS (SELECT 1 FROM ${table} WHERE id = trash.item_id)`).bind(trashId),
    env.DB.prepare(`DELETE FROM trash WHERE id = ? AND EXISTS (SELECT 1 FROM ${table} WHERE id = trash.item_id)`).bind(trashId)
  ]);
  return r[0].meta.changes === 1 ? [200, { restored: true, kind: row.kind, id: row.item_id }] : [409, { error: '元に戻せませんでした。開き直してください。' }];
}
export async function trashPurge(env, olderThan = Date.now() - TRASH_DAYS * 86400000) {
  return (await env.DB.prepare('DELETE FROM trash WHERE deleted_at < ?').bind(olderThan).run()).meta.changes;
}
// Full backup as one JSON document. Raw bodies are spliced in without parsing to keep CPU low.
// The file is also a valid "yoin-v1" backup, so the existing 「バックアップを読み込む」 can restore records.
export async function createBackup(env, kind = 'auto') {
  const now = Date.now();
  const tables = {};
  for (const [name, sql] of [['films', 'SELECT id, body, revision FROM films ORDER BY id'], ['lists', 'SELECT id, body, revision FROM lists ORDER BY id'], ['notices', 'SELECT id, body, created, read FROM notices ORDER BY id'], ['watch_checks', 'SELECT record_id, body, checked_at FROM watch_checks ORDER BY record_id'], ['trash', 'SELECT id, kind, item_id, body, revision, deleted_at FROM trash ORDER BY id'], ['enrichment_snapshots', 'SELECT id, body, revision FROM enrichment_snapshots ORDER BY id']]) tables[name] = (await env.DB.prepare(sql).all()).results;
  const row = r => '{' + Object.entries(r).map(([k, v]) => JSON.stringify(k) + ':' + (k === 'body' ? v : JSON.stringify(v))).join(',') + '}';
  const summary = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  const text = '{"format":"yoin-v1","kind":"full-backup","version":1,"created":' + now + ',"summary":' + JSON.stringify(summary) + ',"records":[' + tables.films.map(r => r.body).join(',') + '],"tables":{' + Object.entries(tables).map(([k, v]) => JSON.stringify(k) + ':[' + v.map(row).join(',') + ']').join(',') + '}}';
  const id = 'backup-' + new Date(now + 9 * 3600000).toISOString().slice(0, 19).replace(/[-:T]/g, '') + '-' + kind + '-' + crypto.randomUUID().slice(0, 8);
  const chunks = [];
  for (let i = 0; i < text.length; i += BACKUP_CHUNK) chunks.push(text.slice(i, i + BACKUP_CHUNK));
  await env.DB.batch([
    ...chunks.map((c, i) => env.DB.prepare('INSERT INTO backup_chunks (backup_id, idx, data) VALUES (?, ?, ?)').bind(id, i, c)),
    env.DB.prepare('INSERT INTO backups (id, created, kind, size, chunks, summary) VALUES (?, ?, ?, ?, ?, ?)').bind(id, now, kind, text.length, chunks.length, JSON.stringify(summary))
  ]);
  // Keep the newest BACKUP_KEEP backups.
  const old = (await env.DB.prepare('SELECT id FROM backups ORDER BY created DESC LIMIT -1 OFFSET ?').bind(BACKUP_KEEP).all()).results;
  if (old.length) await env.DB.batch(old.flatMap(o => [env.DB.prepare('DELETE FROM backup_chunks WHERE backup_id = ?').bind(o.id), env.DB.prepare('DELETE FROM backups WHERE id = ?').bind(o.id)]));
  return { id, created: now, size: text.length, chunks: chunks.length, summary };
}
export async function backupsList(env) {
  return (await env.DB.prepare('SELECT id, created, kind, size, chunks, summary FROM backups ORDER BY created DESC').all()).results.map(b => ({ ...b, summary: JSON.parse(b.summary) }));
}
export async function backupDownload(env, id) {
  const meta = await env.DB.prepare('SELECT id, created, chunks FROM backups WHERE id = ?').bind(id).first();
  if (!meta) return json({ error: 'バックアップが見つかりません。' }, 404);
  const { results } = await env.DB.prepare('SELECT idx, data FROM backup_chunks WHERE backup_id = ? ORDER BY idx').bind(id).all();
  if (results.length !== meta.chunks) return json({ error: 'バックアップが壊れています。' }, 500);
  const date = new Date(meta.created + 9 * 3600000).toISOString().slice(0, 10);
  return new Response(results.map(r => r.data).join(''), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="yoin-full-backup-${date}.json"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
// Cron: purge old trash, then a weekly backup when the newest one is older than 7 days.
export async function runMaintenance(env) {
  if (!env.DB) return null;
  const purged = await trashPurge(env);
  const last = (await env.DB.prepare('SELECT max(created) AS t FROM backups').first())?.t || 0;
  const backup = Date.now() - last >= BACKUP_EVERY ? await createBackup(env, 'auto') : null;
  return { purged, backup };
}
export async function safetyApi(request, env, url) {
  const path = url.pathname, method = request.method;
  const body = () => request.json().catch(() => null);
  const send = ([status, data]) => json(data, status);
  if (path === '/api/trash' && method === 'GET') return json({ items: await trashList(env), days: TRASH_DAYS });
  if (path === '/api/trash/restore' && method === 'POST') { const d = await body(); return typeof d?.id === 'string' ? send(await trashRestore(env, d.id)) : json({ error: 'id を指定してください。' }, 400); }
  if (path === '/api/trash/purge' && method === 'POST') {
    const d = await body();
    if (typeof d?.id !== 'string') return json({ error: 'id を指定してください。' }, 400);
    const r = await env.DB.prepare('DELETE FROM trash WHERE id = ?').bind(d.id).run();
    return json({ purged: r.meta.changes });
  }
  if (path === '/api/backups' && method === 'GET') return json({ backups: await backupsList(env), keep: BACKUP_KEEP });
  if (path === '/api/backups' && method === 'POST') {
    const last = (await env.DB.prepare("SELECT max(created) AS t FROM backups WHERE kind = 'manual'").first())?.t || 0;
    if (Date.now() - last < 600000) return json({ error: '手動バックアップは10分に1回までです。' }, 429);
    return json({ backup: await createBackup(env, 'manual') }, 201);
  }
  const m = /^\/api\/backups\/([^/]+)\/download$/.exec(path);
  if (m && method === 'GET') return backupDownload(env, decodeURIComponent(m[1]));
  return json({ error: '見つかりません。' }, 404);
}
