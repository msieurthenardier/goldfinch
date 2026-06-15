# Leg: observe-scaffold-and-screenshot

**Status**: completed
**Flight**: [Observe Engine (screenshot / DOM / a11y)](../flight.md)

## Objective

Stand up `src/main/automation/observe.js` (the read half of the engine) and build its first two
exports: `captureScreenshot(wcId, deps)` — a foreground-first, base64-PNG screenshot of a target
tab — and `captureWindow(deps)` — a whole-window (chrome + composited guests) capture; both
debugger-free via `capturePage()`, both unit-tested with fakes.

## Context

- **DD1 — Screenshot via `capturePage()` (debugger-free), foreground-first for guests.** A guest must
  be brought to front before `capturePage()` or it returns blank (Flight-1 spike). The result is
  returned as a base64 PNG string (`NativeImage.toPNG().toString('base64')`) so it is JSON-serializable
  across the dev seam and the future Flight-3 transport.
- **DD5 — Foreground-to-act, reusing Flight 1.** Guest ops `await activate(wcId)` then **re-resolve**
  (stale-handle guard) before acting — the exact discipline in `input.js:138 (actOn)`. Chrome is always
  live (no activate). One live tab at a time.
- **DD9 — debugger confined to `observe.js`'s a11y path only.** This leg adds **no** `webContents.debugger`
  use (screenshots are debugger-free); the module stays debugger-free until Leg 3 adds `readAxTree`.
- **Reuse, do not re-build.** `resolveContents` / `classifyContents` (internal-session reject is
  absolute — DD6) and `activate` already exist from Flight 1. This leg imports them; it does not
  re-implement resolution or the security guard.
- **Module convention (mirror `input.js`).** `// @ts-check` + `'use strict'`; **no top-level
  `require('electron')`** — every Electron handle (`fromId`, `chromeContents`, `activate`) is injected
  through a `deps` object so orchestration is unit-testable offline with fakes. Live capture is
  integration-verified (Leg 5 smoke + Leg 6 HAT), not unit-tested.
- **`captureWindow` is its own export / dispatch key, NOT a `null`-wcId overload of `captureScreenshot`**
  (flight leg note). Keeping them separate avoids an ambiguous "wcId may be null" contract. The
  whole-window shot is `chromeContents.capturePage()`.

## Inputs

What exists before this leg runs:
- `src/main/automation/resolve.js` — exports `resolveContents`, `classifyContents`, `isInternalContents`
  (Flight 1). `resolveContents` throws on bad-handle / no-such-contents / internal-session.
- `src/main/automation/input.js:138 (actOn)` — the resolve → (guest) `await activate` → **re-resolve**
  → act sequence to mirror exactly.
- `src/main/automation/engine.js:42` — the injected `activate = (wcId) => tabs.activateTab(wcId, base)`
  built per call (the `activate` shape `deps` will carry; engine wiring itself is Leg 4).
- `test/unit/automation-input.test.js` — the fake-`wc` / `makeGuestWc` / `makeFakeFromId` /
  ordering-via-callLog test style to mirror.
- `node --test test/unit/*.test.js` runner (package.json `test`); `tsc --noEmit -p jsconfig.json`
  (`typecheck`); `eslint .` (`lint`).

## Outputs

What exists after this leg completes:
- `src/main/automation/observe.js` — new module, `// @ts-check`, electron-free at top, exporting
  `captureScreenshot` and `captureWindow` (orchestration only; deps injected).
- `test/unit/automation-observe.test.js` — unit tests for both exports (guest foreground-first ordering,
  chrome no-activate, re-resolve-after-activate, resolve-rejection passthrough, base64 shape,
  whole-window path), runnable under `node --test` with no live Electron.
- Engine wiring and the dev seam are **NOT** touched here — `captureScreenshot` / `captureWindow` are
  added to `engine.js` dispatch in Leg 4 (`wire-and-docs`), alongside the Leg-2/3 ops, to keep all
  engine churn in one reviewable place.

