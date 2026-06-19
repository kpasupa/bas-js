// Keyboard + input primitives over a Screen: INPUT (line, typed), INPUT$(1) (one key),
// INKEY$ (non-blocking poll). One Terminal owns the keydown listener for a screen.

// Sentinel value injected by abort() — never a real keypress.
const _ESC_SENTINEL = Symbol('esc');

class Terminal {
  constructor(screen) {
    this.screen = screen;
    this._buf = [];        // keys waiting to be consumed (INKEY$ / INPUT$)
    this._waiters = [];    // pending nextKey() resolvers
    this._trapBuf = [];    // function-key numbers (F1..F12 -> 1..12) for ON KEY trapping
    this._onKey = this._onKey.bind(this);
    this._ctrlCTime = 0;     // timestamp of last Ctrl+C — double-tap within 500ms aborts
    this._inkeyPending = null; // scan code held between two INKEY$ calls for an extended key
  }

  attach() { window.addEventListener('keydown', this._onKey); }
  detach() { window.removeEventListener('keydown', this._onKey); }

  pasteText(text) {
    text = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
    for (const ch of text) {
      if (ch < ' ' && ch !== '\r') continue;
      if (this._waiters.length) this._waiters.shift()(ch); else this._buf.push(ch);
    }
  }

  async pasteClipboard() {
    let text;
    try { text = await navigator.clipboard.readText(); } catch(e) { return; }
    this.pasteText(text);
  }

  // Deliver one keypress to the next waiter or to _buf.
  // Extended keys are stored as a single 2-char '\x00X' string; inkey() splits them.
  _enqueue(ch) {
    const disp = ch => ch.split('').map(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126 ? `\\x${c.charCodeAt(0).toString(16).padStart(2,'0')}` : c).join('');
    if (this._waiters.length) { console.log(`[key] enqueue→waiter "${disp(ch)}"`); this._waiters.shift()(ch); }
    else { console.log(`[key] enqueue→buf "${disp(ch)}" buf=${this._buf.length+1}`); this._buf.push(ch); }
  }

