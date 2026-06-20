// Virtual printer + report renderer — universal, driven only by the report's own output.
//
// LPRINT output is captured (instead of going to the screen) as fixed-width text lines, then
// classified by content markers and turned into an HTML table for the browser's native print.
// NOTHING here is hard-coded per report — any .BAS that prints a "|" column ruler followed by
// rows becomes a table, so new/edited report programs work without code changes.
//
//   CHR$(27) ESC/P codes  → stripped (do not advance the column)
//   CHR$(12) form feed     → ignored (the HTML table re-paginates itself)
//   line of only '-'/'='   → rule (divider) → dropped
//   line containing '|'     → COLUMN RULER → column labels + %widths from the bar positions
//   line with "Page :"      → page header → dropped from the body (title captured once)
//   "Total…" line           → <tfoot> (label + final amount)
//   everything else         → data row
//   (no '|' ruler anywhere) → faithful monospace <pre> fallback
//
// Columns (labels + %widths) come from the spacing between '|' bars in the ruler. Each data
// line is split into cells by whichever of two strategies fits THAT line:
//   • by SEGMENT  — when the program printed one TAB/USING field per column (whole fields kept,
//     so multi-byte Thai names are never cut). Used when segs ≥ column count.
//   • by POSITION — when several fields were concatenated into one LPRINT (fewer segs than
//     columns): slice the flat text at the ruler's bar columns to recover each cell.
// KU42 bytes are decoded to Thai for display.


// Captures each LPRINT physical line as both a flat fixed-width string (for classification)
// and an ordered list of segments {col, text} (one per TAB-positioned field) so data cells
// map to columns by ORDER — robust even when the original's | ruler and data TABs don't align.
class ReportPrinter {
  constructor() { this.reset(); }
  reset() { this.lines = []; this._buf = ''; this._segs = []; this._curCol = 1; this._cur = ''; this._esc = 0; this._dirty = false; }
  isEmpty() { return this.lines.length === 0 && !this._dirty; }

  _flushSeg() { if (this._cur.length) this._segs.push({ col: this._curCol, text: this._cur }); this._cur = ''; }

  // LPRINT TAB(n): move to column n (1-based) → starts a new segment there. Never moves left.
  tab(n) { this._flushSeg(); while (this._buf.length < n - 1) this._buf += ' '; this._curCol = this._buf.length + 1; }
  spaces(n) { const s = ' '.repeat(n); this._buf += s; this._cur += s; this._dirty = true; }
  // Start a new segment at the current position (a PRINT USING value is its own column,
  // even when it immediately follows text — e.g. due-date then amount in one LPRINT).
  breakSeg() { this._flushSeg(); this._curCol = this._buf.length + 1; }

  // Append printed text. ESC/P (ESC + cmd + 1 arg) consumed without printing; form feed
  // dropped; high bytes KU42-decoded to Thai. Appends to both the flat line and current segment.
  put(text) {
    for (const ch of String(text)) {
      const b = ch.charCodeAt(0);
      if (this._esc > 0) { this._esc--; continue; }
      if (b === 0x1b) { this._esc = 2; continue; }   // ESC "3" n → skip next 2 chars
      if (b === 0x0c) continue;                       // form feed
      let out;
      if (b === 0x00 || b === 0x20 || b === 0xa0) out = ' ';
      else if (b === 0x16) out = '▬';                 // CHR$(22) divider bar
      else if (b < 0x20) continue;                    // other control
      else if (b < 0x80) out = ch;
      else out = (KU42_TO_UTF8[b] ?? ch);             // KU42 Thai
      this._buf += out; this._cur += out; this._dirty = true;
    }
  }

  newline() {
    this._flushSeg();
    this.lines.push({ text: this._buf.replace(/\s+$/, ''), segs: this._segs });
    this._buf = ''; this._segs = []; this._curCol = 1; this._cur = ''; this._dirty = false;
  }
}

const isRule = (s) => /^\s*[-]{3,}[\s-]*$/.test(s) || /^\s*[=]{3,}[\s=]*$/.test(s); // ---- or ==== divider
const isPageHdr = (s) => /page\s*:/i.test(s);
const looksNumeric = (s) => /\d/.test(s) && /^[\d.,()\- ]+$/.test(s);
const esc = (s) => s.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));

