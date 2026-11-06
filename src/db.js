// Storage: one SQLite file (data/scans.db) opened with Node's built-in
// node:sqlite module, so no database package is installed.
//
// A session is a named list of scans ("Warehouse sweep 2026-11-06"). Every
// scan belongs to exactly one session. Nothing is ever erased: "Remove" in the
// page sets deleted_at, so the history stays complete for the later
// comparison with the approved-for-sale list.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const ENTRY_METHODS = Object.freeze(['scanner', 'manual', 'camera']);

// Schema changes, in order. PRAGMA user_version records how many of them a
// database file has had, so each step runs exactly once on every copy.
// To change the schema, append a step. Never edit one that has shipped.
export const MIGRATIONS = [
  `CREATE TABLE sessions (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     name          TEXT NOT NULL,
     created_at    TEXT NOT NULL,                       -- UTC, ISO 8601
     created_by_ip TEXT
   );
   CREATE UNIQUE INDEX sessions_name ON sessions (name COLLATE NOCASE);

   CREATE TABLE scans (
     id                INTEGER PRIMARY KEY AUTOINCREMENT,
     session_id        INTEGER NOT NULL REFERENCES sessions (id),
     code              TEXT NOT NULL,                   -- what was scanned or typed
     entry_method      TEXT NOT NULL CHECK (entry_method IN ('scanner', 'manual', 'camera')),
     barcode_format    TEXT,                            -- camera only, e.g. "GS1 DataMatrix", "Code 39"
     location          TEXT,                            -- optional, from the page
     scanned_by        TEXT,                            -- optional, typed by the user (not a login)
     client_id         TEXT NOT NULL UNIQUE,            -- random ID from the browser; a resend cannot be stored twice
     client_scanned_at TEXT,                            -- browser clock when scanned (UTC, ISO 8601)
     created_at        TEXT NOT NULL,                   -- server clock when stored (UTC, ISO 8601)
     client_ip         TEXT,
     user_agent        TEXT,
     deleted_at        TEXT,                            -- set by "Remove"; the row is kept
     deleted_by_ip     TEXT
   );
   CREATE INDEX scans_session_code ON scans (session_id, code COLLATE NOCASE);`,

  // 2 (2026-11-06): optional details typed on the scan page, and what Dell
  // knows about each service tag (filled in from the Analyze page). Dell data
  // is kept once per tag, not copied onto every scan of it.
  `ALTER TABLE scans ADD COLUMN make TEXT;
   ALTER TABLE scans ADD COLUMN model TEXT;
   ALTER TABLE scans ADD COLUMN notes TEXT;

   CREATE TABLE dell_assets (
     service_tag        TEXT PRIMARY KEY COLLATE NOCASE,
     status             TEXT NOT NULL CHECK (status IN ('found', 'not_found', 'error')),
     model              TEXT,                           -- e.g. "OptiPlex 7040"
     product_line       TEXT,                           -- e.g. "OptiPlex Desktops"
     system_description TEXT,
     product_family     TEXT,
     ship_date          TEXT,                           -- UTC, ISO 8601
     warranty_start     TEXT,
     warranty_end       TEXT,                           -- latest end of any entitlement
     warranty_service   TEXT,                           -- service level of that entitlement
     entitlements_json  TEXT,                           -- every entitlement, as Dell sent it (trimmed)
     cpu                TEXT,
     ram                TEXT,
     storage            TEXT,
     gpu                TEXT,
     os                 TEXT,
     form_factor        TEXT,
     error              TEXT,                           -- why the lookup (or its specs part) failed
     looked_up_at       TEXT NOT NULL
   );`,

  // 3 (2026-11-06): what Cisco knows about each Cisco serial (Analyze page,
  // Cisco Support API "Product Information").
  `CREATE TABLE cisco_assets (
     serial          TEXT PRIMARY KEY COLLATE NOCASE,
     status          TEXT NOT NULL CHECK (status IN ('found', 'not_found', 'error')),
     pid             TEXT,                              -- orderable product ID, e.g. WS-C2960X-48FPD-L
     base_pid        TEXT,
     product_name    TEXT,                              -- Cisco's plain-English description
     series          TEXT,                              -- e.g. Cisco Catalyst 2960-X Series Switches
     type            TEXT,                              -- e.g. SWITCH
     category        TEXT,
     release_date    TEXT,                              -- YYYY-MM-DD
     support_page    TEXT,
     error           TEXT,
     looked_up_at    TEXT NOT NULL
   );`,
];

