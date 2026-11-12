'use strict';
const $ = id => document.getElementById(id);
const key = 'yoin-films-v1', credentialKey = 'yoin-tmdb-key';
let records = [], filter = 'all', storageHealthy = true, credential = '', draftMovie = null, lookupVersion = 0;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safePoster = value => /^https:\/\/image\.tmdb\.org\/t\/p\/w500\/[\w.-]+$/.test(value || '') ? value : '';
const dateLabel = value => value || '情報なし';
const checkedLabel = timestamp => Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString('ja-JP') : '未確認';
function validateRecords(rows) {
  if (!Array.isArray(rows)) throw new Error('invalid records');
  const ids = new Set();
  for (const r of rows) {
    if (!r || typeof r.id !== 'string' || !r.id || ids.has(r.id) || typeof r.title !== 'string' || !r.title.trim() || !['watched', 'want'].includes(r.status) || !Number.isInteger(r.rating) || r.rating < 0 || r.rating > 5 || !Number.isFinite(r.updated) || ['date', 'meta', 'review'].some(k => typeof r[k] !== 'string')) throw new Error('invalid record');
    if (r.movie != null) {
      const m = r.movie;
      if (m.source !== 'TMDB' || !Number.isInteger(m.id) || m.id < 1 || ['title', 'originalTitle', 'releaseDate', 'japanTheatricalDate', 'overview', 'poster'].some(k => typeof m[k] !== 'string') || !Number.isFinite(m.checkedAt) || !Array.isArray(m.directors) || !Array.isArray(m.genres) || [...m.directors, ...m.genres].some(x => typeof x !== 'string')) throw new Error('invalid movie');
      if (m.providers != null) {
        const p = m.providers;
        if (p.region !== 'JP' || !Number.isFinite(p.checkedAt) || typeof p.link !== 'string' || ['flatrate', 'rent', 'buy', 'free', 'ads'].some(k => !Array.isArray(p[k]) || p[k].some(x => typeof x !== 'string'))) throw new Error('invalid providers');
      }
    }
    ids.add(r.id);
  }
  return rows;
}
try {
  const raw = localStorage.getItem(key);
  if (raw) records = validateRecords(JSON.parse(raw));
  credential = localStorage.getItem(credentialKey) || '';
} catch (error) {
  storageHealthy = false;
  records = [];
  $('notice').textContent = '保存済みデータを読み込めませんでした。上書きを防ぐため、バックアップを確認してください。';
  for (const id of ['add', 'import', 'export']) $(id).disabled = true;
}
function persist(next) {
  if (!storageHealthy) return false;
  try {
    validateRecords(next);
    localStorage.setItem(key, JSON.stringify(next));
    records = next;
    render();
    return true;
  } catch (error) {
    alert('保存できませんでした。ブラウザの空き容量や保存設定を確認してください。');
    return false;
  }
}
function providerHTML(movie) {
  const providers = movie.providers;
  let html = '<div class="providers"><b>日本で観る</b>';
  if (!providers) html += '<p>配信情報を取得できませんでした。「情報を更新」で再確認できます。</p>';
  else {
    const any = ['flatrate', 'rent', 'buy', 'free', 'ads'].some(k => providers[k].length);
    if (!any) html += '<p>この情報源では日本の配信先を確認できませんでした。配信がないことを意味しません。</p>';
    for (const [k, label] of [['flatrate', '見放題'], ['rent', 'レンタル'], ['buy', '購入'], ['free', '無料'], ['ads', '広告付き']]) {
      if (providers[k].length) html += `<div class="provider-row">${label}<br>${providers[k].map(name => `<span class="pill">${escape(name)}</span>`).join('')}</div>`;
    }
    const stale = Date.now() - providers.checkedAt > 86400000;
    html += `<p class="source ${stale || movie.providerError ? 'pending' : ''}">確認日：${checkedLabel(providers.checkedAt)}${stale ? ' · 古い情報です。視聴前に更新してください。' : ''}${movie.providerError ? ' · 今回の更新に失敗したため、前回の情報を表示しています。' : ''}</p>`;
  }
  const link = `https://www.themoviedb.org/movie/${movie.id}/watch?locale=JP`;
  html += `<a href="${link}" target="_blank" rel="noopener noreferrer">視聴先・最新条件を確認 ↗</a><p class="source">配信情報：JustWatch（TMDB経由）。追加契約が必要なチャンネルを含む場合があります。</p></div>`;
  return html;
}
function movieHTML(movie) {
  if (!movie) return '';
  return `<section class="movie-info"><p>初公開：${escape(dateLabel(movie.releaseDate))}<br>日本の劇場公開：${escape(dateLabel(movie.japanTheatricalDate))}${movie.runtime ? `<br>上映時間：${escape(movie.runtime)}分` : ''}<br>監督：${escape(movie.directors.join('、') || '情報なし')}</p>${movie.genres.length ? `<p>${escape(movie.genres.join(' / '))}</p>` : ''}${movie.overview ? `<details><summary>あらすじを読む</summary><p>${escape(movie.overview)}</p></details>` : '<p class="source">日本語のあらすじは未登録です。</p>'}${providerHTML(movie)}<p class="source">作品情報：<a href="https://www.themoviedb.org/movie/${movie.id}" target="_blank" rel="noopener noreferrer">TMDB</a> · ${checkedLabel(movie.checkedAt)}取得</p></section>`;
}
function render() {
  const watched = records.filter(r => r.status === 'watched'), rated = watched.filter(r => r.rating > 0);
  $('stats').innerHTML = `<span><b>${watched.length}</b>鑑賞済み</span><span><b>${records.length - watched.length}</b>観たい</span><span><b>${rated.length ? (rated.reduce((sum, r) => sum + r.rating, 0) / rated.length).toFixed(1) : '—'}</b>平均評価</span>`;
  const list = records.filter(r => (filter === 'all' || r.status === filter) && [r.title, r.review, r.meta, r.movie?.originalTitle, ...(r.movie?.directors || [])].join(' ').toLowerCase().includes($('search').value.toLowerCase()));
  list.sort((a, b) => $('sort').value === 'rating' ? b.rating - a.rating : $('sort').value === 'date' ? (b.date || '').localeCompare(a.date || '') : b.updated - a.updated);
  $('grid').innerHTML = list.length ? list.map(r => {
    const poster = safePoster(r.movie?.poster);
    return `<article class="card"><div class="cover ${poster ? 'poster' : ''}" aria-hidden="true">${poster ? `<img src="${poster}" alt="" loading="lazy" referrerpolicy="no-referrer">` : escape(Array.from(r.title).slice(0, 2).join(''))}</div><div class="body"><span class="badge">${r.status === 'want' ? 'WATCHLIST · 観たい' : 'WATCHED · 鑑賞済み'} ${escape(r.date)}</span><h3>${escape(r.title)}</h3><small>${escape(r.meta)}</small><p class="rating">${r.rating ? '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating) : '未評価'}</p>${r.review ? `<p class="review">${escape(r.review)}</p>` : ''}${movieHTML(r.movie)}<button data-edit="${escape(r.id)}">編集</button> <button data-info="${escape(r.id)}">${r.movie ? '情報を更新' : '映画情報を探す'}</button> <button data-delete="${escape(r.id)}">削除</button></div></article>`;
  }).join('') : `<div class="empty"><span class="eyebrow">YOUR FILM COLLECTION</span><h3>${records.length ? '該当する映画がありません' : '最初の一本を、記録しよう。'}</h3><p>${records.length ? '検索や絞り込みを変更してみてください。' : '好きな映画、観たい映画。<br>作品を検索して、あなたの映画の記録を始めましょう。'}</p></div>`;
}
function openRecord(record) {
  lookupVersion++;
  $('form').reset();
  for (const k of ['title', 'status', 'rating', 'date', 'meta', 'review']) if (record) $(k).value = record[k] ?? '';
  $('recordId').value = record?.id || '';
  draftMovie = record?.movie || null;
  $('lookup-results').innerHTML = '';
  $('lookup-status').textContent = credential ? '作品名を入力して検索してください。' : '最初に「映画情報を接続」から無料接続を設定してください。';
  $('lookup-preview').innerHTML = movieHTML(draftMovie);
  $('lookup').disabled = false;
  $('modal').showModal();
}
function showConnection() {
  $('credential').value = '';
  $('remember').checked = false;
  $('connection-status').textContent = credential ? '接続済みです。変更する場合は新しいキーを入力してください。' : '';
  $('connection').showModal();
}
async function searchMovies() {
  if (!credential) { showConnection(); return; }
  const query = $('title').value.trim();
  if (!query) { $('lookup-status').textContent = '検索したい作品名を入力してください。'; $('title').focus(); return; }
  const version = ++lookupVersion;
  $('lookup').disabled = true;
  $('lookup-status').textContent = '作品を検索しています…';
  $('lookup-results').innerHTML = '';
  try {
    const list = await FilmAPI.search(query, credential);
    if (version !== lookupVersion || !$('modal').open) return;
    $('lookup-status').textContent = list.length ? '公開年・ポスターを確認して作品を選んでください。' : '作品が見つかりませんでした。別の表記や原題でも検索できます。';
    $('lookup-results').innerHTML = list.map(m => `<button type="button" class="result" data-movie="${m.id}">${safePoster(m.poster) ? `<img src="${m.poster}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span><strong>${escape(m.title)}</strong><small>${escape(m.releaseDate.slice(0, 4) || '公開年不明')} · ${escape(m.originalTitle)}</small><small>${escape(m.overview.slice(0, 90))}</small></span></button>`).join('');
  } catch (error) {
    if (version === lookupVersion) $('lookup-status').textContent = error.message;
  } finally { if (version === lookupVersion) $('lookup').disabled = false; }
}
$('lookup-results').onclick = async event => {
  const button = event.target.closest('[data-movie]');
  if (!button) return;
  const version = ++lookupVersion;
  $('lookup').disabled = true;
  $('lookup-results').innerHTML = '';
  $('lookup-status').textContent = '作品情報と日本の配信先を取得しています…';
  try {
    const movie = await FilmAPI.details(Number(button.dataset.movie), credential);
    if (version !== lookupVersion || !$('modal').open) return;
    draftMovie = movie;
    if (!$('recordId').value) $('title').value = movie.title;
    $('lookup-preview').innerHTML = movieHTML(movie);
    $('lookup-status').textContent = '作品情報を反映しました。「保存する」で記録に保存します。';
  } catch (error) { if (version === lookupVersion) $('lookup-status').textContent = error.message; }
  finally { if (version === lookupVersion) $('lookup').disabled = false; }
};
$('connect').onclick = showConnection;
$('connection-cancel').onclick = () => $('connection').close();
$('disconnect').onclick = () => {
  try { localStorage.removeItem(credentialKey); credential = ''; $('connect').textContent = '映画情報を接続'; $('connection').close(); }
  catch (error) { $('connection-status').textContent = '接続設定を削除できませんでした。ブラウザの保存設定を確認してください。'; }
};
$('connection-form').onsubmit = async event => {
  event.preventDefault();
  const value = $('credential').value.trim();
  if (!value) return;
  $('connection-save').disabled = true;
  $('connection-status').textContent = 'TMDBとの接続を確認しています…';
  try {
    await FilmAPI.request('configuration', value);
    if ($('remember').checked) localStorage.setItem(credentialKey, value);
    else localStorage.removeItem(credentialKey);
    credential = value;
    $('credential').value = '';
    $('connect').textContent = '映画情報：接続済み';
    $('connection').close();
    if ($('modal').open) searchMovies();
  } catch (error) { $('connection-status').textContent = error.message; }
  finally { $('connection-save').disabled = false; }
};
if (credential) $('connect').textContent = '映画情報：接続済み';
$('lookup').onclick = searchMovies;
$('add').onclick = () => openRecord();
$('cancel').onclick = () => { lookupVersion++; $('modal').close(); };
$('modal').addEventListener('close', () => lookupVersion++);
$('form').onsubmit = event => {
  event.preventDefault();
  const title = $('title').value.trim();
  if (!title) { $('title').focus(); return; }
  const record = {
    id: $('recordId').value || crypto.randomUUID(), title, status: $('status').value,
    rating: Number($('rating').value), date: $('date').value, meta: $('meta').value.trim(),
    review: $('review').value.trim(), updated: Date.now(), ...(draftMovie ? { movie: draftMovie } : {})
  };
  if (persist([...records.filter(r => r.id !== record.id), record])) $('modal').close();
};
document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => {
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === button));
  render();
});
$('search').oninput = render;
$('sort').onchange = render;
$('grid').onclick = async event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.edit) openRecord(records.find(r => r.id === button.dataset.edit));
  if (button.dataset.delete && confirm('この映画の記録を削除しますか？')) persist(records.filter(r => r.id !== button.dataset.delete));
  if (button.dataset.info) {
    const record = records.find(r => r.id === button.dataset.info);
    if (!record.movie) { openRecord(record); searchMovies(); return; }
    if (!credential) { showConnection(); return; }
    button.disabled = true;
    button.textContent = '更新中…';
    try {
      const movie = await FilmAPI.details(record.movie.id, credential, record.movie);
      // Read the latest record after the request so concurrent personal edits survive.
      const latest = records.find(r => r.id === record.id);
      if (latest && latest.movie?.id === record.movie.id) persist(records.map(r => r.id === record.id ? { ...r, movie } : r));
    } catch (error) { alert(error.message); }
    finally { button.disabled = false; button.textContent = '情報を更新'; }
  }
};
$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'yoin-v1', records }, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `yoin-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('import').onclick = () => $('file').click();
$('file').onchange = async event => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    const data = JSON.parse(await file.text());
    if (data.format !== 'yoin-v1') throw new Error('invalid format');
    validateRecords(data.records);
    if (confirm(`${data.records.length}件を読み込みます。同じIDの記録はバックアップの内容で更新します。`)) {
      const merged = new Map(records.map(r => [r.id, r]));
      data.records.forEach(r => merged.set(r.id, r));
      persist([...merged.values()]);
    }
  } catch (error) { alert('バックアップを読み込めません。有効な余韻のJSONファイルを選んでください。'); }
  finally { $('file').value = ''; }
};
async function setupOffline() {
  const status = $('app-status');
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') { status.textContent = 'オンラインで利用できます。オフライン利用にはHTTPSで開いてください。'; return; }
  try {
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    const ready = () => { status.textContent = navigator.onLine ? 'オフライン準備完了 · 映画の検索・配信情報の更新はオンライン時に利用できます' : 'オフライン · 保存済みの作品情報と記録を利用できます'; };
    ready();
    window.addEventListener('online', ready);
    window.addEventListener('offline', ready);
  } catch (error) { status.textContent = 'オフライン準備ができませんでした。通信できる状態で開き直してください。'; }
}
render();
if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) $('install-guide').hidden = true;
setupOffline();
