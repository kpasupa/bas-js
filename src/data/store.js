// Data store over the File System Access API. Holds a directory handle (persisted in
// IndexedDB) for CHQ.DAT / CUSTOMER sitting beside index.html.
//
// ⚠ Writes are per-record and in-place ONLY: seek to (recNo-1)*size and write exactly
// `size` bytes with keepExistingData:true. Never truncate or rewrite the whole file.
// (Mirrors GW-BASIC `PUT #n, recNo`.) This is the project's core fidelity guarantee.


// ─── tiny IndexedDB store for the directory handle ───────────────────────────
const IDB_NAME = 'cheque-js', IDB_STORE = 'handles', IDB_KEY = 'dataDir';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbSet(v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(IDB_STORE, 'readwrite'); t.objectStore(IDB_STORE).put(v, IDB_KEY); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function idbGet() { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(IDB_STORE, 'readonly'); const q = t.objectStore(IDB_STORE).get(IDB_KEY); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function idbDel() { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(IDB_STORE, 'readwrite'); t.objectStore(IDB_STORE).delete(IDB_KEY); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function idbGetKey(key) { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key); q.onsuccess = () => res(q.result ?? null); q.onerror = () => rej(q.error); }); }
async function idbSetKey(key, val) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(IDB_STORE, 'readwrite'); t.objectStore(IDB_STORE).put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); }); }

async function getProjects() { try { return (await idbGetKey('projects')) ?? []; } catch { return []; } }
async function saveProjects(list) { await idbSetKey('projects', list); }
async function setActiveProject(p) { await idbSetKey('active', p); }

let dirHandle = null;

function isConnected() { return dirHandle !== null; }
function folderName() { return dirHandle?.name ?? null; }
async function hasHandle() { try { return !!(await idbGet()); } catch { return false; } }

// Try to reconnect using the active project set by picker.html ({ handle, boot, name }).
// Returns boot filename if granted, null otherwise.
async function tryReconnectActive() {
  try {
    const active = await idbGetKey('active');
    if (!active?.handle) return null;
    if ((await active.handle.queryPermission({ mode: 'readwrite' })) === 'granted') {
      dirHandle = active.handle;
      return active.boot || 'PASSWORD';
    }
  } catch { /* fall through */ }
  return null;
}

// Try to reconnect silently from a saved handle (no user gesture). Returns true if granted.
async function tryReconnect(mode = 'readwrite') {
  let h;
  try { h = await idbGet(); } catch { h = null; }
  if (!h) return false;
  if ((await h.queryPermission({ mode })) === 'granted') { dirHandle = h; return true; }
  return false; // saved but needs a click to re-grant (requestPermission needs a gesture)
}

// Prompt the user to choose the data folder; persist it. Must be called from a user gesture.
async function pickFolder(mode = 'readwrite') {
  const orig = document.title.replace(/ - .+$/, '');
  document.title = orig + ' - Selecting';
  try {
    const h = await window.showDirectoryPicker({ mode });
    if ((await h.requestPermission({ mode })) !== 'granted') throw new Error('Permission denied');
    dirHandle = h;
    await idbSet(h);
    return h.name;
  } finally {
    document.title = orig;
  }
}

// Re-grant permission on a saved handle (from a user gesture) without re-picking.
async function regrant(mode = 'readwrite') {
  const h = dirHandle ?? (await idbGet());
  if (!h) return false;
  if ((await h.requestPermission({ mode })) === 'granted') { dirHandle = h; return true; }
  return false;
}

async function forget() { dirHandle = null; await idbDel(); }

function requireDir() {
  if (!dirHandle) throw new Error('No data folder connected — call pickFolder()/tryReconnect() first.');
  return dirHandle;
}

// Directory listing (uppercased, sorted) — backs the BASIC FILES command.
async function listFiles() {
  if (!dirHandle) return [];
  const names = [];
  for await (const entry of dirHandle.values()) if (entry.kind === 'file') names.push(entry.name.toUpperCase());
  return names.sort();
}

