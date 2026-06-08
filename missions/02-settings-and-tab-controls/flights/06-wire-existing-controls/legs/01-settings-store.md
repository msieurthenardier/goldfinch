# Leg: settings-store

**Status**: landed
**Flight**: [Wire Existing Controls (Shields + Home Page) into Settings](../flight.md)

## Objective
Build `src/main/settings-store.js` — a durable, secure, schema-versioned preferences store (the canonical
home for app settings going forward) with atomic persistence, per-key validation, safe-default repair, an
injected path, and a pluggable serialization seam — holding the home page in this flight.

## Context
- **DD1 / DD6.** The operator wants one durable, secure settings store built properly now (not pieced
  together). "Secure" here = access-controlled (reached only through the origin-checked bridge + trusted
  chrome — legs 2+), validated writes, atomic + versioned persistence. **Not** encrypted now; the
  serialization seam is pluggable so `safeStorage` can be layered in when a secrets manager lands (DD6).
- **Mirrors + improves `src/main/shields.js`** (`load`/`get`/`set`, `userData/<file>.json`) but: (a) the
  module is **Electron-free** — it does NOT `require('electron')` and does NOT call `app.getPath` at
  require-time; the `userData` path is **injected** at `load(userDataPath)` (called from main's `whenReady`,
  like `shields.load()`). This makes it unit-testable with a temp dir and no electron stub (the
  `download-path.js` / `internal-assets.js` purity standard). (b) **Atomic writes** (temp + `rename`), unlike
  `shields.js`'s direct `writeFileSync`.
- **Validation** reuses `isSafeTabUrl` from `src/shared/url-safety.js` (dual-export — requireable in Node).
- This leg is the **foundation**; legs 2–4 consume it via the secured bridge. Flight 7 adds pin keys to the
  same store without rearchitecting.

## Inputs
- `src/main/shields.js` (the load/get/set + userData pattern to mirror & improve) and
  `test/unit/shields.test.js` / `test/helpers/electron-stub` (test conventions; note this store needs NO
  stub).
- `src/shared/url-safety.js` (`isSafeTabUrl`) for home-page validation.
- `src/main/main.js` `whenReady` (where `shields.load()` is called, ~`main.js:636`).

