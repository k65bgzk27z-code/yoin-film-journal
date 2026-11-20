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

test('records accept optional method / spoiler / viewings; invalid extras rejected; old records untouched', async () => {
  const env = await makeEnv(), c = await cookie(env);
  await seed(env, [rec('a', { status: 'watched', rating: 3 })]);
  let r = await call(env, '/api/records/a', { method: 'PUT', headers: c, body: { ...rec('a', { status: 'watched', rating: 3 }), method: 'streaming', service: 'Netflix', spoiler: true, viewings: [{ id: 'v1', date: '2026-01-01', method: 'theater', service: '', rating: 3, note: '' }], _revision: 1 } });
  assert.equal(r.status, 200);
  for (const bad of [{ method: 'vhs' }, { spoiler: 'yes' }, { viewings: [{ id: 'v', date: '1/1' }] }, { viewings: 'x' }]) {
    r = await call(env, '/api/records/a', { method: 'PUT', headers: c, body: { ...rec('a', { status: 'watched' }), ...bad, _revision: 2 } });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  r = await call(env, '/api/import', { method: 'POST', headers: c, body: { records: [rec('legacy')] } });
  assert.deepEqual(await r.json(), { added: 1 });
});

test('bot: add viewing (re-watch) keeps main record sensible', async () => {
  const env = await makeEnv();
  await seed(env, [rec('w', { status: 'watched', rating: 4, date: '2020-05-01' })]);
  let r = await call(env, '/api/bot/records/w/viewings', { method: 'POST', headers: bearer, body: { _revision: 1, date: '2026-11-20', method: 'streaming', service: ' U-NEXT ', rating: 4.5, note: '2回目' } });
  assert.equal(r.status, 201);
  let d = await r.json();
  assert.equal(d.viewCount, 2);
  assert.equal(d.record.viewings[0].id, 'v0'); assert.equal(d.record.viewings[0].date, '2020-05-01'); assert.equal(d.record.viewings[0].rating, 4);
  assert.equal(d.record.date, '2026-11-20'); assert.equal(d.record.method, 'streaming'); assert.equal(d.record.service, 'U-NEXT'); assert.equal(d.record.rating, 4.5);
  // an older viewing without rating does not move the latest date or the rating
  r = await call(env, '/api/bot/records/w/viewings', { method: 'POST', headers: bearer, body: { _revision: 2, date: '2022-01-01', method: 'tv' } });
  d = await r.json();
  assert.equal(d.viewCount, 3); assert.equal(d.record.date, '2026-11-20'); assert.equal(d.record.rating, 4.5); assert.equal(d.record.viewings[1].date, '2022-01-01');
  assert.equal((await call(env, '/api/bot/records/w/viewings', { method: 'POST', headers: bearer, body: { _revision: 1, date: '2026-11-21' } })).status, 409);
  assert.equal((await call(env, '/api/bot/records/w/viewings', { method: 'POST', headers: bearer, body: { _revision: 3, method: 'vhs' } })).status, 400);
  // want → watched via viewing
  await seed(env, [rec('x')]);
  d = await (await call(env, '/api/bot/records/x/viewings', { method: 'POST', headers: bearer, body: { _revision: 1, date: '2026-11-21', method: 'theater' } })).json();
  assert.equal(d.record.status, 'watched'); assert.equal(d.viewCount, 1);
  // patch new fields
  r = await call(env, '/api/bot/records/x', { method: 'PATCH', headers: bearer, body: { _revision: 2, spoiler: true, review: 'ネタバレ' } });
  assert.equal((await r.json()).record.spoiler, true);
  assert.equal((await call(env, '/api/bot/records/x', { method: 'PATCH', headers: bearer, body: { _revision: 3, method: 'bad' } })).status, 400);
  // create with method
  r = await call(env, '/api/bot/records', { method: 'POST', headers: bearer, body: { title: '手入力', status: 'watched', method: 'disc', spoiler: false } });
  assert.equal((await r.json()).record.method, 'disc');
});

test('lists: UI CRUD, bot read/write, validation', async () => {
  const env = await makeEnv(), c = await cookie(env);
  await seed(env, [rec('a', { status: 'watched', rating: 5 }), rec('b')]);
  assert.equal((await call(env, '/api/lists', { method: 'POST', headers: { Cookie: c.Cookie }, body: { name: 'x' } })).status, 403, 'origin check');
  let r = await call(env, '/api/lists', { method: 'POST', headers: c, body: { name: ' ベスト10 ', items: [{ recordId: 'a' }] } });
  assert.equal(r.status, 201);
  let l = (await r.json()).list;
  assert.equal(l.name, 'ベスト10'); assert.equal(l.items[0].title, 'タイトルa');
  r = await call(env, '/api/lists/' + l.id, { method: 'PUT', headers: c, body: { _revision: 1, items: [{ recordId: 'b' }, { recordId: 'a' }] } });
  l = (await r.json()).list;
  assert.deepEqual(l.items.map(i => i.recordId), ['b', 'a']); assert.equal(l.name, 'ベスト10');
  assert.equal((await call(env, '/api/lists/' + l.id, { method: 'PUT', headers: c, body: { _revision: 1, name: 'x' } })).status, 409);
  assert.equal((await call(env, '/api/lists/' + l.id, { method: 'PUT', headers: c, body: { _revision: 2, items: [{ recordId: 'a' }, { recordId: 'a' }] } })).status, 400);
  // bot
  let d = await (await call(env, '/api/bot/lists', { headers: bearer })).json();
  assert.equal(d.lists[0].itemCount, 2);
  d = await (await call(env, '/api/bot/lists/' + l.id, { headers: bearer })).json();
  assert.equal(d.list.items[1].rank, 2); assert.equal(d.list.items[1].record.rating, 5);
  assert.equal((await call(env, '/api/bot/lists', { method: 'POST', headers: bearer, body: { name: 'n', items: ['nope'] } })).status, 400, 'unknown record id');
  r = await call(env, '/api/bot/lists', { method: 'POST', headers: bearer, body: { name: '2026年', description: '今年', items: ['a'] } });
  assert.equal(r.status, 201);
  const l2 = (await r.json()).list;
  r = await call(env, '/api/bot/lists/' + l2.id, { method: 'PATCH', headers: bearer, body: { _revision: 1, items: ['b', 'a'] } });
  assert.deepEqual((await r.json()).list.items.map(i => i.recordId), ['b', 'a']);
  assert.equal((await call(env, '/api/bot/lists/' + l2.id, { method: 'PATCH', headers: bearer, body: { _revision: 2, id: 'z' } })).status, 400);
  assert.equal((await call(env, '/api/bot/lists/' + l2.id, { method: 'DELETE', headers: bearer, body: { _revision: 2 } })).status, 405, 'bot cannot delete');
  assert.equal((await call(env, '/api/lists/' + l.id, { method: 'DELETE', headers: c, body: { _revision: 2 } })).status, 200);
  assert.equal((await (await call(env, '/api/lists', { headers: c })).json()).lists.length, 1);
});

test('notices: baseline from stored providers, stream + release notices, dedupe, cron, bot', async () => {
  const env = await makeEnv(), c = await cookie(env);
  await seed(env, [rec('n', { movie: movie(100, { rent: ['Apple TV'] }) }), rec('o', { movie: movie(200, null) }), rec('watched', { status: 'watched', movie: movie(100, {}) })]);
  const before = env.DB.raw.prepare('SELECT id, body, revision FROM films ORDER BY id').all();
  let r = await call(env, '/api/notices/check', { method: 'POST', headers: c, body: {} });
  let d = await r.json();
  assert.equal(d.checked, 2, 'only want titles linked to TMDB');
  assert.equal(d.created, 2);
  d = await (await call(env, '/api/notices', { headers: c })).json();
  assert.equal(d.unread, 2);
  assert.deepEqual(d.notices.map(n => n.kind).sort(), ['release-soon', 'stream']);
  assert.equal(d.notices.find(n => n.kind === 'stream').provider, 'Netflix');
  assert.equal(d.progress.watching, 2); assert.equal(d.progress.checked, 2);
  assert.deepEqual(env.DB.raw.prepare('SELECT id, body, revision FROM films ORDER BY id').all(), before, 'records never rewritten');
  // second run: no duplicates; rate limit on manual check
  assert.equal((await call(env, '/api/notices/check', { method: 'POST', headers: c, body: {} })).status, 429);
  env.DB.raw.prepare('UPDATE watch_checks SET checked_at = 0').run();
  jpProviders = { flatrate: [{ provider_name: 'Netflix' }, { provider_name: 'Prime Video' }] };
  jpDate = tokyo(0);
  const ctx = { waits: [], waitUntil(p) { this.waits.push(p); } };
  await worker.scheduled({}, env, ctx); await Promise.all(ctx.waits);
  d = await (await call(env, '/api/bot/notices?unread=1', { headers: bearer })).json();
  assert.equal(d.unread, 4);
  assert.deepEqual(d.notices.map(n => n.kind).sort(), ['release', 'release-soon', 'stream', 'stream']);
  assert.equal((await call(env, '/api/bot/notices', { headers: c })).status, 401, 'bot route needs bearer');
  r = await call(env, '/api/bot/notices/read', { method: 'POST', headers: bearer, body: { ids: [d.notices[0].id] } });
  assert.deepEqual(await r.json(), { marked: 1 });
  r = await call(env, '/api/notices/read', { method: 'POST', headers: c, body: { all: true } });
  assert.deepEqual(await r.json(), { marked: 3 });
  assert.equal((await (await call(env, '/api/notices', { headers: c })).json()).unread, 0);
  // no TMDB key: cron is a no-op
  const env2 = { ...env, TMDB_CONFIG_KEY: undefined };
  const ctx2 = { waits: [], waitUntil(p) { this.waits.push(p); } };
  await worker.scheduled({}, env2, ctx2); await Promise.all(ctx2.waits);
});

test('tmdb proxy allows person lookups only for logged-in owner', async () => {
  const env = await makeEnv(), c = await cookie(env);
  assert.equal((await call(env, '/api/tmdb/person/7?append_to_response=combined_credits', { headers: c })).status, 200);
  assert.equal((await call(env, '/api/tmdb/person/7')).status, 401);
  assert.equal((await call(env, '/api/tmdb/person/abc', { headers: c })).status, 404);
});
