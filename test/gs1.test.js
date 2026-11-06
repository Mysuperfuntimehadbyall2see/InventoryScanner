// Unit tests for public/gs1.js (naming the fields of GS1 barcodes) and a
// consistency check of the vendored decoder files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseGs1, describeGs1, aiName } from '../public/gs1.js';

test('parses a GS1 DataMatrix / GS1-128 human-readable string', () => {
  assert.deepEqual(parseGs1('(01)00884116312345(21)7XK2Q93'), [
    { ai: '01', name: 'GTIN', value: '00884116312345' },
    { ai: '21', name: 'Serial', value: '7XK2Q93' },
  ]);
  assert.equal(describeGs1(parseGs1('(01)09506000134352(10)LOT42(17)271231')),
    'GTIN 09506000134352 · Batch/lot LOT42 · Expiry date 271231');
});

test('names asset, internal and measure identifiers', () => {
  assert.equal(aiName('8004'), 'Individual asset ID (GIAI)');
  assert.equal(aiName('91'), 'Company internal');
  assert.equal(aiName('3103'), 'Measure');
  assert.equal(aiName('7240'), 'AI 7240');
});

test('plain codes are not GS1', () => {
  for (const text of ['7XK2Q93', 'CN0F1R2T7618083A01QBA00', 'https://dell.com/x', '(01)', '01234(21)X', '', null]) {
    assert.equal(parseGs1(text), null, String(text));
  }
});

test('vendored zxing-wasm files match VERSION.json and package.json', () => {
  const base = new URL('../public/vendor/zxing-wasm/', import.meta.url);
  const info = JSON.parse(readFileSync(new URL('VERSION.json', base), 'utf8'));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(info.version, pkg.devDependencies['zxing-wasm'], 'run "npm run vendor" after changing the version');
  for (const [file, sha256] of Object.entries(info.sha256)) {
    const actual = createHash('sha256').update(readFileSync(new URL(file, base))).digest('hex');
    assert.equal(actual, sha256, `${file} differs from what was vendored`);
  }
  // The decoder's own build records the checksum of its .wasm; it must agree.
  const reader = readFileSync(new URL('es/reader/index.js', base), 'utf8');
  assert.ok(reader.includes(info.sha256['zxing_reader.wasm']), 'wasm checksum not found in the reader module');
});
