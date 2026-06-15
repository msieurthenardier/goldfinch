# Leg: engine-scaffold-and-resolve

**Status**: completed
**Flight**: [Drive Engine (input / nav / tabs)](../flight.md)

## Objective

Stand up the `src/main/automation/` module group and build `resolve.js` — the pure-where-possible
core that maps a `webContentsId` to a live `webContents`, **rejects any internal-session contents at
resolve-time** (the single load-bearing security control while the flight is ungated), and classifies
a resolved contents as chrome vs guest.

## Context

- **DD1** — the engine acts natively on a `webContents` resolved in the main process (input/nav);
  tab lifecycle is renderer-mediated (Leg 2). This leg builds only the resolution + classification
  core that every later act/nav call funnels through.
- **DD2** — the canonical tab handle is `webContentsId` (`wcId`). All act/nav calls take a `wcId`;
  `webContents.fromId(id)` is the main-process resolver (precedent: `main.js:190`, `main.js:634`).
- **DD5** — the internal-session exclusion is enforced **inside resolve for every act/nav call**, not
  merely as an enumerate filter. Resolving a `wcId` whose `session.__goldfinchInternal === true`
  (strict `=== true`) is **rejected**, so a directly-supplied internal-guest `wcId` (the bypass path)
  cannot be driven. The session-type registry (`WeakMap<Session, type>`) is **deferred** — this flight
  introduces no new session category.
- Because this flight is ungated (DD4), the resolve-time predicate is the **only** thing protecting
  the privileged `goldfinch://settings` internal guest from being driven. It gets explicit acceptance
  criteria and dedicated unit assertions.
- **Pattern to mirror — `src/main/internal-ipc.js`**: deliberately Electron-free at module top so the
  pure predicate is unit-testable under plain `node --test` with no Electron stub. Electron handles
  (`webContents.fromId`, the chrome `mainWindow.webContents`) are **injected** into the resolver, not
  `require('electron')`-d at the top. The strict `=== true` marker check and "pass the raw value to
  the predicate, don't pre-coerce with `!!`" discipline are copied directly from `internal-ipc.js:31`
  and its test matrix.

## Inputs

What exists before this leg runs:
- `src/main/internal-ipc.js` — the Electron-free pure-predicate + injection pattern to mirror.
- `src/shared/url-safety.js` — sibling pure-module convention (dual CJS export).
- `src/main/main.js:190` — `webContents.fromId(webContentsId)` resolution precedent.
- `src/main/main.js:170` — `contents.session?.__goldfinchInternal` marker read precedent.
- `src/main/main.js:518` — `wc.session.__goldfinchInternal === true` strict-equality filter precedent
  (in `broadcastToChromeAndInternal`).
- `src/main/main.js:93` — `let mainWindow` (chrome host; `mainWindow.webContents` is the chrome
  renderer contents).
- `test/helpers/electron-stub.js` — the side-effecting electron shim for tests that DO touch electron.
- `test/unit/internal-ipc.test.js` — the predicate-matrix + fake-object test style to mirror.
- `node --test test/unit/*.test.js` runner (package.json `test` script) in place.

## Outputs

What exists after this leg completes:
- `src/main/automation/resolve.js` — new module exporting the pure predicate, the classifier, and the
  resolve function (Electron-free at top; Electron handles injected).
- `test/unit/automation-resolve.test.js` — unit tests for the pure logic (predicate matrix + resolve
  rejection paths + classification), runnable under `node --test` with no live Electron.
- (Optional) a short module-group JSDoc header noting `src/main/automation/` is the automation engine
  home and the dev-only seam is interim (DD7) — kept minimal; the seam itself is Leg 5.

## Acceptance Criteria

- [x] **AC1** — `src/main/automation/resolve.js` exists and is Electron-free at module top (no
  top-level `require('electron')`), mirroring `internal-ipc.js`. Electron access (`fromId`, chrome
  contents) is via injected parameters.
