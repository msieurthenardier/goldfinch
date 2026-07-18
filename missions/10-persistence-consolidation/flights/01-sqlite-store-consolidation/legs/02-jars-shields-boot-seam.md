# Leg: jars-shields-boot-seam

**Status**: completed
**Flight**: [SQLite Store Consolidation](../flight.md)

## Objective

Convert the two structurally-harder stores — `jars.js` (codec seam built new;
unknown-version carve-out honored) and `shields.js` (DD8 discipline rework) —
onto the app-db document seam, and reshape the boot seam:
`initProfileAndStores` gains the app-db open (after the dev-profile
redirect, fixing leg 1's flagged dev-mode ordering nuance), with the pin
tests updated deliberately (DD9).

## Context

- Flight DDs govern: DD3/DD4 (document seam), DD5 **including the
  unknown-version carve-out**, DD6 addendum (branch-dependent jars reseed is
  deliberate), DD7 (session-store stays a sibling; will-quit close already
  wired in leg 1), DD8 (shields discipline), DD9 (pin moves deliberately),
  DD10 (shields write-errors propagate).
- Leg 1 landed: `src/main/app-db.js` exists (`createDocumentStore(name)` →
  `{ read, write, remove }`); settings/downloads/session are on rows; store
  suites establish the require-app-db-once + `appDb.open(tmpDir)`-per-test
  pattern and the load-throws-before-open pin. Suite at 2008 pass / 0 fail.
- **Leg 1 Decisions note (flight log)**: the interim `main.js`
  `appDb.open(...)` sits BEFORE `initProfileAndStores`, i.e. before the
  dev-profile `setPath('userData')` redirect that is `initProfileAndStores`'
  first step (`init-profile.js:33 — "app.setPath('userData',
  devUserDataPath(...))"`). Dev launches currently open `app.db` in the
  pre-redirect dir. **This leg's reshape moves the open INSIDE
  `initProfileAndStores`, after the redirect** — the permanent fix.
- `jars.js` seams: `load(userDataPath)` (`jars.js:175`), `save()`
  (`jars.js:249` — mkdir + tmp+rename, error-swallowing), three-shape load:
  v2 envelope / v1 bare array / no-file seed with legacy partition probe
  (`jars.js:231 — "containers = (legacy ? LEGACY_DEFAULTS : FRESH_SEED)"`).
  **Unknown-version envelope branch (~:216-223): kept in memory, file NEVER
  rewritten** — pinned byte-identical by
  `test/unit/jars-security-forward-version.test.js`. No codec seam exists
  today — this leg builds it (flight technical approach names this as real
  work).
- `shields.js` seams: `require('electron')` (`shields.js:7`), self-resolved
  path inside `load()` (`shields.js:33 — "configPath =
  path.join(app.getPath('userData'), 'shields.json')"`), non-atomic
  swallow-errors `save()` (`shields.js:44`), exports (`shields.js:156`).
  Its unit test requires `test/helpers/electron-stub` — that dependency
  dies with the rework.
- Boot seam: `init-profile.js:26 — "function initProfileAndStores(app, {
  shields, settings, jars, downloads })"`; `shields.load()` call (no arg,
  `init-profile.js:35`); order pinned by
  `test/unit/init-profile-order.test.js`.

## Inputs

- Leg 1 landed (uncommitted, on the flight branch): app-db + three stores
  converted; suite 2008 pass / 0 fail.

## Outputs

- `jars.js` and `shields.js` persist via `documents` rows (`'jars'`,
  `'shields'`); one-time migration from `containers.json` / `shields.json`
  with `.migrated` renames (jars' unknown-version branch excepted).
- `shields.js`: Electron-free, `load(userDataPath, opts?)` signature, codec
  seam, write errors propagate.
- `init-profile.js`: `initProfileAndStores(app, { appDb, shields, settings,
  jars, downloads })` — redirect → `appDb.open(userData)` → shields →
  settings → jars → downloads; `main.js` interim sibling open removed and
  appDb passed in.
- Updated pins: `init-profile-order.test.js` (new signature/order),
  `jars.test.js`, `shields.test.js` (stub dropped), forward-version test
  still green on the carve-out.

## Acceptance Criteria

- [x] `jars.js`: row-backed persistence with a `{ serialize, deserialize }`
      codec seam (defaulting to JSON, injectable via a new optional `opts`
      arg on `load(userDataPath, opts?)` — backward-compatible); known-shape
      migration (v2 envelope AND v1 bare array both migrate through
      existing validation, then rename `.migrated`); seed branches
      (FRESH_SEED / LEGACY_DEFAULTS partition probe) unchanged in logic,
      persisting to the row.
- [x] **Unknown-version carve-out holds**: unknown-version
      `containers.json` → in-memory envelope use, NO row write, NO rename;
      `jars-security-forward-version.test.js` passes with its byte-identity
      assertion intact; a new test pins "unknown-version file + no row →
      no row is created".
- [x] `shields.js`: no `require('electron')`; `load(userDataPath, opts?)`
      injected path + codec seam; row-backed `save()` — not-loaded state
      stays a silent no-op (today's semantics, pinned by ~9 existing
      pre-load test sites), loaded-state write errors propagate (DD10
      refined); public read/mutate API otherwise unchanged; migration from
      `shields.json` + `.migrated` rename; its test drops `electron-stub`.
- [x] `init-profile.js` reshaped: appDb in the stores param, opened
      immediately after the dev-profile redirect and before all store
      loads; `main.js` interim sibling open removed (close at `will-quit`
      stays); the leg-1 dev-mode ordering nuance is thereby resolved —
      `app.db` lands in the post-redirect (dev-suffixed) profile dir on dev
      launches.
- [x] `init-profile-order.test.js` re-pinned to the new signature and
      order as a named, deliberate change (DD9).
- [x] Both stores keep load-never-throws EXCEPT app-db-not-open (leg 1
      pattern: doc-store resolution/read outside the catch-all; per-store
      throws-before-open test).
- [x] `npm test` green (no regressions; new migration/carve-out tests),
      `npm run typecheck` green, `npm run lint` green.

## Verification Steps

- `node --test test/unit/jars.test.js test/unit/jars-security-forward-version.test.js
  test/unit/shields.test.js test/unit/init-profile-order.test.js` — green.
- `npm test` / `npm run typecheck` / `npm run lint` — green.
- Grep: no `require('electron')` in `shields.js`; no `writeFileSync` save
  path in either store (file I/O = migration read + rename only);
  `main.js` has ZERO `appDb.open` references (the open moved entirely into
  `init-profile.js`; only `appDb.close()` at `will-quit` remains).

## Implementation Guidance

1. **`jars.js`** — add module-scoped `docStore` + codec (clone the
   settings-store seam shape; default `JSON.stringify(…, null, 2)` /
   `JSON.parse` to preserve current file formatting semantics in
   serialized payloads). Rework `load(userDataPath, opts?)`:
   resolve+read row outside the catch-all; row present → parse via codec +
   existing `validateContainers` path; row absent → read `containers.json`:
   - v2 envelope (known version) / v1 bare array → existing validation
     logic → `save()` (row write) → rename `.migrated`.
   - **Unknown-version envelope → existing in-memory behavior, return
     WITHOUT row write or rename** (the pinned branch).
   - No file → existing seed logic (partition probe intact) → `save()`
     (row write; no rename — nothing to rename).
   `save()` (`jars.js:249`) → `docStore.write(codec.serialize(envelope))`;
   keep its current error-swallowing posture (jars' mutation API contract
   today; DD10 names shields only).
2. **`shields.js`** — DD8 rework: drop the electron require; module-scoped
   `docStore` + codec seam; `load(userDataPath, opts?)` (resolve+read row
   outside a new minimal catch-all that preserves "boot on corrupt
   state"); migration from `shields.json` (existing merge-over-DEFAULTS
   repair) + `.migrated` rename; `save()` → row write with **DD10 refined
   (design review): the not-loaded state stays a silent no-op, real write
   errors propagate.** Today `save()` guards `if (configPath)` — a
   pre-load `set()`/`setPaused()` mutates in-memory config and skips
   persistence, and ~9 existing `shields.test.js` sites (lines 65-191)
   call mutations before any `load()` and are NOT throw-wrapped. Preserve
   exactly that: `save()` starts `if (!docStore) return;` (the deliberate,
   documented not-loaded no-op), then `docStore.write(...)` UNGUARDED so a
   loaded-state write failure propagates (DD10's actual target — the old
   swallow-everything catch dies). Exports unchanged plus the new opts.
3. **`init-profile.js`** — widen signature to `{ appDb, shields, settings,
   jars, downloads }`; sequence: dev redirect → `appDb.open(app.getPath('userData'))`
   → `shields.load(app.getPath('userData'))` → settings → jars → downloads.
   Update the header invariant comment (redirect must precede the app-db
   open — that's the leg-1 nuance fix) and the per-store ordering comments.
4. **`main.js`** — remove the interim `appDb.open(...)` sibling line +
   its comment; pass `appDb` into `initProfileAndStores`; `will-quit`
   close unchanged.
5. **Tests** — follow leg 1's established patterns (require app-db once
   per file; `appDb.open(tmpDir)` per test; throws-before-open pin per
   store; migration cases: values-intact + rename, corrupt-JSON repaired
   migrate, row-wins, fresh-dir). `shields.test.js` drops the
   electron-stub require and injects temp dirs. `jars` adds the
   carve-out no-row test. `init-profile-order.test.js` re-pins order
   including `appDb.open` after redirect (assert via call-recording fakes
   as it does today).

## Edge Cases

- **Unknown-version jars file present on EVERY boot** — the probe re-runs
  each boot by design (no row is ever written from that branch); if a row
  ALSO exists (written earlier by a compatible build), **the row wins** and
  the file is left untouched.
- **`shields.json` corrupt** — merge-repair to DEFAULTS (existing
  behavior), migrate the repaired result, rename the corrupt original.
- **Dev vs packaged paths** — after the reshape, ALL of app.db and store
  rows follow the post-redirect userData; no store resolves a path before
  the redirect.
- **jars `save()` during `load()`** (seed/migrate branches) — synchronous
  row write, verified safe by leg 1's synchrony test; keep the call order
  identical to today's.
- **jars mutations before `load()` must stay fail-soft (design review)**:
  `container-menu.test.js:100,116` calls `jars.add()` with NO prior
  `load()`, premised on "add() before load() deliberately never persists".
  Keep `save()`'s ENTIRE body (including the `docStore.write`) inside its
  existing swallow so the unset-docStore TypeError is absorbed exactly as
  the unset-storePath no-op is today — do not hoist the docStore call out
  of the try.
- **Test blast radius beyond the four named suites (design review)**:
  `test/unit/jar-ipc.test.js` (59 tests) calls `jars.load(dir)` in
  `makeHarness()` (:105) with no app-db awareness — it gains the leg-1
  pattern (require app-db once per file; `appDb.open(dir)` per harness).
  `jars-security-forward-version.test.js` DEFINITELY needs `appDb.open`
  in setup (every `load()` now touches the row read first) — its
  byte-identity assertion stays untouched.

## Files Affected

- `src/main/jars.js`, `src/main/shields.js` — conversions
- `src/main/init-profile.js` — signature + sequence reshape
- `src/main/main.js` — interim wiring removal, appDb pass-through
- `test/unit/jars.test.js`, `test/unit/shields.test.js`,
  `test/unit/init-profile-order.test.js` — updates + new cases
- `test/unit/jar-ipc.test.js` — `makeHarness()` gains app-db open (59
  tests ride it; design review)
- `test/unit/jars-security-forward-version.test.js` — setup gains the
  app-db open (definite, not conditional); byte-identity assertion
  untouched
- `test/unit/container-menu.test.js` — must stay green UNMODIFIED (pins
  the pre-load fail-soft; see Edge Cases)

---

## Post-Completion Checklist

**Complete ALL steps before signaling handoff:**

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header)
- [x] Do NOT commit (flight-end review/commit model)

## Citation Audit

Citations verified against current code at leg design time (2026-07-17):
`jars.js:175/249/231` + FRESH_SEED/LEGACY_DEFAULTS/cleanRetention symbols,
`shields.js:7/31/33/44/156`, `init-profile.js:26/33/35` — all `OK` via
symbol/snippet grep on the live working tree (post-leg-1).
