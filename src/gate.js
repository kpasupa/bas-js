// Gate UI — file browser / launcher that sits in front of the interpreter.
// Loaded as the last script in index.html; depends on cp437.js, ku42.js, app.js.

const _origTitle = document.title;  // capture <title> before any program changes it
let _defaultFavicon = null;

const el      = document.getElementById('screen');
const gate    = document.getElementById('gate');
const gatePre = document.getElementById('gate-pre');
const escHint = document.getElementById('esc-hint');

// ── layout ──────────────────────────────────────────────────────────────────
const LI   = 38;  // inner width of each panel (between │ borders)
const ROWS = 17;  // content rows between the two border lines

// ── persisted data ───────────────────────────────────────────────────────────
// Keys use '_v3' suffix to signal schema version (old 'projects' key has
// incompatible format: {handle,boot,codec,name} vs {handle,name,files,subtree}).
let projects  = [];   // [{ handle, name, files: {'FILE.BAS': codec|null} }]
let recentBas = null; // { folderName, basFile, codec }
let autoRun   = true; // auto-execute recent BAS on load if permission live

async function loadData() {
  projects  = (await idbGetKey('projects_v3'))  ?? [];
  recentBas = (await idbGetKey('recentBas_v3')) ?? null;
  autoRun   = (await idbGetKey('autoRun_v3'))   ?? true;
  // Migrate old string codec IDs → numeric; add folderCodecs if missing.
  let migrated = false;
  const remap = { 'cp437': 1, 'ku42': 2 };
  projects.forEach(proj => {
    if (!proj.folderCodecs) { proj.folderCodecs = {}; migrated = true; }
    const files = proj.files || {};
    Object.keys(files).forEach(k => {
      if (files[k] in remap) { files[k] = remap[files[k]]; migrated = true; }
    });
  });
  if (migrated) await saveProjects();
}
async function saveProjects() { await idbSetKey('projects_v3', projects); }
async function saveRecent()   { await idbSetKey('recentBas_v3', recentBas); }
async function saveAutoRun()  { await idbSetKey('autoRun_v3', autoRun); }

// ── ui state ────────────────────────────────────────────────────────────────
let panel         = 'left'; // 'recent' | 'left' | 'right'
let leftIdx       = 0;      // absolute index into leftItems[]
let leftOffset    = 0;      // scroll offset for left panel
let leftItems     = [];     // flat list: {type:'add'} | {type:'root',pi} | {type:'sub',pi,si,name}
let rightIdx      = 0;
let rightOffset   = 0;
let rightVisible  = false;  // right panel only appears after entering a folder
let selProjIdx    = -1;     // which project is open in the right panel
let rightPath     = '';     // current dir path being browsed ('' = project root)
let expandedProj  = -1;     // which project's subfolders are shown in left panel
let allRightFiles = [];     // full recursive file list from last scan
let rightItems    = [];     // dirs + files visible at rightPath level
let gateMsg       = '';

// ── right panel items ────────────────────────────────────────────────────────
// Slices allRightFiles to one level at rightPath, adding <DIR> entries for subdirs.
function rebuildRightItems() {
  if (selProjIdx < 0) { rightItems = []; return; }
  const prefix  = rightPath ? rightPath + '/' : '';
  const subdirs = new Set();
  const files   = [];
  allRightFiles.forEach(f => {
    if (!f.name.startsWith(prefix)) return;
    const rest  = f.name.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash >= 0) subdirs.add(rest.slice(0, slash));
    else files.push({ name: rest, fullName: f.name, codec: f.codec });
  });
  rightItems = [];
  if (rightPath) rightItems.push({ type: 'up' });
  [...subdirs].sort((a, b) => a.localeCompare(b)).forEach(d =>
    rightItems.push({ type: 'dir', name: d, path: prefix + d })
  );
  files.sort((a, b) => a.name.localeCompare(b.name));
  files.forEach(f => rightItems.push({ type: 'file', name: f.name, fullName: f.fullName, codec: f.codec }));
}

