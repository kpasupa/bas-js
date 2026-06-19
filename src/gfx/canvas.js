// Graphics backend — GW-BASIC SCREEN/PSET/LINE/CIRCLE/PAINT/etc. on an HTML canvas.
//
// Modelled like real CGA: an INDEXED framebuffer (one palette index per pixel) is drawn into
// with exact, un-antialiased pixel ops, then blitted to the canvas through the current palette.
// This is what makes (a) PAINT flood-fill airtight — borders are exact colours, not AA blends;
// (b) PALETTE recolour instant — changing a palette entry re-blits every pixel that used it;
// (c) colours faithful — SCREEN 1 is a 4-colour CGA palette, SCREEN 2 is black/white.
//
// Coordinates: (0,0) top-left. WINDOW sets a logical space, VIEW a physical sub-rect; the
// interpreter passes raw numbers and this module maps them. CIRCLE angles are GW-BASIC's
// (CCW from 3 o'clock; on the y-down screen the 0..π arc appears on the bottom). "last point"
// is tracked for LINE -(x,y) continuation and DRAW.

// 16-colour CGA/EGA palette (RGB) — used for PALETTE overrides, the SCREEN-1 background, etc.
const CGA16 = [[0, 0, 0], [0, 0, 170], [0, 170, 0], [0, 170, 170], [170, 0, 0], [170, 0, 170], [170, 85, 0], [170, 170, 170],
  [85, 85, 85], [85, 85, 255], [85, 255, 85], [85, 255, 255], [255, 85, 85], [255, 85, 255], [255, 255, 85], [255, 255, 255]];
// SCREEN 1 four-colour palettes (entries 1-3); 0 is the background. Default = palette 1 (hi).
const SCR1_PAL = [
  [[0, 0, 0], [85, 255, 85], [255, 85, 85], [255, 255, 85]],    // palette 0: green / red / yellow
  [[0, 0, 0], [85, 255, 255], [255, 85, 255], [255, 255, 255]], // palette 1: cyan / magenta / white
];
// Common BASICA/QuickBASIC graphics modes. Modes beyond GW-BASIC's CGA set are included so
// old sample programs that pick EGA/VGA modes get the right coordinate space instead of clipping.
const _mon = 4 / 3;
const _aspect = (w, h) => _mon / (w / h);
const SCREEN_PROFILES = {
  1: { w: 320, h: 200, colors: 4, mono: false, displayAspect: _mon },
  2: { w: 640, h: 200, colors: 2, mono: true, displayAspect: _mon },
  7: { w: 320, h: 200, colors: 16, mono: false, displayAspect: _mon },
  8: { w: 640, h: 200, colors: 16, mono: false, displayAspect: _mon },
  9: { w: 640, h: 350, colors: 16, mono: false, displayAspect: _mon },
  10: { w: 640, h: 350, colors: 4, mono: false, displayAspect: _mon },
  11: { w: 640, h: 480, colors: 2, mono: true, displayAspect: _mon },
  12: { w: 640, h: 480, colors: 16, mono: false, displayAspect: _mon },
  13: { w: 320, h: 200, colors: 256, mono: false, displayAspect: _mon },
};
for (const p of Object.values(SCREEN_PROFILES)) p.circleAspect = _aspect(p.w, p.h);

