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

// ─── reads ───────────────────────────────────────────────────────────────────
async function readFile(name) {
  const fh = await requireDir().getFileHandle(name);
  return new Uint8Array(await (await fh.getFile()).arrayBuffer());
}

// Read a file as text (for loading .BAS programs from the connected folder). Returns null if
// the file does not exist, so CHAIN to a missing program is graceful.
async function readText(name) {
  try {
    const fh = await requireDir().getFileHandle(name);
    return await (await fh.getFile()).text();
  } catch {
    return null;
  }
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
