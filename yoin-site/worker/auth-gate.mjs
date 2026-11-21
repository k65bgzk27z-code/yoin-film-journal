// Passphrase gate for the Cloudflare deployment (added at migration time).
// The app itself still checks for the ChatGPT Sites identity header; after a
// successful passphrase login this gate injects that header, so worker/api.mjs
// and the client stay unchanged. Active only when both AUTH_SECRET and
// AUTH_PASSPHRASE are set as Worker secrets; otherwise it is skipped.
export async function yoinAuthToken(env) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('yoin-owner-v1'));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function yoinCookieValue(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}
export function yoinSame(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export function yoinLoginPage(error) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#304d40"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="余韻"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><title>余韻 — ログイン</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f3ec;font-family:sans-serif;color:#223}.card{background:#fff;border:1px solid #ddd6c4;border-radius:16px;padding:32px 28px;max-width:340px;width:88%;box-shadow:0 8px 30px rgba(60,50,20,.08)}h1{font-size:28px;margin:0 0 4px;letter-spacing:.2em}.sub{color:#667;font-size:13px;margin:0 0 20px}label{font-size:13px;color:#445;display:block;margin-bottom:6px}input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #c9c2ae;border-radius:10px;font-size:16px}button{margin-top:16px;width:100%;padding:12px;border:0;border-radius:10px;background:#20503c;color:#fff;font-size:16px;cursor:pointer}.err{color:#a33;font-size:13px;margin:0 0 12px}</style></head><body><main class="card"><h1>余韻</h1><p class="sub">映画の記録 — 本人専用です</p>${error ? '<p class="err">合言葉が違います。もう一度お試しください。</p>' : ''}<form method="post" action="/login"><label for="p">合言葉</label><input id="p" name="passphrase" type="password" autocomplete="current-password" required autofocus><button type="submit">開く</button></form></main></body></html>`;
}
export const YOIN_PUBLIC_ASSETS = ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'];
export async function yoinGate(request, env, path) {
  if (path === '/login') {
    if (request.method === 'POST') {
      const form = await request.formData().catch(() => null);
      const pass = form ? String(form.get('passphrase') || '') : '';
      if (yoinSame(pass, env.AUTH_PASSPHRASE)) {
        const token = await yoinAuthToken(env);
        return new Response(null, { status: 303, headers: { 'Location': '/', 'Set-Cookie': 'yoin_auth=' + token + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=15552000', 'Cache-Control': 'no-store' } });
      }
      return new Response(yoinLoginPage(true), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    return new Response(yoinLoginPage(false), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  if (path === '/logout') {
    return new Response(null, { status: 303, headers: { 'Location': '/login', 'Set-Cookie': 'yoin_auth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0', 'Cache-Control': 'no-store' } });
  }
  // App icons and the web app manifest hold no personal data. iOS / Android fetch them for the
  // home-screen icon, sometimes without the login cookie, so they are served without the passphrase.
  if (YOIN_PUBLIC_ASSETS.includes(path)) return request;
  // /api/bot/* is authenticated by its own bearer token inside botApi() (worker/bot-api.mjs),
  // never by the cookie; the bearer token is not accepted anywhere else.
  if (path.startsWith('/api/bot/')) return request;
  const token = await yoinAuthToken(env);
  if (yoinSame(yoinCookieValue(request, 'yoin_auth'), token)) {
    const headers = new Headers(request.headers);
    headers.set('oai-authenticated-user-id', 'owner');
    return new Request(request, { headers });
  }
  if (path.startsWith('/api/')) return Response.json({ error: 'ログインが必要です。ページを開き直してログインしてください。' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  return new Response(yoinLoginPage(false), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
