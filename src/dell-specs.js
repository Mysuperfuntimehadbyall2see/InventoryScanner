// Turns Dell's asset-components parts list into CPU / RAM / storage / GPU /
// OS / form factor. Written for an earlier internal project and tested
// against real machines' parts lists.
//
// 2026-11-06: storage sizes
// with a decimal point ("SSDR,3.8T", "HD,8.0T", seen on a Dell EMC AX750)
// were cut at the point and read as 3GB / 8GB, and a part row's quantity
// ("6 x HD,8TB") was ignored. Both mainly affect servers.
/**
 * Turns Dell's asset-components bill of materials into the handful of specs
 * a buyer actually cares about (CPU / RAM / storage / GPU / OS).
 *
 * The endpoint returns the factory parts list for one service tag — 100-150
 * rows of screws, labels, driver SKUs and placeholders, with the interesting
 * hardware buried in Dell's internal part shorthand:
 *
 *   Processor,CFL-S,I5-8500T,2.1G,35W,...      -> Intel Core i5-8500T 2.1GHz
 *   Dual In-Line Memory Module,8GB,2667,...    -> 8GB (summed over all DIMMs)
 *   PWA,PLN,U,V5-1145G7,8GWW,7X,V2             -> soldered CPU + RAM on the board
 *   SSDR,256G,P34,30S3,WDC,SN530               -> 256GB SSD
 *   Hard Drive,500,S3,7.2,512E,7,AQUACSLIM     -> 500GB HDD
 *   DPK,WIN10,PRO                              -> Windows 10 Pro
 *
 * Everything here is deliberately conservative: a field is only filled in
 * when a part clearly says so, because a wrong spec on a listing is worse
 * than a blank one. Anything not recognized is simply left empty for the
 * offline catalog guess (or an admin) to fill in.
 *
 * These describe the unit whose tag was looked up. Since the store sells by
 * model, they are stored on the model, as that model's representative
 * configuration — which is what every listing's "approximate, not
 * guaranteed" notice already covers.
 */

/**
 * Dell writes the CPU several different ways depending on where it lives:
 *   PRC,I5-9500T,CFL-SR,2.2,6C,35W        desktop, socketed
 *   ASSY,BASE,UMA,I5-8250U,3590,V2        laptop, soldered to the base
 *   ASSY,PWA,PLN,I5-1130G7,8,7320D        laptop, on the planar
 *   PWA,PLN,U,V5-1145G7,8GWW,7X,V2        same, vPro (V instead of I)
 *   ASSY,BASE,BTI5-5200U,UMA,3550         same again, with a platform prefix
 */
const CPU_RE = /(?:^|[,\s])[A-Z]{0,2}[IV]([3579])-(\d{4,5}(?:[A-Z]{1,2}\d?)?)\b/;
/**
 * Dell sometimes abbreviates the part number to three digits — the 7390's
 * planar reads "I5-825U", and no such Intel SKU exists (it's an 8250U or an
 * 8265U, and nothing in the parts list says which). Expanding it would mean
 * printing an invented part number on a listing, so a match here is used
 * only for the series letter, and the exact number is left unclaimed.
 */
const CPU_SHORT_RE = /(?:^|[,\s])[A-Z]{0,2}[IV]([3579])-(\d{3})([A-Z])\b/;
/** Xeons are written without separators: "Processor,E51620V3,3.5,10M,HSL,R2". */
const XEON_RE = /\b(E[357])-?(\d{4})\s*(?:V(\d))?\b/i;
/** The Intel case badge, a reliable last resort: LBL,INTEL,CI5,8,SML / CI5EVO,11 / CI5,VPRO,8 */
const CPU_LABEL_RE = /^LBL,\s*INTEL,\s*C(?:I([3579]))(EVO)?(?:,\s*(VPRO))?,\s*(\d{1,2})\b/i;

function ordinal(n) {
  const v = parseInt(n, 10);
  const s = ['th', 'st', 'nd', 'rd'][(v % 100 - v % 10 !== 10) ? Math.min(v % 10, 4) % 4 : 0];
  return `${v}${s || 'th'}`;
}

