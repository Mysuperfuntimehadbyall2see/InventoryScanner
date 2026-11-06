// GS1 barcodes (GS1-128, GS1 DataMatrix, GS1 QR Code) carry several fields in
// one code. Each field starts with an Application Identifier (AI) number. The
// decoder writes them in the human-readable form "(01)00884116312345(21)7XK2Q93".
// This file splits that form into named fields for display. The saved code is
// always the full text, unchanged.

const AI_NAMES = {
  '00': 'SSCC',
  '01': 'GTIN',
  '02': 'Contained GTIN',
  '10': 'Batch/lot',
  '11': 'Production date',
  '12': 'Due date',
  '13': 'Packaging date',
  '15': 'Best before',
  '16': 'Sell by',
  '17': 'Expiry date',
  '20': 'Variant',
  '21': 'Serial',
  '22': 'Consumer product variant',
  '235': 'Third-party serial',
  '240': 'Additional product ID',
  '241': 'Customer part no.',
  '242': 'Made-to-order variant',
  '250': 'Secondary serial',
  '251': 'Source entity reference',
  '30': 'Count',
  '37': 'Units contained',
  '400': 'Customer order no.',
  '401': 'Consignment no.',
  '402': 'Shipment ID',
  '403': 'Routing code',
  '410': 'Ship-to GLN',
  '414': 'Location GLN',
  '420': 'Ship-to postal code',
  '422': 'Country of origin',
  '7003': 'Expiry date and time',
  '8003': 'Returnable asset ID (GRAI)',
  '8004': 'Individual asset ID (GIAI)',
  '8006': 'Component ID',
  '90': 'Internal',
};

export function aiName(ai) {
  if (AI_NAMES[ai]) return AI_NAMES[ai];
  if (/^9[1-9]$/.test(ai)) return 'Company internal';
  if (/^3[1-6]\d\d$/.test(ai)) return 'Measure';
  return `AI ${ai}`;
}

const HRI = /^(?:\(\d{2,4}\)[^()]+)+$/;
const FIELD = /\((\d{2,4})\)([^()]+)/g;

// [{ai: '01', name: 'GTIN', value: '00884116312345'}, ...], or null when the
// text is not in the "(AI)value" form. (A value that itself contains
// brackets is legal in GS1 but rare; such codes are shown unsplit.)
export function parseGs1(text) {
  if (typeof text !== 'string' || !HRI.test(text)) return null;
  return [...text.matchAll(FIELD)].map(([, ai, value]) => ({ ai, name: aiName(ai), value }));
}

// "GTIN 00884116312345 · Serial 7XK2Q93"
export function describeGs1(fields) {
  return fields.map((f) => `${f.name} ${f.value}`).join(' · ');
}