- [x] **AC2** — A pure predicate (e.g. `isInternalContents(wc)`) returns `true` **iff**
  `wc.session.__goldfinchInternal === true` (strict). Returns `false` for: missing `wc`, missing
  `wc.session`, marker `undefined`/`false`, and **truthy-but-not-`true`** marker (e.g. `1`). Never throws.
- [x] **AC3** — A resolve function (e.g. `resolveContents(wcId, { fromId, chromeContents })`)
  returns the live `webContents` for a valid web/chrome `wcId`, and **throws** (rejects) when the
  resolved contents is internal-session — i.e. a directly-supplied internal-guest `wcId` is rejected,
  **not only filtered from enumerate** (DD5, the bypass path).
- [x] **AC4** — `resolveContents` also throws a clear error when `fromId(wcId)` returns `null`/
  `undefined` (no such contents) and when `wcId` is not a number. Error messages are distinguishable
  (no-such-contents vs internal-session-rejected vs bad-handle) so callers/tests can assert which guard fired.
- [x] **AC5** — A classifier (e.g. `classifyContents(wc, chromeContents)`) returns `'chrome'` when
  `wc === chromeContents` and `'guest'` otherwise. Pure; never throws on a valid `wc`. A nullish
  `chromeContents` injection never matches a real `wc`, so the result is `'guest'` (the engine glue —
  Leg 5 — is responsible for injecting a live chrome contents; see Edge Cases).
- [x] **AC6** — `test/unit/automation-resolve.test.js` covers AC2–AC5 with fake `wc`/session objects
  (no live Electron), including: the truthy-but-not-`true` marker case, the direct-internal-`wcId`
  rejection case, the `fromId`-returns-`null` case, the non-number-`wcId` case, and a
  **destroyed-contents** case (`wc.isDestroyed()` → `true` ⇒ throws `no-such-contents`). Full suite
  `node --test test/unit/*.test.js` is green.
- [x] **AC7** — `npm run typecheck` and `npm run lint` are clean for the new files.

## Verification Steps

- `node --test test/unit/automation-resolve.test.js` — new tests pass.
- `npm test` — full unit suite green (no regression).
- `npm run typecheck` — no new TS/JSDoc errors (`// @ts-check` header on the new module, matching
  `internal-ipc.js:1`).
- `npm run lint` — clean.
- Manual read: confirm `resolve.js` has no top-level `require('electron')` (grep) and that the
  internal-session check uses strict `=== true`.

## Implementation Guidance

1. **Create `src/main/automation/resolve.js`** with `// @ts-check` and `'use strict';`, mirroring the
   header discipline of `src/main/internal-ipc.js:1-9`. Add a top comment explaining the module is
   Electron-free so the pure logic is offline-testable, and that the chrome contents + `fromId` are
   injected.

2. **Pure predicate `isInternalContents(wc)`**:
   ```js
   /**
    * @param {any} wc  a webContents (or fake) — may be null/undefined
    * @returns {boolean} true iff wc.session.__goldfinchInternal === true (strict)
    */
   function isInternalContents(wc) {
     return !!wc && !!wc.session && wc.session.__goldfinchInternal === true;
   }
   ```
   Mirror `internal-ipc.js:31` — strict `=== true`, never coerce the marker.

3. **Classifier `classifyContents(wc, chromeContents)`**:
   ```js
   function classifyContents(wc, chromeContents) {
     return wc === chromeContents ? 'chrome' : 'guest';
   }
   ```
   `chromeContents` is `mainWindow.webContents` at the call site (injected, not imported).

4. **Resolver `resolveContents(wcId, { fromId, chromeContents })`** — dependency-injected so it is
   testable without Electron:
   - If `typeof wcId !== 'number'` → throw a `bad-handle` error.
   - `const wc = fromId(wcId);` — `fromId` is `webContents.fromId` at the call site.
   - If `!wc` → throw a `no-such-contents` error. Then, if `wc.isDestroyed?.()` returns `true` → also
     throw `no-such-contents` (a resolved-but-destroyed contents is treated as gone). Optional
     chaining is for the fake test objects that lack `isDestroyed`, not for nullish safety (`!wc` is
     already past). **Add a unit test for this destroyed path (AC6).**
   - If `isInternalContents(wc)` → throw an `internal-session` rejection error (this is the DD5
     load-bearing guard — comment it as such).
   - Otherwise return `wc`.
   - Give the three throw paths distinct, greppable messages (e.g. prefix `automation: `) so tests and
     callers can assert which guard fired (AC4).

