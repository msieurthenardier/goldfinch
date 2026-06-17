# Leg: dev-profile-isolation

**Status**: completed
**Flight**: [Production gating re-architecture + dev-profile isolation + port free-fallback](../flight.md)

## Objective
When the app runs unpackaged (`!app.isPackaged`), redirect Electron's `userData` to a `-dev` sibling directory (e.g. `~/.config/goldfinch-dev`) **before** any code reads `userData`, so no dev launch can ever read or write the installed binary's profile.

## Context
- **DD1** (foundation, sequenced FIRST). This is the prerequisite that makes DD2 (toggle-binds) safe: a dev-left `automationEnabled=true` cannot auto-bind the shipped binary because it lives in a different profile. The F7 debrief is explicit that isolation must land **first or with** toggle-binds.
- **Security property is "can't be forgotten"** — keyed off `app.isPackaged` alone, with no flag/env to set, so a dev run can *never* pollute the installed profile. `dev`, `dev:debug`, `dev:automation`, and a bare `electron .` from source are all unpackaged → all isolated by the same key.
- **Architect-verified feasibility:** `userData` is read in exactly three places, all *inside* `whenReady`, none at module scope:
  - `src/main/main.js:868` — `settings.load(app.getPath('userData'))`
  - `src/main/shields.js:25` — `path.join(app.getPath('userData'), 'shields.json')` (via `shields.load()` at `main.js:867`)
  - `src/main/jars.js:70` — `path.join(app.getPath('userData'), 'containers.json')` (via `jars.load()` at `main.js:869`)
  - Calling `app.setPath('userData', …)` at the **top of the `whenReady` callback (before `main.js:867`)** redirects all three. `app.isPackaged` / `app.setPath` / `app.getPath` are legal pre-`ready` on Electron `^42`.

## Inputs
What exists before this leg runs:
- `src/main/main.js` with the `whenReady().then(() => { shields.load(); settings.load(app.getPath('userData')); jars.load(); … })` block (`main.js:866-869`).
- `shields.js`, `jars.js`, `settings-store.js` each resolve their store path from `app.getPath('userData')` at load time.
- The codebase convention of small **electron-free, unit-tested pure helpers** (`src/shared/automation-dev.js`, `src/main/automation/automation-port` logic, `download-path.js`), each with a sibling `test/unit/*.test.js`.

