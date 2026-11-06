// Unit tests for the Hand scanner timing rules in public/scan-detect.js.
// Run with: npm test  (or: node --test "test/*.test.js")

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BURST_GAP_MS, SPLIT_GAP_MS, MIN_BURST_LENGTH, DEFAULT_SETTINGS,
  sanitizeSettings, createEntryTracker, isScannerBurst, startsNewCode, describeEntry,
} from '../public/scan-detect.js';

// Feeds `text` into a tracker one character at a time, `gaps` ms apart
// (a number, or one gap per character after the first).
function entry(text, gaps) {
  const tracker = createEntryTracker();
  let t = 1000;
  [...text].forEach((_, i) => {
    if (i > 0) t += Array.isArray(gaps) ? gaps[i - 1] : gaps;
    tracker.keystroke(t);
  });
  return { tracker, summary: tracker.summary(), length: text.length };
}

test('defaults: save 1 second after the scanner stops, beep on, camera auto-save on', () => {
  assert.deepEqual(DEFAULT_SETTINGS, { idleMs: 1000, sound: true, cameraAutoSave: true });
});

test('a fast burst is a scanner burst', () => {
  const e = entry('INV-000123', 4);
  assert.equal(isScannerBurst(e.summary, e.length), true);
});

test('a burst right at the gap limit still counts; one slow gap does not', () => {
  const edge = entry('ABCD1234', BURST_GAP_MS);
  assert.equal(isScannerBurst(edge.summary, edge.length), true);
  const slow = entry('ABCDEF', [3, 3, 120, 3, 3]);
  assert.equal(isScannerBurst(slow.summary, slow.length), false);
});

test('normal typing, short bursts, edits and leftover text are not scanner bursts', () => {
  const typed = entry('INV-000123', 140);
  assert.equal(isScannerBurst(typed.summary, typed.length), false);
  const short = entry('AB1', 3);
  assert.equal(MIN_BURST_LENGTH, 4);
  assert.equal(isScannerBurst(short.summary, short.length), false);
  const pasted = entry('PASTED-CODE', 2);
  pasted.tracker.markEdited();
  assert.equal(isScannerBurst(pasted.tracker.summary(), pasted.length), false);
  const leftover = entry('12345', 3);
  assert.equal(isScannerBurst(leftover.summary, 'OLD12345'.length), false);
});

test('a pause after a burst starts a new code; a short pause or typing does not', () => {
  const burst = entry('7XK2Q93', 4);
  assert.equal(startsNewCode(burst.summary, burst.length, SPLIT_GAP_MS + 1), true);
  assert.equal(startsNewCode(burst.summary, burst.length, SPLIT_GAP_MS), false);
  const typed = entry('7XK2Q93', 150);
  assert.equal(startsNewCode(typed.summary, typed.length, 2000), false);
});

test('reset starts a fresh entry', () => {
  const { tracker } = entry('SLOWTYPING', 200);
  tracker.reset();
  for (let i = 0; i < 6; i++) tracker.keystroke(5000 + i * 2);
  assert.equal(isScannerBurst(tracker.summary(), 6), true);
  assert.equal(tracker.lastKeystrokeAt, 5010);
});

test('summary reports keystrokes, longest gap and total time', () => {
  assert.deepEqual(entry('ABCD', [5, 30, 10]).summary, { keystrokes: 4, edited: false, longestGapMs: 30, totalMs: 45 });
});

test('sanitizeSettings fills defaults and clamps the quiet time', () => {
  assert.deepEqual(sanitizeSettings(undefined), { ...DEFAULT_SETTINGS });
  assert.deepEqual(sanitizeSettings({ idleMs: 'junk' }), { ...DEFAULT_SETTINGS });
  assert.equal(sanitizeSettings({ idleMs: 50 }).idleMs, 200);
  assert.equal(sanitizeSettings({ idleMs: 99_999 }).idleMs, 5000);
  assert.equal(sanitizeSettings({ idleMs: '1500' }).idleMs, 1500);
  assert.deepEqual(sanitizeSettings({ sound: false, cameraAutoSave: false }), { idleMs: 1000, sound: false, cameraAutoSave: false });
});

test('describeEntry explains the timing in plain words', () => {
  assert.equal(describeEntry(entry('INV-000123', 4).summary), '10 keystrokes in 36 ms, longest gap 4 ms: scanner speed.');
  assert.match(describeEntry(entry('ABCDE', 150).summary), /typing speed/);
  const pasted = entry('X', 0);
  pasted.tracker.markEdited();
  assert.match(describeEntry(pasted.tracker.summary()), /pasted or edited/);
});
