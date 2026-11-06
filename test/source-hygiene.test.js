// Source files must not contain invisible characters (zero-width spaces,
// byte-order marks, non-breaking spaces). Write them as escapes instead,
// e.g. \uFEFF, so a reader can see them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const INVISIBLE = /[\u00A0\u200B-\u200D\u2060\uFEFF]/;

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'vendor', 'data', '.git'].includes(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.(js|mjs|html|css|md|yml)$/.test(name)) yield full;
  }
}

test('no invisible characters in source files', () => {
  const bad = [];
  for (const file of sourceFiles(root)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (INVISIBLE.test(line)) bad.push(`${path.relative(root, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});