// Per-session totals. Removed scans do not count. Codes are compared without
// regard to case: "abc1" and "ABC1" are the same item.
const SESSION_SUMMARY = `
  SELECT s.id, s.name, s.created_at,
         COUNT(c.id) AS total,
         COUNT(DISTINCT c.code COLLATE NOCASE) AS unique_codes,
         MAX(c.created_at) AS last_scan_at
    FROM sessions s
    LEFT JOIN scans c ON c.session_id = s.id AND c.deleted_at IS NULL`;

export class ConflictError extends Error {}

export function openStore(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  migrate(db);

  const sql = {
    insertSession: db.prepare('INSERT INTO sessions (name, created_at, created_by_ip) VALUES (?, ?, ?)'),
    sessionByName: db.prepare('SELECT id FROM sessions WHERE name = ? COLLATE NOCASE'),
    session: db.prepare(`${SESSION_SUMMARY} WHERE s.id = ? GROUP BY s.id`),
    sessions: db.prepare(`${SESSION_SUMMARY} GROUP BY s.id ORDER BY COALESCE(MAX(c.created_at), s.created_at) DESC, s.id DESC`),
    insertScan: db.prepare(`
      INSERT INTO scans (session_id, code, entry_method, barcode_format, location, scanned_by,
                         make, model, notes, client_id, client_scanned_at, created_at, client_ip, user_agent)
      VALUES (:sessionId, :code, :method, :format, :location, :scannedBy,
              :make, :model, :notes, :clientId, :clientTime, :createdAt, :ip, :userAgent)
      ON CONFLICT (client_id) DO NOTHING`),
    scanByClientId: db.prepare('SELECT * FROM scans WHERE client_id = ?'),
    scanById: db.prepare('SELECT * FROM scans WHERE id = ?'),
    timesScanned: db.prepare(`
      SELECT COUNT(*) AS n FROM scans
       WHERE session_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL`),
    recent: db.prepare(`
      SELECT c.*,
             (SELECT COUNT(*) FROM scans d
               WHERE d.session_id = c.session_id AND d.code = c.code COLLATE NOCASE
                 AND d.deleted_at IS NULL) AS times_scanned
        FROM scans c
       WHERE c.session_id = ? AND c.deleted_at IS NULL
       ORDER BY c.id DESC
       LIMIT ?`),
    softDelete: db.prepare(
      'UPDATE scans SET deleted_at = ?, deleted_by_ip = ? WHERE id = ? AND deleted_at IS NULL'),
    exportSession: db.prepare(`
      SELECT c.*, s.name AS session_name FROM scans c JOIN sessions s ON s.id = c.session_id
       WHERE c.session_id = ? AND c.deleted_at IS NULL ORDER BY c.id`),
    exportAll: db.prepare(`
      SELECT c.*, s.name AS session_name FROM scans c JOIN sessions s ON s.id = c.session_id
       WHERE c.deleted_at IS NULL ORDER BY c.session_id, c.id`),
    sessionScans: db.prepare('SELECT * FROM scans WHERE session_id = ? AND deleted_at IS NULL ORDER BY id'),
    dellAsset: db.prepare('SELECT * FROM dell_assets WHERE service_tag = ?'),
    saveDellAsset: db.prepare(`
      INSERT INTO dell_assets (service_tag, status, model, product_line, system_description, product_family,
                               ship_date, warranty_start, warranty_end, warranty_service, entitlements_json,
                               cpu, ram, storage, gpu, os, form_factor, error, looked_up_at)
      VALUES (:serviceTag, :status, :model, :productLine, :systemDescription, :productFamily,
              :shipDate, :warrantyStart, :warrantyEnd, :warrantyService, :entitlements,
              :cpu, :ram, :storage, :gpu, :os, :formFactor, :error, :lookedUpAt)
      ON CONFLICT (service_tag) DO UPDATE SET
        status = excluded.status, model = excluded.model, product_line = excluded.product_line,
        system_description = excluded.system_description, product_family = excluded.product_family,
        ship_date = excluded.ship_date, warranty_start = excluded.warranty_start,
        warranty_end = excluded.warranty_end, warranty_service = excluded.warranty_service,
        entitlements_json = excluded.entitlements_json, cpu = excluded.cpu, ram = excluded.ram,
        storage = excluded.storage, gpu = excluded.gpu, os = excluded.os,
        form_factor = excluded.form_factor, error = excluded.error, looked_up_at = excluded.looked_up_at`),
    ciscoAsset: db.prepare('SELECT * FROM cisco_assets WHERE serial = ?'),
    saveCiscoAsset: db.prepare(`
      INSERT INTO cisco_assets (serial, status, pid, base_pid, product_name, series, type, category,
                                release_date, support_page, error, looked_up_at)
      VALUES (:serial, :status, :pid, :basePid, :productName, :series, :type, :category,
              :releaseDate, :supportPage, :error, :lookedUpAt)
      ON CONFLICT (serial) DO UPDATE SET
        status = excluded.status, pid = excluded.pid, base_pid = excluded.base_pid,
        product_name = excluded.product_name, series = excluded.series, type = excluded.type,
        category = excluded.category, release_date = excluded.release_date,
        support_page = excluded.support_page, error = excluded.error, looked_up_at = excluded.looked_up_at`),
    ping: db.prepare('SELECT 1 AS ok'),
  };

  const getSession = (id) => {
    const row = sql.session.get(id);
    return row ? sessionToApi(row) : null;
  };
  const scanToApi = (row) => ({
    id: row.id,
    sessionId: row.session_id,
    code: row.code,
    method: row.entry_method,
    format: row.barcode_format,
    location: row.location,
    scannedBy: row.scanned_by,
    make: row.make,
    model: row.model,
    notes: row.notes,
    createdAt: row.created_at,
    timesScanned: row.times_scanned ?? sql.timesScanned.get(row.session_id, row.code).n,
    removed: row.deleted_at !== null,
  });

  return {
    file,

    // Throws ConflictError if a session with that name (any capitalisation) exists.
    createSession(name, ip) {
      if (sql.sessionByName.get(name)) throw new ConflictError('A session with that name already exists.');
      const { lastInsertRowid } = sql.insertSession.run(name, new Date().toISOString(), ip ?? null);
      return getSession(Number(lastInsertRowid));
    },

    getSession,

    listSessions() {
      return sql.sessions.all().map(sessionToApi);
    },

    // Stores one scan. Sending the same clientId again returns the stored row
    // with created: false instead of adding a second one.
    addScan({ sessionId, code, method, format, location, scannedBy, make, model, notes, clientId, clientTime, ip, userAgent }) {
      const result = sql.insertScan.run({
        sessionId,
        code,
        method,
        format: format ?? null,
        location: location ?? null,
        scannedBy: scannedBy ?? null,
        make: make ?? null,
        model: model ?? null,
        notes: notes ?? null,
        clientId,
        clientTime: clientTime ?? null,
        createdAt: new Date().toISOString(),
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      });
      return { scan: scanToApi(sql.scanByClientId.get(clientId)), created: result.changes > 0 };
    },

    recentScans(sessionId, limit) {
      return sql.recent.all(sessionId, limit).map(scanToApi);
    },

    getScan(id) {
      const row = sql.scanById.get(id);
      return row ? scanToApi(row) : null;
    },

    // Returns the scan's session, or null if there is no such scan or it was
    // already removed.
    removeScan(id, ip) {
      const row = sql.scanById.get(id);
      if (!row) return null;
      const { changes } = sql.softDelete.run(new Date().toISOString(), ip ?? null, id);
      return changes > 0 ? getSession(row.session_id) : null;
    },

    // Every scan that has not been removed, with all columns and the session
    // name: one session's, or (no argument) every session's.
    exportRows(sessionId) {
      return sessionId === undefined ? sql.exportAll.all() : sql.exportSession.all(sessionId);
    },

    // Every scan of a session that has not been removed, oldest first, all columns.
    sessionScans(sessionId) {
      return sql.sessionScans.all(sessionId);
    },

    getDellAsset(tag) {
      const row = sql.dellAsset.get(tag);
      return row ? dellToApi(row) : null;
    },

    saveDellAsset(record) {
      sql.saveDellAsset.run({
        serviceTag: record.serviceTag,
        status: record.status,
        model: record.model ?? null,
        productLine: record.productLine ?? null,
        systemDescription: record.systemDescription ?? null,
        productFamily: record.productFamily ?? null,
        shipDate: record.shipDate ?? null,
        warrantyStart: record.warrantyStart ?? null,
        warrantyEnd: record.warrantyEnd ?? null,
        warrantyService: record.warrantyService ?? null,
        entitlements: record.entitlements ? JSON.stringify(record.entitlements) : null,
        cpu: record.cpu ?? null,
        ram: record.ram ?? null,
        storage: record.storage ?? null,
        gpu: record.gpu ?? null,
        os: record.os ?? null,
        formFactor: record.formFactor ?? null,
        error: record.error ?? null,
        lookedUpAt: new Date().toISOString(),
      });
      return this.getDellAsset(record.serviceTag);
    },

    getCiscoAsset(serial) {
      const row = sql.ciscoAsset.get(serial);
      return row ? ciscoToApi(row) : null;
    },

    saveCiscoAsset(record) {
      sql.saveCiscoAsset.run({
        serial: record.serial,
        status: record.status,
        pid: record.pid ?? null,
        basePid: record.basePid ?? null,
        productName: record.productName ?? null,
        series: record.series ?? null,
        type: record.type ?? null,
        category: record.category ?? null,
        releaseDate: record.releaseDate ?? null,
        supportPage: record.supportPage ?? null,
        error: record.error ?? null,
        lookedUpAt: new Date().toISOString(),
      });
      return this.getCiscoAsset(record.serial);
    },

    ping() {
      return sql.ping.get().ok === 1;
    },

    close() {
      if (db.isOpen) db.close();
    },
  };
}