## Outputs
- `src/main/settings-store.js` (new) — the store.
- `test/unit/settings-store.test.js` (new) — unit tests.
- `src/main/main.js` — `settings.load(app.getPath('userData'))` in `whenReady` (initialize the store; no
  reader yet — that's legs 2+).

## Acceptance Criteria
- [ ] `src/main/settings-store.js` exists, is **Electron-free** (no `require('electron')`, no `app.getPath`
  at module scope), and exports: `load(userDataPath, opts?)`, `get(key)`, `getAll()`, `set(key, value)`.
- [ ] **Schema + defaults**: a `version` field (e.g. `1`) + `homePage` defaulting to
  `'https://www.google.com'` (equals the current `renderer.js` `HOMEPAGE` constant — DD4 migration). A
  per-key **validator map**: `homePage` → `(v) => typeof v === 'string' && isSafeTabUrl(v) &&
  v.trim().toLowerCase() !== 'about:blank'` (**exclude `about:blank`** — `isSafeTabUrl` admits it, but it's
  not a meaningful home page; setting it would silently strand the user on a blank tab).
- [ ] **Atomic persistence**: writes go to a temp file then `fs.renameSync` to `settings.json` in the
  injected `userData` path — never a partial direct write.
- [ ] **Safe-default repair on load**: a missing file → defaults; a corrupt/unparseable file → defaults
  (never throws); a file with a **bad field** (e.g. `homePage: 'javascript:…'`) → that field repaired to its
  default while **valid fields are kept** (one bad field never wipes the rest). `version` mismatch is handled
  (merge onto current defaults; room for future migration).
- [ ] **`set(key, value)`**: **throws** on rejection (the codebase + the leg-2 bridge use `throw` /
  `invoke`-rejection propagation, not a `{ok:false}` return). Unknown key → `throw new TypeError('unknown
  settings key: "<key>"')`; invalid value → `throw new TypeError('invalid value for "<key>"')` — and the
  **prior value is kept** (validate before mutating). On success persists atomically and returns the updated
  config. **`save()` failures propagate** (re-throw) so the caller/bridge learns the set didn't persist
  (unlike `shields.js`'s silent swallow — this is the settings foundation). The leg-2 bridge wraps `set` in
  try/catch and surfaces the error to the settings page (so an invalid home page is reported, not dropped).
- [ ] **`set` before `load`** (no `dir`) → throws a clear error (not a `Cannot read properties of null`),
  guarded explicitly. (In practice `load` runs at `whenReady` before any IPC.)
- [ ] **Pluggable serialization seam (DD6)**: `load`/`save` use a `{ serialize, deserialize }` pair
  defaulting to `JSON.stringify`(pretty)/`JSON.parse`, injectable via `opts` — so a future encrypted backend
  replaces the pair without touching callers, the schema, or the atomic write path.
- [ ] `src/main/main.js` calls `settings.load(app.getPath('userData'))` in `whenReady` (next to
  `shields.load()`). No behavior change yet (nothing reads it until legs 2+).
- [ ] **Unit tests** `test/unit/settings-store.test.js` (node:test + node:assert/strict; a real temp dir via
  `fs.mkdtempSync(path.join(os.tmpdir(), …))` in setup, removed after — **no electron stub needed**, since the
  module is Electron-free. NB: `shields.test.js` uses the electron-stub's fixed path, NOT a temp dir — follow
  the `mkdtempSync` setup/teardown described in step 7 here, not `shields.test.js`): defaults on first load;
  set→persist→reload round-trip; atomic write produces valid JSON; corrupt-file repair → defaults (no throw);
  bad-field repair keeps valid fields; `set` validation (**throws** on `javascript:`/`goldfinch://`/
  `about:blank`, accepts `https://…`, prior value kept on reject); **unknown-key throws**; **`set` before
  `load` throws** a clear error; `getAll()` returns a copy (mutating it doesn't change store state);
  `version` present; custom-serializer round-trip.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` green (existing 182 + the new settings-store tests).

## Verification Steps
- `npm test` — new settings-store tests pass alongside the existing suite.
- `npm run lint && npm run typecheck` — green.
- Code read: confirm no `require('electron')` / no module-scope `app.getPath`; atomic temp+rename; repair
  paths; validator map; serializer seam.

## Implementation Guidance
1. **Module shape** (Electron-free): `const fs = require('fs'); const path = require('path'); const {
   isSafeTabUrl } = require('../shared/url-safety');`. Module-scoped `let dir = null; let config = {
   ...DEFAULTS }; let codec = { serialize, deserialize };`.
2. **DEFAULTS**: `{ version: 1, homePage: 'https://www.google.com' }`. **VALIDATORS**: `{ homePage: (v) =>
   typeof v === 'string' && isSafeTabUrl(v) }`.
3. **`load(userDataPath, opts = {})`**: set `dir`; `codec = { serialize: opts.serialize ?? defaultSerialize,
   deserialize: opts.deserialize ?? defaultDeserialize }`; read `path.join(dir,'settings.json')` if present;
   `deserialize`; **merge-with-repair**: start from `{...DEFAULTS}`, for each known key take the stored value
   only if its validator passes (else keep default); wrap the whole read in try/catch → defaults on any
   throw. Return `config`.
4. **`save()`**: `const file = path.join(dir,'settings.json'); const tmp = file + '.tmp';
   fs.writeFileSync(tmp, codec.serialize(config)); fs.renameSync(tmp, file);`. The tmp file lives **beside the
   target** in `dir` (NOT `os.tmpdir()` — `rename` is only atomic on the same filesystem). **Let save errors
   propagate** (do not swallow) so `set` reports a failed persist — only `load` swallows (the app must boot).
5. **`get(key)` / `getAll()`**: return `config[key]` / a shallow copy of `config`.
6. **`set(key, value)`**: if `dir` is null → `throw new Error('settings-store: set before load')`; if
   `!(key in DEFAULTS)` → `throw new TypeError('unknown settings key: "'+key+'"')`; if a validator exists and
   fails → `throw new TypeError('invalid value for "'+key+'"')` (validate **before** mutating, so the prior
   value is kept); else `config = { ...config, [key]: value }; save(); return config;` (a `save` throw
   propagates). The bridge (leg 2) try/catches and surfaces the error to the settings page.
7. **main wiring**: in `whenReady`, `const settings = require('./settings-store'); settings.load(app.getPath(
   'userData'));` next to `shields.load()`.

## Edge Cases
- **Corrupt JSON** must not throw out of `load` (the app must still boot) — defaults.
- **Bad single field** must not discard valid siblings — per-key repair, not all-or-nothing.
- **`set` with an unknown key** is a programmer error / potential abuse vector — reject, don't silently add
  (keeps the schema closed and the store predictable for the origin-checked bridge).
- **Temp-file leftover** from a crash mid-write: the next `save` overwrites the tmp; `rename` is atomic on
  the same filesystem (userData) — fine.
- **`dir` null** (set called before load): guard — no-op/throw clearly; in practice `load` runs at
  `whenReady` before any IPC.
- Do NOT call `app.getPath` inside the module — it would couple to Electron + break the unit tests and the
  after-ready timing.

## Files Affected
- `src/main/settings-store.js` (new) — the store.
- `test/unit/settings-store.test.js` (new) — unit tests.
- `src/main/main.js` — `settings.load(app.getPath('userData'))` in `whenReady`.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to the flight-level review)*

- [ ] All acceptance criteria verified (offline)
- [ ] Tests passing (unit + offline gates)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; do NOT signal `[HANDOFF:review-needed]`
