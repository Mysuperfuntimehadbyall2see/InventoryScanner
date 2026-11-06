// Dell TechDirect API client: what Dell knows about one service tag.
// Uses Dell's TechDirect APIs (register an application at apis.dell.com).
//
//   1. OAuth2 client-credentials token (cached until shortly before expiry)
//   2. GET {apiBase}/asset-entitlements?servicetags=TAG  -> model, ship date, warranty
//   3. GET {apiBase}/asset-components?servicetag=TAG     -> factory parts list -> specs
//
// Credentials come from the environment (DELL_CLIENT_ID, DELL_CLIENT_SECRET,
// DELL_TOKEN_URL, DELL_API_BASE, optional DELL_TIMEOUT_MS), set in .env. They
// never reach the browser.

import { specsFromComponents } from './dell-specs.js';

export function dellConfigFromEnv(env = process.env) {
  return {
    clientId: env.DELL_CLIENT_ID ?? '',
    clientSecret: env.DELL_CLIENT_SECRET ?? '',
    tokenUrl: env.DELL_TOKEN_URL || 'https://apigtwb2c.us.dell.com/auth/oauth/v2/token',
    apiBase: env.DELL_API_BASE || 'https://apigtwb2c.us.dell.com/PROD/sbil/eapi/v5',
    timeoutMs: Number.parseInt(env.DELL_TIMEOUT_MS ?? '', 10) || 10_000,
  };
}

// "OPTIPLEX 7040" -> "OptiPlex 7040", "DELL PRECISION TOWER 5810" -> "Precision Tower 5810",
// "DELL EMC AX750" -> "EMC AX750", "POWEREDGE R740XD" -> "PowerEdge R740XD"
export function modelName(productLine) {
  return String(productLine ?? '')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\boptiplex\b/i, 'OptiPlex')
    .replace(/\bpoweredge\b/i, 'PowerEdge')
    .replace(/\bpowervault\b/i, 'PowerVault')
    .replace(/\b(xps|emc|hci)\b/gi, (w) => w.toUpperCase())
    .replace(/\b(?=[a-z]*\d)[a-z\d]+\b/gi, (w) => w.toUpperCase()) // part-number-like words: AX750, R740XD
    .replace(/\bin\b/i, 'in')
    .replace(/^Dell\s+/i, '')
    .trim();
}

// Warranty from the entitlements list: earliest start, latest end, and the
// service level of the entitlement that runs longest.
export function warrantyFrom(entitlements) {
  const list = (Array.isArray(entitlements) ? entitlements : [])
    .filter((e) => e && e.endDate)
    .map((e) => ({
      service: e.serviceLevelDescription ?? '',
      type: e.entitlementType ?? '',
      start: e.startDate ?? null,
      end: e.endDate,
    }));
  if (list.length === 0) return { start: null, end: null, service: null, list };
  const latest = list.reduce((a, b) => (Date.parse(b.end) > Date.parse(a.end) ? b : a));
  const starts = list.map((e) => e.start).filter(Boolean).sort();
  return { start: starts[0] ?? null, end: latest.end, service: latest.service, list };
}

export function createDellClient(config) {
  let token = null; // { value, expiresAt }
  const configured = Boolean(config.clientId && config.clientSecret && config.tokenUrl && config.apiBase);

  async function getToken(force = false) {
    if (!force && token && token.expiresAt > Date.now() + 30_000) return token.value;
    const res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'client_credentials',
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!res.ok) throw new Error(`Dell sign-in failed (HTTP ${res.status})`);
    const json = await res.json();
    token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 };
    return token.value;
  }

  // GET with the token; one retry with a fresh token if Dell says it expired.
  async function get(path) {
    for (const force of [false, true]) {
      const res = await fetch(`${config.apiBase}${path}`, {
        headers: { Authorization: `Bearer ${await getToken(force)}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (res.status === 401 && !force) continue;
      if (!res.ok) throw new Error(`Dell API answered HTTP ${res.status}`);
      return res.json();
    }
    throw new Error('Dell API refused the sign-in');
  }

  // Everything about one tag, as a flat record for the dell_assets table.
  // status: 'found', 'not_found' (Dell does not know the tag) or 'error'.
  // Never throws.
  async function lookup(tag) {
    const record = { serviceTag: tag, status: 'error', error: null };
    try {
      const rows = await get(`/asset-entitlements?servicetags=${encodeURIComponent(tag)}`);
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row || row.invalid) return { ...record, status: 'not_found' };
      const warranty = warrantyFrom(row.entitlements);
      Object.assign(record, {
        status: 'found',
        model: modelName(row.productLineDescription),
        productLine: (row.productLobDescription ?? '').trim() || null,
        systemDescription: (row.systemDescription ?? '').trim() || null,
        productFamily: row.productFamily || null,
        shipDate: row.shipDate || null,
        warrantyStart: warranty.start,
        warrantyEnd: warranty.end,
        warrantyService: warranty.service,
        entitlements: warranty.list,
      });
    } catch (err) {
      return { ...record, error: err.message };
    }
    // The parts list is a second, slower call; if it fails the model and
    // warranty above are still worth keeping.
    try {
      const payload = await get(`/asset-components?servicetag=${encodeURIComponent(tag)}`);
      if (payload && Array.isArray(payload.components) && payload.components.length) {
        const s = specsFromComponents(payload);
        Object.assign(record, {
          cpu: s.cpu || null, ram: s.ram || null, storage: s.storage || null,
          gpu: s.gpu || null, os: s.os || null, formFactor: s.form_factor || null,
        });
        if (s.system_description) record.systemDescription = s.system_description;
      }
    } catch (err) {
      record.error = `Specs not available: ${err.message}`;
    }
    return record;
  }

  // Looks up several tags, two at a time (gentle on Dell's API).
  async function lookupMany(tags, concurrency = 2) {
    const results = [];
    let next = 0;
    const worker = async () => {
      while (next < tags.length) {
        const tag = tags[next++];
        results.push(await lookup(tag));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, tags.length) }, worker));
    return results;
  }

  return { configured, lookup, lookupMany };
}