/** @returns {{cpu: string, part: object|null}} the CPU and the part it came from (parseRam reuses it). */
function parseCpu(parts) {
  // Sockets first (PRC / Processor), then anywhere else — laptop CPUs are
  // only ever named on the base or planar assembly they're soldered to.
  const isProcessorPart = (p) => /^(prc|processor)\b/i.test(p.desc);
  const ordered = [...parts.filter(isProcessorPart), ...parts.filter((p) => !isProcessorPart(p))];

  for (const p of ordered) {
    const m = CPU_RE.exec(p.desc);
    if (!m) continue;
    return { cpu: `Intel Core i${m[1]}-${m[2]}${ghzFrom(p.desc)}`, part: p };
  }

  for (const p of parts) {
    if (!isProcessorPart(p)) continue;
    if (/xeon/i.test(p.desc) || XEON_RE.test(p.desc)) {
      const x = XEON_RE.exec(p.desc);
      const name = x ? ` ${x[1].toUpperCase()}-${x[2]}${x[3] ? ` v${x[3]}` : ''}` : '';
      return { cpu: `Intel Xeon${name}${ghzFrom(p.desc)}`, part: p };
    }
    if (/celeron/i.test(p.desc)) return { cpu: 'Intel Celeron', part: p };
    if (/pentium/i.test(p.desc)) return { cpu: 'Intel Pentium', part: p };
    if (/ryzen/i.test(p.desc)) return { cpu: 'AMD Ryzen', part: p };
  }

  // No part names the exact chip. Say what is actually known — family,
  // generation, and the series letter when an abbreviated part number gives
  // it away — rather than guessing at the digits Dell left out.
  const short = parts.map((p) => CPU_SHORT_RE.exec(p.desc)).find(Boolean);
  const shortPart = short ? parts.find((p) => CPU_SHORT_RE.test(p.desc)) : null;
  for (const p of parts) {
    if (/^LBL,\s*INTEL,\s*XMN\b/i.test(p.desc)) return { cpu: 'Intel Xeon', part: p };
    const m = CPU_LABEL_RE.exec(p.desc);
    if (!m) continue;
    const bits = [`Intel Core i${m[1]}`];
    if (m[3]) bits.push('vPro');
    if (m[2]) bits.push('Evo');
    const detail = [`${ordinal(m[4])} gen`];
    if (short && short[1] === m[1]) detail.push(`${short[3].toUpperCase()}-series`);
    return { cpu: `${bits.join(' ')} (${detail.join(', ')})`, part: shortPart };
  }
  return { cpu: '', part: null };
}

/** Clock speed as Dell writes it in a processor part: ",2.1G," or ",3.5,". */
function ghzFrom(desc) {
  const m = /,(\d\.\d)G?,/.exec(desc);
  return m ? ` ${m[1]}GHz` : '';
}

function parseRam(parts, cpuPart) {
  // Real DIMMs, summed — a machine with 2x8GB should read 16GB.
  let gb = 0;
  for (const p of parts) {
    if (!/^dual in-line memory module|^dimm\b|,DDR[345],/i.test(p.desc)) continue;
    const m = /,(\d+)\s*GB?,/i.exec(p.desc) || /^[^,]*,(\d+)GB/i.exec(p.desc);
    if (m) gb += parseInt(m[1], 10) * Math.max(1, p.qty || 1);
  }
  if (gb > 0) return `${gb}GB`;
  // Soldered memory has no part of its own: it's the field right after the
  // CPU on whichever assembly carries it — I5-1130G7,8 / I5V,8G / V5-1145G7,8GWW.
  // Scan the CPU's own part first, then anything else shaped the same way,
  // since the badge-only CPU fallback doesn't hand us a part to look at.
  for (const p of [cpuPart, ...parts].filter(Boolean)) {
    const fields = p.desc.split(',');
    const at = fields.findIndex((f) => CPU_RE.test(f) || /^[A-Z]{0,2}I[3579]V$/i.test(f.trim()));
    if (at < 0 || !fields[at + 1]) continue;
    const m = /^\s*(\d{1,3})\s*G(?:WW|B)?\s*$/i.exec(fields[at + 1]);
    if (m) return `${parseInt(m[1], 10)}GB`;
  }
  // Last resort: the factory memory note some laptops carry instead.
  for (const p of parts) {
    const m = /^INFO,\s*INTEL,\s*(\d{1,3})G,\s*BASE\b/i.exec(p.desc);
    if (m) return `${parseInt(m[1], 10)}GB`;
  }
  return '';
}

