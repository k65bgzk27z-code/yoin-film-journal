'use strict';
// Filmarks-style features: re-watch, lists, stats, person pages, notices.
const tokyoToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
const starText = v => v ? '★ ' + v.toFixed(1) : '未評価';
const shelfBadge = r => r ? `<span class="shelf-badge ${r.status}">${r.status === 'want' ? '観たい' : '鑑賞済み'}${r.status === 'watched' && r.rating ? ' ' + starText(r.rating) : ''}</span>` : '';
const thumb = (poster, title) => safePoster(poster) ? `<img class="thumb" src="${poster}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="thumb thumb-empty" aria-hidden="true">${escape(Array.from(title || '').slice(0, 2).join(''))}</span>`;
const closeDialog = id => { if ($(id).open) $(id).close(); };
for (const [button, dialog] of [['person-close', 'person-dialog'], ['rw-cancel', 'rewatch-dialog'], ['list-pick-close', 'list-pick'], ['list-edit-cancel', 'list-edit'], ['list-add-close', 'list-add']]) $(button).onclick = () => closeDialog(dialog);

// ---------- 再鑑賞 ----------
let rewatchRecordId = null;
$('rw-rating').innerHTML = $('rating').innerHTML.replace('>未評価<', '>今回は付けない<');
const toggleRwService = () => { $('rw-service-field').hidden = $('rw-method').value !== 'streaming'; };
$('rw-method').onchange = toggleRwService;
function openRewatch(record) {
  if (!record || !storageHealthy) return;
  rewatchRecordId = record.id;
  $('rewatch-form').reset();
  $('rewatch-title').textContent = `『${record.title}』 ${viewingsOf(record).length + 1}回目の鑑賞`;
  $('rw-date').value = tokyoToday();
  $('rw-method').value = record.method || '';
  $('rw-service').value = record.service || '';
  toggleRwService();
  $('rewatch-dialog').showModal();
}
$('rewatch-form').onsubmit = async event => {
  event.preventDefault();
  const record = records.find(r => r.id === rewatchRecordId);
  if (!record) return;
  const method = $('rw-method').value;
  const viewing = { id: crypto.randomUUID(), date: $('rw-date').value, method, service: method === 'streaming' ? $('rw-service').value.trim() : '', rating: Number($('rw-rating').value), note: $('rw-note').value.trim() };
  if (await persist(records.map(r => r.id === record.id ? { ...addViewing(r, viewing), updated: Date.now() } : r))) closeDialog('rewatch-dialog');
};