// lines (array of {text, segs}) → table model {title, columns, body, foot}.
//
// Cells are extracted by CHARACTER POSITION: the '|' bars in the ruler define column
// boundaries, and every data line's flat text is sliced at those same columns. This is
// faithful to how the dot-matrix output looked — each field was printed at a fixed column
// under its header — and it works even when a report concatenates several fields into one
// LPRINT (e.g. CHQ09 prints date+cheqno+duedate+bank as a single string), because the
// characters still land in the right columns.
function buildModel(lines) {
  const rulerIdx = lines.findIndex((l) => l.text.includes('|'));
  if (rulerIdx < 0) return { title: lines.map((l) => l.text), columns: [], body: [], foot: [], hasRuler: false };

  const title = lines
    .slice(0, rulerIdx)
    .filter((l) => l.text.trim() && !isRule(l.text))
    .map((l) => l.text.replace(/\s*page\s*:\s*\d+/i, '').trim());

  const maxLen = lines.reduce((m, l) => Math.max(m, l.text.length), 0);

  // Column char-ranges from the ruler's bar positions. Pieces before the first bar and after
  // the last bar are included; empty edge pieces (the leading/trailing bar of an enclosed
  // "|a|b|" ruler) are dropped so both enclosed and separator ("a|b|c") rulers work.
  const ruler = lines[rulerIdx].text;
  const bars = [];
  for (let i = 0; i < ruler.length; i++) if (ruler[i] === '|') bars.push(i);
  let prev = 0;
  let ranges = [];
  for (const b of bars) { ranges.push([prev, b]); prev = b + 1; }
  ranges.push([prev, maxLen]);
  ranges = ranges.map(([s, e]) => ({ s, e, label: ruler.slice(s, e).trim() }));
  while (ranges.length && ranges[0].label === '') ranges.shift();
  while (ranges.length && ranges[ranges.length - 1].label === '') ranges.pop();

  const ncol = ranges.length;
  const span = (r) => Math.max(1, r.e - r.s);
  const totalSpan = ranges.reduce((t, r) => t + span(r), 0) || 1;
  const columns = ranges.map((r) => ({ label: r.label, pct: (span(r) / totalSpan * 100).toFixed(1) }));

  // Split a data line into cells, choosing per line:
  //  • by SEGMENT — the program printed one TAB/USING field per column (name01d, chq06b, chq08).
  //    Preserves whole fields incl. Thai names; never cuts mid-text.
  //  • concatenated rows (fewer segments than columns, e.g. CHQ09/CHQ07B jam date+cheqno+due+bank
  //    into one LPRINT, then the amount via PRINT USING): position-slice the flat text at the
  //    ruler's bar columns. The last column (Amount) is taken from the trailing print segment,
  //    which also tells us exactly where Amount begins in the flat text — so the column BEFORE it
  //    is widened to absorb any overflow (e.g. a 29-char bank name in a 26-wide column keeps its
  //    full text instead of losing the tail or bleeding into Amount).
  const cellsFor = (l) => {
    if (l.segs.length >= ncol) return l.segs.slice(0, ncol).map((s) => s.text.trim());
    const lastSeg = l.segs.length >= 2 ? l.segs[l.segs.length - 1] : null;
    // Where does the trailing (amount) segment start in the flat text? Everything up to there
    // belongs to the preceding columns; the penultimate column extends to that boundary.
    const amtStart = lastSeg ? lastSeg.col - 1 : ranges[ncol - 1].s; // .col is 1-based
    const cells = ranges.map((r, i) => {
      if (lastSeg && i === ncol - 1) return lastSeg.text.trim();      // Amount = its own segment
      const end = (lastSeg && i === ncol - 2) ? amtStart : r.e;       // widen the column before Amount
      return l.text.slice(r.s, end).trim();
    });
    return fixSpill(cells);
  };

  const body = [], foot = [];
  for (let i = rulerIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.text.trim() || isRule(l.text) || l.text.includes('|') || isPageHdr(l.text)) continue; // structural / repeated header
    if (/total/i.test(l.text)) {                     // total line → tfoot: amount = last segment
      const segs = l.segs.map((s) => s.text.trim()).filter(Boolean);
      foot.push({ label: segs.slice(0, -1).join(' '), amt: segs.length ? segs[segs.length - 1] : '' });
      continue;
    }
    body.push(cellsFor(l));
  }
  return { title, columns, body, foot, hasRuler: true };
}

