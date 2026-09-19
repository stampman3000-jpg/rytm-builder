# rytm-builder web

Local staging UI for Analog Rytm whole-project `.syx` dumps. It catalogs patterns and kits, lets you stage changes against a destination base, then calls the `rytm-builder` CLI to export a **new** settings-first project or differential. Pattern dest is an A–H × 1–16 grid; empty cells stay empty. **PAT+KIT** is the default tab. **KIT** dest is a dual-column kit list (slots 00–127) and overwrites kit objects in place (no pattern write). **PAT** dest is the pattern grid and overwrites pattern objects in place (dest kit numbers stay). Source files are read-only, destination changes are in-memory until export, and the app never talks to the device.

## Run

From the repo root:

```bash
cargo build
cd web
npm install
npm run dev
```

Opens on [http://127.0.0.1:43147](http://127.0.0.1:43147).

Drop `.syx` dumps onto SOURCE. They are copied into an app-owned library (`~/Library/Application Support/rytm-builder/library`), not the Cursor store. Dest base defaults to the baked empty `Untitled-4` template (all dest cells empty). Drop/choose another project as dest base and the A–H grid lights nonempty pattern cells from that dump; reset to baked clears occupancy. Drag dest cells to rearrange (vacate or swap). Grey still matches dest base; red is the differential. **KIT** dest is kit slots 00–127 as a two-column list. **PAT** dest is the pattern grid (source is a grid too); drop overwrites the pattern object and keeps the dest kit number. **Download project** / **Download edits** save a `.syx` to your Downloads folder. The app never talks USB.

```bash
export RYTM_BUILDER=/path/to/rytm-builder
export RYTM_ROOT=/path/to/this/repo
```
