// Filmarks-style features: viewing method / spoiler / re-watches (stored inside
// each record body as optional keys), user lists, and want-list notices.
// Everything here is additive: existing records are never rewritten by the
// notice checker — it only writes to the new lists / notices / watch_checks tables.
export const VIEW_METHODS = ['theater', 'streaming', 'tv', 'disc', 'other'];
// Dates may be partial: YYYY, YYYY-MM or YYYY-MM-DD (or empty).
export const PARTIAL_DATE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;
const ftDateOk = v => v === '' || PARTIAL_DATE.test(v);
const ftRatingOk = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 5 && Math.abs(v * 10 - Math.round(v * 10)) < 0.000001;
export function viewingError(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return '鑑賞記録の形式が正しくありません。';
  if (typeof v.id !== 'string' || !v.id || v.id.length > 80) return '鑑賞記録のIDが不正です。';
  if (typeof v.date !== 'string' || !ftDateOk(v.date)) return '鑑賞日は "YYYY-MM-DD"・"YYYY-MM"・"YYYY" か空文字で指定してください。';
  if (typeof v.method !== 'string' || (v.method !== '' && !VIEW_METHODS.includes(v.method))) return '鑑賞方法は ' + VIEW_METHODS.join(' / ') + ' か空文字です。';
  if (typeof v.service !== 'string' || v.service.length > 100) return '配信サービス名は100文字以内の文字列です。';
  if (!ftRatingOk(v.rating)) return '鑑賞ごとの評価は 0〜5（小数第1位まで）です。';
  if (typeof v.note !== 'string' || v.note.length > 5000) return '鑑賞メモは5000文字以内の文字列です。';
  return '';
}
// Optional record keys. Absent keys are always valid, so existing records are unaffected.
export function extrasError(r) {
  if ('spoiler' in r && typeof r.spoiler !== 'boolean') return 'spoiler は true / false です。';
  if ('method' in r && (typeof r.method !== 'string' || (r.method !== '' && !VIEW_METHODS.includes(r.method)))) return 'method は ' + VIEW_METHODS.join(' / ') + ' か空文字です。';
  if ('service' in r && (typeof r.service !== 'string' || r.service.length > 100)) return 'service は100文字以内の文字列です。';
  if ('viewings' in r) {
    if (!Array.isArray(r.viewings) || r.viewings.length > 500) return 'viewings は配列（500件まで）です。';
    for (const v of r.viewings) { const e = viewingError(v); if (e) return e; }
    if (new Set(r.viewings.map(v => v.id)).size !== r.viewings.length) return '鑑賞記録のIDが重複しています。';
  }
  return '';
}
export const extrasValid = r => !extrasError(r);
// Viewings sorted oldest → newest (undated first). The record's date/method/service
// mirror the newest viewing so existing sorting and display keep working.
export function syncLatestViewing(r) {
  if (!Array.isArray(r.viewings) || !r.viewings.length) return r;
  const viewings = r.viewings.map((v, i) => [v, i]).sort((a, b) => (a[0].date || '').localeCompare(b[0].date || '') || a[1] - b[1]).map(x => x[0]);
  const latest = viewings.at(-1);
  return { ...r, viewings, date: latest.date || r.date, method: latest.method, service: latest.service };
}
export function addViewing(r, v) {
  const seed = Array.isArray(r.viewings) ? r.viewings : (r.status === 'watched' ? [{ id: 'v0', date: r.date || '', method: r.method || '', service: r.service || '', rating: r.rating || 0, note: '' }] : []);
  const next = syncLatestViewing({ ...r, status: 'watched', viewings: [...seed, v] });
  if (v.rating > 0) next.rating = v.rating;
  return next;
}
export const viewCount = r => Array.isArray(r.viewings) && r.viewings.length ? r.viewings.length : (r.status === 'watched' ? 1 : 0);

