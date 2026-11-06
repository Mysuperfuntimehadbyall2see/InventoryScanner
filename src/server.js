// HTTP server for the Inventory Scanner, built on Node's own http module
// (no Express or other packages). It serves the page in public/ and a small
// JSON API:
//
//   GET    /api/sessions                     every session with its totals, most recently used first
//   POST   /api/sessions                     create one: {name}
//   GET    /api/sessions/:id                 one session with its totals
//   GET    /api/sessions/:id/scans?limit=25  that session's newest scans
//   GET    /api/sessions/:id/export.csv      that session's scans as a spreadsheet
//   POST   /api/scans                        store one scan: {sessionId, code, method, format?, clientId?, location?, scannedBy?, clientTime?}
//   DELETE /api/scans/:id                    remove a scan (kept in the database, marked removed)
//   GET    /api/export.csv                   every session's scans as one spreadsheet
//   GET    /api/sessions/:id/analysis        one row per distinct code, with Dell data (Analyze page)
//   GET    /api/sessions/:id/analysis.csv    the same as a spreadsheet
//   POST   /api/dell/lookup                  look up service tags with Dell: {tags: [...up to 10], refresh?}
//   POST   /api/cisco/lookup                 look up Cisco serials with Cisco: {serials: [...up to 10], refresh?}
//   GET    /healthz                          "ok" when the database answers (Docker and proxy health checks)

import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { openStore, ConflictError, ENTRY_METHODS } from './db.js';
import { createDellClient, dellConfigFromEnv } from './dell.js';
import { createCiscoClient, ciscoConfigFromEnv } from './cisco.js';
import { ciscoSerialFrom } from '../public/cisco-serial.js';
import { buildAnalysis, warrantyStatus } from './analysis.js';

export const LIMITS = Object.freeze({
  codeLength: 256, // characters in one code
  textLength: 100, // characters in location, "scanned by", make and model
  notesLength: 1000,
  dellBatch: 10, // service tags per lookup request (keeps each request well under a proxy's time limit)
  sessionName: 80,
  formatLength: 40,
  bodyBytes: 16 * 1024,
  listDefault: 25,
  listMax: 200,
});

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
};

// Sent with every response. The page uses no inline scripts or styles and
// talks only to this server. 'wasm-unsafe-eval' lets the barcode decoder
// (WebAssembly, served from /vendor) start; it does not allow eval() of
// JavaScript. The camera may be used by this site only.
const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self'; " +
    "connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; " +
    "frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

