// CP437 (DOS Code Page 437) — the original IBM PC character set used by GW-BASIC.
// High bytes 0x80-0xFF map to Unicode block-drawing, Latin, Greek, and math symbols.
// 0x00-0x7F pass through as ASCII (0x00/0x20 → space, control chars skipped).

const CP437 = [
  // 0x80
  'Ç','ü','é','â','ä','à','å','ç','ê','ë','è','ï','î','ì','Ä','Å',
  // 0x90
  'É','æ','Æ','ô','ö','ò','û','ù','ÿ','Ö','Ü','¢','£','¥','₧','ƒ',
  // 0xA0
  'á','í','ó','ú','ñ','Ñ','ª','º','¿','⌐','¬','½','¼','¡','«','»',
  // 0xB0
  '░','▒','▓','│','┤','╡','╢','╖','╕','╣','║','╗','╝','╜','╛','┐',
  // 0xC0
  '└','┴','┬','├','─','┼','╞','╟','╚','╔','╩','╦','╠','═','╬','╧',
  // 0xD0
  '╨','╤','╥','╙','╘','╒','╓','╫','╪','┘','┌','█','▄','▌','▐','▀',
  // 0xE0
  'α','ß','Γ','π','Σ','σ','µ','τ','Φ','Θ','Ω','δ','∞','φ','ε','∩',
  // 0xF0
  '≡','±','≥','≤','⌠','⌡','÷','≈','°','∙','·','√','ⁿ','²','■',' ',
];

// Reverse map: Unicode char → byte value
const CP437_REV = {};
CP437.forEach((ch, i) => { CP437_REV[ch] = i + 0x80; });

function cp437Display(s) {
  let r = '';
  for (const ch of s) {
    const b = ch.charCodeAt(0);
    if (b === 0 || b === 0x20) { r += ' '; continue; }
    if (b < 0x20) continue;          // control chars: no glyph
    if (b < 0x80) { r += ch; continue; }
    r += CP437[b - 0x80] ?? ch;
  }
  return r;
}

function cp437Encode(u) {
  let r = '';
  for (const ch of u) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) r += String.fromCharCode(cp);
    else if (CP437_REV[ch] !== undefined) r += String.fromCharCode(CP437_REV[ch]);
    else r += '?';
  }
  return r;
}
