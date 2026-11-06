# Inventory Scanner

A small self-hosted web app for recording barcodes into named **sessions**, from a
USB/Bluetooth barcode scanner, from typing, or from a phone camera, and for
identifying what was scanned: an **Analyze** page looks up Dell service tags
(model, ship date, warranty, factory specs) and Cisco serial numbers (model and
description) and exports everything as CSV.

- Node.js 24 using only built-in modules (`node:http`, `node:sqlite`); no npm
  packages at run time
- One SQLite file; runs in a single hardened Docker container
- Plain HTML, CSS and JavaScript in the browser; no framework, no build step
- Camera decoding with [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (ZXing-C++
  as WebAssembly), served by the app itself: no CDN

## Features

### Sessions

A session is one named list of scans ("Warehouse sweep 2026-11-06", "Lot 14").
Every code is saved into the browser's **active session**. Sessions can be
created, listed and switched from the page, and each can be exported as CSV
(or all of them in one file). Several people can scan into the same session at
once.

### Three ways to enter codes

| Mode | Use it for | A code is saved |
|---|---|---|
| **Hand scanner** | A USB or Bluetooth scanner in keyboard mode | **1 second after the scanner stops typing** (adjustable), or at once on Enter or Tab. A bar under the box counts down. |
| **Manual** | Typing | When Enter is pressed |
| **Camera** | A phone, tablet or laptop camera | As soon as it is read (or on a tap, with automatic saving off) |

- **Hand scanner:** if a second code starts before the quiet time is up, the
  first one is saved at that moment, so two codes are never glued together
  (a scanner types a whole code in a few milliseconds; that speed is how a new
  burst is recognised).
- **Camera:** every barcode in view is read, in these families: Code 128 and
  GS1-128, Code 39, Code 93, Codabar, ITF, EAN/UPC, GS1 DataBar, Data Matrix
  and GS1 DataMatrix, QR Code (incl. GS1 QR and Micro QR), PDF417 and Aztec.
  GS1 codes are saved in their readable form, `(01)00884116312345(21)7XK2Q93`,
  and their fields are named on screen (GTIN, Serial, …). Frames alternate
  between the whole picture (several codes at once) and the middle at full
  detail (small codes). Torch, zoom and a camera picker appear when the device
  offers them. The camera needs **HTTPS** (or `localhost`).
- The page keeps the keyboard focus in the scan box and says plainly when a
  scan would go somewhere else ("Paused: the cursor is in another box").

### Details saved with each scan

**Location**, **Scanned by** and, under **More details**, **Make**, **Model**
and **Notes** are optional. Each has a **Sticky** box: a sticky field keeps its
value for every scan that follows; any other field is cleared once a scan has
taken it. Location and Scanned by start sticky.

### Reliability

- Entries wait in the browser's storage until the server confirms them, so a
  network drop loses nothing; each carries a random ID, so a resend is never
  stored twice.
- Repeats are flagged (×2) within a session. **Remove** needs a second click
  and only marks a scan removed; nothing is ever deleted from the database.

### Analyze page

One row per distinct code in a session. The app recognises:

- **Dell service tags**: a 7-character code with a letter in it, the end of the
  QR code on a Dell label (`…/servicetag/7XK2Q93`, `qrl.dell.com/7XK2Q93`), or
  the Serial field `(21)` of a GS1 code;
- **Cisco serial numbers**: 11 characters, `LLLYYWWSSSS` (e.g. `FOC1632X0AB`;
  the digits give the year and week built), with or without an `S/N` prefix.

**Look up online** asks Dell's TechDirect API (model, product line, ship date,
warranty and every entitlement, and CPU / RAM / storage / GPU / OS / form
factor parsed from the factory parts list) and Cisco's Product Information API
(orderable PID, product description, series, type, release date) about every
item not looked up yet, a few per request, with a progress bar. Answers are
stored per tag or serial, so each is asked once; **Refresh all** asks again.
**Download analysis (CSV)** includes every field. Each vendor is optional: it
is used only when its credentials are set.

## Running it

```bash
git clone <this repository> inventory-scanner && cd inventory-scanner
mkdir -p data && sudo chown 1000:1000 data   # the container runs as uid 1000
cp .env.example .env                          # optional: Dell / Cisco API keys
docker compose up -d --build
# open http://localhost:3000
```

For real use, put it behind an HTTPS reverse proxy (the camera requires HTTPS),
then in a `docker-compose.override.yml` (merged automatically) remove the
published port, join the proxy's network and set `TRUST_PROXY: "1"`. For
example:

```yaml
services:
  inventory-scanner:
    ports: !reset []
    environment:
      TRUST_PROXY: "1"
      DISPLAY_TIMEZONE: America/New_York
      APP_SUBTITLE: Example Org IT
    networks: [proxy]
networks:
  proxy:
    external: true
```

If the proxy keeps idle connections to the app, its idle timeout should be under
65 seconds (the app closes idle connections after that).

### Settings

Environment variables (set in compose, or `.env` for secrets):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | Listen port |
| `DATA_DIR` | `./data` (`/data` in the container) | Folder holding `scans.db` |
| `TRUST_PROXY` | `0` | `1` = take the client address from `X-Forwarded-For`. Only behind a proxy that is the only way in. |
| `DISPLAY_TIMEZONE` | `UTC` | Time zone of the local-time columns in CSV exports |
| `APP_SUBTITLE` | empty | A line under the page title, e.g. your organisation |
| `DELL_CLIENT_ID`, `DELL_CLIENT_SECRET` | empty | Dell TechDirect API application (apis.dell.com). **Secret.** |
| `DELL_TOKEN_URL`, `DELL_API_BASE` | Dell's production URLs | |
| `CISCO_CLIENT_ID`, `CISCO_CLIENT_SECRET` | empty | Cisco API Console application (apiconsole.cisco.com) with the Product Information API. **Secret.** |
| `CISCO_TOKEN_URL`, `CISCO_API_BASE` | `https://id.cisco.com/oauth2/default/v1/token`, `https://apix.cisco.com` | Confirm the token URL on your API Console application page |