## Acceptance Criteria
- [ ] `src/main/automation/observe.js` exists with `// @ts-check`, `'use strict'`, **no top-level
  `require('electron')`**, and imports `resolveContents` / `classifyContents` from `./resolve`.
- [ ] `captureScreenshot(wcId, { fromId, chromeContents, activate })` resolves the target; for a
  **guest** it `await activate(wcId)` **then re-resolves** before calling `wc.capturePage()`; for
  **chrome** it does not activate.
- [ ] `captureScreenshot` returns a base64 PNG string derived from `image.toPNG().toString('base64')`
  (the fake `capturePage` returns a fake `NativeImage` with a `toPNG()` → Buffer).
- [ ] `captureScreenshot` propagates `resolveContents` rejections unchanged — a bad-handle / dead /
  **internal-session** wcId throws (the DD6 absolute exclusion holds for screenshots), and on the
  internal-session path **neither `activate` nor `capturePage` is called**.
- [ ] A guest screenshot waits for paint settle **after** foregrounding before `capturePage()`. The
  **load-bearing path is the small fixed delay** — the common screenshot case is an *already-loaded*
  guest, where DD1's blank-capture is a compositor/visibility effect (not a load-state effect) and
  there is no load event to await. `wc.once('did-stop-loading', …)` is **only** the fallback for a
  guest foregrounded *mid-navigation* (still loading). The wait mechanism is parameterized/injectable
  (`waitForPaint` dep) so it is unit-testable without real timers and tunable live.
- [ ] `captureWindow({ chromeContents })` calls `chromeContents.capturePage()` and returns the same
  base64 shape; it does **not** take a wcId and does **not** activate. If `chromeContents` is nullish it
  throws the existing `'automation: chrome window unavailable'` message **verbatim** (the same string
  `engine.js:34` throws for the same null-window condition — reuse it, do not coin a new variant).
