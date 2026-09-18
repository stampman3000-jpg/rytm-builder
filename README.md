# rytm-builder

Compose a **new** Analog Rytm whole-project `.syx` from a library of dumps. This is a builder, not an editor: source files stay read-only, and every run writes a fresh file.

Samples must already live on the Rytm +Drive. The builder only copies 16-byte fingerprints so restored kits bind to those files. There is no USB/MIDI send.

Firmware target: **AR 1.70 / v5** object sizes (same as Johnny’s MK1 dumps).

## Build

Needs Rust 1.83 (or similar; not edition 2024). From this directory:

```bash
cargo build
```

The binary is `target/debug/rytm-builder`.

Keep personal `.syx` dumps out of git (they are gitignored). Point the CLI at a local dumps folder.

## Browse UI (Play 3)

```bash
cargo build
cd web && npm install && npm run dev
```

Local app at http://127.0.0.1:43147 — catalog dumps, pick patterns, shuffle the Fresh Project queue, export a new `.syx` through this same CLI. Dest slots follow queue order. Restore model unchanged: disposable RAM project, delete if bad.

## Catalog a dump

```bash
cargo run -- catalog /path/to/Untitled.syx
```

Prints nonempty patterns (A01–H16), linked kit name/index, trig counts, and kits that have names or sample slots.

## Compose a fresh project

Use an **empty whole-project dump** as `--template` (a newly created Rytm project, saved and dumped — not a file this tool “clears”). Copy one or more `PATH:PATTERN` pairs. Destination slots fill from the first empty pattern and first free kit.

```bash
cargo run -- compose \
  --template /path/to/Untitled-4.syx \
  --out /path/to/Fresh.syx \
  --copy /path/to/Untitled-1.syx:A03 \
  --copy /path/to/Untitled.syx:A01 \
  --report /path/to/Fresh.txt
```

Rules the tool will not bend:

- Never overwrites `--out` or `--report` if the path already exists.
- Remaps pattern `kit_number`, kit `sample_nr`, and SMP_NR parameter locks.
- Reuses a destination sample slot when the 16-byte fingerprint already exists; otherwise allocates the next empty slot (1–127).
- Writes **settings, then globals, then kits/sounds/patterns/songs**. Kits-first is how samples show as OFF on the box.
- After writing, checks that template and source dumps are still byte-identical.

## Restore on the Rytm

1. Samples for those fingerprints must already be on +Drive.
2. Open an empty or disposable project in RAM (do not send onto a project you care about).
3. Receive the new `.syx` as a **whole project**.
4. Check pattern slots, kit names, analog sound, and that samples are bound (not SMPL OFF).
5. Save the project on the device if it sounds right.

## What this version does not do

No live USB, no firmware SysEx, no Transfer `.arpj`, no sample upload, no song editing, no in-place project surgery, no sample names.

## Proven fixture (Play 1)

From empty template `Untitled-4.syx`:

| Source | Pattern | Kit | Lands in dest |
|--------|---------|-----|----------------|
| Untitled-1 | A03 | 2 `BLKWAX` | A01 kit 0 |
| Untitled | A01 | 0 `MD1` | A02 kit 1 |

Output example: `Fresh__from_Untitled4_BLKWAX_MD1.syx` (settings-first, 405 messages, 17 allocated sample slots). Restore that file on the box before composing bigger packs.