// ── left panel tree helpers ──────────────────────────────────────────────────
// ancestorIsLasts: one bool per ancestor above this node (root's isLast first).
// Determines whether each ancestor column draws │ or spaces.
function makePrefix(ancestorIsLasts, isLast) {
  let p = ' ';
  ancestorIsLasts.forEach(a => { p += a ? '   ' : '│  '; });
  p += isLast ? '└─ ' : '├─ ';
  return p; // length = 4 + 3 * ancestorIsLasts.length
}

function flattenTree(nodes, pi, ancestorIsLasts, parentPath) {
  nodes.forEach((node, i) => {
    const isLast = i === nodes.length - 1;
    const path   = parentPath ? parentPath + '/' + node.name : node.name;
    leftItems.push({ type: 'sub', pi, name: node.name, path, isLast, ancestorIsLasts: [...ancestorIsLasts] });
    if (node.children?.length) {
      flattenTree(node.children, pi, [...ancestorIsLasts, isLast], path);
    }
  });
}

function rebuildLeftItems() {
  leftItems = [{ type: 'add' }];
  projects.forEach((proj, pi) => {
    const isLastRoot = pi === projects.length - 1;
    const isExpanded = pi === expandedProj && proj.subtree?.length > 0;
    leftItems.push({ type: 'root', pi, isLastRoot, isExpanded });
    if (isExpanded) flattenTree(proj.subtree, pi, [isLastRoot], '');
  });
  clampLeft();
}

// ── codec registry ───────────────────────────────────────────────────────────
// null = not set (inherit from folder/global); 0 = RAW; 1 = CP437; 2 = KU42
const CODECS = [
  { id: null, badge: '',        runtime() { return null; } },
  { id: 0,    badge: '(RAW)',   runtime() { return null; } },
  { id: 1,    badge: '(CP437)', runtime() { return { display: cp437Display, encode: cp437Encode, reverse(ch) { const cp = ch.codePointAt(0); if (cp === 0) return 0; if (cp < 0x80) return cp; return CP437_REV[ch] ?? CP437_CTRL_REV[ch] ?? (cp & 0xFF); } }; } },
  { id: 2,    badge: '(KU42)',  runtime() { return undefined; } },
];

function cycleCodec(c) {
  const id = c ?? null;
  const i  = CODECS.findIndex(x => x.id === id);
  return CODECS[((i < 0 ? 0 : i) + 1) % CODECS.length].id;
}
function codecBadge(c)      { return CODECS.find(x => x.id === (c ?? null))?.badge ?? ''; }
function codecForRuntime(c) { return (CODECS.find(x => x.id === (c ?? null)) ?? CODECS[1]).runtime(); }

// Resolves effective codec for a file: file setting → nearest folder default → RAW.
function resolveFileCodec(pi, filePath, fileCodec) {
  if (fileCodec !== null) return fileCodec;
  const fc    = projects[pi]?.folderCodecs || {};
  const parts = filePath.split('/');
  parts.pop();
  for (let i = parts.length; i >= 0; i--) {
    const c = fc[parts.slice(0, i).join('/')] ?? null;
    if (c !== null) return c;
  }
  return 0;
}

