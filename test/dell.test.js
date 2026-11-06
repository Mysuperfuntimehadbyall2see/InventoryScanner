// Tests for the Dell features: finding service tags in codes, the warranty
// and model helpers, the database migration to version 2, and the Analyze
// API end to end against a fake Dell server (the real Dell API is never called).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { serviceTagFrom } from '../public/service-tag.js';
import { warrantyFrom, modelName } from '../src/dell.js';
import { MIGRATIONS, openStore } from '../src/db.js';
import { startServer } from '../src/server.js';

test('service tags are found in plain codes, Dell QR URLs and GS1 serials', () => {
  assert.equal(serviceTagFrom('7xk2q93'), '7XK2Q93');
  assert.equal(serviceTagFrom(' 7XK2Q93 '), '7XK2Q93');
  assert.equal(serviceTagFrom('https://www.dell.com/support/home/en-us/product-support/servicetag/7XK2Q93'), '7XK2Q93');
  assert.equal(serviceTagFrom('https://www.dell.com/support/x?servicetag=7XK2Q93&lang=en'), '7XK2Q93');
  assert.equal(serviceTagFrom('http://qrl.dell.com/7XK2Q93'), '7XK2Q93');
  assert.equal(serviceTagFrom('(01)00884116312345(21)7XK2Q93'), '7XK2Q93');
  assert.equal(serviceTagFrom('(01)00884116312345(21)7XK2Q93(10)LOT'), '7XK2Q93');
});

test('codes without a service tag give null', () => {
  for (const code of ['1234567', 'ABC123', '7XK2Q934', 'CN0F1R2T7618083A01QBA00', 'https://example.com/servicetag/7XK2Q93',
    '(01)00884116312345(21)7XK2Q93X', '(01)00884116312345(21)1234567', '', null]) {
    assert.equal(serviceTagFrom(code), null, String(code));
  }
});

test('warranty: latest end wins, earliest start, service level of the longest one', () => {
  const w = warrantyFrom([
    { serviceLevelDescription: 'Next Business Day', entitlementType: 'INITIAL', startDate: '2016-08-30T05:00:00Z', endDate: '2019-08-31T04:59:59.999Z' },
    { serviceLevelDescription: 'ProSupport', entitlementType: 'EXTENDED', startDate: '2019-08-31T05:00:00Z', endDate: '2021-08-31T04:59:59.999Z' },
    { serviceLevelDescription: 'no end', startDate: '2016-01-01T00:00:00Z' },
  ]);
  assert.equal(w.start, '2016-08-30T05:00:00Z');
  assert.equal(w.end, '2021-08-31T04:59:59.999Z');
  assert.equal(w.service, 'ProSupport');
  assert.equal(w.list.length, 2);
  assert.deepEqual(warrantyFrom(undefined), { start: null, end: null, service: null, list: [] });
});

test('model names are tidied the way the IT Store does it', () => {
  assert.equal(modelName('OPTIPLEX 7040'), 'OptiPlex 7040');
  assert.equal(modelName('DELL PRECISION TOWER 5810'), 'Precision Tower 5810');
  assert.equal(modelName('XPS 13 9310 2-IN-1'), 'XPS 13 9310 2-in-1');
  assert.equal(modelName(null), '');
  assert.equal(modelName('DELL EMC AX750'), 'EMC AX750');
  assert.equal(modelName('POWEREDGE R740XD'), 'PowerEdge R740XD');
  assert.equal(modelName('LATITUDE 7520'), 'Latitude 7520');
});