- [ ] `test/unit/automation-observe.test.js` covers: guest activate-before-capture **ordering**,
  activate-called-once-with-wcId, **re-resolve after activate** (a fresh `fromId` lookup occurs
  post-activate), chrome no-activate, the three resolve-rejection paths (bad-handle / dead /
  internal-session) with no capture call, the base64 return shape, and `captureWindow`'s whole-window
  path + nullish-chrome throw.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` all green.

## Verification Steps
- `node --test test/unit/automation-observe.test.js` — new cases pass.
- `node --test test/unit/*.test.js` — full unit suite green (no regressions in the Flight-1 automation
  tests).
- `npm run typecheck` — clean (the injected-deps JSDoc typedefs check out).
- `npm run lint` — clean.
- Manual read: confirm `observe.js` has no top-level `require('electron')` and no `webContents.debugger`
  reference.

## Implementation Guidance

1. **Create `src/main/automation/observe.js`**
   - Header: `// @ts-check` / `'use strict'`; a short module JSDoc noting it is the **read** half of the
     automation engine, electron-free at top (deps injected), and that `webContents.debugger` will
     appear **only** in this module's `readAxTree` (Leg 3) — screenshots/DOM are debugger-free. Include
     a one-line handoff note that Leg 4 (`wire-and-docs`) adds the `captureScreenshot` / `captureWindow`
     dispatch keys to `engine.js` (no `engine.js` edit in this leg).
   - `const { resolveContents, classifyContents } = require('./resolve');`

2. **`captureScreenshot(wcId, { fromId, chromeContents, activate })`** — async. Mirror `input.js:138
   actOn` structure:
   ```js
   let wc = resolveContents(wcId, { fromId, chromeContents });
   if (classifyContents(wc, chromeContents) === 'guest' && typeof activate === 'function') {
     await activate(wcId);                        // DD1/DD5 foreground-to-act (guest only)
     wc = resolveContents(wcId, { fromId, chromeContents });  // stale-handle re-resolve
     await settlePaint(wc, deps);                 // paint-settle after foregrounding
   }
   const image = await wc.capturePage();
   return image.toPNG().toString('base64');
   ```
   - Resolve-before-activate means an internal-session wcId throws before `activate`/`capturePage` (AC).

3. **Paint-settle helper** — keep it injectable so unit tests don't wait on real timers. Suggested:
   accept an optional `waitForPaint` in deps (default a real implementation: if `wc.isLoading?.()` then
   `await once(wc, 'did-stop-loading')`, else `await delay(delayMs)`). The **fixed-delay branch is the
   primary path** (already-loaded foreground guest, the common case); the `did-stop-loading` branch only
   covers a guest foregrounded mid-load. Make `delayMs` injectable (e.g. `waitForPaint(wc, { delayMs })`)
   so the Leg-5 smoke can sweep values without editing the module; the default is a small fixed delay
   (e.g. 50–150 ms). The **exact** value — and whether any delay even helps (the spike premise; flight
   Divert criterion) — is a **leg-time live check**, not a docs answer. Tests inject an
   immediate/no-op `waitForPaint`.

4. **`captureWindow({ chromeContents })`** — async. `if (!chromeContents) throw new Error('automation:
   chrome-unavailable — …')`; `const image = await chromeContents.capturePage(); return
   image.toPNG().toString('base64');`. No wcId, no activate, no classify.

5. **Exports** — `module.exports = { captureScreenshot, captureWindow };` (plus the paint-settle helper
   if it is a named export worth unit-testing; otherwise keep it module-private and inject in tests via
   the `waitForPaint` dep).

6. **Tests** (`test/unit/automation-observe.test.js`) — reuse the `makeGuestWc` / `makeInternalWc` /
   `makeDestroyedWc` / `makeFakeFromId` helper shapes from `automation-input.test.js`, extended with a
   fake `capturePage()` returning `{ toPNG: () => Buffer.from('PNGBYTES') }`. Track activate↔capture
   ordering with a `callLog` (as the input test does for activate↔sendInputEvent). Inject an immediate
   `waitForPaint` so no real timer fires.
   - **Internal-session "no capture, no activate" test:** mirror `automation-input.test.js:381`
     (`click: internal-session …`) — assert the activate spy and the `capturePage` spy are both
     uncalled and the call rejects with `automation: internal-session`.
   - **Re-resolve proof:** back `fromId` with a counter so the **second** lookup (post-activate)
     returns a *distinct* fake wc from the first, and assert the **second** handle's `capturePage` is
     the one invoked — this genuinely proves the stale-handle re-resolve, not just that activate ran.

## Edge Cases
- **Internal-session wcId** → `resolveContents` throws before activate/capture (assert no capture). The
  DD6 absolute exclusion is non-negotiable here; do not add an internal bypass.
- **Re-resolve returns a *different* handle after activate** — the post-activate `resolveContents` call
  must be the one whose `.capturePage()` is used (assert the fresh lookup is captured, not the stale
  pre-activate handle). This is the Flight-1 stale-handle lesson; preserve it.
- **`capturePage()` rejects** (e.g. window gone mid-capture) → let it reject; the engine/seam surfaces
  the error. Do not swallow.
- **`activate` absent from deps** (chrome-only callers) → guest path guarded by `typeof activate ===
  'function'` (matches `actOn`); a guest with no `activate` simply captures without foregrounding (and
  may be blank live — acceptable, mirrors `actOn`).
- **Blank guest capture despite foregrounding** — out of scope to *fix* here (flight Divert criterion);
  this leg ensures the foreground-then-settle sequence is correct, Leg 5/6 confirm non-blank live.

## Files Affected
- `src/main/automation/observe.js` — **new**.
- `test/unit/automation-observe.test.js` — **new**.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

> **Batched-flight note:** This is an autonomous leg in a batched flight. The Developer implements to
> acceptance criteria, updates the flight log, sets this leg's status to `landed`, and signals
> `[HANDOFF:review-needed]` — it does **NOT** commit, does **NOT** set `completed`, and does **NOT**
> check off the leg/flight. Code review, `completed` status, leg/flight check-off, and the commit are
> handled once at the end of the autonomous batch (flight review + commit).

- [ ] All acceptance criteria verified
- [ ] Unit suite + typecheck + lint green
- [ ] Update flight-log.md with a Leg Progress entry
- [ ] Set this leg's status to `landed`
