// Page logic for the Inventory Scanner: plain browser JavaScript, no framework.
//
//  - Sessions: every code is saved into the active session, chosen per browser.
//  - Three modes:
//      Hand scanner  saves 1 second after the scanner stops typing (adjustable),
//                    or at once on Enter or Tab;
//      Manual        saves when Enter is pressed;
//      Camera        reads barcodes with the camera (camera.js, loaded on first use).
//  - Saving: entries wait in this browser's storage until the server confirms
//    them, so a network drop loses nothing, and each carries a random ID, so a
//    resend can never be stored twice.

import {
  DEFAULT_SETTINGS, SPLIT_GAP_MS, sanitizeSettings, createEntryTracker, isScannerBurst, startsNewCode, describeEntry,
} from './scan-detect.js';
import { parseGs1, describeGs1 } from './gs1.js';

const MAX_CODE_LENGTH = 256;
const RECENT_LIMIT = 25;
const REFRESH_EVERY_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_FOUND = 60;
const MODES = ['scanner', 'manual', 'camera'];
const METHOD_LABEL = { scanner: 'Hand scanner', manual: 'Typed', camera: 'Camera' };
const STORAGE = {
  settings: 'inventoryScanner.settings.v2',
  context: 'inventoryScanner.context.v1', // before sticky fields: {location, scannedBy}
  details: 'inventoryScanner.details.v1', // {values: {...}, sticky: {...}}
  queue: 'inventoryScanner.pending.v2',
  session: 'inventoryScanner.session.v1',
  mode: 'inventoryScanner.mode.v1',
  camera: 'inventoryScanner.camera.v1',
};
// Same cleanup the server does: no control or zero-width characters.
const INVISIBLE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u2060\uFEFF]/g;

const el = Object.fromEntries([
  'connection', 'sessionName', 'sessionMeta', 'switchSession', 'newSession', 'exportSession',
  'scanCard', 'keyboardPanel', 'status', 'statusText', 'code', 'countdownBar', 'hint',
  'cameraPanel', 'cameraView', 'cameraVideo', 'cameraOverlay', 'cameraIdle', 'cameraStart', 'cameraMessage',
  'cameraStop', 'cameraTorch', 'cameraZoomBox', 'cameraZoom', 'cameraSelectBox', 'cameraSelect', 'cameraAuto',
  'foundList', 'foundEmpty', 'foundClear',
  'result', 'resultLabel', 'resultCode', 'resultDetail', 'resultRemove',
  'location', 'scannedBy', 'make', 'model', 'notes', 'moreDetails', 'statTotal', 'statUnique', 'statPending', 'statPendingBox',
  'recentBody', 'recentEmpty', 'lastEntry', 'setIdle', 'setSound', 'resetSettings',
  'sessionsDialog', 'closeSessions', 'newSessionForm', 'newSessionName', 'newSessionError',
  'sessionList', 'sessionListEmpty',
].map((id) => [id, document.getElementById(id)]));

// ---------------------------------------------------------------------------
// Browser storage. It can be missing or full (private windows, locked-down
// browsers). The page still works then; it only forgets settings and unsent
// scans when reloaded.

function readStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // See above.
  }
}

function requestTimeout() {
  return typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
}

async function api(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', signal: requestTimeout(), ...options });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function postJson(path, value) {
  return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
}

// ---------------------------------------------------------------------------
// Settings, and the details saved with every scan. Kept per browser.

let settings = sanitizeSettings(readStored(STORAGE.settings, DEFAULT_SETTINGS));

function storeSettings() {
  writeStored(STORAGE.settings, settings);
}

function showSettings() {
  el.setIdle.value = settings.idleMs;
  el.setSound.checked = settings.sound;
  el.cameraAuto.checked = settings.cameraAutoSave;
  renderHint();
}

el.setIdle.addEventListener('change', () => {
  settings = sanitizeSettings({ ...settings, idleMs: el.setIdle.value });
  storeSettings();
  showSettings();
});
el.setSound.addEventListener('change', () => {
  settings = { ...settings, sound: el.setSound.checked };
  storeSettings();
});
el.cameraAuto.addEventListener('change', () => {
  settings = { ...settings, cameraAutoSave: el.cameraAuto.checked };
  storeSettings();
});
el.resetSettings.addEventListener('click', () => {
  settings = { ...DEFAULT_SETTINGS };
  storeSettings();
  showSettings();
});

// Optional details saved with each scan. A "sticky" field keeps its value for
// the scans that follow; any other field is cleared once a scan has taken it.
// Location and Scanned by start sticky (they always used to be kept).
const DETAIL_FIELDS = ['location', 'scannedBy', 'make', 'model', 'notes'];
const DEFAULT_STICKY = { location: true, scannedBy: true, make: false, model: false, notes: false };
const stickyBoxes = Object.fromEntries(
  [...document.querySelectorAll('input[data-sticky]')].map((box) => [box.dataset.sticky, box]),
);