// ---- Lists ----
export function listError(l) {
  if (!l || typeof l !== 'object') return 'リストの形式が正しくありません。';
  if (typeof l.name !== 'string' || !l.name.trim() || l.name.length > 100) return 'リスト名（100文字以内）を入力してください。';
  if (typeof l.description !== 'string' || l.description.length > 2000) return '説明は2000文字以内です。';
  if (!Array.isArray(l.items) || l.items.length > 500) return '作品は500件までです。';
  for (const it of l.items) if (!it || typeof it.recordId !== 'string' || !it.recordId || it.recordId.length > 200 || typeof it.title !== 'string' || it.title.length > 1000 || typeof it.note !== 'string' || it.note.length > 1000) return 'リストの作品の形式が正しくありません。';
  if (new Set(l.items.map(i => i.recordId)).size !== l.items.length) return '同じ作品が重複しています。';
  return '';
}
function ftList(input, previous) {
  const now = Date.now();
  return {
    id: previous?.id || crypto.randomUUID(), name: typeof input.name === 'string' ? input.name.trim() : previous?.name,
    description: typeof input.description === 'string' ? input.description.trim() : (previous?.description ?? ''),
    items: Array.isArray(input.items) ? input.items.map(i => typeof i === 'string' ? { recordId: i, title: '', note: '' } : { recordId: i?.recordId, title: typeof i?.title === 'string' ? i.title : '', note: typeof i?.note === 'string' ? i.note : '' }) : (previous?.items ?? []),
    created: previous?.created || now, updated: now
  };
}
// Fill item titles from the shelf (titles are a snapshot so a list survives a deleted record).
async function ftFillTitles(env, list, requireExisting) {
  if (!list.items.length) return '';
  const ids = list.items.map(i => i.recordId);
  const rows = (await env.DB.prepare("SELECT id, json_extract(body,'$.title') AS title FROM films WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids)).all()).results;
  const titles = new Map(rows.map(r => [r.id, r.title]));
  for (const it of list.items) {
    if (titles.has(it.recordId)) it.title = titles.get(it.recordId);
    else if (requireExisting) return '棚にない記録IDです: ' + it.recordId;
  }
  return '';
}
export async function listsList(env) {
  const { results } = await env.DB.prepare('SELECT body, revision FROM lists').all();
  return results.map(r => ({ ...JSON.parse(r.body), _revision: r.revision })).sort((a, b) => b.updated - a.updated);
}
export async function listGet(env, id) {
  const row = await env.DB.prepare('SELECT body, revision FROM lists WHERE id = ?').bind(id).first();
  return row ? { ...JSON.parse(row.body), _revision: row.revision } : null;
}
// Shared by the UI (cookie) and the bot API. Returns [status, data].
export async function listCreate(env, input, { requireExisting = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [400, { error: 'JSON の本文が必要です。' }];
  const list = ftList({ description: '', ...input });
  const e = listError(list) || await ftFillTitles(env, list, requireExisting);
  if (e) return [400, { error: e }];
  const count = await env.DB.prepare('SELECT count(*) AS c FROM lists').first();
  if (count.c >= 200) return [400, { error: 'リストは200個までです。' }];
  await env.DB.prepare('INSERT INTO lists (id, body, revision) VALUES (?, ?, 1)').bind(list.id, JSON.stringify(list)).run();
  return [201, { list: { ...list, _revision: 1 } }];
}
export async function listUpdate(env, id, input, { requireExisting = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [400, { error: 'JSON の本文が必要です。' }];
  if (!Number.isInteger(input._revision) || input._revision < 1) return [409, { error: '_revision を指定してください。' }];
  const current = await listGet(env, id);
  if (!current) return [404, { error: 'リストが見つかりません。' }];
  if (current._revision !== input._revision) return [409, { error: '別の端末で更新されています。最新のリストを取得し直してください。', list: current }];
  const { _revision, ...prev } = current;
  const list = ftList(input, prev);
  const e = listError(list) || await ftFillTitles(env, list, requireExisting);
  if (e) return [400, { error: e }];
  const r = await env.DB.prepare('UPDATE lists SET body = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind(JSON.stringify(list), id, input._revision).run();
  if (r.meta.changes !== 1) return [409, { error: '別の端末で更新されています。最新のリストを取得し直してください。' }];
  return [200, { list: { ...list, _revision: input._revision + 1 } }];
}

// ---- Notices (want list: JP streaming availability + JP release dates) ----
const NOTICE_BATCH = 10;
const ftTokyoDate = (offsetDays = 0) => new Date(Date.now() + 9 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);
const ftNames = (p, keys) => new Set(keys.flatMap(k => Array.isArray(p?.[k]) ? p[k] : []));
const STREAM_KINDS = [['flatrate', '見放題'], ['free', '無料'], ['ads', '広告付き無料']];
function ftParse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
// Pure: compares the previous provider snapshot with the fresh TMDB data and returns new notices.
export function noticesFor(row, prevProviders, fresh, now = Date.now()) {
  const out = [], base = { recordId: row.id, title: row.title, tmdbId: row.tid, mediaType: row.media, poster: typeof row.poster === 'string' ? row.poster : '' };
  const providers = fresh.providers;
  if (prevProviders && providers) {
    const before = ftNames(prevProviders, ['flatrate', 'free', 'ads']);
    for (const [k, label] of STREAM_KINDS) for (const name of providers[k] || []) {
      if (before.has(name)) continue;
      before.add(name);
      out.push({ id: `stream:${row.id}:${name}`, kind: 'stream', ...base, provider: name, monetization: k, message: `「${row.title}」が${name}で${label}配信されています。` });
    }
    const anyBefore = ftNames(prevProviders, ['flatrate', 'free', 'ads', 'rent', 'buy']).size;
    const paid = [...ftNames(providers, ['rent', 'buy'])];
    if (!anyBefore && paid.length && !ftNames(providers, ['flatrate', 'free', 'ads']).size) out.push({ id: `digital:${row.id}`, kind: 'digital', ...base, provider: paid[0], message: `「${row.title}」がレンタル・購入で配信開始されました（${paid.slice(0, 3).join('、')}）。` });
  }
  const date = fresh.releaseDate;
  if (date) {
    const today = ftTokyoDate(0), label = row.media === 'tv' ? '放送開始' : '日本公開';
    if (date > today && date <= ftTokyoDate(14)) out.push({ id: `release-soon:${row.id}:${date}`, kind: 'release-soon', ...base, date, message: `「${row.title}」の${label}日が近づいています（${date.replaceAll('-', '/')}）。` });
    else if (date <= today && date >= ftTokyoDate(-7)) out.push({ id: `release:${row.id}:${date}`, kind: 'release', ...base, date, message: `「${row.title}」が${label}日を迎えました（${date.replaceAll('-', '/')}）。` });
  }
  return out.map(n => ({ ...n, created: now }));
}
function ftFresh(data, media) {
  const jp = data['watch/providers']?.results?.JP;
  const providers = {};
  for (const k of ['flatrate', 'rent', 'buy', 'free', 'ads']) providers[k] = [...new Set((jp?.[k] || []).map(p => typeof p.provider_name === 'string' ? p.provider_name : '').filter(Boolean))];
  let releaseDate = '';
  if (media === 'tv') releaseDate = /^\d{4}-\d{2}-\d{2}/.test(data.first_air_date || '') ? data.first_air_date.slice(0, 10) : '';
  else {
    const dates = ((data.release_dates?.results || []).find(r => r.iso_3166_1 === 'JP')?.release_dates || []).filter(r => [2, 3].includes(r.type)).map(r => String(r.release_date || '').slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    // Prefer the next upcoming JP theatrical date (re-releases), else the first one.
    const today = ftTokyoDate(-7);
    releaseDate = dates.find(d => d >= today) || dates[0] || '';
  }
  return { providers: data['watch/providers'] ? providers : null, releaseDate };
}
export async function runNoticeCheck(env, limit = NOTICE_BATCH) {
  if (!env.DB || !env.TMDB_CONFIG_KEY) return { checked: 0, created: 0, skipped: 'unconfigured' };
  const key = await storedKey(env);
  if (!key) return { checked: 0, created: 0, skipped: 'unconfigured' };
  const { results } = await env.DB.prepare("SELECT f.id, json_extract(f.body,'$.title') AS title, json_extract(f.body,'$.movie.id') AS tid, coalesce(json_extract(f.body,'$.movie.mediaType'),'movie') AS media, json_extract(f.body,'$.movie.poster') AS poster, json_extract(f.body,'$.movie.providers') AS prov, c.body AS cbody FROM films f LEFT JOIN watch_checks c ON c.record_id = f.id WHERE json_extract(f.body,'$.status') = 'want' AND json_extract(f.body,'$.movie.id') IS NOT NULL ORDER BY coalesce(c.checked_at, 0), f.id LIMIT ?").bind(limit).all();
  const now = Date.now(), statements = [], noticeIdx = [];
  const outcomes = await Promise.all(results.map(async row => {
    if (!Number.isInteger(row.tid) || !['movie', 'tv'].includes(row.media)) return null;
    try {
      const res = await upstream(row.media + '/' + row.tid, key, [['append_to_response', row.media === 'tv' ? 'watch/providers' : 'release_dates,watch/providers']]);
      if (res.status === 429) return null; // try again next run
      if (!res.ok) return { row, fresh: null, status: res.status };
      return { row, fresh: ftFresh(await res.json(), row.media) };
    } catch { return null; }
  }));
  for (const o of outcomes) {
    if (!o) continue;
    const prevCheck = ftParse(o.row.cbody);
    const prev = prevCheck ? prevCheck.providers : ftParse(o.row.prov);
    const snapshot = o.fresh ? { providers: o.fresh.providers || prev || null, releaseDate: o.fresh.releaseDate } : { providers: prev || null, releaseDate: prevCheck?.releaseDate || '', error: o.status };
    if (o.fresh) for (const n of noticesFor(o.row, prev, o.fresh, now)) { noticeIdx.push(statements.length); statements.push(env.DB.prepare('INSERT OR IGNORE INTO notices (id, body, created, read) VALUES (?, ?, ?, 0)').bind(n.id, JSON.stringify(n), now)); }
    statements.push(env.DB.prepare('INSERT INTO watch_checks (record_id, body, checked_at) VALUES (?, ?, ?) ON CONFLICT(record_id) DO UPDATE SET body = excluded.body, checked_at = excluded.checked_at').bind(o.row.id, JSON.stringify(snapshot), now));
  }
  let created = 0;
  if (statements.length) { const r = await env.DB.batch(statements); created = noticeIdx.reduce((n, i) => n + (r[i]?.meta?.changes || 0), 0); }
  return { checked: outcomes.filter(Boolean).length, created };
}
const NOTICE_LABELS = { stream: '配信開始', digital: 'レンタル・購入開始', 'release-soon': 'もうすぐ公開', release: '公開日' };
export async function noticesList(env, { unreadOnly = false, limit = 100, since = 0, origin = '' } = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 100)), after = Number.isFinite(Number(since)) ? Number(since) : 0;
  const { results } = await env.DB.prepare(`SELECT id, body, created, read FROM notices WHERE created > ? ${unreadOnly ? 'AND read = 0 ' : ''}ORDER BY created DESC, id LIMIT ?`).bind(after, lim).all();
  const unread = (await env.DB.prepare('SELECT count(*) AS c FROM notices WHERE read = 0').first()).c;
  const progress = await env.DB.prepare("SELECT (SELECT count(*) FROM films WHERE json_extract(body,'$.status') = 'want' AND json_extract(body,'$.movie.id') IS NOT NULL) AS watching, (SELECT count(*) FROM watch_checks w JOIN films f ON f.id = w.record_id WHERE json_extract(f.body,'$.status') = 'want') AS checked, (SELECT max(checked_at) FROM watch_checks) AS lastChecked").first();
  const now = Date.now();
  return { now, unread, progress, notices: results.map(r => { const n = JSON.parse(r.body), media = n.mediaType === 'tv' ? 'tv' : 'movie'; return { ...n, id: r.id, created: r.created, read: !!r.read, kindLabel: NOTICE_LABELS[n.kind] || 'お知らせ', tmdbUrl: Number.isInteger(n.tmdbId) ? `https://www.themoviedb.org/${media}/${n.tmdbId}` : '', watchUrl: Number.isInteger(n.tmdbId) ? `https://www.themoviedb.org/${media}/${n.tmdbId}/watch?locale=JP` : '', appUrl: origin ? origin + '/' : '' }; }) };
}
export async function noticesMarkRead(env, input) {
  if (input?.all === true) { const r = await env.DB.prepare('UPDATE notices SET read = 1 WHERE read = 0').run(); return [200, { marked: r.meta.changes }]; }
  if (!Array.isArray(input?.ids) || !input.ids.length || input.ids.length > 500 || input.ids.some(i => typeof i !== 'string' || i.length > 400)) return [400, { error: 'ids（配列）か all: true を指定してください。' }];
  const r = await env.DB.prepare('UPDATE notices SET read = 1 WHERE read = 0 AND id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(input.ids)).run();
  return [200, { marked: r.meta.changes }];
}

// ---- Cookie (UI) routes: /api/lists*, /api/notices* ----
export async function featureApi(request, env, url) {
  const path = url.pathname, method = request.method;
  const body = async () => request.json().catch(() => null);
  const send = ([status, data]) => json(data, status);
  if (path === '/api/lists') {
    if (method === 'GET') return json({ lists: await listsList(env) });
    if (method === 'POST') return send(await listCreate(env, await body()));
    return json({ error: 'この操作は利用できません。' }, 405);
  }
  const m = /^\/api\/lists\/([^/]+)$/.exec(path);
  if (m) {
    let id; try { id = decodeURIComponent(m[1]); } catch { return json({ error: 'IDが不正です。' }, 400); }
    if (method === 'GET') { const l = await listGet(env, id); return l ? json({ list: l }) : json({ error: 'リストが見つかりません。' }, 404); }
    if (method === 'PUT') return send(await listUpdate(env, id, await body()));
    if (method === 'DELETE') {
      const data = await body();
      if (!Number.isInteger(data?._revision)) return json({ error: '_revision を指定してください。' }, 409);
      const ok = await softDelete(env, 'list', id, data._revision);
      return ok ? json({ saved: true }) : json({ error: '別の端末で更新されています。開き直してください。' }, 409);
    }
    return json({ error: 'この操作は利用できません。' }, 405);
  }
  if (path === '/api/notices' && method === 'GET') return json(await noticesList(env, { unreadOnly: url.searchParams.get('unread') === '1', limit: url.searchParams.get('limit'), since: url.searchParams.get('since') || 0, origin: url.origin }));
  if (path === '/api/notices/read' && method === 'POST') return send(await noticesMarkRead(env, await body()));
  if (path === '/api/notices/check' && method === 'POST') {
    const last = (await env.DB.prepare('SELECT max(checked_at) AS t FROM watch_checks').first())?.t || 0;
    if (Date.now() - last < 20000) return json({ error: '少し時間をおいてからもう一度お試しください。' }, 429);
    return json(await runNoticeCheck(env));
  }
  return json({ error: '見つかりません。' }, 404);
}
