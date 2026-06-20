// bas-js — generic GW-BASIC runtime. Point it at a folder of .BAS programs + their data files
// (CHQ.DAT, CUSTOMER, …); it runs them in an 80×25 terminal, reading/writing through one folder
// handle. No program whitelist: any program CHAIN names is loaded on demand from that folder.

const DEFAULT_BOOT = 'PASSWORD';

// ── favicon helpers ───────────────────────────────────────────────────────────
let _faviconBlobUrl = null;
function _setFavicon(url) {
  if (_faviconBlobUrl) { URL.revokeObjectURL(_faviconBlobUrl); _faviconBlobUrl = null; }
  let link = document.querySelector('link[rel~="icon"]');
  if (!url) { if (link) link.remove(); return; }
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  if (url.startsWith('blob:')) _faviconBlobUrl = url;
  link.href = url;
}
function _detectDefaultFavicon() {
  return new Promise(resolve => {
    const candidates = ['./src/favicon.ico', './src/favicon.png'];
    let i = 0;
    const tryNext = () => {
      if (i >= candidates.length) { resolve(null); return; }
      const img = new Image();
      img.onload = () => resolve(candidates[i]);
      img.onerror = () => { i++; tryNext(); };
      img.src = candidates[i];
    };
    tryNext();
  });
}
async function _loadFavicon(basDir) {
  const dirs = basDir ? [basDir, ''] : [''];
  for (const dir of dirs) {
    for (const [ext, mime] of [['ico','image/x-icon'],['png','image/png']]) {
      try {
        const data = await readFile(dir + 'favicon.' + ext);
        if (data && data.length) return URL.createObjectURL(new Blob([data], { type: mime }));
      } catch {}
    }
  }
  return null;
}

const loadBas = (name) => { let n = String(name).trim().toUpperCase(); if (n.endsWith('.BAS')) n = n.slice(0, -4); return readText(`${n}.BAS`); };

async function runApp(el, status, boot = DEFAULT_BOOT) {
  const s = new Screen(el);
  const term = new Terminal(s);
  term.attach();
  window._activeTerm = term;  // exposed so ESC handler in index.html can abort()

  const bas = new Basic(s, term, loadBas);
  bas.onPrintReady = (lines) => showPrintPreview(lines, 'Report');
  const gfxEl = document.getElementById('gfx');
  if (gfxEl) bas.gfx = new Graphics(gfxEl);     // SCREEN 1/2 graphics on the overlay canvas
  bas.audio = new SoundEngine();                // SOUND / PLAY via Web Audio

  let prog = boot;
  // Directory prefix of the current program (e.g. "old_games/"). CHAIN targets with no path
  // separator are resolved relative to this prefix, matching GW-BASIC's single-directory model
  // where all programs live in the same folder as the one currently running.
  let basDir = /[/\\]/.test(prog) ? prog.replace(/[^/\\]*$/, '') : '';
  try {
    while (prog) {
      document.title = prog.replace(/.*[/\\]/, '').toUpperCase() + '.BAS';
      _setFavicon(await _loadFavicon(basDir));
      const src = await loadBas(prog);
      if (src == null) {
        console.error(`[bas] program "${prog}.BAS" not found in folder`);
        s.color(7, 0); s.locate(25, 1); s.put(`[ "${prog}" not found — press any key ]`); s.render(); await term.inputKey(); break;
      }
      const res = await bas.runText(src);
      if (!bas.printer.isEmpty()) { showPrintPreview(bas.printer.lines, prog); bas.printer.reset(); }
      if (res && res.t === 'chain') {
        console.info(`[bas] ${prog}.BAS → CHAIN ${res.name}`);
        // Bare name (no slash) → same directory as the current program.
        // Explicit path (e.g. "other/GAME") → used as-is.
        const _cn = String(res.name).replace(/^[A-Za-z]:/, '');  // strip DOS drive prefix (e.g. "B:MENU" → "MENU")
        prog = /[/\\]/.test(_cn) ? _cn : basDir + _cn;
        basDir = /[/\\]/.test(prog) ? prog.replace(/[^/\\]*$/, '') : '';
      }
      else if (res && res.t === 'system') { console.info(`[bas] ${prog}.BAS exited (SYSTEM)`); s.color(7, 0); s.locate(25, 1); s.put('[ exited — SYSTEM ]'); s.render(); break; }
      else {
        // Normal END / ran off the end: hold the output on screen until a keypress, so
        // print-and-end programs (e.g. QUAD.BAS) aren't hidden by the gate the instant they finish.
        console.info(`[bas] ${prog}.BAS ended`);
        s.color(7, 0); s.locate(25, 1); s.put('[ program ended - press any key ]'); s.render(); await term.inputKey(); break;
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
    if (gfxEl) { gfxEl.style.display = 'none'; const _c = gfxEl.getContext('2d'); if (_c) _c.clearRect(0, 0, gfxEl.width, gfxEl.height); }
    s.setTextCols(80); s.color(7, 0); s.cls();  // back to gate — clear both canvas and text screen
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
