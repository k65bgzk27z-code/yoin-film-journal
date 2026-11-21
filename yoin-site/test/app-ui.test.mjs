// Run: node build.mjs && node --test test/   — PWA files and the passphrase gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const worker = (await import(new URL('../dist/server/index.js', import.meta.url))).default;
const env = { DB: null, AUTH_SECRET: 'dummy-secret', AUTH_PASSPHRASE: 'dummy-pass' };
const ORIGIN = 'https://yoin.test';
async function login() {
  const r = await worker.fetch(new Request(ORIGIN + '/login', { method: 'POST', body: new URLSearchParams({ passphrase: 'dummy-pass' }) }), env);
  return (r.headers.get('Set-Cookie') || '').split(';')[0];
}
test('manifest and icons are public; app, sw.js and API stay behind the passphrase', async () => {
  const manifest = await worker.fetch(new Request(ORIGIN + '/manifest.webmanifest'), env);
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('Content-Type'), /manifest\+json/);
  const m = await manifest.json();
  assert.equal(m.display, 'standalone');
  assert.equal(m.short_name, '余韻');
  for (const icon of m.icons) {
    const r = await worker.fetch(new Request(ORIGIN + icon.src), env);
    assert.equal(r.status, 200, icon.src);
    assert.equal(r.headers.get('Content-Type'), 'image/png');
  }
  const home = await worker.fetch(new Request(ORIGIN + '/'), env);
  assert.match(await home.text(), /合言葉/);
  const sw = await worker.fetch(new Request(ORIGIN + '/sw.js'), env);
  assert.match(await sw.text(), /合言葉/);
  const api = await worker.fetch(new Request(ORIGIN + '/api/records'), env);
  assert.equal(api.status, 401);
  const cookie = await login();
  const app = await (await worker.fetch(new Request(ORIGIN + '/', { headers: { Cookie: cookie } }), env)).text();
  assert.match(app, /apple-mobile-web-app-capable/);
  assert.match(app, /viewport-fit=cover/);
  assert.match(app, /app-ui\.js/);
  const swAuthed = await worker.fetch(new Request(ORIGIN + '/sw.js', { headers: { Cookie: cookie } }), env);
  assert.equal(swAuthed.status, 200);
  const swText = await swAuthed.text();
  assert.match(swText, /request\.mode !== 'navigate'/);
  assert.doesNotMatch(swText, /cache\.put|caches\.open/);
});

test('old entry opens the shared production shelf and the record sheet has a direct save control', async () => {
  const entry = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(entry, /href="https:\/\/yoin\.hayate-yoin\.workers\.dev\/"/);
  assert.doesNotMatch(entry, /chatgpt\.site/);
  const cookie = await login();
  const headers = { Cookie: cookie };
  const home = await (await worker.fetch(new Request(ORIGIN + '/', { headers }), env)).text();
  assert.match(home, /<button[^>]*id="record-save-top"[^>]*type="submit"[^>]*form="form"/);
  const sheet = await (await worker.fetch(new Request(ORIGIN + '/sheet.js', { headers }), env)).text();
  assert.match(sheet, /before\(save\)/);
  assert.match(sheet, /append\(status\)/);
});
