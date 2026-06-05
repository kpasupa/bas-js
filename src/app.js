// bas-js — generic GW-BASIC runtime. Point it at a folder of .BAS programs + their data files
// (CHQ.DAT, CUSTOMER, …); it runs them in an 80×25 terminal, reading/writing through one folder
// handle. No program whitelist: any program CHAIN names is loaded on demand from that folder.

import { Screen } from './term/screen.js';
import { Terminal } from './term/input.js';
import { Basic } from './interp/basic.js';
import { showPrintPreview } from './print/report.js';
import * as store from './data/store.js';

const BOOT = 'PASSWORD';   // first program to run (the legacy system's entry point)

// Load a .BAS by program name from the connected folder (filenames are uppercased to match
// GW-BASIC/DOS). Returns null if absent.
const loadBas = (name) => store.readText(`${String(name).trim().toUpperCase()}.BAS`);

export async function runApp(el, status) {
  const s = new Screen(el);
  const term = new Terminal(s);
  term.attach();
  const bas = new Basic(s, term, loadBas);
  bas.onPrintReady = (lines) => showPrintPreview(lines, 'Report');

  let prog = BOOT;
  while (prog) {
    const src = await loadBas(prog);
    if (src == null) { s.color(7, 0); s.locate(25, 1); s.put(`[ program "${prog}" not found in folder ]`); s.render(); break; }
    const res = await bas.runText(src);
    if (!bas.printer.isEmpty()) { showPrintPreview(bas.printer.lines, prog); bas.printer.reset(); }
    if (res && res.t === 'chain') prog = res.name;
    else if (res && res.t === 'system') { s.color(7, 0); s.locate(25, 1); s.put('[ exited — SYSTEM ]'); s.render(); break; }
    else break;
  }
  term.detach();
  if (status) status('finished — reload to run again');
}

// Connect the data/.BAS folder, then auto-run. Called on load (silent reconnect) and from the
// connect button (user gesture → folder pick). `onConnected` fires as soon as the folder is
// granted (so the UI can reveal the screen) — BEFORE the long-running program loop starts.
// Writes persist through the granted handle.
// opts.forcePick = true skips regrant and goes straight to the OS folder picker.
export async function connectAndRun(el, status, fromGesture, onConnected, opts = {}) {
  const forcePick = opts?.forcePick ?? false;
  try {
    let ok = await store.tryReconnect('readwrite');
    if (!ok && fromGesture && !forcePick) ok = await store.regrant('readwrite');
    if (!ok && fromGesture) ok = !!(await store.pickFolder('readwrite'));
    if (!ok) { status && status(fromGesture ? 'permission denied' : ''); return false; }
    status && status(`connected: ${store.folderName()}`);
    if (onConnected) onConnected();
    await runApp(el, status);
    return true;
  } catch (e) {
    if (e.name !== 'AbortError') status && status('error: ' + e.message);
    return false;
  }
}
