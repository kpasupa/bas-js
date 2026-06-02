# bas-js

A tiny **GW-BASIC runtime in the browser** — it runs legacy line-numbered `.BAS` programs in an
80×25 text terminal, reading and writing their original binary random-access data files in place.

Built to revive the the old gw-basic application, but the runtime is generic:
point it at any folder of `.BAS` + data and it runs them.

## Run it
1. **Windows:** double-click `run.bat`  ·  **macOS/Linux:** `./run.sh`
   (Launches Chrome/Edge with `--allow-file-access-from-files` so ES-module imports work over
   `file://`, and a dedicated browser profile so the folder permission is remembered.)
2. Click **Connect data folder** and choose the folder that holds binary data files `...`, `.DAT` and the
   `.BAS` files. Granted once, it reconnects automatically next time.
3. The terminal boots the system (`PASSWORD.BAS`) - First menu of the project.

> The app reads `.BAS` **and** data from the one folder you pick, and writes records back in place
> through that handle. Writing local files needs the File System Access API, which requires picking
> the folder once — there is no browser flag that grants folder writes without it.

## Layout
```
<data folder>/            ← you pick this once
  CUSTOMER  CHQ.DAT  CHQ1.DAT  *.BAS
  bas-js/                 ← this app (can live anywhere, incl. beside the data)
    index.html            screen-only shell + connect gate
    run.bat  run.sh       launchers (Windows / macOS-Linux)
    src/
      app.js              boot + folder connect + CHAIN loop
      interp/basic.js     the GW-BASIC interpreter
      term/               80×25 screen, keyboard input, beep, PRINT USING
      data/               File System Access store, record schema, addressing
      codec/              MBF (MKS$/MKD$/CVS/CVD), KU42 Thai, int16, packed dates
      print/report.js     LPRINT → HTML table / monospace → browser print preview
```

## What it implements
- **Interpreter:** line flow, GOTO/GOSUB/RETURN/ON..GOTO/ON..GOSUB, IF/THEN/ELSE, FOR/NEXT,
  multi-statement `:` lines, multi-physical-line statements, CHAIN/COMMON, random files
  (OPEN/FIELD/GET/PUT/CLOSE/LSET, KILL, NAME..AS), INPUT/INPUT$/INKEY$, PRINT/LPRINT/PRINT USING.
  Synchronous fast path keeps 28k-record scans responsive.
- **Codecs** verified byte-exact against real data: MBF dates 100%, amounts 99.99% (exact-decimal),
  KU42 Thai, int16. In-place per-record writes preserve unchanged-field bytes.
- **Reports:** `LPRINT` is captured and rendered as an HTML table (or faithful monospace) for the
  browser's native print/PDF.

Requires a Chromium-family browser (Chrome/Edge) for the File System Access API.
