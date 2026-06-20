// Spike A — GW-BASIC interpreter, scoped to the screens cheque-js needs. Runs the original
// .BAS unmodified.
//
// Supports: line-numbered flow, GOTO/GOSUB/RETURN/ON..GOTO, IF/THEN/ELSE (inline stmts &
// line-number targets), multi-statement ':' lines, FOR/NEXT, CLS/COLOR/LOCATE/BEEP,
// PRINT/LPRINT (with ; , TAB() SPC() and PRINT USING), INPUT, CHAIN/END/SYSTEM, assignment,
// COMMON (passes declared scalars + arrays across CHAIN), random files (OPEN/FIELD/GET/PUT/CLOSE/LSET),
// CVI/MKI$/CVS/CVD/MKS$/MKD$, and INT/RIGHT$/LEFT$/MID$/STR$/STRING$/SPACE$/CHR$/ABS/LEN/VAL
// /INKEY$, operators + - * / MOD, = <> < > <= >=, AND/OR/NOT, string concat.
//
// String model = GW-BASIC byte strings: a JS string whose char codes are raw bytes (0–255).
// Source literals are already ≤0xFF (codepoint = byte). INPUT KU42-encodes typed Unicode to
// bytes; PRINT KU42-decodes bytes to Thai for display. File fields are byte strings.
//
// ⚠ Reads are real (fetched). PUT updates an in-memory buffer only — it does NOT persist to
// the real data file. Real in-place persistence (to a copy) is wired separately.


// Sentinel returned by the synchronous fast path (evlS/execS/runS/…) when a statement needs
// async execution — INPUT, INKEY$, INPUT$, OPEN, PUT, CHAIN, or an empty-body delay FOR. The
// outer async run() then re-executes just that one statement via the await path. Everything
// else (GET, IF, FOR/NEXT scans, assignments, arithmetic, PRINT, LPRINT) runs with no await
// overhead — critical for the 28,729-record listing/report scans.
const _S = Symbol('async-needed');