function loadDetails() {
  const stored = readStored(STORAGE.details, null);
  const old = readStored(STORAGE.context, {}); // from before sticky fields existed
  const values = stored?.values ?? { location: old?.location, scannedBy: old?.scannedBy };
  for (const name of DETAIL_FIELDS) {
    const sticky = typeof stored?.sticky?.[name] === 'boolean' ? stored.sticky[name] : DEFAULT_STICKY[name];
    stickyBoxes[name].checked = sticky;
    el[name].value = sticky && typeof values?.[name] === 'string' ? values[name] : '';
  }
  if (DETAIL_FIELDS.slice(2).some((name) => el[name].value)) el.moreDetails.open = true;
}

function storeDetails() {
  writeStored(STORAGE.details, {
    values: Object.fromEntries(DETAIL_FIELDS.map((name) => [name, el[name].value])),
    sticky: Object.fromEntries(DETAIL_FIELDS.map((name) => [name, stickyBoxes[name].checked])),
  });
}

// The values for one scan; then clear the fields that are not sticky.
function takeDetails() {
  const values = Object.fromEntries(DETAIL_FIELDS.map((name) => [name, el[name].value.trim() || null]));
  for (const name of DETAIL_FIELDS) if (!stickyBoxes[name].checked) el[name].value = '';
  storeDetails();
  return values;
}

loadDetails();
for (const name of DETAIL_FIELDS) {
  el[name].addEventListener('input', storeDetails);
  stickyBoxes[name].addEventListener('change', storeDetails);
  if (el[name].tagName === 'INPUT') {
    el[name].addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        focusScanBox();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Sessions. The active one is remembered per browser as {id, name}.

let activeSession = readStored(STORAGE.session, null);
if (!Number.isSafeInteger(activeSession?.id) || typeof activeSession?.name !== 'string') activeSession = null;
let sessionTotals = null; // {total, uniqueCodes, createdAt, ...} from the server

function setActiveSession(session) {
  activeSession = session ? { id: session.id, name: session.name } : null;
  writeStored(STORAGE.session, activeSession);
  sessionTotals = session?.total !== undefined ? session : null;
  recentScans = [];
  clearFound();
  renderSession();
  renderRecent();
  updateEnabled();
  refreshRecent();
}

function updateSessionTotals(session) {
  if (!session || session.id !== activeSession?.id) return;
  sessionTotals = session;
  if (session.name !== activeSession.name) {
    activeSession = { id: session.id, name: session.name };
    writeStored(STORAGE.session, activeSession);
  }
  renderSession();
}

function plural(n, word) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function renderSession() {
  el.exportSession.hidden = !activeSession;
  if (!activeSession) {
    el.sessionName.textContent = 'No session chosen';
    el.sessionMeta.textContent = 'Choose or create a session to start scanning.';
    el.statTotal.textContent = '–';
    el.statUnique.textContent = '–';
    return;
  }
  el.sessionName.textContent = activeSession.name;
  el.exportSession.href = `/api/sessions/${activeSession.id}/export.csv`;
  if (sessionTotals) {
    el.sessionMeta.textContent = `${plural(sessionTotals.total, 'scan')} · ${sessionTotals.uniqueCodes.toLocaleString()} unique · started ${formatDateTime(sessionTotals.createdAt)}`;
    el.statTotal.textContent = sessionTotals.total.toLocaleString();
    el.statUnique.textContent = sessionTotals.uniqueCodes.toLocaleString();
  } else {
    el.sessionMeta.textContent = 'Loading totals…';
  }
}

function suggestedSessionName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Session ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function showFormError(message) {
  el.newSessionError.textContent = message;
  el.newSessionError.hidden = !message;
}

async function openSessions({ focusNew = false } = {}) {
  showFormError('');
  if (!el.newSessionName.value) el.newSessionName.value = suggestedSessionName();
  if (!el.sessionsDialog.open) el.sessionsDialog.showModal();
  if (focusNew || !activeSession) {
    el.newSessionName.focus();
    el.newSessionName.select();
  }
  await loadSessionList();
}

async function loadSessionList() {
  try {
    const { response, body } = await api('/api/sessions');
    if (!response.ok) throw new Error(String(response.status));
    renderSessionList(body.sessions);
    setConnection(true);
  } catch {
    el.sessionList.replaceChildren();
    el.sessionListEmpty.hidden = false;
    el.sessionListEmpty.textContent = "The server can't be reached, so the list can't be shown. Try again in a moment.";
    setConnection(false);
  }
}

let listedSessions = [];

function renderSessionList(sessions) {
  listedSessions = sessions;
  const rows = sessions.map((s) => {
    const row = document.createElement('tr');
    const current = s.id === activeSession?.id;
    if (current) row.className = 'is-current';
    const name = document.createElement('td');
    const strong = document.createElement('strong');
    strong.textContent = s.name;
    const started = document.createElement('span');
    started.className = 'sub';
    started.textContent = `Started ${formatDateTime(s.createdAt)}`;
    name.append(strong, started);
    const cell = (text, className) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (className) td.className = className;
      return td;
    };
    const actions = document.createElement('td');
    actions.className = 'col-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = current ? 'btn btn-quiet' : 'btn';
    open.textContent = current ? 'Current' : 'Open';
    open.disabled = current;
    open.dataset.openSession = String(s.id);
    const csv = document.createElement('a');
    csv.className = 'btn btn-quiet';
    csv.href = `/api/sessions/${s.id}/export.csv`;
    csv.setAttribute('download', '');
    csv.textContent = 'CSV';
    actions.append(open, ' ', csv);
    row.append(name, cell(s.total.toLocaleString(), 'num'), cell(s.uniqueCodes.toLocaleString(), 'num col-extra'),
      cell(s.lastScanAt ? formatDateTime(s.lastScanAt) : '—', 'col-extra'), actions);
    return row;
  });
  el.sessionList.replaceChildren(...rows);
  el.sessionListEmpty.hidden = rows.length > 0;
  el.sessionListEmpty.textContent = 'No sessions yet. Create the first one above.';
}

el.sessionList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-open-session]');
  if (!button) return;
  const session = listedSessions.find((s) => String(s.id) === button.dataset.openSession);
  if (!session) return;
  setActiveSession(session);
  el.sessionsDialog.close();
});

