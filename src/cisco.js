// Cisco Support API client: Product Information, by serial number.
//
//   1. OAuth2 client-credentials token from Cisco's identity service
//   2. GET {apiBase}/product/v1/information/serial_numbers/{sn,sn,...}  (up to 5)
//      -> per serial: product name (a plain-English description), orderable
//         and base product IDs, series, type, category, release date
//
// Access needs an app in the Cisco API Console (apiconsole.cisco.com) with the
// "Product Information" Support API. Credentials come from the environment
// (CISCO_CLIENT_ID, CISCO_CLIENT_SECRET; optional CISCO_TOKEN_URL,
// CISCO_API_BASE, CISCO_TIMEOUT_MS). They never reach the browser.
// Field names follow Cisco's published sample response; each is read
// defensively, because only a live key can confirm the exact shape.

export const CISCO_BATCH = 5; // serials per API call, Cisco's documented maximum

export function ciscoConfigFromEnv(env = process.env) {
  return {
    clientId: env.CISCO_CLIENT_ID ?? '',
    clientSecret: env.CISCO_CLIENT_SECRET ?? '',
    tokenUrl: env.CISCO_TOKEN_URL || 'https://id.cisco.com/oauth2/default/v1/token',
    apiBase: env.CISCO_API_BASE || 'https://apix.cisco.com',
    timeoutMs: Number.parseInt(env.CISCO_TIMEOUT_MS ?? '', 10) || 15_000,
  };
}

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// One entry of Cisco's product_list -> a flat record for the cisco_assets table.
export function recordFromProductInfo(serial, entry) {
  if (!entry || entry.ErrorResponse || entry.error) return { serial, status: 'not_found', error: null };
  const record = {
    serial,
    status: 'found',
    pid: text(entry.orderable_pid) ?? text(entry.base_pid),
    basePid: text(entry.base_pid),
    productName: text(entry.product_name),
    series: text(entry.product_series),
    type: text(entry.product_type),
    category: text(entry.product_category),
    releaseDate: typeof entry.release_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(entry.release_date)
      ? entry.release_date.slice(0, 10) : null,
    supportPage: text(entry.product_support_page),
    error: null,
  };
  if (!record.pid && !record.productName) return { serial, status: 'not_found', error: null };
  return record;
}

export function createCiscoClient(config) {
  let token = null; // { value, expiresAt }
  const configured = Boolean(config.clientId && config.clientSecret && config.tokenUrl && config.apiBase);

  async function getToken(force = false) {
    if (!force && token && token.expiresAt > Date.now() + 30_000) return token.value;
    const res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.clientSecret,
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!res.ok) throw new Error(`Cisco sign-in failed (HTTP ${res.status})`);
    const json = await res.json();
    token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 };
    return token.value;
  }

  // One API call for up to CISCO_BATCH serials. Never throws: on failure
  // every serial in the batch comes back with status 'error'.
  async function lookupBatch(serials) {
    try {
      const path = `/product/v1/information/serial_numbers/${serials.map(encodeURIComponent).join(',')}`;
      for (const force of [false, true]) {
        const res = await fetch(`${config.apiBase}${path}`, {
          headers: { Authorization: `Bearer ${await getToken(force)}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(config.timeoutMs),
        });
        if (res.status === 401 && !force) continue;
        if (!res.ok) throw new Error(`Cisco API answered HTTP ${res.status}`);
        const body = await res.json();
        const bySerial = new Map((body.product_list ?? []).map((e) => [String(e.sr_no ?? '').toUpperCase(), e]));
        return serials.map((serial) => recordFromProductInfo(serial, bySerial.get(serial)));
      }
      throw new Error('Cisco API refused the sign-in');
    } catch (err) {
      return serials.map((serial) => ({ serial, status: 'error', error: err.message }));
    }
  }

  async function lookupMany(serials) {
    const results = [];
    for (let i = 0; i < serials.length; i += CISCO_BATCH) {
      results.push(...await lookupBatch(serials.slice(i, i + CISCO_BATCH)));
    }
    return results;
  }

  return { configured, lookupMany };
}
