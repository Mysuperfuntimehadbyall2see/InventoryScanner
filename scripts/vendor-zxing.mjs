// Copies the barcode decoder (zxing-wasm) from node_modules into
// public/vendor/zxing-wasm, so the app serves it itself: no CDN, and no npm
// install in the app image. Writes VERSION.json with the version and the
// SHA-256 of every file, so a reviewer can check what is being served.
//
// To update the decoder:
//   npm install --save-dev --save-exact --ignore-scripts zxing-wasm@<version>
//   npm audit
//   npm run vendor
//   then run the tests (README.md, "Tests") and commit public/vendor.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'node_modules/zxing-wasm');
const target = path.join(root, 'public/vendor/zxing-wasm');

// Only the "reader" build is needed (reading, not writing, barcodes).
const FILES = [
  ['LICENSE', 'LICENSE'],
  ['dist/es/reader/index.js', 'es/reader/index.js'],
  ['dist/es/share.js', 'es/share.js'], // imported by es/reader/index.js as "../share.js"
  ['dist/reader/zxing_reader.wasm', 'zxing_reader.wasm'],
];

const pkg = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const locked = lock.packages['node_modules/zxing-wasm'];
if (locked.version !== pkg.version) throw new Error('node_modules does not match package-lock.json; run npm ci');

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const share = readFileSync(path.join(source, 'dist/es/share.js'), 'utf8');
const zxingCppCommit = /ZXING_CPP_COMMIT\s*=\s*"([0-9a-f]+)"/.exec(share)?.[1] ?? /"([0-9a-f]{40})"/.exec(share)?.[1] ?? null;

rmSync(target, { recursive: true, force: true });
const files = {};
for (const [from, to] of FILES) {
  mkdirSync(path.dirname(path.join(target, to)), { recursive: true });
  copyFileSync(path.join(source, from), path.join(target, to));
  files[to] = sha256(path.join(target, to));
}

const info = {
  package: 'zxing-wasm',
  version: pkg.version,
  license: `${pkg.license} (wrapper, see LICENSE); the decoder inside zxing_reader.wasm is zxing-cpp, Apache-2.0`,
  source: 'https://github.com/Sec-ant/zxing-wasm',
  zxingCppCommit,
  npmIntegrity: locked.integrity,
  vendoredOn: new Date().toISOString().slice(0, 10),
  sha256: files,
};
writeFileSync(path.join(target, 'VERSION.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(`vendored zxing-wasm ${pkg.version} into public/vendor/zxing-wasm`);
console.log(JSON.stringify(info.sha256, null, 2));
