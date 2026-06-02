// Record addressing. BASIC random files are 1-based: record N is at byte (N-1)*size.

export const CUSTOMER_SIZE = 50;
export const CHQ_SIZE = 58;

// Byte offset of 1-based record N.
export function recordOffset(recNo, size) {
  return (recNo - 1) * size;
}

// CUSTOMER physical record (1-based) from an AR number.
// ARNO ∈ 101..5050, MN = floor(ARNO/100), SN = ARNO - MN*100 (must be 1..50),
// recordIndex = (MN-1)*50 + SN. Returns null if out of range (matches CHQ02 920–970).
export function arnoToRecord(arno) {
  if (arno < 101 || arno > 5050) return null;
  const mn = Math.floor(arno / 100);
  const sn = arno - mn * 100;
  if (sn <= 0 || sn > 50) return null;
  return (mn - 1) * 50 + sn;
}

// The cheque sequence counter lives in CUSTOMER record 2, field SQ (offset +44).
export const SEQ_RECORD = 2;
export const SEQ_FIELD_OFFSET = 44;