// ---------- 自分で作るリスト ----------
let lists = [], listsLoaded = false, currentListId = null, listEditMode = null, pendingListRecord = null;
async function loadLists() { const data = await api('lists'); lists = data.lists; listsLoaded = true; renderLists(); }
const recordById = id => records.find(r => r.id === id);
async function saveList(list, changes) {
  try {
    const data = await api('lists/' + encodeURIComponent(list.id), { method: 'PUT', body: JSON.stringify({ _revision: list._revision, ...changes }) });
    lists = lists.map(l => l.id === list.id ? data.list : l);
    renderLists();
    return data.list;
  } catch (error) { alert(error.message); await loadLists().catch(() => {}); return null; }
}
const itemsOf = list => list.items.map(i => ({ recordId: i.recordId, title: i.title, note: i.note }));
function renderLists() {
  if ($('lists').hidden) return;
  const view = $('lists-view');
  if (!listsLoaded) { view.innerHTML = '<p class="lookup-note">リストを読み込んでいます…</p>'; return; }
  const list = lists.find(l => l.id === currentListId);
  if (!list) {
    currentListId = null;
    view.innerHTML = lists.length ? `<div class="list-grid">${lists.map(l => `<button class="list-card" data-open-list="${escape(l.id)}"><span class="list-posters">${l.items.slice(0, 4).map(i => { const r = recordById(i.recordId); return thumb(r?.movie?.poster, r?.title || i.title); }).join('')}</span><strong>${escape(l.name)}</strong><small>${l.items.length}作品${l.description ? ' · ' + escape(l.description.slice(0, 60)) : ''}</small></button>`).join('')}</div>` : '<div class="catalog-empty"><h3>まだリストがありません</h3><p>「＋ 新しいリスト」から、生涯ベスト10や「雨の日に観たい映画」などを作れます。</p></div>';
    return;
  }
  view.innerHTML = `<div class="list-detail"><button data-list-back="1">← リスト一覧</button><h3>${escape(list.name)}</h3>${list.description ? `<p class="review">${escape(list.description)}</p>` : ''}<div class="list-tools"><button class="primary" data-list-add="1">＋ 作品を追加</button><button data-list-edit="1">名前・説明を編集</button><button data-list-delete="1">リストを削除</button></div>${list.items.length ? `<ol class="list-items">${list.items.map((item, i) => { const r = recordById(item.recordId); return `<li><span class="rank">${i + 1}</span>${thumb(r?.movie?.poster, r?.title || item.title)}<span class="list-item-text"><strong>${escape(r?.title || item.title)}</strong><small>${r ? shelfBadge(r) : '棚から削除された作品'}</small>${item.note ? `<small>${escape(item.note)}</small>` : ''}</span><span class="list-item-tools"><button data-move="${i}" data-dir="-1" aria-label="上へ" ${i === 0 ? 'disabled' : ''}>↑</button><button data-move="${i}" data-dir="1" aria-label="下へ" ${i === list.items.length - 1 ? 'disabled' : ''}>↓</button><button data-remove-item="${i}" aria-label="リストから外す">✕</button></span></li>`; }).join('')}</ol>` : '<p class="lookup-note">まだ作品がありません。「＋ 作品を追加」から棚の作品を選んでください。</p>'}</div>`;
}
$('lists-view').onclick = async event => {
  const b = event.target.closest('button');
  if (!b) return;
  const list = lists.find(l => l.id === currentListId);
  if (b.dataset.openList) { currentListId = b.dataset.openList; renderLists(); window.scrollTo({ top: $('lists').offsetTop - 10 }); return; }
  if (b.dataset.listBack) { currentListId = null; renderLists(); return; }
  if (!list) return;
  if (b.dataset.listAdd) { $('list-add-query').value = ''; renderListAdd(); $('list-add').showModal(); }
  if (b.dataset.listEdit) openListEdit(list);
  if (b.dataset.listDelete && confirm(`リスト「${list.name}」をゴミ箱に移動しますか？（作品の記録は消えません・30日以内なら元に戻せます）`)) {
    try { await api('lists/' + encodeURIComponent(list.id), { method: 'DELETE', body: JSON.stringify({ _revision: list._revision }) }); currentListId = null; await loadLists(); } catch (error) { alert(error.message); }
  }
  if (b.dataset.move) {
    const i = Number(b.dataset.move), j = i + Number(b.dataset.dir), items = itemsOf(list);
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    b.disabled = true;
    await saveList(list, { items });
  }
  if (b.dataset.removeItem) { const items = itemsOf(list); items.splice(Number(b.dataset.removeItem), 1); await saveList(list, { items }); }
};
function openListEdit(list) {
  listEditMode = list ? list.id : 'new';
  $('list-edit-heading').textContent = list ? 'リストを編集' : '新しいリスト';
  $('list-name').value = list?.name || '';
  $('list-description').value = list?.description || '';
  $('list-edit').showModal();
}
$('list-new').onclick = () => { pendingListRecord = null; openListEdit(null); };
$('list-edit-form').onsubmit = async event => {
  event.preventDefault();
  const name = $('list-name').value.trim(), description = $('list-description').value.trim();
  if (!name) return;
  try {
    if (listEditMode === 'new') {
      const pending = pendingListRecord ? recordById(pendingListRecord) : null;
      const data = await api('lists', { method: 'POST', body: JSON.stringify({ name, description, items: pending ? [{ recordId: pending.id, title: pending.title, note: '' }] : [] }) });
      lists = [data.list, ...lists];
      if (!pending) currentListId = data.list.id;
      pendingListRecord = null;
      closeDialog('list-edit'); closeDialog('list-pick');
      if (pending) $('notice').textContent = `リスト「${name}」を作って『${pending.title}』を追加しました。`;
      renderLists();
    } else {
      const list = lists.find(l => l.id === listEditMode);
      if (list && await saveList(list, { name, description })) closeDialog('list-edit');
    }
  } catch (error) { alert(error.message); }
};
function renderListAdd() {
  const list = lists.find(l => l.id === currentListId);
  if (!list) return;
  const q = $('list-add-query').value.trim().toLowerCase(), inList = new Set(list.items.map(i => i.recordId));
  const found = records.filter(r => !q || [r.title, r.movie?.originalTitle].join(' ').toLowerCase().includes(q)).sort((a, b) => (b.status === 'watched') - (a.status === 'watched') || b.rating - a.rating).slice(0, 60);
  $('list-add-results').innerHTML = found.map(r => `<button data-add-record="${escape(r.id)}" ${inList.has(r.id) ? 'disabled' : ''}>${thumb(r.movie?.poster, r.title)}<span><strong>${escape(r.title)}</strong><small>${inList.has(r.id) ? '✓ 追加済み' : shelfBadge(r)}</small></span></button>`).join('') || '<p class="lookup-note">該当する作品がありません。</p>';
}
$('list-add-query').oninput = renderListAdd;
$('list-add-results').onclick = async event => {
  const b = event.target.closest('[data-add-record]');
  const list = lists.find(l => l.id === currentListId), r = b && recordById(b.dataset.addRecord);
  if (!list || !r || list.items.some(i => i.recordId === r.id)) return;
  b.disabled = true;
  if (await saveList(list, { items: [...itemsOf(list), { recordId: r.id, title: r.title, note: '' }] })) renderListAdd();
};
async function openListPick(record) {
  if (!record) return;
  pendingListRecord = record.id;
  $('list-pick-title').textContent = `『${record.title}』を追加するリストを選んでください。`;
  $('list-pick-options').innerHTML = '<p class="lookup-note">読み込み中…</p>';
  $('list-pick').showModal();
  try { if (!listsLoaded) await loadLists(); } catch (error) { $('list-pick-options').innerHTML = `<p class="lookup-note">${escape(error.message)}</p>`; return; }
  $('list-pick-options').innerHTML = lists.map(l => { const has = l.items.some(i => i.recordId === record.id); return `<button data-pick-list="${escape(l.id)}" ${has ? 'disabled' : ''}><span><strong>${escape(l.name)}</strong><small>${has ? '✓ 追加済み' : l.items.length + '作品'}</small></span></button>`; }).join('') || '<p class="lookup-note">まだリストがありません。下のボタンから作れます。</p>';
}
$('list-pick-options').onclick = async event => {
  const b = event.target.closest('[data-pick-list]');
  const list = b && lists.find(l => l.id === b.dataset.pickList), r = recordById(pendingListRecord);
  if (!list || !r) return;
  b.disabled = true;
  if (await saveList(list, { items: [...itemsOf(list), { recordId: r.id, title: r.title, note: '' }] })) { closeDialog('list-pick'); $('notice').textContent = `『${r.title}』をリスト「${list.name}」に追加しました。`; }
};
$('list-pick-new').onclick = () => { listEditMode = 'new'; $('list-edit-heading').textContent = '新しいリスト'; $('list-name').value = ''; $('list-description').value = ''; $('list-edit').showModal(); };

