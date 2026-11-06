// Recognises a Cisco serial number in a scanned code. Used by the server
// (Cisco lookups) and the Analyze page.
//
// Cisco hardware serials are 11 characters, LLLYYWWSSSS:
//   LLL   3 letters, the factory (FOC, FDO, JAE, SAL, ...)
//   YY    2 digits, year built, counted from 1996 (16 = 2012)
//   WW    2 digits, week of that year (01-53)
//   SSSS  4 letters or digits, the unit
// e.g. FOC1632X0AB = built in week 32 of 2012. Labels sometimes print
// "S/N" or "SN:" in front; that is ignored.

const SERIAL = /^(?:S\/?N[:\s]*)?([A-Z]{3})(\d{2})(\d{2})([A-Z0-9]{4})$/i;

// The serial in capitals, or null.
export function ciscoSerialFrom(code, now = new Date()) {
  if (typeof code !== 'string') return null;
  const m = SERIAL.exec(code.trim());
  if (!m) return null;
  const year = 1996 + Number(m[2]);
  const week = Number(m[3]);
  if (week < 1 || week > 53 || year > now.getUTCFullYear()) return null;
  return `${m[1]}${m[2]}${m[3]}${m[4]}`.toUpperCase();
}

// {year, week} the unit was built, from its serial, or null.
export function ciscoBuildDate(serial) {
  const m = /^[A-Z]{3}(\d{2})(\d{2})[A-Z0-9]{4}$/i.exec(serial ?? '');
  return m ? { year: 1996 + Number(m[1]), week: Number(m[2]) } : null;
}
