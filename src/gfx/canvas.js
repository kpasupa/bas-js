// Graphics backend — GW-BASIC SCREEN/PSET/LINE/CIRCLE/PAINT/etc. on an HTML canvas.
// Logical resolution follows the SCREEN mode (1 = 320×200, 2 = 640×200); the canvas is scaled
// up with nearest-neighbour ("pixelated") so the chunky CGA look is preserved. Colours use the
// 16-entry CGA/EGA palette, remappable by PALETTE.
//
// Coordinates: (0,0) top-left by default. WINDOW sets a logical coordinate space (with optional
// y-flip via WINDOW SCREEN); VIEW sets a physical sub-rectangle. The interpreter passes raw
// numbers; this module maps them. "last point" is tracked for LINE -(x,y) continuation.
const CGA16 = ['#000000', '#0000AA', '#00AA00', '#00AAAA', '#AA0000', '#AA00AA', '#AA5500', '#AAAAAA',
  '#555555', '#5555FF', '#55FF55', '#55FFFF', '#FF5555', '#FF55FF', '#FFFF55', '#FFFFFF'];

class Graphics {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.W = 320; this.H = 200; this.fg = 15; this.bg = 0; this.lastX = 0; this.lastY = 0;
    this.pal = CGA16.slice(); this.view = null; this.win = null; this.mode = 0;
  }

  screen(mode) {
    this.mode = mode;
    if (mode === 0) { this.canvas.style.display = 'none'; return; }   // back to text
    this.W = mode === 2 ? 640 : 320; this.H = 200;
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.canvas.style.display = 'block';
    this.ctx.imageSmoothingEnabled = false;
    this.view = null; this.win = null; this.fg = mode === 2 ? 1 : 15; this.bg = 0;
    this.cls();
  }
  active() { return this.mode !== 0; }
  cls() { this.ctx.fillStyle = this.pal[this.bg]; this.ctx.fillRect(0, 0, this.W, this.H); }
  color(fg, bg) { if (fg != null) this.fg = fg & 15; if (bg != null) this.bg = bg & 15; }
  palette(attr, col) { if (attr == null) this.pal = CGA16.slice(); else this.pal[attr & 15] = CGA16[col & 15]; }

  // ── coordinate mapping (WINDOW logical space + VIEW physical rect) ──
  _map(x, y) {
    if (this.win) {
      const w = this.win; const vx = this.view ? this.view.x : 0, vy = this.view ? this.view.y : 0;
      const vw = this.view ? this.view.w : this.W, vh = this.view ? this.view.h : this.H;
      let px = (x - w.x1) / (w.x2 - w.x1) * (vw - 1) + vx;
      let py = (y - w.y1) / (w.y2 - w.y1) * (vh - 1) + vy;
      return [px, py];
    }
    if (this.view) return [x + this.view.x, y + this.view.y];
    return [x, y];
  }
  _col(c) { return this.pal[(c == null ? this.fg : c) & 15]; }

  pset(x, y, c) { this.ctx.fillStyle = this._col(c); const [px, py] = this._map(x, y); this.ctx.fillRect(Math.round(px), Math.round(py), 1, 1); this.lastX = x; this.lastY = y; }
  preset(x, y, c) { this.pset(x, y, c == null ? this.bg : c); }

  // LINE (x1,y1)-(x2,y2),color[,B|BF]. box: '' | 'B' | 'BF'.
  line(x1, y1, x2, y2, c, box) {
    const [ax, ay] = this._map(x1, y1), [bx, by] = this._map(x2, y2);
    this.ctx.fillStyle = this._col(c); this.ctx.strokeStyle = this._col(c); this.ctx.lineWidth = 1;
    if (box === 'BF') { this.ctx.fillRect(Math.round(Math.min(ax, bx)), Math.round(Math.min(ay, by)), Math.abs(bx - ax) + 1, Math.abs(by - ay) + 1); }
    else if (box === 'B') { this.ctx.strokeRect(Math.round(Math.min(ax, bx)) + 0.5, Math.round(Math.min(ay, by)) + 0.5, Math.abs(bx - ax), Math.abs(by - ay)); }
    else { this.ctx.beginPath(); this.ctx.moveTo(Math.round(ax) + 0.5, Math.round(ay) + 0.5); this.ctx.lineTo(Math.round(bx) + 0.5, Math.round(by) + 0.5); this.ctx.stroke(); }
    this.lastX = x2; this.lastY = y2;
  }

  // CIRCLE (x,y),r,color,start,end,aspect — arcs when start/end given; aspect squashes to ellipse.
  circle(x, y, r, c, start, end, aspect) {
    const [cx, cy] = this._map(x, y);
    const asp = aspect != null ? aspect : (this.H / this.W) * (this.W / this.H);  // ~1 by default
    const rx = r, ry = aspect != null ? r * aspect : r;
    this.ctx.strokeStyle = this._col(c); this.ctx.lineWidth = 1; this.ctx.beginPath();
    const a0 = start != null ? start : 0, a1 = end != null ? end : Math.PI * 2;
    // GW-BASIC angles are CCW from +x; canvas y is down, so negate angle.
    this.ctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, -a1, -a0, true);
    this.ctx.stroke(); this.lastX = x; this.lastY = y;
  }

  // PAINT (x,y),paintColor,borderColor — scanline flood fill until the border colour is hit.
  paint(x, y, c, border) {
    const [sx, sy] = this._map(x, y); const X = Math.round(sx), Y = Math.round(sy);
    const img = this.ctx.getImageData(0, 0, this.W, this.H); const d = img.data;
    const fill = this._rgb(c == null ? this.fg : c), bord = this._rgb(border == null ? (c == null ? this.fg : c) : border);
    const at = (px, py) => (py * this.W + px) * 4;
    const isBord = (px, py) => { const i = at(px, py); return d[i] === bord[0] && d[i + 1] === bord[1] && d[i + 2] === bord[2]; };
    const isFill = (px, py) => { const i = at(px, py); return d[i] === fill[0] && d[i + 1] === fill[1] && d[i + 2] === fill[2]; };
    if (X < 0 || Y < 0 || X >= this.W || Y >= this.H || isBord(X, Y)) return;
    const st = [[X, Y]];
    while (st.length) {
      const [px, py] = st.pop();
      if (px < 0 || px >= this.W || py < 0 || py >= this.H) continue;
      if (isBord(px, py) || isFill(px, py)) continue;
      let l = px; while (l - 1 >= 0 && !isBord(l - 1, py) && !isFill(l - 1, py)) l--;
      let rr = px; while (rr + 1 < this.W && !isBord(rr + 1, py) && !isFill(rr + 1, py)) rr++;
      for (let i = l; i <= rr; i++) { const o = at(i, py); d[o] = fill[0]; d[o + 1] = fill[1]; d[o + 2] = fill[2]; d[o + 3] = 255; st.push([i, py - 1], [i, py + 1]); }
    }
    this.ctx.putImageData(img, 0, 0);
  }

  _rgb(idx) { const h = this.pal[idx & 15]; return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  // POINT(x,y) → nearest palette index at that pixel.
  point(x, y) {
    const [px, py] = this._map(x, y); const X = Math.round(px), Y = Math.round(py);
    if (X < 0 || Y < 0 || X >= this.W || Y >= this.H) return -1;
    const d = this.ctx.getImageData(X, Y, 1, 1).data; let best = 0, bd = 1e9;
    for (let i = 0; i < 16; i++) { const [r, g, b] = this._rgb(i); const dd = (r - d[0]) ** 2 + (g - d[1]) ** 2 + (b - d[2]) ** 2; if (dd < bd) { bd = dd; best = i; } }
    return best;
  }
  // PMAP(n,fn): map between logical/physical x or y. fn 0/1 logical→physical x/y, 2/3 physical→logical.
  pmap(v, fn) { const [px, py] = this._map(fn % 2 === 0 ? v : 0, fn % 2 === 1 ? v : 0); return fn === 0 ? px : fn === 1 ? py : v; }

  getImage(x1, y1, x2, y2) { const [ax, ay] = this._map(x1, y1), [bx, by] = this._map(x2, y2); return this.ctx.getImageData(Math.round(Math.min(ax, bx)), Math.round(Math.min(ay, by)), Math.abs(bx - ax) + 1, Math.abs(by - ay) + 1); }
  putImage(x, y, img) { if (img) { const [px, py] = this._map(x, y); this.ctx.putImageData(img, Math.round(px), Math.round(py)); } }

  setView(x1, y1, x2, y2) { if (x1 == null) this.view = null; else this.view = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) + 1, h: Math.abs(y2 - y1) + 1 }; }
  setWindow(x1, y1, x2, y2) { if (x1 == null) this.win = null; else this.win = { x1, y1, x2, y2 }; }

  // DRAW macro string. Movement U/D/L/R + diagonals E/F/G/H (n pixels × scale/4); M x,y move
  // (absolute, or +/- relative); B prefix = move without drawing; N prefix = draw then return;
  // C n set colour; S n set scale. Drawing starts at the last graphics point.
  draw(str) {
    const s = String(str).toUpperCase(); let i = 0;
    let x = this.lastX, y = this.lastY, color = this.fg, scale = 4, blank = false, noup = false;
    const numAt = () => { let sign = 1; if (s[i] === '+') i++; else if (s[i] === '-') { sign = -1; i++; } let n = ''; while (i < s.length && s[i] >= '0' && s[i] <= '9') n += s[i++]; return sign * (n === '' ? 1 : parseInt(n, 10)); };
    const seg = (nx, ny) => { if (!blank) this.line(x, y, nx, ny, color, ''); if (!noup) { x = nx; y = ny; } blank = false; noup = false; };
    while (i < s.length) {
      const c = s[i++]; if (c === ' ') continue;
      if (c === 'B') { blank = true; continue; }
      if (c === 'N') { noup = true; continue; }
      if (c === 'C') { color = numAt() & 15; continue; }
      if (c === 'S') { scale = numAt(); continue; }
      if (c === 'A') { numAt(); continue; }                 // rotation — accepted, not applied
      if (c === 'M') { const rel = (s[i] === '+' || s[i] === '-'); const nx = numAt(); if (s[i] === ',') i++; const ny = numAt(); seg(rel ? x + nx : nx, rel ? y + ny : ny); continue; }
      const d = numAt() * scale / 4; let dx = 0, dy = 0;
      switch (c) {
        case 'U': dy = -d; break; case 'D': dy = d; break; case 'L': dx = -d; break; case 'R': dx = d; break;
        case 'E': dx = d; dy = -d; break; case 'F': dx = d; dy = d; break; case 'G': dx = -d; dy = d; break; case 'H': dx = -d; dy = -d; break;
        default: continue;
      }
      seg(x + dx, y + dy);
    }
    this.lastX = x; this.lastY = y;
  }
}
