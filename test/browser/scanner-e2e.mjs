// Browser test. Drives a real headless Chromium against the app to check what
// unit tests cannot: real keyboard events and focus, the Hand scanner timing,
// Manual mode, sessions, the offline queue, and Camera mode with a simulated
// camera that shows real barcodes (GS1 DataMatrix, GS1-128, Code 39, QR,
// Code 128) drawn by bwip-js. Talks to Chromium over the DevTools protocol
// with Node's built-in WebSocket.
//
// Run from the repository root:
//   docker build -f test/browser/Dockerfile -t inventory-scanner-e2e .
//   docker run --rm --shm-size=256m -v "$PWD":/app:ro inventory-scanner-e2e node test/browser/scanner-e2e.mjs
// Add  -e SCREENSHOT_DIR=/out -v /some/folder:/out  to also save screenshots.

import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { startServer } from '../../src/server.js';

const bwipjs = createRequire('/deps/package.json')('bwip-js');
const SCANNER_GAP_MS = 3; // plus protocol round trips, about 5 ms per key in total
const TYPING_GAP_MS = 130;
const CHROME = ['/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR;

// --- DevTools protocol client ------------------------------------------------

class Cdp {
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)), { once: true });
    });
    return new Cdp(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id) {
        const call = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) call.reject(new Error(`${call.method}: ${msg.error.message}`));
        else call.resolve(msg.result);
      } else {
        for (const handler of this.handlers.get(msg.method) ?? []) handler(msg.params);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }

  once(method) {
    return new Promise((resolve) => {
      const handler = (params) => {
        this.handlers.set(method, this.handlers.get(method).filter((h) => h !== handler));
        resolve(params);
      };
      this.on(method, handler);
    });
  }

  close() {
    this.ws.close();
  }
}

