// Hand-scanner timing rules. The page (app.js) and the unit tests
// (test/scan-detect.test.js) both use this file, so it contains no page code.
//
// A USB or Bluetooth barcode scanner works like a keyboard: it "types" the
// code. In Hand scanner mode a code is saved once the typing has stopped for
// `idleMs` (1 second by default), or straight away on Enter or Tab.
//
// One more rule keeps two codes from being glued together when they are
// scanned less than a second apart: a scanner types a whole code in a few
// milliseconds (no gap over BURST_GAP_MS). If such a burst is followed by a
// pause longer than SPLIT_GAP_MS and then more typing, the new typing is a
// second code, so the first one is saved at that moment.

export const BURST_GAP_MS = 50;
export const SPLIT_GAP_MS = 300;
export const MIN_BURST_LENGTH = 4;

export const DEFAULT_SETTINGS = Object.freeze({
  idleMs: 1000, // Hand scanner: save after this much quiet time
  sound: true, // beep when a code is saved
  cameraAutoSave: true, // Camera: save each new code without a tap
});

// Allowed range for each number setting: [lowest, highest].
export const SETTING_LIMITS = Object.freeze({
  idleMs: [200, 5000],
});

// Turns whatever is stored (or typed into the settings form) into valid
// settings. Bad or missing values fall back to the defaults.
export function sanitizeSettings(input) {
  const [lowest, highest] = SETTING_LIMITS.idleMs;
  const raw = input?.idleMs;
  const n = raw === '' || raw === null ? NaN : Number(raw);
  return {
    idleMs: Number.isFinite(n) ? Math.min(highest, Math.max(lowest, Math.round(n))) : DEFAULT_SETTINGS.idleMs,
    sound: input?.sound !== false,
    cameraAutoSave: input?.cameraAutoSave !== false,
  };
}

// Records the timing of one entry, from its first character until it is saved
// or cleared.
export function createEntryTracker() {
  let times = [];
  let edited = false;
  return {
    reset() {
      times = [];
      edited = false;
    },
    // One typed character, at time `ms` (event.timeStamp in the page).
    keystroke(ms) {
      times.push(ms);
    },
    // The entry was pasted, dropped, deleted from, auto-completed or composed
    // with an input method, so it is not a clean scanner burst.
    markEdited() {
      edited = true;
    },
    get lastKeystrokeAt() {
      return times.length ? times[times.length - 1] : null;
    },
    summary() {
      let longestGap = 0;
      for (let i = 1; i < times.length; i++) {
        longestGap = Math.max(longestGap, times[i] - times[i - 1]);
      }
      return {
        keystrokes: times.length,
        edited,
        longestGapMs: longestGap,
        totalMs: times.length > 1 ? times[times.length - 1] - times[0] : 0,
      };
    },
  };
}

// True when the entry so far was typed at scanner speed. `length` is the
// number of characters in the box; each counted keystroke adds exactly one,
// so a mismatch means something else put text there.
export function isScannerBurst(summary, length) {
  return !summary.edited
    && summary.keystrokes === length
    && length >= MIN_BURST_LENGTH
    && summary.longestGapMs <= BURST_GAP_MS;
}

// True when a keystroke arriving `gapMs` after the previous one starts a new
// code, because what came before it was a complete scanner burst.
export function startsNewCode(summary, length, gapMs) {
  return gapMs > SPLIT_GAP_MS && isScannerBurst(summary, length);
}

// One plain-English line for the "Last entry" display in the settings.
export function describeEntry(summary) {
  const n = summary.keystrokes;
  if (n === 0) return 'nothing typed.';
  const count = `${n} keystroke${n === 1 ? '' : 's'}`;
  if (summary.edited) return `${count}; the entry was pasted or edited.`;
  if (n === 1) return `${count}.`;
  const speed = summary.longestGapMs <= BURST_GAP_MS ? 'scanner speed' : 'typing speed';
  return `${count} in ${Math.round(summary.totalMs)} ms, longest gap ${Math.round(summary.longestGapMs)} ms: ${speed}.`;
}