el.newSessionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = el.newSessionName.value.trim();
  if (!name) {
    showFormError('Type a name for the session.');
    return;
  }
  const button = el.newSessionForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const { response, body } = await postJson('/api/sessions', { name });
    if (!response.ok) {
      showFormError(body.error ?? `The server answered ${response.status}.`);
      return;
    }
    setConnection(true);
    el.newSessionName.value = '';
    setActiveSession(body.session);
    el.sessionsDialog.close();
  } catch {
    showFormError("The server can't be reached. Try again in a moment.");
  } finally {
    button.disabled = false;
  }
});

el.switchSession.addEventListener('click', () => openSessions());
el.newSession.addEventListener('click', () => openSessions({ focusNew: true }));
el.closeSessions.addEventListener('click', () => el.sessionsDialog.close());
el.sessionsDialog.addEventListener('close', () => {
  showReadiness();
  setTimeout(focusScanBox, 0);
});

async function loadActiveSession() {
  if (!activeSession) {
    openSessions({ focusNew: true });
    return;
  }
  try {
    const { response, body } = await api(`/api/sessions/${activeSession.id}`);
    if (response.status === 404) {
      setActiveSession(null);
      openSessions({ focusNew: true });
      return;
    }
    if (!response.ok) throw new Error(String(response.status));
    updateSessionTotals(body.session);
    setConnection(true);
  } catch {
    setConnection(false); // offline: keep scanning into the remembered session
  }
}

// ---------------------------------------------------------------------------
// Modes.

let mode = MODES.includes(readStored(STORAGE.mode, 'scanner')) ? readStored(STORAGE.mode, 'scanner') : 'scanner';
const modeRadios = [...document.querySelectorAll('input[name="mode"]')];

function setMode(next, { byUser = false } = {}) {
  const previous = mode;
  mode = next;
  writeStored(STORAGE.mode, mode);
  for (const radio of modeRadios) radio.checked = radio.value === mode;
  el.scanCard.dataset.mode = mode;
  el.keyboardPanel.hidden = mode === 'camera';
  el.cameraPanel.hidden = mode !== 'camera';
  el.code.placeholder = mode === 'manual' ? 'Type a code, then press Enter' : 'Scan a barcode';
  if (previous === 'camera' && mode !== 'camera') stopCamera();
  clearEntry();
  showReadiness();
  if (mode === 'camera') {
    if (byUser) startCamera();
  } else {
    focusScanBox();
  }
}

for (const radio of modeRadios) {
  radio.addEventListener('change', () => {
    if (radio.checked) setMode(radio.value, { byUser: true });
  });
}

function updateEnabled() {
  el.code.disabled = !activeSession;
  el.cameraStart.disabled = !activeSession;
  showReadiness();
  renderHint();
}

// ---------------------------------------------------------------------------
// Focus (Hand scanner and Manual). A scanner types into whatever has the
// keyboard focus, so the page keeps that the scan box and says so plainly
// when it is not.

