// Packed ddmmyy dates. Stored as the integer DMY = dd*10000 + mm*100 + yy, held in an
// MBF single (see mbf.js). Logic ported from PASSWORD.BAS (310–490) and CHQ02.BAS (1150–1300).

// Year window (from the source): yy<10 → 200y, 10≤yy<80 → 20yy, else 19yy.
export function yearFromYY(yy) {
  if (yy < 10) return 2000 + yy;
  if (yy < 80) return 2000 + yy;
  return 1900 + yy;
}

// Split packed DMY into its parts. yy is the raw 2-digit value as stored.
export function unpackDMY(dmy) {
  const v = Math.round(dmy);
  const yy = v % 100;
  const mm = Math.floor(v / 100) % 100;
  const dd = Math.floor(v / 10000);
  return { dd, mm, yy, year: yearFromYY(yy) };
}

// Build packed DMY from parts (yy = 2-digit).
export function packDMY(dd, mm, yy) {
  return dd * 10000 + mm * 100 + yy;
}

// Format packed DMY as "dd/mm/yyyy". Returns '' for 0 / empty.
export function formatDMY(dmy) {
  const v = Math.round(dmy);
  if (!v) return '';
  const { dd, mm, year } = unpackDMY(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(dd)}/${p(mm)}/${year}`;
}

// Validity check incl. leap year (matches PASSWORD 410–490 / CHQ02 1220–1300).
// Leap rule in source is simply (yy MOD 4 == 0).
export function isValidDMY(dd, mm, yy) {
  if (mm === 0 || mm > 12 || dd === 0 || dd > 31) return false;
  if (mm === 2) {
    const leap = yy % 4 === 0;
    return dd <= (leap ? 29 : 28);
  }
  if ([1, 3, 5, 7, 8, 10, 12].includes(mm)) return dd <= 31;
  return dd <= 30;
}