// ── text helpers ─────────────────────────────────────────────────────────────
function gpad(s, w) { s = String(s); return s + ' '.repeat(Math.max(0, w - s.length)); }
function hesc(s)    { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function panelHeader(title, inner) {
  const t   = ' ' + String(title).substring(0, inner - 4) + ' ';
  const rem = inner - t.length;
  const l   = Math.floor(rem / 2);
  return '┌' + '─'.repeat(l) + t + '─'.repeat(rem - l) + '┐';
}

// ── left panel row ───────────────────────────────────────────────────────────
function leftRowHtml(r) {
  const ri    = leftOffset + r;
  const item  = leftItems[ri];
  if (!item) return hesc('│' + ' '.repeat(LI) + '│');
  const isSel = panel === 'left' && leftIdx === ri;

  if (item.type === 'add') {
    const inner = gpad(' \\  ADD NEW FOLDER TO LIST', LI);
    if (isSel) return hesc('│') + '<span class="gate-sel">' + hesc(inner) + '</span>' + hesc('│');
    return hesc('│' + inner + '│');
  }

  if (item.type === 'root') {
    const proj   = projects[item.pi];
    const badge  = codecBadge((proj.folderCodecs || {})[''] ?? null);
    const prefix = ' ' + (item.isLastRoot ? '└─ ' : '├─ ');
    const name   = gpad(proj.name, LI - 4 - badge.length - (badge ? 1 : 0)) + (badge ? badge + ' ' : '');
    if (isSel) return hesc('│') + hesc(prefix) + '<span class="gate-sel">' + hesc(name) + '</span>' + hesc('│');
    return hesc('│' + prefix + name + '│');
  }

  if (item.type === 'sub') {
    const proj   = projects[item.pi];
    const badge  = codecBadge((proj.folderCodecs || {})[item.path] ?? null);
    const prefix = makePrefix(item.ancestorIsLasts, item.isLast);
    const name   = gpad(item.name, LI - prefix.length - badge.length - (badge ? 1 : 0)) + (badge ? badge + ' ' : '');
    if (isSel) return hesc('│') + hesc(prefix) + '<span class="gate-sel">' + hesc(name) + '</span>' + hesc('│');
    return hesc('│' + prefix + name + '│');
  }

  return hesc('│' + ' '.repeat(LI) + '│');
}

// ── right panel row ──────────────────────────────────────────────────────────
function rightRowHtml(r) {
  if (!rightVisible) {
    const inner = r === 8 ? gpad('  ← select a folder and press Enter', LI) : ' '.repeat(LI);
    return hesc('│' + inner + '│');
  }

  const ri   = rightOffset + r;
  const item = rightItems[ri];
  if (!item) return hesc('│' + ' '.repeat(LI) + '│');

  const isSel = panel === 'right' && ri === rightIdx;
  let inner;
  if (item.type === 'up') {
    inner = gpad(' ../  Up a Level', LI - 1) + ' ';
  } else if (item.type === 'dir') {
    const badge = codecBadge((projects[selProjIdx]?.folderCodecs || {})[item.path] ?? null);
    inner = gpad(' ' + item.name + ' <DIR>', LI - badge.length - 1) + badge + ' ';
  } else {
    const badge = codecBadge(item.codec);
    inner = gpad(' ' + item.name, LI - badge.length - 1) + badge + ' ';
  }

  if (isSel) return hesc('│') + '<span class="gate-sel">' + hesc(inner) + '</span>' + hesc('│');
  return hesc('│' + inner + '│');
}

// ── F-key bar (line 25) ──────────────────────────────────────────────────────
const fk = s => '<span class="gate-fk">' + hesc(s) + '</span>';
function fkeyBar() {
  const fkeys = [
    ['1','ADD','  '], ['2','REMOVE','  '], ['3','ENCODING"','  '],
    ['4', autoRun ? 'AUTORUN[X]' : 'AUTORUN[ ]', '  '],
  ];
  const chips = fkeys.map(([n, label, trail]) =>
    hesc(n) + '<span class="gate-fk">' + hesc(label) + '</span>' + hesc(trail)
  ).join('');
  const nav =
    hesc('↕') + fk('NAVI') +
    hesc('  ↔') + fk('PANEL') +
    hesc('  ↲') + fk('SELECT') +
    hesc('  [CTRL+C+C]') + fk('ABORT');
  return chips + nav;
}

// ── draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const lines = [];

  // lines 1-4: header
  lines.push(hesc('bas-js 1.3.47'));
  lines.push(hesc('(C) Copyright Krit Pasupa'));
  lines.push(hesc('github.com/kpasupa'));
  lines.push('');

  // line 5: recent BAS (selectable) or status message
  if (recentBas) {
    const badge = codecBadge(recentBas.codec) ? ' ' + codecBadge(recentBas.codec) : '';
    const rline = gpad('Recent BAS: ' + recentBas.folderName + '/' + recentBas.basFile + badge, 80);
    lines.push(panel === 'recent'
      ? '<span class="gate-sel">' + hesc(rline) + '</span>'
      : hesc(rline));
  } else {
    lines.push(hesc(gateMsg));
  }

  // line 6: panel headers
  const rBase  = selProjIdx >= 0 ? (projects[selProjIdx]?.name || '') : '';
  const rTitle = rBase ? rBase + (rightPath ? '/' + rightPath : '') : 'SELECT A FOLDER';
  lines.push(hesc(panelHeader('LIST', LI)) + hesc(panelHeader(rTitle, LI)));

  // lines 7-23: content rows
  for (let r = 0; r < ROWS; r++) lines.push(leftRowHtml(r) + rightRowHtml(r));

  // line 24: bottom borders
  lines.push(hesc('└' + '─'.repeat(LI) + '┘' + '└' + '─'.repeat(LI) + '┘'));

  // line 25: F-key bar (pre-rendered HTML)
  gatePre.innerHTML = lines.join('\n') + '\n' + fkeyBar();
}

