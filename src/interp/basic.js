// Spike A — GW-BASIC interpreter, scoped to the screens cheque-js needs. Runs the original
// .BAS unmodified.
//
// Supports: line-numbered flow, GOTO/GOSUB/RETURN/ON..GOTO, IF/THEN/ELSE (inline stmts &
// line-number targets), multi-statement ':' lines, FOR/NEXT, CLS/COLOR/LOCATE/BEEP,
// PRINT/LPRINT (with ; , TAB() SPC() and PRINT USING), INPUT, CHAIN/END/SYSTEM, assignment,
// COMMON (no-op; all vars persist across CHAIN), random files (OPEN/FIELD/GET/PUT/CLOSE/LSET),
// CVI/MKI$/CVS/CVD/MKS$/MKD$, and INT/RIGHT$/LEFT$/MID$/STR$/STRING$/SPACE$/CHR$/ABS/LEN/VAL
// /INKEY$, operators + - * / MOD, = <> < > <= >=, AND/OR/NOT, string concat.
//
// String model = GW-BASIC byte strings: a JS string whose char codes are raw bytes (0–255).
// Source literals are already ≤0xFF (codepoint = byte). INPUT KU42-encodes typed Unicode to
// bytes; PRINT KU42-decodes bytes to Thai for display. File fields are byte strings.
//
// ⚠ Reads are real (fetched). PUT updates an in-memory buffer only — it does NOT persist to
// the real data file. Real in-place persistence (to a copy) is wired separately.

import { beep } from '../term/beep.js';
import { KU42_TO_UTF8, UTF8_TO_KU42 } from '../codec/ku42.js';
import { mbfSingleToFloat, floatToMbfSingle, mbfDoubleToFloat, encodeMbfDoubleDecimal } from '../codec/mbf.js';
import { formatUsing } from '../term/printusing.js';
import * as store from '../data/store.js';
import { ReportPrinter } from '../print/report.js';

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
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c === '"') { let j = i + 1, s = ''; while (j < src.length && src[j] !== '"') s += src[j++]; i = j + 1; t.push({ k: 'str', v: s }); continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) { let j = i, n = ''; while (j < src.length && /[0-9.]/.test(src[j])) n += src[j++]; i = j; t.push({ k: 'num', v: parseFloat(n) }); continue; }
    if (idStart(c)) { let j = i, id = ''; while (j < src.length && idChar(src[j])) id += src[j++]; if (j < src.length && '%!#$'.includes(src[j])) id += src[j++]; i = j; t.push({ k: 'id', v: id }); continue; }
    const two = src.substr(i, 2);
    if (two === '<=' || two === '>=' || two === '<>') { t.push({ k: 'op', v: two }); i += 2; continue; }
    if ('=<>+-*/^'.includes(c)) { t.push({ k: 'op', v: c }); i++; continue; }
    if (c === '(') { t.push({ k: 'lp' }); i++; continue; }
    if (c === ')') { t.push({ k: 'rp' }); i++; continue; }
    if (c === ',') { t.push({ k: 'comma' }); i++; continue; }
    if (c === ';') { t.push({ k: 'semi' }); i++; continue; }
    if (c === ':') { t.push({ k: 'colon' }); i++; continue; }
    i++; // skip unknown char (incl '#' used as file-number prefix)
  }
  return t;
}