async function launchChrome() {
  if (!CHROME) throw new Error('Chromium not found; run this inside the test/browser image');
  const profile = mkdtempSync(path.join(tmpdir(), 'chrome-profile-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const browserUrl = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error(`Chromium did not start:\n${log}`)), 30_000);
    proc.stderr.on('data', (chunk) => {
      log += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(log);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    proc.once('exit', (code) => reject(new Error(`Chromium exited with ${code}:\n${log}`)));
  });
  const { host } = new URL(browserUrl);
  const targets = await (await fetch(`http://${host}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  return { proc, profile, cdp: await Cdp.connect(page.webSocketDebuggerUrl) };
}

// A simulated camera, installed in the page before its own scripts run:
// getUserMedia returns a canvas stream, and window.__fakeCamera.show() draws
// PNG barcodes onto that canvas. The PNG bytes go through a Blob, not a URL,
// so the page's real Content-Security-Policy stays in force.
const FAKE_CAMERA = `(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  const blank = () => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); };
  blank();
  setInterval(() => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1, 1); }, 100); // keep frames coming
  window.__fakeCamera = {
    async show(items) {
      blank();
      for (const item of items) {
        const bytes = Uint8Array.from(atob(item.png), (c) => c.charCodeAt(0));
        ctx.drawImage(await createImageBitmap(new Blob([bytes], { type: 'image/png' })), item.x, item.y);
      }
    },
    blank,
  };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => canvas.captureStream(15),
      enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'test-camera', label: 'Test camera', groupId: 'test' }],
    },
  });
})();`;

async function barcode(options) {
  const png = await bwipjs.toBuffer({ backgroundcolor: 'FFFFFF', ...options });
  return { png: png.toString('base64'), width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

// Five barcodes like those on a Dell label, laid out on one 1280x720 picture.
// (bwip-js "scale" is pixels per module; "padding" is the quiet zone.)
const DELL_LABEL = [
  { text: '(01)00884116312345(21)7XK2Q93', format: 'GS1 DataMatrix', opts: { bcid: 'gs1datamatrix', scale: 3, padding: 6 } },
  { text: 'https://www.dell.com/support/home/en-us/product-support/servicetag/7XK2Q93', format: 'QR Code', opts: { bcid: 'qrcode', scale: 2, padding: 6 } },
  { text: '7XK2Q93', format: 'Code 39', opts: { bcid: 'code39', scale: 2, height: 10, padding: 12 } },
  { text: '(01)00884116312345(10)LOT42', format: 'GS1-128', opts: { bcid: 'gs1-128', scale: 2, height: 10, padding: 12 } },
  { text: 'CN0F1R2T7618083A01QBA00', format: 'Code 128', opts: { bcid: 'code128', scale: 2, height: 10, padding: 12 } },
];

async function layout(codes) {
  const images = [];
  let x = 30;
  let y = 30;
  let rowHeight = 0;
  for (const code of codes) {
    const image = await barcode({ text: code.text, ...code.opts });
    if (x + image.width > 1250) {
      x = 30;
      y += rowHeight + 40;
      rowHeight = 0;
    }
    // A code drawn outside the 1280x720 picture could never be read.
    if (x + image.width > 1280 || y + image.height > 720) {
      throw new Error(`test picture too small for ${code.opts.bcid} (${image.width}x${image.height} at ${x},${y})`);
    }
    images.push({ png: image.png, x, y });
    x += image.width + 40;
    rowHeight = Math.max(rowHeight, image.height);
  }
  return images;
}

// --- Test setup ---------------------------------------------------------------

// A fake Dell TechDirect API: tag 7XK2Q93 is an OptiPlex 7070 under warranty;
// every other tag is unknown. The real Dell API is never called.
const fakeDell = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (body) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (u.pathname === '/token') return json({ access_token: 't', expires_in: 3600 });
  const tag = u.searchParams.get('servicetags') ?? u.searchParams.get('servicetag');
  if (u.pathname === '/api/asset-entitlements') {
    return json([tag === '7XK2Q93'
      ? { serviceTag: tag, invalid: false, productLineDescription: 'OPTIPLEX 7070', productLobDescription: 'OptiPlex Desktops',
        shipDate: '2020-01-15T06:00:00Z', entitlements: [{ serviceLevelDescription: 'ProSupport', startDate: '2020-01-15T06:00:00Z', endDate: '2099-01-16T05:59:59Z' }] }
      : { serviceTag: tag, invalid: true, entitlements: [] }]);
  }
  return json({ components: [
    { partDescription: 'PRC,I5-9500T,CFL-SR,2.2,6C,35W', partQuantity: 1, itemDescription: 'OptiPlex 7070 Micro XCTO' },
    { partDescription: 'Dual In-Line Memory Module,8GB,2666', partQuantity: 2 },
    { partDescription: 'SSDR,256G,P34', partQuantity: 1 },
  ] });
});
await new Promise((resolve) => fakeDell.listen(0, '127.0.0.1', resolve));
const DELL = {
  clientId: 'id', clientSecret: 'secret', timeoutMs: 5000,
  tokenUrl: `http://127.0.0.1:${fakeDell.address().port}/token`, apiBase: `http://127.0.0.1:${fakeDell.address().port}/api`,
};

// A fake Cisco Product Information API: FOC1632X0AB is a Catalyst 2960-X.
const fakeCisco = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (req.url === '/token') return res.end(JSON.stringify({ access_token: 't', expires_in: 3600 }));
  const serials = decodeURIComponent(req.url.split('/serial_numbers/')[1] ?? '').split(',');
  res.end(JSON.stringify({ product_list: serials.filter((sn) => sn === 'FOC1632X0AB').map((sn) => ({
    sr_no: sn, orderable_pid: 'WS-C2960X-48FPD-L', base_pid: 'WS-C2960X-48FPD-L', product_type: 'SWITCH',
    product_name: 'Catalyst 2960-X 48 GigE PoE 740W, 2 x 10G SFP+, LAN Base', product_series: 'Cisco Catalyst 2960-X Series Switches',
  })) }));
});
await new Promise((resolve) => fakeCisco.listen(0, '127.0.0.1', resolve));
const CISCO = {
  clientId: 'id', clientSecret: 'secret', timeoutMs: 5000,
  tokenUrl: `http://127.0.0.1:${fakeCisco.address().port}/token`, apiBase: `http://127.0.0.1:${fakeCisco.address().port}`,
};

