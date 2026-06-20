# bas-js

A **GW-BASIC runtime in the browser** — runs legacy line-numbered `.BAS` programs in an 80×25 text terminal, with CGA graphics and sound, reading and writing original binary random-access data files in-place.

Built to revive old DOS GW-BASIC applications. Point it at any folder of `.BAS` + data files and it runs them. See **`interpreter.html`** for a keyword-by-keyword coverage map.

> **Requires Chrome or Edge** — uses the [File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) for reading and writing files.

> **Compatibility notice:** This project was originally developed to run a specific set of legacy GW-BASIC applications. It covers a broad subset of the language, but full compatibility with all GW-BASIC programs is not guaranteed. If you encounter a missing keyword or incorrect behaviour, bug reports and contributions are welcome.

---

## Quick start

1. Clone or download this repo
2. Open `index.html` in Chrome or Edge — double-click, or run `run.bat` (Windows) / `./run.sh` (macOS/Linux) for a dedicated app window
3. Press **1** to add a project folder
4. Navigate to your folder in the file picker
5. Press **Enter** on the folder name to scan and open it

No server, no build step, no install.

> **AutoRun and the browser profile:** By default, `run.bat` / `run.sh` launches Chrome with a dedicated profile (`--user-data-dir`), keeping file permissions isolated from your regular browser. AutoRun settings and project lists are stored in that profile, so they will not be visible if you open `index.html` directly in the browser. To share state between the launcher and the browser, comment out or clear the `PROFILE` line in the run script — Chrome will then use its default profile.

---

## Gate UI

The gate is a keyboard-driven 80×25 terminal that sits in front of the interpreter. It manages multiple project folders.

### Navigation

| Key | Action |
|-----|--------|
| `↑ ↓` | Move selection |
| `↑` at top of list | Jump to Clock speed row |
| `← →` / `Tab` | Switch between folder list and file list |
| `Enter` | Open folder / run `.BAS` file |
| `Esc` | Go back to folder list |

### Function keys

| Key | Action |
|-----|--------|
| `1` / `F1` | Add a project folder |
| `2` / `F2` | Remove selected folder |
| `3` / `F3` | Change encoding for selected file |
| `4` / `F4` | Toggle AutoRun (auto-launches recent file on startup) |

### Clock speed

Controls the delay on every backward GOTO — slowing down changes how fast programs run, matching the original hardware feel.

| Speed | Delay | Notes |
|-------|-------|-------|
| SLOW | 100 ms | Very slow — useful for debugging |
| NORMAL | 33 ms | Default — matches a mid-era PC |
| FAST | 8 ms | Faster; may affect timing-sensitive games |
| MAX | 0 ms | No delay; breaks games that rely on loop timing |

Navigate to the `Clock: [NORMAL]` line at the top and press **Enter** to cycle through speeds. Or use `[` / `]` from anywhere in the gate.

### While a program is running

| Key | Action |
|-----|--------|
| `Ctrl+C+C` | Abort program and return to gate |
| `Esc` | Same as above |

---

## Encoding

Each `.BAS` file can have its own encoding for how high bytes (0x80–0xFF) are displayed and entered via INPUT.

| # | Name | Use case |
|---|------|----------|
| 0 | **Raw** | Passthrough — bytes render as Latin-1 |
| 1 | **CP437** | Standard DOS GW-BASIC — box drawing, Greek/math symbols |
| 2 | **KU42** | Thai DOS applications |

Press `3`/`F3` on a file in the right panel to cycle its encoding.

---

## What the interpreter supports

Open **`interpreter.html`** for the full coverage map. Highlights:

