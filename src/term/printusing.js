// PRINT USING — numeric masks like "##,###,###.##", "####", "#####", "###".
// Covers the masks the CHQ screens use. (To be validated against those screens when ported.)
//
// Rules approximated from GW-BASIC: '#' = digit slot; integer part is right-justified and
// space-padded to the number of '#'s; ',' groups thousands; '.' fixes the fraction width.
// If the value overflows the integer slots, GW-BASIC prefixes '%' and prints the full number.

function printUsing(mask, value) {
  const hasComma = mask.includes(',');
  const clean = mask.replace(/,/g, '');
  const dot = clean.indexOf('.');
  const intSlots = (dot === -1 ? clean : clean.slice(0, dot)).split('').filter((c) => c === '#').length;
  const fracSlots = dot === -1 ? 0 : clean.slice(dot + 1).split('').filter((c) => c === '#').length;

  const neg = value < 0;
  const fixed = Math.abs(value).toFixed(fracSlots);
  let [ip, fp = ''] = fixed.split('.');

  if (hasComma) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let sign = neg ? '-' : '';
  let body = sign + ip;

  // field width = intSlots plus the commas those slots would carry
  const commaCount = hasComma ? Math.floor(Math.max(0, intSlots - 1) / 3) : 0;
  const width = intSlots + commaCount;

  let intPart;
  if (body.length > width) intPart = '%' + body;        // overflow marker
  else intPart = body.padStart(width, ' ');

  return fracSlots ? `${intPart}.${fp}` : intPart;
}

// Multi-field PRINT USING: walk the mask, formatting one value per numeric/string field.
// '#' runs → numeric field.  '$$...' → floating-dollar numeric.  '&' → full string.
// '\  \' (backslash + N spaces + backslash) → fixed N+2-char string.  '_x' → literal x.
function formatUsing(mask, values) {
  let out = '', vi = 0, i = 0;
  while (i < mask.length) {
    const c = mask[i];
    if (c === '_') { out += mask[i + 1] ?? ''; i += 2; continue; }
    // Floating dollar sign: $$[#,.]... — prefix result with '$', then format numerically
    if (c === '$' && mask[i + 1] === '$') {
      let j = i + 2, field = '';
      while (j < mask.length && '#,.'.includes(mask[j])) { field += mask[j]; j++; }
      const numStr = printUsing(field || '#', Number(values[vi++] ?? 0));
      out += '$' + numStr.trimStart();
      i = j; continue;
    }
    if (c === '#') {
      let j = i, field = '';
      while (j < mask.length && '#,.'.includes(mask[j])) { field += mask[j]; j++; }
      out += printUsing(field, Number(values[vi++] ?? 0));
      i = j; continue;
    }
    // Variable-length string field: '&' → full string value of next arg
    if (c === '&') { out += String(values[vi++] ?? ''); i++; continue; }
    // Fixed-length string field: '\' + spaces + '\' → left N+2 chars of next arg
    if (c === '\\') {
      let j = i + 1;
      while (j < mask.length && mask[j] === ' ') j++;
      if (j < mask.length && mask[j] === '\\') {
        const width = j - i + 1; // includes both backslashes
        const s = String(values[vi++] ?? '');
        out += s.length >= width ? s.slice(0, width) : s.padEnd(width, ' ');
        i = j + 1; continue;
      }
    }
    out += c; i++;
  }
  return out;
}