// ── scroll helpers ───────────────────────────────────────────────────────────
const leftTotal = () => leftItems.length;

function clampLeft() {
  leftIdx    = Math.max(0, Math.min(leftIdx, leftTotal() - 1));
  if (leftIdx < leftOffset) leftOffset = leftIdx;
  if (leftIdx >= leftOffset + ROWS) leftOffset = leftIdx - ROWS + 1;
  leftOffset = Math.max(0, leftOffset);
}
function clampRight() {
  rightIdx = Math.max(0, Math.min(rightIdx, rightItems.length - 1));
  if (rightIdx < rightOffset) rightOffset = rightIdx;
  if (rightIdx >= rightOffset + ROWS) rightOffset = rightIdx - ROWS + 1;
}

// ── recursive .BAS scanner ──────────────────────────────────────────────────
async function scanDir(dirHandle, prefix, existing, found) {
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file' && entry.name.toUpperCase().endsWith('.BAS')) {
      const n = (prefix ? prefix + '/' : '') + entry.name;
      found.push({ name: n, codec: n in existing ? existing[n] : null });
    } else if (entry.kind === 'directory') {
      const sub       = await dirHandle.getDirectoryHandle(entry.name);
      const subPrefix = prefix ? prefix + '/' + entry.name : entry.name;
      await scanDir(sub, subPrefix, existing, found);
    }
  }
}

// ── build recursive directory tree for left panel ───────────────────────────
// validDirs: Set of paths that contain at least one .BAS file somewhere inside.
async function buildDirTree(dirHandle, validDirs, prefix) {
  const children = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'directory') {
      const childPath = prefix ? prefix + '/' + entry.name : entry.name;
      if (!validDirs.has(childPath)) continue;
      const childHandle = await dirHandle.getDirectoryHandle(entry.name);
      const childTree   = await buildDirTree(childHandle, validDirs, childPath);
      children.push({ name: entry.name, children: childTree });
    }
  }
  children.sort((a, b) => a.name.localeCompare(b.name));
  return children;
}

// ── scan a project folder and update all state ───────────────────────────────
// Permission must already be granted before calling this.
async function scanAndSetup(pi) {
  const proj      = projects[pi];
  const existing  = proj.files || {};
  const found     = [];
  const validDirs = new Set();
  await scanDir(proj.handle, '', existing, found);
  found.forEach(f => {
    const parts = f.name.split('/');
    for (let i = 1; i < parts.length; i++) validDirs.add(parts.slice(0, i).join('/'));
  });
  const subtree = await buildDirTree(proj.handle, validDirs, '');
  found.sort((a, b) => a.name.localeCompare(b.name));
  proj.files   = {};
  found.forEach(f => { proj.files[f.name] = f.codec; });
  proj.subtree = subtree;
  await saveProjects();
  expandedProj  = pi;
  allRightFiles = found;
  selProjIdx    = pi;
  rightPath     = '';
  rightVisible  = true;
  rightIdx      = 0;
  rightOffset   = 0;
  rebuildRightItems();
  rebuildLeftItems();
}

// ── grant permission + scan .BAS files ───────────────────────────────────────
// Called from keydown Enter — requestPermission() as first await keeps gesture alive.
async function grantAndScan(pi) {
  const proj = projects[pi];
  gateMsg = 'Requesting permission…'; draw();
  try {
    const perm = await proj.handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') { gateMsg = 'Permission denied.'; draw(); return false; }
  } catch(e) { gateMsg = 'Error: ' + e.message; draw(); return false; }
  gateMsg = 'Scanning…'; draw();
  try { await scanAndSetup(pi); } catch(e) { gateMsg = 'Scan error: ' + e.message; draw(); return false; }
  gateMsg = ''; return true;
}

