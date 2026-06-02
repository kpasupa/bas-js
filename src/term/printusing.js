// PRINT USING — numeric masks like "##,###,###.##", "####", "#####", "###".
// Covers the masks the CHQ screens use. (To be validated against those screens when ported.)
//
// Rules approximated from GW-BASIC: '#' = digit slot; integer part is right-justified and
// space-padded to the number of '#'s; ',' groups thousands; '.' fixes the fraction width.
// If the value overflows the integer slots, GW-BASIC prefixes '%' and prints the full number.

export function printUsing(mask, value) {
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

// Multi-field PRINT USING: walk the mask, formatting one value per numeric field ('#'-run)
// and emitting literals as-is. '_' escapes the next char as a literal. Used by the
// interpreter for masks like "##_/##_/##";PDD;PMM;PYY -> "31/ 5/26".
export function formatUsing(mask, values) {
  let out = '', vi = 0, i = 0;
  while (i < mask.length) {
    const c = mask[i];
    if (c === '_') { out += mask[i + 1] ?? ''; i += 2; continue; }
    if (c === '#') {
      let j = i, field = '';
      while (j < mask.length && '#,.'.includes(mask[j])) { field += mask[j]; j++; }
      out += printUsing(field, Number(values[vi++] ?? 0));
      i = j; continue;
    }
    out += c; i++;
  }
  return out;
}
