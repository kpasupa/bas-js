# bas-js

A **GW-BASIC runtime in the browser** — runs legacy line-numbered `.BAS` programs in an 80×25 text terminal, with **CGA graphics and sound**, reading and writing their original binary random-access data files in-place.

Built to revive old DOS GW-BASIC applications. The runtime is generic — point it at any folder of `.BAS` + data files and it runs them. It covers essentially the whole GW-BASIC language a file runner can use; see **`interpreter.html`** for a keyword-by-keyword coverage map.

## Quick start

1. Clone or download this repo
2. Open `index.html` in Chrome or Edge — double-click, or run `run.bat` (Windows) / `./run.sh` (macOS/Linux) for a dedicated app window
3. Click **＋ Add folder**, pick the folder containing your `.BAS` files
4. Set the **boot filename** (the first `.BAS` to run, without extension)
5. Choose **encoding** for your project (see below)
6. Click **Run**

No server, no build step, no install.

> **Requires Chrome or Edge** — uses the [File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) for reading and writing files.

---

## Project gate

The gate (`index.html`) manages multiple projects. Each project has:

| Field | Description |
|---|---|
| **Folder** | The directory containing `.BAS` and data files |
| **Boot file** | First program to run (e.g. `PASSWORD`) — no `.BAS` extension |
| **Encoding** | How high bytes (0x80–0xFF) are decoded for display |

### Encoding options

| # | Name | Use case |
|---|---|---|
| 0 | **None** (raw) | Passthrough — bytes render as Latin-1 Unicode |
| 1 | **CP437** *(default)* | Standard DOS GW-BASIC — box drawing, block chars, Greek/math |
| 2 | **KU42** | Thai DOS applications |

### ESC key

Press **ESC** while a program is running to stop it and return to the gate.

---

## Forking for another language / encoding

To add your own encoding (e.g. Shift-JIS for Japanese):

**1. Create `src/codec/yourcodec.js`:**
```js
function yourDisplay(s) {
  let r = '';
  for (const ch of s) {
    const b = ch.charCodeAt(0);
    if (b < 0x80) { r += b === 0 || b === 0x20 ? ' ' : b < 0x20 ? '' : ch; continue; }
    r += YOUR_TABLE[b] ?? ch;  // your byte → Unicode lookup
  }
  return r;
}
function yourEncode(u) {
  let r = '';
  for (const ch of u) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) r += String.fromCharCode(cp);
    else r += YOUR_REV[ch] !== undefined ? String.fromCharCode(YOUR_REV[ch]) : '?';
  }
  return r;
}
```

**2. Load it in `index.html`** (before `src/app.js`):
```html
<script src="src/codec/yourcodec.js"></script>
```

**3. Wire it up** — in `index.html`'s inline script, add your codec to the selector and the `window._bas_codec` assignment:
```js
// in the encoding dropdown
<option value="yours">Your encoding name</option>

// when setting the codec before run
window._bas_codec = p.codec === 'yours'
  ? { display: yourDisplay, encode: yourEncode }
  : /* existing options */;
```

The interpreter calls `window._bas_codec.display(s)` for every PRINT/LPRINT output and `window._bas_codec.encode(s)` for every INPUT value. Setting `window._bas_codec = null` passes bytes through raw.

---

## What the interpreter supports

Open **`interpreter.html`** in a browser for the complete coverage map (each keyword tagged done / partial / dummy / skip). Highlights:

