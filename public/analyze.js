// Analyze data page: one row per distinct code in a session, with what was
// typed on the scan page and what Dell or Cisco knows about it. Lookups go
// through this app's server (which holds the API keys), a few items per
// request, so a big session shows progress and never runs into a request
// time limit.

const DELL_BATCH = 5; // service tags per request
const CISCO_BATCH = 10; // serials per request
const SESSION_KEY = 'inventoryScanner.session.v1'; // the scan page's active session

const $ = (id) => document.getElementById(id);
const el = {
  sessionSelect: $('sessionSelect'), meta: $('analyzeMeta'), lookup: $('lookupButton'), refresh: $('refreshButton'),
  csv: $('analysisCsv'), progress: $('progress'), progressBar: $('progressBar'), progressText: $('progressText'),
  error: $('analyzeError'), filter: $('filter'), rows: $('rows'), rowsEmpty: $('rowsEmpty'),
  sumCodes: $('sumCodes'), sumFound: $('sumFound'), sumActive: $('sumActive'), sumExpired: $('sumExpired'),
};

let sessionId = null;
let rows = [];
let dellConfigured = false;
let ciscoConfigured = false;
let busy = false;

async function api(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}.`);
  return body;
}

function showError(message) {
  el.error.textContent = message ?? '';
  el.error.hidden = !message;
}

function date(iso) {
  const d = new Date(iso);
  return iso && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : '';
}

function warranty(dell) {
  if (dell?.status !== 'found' || !dell.warrantyEnd) return null;
  const end = Date.parse(dell.warrantyEnd);
  const days = Math.round((end - Date.now()) / 86_400_000);
  return { active: days >= 0, days, end: dell.warrantyEnd };
}

// ---------------------------------------------------------------------------
// Loading.

async function loadSessions() {
  const { sessions } = await api('/api/sessions');
  el.sessionSelect.replaceChildren(...sessions.map((s) => {
    const option = document.createElement('option');
    option.value = String(s.id);
    option.textContent = `${s.name} (${s.total} scan${s.total === 1 ? '' : 's'})`;
    return option;
  }));
  if (sessions.length === 0) {
    el.meta.textContent = 'There are no sessions yet. Create one on the Scan page.';
    return;
  }
  // Which session: ?session= in the address, else the scan page's active one, else the newest.
  const fromUrl = Number(new URLSearchParams(location.search).get('session'));
  let fromScanPage = null;
  try {
    fromScanPage = JSON.parse(localStorage.getItem(SESSION_KEY))?.id ?? null;
  } catch {
    // no storage: fall through
  }
  const wanted = [fromUrl, fromScanPage].find((id) => sessions.some((s) => s.id === id)) ?? sessions[0].id;
  el.sessionSelect.value = String(wanted);
  await loadAnalysis(wanted);
}

async function loadAnalysis(id) {
  sessionId = id;
  history.replaceState(null, '', `/analyze?session=${id}`);
  showError('');
  el.meta.textContent = 'Loading…';
  try {
    const body = await api(`/api/sessions/${id}/analysis`);
    if (sessionId !== id) return;
    rows = body.rows;
    dellConfigured = body.dellConfigured;
    ciscoConfigured = body.ciscoConfigured;
    el.csv.href = `/api/sessions/${id}/analysis.csv`;
    el.csv.hidden = false;
    render();
  } catch (err) {
    showError(`Could not load the session: ${err.message}`);
  }
}

el.sessionSelect.addEventListener('change', () => loadAnalysis(Number(el.sessionSelect.value)));
el.filter.addEventListener('input', () => renderRows());

// ---------------------------------------------------------------------------
// Dell lookups.

// What still needs asking: Dell tags and Cisco serials, each only if that
// vendor's API is set up on the server.
function pendingWork(refresh) {
  const wanted = (record) => refresh || !record || record.status === 'error';
  const dell = dellConfigured
    ? [...new Set(rows.filter((r) => r.serviceTag && wanted(r.dell)).map((r) => r.serviceTag))] : [];
  const cisco = ciscoConfigured
    ? [...new Set(rows.filter((r) => r.ciscoSerial && wanted(r.cisco)).map((r) => r.ciscoSerial))] : [];
  const jobs = [];
  for (let i = 0; i < dell.length; i += DELL_BATCH) {
    jobs.push({ vendor: 'dell', path: '/api/dell/lookup', key: 'tags', items: dell.slice(i, i + DELL_BATCH) });
  }
  for (let i = 0; i < cisco.length; i += CISCO_BATCH) {
    jobs.push({ vendor: 'cisco', path: '/api/cisco/lookup', key: 'serials', items: cisco.slice(i, i + CISCO_BATCH) });
  }
  return { jobs, total: dell.length + cisco.length };
}

async function lookUp(refresh) {
  if (busy) return;
  const { jobs, total } = pendingWork(refresh);
  if (total === 0) return;
  busy = true;
  showError('');
  renderButtons();
  el.progress.hidden = false;
  let done = 0;
  const id = sessionId;
  try {
    for (const job of jobs) {
      el.progressText.textContent = `Looking up ${total} item${total === 1 ? '' : 's'} online: ${done} done…`;
      el.progressBar.style.width = `${Math.round((done / total) * 100)}%`;
      const { results } = await api(job.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [job.key]: job.items, refresh }),
      });
      if (sessionId !== id) return; // the user switched sessions
      for (const row of rows) {
        if (job.vendor === 'dell' && row.serviceTag && results[row.serviceTag]) row.dell = results[row.serviceTag];
        if (job.vendor === 'cisco' && row.ciscoSerial && results[row.ciscoSerial]) row.cisco = results[row.ciscoSerial];
        refreshIdentified(row);
      }
      done += job.items.length;
      render();
    }
    el.progressBar.style.width = '100%';
    const failed = rows.filter((r) => r.dell?.status === 'error' || r.cisco?.status === 'error').length;
    el.progressText.textContent = `Done: ${done} item${done === 1 ? '' : 's'} looked up${failed ? `, ${failed} failed (try again)` : ''}.`;
  } catch (err) {
    showError(`Lookup stopped after ${done} of ${total}: ${err.message}`);
    el.progress.hidden = true;
  } finally {
    busy = false;
    renderButtons();
  }
}

// Same rule as the server (src/analysis.js), so the row updates without a reload.
function refreshIdentified(row) {
  const d = row.dell?.status === 'found' ? row.dell : null;
  const c = row.cisco?.status === 'found' ? row.cisco : null;
  row.identified = {
    make: row.make ?? (d ? 'Dell' : row.ciscoSerial ? 'Cisco' : null),
    model: d?.model ?? c?.pid ?? row.model ?? null,
    description: d ? [d.systemDescription ?? d.model, d.productLine].filter(Boolean).join(', ') : c?.productName ?? null,
  };
}

el.lookup.addEventListener('click', () => lookUp(false));
el.refresh.addEventListener('click', () => lookUp(true));

// ---------------------------------------------------------------------------
// Rendering. All text goes in with textContent, never as HTML.

function render() {
  const tags = rows.filter((r) => r.serviceTag);
  const serials = rows.filter((r) => r.ciscoSerial);
  const found = rows.filter((r) => r.dell?.status === 'found' || r.cisco?.status === 'found');
  const looked = rows.filter((r) => (r.dell && r.dell.status !== 'error') || (r.cisco && r.cisco.status !== 'error'));
  const warranties = rows.map((r) => warranty(r.dell)).filter(Boolean);
  el.meta.textContent = `${rows.length} distinct code${rows.length === 1 ? '' : 's'} · ${tags.length} Dell tag${tags.length === 1 ? '' : 's'}`
    + ` · ${serials.length} Cisco serial${serials.length === 1 ? '' : 's'} · ${looked.length} looked up`;
  el.sumCodes.textContent = rows.length;
  el.sumFound.textContent = found.length;
  el.sumActive.textContent = warranties.filter((w) => w.active).length;
  el.sumExpired.textContent = warranties.filter((w) => !w.active).length;
  renderButtons();
  renderRows();
}

function renderButtons() {
  const pending = pendingWork(false).total > 0;
  const any = pendingWork(true).total > 0;
  el.lookup.disabled = busy || !pending;
  el.refresh.disabled = busy || !any;
  el.lookup.textContent = busy ? 'Looking up…' : 'Look up online';
  const off = [];
  if (!dellConfigured && rows.some((r) => r.serviceTag)) off.push('Dell');
  if (!ciscoConfigured && rows.some((r) => r.ciscoSerial)) off.push('Cisco');
  if (off.length && !busy) {
    showError(`${off.join(' and ')} lookups are not set up on this server, so those rows cannot be looked up. `
      + '(IT: the DELL_* / CISCO_* settings in the app\'s .env file.)');
  }
}

function cell(row, className) {
  const td = document.createElement('td');
  if (className) td.className = className;
  row.append(td);
  return td;
}

function line(parent, text, className) {
  if (!text) return;
  const span = document.createElement(className ? 'span' : 'div');
  if (className) span.className = className;
  span.textContent = text;
  parent.append(span);
}

function pill(parent, text, tone) {
  const span = document.createElement('span');
  span.className = `pill pill-${tone}`;
  span.textContent = text;
  parent.append(span);
}

function matches(r, needle) {
  if (!needle) return true;
  const d = r.dell ?? {};
  const c = r.cisco ?? {};
  return [r.code, r.serviceTag, r.ciscoSerial, r.make, r.model, r.notes, r.location, d.model, d.productLine, d.cpu, d.os,
    c.pid, c.productName, c.series]
    .some((v) => v && String(v).toLowerCase().includes(needle));
}

function renderRows() {
  const needle = el.filter.value.trim().toLowerCase();
  const shown = rows.filter((r) => matches(r, needle));
  el.rows.replaceChildren(...shown.map((r) => {
    const tr = document.createElement('tr');
    const d = r.dell?.status === 'found' ? r.dell : null;

    const code = cell(tr, 'col-code');
    code.textContent = r.code;
    if (r.timesScanned > 1) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = `×${r.timesScanned}`;
      badge.title = `Scanned ${r.timesScanned} times`;
      code.append(' ', badge);
    }
    line(code, [r.format, r.location].filter(Boolean).join(' · '), 'sub');

    const c = r.cisco?.status === 'found' ? r.cisco : null;
    const tag = cell(tr);
    const id = r.serviceTag ?? r.ciscoSerial;
    const record = r.serviceTag ? r.dell : r.cisco;
    if (!id) {
      line(tag, 'none found', 'sub');
    } else {
      line(tag, id);
      line(tag, r.serviceTag ? 'Dell service tag' : 'Cisco serial', 'sub');
      if (!record) line(tag, 'not looked up', 'sub');
      else if (record.status === 'not_found') pill(tag, r.serviceTag ? 'Unknown to Dell' : 'Unknown to Cisco', 'muted');
      else if (record.status === 'error') pill(tag, 'Lookup failed', 'bad');
      if (record?.error) tag.title = record.error;
    }

    const model = cell(tr);
    line(model, [r.identified.make, r.identified.model].filter(Boolean).join(' ') || '—');
    if (r.model && r.identified.model && r.model.toLowerCase() !== r.identified.model.toLowerCase()) line(model, `Entered: ${r.model}`, 'sub');
    line(model, d?.productLine ?? (c ? [c.type, c.category].filter(Boolean).join(' · ') : null), 'sub');

    const shipped = cell(tr, 'col-time');
    if (d) shipped.textContent = date(d.shipDate);
    else if (r.ciscoBuilt) shipped.textContent = `Built ${r.ciscoBuilt.year} (wk ${r.ciscoBuilt.week})`;

    const w = cell(tr);
    const info = warranty(d);
    if (info) {
      pill(w, info.active ? 'Active' : 'Expired', info.active ? 'ok' : 'muted');
      line(w, `${info.active ? 'Ends' : 'Ended'} ${date(info.end)}`, 'sub');
      if (d.warrantyService) w.title = d.warrantyService;
    }

    const specs = cell(tr, 'col-specs');
    if (d) {
      line(specs, [d.cpu, d.ram, d.storage].filter(Boolean).join(' · '));
      line(specs, [d.formFactor, d.gpu, d.os].filter(Boolean).join(' · '), 'sub');
    } else if (c) {
      line(specs, c.series);
      line(specs, c.releaseDate ? `Released ${date(c.releaseDate)}` : null, 'sub');
    }

    const notes = cell(tr, 'col-notes');
    if (c) line(notes, r.identified.description); // Cisco's product description
    line(notes, r.notes, c ? 'sub' : null);
    return tr;
  }));
  el.rowsEmpty.hidden = shown.length > 0;
  el.rowsEmpty.textContent = rows.length ? 'Nothing matches the filter.' : 'No scans in this session yet.';
}

loadSessions().catch((err) => {
  showError(`Could not load the sessions: ${err.message}`);
  el.meta.textContent = '';
});
