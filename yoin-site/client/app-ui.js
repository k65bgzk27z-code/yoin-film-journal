'use strict';
// アプリらしい見た目と操作: 作品の詳細ページ、大きな★入力、下部タブ、ホーム画面アプリ（PWA）。
// 既存の保存処理・ポップアップ（sheet.js）・背景テーマはそのまま使い、表示と入力の部品だけを足す。

// ---------- 作品の詳細ページ（自分の記録） ----------
let rdId = null;
const backdropCache = new Map();
const filmKey = m => `${m.mediaType === 'tv' ? 'tv' : 'movie'}:${m.id}`;
const backdropUrl = path => /^\/[\w.-]+$/.test(path || '') ? `https://image.tmdb.org/t/p/w780${path}` : '';
function factsLine(m, r) {
  const year = (m?.releaseDate || '').slice(0, 4) || ((r?.meta || '').match(/(19\d{2}|20\d{2})年/) || [])[1] || '';
  const parts = [];
  if (year) parts.push(`${year}年`);
  if (m?.mediaType === 'tv') { if (m.seasons) parts.push(`シーズン${m.seasons}${m.episodes ? `・全${m.episodes}話` : ''}`); if (m.runtime) parts.push(`1話 約${m.runtime}分`); }
  else if (m?.runtime) parts.push(`${m.runtime}分`);
  if (m) parts.push(kindLabel(m));
  return parts.map(escape).join('<span class="dot">·</span>');
}
// 上部: 背景画像（TMDBの横長画像。取れなければポスターをぼかして使う）＋ポスター＋タイトル
function heroHTML(m, r, title) {
  const poster = safePoster(m?.poster), bd = m ? backdropCache.get(filmKey(m)) : '';
  const bg = bd || poster;
  const jp = m && m.mediaType !== 'tv' && m.japanTheatricalDate ? `<p class="rd-sub">日本公開 ${escape(m.japanTheatricalDate.replaceAll('-', '/'))}</p>` : '';
  return `<div class="rd-hero${bd ? ' has-bd' : ''}" style="--h:${posterHue(title)}"><span class="rd-bg"${bg ? ` style="background-image:url('${bg}')"` : ''}></span><div class="rd-hero-inner">${poster ? `<img class="rd-poster" src="${poster}" alt="${escape(title)}のポスター" referrerpolicy="no-referrer">` : posterPlaceholder({ title, movie: m, meta: r?.meta || '' }, 'rd-poster tile-ph')}<div class="rd-head"><h2>${escape(title)}</h2>${m?.originalTitle && m.originalTitle !== title ? `<p class="rd-orig">${escape(m.originalTitle)}</p>` : ''}<p class="rd-facts">${factsLine(m, r)}</p>${jp}</div></div></div>`;
}
function peopleHTML(m) {
  if (!m) return '';
  const genres = m.genres?.length ? `<div class="rd-chips">${m.genres.map(g => `<span class="chip">${escape(g)}</span>`).join('')}</div>` : '';
  const dir = m.directors?.length ? `<section class="rd-sec"><h3>${m.mediaType === 'tv' ? '制作' : '監督'}</h3><div class="rd-people">${m.directors.map(n => `<span class="rd-person">${personButton(n, 'director', m)}</span>`).join('')}</div></section>` : '';
  const cast = m.cast?.length ? `<section class="rd-sec"><h3>出演</h3><div class="rd-people rd-chips-scroll">${m.cast.map(p => `<span class="rd-person">${personButton(p.name, 'cast', m)}${p.character ? `<small>${escape(p.character)}</small>` : ''}</span>`).join('')}</div></section>` : '';
  return genres + dir + cast;
}
function aboutHTML(m) {
  if (!m) return '';
  const tv = m.mediaType === 'tv';
  return `${m.overview ? `<section class="rd-sec"><h3>あらすじ</h3><p class="rd-overview clamp">${escape(m.overview)}</p><button type="button" class="link-btn" data-more-overview="1">続きを読む</button></section>` : ''}<section class="rd-sec rd-where">${providerHTML(m)}</section><p class="source">作品情報：<a href="https://www.themoviedb.org/${tv ? 'tv' : 'movie'}/${m.id}" target="_blank" rel="noopener noreferrer">TMDB</a> · ${checkedLabel(m.checkedAt)}取得${!tv ? ` · 初公開 ${escape(dateLabel(m.releaseDate))}` : ''}</p>`;
}
function scoreHTML(r) {
  if (r.status === 'want') return `<div class="rd-score want"><span class="rd-want-mark">観たい</span><small>まだ観ていない作品</small></div>`;
  return `<div class="rd-score"><b class="rd-num${r.rating ? '' : ' none'}">${r.rating ? r.rating.toFixed(1) : '−.−'}</b><span>${starsHTML(r.rating, 'lg')}<small>${r.rating ? '私のスコア' : 'まだ評価していません'}</small></span></div>`;
}
function recordDetailHTML(r) {
  const m = r.movie, id = escape(r.id), views = viewingsOf(r);
  const write = r.status === 'want' ? `<button type="button" class="primary rd-write" data-mark-watched="${id}">✓ 観た！記録する</button>` : `<button type="button" class="primary rd-write" data-edit="${id}">${r.rating || r.review ? '✎ 評価・感想を編集' : '★ 評価・感想を書く'}</button>`;
  const progress = m?.mediaType === 'tv' ? `<section class="rd-sec"><h3>視聴の進み具合</h3>
    <form id="episode-form" data-record="${id}">
      <label>シーズン <input id="progress-season" type="number" inputmode="numeric" min="1" max="999" required value="${escape(r.progress?.season || 1)}"></label>
      <label>最後に観た話 <input id="progress-episode" type="number" inputmode="numeric" min="0" max="9999" required value="${escape(r.progress?.episode || 0)}"></label>
      <div class="actions"><button type="submit">進捗を保存</button><button type="submit" name="next-episode">＋1話</button></div>
    </form></section>` : '';
  const review = r.review ? (r.spoiler ? `<details class="spoiler"><summary>ネタバレを含む感想 · タップで表示</summary><p class="review">${escape(r.review)}</p></details>` : `<p class="review">${escape(r.review)}</p>`) : `<p class="rd-empty">まだ感想はありません。</p>`;
  const facts = [];
  if (r.status === 'watched') facts.push(['観た日', r.date ? escape(dateText(r.date)) : '<span class="muted">未入力</span>']);
  const method = methodLabel(r.method, r.service);
  if (method) facts.push(['鑑賞方法', escape(method)]);
  if (r.meta) facts.push(['メモ', escape(r.meta)]);
  const history = r.status === 'watched' ? `<section class="rd-sec"><h3>鑑賞履歴 <small>${views.length}回</small></h3><ol class="rd-history">${[...views].reverse().map((v, i) => `<li><span class="rd-h-no">${views.length - i}</span><span class="rd-h-main"><b>${escape(v.date ? dateText(v.date) : '日付なし')}</b>${v.method ? `<span class="view-meta">${escape(methodLabel(v.method, v.service))}</span>` : ''}${v.note ? `<small>${escape(v.note)}</small>` : ''}</span>${v.rating ? `<span class="rd-h-rate">★ ${v.rating.toFixed(1)}</span>` : ''}</li>`).join('')}</ol><button type="button" data-rewatch="${id}">＋ 再鑑賞を記録</button></section>` : '';
  return `${heroHTML(m, r, r.title)}
  <div class="rd-score-row">${scoreHTML(r)}${write}</div>
  ${r.enrichment?.status === 'review' ? '<p class="review-needed">作品の確認が必要 · 自動では紐づけていません。「作品情報を探す」から選べます。</p>' : ''}
  ${peopleHTML(m)}
  <section class="rd-sec rd-mine"><h3>私の感想</h3>${review}${facts.length ? `<dl class="rd-facts-list">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}${r.status === 'watched' && !r.date ? quickDateHTML(r) : ''}</section>
  ${progress}
  ${history}
  ${aboutHTML(m)}
  <div class="rd-more"><button type="button" data-info="${id}">${m ? '作品情報を更新' : '作品情報を探す'}</button><button type="button" data-addlist="${id}">リストに追加</button><button type="button" class="danger" data-delete="${id}">ゴミ箱へ移動</button></div>`;
}
function renderRecordDetail() {
  const d = $('record-detail');
  if (!rdId || !d.open) return;
  const r = records.find(x => x.id === rdId);
  if (!r) { rdId = null; d.close(); return; }
  const scroll = d.scrollTop, openSpoiler = d.querySelector('#rd-content details.spoiler[open]');
  $('rd-content').innerHTML = recordDetailHTML(r);
  if (openSpoiler) d.querySelector('#rd-content details.spoiler')?.setAttribute('open', '');
  d.scrollTop = scroll;
  const id = escape(r.id);
  $('rd-actions').innerHTML = r.status === 'want'
    ? `<button type="button" data-addlist="${id}">＋ リスト</button><button type="button" class="primary" data-mark-watched="${id}">✓ 観た！記録する</button>`
    : `<button type="button" data-addlist="${id}">＋ リスト</button><button type="button" data-rewatch="${id}">＋ 再鑑賞</button><button type="button" class="primary" data-edit="${id}">★ 評価・感想</button>`;
}
function openRecordDetail(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;
  rdId = id;
  $('rd-status').textContent = '';
  const d = $('record-detail');
  if (!d.open) d.showModal();
  renderRecordDetail();
  d.scrollTop = 0;
  if (r.movie) loadBackdrop(r.movie, $('rd-content'));
}
async function loadBackdrop(m, container) {
  if (!m || !credential || !Number.isInteger(m.id)) return;
  const key = filmKey(m);
  if (!backdropCache.has(key)) {
    try { const data = await FilmAPI.request(`${m.mediaType === 'tv' ? 'tv' : 'movie'}/${m.id}`, credential); backdropCache.set(key, backdropUrl(data.backdrop_path)); }
    catch { return; }
  }
  const url = backdropCache.get(key), hero = container?.querySelector('.rd-hero');
  if (!url || !hero || hero.classList.contains('has-bd')) return;
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.onload = () => { const bg = hero.querySelector('.rd-bg'); if (!bg) return; bg.style.backgroundImage = `url('${url}')`; hero.classList.add('has-bd'); };
  img.src = url;
}
// 作品を探す → 作品の詳細も同じ見た目にする（自分の記録があればスコアも出す）
function filmDetailHTML(film, saved) {
  const score = saved ? `<div class="rd-score-row">${scoreHTML(saved)}<button type="button" class="rd-open-record" data-open-record="${escape(saved.id)}">自分の記録を見る</button></div>` : '';
  return `${heroHTML(film, saved, film.title)}${score}${peopleHTML(film)}${aboutHTML(film)}`;
}
async function onDetailClick(event) {
  const b = event.target.closest('button');
  if (!b) return;
  if (b.dataset.moreOverview) { const p = b.previousElementSibling; p.classList.toggle('clamp'); b.textContent = p.classList.contains('clamp') ? '続きを読む' : '閉じる'; return; }
  if (b.dataset.markWatched) { const r = records.find(x => x.id === b.dataset.markWatched); if (r && storageHealthy) {
    $('rd-status').textContent = '同期中…';
    $('rd-status').textContent = await quickWatch(r.movie, r) ? '今日の鑑賞を保存しました。' : '未同期 · もう一度お試しください。';
  } return; }
  if (b.dataset.openRecord) { $('film-detail').close(); openRecordDetail(b.dataset.openRecord); return; }
  if (b.dataset.edit || b.dataset.rewatch || b.dataset.addlist || b.dataset.delete || b.dataset.info) {
    if (!storageHealthy) { $('rd-status').textContent = '読み込み中です。少し待ってからもう一度お試しください。'; return; }
    await $('grid').onclick({ target: b });
  }
}
$('record-detail').addEventListener('submit', async event => {
  if (event.target.id !== 'episode-form') return;
  event.preventDefault();
  if (!storageHealthy) return;
  const record = records.find(r => r.id === event.target.dataset.record);
  if (!record) return;
  const season = $('progress-season').valueAsNumber;
  const episode = $('progress-episode').valueAsNumber + (event.submitter?.name === 'next-episode' ? 1 : 0);
  if (episode > 9999) return;
  $('rd-status').textContent = '同期中…';
  const saved = await persist(records.map(r => r.id === record.id ? { ...r, progress: { season, episode }, updated: Date.now() } : r));
  $('rd-status').textContent = saved ? '視聴の進み具合を保存しました。' : '未同期 · もう一度お試しください。';
});
$('record-detail').addEventListener('click', onDetailClick);
$('film-content').addEventListener('click', onDetailClick);
$('rd-close').onclick = () => { rdId = null; $('record-detail').close(); };
$('record-detail').addEventListener('close', () => { rdId = null; });
{
  const before = onFeaturesLibraryChanged;
  onFeaturesLibraryChanged = function () { before(); renderRecordDetail(); };
}

// ---------- ★の入力（大きな星・0.1刻み） ----------
// 保存されるのは今まで通り select の値（0〜5、0.1刻み、0 = 未評価）。星はその見た目と操作だけ。
const formSyncers = [];
function starInput(select, zeroLabel) {
  const box = document.createElement('div');
  box.className = 'star-input';
  box.innerHTML = `<div class="si-top"><b class="si-num"></b><span class="si-hint"></span></div><div class="si-stars" role="slider" tabindex="0" aria-label="評価" aria-valuemin="0" aria-valuemax="5">${starsHTML(0, 'xl')}</div><div class="si-steps"><button type="button" data-step="-0.5">−0.5</button><button type="button" data-step="-0.1">−0.1</button><button type="button" data-step="0.1">＋0.1</button><button type="button" data-step="0.5">＋0.5</button><button type="button" class="si-clear">${escape(zeroLabel)}</button></div>`;
  const num = box.querySelector('.si-num'), hint = box.querySelector('.si-hint'), stars = box.querySelector('.si-stars'), visual = stars.firstElementChild;
  const value = () => Number(select.value) || 0;
  function update() {
    const v = value();
    num.textContent = v ? v.toFixed(1) : '−.−';
    num.classList.toggle('none', !v);
    hint.textContent = v ? '星をなぞると0.1刻み・タップで0.5刻み' : `${zeroLabel} · 星をタップ／なぞって評価`;
    visual.style.setProperty('--v', v);
    stars.setAttribute('aria-valuenow', String(v));
    stars.setAttribute('aria-valuetext', v ? `★${v.toFixed(1)}` : zeroLabel);
  }
  function set(v) {
    v = Math.max(0, Math.min(5, Math.round(v * 10) / 10));
    const next = v ? String(v) : '0';
    if (select.value !== next) { select.value = next; select.dispatchEvent(new Event('change', { bubbles: true })); }
    update();
  }
  const at = (e, step) => { const rect = visual.getBoundingClientRect(); const raw = (e.clientX - rect.left) / rect.width * 5; return step === 0.5 ? Math.max(0.5, Math.ceil(raw * 2) / 2) : Math.max(0.1, Math.ceil(raw * 10) / 10); };
  let drag = null;
  stars.addEventListener('pointerdown', e => { drag = { x: e.clientX, moved: false }; stars.setPointerCapture?.(e.pointerId); });
  stars.addEventListener('pointermove', e => { if (!drag) return; if (Math.abs(e.clientX - drag.x) > 6) drag.moved = true; if (drag.moved) set(at(e, 0.1)); });
  stars.addEventListener('pointerup', e => { if (!drag) return; set(at(e, drag.moved ? 0.1 : 0.5)); drag = null; });
  stars.addEventListener('pointercancel', () => { drag = null; });
  stars.addEventListener('keydown', e => {
    const d = { ArrowRight: 0.1, ArrowUp: 0.1, ArrowLeft: -0.1, ArrowDown: -0.1, PageUp: 0.5, PageDown: -0.5 }[e.key];
    if (d) { e.preventDefault(); set(value() + d); } else if (e.key === 'Home') { e.preventDefault(); set(0); } else if (e.key === 'End') { e.preventDefault(); set(5); }
  });
  box.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.classList.contains('si-clear')) set(0); else if (b.dataset.step) set(Math.max(value() ? 0.1 : 0, value() + Number(b.dataset.step))); });
  select.addEventListener('change', update);
  formSyncers.push(update);
  update();
  return box;
}
// select をボタンの並び（セグメント）で選べるようにする。select は隠して値の保存先として残す。
function segmented(select, { allowEmpty = false, className = '' } = {}) {
  const box = document.createElement('div');
  box.className = 'seg ' + className;
  box.setAttribute('role', 'group');
  const options = [...select.options].filter(o => o.value !== '');
  box.innerHTML = options.map(o => `<button type="button" data-v="${escape(o.value)}" aria-pressed="false">${escape(o.textContent)}</button>`).join('');
  const update = () => box.querySelectorAll('button').forEach(b => { const on = b.dataset.v === select.value; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  box.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    const next = allowEmpty && select.value === b.dataset.v ? '' : b.dataset.v;
    if (select.value !== next) { select.value = next; select.dispatchEvent(new Event('change', { bubbles: true })); }
    update();
  });
  select.addEventListener('change', update);
  select.hidden = true;
  select.after(box);
  formSyncers.push(update);
  update();
  return box;
}
function syncFormWidgets() { formSyncers.forEach(f => f()); }
(function buildRecordForm() {
  const form = $('form'), titleLabel = $('title').closest('label');
  const rate = document.createElement('section');
  rate.className = 'rate-block';
  const status = $('status'), rating = $('rating');
  const statusLabel = status.closest('label'), ratingLabel = rating.closest('label'), oldRow = statusLabel.parentElement;
  titleLabel.after(rate);
  rate.append(statusLabel);
  segmented(status, { className: 'seg-status' });
  statusLabel.classList.add('rate-status');
  const stars = starInput(rating, '未評価');
  ratingLabel.hidden = true;
  rate.append(stars, ratingLabel);
  if (!oldRow.children.length) oldRow.remove();
  // ★のすぐ下に感想とネタバレ（Filmarksと同じ順）。作品検索・日付などの詳細はその後。
  const reviewLabel = $('review').closest('label'), spoilerLabel = $('spoiler').closest('label');
  spoilerLabel.classList.add('switch');
  rate.after(reviewLabel, spoilerLabel);
  const toggleRate = () => rate.classList.toggle('is-want', $('status').value === 'want');
  $('status').addEventListener('change', toggleRate);
  formSyncers.push(toggleRate);
  segmented($('method'), { allowEmpty: true, className: 'seg-method' });
  // 再鑑賞
  const rwRating = $('rw-rating'), rwLabel = rwRating.closest('label');
  rwLabel.hidden = true;
  rwLabel.before(starInput(rwRating, '今回は付けない'));
  segmented($('rw-method'), { allowEmpty: true, className: 'seg-method' });
})();
// ポップアップが開く直前（値が入った後）に星やボタンの表示を合わせる。sheet.js の未保存チェックより前に行う。
{
  const show = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function () {
    if (this.id === 'modal' || this.id === 'rewatch-dialog') syncFormWidgets();
    return show.call(this);
  };
}

// ---------- 下部タブ・画面の構成 ----------
{
  // 棚の整理ツールは普段は畳んでおく
  const tools = document.querySelector('.enrich-tools');
  if (tools) {
    const det = document.createElement('details');
    det.className = 'shelf-tools';
    det.innerHTML = '<summary>棚の整理（ポスター追加・作品の確認）</summary>';
    tools.before(det);
    det.append(tools);
  }
  // スマホ: 右下の「＋ 記録」ボタン
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'fab';
  fab.setAttribute('aria-label', '作品を記録');
  fab.innerHTML = '<span aria-hidden="true">＋</span>記録';
  fab.onclick = () => { if (!$('add').disabled) $('add').click(); };
  document.body.append(fab);
  const bar = document.createElement('div');
  bar.className = 'statusbar-bg';
  bar.setAttribute('aria-hidden', 'true');
  document.body.prepend(bar);
  const setTab = tab => { document.body.dataset.tab = tab; };
  const before = onTabShown;
  onTabShown = function (tab) {
    before(tab);
    const changed = document.body.dataset.tab !== tab;
    setTab(tab);
    if (changed && window.matchMedia('(max-width:700px)').matches) window.scrollTo({ top: 0 });
  };
  setTab(currentTab);
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) document.documentElement.classList.add('standalone');
}

// ---------- ホーム画面アプリ（PWA） ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {}); });
}
