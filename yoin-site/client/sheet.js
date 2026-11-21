'use strict';
// Shared behaviour for every popup (dialog): sticky header with ✕, close button at the bottom,
// backdrop tap / Escape / swipe-down to close. Closing always goes through each dialog's existing
// close/cancel button so its existing handlers run. Dialogs with a form ask before discarding edits.
(() => {
  const CLOSERS = {
    'modal': 'cancel', 'film-detail': 'film-close', 'connection': 'connection-cancel', 'person-dialog': 'person-close',
    'rewatch-dialog': 'rw-cancel', 'list-pick': 'list-pick-close', 'list-edit': 'list-edit-cancel', 'list-add': 'list-add-close',
    'trash-dialog': 'trash-close', 'backups-dialog': 'backups-close'
  };
  // Dialogs whose original close button sat at the very top: that row is replaced by the sticky header
  // and a close button is added at the bottom of the content.
  const NEEDS_FOOT = new Set(['film-detail', 'person-dialog', 'trash-dialog', 'backups-dialog']);
  const snapshots = new WeakMap();
  const snap = d => JSON.stringify([...d.querySelectorAll('input,select,textarea')].map(e => e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value)
    .concat([...d.querySelectorAll('#viewings-editor,#lookup-preview')].map(e => e.textContent)));
  const dirty = d => d.querySelector('form') && snapshots.has(d) && snapshots.get(d) !== snap(d);
  const closeNow = d => { const b = document.getElementById(CLOSERS[d.id]); if (b) b.click(); if (d.open) d.close(); };
  function requestClose(d) {
    if (!d.open) return;
    if (dirty(d) && !confirm('保存していない変更があります。閉じてもよいですか？')) return;
    closeNow(d);
  }
  window.requestSheetClose = requestClose;

  function setup(d) {
    if (d.dataset.sheet) return; d.dataset.sheet = '1'; d.classList.add('sheet');
    const closer = document.getElementById(CLOSERS[d.id]);
    const bar = document.createElement('div'); bar.className = 'sheet-bar';
    bar.innerHTML = '<span class="sheet-grip" aria-hidden="true"></span><span class="sheet-title"></span><button type="button" class="sheet-x" aria-label="閉じる">✕<span> 閉じる</span></button>';
    const scope = d.querySelector(':scope > form') || d;
    const h2 = scope.querySelector(':scope > h2');
    if (h2) { h2.removeAttribute('style'); bar.querySelector('.sheet-title').append(h2); }
    d.prepend(bar);
    // Detail views (film, person) have their heading inside loaded content: mirror it into the header
    // once it scrolls out of view, so you always know what you are looking at.
    if (!h2) {
      const title = bar.querySelector('.sheet-title'); title.classList.add('mirror');
      const update = () => { const h = [...d.querySelectorAll('h2')].find(e => !bar.contains(e)); const top = h ? h.getBoundingClientRect().bottom - bar.getBoundingClientRect().bottom : 0; const t = h && top < 0 ? h.textContent.trim() : ''; if (title.textContent !== t) title.textContent = t; };
      d.addEventListener('scroll', update, { passive: true }); new MutationObserver(m => { if (m.some(x => !bar.contains(x.target))) update(); }).observe(d, { childList: true, subtree: true });
    }
    // Old top row that only held the close button -> hidden (the sticky ✕ replaces it).
    if (closer && NEEDS_FOOT.has(d.id)) { const row = closer.closest('.actions'); if (row && row.children.length === 1) row.hidden = true; }
    if (NEEDS_FOOT.has(d.id)) {
      const foot = document.createElement('div'); foot.className = 'actions sheet-foot';
      foot.innerHTML = '<button type="button" class="sheet-close-bottom">閉じる</button>'; d.append(foot);
      foot.firstChild.onclick = () => requestClose(d);
    }
    bar.querySelector('.sheet-x').onclick = () => requestClose(d);
    d.addEventListener('cancel', e => { e.preventDefault(); requestClose(d); }); // Escape
    // Backdrop tap: both press and release must land outside the dialog box.
    let downOutside = false;
    const outside = e => { const r = d.getBoundingClientRect(); return e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom); };
    d.addEventListener('pointerdown', e => { downOutside = outside(e); });
    d.addEventListener('click', e => { if (downOutside && outside(e)) requestClose(d); downOutside = false; });
    // Swipe down on the header (or anywhere while scrolled to the top) to close.
    let startY = null, dy = 0;
    d.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      const onBar = bar.contains(e.target) && !e.target.closest('button');
      const fromTop = d.scrollTop <= 0 && !e.target.closest('input,textarea,select,.lookup-results,.pick-options,.person-films');
      startY = onBar || fromTop ? e.touches[0].clientY : null; dy = 0;
    }, { passive: true });
    d.addEventListener('touchmove', e => {
      if (startY === null) return;
      dy = e.touches[0].clientY - startY;
      if (dy > 0 && d.scrollTop <= 0) { d.style.transform = `translateY(${Math.min(dy, 240) * 0.6}px)`; d.style.transition = 'none'; }
      else if (dy < 0) { startY = null; d.style.transform = ''; }
    }, { passive: true });
    d.addEventListener('touchend', () => {
      if (startY === null) return;
      d.style.transition = ''; d.style.transform = '';
      if (dy > 90 && d.scrollTop <= 0) requestClose(d);
      startY = null; dy = 0;
    });
  }
  // Record the form state each time a dialog opens (after its opener has filled it in).
  const show = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function () {
    setup(this); show.call(this); this.scrollTop = 0;
    // Keep the pre-existing initial focus (first control in the content), not the new ✕.
    if (document.activeElement?.classList.contains('sheet-x') && this.querySelector('form')) { const next = [...this.querySelectorAll('button,input,select,textarea,a[href]')].find(e => !e.closest('.sheet-bar') && !e.closest('[hidden]') && e.type !== 'hidden' && !e.disabled && e.offsetParent); if (next) next.focus({ preventScroll: true }); else document.activeElement.blur(); }
    const d = this; snapshots.set(d, snap(d)); requestAnimationFrame(() => { if (d.open) snapshots.set(d, snap(d)); });
  };
  document.querySelectorAll('dialog').forEach(setup);
})();