const kw = (tok, word) => tok && tok.k === 'id' && tok.v.toUpperCase() === word;

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
  if (tok.k === 'id') {
    const w = tok.v.toUpperCase();
    switch (w) {
      case 'REM': while (!c.eof()) c.next(); return { t: 'rem' };
      case 'COMMON': { c.next(); const vars = []; while (!c.eof() && c.peek().k !== 'colon') { const t = c.next(); if (t.k === 'id') vars.push(t.v); } return { t: 'common', vars }; }
      case 'CLS': c.next(); return { t: 'cls' };
      case 'BEEP': c.next(); return { t: 'beep' };
      case 'END': c.next(); return { t: 'end' };
      case 'SYSTEM': c.next(); return { t: 'system' };
      case 'RETURN': c.next(); return { t: 'return' };
      case 'GOTO': c.next(); return { t: 'goto', line: c.next().v };
      case 'GOSUB': c.next(); return { t: 'gosub', line: c.next().v };
      case 'CHAIN': c.next(); return { t: 'chain', name: parseExpr(c) };
      case 'COLOR': c.next(); return { t: 'color', args: parseExprList(c) };
      case 'LOCATE': c.next(); return { t: 'locate', args: parseExprList(c) };
      case 'PRINT': c.next(); return parsePrint(c, false);
      case 'LPRINT': c.next(); return parsePrint(c, true);
      case 'INPUT': c.next(); return parseInput(c);
      case 'IF': c.next(); return parseIf(c);
      case 'LET': c.next(); return parseAssign(c);
      case 'ON': { c.next(); const e = parseExpr(c); const verb = c.next(); const gosub = !!verb && verb.v && verb.v.toUpperCase() === 'GOSUB'; const lines = [c.next().v]; while (!c.eof() && c.peek().k === 'comma') { c.next(); lines.push(c.next().v); } return { t: 'on', expr: e, lines, gosub }; }
      case 'OPEN': return parseOpen(c);
      case 'FIELD': return parseField(c);
      case 'GET': { c.next(); const fileno = c.next().v; if (!c.eof() && c.peek().k === 'comma') c.next(); return { t: 'get', fileno, rec: parseExpr(c) }; }
      case 'PUT': { c.next(); const fileno = c.next().v; if (!c.eof() && c.peek().k === 'comma') c.next(); return { t: 'put', fileno, rec: parseExpr(c) }; }
      case 'CLOSE': { c.next(); let fileno = null; if (!c.eof() && c.peek().k === 'num') fileno = c.next().v; return { t: 'close', fileno }; }
      case 'KILL': { c.next(); return { t: 'kill', name: parseExpr(c) }; }
      case 'NAME': { c.next(); const from = parseExpr(c); if (kw(c.peek(), 'AS')) c.next(); return { t: 'name', from, to: parseExpr(c) }; }
      case 'LSET': case 'RSET': { c.next(); const name = c.next().v; c.next(); return { t: 'lset', name, expr: parseExpr(c) }; }
      case 'FOR': { c.next(); const v = c.next().v; c.next(); const from = parseExpr(c); /*TO*/ c.next(); const to = parseExpr(c); let step = { t: 'num', v: 1 }; if (kw(c.peek(), 'STEP')) { c.next(); step = parseExpr(c); } return { t: 'for', var: v, from, to, step }; }
      case 'NEXT': { c.next(); if (!c.eof() && c.peek().k === 'id') c.next(); return { t: 'next' }; }
      case 'WIDTH': case 'KEY': c.next(); while (!c.eof() && c.peek().k !== 'colon') c.next(); return { t: 'rem' };
    }
  }
  return parseAssign(c);
}

function parseAssign(c) { const name = c.next().v; c.next(); return { t: 'assign', name, expr: parseExpr(c) }; }

// Comma-separated expression list (COLOR/LOCATE). Empty slots (e.g. COLOR ,7) → null.
function parseExprList(c) {
  const args = [];
  if (c.eof() || c.peek().k === 'colon') return args;
  args.push(c.peek().k === 'comma' ? null : parseExpr(c));
  while (!c.eof() && c.peek().k === 'comma') { c.next(); args.push((c.eof() || c.peek().k === 'colon') ? null : parseExpr(c)); }
  return args;
}

function parseOpen(c) {
  c.next(); const name = parseExpr(c); let fileno = 1, len = 0;
  while (!c.eof() && c.peek().k !== 'colon') {
    const t = c.next();
    if (t.k === 'id' && t.v.toUpperCase() === 'AS') fileno = c.next().v;
    else if (t.k === 'id' && t.v.toUpperCase() === 'LEN') { if (c.peek() && c.peek().k === 'op' && c.peek().v === '=') c.next(); len = c.next().v; }
  }
  return { t: 'open', name, fileno, len };
}

function parseField(c) {
  c.next(); const fileno = c.next().v; const defs = [];
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
    if (kw(c.peek(), 'TAB') || kw(c.peek(), 'SPC')) { const fn = c.next().v.toUpperCase(); c.next(); const e = parseExpr(c); c.next(); lead.push({ kind: fn === 'TAB' ? 'tab' : 'spc', expr: e }); }
    else lead.push({ kind: 'expr', expr: parseExpr(c) });
    if (!c.eof() && (c.peek().k === 'semi' || c.peek().k === 'comma')) trailing = c.next().k === 'semi' ? ';' : ','; else trailing = null;
  }
  return { t: 'print', lpr, lead, using, vals, trailing };
}

