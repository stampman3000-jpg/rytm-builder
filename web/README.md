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

Drop `.syx` dumps onto SOURCE. They are copied into an app-owned library (`~/Library/Application Support/rytm-builder/library`), not the Cursor store. Dest base defaults to the baked empty `Untitled-4` template; drop/choose another project to override.

```bash
export RYTM_BUILDER=/path/to/rytm-builder
export RYTM_ROOT=/path/to/this/repo
```