// ── auto-run recent BAS if folder permission is still live ───────────────────
// Uses queryPermission (no gesture needed) — silently no-ops if permission expired.
async function tryAutoRun() {
  if (!autoRun || !recentBas) return;
  const pi = projects.findIndex(p => p.name === recentBas.folderName);
  if (pi < 0) return;
  try {
    const perm = await projects[pi].handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return;
    await scanAndSetup(pi);
    const f = allRightFiles.find(x => x.name === recentBas.basFile);
    if (f) await runBas(pi, f);
  } catch(e) { /* permission expired or file gone — just stay on gate */ }
}

// ── run a BAS file ───────────────────────────────────────────────────────────
async function runBas(pi, item) {
  const proj     = projects[pi];
  const boot     = item.name.replace(/\.BAS$/i, '');
  const resolved = resolveFileCodec(pi, item.name, item.codec);
  await setActiveProject({ handle: proj.handle, boot, name: proj.name, codec: resolved ?? 'none' });
  window._bas_codec = codecForRuntime(resolved);

  recentBas = { folderName: proj.name, basFile: item.name, codec: item.codec };
  await saveRecent();

  hideGate();
  await connectAndRun(el, (msg) => { gateMsg = msg; }, false, () => {});
  showGate();
}

// ── add folder ───────────────────────────────────────────────────────────────
// Called synchronously from keydown — showDirectoryPicker() as first await keeps gesture alive.
async function openAddFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    if (projects.some(p => p.name === handle.name)) {
      gateMsg = '"' + handle.name + '" is already in the list.'; draw(); return;
    }
    projects.push({ handle, name: handle.name, files: {}, folderCodecs: {}, subtree: [] });
    await saveProjects();
    rebuildLeftItems();
    leftIdx = leftItems.length - 1; // select newly added root entry
    clampLeft();
    gateMsg = '';
    draw();
  } catch(e) {
    if (e.name !== 'AbortError') { gateMsg = 'Error: ' + e.message; draw(); }
  }
}

// ── remove folder ─────────────────────────────────────────────────────────────
async function removeFolder(pi) {
  if (!confirm('Remove "' + projects[pi].name + '" from list?')) return;
  projects.splice(pi, 1);
  if (selProjIdx === pi)     { rightVisible = false; selProjIdx = -1; allRightFiles = []; rightItems = []; rightPath = ''; }
  else if (selProjIdx > pi)  { selProjIdx--; }
  if (expandedProj === pi)   { expandedProj = -1; }
  else if (expandedProj > pi){ expandedProj--; }
  await saveProjects();
  rebuildLeftItems();
  clampLeft();
  draw();
}

