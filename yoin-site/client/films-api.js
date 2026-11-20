'use strict';
// The owner-only server keeps the encrypted credential and contacts TMDB.
const FilmAPI = (() => {
  const date = value => /^\d{4}-\d{2}-\d{2}/.test(value || '') ? value.slice(0, 10) : '';
  const text = value => typeof value === 'string' ? value : '';
  const image = path => /^\/[a-zA-Z0-9_.-]+$/.test(path || '') ? `https://image.tmdb.org/t/p/w500${path}` : '';
  async function request(path, credential, params = {}) {
    if (!credential) throw new Error('映画情報の接続を設定してください。');
    if (navigator.onLine === false) throw new Error('情報の検索・更新にはインターネット接続が必要です。');
    const url = new URL(`/api/tmdb/${path}`, location.origin);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const headers = { accept: 'application/json' };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { headers, signal: controller.signal, referrerPolicy: 'no-referrer', cache: 'no-store' });
      if (response.status === 401 || response.status === 403) throw new Error('接続キーを確認してください。TMDBのAPIキーまたは読み取り用アクセストークンを使います。');
      if (response.status === 429) throw new Error('検索が混み合っています。少し待って再度お試しください。');
      if (!response.ok) throw new Error('映画情報を取得できませんでした。時間をおいて再度お試しください。');
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('検索がタイムアウトしました。もう一度お試しください。');
      if (error instanceof TypeError) throw new Error('通信できませんでした。接続を確認して再度お試しください。');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function summaries(data, mediaType = 'movie') {
    return (data.results || []).map(item => ({
      id: item.id, mediaType,
      title: text(item.title || item.name), originalTitle: text(item.original_title || item.original_name),
      releaseDate: date(item.release_date || item.first_air_date), poster: image(item.poster_path), overview: text(item.overview),
      genreIds: Array.isArray(item.genre_ids) ? item.genre_ids.filter(Number.isInteger) : [],
      popularity: Number.isFinite(item.popularity) ? item.popularity : 0
    })).filter(item => Number.isInteger(item.id) && item.id > 0);
  }
  function kindOf(item) {
    if ((item.genres || []).includes('アニメーション') || (item.genreIds || []).includes(16)) return 'アニメ';
    return item.mediaType === 'tv' ? 'ドラマ' : '映画';
  }
  async function search(query, credential) {
    const [movies, shows] = await Promise.allSettled([
      request('search/movie', credential, { query, region: 'JP', include_adult: 'false' }),
      request('search/tv', credential, { query, include_adult: 'false' })
    ]);
    const merged = [
      ...(movies.status === 'fulfilled' ? summaries(movies.value, 'movie') : []),
      ...(shows.status === 'fulfilled' ? summaries(shows.value, 'tv') : [])
    ];
    if (!merged.length && movies.status === 'rejected') throw movies.reason;
    if (!merged.length && shows.status === 'rejected') throw shows.reason;
    return merged.sort((a, b) => b.popularity - a.popularity);
  }
  async function browse(options, credential) {
    const page = Math.min(500, Math.max(1, Number(options.page) || 1));
    const media = options.media === 'tv' ? 'tv' : 'movie';
    let data;
    if (options.query) {
      if (media === 'tv') data = await request('search/tv', credential, { query: options.query, include_adult: 'false', page });
      else if (options.mode === 'all') { const merged = await search(options.query, credential); return { movies: merged, page: 1, totalPages: 1 }; }
      else data = await request('search/movie', credential, { query: options.query, region: 'JP', include_adult: 'false', page });
    }
    else if (media === 'movie' && options.mode === 'now' && !options.provider) data = await request('movie/now_playing', credential, { region: 'JP', page });
    else if (media === 'tv' && options.mode === 'tv-trending' && !options.provider) data = await request('trending/tv/week', credential, { page });
    else {
      const params = { include_adult: 'false', sort_by: 'popularity.desc', page };
      if (media === 'movie') params.include_video = 'false';
      if (media === 'tv' && options.mode === 'anime-now') {
        const today = new Date(), past = new Date(Date.now() - 21 * 86400000);
        const iso = d => d.toISOString().slice(0, 10);
        Object.assign(params, { with_genres: '16', with_original_language: 'ja', 'air_date.gte': iso(past), 'air_date.lte': iso(today) });
      }
      else if (media === 'tv' && options.mode === 'anime') Object.assign(params, { with_genres: '16', with_original_language: 'ja' });
      else if (media === 'tv' && options.mode === 'drama') params.without_genres = '16';
      if (options.provider) Object.assign(params, { watch_region: 'JP', with_watch_providers: options.provider, with_watch_monetization_types: options.monetization || 'flatrate' });
      data = await request(`discover/${media}`, credential, params);
    }
    return { movies: summaries(data, media), page: data.page || page, totalPages: Math.min(data.total_pages || 0, 500) };
  }
  async function providers(credential, mediaType = 'movie') {
    const data = await request(`watch/providers/${mediaType === 'tv' ? 'tv' : 'movie'}`, credential, { watch_region: 'JP' });
    return (data.results || []).filter(p => Number.isInteger(p.provider_id) && typeof p.provider_name === 'string').sort((a, b) => (a.display_priorities?.JP ?? a.display_priority ?? 999) - (b.display_priorities?.JP ?? b.display_priority ?? 999)).map(p => ({ id: p.provider_id, name: p.provider_name }));
  }
  function normalizeProviders(data, checkedAt, mediaType = 'movie') {
    const jp = data.results?.JP;
    const groups = {};
    for (const key of ['flatrate', 'rent', 'buy', 'free', 'ads']) {
      groups[key] = [...new Set((jp?.[key] || []).map(p => text(p.provider_name)).filter(Boolean))];
    }
    const linkPattern = mediaType === 'tv' ? /^https:\/\/www\.themoviedb\.org\/tv\// : /^https:\/\/www\.themoviedb\.org\/movie\//;
    return { ...groups, checkedAt, region: 'JP', link: linkPattern.test(jp?.link || '') ? jp.link : '' };
  }
  async function details(id, credential, previous = null, mediaType = 'movie') {
    if (!Number.isInteger(id) || id < 1) throw new Error('作品IDが不正です。');
    const media = mediaType === 'tv' ? 'tv' : 'movie';
    const [result, providers] = await Promise.allSettled([
      request(`${media}/${id}`, credential, { append_to_response: media === 'tv' ? 'credits' : 'credits,release_dates' }),
      request(`${media}/${id}/watch/providers`, credential)
    ]);
    if (result.status !== 'fulfilled') throw result.reason;
    const data = result.value;
    const now = Date.now();
    const normalized = providers.status === 'fulfilled' ? normalizeProviders(providers.value, now, media) : previous?.providers || null;
    if (media === 'tv') {
      const runTimes = (data.episode_run_time || []).filter(t => Number.isFinite(t) && t > 0);
      return {
        source: 'TMDB', id, mediaType: 'tv', title: text(data.name), originalTitle: text(data.original_name),
        releaseDate: date(data.first_air_date), japanTheatricalDate: '',
        runtime: runTimes.length ? Math.round(runTimes.reduce((a, b) => a + b, 0) / runTimes.length) : null,
        seasons: Number.isInteger(data.number_of_seasons) && data.number_of_seasons > 0 ? data.number_of_seasons : null,
        episodes: Number.isInteger(data.number_of_episodes) && data.number_of_episodes > 0 ? data.number_of_episodes : null,
        directors: (data.created_by || []).map(p => text(p.name)).filter(Boolean),
        cast: (data.credits?.cast || []).slice(0, 12).map(p => ({ name: text(p.name), character: text(p.character) })),
        genres: (data.genres || []).map(g => text(g.name)).filter(Boolean),
        overview: text(data.overview), poster: image(data.poster_path), checkedAt: now,
        providers: normalized,
        providerError: providers.status === 'rejected'
      };
    }
    const jpDates = (data.release_dates?.results || []).find(r => r.iso_3166_1 === 'JP')?.release_dates || [];
    const theatricalDates = jpDates.filter(r => [2, 3].includes(r.type)).map(r => date(r.release_date)).filter(Boolean).sort();
    return {
      source: 'TMDB', id, mediaType: 'movie', title: text(data.title), originalTitle: text(data.original_title),
      releaseDate: date(data.release_date), japanTheatricalDate: theatricalDates[0] || '',
      runtime: Number.isFinite(data.runtime) && data.runtime > 0 ? data.runtime : null,
      directors: (data.credits?.crew || []).filter(p => p.job === 'Director').map(p => text(p.name)).filter(Boolean),
      cast: (data.credits?.cast || []).slice(0, 12).map(p => ({ name: text(p.name), character: text(p.character) })),
      genres: (data.genres || []).map(g => text(g.name)).filter(Boolean),
      overview: text(data.overview), poster: image(data.poster_path), checkedAt: now,
      providers: normalized,
      providerError: providers.status === 'rejected'
    };
  }
  return { request, search, browse, providers, details, normalizeProviders, kindOf };
})();
