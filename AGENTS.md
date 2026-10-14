# Agents

Notes for coding agents and for anyone picking this repo up cold. Product behavior, restore steps, and the owner's wording live in [README.md](README.md). Add to that file; do not rewrite it.

## What this is

rytm-builder composes Elektron Analog Rytm whole-project and differential `.syx` files from a library of dumps. It is a builder, not an editor. Firmware target is Analog Rytm **1.70 / v5** object sizes. Samples must already be on the Rytm +Drive; the tool copies 16-byte fingerprints so restored kits bind to those files.

Three surfaces, one Rust engine:

- **CLI** — `rytm-builder` (`src/main.rs`). Commands are `catalog` and `compose`.
- **Web UI** — Vite + React in `web/`. This is the desktop window's webview, not a Next.js app (`web/.next` in `.gitignore` is leftover).
- **Mac app** — Tauri 2 shell in `src-tauri/`. Compose runs in-process. Unsigned universal build (Intel + Apple Silicon).

## Repo layout

- `Cargo.toml`, `Cargo.lock` — workspace root. Members are this package and `src-tauri`. Edition 2021.
- `src/` — library `rytm_builder` plus the CLI. `compose.rs`, `project.rs`, `layout.rs`, and `catalog.rs` are the engine. `app.rs` is the desktop library, export paths, and UI compose helper.
- `web/` — Vite UI. Scripts are in `web/package.json`. `web/templates/Untitled-4.syx` is the baked empty whole-project template. Other `*.syx` files are gitignored.
- `src-tauri/` — Tauri app. `tauri.conf.json` serves `web/` and bundles that template.
- `target/` — Cargo output (gitignored).

Personal dumps stay out of git. The Mac app keeps its library under `~/Library/Application Support/rytm-builder/library`.

## Build and test

Nothing here is guessed from outside the repo. There is no CI config checked in.

**CLI.** Rust 1.83 or similar, edition 2021, not edition 2024 (`home` is pinned in `Cargo.toml`). From the repo root:

```bash
cargo build
cargo test
```

The binary is `target/debug/rytm-builder`. `cargo test` runs the `#[cfg(test)]` modules in `src/`. One UI compose test returns early when `Untitled-1.syx` is not in the app library; the others do not need personal dumps. The baked-template test expects `web/templates/Untitled-4.syx`.

**Web.** Node, from `web/package.json`. There is no `npm test` script.

```bash
cd web && npm install
npm --prefix web run dev      # UI only, http://127.0.0.1:1420 — catalog and download need Tauri
npm --prefix web run build    # writes web/dist
```

**Mac app.** macOS only. `desktop:build` passes `--target universal-apple-darwin`.

```bash
cd web && npm install && cd ..
npm --prefix web run desktop          # tauri dev
npm --prefix web run desktop:build    # .app and .dmg
```

Outputs:

- `target/universal-apple-darwin/release/bundle/macos/rytm-builder.app`
- `target/universal-apple-darwin/release/bundle/dmg/`

## Do not

These are the safety rules already stated in the README. Do not weaken them in code or in docs.

- Source dumps stay read-only. The working destination changes only in memory. After a write, template and source dumps must still be byte-identical.
- Every run writes a new file. Never overwrite `--out` or `--report` if that path already exists.
- The tool never talks USB or MIDI to the Rytm. No live send, no firmware SysEx, no sample upload.
- No in-place project surgery. Compose a fresh whole-project or differential `.syx`. The user receives that file in a sysex editor.

## Repo housekeeping

The default branch `cursor/rytm-mac-app-0afb` should probably become `main`. Some work-in-progress branches may live on a separate Cursor Origin copy. Do not act on either: do not rename or retarget the default branch, and do not merge, move, or delete those Origin branches.