Per-browser settings on the page: Hand scanner quiet time (200 ms – 5 s), beep
on save, camera auto-save.

### Updating

```bash
git pull && docker compose up -d --build
```

The database schema updates itself on start (see "Data").

## Tests

```bash
# Unit and API tests (no network; Dell and Cisco are faked)
docker run --rm -v "$PWD":/app:ro -w /app node:24.22.2-alpine3.24 node --test "test/*.test.js"

# Browser test: a real headless Chromium types at scanner and human speed,
# uses sessions and sticky fields, goes offline and back, points a simulated
# camera at five real barcodes (GS1 DataMatrix, GS1-128, Code 39, QR,
# Code 128), and runs the Analyze page against fake Dell and Cisco servers
docker build -f test/browser/Dockerfile -t inventory-scanner-e2e .
docker run --rm --shm-size=256m -v "$PWD":/app:ro inventory-scanner-e2e node test/browser/scanner-e2e.mjs
docker image rm inventory-scanner-e2e   # about 1.4 GB
```

## Updating the decoder

zxing-wasm is pinned in `package.json` / `package-lock.json` as a development
dependency; its four browser files are copied into `public/vendor/zxing-wasm`
and committed, with their SHA-256 in `VERSION.json` (a unit test checks them).

```bash
npm install --save-dev --save-exact --ignore-scripts zxing-wasm@<version>
npm audit
npm run vendor
```

The Node version is pinned in `Dockerfile` and `test/browser/Dockerfile`.

## Data

SQLite, `data/scans.db`. `PRAGMA user_version` is the schema version; changes
are steps appended to `MIGRATIONS` in `src/db.js` and run once, in a
transaction, at start-up.

| Table | Holds |
|---|---|
| `sessions` | `id`, `name` (unique, case-insensitive), `created_at`, `created_by_ip` |
| `scans` | `session_id`, `code`, `entry_method` (`scanner` / `manual` / `camera`), `barcode_format` (camera), `location`, `scanned_by`, `make`, `model`, `notes`, `client_id` (idempotency), `client_scanned_at`, `created_at`, `client_ip`, `user_agent`, `deleted_at`, `deleted_by_ip` |
| `dell_assets` | one row per Dell service tag looked up: model, product line, ship date, warranty, entitlements, CPU, RAM, storage, GPU, OS, form factor, status, error |
| `cisco_assets` | one row per Cisco serial looked up: PID, base PID, product name, series, type, category, release date, support page, status, error |

Consistent backup while running:

```bash
docker exec inventory-scanner node -e "new (require('node:sqlite').DatabaseSync)('/data/scans.db').exec(\"VACUUM INTO '/data/scans-backup-$(date +%Y%m%d-%H%M%S).db'\")"
```

## API

JSON in and out (`Content-Type: application/json`), except CSV downloads.

| Call | Does |
|---|---|
| `GET /api/sessions` | Sessions with totals, most recently used first |
| `POST /api/sessions` | `{"name": "…"}` → `201`, or `409` if the name exists |
| `GET /api/sessions/:id` | One session with totals |
| `GET /api/sessions/:id/scans?limit=25` | Its newest scans (max 200) |
| `GET /api/sessions/:id/export.csv` | Its scans |
| `GET /api/sessions/:id/analysis` | One row per distinct code, with what was recognised and looked up |
| `GET /api/sessions/:id/analysis.csv` | The same as CSV |
| `POST /api/scans` | `{"sessionId", "code", "method", "format?", "clientId?", "location?", "scannedBy?", "make?", "model?", "notes?"}` → `201` stored, `200` already stored (same `clientId`) |
| `DELETE /api/scans/:id` | Mark a scan removed |
| `POST /api/dell/lookup` | `{"tags": […up to 10], "refresh?": true}` |
| `POST /api/cisco/lookup` | `{"serials": […up to 10], "refresh?": true}` |
| `GET /api/export.csv` | Every session's scans |
| `GET /healthz` | `ok` when the database answers |

CSV cells starting with `= + - @` get a leading `'` so spreadsheets treat them
as text.

## Security notes

- **No sign-in.** Anyone who can reach the app can scan, remove (soft) and
  export, and trigger vendor lookups. Run it on a trusted network, or put an
  authenticating proxy in front.
- API credentials stay on the server (`.env`); browsers never see them. Only
  service tags and serial numbers are sent to Dell and Cisco.
- Strict Content-Security-Policy (`script-src 'self' 'wasm-unsafe-eval'`, no
  inline script), `Permissions-Policy: camera=(self)`, nosniff, no framing.
  All page text is set with `textContent`.
- Camera frames are decoded in the browser; no images are uploaded or stored.
- The container runs as uid 1000 with a read-only root filesystem, no
  capabilities and no privilege escalation.

## Licences

This project: MIT (see `LICENSE`). The vendored decoder is zxing-wasm (MIT) wrapping ZXing-C++ (Apache-2.0); see
`public/vendor/zxing-wasm/`. `bwip-js` (MIT) is used by the browser test only.
