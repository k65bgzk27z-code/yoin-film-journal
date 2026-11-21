'use strict';
// 背景テーマの切り替え（シンプル／赤い幕／スクリーンと客席）。
// 選んだ背景はこの端末（localStorage）に保存し、サーバー（/api/settings/ui）にも保存して他の端末と揃える。
(() => {
  const THEMES = [
    { id: 'simple', label: 'シンプル', color: '#304d40' },
    { id: 'curtain', label: '赤い幕', color: '#1c0b0d' },
    { id: 'screen', label: 'スクリーンと客席', color: '#0f1113' }
  ];
  const KEY = 'yoin-bg', root = document.documentElement;
  const valid = id => THEMES.some(t => t.id === id);
  function apply(id) {
    if (!valid(id)) id = 'simple';
    if (id === 'simple') { delete root.dataset.bg; delete root.dataset.dark; }
    else { root.dataset.bg = id; root.dataset.dark = '1'; }
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = THEMES.find(t => t.id === id).color;
    try { localStorage.setItem(KEY, id); } catch {}
    document.querySelectorAll('.bg-options button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.bg === id)));
  }
  const current = () => root.dataset.bg || 'simple';
  const box = document.createElement('div'); box.className = 'bg-setting';
  box.innerHTML = '<b id="bg-setting-label">背景</b><div class="bg-options" role="group" aria-labelledby="bg-setting-label">' +
    THEMES.map(t => `<button type="button" data-bg="${t.id}" aria-pressed="false"><span class="bg-swatch ${t.id}" aria-hidden="true"></span>${t.label}</button>`).join('') + '</div>';
  const footer = document.querySelector('main footer'); if (footer) footer.prepend(box);
  box.addEventListener('click', async e => {
    const b = e.target.closest('button[data-bg]'); if (!b) return;
    apply(b.dataset.bg);
    try { await fetch('/api/settings/ui', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ background: b.dataset.bg }) }); } catch {}
  });
  apply(current());
  // 他の端末で選んだ背景を反映（この端末で未選択か、サーバー側と違う場合）
  fetch('/api/settings/ui', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => { if (d && valid(d.background) && d.background !== current()) apply(d.background); }).catch(() => {});
})();