- **Flow:** GOTO, GOSUB/RETURN, ON..GOTO/GOSUB, IF/THEN/ELSE, FOR/NEXT, WHILE/WEND, END, STOP
- **Data:** variables + arrays (DIM, ERASE, OPTION BASE), DATA/READ/RESTORE, DEF FN, DEFINT/SNG/DBL/STR, SWAP, RANDOMIZE, CLEAR
- **Console:** PRINT (incl. USING), LPRINT, WRITE, INPUT, LINE INPUT, INKEY$, INPUT$, CLS, COLOR, LOCATE, BEEP, TAB/SPC
- **Files:** random (OPEN/FIELD/GET/PUT/LSET/RSET) and sequential (OPEN FOR INPUT/OUTPUT/APPEND, INPUT#/PRINT#/WRITE#/LINE INPUT#, EOF/LOF/LOC); KILL, NAME, FILES, RESET
- **Graphics** (`SCREEN 1/2` on canvas): PSET/PRESET, LINE (B/BF), CIRCLE, PAINT, DRAW, GET/PUT, PALETTE, VIEW/WINDOW, POINT/PMAP — composited under the text layer so text overlays graphics
- **Sound:** SOUND, PLAY (MML) via Web Audio
- **Traps:** ON ERROR GOTO / ERROR / ERR / ERL / RESUME, ON KEY (F-keys) / ON TIMER
- **Operators:** `+ - * / ^ MOD`, `= <> < > <= >=`, `AND OR NOT`, string concat
- **Functions:** INT, SQR, SIN…, LEN, MID$, INSTR, HEX$/OCT$, CINT/CSNG/CDBL, CVI/MKI$/CVS/CVD/MKS$/MKD$, DATE$/TIME$/TIMER, POS/CSRLIN, FRE, …

Hardware keywords (PEEK/POKE/CALL/INP/OUT/WAIT/VARPTR) and editor commands (LIST/SAVE/EDIT/RENUM…) are out of scope.

---

## Samples

`sample/INTERPRETER.BAS` is the root menu. From there:

- **BASIC/** — core language demos: commands, statements, functions, operators
- **GWBASIC/** — PC-extension demos: files, graphics (SCREEN 0/1/2), sound, event traps, CHAIN/COMMON, text colour picker, screen mode switcher
- **DEMO/** — standalone CHAIN demo (`MENU.BAS` → `MATH.BAS` → back)

---

## Reports

`LPRINT` output is captured and rendered as an HTML table using column positions from a `|`-delimited ruler line. Any program that prints a ruler followed by data rows becomes a formatted table automatically. Triggers the browser's native print/PDF dialog.

---

## Adding an encoding

**1. Create `src/codec/yourcodec.js`:**
```js
function yourDisplay(s) {
  let r = '';
  for (const ch of s) {
    const b = ch.charCodeAt(0);
    if (b < 0x80) { r += b < 0x20 ? '' : ch; continue; }
    r += YOUR_TABLE[b] ?? ch;
  }
  return r;
}
function yourEncode(u) {
  let r = '';
  for (const ch of u) {
    const cp = ch.codePointAt(0);
    r += cp < 0x80 ? String.fromCharCode(cp) : (YOUR_REV[ch] !== undefined ? String.fromCharCode(YOUR_REV[ch]) : '?');
  }
  return r;
}
```

**2. Load it in `index.html`** (before `src/app.js`):
```html
<script src="src/codec/yourcodec.js"></script>
```

**3. Wire it up in `src/gate.js`** — add a new entry to the codec registry and encoding cycle logic.

The interpreter calls `window._bas_codec.display(s)` for every PRINT/LPRINT output and `window._bas_codec.encode(s)` for every INPUT value. `window._bas_codec = null` passes bytes through raw.

---

## File layout

```
index.html              shell — loads scripts, sizes window
interpreter.html        keyword-by-keyword coverage map
run.bat                 Windows launcher (dedicated browser profile)
run.sh                  macOS/Linux launcher
sample/
  INTERPRETER.BAS       root menu (BASIC / GW-BASIC / Demo)
  BASIC/                core-language demos (commands, statements, functions, operators)
  GWBASIC/              PC-extension demos (files, graphics, sound, CHAIN, colour, screen modes)
  DEMO/                 standalone CHAIN demo (MENU.BAS → MATH.BAS → back)
src/
  gate.js               project browser/launcher — folder list, file picker, clock, run
  app.js                boot loop, tab title/favicon, gfx/audio wiring
  interp/basic.js       GW-BASIC interpreter (tokenizer, parser, runtime)
  term/
    screen.js           80×25 CGA terminal (16 colours, blink, cursor)
    input.js            keyboard input, INPUT line, INKEY$, ON KEY trap buffer
    beep.js             BEEP via Web Audio
    printusing.js       PRINT USING numeric masks
  gfx/
    canvas.js           SCREEN 1/2 — indexed CGA framebuffer, PSET/LINE/CIRCLE/PAINT/DRAW/PALETTE
  audio/
    sound.js            SOUND + PLAY (MML) via Web Audio
  data/
    store.js            File System Access API + IndexedDB; nested-path .BAS loading
    addressing.js       record addressing (1-based random files)
    schema.js           CUSTOMER / CHQ.DAT parse + patch
  codec/
    cp437.js            CP437 display/encode
    ku42.js             KU42 Thai display/encode
    mbf.js              MBF float encoder/decoder
    bytes.js            int16 LE
    date.js             packed DMY dates
  print/
    report.js           LPRINT capture → HTML table → print preview
```
