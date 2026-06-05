// MBF (Microsoft Binary Format) — GW-BASIC MKS$/MKD$ (encode) and CVS/CVD (decode).
// NOT IEEE 754. Exponent bias 128, implicit leading mantissa 1, exponent in the LAST
// byte, sign in the top bit of the byte before it.
//
// Verified against the real CHQ.DAT (28,729 records, see reference/mbf-roundtrip-test.py):
//   - floatToMbfSingle round-trips dates (integer ddmmyy) 100% byte-exact.
//   - For 8-byte amounts, encode from the DECIMAL value (encodeMbfDoubleDecimal), not from a
//     JS Number: MBF double's 56-bit mantissa exceeds IEEE-754's 53-bit, so a Number can't
//     carry the low ~3 bits. The exact-decimal encoder matches 99.96% of stored amounts; the
//     rest are source values with >2 decimal places. The data/write layer additionally
//     preserves original bytes for any field the user did not edit.

// ─── Decoders ────────────────────────────────────────────────────────────────
function mbfSingleToFloat(b) {
  const exponent = b[3];
  if (exponent === 0) return 0;
  const sign = b[2] & 0x80 ? 1 : 0;
  const mantissa = 0x800000 | ((b[2] & 0x7f) << 16) | (b[1] << 8) | b[0];
  const value = (mantissa / 16777216) * Math.pow(2, exponent - 128);
  return sign ? -value : value;
}

function mbfDoubleToFloat(b) {
  const exponent = b[7];
  if (exponent === 0) return 0;
  const sign = b[6] & 0x80 ? 1 : 0;
  const m =
    0x80000000000000n |
    (BigInt(b[6] & 0x7f) << 48n) |
    (BigInt(b[5]) << 40n) | (BigInt(b[4]) << 32n) |
    (BigInt(b[3]) << 24n) | (BigInt(b[2]) << 16n) |
    (BigInt(b[1]) << 8n) | BigInt(b[0]);
  const value = (Number(m) / Math.pow(2, 56)) * Math.pow(2, exponent - 128);
  return sign ? -value : value;
}

// ─── frexp: value = m * 2^e, with m in [0.5, 1) ──────────────────────────────
function frexp(value) {
  if (value === 0 || !isFinite(value)) return [value, 0];
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, value);
  let bits = (dv.getUint32(0) >>> 20) & 0x7ff;
  if (bits === 0) {
    // subnormal: normalize first
    dv.setFloat64(0, value * Math.pow(2, 64));
    bits = ((dv.getUint32(0) >>> 20) & 0x7ff) - 64;
  }
  const e = bits - 1022;
  return [value / Math.pow(2, e), e];
}

// ─── Single encoder (4 bytes) — exact inverse; lossless for integer dates ────
function floatToMbfSingle(value) {
  if (value === 0) return new Uint8Array(4);
  const sign = value < 0 ? 0x80 : 0;
  let [m, e] = frexp(Math.abs(value)); // value = m * 2^e, m in [0.5,1)
  let exponent = e + 128;
  let mantissa = Math.round(m * (1 << 24)); // 24-bit, top bit set
  if (mantissa === 1 << 24) { mantissa >>= 1; exponent += 1; }
  if (exponent < 1 || exponent > 255) throw new RangeError(`MBF single exponent ${exponent}`);
  mantissa &= 0x7fffff; // strip implicit leading 1
  return new Uint8Array([
    mantissa & 0xff,
    (mantissa >> 8) & 0xff,
    ((mantissa >> 16) & 0x7f) | sign,
    exponent,
  ]);
}

// ─── Double encoder (8 bytes), exact-decimal via BigInt ──────────────────────
// Encodes from the integer numerator/denominator of an exact decimal, finding the
// nearest MBF double with full 56-bit mantissa precision (round half to even).
function mbfDoubleFromRational(numerator, denominator) {
  if (numerator === 0n) return new Uint8Array(8);
  const sign = numerator < 0n ? 0x80 : 0;
  let num = numerator < 0n ? -numerator : numerator;
  const den = denominator;

  // Find p with 2^(p-1) <= num/den < 2^p. Works for p < 0 too (values below 1): compare
  // num vs den*2^p by shifting whichever side keeps both operands integers.
  let p = num.toString(2).length - den.toString(2).length;
  const ge = (k) => { // is num/den >= 2^k ?  (num >= den*2^k)
    return k >= 0 ? num >= (den << BigInt(k)) : (num << BigInt(-k)) >= den;
  };
  while (ge(p)) p += 1;       // raise until 2^p > num/den
  while (!ge(p - 1)) p -= 1;  // lower until 2^(p-1) <= num/den

  // mantissa = round( (num/den) / 2^p * 2^56 ) = round( num * 2^(56-p) / den )
  const shift = 56 - p;
  let topNum, topDen;
  if (shift >= 0) { topNum = num << BigInt(shift); topDen = den; }
  else { topNum = num; topDen = den << BigInt(-shift); }
  let mant = topNum / topDen;
  const rem = topNum - mant * topDen;
  const twice = rem * 2n;
  if (twice > topDen || (twice === topDen && (mant & 1n) === 1n)) mant += 1n; // half to even

  let exponent = p + 128;
  if (mant === 1n << 56n) { mant >>= 1n; exponent += 1; }
  if (exponent < 1 || exponent > 255) throw new RangeError(`MBF double exponent ${exponent}`);
  mant &= 0x7fffffffffffffn; // strip implicit leading 1 (bit 55)

  const out = new Uint8Array(8);
  for (let i = 0; i < 6; i++) out[i] = Number((mant >> BigInt(8 * i)) & 0xffn);
  out[6] = Number((mant >> 48n) & 0x7fn) | sign;
  out[7] = exponent;
  return out;
}

// Parse a decimal string ("-1,234,567.89" / "945890.712") to {num, den} integers.
function decimalToRational(text) {
  let s = String(text).trim().replace(/,/g, '');
  let sign = 1n;
  if (s[0] === '+') s = s.slice(1);
  else if (s[0] === '-') { sign = -1n; s = s.slice(1); }
  const [intPart, fracPart = ''] = s.split('.');
  const digits = (intPart || '0') + fracPart;
  const num = sign * BigInt(digits || '0');
  const den = 10n ** BigInt(fracPart.length);
  return { num, den };
}

// Primary amount encoder. Accepts a decimal string (preferred — the user's typed text)
// or a JS number (converted via its shortest round-trip decimal).
function encodeMbfDoubleDecimal(value) {
  const text = typeof value === 'number' ? value.toString() : value;
  const { num, den } = decimalToRational(text);
  return mbfDoubleFromRational(num, den);
}