class Graphics {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.W = 320; this.H = 200; this.mode = 0; this.fg = 3; this.bg = 0;
    this.lastX = 0; this.lastY = 0; this.view = null; this.win = null;
    this.colors = CGA16.slice(); this.ncol = 16;
    if (typeof window !== 'undefined') window.addEventListener('resize', () => { if (this.active()) this._fit(); }); // keep aligned on zoom/resize
  }

  screen(mode) {
    this.mode = mode;
    if (mode === 0) { this.canvas.style.display = 'none'; return; }
    const p = SCREEN_PROFILES[mode] || SCREEN_PROFILES[1];
    this.profile = p;
    this.W = p.w; this.H = p.h;
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.canvas.style.display = 'block'; this.ctx.imageSmoothingEnabled = false;
    this._fit();                                          // pin to the text screen's content area
    this.buf = new Uint8Array(this.W * this.H);           // palette index per pixel
    this.fence = new Uint8Array(this.W * this.H);        // LINE fence: permanent PAINT boundary
    this.img = this.ctx.createImageData(this.W, this.H); // RGBA mirror, blitted to the canvas
    if (p.mono) { this.colors = [[0, 0, 0], [255, 255, 255]]; this.ncol = 2; this.fg = 1; }
    else if (mode === 1) { this.colors = SCR1_PAL[1].slice(); this.ncol = 4; this.fg = 3; }
    else { this.colors = CGA16.slice(); this.ncol = p.colors; this.fg = p.colors > 4 ? 15 : 3; }
    this.bg = 0; this.lastX = 0; this.lastY = 0; this.view = null; this.win = null;
    this.cls();
  }
  active() { return this.mode !== 0; }
  // Pin the canvas to the text screen's content box — fill the full box so the GFX
  // background colour covers the entire screen area (no letterbox gaps).
  // circleAspect is recomputed for the actual display pixel ratio so CIRCLE stays round.
  _fit() {
    if (typeof document === 'undefined') return;
    const s = document.getElementById('screen'); if (!s) return;
    const r = s.getBoundingClientRect(), cs = getComputedStyle(s);
    const pl = parseFloat(cs.paddingLeft) || 0, pt = parseFloat(cs.paddingTop) || 0;
    const pr = parseFloat(cs.paddingRight) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    // Use natural (pre-transform) dimensions so the canvas mirrors #screen's scaling approach.
    // When #screen has scale(2,1), r.width ≈ 2×offsetWidth; detect and replicate the transform.
    const scaleX = r.width > s.offsetWidth * 1.5 ? 2 : 1;
    const boxW = s.offsetWidth - pl - pr, boxH = s.offsetHeight - pt - pb;
    this.canvas.style.left = (r.left + pl * scaleX) + 'px';
    this.canvas.style.top  = (r.top  + pt) + 'px';
    this.canvas.style.width  = boxW + 'px';
    this.canvas.style.height = boxH + 'px';
    this.canvas.style.transformOrigin = '0 0';
    this.canvas.style.transform = scaleX === 2 ? 'scale(2, 1)' : '';
    // pixel aspect ratio for the actual display; scaleX accounts for scale(2,1) in 40-col mode
    this._circleAspect = (boxW * scaleX * this.H) / (boxH * this.W);
  }
  _ci(c) { c = c == null ? this.fg : c | 0; return ((c % this.ncol) + this.ncol) % this.ncol; } // wrap to mode's colour count

  // ── framebuffer ↔ canvas ──
  _put(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const ci = this._ci(c), i = y * this.W + x, o = i * 4, rgb = this.colors[ci] || CGA16[ci & 15];
    this.buf[i] = ci; this.img.data[o] = rgb[0]; this.img.data[o + 1] = rgb[1]; this.img.data[o + 2] = rgb[2]; this.img.data[o + 3] = 255;
  }
  blit() { this.ctx.putImageData(this.img, 0, 0); }
  _repaintAll() { for (let i = 0; i < this.buf.length; i++) { const rgb = this.colors[this.buf[i]] || CGA16[0], o = i * 4; this.img.data[o] = rgb[0]; this.img.data[o + 1] = rgb[1]; this.img.data[o + 2] = rgb[2]; this.img.data[o + 3] = 255; } this.blit(); }

  cls() { this.buf.fill(this._ci(this.bg)); if (this.fence) this.fence.fill(0); this._repaintAll(); }
  // SCREEN 1: COLOR background[,palette]. SCREEN 2: COLOR foreground. PALETTE overrides one entry.
  color(a, b) {
    if (this.mode === 2) { if (a != null) this.fg = a ? 1 : 1; return; }
    if (a != null) this.colors[0] = CGA16[a & 15];
    if (b != null) { const p = SCR1_PAL[b & 1]; this.colors[1] = p[1]; this.colors[2] = p[2]; this.colors[3] = p[3]; }
    this._repaintAll();
  }
  palette(attr, col) { if (attr == null) { this.colors = (this.mode === 2 ? [[0, 0, 0], [255, 255, 255]] : SCR1_PAL[1].slice()); } else { this.colors[this._ci(attr)] = CGA16[col & 15]; } this._repaintAll(); }

  // ── coordinate mapping (WINDOW logical space + VIEW physical rect) ──
  _map(x, y) {
    if (this.win) {
      const w = this.win, vx = this.view ? this.view.x : 0, vy = this.view ? this.view.y : 0;
      const vw = this.view ? this.view.w : this.W, vh = this.view ? this.view.h : this.H;
      return [(x - w.x1) / (w.x2 - w.x1) * (vw - 1) + vx, (y - w.y1) / (w.y2 - w.y1) * (vh - 1) + vy];
    }
    if (this.view) return [x + this.view.x, y + this.view.y];
    return [x, y];
  }

  pset(x, y, c) { const [px, py] = this._map(x, y); this._put(px, py, c); this.blit(); this.lastX = x; this.lastY = y; }
  preset(x, y, c) { this.pset(x, y, c == null ? this.bg : c); }

  _linePx(ax, ay, bx, by, c, fenceIt) {  // integer Bresenham, exact pixels (no AA)
    ax = Math.round(ax); ay = Math.round(ay); bx = Math.round(bx); by = Math.round(by);
    const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay), sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
    let err = dx + dy, x = ax, y = ay;
    for (; ;) { this._put(x, y, c); if (fenceIt && this.fence) this.fence[y * this.W + x] = 1; if (x === bx && y === by) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x += sx; } if (e2 <= dx) { err += dx; y += sy; } }
  }
  // LINE (x1,y1)-(x2,y2),color[,B|BF].
  line(x1, y1, x2, y2, c, box) {
    const [ax, ay] = this._map(x1, y1), [bx, by] = this._map(x2, y2);
    if (box === 'BF') { const lo = Math.round(Math.min(ay, by)), hi = Math.round(Math.max(ay, by)); for (let yy = lo; yy <= hi; yy++) this._linePx(Math.min(ax, bx), yy, Math.max(ax, bx), yy, c, true); }
    else if (box === 'B') { this._linePx(ax, ay, bx, ay, c, true); this._linePx(bx, ay, bx, by, c, true); this._linePx(bx, by, ax, by, c, true); this._linePx(ax, by, ax, ay, c, true); }
    else this._linePx(ax, ay, bx, by, c, true);
    this.blit(); this.lastX = x2; this.lastY = y2;
  }

  // CIRCLE (x,y),r,color,start,end,aspect — parametric plot; arcs via start/end, ellipse via aspect.
  // GW-BASIC convention: negative start or end angle means draw a radial line from the center to
  // that endpoint (pie-slice mode). The arc itself always uses |angle|.
  circle(x, y, r, c, start, end, aspect) {
    const [cx, cy] = this._map(x, y), rx = Math.abs(r);
    const _hwAsp = this.profile?.circleAspect ?? 1;
    const ry = Math.abs(r * (aspect != null ? aspect : Math.min(this._circleAspect ?? _hwAsp, _hwAsp)));
    const full = start == null && end == null;
    if (full) {
      this._ellipsePx(Math.round(cx), Math.round(cy), Math.round(rx), Math.max(1, Math.round(ry)), c);
      this.blit(); this.lastX = x; this.lastY = y; return;
    }
    // Negative angles = pie-slice mode: use |angle| for arc, draw radial spoke from center to each endpoint.
    // GW-BASIC rule: if EITHER angle is negative, draw spokes for BOTH (both edges close the slice).
    const a0 = Math.abs(start != null ? start : 0), a1 = Math.abs(end != null ? end : Math.PI * 2);
    const arcPt = (a) => [cx + rx * Math.cos(a), cy - ry * Math.sin(a)]; // GW-BASIC: y-up → screen y-down
    const isPie = (start != null && start < 0) || (end != null && end < 0);
    if (isPie && start != null) { const [ex, ey] = arcPt(a0); this._linePx(Math.round(cx), Math.round(cy), Math.round(ex), Math.round(ey), c, true); }
    if (isPie && end   != null) { const [ex, ey] = arcPt(a1); this._linePx(Math.round(cx), Math.round(cy), Math.round(ex), Math.round(ey), c, true); }
    const steps = Math.max(16, Math.ceil(Math.abs(a1 - a0) * Math.max(rx, ry) * 1.5));
    let px = null, py = null;
    for (let k = 0; k <= steps; k++) {
      const [nx, ny] = arcPt(a0 + (a1 - a0) * k / steps);
      if (px != null) this._linePx(px, py, nx, ny, c);
      else this._put(Math.round(nx), Math.round(ny), c);  // first point
      px = nx; py = ny;
    }
    this.blit(); this.lastX = x; this.lastY = y;
  }

  _ellipsePx(cx, cy, rx, ry, c) {
    const plot4 = (x, y) => {
      this._put(cx + x, cy + y, c); this._put(cx - x, cy + y, c);
      this._put(cx + x, cy - y, c); this._put(cx - x, cy - y, c);
    };
    let x = 0, y = ry;
    const rx2 = rx * rx, ry2 = ry * ry;
    let dx = 0, dy = 2 * rx2 * y;
    let d1 = ry2 - rx2 * ry + 0.25 * rx2;
    while (dx < dy) {
      plot4(x, y);
      x++; dx += 2 * ry2;
      if (d1 < 0) d1 += dx + ry2;
      else { y--; dy -= 2 * rx2; d1 += dx - dy + ry2; }
    }
    let d2 = ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2;
    while (y >= 0) {
      plot4(x, y);
      y--; dy -= 2 * rx2;
      if (d2 > 0) d2 += rx2 - dy;
      else { x++; dx += 2 * ry2; d2 += dx - dy + rx2; }
    }
  }

  // PAINT (x,y),paint,border — scanline flood fill on the index buffer (exact, so airtight).
  paint(x, y, c, border) {
    const [sx, sy] = this._map(x, y), X = Math.round(sx), Y = Math.round(sy);
    if (X < 0 || Y < 0 || X >= this.W || Y >= this.H) return;
    const fill = this._ci(c), bord = border == null ? fill : this._ci(border), W = this.W, b = this.buf, f = this.fence;
    const open = (px, py) => !(f && f[py * W + px]) && b[py * W + px] !== bord && b[py * W + px] !== fill;
    if (b[Y * W + X] === bord) return;
    const st = [[X, Y]];
    while (st.length) {
      const [px, py] = st.pop();
      if (py < 0 || py >= this.H || px < 0 || px >= W || !open(px, py)) continue;
      let l = px; while (l - 1 >= 0 && open(l - 1, py)) l--;
      let rr = px; while (rr + 1 < W && open(rr + 1, py)) rr++;
      for (let i = l; i <= rr; i++) { this._put(i, py, fill); st.push([i, py - 1], [i, py + 1]); }
    }
    this.blit();
  }

  point(x, y) { const [px, py] = this._map(x, y), X = Math.round(px), Y = Math.round(py); return (X < 0 || Y < 0 || X >= this.W || Y >= this.H) ? -1 : this.buf[Y * this.W + X]; }
  pmap(v, fn) { const [px, py] = this._map(fn % 2 === 0 ? v : 0, fn % 2 === 1 ? v : 0); return fn === 0 ? px : fn === 1 ? py : v; }

  // GET/PUT — sprites are index rectangles grabbed from / blitted to the buffer.
  getImage(x1, y1, x2, y2) {
    const [ax, ay] = this._map(x1, y1), [bx, by] = this._map(x2, y2);
    const X = Math.round(Math.min(ax, bx)), Y = Math.round(Math.min(ay, by)), w = Math.abs(Math.round(bx) - Math.round(ax)) + 1, h = Math.abs(Math.round(by) - Math.round(ay)) + 1;
    const data = new Uint8Array(w * h);
    for (let r = 0; r < h; r++) for (let cc = 0; cc < w; cc++) { const px = X + cc, py = Y + r; data[r * w + cc] = (px >= 0 && py >= 0 && px < this.W && py < this.H) ? this.buf[py * this.W + px] : 0; }
    return { w, h, data };
  }
  putImage(x, y, img, mode) {
    if (!img || !img.data) return;
    const [px, py] = this._map(x, y), X = Math.round(px), Y = Math.round(py);
    const md = mode ? String(mode).toUpperCase() : 'XOR'; // GW-BASIC default PUT action is XOR (self-inverse: PUT draws, PUT again erases)
    if (md === 'PSET') {
      for (let r = 0; r < img.h; r++) for (let cc = 0; cc < img.w; cc++) this._put(X + cc, Y + r, img.data[r * img.w + cc]);
    } else {
      const mask = this.ncol - 1;
      for (let r = 0; r < img.h; r++) for (let cc = 0; cc < img.w; cc++) {
        const px2 = X + cc, py2 = Y + r;
        if (px2 < 0 || py2 < 0 || px2 >= this.W || py2 >= this.H) continue;
        const src = this._ci(img.data[r * img.w + cc]);
        const idx = py2 * this.W + px2;
        let ci;
        if (md === 'XOR')    ci = (this.buf[idx] ^ src) & mask;
        else if (md === 'AND') ci = (this.buf[idx] & src) & mask;
        else if (md === 'OR')  ci = (this.buf[idx] | src) & mask;
        else if (md === 'PRESET') ci = (~src) & mask;
        else ci = src & mask; // unknown → PSET
        const rgb = this.colors[ci] || CGA16[ci & 15];
        const o = idx * 4;
        this.buf[idx] = ci; this.img.data[o] = rgb[0]; this.img.data[o + 1] = rgb[1]; this.img.data[o + 2] = rgb[2]; this.img.data[o + 3] = 255;
      }
    }
    this.blit();
  }

  setView(x1, y1, x2, y2) { if (x1 == null) this.view = null; else this.view = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) + 1, h: Math.abs(y2 - y1) + 1 }; }
  setWindow(x1, y1, x2, y2) { if (x1 == null) this.win = null; else this.win = { x1, y1, x2, y2 }; }

  // DRAW macro: U/D/L/R + diagonals E/F/G/H (n × scale/4); M x,y move (abs or +/- rel);
  // B prefix = move without drawing; N prefix = draw then return; C n colour; S n scale.
  draw(str) {
    const s = String(str).toUpperCase(); let i = 0;
    let x = this.lastX, y = this.lastY, color = this.fg, scale = 4, blank = false, noup = false;
    const numAt = () => { let sign = 1; if (s[i] === '+') i++; else if (s[i] === '-') { sign = -1; i++; } let n = ''; while (i < s.length && s[i] >= '0' && s[i] <= '9') n += s[i++]; return sign * (n === '' ? 1 : parseInt(n, 10)); };
    const seg = (nx, ny) => { if (!blank) this.line(x, y, nx, ny, color, ''); if (!noup) { x = nx; y = ny; } blank = false; noup = false; };
    while (i < s.length) {
      const c = s[i++]; if (c === ' ') continue;
      if (c === 'B') { blank = true; continue; }
      if (c === 'N') { noup = true; continue; }
      if (c === 'C') { color = numAt(); continue; }
      if (c === 'S') { scale = numAt(); continue; }
      if (c === 'A') { numAt(); continue; }
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