function isTextField(node) {
  if (!node || node === document.body) return false;
  if (node.isContentEditable || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT') return true;
  if (node.tagName !== 'INPUT') return false;
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden']
    .includes(node.type);
}

function keyboardActive() {
  return mode !== 'camera' && activeSession !== null && !el.sessionsDialog.open;
}

function focusScanBox() {
  if (keyboardActive()) el.code.focus();
}

const READY_TEXT = { scanner: 'Ready to scan', manual: 'Ready for typing' };
const PAUSED_TEXT = {
  elsewhere: 'Paused: the cursor is in another box. Click here or press Esc to scan.',
  away: 'Paused: this window is not active. Click here before scanning.',
  nosession: 'Choose or create a session to start. Click here.',
};

function readiness() {
  if (!activeSession) return 'nosession';
  if (!document.hasFocus()) return 'away';
  const active = document.activeElement;
  if (active && active !== el.code && isTextField(active)) return 'elsewhere';
  return 'ready';
}

function showReadiness() {
  const state = readiness();
  el.scanCard.dataset.ready = state;
  const text = state === 'ready' ? READY_TEXT[mode] ?? READY_TEXT.scanner : PAUSED_TEXT[state];
  if (el.statusText.textContent !== text) el.statusText.textContent = text;
}

document.addEventListener('focusin', showReadiness);
document.addEventListener('focusout', () => setTimeout(showReadiness, 0));
window.addEventListener('focus', showReadiness);
window.addEventListener('blur', showReadiness);
setInterval(showReadiness, 1000);
el.status.addEventListener('click', () => (activeSession ? focusScanBox() : openSessions({ focusNew: true })));

// If nothing that takes text has the focus (the page itself, a button, the
// table), the first keystroke moves the focus to the scan box, and the browser
// then types that character and the rest into it. Space is left alone, so it
// still presses a focused button.
document.addEventListener('keydown', (event) => {
  if (!keyboardActive() || event.target === el.code || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Escape') {
    focusScanBox();
    return;
  }
  if (isTextField(document.activeElement)) return;
  if ([...event.key].length !== 1 || event.key === ' ') return; // not a printable character
  focusScanBox();
}, true);

// After a button, link, checkbox or mode is clicked, put the focus back in the
// scan box, so a scanner's next code never lands on a button.
document.addEventListener('click', (event) => {
  if (event.target.closest('dialog')) return;
  if (event.target.closest('button, summary, a, input[type="checkbox"], input[type="radio"]')) setTimeout(focusScanBox, 0);
});

// ---------------------------------------------------------------------------
// Typed entries (Hand scanner and Manual).

const tracker = createEntryTracker();
let quietTimer = 0;

function seconds(ms) {
  return `${(ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} s`;
}

function renderHint() {
  const hasText = el.code.value !== '';
  let text;
  if (!activeSession) text = 'Choose or create a session first.';
  else if (mode === 'manual') text = hasText ? 'Press Enter to save it, or Esc to clear it.' : 'Type a code and press Enter.';
  else if (hasText) text = `Saves ${seconds(settings.idleMs)} after the last character. Enter saves now, Esc cancels.`;
  else text = `Scan a barcode. It saves ${seconds(settings.idleMs)} after the scanner stops. Enter or Tab saves at once.`;
  el.hint.textContent = text;
  el.hint.dataset.state = hasText && mode === 'manual' ? 'waiting' : '';
}

function startCountdown() {
  el.countdownBar.classList.remove('running');
  void el.countdownBar.offsetWidth; // restart the animation
  el.countdownBar.style.animationDuration = `${settings.idleMs}ms`;
  el.countdownBar.classList.add('running');
}

function clearEntry() {
  clearTimeout(quietTimer);
  el.code.value = '';
  tracker.reset();
  el.countdownBar.classList.remove('running');
  renderHint();
}

el.code.addEventListener('input', (event) => {
  clearTimeout(quietTimer);
  if (el.code.value === '') {
    clearEntry();
    return;
  }
  if (event.inputType === 'insertText' && !event.isComposing && event.data?.length === 1) {
    tracker.keystroke(event.timeStamp);
  } else {
    tracker.markEdited(); // pasted, dropped, deleted, auto-completed or composed
  }
  if (mode === 'scanner') {
    quietTimer = setTimeout(saveTypedEntry, settings.idleMs);
    startCountdown();
  }
  renderHint();
});

el.code.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    saveTypedEntry();
    return;
  }
  if (event.key === 'Escape') {
    clearEntry();
    return;
  }
  if (mode !== 'scanner' || el.code.value === '' || tracker.lastKeystrokeAt === null) return;
  const gap = event.timeStamp - tracker.lastKeystrokeAt;
  const length = el.code.value.length;
  if (event.key === 'Tab' && !event.shiftKey && gap < SPLIT_GAP_MS && isScannerBurst(tracker.summary(), length)) {
    // Some scanners end each code with Tab. Treat it like Enter and keep the
    // focus here for the next scan.
    event.preventDefault();
    saveTypedEntry();
  } else if ([...event.key].length === 1 && startsNewCode(tracker.summary(), length, gap)) {
    // A new scan began before the quiet time ran out: save the first code
    // now; this keystroke then lands in the empty box as the next code.
    saveTypedEntry();
  }
});

