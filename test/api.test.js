// API tests: start the real server on a free port with a throwaway database
// and call it over HTTP. Run with: npm test  (or: node --test "test/*.test.js")

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { startServer, csvCell, parseScanInput, slug } from '../src/server.js';

let app;
let dataDir;
let bay; // session "Bay 3 sweep"
let lot; // session "Surplus lot 14"

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'inventory-scanner-test-'));
  app = await startServer({ port: 0, host: '127.0.0.1', dataDir, trustProxy: true, quiet: true });
});

after(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const url = (p) => `${app.url}${p}`;
const postJson = (p, body, headers = {}) => fetch(url(p), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const getJson = async (p) => (await fetch(url(p))).json();
const scan = (body, headers) => postJson('/api/scans', body, headers);

test('APP_SUBTITLE appears under the title, HTML-escaped; empty means no subtitle line', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'inventory-subtitle-'));
  const branded = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, quiet: true, subtitle: 'Acme <IT> & "Ops"' });
  for (const page of ['/', '/analyze']) {
    assert.match(await (await fetch(`${branded.url}${page}`)).text(), /<p class="brand-sub">Acme &#60;IT&#62; &#38; &#34;Ops&#34;<\/p>/);
  }
  await branded.close();
  rmSync(dir, { recursive: true, force: true });
  const plain = await (await fetch(url('/'))).text();
  assert.ok(!plain.includes('brand-sub') && !plain.includes('APP_SUBTITLE'), 'no subtitle markup without APP_SUBTITLE');
});

test('the page, its scripts and the decoder are served with security headers', async () => {
  const res = await fetch(url('/'));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(csp, /'unsafe-inline'|'unsafe-eval'/);
  assert.match(res.headers.get('permissions-policy'), /camera=\(self\)/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  for (const file of ['/app.js', '/scan-detect.js', '/gs1.js', '/camera.js', '/styles.css', '/favicon.svg',
    '/vendor/zxing-wasm/es/reader/index.js', '/vendor/zxing-wasm/es/share.js']) {
    assert.equal((await fetch(url(file))).status, 200, file);
  }
  const wasm = await fetch(url('/vendor/zxing-wasm/zxing_reader.wasm'));
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.ok((await wasm.arrayBuffer()).byteLength > 500_000);
});

test('static files carry an ETag (304 when unchanged) and are gzipped on request', async () => {
  const first = await fetch(url('/app.js'));
  const etag = first.headers.get('etag');
  assert.match(etag, /^"[0-9a-f]{32}"$/);
  const again = await fetch(url('/app.js'), { headers: { 'If-None-Match': etag } });
  assert.equal(again.status, 304);
  // fetch() unzips by itself, so ask with a raw request to see the gzip body.
  const raw = await new Promise((resolve, reject) => {
    import('node:http').then(({ get }) => get(url('/app.js'), { headers: { 'Accept-Encoding': 'gzip' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject));
  });
  assert.equal(raw.headers['content-encoding'], 'gzip');
  assert.match(gunzipSync(raw.body).toString(), /Page logic for the Inventory Scanner/);
});

test('health check answers ok', async () => {
  const res = await fetch(url('/healthz'));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
});

test('sessions are created, named uniquely (any capitalisation) and validated', async () => {
  assert.deepEqual(await getJson('/api/sessions'), { sessions: [] });
  let res = await postJson('/api/sessions', { name: '  Bay 3   sweep ' });
  assert.equal(res.status, 201);
  bay = (await res.json()).session;
  assert.equal(bay.name, 'Bay 3 sweep');
  assert.deepEqual({ total: bay.total, uniqueCodes: bay.uniqueCodes, lastScanAt: bay.lastScanAt }, { total: 0, uniqueCodes: 0, lastScanAt: null });
  res = await postJson('/api/sessions', { name: 'Surplus lot 14' });
  lot = (await res.json()).session;
  res = await postJson('/api/sessions', { name: 'BAY 3 SWEEP' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /already exists/);
  for (const [body, message] of [[{ name: '' }, /empty/], [{ name: 'x'.repeat(81) }, /longer than 80/], [{ name: 5 }, /must be text/]]) {
    res = await postJson('/api/sessions', body);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, message);
  }
  assert.equal((await fetch(url('/api/sessions/999'))).status, 404);
});

test('a scan is stored in its session, with the client address from X-Forwarded-For', async () => {
  const res = await scan(
    { sessionId: bay.id, code: '(01)00884116312345(21)7XK2Q93', method: 'camera', format: 'GS1 DataMatrix',
      clientId: 'test-0001-aaaa', location: 'Bay 3', scannedBy: 'Pat' },
    { 'X-Forwarded-For': '10.1.2.3' },
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.created, true);
  assert.equal(body.scan.sessionId, bay.id);
  assert.equal(body.scan.method, 'camera');
  assert.equal(body.scan.format, 'GS1 DataMatrix');
  assert.equal(body.scan.timesScanned, 1);
  assert.equal(body.session.total, 1);
  const csv = await (await fetch(url(`/api/sessions/${bay.id}/export.csv`))).text();
  assert.match(csv, /10\.1\.2\.3/);
});

test('sending the same clientId again does not store a second copy', async () => {
  const res = await scan({ sessionId: bay.id, code: '(01)00884116312345(21)7XK2Q93', method: 'camera', clientId: 'test-0001-aaaa' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.created, false);
  assert.equal(body.session.total, 1);
});

test('repeats are counted per session, ignoring case', async () => {
  let body = await (await scan({ sessionId: bay.id, code: '7xk2q93', method: 'scanner', clientId: 'test-0002-bbbb' })).json();
  assert.equal(body.scan.timesScanned, 1);
  body = await (await scan({ sessionId: bay.id, code: '7XK2Q93', method: 'manual', clientId: 'test-0003-cccc' })).json();
  assert.equal(body.scan.timesScanned, 2);
  assert.deepEqual([body.session.total, body.session.uniqueCodes], [3, 2]);
  // The same code in another session is that session's first.
  body = await (await scan({ sessionId: lot.id, code: '7XK2Q93', method: 'scanner', clientId: 'test-0004-dddd' })).json();
  assert.equal(body.scan.timesScanned, 1);
  assert.deepEqual([body.session.total, body.session.uniqueCodes], [1, 1]);
});

test('codes are cleaned of control and zero-width characters and surrounding spaces', async () => {
  const res = await scan({ sessionId: lot.id, code: '  \u0002AB\u200BC-9\r\n ', method: 'scanner', clientId: 'test-0005-eeee' });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).scan.code, 'ABC-9');
});

test('a missing clientId is generated, and method defaults to manual', async () => {
  const res = await scan({ sessionId: lot.id, code: 'NO-CLIENT-ID' });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).scan.method, 'manual');
});