// Resolve a possibly-nested path ("DIR/SUB/FILE.BAS") to a file handle by walking subfolders.
// Flat names (no slash) behave exactly as before, so data files are unaffected.
async function fileHandleFor(name, create = false) {
  const parts = String(name).split(/[/\\]/).filter(Boolean);
  let dir = requireDir();
  for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i], create ? { create: true } : undefined);
  return dir.getFileHandle(parts[parts.length - 1], create ? { create: true } : undefined);
}

// ─── GW-BASIC binary detokenizer ─────────────────────────────────────────────
// GW-BASIC saves programs in a tokenized binary format (first byte 0xFF) when
// SAVE is used without ",A". This converts that back to ASCII so the existing
// interpreter handles it unchanged — no second code path needed.
const _GWT = {
  0x81:'END',    0x82:'FOR',    0x83:'NEXT',   0x84:'DATA',   0x85:'INPUT',
  0x86:'DIM',    0x87:'READ',   0x88:'LET',    0x89:'GOTO',   0x8A:'RUN',
  0x8B:'IF',     0x8C:'RESTORE',0x8D:'GOSUB',  0x8E:'RETURN', 0x8F:'REM',
  0x90:'STOP',   0x91:'PRINT',  0x92:'CLEAR',  0x93:'LIST',   0x94:'NEW',
  0x95:'ON',     0x96:'WAIT',   0x97:'DEF',    0x98:'POKE',   0x99:'CONT',
  0x9C:'OUT',    0x9D:'LPRINT', 0x9E:'LLIST',  0xA0:'WIDTH',  0xA1:'ELSE',
  0xA2:'TRON',   0xA3:'TROFF',  0xA4:'SWAP',   0xA5:'ERASE',  0xA6:'EDIT',
  0xA7:'ERROR',  0xA8:'RESUME', 0xA9:'DELETE', 0xAA:'AUTO',   0xAB:'RENUM',
  0xAC:'DEFSTR', 0xAD:'DEFINT', 0xAE:'DEFSNG', 0xAF:'DEFDBL', 0xB0:'LINE',
  0xB1:'WHILE',  0xB2:'WEND',   0xB3:'CALL',   0xB7:'WRITE',  0xB8:'OPTION',
  0xB9:'RANDOMIZE', 0xBA:'OPEN',0xBB:'CLOSE',  0xBC:'LOAD',   0xBD:'MERGE',
  0xBE:'SAVE',   0xBF:'COLOR',  0xC0:'CLS',    0xC1:'MOTOR',  0xC2:'BSAVE',
  0xC3:'BLOAD',  0xC4:'SOUND',  0xC5:'BEEP',   0xC6:'PSET',   0xC7:'PRESET',
  0xC8:'SCREEN', 0xC9:'KEY',    0xCA:'LOCATE', 0xCC:'TO',     0xCD:'THEN',
  0xCE:'TAB(',   0xCF:'STEP',   0xD0:'USR',    0xD1:'FN',     0xD2:'SPC(',
  0xD3:'NOT',    0xD4:'ERL',    0xD5:'ERR',    0xD6:'STRING$',0xD7:'USING',
  0xD8:'INSTR',  0xDA:'VARPTR', 0xDB:'CSRLIN', 0xDC:'POINT',  0xDD:'OFF',
  0xDE:'INKEY$', 0xE6:'>',      0xE7:'=',      0xE8:'<',      0xE9:'+',
  0xEA:'-',      0xEB:'*',      0xEC:'/',      0xED:'^',      0xEE:'AND',
  0xEF:'OR',     0xF0:'XOR',    0xF1:'EQV',    0xF2:'IMP',    0xF3:'MOD',
  0xF4:'\\',
  // FD-prefix: type-conversion functions
  0xFD81:'CVI',   0xFD82:'CVS',   0xFD83:'CVD',
  0xFD84:'MKI$',  0xFD85:'MKS$',  0xFD86:'MKD$',
  // FE-prefix: file / system / graphics commands
  0xFE81:'FILES',  0xFE82:'FIELD',  0xFE83:'SYSTEM', 0xFE84:'NAME',
  0xFE85:'LSET',   0xFE86:'RSET',   0xFE87:'KILL',   0xFE88:'PUT',
  0xFE89:'GET',    0xFE8A:'RESET',  0xFE8B:'COMMON', 0xFE8C:'CHAIN',
  0xFE8D:'DATE$',  0xFE8E:'TIME$',  0xFE8F:'PAINT',  0xFE90:'COM',
  0xFE91:'CIRCLE', 0xFE92:'DRAW',   0xFE93:'PLAY',   0xFE94:'TIMER',
  0xFE95:'ERDEV',  0xFE96:'IOCTL',  0xFE97:'CHDIR',  0xFE98:'MKDIR',
  0xFE99:'RMDIR',  0xFE9A:'SHELL',  0xFE9B:'ENVIRON',0xFE9C:'VIEW',
  0xFE9D:'WINDOW', 0xFE9E:'PMAP',   0xFE9F:'PALETTE',0xFEA0:'LCOPY',
  0xFEA1:'CALLS',  0xFEA5:'PCOPY',  0xFEA7:'LOCK',   0xFEA8:'UNLOCK',
  // FF-prefix: math and string functions
  0xFF81:'LEFT$',  0xFF82:'RIGHT$', 0xFF83:'MID$',   0xFF84:'SGN',
  0xFF85:'INT',    0xFF86:'ABS',    0xFF87:'SQR',    0xFF88:'RND',
  0xFF89:'SIN',    0xFF8A:'LOG',    0xFF8B:'EXP',    0xFF8C:'COS',
  0xFF8D:'TAN',    0xFF8E:'ATN',    0xFF8F:'FRE',    0xFF90:'INP',
  0xFF91:'POS',    0xFF92:'LEN',    0xFF93:'STR$',   0xFF94:'VAL',
  0xFF95:'ASC',    0xFF96:'CHR$',   0xFF97:'PEEK',   0xFF98:'SPACE$',
  0xFF99:'OCT$',   0xFF9A:'HEX$',   0xFF9B:'LPOS',   0xFF9C:'CINT',
  0xFF9D:'CSNG',   0xFF9E:'CDBL',   0xFF9F:'FIX',    0xFFA0:'PEN',
  0xFFA1:'STICK',  0xFFA2:'STRIG',  0xFFA3:'EOF',    0xFFA4:'LOC',
  0xFFA5:'LOF',
};