// ── tokenizer ────────────────────────────────────────────────────────────────
function tokenize(src) {
  const t = []; let i = 0;
  const idStart = (c) => /[A-Za-z]/.test(c);
  const idChar = (c) => /[A-Za-z0-9._]/.test(c);
  const signed16 = (n) => (n & 0x8000) ? n - 0x10000 : n;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c === "'") break; // GW-BASIC apostrophe comment, equivalent to REM through EOL
    if (c === '"') { let j = i + 1, s = ''; while (j < src.length && src[j] !== '"') s += src[j++]; i = j + 1; t.push({ k: 'str', v: s }); continue; }
    if (c === '&' && /[HhOo]/.test(src[i + 1] || '')) {
      const base = /[Hh]/.test(src[i + 1]) ? 16 : 8;
      const re = base === 16 ? /[0-9A-Fa-f]/ : /[0-7]/;
      let j = i + 2, n = '';
      while (j < src.length && re.test(src[j])) n += src[j++];
      if (j < src.length && /[%!#]/.test(src[j])) j++;
      i = j; t.push({ k: 'num', v: signed16(parseInt(n || '0', base) & 0xffff) }); continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i, n = '';
      while (j < src.length && /[0-9]/.test(src[j])) n += src[j++];
      if (src[j] === '.') { n += src[j++]; while (j < src.length && /[0-9]/.test(src[j])) n += src[j++]; }
      if (/[EeDd]/.test(src[j] || '')) {
        n += 'E'; j++;
        if (/[+-]/.test(src[j] || '')) n += src[j++];
        while (j < src.length && /[0-9]/.test(src[j])) n += src[j++];
      }
      if (j < src.length && /[%!#]/.test(src[j])) j++;
      i = j; t.push({ k: 'num', v: parseFloat(n) }); continue;
    }
    if (idStart(c)) { let j = i, id = ''; while (j < src.length && idChar(src[j])) id += src[j++]; if (j < src.length && '%!$'.includes(src[j])) id += src[j++]; else if (j < src.length && src[j] === '#' && (j + 1 >= src.length || !/[0-9]/.test(src[j + 1]))) id += src[j++]; i = j; t.push({ k: 'id', v: id }); continue; }
    // Two-char relational operators; also handle optional spaces between chars (GW-BASIC detokenised form, e.g. '< >' → '<>')
    if ('<>='.includes(c)) {
      let j = i + 1;
      while (j < src.length && src[j] === ' ') j++;
      const two = c + (src[j] || '');
      const norm = {'<>':'<>','<=':'<=','>=':'>=','=>':'>=','=<':'<=','><':'<>'}[two];
      if (norm) { t.push({ k: 'op', v: norm }); i = j + 1; continue; }
    }
    if ('=<>+-*/^\\'.includes(c)) { t.push({ k: 'op', v: c }); i++; continue; }
    if (c === '(') { t.push({ k: 'lp' }); i++; continue; }
    if (c === ')') { t.push({ k: 'rp' }); i++; continue; }
    if (c === ',') { t.push({ k: 'comma' }); i++; continue; }
    if (c === ';') { t.push({ k: 'semi' }); i++; continue; }
    if (c === ':') { t.push({ k: 'colon' }); i++; continue; }
    if (c === '#') { t.push({ k: 'hash' }); i++; continue; }  // file-number marker (e.g. PRINT #1) — needed to tell file I/O from console
    if (c === '?') { t.push({ k: 'id', v: 'PRINT' }); i++; continue; }  // GW-BASIC ? shorthand for PRINT
    i++; // skip any other unknown char
  }
  return t;
}

const kw = (tok, word) => tok && tok.k === 'id' && tok.v.toUpperCase() === word;
const skipHash = (c) => { if (c.peek() && c.peek().k === 'hash') c.next(); };  // consume optional '#' before a file number

class Cursor { constructor(t) { this.t = t; this.i = 0; } peek() { return this.t[this.i]; } next() { return this.t[this.i++]; } eof() { return this.i >= this.t.length; } }

// ── parser ────────────────────────────────────────────────────────────────────
function parseLine(tokens) {
  const c = new Cursor(tokens);
  const stmts = [];
  while (!c.eof()) {
    if (c.peek().k === 'colon') { c.next(); continue; }
    stmts.push(parseStatement(c));
    if (!c.eof() && c.peek().k === 'colon') c.next();
  }
  return stmts;
}

function parseStatement(c) {
  const tok = c.peek();
  if (!tok) return { t: 'rem' };
  // Bare line-number at statement start (GW-BASIC implicit-GOTO after THEN lineno spill).
  if (tok.k === 'num') { c.next(); return tok.v > 0 ? { t: 'goto', line: tok.v } : { t: 'rem' }; }
  if (tok.k === 'id') {
    const w = tok.v.toUpperCase();
    switch (w) {
      case 'REM': while (!c.eof()) c.next(); return { t: 'rem' };
      case 'THEN': c.next(); return { t: 'rem' }; // stray THEN at statement start — skip, parseLine re-enters for the following statement
      case 'COMMON': {
        c.next(); const vars = [], arrs = [];
        while (!c.eof() && c.peek().k !== 'colon') {
          const t = c.next();
          if (t.k === 'id') {
            if (c.peek() && c.peek().k === 'lp') { c.next(); if (c.peek() && c.peek().k === 'rp') c.next(); arrs.push(t.v); }  // COMMON A() → array
            else vars.push(t.v);
          }
        }
        return { t: 'common', vars, arrs };
      }
      case 'CLS': c.next(); return { t: 'cls' };
      case 'BEEP': c.next(); return { t: 'beep' };
      case 'END': c.next(); return { t: 'end' };
      case 'STOP': c.next(); return { t: 'end' };   // no direct mode / CONT here → halt like END
      case 'SYSTEM': c.next(); return { t: 'system' };
      case 'RETURN': c.next(); return { t: 'return' };
      case 'GOTO': c.next(); return { t: 'goto', line: c.next().v };
      case 'GOSUB': c.next(); return { t: 'gosub', line: c.next().v };
      case 'CHAIN': { c.next(); const _cn = parseExpr(c); while (!c.eof() && c.peek().k === 'comma') { c.next(); if (!c.eof() && c.peek().k !== 'colon' && c.peek().k !== 'comma') parseExpr(c); } return { t: 'chain', name: _cn }; }
      case 'COLOR': c.next(); return { t: 'color', args: parseExprList(c) };
      case 'LOCATE': c.next(); return { t: 'locate', args: parseExprList(c) };
      case 'PRINT': {
        c.next();
        if (c.peek() && c.peek().k === 'hash') { c.next(); const fileno = c.next().v; if (c.peek() && c.peek().k === 'comma') c.next(); const p = parsePrint(c, false); p.fileno = fileno; return p; } // PRINT #n,…
        return parsePrint(c, false);
      }
      case 'LPRINT': c.next(); return parsePrint(c, true);
      case 'INPUT': {
        c.next();
        if (c.peek() && c.peek().k === 'hash') {           // INPUT #n, var, var…  (sequential)
          c.next(); const fileno = c.next().v; if (c.peek() && c.peek().k === 'comma') c.next();
          const _pv = () => { const nm = c.next().v; if (c.peek() && c.peek().k === 'lp') { c.next(); const idx = [parseExpr(c)]; while (c.peek() && c.peek().k === 'comma') { c.next(); idx.push(parseExpr(c)); } c.next(); return { name: nm, idx }; } return nm; };
          const vars = [_pv()]; while (!c.eof() && c.peek().k === 'comma') { c.next(); vars.push(_pv()); }
          return { t: 'finput', fileno, vars };
        }
        return parseInput(c);
      }
      case 'IF': c.next(); return parseIf(c);
      case 'LET': c.next(); return parseAssign(c);
      case 'ON': {
        c.next();
        if (kw(c.peek(), 'ERROR')) { c.next(); if (kw(c.peek(), 'GOTO')) c.next(); return { t: 'onerror', line: c.next().v }; } // ON ERROR GOTO n (0 disables)
        const evt = c.peek();
        if (evt && evt.k === 'id' && /^(KEY|TIMER|COM|PEN|PLAY|STRIG)$/.test(evt.v.toUpperCase())) {  // ON KEY/TIMER(n) GOSUB line
          const ev = c.next().v.toUpperCase(); let n = null;
          if (c.peek() && c.peek().k === 'lp') { c.next(); n = parseExpr(c); if (c.peek() && c.peek().k === 'rp') c.next(); }
          if (kw(c.peek(), 'GOSUB')) c.next();
          return { t: 'ontrap', ev, n, line: c.next().v };
        }
        const e = parseExpr(c); const verb = c.next(); const gosub = !!verb && verb.v && verb.v.toUpperCase() === 'GOSUB'; const lines = [c.next().v]; while (!c.eof() && c.peek().k === 'comma') { c.next(); lines.push(c.next().v); } return { t: 'on', expr: e, lines, gosub };
      }
      case 'ERROR': { c.next(); return { t: 'raiseerror', code: parseExpr(c) }; }
      case 'RESUME': {
        c.next(); let mode = 'retry', line = null;
        if (kw(c.peek(), 'NEXT')) { c.next(); mode = 'next'; }
        else if (!c.eof() && c.peek().k === 'num') { const n = c.next().v; if (n !== 0) { mode = 'line'; line = n; } }
        return { t: 'resume', mode, line };
      }
      case 'OPEN': return parseOpen(c);
      case 'FIELD': return parseField(c);
      case 'GET': { c.next(); if (c.peek() && (c.peek().k === 'lp' || kw(c.peek(), 'STEP'))) { const p1 = parseCoord(c); if (c.peek() && c.peek().k === 'op' && c.peek().v === '-') c.next(); const p2 = parseCoord(c); if (c.peek() && c.peek().k === 'comma') c.next(); return { t: 'gget', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, arr: c.next().v }; } skipHash(c); const fileno = c.next().v; if (!c.eof() && c.peek().k === 'comma') c.next(); return { t: 'get', fileno, rec: parseExpr(c) }; }
      case 'PUT': { c.next(); if (c.peek() && (c.peek().k === 'lp' || kw(c.peek(), 'STEP'))) { const p = parseCoord(c); if (c.peek() && c.peek().k === 'comma') c.next(); const arr = c.next().v; let pmode = null; if (c.peek() && c.peek().k === 'comma') { c.next(); pmode = c.next().v; } return { t: 'gput', x: p.x, y: p.y, arr, pmode }; } skipHash(c); const fileno = c.next().v; if (!c.eof() && c.peek().k === 'comma') c.next(); return { t: 'put', fileno, rec: parseExpr(c) }; }
      case 'CLOSE': { c.next(); skipHash(c); let fileno = null; if (!c.eof() && c.peek().k === 'num') fileno = c.next().v; return { t: 'close', fileno }; }
      case 'KILL': { c.next(); return { t: 'kill', name: parseExpr(c) }; }
      case 'NAME': { c.next(); const from = parseExpr(c); if (kw(c.peek(), 'AS')) c.next(); return { t: 'name', from, to: parseExpr(c) }; }
      case 'LSET': case 'RSET': { c.next(); const name = c.next().v; c.next(); return { t: 'lset', name, right: w === 'RSET', expr: parseExpr(c) }; }
      case 'SWAP': { c.next(); const sv = () => { const nm = c.next().v; if (c.peek() && c.peek().k === 'lp') { c.next(); const idx = [parseExpr(c)]; while (c.peek() && c.peek().k === 'comma') { c.next(); idx.push(parseExpr(c)); } c.next(); return { nm, idx }; } return nm; }; const a = sv(); if (!c.eof() && c.peek().k === 'comma') c.next(); return { t: 'swap', a, b: sv() }; }
      case 'DATA': { c.next(); return { t: 'data', values: parseDataItems(c) }; }  // consumes rest of line
      case 'READ': { c.next(); const rv = () => { const nm = c.next().v; if (c.peek() && c.peek().k === 'lp') { c.next(); const idx = [parseExpr(c)]; while (c.peek() && c.peek().k === 'comma') { c.next(); idx.push(parseExpr(c)); } c.next(); return { nm, idx }; } return nm; }; const vars = [rv()]; while (!c.eof() && c.peek().k === 'comma') { c.next(); vars.push(rv()); } return { t: 'read', vars }; }
      case 'RESTORE': { c.next(); let line = null; if (!c.eof() && c.peek().k === 'num') line = c.next().v; return { t: 'restore', line }; }
      case 'WRITE': { c.next(); let fileno = null; if (c.peek() && c.peek().k === 'hash') { c.next(); fileno = c.next().v; if (c.peek() && c.peek().k === 'comma') c.next(); } const vals = []; if (!c.eof() && c.peek().k !== 'colon') { vals.push(parseExpr(c)); while (!c.eof() && c.peek().k === 'comma') { c.next(); vals.push(parseExpr(c)); } } return { t: 'write', vals, fileno }; }
      case 'FOR': { c.next(); const v = c.next().v; c.next(); const from = parseExpr(c); /*TO*/ c.next(); const to = parseExpr(c); let step = { t: 'num', v: 1 }; if (kw(c.peek(), 'STEP')) { c.next(); step = parseExpr(c); } return { t: 'for', var: v, from, to, step }; }
      case 'NEXT': { c.next(); let _nc = 0; while (!c.eof() && c.peek().k === 'id') { c.next(); _nc++; if (c.peek() && c.peek().k === 'comma') c.next(); } return { t: 'next', count: Math.max(1, _nc) }; }
      case 'WHILE': { c.next(); return { t: 'while', cond: parseExpr(c) }; }
      case 'WEND': { c.next(); return { t: 'wend' }; }
      case 'DIM': {
        c.next(); const decls = [];
        while (true) {
          const nm = c.next().v; c.next(); /*lp*/ const dims = [parseExpr(c)];
          while (c.peek() && c.peek().k === 'comma') { c.next(); dims.push(parseExpr(c)); }
          c.next(); /*rp*/ decls.push({ name: nm, dims });
          if (!c.eof() && c.peek().k === 'comma') { c.next(); continue; }
          break;
        }
        return { t: 'dim', decls };
      }
      case 'ERASE': { c.next(); const names = [c.next().v]; while (!c.eof() && c.peek().k === 'comma') { c.next(); names.push(c.next().v); } return { t: 'erase', names }; }
      case 'DEF': {
        c.next();
        if (kw(c.peek(), 'SEG') || kw(c.peek(), 'USR')) {
          const isUsr = kw(c.peek(), 'USR');
          c.next(); let val = null;
          if (c.peek() && c.peek().k === 'op' && c.peek().v === '=') { c.next(); val = parseExpr(c); }
          if (isUsr) return { t: 'rem' };
          return { t: 'defseg', val };   // DEF SEG [= expr]
        }
        let fname = c.next().v.toUpperCase();               // FNxxx  (or "FN" then the name, if spaced)
        if (fname === 'FN' && c.peek() && c.peek().k === 'id') fname = 'FN' + c.next().v.toUpperCase();
        let params = [];
        if (c.peek() && c.peek().k === 'lp') { c.next(); if (c.peek().k !== 'rp') { params.push(c.next().v); while (c.peek() && c.peek().k === 'comma') { c.next(); params.push(c.next().v); } } c.next(); /*rp*/ }
        c.next(); /* '=' */
        return { t: 'deffn', name: fname, params, body: parseExpr(c) };
      }
      case 'OPTION': { c.next(); if (kw(c.peek(), 'BASE')) c.next(); return { t: 'optionbase', n: c.next().v }; }
      case 'POKE': { c.next(); parseExpr(c); if (!c.eof() && c.peek().k === 'comma') c.next(); parseExpr(c); return { t: 'rem' }; } // POKE addr,val — no-op in browser
      case 'OUT': { c.next(); parseExpr(c); if (!c.eof() && c.peek().k === 'comma') c.next(); parseExpr(c); return { t: 'rem' }; } // OUT port,val — no-op
      case 'WAIT': { c.next(); while (!c.eof() && c.peek().k !== 'colon') c.next(); return { t: 'rem' }; } // WAIT port,mask — no-op
      case 'CLEAR': { c.next(); while (!c.eof() && c.peek().k !== 'colon') c.next(); return { t: 'clear' }; } // size args ignored
      case 'RANDOMIZE': { c.next(); let seed = null; if (!c.eof() && c.peek().k !== 'colon') seed = parseExpr(c); return { t: 'randomize', seed }; }
      case 'DEFINT': case 'DEFSNG': case 'DEFDBL': case 'DEFSTR': {
        const ty = w === 'DEFINT' ? 'int' : w === 'DEFSTR' ? 'str' : w === 'DEFDBL' ? 'dbl' : 'sng';
        c.next(); const ranges = [];
        while (!c.eof() && c.peek().k !== 'colon') {
          const lo = c.next().v[0].toUpperCase(); let hi = lo;
          if (c.peek() && c.peek().k === 'op' && c.peek().v === '-') { c.next(); hi = c.next().v[0].toUpperCase(); }
          ranges.push([lo, hi]);
          if (c.peek() && c.peek().k === 'comma') c.next();
        }
        return { t: 'deftype', ty, ranges };
      }
      case 'WIDTH': {
        c.next();
        if (c.peek() && c.peek().k === 'str') { while (!c.eof() && c.peek().k !== 'colon') c.next(); return { t: 'rem' }; } // WIDTH "device",n — ignore
        const cols = parseExpr(c);
        while (!c.eof() && c.peek().k !== 'colon') c.next();
        return { t: 'width', cols };
      }
      case 'KEY': {
        c.next();
        if (c.peek() && c.peek().k === 'lp') { c.next(); const n = parseExpr(c); if (c.peek() && c.peek().k === 'rp') c.next(); return { t: 'trapstate', ev: 'KEY', n, state: (c.next().v || '').toUpperCase() }; } // KEY(n) ON/OFF/STOP
        while (!c.eof() && c.peek().k !== 'colon') c.next(); return { t: 'rem' };  // KEY ON/OFF (soft-key line) / KEY n,str$ — no-op
      }
      case 'TIMER': { c.next(); const t = c.peek(); if (t && t.k === 'id' && /^(ON|OFF|STOP)$/i.test(t.v)) { c.next(); return { t: 'trapstate', ev: 'TIMER', n: null, state: t.v.toUpperCase() }; } while (!c.eof() && c.peek().k !== 'colon') c.next(); return { t: 'rem' }; }
      case 'STRIG': case 'PEN': case 'COM': c.next(); while (!c.eof() && c.peek().k !== 'colon') c.next(); return { t: 'rem' };  // hardware traps — accepted, inert
      case 'TRON': c.next(); return { t: 'tron', on: true };
      case 'TROFF': c.next(); return { t: 'tron', on: false };
      case 'SOUND': { c.next(); const freq = parseExpr(c); if (c.peek() && c.peek().k === 'comma') c.next(); const dur = parseExpr(c); return { t: 'sound', freq, dur }; }
      case 'PLAY': { c.next(); const t = c.peek(); if (t && t.k === 'id' && /^(ON|OFF|STOP)$/i.test(t.v)) { c.next(); return { t: 'rem' }; } return { t: 'play', str: parseExpr(c) }; } // PLAY ON/OFF (trap) inert; else music
      case 'DRAW': { c.next(); return { t: 'draw', str: parseExpr(c) }; }
      case 'SCREEN': { c.next(); const mode = parseExpr(c); while (!c.eof() && c.peek().k !== 'colon') c.next(); return { t: 'gscreen', mode }; }
      case 'PSET': case 'PRESET': { const preset = w === 'PRESET'; c.next(); const p = parseCoord(c); let color = null; if (c.peek() && c.peek().k === 'comma') { c.next(); color = parseExpr(c); } return { t: 'pset', preset, x: p.x, y: p.y, step: p.step, color }; }
      case 'CIRCLE': {
        c.next(); const p = parseCoord(c); if (c.peek() && c.peek().k === 'comma') c.next(); const r = parseExpr(c);
        const opt = () => { if (c.peek() && c.peek().k === 'comma') { c.next(); const nx = c.peek(); if (!nx || nx.k === 'comma' || nx.k === 'colon' || kw(nx, 'PRINT')) return null; return parseExpr(c); } return null; };
        const color = opt(), start = opt(), end = opt(), aspect = opt();
        return { t: 'circle', x: p.x, y: p.y, r, color, start, end, aspect };
      }
      case 'PAINT': { c.next(); const p = parseCoord(c); let color = null, border = null; if (c.peek() && c.peek().k === 'comma') { c.next(); if (!(c.peek() && c.peek().k === 'comma')) color = parseExpr(c); } if (c.peek() && c.peek().k === 'comma') { c.next(); border = parseExpr(c); } return { t: 'paint', x: p.x, y: p.y, color, border }; }
      case 'PALETTE': { c.next(); if (c.eof() || c.peek().k === 'colon') return { t: 'palette', attr: null, col: null }; const attr = parseExpr(c); if (c.peek() && c.peek().k === 'comma') c.next(); const col = parseExpr(c); return { t: 'palette', attr, col }; }
      case 'WINDOW': { c.next(); if (c.eof() || c.peek().k === 'colon') return { t: 'gwindow', x1: null }; if (kw(c.peek(), 'SCREEN')) c.next(); const p1 = parseCoord(c); if (c.peek() && c.peek().k === 'op' && c.peek().v === '-') c.next(); const p2 = parseCoord(c); return { t: 'gwindow', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }; }
      case 'VIEW': {
        c.next();
        if (kw(c.peek(), 'PRINT')) { while (!c.eof() && c.peek().k !== 'colon') c.next(); return { t: 'viewprint' }; }
        if (c.eof() || c.peek().k === 'colon') return { t: 'gview', x1: null };
        if (kw(c.peek(), 'SCREEN')) c.next();
        const p1 = parseCoord(c); if (c.peek() && c.peek().k === 'op' && c.peek().v === '-') c.next(); const p2 = parseCoord(c);
        return { t: 'gview', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
      }
      case 'RESET': c.next(); return { t: 'close', fileno: null };   // RESET = close all open files
      case 'FILES': { c.next(); let pat = null; if (!c.eof() && c.peek().k !== 'colon') pat = parseExpr(c); return { t: 'files', pat }; }
      case 'LINE': {
        c.next();
        if (kw(c.peek(), 'INPUT')) {                       // LINE INPUT [;]["prompt";] var$  /  LINE INPUT #n, var$
          c.next();
          if (c.peek() && c.peek().k === 'hash') { c.next(); const fileno = c.next().v; if (c.peek() && c.peek().k === 'comma') c.next(); return { t: 'flineinput', fileno, var: c.next().v }; }
          if (c.peek() && c.peek().k === 'semi') c.next();  // leading ';' (suppress CR) — ignored
          let prompt = null;
          if (c.peek() && c.peek().k === 'str') { prompt = c.next().v; if (!c.eof() && (c.peek().k === 'semi' || c.peek().k === 'comma')) c.next(); }
          if (c.peek() && c.peek().k === 'id') return { t: 'lineinput', prompt, var: c.next().v };
        }
        // graphics: LINE [(x1,y1)]-(x2,y2) [,color [,B|BF]]
        let x1 = null, y1 = null, step1 = false;
        if (c.peek() && (c.peek().k === 'lp' || kw(c.peek(), 'STEP'))) { const p = parseCoord(c); x1 = p.x; y1 = p.y; step1 = p.step; }
        if (c.peek() && c.peek().k === 'op' && c.peek().v === '-') c.next();
        const p2 = parseCoord(c); let color = null, box = '';
        if (c.peek() && c.peek().k === 'comma') { c.next(); if (!(c.peek() && c.peek().k === 'comma')) color = parseExpr(c); }
        if (c.peek() && c.peek().k === 'comma') { c.next(); if (c.peek() && c.peek().k === 'id') box = c.next().v.toUpperCase(); }
        return { t: 'gline', x1, y1, step1, x2: p2.x, y2: p2.y, step2: p2.step, color, box };
      }
      case 'RUN': {
        c.next();
        if (!c.eof() && c.peek().k !== 'colon') {
          const _ra = parseExpr(c);
          // RUN "file" → chain to another .BAS; RUN lineNum → restart current program
          if (_ra.t === 'str') return { t: 'chain', name: _ra };
          return { t: 'run' };
        }
        return { t: 'run' };
      }
      case 'LOAD': { c.next(); let _lf = null; if (!c.eof() && c.peek().k !== 'colon') _lf = parseExpr(c); while (!c.eof() && c.peek().k !== 'colon') c.next(); return _lf ? { t: 'chain', name: _lf } : { t: 'run' }; } // LOAD "file"[,R] — treat as CHAIN
      case 'CALL': { c.next(); while (!c.eof() && c.peek().k !== 'colon') c.next(); return { t: 'rem' }; } // machine-code CALL — no-op
      case 'BLOAD': case 'BSAVE': { c.next(); while (!c.eof() && c.peek().k !== 'colon') c.next(); return { t: 'rem' }; } // binary file load/save — no-op in browser
      case 'MID$': {
        // MID$(var$, pos[, len]) = expr — in-place string replacement (length unchanged)
        c.next(); // consume MID$
        if (c.peek() && c.peek().k === 'lp') {
          c.next(); // (
          const vname = c.next().v; // variable name
          if (c.peek() && c.peek().k === 'comma') c.next();
          const pos = parseExpr(c);
          let len = null;
          if (c.peek() && c.peek().k === 'comma') { c.next(); if (c.peek() && c.peek().k !== 'rp') len = parseExpr(c); }
          if (c.peek() && c.peek().k === 'rp') c.next(); // )
          if (c.peek() && c.peek().k === 'op' && c.peek().v === '=') c.next(); // =
          return { t: 'midassign', var: vname, pos, len, expr: parseExpr(c) };
        }
        return { t: 'rem' };
      }
    }
    return parseAssign(c);  // id not in switch → variable assignment
  }
  // Non-id, non-num token at statement start (structural leak): skip it.
  c.next(); return { t: 'rem' };
}

function parseAssign(c) {
  const name = c.next().v;
  let index = null;
  if (c.peek() && c.peek().k === 'lp') {                 // indexed lvalue: A(i[,j…]) = expr
    c.next(); index = [parseExpr(c)];
    while (c.peek() && c.peek().k === 'comma') { c.next(); index.push(parseExpr(c)); }
    c.next(); // rp
  }
  c.next(); // '='
  return { t: 'assign', name, index, expr: parseExpr(c) };
}

// DATA items — comma-separated, consuming the rest of the (logical) line, as GW-BASIC does.
// A datum's value: a lone number → Number; a leading-minus number → negative; a quoted string →
// its text; anything else (unquoted, possibly multi-token) → joined token text. Empty → "".
function parseDataItems(c) {
  const vals = []; let cur = [];
  const flush = () => { vals.push(datumValue(cur)); cur = []; };
  while (!c.eof()) { if (c.peek().k === 'comma') { c.next(); flush(); } else cur.push(c.next()); }
  flush();
  return vals;
}
function datumValue(toks) {
  if (toks.length === 0) return '';
  if (toks.length === 1 && toks[0].k === 'num') return toks[0].v;
  if (toks.length === 2 && toks[0].k === 'op' && toks[0].v === '-' && toks[1].k === 'num') return -toks[1].v;
  if (toks.length === 1 && toks[0].k === 'str') return toks[0].v;
  return toks.map((t) => (t.k === 'str' ? t.v : t.v !== undefined ? String(t.v) : '')).join('');
}

// Comma-separated expression list (COLOR/LOCATE). Empty slots (e.g. COLOR ,7) → null.
function parseExprList(c) {
  const args = [];
  if (c.eof() || c.peek().k === 'colon') return args;
  args.push(c.peek().k === 'comma' ? null : parseExpr(c));
  while (!c.eof() && c.peek().k === 'comma') { c.next(); args.push((c.eof() || c.peek().k === 'colon' || c.peek().k === 'comma') ? null : parseExpr(c)); }
  return args;
}

function parseOpen(c) {
  c.next(); let nameExpr = parseExpr(c); let fileno = 1, len = 0, mode = 'random';
  // Old-style: OPEN "I",#n,"filename" — detect single mode-letter as first arg
  if (nameExpr.t === 'str' && /^[IiOoRrAaBb]$/.test(nameExpr.v)) {
    const ml = nameExpr.v.toUpperCase();
    mode = ml === 'I' ? 'input' : ml === 'O' ? 'output' : ml === 'A' ? 'append' : 'random';
    if (c.peek() && c.peek().k === 'comma') c.next();
    skipHash(c); if (!c.eof() && c.peek().k === 'num') fileno = c.next().v;
    if (c.peek() && c.peek().k === 'comma') c.next();
    nameExpr = parseExpr(c);
  }
  while (!c.eof() && c.peek().k !== 'colon') {
    const t = c.next();
    if (t.k === 'hash') { fileno = c.next().v; }                  // AS #n
    else if (t.k === 'id' && t.v.toUpperCase() === 'AS') { skipHash(c); fileno = c.next().v; }
    else if (t.k === 'id' && t.v.toUpperCase() === 'LEN') { if (c.peek() && c.peek().k === 'op' && c.peek().v === '=') c.next(); len = c.next().v; }
    else if (t.k === 'id' && t.v.toUpperCase() === 'FOR') { const m = c.next().v.toUpperCase(); mode = m === 'INPUT' ? 'input' : m === 'OUTPUT' ? 'output' : m === 'APPEND' ? 'append' : 'random'; }
  }
  return { t: 'open', name: nameExpr, fileno, len, mode };
}

// Graphics coordinate "(x,y)" with optional STEP (relative) prefix.
function parseCoord(c) {
  let step = false;
  if (kw(c.peek(), 'STEP')) { c.next(); step = true; }
  c.next(); /*lp*/ const x = parseExpr(c); c.next(); /*comma*/ const y = parseExpr(c); c.next(); /*rp*/
  return { x, y, step };
}

function parseField(c) {
  c.next(); skipHash(c); const fileno = c.next().v; const defs = [];
  while (!c.eof() && c.peek().k === 'comma') { c.next(); const len = c.next().v; c.next(); /*AS*/ const name = c.next().v; defs.push({ len, name }); }
  return { t: 'field', fileno, defs };
}

// PRINT [lead items: TAB()/SPC()/exprs] [USING fmt; values]. USING may follow leading
// positional items (e.g. PRINT TAB(14) USING "####";CVI(NO$)).
function parsePrint(c, lpr) {
  const lead = []; let using = null; const vals = []; let trailing = null;
  while (!c.eof() && c.peek().k !== 'colon') {
    if (kw(c.peek(), 'USING')) {
      c.next(); using = parseExpr(c); if (c.peek() && c.peek().k === 'semi') c.next();
      while (!c.eof() && c.peek().k !== 'colon') {
        vals.push(parseExpr(c));
        if (!c.eof() && (c.peek().k === 'semi' || c.peek().k === 'comma')) trailing = c.next().k === 'semi' ? ';' : ','; else { trailing = null; break; }
      }
      break;
    }
    if (kw(c.peek(), 'ELSE') || kw(c.peek(), 'THEN')) break; // stop before ELSE/THEN so IF…THEN PRINT…ELSE works
    if (kw(c.peek(), 'TAB') || kw(c.peek(), 'SPC')) { const fn = c.next().v.toUpperCase(); c.next(); const e = parseExpr(c); c.next(); lead.push({ kind: fn === 'TAB' ? 'tab' : 'spc', expr: e }); }
    else lead.push({ kind: 'expr', expr: parseExpr(c) });
    if (!c.eof() && (c.peek().k === 'semi' || c.peek().k === 'comma')) trailing = c.next().k === 'semi' ? ';' : ','; else trailing = null;
  }
  return { t: 'print', lpr, lead, using, vals, trailing };
}

function parseInput(c) {
  let prompt = null, sep = null;
  if (c.peek() && c.peek().k === 'semi') c.next(); // INPUT ; prefix (suppress newline) — ignored
  if (c.peek() && c.peek().k === 'str') { prompt = c.next().v; if (c.peek() && (c.peek().k === 'semi' || c.peek().k === 'comma')) sep = c.next().k === 'semi' ? ';' : ','; }
  const pv = () => { const nm = c.next().v; if (c.peek() && c.peek().k === 'lp') { c.next(); const idx = [parseExpr(c)]; while (c.peek() && c.peek().k === 'comma') { c.next(); idx.push(parseExpr(c)); } c.next(); return { name: nm, idx }; } return nm; };
  const vars = [pv()];
  while (!c.eof() && c.peek().k === 'comma') { c.next(); vars.push(pv()); }
  return { t: 'input', prompt, sep, vars };
}

function parseIf(c) {
  const cond = parseExpr(c);
  if (kw(c.peek(), 'THEN')) c.next();
  const thenB = parseBranch(c, true);
  let elseB = [];
  if (kw(c.peek(), 'ELSE')) { c.next(); elseB = parseBranch(c, false); }
  return { t: 'if', cond, then: thenB, else: elseB };
}

function parseBranch(c, stopAtElse) {
  if (c.peek() && c.peek().k === 'num') {
    const r = [{ t: 'goto', line: c.next().v }];
    // When in THEN context, consume trailing ':' so parseIf can find ELSE directly.
    if (stopAtElse) while (c.peek() && c.peek().k === 'colon') c.next();
    return r;
  }
  const stmts = [];
  while (!c.eof()) {
    if (c.peek().k === 'colon') { c.next(); continue; }
    if (stopAtElse && kw(c.peek(), 'ELSE')) break;
    stmts.push(parseStatement(c));
    if (!c.eof() && c.peek().k === 'colon') { c.next(); continue; }
    break;
  }
  return stmts;
}

// expression parser (precedence: OR<AND<NOT<rel<+-<MOD<*/<unary<^<primary)
function parseExpr(c) { return pImp(c); }
function pImp(c) { let l = pEqv(c); while (kw(c.peek(), 'IMP')) { c.next(); l = { t: 'bin', op: 'IMP', l, r: pEqv(c) }; } return l; }
function pEqv(c) { let l = pXor(c); while (kw(c.peek(), 'EQV')) { c.next(); l = { t: 'bin', op: 'EQV', l, r: pXor(c) }; } return l; }
function pXor(c) { let l = pOr(c); while (kw(c.peek(), 'XOR')) { c.next(); l = { t: 'bin', op: 'XOR', l, r: pOr(c) }; } return l; }
function pOr(c) { let l = pAnd(c); while (kw(c.peek(), 'OR')) { c.next(); l = { t: 'bin', op: 'OR', l, r: pAnd(c) }; } return l; }
function pAnd(c) { let l = pNot(c); while (kw(c.peek(), 'AND')) { c.next(); l = { t: 'bin', op: 'AND', l, r: pNot(c) }; } return l; }
function pNot(c) { if (kw(c.peek(), 'NOT')) { c.next(); return { t: 'un', op: 'NOT', e: pNot(c) }; } return pRel(c); }
function pRel(c) { let l = pAdd(c); while (c.peek() && c.peek().k === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(c.peek().v)) { const op = c.next().v; l = { t: 'bin', op, l, r: pAdd(c) }; } return l; }
function pAdd(c) { let l = pMod(c); while (c.peek() && c.peek().k === 'op' && (c.peek().v === '+' || c.peek().v === '-')) { const op = c.next().v; l = { t: 'bin', op, l, r: pMod(c) }; } return l; }
function pMod(c) { let l = pIntDiv(c); while (kw(c.peek(), 'MOD')) { c.next(); l = { t: 'bin', op: 'MOD', l, r: pIntDiv(c) }; } return l; }
function pIntDiv(c) { let l = pMul(c); while (c.peek() && c.peek().k === 'op' && c.peek().v === '\\') { c.next(); l = { t: 'bin', op: '\\', l, r: pMul(c) }; } return l; }
function pMul(c) { let l = pUnary(c); while (c.peek() && c.peek().k === 'op' && (c.peek().v === '*' || c.peek().v === '/')) { const op = c.next().v; l = { t: 'bin', op, l, r: pUnary(c) }; } return l; }
function pUnary(c) {
  if (c.peek() && c.peek().k === 'op' && c.peek().v === '+') { c.next(); return pUnary(c); }
  if (c.peek() && c.peek().k === 'op' && c.peek().v === '-') { c.next(); return { t: 'un', op: '-', e: pUnary(c) }; }
  return pPow(c);
}
// ^ binds tighter than unary minus (so -2^2 = -4), left-associative (2^3^2 = 64, as GW-BASIC),
// and the exponent may carry a leading sign (2^-3 = .125).
function pPow(c) {
  let l = pPrim(c);
  while (c.peek() && c.peek().k === 'op' && c.peek().v === '^') {
    c.next();
    let r;
    if (c.peek() && c.peek().k === 'op' && c.peek().v === '-') { c.next(); r = { t: 'un', op: '-', e: pPrim(c) }; }
    else r = pPrim(c);
    l = { t: 'bin', op: '^', l, r };
  }
  return l;
}
function pPrim(c) {
  const tok = c.next();
  if (!tok) return { t: 'num', v: 0 };
  if (tok.k === 'num') return { t: 'num', v: tok.v };
  if (tok.k === 'str') return { t: 'str', v: tok.v };
  if (tok.k === 'lp') { const e = parseExpr(c); c.next(); return e; }
  if (tok.k === 'id') {
    if (c.peek() && c.peek().k === 'lp') { c.next(); const args = []; if (c.peek().k !== 'rp') { args.push(parseExpr(c)); while (c.peek().k === 'comma') { c.next(); args.push(parseExpr(c)); } } c.next(); return { t: 'call', name: tok.v.toUpperCase(), args }; }
    return { t: 'var', name: tok.v };
  }
  return { t: 'num', v: 0 };
}

// ── byte-string <-> display helpers (KU42) ────────────────────────────────────
function ku42Display(s) {
  let r = '';
  for (const ch of s) {
    const b = ch.charCodeAt(0);
    if (b === 0 || b === 0x20 || b === 0xa0) r += ' ';
    else if (b === 0x16) r += '▬';          // CHR$(22) — divider bar (CP437 graphic)
    else if (b < 0x20) { /* other control (bell, FF): no glyph */ }
    else if (b < 0x80) r += ch;
    else r += KU42_TO_UTF8[b] ?? ch;
  }
  return r;
}
function ku42Encode(u) {
  let r = '';
  for (const ch of u) { const cp = ch.codePointAt(0); if (cp < 0x80) r += String.fromCharCode(cp); else if (UTF8_TO_KU42[ch] !== undefined) r += String.fromCharCode(UTF8_TO_KU42[ch]); else r += '?'; }
  return r;
}

// Pluggable codec wrappers. Forks can set window._bas_codec = { display(s), encode(s) }
// for a custom encoding (e.g. Shift-JIS). null = passthrough (raw bytes). undefined = KU42.
function applyDisplay(s) {
  if (window._bas_codec === null) return s;
  return (window._bas_codec?.display ?? ku42Display)(s);
}
function applyEncode(s) {
  if (window._bas_codec === null) return s;
  return (window._bas_codec?.encode ?? ku42Encode)(s);
}
const bytesOf = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0xff);
const strOf = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

// Names handled by call(). Any other id(args…) is an array reference (GW-BASIC has no other
// user-callable functions except DEF FN's FNxxx), so this set is how eval tells them apart.
const BUILTINS = new Set([
  'INT', 'ABS', 'SQR', 'SIN', 'COS', 'TAN', 'ATN', 'LOG', 'EXP', 'SGN', 'FIX', 'RND',
  'CINT', 'CSNG', 'CDBL', 'LEN', 'VAL', 'CHR$', 'STR$', 'RIGHT$', 'LEFT$', 'MID$',
  'STRING$', 'SPACE$', 'ASC', 'INSTR', 'HEX$', 'OCT$',
  'CVI', 'MKI$', 'CVS', 'MKS$', 'CVD', 'MKD$', 'INKEY$', 'FRE', 'POS', 'EOF', 'LOF', 'LOC',
  'POINT', 'PMAP', 'SCREEN',
  'PEEK', 'INP', 'VARPTR', 'VARPTR$', 'USR',
]);

// DEFtype → suffix used by setVar/getVar for default-typed (suffixless) variables.
const DEF2SUF = { int: '%', str: '$', dbl: '#', sng: '!' };

// Emit a raw GW-BASIC byte string to a screen sink, interpreting control chars
// (CHR$ 7-13, 28-31) as cursor/screen commands before the display codec runs.
// Only the printable byte segments go through applyDisplay.
function putCtrl(sink, raw) {
  let seg = '';
  const flush = () => { if (seg) { sink.put(applyDisplay(seg)); seg = ''; } };
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    switch (c) {
      case  7: flush(); beep(); break;
      case  8: case 29: flush(); sink.cursorLeft?.();  break;  // BS / cursor-left
      case 10: flush(); sink.newline();                break;  // LF
      case 11: flush(); sink.locate?.(1, 1);           break;  // VT → home
      case 12: flush(); sink.cls?.();                  break;  // FF → clear screen
      case 13: flush(); sink.locate?.(null, 1);        break;  // CR
      case 28: flush(); sink.cursorRight?.();          break;
      case 30: flush(); sink.cursorUp?.();             break;
      case 31: flush(); sink.cursorDown?.();           break;
      default: seg += raw[i];
    }
  }
  flush();
}

// ── interpreter ───────────────────────────────────────────────────────────────
class Basic {
  constructor(screen, term, loader) { this.s = screen; this.term = term; this.loader = loader; this.vars = {}; this.arrays = {}; this.optionBase = 0; this.defType = {}; this.fns = {}; this.files = {}; this.printer = new ReportPrinter(); this.commonVars = new Set(); this.commonArrs = new Set(); this.onPrintReady = null; this.audio = null; this.gfx = null; this.rndState = 0x2545f4914f6cdd1d & 0xffffffff; this.rndLast = 0; this.onErrorLine = 0; this.errCode = 0; this.errLineNo = 0; this.errIp = 0; this.trace = false; this.defSeg = 0;
    this.trapKey = {}; this.trapKeyState = {}; this.timerLine = 0; this.timerSec = 0; this.timerState = 'OFF'; this.timerLast = 0; this.inTrap = false; this.anyTrapOn = false; this._inTrapChain = false; }

  _now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); } // overridable in tests
  _updateTrapFlag() { this.anyTrapOn = this.timerState === 'ON' || Object.keys(this.trapKeyState).some((k) => this.trapKeyState[k] === 'ON'); }
  // Called between statements (top level only) when a trap is armed: returns a handler line to
  // implicit-GOSUB, or 0. TIMER fires every n seconds; ON KEY(n) fires on a trapped function key.
  _checkTraps() {
    if (this.timerState === 'ON' && this.timerSec > 0) {
      const now = this._now();
      if (now - this.timerLast >= this.timerSec * 1000) { this.timerLast = now; return this.timerLine; }
    }
    if (this.term && this.term._trapBuf) {
      // Scan trap buffer: consume ON keys (fire), discard OFF keys, leave STOP keys deferred.
      const buf = this.term._trapBuf;
      for (let i = 0; i < buf.length; i++) {
        const k = buf[i];
        if (this.trapKeyState[k] === 'ON' && this.trapKey[k]) { buf.splice(i, 1); return this.trapKey[k]; }
        if (this.trapKeyState[k] !== 'STOP') { buf.splice(i, 1); i--; } // OFF or no handler: discard
        // STOP: leave in buffer, it will fire when KEY(n) ON is next called
      }
    }
    return 0;
  }

  // Seedable PRNG (mulberry32) behind RND. Fixed default seed → same sequence every run, as
  // GW-BASIC; RANDOMIZE / RND(neg) reseed it. rndLast lets RND(0) repeat the previous value.
  rnd() { let t = (this.rndState += 0x6d2b79f5) >>> 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); this.rndLast = ((t ^ (t >>> 14)) >>> 0) / 4294967296; return this.rndLast; }
  seedRnd(n) { this.rndState = (Math.floor(Math.abs(num(n))) >>> 0) || 1; }

  // GW-BASIC: A%, A#, A$ are distinct variables; A and A! are the same (single).
  // So keep %/#/$ in the key; '!' or no suffix collapse to the bare name.
  varKey(name) {
    const m = name.match(/^([A-Za-z][A-Za-z0-9._]*)([%!#$]?)$/);
    const base = m[1].toUpperCase(), suf = m[2];
    return (suf === '$' || suf === '%' || suf === '#') ? base + suf : base;
  }
  findField(name) { for (const fn in this.files) { const f = this.files[fn]; if (f.fields && name in f.fields) return { f, ...f.fields[name] }; } return null; }
  // LSET/RSET: place a value into a FIELD buffer, space-padded to the field width. LSET
  // left-justifies (pads right); RSET right-justifies (pads left). Overlong values truncate.
  // For a non-field name, both just assign the variable.
  fieldSet(name, s, right) {
    const fv = this.findField(name);
    if (!fv) { this.setVar(name, s); return; }
    const L = fv.len, n = Math.min(s.length, L), pad = right ? L - n : 0;
    for (let i = 0; i < L; i++) { const si = i - pad; fv.f.buffer[fv.start + i] = (si >= 0 && si < n) ? s.charCodeAt(si) & 0xff : 0x20; }
  }
  getVar(name) {
    const fv = this.findField(name);
    if (fv) return strOf(fv.f.buffer.subarray(fv.start, fv.start + fv.len));
    const k = this.varKey(name);
    if (k in this.vars) return this.vars[k];
    return (k.endsWith('$') || this.defType[name[0].toUpperCase()] === 'str') ? '' : 0; // default value by type
  }
  // Coerce on store by the variable's type: explicit suffix wins; otherwise the DEFtype default
  // for its first letter (empty unless a DEFINT/DEFSTR/… ran), else single (number stored as-is).
  setVar(name, val) {
    if (typeof name !== 'string' || name.length === 0) return;
    const last = name[name.length - 1];
    let ty = (last === '%' || last === '$' || last === '#' || last === '!') ? last : DEF2SUF[this.defType[name[0].toUpperCase()]];
    const k = this.varKey(name);
    this.vars[k] = ty === '%' ? Math.trunc(num(val)) : ty === '$' ? String(val) : val;
  }

  // ── arrays ──────────────────────────────────────────────────────────────────
  // Arrays live in their own namespace (GW-BASIC: scalar A and array A() are distinct). Keyed
  // by varKey so A%(), A$(), A() are separate. dims = upper bounds; lower bound = OPTION BASE.
  allocArray(name, dims) {
    const key = this.varKey(name), base = this.optionBase;
    const sizes = dims.map((d) => Math.floor(num(d)) - base + 1);
    const strides = new Array(sizes.length); let tot = 1;
    for (let i = sizes.length - 1; i >= 0; i--) { strides[i] = tot; tot *= sizes[i]; }
    this.arrays[key] = { base, strides, data: new Array(tot).fill((key.endsWith('$') || this.defType[name[0].toUpperCase()] === 'str') ? '' : 0) };
  }
  _arr(name, n) {                                  // fetch, auto-dimensioning to 10 per axis if unseen
    const key = this.varKey(name);
    if (!this.arrays[key]) this.allocArray(name, new Array(n).fill(10));
    return this.arrays[key];
  }
  _off(arr, idxs) { let o = 0; for (let i = 0; i < idxs.length; i++) o += (Math.floor(num(idxs[i])) - arr.base) * arr.strides[i]; return o; }
  getArr(name, idxs) { const arr = this._arr(name, idxs.length); return arr.data[this._off(arr, idxs)]; }
  setArr(name, idxs, val) { const arr = this._arr(name, idxs.length); const k = this.varKey(name); const _ty = k.endsWith('%') ? '%' : k.endsWith('$') ? '$' : DEF2SUF[this.defType[name[0].toUpperCase()]]; arr.data[this._off(arr, idxs)] = _ty === '%' ? Math.trunc(num(val)) : _ty === '$' ? String(val) : val; }

  // ── DEF FN user functions ─────────────────────────────────────────────────────
  // Single-line functions. Params shadow same-named globals for the duration of the call, then
  // restore (GW-BASIC's DEF FN params are not truly local, but this matches observable behaviour).
  _fnEnter(fn, args) { const saved = {}; fn.params.forEach((p, i) => { const k = this.varKey(p); saved[k] = this.vars[k]; this.setVar(p, args[i]); }); return saved; }
  _fnExit(fn, saved) { fn.params.forEach((p) => { const k = this.varKey(p); if (saved[k] === undefined) delete this.vars[k]; else this.vars[k] = saved[k]; }); }
  callFn(name, args) { const fn = this.fns[name]; const saved = this._fnEnter(fn, args); const r = this.evlS(fn.body); this._fnExit(fn, saved); return r; }
  async callFnAsync(name, args) { const fn = this.fns[name]; const saved = this._fnEnter(fn, args); const r = await this.evl(fn.body); this._fnExit(fn, saved); return r; }

  async runText(text) {
    // A GW-BASIC logical line may wrap across several physical lines: only the first starts
    // with a line number, the continuations don't. Join each continuation onto the current
    // numbered line before parsing (e.g. CHQ03A line 230's IF…THEN spans two physical lines).
    const lines = [];
    for (const raw of text.split(/\r?\n/)) {
      const t = raw.replace(/\s+$/, '');
      if (/^\s*\d+/.test(t)) lines.push(t.trim());
      else if (lines.length && t.trim()) lines[lines.length - 1] += ' ' + t.trim();
    }
    const parsed = lines.map((l) => { const m = l.match(/^(\d+)\s?(.*)$/); return { line: +m[1], stmts: parseLine(tokenize(m[2])) }; });
    parsed.sort((a, b) => a.line - b.line);
    this.flat = []; this.lineStart = {}; this.flatLines = [];
    for (const p of parsed) { this.lineStart[p.line] = this.flat.length; for (const st of p.stmts) { this.flat.push(st); this.flatLines.push(p.line); } }

    // DATA pool: every DATA item in line order, with its line# (so RESTORE n can re-seek). READ
    // consumes from here; RESTORE rewinds the pointer.
    this.dataPool = []; this.dataLines = []; this.dataPtr = 0;
    for (const p of parsed) for (const st of p.stmts) if (st.t === 'data') for (const v of st.values) { this.dataPool.push(v); this.dataLines.push(p.line); }

    // Pre-register DEF FN definitions so a call before its DEF line still resolves (and so FNxxx
    // is never mistaken for an array).
    for (const p of parsed) for (const st of p.stmts) if (st.t === 'deffn') this.fns[st.name] = { params: st.params, body: st.body };

    // Pair WHILE/WEND by flat index for O(1) jumps (re-evaluating the condition at the WHILE each
    // pass). Nesting handled by a stack. Inline WHILE inside an IF branch is not paired (rare).
    const wstk = [];
    for (let i = 0; i < this.flat.length; i++) {
      const s = this.flat[i];
      if (s.t === 'while') wstk.push(i);
      else if (s.t === 'wend') { const w = wstk.pop(); if (w != null) { this.flat[w].wendIp = i; s.whileIp = w; } }
    }

    this.go = (ln) => { if (!(ln in this.lineStart)) throw new Error('Undefined line ' + ln); return this.lineStart[ln]; };
    this.onErrorLine = 0;  // ON ERROR / traps do not carry over across CHAIN (GW-BASIC behaviour)
    this.trapKey = {}; this.trapKeyState = {}; this.anyTrapOn = false; this.inTrap = false; this._inTrapChain = false;
    this.timerLine = 0; this.timerSec = 0; this.timerState = 'OFF';
    return this.run(0, false);
  }

  // ── Synchronous fast path ─────────────────────────────────────────────────
  // evlS/execS/runS/runStatementsS mirror evl/exec/run/runStatements but run WITHOUT await.
  // Any blocking op returns the _S sentinel, and the async run() falls back to await exec()
  // for just that statement. This removes per-statement async overhead from scan loops.

  evlS(n) {
    if (n == null) return 0;                                       // null/undefined slot (e.g. LOCATE ,col or COLOR ,bg)
    switch (n.t) {
      case 'num': return n.v;
      case 'str': return n.v;
      case 'var': {
        const up = n.name.toUpperCase();
        if (up === 'INKEY$') return _S;                            // polling INKEY$ needs async yield
        if (up === 'RND') return this.rnd();                       // bare RND (no parens)
        if (up === 'ERR') return this.errCode;
        if (up === 'ERL') return this.errLineNo;
        if (up === 'CSRLIN') return this.s.row;                    // current cursor row (1-based)
        const clk = clockVar(up); if (clk !== undefined) return clk;  // TIMER / DATE$ / TIME$
        return this.getVar(n.name);
      }
      case 'un': { const e = this.evlS(n.e); if (e === _S) return _S; return n.op === '-' ? -num(e) : ~i16(e); }
      case 'call': {
        if (n.name === 'INPUT$') return _S;                         // blocking key read
        const a = []; for (const x of n.args) { const v = this.evlS(x); if (v === _S) return _S; a.push(v); }
        if (BUILTINS.has(n.name)) return this.call(n.name, a);
        if (this.fns[n.name]) { const r = this.callFn(n.name, a); return r; }   // DEF FN user function
        return this.getArr(n.name, a);                             // else array element
      }
      case 'bin': { const l = this.evlS(n.l); if (l === _S) return _S; const r = this.evlS(n.r); if (r === _S) return _S; return this.bin(n.op, l, r); }
    }
    return 0;
  }

  execS(st) {
    switch (st.t) {
      case 'rem': return null;
      case 'common': this.commonVars = new Set(st.vars.map((v) => this.varKey(v))); this.commonArrs = new Set((st.arrs || []).map((v) => this.varKey(v))); return null;
      case 'cls': if (this.gfx && this.gfx.active()) { this.gfx.cls(); this.s.clearTransparent(); } else this.s.cls(); return null;
      case 'beep': beep(); return null;
      case 'end': return { t: 'end' };
      case 'system': return { t: 'system' };
      case 'return': return { t: 'return' };
      case 'run': return { t: 'run' };
      case 'goto': return { t: 'goto', line: st.line };
      case 'next': return { t: 'next', count: st.count };
      // gosub recurses into a subroutine that may block partway; defer to the async path so a
      // blocking op there can't cause partial re-execution.
      case 'gosub': return _S;
      case 'color': { const a = this.evlS(st.args[0]); if (a === _S) return _S; const b = st.args[1] != null ? this.evlS(st.args[1]) : null; if (b === _S) return _S; if (this.gfx && this.gfx.active()) this.gfx.color(num(a), b != null ? num(b) : null); else this.s.color(num(a), b != null ? num(b) : null); return null; } // graphics: COLOR = background,palette (text stays white)
      case 'locate': { const a = st.args[0] != null ? this.evlS(st.args[0]) : null; if (a === _S) return _S; const b = st.args[1] != null ? this.evlS(st.args[1]) : null; if (b === _S) return _S; this.s.locate(a != null ? num(a) : null, b != null ? num(b) : null); if (st.args[2] != null) { const cv = this.evlS(st.args[2]); if (cv !== _S) this.s.setCursorVisible(num(cv) !== 0); } return null; }
      case 'assign': {
        const v = this.evlS(st.expr); if (v === _S) return _S;
        if (st.index) { const idx = []; for (const e of st.index) { const iv = this.evlS(e); if (iv === _S) return _S; idx.push(iv); } this.setArr(st.name, idx, v); }
        else this.setVar(st.name, v);
        return null;
      }
      case 'dim': { for (const d of st.decls) { const dims = []; for (const e of d.dims) { const v = this.evlS(e); if (v === _S) return _S; dims.push(v); } this.allocArray(d.name, dims); } return null; }
      case 'erase': { for (const nm of st.names) delete this.arrays[this.varKey(nm)]; return null; }
      case 'defseg': { const v = st.val != null ? this.evlS(st.val) : null; if (v === _S) return _S; this.defSeg = v != null ? num(v) : 0; return null; }
      case 'optionbase': this.optionBase = num(st.n); return null;
      case 'deftype': { for (const [lo, hi] of st.ranges) for (let ch = lo.charCodeAt(0); ch <= hi.charCodeAt(0); ch++) this.defType[String.fromCharCode(ch)] = st.ty; return null; }
      case 'tron': this.trace = st.on; return null;
      case 'ontrap': {
        if (st.ev === 'TIMER') { this.timerLine = st.line; const s = this.evlS(st.n); if (s === _S) return _S; this.timerSec = num(s); }
        else if (st.ev === 'KEY') { const k = this.evlS(st.n); if (k === _S) return _S; const kn = num(k); this.trapKey[kn] = st.line; if (!(kn in this.trapKeyState)) this.trapKeyState[kn] = 'OFF'; }
        return null;                                               // COM/PEN/PLAY/STRIG: registered but inert (no hardware)
      }
      case 'trapstate': {
        if (st.ev === 'TIMER') { this.timerState = st.state; if (st.state === 'ON') this.timerLast = this._now(); }
        else if (st.ev === 'KEY') { const k = this.evlS(st.n); if (k === _S) return _S; this.trapKeyState[num(k)] = st.state; }
        this._updateTrapFlag(); return null;
      }
      case 'onerror': this.onErrorLine = st.line; return null;     // 0 disables (re-enables default stop)
      case 'raiseerror': { const code = num(this.evlS(st.code)); const e = new Error('BASIC error ' + code); e.basCode = code; throw e; }
      case 'resume': return { t: 'resume', mode: st.mode, line: st.line };
      case 'randomize': { let s; if (st.seed) { const v = this.evlS(st.seed); if (v === _S) return _S; s = num(v); } else s = Date.now() & 0xffff; this.seedRnd(s); return null; } // bare RANDOMIZE seeds from clock (no prompt)
      case 'deffn': this.fns[st.name] = { params: st.params, body: st.body }; return null;
      case 'write': {                                    // comma-delimited; strings quoted, numbers raw
        if (st.fileno != null) return _S;                // file write → async
        const parts = [];
        for (const e of st.vals) { const v = this.evlS(e); if (v === _S) return _S; parts.push(typeof v === 'number' ? String(v) : '"' + applyDisplay(String(v)) + '"'); }
        this.s.put(parts.join(',')); this.s.newline(); this.s.render(); return null;
      }
      case 'swap': {
        const ei = (idx) => idx ? idx.map((e) => num(this.evlS(e))) : null;
        const gv = (v, i) => i ? this.getArr(v.nm, i) : this.getVar(v);
        const sv2 = (v, i, val) => { if (i) this.setArr(v.nm, i, val); else this.setVar(v, val); };
        const ia = ei(st.a.idx), ib = ei(st.b.idx);
        const va = gv(st.a, ia), vb = gv(st.b, ib);
        sv2(st.a, ia, vb); sv2(st.b, ib, va); return null;
      }
      case 'midassign': {
        const _mp = this.evlS(st.pos); if (_mp === _S) return _S;
        const _mr = this.evlS(st.expr); if (_mr === _S) return _S;
        const _ml = st.len != null ? this.evlS(st.len) : null; if (_ml === _S) return _S;
        const _ms = String(this.getVar(st.var));
        const _mp0 = Math.max(1, num(_mp)) - 1;
        const _mrs = String(_mr);
        const _mn = Math.max(0, Math.min(_ml != null ? num(_ml) : _mrs.length, _mrs.length, _ms.length - _mp0));
        this.setVar(st.var, _ms.slice(0, _mp0) + _mrs.slice(0, _mn) + _ms.slice(_mp0 + _mn));
        return null;
      }
      case 'data': return null;                          // collected at load; no-op at runtime
      case 'read': {
        for (const v of st.vars) {
          if (this.dataPtr >= this.dataPool.length) throw new Error('Out of DATA');
          const raw = this.dataPool[this.dataPtr++];
          if (typeof v === 'string') { const _rs = v.endsWith('$') || this.defType[v[0].toUpperCase()] === 'str'; this.setVar(v, _rs ? String(raw) : num(raw)); }
          else { const idx = []; for (const e of v.idx) { const iv = this.evlS(e); if (iv === _S) return _S; idx.push(num(iv)); } const _rs = v.nm.endsWith('$') || this.defType[v.nm[0].toUpperCase()] === 'str'; this.setArr(v.nm, idx, _rs ? String(raw) : num(raw)); }
        }
        return null;
      }
      case 'restore': {
        if (st.line == null) this.dataPtr = 0;
        else { let i = 0; while (i < this.dataLines.length && this.dataLines[i] < st.line) i++; this.dataPtr = i; }
        return null;
      }
      case 'on': {
        if (st.gosub) return _S;                                    // ON..GOSUB recurses → async path
        const idx = this.evlS(st.expr); if (idx === _S) return _S; const i = num(idx);
        if (i < 1 || i > st.lines.length) return null;
        return { t: 'goto', line: st.lines[i - 1] };
      }
      case 'print': return (st.fileno != null || this._inTrapChain) ? _S : this.doPrintS(st);   // file print or trap-chain → async (trap-chain adds yield for laser animation)
      case 'for': { const f = this.evlS(st.from); if (f === _S) return _S; const t = this.evlS(st.to); if (t === _S) return _S; const sp = this.evlS(st.step); if (sp === _S) return _S; return { t: 'for', var: st.var, from: num(f), to: num(t), step: num(sp) }; }
      case 'while': { const v = this.evlS(st.cond); if (v === _S) return _S; return { t: 'while', truth: truthy(v), node: st }; }
      case 'wend': return { t: 'wend', node: st };
      case 'field': { const f = this.files[st.fileno]; let start = 0; if (f) { f.fields = {}; for (const d of st.defs) { f.fields[d.name] = { start, len: d.len }; start += d.len; } } return null; }
      case 'get': { const rec = this.evlS(st.rec); if (rec === _S) return _S; const f = this.files[st.fileno]; const off = (num(rec) - 1) * f.recSize; for (let i = 0; i < f.recSize; i++) f.buffer[i] = f.data[off + i] || 0; return null; }
      // NOTE: 'close' is intentionally NOT handled here — it must defer to async closeFile()
      // (below, via _S) so buffered scratch files get flushed to disk. See the _S list.
      case 'lset': {
        const val = this.evlS(st.expr); if (val === _S) return _S;
        this.fieldSet(st.name, String(val), st.right);
        return null;
      }
      case 'if': {
        const c = this.evlS(st.cond); if (c === _S) return _S;
        const branch = truthy(c) ? st.then : st.else;
        if (!branchIsPure(branch)) return _S;            // any blocking op in the branch → async (avoids partial re-exec)
        return this.runStatementsS(branch);
      }
      // Blocking / async-only (disk I/O or input):
      case 'input': case 'lineinput': case 'finput': case 'flineinput': case 'open': case 'put': case 'chain': case 'close': case 'kill': case 'name': case 'clear': case 'sound': case 'play': case 'files': return _S;
    }
    return _S; // unknown → let async exec handle it
  }

  doPrintS(st) {
    const sink = st.lpr ? this.printer : this.s;
    for (const it of st.lead) {
      if (it.kind === 'tab') { const v = this.evlS(it.expr); if (v === _S) return _S; sink.tab(num(v)); }
      else if (it.kind === 'spc') { const v = this.evlS(it.expr); if (v === _S) return _S; st.lpr ? sink.spaces(num(v)) : sink.put(' '.repeat(num(v))); }
      else { const v = this.evlS(it.expr); if (v === _S) return _S; if (typeof v === 'number') sink.put(basicPrintNum(v)); else if (st.lpr) sink.put(v); else putCtrl(sink, v); }
    }
    if (st.using != null) {
      const mask = this.evlS(st.using); if (mask === _S) return _S;
      const vals = []; for (const e of st.vals) { const v = this.evlS(e); if (v === _S) return _S; vals.push(v); }
      if (st.lpr) sink.breakSeg();
      sink.put(formatUsing(String(mask), vals));
    }
    if (st.trailing !== ';') sink.newline();
    if (!st.lpr) sink.render();
    return null;
  }

  runStatementsS(stmts) {
    const loops = []; let i = 0;
    while (i < stmts.length) {
      const st = stmts[i];
      if (st.t === 'for') {
        if (stmts[i + 1] && stmts[i + 1].t === 'next') return _S; // delay loop → async
        const from = this.evlS(st.from); if (from === _S) return _S;
        const to = this.evlS(st.to); if (to === _S) return _S;
        const step = this.evlS(st.step); if (step === _S) return _S;
        let _sfi = loops.length - 1; while (_sfi >= 0 && loops[_sfi].var !== st.var) _sfi--; if (_sfi >= 0) loops.splice(_sfi);
        this.setVar(st.var, num(from)); loops.push({ var: st.var, to: num(to), step: num(step), body: i + 1 }); i++; continue;
      }
      if (st.t === 'next') {
        const _nc = st.count || 1; let _nb = false;
        for (let _ni = 0; _ni < _nc; _ni++) {
          const f = loops[loops.length - 1];
          if (!f) return { t: 'next', count: _nc - _ni, remainder: stmts.slice(i + 1) }; // no local FOR — bubble up; remainder runs if outer loop exhausts
          const nv = num(this.getVar(f.var)) + f.step; this.setVar(f.var, nv);
          if ((f.step >= 0 && nv <= f.to) || (f.step < 0 && nv >= f.to)) { i = f.body; _nb = true; break; }
          loops.pop();
        }
        if (!_nb) i++;
        continue;
      }
      const ctl = this.execS(st); if (ctl === _S) return _S; if (ctl) return ctl; i++;
    }
    return null;
  }

  // Execute from a flat index. GOSUB recurses (so the rest of an IF…THEN branch resumes
  // after RETURN); a recursive call with stopOnReturn=true returns on RETURN. FOR/NEXT use a
  // loop stack local to each invocation. Returns the terminating signal (end/system/chain).
  async run(fromIp, stopOnReturn, escapeBelow = -1) {
    const loops = []; let ip = fromIp; let lastYield = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    while (ip < this.flat.length) {
      const cur = this.flat[ip];
      // Keep the UI responsive on long synchronous scans: yield to the event loop every ~50ms.
      // Each run() invocation (outer loop or GOSUB) has its own lastYield, so quick subroutines
      // never trigger an actual await — only a loop that truly runs >50ms in one call will yield.
      if (nowMs() - lastYield > 50) { await new Promise((r) => setTimeout(r)); lastYield = nowMs(); }
      // Event traps (ON KEY / ON TIMER): between statements, if armed, fire the handler as an
      // implicit GOSUB. Fires inside GOSUBs too (GW-BASIC does); inTrap blocks re-entry.
      if (!this.inTrap && this.anyTrapOn) {
        const tl = this._checkTraps();
        if (tl) {
          this.inTrap = true; this._inTrapChain = true;
          try { const tr = await this.run(this.go(tl), true, tl); if (tr && (tr.t === 'end' || tr.t === 'system' || tr.t === 'chain')) return tr; if (tr && tr.t === 'goto') { ip = this.go(tr.line); } }
          finally { this.inTrap = false; this._inTrapChain = false; }
          continue;
        }
      }
      // TRON: print [line] as each new line is entered.
      if (this.trace && (ip === 0 || this.flatLines[ip] !== this.flatLines[ip - 1])) { this.s.put('[' + this.flatLines[ip] + ']'); this.s.render(); }
      // ON ERROR trap: if an error handler is armed, a thrown error jumps to it (recording ERR/ERL
      // and the statement ip for RESUME) instead of aborting. Only at top level (not in GOSUB).
      try {
      // Fast path: run a single statement synchronously. Skip it for statements that recurse
      // into a subroutine (gosub / on..gosub) or an empty-body delay FOR — those must use the
      // async path so a blocking op inside them doesn't cause partial re-execution.
      const skipFast = cur.t === 'gosub' || (cur.t === 'on' && cur.gosub) ||
        (cur.t === 'for' && this.flat[ip + 1] && this.flat[ip + 1].t === 'next');
      if (!skipFast) {
        const sr = this.execS(cur);
        if (sr !== _S) {
          if (!sr) { ip++; continue; }
          if (sr.t === 'goto') { if (escapeBelow >= 0 && sr.line < escapeBelow) return { t: 'goto', line: sr.line }; const _bms = window._bas_clockMs ?? 33; if (sr.line < this.flatLines[ip] && _bms > 0) { await new Promise((r) => setTimeout(r, _bms)); lastYield = nowMs(); } ip = this.go(sr.line); continue; }
          if (sr.t === 'return') { if (stopOnReturn) return { t: 'return' }; ip++; continue; }
          if (sr.t === 'end' || sr.t === 'system' || sr.t === 'chain') return sr;
          if (sr.t === 'run') { this.vars = {}; this.arrays = {}; this.dataPtr = 0; this.onErrorLine = 0; loops.length = 0; if (this.gfx && this.gfx.active()) { this.gfx.screen(0); this.s.gfx = null; this.s.color(7, 0); this.s.cls(); } ip = 0; continue; }
          if (sr.t === 'for') { let _sfi = loops.length - 1; while (_sfi >= 0 && loops[_sfi].var !== sr.var) _sfi--; if (_sfi >= 0) loops.splice(_sfi); this.setVar(sr.var, sr.from); loops.push({ var: sr.var, to: sr.to, step: sr.step, body: ip + 1 }); ip++; continue; }
          if (sr.t === 'next') {
            const _nc = sr.count || 1; let _nb = false;
            for (let _ni = 0; _ni < _nc; _ni++) {
              const f = loops[loops.length - 1]; if (!f) break;
              const nv = num(this.getVar(f.var)) + f.step; this.setVar(f.var, nv);
              if ((f.step >= 0 && nv <= f.to) || (f.step < 0 && nv >= f.to)) { ip = f.body; _nb = true; break; }
              loops.pop();
            }
            if (!_nb) ip++;
            continue;
          }
          if (sr.t === 'while') { ip = sr.truth ? ip + 1 : (sr.node.wendIp != null ? sr.node.wendIp + 1 : ip + 1); continue; }
          if (sr.t === 'wend') { ip = sr.node.whileIp != null ? sr.node.whileIp : ip + 1; continue; }
          if (sr.t === 'resume') { ip = sr.mode === 'next' ? this.errIp + 1 : sr.mode === 'line' ? this.go(sr.line) : this.errIp; continue; }
          ip++; continue;
        }
      }
      const ctl = await this.exec(this.flat[ip]);
      if (!ctl) { ip++; continue; }
      switch (ctl.t) {
        case 'goto': if (escapeBelow >= 0 && ctl.line < escapeBelow) return { t: 'goto', line: ctl.line }; { const _bms = window._bas_clockMs ?? 33; if (ctl.line < this.flatLines[ip] && _bms > 0) { await new Promise((r) => setTimeout(r, _bms)); lastYield = nowMs(); } } ip = this.go(ctl.line); break;
        case 'return': if (stopOnReturn) return { t: 'return' }; ip++; break;
        case 'end': return { t: 'end' };
        case 'system': return { t: 'system' };
        case 'chain': return ctl;
        case 'run': this.vars = {}; this.arrays = {}; this.dataPtr = 0; this.onErrorLine = 0; loops.length = 0; if (this.gfx && this.gfx.active()) { this.gfx.screen(0); this.s.gfx = null; this.s.color(7, 0); this.s.cls(); } ip = 0; break;
        case 'for':
          // Empty-body delay loop ("FOR x=a TO b : NEXT") — the original's ~1s pause idiom.
          // Run it as a real timed delay so flashed messages are readable.
          if (this.flat[ip + 1] && this.flat[ip + 1].t === 'next') { await sleep(delayMs(ctl.from, ctl.to)); ip += 2; break; }
          { let _sfi = loops.length - 1; while (_sfi >= 0 && loops[_sfi].var !== ctl.var) _sfi--; if (_sfi >= 0) loops.splice(_sfi); }
          this.setVar(ctl.var, ctl.from); loops.push({ var: ctl.var, to: ctl.to, step: ctl.step, body: ip + 1 }); ip++; break;
        case 'next': {
          const _nc = ctl.count || 1; let _nb = false;
          for (let _ni = 0; _ni < _nc; _ni++) {
            const f = loops[loops.length - 1]; if (!f) break;
            const nv = num(this.getVar(f.var)) + f.step; this.setVar(f.var, nv);
            if ((f.step >= 0 && nv <= f.to) || (f.step < 0 && nv >= f.to)) { ip = f.body; _nb = true; break; }
            loops.pop();
          }
          if (!_nb) {
            // When NEXT was inside an IF-THEN branch, the remainder of that branch runs now.
            // e.g. FOR I=1 TO N:IF C(I)<>0 THEN NEXT:GOSUB win:GOTO top — GOSUB win only fires
            // after the loop exhausts (all elements non-zero), matching GW-BASIC semantics.
            if (ctl.remainder?.length) {
              const _rem = await this.runStatements(ctl.remainder);
              if (_rem) {
                if (_rem.t === 'goto') { if (escapeBelow >= 0 && _rem.line < escapeBelow) return { t: 'goto', line: _rem.line }; ip = this.go(_rem.line); break; }
                if (_rem.t === 'return') { if (stopOnReturn) return { t: 'return' }; ip++; break; }
                if (_rem.t === 'end') return { t: 'end' };
                if (_rem.t === 'system') return { t: 'system' };
                if (_rem.t === 'chain') return _rem;
                if (_rem.t === 'run') { this.vars = {}; this.arrays = {}; this.dataPtr = 0; this.onErrorLine = 0; loops.length = 0; if (this.gfx && this.gfx.active()) { this.gfx.screen(0); this.s.gfx = null; this.s.color(7, 0); this.s.cls(); } ip = 0; break; }
              }
            }
            ip++;
          }
          break;
        }
        case 'while': ip = ctl.truth ? ip + 1 : (ctl.node.wendIp != null ? ctl.node.wendIp + 1 : ip + 1); break;
        case 'wend': ip = ctl.node.whileIp != null ? ctl.node.whileIp : ip + 1; break;
        case 'resume': ip = ctl.mode === 'next' ? this.errIp + 1 : ctl.mode === 'line' ? this.go(ctl.line) : this.errIp; break;
        default: ip++;
      }
      } catch (e) {
        if (!stopOnReturn && this.onErrorLine) {
          this.errCode = (e && e.basCode != null) ? e.basCode : 51;
          this.errLineNo = this.flatLines[ip]; this.errIp = ip;
          ip = this.go(this.onErrorLine); continue;
        }
        throw e;
      }
    }
    // Ran off the end of the program. Inside a GOSUB (stopOnReturn) this is an implicit RETURN —
    // GW-BASIC returns to the statement after the GOSUB rather than ending. Some .BAS rely on
    // this: PASSWORD.BAS's "Wrong password" subroutine (line 500) has no RETURN, and the caller's
    // next line (210 GOTO 160) must run to re-prompt. At top level, it's program end.
    return stopOnReturn ? { t: 'return' } : { t: 'end' };
  }

  // Execute a nested statement list (an IF…THEN/ELSE branch). Handles FOR/NEXT contained
  // within the branch locally; bubbles goto/return/end/chain to the caller.
  async runStatements(stmts) {
    const loops = []; let i = 0;
    while (i < stmts.length) {
      const st = stmts[i];
      if (st.t === 'for') {
        const from = num(await this.evl(st.from)), to = num(await this.evl(st.to));
        if (stmts[i + 1] && stmts[i + 1].t === 'next') { await sleep(delayMs(from, to)); i += 2; continue; } // empty-body delay loop
        let _sfi = loops.length - 1; while (_sfi >= 0 && loops[_sfi].var !== st.var) _sfi--; if (_sfi >= 0) loops.splice(_sfi);
        this.setVar(st.var, from); loops.push({ var: st.var, to, step: num(await this.evl(st.step)), body: i + 1 }); i++; continue;
      }
      if (st.t === 'next') {
        const _nc = st.count || 1; let _nb = false;
        for (let _ni = 0; _ni < _nc; _ni++) {
          const f = loops[loops.length - 1];
          if (!f) return { t: 'next', count: _nc - _ni, remainder: stmts.slice(i + 1) }; // no local FOR — bubble up; remainder runs if outer loop exhausts
          const nv = num(this.getVar(f.var)) + f.step; this.setVar(f.var, nv);
          if ((f.step >= 0 && nv <= f.to) || (f.step < 0 && nv >= f.to)) { i = f.body; _nb = true; break; }
          loops.pop();
        }
        if (!_nb) i++;
        continue;
      }
      const sr = this.execS(st);
      const ctl = sr === _S ? await this.exec(st) : sr;
      if (ctl) return ctl;
      i++;
    }
    return null;
  }

  async exec(st) {
    switch (st.t) {
      case 'rem': return null;
      case 'common': this.commonVars = new Set(st.vars.map((v) => this.varKey(v))); this.commonArrs = new Set((st.arrs || []).map((v) => this.varKey(v))); return null; // declares vars that survive CHAIN
      case 'cls': if (this.gfx && this.gfx.active()) { this.gfx.cls(); this.s.clearTransparent(); } else this.s.cls(); return null;
      case 'beep': beep(); return null;
      case 'end': return { t: 'end' };
      case 'system': return { t: 'system' };
      case 'return': return { t: 'return' };
      case 'run': return { t: 'run' };
      case 'goto': return { t: 'goto', line: st.line };
      case 'gosub': { const r = await this.run(this.go(st.line), true, this._inTrapChain ? st.line : -1); return r && (r.t === 'end' || r.t === 'system' || r.t === 'chain' || r.t === 'run' || r.t === 'goto') ? r : null; }
      case 'chain': {
        const name = String(await this.evl(st.name));
        const keepV = {}; for (const k of this.commonVars) if (k in this.vars) keepV[k] = this.vars[k];   // CHAIN passes ONLY
        const keepA = {}; for (const k of this.commonArrs) if (k in this.arrays) keepA[k] = this.arrays[k]; // the COMMON vars + arrays;
        this.vars = keepV; this.arrays = keepA;                                                            // everything else resets
        return { t: 'chain', name };
      }
      case 'color': { const fg = num(await this.evl(st.args[0])), bg = st.args[1] != null ? num(await this.evl(st.args[1])) : null; if (this.gfx && this.gfx.active()) this.gfx.color(fg, bg); else this.s.color(fg, bg); return null; }
      case 'locate': { const _lr = st.args[0] != null ? num(await this.evl(st.args[0])) : null; const _lc = st.args[1] != null ? num(await this.evl(st.args[1])) : null; this.s.locate(_lr, _lc); if (st.args[2] != null) this.s.setCursorVisible(num(await this.evl(st.args[2])) !== 0); return null; }
      case 'assign': {
        const v = await this.evl(st.expr);
        if (st.index) { const idx = []; for (const e of st.index) idx.push(await this.evl(e)); this.setArr(st.name, idx, v); }
        else this.setVar(st.name, v);
        return null;
      }
      case 'midassign': {
        const _mp = num(await this.evl(st.pos));
        const _mr = String(await this.evl(st.expr));
        const _ml = st.len != null ? num(await this.evl(st.len)) : null;
        const _ms = String(this.getVar(st.var));
        const _mp0 = Math.max(1, _mp) - 1;
        const _mn = Math.max(0, Math.min(_ml != null ? _ml : _mr.length, _mr.length, _ms.length - _mp0));
        this.setVar(st.var, _ms.slice(0, _mp0) + _mr.slice(0, _mn) + _ms.slice(_mp0 + _mn));
        return null;
      }
      case 'on': {
        const idx = num(await this.evl(st.expr));
        if (idx < 1 || idx > st.lines.length) return null;        // out of range → fall through
        const target = st.lines[idx - 1];
        if (!st.gosub) return { t: 'goto', line: target };
        const r = await this.run(this.go(target), true, this._inTrapChain ? target : -1);  // ON..GOSUB: call, then continue
        return r && (r.t === 'end' || r.t === 'system' || r.t === 'chain' || r.t === 'run' || r.t === 'goto') ? r : null;
      }
      case 'print': return st.fileno != null ? this.doFilePrint(st) : this.doPrint(st);
      case 'write': return this.doFileWrite(st);          // only reaches here when st.fileno set (else execS handles)
      case 'input': return this.doInput(st);
      case 'finput': return this.doFinput(st);
      case 'flineinput': { const f = this.files[st.fileno]; this.setVar(st.var, this.readLine(f)); return null; }
      case 'lineinput': {
        if (this.onPrintReady && !this.printer.isEmpty()) { this.onPrintReady(this.printer.lines); this.printer.reset(); }
        if (st.prompt != null) { this.s.put(applyDisplay(st.prompt)); this.s.render(); }
        const raw = await this.term.inputLine({ type: 'str', question: false }); // no '?' prompt; whole line
        this.setVar(st.var, applyEncode(raw));
        return null;
      }
      case 'for': return { t: 'for', var: st.var, from: num(await this.evl(st.from)), to: num(await this.evl(st.to)), step: num(await this.evl(st.step)) };
      case 'next': return { t: 'next', count: st.count };
      case 'while': return { t: 'while', truth: truthy(await this.evl(st.cond)), node: st };
      case 'wend': return { t: 'wend', node: st };
      case 'open': { const name = fileName(await this.evl(st.name)); await this.openFile(st.fileno, name, st.len, st.mode); return null; }
      case 'field': { const f = this.files[st.fileno]; let start = 0; if (f) { f.fields = {}; for (const d of st.defs) { f.fields[d.name] = { start, len: d.len }; start += d.len; } } return null; }
      case 'get': { const f = this.files[st.fileno]; const rec = num(await this.evl(st.rec)); const off = (rec - 1) * f.recSize; for (let i = 0; i < f.recSize; i++) f.buffer[i] = f.data[off + i] || 0; return null; }
      case 'put': {
        const f = this.files[st.fileno]; const rec = num(await this.evl(st.rec)); const off = (rec - 1) * f.recSize;
        if (off + f.recSize > f.data.length) { const nd = new Uint8Array(off + f.recSize); nd.set(f.data); f.data = nd; }
        f.data.set(f.buffer, off);                                   // update in-memory image
        if (f.isNew) { f.dirty = true; return null; }                // scratch file: defer to CLOSE (one flush)
        try {
          await writeRecord(f.name, rec, f.recSize, f.buffer.slice()); // existing file: real in-place write
        } catch (e) {
          console.error(`PUT ${f.name} rec=${rec} FAILED:`, e);
          this.s.locate(24, 1); this.s.color(15, 4); this.s.put(`WRITE FAILED rec ${rec}: ${e.message}`.slice(0, 79)); this.s.color(7, 0); this.s.render();
          throw e;
        }
        return null;
      }
      case 'close': return this.closeFile(st.fileno);
      case 'clear': { this.vars = {}; this.arrays = {}; await this.closeFile(null); this.trapKey = {}; this.trapKeyState = {}; this.anyTrapOn = false; if (this.term && this.term._trapBuf) this.term._trapBuf.length = 0; return null; } // reset state; size args no-op
      case 'sound': { const f = num(await this.evl(st.freq)), d = num(await this.evl(st.dur)); if (this.audio) await this.audio.sound(f, d); return null; }
      case 'play': { const s = String(await this.evl(st.str)); if (this.audio) await this.audio.play(s); return null; }
      case 'width': { const n = num(await this.evl(st.cols)); this.s.setTextCols(n === 40 ? 40 : 80); return null; }
      case 'gscreen': {
        const m = num(await this.evl(st.mode));
        // GFX modes with fixed hardware column width: SCREEN 1/7/13 = 40-col, SCREEN 2/9/10/11/12 = 80-col.
        // SCREEN 0 (text mode) does NOT change WIDTH — it preserves whatever WIDTH the program set.
        // setTextCols must run BEFORE gfx.screen() so _fit() sizes the canvas to match.
        if (m === 1 || m === 7 || m === 13) this.s.setTextCols(40);
        else if (m !== 0) this.s.setTextCols(80);
        if (this.gfx) this.gfx.screen(m);
        if (m === 0) { this.s.gfx = null; this.s.color(7, 0); this.s.cls(); }      // back to text: default grey/black
        else { this.s.gfx = this.gfx; this.s.color(m === 2 || m === 11 ? 1 : (m === 1 ? 3 : 15), 0); this.s.clearTransparent(); } // graphics: white text on bg 0, shared palette
        return null;
      }
      case 'pset': {
        if (!this.gfx) return null;
        let x = num(await this.evl(st.x)), y = num(await this.evl(st.y));
        if (st.step) { x += this.gfx.lastX; y += this.gfx.lastY; }
        const c = st.color != null ? num(await this.evl(st.color)) : null;
        st.preset ? this.gfx.preset(x, y, c) : this.gfx.pset(x, y, c); return null;
      }
      case 'gline': {
        if (!this.gfx) return null;
        let x1, y1;
        if (st.x1 != null) { x1 = num(await this.evl(st.x1)); y1 = num(await this.evl(st.y1)); if (st.step1) { x1 += this.gfx.lastX; y1 += this.gfx.lastY; } }
        else { x1 = this.gfx.lastX; y1 = this.gfx.lastY; }
        let x2 = num(await this.evl(st.x2)), y2 = num(await this.evl(st.y2)); if (st.step2) { x2 += x1; y2 += y1; }
        const c = st.color != null ? num(await this.evl(st.color)) : null;
        this.gfx.line(x1, y1, x2, y2, c, st.box); return null;
      }
      case 'circle': {
        if (!this.gfx) return null;
        const x = num(await this.evl(st.x)), y = num(await this.evl(st.y)), r = num(await this.evl(st.r));
        const c = st.color != null ? num(await this.evl(st.color)) : null;
        const start = st.start != null ? num(await this.evl(st.start)) : null;
        const end = st.end != null ? num(await this.evl(st.end)) : null;
        const aspect = st.aspect != null ? num(await this.evl(st.aspect)) : null;
        this.gfx.circle(x, y, r, c, start, end, aspect); return null;
      }
      case 'paint': {
        if (!this.gfx) return null;
        const x = num(await this.evl(st.x)), y = num(await this.evl(st.y));
        const c = st.color != null ? num(await this.evl(st.color)) : null;
        const b = st.border != null ? num(await this.evl(st.border)) : null;
        this.gfx.paint(x, y, c, b); return null;
      }
      case 'palette': { if (this.gfx) { if (st.attr == null) this.gfx.palette(); else this.gfx.palette(num(await this.evl(st.attr)), num(await this.evl(st.col))); } return null; }
      case 'gwindow': { if (this.gfx) { if (st.x1 == null) this.gfx.setWindow(); else this.gfx.setWindow(num(await this.evl(st.x1)), num(await this.evl(st.y1)), num(await this.evl(st.x2)), num(await this.evl(st.y2))); } return null; }
      case 'gview': { if (this.gfx) { if (st.x1 == null) this.gfx.setView(); else this.gfx.setView(num(await this.evl(st.x1)), num(await this.evl(st.y1)), num(await this.evl(st.x2)), num(await this.evl(st.y2))); } return null; }
      case 'gget': { if (this.gfx) { const img = this.gfx.getImage(num(await this.evl(st.x1)), num(await this.evl(st.y1)), num(await this.evl(st.x2)), num(await this.evl(st.y2))); (this.gfxStore || (this.gfxStore = {}))[this.varKey(st.arr)] = img; } return null; }
      case 'gput': { if (this.gfx) this.gfx.putImage(num(await this.evl(st.x)), num(await this.evl(st.y)), (this.gfxStore || {})[this.varKey(st.arr)], st.pmode); return null; }
      case 'draw': { if (this.gfx) this.gfx.draw(String(await this.evl(st.str))); return null; }
      case 'viewprint': return null;   // text scroll window — accepted, no-op on a fixed full screen
      case 'files': {
        let names = (typeof listFiles === 'function') ? await listFiles() : [];
        if (st.pat) { const p = String(await this.evl(st.pat)).toUpperCase().trim(); if (p && p !== '*.*' && p !== '*') names = names.filter((n) => matchPattern(n, p)); }
        for (let i = 0; i < names.length; i++) { this.s.put(names[i].padEnd(13).slice(0, 13)); if ((i + 1) % 5 === 0) this.s.newline(); }
        if (names.length % 5 !== 0 || names.length === 0) this.s.newline();
        this.s.render(); return null;
      }
      case 'onerror': this.onErrorLine = st.line; return null;
      case 'raiseerror': { const code = num(await this.evl(st.code)); const e = new Error('BASIC error ' + code); e.basCode = code; throw e; }
      case 'resume': return { t: 'resume', mode: st.mode, line: st.line };
      case 'lset': { this.fieldSet(st.name, String(await this.evl(st.expr)), st.right); return null; }
      case 'if': return this.runStatements(truthy(await this.evl(st.cond)) ? st.then : st.else);
      case 'kill': await kill(fileName(await this.evl(st.name))); return null;
      case 'name': await rename(fileName(await this.evl(st.from)), fileName(await this.evl(st.to))); return null;
    }
    return null;
  }

  // CLOSE: flush buffered output. Sequential OUTPUT/APPEND files write their whole text; a
  // scratch (newly-created) RANDOM file flushes its image; existing random files were written
  // in place per-record, so nothing to flush.
  async closeFile(fileno) {
    const flush = async (f) => {
      if (!f) return;
      if (f.mode === 'output' || f.mode === 'append') { if (f.dirty) { await writeWholeFile(f.name, bytesOf(f.out)); f.dirty = false; } }
      else if (f.isNew && f.dirty) { await writeWholeFile(f.name, f.data); f.dirty = false; }
    };
    if (fileno != null) { await flush(this.files[fileno]); delete this.files[fileno]; }
    else { for (const k of Object.keys(this.files)) await flush(this.files[k]); this.files = {}; }
    return null;
  }

  async openFile(fileno, name, recSize, mode = 'random') {
    if (!isConnected()) throw new Error(`Data folder not connected — click "Connect data folder" before opening ${name}.`);
    if (mode === 'input') {                                   // sequential read
      let data; try { data = await readFile(name); } catch { throw new Error('File not found: ' + name); }
      this.files[fileno] = { name, mode, data, pos: 0 };
    } else if (mode === 'output') {                           // sequential write (truncate)
      await openOrCreate(name);
      this.files[fileno] = { name, mode, out: '', dirty: true };

    } else if (mode === 'append') {                           // sequential write (append)
      let data; try { data = await readFile(name); } catch { data = new Uint8Array(0); await openOrCreate(name); }
      this.files[fileno] = { name, mode, out: strOf(data), dirty: true };
    } else {                                                  // random (record) file
      let data, isNew = false;
      try { data = await readFile(name); }                    // existing → in-place per-record writes
      catch { await openOrCreate(name); data = new Uint8Array(0); isNew = true; } // new scratch → flush on CLOSE
      this.files[fileno] = { name, mode: 'random', recSize, data, buffer: new Uint8Array(recSize), fields: {}, isNew, dirty: false };
    }
  }

  // ── sequential file text I/O ──────────────────────────────────────────────────
  fileAppend(fileno, text) { const f = this.files[fileno]; f.out += text; f.dirty = true; }
  // Read one whitespace/comma-delimited datum (or a "quoted string") from a FOR INPUT file.
  readDatum(f, isStr) {
    const d = f.data;
    while (f.pos < d.length && (d[f.pos] === 0x20 || d[f.pos] === 0x0d || d[f.pos] === 0x0a)) f.pos++;
    if (f.pos >= d.length) return isStr ? '' : 0;
    let s = '';
    if (d[f.pos] === 0x22) {                                  // quoted string
      f.pos++; while (f.pos < d.length && d[f.pos] !== 0x22) { s += String.fromCharCode(d[f.pos]); f.pos++; } f.pos++;
    } else {
      while (f.pos < d.length && d[f.pos] !== 0x2c && d[f.pos] !== 0x0d && d[f.pos] !== 0x0a) { s += String.fromCharCode(d[f.pos]); f.pos++; }
      s = s.trim();
    }
    if (f.pos < d.length && d[f.pos] === 0x2c) f.pos++;       // consume the field-separating comma
    return isStr ? s : (parseFloat(s) || 0);
  }
  readLine(f) {                                               // LINE INPUT# — whole line to CRLF
    const d = f.data; let s = '';
    while (f.pos < d.length && d[f.pos] !== 0x0d && d[f.pos] !== 0x0a) { s += String.fromCharCode(d[f.pos]); f.pos++; }
    if (f.pos < d.length && d[f.pos] === 0x0d) f.pos++;
    if (f.pos < d.length && d[f.pos] === 0x0a) f.pos++;
    return s;
  }
  async doFinput(st) {
    const f = this.files[st.fileno];
    for (const vn of st.vars) {
      const name = typeof vn === 'string' ? vn : vn.name;
      const val = this.readDatum(f, name.endsWith('$'));
      if (typeof vn === 'string') this.setVar(vn, val);
      else { const idx = []; for (const e of vn.idx) idx.push(num(await this.evl(e))); this.setArr(name, idx, val); }
    }
    return null;
  }
  async doFilePrint(st) {
    let buf = '', col = 1; const put = (s) => { buf += s; col += s.length; };
    for (const it of st.lead) {
      if (it.kind === 'tab') { const n = num(await this.evl(it.expr)); while (col < n) put(' '); }
      else if (it.kind === 'spc') put(' '.repeat(num(await this.evl(it.expr))));
      else { const v = await this.evl(it.expr); put(typeof v === 'number' ? basicPrintNum(v) : String(v)); }
    }
    if (st.using != null) { const mask = String(await this.evl(st.using)); const vals = []; for (const e of st.vals) vals.push(await this.evl(e)); put(formatUsing(mask, vals)); }
    if (st.trailing !== ';') buf += '\r\n';
    this.fileAppend(st.fileno, buf); return null;
  }
  async doFileWrite(st) {
    const parts = [];
    for (const e of st.vals) { const v = await this.evl(e); parts.push(typeof v === 'number' ? String(v) : '"' + String(v) + '"'); }
    this.fileAppend(st.fileno, parts.join(',') + '\r\n'); return null;
  }

  async doPrint(st) {
    if (st.lpr) return this.doLPrint(st);                 // LPRINT → report buffer, not the screen
    const s = this.s;
    for (const it of st.lead) {
      if (it.kind === 'tab') s.tab(num(await this.evl(it.expr)));
      else if (it.kind === 'spc') s.put(' '.repeat(num(await this.evl(it.expr))));
      else { const v = await this.evl(it.expr); if (typeof v === 'number') s.put(basicPrintNum(v)); else putCtrl(s, v); }
    }
    if (st.using != null) {
      const mask = String(await this.evl(st.using));
      const vals = [];
      for (const e of st.vals) vals.push(await this.evl(e));
      s.put(formatUsing(mask, vals));
    }
    if (st.trailing !== ';') s.newline();
    s.render();
    if (this._inTrapChain) await new Promise((r) => setTimeout(r, 5));
  }

  // LPRINT → the virtual printer. Raw values are passed through (the printer strips ESC/P,
  // ignores form feed, and KU42-decodes high bytes itself, so control codes survive detection).
  async doLPrint(st) {
    const p = this.printer;
    for (const it of st.lead) {
      if (it.kind === 'tab') p.tab(num(await this.evl(it.expr)));
      else if (it.kind === 'spc') p.spaces(num(await this.evl(it.expr)));
      else { const v = await this.evl(it.expr); p.put(typeof v === 'number' ? basicPrintNum(v) : v); }
    }
    if (st.using != null) {
      p.breakSeg();                          // the USING value is its own column
      const mask = String(await this.evl(st.using));
      const vals = [];
      for (const e of st.vals) vals.push(await this.evl(e));
      p.put(formatUsing(mask, vals));
    }
    if (st.trailing !== ';') p.newline();
  }

  async doInput(st) {
    // If a finished report is sitting in the printer buffer, flush it to preview BEFORE we
    // block for input. Matches the original "print a report, then loop back to the prompt"
    // screens (e.g. CHQ07B 1000→GOTO 140) — universal, no per-program special-casing.
    if (this.onPrintReady && !this.printer.isEmpty()) { this.onPrintReady(this.printer.lines); this.printer.reset(); }
    if (st.prompt != null) { this.s.put(applyDisplay(st.prompt)); this.s.render(); }
    for (const v of st.vars) {
      const name = typeof v === 'string' ? v : v.name;
      const type = name.endsWith('$') ? 'str' : name.endsWith('%') ? 'int' : 'num';
      const raw = await this.term.inputLine({ type: type === 'int' ? 'int' : type === 'num' ? 'num' : 'str', question: st.sep === ';' || st.prompt == null });
      const val = type === 'str' ? applyEncode(raw) : raw;
      if (typeof v === 'string') this.setVar(v, val);
      else { const idx = []; for (const e of v.idx) idx.push(num(await this.evl(e))); this.setArr(name, idx, val); }
    }
    return null;
  }

  async evl(n) {
    if (n == null) return 0;
    switch (n.t) {
      case 'num': return n.v;
      case 'str': return n.v;
      case 'var': {
        // INKEY$ polls; yield to the event loop so keydown can fire (the GW-BASIC
        // "T$=INKEY$:IF T$=\"\" THEN <loop>" wait-for-key idiom would otherwise hang).
        const up = n.name.toUpperCase();
        if (up === 'INKEY$') { await new Promise((r) => setTimeout(r, 4)); return this.term.inkey(); }
        if (up === 'RND') return this.rnd();                       // bare RND (no parens)
        if (up === 'ERR') return this.errCode;
        if (up === 'ERL') return this.errLineNo;
        if (up === 'CSRLIN') return this.s.row;                    // current cursor row (1-based)
        const clk = clockVar(up); if (clk !== undefined) return clk;  // TIMER / DATE$ / TIME$
        return this.getVar(n.name);
      }
      case 'un': { const _ue = await this.evl(n.e); return n.op === '-' ? -num(_ue) : ~i16(_ue); }
      case 'call': {
        const a = []; for (const x of n.args) a.push(await this.evl(x));
        // INPUT$(n): read exactly n keys (blocking) — used for single-key confirms (CHQ02 890).
        if (n.name === 'INPUT$') { const cnt = Math.max(1, num(a[0])); let r = ''; for (let i = 0; i < cnt; i++) r += await this.term.inputKey(); return r; }
        if (BUILTINS.has(n.name)) return this.call(n.name, a);
        if (this.fns[n.name]) return await this.callFnAsync(n.name, a);   // DEF FN user function
        return this.getArr(n.name, a);                             // else array element
      }
      case 'bin': return this.bin(n.op, await this.evl(n.l), await this.evl(n.r));
    }
    return 0;
  }

  bin(op, l, r) {
    switch (op) {
      case '+': return (typeof l === 'string' || typeof r === 'string') ? String(l) + String(r) : l + r;
      case '-': return num(l) - num(r); case '*': return num(l) * num(r); case '/': return num(l) / num(r); case '\\': return Math.trunc(num(l) / num(r));
      case 'MOD': return Math.trunc(num(l)) % Math.trunc(num(r));
      case '^': return Math.pow(num(l), num(r));
      case '=': return l === r ? -1 : 0; case '<>': return l !== r ? -1 : 0;
      case '<': return l < r ? -1 : 0; case '>': return l > r ? -1 : 0;
      case '<=': return l <= r ? -1 : 0; case '>=': return l >= r ? -1 : 0;
      // GW-BASIC bitwise ops: truncate to 16-bit signed integer first
      case 'AND': return i16(l) & i16(r); case 'OR': return i16(l) | i16(r);
      case 'XOR': return i16(l) ^ i16(r);
      case 'EQV': return ~(i16(l) ^ i16(r));
      case 'IMP': return (~i16(l)) | i16(r);
    }
    return 0;
  }

  call(name, a) {
    switch (name) {
      case 'INT': return Math.floor(num(a[0])); case 'ABS': return Math.abs(num(a[0]));
      case 'SQR': return Math.sqrt(num(a[0]));
      case 'SIN': return Math.sin(num(a[0])); case 'COS': return Math.cos(num(a[0])); case 'TAN': return Math.tan(num(a[0]));
      case 'ATN': return Math.atan(num(a[0]));
      case 'LOG': return Math.log(num(a[0])); case 'EXP': return Math.exp(num(a[0]));
      case 'SGN': return Math.sign(num(a[0])); case 'FIX': return Math.trunc(num(a[0]));
      case 'RND': { const x = a.length ? num(a[0]) : 1; if (x < 0) { this.seedRnd(x); return this.rnd(); } if (x === 0) return this.rndLast; return this.rnd(); }
      case 'CINT': return cint(num(a[0]));     // round to nearest int, ties to even (GW-BASIC)
      case 'CSNG': return Math.fround(num(a[0])); // collapse to single precision
      case 'CDBL': return num(a[0]);           // already double in JS
      case 'LEN': return String(a[0]).length;
      case 'VAL': return parseFloat(String(a[0]).replace(/\s+/g, '')) || 0; // GW-BASIC VAL ignores all spaces
      case 'CHR$': return String.fromCharCode(num(a[0]) & 0xff);
      case 'STR$': return num(a[0]) >= 0 ? ' ' + fmtNum(num(a[0])) : fmtNum(num(a[0]));
      case 'RIGHT$': return String(a[0]).slice(-num(a[1])); case 'LEFT$': return String(a[0]).slice(0, num(a[1]));
      case 'MID$': { const _s = String(a[0]), _p = num(a[1]) - 1; if (_p < 0) return ''; return _s.substr(_p, a[2] != null ? num(a[2]) : undefined); }
      case 'STRING$': return (typeof a[1] === 'number' ? String.fromCharCode(a[1]) : String(a[1])[0]).repeat(num(a[0]));
      case 'SPACE$': return ' '.repeat(num(a[0]));
      case 'ASC': return String(a[0]).length ? String(a[0]).charCodeAt(0) : 0;
      // INSTR([start,] str, sub) — 1-based position of sub in str (0 if absent).
      case 'INSTR': { const off = a.length >= 3 ? num(a[0]) : 1; const s = String(a.length >= 3 ? a[1] : a[0]); const sub = String(a.length >= 3 ? a[2] : a[1]); if (sub === '') return 0; return s.indexOf(sub, Math.max(0, off - 1)) + 1; }
      case 'HEX$': { let n = Math.round(num(a[0])); if (n < 0) n &= 0xffff; return n.toString(16).toUpperCase(); }
      case 'OCT$': { let n = Math.round(num(a[0])); if (n < 0) n &= 0xffff; return n.toString(8); }
      case 'CVI': { const b = bytesOf(String(a[0])); const v = (b[0] || 0) | ((b[1] || 0) << 8); return v & 0x8000 ? v - 0x10000 : v; }
      case 'MKI$': { const n = num(a[0]) & 0xffff; return String.fromCharCode(n & 0xff, (n >> 8) & 0xff); }
      case 'CVS': return mbfSingleToFloat(bytesOf(String(a[0])));
      case 'MKS$': return strOf(floatToMbfSingle(num(a[0])));
      case 'CVD': return mbfDoubleToFloat(bytesOf(String(a[0])));
      case 'MKD$': return strOf(encodeMbfDoubleDecimal(num(a[0])));
      case 'INKEY$': return this.term.inkey();
      case 'FRE': return 60000;                // dummy: plausible era constant (fits old 5-digit fields)
      case 'POS': return this.s.col;           // current cursor column (1-based); arg ignored
      case 'EOF': { const f = this.files[num(a[0])]; return f && f.data ? (f.pos >= f.data.length ? -1 : 0) : -1; }
      case 'LOF': { const f = this.files[num(a[0])]; return f ? (f.data ? f.data.length : (f.out ? f.out.length : 0)) : 0; }
      case 'LOC': { const f = this.files[num(a[0])]; if (!f) return 0; return Math.floor((f.data ? f.pos : (f.out ? f.out.length : 0)) / 128); }
      case 'PEEK': { const off = num(a[0]); return (this.defSeg === 0x40 && off === 0x4A) ? this.s.cols : 0; } // BIOS 0040:004A = screen columns
      case 'INP': return 0;         // hardware port read — inert
      case 'VARPTR': return 0;      // variable pointer — dummy
      case 'VARPTR$': return a.length ? String(a[0]) : '';  // used by DRAW X sub-string — return content
      case 'USR': return a.length ? num(a[0]) : 0;  // machine-code call — pass-through stub
      case 'POINT': return this.gfx ? this.gfx.point(num(a[0]), num(a[1])) : -1;     // pixel colour at (x,y)
      case 'PMAP': return this.gfx ? this.gfx.pmap(num(a[0]), num(a[1])) : num(a[0]);  // logical↔physical map
      case 'SCREEN': {
        if (this.gfx && this.gfx.active() && this.gfx.scrn) return this.gfx.scrn(num(a[0]), num(a[1]));
        const sr = Math.max(1, Math.min(this.s.rows, Math.round(num(a[0])))), sc = Math.max(1, Math.min(this.s.cols, Math.round(num(a[1]))));
        const cell = this.s.cells[sr - 1] && this.s.cells[sr - 1][sc - 1];
        if (!cell) return 32;
        const _sch = cell.ch; const _scp = _sch.charCodeAt(0);
        if (_scp < 0x80) return _scp;
        // Use codec reverse (unicode display char → original GW-BASIC byte).
        const _codec = window._bas_codec;
        if (_codec && _codec.reverse) { const _b = _codec.reverse(_sch); if (_b != null) return _b; }
        // KU42 default reverse lookup.
        const _ku42b = UTF8_TO_KU42[_sch];
        return _ku42b != null ? _ku42b : (_scp & 0xFF);
      } // read char/attr (text)
    }
    console.warn(`[bas] unsupported function ${name}() — returning 0`);
    return 0;
  }
}

// True if a statement list (an IF branch) contains no blocking/async op, so the synchronous
// fast path can run it whole. Blocking = input/open/put/chain/gosub/on..gosub; also bail on
// nested IF whose branches aren't pure. (INKEY$/INPUT$ inside an expression still surface as _S
// at eval time, so this only needs to catch statement-level blockers.)
function branchIsPure(stmts) {
  // Allow-list: only statement types that execS handles synchronously without side effects
  // that would need rolling back. Anything unlisted (graphics, sound, async I/O, unknown)
  // is considered impure — the IF falls back to the async exec path which runs it once, correctly.
  for (const st of stmts || []) {
    switch (st.t) {
      case 'rem': case 'common': case 'end': case 'system': case 'return': case 'run':
      case 'goto': case 'next': case 'for': case 'while': case 'wend':
      case 'color': case 'locate': case 'assign': case 'dim': case 'erase':
      case 'defseg': case 'optionbase': case 'deftype': case 'deffn': case 'tron':
      case 'ontrap': case 'trapstate': case 'onerror': case 'raiseerror': case 'resume':
      case 'randomize': case 'data': case 'read': case 'restore':
      case 'swap': case 'midassign': case 'lset': case 'field': case 'get':
        break;
      case 'print': case 'write': if (st.fileno != null) return false; break;
      case 'on': if (st.gosub) return false; break;
      case 'if': if (!branchIsPure(st.then) || !branchIsPure(st.else)) return false; break;
      default: return false;
    }
  }
  return true;
}

// GW-BASIC/DOS canonicalizes filenames to UPPERCASE — OPEN "chq.dat" and OPEN "CHQ.DAT" refer to
// the same file. The .BAS mix case (e.g. CHQ-ADJ: OPEN "CHQ.DAT" but KILL "chq.dat"). Uppercase at
// the interpreter's file boundary so every op targets one canonical name, matching the real files.
const fileName = (v) => String(v).trim().toUpperCase();
// DOS-style wildcard match for FILES (only * and ? — enough for "*.DAT", "CHQ*", "?.BAS").
function matchPattern(name, pat) {
  const re = '^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  return new RegExp(re).test(name);
}

const num = (v) => (typeof v === 'number' ? v : parseFloat(v) || 0);
// GW-BASIC integer narrowing: round to nearest and sign-extend to 16-bit signed range.
const i16 = (v) => { const n = Math.round(num(v)) & 0xFFFF; return n >= 0x8000 ? n - 0x10000 : n; };
// GW-BASIC CINT rounds to the nearest integer, ties to even (banker's rounding): 2.5→2, 3.5→4.
const cint = (x) => { const f = Math.floor(x), d = x - f; if (d < 0.5) return f; if (d > 0.5) return f + 1; return f % 2 === 0 ? f : f + 1; };
// Bare system-clock built-ins (no parens): TIMER (secs since midnight), DATE$ ("MM-DD-YYYY"),
// TIME$ ("HH:MM:SS"). Returns undefined for any other name (→ fall through to a real variable).
const _p2 = (n) => String(n).padStart(2, '0');
function clockVar(name) {                       // name is already uppercased by the caller
  const d = new Date();
  switch (name) {
    case 'TIMER': return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
    case 'DATE$': return `${_p2(d.getMonth() + 1)}-${_p2(d.getDate())}-${d.getFullYear()}`;
    case 'TIME$': return `${_p2(d.getHours())}:${_p2(d.getMinutes())}:${_p2(d.getSeconds())}`;
  }
  return undefined;
}
// GW-BASIC plain PRINT/LPRINT of a number: a leading space stands in for the sign on
// non-negative values, and a trailing space always follows. (PRINT USING does NOT do this —
// it has its own masks.) This leading space is load-bearing for screen column alignment:
// e.g. PRINT ID% at col 31 puts the digits at col 32, so a later "clear from col 32" erases
// them. Without it, a stray leading digit survives (the "33232" bug in CHQ05).
const basicPrintNum = (v) => (v >= 0 ? ' ' : '') + String(v) + ' ';
const truthy = (v) => (typeof v === 'string' ? v.length > 0 : v !== 0);
const fmtNum = (v) => String(v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Map an empty-body delay loop's iteration count to a readable on-screen pause (ms).
const delayMs = (from, to) => Math.min(1200, Math.max(300, Math.abs(to - from)));
