// Tests for the Cisco features: recognising Cisco serials, reading Cisco's
// Product Information response, and the Analyze API end to end against a
// fake Cisco server (the real Cisco API is never called).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ciscoSerialFrom, ciscoBuildDate } from '../public/cisco-serial.js';
import { recordFromProductInfo } from '../src/cisco.js';
import { startServer } from '../src/server.js';

const NOW = new Date('2026-11-06T12:00:00Z');

test('Cisco serials are recognised, with or without an S/N prefix', () => {
  assert.equal(ciscoSerialFrom('FOC1632X0AB', NOW), 'FOC1632X0AB');
  assert.equal(ciscoSerialFrom('foc1632x0ab', NOW), 'FOC1632X0AB');
  assert.equal(ciscoSerialFrom('S/N: FOC1632X0AB', NOW), 'FOC1632X0AB');
  assert.equal(ciscoSerialFrom('SN FDO2245A1BC', NOW), 'FDO2245A1BC');
});

test('things that are not Cisco serials give null', () => {
  for (const code of ['7XK2Q93', 'FOC1600X0AB' /* week 00 */, 'FOC1654X0AB' /* week 54 */, 'FOC9932X0AB' /* 2095 */,
    'FO1632X0AB', 'FOC1632X0AB1', 'CN0F1R2T7618083A01QBA00', '', null]) {
    assert.equal(ciscoSerialFrom(code, NOW), null, String(code));
  }
});

test('the build year and week come from the serial', () => {
  assert.deepEqual(ciscoBuildDate('FOC1632X0AB'), { year: 2012, week: 32 });
  assert.deepEqual(ciscoBuildDate('FDO2245A1BC'), { year: 2018, week: 45 });
  assert.equal(ciscoBuildDate('nonsense'), null);
});

test("Cisco's product_list entry becomes a flat record", () => {
  const r = recordFromProductInfo('FOC1632X0AB', {
    sr_no: 'FOC1632X0AB', base_pid: 'WS-C2960X-48FPD-L', orderable_pid: 'WS-C2960X-48FPD-L',
    product_name: 'Catalyst 2960-X 48 GigE PoE 740W, 2 x 10G SFP+, LAN Base', product_type: 'SWITCH',
    product_series: 'Cisco Catalyst 2960-X Series Switches', product_category: 'Switches', release_date: '2013-03-14',
    product_support_page: 'https://www.cisco.com/c/en/us/support/switches/catalyst-2960-x-series-switches/series.html',
  });
  assert.equal(r.status, 'found');
  assert.equal(r.pid, 'WS-C2960X-48FPD-L');
  assert.equal(r.productName, 'Catalyst 2960-X 48 GigE PoE 740W, 2 x 10G SFP+, LAN Base');
  assert.equal(r.series, 'Cisco Catalyst 2960-X Series Switches');
  assert.equal(r.releaseDate, '2013-03-14');
  assert.equal(recordFromProductInfo('X', undefined).status, 'not_found');
  assert.equal(recordFromProductInfo('X', { sr_no: 'X', product_name: '  ' }).status, 'not_found');
});

// --- The Analyze API against a fake Cisco server -----------------------------

let fakeCisco;
let calls = [];
let app;
let dataDir;
const KNOWN = {
  FOC1632X0AB: { base_pid: 'WS-C2960X-48FPD-L', orderable_pid: 'WS-C2960X-48FPD-L', product_name: 'Catalyst 2960-X 48 GigE PoE 740W, 2 x 10G SFP+, LAN Base', product_type: 'SWITCH', product_series: 'Cisco Catalyst 2960-X Series Switches' },
  FDO2245A1BC: { base_pid: 'C9300-48P', orderable_pid: 'C9300-48P-E', product_name: 'Catalyst 9300 48-port PoE+, Network Essentials', product_type: 'SWITCH', product_series: 'Cisco Catalyst 9300 Series Switches' },
};

