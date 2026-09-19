# rytm-builder web

Local staging UI for Analog Rytm whole-project `.syx` dumps. The desktop app is a Tauri window: this Vite UI in a webview, compose engine in-process in Rust. It never talks to the device.

## Desktop (Mac)

From the repo root:

```bash
cd web && npm install && cd ..
npm --prefix web run desktop          # tauri dev
npm --prefix web run desktop:build    # unsigned .app + .dmg
```

The built app lands in `target/release/bundle/macos/rytm-builder.app` and `target/release/bundle/dmg/`. Copy those to Desktop if you want a double-clickable copy. First open: right-click the app → Open (unsigned).

## UI only (no compose)

`npm run dev` serves the webview assets on http://127.0.0.1:1420. Catalog, library, and download need the Tauri app (`desktop` / the `.app`).