test('storage: decimal sizes and part quantities (parts from a real Dell EMC AX750)', async () => {
  const { specsFromComponents } = await import('../src/dell-specs.js');
  const part = (partQuantity, partDescription) => ({ partQuantity, partDescription });
  const specs = specsFromComponents({ components: [
    part(2, 'SSDR,240G,2E,IT06,M.2,C,53B,EC'), part(2, 'SSDR,3.8T,2N,FS12,2.5,X,P6,EC'),
    part(6, 'HD,8TB,722E,IS12,3.5,S,CM,EC'), part(1, 'HD,8.0T,722E,IS12,3.5,S-CBP,EC'), part(0, 'HD,4TB,REMOVED'),
  ] });
  assert.equal(specs.storage, '2x 240GB SSD + 2x 3.8TB SSD + 7x 8TB HDD');
  const laptop = specsFromComponents({ components: [part(1, 'SSDR,256G,P34,30S3,WDC'), part(1, 'Hard Drive,500,S3,7.2,512E')] });
  assert.equal(laptop.storage, '256GB SSD + 500GB HDD');
});

test('migration 2 adds the new columns and table and keeps existing data', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'inventory-migrate-'));
  const file = path.join(dir, 'scans.db');
  // A database as it was at schema version 1 (what is live before this change).
  const old = new DatabaseSync(file);
  old.exec(MIGRATIONS[0]);
  old.exec('PRAGMA user_version = 1');
  old.exec("INSERT INTO sessions (name, created_at) VALUES ('Test', '2026-11-06T15:00:00Z')");
  old.exec(`INSERT INTO scans (session_id, code, entry_method, client_id, created_at)
            VALUES (1, '7XK2Q93', 'scanner', 'old-scan-0001', '2026-11-06T15:01:00Z')`);
  old.close();

  const store = openStore(file);
  const [row] = store.sessionScans(1);
  assert.equal(row.code, '7XK2Q93');
  assert.equal(row.make, null);
  assert.equal(row.notes, null);
  const { scan } = store.addScan({ sessionId: 1, code: 'NEW1', method: 'manual', clientId: 'new-scan-0001', make: 'Dell', model: 'OptiPlex 7070', notes: 'no cord' });
  assert.deepEqual([scan.make, scan.model, scan.notes], ['Dell', 'OptiPlex 7070', 'no cord']);
  assert.equal(store.getDellAsset('7XK2Q93'), null);
  store.close();
  const check = new DatabaseSync(file, { readOnly: true });
  assert.equal(check.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
  check.close();
  rmSync(dir, { recursive: true, force: true });
});

// --- The Analyze API against a fake Dell server ------------------------------

let fakeDell;
let dellCalls = [];
let app;
let dataDir;

const COMPONENTS = {
  components: [
    { partDescription: 'PRC,I5-9500T,CFL-SR,2.2,6C,35W', partQuantity: 1, itemDescription: 'OptiPlex 7070 Micro XCTO' },
    { partDescription: 'Dual In-Line Memory Module,8GB,2666,1RX8,DDR4', partQuantity: 2 },
    { partDescription: 'SSDR,256G,P34,30S3,WDC', partQuantity: 1 },
    { partDescription: 'DPK,WIN10,PRO', partQuantity: 1 },
    { partDescription: 'Screw,M2X3', partQuantity: 0 },
  ],
};