function migrate(db) {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let step = version; step < MIGRATIONS.length; step++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[step]);
      db.exec(`PRAGMA user_version = ${step + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

function ciscoToApi(row) {
  return {
    serial: row.serial,
    status: row.status,
    pid: row.pid,
    basePid: row.base_pid,
    productName: row.product_name,
    series: row.series,
    type: row.type,
    category: row.category,
    releaseDate: row.release_date,
    supportPage: row.support_page,
    error: row.error,
    lookedUpAt: row.looked_up_at,
  };
}

function dellToApi(row) {
  return {
    serviceTag: row.service_tag,
    status: row.status,
    model: row.model,
    productLine: row.product_line,
    systemDescription: row.system_description,
    productFamily: row.product_family,
    shipDate: row.ship_date,
    warrantyStart: row.warranty_start,
    warrantyEnd: row.warranty_end,
    warrantyService: row.warranty_service,
    entitlements: row.entitlements_json ? JSON.parse(row.entitlements_json) : [],
    cpu: row.cpu,
    ram: row.ram,
    storage: row.storage,
    gpu: row.gpu,
    os: row.os,
    formFactor: row.form_factor,
    error: row.error,
    lookedUpAt: row.looked_up_at,
  };
}

function sessionToApi(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    total: row.total,
    uniqueCodes: row.unique_codes,
    lastScanAt: row.last_scan_at,
  };
}
