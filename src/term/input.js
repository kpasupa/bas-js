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
    this._ctrlCTime = 0;  // timestamp of last Ctrl+C — double-tap within 500ms aborts
    this._ctrlVTime = 0;  // timestamp of last Ctrl+V — double-tap within 500ms sends CHR$(22)
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
    // Ctrl+V double-tap (≤500 ms apart) → CHR$(22). Single Ctrl+V passes to browser (paste).
    if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) {
      const now = Date.now();
      if (now - this._ctrlVTime <= 500) {
        e.preventDefault();
        this._ctrlVTime = 0;
        const ch = '\x16';
        if (this._waiters.length) this._waiters.shift()(ch); else this._buf.push(ch);
        return;
      }
      this._ctrlVTime = now;
      return; // first press: let browser handle as paste
    }
    const fk = /^F([1-9]|10)$/.exec(e.key);  // F11/F12 pass to browser (DevTools, fullscreen)
    if (fk) {
      e.preventDefault();
      const n = parseInt(fk[1], 10);
      if (!e.shiftKey) this._trapBuf.push(n);               // ON KEY traps unshifted F-keys only
      const scan = e.shiftKey ? 83 + n : 58 + n;            // Shift+F1=84..Shift+F10=93; F1=59..F10=68
      const ch = '\x00' + String.fromCharCode(scan);
      if (this._waiters.length) this._waiters.shift()(ch); else this._buf.push(ch);
      return;
    }
    let ch = null;
    if (e.ctrlKey && e.key.length === 1) {
      const k = e.key.toLowerCase();
      if ('wtnr'.includes(k)) return;                        // let browser keep Ctrl+W/T/N/R
      const n = k.charCodeAt(0) - 96;
      if (n >= 1 && n <= 26) ch = String.fromCharCode(n);   // Ctrl+A=CHR$(1)..Ctrl+Z=CHR$(26)
    } else if (e.key.length === 1 && !e.altKey && !e.metaKey) ch = e.key;
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
    if (this._waiters.length) this._waiters.shift()(ch);
    else this._buf.push(ch);
  }

  nextKey() {
    return new Promise((res) => {
      if (this._buf.length) res(this._buf.shift());
      else this._waiters.push(res);
    });
  }

  // INKEY$: non-blocking poll. Extended keys (2-char '\x00X' strings) are returned as-is
  // in one call — matches real GW-BASIC where IF K$=CHR$(0)+CHR$(72) checks the full string.
  inkey() {
    if (this._aborted) throw Object.assign(new Error('ESC'), { name: 'EscapeError' });
    return this._buf.length ? this._buf.shift() : '';
  }

  // INPUT$(n): reads exactly one character at a time. Extended keys (2-char '\x00X')
  // are split: first call returns CHR$(0), next call returns the scan code.
  async inputKey() {
    const ch = await this.nextKey();
    if (typeof ch === 'string' && ch.length === 2 && ch.charCodeAt(0) === 0) {
      this._buf.unshift(ch[1]); // re-queue scan code for next INPUT$(1) call
      return '\x00';
    }
    return ch;
  }

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
    // Clear _trapBuf on the way in so ON KEY events fired during gameplay (arrows, F-keys)
    // don't trigger game handlers immediately after INPUT returns.
    this._trapBuf = [];
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
      if (ch < ' ') continue; // skip extended keys (\x00X) and other control chars
      buf += ch;
      s.put(ch);
      s.render();
    }
    s.newline();
    s.render();
    // Clear _trapBuf on the way out so keys pressed during INPUT don't leak into game handlers.
    this._trapBuf = [];
    if (type === 'int') { const v = parseInt(buf, 10); return Number.isNaN(v) ? 0 : v; }
    if (type === 'num') { const v = parseFloat(buf); return Number.isNaN(v) ? 0 : v; }
    return buf;
  }
}