before(async () => {
  fakeDell = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    dellCalls.push(url.pathname + url.search);
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/token') return json(200, { access_token: 'fake-token', expires_in: 3600 });
    if (req.headers.authorization !== 'Bearer fake-token') return json(401, {});
    const tag = url.searchParams.get('servicetags') ?? url.searchParams.get('servicetag');
    if (tag === 'FAIL001') return json(500, { error: 'down' });
    if (url.pathname === '/api/asset-entitlements') {
      if (tag !== '7XK2Q93') return json(200, [{ serviceTag: tag, invalid: true, entitlements: [] }]);
      return json(200, [{
        serviceTag: tag, invalid: false, productLineDescription: 'OPTIPLEX 7070', productLobDescription: 'OptiPlex Desktops',
        systemDescription: 'OptiPlex 7070', productFamily: 'all-products/desktops/optiplex-desktops', shipDate: '2020-01-15T06:00:00Z',
        entitlements: [{ serviceLevelDescription: 'ProSupport', entitlementType: 'INITIAL', startDate: '2020-01-15T06:00:00Z', endDate: '2099-01-16T05:59:59.999Z' }],
      }]);
    }
    if (url.pathname === '/api/asset-components') return json(200, COMPONENTS);
    return json(404, {});
  });
  await new Promise((resolve) => fakeDell.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${fakeDell.address().port}`;
  dataDir = mkdtempSync(path.join(tmpdir(), 'inventory-dell-test-'));
  app = await startServer({
    port: 0, host: '127.0.0.1', dataDir, quiet: true,
    dell: { clientId: 'id', clientSecret: 'secret', tokenUrl: `${base}/token`, apiBase: `${base}/api`, timeoutMs: 5000 },
  });
});

after(async () => {
  await app.close();
  await new Promise((resolve) => fakeDell.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
});

const url = (p) => `${app.url}${p}`;
const postJson = async (p, body) => {
  const res = await fetch(url(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('scans carry make, model and notes; the analysis groups codes and finds tags', async () => {
  const { body: { session } } = await postJson('/api/sessions', { name: 'Dell test' });
  const scans = [
    { code: '7XK2Q93', method: 'scanner', make: 'Dell', model: 'Optiplex 7070', notes: 'no power cord' },
    { code: '7xk2q93', method: 'manual', notes: 'scratched lid' },
    { code: 'https://www.dell.com/support/home/en-us/product-support/servicetag/ABCDEF1', method: 'camera', format: 'QR Code' },
    { code: 'FAIL001', method: 'scanner' },
    { code: 'ASSET-0042', method: 'manual', notes: 'monitor' },
  ];
  for (const s of scans) {
    const res = await postJson('/api/scans', { sessionId: session.id, ...s });
    assert.equal(res.status, 201);
  }
  const csv = await (await fetch(url(`/api/sessions/${session.id}/export.csv`))).text();
  assert.match(csv.split('\r\n')[0], /scanned_by,make,model,notes,/);
  assert.match(csv, /,Dell,Optiplex 7070,no power cord,/);

  const analysis = await (await fetch(url(`/api/sessions/${session.id}/analysis`))).json();
  assert.equal(analysis.dellConfigured, true);
  assert.deepEqual(analysis.rows.map((r) => [r.code, r.timesScanned, r.serviceTag]), [
    ['7XK2Q93', 2, '7XK2Q93'],
    ['https://www.dell.com/support/home/en-us/product-support/servicetag/ABCDEF1', 1, 'ABCDEF1'],
    ['FAIL001', 1, 'FAIL001'],
    ['ASSET-0042', 1, null],
  ]);
  assert.equal(analysis.rows[0].notes, 'no power cord | scratched lid');
  assert.equal(analysis.rows[0].make, 'Dell');
  assert.equal(analysis.rows[0].dell, null, 'not looked up yet');
});

test('Dell lookup: found, unknown and failed tags; specs parsed; answers cached', async () => {
  dellCalls = [];
  const res = await postJson('/api/dell/lookup', { tags: ['7xk2q93', 'ABCDEF1', 'FAIL001'] });
  assert.equal(res.status, 200);
  const { results } = res.body;
  const found = results['7XK2Q93'];
  assert.equal(found.status, 'found');
  assert.equal(found.model, 'OptiPlex 7070');
  assert.equal(found.productLine, 'OptiPlex Desktops');
  assert.equal(found.warrantyEnd, '2099-01-16T05:59:59.999Z');
  assert.equal(found.warrantyService, 'ProSupport');
  assert.equal(found.cpu, 'Intel Core i5-9500T 2.2GHz');
  assert.equal(found.ram, '16GB');
  assert.equal(found.storage, '256GB SSD');
  assert.equal(found.os, 'Windows 10 Pro');
  assert.equal(found.formFactor, 'Micro');
  assert.equal(found.systemDescription, 'OptiPlex 7070 Micro');
  assert.equal(results.ABCDEF1.status, 'not_found');
  assert.equal(results.FAIL001.status, 'error');
  assert.match(results.FAIL001.error, /HTTP 500/);
  assert.ok(dellCalls.some((c) => c === '/token'));

  // Asked again: only the failed tag goes back to Dell.
  dellCalls = [];
  const again = await postJson('/api/dell/lookup', { tags: ['7XK2Q93', 'ABCDEF1', 'FAIL001'] });
  assert.equal(again.body.looked, 1);
  assert.ok(dellCalls.every((c) => c.includes('FAIL001')), dellCalls.join(' '));
  // refresh: true asks for everything again.
  dellCalls = [];
  const refreshed = await postJson('/api/dell/lookup', { tags: ['7XK2Q93'], refresh: true });
  assert.equal(refreshed.body.looked, 1);
  assert.ok(dellCalls.some((c) => c.includes('asset-entitlements')));
});

test('the analysis and its CSV include the Dell data', async () => {
  const { sessions } = await (await fetch(url('/api/sessions'))).json();
  const id = sessions.find((s) => s.name === 'Dell test').id;
  const analysis = await (await fetch(url(`/api/sessions/${id}/analysis`))).json();
  assert.equal(analysis.rows[0].dell.model, 'OptiPlex 7070');
  assert.equal(analysis.rows[1].dell.status, 'not_found');
  const res = await fetch(url(`/api/sessions/${id}/analysis.csv`));
  assert.match(res.headers.get('content-disposition'), /filename="analysis-dell-test-\d{8}-\d{6}\.csv"/);
  const lines = (await res.text()).replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.ok(lines[0].startsWith('session,code,times_scanned,') && lines[0].includes(',make,model,description,notes,model_entered,'), lines[0]);
  assert.match(lines[1], /^Dell test,7XK2Q93,2,[^,]*,[^,]*,Dell,OptiPlex 7070,"OptiPlex 7070 Micro, OptiPlex Desktops",no power cord \| scratched lid,Optiplex 7070,,,,7XK2Q93,OptiPlex Desktops,2020-01-1[45],2099-01-1[56],Active,ProSupport,Intel Core i5-9500T 2\.2GHz,16GB,256GB SSD,,Windows 10 Pro,Micro,found,,,,,,,$/);
  assert.match(lines[2], /,QR Code,ABCDEF1,{12}not_found,/);
  assert.ok(lines[4].startsWith('Dell test,ASSET-0042,') && lines[4].includes(',monitor,') && lines[4].endsWith(',,,,,,,,'), lines[4]);
});

test('lookup input is checked; without Dell settings lookups are refused', async () => {
  for (const [body, message] of [[{}, /tags/], [{ tags: [] }, /No service tags/], [{ tags: ['SHORT'] }, /not a service tag/],
    [{ tags: Array.from({ length: 11 }, (_, i) => `ABCDE${String(i).padStart(2, '0')}`) }, /At most 10/]]) {
    const res = await postJson('/api/dell/lookup', body);
    assert.equal(res.status, 400);
    assert.match(res.body.error, message);
  }
  const bare = await startServer({ port: 0, host: '127.0.0.1', dataDir: mkdtempSync(path.join(tmpdir(), 'nodell-')), quiet: true, dell: { clientId: '', clientSecret: '', tokenUrl: 'x', apiBase: 'x' } });
  const res = await fetch(`${bare.url}/api/dell/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"tags":["7XK2Q93"]}' });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not set up/);
  await bare.close();
});

test('the Analyze page is served at /analyze', async () => {
  const res = await fetch(url('/analyze'));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Analyze data/);
  assert.equal((await fetch(url('/analyze.js'))).status, 200);
  assert.equal((await fetch(url('/service-tag.js'))).status, 200);
});
