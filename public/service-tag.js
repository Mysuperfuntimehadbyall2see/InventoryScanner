// Finds a Dell service tag in a scanned code. Used by the server (Dell
// lookups) and by the Analyze page. A Dell service tag is 7 letters and
// digits, for example 7XK2Q93. It can turn up three ways:
//   - the code itself:                     7XK2Q93
//   - the end of the QR code on the label: https://www.dell.com/support/.../servicetag/7XK2Q93
//                                          (also ?servicetag=7XK2Q93 and qrl.dell.com/7XK2Q93)
//   - the Serial field of a GS1 code:      (01)00884116312345(21)7XK2Q93
// Returns the tag in capitals, or null.

const TAG = /^[A-Z0-9]{7}$/i;

export function serviceTagFrom(code) {
  if (typeof code !== 'string') return null;
  const text = code.trim();
  if (TAG.test(text)) return /[A-Z]/i.test(text) ? text.toUpperCase() : null; // all digits: an asset number, not a tag
  const url = /(?:servicetag[/=]|qrl\.dell\.com\/)([A-Z0-9]{7})(?![A-Z0-9])/i.exec(text);
  if (url && /dell\.com/i.test(text)) return url[1].toUpperCase();
  const gs1Serial = /\(21\)([A-Z0-9]{7})(?:\(|$)/i.exec(text);
  if (gs1Serial && /[A-Z]/i.test(gs1Serial[1])) return gs1Serial[1].toUpperCase();
  return null;
}
