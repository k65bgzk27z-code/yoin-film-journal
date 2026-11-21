'use strict';
let catalog = [], catalogPage = 1, catalogTotalPages = 0, catalogVersion = 0, detailVersion = 0;
let selectedFilm = null, providersLoaded = false, currentTab = 'library', catalogQuery = '';

function switchTab(tab) {
  currentTab = tab;
  const sections = { explore: 'explore', library: 'library', lists: 'lists', stats: 'stats-view', notices: 'notices' };
  for (const [name, section] of Object.entries(sections)) $(section).hidden = tab !== name;
  if (typeof onTabShown === 'function') onTabShown(tab);
  for (const name of Object.keys(sections)) {
    $(`tab-${name}`).classList.toggle('active', name === tab);
    $(`tab-${name}`).setAttribute('aria-pressed', String(name === tab));
  }
  if (tab === 'explore' && !catalog.length) loadCatalog(1);
  else if (tab === 'explore') loadProviders();
}
const TV_MODES = ['anime-now', 'anime', 'drama', 'tv-trending', 'tv-popular'];
const modeMedia = mode => TV_MODES.includes(mode) ? 'tv' : 'movie';
function catalogHTML() {
  return catalog.map(film => {
    const record = findFilmRecord(film);
    const poster = safePoster(film.poster);
    const dateText = film.mediaType === 'tv' ? (film.releaseDate ? `放送開始 ${film.releaseDate.replaceAll('-', '/')}` : '放送開始日不明') : (film.releaseDate ? `公開日 ${film.releaseDate.replaceAll('-', '/')}` : '公開日不明');
    return `<button class="catalog-film" data-catalog-id="${film.id}" data-media="${film.mediaType || 'movie'}" aria-label="${escape(film.title)}の詳細">${poster ? `<img src="${poster}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="catalog-placeholder" aria-hidden="true">${escape(Array.from(film.title).slice(0, 2).join(''))}</span>`}<span class="catalog-caption"><strong>${escape(film.title)}</strong><small>${escape(FilmAPI.kindOf(film))} · ${escape(dateText)}</small>${record ? `<small class="badge">${record.status === 'want' ? '✓ 観たいに登録済み' : '✓ 鑑賞済み'}${record.rating ? ` · ★ ${record.rating.toFixed(1)}` : ''}</small>` : ''}</span></button>`;
  }).join('');
}
function onLibraryChanged() {
  if (catalog.length) $('explore-grid').innerHTML = catalogHTML();
  if (typeof onFeaturesLibraryChanged === 'function') onFeaturesLibraryChanged();
}
function disconnectedCatalog() {
  catalogVersion++;
  $('explore-status').textContent = '';
  $('explore-prev').hidden = true;
  $('explore-next').hidden = true;
  $('explore-grid').innerHTML = '<div class="catalog-empty"><h3>作品を探して、そのまま記録。</h3><p>人気の映画・放送中のアニメ・ドラマをポスターで眺めたり、日本の配信サービスから探せます。<br>最初にTMDBの無料接続を設定してください。</p><button id="catalog-start">無料接続を設定する</button><p class="source">登録前でも「私の作品棚」から手入力で記録できます。</p></div>';
  $('catalog-start').onclick = showConnection;
}
let providersMedia = 'movie';
async function loadProviders() {
  const media = modeMedia($('explore-mode').value);
  if ((providersLoaded && providersMedia === media) || !credential) return;
  providersLoaded = false;
  providersMedia = media;
  const connection = credential;
  try {
    const list = await FilmAPI.providers(connection, media);
    if (connection !== credential) return;
    const selected = $('explore-provider').value;
    $('explore-provider').innerHTML = '<option value="">すべて</option>' + list.map(p => `<option value="${p.id}">${escape(p.name)}</option>`).join('');
    if (list.some(p => String(p.id) === selected)) $('explore-provider').value = selected;
    providersLoaded = true;
  } catch (error) {
    $('explore-status').textContent += ' 配信サービスの一覧を取得できませんでした。再度このタブを開くと再試行します。';
  }
}
async function browseCatalog(options) {
  if (options.query) return FilmAPI.browse({ ...options, mode: 'all' }, credential);
  if (options.provider || !['week', 'trending'].includes(options.mode)) {
    return FilmAPI.browse({ ...options, media: modeMedia(options.mode) }, credential);
  }
  const page = Math.min(500, Math.max(1, Number(options.page) || 1));
  const path = options.mode === 'week' ? 'catalog/week' : 'trending/movie/week';
  const data = await FilmAPI.request(path, credential, { page });
  const movies = (data.results || []).filter(movie => Number.isInteger(movie.id) && movie.id > 0).map(movie => ({
    id: movie.id, mediaType: 'movie', genreIds: Array.isArray(movie.genre_ids) ? movie.genre_ids : [], popularity: movie.popularity || 0,
    title: typeof movie.title === 'string' ? movie.title : '',
    originalTitle: typeof movie.original_title === 'string' ? movie.original_title : '',
    releaseDate: /^\d{4}-\d{2}-\d{2}/.test(movie.release_date || '') ? movie.release_date.slice(0, 10) : '',
    poster: /^\/[a-zA-Z0-9_.-]+$/.test(movie.poster_path || '') ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : '',
    overview: typeof movie.overview === 'string' ? movie.overview : ''
  }));
  return { movies, page: data.page || page, totalPages: Math.min(data.total_pages || 0, 500) };
}
async function loadCatalog(page = 1) {
  $('explore-connect').textContent = credential ? '接続設定' : '無料接続を設定';
  if (!credential) { disconnectedCatalog(); return; }
  const version = ++catalogVersion;
  $('explore-status').textContent = '映画を探しています…';
  $('explore-prev').hidden = true;
  $('explore-next').hidden = true;
  $('explore-grid').setAttribute('aria-busy', 'true');
  // Clear previous results so an error never leaves an old list under new filters.
  catalog = [];
  $('explore-grid').innerHTML = '';
  try {
    const result = await browseCatalog({ query: catalogQuery, mode: $('explore-mode').value, provider: $('explore-provider').value, monetization: $('explore-monetization').value, page });
    if (version !== catalogVersion) return;
    catalog = result.movies;
    catalogPage = result.page;
    catalogTotalPages = result.totalPages;
    $('explore-grid').innerHTML = catalog.length ? catalogHTML() : '<div class="catalog-empty"><h3>該当する作品がありません</h3><p>作品名や配信サービスの条件を変えてみてください。</p></div>';
    const context = catalogQuery ? `「${catalogQuery}」の検索結果（映画・アニメ・ドラマ／配信条件は適用していません）` : $('explore-provider').value ? '日本の配信作品（視聴前に作品詳細で最新条件をご確認ください）' : ({now:'日本の上映中作品（TMDB登録情報）',week:'日本の今週公開作品（月曜〜日曜・日本時間／TMDB登録情報）',trending:'TMDBの週間トレンド作品（世界）',popular:'TMDBで人気の映画（世界の人気順）','anime-now':'放送中の日本のアニメ（TMDB登録情報）',anime:'人気の日本のアニメ（TMDB登録情報）',drama:'人気のドラマ（TMDB登録情報）','tv-trending':'TMDBの週間トレンド（アニメ・ドラマ）','tv-popular':'TMDBで人気のアニメ・ドラマ'}[$('explore-mode').value]);
    $('explore-status').textContent = `${context} · ${catalogPage}ページ`;
    $('explore-prev').hidden = catalogPage <= 1;
    $('explore-next').hidden = catalogPage >= catalogTotalPages;
  } catch (error) {
    if (version === catalogVersion) {
      $('explore-status').textContent = error.message;
      $('explore-grid').innerHTML = '<div class="catalog-empty"><p>作品を読み込めませんでした。通信と接続設定を確認してください。</p><button id="catalog-retry">もう一度読み込む</button></div>';
      $('catalog-retry').onclick = () => loadCatalog(page);
    }
  } finally {
    if (version === catalogVersion) $('explore-grid').setAttribute('aria-busy', 'false');
  }
  if (version === catalogVersion) loadProviders();
}
function onFilmConnectionChange() {
  catalog = [];
  providersLoaded = false;
  $('explore-provider').innerHTML = '<option value="">すべて</option>';
  if (currentTab === 'explore') loadCatalog(1);
}
async function openFilm(id, mediaType = 'movie') {
  const version = ++detailVersion;
  selectedFilm = null;
  $('film-content').innerHTML = '';
  $('film-status').textContent = '作品情報と日本の配信先を取得しています…';
  $('film-want').disabled = true;
  $('film-record').disabled = true;
  $('film-detail').showModal();
  try {
    const existing = records.find(r => r.movie?.id === id && (r.movie?.mediaType || 'movie') === mediaType);
    const film = await FilmAPI.details(id, credential, existing?.movie, mediaType);
    if (version !== detailVersion || !$('film-detail').open) return;
    selectedFilm = film;
    const poster = safePoster(film.poster);
    const saved = records.find(r => r.movie?.id === id && (r.movie?.mediaType || 'movie') === mediaType);
    $('film-content').innerHTML = typeof filmDetailHTML === 'function' ? filmDetailHTML(film, saved) : `<div class="film-hero">${poster ? `<img src="${poster}" alt="${escape(film.title)}のポスター" referrerpolicy="no-referrer">` : ''}<div><h2>${escape(film.title)}</h2><p>${escape(film.originalTitle)}</p><p>${escape(kindLabel(film))}${film.genres.length ? ` · ${escape(film.genres.join(' / '))}` : ''}</p></div></div>${movieHTML(film)}`;
    if (typeof loadBackdrop === 'function') loadBackdrop(film, $('film-content'));
    $('film-want').textContent = saved ? (saved.status === 'want' ? '✓ 観たいに登録済み' : '✓ 鑑賞済み') : '＋ 観たい';
    $('film-want').disabled = Boolean(saved) || !storageHealthy;
    $('film-record').textContent = saved ? '自分の記録を編集' : '鑑賞を記録';
    $('film-record').disabled = !storageHealthy;
    $('film-status').textContent = saved ? 'この作品は映画棚に登録済みです。' : '気になったら「観たい」に追加できます。';
  } catch (error) { if (version === detailVersion) $('film-status').textContent = error.message; }
}
$('tab-explore').onclick = () => switchTab('explore');
$('tab-library').onclick = () => switchTab('library');
for (const name of ['lists', 'stats', 'notices']) $(`tab-${name}`).onclick = () => switchTab(name);
$('explore-connect').onclick = showConnection;
$('explore-search-form').onsubmit = event => {
  event.preventDefault();
  catalogQuery = $('explore-query').value.trim();
  if (catalogQuery) { $('explore-provider').value = ''; $('explore-mode').value = 'popular'; }
  loadCatalog(1);
};
$('explore-mode').onchange = () => {
  catalogQuery = '';
  $('explore-query').value = '';
  $('explore-provider').value = '';
  loadCatalog(1);
};
for (const id of ['explore-provider', 'explore-monetization']) $(id).onchange = () => {
  catalogQuery = '';
  $('explore-query').value = '';
  $('explore-mode').value = 'popular';
  loadCatalog(1);
};
$('explore-prev').onclick = () => loadCatalog(catalogPage - 1);
$('explore-next').onclick = () => loadCatalog(catalogPage + 1);
$('explore-grid').onclick = event => {
  const button = event.target.closest('[data-catalog-id]');
  if (button) openFilm(Number(button.dataset.catalogId), button.dataset.media);
};
$('film-close').onclick = () => { detailVersion++; $('film-detail').close(); };
$('film-detail').addEventListener('close', () => detailVersion++);
$('film-want').onclick = async () => {
  if (!selectedFilm || findFilmRecord(selectedFilm)) return;
  const record = { id: crypto.randomUUID(), title: selectedFilm.title, status: 'want', rating: 0, date: '', meta: '', review: '', updated: Date.now(), movie: selectedFilm };
  if (await persist([...records, record])) {
    $('film-want').textContent = '✓ 観たいに登録済み';
    $('film-want').disabled = true;
    $('film-record').textContent = '自分の記録を編集';
    $('film-status').textContent = '「観たい」に保存しました。私の映画棚で確認できます。';
  }
};
$('film-record').onclick = () => {
  if (!selectedFilm) return;
  const film = selectedFilm;
  const existing = findFilmRecord(film);
  $('film-detail').close();
  openRecord(existing);
  if (!existing) { $('title').value = film.title; $('status').value = 'watched'; }
  draftMovie = film;
  $('lookup-preview').innerHTML = movieHTML(film);
  if (typeof syncFormWidgets === 'function') syncFormWidgets();
  $('lookup-status').textContent = '作品情報を選択済みです。評価や感想を記録してください。';
};
switchTab('library');