## Outputs
What exists after this leg completes:
- A pure helper that derives the dev `userData` path from the default path (suffix `-dev` on the basename), unit-tested electron-free.
- `src/main/main.js` calls `app.setPath('userData', <devPath>)` at the top of the `whenReady` callback when `!app.isPackaged`, before `shields.load()` / `settings.load()` / `jars.load()`.
- A new `test/unit/dev-profile.test.js` covering the helper.
- All three stores (`settings.json`, `shields.json`, `containers.json`) write under the `-dev` directory on a dev launch; the installed `~/.config/goldfinch` is untouched by any dev launch.
- **Free consequence (in scope for leg 7's byte-unchanged assertion):** because `setPath` runs before any `session.fromPartition` / `createWindow`, persistent partition storage (`userData/Partitions/` — cookies + per-jar session data for `persist:goldfinch` and container jars) also relocates under `-dev`. Not just the three JSON files — dev cookies/jar sessions cannot leak into the installed profile either. Leg 7 should treat partition data as in-scope when asserting the installed dir is unchanged.

## Acceptance Criteria
- [x] A pure helper (e.g. `devUserDataPath(defaultUserDataPath)` in a new `src/shared/dev-profile.js`, or co-located if the implementer prefers) returns the default path with `-dev` appended to its final path segment (`/home/x/.config/goldfinch` → `/home/x/.config/goldfinch-dev`), and is **electron-free** (no `require('electron')`) so it unit-tests without an Electron runtime.
- [x] `src/main/main.js`, at the **top of the `whenReady` callback before `shields.load()` (`main.js:867`)**, calls `app.setPath('userData', devUserDataPath(app.getPath('userData')))` **iff `!app.isPackaged`**. Packaged builds are untouched (no redirect).
- [x] **Owning AC (per the F7 `INTERNAL_PAGES` lesson — the ordering invariant must be nobody-can-orphan-it):** a dev launch writes **all three** of `settings.json`, `shields.json`, AND `containers.json` under the `-dev` directory — not just `settings.json`. The redirect runs before *every* `getPath('userData')` consumer, so adding a fourth store later inherits isolation automatically. _(Code inspection: the `setPath` precedes `shields.load()`/`settings.load(...)`/`jars.load()` at top of `whenReady`; live write verification is leg 7's.)_
- [x] **Ordering-invariant AC (static proxy for the runtime check — addresses review Q1):** code inspection confirms **no** `getPath('userData')` consumer (in `main.js`, `shields.js`, `jars.js`, or any module) can resolve the pre-redirect path — i.e. every reader runs *after* the `app.setPath` call in `whenReady` (verified: the three readers are inside `load()` calls at `main.js:867-869`, all after the proposed `setPath` at top of `whenReady`; no module-scope reader). This static guarantee makes leg 7's live byte-unchanged check a formality rather than a discovery.
- [x] `test/unit/dev-profile.test.js` exists and asserts: the `-dev` suffix derivation for a representative path; a **doubled-trailing-separator** input (`…/goldfinch//`) yields exactly one `-dev` suffix with no stray separator; a Windows-style path gets `-dev` on the final segment; and the helper file contains **no** `require('electron')` (pins the DD1 electron-free invariant). The helper is applied **exactly once per launch** — no idempotence guard, no `endsWith('-dev')` dead-code branch.
- [x] `npm test`, `npm run typecheck`, and `npm run lint` all pass.

## Verification Steps
- `npm test` — the new `dev-profile.test.js` passes alongside the existing suite.
- `npm run typecheck` — no new type errors (JSDoc types where the codebase uses them).
- `npm run lint` — clean.
- **Code inspection** confirms the `app.setPath` call is positioned before `shields.load()` at `main.js:867` and is guarded by `!app.isPackaged`.
- **Runtime isolation (deferred to leg 7 `verify-integration`, per the flight's validation approach):** a `dev:automation` launch reads/writes `~/.config/goldfinch-dev`; the installed `~/.config/goldfinch` is byte/mtime-unchanged across the dev session. *This leg lands on code-inspection + unit tests; the live cross-profile assertion is leg 7's responsibility (it has the packaged build + GUI).* Note this explicitly in the flight-log entry so the runtime check is not assumed done here.

## Implementation Guidance

1. **Add the pure path helper** (`src/shared/dev-profile.js` recommended — `shared/` is where electron-free helpers live):
   ```js
   'use strict';
   // Derive the dev-isolated userData path from Electron's default userData path.
   // Pure + electron-free so it unit-tests without an Electron runtime (DD1).
   function devUserDataPath(defaultUserDataPath) {
     // Append `-dev` to the final path segment: `/.config/goldfinch` -> `/.config/goldfinch-dev`.
     // Use path.join-safe string ops; the basename suffix keeps it a clear sibling that
     // survives npm reinstalls and is obviously separate in a file listing.
     return defaultUserDataPath.replace(/[\\/]+$/, '') + '-dev';
   }
   module.exports = { devUserDataPath };
   ```
   - **Use `/[\\/]+$/` (one-or-more), not `/[\\/]?$/`** — the `?` form mishandles a doubled trailing separator (`…/goldfinch//` → `…/goldfinch/-dev`). The `+` form collapses any run of trailing separators so `…/goldfinch`, `…/goldfinch/`, and `…/goldfinch//` all yield `…/goldfinch-dev`. (Electron returns a clean path at runtime, but the test asserts the doubled case, so the contract must be real.) Match the project's existing helper style (CommonJS, `'use strict'`, JSDoc if the file warrants it).

2. **Wire the redirect in `main.js`** at the very top of the `whenReady` callback (currently `main.js:866`), **before** `shields.load()`:
   ```js
   app.whenReady().then(() => {
     // DD1: dev runs are profile-isolated from the installed binary. Keyed off
     // app.isPackaged alone — no flag to forget — so a dev launch can never read or
     // write ~/.config/goldfinch. Must run before ANY getPath('userData') consumer
     // (settings/shields/jars all resolve their store path at load()).
     if (!app.isPackaged) {
       app.setPath('userData', devUserDataPath(app.getPath('userData')));
     }
     shields.load();
     settings.load(app.getPath('userData'));
     jars.load();
     …
   ```
   - Add `const { devUserDataPath } = require('../shared/dev-profile');` to the require block, **grouped with the other `../shared/*` requires** (near `main.js:10-11,16`), not appended at the end.

3. **Add the unit test** (`test/unit/dev-profile.test.js`), mirroring the `node --test` style of the existing unit tests (e.g. `automation-dev.test.js`):
   - Assert `devUserDataPath('/home/u/.config/goldfinch')` === `'/home/u/.config/goldfinch-dev'`.
   - Assert a single-trailing-slash input yields the same single `-dev` suffix.
   - Assert a **doubled-trailing-separator** input (`'/home/u/.config/goldfinch//'`) yields exactly `'/home/u/.config/goldfinch-dev'` (no stray separator) — this is the case the `+` quantifier fixes.
   - Assert a Windows-style path (`C:\\Users\\u\\AppData\\Roaming\\goldfinch`) gets `-dev` on the final segment (the regex handles `\\` and `/`).
   - Assert the helper file contains no `require('electron')` (read the source and check) — pins the electron-free invariant.

## Edge Cases
- **Trailing separator** in the default path → strip before appending (the regex `/[\\/]?$/` covers `/` and `\`).
- **`app.setPath` before `ready`** — keep the call inside `whenReady` (not module scope) so `getPath('userData')` returns the fully-resolved default; the Architect verified all consumers are inside `whenReady`, so top-of-`whenReady` is early enough.
- **Packaged build** — the guard `!app.isPackaged` means zero behavior change for the shipped binary; do not redirect.
- **Do NOT couple the helper to electron** — it takes the default path as an argument; the `app.getPath`/`app.setPath`/`app.isPackaged` calls stay in `main.js`. This preserves the electron-free unit test and matches the `automation-dev.js` / `automation-port` pattern.
- **Operator profile reset is independent of this leg (review Q2).** The flight's one-time operator reset of the polluted `~/.config/goldfinch` can run in parallel and does **not** gate leg 1's tests — leg 1 writes only under `-dev` and never touches the installed profile, so its unit tests + code inspection are unaffected by the installed profile's current contents. No reference to the reset is needed in this leg.

## Files Affected
- `src/shared/dev-profile.js` — new pure helper.
- `src/main/main.js` — require the helper; call `app.setPath('userData', …)` at top of `whenReady` when `!app.isPackaged`.
- `test/unit/dev-profile.test.js` — new unit test.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test` + typecheck + lint)
- [ ] Update flight-log.md with leg progress entry (note the deferred runtime isolation check → leg 7)
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 1 of 8)
- [ ] Commit deferred to flight-end batch review (per agentic-workflow batch model — do NOT commit per-leg)

## Citation Audit
6 source citations verified against current code at leg design time (2026-06-17):
- `src/main/main.js:866-869` (`whenReady` callback: `shields.load()` / `settings.load(app.getPath('userData'))` / `jars.load()`) — **OK** (verified via `sed -n '866,869p'`; `settings.load(app.getPath('userData'))` is line 868).
- `src/main/shields.js:25` (`path.join(app.getPath('userData'), 'shields.json')`) — **OK**.
- `src/main/jars.js:70` (`path.join(app.getPath('userData'), 'containers.json')`) — **OK**.
- `src/main/main.js:3` (`const { app, … } = require('electron')`) — **OK** (app is imported).
- grep confirms `getPath('userData')` appears in exactly those three locations; no module-scope reader. **OK**.