function cleanCode(text) {
  return text.normalize('NFC').replace(INVISIBLE_CHARS, '').trim();
}

function saveTypedEntry() {
  const raw = el.code.value;
  const summary = tracker.summary();
  clearEntry();
  el.lastEntry.textContent = `Last entry: ${describeEntry(summary)}`;
  const code = cleanCode(raw);
  if (code) saveCode({ code, method: mode === 'manual' ? 'manual' : 'scanner' });
}

// ---------------------------------------------------------------------------
// Camera mode. camera.js and the decoder load on first use.

let camera = null;
let resumeCamera = false;
const found = new Map(); // "format|text" -> {text, format, gs1, status, clientId}

async function getCamera() {
  if (!camera) {
    const { createCameraScanner } = await import('./camera.js');
    camera = createCameraScanner({
      video: el.cameraVideo,
      overlay: el.cameraOverlay,
      onResults: onCameraResults,
      isSaved: (text, format) => found.get(`${format}|${text}`)?.status === 'saved',
    });
  }
  return camera;
}

function setCameraState(state, message) {
  el.cameraView.dataset.state = state;
  el.cameraIdle.hidden = state === 'running';
  el.cameraStop.hidden = state !== 'running';
  el.cameraStart.disabled = state === 'starting' || !activeSession;
  el.cameraStart.textContent = state === 'starting' ? 'Starting…' : 'Start camera';
  el.cameraMessage.textContent = message
    || 'Point the camera at a label. Every barcode it can read is listed below the picture.';
  if (state !== 'running') {
    el.cameraTorch.hidden = true;
    el.cameraZoomBox.hidden = true;
  }
}

async function startCamera() {
  if (!activeSession) {
    openSessions({ focusNew: true });
    return;
  }
  setCameraState('starting', 'Starting the camera…');
  try {
    const cam = await getCamera();
    const remembered = readStored(STORAGE.camera, null)?.deviceId ?? null;
    let info;
    try {
      info = await cam.start(remembered);
    } catch (err) {
      if (!remembered || err.kind !== 'missing') throw err;
      info = await cam.start(); // the remembered camera is gone; use the default one
    }
    if (mode !== 'camera') {
      cam.stop();
      return;
    }
    setCameraState('running', '');
    await showCameraControls(cam, info);
  } catch (err) {
    setCameraState('off', err?.message ?? String(err));
  }
}

function stopCamera() {
  camera?.stop();
  setCameraState('off', '');
}

async function showCameraControls(cam, info) {
  const caps = cam.capabilities();
  el.cameraTorch.hidden = !caps.torch;
  el.cameraTorch.setAttribute('aria-pressed', 'false');
  el.cameraZoomBox.hidden = !caps.zoom;
  if (caps.zoom) {
    Object.assign(el.cameraZoom, { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step });
    el.cameraZoom.value = caps.zoom.value;
  }
  const cameras = await cam.listCameras();
  el.cameraSelectBox.hidden = cameras.length < 2;
  el.cameraSelect.replaceChildren(...cameras.map((c) => {
    const option = document.createElement('option');
    option.value = c.id;
    option.textContent = c.label;
    option.selected = c.id === info?.deviceId;
    return option;
  }));
}

// Give the picture the camera's own shape (portrait on most phones).
el.cameraVideo.addEventListener('loadedmetadata', () => {
  const { videoWidth: w, videoHeight: h } = el.cameraVideo;
  if (w && h) el.cameraView.style.aspectRatio = `${w} / ${h}`;
});

el.cameraStart.addEventListener('click', startCamera);
el.cameraStop.addEventListener('click', stopCamera);
el.cameraSelect.addEventListener('change', () => {
  writeStored(STORAGE.camera, { deviceId: el.cameraSelect.value });
  startCamera();
});
el.cameraTorch.addEventListener('click', async () => {
  const on = el.cameraTorch.getAttribute('aria-pressed') !== 'true';
  try {
    await camera?.setTorch(on);
    el.cameraTorch.setAttribute('aria-pressed', String(on));
  } catch {
    el.cameraTorch.hidden = true; // the camera refused after all
  }
});
el.cameraZoom.addEventListener('input', () => camera?.setZoom(Number(el.cameraZoom.value)).catch(() => {}));

function onCameraResults(results, error) {
  if (error) {
    stopCamera();
    setCameraState('off', error.message);
    return;
  }
  let changed = false;
  for (const r of results) {
    const key = `${r.format}|${r.text}`;
    if (found.has(key)) continue;
    const item = { key, text: r.text, format: r.format, gs1: parseGs1(r.text), status: 'new', clientId: null };
    found.set(key, item);
    changed = true;
    if (settings.cameraAutoSave) saveFound(item);
    else beep('found');
  }
  if (!changed) return;
  // Keep the list to a sensible length; never drop one that is still saving.
  for (const [key, item] of found) {
    if (found.size <= MAX_FOUND) break;
    if (item.status !== 'saving' && item.status !== 'waiting') found.delete(key);
  }
  renderFound();
}