test('bad input is refused with a clear message', async () => {
  const cases = [
    [{ code: 'OK' }, 400, /sessionId/],
    [{ sessionId: 'abc', code: 'OK' }, 400, /sessionId/],
    [{ sessionId: 999, code: 'OK' }, 404, /No such session/],
    [{ sessionId: bay.id, code: '' }, 400, /empty/],
    [{ sessionId: bay.id, code: '   \u0003 ' }, 400, /empty/],
    [{ sessionId: bay.id, code: 'x'.repeat(257) }, 400, /longer than 256/],
    [{ sessionId: bay.id, code: 42 }, 400, /must be text/],
    [{ sessionId: bay.id, code: 'OK', method: 'scan' }, 400, /scanner, manual, camera/],
    [{ sessionId: bay.id, code: 'OK', clientId: 'bad id!' }, 400, /clientId/],
    [{ sessionId: bay.id, code: 'OK', location: 'x'.repeat(101) }, 400, /location is longer/],
    [{ sessionId: bay.id, code: 'OK', format: 'x'.repeat(41) }, 400, /format is longer/],
    [['not', 'an', 'object'], 400, /JSON object/],
  ];
  for (const [body, status, message] of cases) {
    const res = await scan(body);
    assert.equal(res.status, status, JSON.stringify(body).slice(0, 60));
    assert.match((await res.json()).error, message);
  }
  assert.equal((await scan('{oops')).status, 400);
  const wrongType = await fetch(url('/api/scans'), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(wrongType.status, 415);
  assert.equal((await scan({ sessionId: bay.id, code: 'X', padding: 'y'.repeat(20_000) })).status, 413);
});

test('session scans are newest first; the session list is most recently used first', async () => {
  const body = await getJson(`/api/sessions/${bay.id}/scans?limit=200`);
  assert.deepEqual(body.scans.map((s) => s.code), ['7XK2Q93', '7xk2q93', '(01)00884116312345(21)7XK2Q93']);
  assert.ok(!('clientIp' in body.scans[0]), 'client addresses stay out of the page data');
  assert.equal(body.session.total, 3);
  const { sessions } = await getJson('/api/sessions');
  assert.deepEqual(sessions.map((s) => [s.name, s.total, s.uniqueCodes]), [['Surplus lot 14', 3, 3], ['Bay 3 sweep', 3, 2]]);
});

test('remove marks a scan removed, keeps the row, updates totals, and cannot be repeated', async () => {
  const target = (await getJson(`/api/sessions/${lot.id}/scans`)).scans.find((s) => s.code === 'ABC-9');
  const res = await fetch(url(`/api/scans/${target.id}`), { method: 'DELETE' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.session.id, lot.id);
  assert.equal(body.session.total, 2);
  assert.equal(app.store.getScan(target.id).removed, true, 'row still in the database');
  assert.equal((await fetch(url(`/api/scans/${target.id}`), { method: 'DELETE' })).status, 404);
  assert.equal((await fetch(url('/api/scans/999999'), { method: 'DELETE' })).status, 404);
});

test('CSV export per session and for all sessions; formulas neutralised', async () => {
  await scan({ sessionId: lot.id, code: '=HYPERLINK("http://x")', clientId: 'test-0006-ffff' });
  const res = await fetch(url(`/api/sessions/${bay.id}/export.csv`));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /filename="inventory-bay-3-sweep-\d{8}-\d{6}\.csv"/);
  const lines = (await res.text()).replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.match(lines[0], /^session,id,code,entry_method,barcode_format,location,scanned_by,make,model,notes,scanned_at_local \(UTC\),scanned_at_utc/);
  assert.equal(lines.length, 4, 'header + 3 scans of this session only');
  assert.match(lines[1], /^Bay 3 sweep,\d+,\(01\)00884116312345\(21\)7XK2Q93,camera,GS1 DataMatrix,Bay 3,Pat,,,,\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},/);

  const all = (await (await fetch(url('/api/export.csv'))).text()).trim().split('\r\n');
  assert.equal(all.length, 1 + 3 + 3, 'header + every session, removed scans left out');
  assert.ok(all.some((l) => l.includes(`"'=HYPERLINK(""http://x"")"`)), 'formula is quoted and prefixed');
  assert.ok(!all.some((l) => l.includes('ABC-9')), 'removed scans are left out');
  assert.equal((await fetch(url('/api/sessions/999/export.csv'))).status, 404);
});