const dataDir = mkdtempSync(path.join(tmpdir(), 'inventory-scanner-e2e-'));
let app = await startServer({ port: 0, host: '127.0.0.1', dataDir, quiet: true, dell: DELL, cisco: CISCO });
const appOrigin = new URL(app.url).origin;
const { proc: chrome, profile, cdp } = await launchChrome();

const pageErrors = [];
const foreignRequests = [];
cdp.on('Runtime.exceptionThrown', (p) => pageErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
cdp.on('Runtime.consoleAPICalled', (p) => {
  if (p.type === 'error') pageErrors.push(p.args.map((a) => a.value ?? a.description).join(' '));
});
cdp.on('Log.entryAdded', ({ entry }) => {
  // Refused connections are expected while the server is deliberately down.
  if (entry.level === 'error' && !/ERR_CONNECTION_REFUSED|Failed to load resource/.test(entry.text)) {
    pageErrors.push(entry.text);
  }
});
cdp.on('Network.requestWillBeSent', ({ request }) => {
  if (!request.url.startsWith(appOrigin) && !request.url.startsWith('data:') && !request.url.startsWith('blob:')) {
    foreignRequests.push(request.url);
  }
});
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Log.enable');
await cdp.send('Network.enable');
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_CAMERA });
// Headless pages are never "focused" unless told to be.
await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(`page error: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
  return result.result.value;
}

async function waitFor(check, what, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function keyFor(ch) {
  if (/^[a-z]$/i.test(ch)) return { code: `Key${ch.toUpperCase()}`, vk: ch.toUpperCase().charCodeAt(0) };
  if (/^[0-9]$/.test(ch)) return { code: `Digit${ch}`, vk: ch.charCodeAt(0) };
  const keys = { '-': ['Minus', 189], ' ': ['Space', 32], '/': ['Slash', 191], '<': ['Comma', 188], '>': ['Period', 190] };
  const [code, vk] = keys[ch] ?? ['', 0];
  return { code, vk };
}

async function type(text, gapMs) {
  for (const ch of text) {
    const { code, vk } = keyFor(ch);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, windowsVirtualKeyCode: vk, text: ch, unmodifiedText: ch });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: vk });
    if (gapMs) await sleep(gapMs);
  }
}

async function press(key) {
  const keys = { Enter: ['Enter', 13, '\r'], Tab: ['Tab', 9, null], Escape: ['Escape', 27, null] };
  const [code, vk, text] = keys[key];
  await cdp.send('Input.dispatchKeyEvent', {
    type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}),
  });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
}

const sessionId = () => evaluate("JSON.parse(localStorage.getItem('inventoryScanner.session.v1'))?.id ?? null");
const allScans = () => app.store.listSessions().flatMap((s) => app.store.recentScans(s.id, 500));
const stored = (code) => allScans().filter((s) => s.code === code);
const boxValue = () => evaluate("document.getElementById('code').value");
const focused = () => evaluate('document.activeElement?.id ?? ""');
const resultKind = () => evaluate("document.getElementById('result').dataset.kind");
const readiness = () => evaluate("document.getElementById('scanCard').dataset.ready");
const clickMode = (mode) => evaluate(`document.querySelector('input[name="mode"][value="${mode}"]').click()`);

async function createSession(name) {
  if (!(await evaluate("document.getElementById('sessionsDialog').open"))) {
    await evaluate("document.getElementById('newSession').click()");
  }
  await waitFor(() => evaluate("document.getElementById('sessionsDialog').open"), 'the sessions dialog');
  await evaluate(`(() => {
    document.getElementById('newSessionName').value = ${JSON.stringify(name)};
    document.getElementById('newSessionForm').requestSubmit();
  })()`);
  await waitFor(async () => (await evaluate("document.getElementById('sessionName').textContent")) === name, `session "${name}"`);
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`PASS  ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`FAIL  ${name}\n      ${err.message}`);
    await press('Escape').catch(() => {}); // leave the box empty for the next check
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function screenshot(name, { width, height, mobile = false, dark = false }) {
  if (!SCREENSHOT_DIR) return;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  await sleep(400);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(path.join(SCREENSHOT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  console.log(`      screenshot ${name}.png`);
}

// --- Checks -------------------------------------------------------------------

const loaded = cdp.once('Page.loadEventFired');
await cdp.send('Page.navigate', { url: `${app.url}/` });
await loaded;

await check('first visit opens the sessions dialog; a new session becomes active', async () => {
  await waitFor(() => evaluate("document.getElementById('sessionsDialog').open"), 'the dialog to open by itself');
  expect(await evaluate("document.getElementById('newSessionName').value.startsWith('Session ')"), 'a name should be suggested');
  expect((await readiness()) === 'nosession', 'status should ask for a session');
  await screenshot('sessions-dialog-first', { width: 1280, height: 900 });
  await createSession('E2E Bay 3');
  expect(!(await evaluate("document.getElementById('sessionsDialog').open")), 'dialog should close');
  await waitFor(async () => (await focused()) === 'code', 'the cursor in the scan box');
  expect((await readiness()) === 'ready', 'status should be ready');
  expect((await evaluate("document.querySelector('input[name=mode]:checked').value")) === 'scanner', 'Hand scanner is the default mode');
});

await check('Hand scanner: a burst with no Enter saves about 1 second after the scanner stops', async () => {
  await type('INV-000123', SCANNER_GAP_MS);
  const typedAt = Date.now();
  await sleep(600);
  expect(stored('INV-000123').length === 0, 'saved too early (before the 1 s quiet time)');
  await waitFor(() => stored('INV-000123').length === 1, 'the scan in the database', 3000);
  const after = Date.now() - typedAt;
  expect(after >= 900 && after <= 2000, `saved after ${after} ms`);
  expect(stored('INV-000123')[0].method === 'scanner', 'method should be scanner');
  await waitFor(async () => (await resultKind()) === 'saved', 'the Saved message');
  console.log(`      saved ${after} ms after the last keystroke`);
});

await check('Hand scanner: slower typing also saves itself after 1 second of quiet', async () => {
  await type('TYPED-42', TYPING_GAP_MS);
  await waitFor(() => stored('TYPED-42').length === 1, 'the entry in the database', 3000);
  expect((await boxValue()) === '', 'box should be empty');
});

await check('Hand scanner: two scans less than a second apart are kept apart', async () => {
  await type('SPLIT-AAA1', SCANNER_GAP_MS);
  await sleep(500);
  await type('SPLIT-BBB2', SCANNER_GAP_MS);
  await waitFor(() => stored('SPLIT-BBB2').length === 1, 'the second code', 3000);
  expect(stored('SPLIT-AAA1').length === 1, 'first code missing');
  expect(stored('SPLIT-AAA1SPLIT-BBB2').length === 0, 'the two codes were glued together');
});

await check('Hand scanner: a scanner that sends Enter or Tab saves at once, once', async () => {
  await type('ENTER-555', SCANNER_GAP_MS);
  await press('Enter');
  await waitFor(() => stored('ENTER-555').length === 1, 'the Enter code', 400);
  await type('TAB-888', SCANNER_GAP_MS);
  await press('Tab');
  await waitFor(() => stored('TAB-888').length === 1, 'the Tab code', 400);
  await sleep(1300);
  expect(stored('ENTER-555').length === 1 && stored('TAB-888').length === 1, 'a code was stored twice');
  expect((await focused()) === 'code', `focus moved to "${await focused()}"`);
});

await check('a repeat in the same session is flagged', async () => {
  await type('INV-000123', SCANNER_GAP_MS);
  await press('Enter');
  await waitFor(async () => (await resultKind()) === 'duplicate', 'the repeat warning');
  await waitFor(() => evaluate("[...document.querySelectorAll('#recentBody .badge')].some((b) => b.textContent === '×2')"), 'the ×2 badge');
});

await check('a scan still lands whole when the cursor is not in the scan box', async () => {
  await evaluate('document.activeElement.blur()');
  expect((await focused()) !== 'code', 'the box should have lost the focus');
  await type('FOCUS-777', SCANNER_GAP_MS);
  await press('Enter');
  await waitFor(() => stored('FOCUS-777').length === 1, 'the scan in the database', 1000);
  expect(stored('OCUS-777').length === 0, 'the first character was lost');
});

await check('Manual: nothing saves until Enter, even a fast burst', async () => {
  await clickMode('manual');
  await waitFor(async () => (await focused()) === 'code', 'focus back in the box');
  await type('MANUAL-BURST', SCANNER_GAP_MS);
  await sleep(1600);
  expect(stored('MANUAL-BURST').length === 0, 'Manual mode saved without Enter');
  expect((await boxValue()) === 'MANUAL-BURST', 'box should keep the text');
  expect((await evaluate("document.getElementById('hint').dataset.state")) === 'waiting', 'hint should ask for Enter');
  await press('Enter');
  await waitFor(() => stored('MANUAL-BURST').length === 1, 'the entry after Enter', 1000);
  expect(stored('MANUAL-BURST')[0].method === 'manual', 'method should be manual');
  await type('AB1', TYPING_GAP_MS);
  await press('Escape');
  expect((await boxValue()) === '', 'Esc should clear the box');
});

await check('location and scanned-by are saved with each scan; Enter goes back to scanning', async () => {
  await evaluate("document.getElementById('location').focus()");
  await waitFor(async () => (await readiness()) === 'elsewhere', 'the paused warning');
  await type('Bay 3', 40);
  await press('Enter');
  expect((await focused()) === 'code', 'Enter in Location should return to the scan box');
  await evaluate("document.getElementById('scannedBy').value = 'Pat'; document.getElementById('scannedBy').dispatchEvent(new Event('input'))");
  await type('LOC-0001', SCANNER_GAP_MS);
  await press('Enter');
  await waitFor(() => stored('LOC-0001').length === 1, 'the scan in the database', 1000);
  const [row] = stored('LOC-0001');
  expect(row.location === 'Bay 3' && row.scannedBy === 'Pat', `got location=${row.location} scannedBy=${row.scannedBy}`);
});

await check('optional details: unticked fields clear after a scan, sticky ones stay', async () => {
  await evaluate("document.querySelector('#moreDetails summary').click()");
  expect(await evaluate("document.getElementById('moreDetails').open"), 'More details should open');
  expect(await evaluate("document.getElementById('stickyLocation').checked && !document.getElementById('stickyMake').checked"),
    'Location starts sticky, Make does not');
  await evaluate("document.getElementById('make').focus()");
  await type('Dell', 40);
  await press('Enter');
  expect((await focused()) === 'code', 'Enter in Make should return to the scan box');
  await evaluate(`(() => {
    for (const [id, value] of [['model', 'OptiPlex 7070'], ['notes', 'no power cord']]) {
      const f = document.getElementById(id); f.value = value; f.dispatchEvent(new Event('input'));
    }
    document.getElementById('stickyModel').click();
  })()`);
  await evaluate("document.getElementById('code').focus()");
  await type('DETAIL-0001', SCANNER_GAP_MS);
  await press('Enter');
  await waitFor(() => stored('DETAIL-0001').length === 1, 'the scan in the database', 1000);
  const [first] = stored('DETAIL-0001');
  expect(first.make === 'Dell' && first.model === 'OptiPlex 7070' && first.notes === 'no power cord' && first.location === 'Bay 3',
    `got make=${first.make} model=${first.model} notes=${first.notes} location=${first.location}`);
  const left = await evaluate("['location','make','model','notes'].map((id) => document.getElementById(id).value)");
  expect(JSON.stringify(left) === JSON.stringify(['Bay 3', '', 'OptiPlex 7070', '']), `fields after the scan: ${JSON.stringify(left)}`);
  await type('DETAIL-0002', SCANNER_GAP_MS);
  await press('Enter');
  await waitFor(() => stored('DETAIL-0002').length === 1, 'the second scan', 1000);
  const [second] = stored('DETAIL-0002');
  expect(second.make === null && second.notes === null && second.model === 'OptiPlex 7070', 'second scan should keep only the sticky model');
  await screenshot('details-sticky', { width: 1280, height: 1500 });
  await evaluate(`(() => {
    document.getElementById('stickyModel').click();
    const f = document.getElementById('model'); f.value = ''; f.dispatchEvent(new Event('input'));
    document.getElementById('code').focus();
  })()`);
});

await check('codes are shown as plain text, never as HTML', async () => {
  await type('<b>XSS</b>', SCANNER_GAP_MS);
  await press('Enter');
  await waitFor(() => stored('<b>XSS</b>').length === 1, 'the scan in the database', 1000);
  await waitFor(() => evaluate("[...document.querySelectorAll('#recentBody td.col-code')].some((td) => td.textContent.startsWith('<b>XSS</b>'))"), 'the row in the table');
  expect(await evaluate("document.querySelector('#recentBody b, #result b') === null"), 'markup was rendered as HTML');
});

await check('Remove needs a second click, then the scan stops counting', async () => {
  await evaluate("document.getElementById('resultRemove').click()");
  expect((await evaluate("document.getElementById('resultRemove').textContent")) === 'Click again to remove', 'first click should ask again');
  expect(stored('<b>XSS</b>').length === 1, 'removed after one click');
  await evaluate("document.getElementById('resultRemove').click()");
  await waitFor(() => stored('<b>XSS</b>').length === 0, 'the removal', 3000);
  await waitFor(async () => (await resultKind()) === 'removed', 'the Removed message');
});

await check('a scan made while the server is down is kept and sent once it is back', async () => {
  const { port } = app;
  await app.close();
  await type('OFFLINE-1', SCANNER_GAP_MS);
  await press('Enter');
  await waitFor(async () => (await resultKind()) === 'queued', 'the not-saved-yet warning', 5000);
  expect((await evaluate("document.getElementById('statPending').textContent")) === '1', 'pending count should be 1');
  expect(await evaluate("getComputedStyle(document.getElementById('resultRemove')).display === 'none'"), 'Remove should be hidden while unsaved');
  app = await startServer({ port, host: '127.0.0.1', dataDir, quiet: true, dell: DELL, cisco: CISCO });
  await waitFor(() => stored('OFFLINE-1').length === 1, 'the queued scan to arrive', 20_000);
  await waitFor(async () => (await evaluate("document.getElementById('statPending').textContent")) === '0', 'pending back to 0');
  await sleep(1500);
  expect(stored('OFFLINE-1').length === 1, 'the queued scan was stored twice');
});

let bayId;
await check('sessions: a second session starts empty; switching back shows the first one again', async () => {
  bayId = await sessionId();
  await createSession('E2E Lot 14');
  const lotId = await sessionId();
  expect(lotId !== bayId, 'a new session should be active');
  await waitFor(async () => (await evaluate("document.getElementById('statTotal').textContent")) === '0', 'empty totals');
  expect(await evaluate("document.getElementById('recentBody').children.length === 0"), 'recent list should be empty');
  await clickMode('scanner');
  await type('LOT-0001', SCANNER_GAP_MS);
  await press('Enter');
  await waitFor(() => stored('LOT-0001').length === 1, 'the scan in the database', 1000);
  expect(stored('LOT-0001')[0].sessionId === lotId, 'scan went to the wrong session');
  await evaluate("document.getElementById('switchSession').click()");
  await waitFor(() => evaluate(`!!document.querySelector('button[data-open-session="${bayId}"]')`), 'the session list');
  await screenshot('sessions-dialog', { width: 1280, height: 900 });
  await evaluate(`document.querySelector('button[data-open-session="${bayId}"]').click()`);
  await waitFor(async () => (await sessionId()) === bayId, 'the first session to be active again');
  await waitFor(() => evaluate("[...document.querySelectorAll('#recentBody td.col-code')].some((td) => td.textContent.startsWith('INV-000123'))"), 'the first session\'s scans');
  const csv = await evaluate(`fetch('/api/sessions/${bayId}/export.csv').then((r) => r.text())`);
  expect(csv.includes('INV-000123') && !csv.includes('LOT-0001'), 'the session CSV should hold only its own scans');
  const link = await evaluate("document.getElementById('exportSession').getAttribute('href')");
  expect(link === `/api/sessions/${bayId}/export.csv`, `export link is ${link}`);
});

await check('Camera: every barcode on a Dell-style label is read and saved once, with its format', async () => {
  await createSession('E2E Camera');
  const camSession = await sessionId();
  await evaluate(`window.__fakeCamera.show(${JSON.stringify(await layout(DELL_LABEL))})`);
  await clickMode('camera');
  await waitFor(() => evaluate("document.getElementById('cameraView').dataset.state === 'running'"), 'the camera to start', 10_000);
  const saved = () => app.store.recentScans(camSession, 100);
  try {
    await waitFor(() => saved().length >= DELL_LABEL.length, 'all five codes to be saved', 20_000);
  } catch (err) {
    const got = saved().map((r) => `${r.format}: ${r.code}`);
    const missing = DELL_LABEL.filter((c) => !saved().some((r) => r.code === c.text)).map((c) => c.format);
    throw new Error(`${err.message}; missing ${missing.join(', ')}; saved [${got.join(' | ')}]`);
  }
  await sleep(2000); // the label stays in view: nothing may be saved twice
  const rows = saved();
  for (const code of DELL_LABEL) {
    const hits = rows.filter((r) => r.code === code.text);
    expect(hits.length === 1, `${code.format} "${code.text}" saved ${hits.length} times`);
    expect(hits[0].method === 'camera', `${code.format} method ${hits[0].method}`);
    expect(hits[0].format === code.format, `expected format "${code.format}", got "${hits[0].format}"`);
  }
  expect(rows.length === DELL_LABEL.length, `extra codes saved: ${rows.map((r) => `${r.format}:${r.code}`).join(', ')}`);
  const meta = await evaluate("[...document.querySelectorAll('.found-meta')].map((m) => m.textContent)");
  expect(meta.some((m) => m === 'GS1 DataMatrix · GTIN 00884116312345 · Serial 7XK2Q93'), `GS1 fields not shown: ${meta.join(' | ')}`);
  await screenshot('camera-desktop', { width: 1280, height: 1300 });
  await screenshot('camera-phone', { width: 390, height: 1500, mobile: true });
});

await check('Camera: with automatic saving off, a code waits for a tap on Save', async () => {
  await evaluate("document.getElementById('cameraAuto').click()");
  await evaluate("document.getElementById('foundClear').click()");
  await evaluate(`window.__fakeCamera.show(${JSON.stringify(await layout([{ text: 'TAP-TO-SAVE-1', opts: { bcid: 'code128', scale: 3, height: 16, padding: 24 } }]))})`);
  await waitFor(() => evaluate("!!document.querySelector('button[data-save-found]')"), 'the code with a Save button', 10_000);
  await sleep(800);
  expect(stored('TAP-TO-SAVE-1').length === 0, 'saved without a tap');
  await evaluate("document.querySelector('button[data-save-found]').click()");
  await waitFor(() => stored('TAP-TO-SAVE-1').length === 1, 'the tapped code in the database', 3000);
  await waitFor(() => evaluate("document.querySelector('.found-item')?.dataset.status === 'saved'"), 'the item marked saved');
  await sleep(800);
  expect(stored('TAP-TO-SAVE-1').length === 1, 'tapped code saved twice');
  await evaluate("document.getElementById('cameraAuto').click()"); // back on, as it was
});

await check('leaving Camera mode stops the camera', async () => {
  await clickMode('scanner');
  await waitFor(() => evaluate("document.getElementById('cameraVideo').srcObject === null"), 'the camera to stop');
  await waitFor(async () => (await focused()) === 'code', 'focus in the scan box');
});

await check('Analyze data: one lookup fills in Dell (model, warranty, specs) and Cisco (model, description)', async () => {
  const camSession = await sessionId();
  await fetch(`${app.url}/api/scans`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: camSession, code: 'FOC1632X0AB', method: 'scanner' }) });
  const loadedAnalyze = cdp.once('Page.loadEventFired');
  await evaluate("document.querySelector('a.nav-link[href=\"/analyze\"]').click()");
  await loadedAnalyze;
  await waitFor(() => evaluate("document.querySelectorAll('#rows tr').length > 0"), 'the analysis rows', 5000);
  expect((await evaluate("document.getElementById('sessionSelect').value")) === String(camSession), 'should open the scan page\'s session');
  expect(await evaluate("!document.getElementById('lookupButton').disabled"), 'Look up should be enabled');
  await evaluate("document.getElementById('lookupButton').click()");
  await waitFor(() => evaluate("document.getElementById('progressText').textContent.startsWith('Done')"), 'the lookup to finish', 10_000);
  const texts = await evaluate("[...document.querySelectorAll('#rows tr')].map((tr) => tr.innerText.replace(/\\s+/g, ' '))");
  const dellRows = texts.filter((t) => t.includes('Dell OptiPlex 7070'));
  expect(dellRows.length === 3, `the Code 39, QR and GS1 DataMatrix rows all carry tag 7XK2Q93; got:\n${texts.join('\n')}`);
  expect(dellRows.every((t) => t.includes('Active') && t.includes('Intel Core i5-9500T')), 'warranty and specs missing');
  expect((await evaluate("document.getElementById('sumActive').textContent")) === '3', 'summary should count 3 active warranties');
  const cisco = texts.find((t) => t.includes('FOC1632X0AB')) ?? '';
  expect(cisco.includes('Cisco WS-C2960X-48FPD-L') && cisco.includes('Catalyst 2960-X 48 GigE PoE 740W') && cisco.includes('Built 2012'),
    `Cisco row incomplete: ${cisco}`);
  const csv = await evaluate(`fetch('/api/sessions/${camSession}/analysis.csv').then((r) => r.text())`);
  expect(csv.includes('OptiPlex 7070') && csv.includes('Active'), 'analysis CSV lacks the Dell data');
  await screenshot('analyze-desktop', { width: 1280, height: 900 });
  await screenshot('analyze-phone', { width: 390, height: 1200, mobile: true });
  const back = cdp.once('Page.loadEventFired');
  await evaluate("document.querySelector('a.nav-link[href=\"/\"]').click()");
  await back;
  await waitFor(async () => (await focused()) === 'code', 'the scan page again');
});

await check('nothing was fetched from outside this server, and no browser console errors', async () => {
  expect(foreignRequests.length === 0, `outside requests: ${foreignRequests.join(', ')}`);
  expect(pageErrors.length === 0, pageErrors.join('\n      '));
});

// Pictures of the finished page, for a human to look at.
await clickMode('scanner');
await type('DELL-7XK2Q93', SCANNER_GAP_MS);
await press('Enter');
await waitFor(() => stored('DELL-7XK2Q93').length === 1, 'the last scan', 3000);
await sleep(400);
await screenshot('desktop-light', { width: 1280, height: 1000 });
await screenshot('desktop-dark', { width: 1280, height: 1000, dark: true });
await screenshot('phone-light', { width: 390, height: 844, mobile: true });

// --- Clean up -----------------------------------------------------------------

cdp.close();
// Chromium keeps writing to its profile until it has fully exited.
const chromeExited = new Promise((resolve) => chrome.once('exit', resolve));
chrome.kill();
await Promise.race([chromeExited, sleep(5000)]);
await app.close();
fakeDell.close();
fakeCisco.close();
rmSync(dataDir, { recursive: true, force: true });
rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