// Canonize number string to GW-BASIC style: 0.5→.5  8.0→8  uppercase E
function _gwNum(s) { return s.replace(/^(-?)0\./, '$1.').replace(/\.0$/, '').toUpperCase(); }

// Microsoft Binary Format float32: bytes[i..i+3], LSB first, exponent in byte[i+3]
function _gwMbf32(b, i) {
  if (b[i + 3] === 0) return '0';
  const exp = b[i + 3] - 152; // bias = 128, then -24 because mantissa is 24-bit fraction
  const mant = ((b[i + 2] | 0x80) << 16) | (b[i + 1] << 8) | b[i];
  const val = ((b[i + 2] & 0x80) ? -1 : 1) * mant * Math.pow(2, exp);
  const s = _gwNum(parseFloat(val.toPrecision(6)).toString());
  return (s.includes('.') || s.includes('E')) ? s : s + '!';
}

// Microsoft Binary Format float64: always positive (GW-BASIC emits '-' token before negative doubles)
function _gwMbf64(b, i) {
  if (b[i + 7] === 0) return '0';
  const exp = b[i + 7] - 184;
  const mant = (b[i + 6] | 0x80) * 2 ** 48 + b[i + 5] * 2 ** 40 + b[i + 4] * 2 ** 32 +
               b[i + 3] * 2 ** 24 + b[i + 2] * 2 ** 16 + b[i + 1] * 2 ** 8 + b[i];
  const s = _gwNum(parseFloat((mant * Math.pow(2, exp)).toPrecision(16)).toString()).replace('E', 'D');
  return s.includes('D') ? s : s + '#';
}

