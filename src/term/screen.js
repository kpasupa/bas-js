// 80×25 text screen emulating the GW-BASIC console: LOCATE/COLOR/CLS/PRINT primitives
// over a character+color cell buffer, rendered to a DOM element as colored spans.

// CGA/EGA 16-color palette (indices 0–15). COLOR fg,bg uses these; fg 16–31 = blink.
const CGA = [
  '#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
  '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff',
];

class Screen {
  constructor(el, rows = 25, cols = 80) {
    this.el = el;
    this.rows = rows;
    this.cols = cols;
    this.fg = 7;
    this.bg = 0;
    this.row = 1;
    this.col = 1;
    this.cursorOn = false;
    this.cells = [];
    this.cls();
  }

  cls() {
    this.cells = Array.from({ length: this.rows }, () =>
      Array.from({ length: this.cols }, () => ({ ch: ' ', fg: this.fg, bg: this.bg })));
    this.row = 1;
    this.col = 1;
    this.render();
  }

  color(fg, bg) {
    if (fg != null) this.fg = fg;
    if (bg != null) this.bg = bg;
  }

  locate(row, col) {
    if (row != null) this.row = Math.max(1, Math.min(this.rows, row));
    if (col != null) this.col = Math.max(1, Math.min(this.cols, col));
  }

  // TAB(n): move the print column to n (1-based). If already past n, wrap to next line.
  tab(n) {
    if (this.col > n) this.newline();
    this.col = Math.max(1, Math.min(this.cols, n));
  }

  newline() {
    this.col = 1;
    this.row += 1;
    if (this.row > this.rows) { this.scroll(); this.row = this.rows; }
  }

  scroll() {
    this.cells.shift();
    this.cells.push(Array.from({ length: this.cols }, () => ({ ch: ' ', fg: this.fg, bg: this.bg })));
  }

  // Write a string at the cursor (no implicit newline), wrapping at the right edge.
  // Visible blink is approximated by mapping fg 16–31 to the base color + a blink flag.
  put(str) {
    const blink = this.fg >= 16;
    const fg = this.fg % 16;
    for (const ch of String(str)) {
      if (ch === '\n') { this.newline(); continue; }
      if (this.col > this.cols) this.newline();
      this.cells[this.row - 1][this.col - 1] = { ch, fg, bg: this.bg, blink };
      this.col += 1;
    }
  }

  // PRINT semantics: write text, then CRLF unless `noNewline` (trailing ';').
  print(str = '', noNewline = false) {
    this.put(str);
    if (!noNewline) this.newline();
  }

  setCursorVisible(on) { this.cursorOn = on; this.render(); }

  render() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const cells = this.cells[r];
      let html = '';
      let run = null;
      const flush = () => {
        if (!run) return;
        const cls = run.blink ? 'blink' : run.cursor ? 'cursor-blink' : '';
        html += `<span style="color:${CGA[run.fg]};background:${CGA[run.bg]}"${cls ? ` class="${cls}"` : ''}>${run.text}</span>`;
        run = null;
      };
      for (let c = 0; c < this.cols; c++) {
        const cell = cells[c];
        const isCursor = this.cursorOn && r === this.row - 1 && c === this.col - 1;
        const fg = isCursor ? cell.bg : cell.fg;
        const bg = isCursor ? cell.fg : cell.bg;
        const blink = !!cell.blink;
        let ch = cell.ch;
        ch = ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch;
        if (run && run.fg === fg && run.bg === bg && run.blink === blink && !isCursor && !run.cursor) run.text += ch;
        else { flush(); run = { fg, bg, blink, cursor: isCursor, text: ch }; }
      }
      flush();
      out.push(html);
    }
    this.el.innerHTML = out.join('\n');
  }
}

// GW-BASIC string helpers.
const STRING$ = (n, ch) => (typeof ch === 'number' ? String.fromCharCode(ch) : ch[0]).repeat(n);
const SPACE$ = (n) => ' '.repeat(n);
// STR$: leading space for non-negative numbers, as GW-BASIC does.
const STR$ = (n) => (n >= 0 ? ' ' + n : String(n));