// ── keyboard ─────────────────────────────────────────────────────────────────
function gateKeydown(e) {

  // ── global: 4 toggles autorun ──────────────────────────────
  if (e.key === '4' || e.key === 'F4') {
    e.preventDefault(); autoRun = !autoRun; saveAutoRun(); draw(); return;
  }

  // ── recent BAS row ─────────────────────────────────────────
  if (panel === 'recent') {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); panel = 'left'; leftIdx = 0; draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!recentBas) return;
      const pi = projects.findIndex(p => p.name === recentBas.folderName);
      if (pi < 0) { gateMsg = 'Folder not found.'; panel = 'left'; draw(); return; }
      grantAndScan(pi).then(ok => {
        if (!ok) return;
        const item = allRightFiles.find(f => f.name === recentBas.basFile);
        if (item) runBas(pi, item);
        else { panel = 'right'; draw(); }
      });
    }
    return;
  }

  // ── left panel ─────────────────────────────────────────────
  if (panel === 'left') {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); leftIdx++; clampLeft(); draw();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (leftIdx === 0 && recentBas) { panel = 'recent'; draw(); }
      else { leftIdx--; clampLeft(); draw(); }
    } else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      if (rightVisible) { panel = 'right'; draw(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = leftItems[leftIdx];
      if (!item) return;
      if (item.type === 'add') {
        openAddFolder();
      } else if (item.type === 'root') {
        grantAndScan(item.pi).then(ok => { if (ok) { panel = 'right'; draw(); } });
      } else if (item.type === 'sub') {
        rightPath = item.path; rebuildRightItems();
        rightIdx  = 0; rightOffset = 0;
        panel     = 'right'; draw();
      }
    } else if (e.key === '1' || e.key === 'F1') {
      e.preventDefault(); openAddFolder();
    } else if (e.key === '2' || e.key === 'F2' || e.key === 'Delete') {
      e.preventDefault();
      const item = leftItems[leftIdx];
      if (item?.type === 'root') removeFolder(item.pi);
    } else if (e.key === '3' || e.key === 'F3') {
      e.preventDefault();
      const item = leftItems[leftIdx];
      if (item?.type === 'root' || item?.type === 'sub') {
        const proj = projects[item.pi];
        if (!proj.folderCodecs) proj.folderCodecs = {};
        const path = item.type === 'root' ? '' : item.path;
        proj.folderCodecs[path] = cycleCodec(proj.folderCodecs[path] ?? null);
        saveProjects(); draw();
      }
    }
    return;
  }

  // ── right panel ────────────────────────────────────────────
  if (panel === 'right') {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); rightIdx++; clampRight(); draw();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); rightIdx--; clampRight(); draw();
    } else if (e.key === 'ArrowLeft' || e.key === 'Escape' || (e.key === 'Tab' && e.shiftKey) || e.key === 'Tab') {
      e.preventDefault(); panel = 'left'; draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const ri = rightItems[rightIdx];
      if (!ri) return;
      if (ri.type === 'up') {
        rightPath = rightPath.includes('/') ? rightPath.split('/').slice(0, -1).join('/') : '';
        rebuildRightItems(); rightIdx = 0; rightOffset = 0; draw();
      } else if (ri.type === 'dir') {
        rightPath = ri.path; rebuildRightItems();
        rightIdx = 0; rightOffset = 0; draw();
      } else if (ri.type === 'file') {
        const f = allRightFiles.find(x => x.name === ri.fullName);
        if (f) runBas(selProjIdx, f);
      }
    } else if (e.key === 'F3' || e.key === '3') {
      e.preventDefault();
      const ri = rightItems[rightIdx];
      if (!ri) return;
      if (ri.type === 'file') {
        const f = allRightFiles.find(x => x.name === ri.fullName);
        if (!f) return;
        f.codec  = cycleCodec(f.codec);
        ri.codec = f.codec;
        projects[selProjIdx].files[f.name] = f.codec;
        saveProjects(); draw();
      } else if (ri.type === 'dir') {
        const proj = projects[selProjIdx];
        if (!proj.folderCodecs) proj.folderCodecs = {};
        proj.folderCodecs[ri.path] = cycleCodec(proj.folderCodecs[ri.path] ?? null);
        saveProjects(); draw();
      }
    }
  }
}

// ── gate show / hide ─────────────────────────────────────────────────────────
function showGate() {
  gate.style.display = 'flex';
  escHint.style.display = 'none';
  document.title = _origTitle;
  _setFavicon(_defaultFavicon);
  leftOffset = 0; gateMsg = '';
  if (recentBas) { panel = 'recent'; leftIdx = 0; }
  else            { panel = 'left';   leftIdx = 0; }
  rebuildLeftItems();
  draw();
  window.addEventListener('keydown', gateKeydown);
  gatePre.focus();
}
function hideGate() {
  gate.style.display = 'none';
  escHint.style.display = 'block';
  el.focus();
  window.removeEventListener('keydown', gateKeydown);
}

// Paste: synchronous via native paste event (Ctrl+V / Shift+Ins / browser menu).
window.addEventListener('paste', e => {
  if (!window._activeTerm) return;
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text');
  if (text) window._activeTerm.pasteText(text);
});
// Right-click paste — disabled.
// window.addEventListener('contextmenu', e => {
//   if (!window._activeTerm) return;
//   e.preventDefault();
//   window._activeTerm.pasteClipboard();
// });

// ── init ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await loadData();
    _defaultFavicon = await _detectDefaultFavicon();
    showGate();
    tryAutoRun(); // non-blocking: silently runs recent BAS if permission still live
  } catch(err) {
    gatePre.textContent = 'INIT ERROR:\n' + err.stack;
  }
})();