function saveFound(item) {
  const entry = saveCode({ code: item.text, method: 'camera', format: item.format });
  if (!entry) return;
  item.clientId = entry.clientId;
  item.status = 'saving';
  renderFound();
}

function markFound(clientId, status) {
  for (const item of found.values()) {
    if (item.clientId === clientId) {
      item.status = status;
      renderFound();
      return;
    }
  }
}

function clearFound() {
  found.clear();
  renderFound();
}

const FOUND_STATUS = { saving: 'Saving…', saved: 'Saved', waiting: 'Waiting to save' };

function renderFound() {
  const items = [...found.values()].reverse();
  el.foundList.replaceChildren(...items.map((item) => {
    const li = document.createElement('li');
    li.className = 'found-item';
    li.dataset.status = item.status;
    const text = document.createElement('div');
    text.className = 'found-text';
    const code = document.createElement('p');
    code.className = 'found-code';
    code.textContent = item.text;
    const meta = document.createElement('p');
    meta.className = 'found-meta';
    meta.textContent = item.gs1 ? `${item.format} · ${describeGs1(item.gs1)}` : item.format;
    text.append(code, meta);
    let action;
    if (item.status === 'new' || item.status === 'failed') {
      action = document.createElement('button');
      action.type = 'button';
      action.className = 'btn';
      action.dataset.saveFound = item.key;
      action.textContent = item.status === 'failed' ? 'Try again' : 'Save';
    } else {
      action = document.createElement('span');
      action.className = 'found-status';
      action.textContent = FOUND_STATUS[item.status];
    }
    li.append(text, action);
    return li;
  }));
  el.foundEmpty.hidden = items.length > 0;
}

el.foundList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-save-found]');
  const item = button && found.get(button.dataset.saveFound);
  if (item) saveFound(item);
});
el.foundClear.addEventListener('click', clearFound);

// The camera stops while the page is hidden (another tab, phone locked) and
// starts again when it comes back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (camera?.running) {
      resumeCamera = true;
      stopCamera();
    }
    return;
  }
  refreshRecent();
  flushQueue();
  if (resumeCamera && mode === 'camera') {
    resumeCamera = false;
    startCamera();
  }
});

// ---------------------------------------------------------------------------
// Saving. The queue lives in browser storage until the server confirms each
// entry.

function isQueuedEntry(entry) {
  return Boolean(entry) && typeof entry.code === 'string' && entry.code !== ''
    && typeof entry.clientId === 'string' && Number.isSafeInteger(entry.sessionId)
    && MODES.includes(entry.method);
}

let queue = readStored(STORAGE.queue, []);
queue = Array.isArray(queue) ? queue.filter(isQueuedEntry) : [];
let flushing = false;
let retryTimer = 0;
let retryDelay = 1000;
let latestClientId = null;

function storeQueue() {
  writeStored(STORAGE.queue, queue);
}

// A random ID for each entry, so the server can recognise a resend.
// crypto.randomUUID only exists on HTTPS pages; the fallback works anywhere.
function newClientId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Queues one code for the active session. Returns the entry, or null if it
// could not be queued.
function saveCode({ code, method, format = null }) {
  if (!activeSession) {
    showResult('rejected', code, 'Not saved: choose or create a session first.');
    beep('error');
    openSessions({ focusNew: true });
    return null;
  }
  if (code.length > MAX_CODE_LENGTH) {
    showResult('rejected', `${code.slice(0, 40)}…`, `Not saved: a code can be at most ${MAX_CODE_LENGTH} characters.`);
    beep('error');
    return null;
  }
  const entry = {
    clientId: newClientId(),
    sessionId: activeSession.id,
    code,
    method,
    format,
    ...takeDetails(),
    clientTime: new Date().toISOString(),
  };
  latestClientId = entry.clientId;
  queue.push(entry);
  storeQueue();
  showResult('saving', code, 'Saving…');
  renderPending();
  renderRecent();
  flushQueue();
  return entry;
}

async function flushQueue() {
  if (flushing) return;
  flushing = true;
  clearTimeout(retryTimer);
  try {
    while (queue.length) {
      const entry = queue[0];
      let response;
      try {
        response = await fetch('/api/scans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
          cache: 'no-store',
          signal: requestTimeout(),
        });
      } catch {
        scheduleRetry(); // network down, or no answer in time
        return;
      }
      if (response.status >= 500 || response.status === 408 || response.status === 429) {
        scheduleRetry(); // the server (or a reverse proxy in front of it) is having trouble
        return;
      }
      const body = await response.json().catch(() => null);
      queue.shift();
      storeQueue();
      setConnection(true);
      if (response.ok) onSaved(entry, body);
      else onRejected(entry, body?.error ?? `the server answered ${response.status}.`);
    }
    retryDelay = 1000;
  } finally {
    flushing = false;
    renderPending();
  }
}

