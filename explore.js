'use strict';
let catalog = [], catalogPage = 1, catalogTotalPages = 0, catalogVersion = 0, detailVersion = 0;
let selectedFilm = null, providersLoaded = false, currentTab = 'library', catalogQuery = '';

function switchTab(tab) {
  currentTab = tab;
  $('explore').hidden = tab !== 'explore';
  $('library').hidden = tab !== 'library';
  for (const name of ['explore', 'library']) {
    $(`tab-${name}`).classList.toggle('active', name === tab);
    $(`tab-${name}`).setAttribute('aria-pressed', String(name === tab));
  }
  if (tab === 'explore' && !catalog.length) loadCatalog(1);
  else if (tab === 'explore') loadProviders();
}
function catalogHTML() {
  return catalog.map(film => {
    const record = records.find(r => r.movie?.id === film.id);
    const poster = safePoster(film.poster);
    return `<button class="catalog-film" data-catalog-id="${film.id}" aria-label="${escape(film.title)}の詳細">${poster ? `<img src="${poster}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="catalog-placeholder" aria-hidden="true">${escape(Array.from(film.title).slice(0, 2).join(''))}</span>`}<span class="catalog-caption"><strong>${escape(film.title)}</strong><small>${escape(film.releaseDate.slice(0, 4) || '公開年不明')}</small>${record ? `<small class="badge">${record.status === 'want' ? '✓ 観たいに登録済み' : '✓ 鑑賞済み'}${record.rating ? ` · ★ ${record.rating.toFixed(1)}` : ''}</small>` : ''}</span></button>`;
  }).join('');
}
function onLibraryChanged() {
  if (catalog.length) $('explore-grid').innerHTML = catalogHTML();
}
function disconnectedCatalog() {
  catalogVersion++;
  $('explore-status').textContent = '';
  $('explore-prev').hidden = true;
  $('explore-next').hidden = true;
  $('explore-grid').innerHTML = '<div class="catalog-empty"><h3>映画を探して、そのまま記録。</h3><p>人気作や上映中作品をポスターで眺めたり、日本の配信サービスから探せます。<br>最初にTMDBの無料接続を設定してください。</p><button id="catalog-start">無料接続を設定する</button><p class="source">登録前でも「私の映画棚」から手入力で記録できます。</p></div>';
  $('catalog-start').onclick = showConnection;
}
async function loadProviders() {
  if (providersLoaded || !credential) return;
  const connection = credential;
  try {
    const list = await FilmAPI.providers(connection);
    if (connection !== credential) return;
    const selected = $('explore-provider').value;
    $('explore-provider').innerHTML = '<option value="">すべて</option>' + list.map(p => `<option value="${p.id}">${escape(p.name)}</option>`).join('');
    if (list.some(p => String(p.id) === selected)) $('explore-provider').value = selected;
    providersLoaded = true;
  } catch (error) {
    $('explore-status').textContent += ' 配信サービスの一覧を取得できませんでした。再度このタブを開くと再試行します。';
  }
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
    const result = await FilmAPI.browse({ query: catalogQuery, mode: $('explore-mode').value, provider: $('explore-provider').value, monetization: $('explore-monetization').value, page }, credential);
    if (version !== catalogVersion) return;
    catalog = result.movies;
    catalogPage = result.page;
    catalogTotalPages = result.totalPages;
    $('explore-grid').innerHTML = catalog.length ? catalogHTML() : '<div class="catalog-empty"><h3>該当する映画がありません</h3><p>作品名や配信サービスの条件を変えてみてください。</p></div>';
    const context = catalogQuery ? `「${catalogQuery}」の検索結果（配信条件は適用していません）` : $('explore-provider').value ? '日本の配信作品（視聴前に作品詳細で最新条件をご確認ください）' : $('explore-mode').value === 'now' ? '日本の上映中作品（TMDB登録情報）' : 'TMDBで人気の作品（世界の人気順）';
    $('explore-status').textContent = `${context} · ${catalogPage}ページ`;
    $('explore-prev').hidden = catalogPage <= 1;
    $('explore-next').hidden = catalogPage >= catalogTotalPages;
  } catch (error) {
    if (version === catalogVersion) {
      $('explore-status').textContent = error.message;
      $('explore-grid').innerHTML = '<div class="catalog-empty"><p>映画を読み込めませんでした。通信と接続設定を確認してください。</p><button id="catalog-retry">もう一度読み込む</button></div>';
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
async function openFilm(id) {
  const version = ++detailVersion;
  selectedFilm = null;
  $('film-content').innerHTML = '';
  $('film-status').textContent = '作品情報と日本の配信先を取得しています…';
  $('film-want').disabled = true;
  $('film-record').disabled = true;
  $('film-detail').showModal();
  try {
    const existing = records.find(r => r.movie?.id === id);
    const film = await FilmAPI.details(id, credential, existing?.movie);
    if (version !== detailVersion || !$('film-detail').open) return;
    selectedFilm = film;
    const poster = safePoster(film.poster);
    $('film-content').innerHTML = `<div class="film-hero">${poster ? `<img src="${poster}" alt="${escape(film.title)}のポスター" referrerpolicy="no-referrer">` : ''}<div><h2>${escape(film.title)}</h2><p>${escape(film.originalTitle)}</p><p>${escape(film.genres.join(' / '))}</p></div></div>${movieHTML(film)}`;
    const saved = records.find(r => r.movie?.id === id);
    $('film-want').textContent = saved ? (saved.status === 'want' ? '✓ 観たいに登録済み' : '✓ 鑑賞済み') : '＋ 観たい';
    $('film-want').disabled = Boolean(saved) || !storageHealthy;
    $('film-record').textContent = saved ? '自分の記録を編集' : '鑑賞を記録';
    $('film-record').disabled = !storageHealthy;
    $('film-status').textContent = saved ? 'この作品は映画棚に登録済みです。' : '気になったら「観たい」に追加できます。';
  } catch (error) { if (version === detailVersion) $('film-status').textContent = error.message; }
}
$('tab-explore').onclick = () => switchTab('explore');
$('tab-library').onclick = () => switchTab('library');
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
  if (button) openFilm(Number(button.dataset.catalogId));
};
$('film-close').onclick = () => { detailVersion++; $('film-detail').close(); };
$('film-detail').addEventListener('close', () => detailVersion++);
$('film-want').onclick = () => {
  if (!selectedFilm || records.some(r => r.movie?.id === selectedFilm.id)) return;
  const record = { id: crypto.randomUUID(), title: selectedFilm.title, status: 'want', rating: 0, date: '', meta: '', review: '', updated: Date.now(), movie: selectedFilm };
  if (persist([...records, record])) {
    $('film-want').textContent = '✓ 観たいに登録済み';
    $('film-want').disabled = true;
    $('film-record').textContent = '自分の記録を編集';
    $('film-status').textContent = '「観たい」に保存しました。私の映画棚で確認できます。';
  }
};
$('film-record').onclick = () => {
  if (!selectedFilm) return;
  const film = selectedFilm;
  const existing = records.find(r => r.movie?.id === film.id);
  $('film-detail').close();
  openRecord(existing);
  if (!existing) { $('title').value = film.title; $('status').value = 'watched'; }
  draftMovie = film;
  $('lookup-preview').innerHTML = movieHTML(film);
  $('lookup-status').textContent = '作品情報を選択済みです。評価や感想を記録してください。';
};
switchTab(records.length ? 'library' : 'explore');