// Control characters and invisible "zero-width" characters are dropped. A
// scanner can send them, and they would make two identical-looking codes
// compare as different.
const INVISIBLE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u2060\uFEFF]/g;
const CLIENT_ID = /^[A-Za-z0-9-]{8,64}$/;
const MAX_CLIENT_CLOCK_SKEW_MS = 30 * 24 * 60 * 60 * 1000;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function cleanText(value, field) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text.`);
  return value.normalize('NFC').replace(INVISIBLE_CHARS, '').trim();
}

function optionalText(value, field, max) {
  const text = cleanText(value, field);
  if (text.length > max) throw new HttpError(400, `${field} is longer than ${max} characters.`);
  return text || null;
}

function positiveId(value, field) {
  const n = typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(400, `${field} must be a session number.`);
  return n;
}

export function parseSessionName(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Send a JSON object.');
  const name = cleanText(body.name, 'name').replace(/\s+/g, ' ');
  if (!name) throw new HttpError(400, 'The session name is empty.');
  if (name.length > LIMITS.sessionName) {
    throw new HttpError(400, `The session name is longer than ${LIMITS.sessionName} characters.`);
  }
  return name;
}

// Checks and tidies a POST /api/scans body. Throws HttpError(400) on bad input.
export function parseScanInput(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Send a JSON object.');
  }
  const sessionId = positiveId(body.sessionId, 'sessionId');
  const code = cleanText(body.code, 'code');
  if (!code) throw new HttpError(400, 'The code is empty.');
  if (code.length > LIMITS.codeLength) {
    throw new HttpError(400, `The code is longer than ${LIMITS.codeLength} characters.`);
  }

  const method = body.method ?? 'manual';
  if (!ENTRY_METHODS.includes(method)) {
    throw new HttpError(400, `method must be one of: ${ENTRY_METHODS.join(', ')}.`);
  }

  let clientId = body.clientId;
  if (clientId === undefined || clientId === null || clientId === '') {
    clientId = randomUUID();
  } else if (typeof clientId !== 'string' || !CLIENT_ID.test(clientId)) {
    throw new HttpError(400, 'clientId must be 8 to 64 letters, digits or dashes.');
  }

  // The browser's own time of the scan. Only informational (the server's
  // created_at is the record), and ignored if it is missing or implausible.
  let clientTime = null;
  if (typeof body.clientTime === 'string') {
    const t = Date.parse(body.clientTime);
    if (Number.isFinite(t) && Math.abs(t - now) <= MAX_CLIENT_CLOCK_SKEW_MS) {
      clientTime = new Date(t).toISOString();
    }
  }

  return {
    sessionId,
    code,
    method,
    clientId,
    format: optionalText(body.format, 'format', LIMITS.formatLength),
    location: optionalText(body.location, 'location', LIMITS.textLength),
    scannedBy: optionalText(body.scannedBy, 'scannedBy', LIMITS.textLength),
    make: optionalText(body.make, 'make', LIMITS.textLength),
    model: optionalText(body.model, 'model', LIMITS.textLength),
    notes: optionalText(body.notes, 'notes', LIMITS.notesLength),
    clientTime,
  };
}

// Spreadsheet programs run a cell that starts with = + - @ as a formula. A
// leading apostrophe makes them show it as text instead (OWASP "CSV injection").
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

const SERVICE_TAG = /^[A-Z0-9]{7}$/i;

export function parseCiscoLookupInput(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.serials)) throw new HttpError(400, 'Send {"serials": [...]}.');
  const serials = [...new Set(body.serials.map((t) => (typeof t === 'string' ? ciscoSerialFrom(t) ?? t.trim() : '')))];
  if (serials.length === 0) throw new HttpError(400, 'No serial numbers given.');
  if (serials.length > LIMITS.dellBatch) throw new HttpError(400, `At most ${LIMITS.dellBatch} serial numbers per request.`);
  const bad = serials.find((t) => !ciscoSerialFrom(t));
  if (bad !== undefined) throw new HttpError(400, `"${bad}" is not a Cisco serial number (3 letters, 4 digits, 4 letters or digits).`);
  return { serials, refresh: body.refresh === true };
}

export function parseLookupInput(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.tags)) throw new HttpError(400, 'Send {"tags": [...]}.');
  const tags = [...new Set(body.tags.map((t) => (typeof t === 'string' ? t.trim().toUpperCase() : '')))];
  if (tags.length === 0) throw new HttpError(400, 'No service tags given.');
  if (tags.length > LIMITS.dellBatch) throw new HttpError(400, `At most ${LIMITS.dellBatch} service tags per request.`);
  const bad = tags.find((t) => !SERVICE_TAG.test(t));
  if (bad !== undefined) throw new HttpError(400, `"${bad}" is not a service tag (7 letters and digits).`);
  return { tags, refresh: body.refresh === true };
}

function fileStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

// A file-name-safe version of a session name: "Bay 3 / Nov" -> "bay-3-nov".
export function slug(text) {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'session';
}

// Every file under public/ is read once at start-up and served from memory,
// so a request can only ever get one of these exact paths. Each gets an ETag
// (the browser re-uses its copy when nothing changed) and a gzip copy.
function loadPublicFiles(subtitle = '') {
  // The optional subtitle under the page title (APP_SUBTITLE), HTML-escaped.
  const subtitleHtml = subtitle
    ? `<p class="brand-sub">${subtitle.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</p>`
    : '';
  const files = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const type = CONTENT_TYPES[path.extname(entry.name)];
      if (!type) continue;
      let body = readFileSync(full);
      if (entry.name.endsWith('.html')) body = Buffer.from(body.toString('utf8').replaceAll('<!--APP_SUBTITLE-->', subtitleHtml));
      const urlPath = `/${path.relative(PUBLIC_DIR, full).split(path.sep).join('/')}`;
      files.set(urlPath, {
        body,
        gzip: gzipSync(body, { level: 9 }),
        type,
        etag: `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`,
      });
    }
  };
  walk(PUBLIC_DIR);
  files.set('/', files.get('/index.html'));
  files.set('/analyze', files.get('/analyze.html'));
  return files;
}

export async function startServer({
  port = 3000,
  host = '0.0.0.0',
  dataDir,
  trustProxy = false,
  timeZone = 'UTC',
  subtitle = '',
  quiet = false,
  dell = dellConfigFromEnv(),
  cisco = ciscoConfigFromEnv(),
} = {}) {
  if (!dataDir) throw new Error('dataDir is required');
  const dellClient = createDellClient(dell);
  const ciscoClient = createCiscoClient(cisco);
  const store = openStore(path.join(dataDir, 'scans.db'));
  const log = quiet ? () => {} : (...parts) => console.log(new Date().toISOString(), ...parts);
  const staticFiles = loadPublicFiles(subtitle);

  // "2026-11-06 14:31:05" in DISPLAY_TIMEZONE, for the CSV exports.
  const localTime = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const formatLocal = (iso) => {
    if (!iso) return '';
    const p = Object.fromEntries(localTime.formatToParts(new Date(iso)).map(({ type, value }) => [type, value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  };

  // A reverse proxy adds the real client address as the last X-Forwarded-For
  // entry. Only trusted when TRUST_PROXY=1: set it only when the proxy is the
  // only way in, or anyone could write their own address into that header.
  const clientIp = (req) => {
    if (trustProxy) {
      const forwarded = String(req.headers['x-forwarded-for'] ?? '')
        .split(',').map((s) => s.trim()).filter(Boolean);
      if (forwarded.length) return forwarded[forwarded.length - 1];
    }
    return req.socket.remoteAddress ?? null;
  };

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
    res.end(body);
  }

  function sendJson(res, status, value, headers = {}) {
    send(res, status, JSON.stringify(value), {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    });
  }

  function sendCsv(res, rows, fileName) {
    const header = [
      'session', 'id', 'code', 'entry_method', 'barcode_format', 'location', 'scanned_by', 'make', 'model', 'notes',
      `scanned_at_local (${timeZone})`, 'scanned_at_utc', 'browser_time_utc', 'client_ip', 'user_agent',
    ];
    const lines = [header.map(csvCell).join(',')];
    for (const row of rows) {
      lines.push([
        row.session_name, row.id, row.code, row.entry_method, row.barcode_format, row.location, row.scanned_by,
        row.make, row.model, row.notes,
        formatLocal(row.created_at), row.created_at, row.client_scanned_at, row.client_ip, row.user_agent,
      ].map(csvCell).join(','));
    }
    // The byte-order mark makes Excel read the file as UTF-8.
    send(res, 200, `\uFEFF${lines.join('\r\n')}\r\n`, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}-${fileStamp(new Date())}.csv"`,
      'Cache-Control': 'no-store',
    });
  }

  function sendAnalysisCsv(res, session, rows) {
    const header = [
      'session', 'code', 'times_scanned', `first_scan_local (${timeZone})`, `last_scan_local (${timeZone})`,
      'make', 'model', 'description', 'notes', 'model_entered', 'location', 'scanned_by', 'barcode_format',
      'service_tag', 'dell_product_line', 'ship_date', 'warranty_end', 'warranty_status', 'warranty_service',
      'cpu', 'ram', 'storage', 'gpu', 'os', 'form_factor', 'dell_lookup',
      'cisco_serial', 'cisco_built', 'cisco_base_pid', 'cisco_series', 'cisco_type', 'cisco_release_date', 'cisco_lookup',
    ];
    const day = (iso) => (iso ? formatLocal(iso).slice(0, 10) : '');
    const lines = [header.map(csvCell).join(',')];
    for (const r of rows) {
      const d = r.dell?.status === 'found' ? r.dell : null;
      const c = r.cisco?.status === 'found' ? r.cisco : null;
      const built = r.ciscoBuilt ? `${r.ciscoBuilt.year} week ${r.ciscoBuilt.week}` : '';
      lines.push([
        session.name, r.code, r.timesScanned, formatLocal(r.firstScanAt), formatLocal(r.lastScanAt),
        r.identified.make, r.identified.model, r.identified.description, r.notes, r.model, r.location, r.scannedBy, r.format,
        r.serviceTag, d?.productLine, day(d?.shipDate), day(d?.warrantyEnd), warrantyStatus(d?.warrantyEnd),
        d?.warrantyService, d?.cpu, d?.ram, d?.storage, d?.gpu, d?.os, d?.formFactor,
        r.serviceTag ? (r.dell?.status ?? 'not looked up') : '',
        r.ciscoSerial, built, c?.basePid, c?.series, c?.type, c?.releaseDate,
        r.ciscoSerial ? (r.cisco?.status ?? 'not looked up') : '',
      ].map(csvCell).join(','));
    }
    send(res, 200, `\uFEFF${lines.join('\r\n')}\r\n`, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="analysis-${slug(session.name)}-${fileStamp(new Date())}.csv"`,
      'Cache-Control': 'no-store',
    });
  }

  function sendStatic(req, res, file) {
    const common = { 'Content-Type': file.type, 'Cache-Control': 'no-cache', ETag: file.etag, Vary: 'Accept-Encoding' };
    if (req.headers['if-none-match'] === file.etag) return send(res, 304, undefined, common);
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && file.gzip.length < file.body.length) {
      return send(res, 200, file.gzip, { ...common, 'Content-Encoding': 'gzip' });
    }
    return send(res, 200, file.body, common);
  }

  async function readJsonBody(req) {
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') {
      throw new HttpError(415, 'Send JSON with Content-Type: application/json.');
    }
    if (Number(req.headers['content-length']) > LIMITS.bodyBytes) {
      throw new HttpError(413, 'The request is too large.');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > LIMITS.bodyBytes) throw new HttpError(413, 'The request is too large.');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HttpError(400, 'The request is not valid JSON.');
    }
  }

  function methodNotAllowed(res, allow) {
    sendJson(res, 405, { error: `Use ${allow}.` }, { Allow: allow });
  }

  function requireSession(id) {
    const session = store.getSession(id);
    if (!session) throw new HttpError(404, 'No such session.');
    return session;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    const method = req.method;
    const isRead = method === 'GET' || method === 'HEAD';

    if (pathname === '/healthz') {
      if (!isRead) return methodNotAllowed(res, 'GET, HEAD');
      return send(res, 200, store.ping() ? 'ok' : 'db?', {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
    }

    if (pathname === '/api/sessions') {
      if (isRead) return sendJson(res, 200, { sessions: store.listSessions() });
      if (method === 'POST') {
        const name = parseSessionName(await readJsonBody(req));
        const ip = clientIp(req);
        try {
          const session = store.createSession(name, ip);
          log(`session id=${session.id} created ip=${ip} name=${JSON.stringify(name)}`);
          return sendJson(res, 201, { session });
        } catch (err) {
          if (err instanceof ConflictError) throw new HttpError(409, err.message);
          throw err;
        }
      }
      return methodNotAllowed(res, 'GET, HEAD, POST');
    }

    const sessionPath = /^\/api\/sessions\/(\d{1,15})(\/scans|\/export\.csv|\/analysis|\/analysis\.csv)?$/.exec(pathname);
    if (sessionPath) {
      if (!isRead) return methodNotAllowed(res, 'GET, HEAD');
      const session = requireSession(Number(sessionPath[1]));
      if (!sessionPath[2]) return sendJson(res, 200, { session });
      if (sessionPath[2] === '/scans') {
        const requested = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
        const limit = Number.isFinite(requested) && requested > 0
          ? Math.min(requested, LIMITS.listMax)
          : LIMITS.listDefault;
        return sendJson(res, 200, { session, scans: store.recentScans(session.id, limit) });
      }
      if (sessionPath[2] === '/export.csv') {
        return sendCsv(res, store.exportRows(session.id), `inventory-${slug(session.name)}`);
      }
      const rows = buildAnalysis(store.sessionScans(session.id), (tag) => store.getDellAsset(tag), (sn) => store.getCiscoAsset(sn));
      if (sessionPath[2] === '/analysis.csv') return sendAnalysisCsv(res, session, rows);
      return sendJson(res, 200, { session, dellConfigured: dellClient.configured, ciscoConfigured: ciscoClient.configured, rows });
    }

    if (pathname === '/api/cisco/lookup') {
      if (method !== 'POST') return methodNotAllowed(res, 'POST');
      const { serials, refresh } = parseCiscoLookupInput(await readJsonBody(req));
      if (!ciscoClient.configured) throw new HttpError(503, 'The Cisco API is not set up on this server (CISCO_* settings in .env).');
      // Serials already answered are not asked again unless refresh is set. Failed ones are retried.
      const cached = new Map(serials.map((sn) => [sn, store.getCiscoAsset(sn)]));
      const toAsk = serials.filter((sn) => refresh || !cached.get(sn) || cached.get(sn).status === 'error');
      const fresh = await ciscoClient.lookupMany(toAsk);
      for (const record of fresh) cached.set(record.serial, store.saveCiscoAsset(record));
      if (toAsk.length) {
        const counts = fresh.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
        log(`cisco lookup ip=${clientIp(req)} asked=${toAsk.length} ${JSON.stringify(counts)}`);
      }
      return sendJson(res, 200, { results: Object.fromEntries(cached), looked: toAsk.length });
    }

    if (pathname === '/api/dell/lookup') {
      if (method !== 'POST') return methodNotAllowed(res, 'POST');
      const { tags, refresh } = parseLookupInput(await readJsonBody(req));
      if (!dellClient.configured) throw new HttpError(503, 'The Dell API is not set up on this server (DELL_* settings in .env).');
      // Tags already answered are not asked again unless refresh is set. Failed ones are retried.
      const cached = new Map(tags.map((t) => [t, store.getDellAsset(t)]));
      const toAsk = tags.filter((t) => refresh || !cached.get(t) || cached.get(t).status === 'error');
      const fresh = await dellClient.lookupMany(toAsk);
      for (const record of fresh) cached.set(record.serviceTag, store.saveDellAsset(record));
      if (toAsk.length) {
        const counts = fresh.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
        log(`dell lookup ip=${clientIp(req)} asked=${toAsk.length} ${JSON.stringify(counts)}`);
      }
      return sendJson(res, 200, { results: Object.fromEntries(cached), looked: toAsk.length });
    }

    if (pathname === '/api/scans') {
      if (method !== 'POST') return methodNotAllowed(res, 'POST');
      const input = parseScanInput(await readJsonBody(req));
      requireSession(input.sessionId);
      const ip = clientIp(req);
      const { scan, created } = store.addScan({
        ...input,
        ip,
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
      });
      if (created) {
        log(`scan id=${scan.id} session=${scan.sessionId} method=${scan.method} format=${JSON.stringify(scan.format)} ` +
          `times=${scan.timesScanned} ip=${ip} code=${JSON.stringify(scan.code)}`);
      }
      return sendJson(res, created ? 201 : 200, { scan, created, session: store.getSession(scan.sessionId) });
    }

    const scanPath = /^\/api\/scans\/(\d{1,15})$/.exec(pathname);
    if (scanPath) {
      if (method !== 'DELETE') return methodNotAllowed(res, 'DELETE');
      const id = Number(scanPath[1]);
      const ip = clientIp(req);
      const session = store.removeScan(id, ip);
      if (!session) return sendJson(res, 404, { error: 'No such scan, or it was already removed.' });
      log(`removed id=${id} session=${session.id} ip=${ip}`);
      return sendJson(res, 200, { removed: id, session });
    }

    if (pathname === '/api/export.csv') {
      if (!isRead) return methodNotAllowed(res, 'GET, HEAD');
      return sendCsv(res, store.exportRows(), 'inventory-all-sessions');
    }

    const file = staticFiles.get(pathname);
    if (file) {
      if (!isRead) return methodNotAllowed(res, 'GET, HEAD');
      return sendStatic(req, res, file);
    }

    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found.' });
    return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) log('error', req.method, req.url, err.stack ?? err);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      // After an oversized body, close the connection rather than read the rest.
      const headers = status === 413 ? { Connection: 'close' } : {};
      sendJson(res, status, { error: status === 500 ? 'Something went wrong on the server.' : err.message }, headers);
    });
  });

  // Keep idle connections open longer than a reverse proxy does, so the proxy, not
  // Node, is the side that closes them. That avoids a request being sent on
  // a connection Node is closing at the same moment.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 120_000;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const urlHost = address.family === 'IPv6' ? `[${address.address}]` : address.address;

  return {
    server,
    store,
    port: address.port,
    url: `http://${urlHost === '0.0.0.0' ? '127.0.0.1' : urlHost}:${address.port}`,
    async close() {
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
      store.close();
    },
  };
}