function scheduleRetry() {
  setConnection(false);
  clearTimeout(retryTimer);
  retryTimer = setTimeout(flushQueue, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 30_000);
  for (const entry of queue) markFound(entry.clientId, 'waiting');
  const latest = queue.find((entry) => entry.clientId === latestClientId);
  if (latest) {
    const firstWarning = el.result.dataset.kind !== 'queued';
    const count = queue.length === 1 ? '1 scan is' : `${queue.length} scans are`;
    showResult('queued', latest.code,
      `The server can't be reached. ${count} kept in this browser and will be sent automatically.`);
    if (firstWarning) beep('error');
  }
}

function describeSaved(entry, scan) {
  const parts = [];
  if (entry.format) parts.push(entry.format);
  const gs1 = parseGs1(entry.code);
  if (gs1) parts.push(describeGs1(gs1));
  parts.push(formatTime(scan?.createdAt ?? entry.clientTime), METHOD_LABEL[entry.method]);
  return parts.join(' · ');
}

function onSaved(entry, body) {
  updateSessionTotals(body?.session);
  markFound(entry.clientId, 'saved');
  scheduleRefresh();
  if (entry.method === 'camera') navigator.vibrate?.(40);
  if (entry.clientId !== latestClientId) return; // the card shows only the newest entry
  const scan = body?.scan;
  const times = scan?.timesScanned ?? 1;
  if (times > 1) {
    showResult('duplicate', entry.code,
      `Scanned ${times} times in this session. Remove this scan if it was a mistake. (${describeSaved(entry, scan)})`, scan?.id);
    beep('duplicate');
  } else {
    showResult('saved', entry.code, describeSaved(entry, scan), scan?.id);
    beep('ok');
  }
}

function onRejected(entry, message) {
  markFound(entry.clientId, 'failed');
  scheduleRefresh();
  showResult('rejected', entry.code, `Not saved: ${message}`);
  beep('error');
}

window.addEventListener('online', flushQueue);
window.addEventListener('beforeunload', (event) => {
  // Unsent scans stay in this browser's storage, but warn anyway: they are
  // only sent once this page is open again.
  if (queue.length) {
    event.preventDefault();
    event.returnValue = '';
  }
});

// ---------------------------------------------------------------------------
// Showing results, totals and the recent list.

const RESULT_LABEL = {
  saving: 'Saving…',
  saved: 'Saved',
  duplicate: 'Saved, but scanned before',
  queued: 'Not saved yet',
  rejected: 'Not saved',
  removed: 'Removed',
  error: 'Problem',
};
const FLASH_CLASS = { saved: 'flash-ok', duplicate: 'flash-warn', queued: 'flash-bad', rejected: 'flash-bad' };

function showResult(kind, code, detail, scanId = null) {
  el.result.hidden = false;
  el.result.dataset.kind = kind;
  el.resultLabel.textContent = RESULT_LABEL[kind];
  el.resultCode.textContent = code;
  el.resultDetail.textContent = detail;
  el.resultRemove.hidden = !scanId;
  el.resultRemove.dataset.id = scanId ? String(scanId) : '';
  setRemoveLabel(el.resultRemove);
  el.scanCard.classList.remove('flash-ok', 'flash-warn', 'flash-bad');
  if (FLASH_CLASS[kind]) {
    void el.scanCard.offsetWidth; // restart the animation
    el.scanCard.classList.add(FLASH_CLASS[kind]);
  }
}

function renderPending() {
  el.statPending.textContent = String(queue.length);
  el.statPendingBox.dataset.state = queue.length ? 'waiting' : 'none';
}

function setConnection(ok) {
  const state = ok ? 'ok' : 'down';
  if (el.connection.dataset.state === state) return;
  el.connection.dataset.state = state;
  el.connection.textContent = ok ? 'Connected' : 'Server unreachable';
}

function formatTime(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDateTime(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

let recentScans = [];

function scanRow(scan) {
  const row = document.createElement('tr');
  if (scan.pending) row.className = 'is-pending';
  const cell = (text, className) => {
    const td = document.createElement('td');
    td.className = className;
    td.textContent = text ?? '';
    row.append(td);
    return td;
  };
  cell(formatTime(scan.createdAt), 'col-time');
  const codeCell = cell(scan.code, 'col-code');
  if (scan.timesScanned > 1) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = `×${scan.timesScanned}`;
    badge.title = `Scanned ${scan.timesScanned} times in this session`;
    codeCell.append(' ', badge);
  }
  const extra = [scan.format, [scan.make, scan.model].filter(Boolean).join(' '), scan.notes].filter(Boolean);
  for (const text of extra) {
    const line = document.createElement('span');
    line.className = 'sub';
    line.textContent = text;
    codeCell.append(line);
  }
  cell(scan.pending ? 'Waiting' : METHOD_LABEL[scan.method], 'col-how');
  cell(scan.location, 'col-extra');
  cell(scan.scannedBy, 'col-extra');
  const actions = cell('', 'col-actions');
  if (!scan.pending) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-quiet remove';
    button.dataset.id = String(scan.id);
    setRemoveLabel(button);
    actions.append(button);
  }
  return row;
}