// ---------- 統計 ----------
let statsYear = null;
function vchart(entries, max = Math.max(1, ...entries.map(e => e[1]))) {
  return `<div class="vchart">${entries.map(([label, n]) => `<div class="vbar" title="${escape(label)}: ${n}"><span class="vbar-val">${n || ''}</span><span class="vbar-track"><span class="vbar-fill" style="height:${(n / max * 100).toFixed(1)}%"></span></span><span class="vbar-label">${escape(label)}</span></div>`).join('')}</div>`;
}
function hchart(entries, extra = () => '') {
  const max = Math.max(1, ...entries.map(e => e[1]));
  return entries.length ? `<div class="hchart">${entries.map((e, i) => `<div class="hbar"><span class="hbar-label">${e[2] || escape(e[0])}</span><span class="hbar-track"><span style="width:${(e[1] / max * 100).toFixed(1)}%"></span></span><span class="hbar-val">${e[1]}${extra(e, i)}</span></div>`).join('')}</div>` : '<p class="lookup-note">作品情報が紐づいた記録がまだありません。</p>';
}
let recapMonth = '';
function renderRecap(watched, monthly) {
  const today = tokyoToday();
  const lastYear = `${Number(today.slice(0, 4)) - 1}${today.slice(4, 7)}`;
  const options = [...new Set([lastYear, ...monthly.map(v => v.date.slice(0, 7))])].sort().reverse();
  if (!options.includes(recapMonth)) recapMonth = lastYear;
  const monthViews = monthly.filter(v => v.date.startsWith(recapMonth));
  const titles = [...new Map(monthViews.sort((a, b) => b.date.localeCompare(a.date)).map(v => [v.record.id, v.record])).values()];
  const favorites = watched.filter(r => r.rating >= 4).sort((a, b) => b.rating - a.rating || b.updated - a.updated);
  const rows = list => list.length ? `<ul>${list.map(r => `<li><button type="button" data-recap-record="${escape(r.id)}">${escape(r.title)}</button>${r.rating ? ` ★${r.rating.toFixed(1)}` : ''}${r.review ? ' · 感想あり' : ''}</li>`).join('')}</ul>` : '<p>該当する記録はありません。</p>';
  return `<section class="stat-block"><h3>鑑賞を振り返る</h3>
    <label>鑑賞月 <select id="recap-month">${options.map(m => `<option value="${m}"${m === recapMonth ? ' selected' : ''}>${dateText(m)}</option>`).join('')}</select></label>
    <p>${titles.length}作品 · ${monthViews.length}回の鑑賞</p>${rows(titles)}
    <details><summary>★4以上の作品（${favorites.length}件）</summary>${rows(favorites)}</details></section>`;
}
$('stats-content').addEventListener('click', event => {
  const button = event.target.closest('[data-recap-record]');
  if (button) openRecordDetail(button.dataset.recapRecord);
});
function renderStats() {
  if ($('stats-view').hidden) return;
  const watched = records.filter(r => r.status === 'watched'), rated = watched.filter(r => r.rating > 0);
  const views = watched.flatMap(r => viewingsOf(r).map(v => ({ ...v, record: r })));
  const dated = views.filter(v => /^\d{4}/.test(v.date || '')), monthly = dated.filter(v => /^\d{4}-\d{2}/.test(v.date));
  const years = [...new Set(dated.map(v => v.date.slice(0, 4)))].sort();
  if (!years.includes(statsYear)) statsYear = years.at(-1) || null;
  const byYear = years.map(y => [y, dated.filter(v => v.date.startsWith(y)).length]);
  const months = Array.from({ length: 12 }, (_, i) => [`${i + 1}月`, monthly.filter(v => v.date.startsWith(`${statsYear}-${String(i + 1).padStart(2, '0')}`)).length]);
  const yearOnly = dated.filter(v => v.date.length === 4 && v.date === statsYear).length;
  const buckets = Array.from({ length: 10 }, (_, i) => [(i / 2).toFixed(1), 0]);
  for (const r of rated) buckets[Math.min(9, Math.floor(r.rating * 2 + 0.000001))][1]++;
  const tally = (list, keyFn) => { const m = new Map(); for (const r of list) for (const k of keyFn(r)) { const e = m.get(k) || { n: 0, sum: 0, rated: 0, movie: r.movie }; e.n++; if (r.rating > 0) { e.sum += r.rating; e.rated++; } m.set(k, e); } return [...m.entries()].sort((a, b) => b[1].n - a[1].n || (b[1].sum / (b[1].rated || 1)) - (a[1].sum / (a[1].rated || 1))).slice(0, 10); };
  const avg = e => e.rated ? ` <small>平均★${(e.sum / e.rated).toFixed(1)}</small>` : '';
  const genres = tally(watched, r => r.movie?.genres || []).map(([k, e]) => [k, e.n, null, e]);
  const directors = tally(watched, r => r.movie?.directors || []).map(([k, e]) => [k, e.n, personButton(k, 'director', e.movie), e]);
  const cast = tally(watched, r => (r.movie?.cast || []).slice(0, 5).map(p => p.name)).map(([k, e]) => [k, e.n, personButton(k, 'cast', e.movie), e]);
  const methodCounts = Object.entries(METHOD_LABELS).map(([k, label]) => [label, views.filter(v => v.method === k).length]).filter(e => e[1]);
  const unsetMethods = views.filter(v => !v.method).length;
  const rewatched = watched.filter(r => viewingsOf(r).length > 1).length;
  const thisYear = tokyoToday().slice(0, 4);
  $('stats-content').innerHTML = `<div class="stats stat-cards"><span><b>${watched.length}</b>鑑賞作品</span><span><b>${views.length}</b>総鑑賞回数</span><span><b>${rated.length ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(2) : '—'}</b>平均★</span><span><b>${dated.filter(v => v.date.startsWith(thisYear)).length}</b>${thisYear}年の鑑賞</span><span><b>${rewatched}</b>再鑑賞した作品</span><span><b>${records.filter(r => r.status === 'want').length}</b>観たい</span></div>
  ${renderRecap(watched, monthly)}
  <section class="stat-block"><h3>年別の鑑賞回数</h3>${byYear.length ? vchart(byYear.slice(-15)) : ''}<p class="lookup-note">${dated.length ? `鑑賞日が入っている ${dated.length}回を集計しています。` : 'まだ鑑賞日が入っている記録がありません。'}${views.length - dated.length ? `鑑賞日なし ${views.length - dated.length}回（私の作品棚の「観た日が未入力」から年・月だけでも入れられます）。` : ''}</p></section>
  ${statsYear ? `<section class="stat-block"><h3>月別の鑑賞回数 <select id="stats-year" aria-label="年">${years.map(y => `<option ${y === statsYear ? 'selected' : ''}>${y}</option>`).join('')}</select></h3>${vchart(months)}${yearOnly ? `<p class="lookup-note">${statsYear}年のうち、月が未入力の ${yearOnly}回は月別に含みません。</p>` : ''}</section>` : ''}
  <section class="stat-block"><h3>★の分布 <small class="muted">評価済み ${rated.length}作品・未評価 ${watched.length - rated.length}作品</small></h3>${vchart(buckets.map(([l, n]) => [l, n]))}<p class="lookup-note">各棒は ★の値以上〜0.5未満（4.5は5.0を含む）。</p></section>
  <section class="stat-block"><h3>鑑賞方法</h3>${methodCounts.length ? hchart(methodCounts) : ''}<p class="lookup-note">${unsetMethods ? `鑑賞方法が未設定 ${unsetMethods}回。` : ''}記録の編集画面や再鑑賞で「劇場・配信・TV・DVD/BD」を選べます。</p></section>
  <div class="stat-two"><section class="stat-block"><h3>よく観るジャンル</h3>${hchart(genres, e => avg(e[3]))}</section><section class="stat-block"><h3>よく観る監督・制作</h3>${hchart(directors, e => avg(e[3]))}<p class="lookup-note">名前をタップすると作品一覧を開きます。</p></section></div>
  <section class="stat-block"><h3>よく観る俳優 <small class="muted">各作品の主要キャスト5名から</small></h3>${hchart(cast, e => avg(e[3]))}</section>`;
  $('recap-month').onchange = event => { recapMonth = event.target.value; renderStats(); };
  const sel = $('stats-year');
  if (sel) sel.onchange = () => { statsYear = sel.value; renderStats(); };
}