// A ruler column can be 1 char narrower than the real field (e.g. header "CheqNo." is 7 chars
// but the cheque number is 8), so the field's last char spills as a leading digit into the next
// cell — producing "326/05/2026" where "3" belongs to the cheque number. When a cell starts with
// 3+ digits immediately before a date "/", move that leading digit back to the previous cell.
function fixSpill(cells) {
  for (let i = 1; i < cells.length; i++) {
    if (/^\d{3,}\/\d/.test(cells[i]) && cells[i - 1]) {
      cells[i - 1] += cells[i][0];
      cells[i] = cells[i].slice(1);
    }
  }
  return cells;
}

function renderLprintHTML(lines) {
  // An HTML table for any report that has a '|' column ruler (position-based slicing handles
  // aligned AND concatenated-field reports). A report with no ruler at all falls back to
  // faithful monospace <pre> (the print dialog still gives Scale + page numbers + Save-PDF).
  const model = buildModel(lines);
  if (!model.hasRuler) {
    return `<pre class="rpt-pre">${lines.map((l) => esc(l.text)).join('\n')}</pre>`;
  }
  const { title, columns, body, foot } = model;
  const ncol = columns.length || 1;
  const colgroup = `<colgroup>${columns.map((c) => `<col style="width:${c.pct}%">`).join('')}</colgroup>`;
  const titleRow = title.length ? `<tr class="rpt-title"><th colspan="${ncol}">${title.map(esc).join('<br>')}</th></tr>` : '';
  const headRow = `<tr>${columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr>`;
  const cell = (t) => `<td class="${looksNumeric(t) ? 'num' : ''}">${esc(t)}</td>`;
  const tbody = body.map((cells) => `<tr>${cells.map(cell).join('')}</tr>`).join('');
  // tfoot: "Total …" → label spanning all but the last column, amount right-aligned in the last.
  const footHtml = foot.length ? `<tfoot>${foot.map(({ label, amt }) =>
    ncol >= 2
      ? `<tr><td colspan="${ncol - 1}">${esc(label)}</td><td class="num">${esc(amt)}</td></tr>`
      : `<tr><td>${esc(label + ' ' + amt)}</td></tr>`
  ).join('')}</tfoot>` : '';
  return `<table>${colgroup}<thead>${titleRow}${headRow}</thead><tbody>${tbody}</tbody>${footHtml}</table>`;
}

const REPORT_CSS = `
  body{font-family:'Tahoma','Leelawadee UI','Courier New',monospace;font-size:12px;margin:14px;color:#000;}
  table{width:100%;border-collapse:collapse;}
  th,td{border:1px solid #000;padding:2px 6px;vertical-align:top;white-space:pre-wrap;word-break:break-word;}
  thead th{background:#eee;text-align:center;}
  td.num{text-align:right;font-variant-numeric:tabular-nums;}
  tr.rpt-title th{border:none;text-align:left;font-size:15px;font-weight:700;padding:4px 0 8px;}
  pre.rpt-pre{font-family:'Courier New',monospace;font-size:12px;white-space:pre;margin:0;}
  thead{display:table-header-group;}   /* repeat header on every printed page */
  tfoot{display:table-footer-group;font-weight:700;}
  @media print{body{margin:0;}}
`;

// Render the captured lines into a hidden iframe and invoke the browser's native print
// preview (no popup blocker, unlike window.open). The user gets Scale + page numbers + PDF.
function showLprintPreview(lines, title = 'Report') {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${REPORT_CSS}</style></head><body>${renderLprintHTML(lines)}</body></html>`;
  let frame = document.getElementById('__report_frame');
  if (frame) frame.remove();
  frame = document.createElement('iframe');
  frame.id = '__report_frame';
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  // Print once, after the document has rendered (a tick lets Thai fonts/layout settle).
  // On afterprint: remove the frame (releases its focus) then refocus the screen.
  setTimeout(() => {
    try {
      frame.contentWindow.addEventListener('afterprint', () => {
        setTimeout(() => { frame.remove(); document.getElementById('screen')?.focus(); }, 100);
      }, { once: true });
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch (e) { /* preview unavailable */ }
  }, 200);
}
