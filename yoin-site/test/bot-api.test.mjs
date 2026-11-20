// Run: node build.mjs && node --test test/bot-api.test.mjs   (Node 22.5+; uses node:sqlite as a D1 stand-in and a mocked TMDB)
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
  return { prepare: sql => stmt(sql), batch: async list => Promise.all(list.map(s => s.run())), raw: db };
}
const TOKEN = 'test-bot-token-0123456789abcdef0123456789';
const ORIGIN = 'https://yoin.test';
async function makeEnv() {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const env = { DB: d1(), AUTH_SECRET: 'dummy-secret', AUTH_PASSPHRASE: 'dummy-pass', BOT_API_TOKEN: TOKEN, TMDB_CONFIG_KEY: Buffer.from(keyBytes).toString('base64') };
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('0123456789abcdef0123456789abcdef')));
  env.DB.raw.prepare("INSERT INTO app_settings(name,body) VALUES('tmdb',?)").run(JSON.stringify({ iv: [...iv], data: [...data] }));
  return env;
}
// Mock TMDB
const tmdbCalls = [];
globalThis.fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  tmdbCalls.push(url);
  assert.equal(url.host, 'api.themoviedb.org');
  assert.equal(url.searchParams.get('language'), 'ja-JP');
  const p = url.pathname.replace('/3/', '');
  const ok = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  if (p === 'search/movie') return ok({ results: [{ id: 129, title: '千と千尋の神隠し', original_title: '千と千尋の神隠し', release_date: '2001-07-20', overview: 'x'.repeat(400), poster_path: '/a.jpg', popularity: 50 }] });
  if (p === 'search/tv') return ok({ results: [{ id: 999, name: '千尋TV', original_name: 'Chihiro', first_air_date: '2020-01-01', popularity: 80 }] });
  if (p === 'movie/129') return ok({ id: 129, title: '千と千尋の神隠し', original_title: '千と千尋の神隠し', release_date: '2001-07-20', runtime: 125, poster_path: '/a.jpg', overview: 'あらすじ', genres: [{ name: 'アニメーション' }], credits: { crew: [{ job: 'Director', name: '宮崎駿' }], cast: [{ name: '柊瑠美', character: '千尋' }] }, release_dates: { results: [{ iso_3166_1: 'JP', release_dates: [{ type: 3, release_date: '2001-07-20T00:00:00.000Z' }] }] } });
  if (p === 'movie/129/watch/providers') return ok({ results: { JP: { link: 'https://www.themoviedb.org/movie/129-x/watch?locale=JP', flatrate: [{ provider_name: 'Netflix' }], rent: [] } } });
  if (p === 'tv/999') return ok({ id: 999, name: '千尋TV', original_name: 'Chihiro', first_air_date: '2020-01-01', number_of_seasons: 2, number_of_episodes: 24, episode_run_time: [24], created_by: [{ name: '某' }], genres: [{ name: 'ドラマ' }], credits: { cast: [] } });
  if (p === 'tv/999/watch/providers') return new Response('{}', { status: 500 });
  return new Response('{}', { status: 404 });
};
const call = (env, path, { method = 'GET', body, headers = {} } = {}) => worker.fetch(new Request(ORIGIN + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
const bearer = { Authorization: 'Bearer ' + TOKEN };
async function cookie(env) {
  const r = await worker.fetch(new Request(ORIGIN + '/login', { method: 'POST', body: new URLSearchParams({ passphrase: 'dummy-pass' }) }), env);
  assert.equal(r.status, 303);
  return { Cookie: r.headers.get('Set-Cookie').split(';')[0] };
}
// Copy of validateRecords() from client/app.js, to prove bot records load in the UI.
const appJs = fs.readFileSync(new URL('../client/app.js', import.meta.url), 'utf8');
const validateRecords = new Function(appJs.slice(appJs.indexOf('function validateRecords'), appJs.indexOf('\ntry{')) + '\nreturn validateRecords;')();

test('auth boundaries', async () => {
  const env = await makeEnv();
  assert.equal((await call(env, '/api/bot/records')).status, 401);
  assert.equal((await call(env, '/api/bot/records', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await call(env, '/api/bot/records', { headers: await cookie(env) })).status, 401, 'cookie alone is not a bot token');
  assert.equal((await call(env, '/api/bot/records', { headers: { 'oai-authenticated-user-id': 'owner' } })).status, 401, 'spoofed identity header');
  assert.equal((await call(env, '/api/bot/records', { headers: bearer })).status, 200);
  // bearer must not open anything else
  for (const [path, opt] of [['/api/records', {}], ['/api/import', { method: 'POST', body: { records: [] } }], ['/api/tmdb/connection', {}], ['/api/enrich', {}], ['/', {}], ['/api/bot', {}], ['/api/bot/../records', {}]]) {
    const r = await call(env, path, { ...opt, headers: { ...bearer, Origin: ORIGIN } });
    assert.ok([401, 200].includes(r.status));
    if (path === '/') assert.match(await r.text(), /合言葉/); else assert.equal(r.status, 401, path);
  }
  // unset / too-short token
  const env2 = { ...env, BOT_API_TOKEN: undefined };
  assert.equal((await call(env2, '/api/bot/records', { headers: bearer })).status, 503);
  const env3 = { ...env, BOT_API_TOKEN: 'short' };
  assert.equal((await call(env3, '/api/bot/records', { headers: { Authorization: 'Bearer short' } })).status, 503);
  // no delete / unknown routes
  assert.equal((await call(env, '/api/bot/records/x', { method: 'DELETE', headers: bearer, body: { _revision: 1 } })).status, 405);
  assert.equal((await call(env, '/api/bot/import', { method: 'POST', headers: bearer, body: {} })).status, 404);
  assert.equal((await call(env, '/api/bot/records', { method: 'POST', headers: bearer })).status, 415);
});

test('cookie UI flow unchanged', async () => {
  const env = await makeEnv();
  const c = await cookie(env);
  assert.equal((await call(env, '/api/records')).status, 401);
  let r = await call(env, '/api/records', { headers: c });
  assert.deepEqual(await r.json(), { records: [] });
  const rec = { id: 'u1', title: 'テスト', status: 'want', rating: 0, date: '', meta: '', review: '', updated: 1 };
  assert.equal((await call(env, '/api/import', { method: 'POST', body: { records: [rec] }, headers: c })).status, 403, 'origin check kept');
  r = await call(env, '/api/import', { method: 'POST', body: { records: [rec] }, headers: { ...c, Origin: ORIGIN } });
  assert.deepEqual(await r.json(), { added: 1 });
  r = await call(env, '/api/records/u1', { method: 'PUT', body: { ...rec, rating: 4, _revision: 1 }, headers: { ...c, Origin: ORIGIN } });
  assert.deepEqual(await r.json(), { saved: true });
  r = await call(env, '/api/tmdb/connection', { headers: c });
  assert.deepEqual(await r.json(), { connected: true });
  r = await call(env, '/api/records/u1', { method: 'DELETE', body: { _revision: 2 }, headers: { ...c, Origin: ORIGIN } });
  assert.deepEqual(await r.json(), { saved: true });
});

test('search, create, duplicate, patch, conflict', async () => {
  const env = await makeEnv();
  let r = await call(env, '/api/bot/search?query=千と千尋', { headers: bearer });
  let d = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(d.results.map(x => [x.mediaType, x.tmdbId]), [['tv', 999], ['movie', 129]], 'merged by popularity');
  assert.equal(d.results[1].overview.length, 160);
  assert.equal(d.results[1].onShelf, null);
  assert.equal(tmdbCalls.find(u => u.pathname.endsWith('search/movie')).searchParams.get('region'), 'JP');

  r = await call(env, '/api/bot/records', { method: 'POST', headers: bearer, body: { tmdbId: 129, status: 'watched', rating: 4.5, date: '2026-11-20', review: '  良かった  ' } });
  assert.equal(r.status, 201);
  const created = (await r.json()).record;
  assert.equal(created.title, '千と千尋の神隠し');
  assert.equal(created.review, '良かった');
  assert.equal(created._revision, 1);
  assert.equal(created.movie.mediaType, 'movie');
  assert.deepEqual(created.movie.directors, ['宮崎駿']);
  assert.equal(created.movie.japanTheatricalDate, '2001-07-20');
  assert.deepEqual(created.movie.providers.flatrate, ['Netflix']);
  assert.equal(created.movie.providerError, false);
  assert.match(created.id, /^[0-9a-f-]{36}$/);

  r = await call(env, '/api/bot/records', { method: 'POST', headers: bearer, body: { tmdbId: 999, mediaType: 'tv', status: 'want' } });
  assert.equal(r.status, 201);
  const tv = (await r.json()).record;
  assert.equal(tv.movie.seasons, 2); assert.equal(tv.movie.providers, null); assert.equal(tv.movie.providerError, true);
  assert.equal(tv.rating, 0); assert.equal(tv.date, '');

  r = await call(env, '/api/bot/records', { method: 'POST', headers: bearer, body: { tmdbId: 129, status: 'want' } });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).record.id, created.id);

  // title-only record + duplicate title guard
  r = await call(env, '/api/bot/records', { method: 'POST', headers: bearer, body: { title: '自主映画', status: 'watched', meta: '2019年製作' } });
  assert.equal(r.status, 201);
  assert.equal((await call(env, '/api/bot/records', { method: 'POST', headers: bearer, body: { title: '自主映画', status: 'want' } })).status, 409);
  assert.equal((await call(env, '/api/bot/records', { method: 'POST', headers: bearer, body: { title: '自主映画', status: 'want', allowDuplicateTitle: true } })).status, 201);

  // validation
  for (const body of [{ status: 'seen', title: 'a' }, { status: 'want' }, { title: 'a', status: 'want', rating: 6 }, { title: 'a', status: 'want', rating: 3.33 }, { title: 'a', status: 'want', date: '11/20' }, { tmdbId: 'x', status: 'want' }, { tmdbId: 1, mediaType: 'book', status: 'want' }])
    assert.equal((await call(env, '/api/bot/records', { method: 'POST', headers: bearer, body })).status, 400, JSON.stringify(body));
  assert.equal((await call(env, '/api/bot/records', { method: 'POST', headers: bearer, body: { tmdbId: 5555, status: 'want' } })).status, 404);

  // search now shows shelf
  d = await (await call(env, '/api/bot/search?query=千と千尋', { headers: bearer })).json();
  assert.equal(d.results[1].onShelf.id, created.id); assert.equal(d.results[1].onShelf.match, 'tmdb');

  // list
  d = await (await call(env, '/api/bot/records?q=千と', { headers: bearer })).json();
  assert.equal(d.total, 1); assert.equal(d.records[0]._revision, 1);
  d = await (await call(env, '/api/bot/records?status=want', { headers: bearer })).json();
  assert.equal(d.total, 2);
  d = await (await call(env, '/api/bot/records?tmdbId=999&mediaType=tv', { headers: bearer })).json();
  assert.equal(d.records[0].id, tv.id);
  d = await (await call(env, '/api/bot/records?limit=1', { headers: bearer })).json();
  assert.equal(d.records.length, 1); assert.equal(d.total, 4);

  // patch
  const p = (id, body) => call(env, '/api/bot/records/' + encodeURIComponent(id), { method: 'PATCH', headers: bearer, body });
  r = await p(created.id, { rating: 5, review: '最高', _revision: 1 });
  assert.equal(r.status, 200);
  const upd = (await r.json()).record;
  assert.equal(upd.rating, 5); assert.equal(upd.review, '最高'); assert.equal(upd._revision, 2);
  assert.equal(upd.status, 'watched'); assert.deepEqual(upd.movie, created.movie); assert.ok(upd.updated >= created.updated);
  r = await p(created.id, { rating: 3, _revision: 1 });
  assert.equal(r.status, 409); assert.equal((await r.json()).record._revision, 2);
  assert.equal((await p(created.id, { rating: 3 })).status, 409);
  assert.equal((await p(created.id, { title: 'x', _revision: 2 })).status, 400);
  assert.equal((await p(created.id, { movie: null, _revision: 2 })).status, 400);
  assert.equal((await p(created.id, { status: 'nope', _revision: 2 })).status, 400);
  assert.equal((await p('missing', { rating: 1, _revision: 1 })).status, 404);
  r = await call(env, '/api/bot/records/' + created.id, { headers: bearer });
  assert.equal((await r.json()).record._revision, 2);

  // UI sees the same data and its validator accepts every record
  const ui = await (await call(env, '/api/records', { headers: await cookie(env) })).json();
  assert.equal(ui.records.length, 4);
  assert.doesNotThrow(() => validateRecords(ui.records));
});

test('TMDB not connected / failing errors cleanly', async () => {
  const env = await makeEnv();
  env.DB.raw.exec("DELETE FROM app_settings");
  let r = await call(env, '/api/bot/search?query=a', { headers: bearer });
  assert.equal(r.status, 503); assert.ok((await r.json()).error);
  r = await call(env, '/api/bot/records', { method: 'POST', headers: bearer, body: { tmdbId: 129, status: 'want' } });
  assert.equal(r.status, 503);
  const saved = globalThis.fetch; globalThis.fetch = async () => { throw new TypeError('network'); };
  const env2 = await makeEnv();
  r = await call(env2, '/api/bot/search?query=a', { headers: bearer });
  assert.equal(r.status, 503); assert.ok((await r.json()).error);
  globalThis.fetch = saved;
  assert.equal((await call(env, '/api/bot/search', { headers: bearer })).status, 400);
});