// ---------- 監督・俳優ページ ----------
let personState = null, personVersion = 0;
const HIDDEN_TV_GENRES = [10767, 10763]; // talk / news shows
function personFilm(c) {
  const media = c.media_type === 'tv' ? 'tv' : 'movie';
  return { id: c.id, mediaType: media, title: String(c.title || c.name || ''), originalTitle: String(c.original_title || c.original_name || ''), releaseDate: /^\d{4}-\d{2}-\d{2}/.test(c.release_date || c.first_air_date || '') ? (c.release_date || c.first_air_date).slice(0, 10) : '', poster: /^\/[\w.-]+$/.test(c.poster_path || '') ? 'https://image.tmdb.org/t/p/w500' + c.poster_path : '', genreIds: c.genre_ids || [], roles: [c.job ? ({ Director: '監督', Creator: '制作', 'Series Director': 'シリーズ監督' }[c.job] || c.job) : c.character ? c.character + ' 役' : ''].filter(Boolean) };
}
function mergeFilms(list) {
  const map = new Map();
  for (const c of list) {
    if (!Number.isInteger(c.id) || c.id < 1) continue;
    const f = personFilm(c), k = f.mediaType + ':' + f.id, prev = map.get(k);
    if (prev) prev.roles = [...new Set([...prev.roles, ...f.roles])]; else map.set(k, f);
  }
  return [...map.values()].sort((a, b) => (!a.releaseDate) - (!b.releaseDate) || b.releaseDate.localeCompare(a.releaseDate));
}
async function openPerson(name, role, movieId, media) {
  if (!credential) { showConnection(); return; }
  const version = ++personVersion;
  personState = null;
  $('person-content').innerHTML = '';
  $('person-status').textContent = `${name} さんの作品を探しています…`;
  if (!$('person-dialog').open) $('person-dialog').showModal();
  try {
    let id = null;
    if (Number.isInteger(movieId) && movieId > 0) {
      const data = await FilmAPI.request(`${media}/${movieId}`, credential, { append_to_response: 'credits' });
      const pool = role === 'director' ? [...(data.created_by || []), ...(data.credits?.crew || []).filter(p => p.job === 'Director')] : (data.credits?.cast || []);
      id = pool.find(p => p.name === name)?.id || [...(data.credits?.cast || []), ...(data.credits?.crew || []), ...(data.created_by || [])].find(p => p.name === name)?.id || null;
    }
    if (!id) {
      const found = await FilmAPI.request('search/person', credential, { query: name, include_adult: 'false' });
      const results = found.results || [];
      id = (results.find(p => p.name === name) || results[0])?.id || null;
    }
    if (!Number.isInteger(id)) throw new Error('TMDBでこの人物を見つけられませんでした。');
    const person = await FilmAPI.request(`person/${id}`, credential, { append_to_response: 'combined_credits' });
    if (version !== personVersion) return;
    const credits = person.combined_credits || {};
    const directing = mergeFilms((credits.crew || []).filter(c => c.job === 'Director' || (c.media_type === 'tv' && ['Creator', 'Series Director'].includes(c.job))));
    const acting = mergeFilms((credits.cast || []).filter(c => !(c.genre_ids || []).some(g => HIDDEN_TV_GENRES.includes(g))));
    personState = { person, directing, acting, tab: role === 'director' ? (directing.length ? 'directing' : 'acting') : (acting.length ? 'acting' : 'directing') };
    $('person-status').textContent = '';
    renderPerson();
  } catch (error) { if (version === personVersion) $('person-status').textContent = error.message; }
}
function renderPerson() {
  if (!personState || !$('person-dialog').open) return;
  const { person, directing, acting, tab } = personState, list = tab === 'directing' ? directing : acting;
  const all = mergeFilms([...directing, ...acting].map(f => ({ id: f.id, media_type: f.mediaType, title: f.title, release_date: f.releaseDate })));
  const onShelf = all.map(f => findFilmRecord(f)).filter(Boolean), seen = onShelf.filter(r => r.status === 'watched'), rated = seen.filter(r => r.rating > 0);
  const photo = /^\/[\w.-]+$/.test(person.profile_path || '') ? `<img src="https://image.tmdb.org/t/p/w185${person.profile_path}" alt="" referrerpolicy="no-referrer">` : '';
  $('person-content').innerHTML = `<div class="film-hero person-hero">${photo}<div><h2>${escape(person.name)}</h2><p>${escape({ Directing: '監督', Acting: '俳優', Writing: '脚本', Production: '製作' }[person.known_for_department] || person.known_for_department || '')}${person.birthday ? ` · ${escape(person.birthday.replaceAll('-', '/'))}生まれ` : ''}${person.place_of_birth ? ` · ${escape(person.place_of_birth)}` : ''}</p><p><b>${seen.length}</b>本鑑賞済み · 観たい ${onShelf.length - seen.length}本${rated.length ? ` · 私の平均 ★${(rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1)}` : ''}</p></div></div>
  <div class="person-tabs"><button data-person-tab="directing" class="${tab === 'directing' ? 'active' : ''}" ${directing.length ? '' : 'disabled'}>監督・制作 ${directing.length}</button><button data-person-tab="acting" class="${tab === 'acting' ? 'active' : ''}" ${acting.length ? '' : 'disabled'}>出演 ${acting.length}</button></div>
  <ul class="person-films">${list.map((f, i) => { const r = findFilmRecord(f); return `<li class="${r ? 'on-shelf' : ''}"><button class="person-film" data-open-film="${f.id}" data-media="${f.mediaType}">${thumb(f.poster, f.title)}<span><strong>${escape(f.title)}</strong><small>${escape(f.releaseDate.slice(0, 4) || '公開日未定')} · ${f.mediaType === 'tv' ? 'TV' : '映画'}${f.roles.length ? ' · ' + escape(f.roles.slice(0, 2).join('／')) : ''}</small>${shelfBadge(r)}</span></button>${r ? '' : `<button class="person-want" data-person-want="${i}">＋ 観たい</button>`}</li>`; }).join('') || '<li class="lookup-note">作品がありません。</li>'}</ul><p class="source">作品情報：TMDB。★は私の評価です。</p>`;
}
$('person-content').onclick = async event => {
  const b = event.target.closest('button');
  if (!b || !personState) return;
  if (b.dataset.personTab) { personState.tab = b.dataset.personTab; renderPerson(); return; }
  if (b.dataset.openFilm) { closeDialog('film-detail'); openFilm(Number(b.dataset.openFilm), b.dataset.media); return; }
  if (b.dataset.personWant) {
    if (!storageHealthy) return;
    const f = (personState.tab === 'directing' ? personState.directing : personState.acting)[Number(b.dataset.personWant)];
    if (!f || findFilmRecord(f)) return;
    b.disabled = true; b.textContent = '追加中…';
    try {
      const movie = await FilmAPI.details(f.id, credential, null, f.mediaType);
      if (findFilmRecord(movie)) { renderPerson(); return; }
      if (await persist([...records, { id: crypto.randomUUID(), title: movie.title || f.title, status: 'want', rating: 0, date: '', meta: '', review: '', updated: Date.now(), movie }])) $('person-status').textContent = `『${movie.title || f.title}』を観たいに追加しました。`;
    } catch (error) { $('person-status').textContent = error.message; }
    renderPerson();
  }
};
document.addEventListener('click', event => {
  const b = event.target.closest('.person-link');
  if (!b) return;
  event.preventDefault();
  openPerson(b.dataset.person, b.dataset.role, Number(b.dataset.mid), b.dataset.mmedia === 'tv' ? 'tv' : 'movie');
});