function parseInput(c) {
  let prompt = null, sep = null;
  if (c.peek() && c.peek().k === 'str') { prompt = c.next().v; if (c.peek() && (c.peek().k === 'semi' || c.peek().k === 'comma')) sep = c.next().k === 'semi' ? ';' : ','; }
  const vars = [c.next().v];
  while (!c.eof() && c.peek().k === 'comma') { c.next(); vars.push(c.next().v); }
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
  if (c.peek() && c.peek().k === 'num') return [{ t: 'goto', line: c.next().v }];
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

// expression parser (precedence: OR<AND<NOT<rel<+-<MOD<*/<unary<primary)
function parseExpr(c) { return pOr(c); }
function pOr(c) { let l = pAnd(c); while (kw(c.peek(), 'OR')) { c.next(); l = { t: 'bin', op: 'OR', l, r: pAnd(c) }; } return l; }
function pAnd(c) { let l = pNot(c); while (kw(c.peek(), 'AND')) { c.next(); l = { t: 'bin', op: 'AND', l, r: pNot(c) }; } return l; }
function pNot(c) { if (kw(c.peek(), 'NOT')) { c.next(); return { t: 'un', op: 'NOT', e: pNot(c) }; } return pRel(c); }
function pRel(c) { let l = pAdd(c); while (c.peek() && c.peek().k === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(c.peek().v)) { const op = c.next().v; l = { t: 'bin', op, l, r: pAdd(c) }; } return l; }
function pAdd(c) { let l = pMod(c); while (c.peek() && c.peek().k === 'op' && (c.peek().v === '+' || c.peek().v === '-')) { const op = c.next().v; l = { t: 'bin', op, l, r: pMod(c) }; } return l; }
function pMod(c) { let l = pMul(c); while (kw(c.peek(), 'MOD')) { c.next(); l = { t: 'bin', op: 'MOD', l, r: pMul(c) }; } return l; }
function pMul(c) { let l = pUnary(c); while (c.peek() && c.peek().k === 'op' && (c.peek().v === '*' || c.peek().v === '/')) { const op = c.next().v; l = { t: 'bin', op, l, r: pUnary(c) }; } return l; }
function pUnary(c) { if (c.peek() && c.peek().k === 'op' && c.peek().v === '-') { c.next(); return { t: 'un', op: '-', e: pUnary(c) }; } return pPrim(c); }
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
const bytesOf = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0xff);
const strOf = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

// ── interpreter ───────────────────────────────────────────────────────────────
export class Basic {
  constructor(screen, term, loader) { this.s = screen; this.term = term; this.loader = loader; this.vars = {}; this.files = {}; this.printer = new ReportPrinter(); this.commonVars = new Set(); this.onPrintReady = null; this.store = store; }