before(async () => {
  fakeCisco = http.createServer((req, res) => {
    calls.push(req.url);
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/token') return json(200, { access_token: 'cisco-token', expires_in: 3600 });
    if (req.headers.authorization !== 'Bearer cisco-token') return json(401, {});
    const m = /^\/product\/v1\/information\/serial_numbers\/([^?]+)/.exec(req.url);
    if (!m) return json(404, {});
    const serials = decodeURIComponent(m[1]).split(',');
    if (serials.length > 5) return json(400, { error: 'too many' });
    if (serials.includes('FOC1701ERR1')) return json(500, {});
    return json(200, {
      pagination_response_record: { page_index: 1, last_index: 1, total_records: serials.length },
      product_list: serials.filter((sn) => KNOWN[sn]).map((sn, i) => ({ id: String(i + 1), sr_no: sn, ...KNOWN[sn] })),
    });
  });
  await new Promise((resolve) => fakeCisco.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${fakeCisco.address().port}`;
  dataDir = mkdtempSync(path.join(tmpdir(), 'inventory-cisco-test-'));
  app = await startServer({
    port: 0, host: '127.0.0.1', dataDir, quiet: true,
    dell: { clientId: '', clientSecret: '', tokenUrl: 'x', apiBase: 'x' },
    cisco: { clientId: 'id', clientSecret: 'secret', tokenUrl: `${base}/token`, apiBase: base, timeoutMs: 5000 },
  });
});

after(async () => {
  await app.close();
  await new Promise((resolve) => fakeCisco.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
});

const url = (p) => `${app.url}${p}`;
const postJson = async (p, body) => {
  const res = await fetch(url(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('Cisco lookups: found, unknown, failed; five per call; answers kept', async () => {
  calls = [];
  const serials = ['FOC1632X0AB', 'FDO2245A1BC', 'FOC1801AAA1', 'FOC1801AAA2', 'FOC1801AAA3', 'FOC1801AAA4', 'S/N FOC1801AAA5'];
  const { status, body } = await postJson('/api/cisco/lookup', { serials });
  assert.equal(status, 200);
  assert.equal(body.looked, 7);
  assert.equal(calls.filter((c) => c.startsWith('/product/')).length, 2, 'seven serials = two calls of at most five');
  assert.equal(body.results.FOC1632X0AB.status, 'found');
  assert.equal(body.results.FOC1632X0AB.pid, 'WS-C2960X-48FPD-L');
  assert.equal(body.results.FDO2245A1BC.productName, 'Catalyst 9300 48-port PoE+, Network Essentials');
  assert.equal(body.results.FOC1801AAA5.status, 'not_found', 'the S/N prefix is removed');

  calls = [];
  const again = await postJson('/api/cisco/lookup', { serials: ['FOC1632X0AB'] });
  assert.equal(again.body.looked, 0);
  assert.equal(calls.length, 0, 'a stored answer is not asked again');

  const failed = await postJson('/api/cisco/lookup', { serials: ['FOC1701ERR1'] });
  assert.equal(failed.body.results.FOC1701ERR1.status, 'error');
  assert.match(failed.body.results.FOC1701ERR1.error, /HTTP 500/);
});

test('bad input is refused; Dell not set up gives 503 for Dell only', async () => {
  for (const [body, message] of [[{}, /serials/], [{ serials: [] }, /No serial/], [{ serials: ['7XK2Q93'] }, /not a Cisco serial/],
    [{ serials: Array.from({ length: 11 }, (_, i) => `FOC17${String(i + 10)}AAAA`) }, /At most 10/]]) {
    const res = await postJson('/api/cisco/lookup', body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 50));
    assert.match(res.body.error, message);
  }
  const dell = await postJson('/api/dell/lookup', { tags: ['7XK2Q93'] });
  assert.equal(dell.status, 503);
});

test('the analysis names Cisco items: make, model (PID), description, build date', async () => {
  const { body: { session } } = await postJson('/api/sessions', { name: 'Network closet' });
  for (const code of ['FOC1632X0AB', 'FOC1632X0AB', 'S/N: FDO2245A1BC', 'FOC1801AAA2', 'UNKNOWN-THING']) {
    assert.equal((await postJson('/api/scans', { sessionId: session.id, code, method: 'scanner', notes: code === 'FOC1801AAA2' ? 'top of rack' : undefined })).status, 201);
  }
  const analysis = await (await fetch(url(`/api/sessions/${session.id}/analysis`))).json();
  assert.equal(analysis.ciscoConfigured, true);
  assert.equal(analysis.dellConfigured, false);
  const [c2960, c9300, unknown, other] = analysis.rows;
  assert.deepEqual([c2960.ciscoSerial, c2960.timesScanned], ['FOC1632X0AB', 2]);
  assert.deepEqual(c2960.identified, { make: 'Cisco', model: 'WS-C2960X-48FPD-L', description: 'Catalyst 2960-X 48 GigE PoE 740W, 2 x 10G SFP+, LAN Base' });
  assert.deepEqual(c2960.ciscoBuilt, { year: 2012, week: 32 });
  assert.equal(c9300.ciscoSerial, 'FDO2245A1BC');
  assert.equal(c9300.identified.model, 'C9300-48P-E');
  assert.deepEqual(unknown.identified, { make: 'Cisco', model: null, description: null }, 'Cisco by its serial even when Cisco does not know it');
  assert.equal(unknown.notes, 'top of rack');
  assert.equal(other.ciscoSerial, null);
  assert.equal(other.identified.make, null);

  const lines = (await (await fetch(url(`/api/sessions/${session.id}/analysis.csv`))).text()).replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.ok(lines[0].includes(',make,model,description,notes,') && lines[0].includes(',cisco_serial,cisco_built,'), lines[0]);
  assert.match(lines[1], /^Network closet,FOC1632X0AB,2,[^,]*,[^,]*,Cisco,WS-C2960X-48FPD-L,"Catalyst 2960-X 48 GigE PoE 740W, 2 x 10G SFP\+, LAN Base",,/);
  assert.match(lines[1], /,FOC1632X0AB,2012 week 32,WS-C2960X-48FPD-L,Cisco Catalyst 2960-X Series Switches,SWITCH,,found$/);
  assert.match(lines[3], /,Cisco,,,top of rack,/);
});
