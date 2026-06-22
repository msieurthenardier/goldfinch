# Leg: downloads-handler-refactor

**Status**: completed
**Flight**: [Polish & MCP Hygiene](../flight.md)

## Objective

Extract the download **record + `download-progress`/`download-done` payload** construction out of the
Electron `will-download` handler in `src/main/main.js` into a new pure, electron-free helper that takes
**injected accessors** (the live `DownloadItem`'s `getSavePath`/`isPaused`/… methods), so the two
Flight-5 HAT-fix reads — `filename = basename(getSavePath())` and `paused = isPaused()` — become
unit-testable; behavior-preserving (byte-identical payloads/records), plus a one-line doc of the Electron
paused/`getState()` fact.

## Context

- **DD4 (flight.md:149-167)** — the helper must take **accessors, not plain primitives**. The architect's
  reasoning: the two HAT defects were *reads off the live `DownloadItem`*
  (`filename = path.basename(item.getSavePath())` at `main.js:561`; `paused = item.isPaused?.()` at
  `main.js:582`/`:594`), not transformations of already-extracted data. A strictly pure helper fed plain
  primitives would only unit-test payload *assembly* and would NOT cover the two `item.*` reads that
  actually broke. So inject the extractors: the helper receives an accessor bag (real `item` methods in
  prod, fakes in tests) and a unit test asserts `filename === basename(getSavePath())` and
  `paused === isPaused()` with fakes. **DD4 fallback**: if accessor injection proves awkward against the
  handler shape, scope the helper to payload-assembly-only and let the hardened `downloads-surface`
  behavior test (verify leg) own the `item.*` regression — but accessor injection is **preferred**.
  *(Design review found accessor injection clean — see "Risks / Open Questions". Fallback not needed.)*
- **DD4** — document the Electron fact ("a paused `DownloadItem` stays `getState()==='progressing'`;
  `isPaused()` is the only truth") "at the helper or in a short download-architecture note." **Decision:
  put it at the helper's top comment** (rationale in "Implementation Guidance" step 4) — the helper IS the
  download-architecture surface that re-trips it, so co-locating beats a separate note.
- **Flight-5 debrief — `wireDownloadHandler` is the most under-tested high-value function**
  (`flight-debrief.md:77-81`, `:141-143`, `:161`): it owns silent-save, id assignment, the
  filename-from-`savePath` fix, and the `paused`-from-`isPaused()` broadcast, with zero direct unit
  coverage; two of the three HAT defects lived here.
- **Flight-5 flight-log / HAT leg — the three fixes** the HAT found and fixed inline
  (`flight-debrief.md:106-112`): (1) **double-download** on file-URL navigation (a vestigial `.catch`
  re-navigate firing a 2nd `will-download` — *not* in this helper's scope; guarded by the verify leg's
  count assertion); (2) **wrong filename** — record used `item.getFilename()` (original suggested name)
  instead of `basename(getSavePath())` (the deduped on-disk name); (3) **pause/resume feedback** — `paused`
  made first-class in the broadcast via `isPaused()` because `getState()` stays `'progressing'` while
  paused. This leg makes (2) and (3) unit-guarded; (1) is owned by the behavior test (verify leg).
- **Behavior-preserving (DD4 trade-off, flight-debrief.md "verified behavior-preserving"):** no functional
  change. The emitted payloads and the registered record must be **byte-identical** to today's. The
  acceptance bar is the existing 940-test suite + the hardened `downloads-surface` behavior test (verify
  leg) staying green, plus the new helper unit tests.

## Inputs

What exists before this leg runs (all line refs current as of leg design — see Citation Audit):

- `src/main/main.js:540` `wireDownloadHandler(sess)` — the session-scoped `will-download` handler. The
  three construction sites this leg extracts:
  - **`:558-561` — `savedName`**: `// getSavePath() is now final … const savedName = path.basename(item.getSavePath());`
    (the Flight-5 wrong-filename fix; read off `getSavePath()`, NOT `getFilename()`).
  - **`:565-573` — the register record**: `downloadsManager.register({ url, filename: savedName, savePath:
    item.getSavePath(), mime: item.getMimeType?.(), startTime: Date.now() })`.
  - **`:576-596` — the `updated` handler**: hoists `const received = item.getReceivedBytes();` /
    `const total = item.getTotalBytes();` (`:579-580`), calls `downloadsManager.update(id, { state,
    received, total, paused: item.isPaused?.() })` (`:582`), then `broadcastToChromeAndInternal(
    'download-progress', { id, url, filename: savedName, state, received, total, paused: item.isPaused?.() })`
    (`:587-595`).
  - **`:598-612` — the `done` handler**: `const savePath = state === 'completed' ? item.getSavePath() :
    null;` (`:600`), `downloadsManager.finalize(id, { state, savePath, endTime: Date.now() })` (`:602`),
    then `broadcastToChromeAndInternal('download-done', { id, url, filename: savedName, state, savePath })`
    (`:605-611`).
- `src/main/main.js:981-989` — a **SECOND** `download-progress` payload, built in the
  pause/resume/cancel action handler (`download-action` IPC). It reads `item.getReceivedBytes()`,
  `item.getTotalBytes()`, `item.getState?.() || 'progressing'`, `item.isPaused?.()`, `item.getURL()`,
  `path.basename(item.getSavePath())` and assembles `{ id, url, filename, state, received, total, paused }`
  — the **same shape** as the `:587` progress payload but for an explicit pause/resume push. This leg
  routes this site through the same helper (see Implementation Guidance step 3) so the progress shape has
  one definition. *(Behavior-preserving: same fields, same values.)*
- `src/main/downloads-manager.js` — `createManager(store)`; `register({ url, filename, savePath, mime,
  startTime })` (`:41`), `update(id, { received, total, state, paused })` (`:65`), `finalize(id, { state,
  savePath, endTime, error })` (`:81`). **Electron-free factory, store injected** — the convention this
  helper mirrors.
- `src/main/download-path.js` — `sanitizeFilename`, `isWithinDir`; electron-free, `require('path')` only.
  The closest "pure path-logic helper" precedent (note: it has **no** `@ts-check` header — the newer
  modules do; match the newer ones, see step 1).
- `src/main/main.js:565` `downloadsManager` (module-scoped manager) and `:574` `liveDownloadItems`
  (`Map<id, DownloadItem>`) — the manager/registry the handler threads. **The helper does NOT touch
  either** — it builds plain objects; the handler still calls `manager.register/update/finalize` and
  `liveDownloadItems.set/get/delete` with the helper's output. (Keeps the helper electron-and-manager-free.)
- `src/main/main.js:587` `broadcastToChromeAndInternal('download-progress', …)` / `:605`
  `broadcastToChromeAndInternal('download-done', …)` — the fan-out the handler calls with the helper's
  payload (unchanged; the helper does not broadcast).
- `test/unit/downloads-manager.test.js:14` `makeFakeStore` — the **fake-injection test pattern** to
  mirror: a pure in-memory fake of the injected dependency, deterministic assertions, no fs/electron, no
  require-cache dance (it's a factory, not a singleton). The new helper test follows this exactly.
- `test/unit/download-path.test.js` — the test-file skeleton (`node:test` + `node:assert/strict`, `require`
  the module under test). 940 tests currently pass.
- `package.json:14-16` — `test` = `node --test test/unit/*.test.js`; `typecheck` = `tsc --noEmit -p
  jsconfig.json`; `lint` = `eslint .`.

## Outputs

What exists after this leg completes:

- **`src/main/downloads-payload.js`** (new) — electron-free helper module exporting the payload/record
  builders that take an accessor bag.
- **`src/main/main.js`** — `wireDownloadHandler` (`:540`) and the `download-action` progress push
  (`:981`) refactored to build their record/payloads via the helper; behavior-preserving.
- **`test/unit/downloads-payload.test.js`** (new) — unit coverage for the filename, paused, and assembly
  behaviors.

## Acceptance Criteria

- [x] **`src/main/downloads-payload.js` exists, electron-free** — no `require('electron')`, no `app.*`, no
  IPC. May `require('path')` only (for `basename`), mirroring `download-path.js`. Carries the `// @ts-check`
  header + JSDoc, matching `downloads-store.js`/`downloads-manager.js`.
- [x] **Helper takes accessors, not primitives** (DD4). The progress/done/record builders receive an
  **accessor bag** of the relevant `DownloadItem` methods (e.g. `getSavePath`, `isPaused`, `getState`,
  `getReceivedBytes`, `getTotalBytes`, `getMimeType`) — NOT already-extracted `filename`/`paused`. A unit
  test can therefore assert the reads, not just the assembly.
- [x] **`filename === basename(getSavePath())`** is computed inside the helper (the wrong-filename HAT fix),
  and a unit test proves it with a fake `getSavePath` whose basename **differs from** the fake
  `getFilename` — including a deduped `" (1)"` name (e.g. `getSavePath → "/dl/report (1).pdf"`,
  `getFilename → "report.pdf"`; helper yields `"report (1).pdf"`).
- [x] **`paused === isPaused()`** is read inside the helper for the progress payload AND the manager-update
  patch (the pause/resume HAT fix), and a unit test proves both `true` and `false` while the fake
  `getState()` returns `'progressing'` (proving paused is NOT derived from state).
- [x] **The progress payload** assembles `{ id, url, filename, state, received, total, paused }` with
  `received = getReceivedBytes()`, `total = getTotalBytes()`; a unit test asserts every field including `id`
  and `url` (which are passed in, not read off `item`).
- [x] **The done payload** assembles `{ id, url, filename, state, savePath }` where `savePath =
  state === 'completed' ? getSavePath() : null`; a unit test asserts both branches (completed → real path;
  any non-completed → `null`).
- [x] **The register record** assembles `{ url, filename, savePath, mime, startTime }` (the
  `manager.register` arg shape) with `filename = basename(getSavePath())`, `savePath = getSavePath()`,
  `mime = getMimeType?.()`; a unit test asserts it (incl. `mime` omitted/undefined tolerated, matching
  `manager.register`'s `typeof mime === 'string'` guard at `downloads-manager.js:55`).
- [x] **Behavior-preserving**: `wireDownloadHandler` (`main.js:540`) and the `download-action` progress
  push (`main.js:981`) build the **byte-identical** record/payloads via the helper — same field names, same
  values, same order of `item.*` reads (notably `getReceivedBytes`/`getTotalBytes` still hoisted once so
  the same bindings feed both `manager.update` and the broadcast, per the `:579-580` comment). No new
  fields, no dropped fields, no `item.getFilename()` reintroduced as the display name.
- [x] **Electron paused fact documented** at the top of `downloads-payload.js` (the one-liner: a paused
  `DownloadItem` keeps `getState()==='progressing'`; `isPaused()` is the only source of truth — so the
  payload reads `paused` from `isPaused()`, never derives it from `state`).
- [x] **`node --test test/unit/*.test.js` passes** — the new `downloads-payload.test.js` plus the existing
  suite (was 940; this leg adds the new tests and no regressions). `npm run typecheck` clean; `npm run
  lint` clean.

## Verification Steps

- `node --test test/unit/downloads-payload.test.js` — filename-from-savePath (incl. deduped `" (1)"`
  differing from `getFilename`), paused-from-isPaused (true/false while state `'progressing'`),
  progress/done/record assembly (incl. done `savePath` completed-vs-null branches).
- `node --test test/unit/*.test.js` — full suite green; no regression in `downloads-manager.test.js` /
  `downloads-store.test.js` / `download-path.test.js`.
- `grep -n "require('electron')\|app\.\|ipcMain\|BrowserWindow" src/main/downloads-payload.js` — **no
  matches** (electron-free).
- `grep -n "@ts-check" src/main/downloads-payload.js` — present.
- `grep -n "getFilename" src/main/main.js` — the only remaining read is the **suggested-name** resolution
  at `:546` (`(meta && meta.suggestedName) || item.getFilename() || 'download'`), which feeds `setSavePath`
  *before* the file lands — NOT the display filename. The display `filename` everywhere downstream is
  `basename(getSavePath())` (via the helper). Confirm no `filename: item.getFilename()` regression.
- `grep -nE "broadcastToChromeAndInternal\('download-(progress|done)'" src/main/main.js` — both call sites
  still present (`:587`, `:605`) plus the action-handler progress push (`:981`); each now passes a
  helper-built payload.
- `npm run typecheck && npm run lint` — both clean (JSDoc accessor-bag typedef; no unused-var / no
  any-leak lint).

## Implementation Guidance

1. **Create `src/main/downloads-payload.js` — electron-free, accessor-injected.**
   - Headers: `// @ts-check` then `'use strict';` (match `downloads-store.js:1`/`downloads-manager.js:1`).
     `const path = require('path');` is the only import (for `basename`) — mirrors `download-path.js`.
   - Define a JSDoc typedef for the **accessor bag** (the subset of `Electron.DownloadItem` methods read).
     Name it e.g. `DownloadItemAccessors`:
     ```js
     /**
      * @typedef {object} DownloadItemAccessors
      * @property {() => string} getSavePath    Final on-disk path (set via setSavePath BEFORE register).
      * @property {() => boolean} [isPaused]     Electron exposes paused ONLY here (see top note).
      * @property {() => string} [getState]      Note: stays 'progressing' while paused — do NOT derive paused from it.
      * @property {() => number} getReceivedBytes
      * @property {() => number} getTotalBytes
      * @property {() => (string|undefined)} [getMimeType]
      */
     ```
     In production the real `item` IS an accessor bag (it has all these methods) — the handler can pass
     `item` directly. In tests, pass a plain object with fake methods. *(Either pass `item` whole, or build
     a small `{ getSavePath: () => item.getSavePath(), … }` adapter — passing `item` whole is simpler and
     keeps prod call sites tiny; the typedef documents the contract either way.)*
   - Export three builders. Each takes `(acc, fixed)` where `acc` is the accessor bag and `fixed` carries
     the non-`item` values the handler already has in scope (`id`, `url`, the `state` arg from the event,
     `startTime`):
     ```js
     /** @param {DownloadItemAccessors} acc @returns {string} */
     function displayFilename(acc) { return path.basename(acc.getSavePath()); }

     /**
      * The manager.register({ url, filename, savePath, mime, startTime }) arg shape.
      * @param {DownloadItemAccessors} acc
      * @param {{ url: string, startTime: number }} fixed
      */
     function buildRegisterRecord(acc, { url, startTime }) {
       return {
         url,
         filename: displayFilename(acc),
         savePath: acc.getSavePath(),
         mime: acc.getMimeType ? acc.getMimeType() : undefined,
         startTime
       };
     }

     /**
      * The 'download-progress' broadcast payload (and the source of the manager.update patch).
      * @param {DownloadItemAccessors} acc
      * @param {{ id: number, url: string, state: string }} fixed
      */
     function buildProgressPayload(acc, { id, url, state }) {
       return {
         id,
         url,
         filename: displayFilename(acc),
         state,
         received: acc.getReceivedBytes(),
         total: acc.getTotalBytes(),
         paused: acc.isPaused ? acc.isPaused() : undefined
       };
     }

     /**
      * The 'download-done' broadcast payload.
      * @param {DownloadItemAccessors} acc
      * @param {{ id: number, url: string, state: string }} fixed
      */
     function buildDonePayload(acc, { id, url, state }) {
       const savePath = state === 'completed' ? acc.getSavePath() : null;
       return { id, url, filename: displayFilename(acc), state, savePath };
     }

     module.exports = { displayFilename, buildRegisterRecord, buildProgressPayload, buildDonePayload };
     ```
   - **Byte-identical caveats to preserve:**
     - `mime` and `paused` use the `getMimeType?.()` / `isPaused?.()` optional-call semantics the handler
       has today (`main.js:570`, `:582`/`:594`). Reproduce with `acc.fn ? acc.fn() : undefined` so an
       absent accessor yields `undefined` — exactly what the optional-chaining call produced. `register`
       drops an undefined `mime` via its own `typeof mime === 'string'` guard (`downloads-manager.js:55`),
       so emitting `mime: undefined` is byte-identical to today.
     - `update`'s patch is `{ state, received, total, paused }` — derive it from the progress payload by
       reusing `received`/`total`/`paused` so the **byte getters are still hoisted once** (the `:579-580`
       comment is load-bearing: the same `received`/`total` bindings feed both `update` and the broadcast).
       Do NOT call `getReceivedBytes()` twice. (See step 2 for how the handler reuses the payload.)

2. **Refactor `wireDownloadHandler` (`main.js:540`) to call the helper.**
   - Add `const { buildRegisterRecord, buildProgressPayload, buildDonePayload } = require('./downloads-payload');`
     at the top of `main.js` with the other main-module requires.
   - **Register (`:558-573`)**: replace the `savedName` local + the inline `register({...})` object with
     `const record = buildRegisterRecord(item, { url, startTime: Date.now() }); const id = downloadsManager
     ? downloadsManager.register(record) : -1;`. (Keep the `downloadsManager ?` guard and the `if (id !==
     -1) liveDownloadItems.set(id, item);` line at `:574` unchanged.) The `savedName` const is no longer
     needed for register; the `updated`/`done` handlers below also stop using `savedName` (they call the
     helper). **Drop the now-unused `savedName` local** — leaving it would be a lint `no-unused-vars`.
   - **`updated` (`:576-596`)**: build the payload once, then derive the manager patch from it:
     ```js
     item.on('updated', (_e, state) => {
       const payload = buildProgressPayload(item, { id, url, state });
       if (downloadsManager) {
         downloadsManager.update(id, {
           state: payload.state, received: payload.received, total: payload.total, paused: payload.paused
         });
       }
       broadcastToChromeAndInternal('download-progress', payload);
     });
     ```
     This preserves "byte getters hoisted once" (now hoisted inside the helper, read once) and the
     identical update/broadcast field values. *(If you prefer, keep `manager.update` taking the same object
     identity — but it mutates nothing, so deriving the four fields is fine and explicit.)*
   - **`done` (`:598-612`)**: 
     ```js
     item.once('done', (_e, state) => {
       pendingDownloads.delete(url);
       const payload = buildDonePayload(item, { id, url, state });
       if (downloadsManager) {
         downloadsManager.finalize(id, { state, savePath: payload.savePath, endTime: Date.now() });
       }
       liveDownloadItems.delete(id);
       broadcastToChromeAndInternal('download-done', payload);
     });
     ```
     `finalize`'s `savePath` is `payload.savePath` (the same `state==='completed' ? getSavePath() : null`).

3. **Route the second progress site (`main.js:981-989`, the `download-action` pause/resume push) through
   the helper too.** Today it independently computes `received`/`total`/`state`/`paused`/`url`/`filename`
   (`:974-989`). Replace the manual payload object with
   `const payload = buildProgressPayload(item, { id, url: item.getURL(), state: item.getState?.() ||
   'progressing' });` then `downloadsManager.update(id, { state: payload.state, received: payload.received,
   total: payload.total, paused: payload.paused });` and `broadcastToChromeAndInternal('download-progress',
   payload);`. **Byte-identical check**: this site's `state` is `item.getState?.() || 'progressing'`
   (different source than the `updated` event's `state` arg, but that's the same value this site computes
   today at `:976`); `url` is `item.getURL()` (same as `:983`); `filename` becomes
   `basename(getSavePath())` (same as `:984`); `received`/`total`/`paused` identical. Confirm the `state ||
   'progressing'` fallback is computed at the call site (the helper takes `state` as given), matching today.
   *(This dedups the progress shape to one definition — a maintenance win called out in the debrief as the
   coverage gap. If routing this site complicates the diff, it is acceptable to leave `:981` as-is and only
   refactor the `wireDownloadHandler` sites — the helper + its tests still satisfy DD4 — but routing both
   is preferred for single-definition.)*

4. **Document the Electron paused fact at the helper top** (DD4: "at the helper or a short
   download-architecture note" → helper, decided). Add a top-of-file comment block:
   ```js
   // Pure, electron-free builders for the download record + 'download-progress'/'download-done'
   // broadcast payloads (Flight 6, DD4). Extracted from wireDownloadHandler so the two Flight-5
   // HAT-fix reads are unit-testable. Built to take INJECTED ACCESSORS (the live DownloadItem's
   // methods in production, fakes in tests) so a unit test covers the *reads*, not just assembly.
   //
   // ELECTRON PAUSED FACT (load-bearing, re-tripped ~6 places): a paused DownloadItem keeps
   // getState() === 'progressing'. The ONLY source of truth for paused is item.isPaused(). So the
   // payload reads `paused` from isPaused() and NEVER derives it from getState(). (Flight-5 HAT.)
   //
   // FILENAME FACT: the display filename is basename(getSavePath()) — the deduped/sanitized on-disk
   // name (uniquePath adds " (n)") — NOT item.getFilename() (the original server-suggested name).
   // (Flight-5 HAT wrong-filename fix.)
   ```
   No separate `docs/` note needed; the helper is the surface that re-trips these facts.

5. **Write `test/unit/downloads-payload.test.js`** mirroring the `makeFakeStore` injection pattern from
   `downloads-manager.test.js:14` — a `makeFakeItem(overrides)` factory returning a plain object of fake
   accessors. Cases:
   - **`displayFilename` / register filename = basename(getSavePath())**: `getSavePath → '/dl/report
     (1).pdf'`, `getFilename → 'report.pdf'` (present but irrelevant); assert
     `buildRegisterRecord(item, {...}).filename === 'report (1).pdf'` and `displayFilename(item) ===
     'report (1).pdf'` — proving the deduped on-disk name, NOT the suggested name, is used.
   - **paused = isPaused() true while state 'progressing'**: `getState → 'progressing'`, `isPaused →
     true`; assert `buildProgressPayload(item, {...}).paused === true`. Then `isPaused → false`; assert
     `.paused === false`. (Proves paused is read from `isPaused()`, decoupled from `state`.)
   - **progress assembly**: `getReceivedBytes → 4096`, `getTotalBytes → 8192`; assert the full payload
     `{ id, url, filename, state, received: 4096, total: 8192, paused }` including the passed-in `id`/`url`.
   - **done assembly — completed branch**: `state: 'completed'`, `getSavePath → '/dl/x.bin'`; assert
     `savePath === '/dl/x.bin'`. **non-completed branch**: `state: 'interrupted'`; assert
     `savePath === null` (and that `getSavePath` is NOT used for the done payload's savePath when not
     completed — guard via a `getSavePath` that throws if called, or a spy).
   - **register record shape**: assert `{ url, filename, savePath, mime, startTime }`; one case with
     `getMimeType → 'application/pdf'` (mime present) and one with `getMimeType` **absent** from the bag
     (assert `mime === undefined`, matching `register`'s `typeof mime === 'string'` drop).
   - Use `node:test` + `node:assert/strict`, `require('../../src/main/downloads-payload')` (mirror
     `download-path.test.js`).

6. **Typecheck/lint.** The new module is `@ts-check`'d — give the accessor-bag typedef and the builder
   JSDoc enough types that `tsc -p jsconfig.json` is clean (the optional methods on the typedef must be
   marked `[optional]` so the `acc.fn ? acc.fn() : undefined` guard typechecks). Run `npm run lint`
   (eslint .) — watch the dropped `savedName` local (must be removed, not left unused).

## Edge Cases

- **`getSavePath()` returning a bare filename (no dir)**: `path.basename` is still correct (returns the
  name unchanged). No special handling — matches today's `:561`.
- **`mime` absent**: accessor bag without `getMimeType` → `mime: undefined` → `register` drops it
  (`downloads-manager.js:55`). Byte-identical to today's `item.getMimeType?.()` returning `undefined`.
- **`isPaused` absent** (defensive — the live item always has it, but the `?.()` today tolerates absence):
  → `paused: undefined`. Byte-identical to `item.isPaused?.()` today.
- **`done` with a non-`'completed'` terminal state** (`cancelled`/`interrupted`): `savePath: null` — the
  helper must NOT call `getSavePath()` in that branch (matches `:600`; the test guards this).
- **Manager not yet loaded** (`downloadsManager` null, `:565` guard): the handler still builds the record
  via the helper but skips `register` (id `-1`); broadcasts still fire with the helper payloads. The helper
  is manager-agnostic, so this is unchanged — the `downloadsManager ?` guards stay in main.js, not the
  helper.
- **Second progress site fallback** (step 3 optional): if the `download-action` site is left un-refactored,
  it keeps its inline payload — no behavior change, but the progress shape then has two definitions. Note
  in the flight log if you take the fallback.

## Files Affected

- `src/main/downloads-payload.js` — **new**: electron-free, `@ts-check`'d accessor-injected builders
  (`displayFilename`, `buildRegisterRecord`, `buildProgressPayload`, `buildDonePayload`); top-comment doc
  of the Electron paused + filename facts.
- `src/main/main.js` — refactor `wireDownloadHandler` (`:540`): record + progress + done built via the
  helper (drop the `savedName` local); add the `require('./downloads-payload')`. Route the
  `download-action` progress push (`:981`) through `buildProgressPayload` (preferred; fallback noted).
  **Behavior-preserving — no functional change.**
- `test/unit/downloads-payload.test.js` — **new**: filename/paused/assembly coverage with fake accessors.

> **Sequencing note for the Flight Director:** this leg and **leg 5 (`app-icon`)** both touch
> `src/main/main.js`. They edit **different regions** — this leg touches `wireDownloadHandler` (`:540`)
> and the `download-action` handler (`:981`); leg 5 touches the `BrowserWindow` icon (`:256`,
> `icon: path.join(__dirname, '..', '..', 'build', 'icon.png')`). No overlap, but sequence/merge them so
> the second to land rebases cleanly. Legs 1-3 also have uncommitted working-tree changes (flight in
> progress); none touch `wireDownloadHandler`/`downloads-payload`.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`node --test test/unit/*.test.js`; `npm run typecheck`; `npm run lint`)
- [ ] Update flight-log.md with leg progress entry (note: behavior-preserving, helper signature, whether
  the second progress site was routed or fallback taken)
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 4 of 6)
- [ ] Commit deferred per `/agentic-workflow` (flight-level review + commit after the last autonomous leg)

---

## Citation Audit

All code citations verified against current code at leg design time (legs 1-3 of Flight 6 have shifted
`main.js` line numbers vs. the Flight-5 leg-1 artifact and DD4's `:561,582,594`). Verified clean:

- `main.js:540` `wireDownloadHandler` — **OK** (was `:507` in the Flight-5 leg-1 artifact; shifted +33 by
  intervening work — current value verified by grep).
- `main.js:546` suggested-name (`item.getFilename()` for setSavePath), `:558-561` `savedName =
  path.basename(item.getSavePath())`, `:565-573` register record, `:576-596` `updated` handler
  (`:579-580` byte-getter hoist, `:582` update, `:587-595` progress broadcast), `:598-612` `done` handler
  (`:600` savePath, `:602` finalize, `:605-611` done broadcast) — **OK**, all read in full.
- `main.js:981-989` second `download-progress` payload (in the `download-action` handler, `:974-989`
  source reads) — **OK** (the prompt's leg-design brief did not flag this site; surfaced during full-file
  read and folded in as step 3).
- `main.js:256` `BrowserWindow` `icon: path.join(__dirname, '..', '..', 'build', 'icon.png')` — **OK**
  (the leg-5 overlap region; verified for the sequencing note).
- `downloads-manager.js:41` `register`, `:55` `typeof mime === 'string'` drop, `:65` `update`, `:81`
  `finalize` — **OK**.
- `download-path.js` (electron-free precedent, no `@ts-check`), `downloads-store.js:1`/`downloads-manager.js:1`
  (`@ts-check` + `'use strict'` headers to match) — **OK**.
- `downloads-manager.test.js:14` `makeFakeStore` (fake-injection test pattern) — **OK**.
- `package.json:14-16` `test`/`typecheck`/`lint` scripts — **OK**.
- **Test count**: `node --test test/unit/*.test.js` reports **940 tests, 940 pass** at leg design time
  (matches "940 after legs 1-3").

**DD4 note (not drift):** DD4 cites the HAT-fix reads at `main.js:561,582,594`. Those line numbers are the
*current* values (verified) — the savedName read is `:561`, the `update` paused read is `:582`, the
progress-broadcast paused read is `:594`. No repair needed.
