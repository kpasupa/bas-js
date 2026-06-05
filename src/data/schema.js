// Record schemas + parse/patch for CUSTOMER (50B) and CHQ.DAT (58B).
//
// patch*() implements the preserve-unchanged-bytes rule: it clones the ORIGINAL record
// bytes and overwrites only the fields present in the patch. Untouched fields (notably
// AMT, whose low mantissa bits can't survive a JS Number round-trip) keep their exact
// original bytes — so editing one field never perturbs the others.


const ascii = (bytes) => String.fromCharCode(...bytes).replace(/\0/g, ' ').trimEnd();
const putAscii = (rec, off, len, str) => {
  for (let i = 0; i < len; i++) rec[off + i] = i < str.length ? str.charCodeAt(i) & 0xff : 0x20;
};
const putBytes = (rec, off, bytes) => rec.set(bytes, off);

// ─── CHQ.DAT (58 bytes) ──────────────────────────────────────────────────────
// ID@0(i16) KDAY@2(mbf single date) CHNO@6(8 ascii) DES@14(30 ku42)
// DUE@44(mbf single date) AMT@48(mbf double) FLG@56(2 ascii)
function parseChq(rec) {
  const kdayDmy = Math.round(mbfSingleToFloat(rec.subarray(2, 6)));
  const dueDmy = Math.round(mbfSingleToFloat(rec.subarray(44, 48)));
  return {
    id: readInt16LE(rec, 0),
    kday: kdayDmy, kdayText: formatDMY(kdayDmy),
    chno: ascii(rec.subarray(6, 14)),
    des: decodeKU42(rec.subarray(14, 44)),
    due: dueDmy, dueText: formatDMY(dueDmy),
    amt: mbfDoubleToFloat(rec.subarray(48, 56)),
    flg: ascii(rec.subarray(56, 58)),
    raw: rec.slice(),
  };
}

// patch keys: id (int) | kday/due ({dd,mm,yy} or packed int) | chno (str) | des (str)
//             | amt (decimal string — preferred — or number) | flg (str)
function patchChq(original, patch) {
  const rec = original.slice(0, CHQ_SIZE);
  if ('id' in patch) putBytes(rec, 0, writeInt16LE(patch.id));
  if ('kday' in patch) putBytes(rec, 2, floatToMbfSingle(toDMY(patch.kday)));
  if ('chno' in patch) putAscii(rec, 6, 8, patch.chno);
  if ('des' in patch) putBytes(rec, 14, encodeKU42(patch.des, 30));
  if ('due' in patch) putBytes(rec, 44, floatToMbfSingle(toDMY(patch.due)));
  if ('amt' in patch) putBytes(rec, 48, encodeMbfDoubleDecimal(patch.amt));
  if ('flg' in patch) putAscii(rec, 56, 2, patch.flg);
  return rec;
}

// Build a fresh CHQ record from scratch (new cheque entry — CHQ02).
function buildChq({ id, kday, chno, des, due, amt, flg = 'AA' }) {
  return patchChq(new Uint8Array(CHQ_SIZE), { id, kday, chno, des, due, amt, flg });
}

const toDMY = (v) => (typeof v === 'object' ? packDMY(v.dd, v.mm, v.yy) : v);

// ─── CUSTOMER (50 bytes) ─────────────────────────────────────────────────────
// NO@0(i16) NM@2(40 ku42) FG@42(2 ascii) SQ@44(i16) RS@46(4 reserved)
function parseCustomer(rec) {
  return {
    no: readInt16LE(rec, 0),
    name: decodeKU42(rec.subarray(2, 42)),
    flag: ascii(rec.subarray(42, 44)),
    seq: readInt16LE(rec, 44),
    raw: rec.slice(),
  };
}

// patch keys: no (int) | name (str) | flag (str) | seq (int)
function patchCustomer(original, patch) {
  const rec = original.slice(0, CUSTOMER_SIZE);
  if ('no' in patch) putBytes(rec, 0, writeInt16LE(patch.no));
  if ('name' in patch) putBytes(rec, 2, encodeKU42(patch.name, 40));
  if ('flag' in patch) putAscii(rec, 42, 2, patch.flag);
  if ('seq' in patch) putBytes(rec, 44, writeInt16LE(patch.seq));
  return rec;
}
