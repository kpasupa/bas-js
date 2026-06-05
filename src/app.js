// bas-js — generic GW-BASIC runtime. Point it at a folder of .BAS programs + their data files
// (CHQ.DAT, CUSTOMER, …); it runs them in an 80×25 terminal, reading/writing through one folder
// handle. No program whitelist: any program CHAIN names is loaded on demand from that folder.

const DEFAULT_BOOT = 'PASSWORD';

const loadBas = (name) => readText(`${String(name).trim().toUpperCase()}.BAS`);

async function runApp(el, status, boot = DEFAULT_BOOT) {
  const s = new Screen(el);
  const term = new Terminal(s);
  term.attach();
  const bas = new Basic(s, term, loadBas);
  bas.onPrintReady = (lines) => showPrintPreview(lines, 'Report');

  let prog = boot;
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

async function connectAndRun(el, status, fromGesture, onConnected) {
  try {
    // Try active project from picker.html first (permission already granted there)
    let boot = await tryReconnectActive();
    let ok = !!boot;

    // Fall back to legacy single-handle reconnect
    if (!ok) { ok = await tryReconnect('readwrite'); boot = DEFAULT_BOOT; }
    if (!ok && fromGesture) ok = await regrant('readwrite');
    if (!ok && fromGesture) ok = !!(await pickFolder('readwrite'));
    if (!ok) { status && status(fromGesture ? 'permission denied' : 'click "Connect data folder"'); return false; }

    status && status(`connected: ${folderName()}`);
    if (onConnected) onConnected();
    await runApp(el, status, boot);
    return true;
  } catch (e) {
    if (e.name !== 'AbortError') status && status('error: ' + e.message);
    return false;
  }
}
