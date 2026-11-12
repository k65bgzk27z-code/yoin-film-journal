'use strict';
// API access is always from the visitor's device directly to TMDB.
const FilmAPI = (() => {
  const date = value => /^\d{4}-\d{2}-\d{2}/.test(value || '') ? value.slice(0, 10) : '';
  const text = value => typeof value === 'string' ? value : '';
  const image = path => /^\/[a-zA-Z0-9_.-]+$/.test(path || '') ? `https://image.tmdb.org/t/p/w500${path}` : '';
  async function request(path, credential, params = {}) {
    if (!credential) throw new Error('映画情報の接続を設定してください。');
    if (navigator.onLine === false) throw new Error('情報の検索・更新にはインターネット接続が必要です。');
    const url = new URL(`https://api.themoviedb.org/3/${path}`);
    url.searchParams.set('language', 'ja-JP');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const headers = { accept: 'application/json' };
    if (/^[a-f0-9]{32}$/i.test(credential)) url.searchParams.set('api_key', credential);
    else headers.Authorization = `Bearer ${credential}`;
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
  async function search(query, credential) {
    const data = await request('search/movie', credential, { query, region: 'JP', include_adult: 'false' });
    return (data.results || []).slice(0, 12).map(movie => ({
      id: movie.id, title: text(movie.title), originalTitle: text(movie.original_title),
      releaseDate: date(movie.release_date), poster: image(movie.poster_path), overview: text(movie.overview)
    })).filter(movie => Number.isInteger(movie.id) && movie.id > 0);
  }
  function normalizeProviders(data, checkedAt) {
    const jp = data.results?.JP;
    const groups = {};
    for (const key of ['flatrate', 'rent', 'buy', 'free', 'ads']) {
      groups[key] = [...new Set((jp?.[key] || []).map(p => text(p.provider_name)).filter(Boolean))];
    }
    return { ...groups, checkedAt, region: 'JP', link: /^https:\/\/www\.themoviedb\.org\/movie\//.test(jp?.link || '') ? jp.link : '' };
  }
  async function details(id, credential, previous = null) {
    if (!Number.isInteger(id) || id < 1) throw new Error('作品IDが不正です。');
    const [result, providers] = await Promise.allSettled([
      request(`movie/${id}`, credential, { append_to_response: 'credits,release_dates' }),
      request(`movie/${id}/watch/providers`, credential)
    ]);
    if (result.status !== 'fulfilled') throw result.reason;
    const data = result.value;
    const jpDates = (data.release_dates?.results || []).find(r => r.iso_3166_1 === 'JP')?.release_dates || [];
    const theatricalDates = jpDates.filter(r => [2, 3].includes(r.type)).map(r => date(r.release_date)).filter(Boolean).sort();
    const now = Date.now();
    return {
      source: 'TMDB', id, title: text(data.title), originalTitle: text(data.original_title),
      releaseDate: date(data.release_date), japanTheatricalDate: theatricalDates[0] || '',
      runtime: Number.isFinite(data.runtime) && data.runtime > 0 ? data.runtime : null,
      directors: (data.credits?.crew || []).filter(p => p.job === 'Director').map(p => text(p.name)).filter(Boolean),
      genres: (data.genres || []).map(g => text(g.name)).filter(Boolean),
      overview: text(data.overview), poster: image(data.poster_path), checkedAt: now,
      providers: providers.status === 'fulfilled' ? normalizeProviders(providers.value, now) : previous?.providers || null,
      providerError: providers.status === 'rejected'
    };
  }
  return { request, search, details, normalizeProviders };
})();