function detokenize(bytes) {
  const lines = [];
  let pos = 1; // skip 0xFF header
  while (pos + 1 < bytes.length) {
    if (bytes[pos] === 0 && bytes[pos + 1] === 0) break; // end-of-program marker
    pos += 2; // skip next-line pointer (used by GW-BASIC runtime, not needed here)
    const lineNum = bytes[pos] | (bytes[pos + 1] << 8);
    pos += 2;
    let out = lineNum + ' ';
    let inQ = false, inRem = false;
    while (pos < bytes.length && bytes[pos] !== 0) {
      const b = bytes[pos];
      if (b === 0x22 && !inRem) {                          // quote toggles string mode
        inQ = !inQ; out += '"'; pos++;
      } else if (inQ || inRem) {                           // raw bytes inside strings/comments
        out += String.fromCharCode(b); pos++;
      } else if (b === 0x3A && bytes[pos+1] === 0x8F && bytes[pos+2] === 0xD9) {
        inRem = true; out += "'"; pos += 3;                // colon + REM + apostrophe = ' comment
      } else if (b >= 0x20 && b <= 0x7E) {                // printable ASCII — pass through
        out += String.fromCharCode(b); pos++;
      } else if (b === 0x8F) {                             // REM keyword
        inRem = true; out += 'REM'; pos++;
      } else if (b === 0xD9) {                             // standalone apostrophe comment
        inRem = true; out += "'"; pos++;
      } else if (b === 0x0B) {                             // &O octal constant
        const v = bytes[pos+1] | (bytes[pos+2] << 8);
        out += '&O' + v.toString(8).toUpperCase(); pos += 3;
      } else if (b === 0x0C) {                             // &H hex constant
        const v = bytes[pos+1] | (bytes[pos+2] << 8);
        out += '&H' + v.toString(16).toUpperCase(); pos += 3;
      } else if (b === 0x0E) {                             // line number reference (GOTO target etc.)
        out += bytes[pos+1] | (bytes[pos+2] << 8); pos += 3;
      } else if (b === 0x0F) {                             // 1-byte integer constant (0–127)
        out += bytes[pos+1]; pos += 2;
      } else if (b >= 0x11 && b <= 0x1B) {                // inline constants 0–10
        out += (b - 0x11); pos++;
      } else if (b === 0x1C) {                             // 16-bit signed integer
        const lo = bytes[pos+1], hi = bytes[pos+2];
        let v = lo | (hi << 8); if (hi & 0x80) v -= 0x10000;
        out += v; pos += 3;
      } else if (b === 0x1D) {                             // MBF 4-byte float
        out += _gwMbf32(bytes, pos+1); pos += 5;
      } else if (b === 0x1F) {                             // MBF 8-byte double
        out += _gwMbf64(bytes, pos+1); pos += 9;
      } else {                                             // keyword token (1- or 2-byte)
        const two = (b << 8) | (pos+1 < bytes.length ? bytes[pos+1] : 0);
        if (_GWT[two] !== undefined) { out += _GWT[two]; pos += 2; }
        else if (_GWT[b] !== undefined) { out += _GWT[b]; pos++; }
        else { pos++; }                                    // skip unknown token gracefully
      }
    }
    lines.push(out);
    pos++; // consume line's null terminator
  }
  return lines.join('\n');
}

// GW-BASIC SAVE "file",P decryption — Paul Kocher, The Cryptogram #19 (1994)
const _K1 = [0xA9,0x84,0x8D,0xCD,0x75,0x83,0x43,0x63,0x24,0x83,0x19,0xF7,0x9A]; // 13
const _K2 = [0x1E,0x1D,0xC4,0x77,0x26,0x97,0xE0,0x74,0x59,0x88,0x7C];             // 11
function deprotect(buf) {
  const out = new Uint8Array(buf.length - 1); // -1: drop last byte (encrypted DOS Ctrl+Z)
  out[0] = 0xFF;
  for (let i = 0; i < buf.length - 2; i++) {
    let c = buf[i + 1];
    c = (c - (11 - i % 11) + 256) & 0xFF;
    c ^= _K1[i % 13];
    c ^= _K2[i % 11];
    c = (c + (13 - i % 13)) & 0xFF;
    out[i + 1] = c;
  }
  return out;
}

// ─── reads ───────────────────────────────────────────────────────────────────
async function readFile(name) {
  const fh = await fileHandleFor(name);
  return new Uint8Array(await (await fh.getFile()).arrayBuffer());
}