test('helpers: csvCell, slug, parseScanInput clock check', () => {
  assert.equal(csvCell(null), '');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-5'), "'-5");
  assert.equal(slug('Bay 3 / Nov — Éte!'), 'bay-3-nov-ete');
  assert.equal(slug('!!!'), 'session');
  const now = Date.parse('2026-11-06T12:00:00Z');
  assert.equal(parseScanInput({ sessionId: 1, code: 'A', clientTime: '2026-11-06T11:59:00Z' }, now).clientTime, '2026-11-06T11:59:00.000Z');
  assert.equal(parseScanInput({ sessionId: '1', code: 'A', clientTime: '1999-01-01T00:00:00Z' }, now).clientTime, null);
});

test('wrong methods and unknown paths', async () => {
  assert.equal((await fetch(url('/api/scans'))).status, 405);
  assert.equal((await fetch(url('/api/scans/1'), { method: 'GET' })).status, 405);
  assert.equal((await fetch(url(`/api/sessions/${bay.id}`), { method: 'DELETE' })).status, 405);
  assert.equal((await fetch(url('/api/sessions'), { method: 'PUT' })).status, 405);
  assert.equal((await fetch(url('/api/nothing'))).status, 404);
  assert.equal((await fetch(url('/src/db.js'))).status, 404);
  assert.equal((await fetch(url('/data/scans.db'))).status, 404);
  assert.equal((await fetch(url('/vendor/zxing-wasm/LICENSE'))).status, 404, 'only known file types are served');
});

test('the database keeps its data across a restart', async () => {
  const before = await getJson('/api/sessions');
  await app.close();
  app = await startServer({ port: 0, host: '127.0.0.1', dataDir, trustProxy: true, quiet: true });
  assert.deepEqual(await getJson('/api/sessions'), before);
});
