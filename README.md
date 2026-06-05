# bas-js

A **GW-BASIC runtime in the browser** — runs legacy line-numbered `.BAS` programs in an 80×25 text terminal, reading and writing their original binary random-access data files in-place.

Built to revive old DOS GW-BASIC applications. The runtime is generic — point it at any folder of `.BAS` + data files and it runs them.

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

- **Flow:** line numbers, GOTO / GOSUB / RETURN / ON..GOTO / ON..GOSUB / IF-THEN-ELSE
- **Loops:** FOR / NEXT (with STEP)
- **Statements:** CLS, COLOR, LOCATE, PRINT, LPRINT, INPUT, INPUT$, INKEY$, BEEP, END, SYSTEM, CHAIN, COMMON
- **Files:** OPEN / FIELD / GET / PUT / CLOSE / LSET / KILL / NAME..AS (random-access binary files)
- **Operators:** `+ - * / MOD`, `= <> < > <= >=`, `AND OR NOT`, string concat
- **Math built-ins:** INT, ABS, SQR, SIN, COS, TAN, ATN, LOG, EXP, RND, SGN, FIX
- **String / misc built-ins:** LEN, VAL, STR$, CHR$, RIGHT$, LEFT$, MID$, STRING$, SPACE$, TAB, SPC, PRINT USING, CVI/MKI$/CVS/CVD/MKS$/MKD$

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
index.html              gate UI + terminal shell
picker.html             standalone project manager (optional)
run.bat                 Windows launcher (dedicated browser profile)
run.sh                  macOS/Linux launcher
sample/
  APP.BAS               feature-demo menu (display, input, loops, PRINT USING, BEEP, LPRINT, CHAIN)
  MATH.BAS              number demo; receives a value via CHAIN from APP, or asks for input standalone
src/
  app.js                boot loop + folder connect
  interp/basic.js       GW-BASIC interpreter
  term/
    screen.js           80×25 CGA terminal (16 colors, blink, cursor)
    input.js            keyboard input, INPUT line, INKEY$
    beep.js             BEEP via WebAudio
    printusing.js       PRINT USING numeric masks
  data/
    store.js            File System Access API + IndexedDB handle persistence
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
