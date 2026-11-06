// The Analyze page's view of a session: one row per distinct code (capital
// and small letters ignored), with what was typed on the scan page and what
// Dell or Cisco knows about the service tag or serial found in the code.

import { serviceTagFrom } from '../public/service-tag.js';
import { ciscoSerialFrom, ciscoBuildDate } from '../public/cisco-serial.js';

// scans: rows from store.sessionScans(); getDellAsset(tag) / getCiscoAsset(serial) -> record or null.
export function buildAnalysis(scans, getDellAsset, getCiscoAsset = () => null) {
  const groups = new Map();
  for (const s of scans) {
    const key = s.code.toUpperCase();
    let g = groups.get(key);
    if (!g) {
      g = {
        code: s.code, timesScanned: 0, firstScanAt: s.created_at, lastScanAt: s.created_at,
        format: null, make: null, model: null, notes: [], location: null, scannedBy: null, methods: new Set(),
      };
      groups.set(key, g);
    }
    // Later scans win for single values; every distinct note is kept.
    g.timesScanned += 1;
    g.lastScanAt = s.created_at;
    g.methods.add(s.entry_method);
    if (s.barcode_format) g.format = s.barcode_format;
    if (s.make) g.make = s.make;
    if (s.model) g.model = s.model;
    if (s.location) g.location = s.location;
    if (s.scanned_by) g.scannedBy = s.scanned_by;
    if (s.notes && !g.notes.includes(s.notes)) g.notes.push(s.notes);
  }
  return [...groups.values()].map((g) => {
    const serviceTag = serviceTagFrom(g.code);
    const ciscoSerial = serviceTag ? null : ciscoSerialFrom(g.code);
    const dell = serviceTag ? getDellAsset(serviceTag) : null;
    const cisco = ciscoSerial ? getCiscoAsset(ciscoSerial) : null;
    const d = dell?.status === 'found' ? dell : null;
    const c = cisco?.status === 'found' ? cisco : null;
    // What the item is, from typed details first, then what Dell or Cisco said.
    const make = g.make ?? (d ? 'Dell' : ciscoSerial ? 'Cisco' : null);
    const model = d?.model ?? c?.pid ?? g.model;
    const description = d ? [d.systemDescription ?? d.model, d.productLine].filter(Boolean).join(', ') : c?.productName ?? null;
    return {
      ...g,
      methods: [...g.methods],
      notes: g.notes.join(' | ') || null,
      serviceTag,
      ciscoSerial,
      ciscoBuilt: ciscoSerial ? ciscoBuildDate(ciscoSerial) : null,
      dell,
      cisco,
      identified: { make, model: model ?? null, description },
    };
  });
}

// "Active" / "Expired" / "" for a warranty end date.
export function warrantyStatus(end, now = Date.now()) {
  if (!end) return '';
  return Date.parse(end) >= now ? 'Active' : 'Expired';
}
