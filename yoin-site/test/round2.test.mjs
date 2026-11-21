// Run: node build.mjs && node --test test/   (node:sqlite as a D1 stand-in, mocked TMDB)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const worker = (await import(new URL('../dist/server/index.js', import.meta.url))).default;
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; }
  });
  return { prepare: sql => stmt(sql), batch: async list => { const out = []; for (const s of list) out.push(await s.run()); return out; }, raw: db };
}
const TOKEN = 'test-bot-token-0123456789abcdef0123456789', ORIGIN = 'https://yoin.test';
async function makeEnv() {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const env = { DB: d1(), AUTH_SECRET: 'dummy-secret', AUTH_PASSPHRASE: 'dummy-pass', BOT_API_TOKEN: TOKEN, TMDB_CONFIG_KEY: Buffer.from(keyBytes).toString('base64') };
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('0123456789abcdef0123456789abcdef')));
  env.DB.raw.prepare("INSERT INTO app_settings(name,body) VALUES('tmdb',?)").run(JSON.stringify({ iv: [...iv], data: [...data] }));
  return env;
}
const tokyo = d => new Date(Date.now() + 9 * 3600000 + d * 86400000).toISOString().slice(0, 10);
let jpProviders = { flatrate: [{ provider_name: 'Netflix' }] };
let jpDate = tokyo(5);
const tmdbCalls = [];
globalThis.fetch = async input => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  tmdbCalls.push(url.pathname);
  const p = url.pathname.replace('/3/', '');
  const ok = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  if (p === 'movie/100') return ok({ id: 100, title: '新作', release_dates: { results: [{ iso_3166_1: 'JP', release_dates: [{ type: 3, release_date: jpDate + 'T00:00:00.000Z' }] }] }, 'watch/providers': { results: { JP: jpProviders } } });
  if (p === 'movie/200') return ok({ id: 200, title: '旧作', release_dates: { results: [] }, 'watch/providers': { results: {} } });
  if (p === 'movie/300') return ok({ id: 300, title: '紐づけ先', original_title: 'Link', release_date: '1999-01-01', genres: [], credits: { crew: [], cast: [] }, release_dates: { results: [] } });
  if (p === 'movie/300/watch/providers') return ok({ results: {} });
  if (p === 'person/7') return ok({ id: 7, name: '監督A', combined_credits: { crew: [], cast: [] } });
  return new Response('{}', { status: 404 });
};
const call = (env, path, { method = 'GET', body, headers = {} } = {}) => worker.fetch(new Request(ORIGIN + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
const bearer = { Authorization: 'Bearer ' + TOKEN };
async function cookie(env) {
  const r = await worker.fetch(new Request(ORIGIN + '/login', { method: 'POST', body: new URLSearchParams({ passphrase: 'dummy-pass' }) }), env);
  return { Cookie: r.headers.get('Set-Cookie').split(';')[0], Origin: ORIGIN };
}
const movie = (id, providers) => ({ source: 'TMDB', id, mediaType: 'movie', title: 't' + id, originalTitle: '', releaseDate: '', japanTheatricalDate: '', overview: '', poster: '', checkedAt: 1, directors: ['監督A'], genres: ['ドラマ'], cast: [], providers: providers ? { flatrate: [], rent: [], buy: [], free: [], ads: [], ...providers, region: 'JP', checkedAt: 1, link: '' } : null });
const rec = (id, extra = {}) => ({ id, title: 'タイトル' + id, status: 'want', rating: 0, date: '', meta: '', review: '', updated: 1, ...extra });
async function seed(env, rows) { for (const r of rows) env.DB.raw.prepare('INSERT INTO films (id, body, revision) VALUES (?, ?, 1)').run(r.id, JSON.stringify(r)); }


test('soft delete → trash → restore; duplicate guard; purge by cron', async () => {
  const env = await makeEnv(), c = await cookie(env);
  await seed(env, [rec('a', { status: 'watched', rating: 4, movie: movie(100, {}) })]);
  let r = await call(env, '/api/records/a', { method: 'DELETE', headers: c, body: { _revision: 1 } });
  assert.deepEqual(await r.json(), { saved: true });
  assert.equal(env.DB.raw.prepare('SELECT count(*) c FROM films').get().c, 0);
  let d = await (await call(env, '/api/trash', { headers: c })).json();
  assert.equal(d.items.length, 1); assert.equal(d.items[0].title, 'タイトルa'); assert.equal(d.items[0].kind, 'record');
  assert.equal((await call(env, '/api/records/a', { method: 'DELETE', headers: c, body: { _revision: 1 } })).status, 409);
  r = await call(env, '/api/trash/restore', { method: 'POST', headers: c, body: { id: d.items[0].id } });
  assert.equal(r.status, 200);
  const back = env.DB.raw.prepare('SELECT body, revision FROM films').get();
  assert.equal(JSON.parse(back.body).rating, 4); assert.equal(back.revision, 2);
  assert.equal((await (await call(env, '/api/trash', { headers: c })).json()).items.length, 0);
  // restore blocked when the same TMDB work was re-added meanwhile
  await call(env, '/api/records/a', { method: 'DELETE', headers: c, body: { _revision: 2 } });
  await seed(env, [rec('b', { movie: movie(100, {}) })]);
  d = await (await call(env, '/api/trash', { headers: c })).json();
  assert.equal((await call(env, '/api/trash/restore', { method: 'POST', headers: c, body: { id: d.items[0].id } })).status, 409);
  // lists also go to trash
  const l = (await (await call(env, '/api/lists', { method: 'POST', headers: c, body: { name: 'L' } })).json()).list;
  assert.equal((await call(env, '/api/lists/' + l.id, { method: 'DELETE', headers: c, body: { _revision: 1 } })).status, 200);
  d = await (await call(env, '/api/trash', { headers: c })).json();
  assert.deepEqual(d.items.map(i => i.kind).sort(), ['list', 'record']);
  // bot still cannot delete or touch trash
  assert.equal((await call(env, '/api/bot/records/b', { method: 'DELETE', headers: bearer, body: { _revision: 1 } })).status, 405);
  assert.equal((await call(env, '/api/trash', { headers: bearer })).status, 401);
  // cron purges entries older than 30 days
  env.DB.raw.prepare("UPDATE trash SET deleted_at = ? WHERE kind = 'record'").run(Date.now() - 31 * 86400000);
  const ctx = { waits: [], waitUntil(p) { this.waits.push(p); } };
  await worker.scheduled({}, env, ctx); await Promise.all(ctx.waits);
  d = await (await call(env, '/api/trash', { headers: c })).json();
  assert.deepEqual(d.items.map(i => i.kind), ['list']);
});

test('backups: weekly by cron, manual, download is a valid yoin-v1 file, keep 8', async () => {
  const env = await makeEnv(), c = await cookie(env);
  await seed(env, [rec('a', { review: '改行\nと"引用"' }), rec('b')]);
  const ctx = { waits: [], waitUntil(p) { this.waits.push(p); } };
  await worker.scheduled({}, env, ctx); await Promise.all(ctx.waits);
  let d = await (await call(env, '/api/backups', { headers: c })).json();
  assert.equal(d.backups.length, 1); assert.equal(d.backups[0].kind, 'auto'); assert.equal(d.backups[0].summary.films, 2);
  ctx.waits = []; await worker.scheduled({}, env, ctx); await Promise.all(ctx.waits);
  assert.equal((await (await call(env, '/api/backups', { headers: c })).json()).backups.length, 1, 'not again within a week');
  const r = await call(env, `/api/backups/${d.backups[0].id}/download`, { headers: c });
  assert.match(r.headers.get('Content-Disposition'), /yoin-full-backup-/);
  const file = await r.json();
  assert.equal(file.format, 'yoin-v1'); assert.equal(file.records.length, 2); assert.equal(file.records.find(x => x.id === 'a').review, '改行\nと"引用"');
  assert.equal(file.tables.films[0].revision, 1); assert.ok(Array.isArray(file.tables.trash));
  assert.equal((await call(env, `/api/backups/${d.backups[0].id}/download`)).status, 401);
  assert.equal((await call(env, '/api/backups', { method: 'POST', headers: c, body: {} })).status, 201);
  assert.equal((await call(env, '/api/backups', { method: 'POST', headers: c, body: {} })).status, 429);
  // chunking + keep 8
  env.DB.raw.prepare("UPDATE films SET body = json_set(body, '$.review', ?) WHERE id = ?").run('長'.repeat(600000), 'b');
  for (let i = 0; i < 9; i++) { ctx.waits = []; env.DB.raw.prepare('UPDATE backups SET created = created - ?').run(8 * 86400000); await worker.scheduled({}, env, ctx); await Promise.all(ctx.waits); }
  d = await (await call(env, '/api/backups', { headers: c })).json();
  assert.equal(d.backups.length, 8);
  assert.ok(d.backups[0].chunks >= 3);
  assert.equal(env.DB.raw.prepare('SELECT count(DISTINCT backup_id) c FROM backup_chunks').get().c, 8);
  const big = await (await call(env, `/api/backups/${d.backups[0].id}/download`, { headers: c })).json();
  assert.equal(big.records.find(x => x.id === 'b').review.length, 600000);
});

test('notices: since filter and links for the chat digest', async () => {
  const env = await makeEnv(), c = await cookie(env);
  await seed(env, [rec('n', { movie: movie(100, { rent: ['Apple TV'] }) })]);
  await call(env, '/api/notices/check', { method: 'POST', headers: c, body: {} });
  let d = await (await call(env, '/api/bot/notices', { headers: bearer })).json();
  assert.ok(d.notices.length >= 1); assert.ok(Number.isFinite(d.now));
  const n = d.notices[0];
  assert.equal(n.watchUrl, 'https://www.themoviedb.org/movie/100/watch?locale=JP'); assert.equal(n.tmdbUrl, 'https://www.themoviedb.org/movie/100');
  assert.equal(n.appUrl, ORIGIN + '/'); assert.ok(n.kindLabel); assert.ok(n.title);
  d = await (await call(env, '/api/bot/notices?since=' + d.now, { headers: bearer })).json();
  assert.equal(d.notices.length, 0);
});

test('bot link + partial dates + enrichment safety check ignores date fill', async () => {
  const env = await makeEnv(), c = await cookie(env);
  const original = rec('r', { status: 'watched', rating: 3.5, review: '感想', meta: '1999年製作の映画', enrichment: { status: 'review', reason: '同名作品の候補が複数', checkedAt: 1, candidates: [] } });
  await seed(env, [original, rec('x', { movie: movie(200, null) })]);
  let r = await call(env, '/api/bot/records/r/link', { method: 'POST', headers: bearer, body: { _revision: 1, tmdbId: 300 } });
  assert.equal(r.status, 200);
  let rec2 = (await r.json()).record;
  assert.equal(rec2.movie.id, 300); assert.equal(rec2.enrichment.status, 'linked'); assert.equal(rec2.enrichment.previous.status, 'review');
  assert.equal(rec2.title, 'タイトルr'); assert.equal(rec2.rating, 3.5); assert.equal(rec2.review, '感想');
  assert.equal(JSON.parse(env.DB.raw.prepare("SELECT body FROM enrichment_snapshots WHERE id='r'").get().body).enrichment.status, 'review');
  assert.equal((await call(env, '/api/bot/records/r/link', { method: 'POST', headers: bearer, body: { _revision: 1, tmdbId: 300 } })).status, 409);
  assert.equal((await call(env, '/api/bot/records/r/link', { method: 'POST', headers: bearer, body: { _revision: 2, tmdbId: 200 } })).status, 409, 'linked elsewhere');
  assert.equal((await call(env, '/api/bot/records/r/link', { method: 'POST', headers: bearer, body: { _revision: 2, tmdbId: 5555 } })).status, 404);
  // partial dates
  for (const date of ['2020', '2020-05', '2020-05-31']) assert.equal((await call(env, '/api/bot/records/r', { method: 'PATCH', headers: bearer, body: { _revision: (await (await call(env, '/api/bot/records/r', { headers: bearer })).json()).record._revision, date } })).status, 200, date);
  for (const date of ['20', '2020-13', '2020-5', '2020/05']) assert.equal((await call(env, '/api/bot/records/r', { method: 'PATCH', headers: bearer, body: { _revision: 99, date } })).status, 400, date);
  // a data fill of date (no updated change) does not trip the enrichment safety check
  env.DB.raw.prepare("UPDATE films SET body = json_set(body, '$.date', '2018-01-01') WHERE id = 'x'").run();
  env.DB.raw.prepare("INSERT INTO enrichment_snapshots (id, body, revision) VALUES ('x', ?, 1)").run(JSON.stringify(rec('x')));
  let s = await (await call(env, '/api/enrich', { headers: c })).json();
  assert.equal(s.protectedMismatch, 0);
  env.DB.raw.prepare("UPDATE films SET body = json_set(body, '$.rating', 5) WHERE id = 'x'").run();
  s = await (await call(env, '/api/enrich', { headers: c })).json();
  assert.equal(s.protectedMismatch, 1, 'still catches untracked rating changes');
});
