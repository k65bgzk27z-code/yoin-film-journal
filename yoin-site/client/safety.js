'use strict';
// 観た日の穴埋め / ゴミ箱 / 自動バックアップ
function quickDateHTML(r) {
  const hint = /^\d{4}-\d{2}-\d{2}$/.test(r.filmarksMarkedAt || '') ? `<button type="button" class="qd-hint" data-qd-use="${escape(r.id)}" data-date="${escape(r.filmarksMarkedAt)}">Filmarks登録日 ${escape(dateText(r.filmarksMarkedAt))} にする</button>` : '';
  return `<div class="quick-date" data-qd="${escape(r.id)}"><b>観た日を入れる</b><span><input type="number" inputmode="numeric" min="1900" max="2100" placeholder="年" data-qd-y aria-label="年"><select data-qd-m aria-label="月"><option value="">月不明</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}月</option>`).join('')}</select><input type="number" inputmode="numeric" min="1" max="31" placeholder="日" data-qd-d aria-label="日"><button type="button" class="primary" data-qd-save="${escape(r.id)}">保存</button></span>${hint}<small>年だけ・年月だけでも保存できます。</small></div>`;
}
async function saveQuickDate(id, date, button) {
  const r = records.find(x => x.id === id);
  if (!r || r.date || !date) return;
  button.disabled = true;
  if (await persist(records.map(x => x.id === id ? { ...x, date } : x))) $('notice').textContent = `『${r.title}』の観た日を ${dateText(date)} にしました。残り ${records.filter(x => x.status === 'watched' && !x.date).length}件。`;
  else button.disabled = false;
}
function updateNodateCount() { const n = records.filter(r => r.status === 'watched' && !r.date).length; $('nodate-filter').textContent = n ? `観た日が未入力（${n}）` : '観た日が未入力'; }
const _renderBefore = render;
render = function () { _renderBefore(); updateNodateCount(); };
updateNodateCount();
document.addEventListener('click', async event => {
  const b = event.target.closest('button');
  if (!b) return;
  if (b.dataset.qdUse) { await saveQuickDate(b.dataset.qdUse, b.dataset.date, b); return; }
  if (b.dataset.qdSave) {
    const box = b.closest('[data-qd]'), y = box.querySelector('[data-qd-y]').value.trim(), m = box.querySelector('[data-qd-m]').value, d = box.querySelector('[data-qd-d]').value.trim();
    if (!/^\d{4}$/.test(y) || Number(y) < 1900 || Number(y) > 2100) { alert('年を4桁で入力してください。'); return; }
    if (d && !m) { alert('日を入れる場合は月も選んでください。'); return; }
    const date = y + (m ? '-' + m.padStart(2, '0') + (d ? '-' + d.padStart(2, '0') : '') : '');
    if (d && (Number(d) < 1 || Number(d) > 31 || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date)) { alert('日付を確認してください。'); return; }
    if (date > tokyoToday()) { alert('未来の日付です。'); return; }
    await saveQuickDate(b.dataset.qdSave, date, b);
    return;
  }
  if (b.dataset.openTrash) openTrash();
});

// ---------- ゴミ箱 ----------
async function openTrash() {
  if (!$('trash-dialog').open) $('trash-dialog').showModal();
  $('trash-status').textContent = '読み込み中…';
  try {
    const data = await api('trash');
    $('trash-status').textContent = data.items.length ? `${data.items.length}件` : '';
    $('trash-list').innerHTML = data.items.map(t => { const days = Math.max(0, Math.ceil((t.purgeAt - Date.now()) / 86400000)); return `<div class="trash-item">${thumb(t.poster, t.title)}<span><strong>${escape(t.title || '(名前なし)')}</strong><small>${t.kind === 'list' ? 'リスト' : t.status === 'want' ? '観たい' : '鑑賞済み' + (t.rating ? ' ★ ' + Number(t.rating).toFixed(1) : '')} · ${new Date(t.deletedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}に削除 · あと${days}日で完全に削除</small></span><span class="trash-tools"><button class="primary" data-restore="${escape(t.id)}">元に戻す</button><button data-purge="${escape(t.id)}">完全に削除</button></span></div>`; }).join('') || '<p class="lookup-note">ゴミ箱は空です。</p>';
  } catch (error) { $('trash-status').textContent = error.message; }
}
$('open-trash').onclick = openTrash;
$('trash-close').onclick = () => $('trash-dialog').close();
$('trash-list').onclick = async event => {
  const b = event.target.closest('button');
  if (!b) return;
  try {
    if (b.dataset.restore) { b.disabled = true; await api('trash/restore', { method: 'POST', body: JSON.stringify({ id: b.dataset.restore }) }); await refresh(); listsLoaded = false; if (!$('lists').hidden) loadLists(); $('notice').textContent = '元に戻しました。'; }
    if (b.dataset.purge && confirm('完全に削除します。元に戻せません。よろしいですか？')) await api('trash/purge', { method: 'POST', body: JSON.stringify({ id: b.dataset.purge }) });
  } catch (error) { alert(error.message); }
  openTrash();
};

// ---------- 自動バックアップ ----------
async function openBackups() {
  if (!$('backups-dialog').open) $('backups-dialog').showModal();
  $('backups-status').textContent = '読み込み中…';
  try {
    const data = await api('backups');
    $('backups-status').textContent = data.backups.length ? `最新：${new Date(data.backups[0].created).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}` : 'まだバックアップがありません（最初の自動バックアップは次の定期確認時に作られます）。';
    $('backups-list').innerHTML = data.backups.map(b => `<a class="backup-item" href="/api/backups/${encodeURIComponent(b.id)}/download" download><span><strong>${new Date(b.created).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong><small>${b.kind === 'auto' ? '自動' : '手動'} · 記録 ${b.summary.films}件 · リスト ${b.summary.lists}件 · ${(b.size / 1048576).toFixed(1)}MB</small></span><span>↓ ダウンロード</span></a>`).join('');
  } catch (error) { $('backups-status').textContent = error.message; }
}
$('open-backups').onclick = openBackups;
$('backups-close').onclick = () => $('backups-dialog').close();
$('backup-now').onclick = async () => {
  $('backup-now').disabled = true;
  try { await api('backups', { method: 'POST', body: '{}' }); await openBackups(); } catch (error) { $('backups-status').textContent = error.message; }
  finally { $('backup-now').disabled = false; }
};