5. **CommonJS export** — `module.exports = { isInternalContents, classifyContents, resolveContents };`
   `isInternalContents` is exported **for direct test coverage** (mirroring `isTrustedInternalSender`
   being exported from `internal-ipc.js` so the strict-`===true` matrix can be pinned), even though
   only `resolveContents` is called by engine consumers. This module is main-process only (no renderer
   global needed, unlike `url-safety.js`).

6. **Tests `test/unit/automation-resolve.test.js`** — mirror `test/unit/internal-ipc.test.js`:
   - Predicate matrix for `isInternalContents`: `{session:{__goldfinchInternal:true}}`→true; `false`→
     false; `1`→false (pins strict `===true`); missing session→false; `null` wc→false.
   - `classifyContents`: identity match → `'chrome'`; different object → `'guest'`.
   - `resolveContents` with a fake `fromId`:
     - valid guest contents → returns it;
     - internal-session contents (directly supplied `wcId`) → throws the internal-session rejection
       (the bypass-path assertion, DD5);
     - `fromId` returns `null` → throws no-such-contents;
     - non-number `wcId` → throws bad-handle.
   - These tests are Electron-free (fake objects), so no `electron-stub` require is needed — note that
     in a comment, as `internal-ipc.test.js:4-6` does.

## Edge Cases

- **Truthy-but-not-`true` marker** (`__goldfinchInternal: 1`): must be treated as **not internal**
  by the predicate's strict check — but that means it would NOT be rejected by resolve. That is the
  correct, intended behavior: the marker is only ever set to literal `true` in `main.js`
  (`main.js:693,718`), so a non-`true` value is by definition not the internal session. The test pins
  the predicate returns `false` for `1`, matching `internal-ipc.test.js:25`. (The risk the strict
  check guards against is the *inverse* — never letting a truthy-but-wrong value mark something as
  trusted; here non-internal = drivable, which is fine because only literal `true` marks the real
  internal session.)
- **`wc.isDestroyed()`** — a resolved-but-destroyed contents should be treated as no-such-contents.
  Guard with optional chaining (`wc.isDestroyed?.()`) so the fake test objects (no `isDestroyed`) are
  unaffected.
- **`fromId` returning a contents from a *different* BrowserWindow** — out of scope for this leg
  (single-window architecture); no special handling.
- **Nullish `chromeContents` injection** — `classifyContents` does a strict `===` against
  `chromeContents`; a `null`/`undefined` chrome injection simply never matches a real `wc`, so it
  returns `'guest'`. The contract is that the **engine glue (Leg 5) injects a live
  `mainWindow.webContents`** before any classification matters; the resolver's *security* guard
  (`isInternalContents`) does not depend on `chromeContents` at all, so a null chrome injection cannot
  weaken the internal-session rejection. No throw is needed here.
- **`classifyContents` on a nullish `wc`** — only ever called on a contents that `resolveContents`
  already returned (non-null), so this is unreachable in normal flow. `null === chromeContents` would
  return `'guest'` harmlessly; no dedicated guard or test required (AC5 scopes the contract to a
  "valid `wc`").

## Files Affected
- `src/main/automation/resolve.js` — **new**: pure predicate + classifier + injected resolver.
- `test/unit/automation-resolve.test.js` — **new**: unit tests for the above.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed` (in this file's header)
- [x] Check off this leg in flight.md
- [x] If final leg of flight: (not final — no flight-level transition)
- [x] Commit handled at flight level (batch commit after `verify-integration`, per /agentic-workflow)