  // GW-BASIC: A%, A#, A$ are distinct variables; A and A! are the same (single).
  // So keep %/#/$ in the key; '!' or no suffix collapse to the bare name.
  varKey(name) {
    const m = name.match(/^([A-Za-z][A-Za-z0-9._]*)([%!#$]?)$/);
    const base = m[1].toUpperCase(), suf = m[2];
    return (suf === '$' || suf === '%' || suf === '#') ? base + suf : base;
  }
  findField(name) { for (const fn in this.files) { const f = this.files[fn]; if (name in f.fields) return { f, ...f.fields[name] }; } return null; }
  getVar(name) {
    const fv = this.findField(name);
    if (fv) return strOf(fv.f.buffer.subarray(fv.start, fv.start + fv.len));
    const k = this.varKey(name); return k in this.vars ? this.vars[k] : (k.endsWith('$') ? '' : 0);
  }
  setVar(name, val) { const k = this.varKey(name); this.vars[k] = name.endsWith('%') ? Math.trunc(num(val)) : val; }

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
    this.flat = []; this.lineStart = {};
    for (const p of parsed) { this.lineStart[p.line] = this.flat.length; for (const st of p.stmts) this.flat.push(st); }

    this.go = (ln) => { if (!(ln in this.lineStart)) throw new Error('Undefined line ' + ln); return this.lineStart[ln]; };
    return this.run(0, false);
  }

  // ── Synchronous fast path ─────────────────────────────────────────────────
  // evlS/execS/runS/runStatementsS mirror evl/exec/run/runStatements but run WITHOUT await.
  // Any blocking op returns the _S sentinel, and the async run() falls back to await exec()
  // for just that statement. This removes per-statement async overhead from scan loops.

  evlS(n) {
    switch (n.t) {
      case 'num': return n.v;
      case 'str': return n.v;
      case 'var': {
        if (n.name.toUpperCase() === 'INKEY$') return _S;          // polling INKEY$ needs async yield
        return this.getVar(n.name);
      }
      case 'un': { const e = this.evlS(n.e); if (e === _S) return _S; return n.op === '-' ? -num(e) : (truthy(e) ? 0 : -1); }
      case 'call': {
        if (n.name === 'INPUT$') return _S;                         // blocking key read
        const a = []; for (const x of n.args) { const v = this.evlS(x); if (v === _S) return _S; a.push(v); }
        return this.call(n.name, a);
      }
      case 'bin': { const l = this.evlS(n.l); if (l === _S) return _S; const r = this.evlS(n.r); if (r === _S) return _S; return this.bin(n.op, l, r); }
    }
    return 0;
  }

  execS(st) {
    switch (st.t) {
      case 'rem': return null;
      case 'common': this.commonVars = new Set(st.vars.map((v) => this.varKey(v))); return null;
      case 'cls': this.s.cls(); return null;
      case 'beep': beep(); return null;
      case 'end': return { t: 'end' };
      case 'system': return { t: 'system' };
      case 'return': return { t: 'return' };
      case 'goto': return { t: 'goto', line: st.line };
      case 'next': return { t: 'next' };
      // gosub recurses into a subroutine that may block partway; defer to the async path so a
      // blocking op there can't cause partial re-execution.
      case 'gosub': return _S;
      case 'color': { const a = this.evlS(st.args[0]); if (a === _S) return _S; const b = st.args[1] != null ? this.evlS(st.args[1]) : null; if (b === _S) return _S; this.s.color(num(a), b != null ? num(b) : null); return null; }
      case 'locate': { const a = this.evlS(st.args[0]); if (a === _S) return _S; const b = st.args[1] != null ? this.evlS(st.args[1]) : null; if (b === _S) return _S; this.s.locate(num(a), b != null ? num(b) : null); return null; }
      case 'assign': { const v = this.evlS(st.expr); if (v === _S) return _S; this.setVar(st.name, v); return null; }
      case 'on': {
        if (st.gosub) return _S;                                    // ON..GOSUB recurses → async path
        const idx = this.evlS(st.expr); if (idx === _S) return _S; const i = num(idx);
        if (i < 1 || i > st.lines.length) return null;
        return { t: 'goto', line: st.lines[i - 1] };
      }
      case 'print': return this.doPrintS(st);
      case 'for': { const f = this.evlS(st.from); if (f === _S) return _S; const t = this.evlS(st.to); if (t === _S) return _S; const sp = this.evlS(st.step); if (sp === _S) return _S; return { t: 'for', var: st.var, from: num(f), to: num(t), step: num(sp) }; }
      case 'field': { const f = this.files[st.fileno]; let start = 0; if (f) { f.fields = {}; for (const d of st.defs) { f.fields[d.name] = { start, len: d.len }; start += d.len; } } return null; }
      case 'get': { const rec = this.evlS(st.rec); if (rec === _S) return _S; const f = this.files[st.fileno]; const off = (num(rec) - 1) * f.recSize; for (let i = 0; i < f.recSize; i++) f.buffer[i] = f.data[off + i] || 0; return null; }
      // NOTE: 'close' is intentionally NOT handled here — it must defer to async closeFile()
      // (below, via _S) so buffered scratch files get flushed to disk. See the _S list.
      case 'lset': {
        const val = this.evlS(st.expr); if (val === _S) return _S; const s = String(val);
        const fv = this.findField(st.name);
        if (fv) for (let i = 0; i < fv.len; i++) fv.f.buffer[fv.start + i] = i < s.length ? s.charCodeAt(i) & 0xff : 0x20;
        else this.setVar(st.name, s);
        return null;
      }
      case 'if': {
        const c = this.evlS(st.cond); if (c === _S) return _S;
        const branch = truthy(c) ? st.then : st.else;
        if (!branchIsPure(branch)) return _S;            // any blocking op in the branch → async (avoids partial re-exec)
        return this.runStatementsS(branch);
      }
      // Blocking / async-only (disk I/O or input):
      case 'input': case 'open': case 'put': case 'chain': case 'close': case 'kill': case 'name': return _S;
    }
    return _S; // unknown → let async exec handle it
  }

  doPrintS(st) {
    const sink = st.lpr ? this.printer : this.s;
    for (const it of st.lead) {
      if (it.kind === 'tab') { const v = this.evlS(it.expr); if (v === _S) return _S; sink.tab(num(v)); }
      else if (it.kind === 'spc') { const v = this.evlS(it.expr); if (v === _S) return _S; st.lpr ? sink.spaces(num(v)) : sink.put(' '.repeat(num(v))); }
      else { const v = this.evlS(it.expr); if (v === _S) return _S; sink.put(typeof v === 'number' ? basicPrintNum(v) : (st.lpr ? v : ku42Display(v))); }
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
        this.setVar(st.var, num(from)); loops.push({ var: st.var, to: num(to), step: num(step), body: i + 1 }); i++; continue;
      }
      if (st.t === 'next') {
        const f = loops[loops.length - 1]; if (!f) { i++; continue; }
        const nv = num(this.getVar(f.var)) + f.step; this.setVar(f.var, nv);
        if ((f.step >= 0 && nv <= f.to) || (f.step < 0 && nv >= f.to)) i = f.body; else { loops.pop(); i++; }
        continue;
      }
      const ctl = this.execS(st); if (ctl === _S) return _S; if (ctl) return ctl; i++;
    }
    return null;
  }

  // Execute from a flat index. GOSUB recurses (so the rest of an IF…THEN branch resumes
  // after RETURN); a recursive call with stopOnReturn=true returns on RETURN. FOR/NEXT use a
  // loop stack local to each invocation. Returns the terminating signal (end/system/chain).
  async run(fromIp, stopOnReturn) {
    const loops = []; let ip = fromIp; let lastYield = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    while (ip < this.flat.length) {
      const cur = this.flat[ip];
      // Keep the UI responsive on long synchronous scans: yield to the event loop every ~50ms
      // (only in the outer loop, not inside GOSUB recursions, to avoid extra overhead).
      if (!stopOnReturn && nowMs() - lastYield > 50) { await new Promise((r) => setTimeout(r)); lastYield = nowMs(); }
      // Fast path: run a single statement synchronously. Skip it for statements that recurse
      // into a subroutine (gosub / on..gosub) or an empty-body delay FOR — those must use the
      // async path so a blocking op inside them doesn't cause partial re-execution.
      const skipFast = cur.t === 'gosub' || (cur.t === 'on' && cur.gosub) ||
        (cur.t === 'for' && this.flat[ip + 1] && this.flat[ip + 1].t === 'next');
      if (!skipFast) {
        const sr = this.execS(cur);
        if (sr !== _S) {
          if (!sr) { ip++; continue; }
          if (sr.t === 'goto') { ip = this.go(sr.line); continue; }
          if (sr.t === 'return') { if (stopOnReturn) return { t: 'return' }; ip++; continue; }
          if (sr.t === 'end' || sr.t === 'system' || sr.t === 'chain') return sr;
          if (sr.t === 'for') { this.setVar(sr.var, sr.from); loops.push({ var: sr.var, to: sr.to, step: sr.step, body: ip + 1 }); ip++; continue; }
          if (sr.t === 'next') {
            const f = loops[loops.length - 1];
            if (!f) { ip++; continue; }
            const nv = num(this.getVar(f.var)) + f.step; this.setVar(f.var, nv);
            if ((f.step >= 0 && nv <= f.to) || (f.step < 0 && nv >= f.to)) ip = f.body; else { loops.pop(); ip++; }
            continue;
          }
          ip++; continue;
        }
      }
      const ctl = await this.exec(this.flat[ip]);
      if (!ctl) { ip++; continue; }
      switch (ctl.t) {
        case 'goto': ip = this.go(ctl.line); break;
        case 'return': if (stopOnReturn) return { t: 'return' }; ip++; break;
        case 'end': return { t: 'end' };
        case 'system': return { t: 'system' };
        case 'chain': return ctl;
        case 'for':
          // Empty-body delay loop ("FOR x=a TO b : NEXT") — the original's ~1s pause idiom.
          // Run it as a real timed delay so flashed messages are readable.
          if (this.flat[ip + 1] && this.flat[ip + 1].t === 'next') { await sleep(delayMs(ctl.from, ctl.to)); ip += 2; break; }
          this.setVar(ctl.var, ctl.from); loops.push({ var: ctl.var, to: ctl.to, step: ctl.step, body: ip + 1 }); ip++; break;
        case 'next': {
          const f = loops[loops.length - 1];
          if (!f) { ip++; break; }
          const nv = num(this.getVar(f.var)) + f.step;
          this.setVar(f.var, nv);
          if ((f.step >= 0 && nv <= f.to) || (f.step < 0 && nv >= f.to)) ip = f.body; else { loops.pop(); ip++; }
          break;
        }
        default: ip++;
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
        this.setVar(st.var, from); loops.push({ var: st.var, to, step: num(await this.evl(st.step)), body: i + 1 }); i++; continue;
      }
      if (st.t === 'next') {
        const f = loops[loops.length - 1];
        if (!f) { i++; continue; }
        const nv = num(this.getVar(f.var)) + f.step; this.setVar(f.var, nv);
        if ((f.step >= 0 && nv <= f.to) || (f.step < 0 && nv >= f.to)) i = f.body; else { loops.pop(); i++; }
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
      case 'common': this.commonVars = new Set(st.vars.map((v) => this.varKey(v))); return null; // declares vars that survive CHAIN
      case 'cls': this.s.cls(); return null;
      case 'beep': beep(); return null;
      case 'end': return { t: 'end' };
      case 'system': return { t: 'system' };
      case 'return': return { t: 'return' };
      case 'goto': return { t: 'goto', line: st.line };
      case 'gosub': { const r = await this.run(this.go(st.line), true); return r && (r.t === 'end' || r.t === 'system' || r.t === 'chain') ? r : null; }
      case 'chain': {
        const name = String(await this.evl(st.name));
        const keep = {};                                     // CHAIN passes ONLY the COMMON vars;
        for (const k of this.commonVars) if (k in this.vars) keep[k] = this.vars[k]; // the rest reset
        this.vars = keep;
        return { t: 'chain', name };
      }
      case 'color': this.s.color(num(await this.evl(st.args[0])), st.args[1] != null ? num(await this.evl(st.args[1])) : null); return null;
      case 'locate': this.s.locate(num(await this.evl(st.args[0])), st.args[1] != null ? num(await this.evl(st.args[1])) : null); return null;
      case 'assign': this.setVar(st.name, await this.evl(st.expr)); return null;
      case 'on': {
        const idx = num(await this.evl(st.expr));
        if (idx < 1 || idx > st.lines.length) return null;        // out of range → fall through
        const target = st.lines[idx - 1];
        if (!st.gosub) return { t: 'goto', line: target };
        const r = await this.run(this.go(target), true);          // ON..GOSUB: call, then continue
        return r && (r.t === 'end' || r.t === 'system' || r.t === 'chain') ? r : null;
      }
      case 'print': return this.doPrint(st);
      case 'input': return this.doInput(st);
      case 'for': return { t: 'for', var: st.var, from: num(await this.evl(st.from)), to: num(await this.evl(st.to)), step: num(await this.evl(st.step)) };
      case 'next': return { t: 'next' };
      case 'open': { const name = fileName(await this.evl(st.name)); await this.openFile(st.fileno, name, st.len); return null; }
      case 'field': { const f = this.files[st.fileno]; let start = 0; if (f) { f.fields = {}; for (const d of st.defs) { f.fields[d.name] = { start, len: d.len }; start += d.len; } } return null; }
      case 'get': { const f = this.files[st.fileno]; const rec = num(await this.evl(st.rec)); const off = (rec - 1) * f.recSize; for (let i = 0; i < f.recSize; i++) f.buffer[i] = f.data[off + i] || 0; return null; }
      case 'put': {
        const f = this.files[st.fileno]; const rec = num(await this.evl(st.rec)); const off = (rec - 1) * f.recSize;
        if (off + f.recSize > f.data.length) { const nd = new Uint8Array(off + f.recSize); nd.set(f.data); f.data = nd; }
        f.data.set(f.buffer, off);                                   // update in-memory image
        if (f.isNew) { f.dirty = true; return null; }                // scratch file: defer to CLOSE (one flush)
        try {
          await this.store.writeRecord(f.name, rec, f.recSize, f.buffer.slice()); // existing file: real in-place write
        } catch (e) {
          console.error(`PUT ${f.name} rec=${rec} FAILED:`, e);
          this.s.locate(24, 1); this.s.color(15, 4); this.s.put(`WRITE FAILED rec ${rec}: ${e.message}`.slice(0, 79)); this.s.color(7, 0); this.s.render();
          throw e;
        }
        return null;
      }
      case 'close': return this.closeFile(st.fileno);
      case 'lset': {
        const val = String(await this.evl(st.expr));
        const fv = this.findField(st.name);
        if (fv) for (let i = 0; i < fv.len; i++) fv.f.buffer[fv.start + i] = i < val.length ? val.charCodeAt(i) & 0xff : 0x20;
        else this.setVar(st.name, val);
        return null;
      }
      case 'if': return this.runStatements(truthy(await this.evl(st.cond)) ? st.then : st.else);
      case 'kill': await this.store.kill(fileName(await this.evl(st.name))); return null;
      case 'name': await this.store.rename(fileName(await this.evl(st.from)), fileName(await this.evl(st.to))); return null;
    }
    return null;
  }

  // CLOSE: flush a buffered scratch (newly-created) file to disk in one write; existing files
  // were already written in place per-record, so nothing to flush.
  async closeFile(fileno) {
    const flush = async (f) => { if (f && f.isNew && f.dirty) { await this.store.writeWholeFile(f.name, f.data); f.dirty = false; } };
    if (fileno != null) { await flush(this.files[fileno]); delete this.files[fileno]; }
    else { for (const k of Object.keys(this.files)) await flush(this.files[k]); this.files = {}; }
    return null;
  }

  async openFile(fileno, name, recSize) {
    if (!this.store.isConnected()) throw new Error(`Data folder not connected — click "Connect data folder" before opening ${name}.`);
    let data, isNew = false;
    try {
      data = await this.store.readFile(name);          // existing file → in-place per-record writes
    } catch {
      await this.store.openOrCreate(name);             // GW-BASIC OPEN FOR RANDOM auto-creates
      data = new Uint8Array(0); isNew = true;     // new scratch file → buffer, flush whole on CLOSE
    }
    this.files[fileno] = { name, recSize, data, buffer: new Uint8Array(recSize), fields: {}, isNew, dirty: false };
  }

  async doPrint(st) {
    if (st.lpr) return this.doLPrint(st);                 // LPRINT → report buffer, not the screen
    const s = this.s;
    for (const it of st.lead) {
      if (it.kind === 'tab') s.tab(num(await this.evl(it.expr)));
      else if (it.kind === 'spc') s.put(' '.repeat(num(await this.evl(it.expr))));
      else { const v = await this.evl(it.expr); s.put(typeof v === 'number' ? basicPrintNum(v) : ku42Display(v)); }
    }
    if (st.using != null) {
      const mask = String(await this.evl(st.using));
      const vals = [];
      for (const e of st.vals) vals.push(await this.evl(e));
      s.put(formatUsing(mask, vals));
    }
    if (st.trailing !== ';') s.newline();
    s.render();
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
    if (st.prompt != null) { this.s.put(ku42Display(st.prompt)); this.s.render(); }
    const v = st.vars[0];
    const type = v.endsWith('$') ? 'str' : v.endsWith('%') ? 'int' : 'num';
    const raw = await this.term.inputLine({ type: type === 'int' ? 'int' : type === 'num' ? 'num' : 'str', question: st.sep === ';' || st.prompt == null });
    this.setVar(v, type === 'str' ? ku42Encode(raw) : raw);
    return null;
  }

  async evl(n) {
    switch (n.t) {
      case 'num': return n.v;
      case 'str': return n.v;
      case 'var': {
        // INKEY$ polls; yield to the event loop so keydown can fire (the GW-BASIC
        // "T$=INKEY$:IF T$=\"\" THEN <loop>" wait-for-key idiom would otherwise hang).
        if (n.name.toUpperCase() === 'INKEY$') { await new Promise((r) => setTimeout(r)); return this.term.inkey(); }
        return this.getVar(n.name);
      }
      case 'un': return n.op === '-' ? -num(await this.evl(n.e)) : (truthy(await this.evl(n.e)) ? 0 : -1);
      case 'call': {
        const a = []; for (const x of n.args) a.push(await this.evl(x));
        // INPUT$(n): read exactly n keys (blocking) — used for single-key confirms (CHQ02 890).
        if (n.name === 'INPUT$') { const cnt = Math.max(1, num(a[0])); let r = ''; for (let i = 0; i < cnt; i++) r += await this.term.inputKey(); return r; }
        return this.call(n.name, a);
      }
      case 'bin': return this.bin(n.op, await this.evl(n.l), await this.evl(n.r));
    }
    return 0;
  }

  bin(op, l, r) {
    switch (op) {
      case '+': return (typeof l === 'string' || typeof r === 'string') ? String(l) + String(r) : l + r;
      case '-': return num(l) - num(r); case '*': return num(l) * num(r); case '/': return num(l) / num(r);
      case 'MOD': return Math.trunc(num(l)) % Math.trunc(num(r));
      case '=': return l === r ? -1 : 0; case '<>': return l !== r ? -1 : 0;
      case '<': return l < r ? -1 : 0; case '>': return l > r ? -1 : 0;
      case '<=': return l <= r ? -1 : 0; case '>=': return l >= r ? -1 : 0;
      case 'AND': return (truthy(l) && truthy(r)) ? -1 : 0; case 'OR': return (truthy(l) || truthy(r)) ? -1 : 0;
    }
    return 0;
  }

  call(name, a) {
    switch (name) {
      case 'INT': return Math.floor(num(a[0])); case 'ABS': return Math.abs(num(a[0]));
      case 'LEN': return String(a[0]).length;
      case 'VAL': return parseFloat(String(a[0]).replace(/\s+/g, '')) || 0; // GW-BASIC VAL ignores all spaces
      case 'CHR$': return String.fromCharCode(num(a[0]) & 0xff);
      case 'STR$': return num(a[0]) >= 0 ? ' ' + fmtNum(num(a[0])) : fmtNum(num(a[0]));
      case 'RIGHT$': return String(a[0]).slice(-num(a[1])); case 'LEFT$': return String(a[0]).slice(0, num(a[1]));
      case 'MID$': return String(a[0]).substr(num(a[1]) - 1, a[2] != null ? num(a[2]) : undefined);
      case 'STRING$': return (typeof a[1] === 'number' ? String.fromCharCode(a[1]) : String(a[1])[0]).repeat(num(a[0]));
      case 'SPACE$': return ' '.repeat(num(a[0]));
      case 'CVI': { const b = bytesOf(String(a[0])); const v = (b[0] || 0) | ((b[1] || 0) << 8); return v & 0x8000 ? v - 0x10000 : v; }
      case 'MKI$': { const n = num(a[0]) & 0xffff; return String.fromCharCode(n & 0xff, (n >> 8) & 0xff); }
      case 'CVS': return mbfSingleToFloat(bytesOf(String(a[0])));
      case 'MKS$': return strOf(floatToMbfSingle(num(a[0])));
      case 'CVD': return mbfDoubleToFloat(bytesOf(String(a[0])));
      case 'MKD$': return strOf(encodeMbfDoubleDecimal(num(a[0])));
      case 'INKEY$': return this.term.inkey();
    }
    return 0;
  }
}

// True if a statement list (an IF branch) contains no blocking/async op, so the synchronous
// fast path can run it whole. Blocking = input/open/put/chain/gosub/on..gosub; also bail on
// nested IF whose branches aren't pure. (INKEY$/INPUT$ inside an expression still surface as _S
// at eval time, so this only needs to catch statement-level blockers.)
function branchIsPure(stmts) {
  for (const st of stmts || []) {
    if (st.t === 'input' || st.t === 'open' || st.t === 'put' || st.t === 'chain' || st.t === 'gosub') return false;
    if (st.t === 'on' && st.gosub) return false;
    if (st.t === 'if' && (!branchIsPure(st.then) || !branchIsPure(st.else))) return false;
  }
  return true;
}

// GW-BASIC/DOS canonicalizes filenames to UPPERCASE — OPEN "chq.dat" and OPEN "CHQ.DAT" refer to
// the same file. The .BAS mix case (e.g. CHQ-ADJ: OPEN "CHQ.DAT" but KILL "chq.dat"). Uppercase at
// the interpreter's file boundary so every op targets one canonical name, matching the real files.
const fileName = (v) => String(v).trim().toUpperCase();

const num = (v) => (typeof v === 'number' ? v : parseFloat(v) || 0);
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
