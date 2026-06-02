// int16 little-endian — the GW-BASIC MKI$ / CVI codec.
// CHQ.DAT ID and CUSTOMER NO/SQ fields are 2-byte signed LE integers.

export function readInt16LE(bytes, offset = 0) {
  const v = bytes[offset] | (bytes[offset + 1] << 8);
  return v & 0x8000 ? v - 0x10000 : v; // sign-extend
}

export function writeInt16LE(value) {
  const v = value & 0xffff;
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
}