- **Flow:** GOTO, GOSUB/RETURN, ON..GOTO/GOSUB, IF/THEN/ELSE, FOR/NEXT, WHILE/WEND, END, STOP
- **Data:** variables + arrays (DIM n-D, ERASE, OPTION BASE), DATA/READ/RESTORE, DEF FN, DEFINT/SNG/DBL/STR, SWAP, RANDOMIZE (seedable RND), CLEAR
- **Console:** PRINT (incl. USING), LPRINT, WRITE, INPUT, LINE INPUT, INKEY$, INPUT$, CLS, COLOR, LOCATE, BEEP, TAB/SPC
- **Files:** random (OPEN/FIELD/GET/PUT/LSET/RSET) and sequential (OPEN FOR INPUT/OUTPUT/APPEND, INPUT#/PRINT#/WRITE#/LINE INPUT#, EOF/LOF/LOC); KILL, NAME, FILES, RESET
- **Graphics** (`SCREEN 1/2` on a canvas): PSET/PRESET, LINE (B/BF), CIRCLE, PAINT, DRAW, GET/PUT, PALETTE, VIEW/WINDOW, POINT/PMAP — composited *under* the text layer, so text overlays graphics with authentic opaque boxes
- **Sound:** SOUND, PLAY (MML) via Web Audio
- **Traps:** ON ERROR GOTO / ERROR / ERR / ERL / RESUME, ON KEY (F-keys) / ON TIMER
- **Operators:** `+ - * / ^ MOD`, `= <> < > <= >=`, `AND OR NOT`, string concat
- **Functions:** full math/string/conversion set — INT, SQR, SIN…, LEN, MID$, INSTR, HEX$/OCT$, CINT/CSNG/CDBL, CVI/MKI$/CVS/CVD/MKS$/MKD$, DATE$/TIME$/TIMER, POS/CSRLIN, FRE, …

Hardware keywords (PEEK/POKE/CALL/INP/OUT/WAIT/VARPTR) and editor commands (LIST/SAVE/EDIT/RENUM…) are intentionally out of scope — they need a real PC or an interactive editor. See `interpreter.html`.

## Demos

`sample/INTERPRETER.BAS` is a menu that walks every command group (BASIC / GW-BASIC → Commands / Statements / Functions / Operators) with a live example per keyword — boot it to explore the interpreter, including the graphics, sound, and `CHAIN`-colour demos. `sample/APP.BAS` + `MATH.BAS` are a smaller `CHAIN` demo.

## Codecs

| File | Purpose |
|---|---|
| `src/codec/cp437.js` | DOS Code Page 437 (default) |
| `src/codec/ku42.js` | KU42 Thai codepage |
| `src/codec/mbf.js` | Microsoft Binary Format — MKS$/MKD$/CVS/CVD, exact-decimal encoder |
| `src/codec/bytes.js` | int16 little-endian (MKI$/CVI) |
| `src/codec/date.js` | Packed ddmmyy dates |

## Reports

`LPRINT` output is captured and rendered as an HTML table using column positions from a `|`-delimited ruler line. Any program that prints a ruler followed by data rows becomes a formatted table automatically. Triggers the browser's native print/PDF dialog.

## File layout

```
index.html              gate UI + terminal shell + graphics canvas
interpreter.html        keyword-by-keyword coverage map (done / partial / dummy / skip)
picker.html             standalone project manager (optional)
run.bat                 Windows launcher (dedicated browser profile)
run.sh                  macOS/Linux launcher
sample/
  INTERPRETER.BAS       command test menu (BASIC / GW-BASIC, one demo per keyword group)
  BASIC/ GWBASIC/       the nested menu + demo programs it CHAINs to
  APP.BAS  MATH.BAS     small CHAIN demo
src/
  app.js                boot loop + folder connect + gfx/audio wiring
  interp/basic.js       GW-BASIC interpreter (tokenizer, parser, runtime)
  term/
    screen.js           80×25 CGA terminal (16 colors, blink, cursor, transparent-cell overlay)
    input.js            keyboard input, INPUT line, INKEY$, ON KEY trap buffer
    beep.js             BEEP via WebAudio
    printusing.js       PRINT USING numeric masks
  gfx/
    canvas.js           SCREEN 1/2 graphics — indexed CGA framebuffer, PSET/LINE/CIRCLE/PAINT/DRAW/PALETTE
  audio/
    sound.js            SOUND tone + PLAY (MML) via Web Audio
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