  _onKey(e) {
    // Ctrl+C double-tap (≤500 ms apart) → abort. Single Ctrl+C passes to browser (copy).
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
      const now = Date.now();
      if (now - this._ctrlCTime <= 500) {
        e.preventDefault();
        this._ctrlCTime = 0;
        this.abort();
        return;
      }
      this._ctrlCTime = now;
      return; // first press: let browser handle as copy
    }
    const fk = /^F([1-9]|1[0-2])$/.exec(e.key);
    if (fk) {
      e.preventDefault();
      const n = parseInt(fk[1], 10);
      this._trapBuf.push(n);
      if (n >= 1 && n <= 10) this._enqueue('\x00' + String.fromCharCode(58 + n)); // F1=CHR$(59)..F10=CHR$(68)
      return;
    }
    let ch = null;
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) ch = e.key;
    else if (e.key === 'Enter')      ch = '\r';
    else if (e.key === 'Backspace')  ch = '\b';
    else if (e.key === 'Tab')        ch = '\t';              // CHR$(9)
    else if (e.key === 'Escape')     ch = '\x1b';            // CHR$(27)
    else if (e.key === 'ArrowUp')    { ch = '\x00H'; this._trapBuf.push(11); }  // KEY(11)
    else if (e.key === 'ArrowDown')  { ch = '\x00P'; this._trapBuf.push(14); }  // KEY(14)
    else if (e.key === 'ArrowLeft')  { ch = e.ctrlKey ? '\x00s' : '\x00K'; this._trapBuf.push(12); }  // KEY(12)
    else if (e.key === 'ArrowRight') { ch = e.ctrlKey ? '\x00t' : '\x00M'; this._trapBuf.push(13); }  // KEY(13)
    else if (e.key === 'Home')       ch = e.ctrlKey ? '\x00w' : '\x00G';   // CHR$(119) / CHR$(71)
    else if (e.key === 'End')        ch = e.ctrlKey ? '\x00u' : '\x00O';   // CHR$(117) / CHR$(79)
    else if (e.key === 'PageUp')     ch = e.ctrlKey ? '\x00\x84' : '\x00I'; // CHR$(132) / CHR$(73)
    else if (e.key === 'PageDown')   ch = e.ctrlKey ? '\x00v' : '\x00Q';   // CHR$(118) / CHR$(81)
    else if (e.key === 'Insert')     ch = '\x00R';           // CHR$(0)+CHR$(82)
    else if (e.key === 'Delete')     ch = '\x00S';           // CHR$(0)+CHR$(83)
    if (ch === null) return;
    e.preventDefault();
    this._enqueue(ch);
  }

  nextKey() {
    return new Promise((res) => {
      if (this._buf.length) res(this._buf.shift());
      else this._waiters.push(res);
    });
  }

  // INKEY$: non-blocking poll. Extended keys (stored as '\x00X' 2-char strings) are
  // returned as two separate calls — CHR$(0) first, then the scan code — matching real
  // GW-BASIC keyboard-buffer behaviour so games can detect them with two INKEY$ calls.
  inkey() {
    if (this._aborted) throw Object.assign(new Error('ESC'), { name: 'EscapeError' });
    const disp = c => typeof c === 'string' ? c.split('').map(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126 ? `\\x${c.charCodeAt(0).toString(16).padStart(2,'0')}` : c).join('') : String(c);
    if (this._inkeyPending !== null) {
      const sc = this._inkeyPending;
      this._inkeyPending = null;
      console.log(`[inkey] pending→"${disp(sc)}"`);
      return sc;
    }
    if (!this._buf.length) return '';
    const ch = this._buf.shift();
    if (typeof ch === 'string' && ch.length === 2 && ch.charCodeAt(0) === 0) {
      this._inkeyPending = ch[1];
      console.log(`[inkey] ext→"\\x00" pending="${disp(ch[1])}" buf=${this._buf.length}`);
      return '\x00';
    }
    console.log(`[inkey] →"${disp(ch)}" buf=${this._buf.length}`);
    return ch;
  }

  async inputKey() { return this.nextKey(); }                   // INPUT$(1)
  nextTrap() { return this._trapBuf.length ? this._trapBuf.shift() : 0; } // ON KEY: next trapped F-key #

  // Interrupt any pending nextKey() waiter and future reads with an escape signal.
  abort() {
    while (this._waiters.length) this._waiters.shift()(_ESC_SENTINEL);
    this._buf = [_ESC_SENTINEL];
    this._aborted = true;
  }

  // INPUT a line. type: 'str' | 'int' | 'num'. question:true prepends "? " (bare INPUT / ';' form).
  async inputLine({ type = 'str', question = false } = {}) {
    const s = this.screen;
    if (question) { s.put('? '); s.render(); }
    s.setCursorVisible(true);
    // Bidirectional stage fence: clear buffer and pending scan-code on the way IN
    // (discards game-loop leftovers before the prompt) and again on the way OUT
    // (prevents keys typed during INPUT from leaking into game-mode INKEY$ reads).
    const disp = c => typeof c === 'string' ? c.split('').map(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126 ? `\\x${c.charCodeAt(0).toString(16).padStart(2,'0')}` : c).join('') : String(c);
    const _flushInput = (label) => {
      const dropped = this._buf.filter(c => c !== _ESC_SENTINEL).map(disp);
      if (this._inkeyPending !== null || dropped.length)
        console.log(`[inputLine] flush(${label}) pending="${disp(this._inkeyPending)}" dropped=[${dropped.map(s=>`"${s}"`).join(',')}]`);
      this._inkeyPending = null;
      this._buf = this._buf.filter(c => c === _ESC_SENTINEL);
    };
    _flushInput('enter');
    let buf = '';
    for (;;) {
      const ch = await this.nextKey();
      if (ch === _ESC_SENTINEL) { s.setCursorVisible(false); throw Object.assign(new Error('ESC'), { name: 'EscapeError' }); }
      if (ch === '\r') break;
      if (ch === '\x1b') continue; // ESC key from keyboard (ignored in line input)
      if (ch === '\b') {
        if (buf.length) { buf = buf.slice(0, -1); s.col -= 1; s.put(' '); s.col -= 1; s.render(); }
        continue;
      }
      if (ch < ' ') { console.log(`[inputLine] skip ctrl "${disp(ch)}"`); continue; }
      buf += ch;
      s.put(ch);
      s.render();
    }
    s.newline();
    s.render();
    console.log(`[inputLine] result="${buf}"`);
    _flushInput('exit'); // clear keys pressed during / just after typing
    if (type === 'int') { const v = parseInt(buf, 10); return Number.isNaN(v) ? 0 : v; }
    if (type === 'num') { const v = parseFloat(buf); return Number.isNaN(v) ? 0 : v; }
    return buf;
  }
}
