// KU42 — the legacy single-byte Thai codepage used in CUSTOMER names and CHQ.DAT
// descriptions. NOT TIS-620. Table + encode/decode ported verbatim from
// reference/customer-rw-poc.html. Do not re-derive the table.

const KU42_TO_UTF8 = {};
// 9x: ๐๑๒๓๔๕๖๗๘๙ ฃ ฅ
['๐','๑','๒','๓','๔','๕','๖','๗','๘','๙','ฃ','ฅ']
  .forEach((c, i) => (KU42_TO_UTF8[0x90 + i] = c));
// Ax: (A0 empty) ก ข ค ฆ ง จ ฉ ช ซ ฌ ญ ฎ ฏ ฐ ฑ
[null,'ก','ข','ค','ฆ','ง','จ','ฉ','ช','ซ','ฌ','ญ','ฎ','ฏ','ฐ','ฑ']
  .forEach((c, i) => { if (c) KU42_TO_UTF8[0xa0 + i] = c; });
// Bx: ฒ ณ ด ต ถ ท ธ น บ ป ผ ฝ พ ฟ ภ ม
['ฒ','ณ','ด','ต','ถ','ท','ธ','น','บ','ป','ผ','ฝ','พ','ฟ','ภ','ม']
  .forEach((c, i) => (KU42_TO_UTF8[0xb0 + i] = c));
// Cx: ย ร ฤ ล ว ศ ษ ส ห ฬ อ ฮ ะ ฦ า ำ
['ย','ร','ฤ','ล','ว','ศ','ษ','ส','ห','ฬ','อ','ฮ','ะ','ฦ','า','ำ']
  .forEach((c, i) => (KU42_TO_UTF8[0xc0 + i] = c));
// Dx: เ แ โ ใ ไ ๆ ฯ ุ ู ิ ี ึ ื ั ํ ็
['เ','แ','โ','ใ','ไ','ๆ','ฯ','ุ','ู','ิ','ี','ึ','ื','ั','ํ','็']
  .forEach((c, i) => (KU42_TO_UTF8[0xd0 + i] = c));
// Ex: ่ ้ ๊ ๋ ์ ฺ
['่','้','๊','๋','์','ฺ']
  .forEach((c, i) => (KU42_TO_UTF8[0xe0 + i] = c));

const UTF8_TO_KU42 = {};
for (const [byte, char] of Object.entries(KU42_TO_UTF8)) {
  UTF8_TO_KU42[char] = parseInt(byte, 10);
}

export { KU42_TO_UTF8, UTF8_TO_KU42 };

// Decode KU42 bytes → UTF-8 string. 0x00/0x20/0xA0 → space (0xA0 is used in real
// CUSTOMER names as an inter-token space); <0x80 → ASCII.
// Unknown high bytes render as [xx] so corruption is visible, not silent.
export function decodeKU42(bytes) {
  let result = '';
  for (const b of bytes) {
    if (b === 0x00 || b === 0x20 || b === 0xa0) { result += ' '; continue; }
    if (b < 0x80) { result += String.fromCharCode(b); continue; }
    result += KU42_TO_UTF8[b] ?? `[${b.toString(16).padStart(2, '0')}]`;
  }
  return result.trimEnd();
}

// Encode a UTF-8 string → fixed-length KU42 byte field, space-padded (0x20).
// Iterates Unicode code points so Thai chars map correctly. Unknown → '?'.
export function encodeKU42(str, len = 40) {
  const out = new Uint8Array(len).fill(0x20);
  let pos = 0;
  for (const char of str) {
    if (pos >= len) break;
    const code = char.codePointAt(0);
    if (code < 0x80) out[pos++] = code;
    else if (UTF8_TO_KU42[char] !== undefined) out[pos++] = UTF8_TO_KU42[char];
    else out[pos++] = 0x3f; // '?'
  }
  return out;
}
