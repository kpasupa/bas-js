// Keyboard + input primitives over a Screen: INPUT (line, typed), INPUT$(1) (one key),
// INKEY$ (non-blocking poll). One Terminal owns the keydown listener for a screen.

// Sentinel value injected by abort() — never a real keypress.
const _ESC_SENTINEL = Symbol('esc');

class Terminal {
  constructor(screen) {
    this.screen = screen;
    this._buf = [];        // keys waiting to be consumed (INKEY$ / INPUT$)
    this._waiters = [];    // pending nextKey() resolvers
    this._onKey = this._onKey.bind(this);
  }

  attach() { window.addEventListener('keydown', this._onKey); }
  detach() { window.removeEventListener('keydown', this._onKey); }

  _onKey(e) {
    let ch = null;
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) ch = e.key;
    else if (e.key === 'Enter') ch = '\r';
    else if (e.key === 'Backspace') ch = '\b';
    else if (e.key === 'Escape') ch = '\x1b';
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

  inkey() { return this._buf.length ? this._buf.shift() : ''; } // INKEY$
  async inputKey() { return this.nextKey(); }                   // INPUT$(1)

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
      if (ch < ' ') continue;
      buf += ch;
      s.put(ch);
      s.render();
    }
    s.setCursorVisible(false);
    s.newline();
    s.render();
    if (type === 'int') { const v = parseInt(buf, 10); return Number.isNaN(v) ? 0 : v; }
    if (type === 'num') { const v = parseFloat(buf); return Number.isNaN(v) ? 0 : v; }
    return buf;
  }
}
