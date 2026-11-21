// Scoped API for the owner's chat bot (/api/bot/*).
// Authenticated ONLY by `Authorization: Bearer <BOT_API_TOKEN>` (Worker secret).
// The token is never accepted on any other path, and this API can only search,
// list, create and partially update records — no delete, import, TMDB
// connection or enrichment. Created records use the same shape as the UI.
const BOT_FIELDS = ['status', 'rating', 'date', 'review', 'meta', 'spoiler', 'method', 'service', 'viewings'];
const botJson = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function botAuthorized(request, env) {
  const token = typeof env.BOT_API_TOKEN === 'string' ? env.BOT_API_TOKEN : '';
  if (token.length < 32) return 'unconfigured';
  const header = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(\S+)$/.exec(header);
  return m && yoinSame(m[1], token) ? 'ok' : 'denied';
}
// Same rules as client/app.js validateRecords(), so bot records never break the UI.
function botClientValid(r) {
  if (!validate(r) || Math.abs(r.rating * 10 - Math.round(r.rating * 10)) > 0.000001) return false;
  const m = r.movie;
  if (m != null) {
    if (m.source !== 'TMDB' || !Number.isInteger(m.id) || m.id < 1 || (m.mediaType != null && !['movie', 'tv'].includes(m.mediaType)) || (m.seasons != null && !Number.isInteger(m.seasons)) || (m.episodes != null && !Number.isInteger(m.episodes)) || ['title', 'originalTitle', 'releaseDate', 'japanTheatricalDate', 'overview', 'poster'].some(k => typeof m[k] !== 'string') || !Number.isFinite(m.checkedAt) || !Array.isArray(m.directors) || !Array.isArray(m.genres) || [...m.directors, ...m.genres].some(x => typeof x !== 'string')) return false;
    if (m.cast != null && (!Array.isArray(m.cast) || m.cast.some(p => !p || typeof p.name !== 'string' || typeof p.character !== 'string'))) return false;
    if (m.providers != null) {
      const p = m.providers;
      if (p.region !== 'JP' || !Number.isFinite(p.checkedAt) || typeof p.link !== 'string' || ['flatrate', 'rent', 'buy', 'free', 'ads'].some(k => !Array.isArray(p[k]) || p[k].some(x => typeof x !== 'string'))) return false;
    }
  }
  return true;
}
// Field checks for bot input. Returns an error message or ''.
function botFieldError(data) {
  if ('status' in data && !['watched', 'want'].includes(data.status)) return 'status は "watched" か "want" を指定してください。';
  if ('rating' in data && (typeof data.rating !== 'number' || !Number.isFinite(data.rating) || data.rating < 0 || data.rating > 5 || Math.abs(data.rating * 10 - Math.round(data.rating * 10)) > 0.000001)) return 'rating は 0〜5 の数値（小数第1位まで、0 は未評価）で指定してください。';
  if ('date' in data && (typeof data.date !== 'string' || (data.date !== '' && !PARTIAL_DATE.test(data.date)))) return 'date は "YYYY-MM-DD"・"YYYY-MM"（月まで）・"YYYY"（年だけ）か空文字で指定してください。';
  for (const k of ['review', 'meta']) if (k in data && (typeof data[k] !== 'string' || data[k].length > 100000)) return k + ' は文字列で指定してください。';
  return extrasError(data);
}
const botDate = v => /^\d{4}-\d{2}-\d{2}/.test(v || '') ? v.slice(0, 10) : '';
const botText = v => typeof v === 'string' ? v : '';
const botImage = p => /^\/[a-zA-Z0-9_.-]+$/.test(p || '') ? 'https://image.tmdb.org/t/p/w500' + p : '';
const botNormalize = s => String(s || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
class BotTmdbError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function botTmdb(env, key, path, params = []) {
  let result;
  try { result = await upstream(path, key, params); } catch { throw new BotTmdbError(503, '映画情報に接続できませんでした。時間をおいて再度お試しください。'); }
  if (result.status === 404) throw new BotTmdbError(404, 'TMDBに該当する作品がありません。');
  if (!result.ok) throw new BotTmdbError(result.status === 429 ? 429 : 502, result.status === 429 ? '検索が混み合っています。少し待って再度お試しください。' : '映画情報を取得できませんでした。');
  return result.json();
}
async function botKey(env) {
  if (!env.TMDB_CONFIG_KEY) throw new BotTmdbError(503, '共通接続を準備しています。');
  const key = await storedKey(env);
  if (!key) throw new BotTmdbError(503, '映画情報を接続してください。');
  return key;
}
// Port of FilmAPI.normalizeProviders / FilmAPI.details in client/films-api.js.
function botProviders(data, checkedAt, media) {
  const jp = data.results?.JP, groups = {};
  for (const k of ['flatrate', 'rent', 'buy', 'free', 'ads']) groups[k] = [...new Set((jp?.[k] || []).map(p => botText(p.provider_name)).filter(Boolean))];
  const linkPattern = media === 'tv' ? /^https:\/\/www\.themoviedb\.org\/tv\// : /^https:\/\/www\.themoviedb\.org\/movie\//;
  return { ...groups, checkedAt, region: 'JP', link: linkPattern.test(jp?.link || '') ? jp.link : '' };
}
async function botDetails(env, key, id, media) {
  const [result, providers] = await Promise.allSettled([
    botTmdb(env, key, media + '/' + id, [['append_to_response', media === 'tv' ? 'credits' : 'credits,release_dates']]),
    botTmdb(env, key, media + '/' + id + '/watch/providers')
  ]);
  if (result.status !== 'fulfilled') throw result.reason;
  const data = result.value, now = Date.now();
  if (data.id !== id) throw new BotTmdbError(502, '映画情報を取得できませんでした。');
  const normalized = providers.status === 'fulfilled' ? botProviders(providers.value, now, media) : null;
  const cast = (data.credits?.cast || []).slice(0, 12).map(p => ({ name: botText(p.name), character: botText(p.character) }));
  const genres = (data.genres || []).map(g => botText(g.name)).filter(Boolean);
  if (media === 'tv') {
    const runTimes = (data.episode_run_time || []).filter(t => Number.isFinite(t) && t > 0);
    return {
      source: 'TMDB', id, mediaType: 'tv', title: botText(data.name), originalTitle: botText(data.original_name),
      releaseDate: botDate(data.first_air_date), japanTheatricalDate: '',
      runtime: runTimes.length ? Math.round(runTimes.reduce((a, b) => a + b, 0) / runTimes.length) : null,
      seasons: Number.isInteger(data.number_of_seasons) && data.number_of_seasons > 0 ? data.number_of_seasons : null,
      episodes: Number.isInteger(data.number_of_episodes) && data.number_of_episodes > 0 ? data.number_of_episodes : null,
      directors: (data.created_by || []).map(p => botText(p.name)).filter(Boolean),
      cast, genres, overview: botText(data.overview), poster: botImage(data.poster_path), checkedAt: now,
      providers: normalized, providerError: providers.status === 'rejected'
    };
  }
  const jpDates = (data.release_dates?.results || []).find(r => r.iso_3166_1 === 'JP')?.release_dates || [];
  const theatricalDates = jpDates.filter(r => [2, 3].includes(r.type)).map(r => botDate(r.release_date)).filter(Boolean).sort();
  return {
    source: 'TMDB', id, mediaType: 'movie', title: botText(data.title), originalTitle: botText(data.original_title),
    releaseDate: botDate(data.release_date), japanTheatricalDate: theatricalDates[0] || '',
    runtime: Number.isFinite(data.runtime) && data.runtime > 0 ? data.runtime : null,
    directors: (data.credits?.crew || []).filter(p => p.job === 'Director').map(p => botText(p.name)).filter(Boolean),
    cast, genres, overview: botText(data.overview), poster: botImage(data.poster_path), checkedAt: now,
    providers: normalized, providerError: providers.status === 'rejected'
  };
}
async function botShelf(env) {
  const {results} = await env.DB.prepare('SELECT body, revision FROM films ORDER BY id').all();
  return results.map(r => ({...JSON.parse(r.body), _revision: r.revision}));
}
const botMedia = r => r.movie?.mediaType || 'movie';
const botBrief = r => ({ id: r.id, title: r.title, status: r.status, rating: r.rating, date: r.date, _revision: r._revision });
// Same matching as findFilmRecord() in client/app.js.
function botFindOnShelf(shelf, film) {
  const exact = shelf.find(r => r.movie?.id === film.id && botMedia(r) === film.mediaType);
  if (exact) return { match: 'tmdb', record: exact };
  const year = (film.releaseDate || '').slice(0, 4);
  const compatible = shelf.filter(r => botNormalize(r.title) === botNormalize(film.title)).filter(r => { const known = (r.meta || '').match(/(19\d{2}|20\d{2})年製作/); return !known || !year || known[1] === year; });
  const record = compatible.find(r => r.status === 'watched') || compatible[0];
  return record ? { match: 'title', record } : null;
}
async function botSearch(url, env) {
  const query = (url.searchParams.get('query') || url.searchParams.get('q') || '').trim();
  if (!query || query.length > 200) return botJson({error: 'query を指定してください。'}, 400);
  const key = await botKey(env);
  const [movies, shows] = await Promise.allSettled([
    botTmdb(env, key, 'search/movie', [['query', query], ['region', 'JP'], ['include_adult', 'false']]),
    botTmdb(env, key, 'search/tv', [['query', query], ['include_adult', 'false']])
  ]);
  const list = (res, mediaType) => res.status === 'fulfilled' ? (res.value.results || []).filter(i => Number.isInteger(i.id) && i.id > 0).map(i => ({
    tmdbId: i.id, mediaType, title: botText(i.title || i.name), originalTitle: botText(i.original_title || i.original_name),
    releaseDate: botDate(i.release_date || i.first_air_date), overview: botText(i.overview).slice(0, 160), poster: botImage(i.poster_path),
    popularity: Number.isFinite(i.popularity) ? i.popularity : 0
  })) : [];
  const merged = [...list(movies, 'movie'), ...list(shows, 'tv')];
  if (!merged.length && movies.status === 'rejected') throw movies.reason;
  if (!merged.length && shows.status === 'rejected') throw shows.reason;
  merged.sort((a, b) => b.popularity - a.popularity);
  const shelf = await botShelf(env);
  const limit = Math.min(40, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  return botJson({results: merged.slice(0, limit).map(({popularity, ...film}) => {
    const found = botFindOnShelf(shelf, {id: film.tmdbId, mediaType: film.mediaType, title: film.title, releaseDate: film.releaseDate});
    return {...film, year: film.releaseDate.slice(0, 4), onShelf: found ? {match: found.match, ...botBrief(found.record)} : null};
  })});
}
async function botList(url, env) {
  const q = (url.searchParams.get('q') || '').toLowerCase(), status = url.searchParams.get('status') || '';
  const tmdbId = url.searchParams.get('tmdbId'), mediaType = url.searchParams.get('mediaType') || '';
  if (status && !['watched', 'want'].includes(status)) return botJson({error: 'status は watched か want です。'}, 400);
  if (mediaType && !['movie', 'tv'].includes(mediaType)) return botJson({error: 'mediaType は movie か tv です。'}, 400);
  if (tmdbId != null && !/^[1-9]\d{0,9}$/.test(tmdbId)) return botJson({error: 'tmdbId が不正です。'}, 400);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const matches = (await botShelf(env)).filter(r =>
    (!status || r.status === status) &&
    (tmdbId == null || r.movie?.id === Number(tmdbId)) &&
    (!mediaType || botMedia(r) === mediaType) &&
    (!q || [r.title, r.movie?.title, r.movie?.originalTitle].some(t => typeof t === 'string' && t.toLowerCase().includes(q)))
  ).sort((a, b) => b.updated - a.updated);
  return botJson({total: matches.length, records: matches.slice(0, limit)});
}
async function botCreate(request, env) {
  const data = await request.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return botJson({error: 'JSON の本文が必要です。'}, 400);
  if (!('status' in data)) return botJson({error: 'status を指定してください。'}, 400);
  const fieldError = botFieldError(data);
  if (fieldError) return botJson({error: fieldError}, 400);
  if (data.title != null && (typeof data.title !== 'string' || data.title.length > 1000)) return botJson({error: 'title が不正です。'}, 400);
  let movie = null;
  if (data.tmdbId != null) {
    if (!Number.isInteger(data.tmdbId) || data.tmdbId < 1) return botJson({error: 'tmdbId が不正です。'}, 400);
    const media = data.mediaType == null ? 'movie' : data.mediaType;
    if (!['movie', 'tv'].includes(media)) return botJson({error: 'mediaType は movie か tv です。'}, 400);
    const existing = (await botShelf(env)).find(r => r.movie?.id === data.tmdbId && botMedia(r) === media);
    if (existing) return botJson({error: 'この作品はすでに棚にあります。', record: existing}, 409);
    movie = await botDetails(env, await botKey(env), data.tmdbId, media);
  }
  const title = (typeof data.title === 'string' && data.title.trim()) ? data.title.trim() : (movie?.title || movie?.originalTitle || '');
  if (!title) return botJson({error: 'title か tmdbId を指定してください。'}, 400);
  if (!movie && data.allowDuplicateTitle !== true) {
    const same = (await botShelf(env)).find(r => botNormalize(r.title) === botNormalize(title));
    if (same) return botJson({error: '同じ作品名の記録がすでにあります。別作品として追加する場合は allowDuplicateTitle: true を指定してください。', record: same}, 409);
  }
  const record = {
    id: crypto.randomUUID(), title, status: data.status,
    rating: data.rating ?? 0, date: data.date ?? '', meta: (data.meta ?? '').trim(), review: (data.review ?? '').trim(),
    updated: Date.now(), ...(movie ? {movie} : {})
  };
  for (const k of ['spoiler', 'method', 'service', 'viewings']) if (k in data) record[k] = data[k];
  Object.assign(record, syncLatestViewing(record));
  if (!botClientValid(record)) return botJson({error: '記録の形式が正しくありません。'}, 400);
  const body = JSON.stringify(record);
  // Atomic duplicate guard: insert only if no record already has this TMDB id + media type.
  const result = movie
    ? await env.DB.prepare("INSERT INTO films (id, body, revision) SELECT ?, ?, 1 WHERE NOT EXISTS (SELECT 1 FROM films WHERE json_extract(body, '$.movie.id') = ? AND coalesce(json_extract(body, '$.movie.mediaType'), 'movie') = ?)").bind(record.id, body, movie.id, movie.mediaType).run()
    : await env.DB.prepare('INSERT INTO films (id, body, revision) VALUES (?, ?, 1)').bind(record.id, body).run();
  if (result.meta.changes !== 1) {
    const existing = (await botShelf(env)).find(r => r.movie?.id === movie.id && botMedia(r) === movie.mediaType);
    return botJson({error: 'この作品はすでに棚にあります。', record: existing || null}, 409);
  }
  return botJson({record: {...record, _revision: 1}}, 201);
}
async function botUpdate(request, env, id) {
  const data = await request.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return botJson({error: 'JSON の本文が必要です。'}, 400);
  if (!Number.isInteger(data._revision) || data._revision < 1) return botJson({error: '_revision を指定してください。'}, 409);
  const extra = Object.keys(data).filter(k => k !== '_revision' && !BOT_FIELDS.includes(k));
  if (extra.length) return botJson({error: '変更できない項目です: ' + extra.join(', ') + '（変更できるのは ' + BOT_FIELDS.join(', ') + '）'}, 400);
  if (!BOT_FIELDS.some(k => k in data)) return botJson({error: '変更する項目を指定してください。'}, 400);
  const fieldError = botFieldError(data);
  if (fieldError) return botJson({error: fieldError}, 400);
  const row = await env.DB.prepare('SELECT body, revision FROM films WHERE id = ?').bind(id).first();
  if (!row) return botJson({error: '記録が見つかりません。'}, 404);
  const current = JSON.parse(row.body);
  if (row.revision !== data._revision) return botJson({error: '別の端末で更新されています。最新の記録を取得し直してください。', record: {...current, _revision: row.revision}}, 409);
  const next = {...current, updated: Date.now()};
  for (const k of BOT_FIELDS) if (k in data) next[k] = (k === 'review' || k === 'meta' || k === 'service') ? data[k].trim() : data[k];
  if ('viewings' in data) Object.assign(next, syncLatestViewing(next));
  if (!botClientValid(next)) return botJson({error: '記録の形式が正しくありません。'}, 400);
  const result = await env.DB.prepare('UPDATE films SET body = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind(JSON.stringify(next), id, data._revision).run();
  if (result.meta.changes !== 1) return botJson({error: '別の端末で更新されています。最新の記録を取得し直してください。'}, 409);
  return botJson({record: {...next, _revision: data._revision + 1}});
}
async function botApi(request, env) {
  const auth = botAuthorized(request, env);
  if (auth === 'unconfigured') return botJson({error: 'ボット用APIは設定されていません。'}, 503);
  if (auth !== 'ok') return Response.json({error: 'ボット用の鍵が必要です。'}, {status: 401, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'WWW-Authenticate': 'Bearer'}});
  if (!env.DB) return botJson({error: '保存先の準備が完了していません。'}, 503);
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (method !== 'GET' && !request.headers.get('Content-Type')?.startsWith('application/json')) return botJson({error: 'Content-Type: application/json で送ってください。'}, 415);
  try {
    if (path === '/api/bot/search') return method === 'GET' ? await botSearch(url, env) : botJson({error: 'この操作は利用できません。'}, 405);
    if (path === '/api/bot/records') {
      if (method === 'GET') return await botList(url, env);
      if (method === 'POST') return await botCreate(request, env);
      return botJson({error: 'この操作は利用できません。'}, 405);
    }
    const extra = await botFeatureRoute(request, env, url, path, method);
    if (extra) return extra;
    const m = /^\/api\/bot\/records\/([^/]+)$/.exec(path);
    if (m) {
      let id;
      try { id = decodeURIComponent(m[1]); } catch { return botJson({error: 'IDが不正です。'}, 400); }
      if (!id || id.length > 200) return botJson({error: 'IDが不正です。'}, 400);
      if (method === 'GET') { const row = await env.DB.prepare('SELECT body, revision FROM films WHERE id = ?').bind(id).first(); return row ? botJson({record: {...JSON.parse(row.body), _revision: row.revision}}) : botJson({error: '記録が見つかりません。'}, 404); }
      if (method === 'PATCH') return await botUpdate(request, env, id);
      return botJson({error: 'この操作は利用できません。'}, 405);
    }
    return botJson({error: '見つかりません。'}, 404);
  } catch (e) {
    if (e instanceof BotTmdbError) return botJson({error: e.message}, e.status);
    return botJson({error: '処理できませんでした。時間をおいて再度お試しください。'}, 503);
  }
}

// Viewings, lists and notices for the bot (same rules as the UI).
async function botAddViewing(request, env, id) {
  const data = await request.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return botJson({error: 'JSON の本文が必要です。'}, 400);
  if (!Number.isInteger(data._revision) || data._revision < 1) return botJson({error: '_revision を指定してください。'}, 409);
  const viewing = { id: crypto.randomUUID(), date: data.date ?? '', method: data.method ?? '', service: typeof data.service === 'string' ? data.service.trim() : (data.service ?? ''), rating: data.rating ?? 0, note: typeof data.note === 'string' ? data.note.trim() : (data.note ?? '') };
  const e = viewingError(viewing);
  if (e) return botJson({error: e}, 400);
  const row = await env.DB.prepare('SELECT body, revision FROM films WHERE id = ?').bind(id).first();
  if (!row) return botJson({error: '記録が見つかりません。'}, 404);
  const current = JSON.parse(row.body);
  if (row.revision !== data._revision) return botJson({error: '別の端末で更新されています。最新の記録を取得し直してください。', record: {...current, _revision: row.revision}}, 409);
  const next = {...addViewing(current, viewing), updated: Date.now()};
  if (!botClientValid(next)) return botJson({error: '記録の形式が正しくありません。'}, 400);
  const result = await env.DB.prepare('UPDATE films SET body = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind(JSON.stringify(next), id, data._revision).run();
  if (result.meta.changes !== 1) return botJson({error: '別の端末で更新されています。最新の記録を取得し直してください。'}, 409);
  return botJson({record: {...next, _revision: data._revision + 1}, viewCount: viewCount(next)}, 201);
}
async function botListWithItems(env, list) {
  const ids = list.items.map(i => i.recordId);
  const rows = ids.length ? (await env.DB.prepare('SELECT id, body, revision FROM films WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all()).results : [];
  const byId = new Map(rows.map(r => [r.id, {...JSON.parse(r.body), _revision: r.revision}]));
  return {...list, items: list.items.map((it, i) => { const r = byId.get(it.recordId); return {...it, rank: i + 1, record: r ? {...botBrief(r), tmdbId: r.movie?.id ?? null, mediaType: r.movie ? botMedia(r) : null} : null}; })};
}
async function botFeatureRoute(request, env, url, path, method) {
  const no = () => botJson({error: 'この操作は利用できません。'}, 405);
  const send = ([status, data]) => botJson(data, status);
  const body = () => request.json().catch(() => null);
  let m = /^\/api\/bot\/records\/([^/]+)\/viewings$/.exec(path);
  if (m) {
    let id; try { id = decodeURIComponent(m[1]); } catch { return botJson({error: 'IDが不正です。'}, 400); }
    return method === 'POST' ? botAddViewing(request, env, id) : no();
  }
  if (path === '/api/bot/lists') {
    if (method === 'GET') return botJson({lists: (await listsList(env)).map(l => ({...l, itemCount: l.items.length}))});
    if (method === 'POST') { const [status, data] = await listCreate(env, await body(), {requireExisting: true}); return botJson(data.list ? {list: await botListWithItems(env, data.list)} : data, status); }
    return no();
  }
  m = /^\/api\/bot\/lists\/([^/]+)$/.exec(path);
  if (m) {
    let id; try { id = decodeURIComponent(m[1]); } catch { return botJson({error: 'IDが不正です。'}, 400); }
    if (method === 'GET') { const l = await listGet(env, id); return l ? botJson({list: await botListWithItems(env, l)}) : botJson({error: 'リストが見つかりません。'}, 404); }
    if (method === 'PATCH') {
      const input = await body();
      const extra = input && typeof input === 'object' ? Object.keys(input).filter(k => !['_revision', 'name', 'description', 'items'].includes(k)) : [];
      if (extra.length) return botJson({error: '変更できない項目です: ' + extra.join(', ') + '（変更できるのは name, description, items）'}, 400);
      const [status, data] = await listUpdate(env, id, input, {requireExisting: true});
      return botJson(data.list && status === 200 ? {list: await botListWithItems(env, data.list)} : data, status);
    }
    return no();
  }
  if (path === '/api/bot/notices') return method === 'GET' ? botJson(await noticesList(env, {unreadOnly: url.searchParams.get('unread') === '1', limit: url.searchParams.get('limit') || 50, since: url.searchParams.get('since') || 0, origin: url.origin})) : no();
  m = /^\/api\/bot\/records\/([^/]+)\/link$/.exec(path);
  if (m) {
    let id; try { id = decodeURIComponent(m[1]); } catch { return botJson({error: 'IDが不正です。'}, 400); }
    return method === 'POST' ? botLink(request, env, id) : no();
  }
  if (path === '/api/bot/notices/read') return method === 'POST' ? send(await noticesMarkRead(env, await body())) : no();
  return null;
}

// Link an existing record (e.g. 「確認が必要」) to a TMDB work. Only movie + enrichment change;
// title, rating, review, dates etc. are kept. The pre-link body is kept in enrichment_snapshots.
async function botLink(request, env, id) {
  const data = await request.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return botJson({error: 'JSON の本文が必要です。'}, 400);
  if (!Number.isInteger(data._revision) || data._revision < 1) return botJson({error: '_revision を指定してください。'}, 409);
  if (!Number.isInteger(data.tmdbId) || data.tmdbId < 1) return botJson({error: 'tmdbId が不正です。'}, 400);
  const media = data.mediaType == null ? 'movie' : data.mediaType;
  if (!['movie', 'tv'].includes(media)) return botJson({error: 'mediaType は movie か tv です。'}, 400);
  const row = await env.DB.prepare('SELECT body, revision FROM films WHERE id = ?').bind(id).first();
  if (!row) return botJson({error: '記録が見つかりません。'}, 404);
  const current = JSON.parse(row.body);
  if (row.revision !== data._revision) return botJson({error: '別の端末で更新されています。最新の記録を取得し直してください。', record: {...current, _revision: row.revision}}, 409);
  const other = (await botShelf(env)).find(r => r.id !== id && r.movie?.id === data.tmdbId && botMedia(r) === media);
  if (other) return botJson({error: 'この作品は別の記録に紐づいています。', record: other}, 409);
  const movie = await botDetails(env, await botKey(env), data.tmdbId, media);
  const reason = typeof data.reason === 'string' && data.reason.trim() ? data.reason.trim().slice(0, 200) : 'ボットで確認して紐づけ';
  const next = {...current, movie, enrichment: {status: 'linked', reason, checkedAt: Date.now(), candidates: [], ...(current.enrichment ? {previous: {status: current.enrichment.status, reason: current.enrichment.reason}} : {})}};
  if (!botClientValid(next)) return botJson({error: '記録の形式が正しくありません。'}, 400);
  const saved = await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO enrichment_snapshots (id, body, revision) VALUES (?, ?, ?)').bind(id, row.body, row.revision),
    env.DB.prepare('UPDATE films SET body = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind(JSON.stringify(next), id, data._revision)
  ]);
  if (saved[1].meta.changes !== 1) return botJson({error: '別の端末で更新されています。最新の記録を取得し直してください。'}, 409);
  return botJson({record: {...next, _revision: data._revision + 1}});
}