// ---------- お知らせ ----------
let noticeData = null;
const NOTICE_KINDS = { stream: '配信開始', digital: 'デジタル配信', 'release-soon': 'もうすぐ公開', release: '公開日' };
async function loadNotices() {
  try {
    noticeData = await api('notices');
    const n = noticeData.unread;
    $('notice-badge').hidden = !n;
    $('notice-badge').textContent = n > 99 ? '99+' : String(n);
    renderNotices();
  } catch (error) { if (!$('notices').hidden) $('notices-status').textContent = error.message; }
}
function renderNotices() {
  if ($('notices').hidden || !noticeData) return;
  const p = noticeData.progress || {};
  $('notices-status').textContent = `「観たい」の作品（TMDB連携済み ${p.watching ?? 0}件）の日本の配信状況と公開日を、30分ごとに10件ずつ自動で確認しています。確認済み ${p.checked ?? 0}件${p.lastChecked ? ` · 最終確認 ${new Date(p.lastChecked).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}。`;
  $('notices-list').innerHTML = noticeData.notices.length ? `<ul class="notice-list">${noticeData.notices.map(n => `<li><button class="notice-item ${n.read ? '' : 'unread'}" data-notice="${escape(n.id)}">${thumb(n.poster, n.title)}<span><small class="notice-kind">${escape(NOTICE_KINDS[n.kind] || 'お知らせ')}${n.read ? '' : ' · 未読'}</small><strong>${escape(n.message)}</strong><small>${new Date(n.created).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}</small></span></button></li>`).join('')}</ul>` : '<div class="catalog-empty"><h3>新しいお知らせはありません</h3><p>観たい作品が日本の配信サービスで観られるようになったときや、日本公開日が近づいたときにここでお知らせします。</p></div>';
}
$('notices-list').onclick = async event => {
  const b = event.target.closest('[data-notice]');
  const n = b && noticeData?.notices.find(x => x.id === b.dataset.notice);
  if (!n) return;
  if (!n.read) { api('notices/read', { method: 'POST', body: JSON.stringify({ ids: [n.id] }) }).then(loadNotices).catch(() => {}); n.read = true; renderNotices(); }
  if (credential && Number.isInteger(n.tmdbId)) openFilm(n.tmdbId, n.mediaType === 'tv' ? 'tv' : 'movie');
};
$('notices-read-all').onclick = async () => { try { await api('notices/read', { method: 'POST', body: JSON.stringify({ all: true }) }); await loadNotices(); } catch (error) { alert(error.message); } };
$('notices-check').onclick = async () => {
  $('notices-check').disabled = true;
  try { const r = await api('notices/check', { method: 'POST', body: '{}' }); await loadNotices(); $('notices-status').textContent = `${r.checked}件を確認しました。新しいお知らせ ${r.created}件。 ` + $('notices-status').textContent; }
  catch (error) { $('notices-status').textContent = error.message; }
  finally { $('notices-check').disabled = false; }
};

// ---------- hooks ----------
function onTabShown(tab) {
  if (tab === 'lists') { renderLists(); if (!listsLoaded) loadLists().catch(error => { $('lists-view').innerHTML = `<p class="lookup-note">${escape(error.message)}</p>`; }); }
  if (tab === 'stats') renderStats();
  if (tab === 'notices') { renderNotices(); loadNotices(); }
}
function onFeaturesLibraryChanged() { renderStats(); renderLists(); renderPerson(); }
loadNotices();
setInterval(() => { if (document.visibilityState === 'visible') loadNotices(); }, 600000);
window.addEventListener('focus', () => loadNotices());
