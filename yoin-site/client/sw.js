'use strict';
// 余韻 service worker — データは一切キャッシュしない。
// 記録・API・画像の通信はすべてブラウザにそのまま任せ（常に最新を表示）、合言葉ログインにも触れない。
// 役割は「ホーム画面から開いたとき、通信できなければ簡単なオフライン画面を出す」ことだけ。
const OFFLINE_HTML = '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#304d40"><title>余韻 — オフライン</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f4ef;color:#272b29;font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:24px}h1{font-family:serif;font-size:30px;margin:0 0 10px}p{color:#747971;line-height:1.8;font-size:14px}button{margin-top:14px;padding:12px 22px;border:0;border-radius:10px;background:#304d40;color:#fff;font-size:16px}</style><main><h1>余韻</h1><p>インターネットに接続できません。<br>記録の表示・保存には通信が必要です。</p><button onclick="location.reload()">もう一度読み込む</button></main></html>';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.mode !== 'navigate' || request.method !== 'GET') return;
  event.respondWith(fetch(request).catch(() => new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })));
});