function renderRecent() {
  const rows = [];
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].sessionId === activeSession?.id) {
      rows.push(scanRow({ ...queue[i], createdAt: queue[i].clientTime, pending: true }));
    }
  }
  for (const scan of recentScans) rows.push(scanRow(scan));
  el.recentBody.replaceChildren(...rows);
  el.recentEmpty.hidden = rows.length > 0;
}

async function refreshRecent() {
  if (!activeSession) {
    recentScans = [];
    renderRecent();
    return;
  }
  const sessionId = activeSession.id;
  try {
    const { response, body } = await api(`/api/sessions/${sessionId}/scans?limit=${RECENT_LIMIT}`);
    if (activeSession?.id !== sessionId) return; // switched session meanwhile
    if (response.status === 404) {
      setActiveSession(null);
      openSessions({ focusNew: true });
      return;
    }
    if (!response.ok) throw new Error(String(response.status));
    recentScans = body.scans;
    updateSessionTotals(body.session);
    setConnection(true);
  } catch {
    setConnection(false);
  }
  renderRecent();
}

let refreshSoonTimer = 0;
function scheduleRefresh() {
  clearTimeout(refreshSoonTimer);
  refreshSoonTimer = setTimeout(refreshRecent, 300);
}

// Picks up scans made on other devices into the same session.
setInterval(() => {
  if (document.visibilityState === 'visible') refreshRecent();
}, REFRESH_EVERY_MS);

// ---------------------------------------------------------------------------
// Removing a scan takes two clicks on the same button within 4 seconds.

let armedRemoveId = null;
let disarmTimer = 0;

function setRemoveLabel(button) {
  const armed = button.dataset.id !== '' && button.dataset.id === String(armedRemoveId);
  button.textContent = armed ? 'Click again to remove' : 'Remove';
  button.classList.toggle('is-armed', armed);
}

function refreshRemoveLabels() {
  document.querySelectorAll('button.remove').forEach(setRemoveLabel);
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button.remove');
  if (button) removeScan(Number(button.dataset.id));
});

async function removeScan(id) {
  if (!id) return;
  if (armedRemoveId !== id) {
    armedRemoveId = id;
    clearTimeout(disarmTimer);
    disarmTimer = setTimeout(() => {
      armedRemoveId = null;
      refreshRemoveLabels();
    }, 4000);
    refreshRemoveLabels();
    return;
  }
  armedRemoveId = null;
  clearTimeout(disarmTimer);
  refreshRemoveLabels();
  try {
    const { response, body } = await api(`/api/scans/${id}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error(body.error ?? `HTTP ${response.status}`);
    updateSessionTotals(body.session);
    if (el.resultRemove.dataset.id === String(id)) {
      showResult('removed', el.resultCode.textContent,
        'This scan no longer counts. The database keeps a record that it was removed.');
    }
  } catch {
    showResult('error', '', 'Could not remove the scan. Check the connection and try again.');
  }
  refreshRecent();
}

// ---------------------------------------------------------------------------
// Sounds, made in the browser (no sound files). The scanner's own beep only
// means it read a barcode; this one means the database has the code.

let audio = null;
const TONES = {
  ok: [[880, 0.07]],
  duplicate: [[660, 0.07], [660, 0.07]],
  error: [[220, 0.3]],
  found: [[1320, 0.03]],
};

function beep(kind) {
  if (!settings.sound) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    let start = audio.currentTime + 0.01;
    for (const [frequency, length] of TONES[kind]) {
      const tone = audio.createOscillator();
      const volume = audio.createGain();
      tone.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, start);
      volume.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
      volume.gain.exponentialRampToValueAtTime(0.0001, start + length);
      tone.connect(volume).connect(audio.destination);
      tone.start(start);
      tone.stop(start + length + 0.02);
      start += length + 0.06;
    }
  } catch {
    // No sound available. The colours and text still show the result.
  }
}

// ---------------------------------------------------------------------------
// Start.

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    clearEntry(); // page restored from the back/forward cache
    refreshRecent();
  }
});

showSettings();
renderSession();
renderPending();
renderRecent();
setMode(mode);
updateEnabled();
focusScanBox();
loadActiveSession().then(() => refreshRecent());
if (queue.length) flushQueue();
if (mode === 'camera') {
  // Start straight away only if camera access was already allowed; otherwise
  // wait for the Start camera button (so the permission prompt follows a tap).
  navigator.permissions?.query({ name: 'camera' })
    .then((status) => {
      if (status.state === 'granted' && mode === 'camera') startCamera();
    })
    .catch(() => {});
}
