// bas-js — generic GW-BASIC runtime. Point it at a folder of .BAS programs + their data files
// (CHQ.DAT, CUSTOMER, …); it runs them in an 80×25 terminal, reading/writing through one folder
// handle. No program whitelist: any program CHAIN names is loaded on demand from that folder.


const BOOT = 'PASSWORD';   // first program to run (the legacy system's entry point)

// Load a .BAS by program name from the connected folder (filenames are uppercased to match
// GW-BASIC/DOS). Returns null if absent.
const loadBas = (name) => readText(`${String(name).trim().toUpperCase()}.BAS`);

async function runApp(el, status) {
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
async function connectAndRun(el, status, fromGesture, onConnected) {
  try {
    let ok = await tryReconnect('readwrite');                        // silent if previously granted
    if (!ok && fromGesture) ok = await regrant('readwrite');         // re-grant saved handle (no picker)
    if (!ok && fromGesture) ok = !!(await pickFolder('readwrite')); // first time: pick folder
    if (!ok) { status && status(fromGesture ? 'permission denied' : 'click “Connect data folder”'); return false; }
    status && status(`connected: ${folderName()} — writes persist`);
    if (onConnected) onConnected();
    await runApp(el, status);
    return true;
  } catch (e) {
    if (e.name !== 'AbortError') status && status('error: ' + e.message);
    return false;
  }
}