function parseStorage(parts) {
  const drives = [];
  for (const p of parts) {
    const d = p.desc;
    let m;
    // The size unit is often omitted entirely (SSDR,256,P34 / Solid State
    // Drive,128,S3), so treat a bare number as GB.
    if ((m = /^(?:solid state drive|ssdr|ssd),\s*(\d+(?:\.\d+)?)\s*(G|GB|T|TB)?\b/i.exec(d))) {
      // 16GB/32GB "Optane" parts are a cache module, not the system drive.
      if (/OPTM|OPTANE/i.test(d) && parseInt(m[1], 10) <= 64) continue;
      for (let i = 0; i < Math.max(1, p.qty); i++) drives.push({ size: normSize(m[1], m[2]), kind: 'SSD' });
    } else if ((m = /^(?:hard drive|hdd|hd),\s*(\d+(?:\.\d+)?)\s*(G|GB|T|TB)?\b/i.exec(d))) {
      for (let i = 0; i < Math.max(1, p.qty); i++) drives.push({ size: normSize(m[1], m[2]), kind: 'HDD' });
    }
  }
  if (drives.length === 0) return '';
  // Dedupe identical drives into "2x 512GB SSD" rather than repeating them.
  const counts = new Map();
  for (const d of drives) {
    const key = `${d.size} ${d.kind}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].map(([key, n]) => (n > 1 ? `${n}x ${key}` : key)).join(' + ');
}

function normSize(n, unit) {
  const v = Number.parseFloat(n);
  if (/^t/i.test(unit || '')) return `${Number(v.toFixed(2))}TB`; // 8.0T -> 8TB, 3.84T -> 3.84TB
  return v >= 1000 && v % 1000 === 0 ? `${v / 1000}TB` : `${v}GB`;
}

function parseOs(parts) {
  // Only the digital product key part is trustworthy. Older machines also
  // carry legacy "Service Charge,Software, Windows 98 / XP" SKUs that have
  // nothing to do with what shipped on the unit.
  for (const p of parts) {
    const m = /\bDPK,\s*WIN(\d+)(?:,\s*(PRO|HOME|ENT[A-Z]*))?/i.exec(p.desc);
    if (m) {
      const edition = m[2] ? m[2].replace(/^PRO$/i, 'Pro').replace(/^HOME$/i, 'Home').replace(/^ENT.*/i, 'Enterprise') : '';
      return `Windows ${m[1]}${edition ? ` ${edition}` : ''}`;
    }
  }
  return '';
}

function parseGpu(parts) {
  for (const p of parts) {
    const d = p.desc;
    if (!/nvidia|quadro|geforce|radeon|firepro|\bvcard\b|card,\s*video/i.test(d)) continue;
    const q = /\b(QUADRO|GEFORCE|RADEON|FIREPRO)[,\s]+([A-Z]{0,2}\d{3,4}[A-Z]*)/i.exec(d);
    if (q) return `NVIDIA ${q[1].replace(/^QUADRO$/i, 'Quadro').replace(/^GEFORCE$/i, 'GeForce')} ${q[2]}`.replace(/^NVIDIA (Radeon|FIREPRO)/i, 'AMD $1');
    if (/nvidia|quadro|geforce/i.test(d)) return 'NVIDIA discrete graphics';
    if (/radeon|firepro/i.test(d)) return 'AMD discrete graphics';
  }
  return '';
}

/**
 * Dell's build names trail factory ordering jargon that means nothing to a
 * buyer: "OptiPlex 5060 Micro XCTO", "Precision 3240 Compact CTO BASE",
 * "Latitude 3550 : Standard Base (CTO)".
 */
function cleanSystemName(s) {
  return String(s || '')
    .replace(/\s*:\s*Standard Base\s*\(CTO\)\s*$/i, '')
    .replace(/\s+X?CTO(\s+BASE)?\s*$/i, '')
    .replace(/[,\s]+$/, '')
    .trim();
}

/** Rough "Micro / SFF / Tower / Laptop" read from the system description Dell puts on every part row. */
function parseFormFactor(systemDescription) {
  const s = String(systemDescription || '');
  if (/\bmicro\b/i.test(s)) return 'Micro';
  if (/\bsff\b|small form/i.test(s)) return 'Small Form Factor';
  if (/\btower\b|\bmt\b/i.test(s)) return 'Tower';
  if (/\baio\b|all[- ]in[- ]one/i.test(s)) return 'All-in-One';
  if (/laptop|notebook/i.test(s)) return 'Laptop';
  return '';
}

/**
 * @param {object} payload the asset-components response ({components: [...]})
 * @returns {{cpu,ram,storage,gpu,os,form_factor,system_description,part_count}}
 */
function specsFromComponents(payload) {
  const raw = (payload && payload.components) || [];
  const parts = raw.map((c) => ({
    desc: String(c.partDescription || '').trim(),
    qty: parseInt(c.partQuantity, 10) || 0,
    item: String(c.itemDescription || '').trim(),
  }))
    // partQuantity 0 rows are parts that were configured out of the build.
    .filter((p) => p.desc && p.qty > 0);

  const systemDescription = (raw.find((c) => c.itemDescription) || {}).itemDescription || '';
  const { cpu, part: cpuPart } = parseCpu(parts);
  return {
    cpu,
    ram: parseRam(parts, cpuPart),
    storage: parseStorage(parts),
    gpu: parseGpu(parts),
    os: parseOs(parts),
    form_factor: parseFormFactor(systemDescription),
    system_description: cleanSystemName(systemDescription),
    part_count: parts.length,
  };
}

export { specsFromComponents, parseFormFactor, cleanSystemName };