// Read a file as text (for loading .BAS programs from the connected folder, incl. nested menu
// folders like BASIC/COMMAND/RUN.BAS). Returns null if missing, so CHAIN to it is graceful.
// Automatically detokenizes GW-BASIC binary (.BAS saved without ,A) so the interpreter always
// receives plain ASCII regardless of which format the file was saved in.
// Falls back to a case-insensitive directory scan so CHAIN "menu" finds MENU.BAS on
// case-sensitive filesystems (Linux, some macOS/browser combos).
async function readText(name) {
  const _decode = (buf) => {
    if (buf.length > 0 && buf[0] === 0xFF) return detokenize(buf);
    if (buf.length > 0 && buf[0] === 0xFE) return detokenize(deprotect(buf));
    return new TextDecoder().decode(buf);
  };
  try {
    const fh = await fileHandleFor(name);
    return _decode(new Uint8Array(await (await fh.getFile()).arrayBuffer()));
  } catch {}
  // Case-insensitive fallback: scan root directory for a matching filename.
  const upper = name.toUpperCase();
  try {
    for await (const entry of requireDir().values()) {
      if (entry.kind === 'file' && entry.name.toUpperCase() === upper)
        return _decode(new Uint8Array(await (await entry.getFile()).arrayBuffer()));
    }
  } catch {}
  return null;
}

// Read exactly one record (slice the File — avoids loading the whole file).
async function readRecord(name, recNo, size) {
  const fh = await requireDir().getFileHandle(name);
  const file = await fh.getFile();
  const off = recordOffset(recNo, size);
  return new Uint8Array(await file.slice(off, off + size).arrayBuffer());
}

async function recordCount(name, size) {
  const fh = await requireDir().getFileHandle(name);
  return Math.floor((await fh.getFile()).size / size);
}

// ─── in-place per-record write ────────────────────────────────────────────────
async function writeRecord(name, recNo, size, bytes) {
  if (bytes.length !== size) throw new Error(`writeRecord: expected ${size} bytes, got ${bytes.length}`);
  const fh = await requireDir().getFileHandle(name);
  const w = await fh.createWritable({ keepExistingData: true });
  await w.seek(recordOffset(recNo, size));
  await w.write(bytes);
  await w.close();
}

// ─── cheque sequence counter (CUSTOMER record 2, SQ @ +44) ───────────────────
async function readSeq() {
  const rec = await readRecord('CUSTOMER', SEQ_RECORD, CUSTOMER_SIZE);
  return readInt16LE(rec, SEQ_FIELD_OFFSET);
}

// ─── whole-file ops (for CHQ-ADJ: create scratch file, KILL, NAME ... AS) ────────
// Get/create a file handle (GW-BASIC OPEN FOR RANDOM auto-creates a missing file).
async function openOrCreate(name) {
  return requireDir().getFileHandle(name, { create: true });
}

// Overwrite a whole file's contents (truncates). Used only for building the CHQ-ADJ scratch
// file from scratch — NOT for normal record edits (those stay in-place via writeRecord).
async function writeWholeFile(name, bytes) {
  const fh = await requireDir().getFileHandle(name, { create: true });
  const w = await fh.createWritable();            // no keepExistingData → truncates
  await w.write(bytes);
  await w.close();
}

// KILL "name" — delete a file.
async function kill(name) {
  await requireDir().removeEntry(name);
}

// NAME old AS new — rename. File System Access has no atomic rename, so copy bytes to the new
// name then delete the old one.
async function rename(oldName, newName) {
  const src = await requireDir().getFileHandle(oldName);
  const bytes = new Uint8Array(await (await src.getFile()).arrayBuffer());
  await writeWholeFile(newName, bytes);
  await requireDir().removeEntry(oldName);
}

// In-place update of just the 2-byte SQ field within CUSTOMER record 2.
async function writeSeq(seq) {
  const fh = await requireDir().getFileHandle('CUSTOMER');
  const w = await fh.createWritable({ keepExistingData: true });
  await w.seek(recordOffset(SEQ_RECORD, CUSTOMER_SIZE) + SEQ_FIELD_OFFSET);
  await w.write(writeInt16LE(seq));
  await w.close();
}
