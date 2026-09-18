# rytm-builder web

Local browse UI for Analog Rytm whole-project `.syx` dumps. It catalogs patterns and kits, then calls the `rytm-builder` CLI to export a **new** settings-first project. Destination is an A–H × 1–16 grid; empty cells stay empty. Pattern+kit copy only. It does not edit dumps in place and does not talk to the device.

## Run

From the repo root:

```bash
cargo build
cd web
npm install
npm run dev
```

Opens on [http://127.0.0.1:43147](http://127.0.0.1:43147).

Drop `.syx` dumps onto SOURCE. They are copied into an app-owned library (`~/Library/Application Support/rytm-builder/library`), not the Cursor store. Dest base defaults to the baked empty `Untitled-4` template (all dest cells empty). Drop/choose another project as dest base and the A–H grid lights nonempty pattern cells from that dump; reset to baked clears occupancy. Drag dest cells to rearrange (vacate or swap). Grey still matches dest base; red is the differential.

```bash
export RYTM_BUILDER=/path/to/rytm-builder
export RYTM_ROOT=/path/to/this/repo
```
