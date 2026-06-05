// bas-js — generic GW-BASIC runtime. Point it at a folder of .BAS programs + their data files
// (CHQ.DAT, CUSTOMER, …); it runs them in an 80×25 terminal, reading/writing through one folder
// handle. No program whitelist: any program CHAIN names is loaded on demand from that folder.

const DEFAULT_BOOT = 'PASSWORD';

const loadBas = (name) => readText(`${String(name).trim().toUpperCase()}.BAS`);

async function runApp(el, status, boot = DEFAULT_BOOT) {
  const s = new Screen(el);
  const term = new Terminal(s);
  term.attach();
  window._activeTerm = term;  // exposed so ESC handler in index.html can abort()

  const bas = new Basic(s, term, loadBas);
  bas.onPrintReady = (lines) => showPrintPreview(lines, 'Report');

  let prog = boot;
  try {
    while (prog) {
      const src = await loadBas(prog);
      if (src == null) {
        console.error(`[bas] program "${prog}.BAS" not found in folder`);
        s.color(7, 0); s.locate(25, 1); s.put(`[ "${prog}" not found — press any key ]`); s.render(); await term.inputKey(); break;
      }
      const res = await bas.runText(src);
      if (!bas.printer.isEmpty()) { showPrintPreview(bas.printer.lines, prog); bas.printer.reset(); }
      if (res && res.t === 'chain') { console.info(`[bas] ${prog}.BAS → CHAIN ${res.name}`); prog = res.name; }
      else if (res && res.t === 'system') { console.info(`[bas] ${prog}.BAS exited (SYSTEM)`); s.color(7, 0); s.locate(25, 1); s.put('[ exited — SYSTEM ]'); s.render(); break; }
      else {
        // Normal END / ran off the end: hold the output on screen until a keypress, so
        // print-and-end programs (e.g. QUAD.BAS) aren't hidden by the gate the instant they finish.
        console.info(`[bas] ${prog}.BAS ended`);
        s.color(7, 0); s.locate(25, 1); s.put('[ program ended — press any key ]'); s.render(); await term.inputKey(); break;
      }
    }
  } catch (e) {
    // Program-level errors are handled (and logged) here, NOT re-thrown — so connectAndRun's
    // catch only ever logs connect/setup failures. One error → one log.
    if (e.name === 'EscapeError') console.info(`[bas] ${prog}.BAS aborted (ESC/abort)`);
    else console.error(`[bas] runtime error in ${prog}.BAS:`, e);
  } finally {
    window._activeTerm = null;
    term.detach();
  }

  if (status) status('');
}

async function connectAndRun(el, status, fromGesture, onConnected) {
  try {
    // Try active project from picker (permission already granted there)
    let boot = await tryReconnectActive();
    let ok = !!boot;

    // Fall back to legacy single-handle reconnect
    if (!ok) { ok = await tryReconnect('readwrite'); boot = DEFAULT_BOOT; }
    if (!ok && fromGesture) ok = await regrant('readwrite');
    if (!ok && fromGesture) ok = !!(await pickFolder('readwrite'));
    if (!ok) { status && status(fromGesture ? 'permission denied' : ''); return false; }

    status && status(`connected: ${folderName()}`);
    if (onConnected) onConnected();
    await runApp(el, status, boot);
    return true;
  } catch (e) {
    console.error('[bas] connectAndRun error:', e);
    if (e.name !== 'AbortError') status && status('error: ' + e.message);
    return false;
  }
}
