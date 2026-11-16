# Leg: clipboard-and-file-modes

**Status**: completed
**Flight**: [Vault and Automation Boundary](../flight.md)

## Objective

A copied secret leaves the clipboard on schedule and at quit wherever the app can make that happen, and the files that hold vault and profile data are created readable by their owner only.

## Context

- Flight DD7 (the clipboard and file halves). Mission findings 13 (clipboard) and 21. Split from `vault-lifecycle` at its design review; the two halves here share no file with each other, but both are small and mechanical.
- **Clipboard — what exists** (design review, 2026-11-14). Main-side sinks, all in two files:
  - `clipboard:write` (`register-settings-ipc.js`) — internal pages. With `{ secret: true }` it arms a 20-second clear that fires only if `clipboard.readText()` still equals what was written, then writes `''`. The timer is a closure variable, `unref`'d, unreachable at quit. A later write of any kind replaces the pending clear.
  - `menu-overlay:copy-text` (`register-overlay-ipc.js` → `writeClipboard` in `main.js`, a plain `clipboard.writeText`). **Its row in `SHEET_MENU_TYPES` admits exactly three menu types: `vault-recovery-show`, `vault-accesskey-show`, `vault-adminkey-show`** — the gate refuses it from any other card. So every sheet copy is a key, and none is ever cleared.
  - `chrome-clipboard-write` — the chrome's own copies (link and selection text from the page context menu); never a secret.
  - Renderer-side, `navigator.clipboard` appears once: `automation.js` `copyText`, which falls back to `clipboard:write` with no secret flag. Its call sites: the address, the MCP config JSON (carries no key), and **one** show-once key copy (the key widget's Copy button, which serves both jar and admin keys).
- **What is not known and must be measured before the quit flush is trusted**: (1) whether `clipboard.readText()` works on Wayland / WSLg when the app is not focused or is quitting — if it returns empty, the still-holds check fails and the secret stays; (2) whether clipboard content owned by the process simply disappears when it exits on this host, or is kept by WSLg's Windows bridge or a clipboard manager — if it disappears by itself, "the clipboard is empty after quit" proves nothing about the flush.
- **Limits that no code here changes, to be stated in the docs**: a clipboard manager, Windows clipboard history and cloud clipboard may keep a copy; `before-quit` is not delivered on `app.exit()`, `process.exit` or a signal.
- **Files — what exists.** `src/main/vault/atomic-write.js` opens its temp file with `'wx'` and no mode, then renames (rename keeps the temp file's mode); **`vault-txn.js` writes its journal and staged files through `writeFileAtomic`**, so one change covers vault files, the manager, the journal and staging. `vault-store.js` creates the vaults directory with `mkdirSync(…, { recursive: true })`. The bundle export (`main.js`) uses `fs.writeFileSync`, on an exclusive path and an overwrite path. `app-db.js` and `history-store.js` open `node:sqlite` databases (WAL on); SQLite creates the `-wal` / `-shm` sidecars with the main file's mode. Quarantine and `.migrated` renames keep the mode. `crash-log.js` appends through an injected `fs`. Electron creates the profile directory 0700 on Linux — today's only protection.
- Out of scope: Chromium's own files in the profile (cookies, cache, crash dumps directory).
- Budgets: do not touch `src/renderer/renderer.js`. `main.js` gets wiring only.

## Inputs

- Legs 01–07 landed (uncommitted). `app-lifecycle.js`'s `before-quit` was edited by leg `vault-lifecycle` (a quit lock, before the MCP stop).
- Files named above; `test/unit/vault-atomic-write.test.js`, `app-db.test.js`, `history-store.test.js`, `crash-log.test.js`, `register-settings-ipc.test.js`; find the test that covers `menu-overlay:copy-text` by grepping for `copy-text`.

## Acceptance Criteria

**Measurement first (the tree as of leg `vault-lifecycle`; scratch profile; a standalone Electron script is fine and preferable — do not drive the app's vault)**

- [ ] **AC1 — What the platform does.** With a tiny standalone Electron main script (run with the repo's binary and the dev launch's platform flags, as the dialog probe did): (a) `clipboard.writeText(marker)`, then `clipboard.readText()` at once, after the window loses focus, and inside `before-quit` — does each read return the marker; (b) write a marker and exit **without** clearing — is the marker still readable afterwards from another process (a second Electron run, and `powershell.exe Get-Clipboard` if the Windows side is reachable from WSL); (c) the same with `clipboard.clear()` in `before-quit`. A table; state what could not be observed.

**Clipboard**

- [ ] **AC2 — One helper.** A new Electron-free module (injected `clipboard`, timer functions) exports `write(text, { secret })` and `flush()`. A secret write arms one 20-second clear; a later write of any kind replaces the pending clear (a later secret arms its own; a later plain write cancels it — the clipboard no longer holds the secret). The clear and `flush()` share one routine: clear with `clipboard.clear()` if the clipboard still holds exactly that text. **If the read throws or — per AC1 — cannot be trusted in that state, the routine skips** rather than clearing blind: wiping an unrelated copy is worse than leaving a secret the operator copied on purpose. If AC1 shows the read is unreliable at quit on this platform, say so in the flight log and the docs; do not change the rule without the Flight Director. `flush()` is idempotent. Unit-tested with fake timers enabled per test.
- [ ] **AC3 — All three sinks use it.** `clipboard:write` keeps its `opts.secret` contract. The sheet's `menu-overlay:copy-text` is **always** a secret write; a unit pin asserts its `SHEET_MENU_TYPES` row is exactly the three key-display types, so a future card added to that row must revisit this. `chrome-clipboard-write` is a plain write. A source-scan test fails on any `clipboard.writeText(`, `clipboard.write(` or `clipboard.clear(` in `src/main/**` outside the helper and its construction (neuter-verified).
- [ ] **AC4 — Cleared at quit.** `before-quit` calls `flush()` **first**, in its own `try`, logged on failure — ahead of the snapshot steps, so nothing earlier can skip it. Unit pin on presence, guard and position.
- [ ] **AC5 — The automation page's show-once key.** `copyText` takes a `secret` flag; the one show-once key copy passes it and goes **straight to the bridge** with `{ secret: true }` instead of trying `navigator.clipboard` first — main must own a clear it is responsible for. The other two call sites keep today's order. A unit pin asserts exactly one secret call site; a page test against the mock DOM (the function is file-scope in a page controller: pass the flag, use the injected bridge).

**Files**

- [ ] **AC6 — Created owner-only.** `writeFileAtomic` opens its temp file with mode `0o600` (covering vault files, the manager, the transaction journal and staging); the vaults directory is created `0o700`; the bundle export is written `0o600` on creation; `app.db` and `history.db` are **pre-created** `0o600` (open-append-close) before `DatabaseSync` opens them, so the sidecars inherit the mode; the crash log is appended with mode `0o600`. Journal mode and pragmas are untouched. Unit tests on a temp directory assert the resulting modes, skipped on `win32` with the reason in the test title. `crash-log.test.js` uses a fake `fs` and may assert call arguments — update, do not weaken.
- [ ] **AC7 — Existing files are tightened once, at open.** An existing vaults directory → `0o700`; existing vault files, the manager, journal and staging files → `0o600`; existing `app.db`, `history.db` and their `-wal` / `-shm`, `.corrupt-*` and `.migrated` siblings → `0o600`; the crash log → `0o600`. Idempotent; runs before any write; never on a timer. A bundle the operator **overwrites** at a path they chose keeps that file's existing mode (`writeFileSync`'s mode applies only on creation): either `chmod` after the write or state the limit — choose, and say which.
- [ ] **AC8 — Never fatal.** Every `chmod` and mode-carrying create is in a `try`; a failure is logged once and the app carries on (read-only profile, FAT or network filesystem, Windows). No code path depends on the resulting mode.

**Docs, live, gates**

- [ ] **AC9 — Docs.** `docs/vault.md`: clipboard clearing for item copies, key-display cards and the automation page's show-once key — after 20 seconds and at quit — with its limits exactly as measured in AC1 (only if the clipboard still holds that text; what happens when the read is unavailable; clipboard managers, Windows clipboard history and cloud clipboard are outside the app's reach; no flush on a crash or a kill); file modes and what is out of scope (Chromium's own profile files). `CLAUDE.md`: the vault paragraph, the quit order (flush first, then the existing steps, the quit lock before the MCP stop). The disposition for finding 21 is recorded in the flight log for the flight-end table.
- [ ] **AC10 — Live** (scratch profile; no vault; no admin-driven mint — nothing can press the automation page's buttons without an admin session, and an admin session makes minting raise a native dialog, so the in-app secret copy is **not run** here and goes to the HAT with AC1's negative control written into the HAT step): a fresh scratch profile's `app.db`, `history.db`, their sidecars and the crash log are `0600` and the profile boots, browses, records history and quits; a profile created **before** this leg (make one with the snapshot of the tree, or by loosening modes by hand in a scratch profile) is tightened at the next launch; `before-quit` runs the flush without error on a real quit (a trace line or the absence of the logged failure); every apparatus primitive still works.
- [ ] **AC11 — Gates.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` pass. The store suites are also run under Electron's own Node (`ELECTRON_RUN_AS_NODE=1 npx electron --test` over the files matched by `grep -rlE "node:sqlite|app-db|history-store" test/unit`), because this leg changes how the databases are created.

## Verification Steps

- AC1: the probe's table in the flight log.
- AC2–AC5: new `secret-clipboard.test.js`; registrar tests for the three sinks; the menu-type row pin; the source-scan pin; the automation page test.
- AC6–AC8: mode tests for `atomic-write`, `vault-store` (directory), the export writer, `app-db`, `history-store`, `crash-log`; a test that a `chmod` failure does not throw.
- AC9: read by the Flight Director. AC10: script output in the flight log.

## Implementation Guidance

1. AC1 before any edit. Scratch directory for the probe; self-terminating script; `timeout` around it.
2. Clipboard: helper and tests → the three sinks → `before-quit` → the automation page.
3. Files: `atomic-write` → vaults directory → export → databases (pre-create, then the one-time tighten) → crash log.
4. Live smoke; docs.
5. Do not commit. Leg `landed`, flight log entry, `[LAND:leg]`.

## Edge Cases

- **Copy a secret, copy something else, quit**: nothing is cleared.
- **A secret copy in one window and a plain copy in another**: one helper, one pending clear; the plain write cancels it. As today.
- **Two secret copies 10 seconds apart**: the second's timer replaces the first's; one clear, 20 seconds after the second.
- **`flush()` with nothing pending**: no clipboard access at all.
- **A database file that exists but is zero-length because pre-create ran and the open then failed**: the existing open-failure and quarantine paths must treat it as they treat a missing or corrupt file today — test it.
- **A profile on a filesystem without modes**: logged once, not per file.
- **Restore / adopt / import paths that write vault files**: they go through `writeFileAtomic`; confirm by grep that no vault or manager write bypasses it, and list any that does.
- **Anything needing a design call**: `[BLOCKED:<reason>]`.

## Files Affected

- New: `src/main/secret-clipboard.js`.
- `src/main/main.js` (construct, wire; the export writer), `src/main/app-lifecycle.js` (`before-quit`), `src/main/register-settings-ipc.js`, `src/main/register-overlay-ipc.js`, `src/renderer/pages/automation.js`; `src/main/vault/atomic-write.js`, `src/main/vault/vault-store.js`, `src/main/app-db.js`, `src/main/history-store.js`, `src/main/crash-log.js`.
- Tests as listed; `docs/vault.md`, `CLAUDE.md`.

## Citation Audit

From the design review of `vault-lifecycle` (Sonnet, 2026-11-14), which read these for this purpose: the four main-side clipboard sites (`register-settings-ipc.js` write, clear and the chrome write; `main.js` `writeClipboard`); `ipc-channel-table.js` — the `menu-overlay:copy-text` row with its three menu types; `automation.js` `copyText` and its three call sites; `atomic-write.js` `openSync(tmp, 'wx')`; `vault-txn.js` writing through `writeFileAtomic`; `vault-store.js` vaults-directory `mkdirSync`; `main.js` bundle `writeFileSync`; `app-db.js` / `history-store.js` `DatabaseSync` opens with WAL; quarantine renames; `crash-log.js` append through injected `fs`. Tier: **high** for the file half (it changes how the databases are created) — the reviewed content of `vault-lifecycle`'s second half, with that review's corrections applied; no separate pass was run for this file.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
